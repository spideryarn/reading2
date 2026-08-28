/**
 * Put one filesystem article into Postgres the way the pipeline would.
 *
 * ## Why this is not `importArticle`
 *
 * `db:import` is being deleted (docs/plans/delete-the-importer.md § C7), and
 * three suites used it purely as a fixture loader. The replacement is not a
 * smaller importer — that would be a second files → Postgres implementation,
 * exercised only by tests and therefore free to drift from the path production
 * actually runs. It is the *real* write path, driven over a fixture:
 *
 * 1. a running `jobs` row, because every artefact write is fenced on one;
 * 2. `openOrBeginJobDraft`, the same call `advanceJob` makes;
 * 3. `copyArtefacts` from the filesystem store to `pgArtifactsIn`, which is
 *    `beginStep` → `write` → `finishStep` per step, in pipeline order;
 * 4. `publishRevision`, with its guards run rather than routed around;
 * 5. the job released, so the next call can have the single running slot.
 *
 * Every byte therefore crosses the same seam a real ingest crosses. What that
 * buys is stated plainly in tests/helpers/artefacts.ts; what it *costs* is that
 * this loader carries strictly less than the importer did, and the difference
 * is not an oversight — see § What this does not carry.
 *
 * ## What this does not carry
 *
 * `ArtifactStore` owns artefacts and nothing else, so **no reader state** comes
 * across: comments, chat, searches, glossary lookups, the shelf. A suite that
 * needs any of it must write it through the live reader stores, which is also
 * how production gets it.
 *
 * **`created_at` is today unless you say otherwise.** A draft minted by this
 * function was minted *now*, and the filesystem's idea of when the article
 * arrived is the blocks file's mtime. Where a suite compares the two stores'
 * library entries, that difference is the whole assertion, so `createdAt` is an
 * explicit option rather than something quietly inferred — a fixture that
 * guessed would make "today" pass for history and the parity claim would be
 * about nothing.
 */
import { and, eq } from "drizzle-orm";

import { getDb } from "../../src/db/client.js";
import { articleRevisions, jobs } from "../../src/db/schema.js";
import { mintId } from "../../src/ids.js";
import { currentOwnerId } from "../../src/owner.js";
import { createFsArtifactStore } from "../../src/store/artifacts-fs.js";
import { pgArtifactsIn } from "../../src/store/artifacts-pg.js";
import { mintAttempt } from "../../src/store/jobs.js";
import { openOrBeginJobDraft, publishRevision } from "../../src/store/pg-revisions.js";
import type { JobStep } from "../../src/types.js";
import type { StepName } from "../../src/types.js";
import { copyArtefacts } from "./artefacts.js";

/** What the load produced, so a caller can assert on it rather than assume. */
export interface LoadedArticle {
  readonly articleId: string;
  readonly revisionId: string;
  /**
   * The steps that actually had something to copy — **the thing to assert on**.
   * A silent no-op over an article the filesystem has never heard of returns an
   * empty array, and a fixture that loaded nothing is the failure this repo
   * keeps meeting (docs/reusable/silent-success.md).
   */
  readonly copied: readonly StepName[];
  /** False when `publish` was off, or when the gate refused and `publish` was `"try"`. */
  readonly published: boolean;
  /** The gate's reasons, when it refused. Empty otherwise. */
  readonly refusedBecause: readonly string[];
}

export interface LoadOptions {
  /**
   * What `article_revisions.created_at` should say. Left alone when absent,
   * which means "now" — see the note above about history.
   */
  readonly createdAt?: Date;
  /**
   * `true` (the default) publishes and throws if the gate refuses.
   * `"try"` publishes but reports a refusal on the result instead of throwing,
   * for a suite whose subject *is* the gate.
   * `false` leaves the revision a draft.
   */
  readonly publish?: boolean | "try";
  /**
   * Whose article it is. Defaults to `currentOwnerId()`, which outside a
   * request is the environment's owner — the same answer `importArticle` used,
   * so a suite that does not care about ownership does not have to say.
   */
  readonly ownerId?: string;
}

