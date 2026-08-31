/**
 * The seam a job runs its revision through, and the one place that picks it.
 *
 * [`pg-revisions.ts`](pg-revisions.ts) is the *adapter* — `beginRevision`,
 * `recordStepRun`, `publishRevision`, `failRevision`, `sweepAbandonedDrafts`.
 * This file is the **seam**: one small interface, two implementations, and the
 * `SPIDERYARN_STORE` switch between them, so that
 * [`src/jobs.ts`](../jobs.ts) can call the same four methods whichever store is
 * live and needs no `if` around any of them.
 *
 * Written 2026-08-26 because the adapter existed and *nothing called it*, which
 * is the most dangerous state in the migration plan: the work looks done from
 * the file list. docs/plans/260826e-postgres-storage-implementation.md § Step 11 half A.
 *
 * ## Why the filesystem implementation does nothing at all
 *
 * Not laziness and not a stub. **There is no filesystem notion of a draft.**
 * `data/<slug>/` is one directory that every run overwrites in place — that is
 * precisely the property step 11 exists to end — so there is nothing for a
 * begin/publish pair to mean there. `NO_DRAFTS` returns `null` from `begin`,
 * and every other method takes `null` and returns immediately. The handle being
 * nullable is what keeps the branch out of the caller.
 *
 * ## Nothing is wired. Checked 2026-08-28.
 *
 * **This section used to open "Wired: a job opens a draft…". That was false, and
 * the paragraphs under it described an ingest that cannot happen.** No
 * production file imports this module. `revisionLifecycle` below is referenced
 * by exactly one thing in the repo, `tests/store-guarded.test.ts`, and
 * [`src/jobs.ts`](../jobs.ts) contains the word "draft" once, in a comment about
 * something else. So no job opens a draft, and none of the outcomes described
 * below — the empty draft, the refused publish, the one `warn` line — has ever
 * occurred.
 *
 * The sting is that this file was *written* to fix precisely that
 * (`457fa74`, "Give the revision adapter a seam, because nothing was calling
 * it"), and its own commit message names the failure exactly: *"That is the
 * worst state in this migration: the work looks finished from the outside and
 * the running code has never once gone through it."* The commit is one file, 259
 * insertions, and no change to `jobs.ts` — so the seam repeated, one level up,
 * the thing it was written to end. **Do not write "wired" here again until
 * `git grep` shows a caller outside `tests/`.**
 *
 * `sweepAbandonedDrafts` is in the same position, and it is the one with teeth:
 * `ABANDONED_DRAFT_MS` below explains that each abandoned draft carries a full
 * copy of the article's `revision_blocks`. Nothing calls `sweep()`. That is not
 * a leak today, because nothing creates drafts — **it becomes one the moment
 * `begin()` becomes reachable.** So the first production `begin()`, the artefact
 * wiring, the job fence carried through `publish` and `fail`, an atomic clear of
 * `jobs.draft_revision_id`, a scheduled `sweep()`, and a test that drives a
 * *refused* and a *failed* draft through that sweep, all have to land together.
 * Recorded as an acceptance condition on step 11, not as a separate fix. See
 * docs/plans/260828aj-simplification-wave-2.md § 0.6.
 *
 * ## What the artefact half would still need
 *
 * **Also not wired: the artefacts.** The pipeline stages still write
 * `data/<slug>/blocks.json` and the rest with their own `writeFile` calls
 * (step 11 half B stage 5 is what moves them), and
 * [`src/jobs.ts`](../jobs.ts) binds them to `fsArtifacts` unconditionally — with
 * no `SPIDERYARN_STORE` switch, though the *job* store two lines away does
 * switch on it. So even once a draft is opened, nothing would fill it. The
 * consequences below are what the guards are designed to produce when that day
 * comes, and are written in the future tense on purpose:
 *
 * - A **fresh article** gets an empty draft, and `publishRevision` refuses it —
 *   *"it has no blocks; it has no tree"*. Correct: the pipeline did not produce
 *   a publishable Postgres revision, it produced files.
 * - A **re-extraction** of an article already in Postgres gets a draft carrying
 *   the *previous* blocks, while the new ones land on disk. `recordStep` then
 *   stamps `toc` with the hash of the blocks it really ran against, the
 *   publication guard compares that against the draft's blocks, and the publish
 *   is refused — *"the tree was built from different blocks"*. Also correct,
 *   and it is the guard catching exactly the divergence it was written for.
 *
 * So once `begin()` is reached, an ingest under `SPIDERYARN_STORE=postgres`
 * will end with one `warn` line and a failed draft, and the reader will stay on
 * the revision they had. That is the honest state of a half-finished seam, and
 * it is preferable to the alternative, which is a republished copy of the old
 * revision under a green tick.
 *
 * **This file will need changing, though — an earlier draft of this comment said
 * it would not.** `begin` takes `opts.job` and hands it to `beginRevision`, and
 * then `RevisionHandle` drops it: the handle carries `slug`, `revisionId` and
 * `artifacts` and nothing else. So `publish` and both failure paths have no job
 * token to fence on, publication would skip the live-attempt check, and a failed
 * draft keeps `jobs.draft_revision_id` pointing at it — which the sweeper
 * deliberately spares. Carrying the fence through `publish` and `fail`, and
 * clearing that pointer in the same transaction, is part of the work, not a
 * consequence of it.
 *
 * **Today none of that runs**, because nothing calls `begin()` — see the top of
 * this comment. An ingest under `SPIDERYARN_STORE=postgres` writes files and
 * says nothing about revisions at all.
 *
 * ## What this file may log
 *
 * Slugs, ids, step names, counts, statuses. Never article prose, never a title.
 */

