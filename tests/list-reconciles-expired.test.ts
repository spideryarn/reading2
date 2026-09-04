/**
 * **The reader comes back, and the card is still spinning.**
 *
 * `settleExpired` is what turns an abandoned claim into something a reader can
 * act on, and until now it had exactly one caller: the top of
 * `POST /api/jobs/:id/advance`. In production that is a problem of shape rather
 * than of tuning. Vercel has no cron and no worker — `pump` opens with
 * `if (process.env.VERCEL) return` — so the browser is the engine, and
 * `/advance` only fires when somebody is *already* driving a job. The one
 * person the sweep could never reach was therefore the one who needed it: the
 * reader who closed the tab, whose claimant died, and who comes back to a
 * frozen card that nothing will ever move.
 *
 * So `listJobs` reconciles too. Stage 3 of
 * docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md.
 *
 * ## The three things this file pins, and why each is a separate way to be wrong
 *
 * - **It settles, and answers with what it settled** — in the *same* call. A
 *   list that swept and then returned its pre-sweep rows would be right by the
 *   next poll and wrong on the one the reader is looking at.
 * - **It is scoped to the reader who asked.** A request is not a cron job. The
 *   list path runs under whoever is signed in, and a sweep that took the table
 *   would be one reader's page load ending another reader's import.
 * - **It costs nothing when there is nothing to do.** The gate is *does the list
 *   I just fetched contain a `running` job* — deliberately not *does it contain
 *   an expired lease*, which the app-level `Job` cannot see and must not be
 *   taught to (`Job` on the wire carries no lease; that is what keeps ownership
 *   decisions on the server). With no running job there is no second statement
 *   at all, which is what keeps an idle shelf at one round trip.
 *
 * ## Why the store is Postgres, since 2026-09-04
 *
 * It used to leave `SPIDERYARN_STORE` unset — the state of every laptop — on
 * the argument that the decision under test is `listJobs`'s and is the same
 * under either store. That was true and it is no longer the point: the store it
 * proved `listJobs` over is the one being deleted. Stage B of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 *
 * **And it is a stronger file for it, in one specific place.** On the
 * filesystem store `list` handed back references to the live in-memory records
 * and `settleExpired` mutated those same objects — the trap the *reads the list
 * again* case below was written around. Under Postgres a list is rows read out
 * of a database and there is no shared object for a bug to hide behind, so
 * *settles, and answers with what it settled* is a claim about two real
 * statements. The sweep those cases spy on is an `UPDATE ... where owner_id =
 * $1 and lease_expires_at < clock_timestamp()`, which is a predicate the
 * filesystem store never had at all.
 *
 * tests/store-jobs-parity.test.ts is still where the owner-scoped sweep itself
 * is held to one contract across both adapters.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Two things before any import, and both for the same reason: the module that
 * reads each of them reads it **once, at its own load**, and imports are
 * hoisted above every statement in a module.
 *
 * The log level — `level()` in src/log.ts reads `LOG_LEVEL` once, and vitest's
 * `NODE_ENV=test` otherwise makes the logger `silent`, which writes nothing,
 * which satisfies every assertion below that looks for a string.
 * tests/helpers/log-capture.ts § two things a caller has to do.
 *
 * The store — `src/jobs.ts` picks between `pgJobStore` and `fsJobStore` at its
 * own load, so a plain assignment here would leave the whole file on the
 * filesystem queue with nothing saying so.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  const previousStore = process.env.SPIDERYARN_STORE;
  if (previousLevel === undefined || ["silent", "fatal", "error"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "warn";
  }
  process.env.SPIDERYARN_STORE = "postgres";
  return { previousLevel, previousStore };
});

import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { listJobs, REQUEUE_BUDGET } from "../src/jobs.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import { mintAttempt } from "../src/store/jobs.js";
import { STORE } from "../src/store/live.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import type { Job, JobStep } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.previousLevel;
/* Put the store flag back straight after the imports: vitest reuses a worker
   across files and does not reset `process.env` between them. */
