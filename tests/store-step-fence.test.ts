/**
 * Only the attempt that started a step may finish it.
 *
 * `revision_step_runs.attempt_id` has existed since `drizzle/0017` with **no
 * writer and no reader**. `beginStepRun` is its first writer and `finishStepRun`
 * its first reader, and together they are the Postgres form of what
 * `ArtifactStore.beginStep`/`finishStep` do with a marker file — the thing the
 * filesystem adapter's own comment has been asking for since it was written.
 *
 * ## Two fences, and the obvious test only exercises one
 *
 * `finishStepRun` refuses on two conditions and they refuse different things:
 * `attempt_id` refuses somebody else's claim, `status = 'running'` refuses a
 * step that has already ended.
 *
 * The plan's first version of this test built *"a step-run that has ended and
 * still carries its token"* and finished it with a different token. That state
 * already fails the **status** half, so deleting the `attempt_id` condition
 * would have changed nothing and the test would have stayed green against the
 * bug it was aimed at. GPT Sol caught it in review;
 * docs/plans/260827aa-delete-the-importer-review-2-sol.md finding 6. It is this
 * document's own mutation habit failing, which is worth the paragraph.
 *
 * So there are two independent cases, each of which isolates one condition:
 *
 * | the row | finished with | refused by |
 * |---|---|---|
 * | `running`, token **A** | token **B** | the attempt fence alone |
 * | `done`, token **A** | token **A** | the status fence alone |
 *
 * ## How to watch them go red
 *
 * Delete `eq(revisionStepRuns.attemptId, attemptId)` from `finishStepRun` and
 * *"refuses another attempt's token"* fails, while the status case still passes.
 * Delete `eq(revisionStepRuns.status, "running")` and the reverse happens. Both
 * were watched failing that way, separately.
 *
 * ## Nothing here commits a job
 *
 * `jobs_only_one_running` used to make that a rule: one `running` row in the
 * whole table, so two suites that each wanted one were mutually exclusive, and
 * `store-job-draft` and `store-jobs-parity` failed against each other under
 * parallel vitest — seven failures, measured 2026-08-27, before this file
 * existed. That index is gone since 2026-08-30, replaced by a counted cap, so
 * the global slot no longer exists. What remains is `jobs_active_slug` — one
 * job in flight per article — and this file's fixtures are named the same on
 * every run, so a peer's `npm test` still collides with it.
 *
 * So the `beginStepRun` cases open a transaction, insert their job, exercise
 * the fence and roll the lot back. Nothing is ever committed, nothing needs
 * cleaning up, and the window a peer could collide with is milliseconds.
 *
 * Skips loudly when there is no database, for the reason tests/db-schema.test.ts
 * explains at length.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { and, eq } from "drizzle-orm";

import {
  JobDraftGone,
  NotTheLiveAttempt,
  StepRunNotHeld,
  beginRevision,
  beginStepRun,
  finishStepRun,
} from "../src/store/pg-revisions.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, jobs, revisionStepRuns } from "../src/db/schema.js";
import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { mintAttempt } from "../src/store/jobs.js";
import { NO_INPUT_HASH, PIPELINE_RUN } from "../src/store/revisions.js";
import type { JobStep } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";
import { takeRunLock } from "./helpers/run-lock.js";

loadEnvLocal();

const SLUG = "test-step-fence";

/**
 * The owner the fixture jobs hang off — Greg's `auth.users` row in the local
 * stack, which the migrations put there and no test owns.
 *
 * **Imported, not copied**, for the reason in `tests/store-artefacts-pg.test.ts`:
 * it is a foreign key to a row that has to already exist, and three files each
 * holding their own copy of the uuid is three files to miss when it changes.
 * Not a fixture id — the teardown here deletes by slug, never by owner.
 */
const DEV_OWNER_ID = ADMIN_USER_ID_LOCAL;

/* ---------------------------------------------------- is there a database -- */

const { reachable } = await pgReady({
  suite: "tests/store-step-fence.test.ts",
  tables: ["spideryarn.revision_step_runs"],
});

const when = reachable ? describe : describe.skip;

