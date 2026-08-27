/**
 * The two job stores, asked the same questions — the record both invocations
 * can see, and the fence that stops the wrong one writing.
 *
 * Most of what is worth testing here is **the refusals**, because every one of
 * them is a thing that reads as success if it is got wrong:
 *
 *  - a stale claimant's write affecting zero rows and being reported as done;
 *  - a claim on a job somebody else is running silently starting a second one;
 *  - a claim held across requests, which turns the happy path into `busy`.
 *
 * Two of these were watched red against a deliberately weakened implementation
 * before they were believed, and each says which weakening. A test that has
 * never failed proves nothing — docs/reusable/silent-success.md.
 *
 * **The filesystem adapter is honest about being one process** and this file
 * does not pretend otherwise: its single-running rule and its attempt tokens
 * are variables in memory, so what it promises holds within one process and not
 * across two. That is what the Postgres adapter is for, and running both
 * through the same cases is how "the same rules, differently enforced" stays a
 * claim somebody checked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { eq, inArray } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { DEV_OWNER_ID } from "../src/owner.js";
import { mintAttempt } from "../src/store/jobs.js";
import type { JobStore } from "../src/store/jobs.js";
import { StaleAttemptError } from "../src/store/jobs.js";
import {
  expireLeaseForTests,
  fsJobStore,
  reattachAttemptForTests,
  forgetForTests,
} from "../src/store/jobs-fs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Job, JobStep, OwnerId } from "../src/types.js";

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
 * The dev owner, **imported rather than written out**, because `jobs_owner_fk`
 * means it has to be a real `auth.users` row and there is exactly one of those.
 * A literal here would be a second copy of a value the app already owns — and
 * `tests/fixture-ids.test.ts` would rightly flag it as shared.
 *
 * The stranger is this file's own and never inserted: it exists only to prove
 * that somebody else's job reads as one that is not there.
 */
const OWNER = DEV_OWNER_ID;
const STRANGER = "00000000-0000-4000-8000-0000000000b5" as OwnerId;

const LEASE = 60_000;
/** Prefixed so this file's rows can be found and removed without touching anybody else's. */
const MINE = "test-store-jobs-";

/**
 * **Each store, plus the two states its own API cannot reach.**
 *
 * A lease that has passed, and a job that has ended while still carrying its
 * token. Both are real — the second is one forgotten `attemptId: null` away in
 * any transition somebody adds later — and neither can be produced through the
 * contract, which is rather the point of a fence. Without an equivalent on both
 * sides the two adapters would be tested to different depths and "parity" would
 * be doing no work.
 */
interface Adapter {
  name: string;
  store: JobStore;
  available: boolean;
  expire(id: string): Promise<void>;
  reattach(id: string, attempt: string): Promise<void>;
  forgetAll(ids: string[]): Promise<void>;
}

const ADAPTERS: Adapter[] = [
  {
    name: "the filesystem store",
    store: fsJobStore,
    available: true,
    async expire(id) {
      expireLeaseForTests(id);
    },
    async reattach(id, attempt) {
      reattachAttemptForTests(id, attempt);
    },
    /* By id. `resetForTests` alone cleared the maps and left every record in
       `data/_jobs/` — which is where a job actually lives — so each run of this
       file leaked its ~20 `queued` records, and retention never touches those. */
    async forgetAll(ids) {
      await forgetForTests(ids);
    },
  },
  {
    name: "Postgres",
    store: pgJobStore,
    available: reachable,
    /* Written straight to the column rather than by claiming with a tiny lease,
       because a lease short enough to expire during a test is short enough to
       expire between two of the assertions that follow. */
    async expire(id) {
      await getDb()
        .update(jobs)
        .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(jobs.id, id));
    },
    async reattach(id, attempt) {
      await getDb().update(jobs).set({ attemptId: attempt }).where(eq(jobs.id, id));
    },
    async forgetAll(ids) {
      await getDb().delete(jobs).where(inArray(jobs.id, ids));
    },
  },
];

