/**
 * **What is left of the revision seam: two constants, and a note about where
 * the seam went.**
 *
 * This file used to be *the* seam a job ran its revision through — one small
 * `RevisionLifecycle` interface, a Postgres implementation, a do-nothing
 * filesystem one, and the `SPIDERYARN_STORE` switch between them — written on
 * 2026-08-26 because the adapter existed and nothing called it.
 *
 * ## Nothing ever did call it, and on 2026-09-01 it was deleted
 *
 * The day the pipeline started publishing through Postgres, it went a different
 * way. `src/jobs.ts`'s `claimSession` opens a `StoreSession` straight over
 * [`pg-session.ts`](pg-session.ts), which calls `openOrBeginJobDraft`,
 * `finishStepRun`, `publishRevisionIn` and `failRevisionIn` in
 * [`pg-revisions.ts`](pg-revisions.ts) itself, inside the job's own
 * transaction. `RevisionLifecycle` was never on that path, and between its
 * writing and its deletion `git grep` found `revisionLifecycle` from exactly
 * one place outside this file — a guard test.
 * `docs/plans/260831b-finish-the-database-move.md` § Stage 4 is the demolition;
 * [`docs/project/database.md`](../../docs/project/database.md) describes what a
 * finished job does now.
 *
 * **Two things went with it that were not dead by accident**, and are recorded
 * here because a reader looking for them will look here first:
 *
 * - `ABANDONED_DRAFT_MS` — six hours, being comfortably longer than any ingest
 *   and short enough that abandoned copies do not accumulate for a week. It was
 *   the only argument for `sweepAbandonedDrafts`, which
 *   ([`pg-revisions.ts`](pg-revisions.ts)) now has **no caller at all**, in
 *   production or in tests. Each abandoned draft carries a full copy of the
 *   article's `revision_blocks`, so that is storage rather than tidiness, and it
 *   remains a real gap — just not one this file will close.
 * - `NO_DRAFTS`, the filesystem's permanent answer that there is no such thing
 *   as a draft in `data/<slug>/`. There is no filesystem store to answer for
 *   any more.
 *
 * ## Why the file survives at all
 *
 * The two constants below. They live in [`artifacts.ts`](artifacts.ts) — they
 * are facts about a **step run's stamp**, which is what that file defines, and
 * it is a leaf that imports nothing from `store/`. They moved there on
 * 2026-08-27 because `pg-revisions.ts` needs them and importing them from here
 * made a cycle (`lint/suspicious/noImportCycles` caught it, and was right to:
 * the runtime happened to be fine, which is not a property worth depending on).
 *
 * They are re-exported here so that the seven test files importing them from
 * this path keep working. **That is the whole of this file's job**, and it is a
 * pure alias — worth retiring by repointing those importers at
 * `src/store/artifacts.js`, at a moment when fewer sessions are editing them.
 */

export { NO_INPUT_HASH, PIPELINE_RUN } from "./artifacts.js";
