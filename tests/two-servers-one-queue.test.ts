/**
 * **Two copies of the server over one `data/` directory, and the claim between
 * them.**
 *
 * The filesystem job store's fence is a variable in one *module's* memory:
 * `claim` refuses a second claimant by reading `job.status === "running"` out of
 * a module-scope `index`, `ready()` fills that index from disk exactly once, and
 * the attempt token is — in the file's own words — *"never written to disk. It
 * dies with the process."*
 *
 * The process is not what dies. **Saving any file under `src/` restarts the Vite
 * dev server inside the same process** — the API is mounted by
 * a dynamic import of `src/routes.js` from `vite.config.ts`, so every server module
 * is a config dependency, and the restart re-evaluates all of them from a
 * uniquely named temp file that the module registry cannot dedupe. The new copy
 * has empty Maps, `loadFromDisk` calls `sweepStopped` on a job it believes
 * nobody can be inside, and the browser's next advance starts the same
 * eight-minute model call again. The old copy never finds out: its own `fenced()`
 * reads its own Maps, where its own attempt is still live.
 *
 * On 2026-08-30 that ran one article's `hierarchy` step **eleven times
 * concurrently** under one job id — eleven `runId`s in `data/_ai-calls.jsonl` at
 * $0.24–$0.56 a call — and six times on a tiny article where all six came back
 * fine, which is why nobody noticed.
 * docs/postmortems/260902c-the-truncation-retry-cost-storm.md.
 *
 * ## Why `vi.resetModules()` and two imports is the faithful reproduction
 *
 * It is the same event: a fresh copy of the module's state over the same files,
 * with the first copy still holding what it thinks is a live claim. It is also
 * the only way to get one inside a test run — the store exports no constructor,
 * and `reloadForTests` gives *one* copy a cold start rather than giving us two
 * copies at once.
 *
 * **The Postgres adapter is deliberately not in this file, and its absence is
 * the point.** Its state is in the database, so "another copy" and "another
 * request in this copy" are the same question there, and
 * tests/store-jobs-parity.test.ts already asks it of both adapters. What fences
 * it is `claimIn`'s single statement in src/store/pg-jobs.ts — `update jobs …
 * where id = $id and status = 'queued'` — which no second copy of anything can
 * get past. This file is about the adapter that has no such statement.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { mintId } from "../src/ids.js";
import { environmentOwnerId } from "../src/owner.js";
import { forgetForTests } from "../src/store/jobs-fs.js";
import { mintAttempt } from "../src/store/jobs.js";
import type { Job, JobStep } from "../src/types.js";

/** Long enough that nothing here expires while the test is running. */
const LEASE_MS = 600_000;
/** Well above anything this file creates, so the cap is never what refuses a claim. */
const MAX_RUNNING = 8;

type FsStore = typeof import("../src/store/jobs-fs.js");

/**
 * A copy of the server. Each call re-evaluates the store module over the same
 * `data/_jobs/` — which is what one Vite restart does, and what an editor's
 * autosave therefore does.
 *
 * `vi.resetModules()` before the import rather than after, so the copy we hand
 * back is the one the *next* reset will not disturb.
 */
async function aServer(): Promise<FsStore> {
  vi.resetModules();
  return (await import("../src/store/jobs-fs.js")) as FsStore;
}

/**
 * **Minted rather than written out**, and that matters more since the fix.
 *
 * A fixed id is shared with every run there has ever been — another suite in
 * this worker, a killed run's residue on disk — and the index that would hold
 * that residue now survives `vi.resetModules()`. A stale `running` row under a
 * familiar id would count against `maxRunning` and refuse a claim for the wrong
 * reason, which is a green case for a false statement.
 * `tests/store-jobs-parity.test.ts` learned the same thing about its owner.
 */
const made: string[] = [];

