# Review this plan before it is built

You are reviewing a **plan**, not code. Nothing has been implemented yet. Say plainly whether it is
ready to build, and if not, what must change.

Repo root is the working directory. You may read any file and **run one test file yourself** — please
do, if a claim below is checkable that way. A finding you reproduced outranks one you reasoned to.

## The plan

Read `docs/plans/260903e-glossary-delete-in-postgres.md` in full. That is the artefact under review.

## Background you should verify rather than accept

The job: `DELETE /api/glossary/:slug` answers **501** under `SPIDERYARN_STORE=postgres`, which is
what production runs. The reader-facing effect is that the glossary panel's "Start again" button
does not work. We intend to build the Postgres half.

The plan rests on three load-bearing claims. **Check each against the code, and say if any is wrong:**

1. **The refusal's stated reason has expired.** `src/store/index.ts:340` refuses because nulling
   `article_revisions.glossary` would mutate a published revision, and that table is documented
   immutable. The plan claims `src/db/schema.ts:380` already settles this — "Immutable in its text"
   — and explicitly names `glossary` as one of four artefacts written onto an already-published
   revision in a single UPDATE, which `src/store/artifacts-pg.ts` does on every glossary run today.

2. **Nulling the column is enough to make the step re-run.** The worry was that
   `revision_step_runs` would still say `glossary: done` while the column was empty, so "Start
   again" would delete a glossary nothing regenerates — strictly worse than the 501. The plan claims
   `hasArtefacts` (`src/store/artifacts-pg.ts`, around line 678) requires BOTH a done row AND every
   produced kind reading back, and `readArtefactOutcome` answers `absent` for a null column — so
   `has()` is false, `stepIsDone` (`src/pipeline.ts:906`) is false, and an ordinary run rebuilds it.
   **This is the claim I am least willing to be wrong about**, because being wrong makes the feature
   destructive. Trace it yourself. In particular: is there any path where a glossary job would skip
   the step, or where the reader's `run(false)` after the delete would not actually re-run it?

3. **The delete must NOT remove the `revision_step_runs` row.** Follows from 2. Check that leaving
   the row does not break anything else — `stampForStep`, `beginDraftIn`'s carry-forward
   (`src/store/pg-revisions.ts:780`), the importer, or the metadata page.

## Specific questions

- **The concurrency shape.** The plan chooses a transaction with a `.for("update")` locked read of
  the `articles` row, then the UPDATE — copying `pgVisibilityStore.set` (`src/store/pg-visibility.ts:94`)
  — over a single UPDATE with a subselect. Is that right? Does locking the `articles` row here
  serialise against `publishRevision` in a way that could deadlock or stall a running job?
- **What happens if a glossary job is running when the reader presses the button?** The run finishes
  and writes the column back, so the reader's delete is silently undone. The plan does not address
  this. Is it worth addressing, or is it the same race the filesystem already has and not worth
  machinery? Say which.
- **`{ deleted: boolean }` semantics.** The plan makes `deleted` mean "there was one and now there
  is not", via `AND glossary IS NOT NULL` in the WHERE, matching the filesystem's ENOENT ->
  `{ deleted: false }` (`src/api.ts:846`). The client (`src/web/useGlossary.ts:469`) ignores the
  body and treats any non-throw as success. Is the distinction worth keeping?
- **Ownership.** The plan uses `ownedSlug` (`src/store/owned-slug.ts`) with the ambient
  `currentOwnerId()`, and 404s on a miss rather than 403. Confirm there is no way for this to null
  another owner's column, and that `tests/owner-isolation.test.ts` would actually catch the
  unfiltered spelling if someone wrote it.
- **File placement.** A new `src/store/pg-glossary.ts` versus adding to `src/store/pg-lookups.ts`,
  which already owns the sibling `GlossaryLookupStore`. Which is right for this repo?
- **What is missing from the stages?** Anything that will break that the plan has not named. The
  plan claims the only test that goes red on building this is
  `tests/store-seams-have-two-implementations.test.ts`, by design.

## What I want back

A verdict — **ready to build** or **not ready** — then the findings, most important first, each
saying what is wrong and what it should be instead. Be blunt. If the plan is over-engineered for
what this is, say so; if it is under-engineered and will break something, say that. Where you are
uncertain, say you are uncertain rather than picking a side.
