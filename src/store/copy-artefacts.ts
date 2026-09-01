/**
 * Move one article's artefacts from one store to another, through the seam.
 *
 * ## Why this exists
 *
 * Because an article can exist in one store and be wanted in another: a fixture
 * on a disk that a Postgres test needs in the database. It is a loop over
 * `produces` between two `ArtifactStore`s, so every byte of it goes through the
 * interface production ships on.
 *
 * **The rejected answer was a stripped-down importer.** It would be a second
 * implementation of files → Postgres, free to drift from the production write
 * path — and `db:import` is being deleted precisely because it is that
 * (docs/plans/260827aa-delete-the-importer.md).
 *
 * ## It is a fixture loader again, and it was briefly more than that
 *
 * It lived at `tests/helpers/artefacts.ts` and was written to replace `db:import`
 * as a fixture loader for three suites. Between 2026-08-30 and 2026-09-01 it was
 * also the real ingest path: `publishingSession` copied a finished job's files
 * into a draft and published that, because the stages wrote their own files and
 * returned nothing a session could write. They all return their products now, so
 * a claim under Postgres writes straight into its draft and copies nothing
 * (`claimSession` in src/jobs.ts, docs/plans/260831b-finish-the-database-move.md
 * § Stage 3 — the flip). **It stays here rather than going back to `tests/`**:
 * `tests/helpers/load-article.ts` and the fixture suites still drive it, and it
 * is the one piece of machinery that moves an article between two stores through
 * the production interface.
 *
 * ## What it deliberately does not do
 *
 * **It is not `db:import`.** It does not touch the reader's own state —
 * comments, chat, searches, glossary lookups, the shelf — because
 * `ArtifactStore` explicitly excludes all of it (src/store/artifacts.ts). Any
 * caller that needs reader state must put it there through the live reader
 * stores.
 *
 * **It does not publish.** Writing artefacts and making a draft the article a
 * reader sees are two different acts, and `publishRevisionIn` has guards worth
 * running rather than routing around. The caller publishes.
 */
import { STEPS, STEP_ORDER } from "../pipeline.js";
import type { ArtifactKind, ArtifactParts, ArtifactStore, StepStamp } from "./artifacts.js";
import type { StepName } from "../types.js";

/**
 * Everything `store` holds for one step, as the argument `write` wants.
 *
 * Absent kinds stay absent rather than becoming `null`. That distinction is
 * real here: `exactOptionalPropertyTypes` is on across this repo, and a `null`
 * where the store had nothing is a claim that the step produced an empty
 * artefact.
 */
export async function readParts(
  store: ArtifactStore,
  slug: string,
  step: StepName,
): Promise<ArtifactParts> {
  const parts: ArtifactParts = {};
  for (const kind of STEPS[step].produces) {
    const value = await store.read(slug, step, kind);
    // The cast is the one place this loop cannot be typed: `kind` is a union,
    // so TypeScript cannot see that `read`'s result matches `parts[kind]`.
    if (value !== null) (parts as Record<ArtifactKind, unknown>)[kind] = value;
  }
  return parts;
}

/** What `store` recorded about this step, or a stamp saying nothing. */
async function stampOrEmpty(store: ArtifactStore, slug: string, step: StepName): Promise<StepStamp> {
  return (await store.stampFor(slug, step)) ?? {};
}

/**
 * Copy every step of one article from one store to the other.
 *
 * **Steps in pipeline order, and a step with nothing is skipped rather than
 * written empty.** Order matters because the destination may derive one
 * artefact's validity from another's — `blocks` before `hierarchy`, above all — and
 * writing an empty part set would record a step as having run when it has not.
 *
 * Returns the steps it actually copied, so a caller can assert on the set. A
 * silent no-op over an article the source store has never heard of is exactly
 * the shape this repo keeps being caught by
 * (docs/reusable/silent-success.md), and an empty array is how a caller sees it.
 */
export async function copyArtefacts(
  from: ArtifactStore,
  to: ArtifactStore,
  slug: string,
): Promise<StepName[]> {
  const copied: StepName[] = [];
  for (const step of STEP_ORDER) {
    const parts = await readParts(from, slug, step);
    if (Object.keys(parts).length === 0) continue;
    /* **All of a step's products, or none of it.** Copying one of `extract`'s
       two outputs and then calling `finishStep` would record a step as having
       completed while half of what it declares is missing — and an unstamped
       step's run row is exactly what `articleMetadata` trusts. `has` requires
       all-of-them for the same reason; a partial source is a broken article,
       and a loud refusal beats a copy that looks like it worked.
       GPT Sol, 2026-08-27; docs/plans/260827au-c1-c2-code-review-sol.md finding 5. */
    const wanted = STEPS[step].produces;
    if (Object.keys(parts).length !== wanted.length) {
      const missing = wanted.filter((kind) => !(kind in parts));
      throw new Error(
        `cannot copy "${slug}": the source has some but not all of ${step}'s products — ` +
          `missing ${missing.join(" and ")}. Finishing the step would claim it ran.`,
      );
    }
    /* **`beginStep` … `write` … `finishStep`, not `write` alone**, because a
       written artefact and a *completed step* are two different facts and only
       one of them is a file.

       On the filesystem `write` alone very nearly passes for a copy: `has`
       parses the artefacts and says yes. The Postgres adapter cannot be so
       forgiving — carry-forward means a value can be present because the
       previous revision had it, so completion is a `revision_step_runs` row
       with `status = 'done'` and nothing else will do. A copy that skipped this
       would land artefacts that store reports incomplete, and every reader of
       it would fail for a reason that has nothing to do with the copy.

       GPT Sol found this against the first version of this file, which called
       `write` only; docs/plans/260827aa-delete-the-importer-review-2-sol.md finding 2.
       Running the same three calls in the same order as the runner is also the
       point of the helper — a copy that takes a shortcut through the seam is a
       copy that stops proving the seam works. */
    const attempt = await to.beginStep(slug, step);
    await to.write(slug, step, parts, await stampOrEmpty(from, slug, step));
    await to.finishStep(slug, step, attempt);
    copied.push(step);
  }
  return copied;
}
