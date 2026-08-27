/**
 * The Postgres job store: the record both invocations can see, and the fence
 * that stops the wrong one writing.
 *
 * Most of what is worth testing here is **the refusals**, because every one of
 * them is a thing that reads as success if it is got wrong:
 *
 *  - a stale claimant's write affecting zero rows and being reported as done;
 *  - a claim on a job somebody else is running silently starting a second one;
 *  - a claim held across requests, which turns the happy path into `busy`.
 *
 * Two of the tests below were watched red against a deliberately weakened
 * implementation before they were believed, and each says which weakening.
 * A test that has never failed proves nothing — docs/reusable/silent-success.md.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { mintId } from "../src/ids.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { StaleAttemptError } from "../src/store/jobs.js";
import type { Job, JobStep, OwnerId } from "../src/types.js";
import { eq, inArray } from "drizzle-orm";

loadEnvLocal();

/** Probed at MODULE LOAD so the skip is a real vitest skip rather than a green tick. */
let reachable = false;
if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const probe = await pool.query("select to_regclass('spideryarn.jobs') is not null as ready");
    reachable = probe.rows[0]?.ready === true;
  } catch {
    reachable = false;
  }
  await pool.end();
}

/**
 * The dev owner, **imported rather than written out**, because
 * `jobs_owner_fk` means it has to be a real `auth.users` row and there is
 * exactly one of those. A literal here would be a second copy of a value the
 * app already owns — and `tests/fixture-ids.test.ts` would rightly flag it as
 * shared with every other file that needed the same row.
 *
 * The stranger is this file's own, and never inserted: it exists only to prove
 * that somebody else's job reads as one that is not there.
 */
const OWNER = DEV_OWNER_ID;
const STRANGER = "00000000-0000-4000-8000-000000000b51" as OwnerId;

/**
 * Slugs are prefixed so this file's rows can be found and removed without
 * touching anybody else's. `jobs_only_one_running` and `jobs_active_slug` are
 * global and partial, so a row left behind by a failed test would make every
 * later run fail for a different and much more confusing reason.
 */
const MINE = "test-store-jobs-";
const made: string[] = [];

afterEach(async () => {
  if (!reachable || made.length === 0) return;
  await getDb()
    .delete(jobs)
    .where(inArray(jobs.id, made.splice(0)));
});

function aJob(over: Partial<Job> = {}): Job {
  const id = mintId();
  made.push(id);
  return {
    id,
    ownerId: OWNER,
    slug: `${MINE}${id}`,
    steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }] as JobStep[],
    status: "queued",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const LEASE = 60_000;

