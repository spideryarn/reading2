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
import { mintAttempt } from "../src/store/jobs.js";
import type { ExpirySettlement, JobStore } from "../src/store/jobs.js";
import { StaleAttemptError } from "../src/store/jobs.js";
import {
  expireLeaseForTests,
  fsJobStore,
  reattachAttemptForTests,
  forgetForTests,
} from "../src/store/jobs-fs.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Job, JobStep, OwnerId } from "../src/types.js";
import { failIfPostgresRequired, type MissingKind } from "./helpers/pg-ready.js";
import { type HeldRunLock, takeRunLock } from "./helpers/run-lock.js";

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
const RUBBLE = `${OWNER_STEM}%`;
const STRANGER = "00000000-0000-4000-8000-0000000000b5" as OwnerId;

/**
 * **One run of this file at a time, against one database.**
 *
 * A private owner is not enough on its own, because the two rules that matter
 * most here are not scoped to an owner at all: `jobs_only_one_running` is a
 * unique index on `(true)` over every running row in the table, and
 * `settleExpired` sweeps the whole table and returns the ids this file asserts
 * exactly. So a second copy holding a claim makes this one's `claimed` come
 * back `busy`, and its expiries are added to this one's total. Measured with
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

/** Probed at MODULE LOAD so the skip is a real vitest skip rather than a green tick. */
let reachable = false;
/** What was missing, and which fix it needs, for `REQUIRE_POSTGRES=1`. */
let why = "DATABASE_URL is not set — run npm run db:start";
let kind: MissingKind = "no-url";
/** Holds `RUN_LOCK` for the length of the run; released in `afterAll`. */
let runLock: HeldRunLock | undefined;

if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  kind = "migration";
  why = "spideryarn.jobs is not there — run npm run db:migrate";
  try {
    const probe = await pool.query("select to_regclass('spideryarn.jobs') is not null as ready");
    reachable = probe.rows[0]?.ready === true;
    /* Locked, swept and seeded in the same breath as the probe, because a
       `beforeAll` runs after the describes have been collected and one of them
       would already have been skipped.

       Not a `catch` that shrugs: if the row cannot be created then every
       Postgres case here is about to fail on a foreign key, and a probe that
       swallowed the reason would send the reader to the store. The dozen
       not-null columns and the zero `instance_id` are `auth.users` being
       Supabase's table rather than ours — see scripts/db-seed-owner.ts. */
    if (reachable) {
      runLock = await takeRunLock("tests/store-jobs-parity.test.ts");

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
         ever reach rows this file made. */
      await pool.query(`delete from spideryarn.jobs where owner_id::text like $1`, [RUBBLE]);
      await pool.query(`delete from auth.users where id::text like $1`, [RUBBLE]);

      /* No `on conflict`: the id is fresh and the rubble is gone, so a conflict
         here would mean something we have not thought of, and the point of the
         rethrow above is that this file says so rather than failing later on a
         foreign key. The email is per-run too — `users_email_partial_key` is
         unique, so a fixed one is its own way for two runs to collide. */
      await pool.query(
        `insert into auth.users
           (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                 $2, 'x', now(), now())`,
        [OWNER, `store-jobs-parity-${OWNER}@example.invalid`],
      );
    }
  } catch (err) {
    if (reachable) throw err;
    reachable = false;
    kind = "unreachable";
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
}

/* This file has never said anything when it skips, so `REQUIRE_POSTGRES=1` is
   the only way its absence is visible. tests/helpers/pg-ready.ts. */
if (!reachable) failIfPostgresRequired("tests/store-jobs-parity.test.ts", why, kind);

const LEASE = 60_000;
/**
 * **Deliberately out of the way.** `claim` takes the cap as an argument, exactly
 * as it takes the lease, so most cases here want a number high enough that the
 * global cap never enters into what they are testing. The two cases that *are*
 * about the cap pass their own, small, on purpose — a suite-wide constant that
 * both sets shared would make one of them pass for the other's reason.
 */