if (HOISTED.previousStore === undefined) delete process.env.SPIDERYARN_STORE;
else process.env.SPIDERYARN_STORE = HOISTED.previousStore;

loadEnvLocal();

const { reachable } = await pgReady({
  suite: "tests/list-reconciles-expired.test.ts",
  tables: ["spideryarn.jobs"],
});

const when = reachable ? describe : describe.skip;

describe("the store these tests are actually talking to", () => {
  it("is the Postgres one", () => {
    /* Said out loud, and **not** gated on `reachable`: the whole file is about
       what a reader's poll does to rows in `spideryarn.jobs`, and the
       filesystem queue would answer every call below happily while consulting
       none of the predicates the cases are about. A control that disappears
       when the database is missing disappears exactly when it matters. */
    expect(STORE).toBe("postgres");
  });
});

/**
 * Two readers of this file's own, and **real `auth.users` rows** since the
 * move: `jobs.owner_id` carries a foreign key, so a made-up uuid would fail
 * every *insert* rather than the ownership check — and *cannot settle somebody
 * else's job* would then be passing because neither job existed. Their own ids
 * rather than a shared pair, because the file's subject is one reader who is
 * not the other.
 */
const ALICE = "00000000-0000-4000-8000-00000000c3a1" as OwnerId;
const BOB = "00000000-0000-4000-8000-00000000c3a2" as OwnerId;

/** Its own slug stem, so nothing here can collide with another suite's records. */
const MINE = "test-list-reconciles-";

/**
 * Deliberately out of the way. The cap is an argument to `claim`, and every case
 * here wants a number high enough that it never enters into what is being
 * tested — including when a peer's real ingest holds a slot on the same laptop.
 */
const CAP = 8;
const LEASE = 60_000;

const made: string[] = [];

/**
 * Rows out, by id.
 *
 * `forgetJob` is the reader's Dismiss and refuses a job that is queued or
 * running, which is most of what this file makes — and `forgetForTests` was the
 * filesystem store's way round that. A delete is the Postgres one. No article
 * delete to order it against: nothing here seeds one, so no job carries a
 * `draft_revision_id`.
 */
async function forgetAll(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await getDb().delete(jobsTable).where(inArray(jobsTable.id, ids));
}

afterEach(async () => {
  vi.restoreAllMocks();
  const ids = made.splice(0);
  if (reachable) await forgetAll(ids);
});

afterAll(async () => {
  if (!reachable) return;
  await forgetAll(made.splice(0));
  await closeDb();
});

beforeAll(async () => {
  if (!reachable) return;
  const db = getDb();
  await seedAuthUser(db, {
    id: ALICE,
    email: "list-reconciles-alice@spideryarn.local",
    onConflictDoNothing: true,
  });
  await seedAuthUser(db, {
    id: BOB,
    email: "list-reconciles-bob@spideryarn.local",
    onConflictDoNothing: true,
  });
}, 60_000);

/** Do something as a signed-in reader, exactly as `handleApi` does. */
function as<T>(who: OwnerId, fn: () => T): T {
  return runInRequest(() => {
    setRequestOwner(who);
    return fn();
  });
}