import { log } from "../log.js";
import type { StepName } from "../types.js";
import type { ArtifactStore } from "./artifacts.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "./artifacts.js";
import { guardDbStore } from "./db-errors.js";
import { STORE } from "./live.js";
import {
  beginRevision,
  failRevision,
  publishRevision,
  PublishRefused,
  recordStepRun,
  sweepAbandonedDrafts,
} from "./pg-revisions.js";

const logger = log("store");

/**
 * The draft a job is filling in, as far as its caller is concerned.
 *
 * `null` everywhere means "this store has no drafts", which is the filesystem's
 * permanent answer rather than a failure.
 */
export interface RevisionHandle {
  readonly slug: string;
  readonly revisionId: string;
  /**
   * The artefact store the job is writing through, kept on the handle so that
   * `recordStep` can read a step's own stamp rather than making the caller
   * fetch it. It is the same object `src/jobs.ts` already holds.
   */
  readonly artifacts: ArtifactStore;
}

export interface BeginOptions {
  readonly artifacts: ArtifactStore;
  /**
   * The job that owns this draft, if the job records live in Postgres.
   *
   * **Nothing passes one today.** Jobs are files under `data/_jobs/`
   * (src/jobs.ts), so there is no `jobs` row to fence against; the column and
   * the fence are step 12's, and `beginRevision` implements them already.
   */
  readonly job?: { readonly id: string; readonly attemptId: string };
}

/** One step's run, as much of it as the queue actually knows. */
export interface StepRunRecord {
  readonly step: StepName;
  readonly status: "running" | "done" | "error";
  readonly startedAt?: Date | undefined;
  readonly finishedAt?: Date | undefined;
}

export interface RevisionLifecycle {
  begin(slug: string, opts: BeginOptions): Promise<RevisionHandle | null>;
  recordStep(handle: RevisionHandle | null, run: StepRunRecord): Promise<void>;
  /** The published revision id, or `null` if there was nothing to publish or it was refused. */
  publish(handle: RevisionHandle | null): Promise<string | null>;
  fail(handle: RevisionHandle | null, reason: string): Promise<void>;
  /** How many abandoned drafts were reclaimed. */
  sweep(): Promise<number>;
}

/* ------------------------------------------------------ the two constants -- */

/**
 * `PIPELINE_RUN` and `NO_INPUT_HASH` **live in artifacts.ts now**, and are
 * re-exported here so that every existing importer keeps working.
 *
 * They moved on 2026-08-27 because `pg-revisions.ts` needs them —
 * `beginStepRun` writes both — and importing them from this file made a cycle,
 * since this file imports `pg-revisions.ts`. The linter caught it
 * (`lint/suspicious/noImportCycles`) and it was right to: the runtime happened
 * to be fine, because the values are only read inside function bodies, but
 * "happens to work given the current evaluation order" is not a property worth
 * depending on.
 *
 * artifacts.ts is the right home rather than merely a convenient one: it is a
 * leaf that imports nothing from `store/`, and both constants are facts about
 * a **step run's stamp**, which is what that file defines.
 */
export { NO_INPUT_HASH, PIPELINE_RUN } from "./artifacts.js";

/**
 * How long a draft has to be untouched before the sweep may reclaim it.
 *
 * Six hours: comfortably longer than any ingest — the whole default pipeline is
 * minutes — and short enough that the copies a half-connected seam leaves
 * behind do not accumulate for a week. Each abandoned draft carries a full copy
 * of the article's `revision_blocks`, so this is storage rather than tidiness.
 * See `sweepAbandonedDrafts`.
 */