/**
 * **This file starts a job, so it takes the shared run lock.**
 *
 * This file's fixtures are named the same on every run, so a second copy — a
 * peer's `npm test` beside yours — collides with it on `jobs_active_slug` and
 * on the fixture rows themselves. Taken after `pgReady` and only
 * when reachable, because a suite that is about to skip must not sit holding it.
 * tests/helpers/run-lock.ts has the reasoning and the measurements.
 */
const runLock = reachable ? await takeRunLock("tests/store-step-fence.test.ts") : undefined;
afterAll(async () => {
  await runLock?.release();
});

/** The same alias both store modules declare, for the callback's parameter. */
type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/* ------------------------------------------------------------ the fixture -- */

const JOB_STEPS: JobStep[] = [{ name: "hierarchy", label: "Building the hierarchy", status: "pending" }];

let revisionId = "";

/** A step run in exactly the state a case needs, with no happy path in between. */
async function stepRow(
  tx: Tx,
  status: "running" | "done" | "error",
  attemptId: string | null,
): Promise<void> {
  const values = {
    revisionId,
    stepName: "hierarchy" as const,
    inputHash: NO_INPUT_HASH,
    implementationVersion: PIPELINE_RUN,
    status,
    startedAt: new Date(),
    finishedAt: status === "running" ? null : new Date(),
    attemptId,
  };
  await tx
    .insert(revisionStepRuns)
    .values(values)
    .onConflictDoUpdate({
      target: [revisionStepRuns.revisionId, revisionStepRuns.stepName],
      set: values,
    });
}

const theRow = async (tx: Tx) => {
  const rows = await tx
    .select()
    .from(revisionStepRuns)
    .where(and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, "hierarchy")));
  return rows[0];
};

const finish = (tx: Tx, job: { id: string; attemptId: string }, status: "done" | "error" = "done") =>
  finishStepRun({ revisionId, stepName: "hierarchy", job, status }, tx);

/** Nothing this file made survives it. */
async function cleanUp(): Promise<void> {
  const db = getDb();
  await db.delete(jobs).where(eq(jobs.slug, SLUG));
  const [article] = await db.select().from(articles).where(eq(articles.slug, SLUG)).limit(1);
  if (article) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, article.id));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, article.id));
    await db.delete(articles).where(eq(articles.id, article.id));
  }
  await closeDb();
}