describe.skipIf(!reachable)("the Postgres job store", () => {
  it("hands back what it was given, with nothing turned into null", async () => {
    const job = aJob({ url: "https://example.test/a", guidance: "shorter", profile: "a linguist" });
    const { job: saved, created } = await pgJobStore.enqueueOrGet(job, "k1");
    expect(created).toBe(true);
    expect(saved).toEqual(job);
    // `Job`'s optional fields mean "we do not have this" and are read with `?.`
    // and `!== undefined` all over. A null from the database is a different
    // value in some of those places and goes onto the wire in others.
    expect("title" in saved).toBe(false);
    expect("upload" in saved).toBe(false);
    expect("cancelling" in saved).toBe(false);
  });

  it("hands back the job already doing this work rather than paying twice", async () => {
    const first = aJob();
    await pgJobStore.enqueueOrGet(first, "k1");

    /* Two instances each scanning their own memory each find nothing and each
       start paying for the same article. `jobs_active_slug` is what stops that
       once the memory is not shared. */
    const again = { ...aJob(), slug: first.slug };
    const { job, created, sameWork } = await pgJobStore.enqueueOrGet(again, "k1");
    expect(created).toBe(false);
    expect(sameWork).toBe(true);
    expect(job.id).toBe(first.id);
  });

  it("says when the slug is held by different work, so the caller can move along", async () => {
    const first = aJob();
    await pgJobStore.enqueueOrGet(first, "k1");
    const other = { ...aJob(), slug: first.slug };
    const { created, sameWork } = await pgJobStore.enqueueOrGet(other, "k2");
    expect(created).toBe(false);
    expect(sameWork).toBe(false);
  });

  it("reads somebody else's job as one that is not there", async () => {
    const job = aJob();
    await pgJobStore.enqueueOrGet(job, "k1");
    expect(await pgJobStore.get(job.id, OWNER)).toBeDefined();
    expect(await pgJobStore.get(job.id, STRANGER)).toBeUndefined();
    expect((await pgJobStore.claim(job.id, STRANGER, crypto.randomUUID(), LEASE)).kind).toBe("gone");
  });

  it("lets one claimant in and turns the second away", async () => {
    const job = aJob();
    await pgJobStore.enqueueOrGet(job, "k1");

    const first = await pgJobStore.claim(job.id, OWNER, crypto.randomUUID(), LEASE);
    expect(first.kind).toBe("claimed");
    const second = await pgJobStore.claim(job.id, OWNER, crypto.randomUUID(), LEASE);
    expect(second.kind).toBe("busy");
  });

  it("turns a claim away while another job holds the one running slot", async () => {
    const a = aJob();
    const b = aJob();
    await pgJobStore.enqueueOrGet(a, "k1");
    await pgJobStore.enqueueOrGet(b, "k2");

    expect((await pgJobStore.claim(a.id, OWNER, crypto.randomUUID(), LEASE)).kind).toBe("claimed");
    /* `jobs_only_one_running` raises 23505 rather than matching no rows, so
       this fails as a 500 unless the adapter catches that code by name. The
       index is doing its job; an index doing its job is not an exception. */
    const blocked = await pgJobStore.claim(b.id, OWNER, crypto.randomUUID(), LEASE);
    expect(blocked.kind).toBe("busy");
    expect(blocked.kind === "busy" && blocked.why).toMatch(/another job is running/);
  });

  it("will not claim a job the reader has stopped, or one already over", async () => {
    const stopping = aJob();
    await pgJobStore.enqueueOrGet(stopping, "k1");
    await pgJobStore.requestCancel(stopping.id, OWNER);
    // Otherwise the API key is spent on a job that has already been stopped —
    // one of the three cancellation windows step 12 named.
    expect((await pgJobStore.claim(stopping.id, OWNER, crypto.randomUUID(), LEASE)).kind).toBe(
      "stopping",
    );

    const over = aJob();
    await pgJobStore.enqueueOrGet(over, "k2");
    const attempt = crypto.randomUUID();
    expect((await pgJobStore.claim(over.id, OWNER, attempt, LEASE)).kind).toBe("claimed");
    await pgJobStore.finish(over.id, attempt, { status: "done", steps: over.steps });
    expect((await pgJobStore.claim(over.id, OWNER, crypto.randomUUID(), LEASE)).kind).toBe(
      "finished",
    );
  });

  /**
   * **The one that stops the endpoint deadlocking itself.**
   *
   * One claim covers one step. If it were held across requests, the next
   * advance — a different request with a different token — would be told `busy`
   * until the lease expired, and the happy path would break on step two with
   * every symptom pointing at the client.
   */
  it("lets the claim go after a step, so the next request can have it", async () => {
    const job = aJob();
    await pgJobStore.enqueueOrGet(job, "k1");
    const attempt = crypto.randomUUID();
    const held = await pgJobStore.claim(job.id, OWNER, attempt, LEASE);
    expect(held.kind).toBe("claimed");

    const done: JobStep[] = [{ ...job.steps[0]!, status: "done" }];
    const after = await pgJobStore.releaseStep(job.id, attempt, done, { title: "A Paper" });
    expect(after.status).toBe("queued");
    expect(after.title).toBe("A Paper");
    expect(after.steps[0]?.status).toBe("done");

    // A different request, a different token, and it gets in.
    expect((await pgJobStore.claim(job.id, OWNER, crypto.randomUUID(), LEASE)).kind).toBe("claimed");
  });

  /**
   * **The fence's third condition, tested on the state that needs it.**
   *
   * The first version of this test failed a job with `failExpired` and asserted
   * the old token was refused — and it **passed with `status = 'running'`
   * removed from the fence**, because `failExpired` clears `attempt_id` too, so
   * the second condition was doing all the work. A test that cannot fail proves
   * nothing, and this one nearly shipped with a comment saying it had been
   * watched red.
   *
   * So the dangerous state is built directly: a terminal row that still carries
   * its token. **The schema permits exactly that** —
   * `jobs_running_is_fenced` constrains `running` rows only — so it is one
   * forgotten `attemptId: null` away in any transition somebody adds later.
   * That is what the third condition is for, and what this now watches.
   *
   * Watched red with `eq(jobs.status, "running")` removed from `fence()`:
   * `releaseStep` then returns a job instead of throwing.
   */
  it("refuses a write onto a finished job that still carries its token", async () => {
    const job = aJob();
    await pgJobStore.enqueueOrGet(job, "k1");
    const attempt = crypto.randomUUID();
    const held = await pgJobStore.claim(job.id, OWNER, attempt, LEASE);
    expect(held.kind).toBe("claimed");

    // Its lease runs out and the sweep fails it. The claimant does not know.
    await expire(job.id);
    expect(await pgJobStore.failExpired()).toBeGreaterThanOrEqual(1);
    expect((await pgJobStore.get(job.id, OWNER))?.status).toBe("error");

    /* Put the token back on the terminal row — the state the third condition
       exists for, and the one no current transition produces. Without this the
       test passes for the wrong reason, because `failExpired` clears the token
       and `attempt_id = $attempt` alone would already refuse. */
    await getDb().update(jobs).set({ attemptId: attempt }).where(eq(jobs.id, job.id));

    await expect(pgJobStore.releaseStep(job.id, attempt, job.steps, {})).rejects.toBeInstanceOf(
      StaleAttemptError,
    );
    await expect(
      pgJobStore.finish(job.id, attempt, { status: "done", steps: job.steps }),
    ).rejects.toBeInstanceOf(StaleAttemptError);
    // And the sweep's own account of it survived the refused writes.
    expect((await pgJobStore.get(job.id, OWNER))?.error).toMatch(/did not come back/);
  });

  it("refuses a write from a claimant whose job somebody else now holds", async () => {
    const job = aJob();
    await pgJobStore.enqueueOrGet(job, "k1");
    const mine = crypto.randomUUID();
    await pgJobStore.claim(job.id, OWNER, mine, LEASE);
    await pgJobStore.releaseStep(job.id, mine, job.steps, {});
    const theirs = crypto.randomUUID();
    await pgJobStore.claim(job.id, OWNER, theirs, LEASE);

    // The first claimant comes back late. It cannot write, and it learns that
    // rather than affecting zero rows and being told nothing.
    await expect(pgJobStore.releaseStep(job.id, mine, job.steps, {})).rejects.toBeInstanceOf(
      StaleAttemptError,
    );
  });

  it("fails a job whose lease ran out, and leaves a live one alone", async () => {
    const dead = aJob();
    await pgJobStore.enqueueOrGet(dead, "k1");
    await pgJobStore.claim(dead.id, OWNER, crypto.randomUUID(), LEASE);
    await expire(dead.id);
    expect(await pgJobStore.failExpired()).toBe(1);
    const failed = await pgJobStore.get(dead.id, OWNER);
    expect(failed?.status).toBe("error");
    /* `retry`, said rather than left to the absent-means-yes rule — both offer
       the button, and only one of them says why. An interrupted job really is
       worth another go, because `stepIsDone` derives what is finished from the
       artefacts, so a retry resumes rather than starting again. */
    expect(failed?.failureKind).toBe("retry");

    // The running slot is free again, which is the other half of why this runs.
    const alive = aJob();
    await pgJobStore.enqueueOrGet(alive, "k2");
    await pgJobStore.claim(alive.id, OWNER, crypto.randomUUID(), LEASE);
    expect(await pgJobStore.failExpired()).toBe(0);
    expect((await pgJobStore.get(alive.id, OWNER))?.status).toBe("running");
  });

  it("cancels a queued job outright, and only asks a running one", async () => {
    const queued = aJob();
    await pgJobStore.enqueueOrGet(queued, "k1");
    /* Nobody is inside a queued job, so there is no `cancelling` flag for
       anyone to notice — p-queue's own callback used to clear it and Postgres
       provides no such callback. It has to be terminal here or never. */
    expect((await pgJobStore.cancelIdle(queued.id, OWNER))?.status).toBe("cancelled");

    const running = aJob();
    await pgJobStore.enqueueOrGet(running, "k2");
    await pgJobStore.claim(running.id, OWNER, crypto.randomUUID(), LEASE);
    expect(await pgJobStore.cancelIdle(running.id, OWNER)).toBeUndefined();
    expect((await pgJobStore.requestCancel(running.id, OWNER))?.cancelling).toBe(true);
  });

  it("refuses to forget a job that is still going", async () => {
    const job = aJob();
    await pgJobStore.enqueueOrGet(job, "k1");
    expect(await pgJobStore.forget(job.id, OWNER)).toBe(false);
    const attempt = crypto.randomUUID();
    expect((await pgJobStore.claim(job.id, OWNER, attempt, LEASE)).kind).toBe("claimed");
    await pgJobStore.finish(job.id, attempt, { status: "done", steps: job.steps });
    expect(await pgJobStore.forget(job.id, OWNER)).toBe(true);
    expect(await pgJobStore.get(job.id, OWNER)).toBeUndefined();
  });
});

/**
 * Push a job's lease into the past.
 *
 * Written straight to the column rather than by claiming with a tiny lease,
 * because a lease short enough to expire during a test is short enough to
 * expire between two of the assertions that follow.
 */
async function expire(id: string): Promise<void> {
  await getDb()
    .update(jobs)
    .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(jobs.id, id));
}

process.on("beforeExit", () => {
  void closeDb();
});
