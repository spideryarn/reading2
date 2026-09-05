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
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { ID_PREFIX, mintId } from "../src/ids.js";
import { INTERRUPTED } from "../src/messages.js";
import { mintAttempt } from "../src/store/jobs.js";
import type { ExpirySettlement, JobStore } from "../src/store/jobs.js";
import { StaleAttemptError } from "../src/store/jobs.js";
import {
  expireLeaseForTests,
  fsJobStore,
  reattachAttemptForTests,
  forgetForTests,
  stampFinishedForTests,
} from "../src/store/jobs-fs.js";
import { pgJobStore, releaseStepIn } from "../src/store/pg-jobs.js";
import type { Job, JobStep, OwnerId } from "../src/types.js";
import { expectClaimed } from "./helpers/expect-claimed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { cleanUpThenRelease, takeRunLockAndSetUp } from "./helpers/lock-lifecycle.js";
import type { HeldRunLock } from "./helpers/run-lock.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();

/**
 * **This suite's own person, seeded here and taken away again.**
 *
 * It used to be the development owner — `DEV_OWNER_ID`, imported rather than
 * written out, on the grounds that `jobs_owner_fk` needs a real `auth.users`
 * row and there was exactly one of those. That was wrong, and it took a while
 * to show, because sharing an owner is only a problem for the one method whose
 * scope is the owner: **`trimFinished` is owner-wide**. Every other case here
 * addresses a job by id and cannot see anybody else's.
 *
 * So the retention case counted rows it had not created and deleted rows it did
 * not own. One stray `error` row, left in the local database by a run of
 * tests/jobs.test.ts that had picked up `SPIDERYARN_STORE=postgres` from a file
 * before it in the same worker, made it delete three where it expected two —
 * and the same arrangement, with the stray a *success* rather than a failure,
 * would have deleted that other suite's row instead of its own. That is exactly
 * the hazard tests/fixture-ids.test.ts exists to catch, and it could not: the
 * id was imported rather than written out, so there was no literal to collide.
 *
 * Hence a uuid of this file's own, and a real `auth.users` row to hang it on —
 * the pattern is tests/db-schema.test.ts, which has been inserting one for its
 * own fixtures since it was written. Created once at module load, removed with
 * its jobs in `afterAll`, and nothing else in the suite anywhere near it.
 *
 * **And a fresh one every run**, which the first version of this was not. A
 * fixed uuid is one owner shared by every run there has ever been, so it moves
 * the same hazard rather than removing it: two runs at once put their jobs
 * under one owner and whichever `afterAll` fires first takes the other's away,
 * and a run that was killed leaves its rows there for the next one to count.
 * `on conflict do nothing` on the person does not help with either — it makes
 * the *seed* survive both, which is what made them look handled.
 *
 * The stem is fixed and the tail is random, so the rows are recognisable as
 * this file's without being shared: `RUBBLE` below sweeps the stem, and that is
 * the whole cleanup for a run that never reached its teardown. A random owner
 * is also invisible to tests/fixture-ids.test.ts, which reads uuid *literals* —
 * no loss, since an id nobody can write down is an id nobody can collide with.
 *
 * The stranger is this file's own too and is never inserted: it exists only to
 * prove that somebody else's job reads as one that is not there.
 */
const OWNER_STEM = "000000b6-0000-4000-8000-";
const OWNER = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
/**
 * **A second real person**, because one case here is about a sweep that must
 * only reach one of them.
 *
 * `settleExpired(now, owner)` is the owner-scoped sweep `listJobs` calls, and
 * the way to get it wrong is for the owner argument to be accepted and then not
 * used — which no test with a single owner can see, and which the `STRANGER`
 * cannot see either: an owner with no jobs of their own proves that *nothing*
 * was settled, not that *the right thing* was. So this owner is seeded and has
 * a job, and the case sweeps as `OWNER` and looks at both.
 *
 * Same stem, so `RUBBLE` takes it away with the rest, and the same random tail
 * per run for the same reason as `OWNER`.
 */
const OWNER_B = `${OWNER_STEM}${randomUUID().slice(-12)}` as OwnerId;
const RUBBLE = `${OWNER_STEM}%`;
const STRANGER = "00000000-0000-4000-8000-0000000000b5" as OwnerId;

/**
 * **One run of this file at a time, against one database.**
 *
 * A private owner is not enough on its own, because the two rules that matter
 * most here are not scoped to an owner at all: `jobs_only_one_running` is a
 * unique index on `(true)` over every running row in the table, and
 * `settleExpired` sweeps the whole table and returns the settlements this file
 * asserts exactly. So a second copy holding a claim makes this one's `claimed`
 * come back `busy`, and its expiries are added to this one's total. Measured with
 * the lock taken out and the owner already unique per run: two copies at once,
 * 6 and 9 of the 21 Postgres cases failed. The filesystem side passed both
 * times — its running slot is a variable in one process.
 *
 * **It covers copies of this file and nothing else.** Anything with a `running`
 * row takes the same one slot — a real ingest on the same laptop will do — and
 * three claim cases here were watched failing `busy` for exactly that reason on
 * 2026-08-28, while a peer's job ran. No owner and no lock can help: the index
 * is global on purpose, because global concurrency 1 is what it is for.
 *
 * A session-level advisory lock is what serialises them. Postgres drops it when
 * the connection goes, so a killed run releases it without anybody's teardown
 * having to run.
 *
 * **The lock used to live in this file, and the key used to be this file's.**
 * The comment here said "nothing else in the repo takes an advisory lock, and a
 * collision would only serialise more than needed", which was true when one file
 * needed it and stopped being true afterwards. A lock only serialises the
 * holders that agree to take it, so while this file held the key alone it went
 * on failing `expected 'busy' to be 'claimed'` against files that had never
 * heard of it. It is now `tests/helpers/run-lock.ts`, taken by every suite that
 * needs the slot, and the reasoning lives there.
 */

/**
 * Probed at MODULE LOAD so the failure arrives before a single case is
 * registered — and it **is** a failure now rather than a skip: there is one
 * store, and a database this file cannot use is not a configuration.
 * tests/helpers/pg-ready.ts.
 */
await pgReady({ suite: "tests/store-jobs-parity.test.ts", tables: ["spideryarn.jobs"] });

/** Holds `RUN_LOCK` for the length of the run; released in `afterAll`. */
let runLock: HeldRunLock | undefined;

{
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    /* Locked, swept and seeded in the same breath as the probe, because a
       `beforeAll` runs after the describes have been collected.

       Not a `catch` that shrugs: if the row cannot be created then every case
       here is about to fail on a foreign key, and a probe that swallowed the
       reason would send the reader to the store. The dozen not-null columns and
       the zero `instance_id` are `auth.users` being Supabase's table rather than
       ours — see scripts/db-seed-owner.ts.

       Through `takeRunLockAndSetUp`, so a failure inside the sweep cannot walk
       away with the key. tests/helpers/lock-lifecycle.ts. */
    runLock = await takeRunLockAndSetUp("tests/store-jobs-parity.test.ts", async () => {
      /* **Every owner this file has ever minted, jobs first.**
         Not the same thing as the teardown, and not covered by it: teardown
         does not run when the process is killed, so a run that was interrupted
         leaves its jobs behind for ever. With a fresh owner each run those rows
         are invisible to this one's own queries — but not to the database's,
         and both of the rules this file leans on are global. A leftover
         `running` row makes every claim here answer `busy` through
         `jobs_only_one_running`, and a leftover expired one is counted by
         `settleExpired`, which two cases below assert exactly.

         Safe to take the lot because the lock is already held, so no sibling
         copy can be using any of them; and scoped by the stem, so it can only
         ever reach rows this file made.

         On this file's own `pool` rather than on the lock's connection: the
         lock excludes the other suites whichever connection does the work, and
         `pool` is what seeds through `seedAuthUser` below. */
      await pool.query(`delete from spideryarn.jobs where owner_id::text like $1`, [RUBBLE]);
      await pool.query(`delete from auth.users where id::text like $1`, [RUBBLE]);

      /* No `on conflict`: the id is fresh and the rubble is gone, so a conflict
         here would mean something we have not thought of. The email is per-run
         too — `users_email_partial_key` is unique, so a fixed one is its own way
         for two runs to collide. */
      for (const who of [OWNER, OWNER_B]) {
        await seedAuthUser(pool, { id: who, email: `store-jobs-parity-${who}@example.invalid` });
      }
    });
  } finally {
    /* A leaked pool at module scope is a connection nothing ever closes. */
    await pool.end();
  }
}

const LEASE = 60_000;
/**
 * **Deliberately out of the way.** `claim` takes the cap as an argument, exactly
 * as it takes the lease, so most cases here want a number high enough that the
 * global cap never enters into what they are testing. The two cases that *are*
 * about the cap pass their own, small, on purpose — a suite-wide constant that
 * both sets shared would make one of them pass for the other's reason.
 *
 * **It was 4 until 2026-09-02, and 4 was not out of the way.** The count is
 * taken over every `running` row in the table, so a peer's `npm test` in another
 * worktree — which the run lock cannot exclude unless every one of its suites
 * takes the same key — puts this suite over 4 and the cases about an article's
 * *line* then answer `already running N of 4` instead of `ahead of it`. Watched
 * happening while two other runs shared this laptop's database. A number nothing
 * plausible reaches is the honest way to say "not what this case is about".
 */
const CAP = 100;
/** Prefixed so this file's rows can be found and removed without touching anybody else's. */
const MINE = "test-store-jobs-";

/**
 * The ids out of a settlement, for the cases that only care which jobs moved.
 *
 * `settleExpired` returns `{ id, status }` pairs rather than ids, because since
 * 2026-09-01 it does not always fail: a row carrying `cancelling` ends
 * `cancelled`. The cases that are *about* which ending it chose assert the
 * whole pair.
 */
function settledIds(settled: ExpirySettlement[]): string[] {
  return settled.map((one) => one.id);
}

/**
 * **Each store, plus the three states its own API cannot reach.**
 *
 * A lease that has passed, a job that has ended while still carrying its token,
 * and a chosen `finishedAt`. All three are real — the second is one forgotten
 * `attemptId: null` away in any transition somebody adds later — and none can
 * be produced through the contract, which is rather the point of a fence.
 * Without an equivalent on both sides the two adapters would be tested to
 * different depths and "parity" would be doing no work.
 *
 * `stampFinished` joined them on 2026-09-03, when retention started ordering by
 * when a job finished rather than by when it was queued. Every terminal
 * transition reads the clock for itself, so no sequence of `JobStore` calls can
 * tie two finishes or put three of them in an order other than the calls'.
 */
interface Adapter {
  name: string;
  store: JobStore;
  expire(id: string): Promise<void>;
  reattach(id: string, attempt: string): Promise<void>;
  /** Rewrite an already-terminal job's `finishedAt`. The job must have ended. */
  stampFinished(id: string, iso: string): Promise<void>;
  forgetAll(ids: string[]): Promise<void>;
}

const ADAPTERS: Adapter[] = [
  {
    name: "the filesystem store",
    store: fsJobStore,
    async expire(id) {
      expireLeaseForTests(id);
    },
    async reattach(id, attempt) {
      reattachAttemptForTests(id, attempt);
    },
    async stampFinished(id, iso) {
      await stampFinishedForTests(id, iso);
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
    /* Written straight to the column rather than by claiming with a tiny lease,
       because a lease short enough to expire during a test is short enough to
       expire between two of the assertions that follow.

       **`clock_timestamp()`, not `Date.now()`.** The store creates and compares
       leases on the database's clock, so a helper reaching for the
       application's would be testing the two against each other — green on a
       laptop where they are the same clock, and quietly wrong exactly where
       Vercel and Supabase are not. And `clock_timestamp()` rather than `now()`
       for the same reason the store uses it: one spelling of "the time", so
       nobody has to work out whether a helper and a fence mean the same
       thing. */
    async expire(id) {
      await getDb()
        .update(jobs)
        .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(jobs.id, id));
    },
    async reattach(id, attempt) {
      await getDb().update(jobs).set({ attemptId: attempt }).where(eq(jobs.id, id));
    },
    async stampFinished(id, iso) {
      await getDb()
        .update(jobs)
        .set({ finishedAt: new Date(iso) })
        .where(eq(jobs.id, id));
    },
    async forgetAll(ids) {
      await getDb().delete(jobs).where(inArray(jobs.id, ids));
    },
  },
];

