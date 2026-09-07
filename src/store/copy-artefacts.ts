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
import type {
  ArtifactKind,
  ArtifactParts,
  ArtifactSource,
  ArtifactStore,
  StepStamp,
} from "./artifacts.js";
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
  store: ArtifactSource,
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
async function stampOrEmpty(store: ArtifactSource, slug: string, step: StepName): Promise<StepStamp> {
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
  /* **`ArtifactSource`, not `ArtifactStore`, since 2026-09-05**, and the
     widening is the point rather than tidying. The source half of this copy is
     two method calls — `read` and `stampFor` — and demanding a whole store for
     them meant the only thing that could be a source was something that could
     also write. So the fixture loader's source had to be a
     `createFsArtifactStore`, which is one import in one helper and was the
     largest single thing keeping the filesystem store alive at run time:
     56 test files executed it and 14 named it.
     `tests/helpers/fixture-artefacts.ts` is now what goes here, and it cannot
     write at all. Nothing about the copy itself changed, and `ArtifactStore` is
     still assignable, so `tests/artefact-copy.test.ts` passed exactly as before
     — which mattered for a day: the filesystem store was deleted on 2026-09-05
     and that file now copies from the fixture reader into `memoryArtefacts()`.
     This function is the half of the pair that survived, and it survived
     because of this widening.
     docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § D. */
  from: ArtifactSource,
  to: ArtifactStore,
  slug: string,
): Promise<StepName[]> {
  const copied: StepName[] = [];
  for (const step of STEP_ORDER) {
    const parts = await readParts(from, slug, step);
    if (Object.keys(parts).length === 0) continue;
    /**
     * **A pending manifest means the `labels` step has not run, so there is
     * nothing of it to copy.**
     *
     * `hierarchy` and `labels` write the same two artefacts, and a source that
     * holds them holds them once — the fixture reader lists one `tree.json` and
     * one `labels.json` under both steps
     * (tests/helpers/fixture-artefacts.ts § LAYOUT), which is honest, because on
     * disk those are the files stage 4 as a whole produced. For a completed
     * manifest both writes are true and both happen.
     *
     * For a `PendingLabelsFile` (`batches: null`, src/labels.ts) the second one
     * is a claim the artefact itself contradicts, and `writeArtefacts` refuses
     * it outright: a labels run that produced no batches would delete the very
     * receipt the write is holding. Because `beginStep`, `write` and
     * `finishStep` are three store calls, that refusal lands *after* the run row
     * is open — so before this guard, copying a legitimately pending article
     * failed **and** left a `labels = running` row behind.
     *
     * **Keyed on the manifest rather than on the fixture**, which is why the
     * guard is here rather than in the test helper: the state is a real one that
     * stage 2a introduced, any future source can hold it, and taking `labels`
     * out of the helper's layout would have hidden it from the copier instead of
     * teaching the copier to carry it. Skipping is the honest answer — the
     * pending manifest still travels, as part of `hierarchy`, where it correctly
     * sets `nav_label_status = 'pending'` and deletes the destination's receipt.
     * GPT Sol's F1 on stage 2a, 2026-09-06;
     * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md.
     */
    if (step === "labels" && parts.labels?.batches === null) continue;
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