function aJob(owner: OwnerId): Job {
  const id = mintId();
  made.push(id);
  return {
    id,
    ownerId: owner,
    slug: `${MINE}${id}`,
    steps: [{ name: "fetch", label: STEPS.fetch.label, status: "pending" }] as JobStep[],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

/** Queued, claimed, and then the claimant walks away and its lease runs out. */
async function abandoned(owner: OwnerId): Promise<Job> {
  const job = aJob(owner);
  await pgJobStore.enqueueOrGet(job, { workKey: `k-${job.id}`, reservesName: false });
  await abandonAgain(job, owner);
  return job;
}

/**
 * The lease, run out.
 *
 * **Written straight to the column**, for the reason
 * tests/store-jobs-parity.test.ts gives about its own Postgres adapter: a lease
 * short enough to expire during a test is short enough to expire between two of
 * the assertions that follow. And `clock_timestamp()` rather than
 * `Date.now()`, because the store creates and compares leases on the database's
 * clock — a helper reaching for the application's would be testing the two
 * against each other, green on a laptop where they are the same clock and
 * quietly wrong exactly where Vercel and Supabase are not.
 *
 * This is what `expireLeaseForTests` was, and the difference is the whole
 * conversion: it used to reach into a process-local `attempts` map.
 */
async function expireLease(id: string): Promise<void> {
  await getDb()
    .update(jobsTable)
    .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(jobsTable.id, id));
}

/** The same thing to a job that is already in the queue: claim it, then lapse. */
async function abandonAgain(job: Job, owner: OwnerId): Promise<void> {
  const claimed = await pgJobStore.claim(job.id, owner, mintAttempt(), LEASE, CAP);
  expect(claimed.kind).toBe("claimed");
  await expireLease(job.id);
  /* The row is untouched and still says `running`, which is exactly the state
     the reader's card is frozen on. */
  expect((await pgJobStore.get(job.id, owner))?.status).toBe("running");
}

/**
 * **Use up the job's resumption budget**, so the next lapse is an ending.
 *
 * Since 2026-09-03 a lapsed claim with budget left goes back to `queued` on its
 * own row rather than ending — src/jobs.ts § `REQUEUE_BUDGET`, and
 * src/store/jobs.ts § `settleExpired` for the contract. So the cases here that
 * are about an *ending* have to get the job to one, and they say so rather than
 * quietly assuming the first lapse is fatal, which is what they used to.
 *
 * Driven through `listJobs`, not through the store, because the thing under test
 * in this file is what a reader's poll does.
 */
async function spendBudget(job: Job, owner: OwnerId): Promise<void> {
  for (let i = 0; i < REQUEUE_BUDGET; i++) {
    await as(owner, () => listJobs());
    expect((await pgJobStore.get(job.id, owner))?.status).toBe("queued");
    await abandonAgain(job, owner);
  }
}

when("listing your jobs", () => {
  /**
   * **The unfrozen version, on the poll the reader is actually looking at.**
   *
   * Watched red before `listJobs` reconciled at all: the job came back
   * `running`, which is the frozen card this stage exists to unfreeze.
   *
   * **What it comes back as changed on 2026-09-03.** It used to be `error` plus
   * a Retry button; a lapsed claim with budget left is now put back in the queue
   * on its own row instead, so the reader's next poll drives it on rather than
   * asking them to press anything — and the job keeps its slug, its article and
   * its article's checkpoints, which a new job could not. src/jobs.ts §
   * `REQUEUE_BUDGET`.
   */
  it("puts a job whose claimant stopped answering back in the queue, in the same answer", async () => {
    const job = await abandoned(ALICE);

    const listed = await as(ALICE, () => listJobs());
    const seen = listed.find((one) => one.id === job.id);
    expect(seen?.status).toBe("queued");
    /* Nothing failed, so the card must not say anything did. */
    expect(seen?.error).toBeUndefined();
    expect(seen?.failureKind).toBeUndefined();
    expect(seen?.slug, "the resumption moved the job to a different article").toBe(job.slug);

    /* And it really is in the store that way, not merely rewritten on the way
       out. A `listJobs` that patched its own answer would pass the lines above
       and leave the next reader's card exactly as frozen. */
    expect((await pgJobStore.get(job.id, ALICE))?.status).toBe("queued");
  });

  /**
   * **And the resumptions run out**, which is the other half and the one that
   * keeps a job that overruns every lease from buying model calls for ever.
   *
   * The ending is the one this file used to assert on the first lapse: `error`,
   * `retry`, and the button. A press of it makes a *new* job with a fresh
   * budget, so the reader is the outer loop.
   */
  it("settles a job that has used up its resumptions, and offers the button", async () => {
    const job = await abandoned(ALICE);
    await spendBudget(job, ALICE);

    const listed = await as(ALICE, () => listJobs());
    const seen = listed.find((one) => one.id === job.id);
    expect(seen?.status).toBe("error");
    /* `retry`, so the card offers the button — the whole point of settling it
       rather than leaving it spinning. */
    expect(seen?.failureKind).toBe("retry");
    expect((await pgJobStore.get(job.id, ALICE))?.status).toBe("error");
  });

  /**
   * **That the answer is re-read, and not the pre-sweep one handed back.**
   *
   * Its own test because the case above **could not** pin this, which GPT Sol
   * found on 2026-09-01: `fsJobStore.list` returned references to the live
   * in-memory records, and `settleExpired` mutated those same objects — so the
   * supposedly pre-sweep array changed underneath the assertion and
   * `return listed` passed every line of it. That is
   * docs/reusable/silent-success.md in a test rather than in code: the check
   * agrees with the implementation because the two share an assumption, and the
   * assumption was that a list is a copy.
   *
   * Postgres has no such shared object — every `list` is rows read out again —
   * so the case above would now catch it. **The call count stays anyway**, and
   * not out of sentiment: it is the only assertion here that distinguishes *the
   * answer was re-read* from *the answer happened to be right*, and it is the
   * one that fails when somebody replaces the second read with a patch of the
   * first for the round trip's sake.
   *
   * So this counts the calls instead, which no amount of shared mutation can
   * fake. Watched red with the final `store.list(owner)` replaced by
   * `return listed`: one call, not two.
   */
  it("reads the list again after settling, rather than handing back the one it swept", async () => {
    await abandoned(ALICE);
    const reads = vi.spyOn(pgJobStore, "list");
    try {
      await as(ALICE, () => listJobs());
      expect(reads).toHaveBeenCalledTimes(2);
    } finally {
      reads.mockRestore();
    }
  });

  /**
   * The other half, and the one that stops the count above being satisfied by a
   * `listJobs` that simply reads twice every time. A quiet shelf pays for one.
   */
  it("reads the list once when there was nothing to settle", async () => {
    const quiet = aJob(ALICE);
    await pgJobStore.enqueueOrGet(quiet, { workKey: `k-${quiet.id}`, reservesName: false });
    const reads = vi.spyOn(pgJobStore, "list");
    try {
      await as(ALICE, () => listJobs());
      expect(reads).toHaveBeenCalledTimes(1);
    } finally {
      reads.mockRestore();
    }
  });

  /**
   * **A page load is not a cron job.**
   *
   * The sweep runs under whoever is signed in, so it has to be scoped to them.
   * Unscoped, Bob opening his shelf ends Alice's import — and Alice is not
   * watching, so the first she hears of it is a Retry button.
   *
   * Watched red against `store.settleExpired()` with the owner left off: Alice's
   * job came back `error`.
   */
  it("cannot settle somebody else's job, however long their claimant has been gone", async () => {
    const hers = await abandoned(ALICE);
    const his = await abandoned(BOB);

    const listed = await as(BOB, () => listJobs());
    expect(listed.map((one) => one.id)).not.toContain(hers.id);
    /* `queued`, because a first lapse is now a resumption rather than an ending
       — what matters here is that Bob's row moved and Alice's did not. */
    expect(listed.find((one) => one.id === his.id)?.status).toBe("queued");

    const untouched = await pgJobStore.get(hers.id, ALICE);
    expect(untouched?.status).toBe("running");
    expect(untouched?.error).toBeUndefined();
    expect(untouched?.finishedAt).toBeUndefined();
  });

  /**
   * **The gate, and it is the reason this is affordable.**
   *
   * With a job running, the reader's browser polls `GET /api/jobs` once a
   * second, so a second statement on every list is a doubling of database round
   * trips for the length of the import. That is bounded and worth paying while
   * something is actually running; paying it on every idle shelf load for ever
   * is not.
   *
   * Watched red against a `listJobs` that swept unconditionally: one call
   * instead of none.
   */
  it("asks the store nothing extra when nothing is running", async () => {
    const idle = aJob(ALICE);
    await pgJobStore.enqueueOrGet(idle, { workKey: `k-${idle.id}`, reservesName: false });
    const sweep = vi.spyOn(pgJobStore, "settleExpired");

    const listed = await as(ALICE, () => listJobs());
    expect(listed.map((one) => one.id)).toContain(idle.id);
    expect(sweep).not.toHaveBeenCalled();
  });

  /**
   * The other half of the same rule: with a `running` job in the list it *does*
   * sweep, and it sweeps for this reader. Without this, "no extra statement"
   * above is also satisfied by a `listJobs` that never sweeps at all.
   */
  it("sweeps, for this reader, when the list it just read has a running job in it", async () => {
    await abandoned(ALICE);
    const sweep = vi.spyOn(pgJobStore, "settleExpired");

    await as(ALICE, () => listJobs());
    expect(sweep).toHaveBeenCalledTimes(1);
    /* The date is for tests only — production compares against the store's own
       clock — so the first argument stays `undefined` and the owner is second.
       The budget is third, and passing it is what makes a restart mid-ingest a
       pause rather than an abandoned job: a `listJobs` that dropped it would
       still sweep, still be owner-scoped, and quietly end every interrupted
       import. */
    expect(sweep).toHaveBeenCalledWith(undefined, ALICE, REQUEUE_BUDGET);
  });

  /**
   * **The only account there is of somebody's import ending.**
   *
   * The claimant is gone and logged nothing on its way out, so if the list path
   * settles a job in silence there is no server-side record that it happened at
   * all — and after this stage the list path is the *common* route to settling a
   * dead claimant, not the rare one. The advance path has carried this line
   * since 2026-08-30; this is the same line from the new door, ids and all.
   *
   * Watched red twice: once with the log statement removed (empty capture), and
   * once with `{ count }` alone in place of the settlements (the id missing).
   */
  it("writes down which jobs it moved, ids and endings", async () => {
    const job = await abandoned(ALICE);

    /**
     * **The resumption first, because it is now the common one** — and because
     * a line calling it a settlement would be reporting an ending that did not
     * happen, in the one place there is no other account of what did.
     */
    const resumed = await logLinesWhile(async () => {
      await as(ALICE, () => listJobs());
    });
    const back = resumed
      .split("\n")
      .filter((one) => one.trim() !== "")
      .map((one) => JSON.parse(one) as Record<string, unknown>)
      .find((one) => one.where === "list");
    expect(back?.msg).toBe("put 1 back in the queue — job(s) whose claimant stopped answering");
    expect(back?.settled).toEqual([{ id: job.id, status: "queued" }]);

    await spendBudget(job, ALICE);

    let listed: Job[] = [];
    const lines = await logLinesWhile(async () => {
      listed = await as(ALICE, () => listJobs());
    });

    /* The capture caught something — every way of getting this wrong produces an
       empty string, and an empty string contains nothing and fails nothing. */
    expect(lines).not.toBe("");
    expect(listed.find((one) => one.id === job.id)?.status).toBe("error");

    /* **Parsed, not grepped.** GPT Sol pointed out on 2026-09-01 that
       `toContain(id)` and `toContain("settled")` between them pass a line that
       carries neither the ending nor the door — which are the two fields the
       message was added for, since "settled 1 job(s)" joins to nothing and a
       `cancelled` ending must not be reported as a failure. A substring check
       on a log line is a check that agrees with almost any log line. */
    const line = lines
      .split("\n")
      .filter((one) => one.trim() !== "")
      .map((one) => JSON.parse(one) as Record<string, unknown>)
      .find((one) => one.msg === "settled 1 — job(s) whose claimant stopped answering");

    expect(line).toBeDefined();
    expect(line?.count).toBe(1);
    /* Which door found it. The advance path writes the identical sentence, so
       without this the two are indistinguishable in production — and which one
       is settling dead claimants is the whole question this stage raises. */
    expect(line?.where).toBe("list");
    expect(line?.settled).toEqual([{ id: job.id, status: "error" }]);
  });
});