for (const adapter of ADAPTERS) {
  const store = adapter.store;

  describe(adapter.name, () => {
    const made: string[] = [];
    afterEach(async () => {
      const ids = made.splice(0);
      if (ids.length > 0) await adapter.forgetAll(ids);
    });

    /* `over.id` is honoured and still cleaned up. The retention cases below name
       their own ids, because two jobs created in the same millisecond are told
       apart by id and a test of that cannot leave the ids to chance. */
    function aJob(over: Partial<Job> = {}): Job {
      const id = over.id ?? mintId();
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
      const job = aJob({ url: "https://example.test/a", profile: "a linguist" });
      const { job: saved, kind } = await store.enqueueOrGet(job, {
        workKey: "k1",
        reservesName: false,
      });
      expect(kind).toBe("created");
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
      await store.enqueueOrGet(first, { workKey: "k1", reservesName: false });

      /* Two instances each scanning their own memory each find nothing and each
         start paying for the same article. */
      const again = { ...aJob(), slug: first.slug };
      const { job, kind } = await store.enqueueOrGet(again, {
        workKey: "k1",
        reservesName: false,
      });
      expect(kind).toBe("sameWork");
      expect(job.id).toBe(first.id);
    });

    /**
     * **The de-duplication has to survive a slug holding several jobs**, and
     * this is the case that says so.
     *
     * Both adapters used to answer this question against **one arbitrarily
     * chosen row** — Postgres `.limit(1)` with no ordering, the filesystem
     * `.find` in `Map` insertion order — which was correct only while a slug
     * could hold a single active job. With a line, a request duplicating the
     * *second* job in it was told the slug was held by different work, and the
     * reader paid again for something already in flight. So the third request
     * here matches the second job, never the first.
     *
     * Watched red against the `.limit(1)` read: `expected 'created' to be
     * 'sameWork'` on Postgres.
     */
    it("finds the matching job in the line, not whichever row comes first", async () => {
      const first = aJob();
      await store.enqueueOrGet(first, { workKey: "k1", reservesName: false });
      const second = aJob({ slug: first.slug });
      await store.enqueueOrGet(second, { workKey: "k2", reservesName: false });

      const again = aJob({ slug: first.slug });
      const found = await store.enqueueOrGet(again, { workKey: "k2", reservesName: false });
      expect(found.kind).toBe("sameWork");
      expect(found.job.id).toBe(second.id);
    });

    /**
     * **This case used to be its own opposite**, and the inversion is the whole
     * of what Greg asked for.
     *
     * It said *"says when the slug is held by different work, so the caller can
     * move along"* — because `jobs_active_slug` covered `queued`, so a second,
     * different request for one article could not be stored at all and the
     * caller had to rename the article or refuse. Different work on one article
     * now queues behind the first, and there is nothing to move along from.
     */
    it("takes different work on a held slug rather than turning it away", async () => {
      const first = aJob();
      await store.enqueueOrGet(first, { workKey: "k1", reservesName: false });
      const other = aJob({ slug: first.slug });
      const queued = await store.enqueueOrGet(other, { workKey: "k2", reservesName: false });
      expect(queued.kind).toBe("created");
      expect(queued.job.id).toBe(other.id);
      expect(queued.job.status).toBe("queued");
    });

    /**
     * **A `running` job handed to `enqueueOrGet` is queued — in every account of
     * it.**
     *
     * `enqueueOrGet` takes a whole `Job`, and honouring its `status` would let a
     * caller put a `running` row in through the door marked *enqueue*: one that
     * never passed the cap check, carries no attempt token, and is counted
     * against everybody else by `runningCount`. Nothing does that today; the
     * contract simply should not allow it.
     *
     * **Three places have to agree**, and the filesystem adapter had one of them
     * wrong: it normalised the job into memory and then persisted and returned
     * the *caller's* object, so the same job was queued in memory, running on
     * disk, and running in the `created` outcome the route answers with. The
     * disk half is tests/jobs-fs-load.test.ts, which can reload; these two are
     * the ones both stores can be asked. GPT Sol, reviewing the built stage 1,
     * finding 6.
     *
     * Watched red on 2026-09-02 against the filesystem adapter as it stood:
     * *"the outcome handed back the caller's status: expected 'running' to be
     * 'queued'"*.
     */
    it("queues a job it was handed as running, in the outcome as well as the store", async () => {
      const job = aJob({ status: "running" });
      const created = await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      expect(created.kind).toBe("created");
      expect(created.job.status, "the outcome handed back the caller's status").toBe("queued");
      expect((await store.get(job.id, OWNER))?.status).toBe("queued");
    });

    it("reads somebody else's job as one that is not there", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      expect(await store.get(job.id, OWNER)).toBeDefined();
      expect(await store.get(job.id, STRANGER)).toBeUndefined();
      expect((await store.claim(job.id, STRANGER, mintAttempt(), LEASE, CAP)).kind).toBe("gone");
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
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      await store.releaseStep(job.id, attempt, job.steps, {});
    });

    it("lets one claimant in and turns the second away", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });

      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("busy");
    });

    /**
     * **The cap, which used to be the number one and is now an argument.**
     *
     * This case said *"turns a claim away while another job holds the one
     * running slot"* until 2026-08-30, and it was about `jobs_only_one_running`
     * — a unique index on the constant `(true)`, which in Postgres raised
     * `23505` rather than matching no rows, so the point of the test was that
     * the adapter caught that code **by name**. The index is gone
     * (drizzle/0032_jobs_concurrency_cap.sql) and the cap is a count taken
     * inside the `queue_state` lock, so what is worth pinning changed with it:
     * not a constraint name, but that the number is honoured and that going
     * over it is refused rather than merely unlikely.
     *
     * **`maxRunning: 1` rather than the suite's `CAP`**, so the cap is what
     * blocks the second claim and nothing else can be. With two jobs on two
     * slugs, the article rule cannot fire and there is only one candidate
     * explanation left.
     *
     * Watched red against a claim that ignored its `maxRunning` argument: both
     * adapters answered `claimed`.
     */
    it("refuses a claim that would put the machine over its cap", async () => {
      const a = aJob();
      const b = aJob();
      await store.enqueueOrGet(a, { workKey: "k1", reservesName: false });
      await store.enqueueOrGet(b, { workKey: "k2", reservesName: false });

      const held = mintAttempt();
      expectClaimed(await store.claim(a.id, OWNER, held, LEASE, 1));
      const blocked = await store.claim(b.id, OWNER, mintAttempt(), LEASE, 1);
      expect(blocked.kind).toBe("busy");
      /* The reason names the arithmetic. `busy` already means four things to the
         client, and a log line that cannot tell "the machine is full" from "your
         other tab has it" makes them one symptom. */
      expect(blocked.kind === "busy" && blocked.why).toMatch(/1 of 1/);

      /* **And the same claim goes through when the cap allows it** — without
         this half, a `claim` that refused everything would pass. */
      expectClaimed(await store.claim(b.id, OWNER, mintAttempt(), LEASE, 2));
      await store.releaseStep(a.id, held, a.steps, {});
    });

    /* ------------------------------------------------- several at once -- */

    /**
     * **The lock itself, and nothing else.**
     *
     * The cap case below proves the *arithmetic* — that `maxRunning` is read and
     * obeyed. It cannot prove the **serialisation**, and GPT Sol's review of the
     * built code made the point exactly: delete the `for update` line from
     * `claim` and that test stays green, because it claims A and then claims B,
     * one after the other, and a count taken outside a lock is perfectly correct
     * when nothing is racing it. A test that cannot go red when the guard is
     * removed is testing something else.
     *
     * So this holds the singleton from **another connection** and asks whether
     * `claim` notices. If the lock statement is there, the claim is refused; if
     * somebody deletes it, the claim sails past a lock it never asked for and
     * this goes red — which is the whole point.
     *
     * **`NOWAIT` is why this can be written at all.** Against a plain
     * `for update` the claim would block on the held row and the test would have
     * to be a barrier and a race; refusing immediately makes it two statements
     * and a `finally`. See `claim` for why refusing rather than waiting is the
     * contract anyway.
     *
     * Postgres only: the filesystem adapter has no lock to take, because it has
     * no second process to take it from.
     */
    it.skipIf(adapter.name !== "Postgres")(
      "will not claim while another claimant holds the queue lock",
      async () => {
        const job = aJob();
        await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });

        /* Its own connection, because a transaction cannot block on a lock it
           already holds — taking it through `getDb()` would prove nothing. */
        const holder = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
        const held = await holder.connect();
        try {
          await held.query("begin");
          await held.query("select 1 from spideryarn.queue_state where id = 1 for update");

          const refused = await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP);
          expect(refused.kind).toBe("busy");
          expect(refused.kind === "busy" && refused.why).toMatch(/being decided/);

          /* **And it goes through the moment the lock is free** — without this
             half, a `claim` that refused unconditionally would pass. */
          await held.query("rollback");
          const attempt = mintAttempt();
          expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
          await store.releaseStep(job.id, attempt, job.steps, {});
        } finally {
          /* Belt and braces: an assertion that threw above leaves the
             transaction open, and a released client keeps its locks. */
          await held.query("rollback").catch(() => undefined);
          held.release();
          await holder.end();
        }
      },
    );


    /**
     * **Two articles at once**, which is the whole of what Greg asked for.
     *
     * Red before the change and it is worth saying exactly how: today
     * `jobs_only_one_running` is a unique index on the constant `(true)`, so the
     * second claim raises `23505` and the adapter turns it into `busy`. The
     * filesystem adapter reaches the same answer through `runningNow()`. Both
     * sides therefore fail this, which is what makes it a parity case rather
     * than a Postgres one.
     *
     * `aJob()` gives each job a slug of its own, so nothing here is about the
     * article rule below.
     */
    it("runs two jobs on two different articles at the same time", async () => {
      const a = aJob();
      const b = aJob();
      await store.enqueueOrGet(a, { workKey: "k1", reservesName: false });
      await store.enqueueOrGet(b, { workKey: "k2", reservesName: false });

      /* The tokens are kept rather than read back off the job: `toJob` does not
         carry `attempt_id`, deliberately, so the caller's own is the only
         spelling of it there is. */
      const [heldA, heldB] = [mintAttempt(), mintAttempt()];
      expectClaimed(await store.claim(a.id, OWNER, heldA, LEASE, CAP));
      expectClaimed(await store.claim(b.id, OWNER, heldB, LEASE, CAP));

      /* Released, or they hold two of the cap's slots for every case after this
         one — which would read as those cases failing. */
      await store.releaseStep(a.id, heldA, a.steps, {});
      await store.releaseStep(b.id, heldB, b.steps, {});
    });

    /**
     * **A full machine must not change what a job *is*.**
     *
     * The two adapters classified in opposite orders and nobody would have
     * noticed: Postgres refused on the cap before it looked at the row, the
     * filesystem store looked first. So at the cap a finished job read `busy`
     * here and `finished` there, and a job that does not exist read `busy`
     * rather than `gone` — which matters beyond tidiness, because
     * `advanceJobWith` casts the `get()` behind its `busy` branch straight to
     * `Job`, so a missing row would come back as a 200 where the route means a
     * 404. GPT Sol found it reviewing the built code.
     *
     * The cap is 0, which no configuration would ask for and is the cleanest way
     * to say "saturated" — every claim is over the limit whatever else is
     * running, so nothing here depends on the state another case left behind.
     */
    it("answers what a job is, not how busy the machine is, when the cap is full", async () => {
      const missing = `${ID_PREFIX}zzzzzz`;
      expect((await store.claim(missing, OWNER, mintAttempt(), LEASE, 0)).kind).toBe("gone");

      const over = aJob();
      await store.enqueueOrGet(over, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(over.id, OWNER, attempt, LEASE, CAP));
      await store.finish(over.id, attempt, { status: "done", steps: over.steps });
      expect((await store.claim(over.id, OWNER, mintAttempt(), LEASE, 0)).kind).toBe("finished");

      /* Somebody else's still reads as one that is not there, at the cap as
         below it — otherwise a full machine is an oracle for which job ids
         exist. */
      const mine = aJob();
      await store.enqueueOrGet(mine, { workKey: "k2", reservesName: false });
      expect((await store.claim(mine.id, STRANGER, mintAttempt(), LEASE, 0)).kind).toBe("gone");
    });

    /**
     * **And two jobs on ONE article take turns**, which is the guarantee that
     * pays for the one above.
     *
     * Not a nicety: src/store/artifacts-fs.ts keys every artefact write, the
     * attempt marker and `interrupted()` on `(slug, step)` in one shared
     * `data/<slug>/` directory with no job scoping, and on Postgres a job
     * publishes by copying whatever revision is current and moving the pointer.
     * Two claimants on one article therefore overwrite each other, and both
     * report success — docs/reusable/silent-success.md.
     *
     * **Skipped until 2026-09-02**, because the second job had nowhere to be
     * stored: `jobs_active_slug` covered `queued`, so this failed at its second
     * line. It was written and watched red first so that turning it on was a
     * one-word change to something already known to fail for the right reason.
     */
    it("queues a second job for one article rather than refusing it, and will not run both", async () => {
      const first = aJob();
      await store.enqueueOrGet(first, { workKey: "k1", reservesName: false });
      /* **An explicitly later timestamp, because `aJob()`'s is only accurate to
         the millisecond and the enqueue above can return inside one.** When the
         two share a `createdAt`, both stores break the tie on the id
         (`blockedByAnother`, src/store/jobs-fs.ts), and ids are random — so
         roughly half of all runs made `second` the predecessor, at which point
         `claim(first)` answers `busy: another job on this article is ahead of
         it`. That is the store being right and the fixture being wrong.

         Found by GPT Sol, 2026-09-03, reviewing this file. It is the second of
         the two causes of the flakiness behind
         docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md,
         and the only one that is not contention — so a private database would
         never have fixed it. */
      const second = aJob({
        slug: first.slug,
        createdAt: new Date(Date.parse(first.createdAt) + 1).toISOString(),
      });

      const queued = await store.enqueueOrGet(second, { workKey: "k2", reservesName: false });
      expect(queued.kind).toBe("created");
      expect(queued.job.id).toBe(second.id);
      expect(queued.job.status).toBe("queued");

      const held = mintAttempt();
      expectClaimed(await store.claim(first.id, OWNER, held, LEASE, CAP));

      /* The article is busy, and the reason has to say so. `busy` already means
         three different things to the client loop; a fourth that cannot be told
         apart in a log is how "waiting behind an ingest" and "the machine is at
         its cap" become one indistinguishable symptom. */
      const blocked = await store.claim(second.id, OWNER, mintAttempt(), LEASE, CAP);
      expect(blocked.kind).toBe("busy");
      expect(blocked.kind === "busy" && blocked.why).toMatch(/article/i);

      await store.releaseStep(first.id, held, first.steps, {});
    });

    /* ------------------------------------------- the line, and its order -- */

    /**
     * **Three jobs claim in the order they were asked for**, with the claims
     * **attempted in reverse**.
     *
     * The reverse is the whole point: claiming them in order would pass against
     * a `claim` that had no order rule at all, since each would simply be next.
     *
     * **And the timestamps are set a second apart, explicitly.** `createdAt` is
     * the application's millisecond clock, so three inserts in one loop can
     * share a millisecond and then order on a random id — and the test would be
     * asserting whatever the ids happened to do, passing or failing by luck.
     * GPT Sol, 2026-09-02, on a draft of this that used `aJob()`'s own `now`.
     */
    it("runs an article's jobs in the order they were asked for, whatever order they are claimed in", async () => {
      const slug = `${MINE}${mintId()}`;
      const base = Date.now();
      const line = [0, 1, 2].map((n) =>
        aJob({ slug, createdAt: new Date(base + n * 1000).toISOString() }),
      );
      for (const [n, job] of line.entries()) {
        const put = await store.enqueueOrGet(job, { workKey: `k${n}`, reservesName: false });
        expect(put.kind).toBe("created");
      }

      const pending = [...line];
      while (pending.length > 0) {
        const wanted = pending[0]!;
        let heldBy = "";
        /* Backwards, so the only thing that can produce the right answer is the
           rule rather than the order of asking. */
        for (const job of [...pending].reverse()) {
          const attempt = mintAttempt();
          const outcome = await store.claim(job.id, OWNER, attempt, LEASE, CAP);
          if (job.id === wanted.id) {
            expectClaimed(outcome, "the job at the head of its article's line");
            heldBy = attempt;
          } else {
            expect(outcome.kind).toBe("busy");
            expect(outcome.kind === "busy" && outcome.why).toMatch(/ahead of it/);
          }
        }
        /* Finished rather than released: a released job goes back to `queued`
           and is still at the head of its own line. */
        await store.finish(wanted.id, heldBy, { status: "done", steps: wanted.steps });
        pending.shift();
      }
    });

    /**
     * **Stop lands on a running predecessor, and the successor still waits.**
     *
     * This replaces a case that asserted the opposite — *"a cancelling
     * predecessor does not block its successor"* — against a `queued` row
     * carrying `cancelling`, which the cancellation API cannot produce and the
     * schema now forbids outright. It would have gone green while the real
     * running path stayed broken.
     *
     * The rule: Stop on a *running* job leaves it `running` with `cancelling`
     * set until its claimant releases, and `jobs_one_running_per_slug` still
     * covers that row — so skipping it would buy the successor a unique
     * violation rather than a claim. The successor unblocks when the
     * cancellation becomes **terminal**, not when Stop is pressed.
     */
    it("keeps a successor waiting while a stopped predecessor is still running", async () => {
      const slug = `${MINE}${mintId()}`;
      const base = Date.now();
      const first = aJob({ slug, createdAt: new Date(base).toISOString() });
      const second = aJob({ slug, createdAt: new Date(base + 1000).toISOString() });
      await store.enqueueOrGet(first, { workKey: "k1", reservesName: false });
      await store.enqueueOrGet(second, { workKey: "k2", reservesName: false });

      const held = mintAttempt();
      expectClaimed(await store.claim(first.id, OWNER, held, LEASE, CAP));

      const stopped = await store.requestCancel(first.id, OWNER);
      expect(stopped?.status).toBe("running");
      expect(stopped?.cancelling).toBe(true);

      const waiting = await store.claim(second.id, OWNER, mintAttempt(), LEASE, CAP);
      expect(waiting.kind).toBe("busy");
      expect(waiting.kind === "busy" && waiting.why).toMatch(/ahead of it/);

      /* The claimant lets go, which is where the cancellation actually lands —
         `releaseStep` settles a `cancelling` job as `cancelled` rather than
         requeueing it. */
      const settled = await store.releaseStep(first.id, held, first.steps, {});
      expect(settled.status).toBe("cancelled");

      expectClaimed(await store.claim(second.id, OWNER, mintAttempt(), LEASE, CAP));
    });

    /**
     * **A predecessor belonging to somebody else blocks too**, because the line
     * is the article's and `articles.slug` is global.
     *
     * An owner-scoped rule would let two people claim one article at once, and
     * what that corrupts is a directory and a revision chain neither of them
     * owns exclusively. The cost of getting this right — a queued row one owner
     * cannot see or stop, holding up another's line — is closed at *enqueue* by
     * the ownership check in `src/jobs.ts`, not here.
     */
    it("waits behind an older job on this article even when it belongs to somebody else", async () => {
      const slug = `${MINE}${mintId()}`;
      const base = Date.now();
      const theirs = aJob({ slug, ownerId: OWNER_B, createdAt: new Date(base).toISOString() });
      const mine = aJob({ slug, createdAt: new Date(base + 1000).toISOString() });
      await store.enqueueOrGet(theirs, { workKey: "k1", reservesName: false });
      await store.enqueueOrGet(mine, { workKey: "k2", reservesName: false });

      const blocked = await store.claim(mine.id, OWNER, mintAttempt(), LEASE, CAP);
      expect(blocked.kind).toBe("busy");
      expect(blocked.kind === "busy" && blocked.why).toMatch(/ahead of it/);
    });

    /**
     * **A job that commits *after* a newer one is already running still waits.**
     *
     * The interleaving the order rule alone cannot see, and the one that turned
     * a wait into a 500. Two requests land on one article; A gets the earlier
     * `createdAt` and its insert is still uncommitted when B — later, same slug
     * — commits and claims. A then commits and claims. Nothing on the slug is
     * *older* than A, so the predecessor read passes it, and its `UPDATE` walks
     * straight into `jobs_one_running_per_slug`: a `23505` where the contract
     * says `busy`, answered as 500 by the route and logged as a thrown pump.
     *
     * So `claim` refuses on **either** an older active row or any other
     * *running* row on the slug. The late commit is still deliberately not FIFO
     * — A does not get to displace a job that is already inside the article —
     * and it no longer uses a unique violation as control flow.
     *
     * **The order of the calls is the test.** The neighbouring cases insert
     * every row before anything claims, which cannot reach this: they only ever
     * ask a *newer* row to wait. Here the enqueue happens after the claim, which
     * is exactly what a late commit looks like to everything downstream of it.
     *
     * Watched red on 2026-09-02: Postgres threw
     * *"duplicate key value violates unique constraint jobs_one_running_per_slug"*,
     * and the filesystem store did something worse — it answered `claimed`, and
     * two jobs were running on one article at once.
     */
    it("waits behind a newer job that is already running, when its own row lands late", async () => {
      const slug = `${MINE}${mintId()}`;
      const base = Date.now();
      /* Older by a second, and inserted *second*. */
      const late = aJob({ slug, createdAt: new Date(base).toISOString() });
      const running = aJob({ slug, createdAt: new Date(base + 1000).toISOString() });

      await store.enqueueOrGet(running, { workKey: "k1", reservesName: false });
      const held = mintAttempt();
      expectClaimed(await store.claim(running.id, OWNER, held, LEASE, CAP));

      await store.enqueueOrGet(late, { workKey: "k2", reservesName: false });
      const blocked = await store.claim(late.id, OWNER, mintAttempt(), LEASE, CAP);
      expect(blocked.kind).toBe("busy");
      expect(blocked.kind === "busy" && blocked.why).toMatch(/article/i);
      /* And the running job is still the only one inside the article. */
      expect((await store.get(late.id, OWNER))?.status).toBe("queued");

      await store.releaseStep(running.id, held, running.steps, {});
    });

    /**
     * **A finished job is history and holds nothing up.** The predicate is
     * `status in ('queued','running')`, and the other direction — waiting on any
     * older row at all — is an article that can never be worked on twice.
     */
    it("does not wait behind a job on this article that is already over", async () => {
      const slug = `${MINE}${mintId()}`;
      const base = Date.now();
      const over = aJob({ slug, createdAt: new Date(base).toISOString() });
      const next = aJob({ slug, createdAt: new Date(base + 1000).toISOString() });
      await store.enqueueOrGet(over, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      await store.claim(over.id, OWNER, attempt, LEASE, CAP);
      await store.finish(over.id, attempt, { status: "done", steps: over.steps });

      await store.enqueueOrGet(next, { workKey: "k2", reservesName: false });
      expectClaimed(await store.claim(next.id, OWNER, mintAttempt(), LEASE, CAP));
    });

    /* ---------------------------------- reserving a name, and an address -- */

    /**
     * **A request that is merely naming an article reserves nothing**, which is
     * what lets a line exist at all.
     *
     * A re-ingest of a URL this owner already has an article for adopts that
     * slug rather than minting — so it does not reserve, and it queues behind
     * whatever that article is already doing instead of being turned away or
     * given a second name. `reserves_name` is *the slug was minted*, and this is
     * the half of that definition that the August draft — "the request carried a
     * URL" — got wrong.
     */
    it("queues behind an article's own work when the slug was adopted rather than minted", async () => {
      const first = aJob({ url: "https://example.test/paper" });
      await store.enqueueOrGet(first, {
        workKey: "k1",
        reservesName: true,
        urlKey: "example.test/paper",
      });

      const again = aJob({ slug: first.slug, url: "https://example.test/paper" });
      const queued = await store.enqueueOrGet(again, {
        workKey: "k2",
        reservesName: false,
        urlKey: "example.test/paper",
      });
      expect(queued.kind).toBe("created");
      expect(queued.job.slug).toBe(first.slug);
    });

    /**
     * **Two accounts cannot both be minting one name**, because `articles.slug`
     * is the URL contract and there is only one `/read/<slug>`.
     *
     * The de-duplication index is owner-scoped and this one is not, and that
     * asymmetry is deliberate: whose request it is decides de-duplication;
     * nothing about whose request it is decides who gets the name.
     */
    it("refuses a second reserver of one name, in any account", async () => {
      const first = aJob();
      await store.enqueueOrGet(first, { workKey: "k1", reservesName: true });

      const theirs = aJob({ slug: first.slug, ownerId: OWNER_B });
      const refused = await store.enqueueOrGet(theirs, { workKey: "k2", reservesName: true });
      expect(refused.kind).toBe("nameTaken");
      expect(refused.job.id).toBe(first.id);
    });

    /**
     * **And a job that stopped but has not finished still holds its name**,
     * where it no longer de-duplicates.
     *
     * The two predicates differ on purpose: a request that de-duplicated onto a
     * job the reader had just stopped would vanish into a job about to end,
     * while the name really is still spoken for — its claimant is inside it.
     * Both halves are asserted here, because getting either one to match the
     * other is a one-word change.
     */
    it("keeps a stopped job's name reserved while releasing its work key", async () => {
      const first = aJob();
      await store.enqueueOrGet(first, { workKey: "k1", reservesName: true });
      const held = mintAttempt();
      await store.claim(first.id, OWNER, held, LEASE, CAP);
      await store.requestCancel(first.id, OWNER);

      // The same work, which must NOT collapse onto a job that is about to end.
      const same = aJob({ slug: first.slug });
      expect(
        (await store.enqueueOrGet(same, { workKey: "k1", reservesName: false })).kind,
      ).toBe("created");

      // The same name, which is still taken.
      const named = aJob({ slug: first.slug });
      expect((await store.enqueueOrGet(named, { workKey: "k3", reservesName: true })).kind).toBe(
        "nameTaken",
      );

      await store.releaseStep(first.id, held, first.steps, {});
    });

    /**
     * **Two pastes of one URL at the same instant make one article.**
     *
     * This replaces *"two uploads called `paper.pdf` get two slugs"*, which
     * passes today and would pass if `reserves_name` were never persisted at
     * all: every minted slug ends in a random short id, so the two are separate
     * whatever the store does. The race that is real is the one where **the
     * slugs differ and the address does not** — both callers looked, both found
     * nothing, and every unique key contains the slug. `jobs_active_source` is
     * the only thing that catches it, and the loser adopts the winner's slug
     * rather than minting a second name.
     *
     * `Promise.all` rather than one call after the other, because a sequential
     * pair does not test a race — GPT Sol, 2026-09-02. On Postgres the two
     * inserts really are concurrent; the filesystem adapter decides between
     * `await ready()` and `index.set` with no `await` in between, which is its
     * whole claim.
     *
     * **This proves the index and not the repair**, and it was once advertised
     * as proving both. It calls `enqueueOrGet` with two preconstructed slugs and
     * looks at the two answers; it never calls `enqueue`, so the branch that
     * decides what the loser does *next* is not exercised here and this case
     * would stay green if that branch were deleted. GPT Sol, reviewing the built
     * stage 1, finding 3. The repair is
     * tests/one-article-for-one-address.test.ts.
     */
    it("makes one article out of two simultaneous requests for one address", async () => {
      const urlKey = `example.test/race-${mintId()}`;
      const a = aJob({ url: `https://${urlKey}` });
      const b = aJob({ url: `https://${urlKey}` });
      // Different slugs, exactly as two independent mints produce.
      expect(a.slug).not.toBe(b.slug);

      const [first, second] = await Promise.all([
        store.enqueueOrGet(a, { workKey: "k1", reservesName: true, urlKey }),
        store.enqueueOrGet(b, { workKey: "k1", reservesName: true, urlKey }),
      ]);

      const kinds = [first!.kind, second!.kind].sort();
      expect(kinds).toEqual(["created", "sourceTaken"]);
      /* The loser is pointed at the winner's article, not merely refused — that
         slug is what the caller adopts, and adopting the wrong one is how the
         reader gets two articles for one address anyway. */
      const won = first!.kind === "created" ? first! : second!;
      const lost = first!.kind === "created" ? second! : first!;
      expect(lost.job.slug).toBe(won.job.slug);
    });

    /**
     * **A request that carries no address is outside the source rule**, and two
     * of them are two articles.
     *
     * That is an upload: it has no URL to compare, so it always mints, and
     * `url_key` is null. A null is never equal to anything in a unique index, so
     * `jobs_active_source` ignores those rows — which is what Greg asked for:
     * *"if it was previously uploaded by a different user, then reuse the source
     * object, but add a new per-user article object"* (2026-08-26). Without it,
     * a `coalesce(url_key, '')` anywhere would quietly make every upload one
     * article, and the two here carry the same work key to prove that the
     * absence of an address is what decides rather than the key.
     */
    it("lets two reserving requests with no address at all both go through", async () => {
      const a = aJob();
      const b = aJob();
      expect((await store.enqueueOrGet(a, { workKey: "k1", reservesName: true })).kind).toBe(
        "created",
      );
      expect((await store.enqueueOrGet(b, { workKey: "k1", reservesName: true })).kind).toBe(
        "created",
      );
    });

    it("will not claim a job the reader has stopped, or one already over", async () => {
      /* Stop on a job somebody is **inside**. That is the only way to reach
         `stopping` since 2026-08-27: a *queued* job is cancelled outright by
         the same call, because nobody is there to notice a flag. */
      const stopping = aJob();
      await store.enqueueOrGet(stopping, { workKey: "k1", reservesName: false });
      const held = mintAttempt();
      await store.claim(stopping.id, OWNER, held, LEASE, CAP);
      await store.requestCancel(stopping.id, OWNER);
      // Otherwise the API key is spent on a job that has already been stopped —
      // one of the three cancellation windows step 12 named.
      expect((await store.claim(stopping.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe(
        "stopping",
      );
      /* Released before the second half, or it would hold the single running
         slot and the next job's claim would come back `busy` — a true answer to
         a different question, and it would look like this test failing. */
      await store.releaseStep(stopping.id, held, stopping.steps, {});

      const over = aJob();
      await store.enqueueOrGet(over, { workKey: "k2", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(over.id, OWNER, attempt, LEASE, CAP));
      await store.finish(over.id, attempt, { status: "done", steps: over.steps });
      expect((await store.claim(over.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("finished");
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
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));

      const done: JobStep[] = [{ ...job.steps[0]!, status: "done" }];
      const after = await store.releaseStep(job.id, attempt, done, { title: "A Paper" });
      expect(after.status).toBe("queued");
      expect(after.title).toBe("A Paper");
      expect(after.steps[0]?.status).toBe("done");

      // A different request, a different token, and it gets in.
      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
    });

    it("writes what the card says mid-step without letting go of the claim", async () => {
      /* The reader-facing half of the claim. A step is one request and a model
         call inside it takes tens of seconds; without this the poll in between
         shows the step still `pending` and the card says nothing is happening.
         So: the steps move, the status stays `running`, and the token stays
         put — a `queued` here would let a second request in mid-step. */
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));

      const running: JobStep[] = [{ ...job.steps[0]!, status: "running", detail: "12 KB" }];
      const after = await store.noteProgress(job.id, attempt, running);
      expect(after.status).toBe("running");
      expect(after.steps[0]?.status).toBe("running");
      expect(after.steps[0]?.detail).toBe("12 KB");

      // Still held: a second request must not get in behind a progress write.
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("busy");
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
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));

      await adapter.expire(job.id);
      expect(settledIds(await store.settleExpired())).toContain(job.id);
      await adapter.reattach(job.id, attempt);

      // id matches, attempt matches. Only `status = 'running'` refuses this.
      await expect(store.noteProgress(job.id, attempt, job.steps)).rejects.toBeInstanceOf(
        StaleAttemptError,
      );
    });

    /* **`activeForSlug` was tested here, and both are gone.**

       *"names the job holding a slug, and says nothing about a finished one"* —
       a question that can no longer have one answer, since an article holds a
       line. It had no production callers by the time it went, and inventing a
       second ambiguous singular lookup to replace an unused one would be adding
       the problem back. What replaced it is not a lookup at all: the name is
       held by `jobs_reserved_slug` and reported as `nameTaken`, which is
       asserted above. See src/store/jobs.ts. */
    /**
     * **The fence's third condition, tested on the state that needs it.**
     *
     * The first version of this failed a job with `settleExpired` and asserted the
     * old token was refused — and it **passed with `status = 'running'` removed
     * from the fence**, because `settleExpired` clears the token too, so the second
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
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));

      // Its lease runs out and the sweep fails it. The claimant does not know.
      await adapter.expire(job.id);
      expect(settledIds(await store.settleExpired())).toContain(job.id);
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
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const mine = mintAttempt();
      await store.claim(job.id, OWNER, mine, LEASE, CAP);
      await store.releaseStep(job.id, mine, job.steps, {});
      await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP);

      // The first claimant comes back late. It cannot write, and it learns that
      // rather than affecting zero rows and being told nothing.
      await expect(store.releaseStep(job.id, mine, job.steps, {})).rejects.toBeInstanceOf(
        StaleAttemptError,
      );
    });

    /**
     * **An expired lease revokes the claimant, on its own** — before Stop and
     * before the sweep, and whether or not either ever arrives.
     *
     * This is the invariant the whole design rests on: the claimant sets its
     * own deadline *inside* the lease and aborts itself (src/jobs.ts §
     * `LEASE_MS`), so a lapsed lease is supposed to mean *the process is gone*
     * rather than *the process might be slow*. Everything that acts on an
     * expired lease — `settleExpired`, `requestCancel`'s lapsed branch — is
     * only safe because of that.
     *
     * **And until 2026-09-01 nothing enforced it.** The fence checked `id`,
     * `attempt_id` and `status = 'running'` and said nothing about the lease,
     * so expiry revoked nothing: a claimant that woke up late could still
     * commit, as long as it reached the row before Stop or the sweep did. In
     * the ignored-abort path it could commit an `error`/INTERRUPTED ending,
     * which is a concurrent Stop reporting the wrong thing to the reader —
     * the exact class of bug the stage before this one existed to close.
     *
     * So: expire it, sweep **nothing**, and ask for all three writes.
     * GPT Sol, 2026-09-01, finding 1 on the built stage 2.
     */
    it("refuses every write from a claimant whose lease has run out, with nothing having swept it", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));

      await adapter.expire(job.id);
      /* **The row is untouched**, and that is what makes this a test of expiry
         rather than of settlement: still `running`, still carrying this
         claimant's own token. Every condition the old fence checked still
         holds. */
      expect((await store.get(job.id, OWNER))?.status).toBe("running");

      await expect(store.noteProgress(job.id, attempt, job.steps)).rejects.toBeInstanceOf(
        StaleAttemptError,
      );
      await expect(store.releaseStep(job.id, attempt, job.steps, {})).rejects.toBeInstanceOf(
        StaleAttemptError,
      );
      await expect(
        store.finish(job.id, attempt, { status: "error", steps: job.steps, error: "wrong" }),
      ).rejects.toBeInstanceOf(StaleAttemptError);

      /* And none of them moved the row a millimetre — a refusal that still
         wrote half of something would be the same failure wearing a throw. */
      const after = await store.get(job.id, OWNER);
      expect(after?.status).toBe("running");
      expect(after?.error).toBeUndefined();
      expect(after?.finishedAt).toBeUndefined();
    });

    it("fails a job whose lease ran out, and leaves a live one alone", async () => {
      const dead = aJob();
      await store.enqueueOrGet(dead, { workKey: "k1", reservesName: false });
      await store.claim(dead.id, OWNER, mintAttempt(), LEASE, CAP);
      await adapter.expire(dead.id);
      /* **The ids, not a count.** A sweep that returns `1` cannot say *which* job
         it failed, and this case is precisely about one job being swept while a
         live one is left alone — so naming the id is the assertion, and the
         count never was. */
      expect(await store.settleExpired()).toEqual([{ id: dead.id, status: "error" }]);
      const failed = await store.get(dead.id, OWNER);
      expect(failed?.status).toBe("error");
      /* `retry`, said rather than left to the absent-means-yes rule — both offer
         the button, and only one of them says why. An interrupted job really is
         worth another go, because `stepIsDone` derives what is finished from the
         artefacts, so a retry resumes rather than starting again. */
      expect(failed?.failureKind).toBe("retry");

      // The running slot is free again, which is the other half of why this runs.
      const alive = aJob();
      await store.enqueueOrGet(alive, { workKey: "k2", reservesName: false });
      await store.claim(alive.id, OWNER, mintAttempt(), LEASE, CAP);
      expect(await store.settleExpired()).toEqual([]);
      expect((await store.get(alive.id, OWNER))?.status).toBe("running");
    });

    /* ------------------------------------------ and it does not always end -- */

    /**
     * **A lapsed claim with budget left goes back to the queue on its own row.**
     *
     * The Postgres answer to `sweepStopped`, which has always made a dev-server
     * restart a *pause* rather than an abandoned ingest. Postgres had no
     * equivalent, so on the store we actually ship a deploy landing mid-ingest
     * ended the reader's job — and sent them to a Retry that, until 2026-09-03,
     * minted a new article and threw away every chunk they had paid for.
     *
     * **The same job id, and that is the assertion under all the others.** The
     * row keeps its slug, so it keeps its article, so it keeps the article's
     * checkpoints (src/store/checkpoints.ts). A new job could not.
     *
     * **The default is unchanged**, which is why every case around this one
     * passes no budget and still asserts an ending: a caller that has not asked
     * for a resumption gets exactly what it always got.
     */
    it("gives a lapsed claim another go on the same row, while it has budget", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      /* A step actually in flight, so the *steps* half of the transition is
         exercised rather than assumed. `aJob`'s step starts `pending`, and a
         requeue that left a `running` step behind would draw a spinner on a card
         that is waiting its turn. */
      await store.noteProgress(job.id, attempt, [
        { ...job.steps[0]!, status: "running", startedAt: new Date().toISOString() },
      ]);
      await adapter.expire(job.id);

      expect(await store.settleExpired(undefined, undefined, 2)).toEqual([
        { id: job.id, status: "queued" },
      ]);
      const back = await store.get(job.id, OWNER);
      expect(back?.status).toBe("queued");
      expect(back?.slug, "the requeue moved the job to a different article").toBe(job.slug);
      /* Nothing failed, so the record must not say anything did — and
         `failureKind` under a `queued` status is a Retry rule reading a state
         that is not an ending. */
      expect(back?.error).toBeUndefined();
      expect(back?.failureKind).toBeUndefined();
      expect(back?.finishedAt).toBeUndefined();
      expect(back?.steps[0]?.status, "a requeued job left a step spinning").toBe("pending");
      expect(back?.steps[0]?.error).toBeUndefined();

      /* And it is claimable again, which is the whole of what "back in the
         queue" has to mean. */
      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
    });

    /**
     * **And it stops.** Without a cap a job that overruns every lease requeues
     * for ever, buying model calls nobody is waiting for — which is the same
     * failure this whole area is about, wearing a different hat.
     *
     * A budget of one, so the case is two sweeps rather than four: the first is
     * the resumption, the second is the ending. `INTERRUPTED` and `retry`, so the
     * reader gets the button and the sentence — a new job with a fresh budget is
     * exactly what pressing it makes, which is the point of the human being the
     * outer loop.
     */
    it("stops giving a job that always overruns another go, rather than looping for ever", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
      await adapter.expire(job.id);
      expect(await store.settleExpired(undefined, undefined, 1)).toEqual([
        { id: job.id, status: "queued" },
      ]);

      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
      await adapter.expire(job.id);
      expect(await store.settleExpired(undefined, undefined, 1)).toEqual([
        { id: job.id, status: "error" },
      ]);
      const over = await store.get(job.id, OWNER);
      expect(over?.status).toBe("error");
      expect(over?.failureKind).toBe("retry");
      expect(over?.error).toBe(INTERRUPTED.message);
    });

    /**
     * **A reader who pressed Stop gets their stop, whatever the budget says.**
     *
     * Resuming what somebody stopped is the app not listening — the same rule
     * `settleExpired` already follows in choosing `cancelled` over `error` for
     * these rows, and the reason the requeue is excluded from them by predicate
     * rather than by luck.
     */
    it("never resumes a job the reader stopped, however much budget is left", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
      expect((await store.requestCancel(job.id, OWNER))?.cancelling).toBe(true);
      await adapter.expire(job.id);

      expect(await store.settleExpired(undefined, undefined, 3)).toEqual([
        { id: job.id, status: "cancelled" },
      ]);
      expect((await store.get(job.id, OWNER))?.status).toBe("cancelled");
    });

    /* --------------------------------- and a claimant can put a job down -- */

    /**
     * **A claimant that runs out of its own deadline *inside* a step hands the
     * job back rather than ending it** — the cooperative half of the pause, and
     * the difference between a reader pressing Retry and a reader watching the
     * next window start by itself.
     *
     * `settleExpired` above is the *lapsed* half: nobody came back. This one is
     * the claimant that is still here, has unwound cleanly, and is putting the
     * job down. Both write `queued` on the same row and both spend the same
     * counter — see `pauseForDeadline` in src/store/jobs.ts.
     *
     * **Watched red before it was believed**, against the stores as they were:
     * `store.pauseForDeadline is not a function`.
     */
    it("puts a claimant that ran out of its own time back in the queue, on its own row", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      /* A step actually in flight, so the *steps* half of the transition is
         exercised rather than assumed — a pause that left a `running` step
         behind would draw a spinner on a card that is waiting its turn. */
      await store.noteProgress(job.id, attempt, [
        { ...job.steps[0]!, status: "running", startedAt: new Date().toISOString() },
      ]);

      const paused = await store.pauseForDeadline(job.id, attempt, 2);
      expect(paused.kind).toBe("requeued");
      if (paused.kind !== "requeued") throw new Error("unreachable");
      expect(paused.job.status).toBe("queued");
      expect(paused.job.slug, "the pause moved the job to a different article").toBe(job.slug);
      /* **Which window it is on, on the record the reader is shown.** A card
         that cannot say which attempt this is looks stalled. */
      expect(paused.job.requeues).toBe(1);

      const back = await store.get(job.id, OWNER);
      expect(back?.status).toBe("queued");
      /* Nothing failed, so the record must not say anything did. */
      expect(back?.error).toBeUndefined();
      expect(back?.failureKind).toBeUndefined();
      expect(back?.finishedAt).toBeUndefined();
      expect(back?.steps[0]?.status, "a paused job left a step spinning").toBe("pending");
      expect(back?.steps[0]?.error).toBeUndefined();

      /* And it is claimable again, which is the whole of what "back in the
         queue" has to mean. */
      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
    });

    /**
     * **One counter, two ways of spending it.**
     *
     * `jobs.requeues` is shared between the lapsed-lease recovery and this one,
     * so three windows is three *in total* — a lapse followed by one cooperative
     * pause leaves only the third. Said here as a case rather than only in a
     * comment, because the two paths are in different files and a second counter
     * is exactly the shape somebody would add without noticing.
     */
    it("spends the same budget a lapsed lease spends, not a second one of its own", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });

      /* Window one: the claimant is deployed over and says nothing. */
      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
      await adapter.expire(job.id);
      expect(await store.settleExpired(undefined, undefined, 2)).toEqual([
        { id: job.id, status: "queued" },
      ]);

      /* Window two: the claimant is alive and runs out of its own deadline. */
      const second = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, second, LEASE, CAP));
      expect((await store.pauseForDeadline(job.id, second, 2)).kind).toBe("requeued");

      /* Window three is the last one, and nothing is left after it. */
      const third = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, third, LEASE, CAP));
      const spent = await store.pauseForDeadline(job.id, third, 2);
      expect(spent.kind, "a third pause bought a fourth window").toBe("budget-spent");
      /* **And the row did not move**, which is what lets the claimant end the
         job properly through its own session — the draft failed, the pointer
         cleared, the ending recorded — rather than this statement doing half of
         it. */
      expect((await store.get(job.id, OWNER))?.status).toBe("running");
    });

    /**
     * **Cancellation wins.**
     *
     * A reader pressed Stop while the step was running, and the claimant then
     * reached its own deadline. Resuming what they stopped is the app not
     * listening — and falling through to the interrupted ending would be worse
     * still, because `finishIn` clears `cancelling` and keeps whatever ending it
     * was handed, so a job the reader chose to stop would end `error` with a
     * Retry button on it. ⟨GPT Sol, finding 3 on the plan⟩
     */
    it("tells a claimant that the reader stopped the job, rather than giving it another window", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      expect((await store.requestCancel(job.id, OWNER))?.cancelling).toBe(true);

      const paused = await store.pauseForDeadline(job.id, attempt, 3);
      expect(paused.kind, "a stopped job was handed another window").toBe("cancelled");
      /* Still running, still ours, still carrying the flag — so the claimant's
         own settlement is what ends it, as a cancellation. */
      const still = await store.get(job.id, OWNER);
      expect(still?.status).toBe("running");
      expect(still?.cancelling).toBe(true);
    });

    /**
     * **A pause and a Stop that land together may not disagree about what
     * happened** — the outcome and the record it carries are one answer.
     *
     * ⟨GPT Sol, reviewing the built stage 3, finding 3, CONFIRMED⟩ It ran the
     * two concurrently against the filesystem adapter and got
     * `{"pauseKind":"requeued","pauseStatus":"cancelled","current":"cancelled"}`
     * — a `requeued` outcome carrying a job that had already ended. The
     * discriminated union `pauseForDeadline` returns is then false at runtime,
     * and src/jobs.ts answers the reader `done: false` about a terminal job.
     *
     * The cause is that the adapter mutates the record every caller shares,
     * yields while persisting it, and clones it **after** the yield — so the
     * value it hands back is whatever the *next* transition left behind rather
     * than the one it made. Postgres cannot produce it: the transition is one
     * locked transaction and `returning` reads the row it wrote.
     *
     * The assertion is deliberately about **agreement rather than about which
     * of the two won**. Either order is legitimate: a pause that commits first
     * leaves a `queued` job for the Stop to cancel, and a Stop that lands first
     * makes the pause answer `cancelled`. What is never legitimate is an
     * outcome whose own `job` contradicts it.
     */
    it("never answers `requeued` with a job that is not queued", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));

      /* Started in the same turn, so the pause is mid-transition when the Stop
         arrives. Sequential calls cannot reach this state and the existing Stop
         case above is sequential, which is why it stayed green. */
      const [paused] = await Promise.all([
        store.pauseForDeadline(job.id, attempt, 2),
        store.requestCancel(job.id, OWNER),
      ]);

      if (paused.kind === "requeued") {
        expect(
          paused.job.status,
          "a `requeued` outcome came back carrying a job that is not queued",
        ).toBe("queued");
        expect(
          paused.job.cancelling ?? false,
          "a `requeued` outcome came back carrying a job that is being stopped",
        ).toBe(false);
        expect(paused.job.finishedAt, "a `requeued` job has not finished").toBeUndefined();
      } else {
        /* The other legitimate order, and the only other one: the Stop was on
           the row before the pause classified it. */
        expect(paused.kind, "a pause racing a Stop answered something else").toBe("cancelled");
      }

      /* However it resolved, the reader who pressed Stop gets their stop —
         either from `requestCancel` itself or from the claimant that was told
         `cancelled`. Read afterwards so this says what the store settled on
         rather than what either call believed. */
      const current = (await store.get(job.id, OWNER))?.status;
      expect(["cancelled", "running", "queued"]).toContain(current);
    });

    /**
     * **An unwind that crossed the lease is not a pause, it is a lost claim.**
     *
     * The claimant aborts at `LEASE_MS - DEADLINE_MARGIN_MS` and has that margin
     * to unwind in; a step that takes longer than the margin to come apart
     * arrives here with nothing left to write with. Zero rows moved would look
     * exactly like a spent budget, which is why the outcome is discriminated
     * rather than counted.
     */
    it("refuses a claimant whose lease ran out while it was unwinding", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      await adapter.expire(job.id);

      expect((await store.pauseForDeadline(job.id, attempt, 3)).kind).toBe("stale");
      /* And nothing moved: a refusal that still wrote half of something would be
         the same failure wearing a different word. */
      expect((await store.get(job.id, OWNER))?.status).toBe("running");
    });

    /**
     * **And a claimant whose job somebody else now holds gets the same answer**
     * — a second job, with its lease still live, so what refuses it is the token
     * rather than an expiry it could have been refused for anyway.
     */
    it("refuses a pause from a claimant whose job somebody else now holds", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      await adapter.reattach(job.id, mintAttempt());

      expect((await store.pauseForDeadline(job.id, attempt, 3)).kind).toBe("stale");
      expect((await store.get(job.id, OWNER))?.status).toBe("running");
    });

    /**
     * **The sweep, scoped to one person, because `listJobs` calls it.**
     *
     * Stage 3 of docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md:
     * on Vercel there is no cron and no worker, so the only caller of
     * `settleExpired` was the top of `/api/jobs/:id/advance` — an endpoint that
     * fires only when somebody is *already* driving a job. The reader who comes
     * back to a dead claimant is exactly the person that sweep cannot reach, so
     * the list path calls it too. And the list path is a reader's request, so
     * what it settles has to be that reader's and nobody else's.
     *
     * **The owner is a filter on the same method**, not a sibling, so this file
     * goes on holding both adapters to one contract — Sol approved that shape
     * and asked for this case by name, 2026-09-01, answer 7.
     *
     * **Both people have an expired job**, which is the half that matters: an
     * owner with nothing of their own could only prove that *nothing* was
     * settled, and an argument that is accepted and then dropped passes that.
     * With two, an unscoped sweep settles the wrong row and this goes red.
     */
    it("settles this owner's expired job, and cannot reach anybody else's", async () => {
      const mine = aJob();
      const theirs = aJob({ ownerId: OWNER_B });
      await store.enqueueOrGet(mine, { workKey: "k1", reservesName: false });
      await store.enqueueOrGet(theirs, { workKey: "k2", reservesName: false });
      expectClaimed(await store.claim(mine.id, OWNER, mintAttempt(), LEASE, CAP));
      expectClaimed(await store.claim(theirs.id, OWNER_B, mintAttempt(), LEASE, CAP));
      await adapter.expire(mine.id);
      await adapter.expire(theirs.id);

      /* Exactly one settlement, not merely "contains mine": the failure this
         guards against is a sweep that took the lot and happened to include the
         right one. The owner is fresh every run, so nothing else can be in it. */
      expect(await store.settleExpired(undefined, OWNER)).toEqual([
        { id: mine.id, status: "error" },
      ]);
      expect((await store.get(mine.id, OWNER))?.status).toBe("error");

      /* Untouched, and said field by field — a sweep that ended the job but
         reported nothing would pass the line above. */
      const untouched = await store.get(theirs.id, OWNER_B);
      expect(untouched?.status).toBe("running");
      expect(untouched?.error).toBeUndefined();
      expect(untouched?.finishedAt).toBeUndefined();

      /* And it is settleable — by the person whose job it is. Without this the
         case would also pass for a sweep that had simply stopped working. */
      expect(await store.settleExpired(undefined, OWNER_B)).toEqual([
        { id: theirs.id, status: "error" },
      ]);
    });

    /**
     * **Stop, and then the claimant walks away.**
     *
     * The sweep used to settle *every* lapsed claim as `error` / `INTERRUPTED`,
     * including a row already carrying `cancelling` — so a reader who pressed
     * Stop was told, twelve minutes later, that their import had been
     * interrupted. It was the odd one out: `releaseStepIn` settles a live
     * claimant's release on a `cancelling` job as cancelled, and `sweepStopped`
     * does the same on restart. This makes three mechanisms agree.
     */
    it("settles a stopped job as cancelled, rather than telling the reader they were interrupted", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));

      /* Stop while the claim is still live: the flag goes on and the claimant
         is asked, which is the right answer at that moment. */
      expect((await store.requestCancel(job.id, OWNER))?.cancelling).toBe(true);
      // And then it never comes back.
      await adapter.expire(job.id);

      expect(await store.settleExpired()).toContainEqual({ id: job.id, status: "cancelled" });
      const settled = await store.get(job.id, OWNER);
      expect(settled?.status).toBe("cancelled");
      expect(settled?.cancelling).toBeFalsy();
      /* **No sentence and no kind.** Nothing failed — the reader stopped it —
         and a job that failed a step, was retried and is then stopped would
         otherwise carry the old sentence under a `cancelled` status. */
      expect(settled?.error).toBeUndefined();
      expect(settled?.failureKind).toBeUndefined();
    });

    /**
     * **Stop on a claimant that is provably gone is over, right now.**
     *
     * The claimant sets its own deadline *inside* the lease and aborts itself
     * (src/jobs.ts § `LEASE_MS`), so a lapsed lease says the process is gone
     * rather than slow. Writing `cancelling` and waiting there is waiting for
     * somebody who cannot arrive: the card showed a disabled "Stopping…" for up
     * to 12.67 minutes and then reported the wrong reason.
     *
     * There is deliberately no force-stop *before* the lease lapses — a live
     * claim may genuinely be working, and clearing it is how two writers get one
     * article.
     */
    it("stops a job whose claimant is provably gone in one statement, rather than waiting out a lease nobody holds", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      expectClaimed(await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP));
      await adapter.expire(job.id);

      const stopped = await store.requestCancel(job.id, OWNER);
      expect(stopped?.status).toBe("cancelled");
      expect(stopped?.cancelling).toBeFalsy();
      expect(stopped?.finishedAt).toBeTruthy();

      /* Really over: nothing is left for the sweep to find, and no later claim
         gets in — which is what separates this from writing the flag. */
      expect(settledIds(await store.settleExpired())).not.toContain(job.id);
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("finished");
    });

    /**
     * **A job that is over must not still be showing a spinner — and the two
     * endings do not settle the step the same way.**
     *
     * Both expiry paths end a job nobody is inside, so if the statement that
     * ends it does not settle the step that was running, nothing ever will:
     * `StepRow` draws `LoaderCircle` for a `running` step regardless of what the
     * job says.
     *
     * **Cancelled goes to `pending`, interrupted goes to `error`.** That
     * distinction is finding 2 of GPT Sol's review of stage 2, and the argument
     * for it is about the built card rather than about tidiness: `JobCard`
     * (src/web/AddArticle.tsx) renders `step.error` and the shared poll error,
     * and **never `job.error`**. Settling both endings to `pending` — which is
     * what stage 2 shipped — left an interrupted job showing one muted step and
     * a Retry button with no explanation on the card at all. A reader who
     * pressed Stop has an explanation already: they are the one who pressed it.
     *
     * `tests/interrupted-job-card.test.tsx` is the other half of this, because
     * a store assertion is not evidence that a person can see anything.
     */
    it("settles the step that was running, and says why only when nobody asked", async () => {
      /** Claim it and leave one step visibly running, as any long step does. */
      async function midStep(job: Job, key: string): Promise<string> {
        await store.enqueueOrGet(job, { workKey: key, reservesName: false });
        const attempt = mintAttempt();
        expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
        const startedAt = new Date().toISOString();
        await store.noteProgress(job.id, attempt, [
          { ...job.steps[0]!, status: "running", startedAt },
        ]);
        await adapter.expire(job.id);
        return startedAt;
      }

      const swept = aJob();
      const startedAt = await midStep(swept, "k1");
      await store.settleExpired();
      const afterSweep = await store.get(swept.id, OWNER);
      expect(afterSweep?.status).toBe("error");
      expect(afterSweep?.steps.map((step) => step.status)).toEqual(["error"]);
      /* The sentence the reader gets, on the row that draws it. Without this
         the card is a muted line and a Retry button and nothing else. */
      expect(afterSweep?.steps[0]?.error).toBe(INTERRUPTED.message);
      /* A step that ended has a `finishedAt`, exactly as one that threw does —
         and it keeps the `startedAt` it really had, because it really did run. */
      expect(afterSweep?.steps[0]?.finishedAt).toBeTruthy();
      expect(afterSweep?.steps[0]?.startedAt).toBe(startedAt);
      /* And the job repeats it, which is what src/types.ts says `job.error` is
         for — the failure of the step that raised it. */
      expect(afterSweep?.error).toBe(INTERRUPTED.message);

      const stopped = aJob();
      await midStep(stopped, "k2");
      const cancelled = await store.requestCancel(stopped.id, OWNER);
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.steps.map((step) => step.status)).toEqual(["pending"]);
      expect(cancelled?.steps[0]?.startedAt).toBeUndefined();
      /* **Nothing failed.** A sentence here would be the app telling a reader
         who pressed Stop that something went wrong. */
      expect(cancelled?.steps[0]?.error).toBeUndefined();
      expect(cancelled?.error).toBeUndefined();
    });

    /**
     * **Everything that was not running is left exactly as it was.**
     *
     * The settlement rewrites the `steps` array whole — one `jsonb_agg` over
     * every element in Postgres, a loop over every step on the filesystem — so
     * "it only touches the running one" is a claim about a statement that
     * rebuilds all of them. The single-step fixture every other case here uses
     * cannot tell the difference: with one step, "rewrote the right one" and
     * "rewrote all of them" are the same array.
     *
     * So this one carries a done step with a detail and a stamp, a running one,
     * a pending one and a skipped one, and asserts the three bystanders come
     * back **deep-equal to what went in**. GPT Sol asked for it by name,
     * 2026-09-01.
     *
     * **What it does not pin is the ordering.** The `order by step.ordinality`
     * inside `jsonb_agg` was deleted as a mutation and this case stayed green:
     * Postgres happens to aggregate that plan in input order, so the clause is
     * insurance against a plan change rather than something a test can watch
     * fail. Said out loud rather than implied by an assertion that never had
     * teeth.
     */
    it("leaves every step that was not running exactly as it found it", async () => {
      const startedAt = "2026-09-01T00:00:00.000Z";
      const mixed: JobStep[] = [
        {
          name: "fetch",
          label: "Fetching the page",
          status: "done",
          detail: "12 KB",
          startedAt,
          finishedAt: "2026-09-01T00:00:01.000Z",
        },
        { name: "extract", label: "Reading the article", status: "running", startedAt },
        { name: "blocks", label: "Splitting it up", status: "pending" },
        { name: "hierarchy", label: "Building the hierarchy", status: "skipped" },
      ];
      const bystanders = [mixed[0], mixed[2], mixed[3]].map((step) => structuredClone(step));

      const job = aJob({ steps: structuredClone(mixed) });
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      await store.noteProgress(job.id, attempt, structuredClone(mixed));
      await adapter.expire(job.id);

      expect(settledIds(await store.settleExpired())).toContain(job.id);
      const after = await store.get(job.id, OWNER);
      expect(after?.steps.map((step) => step.name)).toEqual([
        "fetch",
        "extract",
        "blocks",
        "hierarchy",
      ]);
      expect([after?.steps[0], after?.steps[2], after?.steps[3]]).toEqual(bystanders);
      expect(after?.steps[1]?.status).toBe("error");
    });

    it("cancels a queued job outright, and only asks a running one — in one call", async () => {
      const queued = aJob();
      await store.enqueueOrGet(queued, { workKey: "k1", reservesName: false });
      /* Nobody is inside a queued job, so there is no `cancelling` flag for
         anyone to notice — p-queue's own callback used to clear it and Postgres
         provides no such callback. It has to be terminal here or never. */
      const stopped = await store.requestCancel(queued.id, OWNER);
      expect(stopped?.status).toBe("cancelled");
      expect(stopped?.cancelling).toBeFalsy();

      const running = aJob();
      await store.enqueueOrGet(running, { workKey: "k2", reservesName: false });
      await store.claim(running.id, OWNER, mintAttempt(), LEASE, CAP);
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
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));

      // Somebody else presses Stop. This claimant knows nothing about it.
      await store.requestCancel(job.id, OWNER);

      // Its step succeeds and it releases, as it would on any ordinary step.
      const after = await store.releaseStep(job.id, attempt, job.steps, {});
      expect(after.status).toBe("cancelled");
      expect(after.cancelling).toBeFalsy();
      expect(after.finishedAt).toBeTruthy();

      // And it is really over, rather than answering `stopping` for ever.
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("finished");
    });

    /**
     * **The lease had a deadline and nothing enforced it.**
     *
     * `settleExpired` was written with the store and had no production caller at
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
      await store.enqueueOrGet(dead, { workKey: "k1", reservesName: false });
      expectClaimed(await store.claim(dead.id, OWNER, mintAttempt(), LEASE, CAP));

      const waiting = aJob();
      await store.enqueueOrGet(waiting, { workKey: "k2", reservesName: false });
      /* Blocked, correctly, while the first job is genuinely running — and
         **at `maxRunning: 1`**, because that is the only thing that makes the
         dead claimant's slot *the* slot. Under the suite's ordinary `CAP` there
         are spare slots, this claim would succeed, and the test would stop being
         about a lease expiring at all. */
      expect((await store.claim(waiting.id, OWNER, mintAttempt(), LEASE, 1)).kind).toBe("busy");

      await adapter.expire(dead.id);
      expect(settledIds(await store.settleExpired())).toContain(dead.id);

      const after = await store.get(dead.id, OWNER);
      expect(after?.status).toBe("error");
      // Failed rather than taken over, and offering Retry rather than a dead end.
      expect(after?.failureKind).toBe("retry");
      // Same cap, so the sweep is what changed and not the arithmetic.
      expectClaimed(await store.claim(waiting.id, OWNER, mintAttempt(), LEASE, 1));
    });

    it("refuses to forget a job that is still going", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, { workKey: "k1", reservesName: false });
      expect(await store.forget(job.id, OWNER)).toBe(false);
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      await store.finish(job.id, attempt, { status: "done", steps: job.steps });
      expect(await store.forget(job.id, OWNER)).toBe(true);
      expect(await store.get(job.id, OWNER)).toBeUndefined();
    });

    /* ------------------------------------------------------------ retention --

       **The only cases here whose scope is the whole owner**, which is why
       the file has an owner nobody else uses — see the head of it. `keep` is a
       plain number in all of them, and it can be, because every finished job
       this owner has is one of these lines. Written against a shared owner they
       would have to count first, and then they would be asserting arithmetic
       against whatever else happened to be in the database that morning. */

    /**
     * Queue it, claim it, end it. The three lines every case below repeats.
     *
     * **The claim is asserted, not assumed.** It used to be called for its
     * effect and its outcome dropped on the floor — so when it came back `busy`
     * the next line failed instead, as `StaleAttemptError: no longer held by
     * this attempt`, which describes a fence bug and is not what happened. On a
     * box where several worktrees share one local Postgres that is a real
     * event: `claim` refuses on the `queue_state` singleton if any other
     * claimant is mid-decision, and on a concurrency cap counted across the
     * *whole* `jobs` table, neither of which this suite's private owner keeps
     * anybody out of. `expectClaimed` is the rest of the file's answer to
     * exactly that and says which reason it was — docs/reusable/silent-success.md,
     * in its reporting form. It does not retry, on purpose.
     */
    async function endJob(job: Job, key: string, ending: "done" | "error"): Promise<void> {
      await store.enqueueOrGet(job, { workKey: key, reservesName: false });
      const attempt = mintAttempt();
      expectClaimed(await store.claim(job.id, OWNER, attempt, LEASE, CAP));
      await store.finish(job.id, attempt, {
        status: ending,
        steps: job.steps,
        ...(ending === "error" ? { error: "went wrong" } : {}),
      });
    }

    it("keeps the newest finished jobs and drops successes before failures", async () => {
      /* Retention is on the contract rather than left to a caller because a
         store that grows without limit is not a detail: `list` reads all of
         them, and it is what the homepage polls. */
      const ended: Job[] = [];
      for (let i = 0; i < 4; i++) {
        const job = aJob({ createdAt: new Date(Date.now() - (4 - i) * 60_000).toISOString() });
        // The oldest one failed; the rest succeeded.
        await endJob(job, `k${i}`, i === 0 ? "error" : "done");
        ended.push(job);
      }

      expect(await store.trimFinished(OWNER, 2)).toBe(2);
      const left = (await store.list(OWNER)).map((j) => j.id);
      // The failure survives even though it is the oldest — a reader who loses a
      // failure loses the only account of what went wrong.
      expect(left).toContain(ended[0]!.id);
      expect(left).toContain(ended[3]!.id);
      expect(left).not.toContain(ended[1]!.id);
      expect(left).not.toContain(ended[2]!.id);
    });

    /**
     * **A success survives a history that is already nothing but failures.**
     *
     * The case the old rule could not pass, and the reason the rule changed:
     * the preference for failures was absolute, so once an owner held
     * `KEEP_FINISHED` of them every success was past the offset the moment it
     * was written — deleted by the very `trimFinished` its own ending ran
     * (src/jobs.ts § `noteEnded`). The client learns a job finished by polling
     * for a terminal row, so no completion was ever announced, for any mode.
     * docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md.
     *
     * **Three and one, not fifty and one.** The first draft of this used fifty
     * to match `KEEP_FINISHED`, arguing the bug is about a full boundary. That
     * was wrong: `keep` is an argument, so the boundary is wherever the caller
     * puts it, and three failures against `keep` 3 is the identical shape.
     * Fifty bought nothing and cost a second per adapter and a hundred rows a
     * run in a local database every worktree on this box shares — which is a
     * complaint the postmortem above makes about this very suite.
     *
     * Watched red first: both adapters deleted the success and kept every
     * failure.
     */
    it("keeps a success that ends into a history already full of failures", async () => {
      const failures: Job[] = [];
      for (let i = 0; i < 3; i++) {
        const job = aJob({ createdAt: new Date(Date.now() - (60 - i) * 60_000).toISOString() });
        await endJob(job, `full${i}`, "error");
        failures.push(job);
      }
      const success = aJob({ createdAt: new Date().toISOString() });
      await endJob(success, "fullDone", "done");

      /* One over the line, so exactly one row goes and there is no ambiguity
         about which side it came off. */
      expect(await store.trimFinished(OWNER, 3)).toBe(1);
      const left = (await store.list(OWNER)).map((j) => j.id);
      expect(left).toContain(success.id);
      // The slot came off the back of the failures, not the front: the one that
      // finished longest ago is the one nobody needs any more.
      expect(left).not.toContain(failures[0]!.id);
      expect(left).toContain(failures[2]!.id);
    });

    /**
     * **The clock is when a job finished, not when it was queued.**
     *
     * Jobs run several at a time (src/jobs.ts § `DEFAULT_JOB_CONCURRENCY`) and
     * take wildly different times, so a job queued first routinely ends last.
     * Ranked by `createdAt` such a job sits well down its kind and can be swept
     * by its own ending — which is the bug, with the failure preference taken
     * out of it.
     *
     * **Written to this exact shape on purpose.** A vaguer version — three
     * successes ended in creation order — is kept identically by both rules and
     * proves nothing. Here the two rules disagree about every slot: by creation
     * the survivors are B and C, by finish they are A and C.
     *
     * The instants are stamped rather than taken from the clock. Real time would
     * make the green result depend on three `finish` calls landing in three
     * different milliseconds — flaky rather than wrong, which is worse.
     *
     * Watched red first: both adapters kept B and C and deleted A.
     */
    it("keeps the job that finished last, however early it was queued", async () => {
      const base = Date.parse("2026-09-03T09:00:00.000Z");
      const at = (minutes: number): string => new Date(base + minutes * 60_000).toISOString();
      // Queued a minute apart, so the old rule has a definite answer to be wrong
      // with rather than a tie.
      const a = aJob({ createdAt: at(0) });
      const b = aJob({ createdAt: at(1) });
      const c = aJob({ createdAt: at(2) });
      for (const [i, job] of [a, b, c].entries()) await endJob(job, `late${i}`, "done");
      // A was queued first and ended last — the slow one.
      await adapter.stampFinished(b.id, at(10));
      await adapter.stampFinished(c.id, at(11));
      await adapter.stampFinished(a.id, at(12));

      expect(await store.trimFinished(OWNER, 2)).toBe(1);
      const left = (await store.list(OWNER)).map((j) => j.id);
      expect(left).toContain(a.id);
      expect(left).toContain(c.id);
      expect(left).not.toContain(b.id);
    });

    it("breaks a tie in the timestamps by id rather than by luck", async () => {
      /**
       * **The part that drifts silently.** Neither timestamp is a total order —
       * two jobs queued in the same millisecond are common enough, and since
       * 2026-09-03 the first key is `finishedAt`, which two endings inside one
       * request can share just as easily. With no tie-break the two adapters
       * answer from different accidents: Postgres from whatever order the
       * planner returned, the filesystem store from the insertion order of a
       * `Map`. Both look right until the day they disagree about which record
       * still exists.
       *
       * So the rule is written down here: **both timestamps tied, lowest id
       * goes.**
       *
       * **The fixture changed with the clock, and it had to.** It used to tie
       * only `createdAt` and end the three in the opposite order to their ids —
       * which under a `finishedAt` key is not a tie at all, so the case would
       * have passed without the tie-break existing: a green tick for a rule
       * nobody had implemented, the exact hazard this comment is about. So
       * `finishedAt` is now stamped to one instant for all three through the
       * `Adapter` seam, which is the only way to say it — every terminal
       * transition reads the clock for itself.
       *
       * **And they are ended in the same order as their ids**, which is what
       * gives it teeth now: an implementation with no tie-break keeps whichever
       * two it was handed first, `aaa` and `aab` — the opposite of the answer
       * below.
       *
       * The ids are built rather than minted, and differ only in a trailing
       * letter, because `id` is compared by Postgres under the database's
       * collation and by this test in JavaScript — and those two agree about
       * `a < b < c` under every collation, which is not true of every pair of
       * random ids. The stem is still random, so a killed run cannot collide
       * with the next one.
       */
      const stem = mintId().slice(0, ID_PREFIX.length + 3);
      const stamp = new Date().toISOString();
      const tied = ["aaa", "aab", "aac"].map((tail) =>
        aJob({ id: `${stem}${tail}`, createdAt: stamp }),
      );
      for (const [i, job] of tied.entries()) await endJob(job, `tie${i}`, "done");
      for (const job of tied) await adapter.stampFinished(job.id, stamp);

      expect(await store.trimFinished(OWNER, 2)).toBe(1);
      const left = (await store.list(OWNER)).map((j) => j.id);
      expect(left).not.toContain(tied[0]!.id);
      expect(left).toContain(tied[1]!.id);
      expect(left).toContain(tied[2]!.id);
    });
  });
}