when("who may finish a step", () => {
  beforeAll(async () => {
    const begun = await beginRevision({ slug: SLUG });
    revisionId = begun.revisionId;
  }, 60_000);

  afterAll(cleanUp);

  it("refuses another attempt's token, on a step that is still running", async () => {
    /* The attempt fence **alone**: the row is `running` and the job is live, so
       neither of the other two conditions can be what refuses this. */
    await withClaimedJob(revisionId, async (tx, job) => {
      await stepRow(tx, "running", mintAttempt());
      await expect(finish(tx, job)).rejects.toThrow(StepRunNotHeld);
      expect((await theRow(tx))?.status, "the row must be untouched").toBe("running");
    });
  });

  it("refuses a step that has already ended, even to the attempt that holds it", async () => {
    /* The status fence **alone**: the token matches and the job is live.
       Finishing twice is not idempotent — the second call would overwrite the
       first's stamp and timestamps with a later run's. */
    await withClaimedJob(revisionId, async (tx, job) => {
      await stepRow(tx, "done", job.attemptId);
      await expect(finish(tx, job)).rejects.toThrow(StepRunNotHeld);
    });
  });

  it("refuses a row that carries no token at all", async () => {
    /* The importer and every CLI run write rows with a null `attempt_id`, and
       `attempt_id = $token` is never true of NULL. So this falls out of the
       fence rather than being special-cased — which is the rule
       src/db/schema.ts states for the column: a run that cannot prove who wrote
       it cannot prove it was not somebody stale. */
    await withClaimedJob(revisionId, async (tx, job) => {
      await stepRow(tx, "running", null);
      await expect(finish(tx, job)).rejects.toThrow(StepRunNotHeld);
    });
  });

  it("refuses a claimant whose job has been swept, however good its row looks", async () => {
    /* The **job** fence, which the row conditions cannot supply. `settleExpired`
       clears a lapsed job's token and marks it errored without touching its
       step runs, so a swept worker that keeps going finds its own row still
       `running/A` — both row conditions satisfied — and would otherwise commit
       `done` for a job that has already failed.

       Found by GPT Sol reviewing the built code rather than the plan, which is
       exactly the distinction this repo draws between the two. */
    await withClaimedJob(revisionId, async (tx, job) => {
      await stepRow(tx, "running", job.attemptId);
      // What the sweep does: the token goes, the step run is left alone.
      await tx
        .update(jobs)
        .set({ status: "error", attemptId: null })
        .where(eq(jobs.id, job.id));

      await expect(finish(tx, job)).rejects.toThrow(NotTheLiveAttempt);
      expect((await theRow(tx))?.status, "the row must be untouched").toBe("running");
    });
  });

  it("refuses a live job that holds the token but owns a different draft", async () => {
    /* **`JobDraftGone`, and the name is the point.** This is the same refusal as
       the one above and a different event: there the job had moved on, here it
       is still ours and only the draft pointer went. src/jobs.ts recovers from
       them in opposite directions — walk away, or end the job — and while both
       arrived as `NotTheLiveAttempt` it could only do one, which is
       docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md. */
    await withClaimedJob(null, async (tx, job) => {
      await stepRow(tx, "running", job.attemptId);
      await expect(finish(tx, job)).rejects.toThrow(JobDraftGone);
      await expect(finish(tx, job)).rejects.not.toThrow(NotTheLiveAttempt);
    });
  });

  it("lets the holder finish, and records the ending", async () => {
    /* The control. Every refusal test above also passes against a
       `finishStepRun` that refuses everything, and this is what notices. */
    await withClaimedJob(revisionId, async (tx, job) => {
      await stepRow(tx, "running", job.attemptId);

      await finish(tx, job);

      const row = await theRow(tx);
      expect(row?.status).toBe("done");
      expect(row?.finishedAt).not.toBeNull();
      expect(row?.attemptId, "the token stays, as the record of who ran it").toBe(job.attemptId);
    });
  });

  it("records an error ending too, and only the holder may", async () => {
    await withClaimedJob(revisionId, async (tx, job) => {
      await stepRow(tx, "running", job.attemptId);
      await finish(tx, job, "error");
      expect((await theRow(tx))?.status).toBe("error");
    });
  });
});

/**
 * The `beginStepRun` cases, entirely inside transactions that roll back.
 *
 * **Because a committed `running` job is a contended thing.** It was worse when
 * this was written: `jobs_only_one_running` allowed one `running` row in the
 * whole table, so `tests/store-job-draft.test.ts` and
 * `tests/store-jobs-parity.test.ts` failed against each other when vitest ran
 * them in parallel — measured, 2026-08-27, seven failures before this file
 * existed. That index went on 2026-08-30 and the cap is now a count, so the
 * global slot is gone; `jobs_active_slug` still allows one job in flight per
 * article, and this file's slug is fixed.
 *
 * So this file declines to contend at all. Each case opens a transaction,
 * inserts its running job, exercises the fence and throws to roll the lot back,
 * so nothing is ever committed and there is nothing to clean up. The window is a
 * few milliseconds instead of the length of a test.
 *
 * It also happens to be the more honest shape: `beginStepRun` takes a `Tx`
 * because it is meant to run inside the coordinator's transaction, and this
 * exercises it exactly there.
 */

/** Thrown to roll a transaction back once its assertions have run. */
class RollBack extends Error {}

/**
 * Run `body` against a live claimed job, then undo all of it.
 *
 * The rollback means this suite never leaves a `running` row behind: it exists
 * for milliseconds rather than for the length of a test.
 *
 * **There was a retry loop here too, and it went on 2026-08-30** along with
 * `jobs_only_one_running`. It waited out a 23505 from that index while somebody
 * else held the one global running slot. There is no such slot now — the cap is
 * a count taken by `claim` — and this insert is direct SQL, which no counted cap
 * applies to anyway. The contention it waited for cannot happen, so a loop that
 * still waited for it would be dead code reading as a live guard.
 *
 * What it never did was sweep whatever is running. A test that can destroy the
 * data it is run against is worse than no test, and
 * `tests/store-job-draft.test.ts` was caught doing precisely that.
 */