for (const adapter of ADAPTERS) {
  const store = adapter.store;

  describe.skipIf(!adapter.available)(adapter.name, () => {
    const made: string[] = [];
    afterEach(async () => {
      const ids = made.splice(0);
      if (ids.length > 0) await adapter.forgetAll(ids);
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

    it("hands back what it was given, with nothing turned into null", async () => {
      const job = aJob({
        url: "https://example.test/a",
        guidance: "shorter",
        profile: "a linguist",
      });
      const { job: saved, created } = await store.enqueueOrGet(job, "k1");
      expect(created).toBe(true);
      expect(saved).toEqual(job);
      /* `Job`'s optional fields mean "we do not have this" and are read with
         `?.` and `!== undefined` all over. A null from the database is a
         different value in some of those places and goes onto the wire in
         others, where the client's own type says it cannot be. */
      expect("title" in saved).toBe(false);
      expect("upload" in saved).toBe(false);
      expect("cancelling" in saved).toBe(false);
    });

    it("hands back the job already doing this work rather than paying twice", async () => {
      const first = aJob();
      await store.enqueueOrGet(first, "k1");

      /* Two instances each scanning their own memory each find nothing and each
         start paying for the same article. */
      const again = { ...aJob(), slug: first.slug };
      const { job, created, sameWork } = await store.enqueueOrGet(again, "k1");
      expect(created).toBe(false);
      expect(sameWork).toBe(true);
      expect(job.id).toBe(first.id);
    });

    it("says when the slug is held by different work, so the caller can move along", async () => {
      const first = aJob();
      await store.enqueueOrGet(first, "k1");
      const other = { ...aJob(), slug: first.slug };
      const { created, sameWork } = await store.enqueueOrGet(other, "k2");
      expect(created).toBe(false);
      expect(sameWork).toBe(false);
    });

    it("reads somebody else's job as one that is not there", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      expect(await store.get(job.id, OWNER)).toBeDefined();
      expect(await store.get(job.id, STRANGER)).toBeUndefined();
      expect((await store.claim(job.id, STRANGER, mintAttempt(), LEASE)).kind).toBe("gone");
    });

    /**
     * **The value that travels between the caller and the store.**
     *
     * `advanceJob` minted its attempt token with `mintId()` — a `spya-` id —
     * while `jobs.attempt_id` is a `uuid` column, so every advance against
     * Postgres died with `22P02` on the claim. Nothing caught it: the
     * filesystem adapter takes any string so the job suite was green, and this
     * suite minted its own tokens with `crypto.randomUUID()`, so the store was
     * tested and the caller was tested and the thing passed between them was
     * not.
     *
     * Every case in this file now mints the way the caller does, which is the
     * real fix. This one states it, so that changing `mintAttempt` to something
     * a column will not take fails here rather than in production.
     */
    it("accepts the token the caller actually mints", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE)).kind).toBe("claimed");
      await store.releaseStep(job.id, attempt, job.steps, {});
    });

    it("lets one claimant in and turns the second away", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");

      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE)).kind).toBe("claimed");
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE)).kind).toBe("busy");
    });

    it("turns a claim away while another job holds the one running slot", async () => {
      const a = aJob();
      const b = aJob();
      await store.enqueueOrGet(a, "k1");
      await store.enqueueOrGet(b, "k2");

      expect((await store.claim(a.id, OWNER, mintAttempt(), LEASE)).kind).toBe("claimed");
      /* In Postgres `jobs_only_one_running` raises 23505 rather than matching no
         rows, so this escapes as a 500 unless the adapter catches that code by
         name — and Drizzle wraps the driver error, so the obvious check compiles
         and never matches. An index doing its job is not an exception. */
      const blocked = await store.claim(b.id, OWNER, mintAttempt(), LEASE);
      expect(blocked.kind).toBe("busy");
      expect(blocked.kind === "busy" && blocked.why).toMatch(/another job is running/);
    });

    it("will not claim a job the reader has stopped, or one already over", async () => {
      /* Stop on a job somebody is **inside**. That is the only way to reach
         `stopping` since 2026-08-27: a *queued* job is cancelled outright by
         the same call, because nobody is there to notice a flag. */
      const stopping = aJob();
      await store.enqueueOrGet(stopping, "k1");
      const held = mintAttempt();
      await store.claim(stopping.id, OWNER, held, LEASE);
      await store.requestCancel(stopping.id, OWNER);
      // Otherwise the API key is spent on a job that has already been stopped —
      // one of the three cancellation windows step 12 named.
      expect((await store.claim(stopping.id, OWNER, mintAttempt(), LEASE)).kind).toBe(
        "stopping",
      );
      /* Released before the second half, or it would hold the single running
         slot and the next job's claim would come back `busy` — a true answer to
         a different question, and it would look like this test failing. */
      await store.releaseStep(stopping.id, held, stopping.steps, {});

      const over = aJob();
      await store.enqueueOrGet(over, "k2");
      const attempt = mintAttempt();
      expect((await store.claim(over.id, OWNER, attempt, LEASE)).kind).toBe("claimed");
      await store.finish(over.id, attempt, { status: "done", steps: over.steps });
      expect((await store.claim(over.id, OWNER, mintAttempt(), LEASE)).kind).toBe("finished");
    });

    /**
     * **The one that stops the endpoint deadlocking itself.**
     *
     * One claim covers one step. If it were held across requests, the next
     * advance — a different request with a different token — would be told
     * `busy` until the lease expired, and the happy path would break on step two
     * with every symptom pointing at the client.
     */
    it("lets the claim go after a step, so the next request can have it", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE)).kind).toBe("claimed");

      const done: JobStep[] = [{ ...job.steps[0]!, status: "done" }];
      const after = await store.releaseStep(job.id, attempt, done, { title: "A Paper" });
      expect(after.status).toBe("queued");
      expect(after.title).toBe("A Paper");
      expect(after.steps[0]?.status).toBe("done");

      // A different request, a different token, and it gets in.
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE)).kind).toBe("claimed");
    });

    it("writes what the card says mid-step without letting go of the claim", async () => {
      /* The reader-facing half of the claim. A step is one request and a model
         call inside it takes tens of seconds; without this the poll in between
         shows the step still `pending` and the card says nothing is happening.
         So: the steps move, the status stays `running`, and the token stays
         put — a `queued` here would let a second request in mid-step. */
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE)).kind).toBe("claimed");

      const running: JobStep[] = [{ ...job.steps[0]!, status: "running", detail: "12 KB" }];
      const after = await store.noteProgress(job.id, attempt, running);
      expect(after.status).toBe("running");
      expect(after.steps[0]?.status).toBe("running");
      expect(after.steps[0]?.detail).toBe("12 KB");

      // Still held: a second request must not get in behind a progress write.
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE)).kind).toBe("busy");
      // And the claimant still owns it.
      await store.releaseStep(job.id, attempt, running, {});
    });

    it("refuses a progress write onto a job that has ended under the claimant", async () => {
      /* Built the dangerous way round, for the reason spelled out three tests
         down: releasing clears the status *and* the token, so a test that
         released first would pass with either condition deleted and prove
         neither. The state that needs the third condition is a job that is over
         and still carries its token — which the schema permits, because
         `jobs_running_is_fenced` constrains `running` rows only. */
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE)).kind).toBe("claimed");

      await adapter.expire(job.id);
      expect(await store.failExpired()).toBeGreaterThanOrEqual(1);
      await adapter.reattach(job.id, attempt);

      // id matches, attempt matches. Only `status = 'running'` refuses this.
      await expect(store.noteProgress(job.id, attempt, job.steps)).rejects.toBeInstanceOf(
        StaleAttemptError,
      );
    });

    it("names the job holding a slug, and says nothing about a finished one", async () => {
      /* What slug allocation asks. A job that has not written a `meta.json` yet
         still owns its name, or two articles whose URLs end in the same segment
         both take the bare one and the second is quietly handed the first's
         job. A *finished* job owns nothing — its article speaks for it. */
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      expect((await store.activeForSlug(job.slug, OWNER))?.id).toBe(job.id);
      // Somebody else asking learns nothing, exactly as with `get`.
      expect(await store.activeForSlug(job.slug, STRANGER)).toBeUndefined();

      const attempt = mintAttempt();
      await store.claim(job.id, OWNER, attempt, LEASE);
      expect((await store.activeForSlug(job.slug, OWNER))?.id).toBe(job.id);

      await store.finish(job.id, attempt, { status: "done", steps: job.steps });
      expect(await store.activeForSlug(job.slug, OWNER)).toBeUndefined();
    });

    /**
     * **The fence's third condition, tested on the state that needs it.**
     *
     * The first version of this failed a job with `failExpired` and asserted the
     * old token was refused — and it **passed with `status = 'running'` removed
     * from the fence**, because `failExpired` clears the token too, so the second
     * condition was doing all the work. A test that cannot fail proves nothing,
     * and this one nearly shipped with a comment saying it had been watched red.
     *
     * So the dangerous state is built directly: a job that has ended and still
     * carries its token. **The schema permits exactly that** —
     * `jobs_running_is_fenced` constrains `running` rows only — so it is one
     * forgotten `attemptId: null` away in any transition somebody adds later.
     */
    it("refuses a write onto a finished job that still carries its token", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE)).kind).toBe("claimed");

      // Its lease runs out and the sweep fails it. The claimant does not know.
      await adapter.expire(job.id);
      expect(await store.failExpired()).toBeGreaterThanOrEqual(1);
      expect((await store.get(job.id, OWNER))?.status).toBe("error");

      await adapter.reattach(job.id, attempt);

      await expect(store.releaseStep(job.id, attempt, job.steps, {})).rejects.toBeInstanceOf(
        StaleAttemptError,
      );
      await expect(
        store.finish(job.id, attempt, { status: "done", steps: job.steps }),
      ).rejects.toBeInstanceOf(StaleAttemptError);
      // And the sweep's own account of it survived the refused writes.
      expect((await store.get(job.id, OWNER))?.error).toMatch(/did not come back/);
    });

    it("refuses a write from a claimant whose job somebody else now holds", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      const mine = mintAttempt();
      await store.claim(job.id, OWNER, mine, LEASE);
      await store.releaseStep(job.id, mine, job.steps, {});
      await store.claim(job.id, OWNER, mintAttempt(), LEASE);

      // The first claimant comes back late. It cannot write, and it learns that
      // rather than affecting zero rows and being told nothing.
      await expect(store.releaseStep(job.id, mine, job.steps, {})).rejects.toBeInstanceOf(
        StaleAttemptError,
      );
    });

    it("fails a job whose lease ran out, and leaves a live one alone", async () => {
      const dead = aJob();
      await store.enqueueOrGet(dead, "k1");
      await store.claim(dead.id, OWNER, mintAttempt(), LEASE);
      await adapter.expire(dead.id);
      expect(await store.failExpired()).toBe(1);
      const failed = await store.get(dead.id, OWNER);
      expect(failed?.status).toBe("error");
      /* `retry`, said rather than left to the absent-means-yes rule — both offer
         the button, and only one of them says why. An interrupted job really is
         worth another go, because `stepIsDone` derives what is finished from the
         artefacts, so a retry resumes rather than starting again. */
      expect(failed?.failureKind).toBe("retry");

      // The running slot is free again, which is the other half of why this runs.
      const alive = aJob();
      await store.enqueueOrGet(alive, "k2");
      await store.claim(alive.id, OWNER, mintAttempt(), LEASE);
      expect(await store.failExpired()).toBe(0);
      expect((await store.get(alive.id, OWNER))?.status).toBe("running");
    });

    it("cancels a queued job outright, and only asks a running one — in one call", async () => {
      const queued = aJob();
      await store.enqueueOrGet(queued, "k1");
      /* Nobody is inside a queued job, so there is no `cancelling` flag for
         anyone to notice — p-queue's own callback used to clear it and Postgres
         provides no such callback. It has to be terminal here or never. */
      const stopped = await store.requestCancel(queued.id, OWNER);
      expect(stopped?.status).toBe("cancelled");
      expect(stopped?.cancelling).toBeFalsy();

      const running = aJob();
      await store.enqueueOrGet(running, "k2");
      await store.claim(running.id, OWNER, mintAttempt(), LEASE);
      const asked = await store.requestCancel(running.id, OWNER);
      expect(asked?.status).toBe("running");
      expect(asked?.cancelling).toBe(true);
    });

    /**
     * **The state that used to be permanent, and the reason cancel is one call.**
     *
     * Instance B presses Stop on a job instance A is inside. `cancelling` goes
     * on; A finishes its step successfully and releases. If the release put the
     * job back to `queued` and left the flag alone, every later claim would read
     * the flag, answer `stopping`, and do so for ever — with the reader's Stop
     * button already disabled, because the job says it is stopping. Nothing in
     * the system moves that row again.
     *
     * So the release is where a cancel observed mid-step lands. GPT Sol found
     * it reviewing the built queue; there is a same-instance version too, which
     * is why the ask itself also had to stop being two calls.
     */
    it("ends a job whose Stop arrived while a step was running, rather than requeueing it", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE)).kind).toBe("claimed");

      // Somebody else presses Stop. This claimant knows nothing about it.
      await store.requestCancel(job.id, OWNER);

      // Its step succeeds and it releases, as it would on any ordinary step.
      const after = await store.releaseStep(job.id, attempt, job.steps, {});
      expect(after.status).toBe("cancelled");
      expect(after.cancelling).toBeFalsy();
      expect(after.finishedAt).toBeTruthy();

      // And it is really over, rather than answering `stopping` for ever.
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE)).kind).toBe("finished");
    });

    /**
     * **The lease had a deadline and nothing enforced it.**
     *
     * `failExpired` was written with the store and had no production caller at
     * all — GPT Sol's first finding on the built queue, and the worst of them,
     * because it is a regression rather than a gap. The old in-memory queue
     * self-healed on restart: a dead process left an empty `Map`, so the next
     * advance found nothing owning the job and got on with it. A `running` row
     * with a dead claimant heals by itself never; every advance answers `busy`,
     * the browser retries for ever and the pump backs off for ever.
     *
     * `advanceJob` now sweeps before it claims. Here that is checked at the
     * level the store owns: after a sweep, the slot is free again.
     */
    it("frees the running slot once a claimant has stopped answering", async () => {
      const dead = aJob();
      await store.enqueueOrGet(dead, "k1");
      expect((await store.claim(dead.id, OWNER, mintAttempt(), LEASE)).kind).toBe("claimed");

      const waiting = aJob();
      await store.enqueueOrGet(waiting, "k2");
      // Blocked, correctly, while the first job is genuinely running.
      expect((await store.claim(waiting.id, OWNER, mintAttempt(), LEASE)).kind).toBe("busy");

      await adapter.expire(dead.id);
      expect(await store.failExpired()).toBeGreaterThanOrEqual(1);

      const after = await store.get(dead.id, OWNER);
      expect(after?.status).toBe("error");
      // Failed rather than taken over, and offering Retry rather than a dead end.
      expect(after?.failureKind).toBe("retry");
      expect((await store.claim(waiting.id, OWNER, mintAttempt(), LEASE)).kind).toBe(
        "claimed",
      );
    });

    it("refuses to forget a job that is still going", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      expect(await store.forget(job.id, OWNER)).toBe(false);
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE)).kind).toBe("claimed");
      await store.finish(job.id, attempt, { status: "done", steps: job.steps });
      expect(await store.forget(job.id, OWNER)).toBe(true);
      expect(await store.get(job.id, OWNER)).toBeUndefined();
    });

    it("keeps the newest finished jobs and drops successes before failures", async () => {
      /* Retention is on the contract rather than left to a caller because a
         store that grows without limit is not a detail: `list` reads all of
         them, and it is what the homepage polls. */
      const ended: Job[] = [];
      for (let i = 0; i < 4; i++) {
        const job = aJob({ createdAt: new Date(Date.now() - (4 - i) * 60_000).toISOString() });
        await store.enqueueOrGet(job, `k${i}`);
        const attempt = mintAttempt();
        await store.claim(job.id, OWNER, attempt, LEASE);
        // The oldest one failed; the rest succeeded.
        await store.finish(job.id, attempt, {
          status: i === 0 ? "error" : "done",
          steps: job.steps,
          ...(i === 0 ? { error: "went wrong" } : {}),
        });
        ended.push(job);
      }

      expect(await store.trimFinished(OWNER, 2)).toBe(2);
      const left = (await store.list(OWNER)).map((j) => j.id);
      // The failure survives even though it is the oldest — a reader who loses a
      // failure loses the only account of what went wrong.
      expect(left).toContain(ended[0]!.id);
      expect(left).toContain(ended[3]!.id);
      expect(left).not.toContain(ended[1]!.id);
    });
  });
}

process.on("beforeExit", () => {
  void closeDb();
});