/**
 * **The lease is the database's arithmetic, end to end** — Postgres only,
 * because on the filesystem adapter the store's clock and the application's are
 * the same clock and there is nothing to disagree.
 *
 * The lease says whether a claimant may still write, and it is written by one
 * instance and read by another. Until 2026-09-01 both ends used `Date.now()`,
 * which is fine on a laptop and is two clocks the moment Vercel is talking to
 * Supabase: an instance running fast writes a deadline the sweep will not act
 * on for as long as the skew, and one running slow has its live claim swept out
 * from under it.
 *
 * **The skew is what makes this a test rather than a tautology.** Every
 * assertion below is true of the old code on a machine whose clocks agree, so
 * the case moves the *application's* clock an hour forward and leaves the
 * database's alone. Only `Date` is faked — timers stay real, or the pool's own
 * work would never resolve.
 */
describe("Postgres, on the database's clock", () => {
  const made: string[] = [];
  afterEach(async () => {
    const ids = made.splice(0);
    if (ids.length > 0) await getDb().delete(jobs).where(inArray(jobs.id, ids));
  });

  /** Run `body` with this process believing it is `skewMs` later than it is. */
  async function skewed<T>(skewMs: number, body: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + skewMs });
    try {
      return await body();
    } finally {
      vi.useRealTimers();
    }
  }

  const STEPS: JobStep[] = [{ name: "fetch", label: "Fetching the page", status: "pending" }];

  /** One queued job of this suite's own, cleaned up by the `afterEach` above. */
  async function queued(): Promise<string> {
    const id = mintId();
    made.push(id);
    await pgJobStore.enqueueOrGet(
      {
        id,
        ownerId: OWNER,
        slug: `${MINE}${id}`,
        steps: structuredClone(STEPS),
        status: "queued",
        createdAt: new Date().toISOString(),
      },
      { workKey: `clock-${id}`, reservesName: false },
    );
    return id;
  }

  /**
   * **A primary-key collision is not a queue conflict, and the retry cannot
   * clear it.**
   *
   * `on conflict do nothing` catches *every* unique index on `jobs`, `jobs_pkey`
   * included. The re-read that follows classifies only the three queue
   * predicates — same work, same name, same address — so a row that merely
   * happens to hold this job's minted id classifies as nothing, `enqueueOrGet`
   * reads that as *the holder finished between the two statements*, and tries
   * the same id four more times before giving up with a sentence about the slug.
   * The slug is not the problem and nothing about it can become true.
   *
   * Astronomically unlikely — the id is `spya-` plus six random base36
   * characters — and exactly the conflict a retry cannot repair, which is why it
   * has to be said out loud rather than left to the loop. GPT Sol, reviewing the
   * built stage 1, finding 7.
   *
   * **It carries a `status`, which is what makes it visible at all.** Every
   * error out of this store goes through `guardDbStore`, which replaces the
   * message of anything that is not on its allowlist — so the old sentence
   * reached nobody, and neither would a better one. Door 1 in
   * src/store/db-errors.ts is the way through: a job id is `spya-` and six
   * characters we minted, which is the test that file sets for a message that
   * may cross the boundary.
   *
   * Watched red on 2026-09-02: the rejection was the scrubbed *"This app asked
   * its database for something it would not do…"*, with the id nowhere in it.
   */
  it("says which id is taken when the conflict is the primary key, rather than blaming the slug", async () => {
    const id = await queued();
    const clash: Job = {
      id,
      ownerId: OWNER,
      /* A different article and a different piece of work, so none of the three
         queue classifiers can answer — the only thing in the way is the id. */
      slug: `${MINE}${mintId()}`,
      steps: structuredClone(STEPS),
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await expect(
      pgJobStore.enqueueOrGet(clash, { workKey: `pk-${id}`, reservesName: false }),
    ).rejects.toThrow(new RegExp(`${id}.*already`));
  });

  it("dates the lease and the ending from the database, not from whatever this instance thinks the time is", async () => {
    const id = mintId();
    made.push(id);
    const job: Job = {
      id,
      ownerId: OWNER,
      slug: `${MINE}${id}`,
      steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }],
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    await pgJobStore.enqueueOrGet(job, { workKey: "clock", reservesName: false });

    const attempt = mintAttempt();
    const HOUR = 60 * 60_000;
    await skewed(HOUR, async () => {
      expectClaimed(await pgJobStore.claim(id, OWNER, attempt, LEASE, CAP));
    });

    const [claimed] = await getDb()
      .select({ lease: jobs.leaseExpiresAt })
      .from(jobs)
      .where(eq(jobs.id, id));
    /* An hour-fast instance writing `Date.now() + LEASE` puts the deadline an
       hour and a minute out, and the sweep would leave a dead claimant holding
       the article for that whole hour. */
    expect(claimed?.lease).toBeTruthy();
    expect(claimed!.lease!.getTime() - Date.now()).toBeLessThan(LEASE + 30_000);

    await skewed(HOUR, async () => {
      await pgJobStore.finish(id, attempt, { status: "done", steps: job.steps });
    });
    const [ended] = await getDb()
      .select({ finishedAt: jobs.finishedAt })
      .from(jobs)
      .where(eq(jobs.id, id));
    /* The same for the ending. A job stamped an hour in the future sorts above
       everything the reader did afterwards, and retention orders by time. */
    expect(ended?.finishedAt).toBeTruthy();
    expect(ended!.finishedAt!.getTime() - Date.now()).toBeLessThan(30_000);
    /* **And a lower bound, which the first version of this did not have.** Both
       assertions above were one-sided, so the epoch passed them, and so did any
       timestamp arbitrarily far in the past — which is the other half of the
       same bug, since an instance running *slow* writes a lease that has
       already expired. GPT Sol, 2026-09-01: "its timestamp assertions are upper
       bounds only". */
    expect(claimed!.lease!.getTime() - Date.now()).toBeGreaterThan(LEASE - 30_000);
    expect(ended!.finishedAt!.getTime() - Date.now()).toBeGreaterThan(-30_000);
  });

  /**
   * **The sweep and Stop are on the database's clock too**, and the previous
   * case never asked them.
   *
   * It skewed the application clock across `claim` and `finish` and stopped
   * there — so an implementation that had moved back to `Date.now()` inside
   * `settleExpired` or `requestCancel` would have passed it. Those two are
   * where an app clock does the most damage, because they decide *ownership*: a
   * fast instance evicts a claimant that is still working, and a slow one
   * leaves a dead one holding the article for as long as the skew.
   *
   * Both directions, because they fail differently and only one of them is
   * visible as a stuck job.
   */
  it("settles and stops on the database's clock, in both directions of skew", async () => {
    const HOUR = 60 * 60_000;

    /* An hour SLOW. This instance believes the lease has an hour left; the
       database knows it ran out a second ago. The sweep must act. */
    const dead = await queued();
    expectClaimed(await pgJobStore.claim(dead, OWNER, mintAttempt(), LEASE, CAP));
    await getDb()
      .update(jobs)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(jobs.id, dead));
    await skewed(-HOUR, async () => {
      expect(settledIds(await pgJobStore.settleExpired())).toContain(dead);
    });
    expect((await pgJobStore.get(dead, OWNER))?.status).toBe("error");

    /* An hour FAST, on a claim that is genuinely live. Stop must **ask** — an
       instance that believed the lease had lapsed would end the job outright
       and leave the real claimant writing artefacts for an article the reader
       has been told is finished, which is the one thing the lapsed branch of
       `requestCancel` must never do early. */
    const live = await queued();
    expectClaimed(await pgJobStore.claim(live, OWNER, mintAttempt(), LEASE, CAP));
    await skewed(HOUR, async () => {
      const asked = await pgJobStore.requestCancel(live, OWNER);
      expect(asked?.status).toBe("running");
      expect(asked?.cancelling).toBe(true);
      /* And it did not settle it either, for the same reason. */
      expect(settledIds(await pgJobStore.settleExpired())).not.toContain(live);
    });
  });

  /**
   * **A transaction that began before the deadline and reaches the row after
   * it.**
   *
   * This is the case `now()` cannot see and the reason the fence uses
   * `clock_timestamp()`. `now()` is **transaction start time** and does not
   * move: a claimant whose write is inside a transaction that opened before the
   * lease ran out — which under Postgres is every artefact commit, since
   * `releaseStepIn` runs inside the session's transaction — would be judged on
   * the time before it waited, and let through.
   *
   * The case makes the two readings visible rather than assuming them: it asks
   * the database, in the same transaction, whether `now()` still thinks the
   * lease is live (it does) and whether `clock_timestamp()` knows better (it
   * does). So a run that goes green cannot have gone green because the timing
   * did not happen.
   */
  it("refuses a claimant whose transaction opened before its lease ran out", async () => {
    const id = await queued();
    const attempt = mintAttempt();
    expectClaimed(await pgJobStore.claim(id, OWNER, attempt, LEASE, CAP));

    await getDb().transaction(async (tx) => {
      /* Pins the transaction's `now()`. Postgres sets it at the first command,
         so without this it would be whatever the fenced statement itself
         started at, and there would be nothing to cross. */
      await tx.execute(sql`select 1`);

      /* **The wait comes first, and the expiry is written after it.** The wall
         clock has to move past this transaction's `now()`, and the obvious
         order — write a lease a second out, then sleep two — leaves the row
         `running` with a lapsed lease for the whole of that sleep, which is a
         fixture any *other* process may lawfully settle: `advanceJobWith` opens
         with an unscoped `store.settleExpired()`, so one dev server mid-ingest
         on this same local database clears this row's `attempt_id` and
         `lease_expires_at` while the test is asleep on it. The failure then
         arrives here as `expected null to be true` — a null because the columns
         the two booleans read are gone — which reads as a product bug and is
         somebody else's pump. Watched, and reproduced by running the sweep from
         a second connection inside the sleep, on 2026-09-02.

         Sleeping first and expiring after leaves the row expired for the two
         statements below rather than for two seconds. Nothing can make it
         zero — a `running` row past its lease is exactly what the global sweep
         is for — so this shrinks the window rather than closing it.

         Written on **another** connection, because inside this transaction it
         would be invisible to everybody else and the point is that the row
         really has expired. A second *behind* `clock_timestamp()`, which is
         still a second *ahead* of the `now()` pinned above. */
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await getDb()
        .update(jobs)
        .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
        .where(eq(jobs.id, id));

      const crossing = await tx.execute<{ frozen: boolean; really: boolean }>(sql`
        select now() < lease_expires_at as frozen,
               clock_timestamp() > lease_expires_at as really
        from ${jobs} where ${jobs.id} = ${id}`);
      /* The whole hazard, in two booleans: this transaction's `now()` still
         says the claim is live, and the wall clock says it is over. */
      expect(crossing.rows[0]?.frozen, "the transaction has not crossed the lease").toBe(true);
      expect(crossing.rows[0]?.really, "the lease has not actually expired").toBe(true);

      await expect(releaseStepIn(tx, id, attempt, STEPS, {})).rejects.toBeInstanceOf(
        StaleAttemptError,
      );
    });

    // Still running and still untouched, waiting for the sweep rather than
    // carrying a settlement written by a claimant that had no right to.
    expect((await pgJobStore.get(id, OWNER))?.status).toBe("running");
  }, 20_000);

  /**
   * **A Stop that arrives with a real failure already on the row.**
   *
   * The cancelled settlement clears `error` and `failure_kind`, and the case
   * that covers it built its fixture out of a job that had never failed — so an
   * implementation that simply left both columns alone passed it. GPT Sol's
   * table, 2026-09-01: "retaining stale `error`, `failureKind`, token, lease,
   * pointer, or missing `finishedAt`".
   *
   * So this one seeds the whole set: a job that failed, was retried, was
   * claimed again, was stopped, and whose claimant then walked away. Every
   * field the settlement is supposed to write is asserted, including the draft
   * pointer — a terminal job holding one is a revision `sweepAbandonedDrafts`
   * spares for ever.
   *
   * Postgres only, because the fields are seeded straight into the columns: the
   * filesystem adapter has no equivalent of "a row that failed before this
   * claim", and `settleAbandoned` there is one branch that clears both.
   */
  it("clears a real failure's sentence when a stopped job is swept", async () => {
    const id = await queued();
    const attempt = mintAttempt();
    expectClaimed(await pgJobStore.claim(id, OWNER, attempt, LEASE, CAP));
    await pgJobStore.noteProgress(id, attempt, [
      { ...STEPS[0]!, status: "running", startedAt: new Date().toISOString() },
    ]);

    await getDb()
      .update(jobs)
      .set({
        cancelling: true,
        error: "Readability could not find an article on this page. [ex-empty]",
        failureKind: "blocked",
        leaseExpiresAt: sql`clock_timestamp() - interval '1 second'`,
      })
      .where(eq(jobs.id, id));

    expect(await pgJobStore.settleExpired()).toContainEqual({ id, status: "cancelled" });

    const settled = await pgJobStore.get(id, OWNER);
    expect(settled?.status).toBe("cancelled");
    expect(settled?.cancelling).toBeFalsy();
    expect(settled?.error, "the old failure's sentence survived the cancel").toBeUndefined();
    expect(settled?.failureKind).toBeUndefined();
    expect(settled?.finishedAt).toBeTruthy();
    /* No sentence on the step either: the reader stopped it. */
    expect(settled?.steps[0]?.status).toBe("pending");
    expect(settled?.steps[0]?.error).toBeUndefined();

    const [row] = await getDb()
      .select({ attemptId: jobs.attemptId, lease: jobs.leaseExpiresAt })
      .from(jobs)
      .where(eq(jobs.id, id));
    expect(row?.attemptId).toBeNull();
    expect(row?.lease).toBeNull();
    /* **The draft pointer is not asserted here**, and deliberately: the column
       has a foreign key, so seeding it needs a real article and a real
       revision, and `tests/store-pg-session.test.ts` already settles an expired
       job that is genuinely holding one and watches the pointer go. Inventing a
       second, weaker version of that here would be a test of the fixture. */
  });

  /**
   * **Stop, the sweep and the claimant's own release, all at once.**
   *
   * Every one of the three has a claim on the same expired row, and the reader
   * must end up with one coherent account whichever order they land in. The
   * risk is not a crash — Postgres serialises the row — it is two of them
   * *both* believing they settled it, which is how a reader gets told their
   * Stop was an interruption.
   *
   * Three assertions, and the middle one is the sharp one: exactly one
   * settlement is reported. `requestCancel` is fenced on `status in
   * ('queued','running')` and `settleExpired` on `status = 'running'`, so
   * whichever commits second re-reads the row and finds nothing to do.
   */
  /**
   * **Stop, arriving in the window between the pause's read and its write.**
   *
   * ⟨GPT Sol, reviewing the built stage 3, finding 2⟩ The sequential Stop case
   * in the parity block above is real but blunt: it completes `requestCancel`
   * *before* calling `pauseForDeadline`, so removing `.for("update")` — or
   * splitting the read and the write into two transactions — leaves it green.
   * This is the case that goes red for that.
   *
   * **The barrier is a second connection holding the row lock**, so the
   * interleaving is arranged rather than raced for. The lock is taken, the pause
   * is started and blocks, Stop is written onto the locked row, and the lock is
   * released. Whichever statement of the pause was waiting then re-reads the
   * committed row — `read committed` re-checks a locked tuple — and must see
   * the Stop.
   *
   * Under the weakening the pause's `SELECT` does not block, so it classifies a
   * row that says nothing about Stop; its `UPDATE` blocks instead, and by the
   * time it lands `cancelling` is set. `liveAttempt` still matches, so it writes
   * `queued` over a row carrying the flag — **the wedge**: `claim` answers
   * `stopping` to that row for ever, and the reader's Stop button is already
   * disabled. That is the state `jobs_cancelling_is_running` exists to make
   * unreachable through the API and which two statements can still reach
   * between them.
   */
  it("cannot be raced into leaving a job queued with Stop still on it", async () => {
    const id = await queued();
    const attempt = mintAttempt();
    expectClaimed(await pgJobStore.claim(id, OWNER, attempt, LEASE, CAP));

    /* **The holder runs on `getDb()`**, not on a `Pool` of this file's own.
       `DATABASE_URL` is not where the tests are: vitest gives each run its own
       private lane, and a second pool built from the environment locks a row in
       whichever database that names — which was the first version of this, and
       it failed loudly at the barrier check below rather than passing for the
       wrong reason. */
    let pausing!: ReturnType<typeof pgJobStore.pauseForDeadline>;
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`select id from ${jobs} where ${jobs.id} = ${id} for update`);

      /* Started, not awaited: it is about to block on the lock above. */
      pausing = pgJobStore.pauseForDeadline(id, attempt, 2);

      /* **Wait until it really is blocked**, rather than sleeping and hoping.
         A backend of this database waiting on a `Lock` is this run's: vitest
         gives the file its own private database, and the file holds the shared
         run lock besides. Failing loudly when the barrier never engages is the
         point — a barrier that quietly did not is a test that passes for the
         wrong reason (docs/reusable/silent-success.md), and this check has
         earned its keep twice already.

         **Two things about the probe, and each reported the opposite of the
         truth before it was right.**

         `pg_stat_activity`, not `pg_locks`: a row-lock waiter waits on the
         holder's `transactionid`, and a `transactionid` lock carries no
         `relation`, so the obvious `not granted and relation =
         'spideryarn.jobs'::regclass` matches nothing at all.

         And on **`getDb()`, not `tx`**: Postgres takes the activity snapshot
         once per transaction and caches it until that transaction ends, so a
         probe run on the *holding* transaction re-reads the picture as it was
         before the pause had even connected — for ever, however long it polls.
         It said the pause had sailed straight through the lock while the pause
         was blocked on it the whole time. */
      let waiting = false;
      for (let i = 0; i < 200 && !waiting; i++) {
        const probe = await getDb().execute(
          sql`select count(*)::int as n from pg_stat_activity
                where datname = current_database() and wait_event_type = 'Lock'`,
        );
        waiting = Number((probe.rows[0] as { n: number } | undefined)?.n ?? 0) > 0;
        if (!waiting) await new Promise((r) => setTimeout(r, 25));
      }
      expect(waiting, "the pause never blocked on the row lock — the barrier did nothing").toBe(
        true,
      );

      /* The reader presses Stop, onto the row this transaction holds. It commits
         when this callback returns, which is what lets the pause through. */
      await tx.update(jobs).set({ cancelling: true }).where(eq(jobs.id, id));
    });
    const paused = await pausing;

    expect(paused.kind, "a Stop that landed mid-transition was not seen").toBe("cancelled");
    const after = await pgJobStore.get(id, OWNER);
    /* The row did not move, so the claimant still holds it and ends it as a
       cancellation through its own session. */
    expect(after?.status).toBe("running");
    expect(after?.cancelling).toBe(true);
  });

  it("gives one answer when Stop, the sweep and a release arrive together", async () => {
    const id = await queued();
    const attempt = mintAttempt();
    expectClaimed(await pgJobStore.claim(id, OWNER, attempt, LEASE, CAP));
    await getDb()
      .update(jobs)
      .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(jobs.id, id));

    /* **The claimant goes first.** The three run concurrently either way, but
       issuing the release ahead of the other two is what makes the assertion
       below load-bearing: with the lease left out of the fence — the state this
       work found — the claimant's `UPDATE` reaches the row first and wins, and
       a reader who had pressed Stop is told they were interrupted. Ordered
       last, the same broken code passes by luck. */
    const [released, stopped, swept] = await Promise.allSettled([
      pgJobStore.releaseStep(id, attempt, STEPS, {}),
      pgJobStore.requestCancel(id, OWNER),
      pgJobStore.settleExpired(),
    ]);

    /* The claimant loses, always and whatever the order: its lease is gone, so
       there is no interleaving in which it is entitled to write. */
    expect(released.status).toBe("rejected");
    expect(released.status === "rejected" && released.reason).toBeInstanceOf(StaleAttemptError);

    /* **`stopped.value !== undefined` is not padding.** `requestCancel` answers
       `undefined` when its `WHERE` matched nothing, which is what it does when
       the sweep got there first — and `undefined?.status !== "running"` is
       *true*, so the obvious spelling of this counted a Stop that did nothing
       as a settlement and the case failed about one run in three. Written down
       because the wrong version reads correctly. */
    const settlements =
      Number(
        stopped.status === "fulfilled" &&
          stopped.value !== undefined &&
          stopped.value.status !== "running",
      ) + Number(swept.status === "fulfilled" && settledIds(swept.value).includes(id));
    expect(settlements, "two of them both thought they had settled it").toBe(1);

    const after = await pgJobStore.get(id, OWNER);
    expect(["cancelled", "error"]).toContain(after?.status);
    expect(after?.finishedAt).toBeTruthy();
    expect(after?.cancelling).toBeFalsy();
    /* Whichever won, the row is complete: no spinner, no token, no lease. */
    expect(after?.steps.some((step) => step.status === "running")).toBe(false);
    const [row] = await getDb()
      .select({ attemptId: jobs.attemptId, lease: jobs.leaseExpiresAt })
      .from(jobs)
      .where(eq(jobs.id, id));
    expect(row?.attemptId).toBeNull();
    expect(row?.lease).toBeNull();
  });
});

/**
 * Take the seeded person away again, and their jobs first.
 *
 * **The jobs delete is not belt and braces.** `afterEach` forgets by id, so it
 * misses anything a case left behind by throwing before its ids were recorded —
 * and one such row makes `jobs_owner_fk` refuse the delete below, which would
 * leave the user row behind for ever while the run still reported green. Both
 * statements, in the order the foreign key requires.
 */
afterAll(async () => {
  /* And let the next suite in, last and unconditionally. Not left to the process
     exiting: vitest keeps its worker alive for the next file, so a sibling would
     go on waiting long after this file had finished. If we crash instead,
     Postgres drops the lock with the connection and the sibling is let in
     anyway. The release used to sit in a `finally` behind `pool.end()`, which is
     itself fallible. tests/helpers/lock-lifecycle.ts. */
  await cleanUpThenRelease(
    async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      try {
        await pool.query("delete from spideryarn.jobs where owner_id = any($1)", [
          [OWNER, OWNER_B],
        ]);
        await pool.query("delete from auth.users where id = any($1)", [[OWNER, OWNER_B]]);
      } finally {
        await pool.end();
      }
    },
    async () => {
      await runLock?.release();
    },
  );
});

process.on("beforeExit", () => {
  void closeDb();
});
