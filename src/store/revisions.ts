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
 * ## Superseded, not wired. Checked 2026-09-01.
 *
 * **This section used to say "nothing is wired" and describe, in the future
 * tense, what would happen the day something called `begin()`.** That day
 * came, but not through this file. `src/jobs.ts`'s `claimSession` now opens a
 * `StoreSession` straight over [`pg-session.ts`](pg-session.ts), which calls
 * `openOrBeginJobDraft`, `finishStepRun`, `publishRevisionIn` and
 * `failRevisionIn` in [`pg-revisions.ts`](pg-revisions.ts) itself, inside the
 * job's own transaction — not through the `RevisionLifecycle` interface below.
 * `docs/plans/260831b-finish-the-database-move.md` § Stage 3 is that design;
 * [`docs/project/database.md`](../../docs/project/database.md) describes what a
 * finished job does now.
 *
 * So `revisionLifecycle`, `pgLifecycle` and `NO_DRAFTS` are not dead — every
 * method still runs — but none of them is on the path a real ingest takes.
 * `git grep` finds `revisionLifecycle` from exactly one place outside this
 * file, `tests/store-guarded.test.ts`. **Do not write "wired" here again until
 * that changes.**
 *
 * The dormant `publish()` below wraps `publishRevision`, which opens its own
 * transaction around `publishRevisionIn` — the same function `pg-session.ts`
 * calls inside the job's transaction instead. A guard added to
 * `publishRevisionIn` therefore covers both callers alike; this file does not
 * need to change when one lands.
 *
 * `sweepAbandonedDrafts` is exported below and still has no caller but tests.
 * That remains a real gap — a draft an abandoned or failed job leaves behind
 * still needs reclaiming — just not one this seam will close, since the caller
 * that matters (`pg-session.ts`) does not go through it either.
 * `ABANDONED_DRAFT_MS` below explains why each abandoned draft is worth
 * reclaiming rather than ignoring: it carries a full copy of the article's
 * `revision_blocks`.
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