/** A job's step list has to be non-empty and well-formed; nothing reads these. */
const FIXTURE_STEPS: JobStep[] = [
  { name: "toc", label: "Building the table of contents", status: "pending" },
];

/**
 * Take the single running slot, run `body`, and give the slot back.
 *
 * **The retry is not defensive padding.** `jobs_only_one_running` is a partial
 * unique index over the *whole table*, so a dev server mid-ingest, or another
 * suite's fixture, will refuse this insert — and the refusal arrives as a
 * constraint name rather than as anything a test could recognise. Retrying on
 * that one name and rethrowing everything else keeps a genuine bug loud.
 *
 * The release is in `finally` because a job left running would wedge every
 * later call in the same run, turning one real failure into a file full of
 * timeouts that say nothing about what broke.
 */
async function withRunningJob<T>(
  slug: string,
  ownerId: string,
  body: (job: { id: string; attemptId: string }) => Promise<T>,
): Promise<T> {
  const db = getDb();
  for (let attempt = 1; ; attempt++) {
    const job = { id: mintId(), attemptId: mintAttempt() };
    try {
      await db.insert(jobs).values({
        id: job.id,
        ownerId,
        slug,
        steps: FIXTURE_STEPS,
        status: "running",
        attemptId: job.attemptId,
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `fixture-${job.id}`,
      });
    } catch (err) {
      const constraint = (err as { cause?: { constraint?: string } }).cause?.constraint;
      /* `jobs_active_slug` too, not only the global slot: a previous load of the
         same slug that died before its `finally` leaves a running row for this
         article, and that refuses on a different name for the same reason. */
      if (constraint !== "jobs_only_one_running" && constraint !== "jobs_active_slug") throw err;
      if (attempt >= 40) {
        throw new Error(
          `could not get the running-job slot for "${slug}" in 20s — another job is holding it. ` +
            "Re-run when the queue is idle, or check for a wedged `running` row in `jobs`.",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    try {
      return await body(job);
    } finally {
      /* Done and owning no draft. The pointer is cleared as well as the status
         because `jobs_draft_revision_unique` is not partial on status: a
         finished job still holding a draft id is a row that can refuse a later,
         legitimate claim on the same revision. */
      await db
        .update(jobs)
        .set({ status: "done", attemptId: null, leaseExpiresAt: null, draftRevisionId: null, finishedAt: new Date() })
        .where(and(eq(jobs.id, job.id)));
    }
  }
}

/**
 * Load `slug` from `data/` into Postgres, published by default.
 *
 * Idempotent in the way the pipeline is idempotent: each call mints a fresh
 * draft from whatever is published, copies over it and publishes again. It does
 * not compare against what is already there, and it is not trying to.
 */
export async function loadArticleIntoPg(
  slug: string,
  opts: LoadOptions = {},
): Promise<LoadedArticle> {
  const { publish = true, ownerId = currentOwnerId() } = opts;
  const fs = createFsArtifactStore();
  const db = getDb();

  return withRunningJob(slug, ownerId, async (job) => {
    const draft = await openOrBeginJobDraft({ slug, job });
    const ref = {
      slug,
      articleId: draft.articleId,
      revisionId: draft.revisionId,
      jobId: job.id,
      attemptId: job.attemptId,
    };

    /* One transaction around the whole copy, which is what the coordinator will
       do for one step. Not one per step: a fixture that committed step by step
       could leave an article half-loaded behind a failure, and the next suite
       to read it would fail somewhere else entirely. */
    const copied = await db.transaction((tx) => copyArtefacts(fs, pgArtifactsIn(ref, tx), slug));

    if (opts.createdAt) {
      await db
        .update(articleRevisions)
        .set({ createdAt: opts.createdAt })
        .where(eq(articleRevisions.id, draft.revisionId));
    }

    if (publish === false) return { ...ref, copied, published: false, refusedBecause: [] };

    try {
      await publishRevision({ slug, revisionId: draft.revisionId, job });
      return { ...ref, copied, published: true, refusedBecause: [] };
    } catch (err) {
      if (publish !== "try") throw err;
      return {
        ...ref,
        copied,
        published: false,
        refusedBecause: [(err as Error).message],
      };
    }
  });
}