async function withClaimedJob(
  draft: string | null,
  body: (tx: Tx, job: { id: string; attemptId: string }) => Promise<void>,
): Promise<void> {
  const id = mintId();
  const attemptId = mintAttempt();
  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(jobs).values({
        id,
        ownerId: DEV_OWNER_ID,
        slug: SLUG,
        steps: JOB_STEPS,
        status: "running",
        attemptId,
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `wk-${id}`,
        ...(draft ? { draftRevisionId: draft } : {}),
      });
      await body(tx, { id, attemptId });
      throw new RollBack();
    });
  } catch (err) {
    if (!(err instanceof RollBack)) throw err;
  }
}

when("who may begin a step", () => {
  beforeAll(async () => {
    const begun = await beginRevision({ slug: SLUG });
    revisionId = begun.revisionId;
  }, 60_000);

  afterAll(async () => {
    const db = getDb();
    await db.delete(jobs).where(eq(jobs.slug, SLUG));
    const [article] = await db.select().from(articles).where(eq(articles.slug, SLUG)).limit(1);
    if (article) {
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, article.id));
      await db.delete(articleRevisions).where(eq(articleRevisions.articleId, article.id));
      await db.delete(articles).where(eq(articles.id, article.id));
    }
    await closeDb();
  });

  it("installs the job's token, and starts unstamped", async () => {
    await withClaimedJob(revisionId, async (tx, job) => {
      await beginStepRun({ revisionId, stepName: "hierarchy", job }, tx);

      const [row] = await tx
        .select()
        .from(revisionStepRuns)
        .where(
          and(eq(revisionStepRuns.revisionId, revisionId), eq(revisionStepRuns.stepName, "hierarchy")),
        );
      expect(row?.status).toBe("running");
      expect(row?.attemptId).toBe(job.attemptId);
      /* Not a plausible-looking hash: a step that has not run has not been made
         from anything, and inventing one here would make a step that died
         mid-run look like one that completed against those blocks. */
      expect(row?.inputHash).toBe(NO_INPUT_HASH);
      expect(row?.finishedAt).toBeNull();
    });
  });

  it("refuses a stale token", async () => {
    await withClaimedJob(revisionId, async (tx, job) => {
      await expect(
        beginStepRun({ revisionId, stepName: "hierarchy", job: { id: job.id, attemptId: mintAttempt() } }, tx),
      ).rejects.toThrow(NotTheLiveAttempt);
    });
  });

  it("will not let one token reopen a run it has already ended", async () => {
    /* Two callers holding the same live capability — a retry that raced, a
       duplicated request — must not turn `done/A` back into `running/A`, clear
       `finishedAt`, and replace the recorded hash with `unstamped`. The step
       would then look like one still in flight, and whatever it had already
       produced would be reported unfinished.

       A *different* attempt reopening the row is legitimate: that is what a
       re-run is. Only the same token is refused, which is why the assertion
       below is about the row surviving rather than about a throw — the upsert
       simply declines to write. GPT Sol, finding 4. */
    await withClaimedJob(revisionId, async (tx, job) => {
      await beginStepRun({ revisionId, stepName: "hierarchy", job }, tx);
      await finish(tx, job);
      expect((await theRow(tx))?.status).toBe("done");

      await beginStepRun({ revisionId, stepName: "hierarchy", job }, tx);

      const row = await theRow(tx);
      expect(row?.status, "the ended run must stay ended").toBe("done");
      expect(row?.finishedAt, "and must keep its ending").not.toBeNull();
    });
  });

  it("refuses a job that is no longer running", async () => {
    await withClaimedJob(revisionId, async (tx, job) => {
      await tx.update(jobs).set({ status: "error" }).where(eq(jobs.id, job.id));
      await expect(beginStepRun({ revisionId, stepName: "hierarchy", job }, tx)).rejects.toThrow(
        NotTheLiveAttempt,
      );
    });
  });

  it("refuses a live job that owns a different draft", async () => {
    /* The condition easiest to leave out, and the one with no other guard
       behind it: a token can be perfectly current and still belong to a job
       pointed somewhere else, and a step run written into somebody else's draft
       is a fault nothing downstream could untangle.

       **Its own error since 2026-09-02.** See the matching case above `finish`. */
    await withClaimedJob(null, async (tx, job) => {
      await expect(beginStepRun({ revisionId, stepName: "hierarchy", job }, tx)).rejects.toThrow(
        JobDraftGone,
      );
    });
  });
});
