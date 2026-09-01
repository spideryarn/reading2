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
 * ## Why the store is the filesystem one
 *
 * `SPIDERYARN_STORE` is left unset, which is the state of every laptop, so this
 * cannot skip itself into a green run (docs/reusable/silent-success.md). The
 * decision under test is `listJobs`'s and is the same under either store;
 * tests/store-jobs-parity.test.ts is where the owner-scoped sweep itself is held
 * to one contract across both adapters.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * The log level, before any import — `level()` in src/log.ts reads `LOG_LEVEL`
 * once at that module's load, and vitest's `NODE_ENV=test` otherwise makes the
 * logger `silent`, which writes nothing, which satisfies every assertion below
 * that looks for a string. tests/helpers/log-capture.ts § two things a caller
 * has to do.
 *
 * The store flag is **deleted** rather than set, because unset is the state a
 * fresh clone is in and `storeFromEnv` treats the two the same on purpose.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  const previousStore = process.env.SPIDERYARN_STORE;
  if (previousLevel === undefined || ["silent", "fatal", "error"].includes(previousLevel)) {
    process.env.LOG_LEVEL = "warn";
  }
  delete process.env.SPIDERYARN_STORE;
  return { previousLevel, previousStore };
});

import { mintId } from "../src/ids.js";
import { listJobs } from "../src/jobs.js";
import { type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import { expireLeaseForTests, forgetForTests, fsJobStore } from "../src/store/jobs-fs.js";
import { mintAttempt } from "../src/store/jobs.js";
import { STORE } from "../src/store/live.js";
import type { Job, JobStep } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";

if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
else process.env.LOG_LEVEL = HOISTED.previousLevel;
if (HOISTED.previousStore !== undefined) process.env.SPIDERYARN_STORE = HOISTED.previousStore;

/** Said out loud, because the whole file is about the filesystem store's records. */
if (STORE !== "files") {
  throw new Error(`this file needs the filesystem job store, and STORE is ${STORE}`);
}

/**
 * Two readers of this file's own. Neither ever becomes an `auth.users` row —
 * the job store here is the filesystem one — but the ids are still unique to
 * this file, because tests/fixture-ids.test.ts reads literals and cannot know
 * that, and a shared id is one refactor away from being a shared row.
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

afterEach(async () => {
  vi.restoreAllMocks();
  const ids = made.splice(0);
  if (ids.length > 0) await forgetForTests(ids);
});

afterAll(async () => {
  if (made.length > 0) await forgetForTests(made.splice(0));
});

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
  await fsJobStore.enqueueOrGet(job, `k-${job.id}`);
  const claimed = await fsJobStore.claim(job.id, owner, mintAttempt(), LEASE, CAP);
  expect(claimed.kind).toBe("claimed");
  expireLeaseForTests(job.id);
  /* The row is untouched and still says `running`, which is exactly the state
     the reader's card is frozen on. */
  expect((await fsJobStore.get(job.id, owner))?.status).toBe("running");
  return job;
}

describe("listing your jobs", () => {
  /**
   * **The settled version, on the poll the reader is actually looking at.**
   *
   * Watched red before `listJobs` reconciled at all: the job came back
   * `running`, which is the frozen card this stage exists to unfreeze.
   */
  it("settles a job whose claimant stopped answering, and says so in the same answer", async () => {
    const job = await abandoned(ALICE);

    const listed = await as(ALICE, () => listJobs());
    const seen = listed.find((one) => one.id === job.id);
    expect(seen?.status).toBe("error");
    /* `retry`, so the card offers the button — the whole point of settling it
       rather than leaving it spinning. */
    expect(seen?.failureKind).toBe("retry");

    /* And it really is settled in the store, not merely rewritten on the way
       out. A `listJobs` that patched its own answer would pass the lines above
       and leave the next reader's card exactly as frozen. */
    expect((await fsJobStore.get(job.id, ALICE))?.status).toBe("error");
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
    expect(listed.find((one) => one.id === his.id)?.status).toBe("error");

    const untouched = await fsJobStore.get(hers.id, ALICE);
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
    await fsJobStore.enqueueOrGet(idle, `k-${idle.id}`);
    const sweep = vi.spyOn(fsJobStore, "settleExpired");

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
    const sweep = vi.spyOn(fsJobStore, "settleExpired");

    await as(ALICE, () => listJobs());
    expect(sweep).toHaveBeenCalledTimes(1);
    /* The date is for tests only — production compares against the store's own
       clock — so the first argument stays `undefined` and the owner is second. */
    expect(sweep).toHaveBeenCalledWith(undefined, ALICE);
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
  it("writes down which jobs it settled, ids and endings", async () => {
    const job = await abandoned(ALICE);

    let listed: Job[] = [];
    const lines = await logLinesWhile(async () => {
      listed = await as(ALICE, () => listJobs());
    });

    /* The capture caught something — every way of getting this wrong produces an
       empty string, and an empty string contains nothing and fails nothing. */
    expect(lines).not.toBe("");
    expect(listed.find((one) => one.id === job.id)?.status).toBe("error");
    expect(lines).toContain(job.id);
    expect(lines).toContain("settled");
  });
});