export const ABANDONED_DRAFT_MS = 6 * 60 * 60 * 1000;

/* ------------------------------------------------------------ Postgres --- */

const pgLifecycle: RevisionLifecycle = {
  async begin(slug, opts) {
    const begun = await beginRevision({ slug, ...(opts.job ? { job: opts.job } : {}) });
    return { slug, revisionId: begun.revisionId, artifacts: opts.artifacts };
  },

  async recordStep(handle, run) {
    if (!handle) return;
    /* The step's own stamp, read from the store the step wrote through, so the
       row says what it really ran against. Five steps have one; `fetch`,
       `extract` and `blocks` have none and never will. */
    const stamp = await handle.artifacts.stampFor(handle.slug, run.step);
    await recordStepRun({
      revisionId: handle.revisionId,
      stepName: run.step,
      inputHash: stamp?.inputHash ?? NO_INPUT_HASH,
      implementationVersion: stamp?.implementationVersion ?? PIPELINE_RUN,
      promptVersion: stamp?.promptVersion ?? null,
      model: stamp?.model ?? null,
      status: run.status,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
    });
  },

  async publish(handle) {
    if (!handle) return null;
    try {
      const { revisionId } = await publishRevision({
        slug: handle.slug,
        revisionId: handle.revisionId,
      });
      return revisionId;
    } catch (err) {
      /* **A refusal is an answer, not a fault, and this is the one place it is
         caught.** `PublishRefused` means the draft is not fit to be an article;
         the job's own work — the files it wrote — is unaffected, so failing the
         whole job here would report a broken ingest that was not broken.

         This is emphatically *not* the forbidden "catch a Postgres error and
         fall back to files": nothing is retried anywhere else, nothing is
         written to disk in response, and the reader is left on the revision
         they already had. Any other error propagates, including every real
         database failure. */
      if (!(err instanceof PublishRefused)) throw err;
      logger.warn(
        { slug: handle.slug, revisionId: handle.revisionId, reasons: err.reasons },
        "draft not published",
      );
      await failRevision({
        slug: handle.slug,
        revisionId: handle.revisionId,
        reason: err.reasons.join("; "),
      });
      return null;
    }
  },

  async fail(handle, reason) {
    if (!handle) return;
    await failRevision({ slug: handle.slug, revisionId: handle.revisionId, reason });
  },

  sweep: () => sweepAbandonedDrafts(ABANDONED_DRAFT_MS),
};

/* ---------------------------------------------------------- filesystem --- */

/**
 * No drafts, and therefore nothing to do — see the header.
 *
 * Every method is reachable with `null` and every one returns without touching
 * anything, so the caller is the same shape in both stores.
 */
export const NO_DRAFTS: RevisionLifecycle = {
  begin: async () => null,
  recordStep: async () => {},
  publish: async () => null,
  fail: async () => {},
  sweep: async () => 0,
};

/**
 * The lifecycle this process is running, decided once at module load.
 *
 * Read from `STORE` for the same reason `src/store/index.ts` does: a store that
 * could change under a running job is a much worse thing to debug than one that
 * needs a restart.
 *
 * **Deliberately not exported through `src/store/index.ts`.** That file is the
 * *reader's* store and it is what `src/routes.ts` imports; this is the
 * pipeline's, and switching the pipeline over is a separate decision from
 * switching reads over — the same reasoning `src/jobs.ts` gives for importing
 * its artefact store directly. Routing it through index.ts would also close an
 * import cycle: index.ts imports fs.ts, which imports src/chat.ts.
 */
/**
 * **Guarded, and `NO_DRAFTS` deliberately is not.**
 *
 * The third of the three Postgres stores that were selected outside
 * src/store/index.ts and so never met `guardDbStore` — src/store/pg-jobs.ts and
 * src/store/pg-uploads.ts are the other two, and the homepage rendered one of
 * them in red on 2026-08-27. This one had not leaked yet only because nothing
 * calls it in production; that is a fact about the wiring, not a property of the
 * code, and the day it is wired is not the day anybody will re-read this.
 *
 * `NO_DRAFTS` stays bare because it touches no database and has nothing to
 * scrub. Wrapping it would cost a layer and buy an implication that is false.
 *
 * `PublishRefused` crosses intact without being named on any allowlist: it
 * carries `status = 409`, which is this codebase's mark for a failure somebody
 * chose and worded, and db-errors.ts passes those through.
 */
export const revisionLifecycle: RevisionLifecycle =
  STORE === "postgres" ? guardDbStore("revisions", pgLifecycle) : NO_DRAFTS;