const CAP = 4;
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
       expire between two of the assertions that follow.

       **`now()`, not `Date.now()`.** The store creates and compares leases on
       the database's clock since 2026-09-01, so a helper reaching for the
       application's would be testing the two against each other — green on a
       laptop where they are the same clock, and quietly wrong exactly where
       Vercel and Supabase are not. */
    async expire(id) {
      await getDb()
        .update(jobs)
        .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
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
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
      await store.releaseStep(job.id, attempt, job.steps, {});
    });

    it("lets one claimant in and turns the second away", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");

      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("claimed");
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
      await store.enqueueOrGet(a, "k1");
      await store.enqueueOrGet(b, "k2");

      const held = mintAttempt();
      expect((await store.claim(a.id, OWNER, held, LEASE, 1)).kind).toBe("claimed");
      const blocked = await store.claim(b.id, OWNER, mintAttempt(), LEASE, 1);
      expect(blocked.kind).toBe("busy");
      /* The reason names the arithmetic. `busy` already means four things to the
         client, and a log line that cannot tell "the machine is full" from "your
         other tab has it" makes them one symptom. */
      expect(blocked.kind === "busy" && blocked.why).toMatch(/1 of 1/);

      /* **And the same claim goes through when the cap allows it** — without
         this half, a `claim` that refused everything would pass. */
      expect((await store.claim(b.id, OWNER, mintAttempt(), LEASE, 2)).kind).toBe("claimed");
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
        await store.enqueueOrGet(job, "k1");

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
          expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
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
      await store.enqueueOrGet(a, "k1");
      await store.enqueueOrGet(b, "k2");

      /* The tokens are kept rather than read back off the job: `toJob` does not
         carry `attempt_id`, deliberately, so the caller's own is the only
         spelling of it there is. */
      const [heldA, heldB] = [mintAttempt(), mintAttempt()];
      expect((await store.claim(a.id, OWNER, heldA, LEASE, CAP)).kind).toBe("claimed");
      expect((await store.claim(b.id, OWNER, heldB, LEASE, CAP)).kind).toBe("claimed");

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
      await store.enqueueOrGet(over, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(over.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
      await store.finish(over.id, attempt, { status: "done", steps: over.steps });
      expect((await store.claim(over.id, OWNER, mintAttempt(), LEASE, 0)).kind).toBe("finished");

      /* Somebody else's still reads as one that is not there, at the cap as
         below it — otherwise a full machine is an oracle for which job ids
         exist. */
      const mine = aJob();
      await store.enqueueOrGet(mine, "k2");
      expect((await store.claim(mine.id, STRANGER, mintAttempt(), LEASE, 0)).kind).toBe("gone");
    });

    /**
     * **And two jobs on ONE article do not**, which is the guarantee that pays
     * for the one above.
     *
     * Not a nicety: a job publishes by copying whatever revision is current,
     * writing into the copy and moving the pointer, and `publishRevisionIn`
     * never compares what it branched from against what is current now. Two
     * jobs on one article therefore lose one of the two results, silently, with
     * both reporting success — docs/reusable/silent-success.md.
     *
     * **This fails today at its second line**, before it reaches the claim:
     * `jobs_active_slug` covers `queued`, so the second `enqueueOrGet` does not
     * create a row at all. That is the refusal being moved from enqueue time to
     * claim time, seen from the store.
     */
    /* **Stage 2, and it is skipped rather than absent.** This is the behaviour
       Greg asked for and it is not built yet: it must not ship before late steps
       read the published store, because a job queued behind an ingest claims on
       some other instance and opens `blocks.json` in its own empty scratch
       directory — docs/plans/260830ar-several-articles-at-once.md § The prerequisite, and
       docs/plans/260830aq-late-steps-read-the-store.md, which is another session's.
       Written and watched red first, so that turning it on is a one-word change
       to something already known to fail for the right reason. */
    it.skip("queues a second job for one article rather than refusing it, and will not run both", async () => {
      const first = aJob();
      await store.enqueueOrGet(first, "k1");
      const second = aJob({ slug: first.slug });

      const queued = await store.enqueueOrGet(second, "k2");
      expect(queued.created).toBe(true);
      expect(queued.job.id).toBe(second.id);
      expect(queued.job.status).toBe("queued");

      const held = mintAttempt();
      expect((await store.claim(first.id, OWNER, held, LEASE, CAP)).kind).toBe("claimed");

      /* The article is busy, and the reason has to say so. `busy` already means
         three different things to the client loop; a fourth that cannot be told
         apart in a log is how "waiting behind an ingest" and "the machine is at
         its cap" become one indistinguishable symptom. */
      const blocked = await store.claim(second.id, OWNER, mintAttempt(), LEASE, CAP);
      expect(blocked.kind).toBe("busy");
      expect(blocked.kind === "busy" && blocked.why).toMatch(/article/i);

      await store.releaseStep(first.id, held, first.steps, {});
    });

    it("will not claim a job the reader has stopped, or one already over", async () => {
      /* Stop on a job somebody is **inside**. That is the only way to reach
         `stopping` since 2026-08-27: a *queued* job is cancelled outright by
         the same call, because nobody is there to notice a flag. */
      const stopping = aJob();
      await store.enqueueOrGet(stopping, "k1");
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
      await store.enqueueOrGet(over, "k2");
      const attempt = mintAttempt();
      expect((await store.claim(over.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
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
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");

      const done: JobStep[] = [{ ...job.steps[0]!, status: "done" }];
      const after = await store.releaseStep(job.id, attempt, done, { title: "A Paper" });
      expect(after.status).toBe("queued");
      expect(after.title).toBe("A Paper");
      expect(after.steps[0]?.status).toBe("done");

      // A different request, a different token, and it gets in.
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("claimed");
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
      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");

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
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");

      await adapter.expire(job.id);
      expect(settledIds(await store.settleExpired())).toContain(job.id);
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
      await store.claim(job.id, OWNER, attempt, LEASE, CAP);
      expect((await store.activeForSlug(job.slug, OWNER))?.id).toBe(job.id);

      await store.finish(job.id, attempt, { status: "done", steps: job.steps });
      expect(await store.activeForSlug(job.slug, OWNER)).toBeUndefined();
    });

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
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");

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
      await store.enqueueOrGet(job, "k1");
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

    it("fails a job whose lease ran out, and leaves a live one alone", async () => {
      const dead = aJob();
      await store.enqueueOrGet(dead, "k1");
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
      await store.enqueueOrGet(alive, "k2");
      await store.claim(alive.id, OWNER, mintAttempt(), LEASE, CAP);
      expect(await store.settleExpired()).toEqual([]);
      expect((await store.get(alive.id, OWNER))?.status).toBe("running");
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
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");

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
      await store.enqueueOrGet(job, "k1");
      expect((await store.claim(job.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("claimed");
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
     * **A job that is over must not still be showing a spinner.**
     *
     * Both expiry paths end a job nobody is inside, so if the statement that
     * ends it does not settle the step that was running, nothing ever will:
     * `StepRow` draws `LoaderCircle` for a `running` step regardless of what the
     * job says. Back to `pending`, which is what `sweepStopped` already writes
     * for a step whose process went away.
     */
    it("settles the step that was running, so a finished job never draws a spinner", async () => {
      /** Claim it and leave one step visibly running, as any long step does. */
      async function midStep(job: Job, key: string): Promise<void> {
        await store.enqueueOrGet(job, key);
        const attempt = mintAttempt();
        expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
        await store.noteProgress(job.id, attempt, [
          { ...job.steps[0]!, status: "running", startedAt: new Date().toISOString() },
        ]);
        await adapter.expire(job.id);
      }

      const swept = aJob();
      await midStep(swept, "k1");
      await store.settleExpired();
      const afterSweep = await store.get(swept.id, OWNER);
      expect(afterSweep?.status).toBe("error");
      expect(afterSweep?.steps.map((step) => step.status)).toEqual(["pending"]);
      expect(afterSweep?.steps[0]?.startedAt).toBeUndefined();

      const stopped = aJob();
      await midStep(stopped, "k2");
      const cancelled = await store.requestCancel(stopped.id, OWNER);
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.steps.map((step) => step.status)).toEqual(["pending"]);
      expect(cancelled?.steps[0]?.startedAt).toBeUndefined();
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
      await store.enqueueOrGet(job, "k1");
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");

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
      await store.enqueueOrGet(dead, "k1");
      expect((await store.claim(dead.id, OWNER, mintAttempt(), LEASE, CAP)).kind).toBe("claimed");

      const waiting = aJob();
      await store.enqueueOrGet(waiting, "k2");
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
      expect((await store.claim(waiting.id, OWNER, mintAttempt(), LEASE, 1)).kind).toBe(
        "claimed",
      );
    });

    it("refuses to forget a job that is still going", async () => {
      const job = aJob();
      await store.enqueueOrGet(job, "k1");
      expect(await store.forget(job.id, OWNER)).toBe(false);
      const attempt = mintAttempt();
      expect((await store.claim(job.id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
      await store.finish(job.id, attempt, { status: "done", steps: job.steps });
      expect(await store.forget(job.id, OWNER)).toBe(true);
      expect(await store.get(job.id, OWNER)).toBeUndefined();
    });

    /* ------------------------------------------------------------ retention --

       **The only two cases here whose scope is the whole owner**, which is why
       the file has an owner nobody else uses — see the head of it. `keep` is a
       plain number in both, and it can be, because every finished job this
       owner has is one of these lines. Written against a shared owner it would
       have to count first, and then it would be asserting arithmetic against
       whatever else happened to be in the database that morning. */

    /** Queue it, claim it, end it. The three lines every case below repeats. */
    async function endJob(job: Job, key: string, ending: "done" | "error"): Promise<void> {
      await store.enqueueOrGet(job, key);
      const attempt = mintAttempt();
      await store.claim(job.id, OWNER, attempt, LEASE, CAP);
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

    it("breaks a tie in the timestamps by id rather than by luck", async () => {
      /**
       * **The part that drifts silently.** `created_at` is not a total order —
       * two jobs queued in the same millisecond are common enough — and with no
       * tie-break the two adapters answer from different accidents: Postgres
       * from whatever order the planner returned, the filesystem store from the
       * insertion order of a `Map`. Both look right until the day they disagree
       * about which record still exists.
       *
       * So the rule is written down here: **same timestamp, lowest id goes.**
       *
       * **They are finished in the opposite order to their ids**, which is the
       * part that gives this teeth. Written the other way round it passed
       * against a filesystem store with no tie-break at all, because the order
       * it was handed them happened to be the order it should have sorted them
       * into — a green tick for a rule nobody had implemented.
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
      for (const [i, job] of [...tied].reverse().entries()) await endJob(job, `tie${i}`, "done");

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
describe.skipIf(!reachable)("Postgres, on the database's clock", () => {
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
    await pgJobStore.enqueueOrGet(job, "clock");

    const attempt = mintAttempt();
    const HOUR = 60 * 60_000;
    await skewed(HOUR, async () => {
      expect((await pgJobStore.claim(id, OWNER, attempt, LEASE, CAP)).kind).toBe("claimed");
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
  if (!reachable) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query("delete from spideryarn.jobs where owner_id = $1", [OWNER]);
    await pool.query("delete from auth.users where id = $1", [OWNER]);
  } finally {
    await pool.end();
    /* And let the next suite in. Not left to the process exiting: vitest keeps
       its worker alive for the next file, so a sibling would go on waiting long
       after this file had finished. If we crash instead, Postgres drops the
       lock with the connection and the sibling is let in anyway. */
    await runLock?.release();
  }
});

process.on("beforeExit", () => {
  void closeDb();
});
