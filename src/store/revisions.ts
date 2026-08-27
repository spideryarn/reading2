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
 * the file list. docs/plans/postgres-storage-implementation.md § Step 11 half A.
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
 * ## What is wired, and what is still only half-connected
 *
 * Wired: a job opens a draft, records each step it runs against it, and
 * publishes or fails it. Real rows, real carry-forward, real publication guard.
 *
 * **Not wired: the artefacts.** The pipeline stages still write
 * `data/<slug>/blocks.json` and the rest with their own `writeFile` calls
 * (step 11 half B stage 5 is what moves them), so nothing fills the draft the
 * job just opened. The consequence is deliberate and visible rather than
 * papered over:
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
 * So under `SPIDERYARN_STORE=postgres` an ingest today ends with one `warn`
 * line and a failed draft, and the reader stays on the revision they had. That
 * is the honest state of a half-finished seam, and it is preferable to the
 * alternative, which is a republished copy of the old revision under a green
 * tick. When stage 5 lands and the artefacts arrive as values, publication
 * starts succeeding here with no change to this file.
 *
 * ## What this file may log
 *
 * Slugs, ids, step names, counts, statuses. Never article prose, never a title.
 */

import { log } from "../log.js";
import type { StepName } from "../types.js";
import type { ArtifactStore } from "./artifacts.js";
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
 * What `revision_step_runs.implementation_version` says for a row this seam
 * wrote, and it is load-bearing that it is **not** `"imported"`.
 *
 * The importer withdraws inferred rows by deleting everything stamped
 * `imported` whose artefact has gone (src/store/import.ts), scoped that way
 * precisely so that *a migration tool cannot delete a pipeline record*. A row
 * from here carrying that marker would be inside the blast radius of every
 * `npm run db:import`.
 *
 * There is no real implementation version to write yet — no step declares one
 * (see `StepStamp.implementationVersion` in artifacts.ts) — so this says where
 * the row came from and nothing it cannot back up.
 */
export const PIPELINE_RUN = "pipeline";

/**
 * The `input_hash` for a step that records nothing about its input.
 *
 * `fetch`, `extract` and `blocks` write no `sourceHash` anywhere, so their
 * stamp is `null` in every store (artifacts.ts § `STAMP_SOURCE`) — and the
 * column is `not null`. A sentinel that can never equal a hash is the honest
 * filler: **it must not be the draft's block hash**, which would claim the step
 * ran against blocks it has never seen, and would make the metadata page report
 * a stale stage as current.
 */
export const NO_INPUT_HASH = "unstamped";

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