function aJob(): Job {
  const id = mintId();
  made.push(id);
  return {
    id,
    ownerId: environmentOwnerId(),
    slug: `test-two-servers-${id}`,
    steps: [{ name: "fetch", label: "Fetching the page", status: "pending" }] as JobStep[],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}

afterEach(async () => {
  /* **Both halves, and the second one is new.** `forgetForTests` takes the
     records off the disk by name — never by sweeping the directory, since
     `data/_jobs/` holds this installation's real records too — *and* clears the
     in-memory maps. Deleting only the files was enough while those maps died
     with the module; they belong to the process now, so a claimed job left in
     `index` would outlive `vi.resetModules()` and be counted by the next case.
     GPT Sol, reviewing this plan. */
  await forgetForTests(made.splice(0));
});

describe("one job, two servers over the same data directory", () => {
  it("refuses the second server a job the first is already inside", async () => {
    const first = await aServer();
    const job = aJob();
    /* `created`, or every assertion below could be a statement about a job
       some other run left behind under the same id. */
    expect((await first.fsJobStore.enqueueOrGet(job, "work-key-1")).created).toBe(true);

    const held = await first.fsJobStore.claim(
      job.id,
      job.ownerId,
      mintAttempt(),
      LEASE_MS,
      MAX_RUNNING,
    );
    expect(held.kind).toBe("claimed");

    /* The restart happens now — after the claim — so the new copy's first read
       of the directory is the one that matters. This is the path that spends
       money: `loadFromDisk` calls `sweepStopped`, which returns a `running` job
       to `queued` on the premise that "this process has just started, so nothing
       on disk can have work happening against it". The process did not start.
       Only the module did, and the first copy is inside an eight-minute model
       call at the time. */
    const second = await aServer();
    const race = await second.fsJobStore.claim(
      job.id,
      job.ownerId,
      mintAttempt(),
      LEASE_MS,
      MAX_RUNNING,
    );

    expect(race.kind).toBe("busy");
  });

  it("refuses it even when the second copy was already awake", async () => {
    const first = await aServer();
    const job = aJob();
    /* `created`, or every assertion below could be a statement about a job
       some other run left behind under the same id. */
    expect((await first.fsJobStore.enqueueOrGet(job, "work-key-2")).created).toBe(true);

    /* Warm and stale rather than swept — this copy read the directory *before*
       the claim. The other half of the same hazard, and the one a second dev
       server on the box actually meets; a `sweepStopped` that learned to leave
       live jobs alone would fix the case above and not this one. */
    const second = await aServer();
    expect((await second.fsJobStore.get(job.id, job.ownerId))?.status).toBe("queued");

    const held = await first.fsJobStore.claim(
      job.id,
      job.ownerId,
      mintAttempt(),
      LEASE_MS,
      MAX_RUNNING,
    );
    expect(held.kind).toBe("claimed");

    const race = await second.fsJobStore.claim(
      job.id,
      job.ownerId,
      mintAttempt(),
      LEASE_MS,
      MAX_RUNNING,
    );

    expect(race.kind).toBe("busy");
  });

  /**
   * The other direction, and it is the one a fence gets wrong second: having
   * refused, it has to let go. A queue that can be wedged by a claim nobody
   * holds is worse than the duplication it was built to stop.
   */
  it("lets the second server in once the first has put the job down", async () => {
    const first = await aServer();
    const job = aJob();
    /* `created`, or every assertion below could be a statement about a job
       some other run left behind under the same id. */
    expect((await first.fsJobStore.enqueueOrGet(job, "work-key-3")).created).toBe(true);

    const attempt = mintAttempt();
    expect(
      (await first.fsJobStore.claim(job.id, job.ownerId, attempt, LEASE_MS, MAX_RUNNING)).kind,
    ).toBe("claimed");

    const steps: JobStep[] = [{ name: "fetch", label: "Fetching the page", status: "done" }];
    await first.fsJobStore.releaseStep(job.id, attempt, steps, {});

    const second = await aServer();
    const next = await second.fsJobStore.claim(
      job.id,
      job.ownerId,
      mintAttempt(),
      LEASE_MS,
      MAX_RUNNING,
    );

    expect(next.kind).toBe("claimed");
  });

  /**
   * And a claimant that never came back must not hold the job for ever.
   *
   * **The ending is a settlement, not a takeover** — src/jobs.ts § LEASE_MS:
   * *"An expired lease is not a takeover. The job is failed and Retry is the
   * reader's move."* So what this pins is that the lapse is still *reachable*
   * once the fence is shared: `settleExpired`, which `advanceJobWith` runs at
   * the top of every advance, ends the job, and the next copy is told `finished`
   * rather than `busy` for ever.
   *
   * Worth writing down because the first draft of this case asserted a takeover
   * and went green before the fix for the wrong reason: `sweepStopped` requeued
   * the job, which is a *cold start's* answer and means "the process is gone".
   * It was not gone. That is the bug, not the recovery.
   */
  it("settles a job whose claimant's lease lapsed, rather than holding it for ever", async () => {
    const first = await aServer();
    const job = aJob();
    /* `created`, or every assertion below could be a statement about a job
       some other run left behind under the same id. */
    expect((await first.fsJobStore.enqueueOrGet(job, "work-key-4")).created).toBe(true);

    expect(
      (await first.fsJobStore.claim(job.id, job.ownerId, mintAttempt(), 1, MAX_RUNNING)).kind,
    ).toBe("claimed");
    // One millisecond of lease, and a tick to make sure it is behind us.
    await new Promise((r) => setTimeout(r, 5));

    const second = await aServer();
    expect((await second.fsJobStore.settleExpired()).map((s) => s.id)).toContain(job.id);

    const after = await second.fsJobStore.claim(
      job.id,
      job.ownerId,
      mintAttempt(),
      LEASE_MS,
      MAX_RUNNING,
    );

    expect(after.kind).toBe("finished");
  });
});
