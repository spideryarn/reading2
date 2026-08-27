/**
 * Move one article's artefacts from one store to another, through the seam.
 *
 * ## Why this exists
 *
 * `db:import` is being deleted (docs/plans/delete-the-importer.md). Three test
 * suites currently use it to get an article into Postgres —
 * `tests/store-parity.test.ts`, `tests/store-roundtrip.test.ts` and
 * `tests/chat-anchor.test.ts` — and they need some other way to do that or they
 * go with it.
 *
 * **The rejected answer was a stripped-down importer kept for tests.** It would
 * be a second implementation of files → Postgres, free to drift from the
 * production write path, and the drift would be invisible because tests would
 * be the only thing exercising it.
 *
 * This is the other answer, and it turned out to need no parsing code at all:
 * reading an artefact from a directory is `fsArtifacts.read`, and writing it to
 * Postgres is `pgArtifacts.write`. So the "fixture loader" is a loop over
 * `produces` between two `ArtifactStore`s, and every byte of it goes through
 * the interface production ships on. A test built on this is *more* honest than
 * one built on the importer, not less.
 *
 * ## What it deliberately does not do
 *
 * **It is not `db:import`.** It does not touch the reader's own state —
 * comments, chat, searches, glossary lookups, the shelf — because
 * `ArtifactStore` explicitly excludes all of it (src/store/artifacts.ts). Any
 * suite that needs reader state must put it there through the live reader
 * stores, which is what `tests/store-roundtrip.test.ts` will do.
 *
 * **It does not publish.** Writing artefacts and making a draft the article a
 * reader sees are two different acts, and `publishRevision` has guards worth
 * running rather than routing around. The caller publishes.
 */
import { STEPS, STEP_ORDER } from "../../src/pipeline.js";
import type { ArtifactKind, ArtifactParts, ArtifactStore, StepStamp } from "../../src/store/artifacts.js";
import type { StepName } from "../../src/types.js";

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
 * artefact's validity from another's — `blocks` before `toc`, above all — and
 * writing an empty part set would record a step as having run when it has not.
 *
 * Returns the steps it actually copied, so a caller can assert on the set. A
 * silent no-op over an article the source store has never heard of is exactly
 * the shape this repo keeps being caught by
 * (docs/reusable/silent-success.md), and an empty array is how a test sees it.
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
    await to.write(slug, step, parts, await stampOrEmpty(from, slug, step));
    copied.push(step);
  }
  return copied;
}
