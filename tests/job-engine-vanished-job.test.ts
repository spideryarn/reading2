/**
 * **What the drive loop does when the job it is driving no longer exists.**
 *
 * `POST /api/jobs/:id/advance` answers 404 *"No such job"* only when
 * `advanceJob` finds no row (src/routes.ts), and a deleted row does not come
 * back — retention can take a terminal job out from under a tab that is still
 * driving it. Every other rejection is worth retrying; this one is the server
 * answering the question for good, so the loop is over.
 *
 * Until 2026-09-03 it was counted as transient like the rest: a request every
 * eight seconds, for as long as the tab stayed open, saying nothing. Found
 * while writing up
 * docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md,
 * where this loop is one of three safety nets that were disarmed at once.
 *
 * **The four assertions belong together.** Three of them pass today by accident
 * of a single-shot test — one attempt, no wait and a dead loop are also what
 * "the test only ran one turn" looks like. Only all four at once say that a 404
 * ends the loop rather than starting the next round of it. ⟨Sol⟩
 *
 * `listJobs` is left pending throughout, on purpose: with no poll landing there
 * is no `schedule`, so **every timer in this file belongs to the drive loop**
 * and `vi.getTimerCount()` is a direct reading of "did it sit down and wait".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";
import { type Advanced, createJobEngine, type JobEngineDeps } from "../src/web/jobEngine.js";

const job = (id: string, status: Job["status"]): Job =>
  ({ id, slug: "a-piece", status, steps: [] }) as unknown as Job;

/** What `readJson` throws for a refusal: an `Error` carrying the status.
 *  Duck-typed on purpose — `statusOf` reads `.status` and nothing else. */
const refusal = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

let advances = 0;
/** What the next `/advance` rejects with, or null to succeed and stay busy. */
let advanceRefusal: Error | null = null;

const deps: JobEngineDeps = {
  /* Never resolved. See the header. */
  listJobs: () => new Promise<Job[]>(() => {}),
  advance: async (id): Promise<Advanced> => {
    advances += 1;
    if (advanceRefusal) throw advanceRefusal;
    return { job: job(id, "running"), ran: null, busy: true, done: false };
  },
  visible: () => true,
  watchVisibility: () => () => {},
};

/** Let every promise the engine is waiting on settle, and any timer fire. */
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  advances = 0;
  advanceRefusal = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a 404 from /advance", () => {
  it("ends the drive loop instead of asking a deleted job to advance for ever", async () => {
    const engine = createJobEngine(deps);
    advanceRefusal = refusal(404, "No such job");
    engine.start("reader-1");
    await settle();
    /* The engine's own input, so nothing here depends on the poll timer. */
    engine.receive([job("j1", "running")]);
    await settle();

    expect(advances, "asked a job that does not exist more than once").toBe(1);
    expect(
      engine.getSnapshot().driverFailures,
      "counted driver ill-health for a job that is gone",
    ).toEqual({});
    expect(vi.getTimerCount(), "sat through the idle wait before giving up").toBe(0);

    // Ten minutes is seventy-five idle retries' worth.
    await settle(10 * 60_000);
    expect(advances, "the loop was still going").toBe(1);
  });

  it("still retries a 500, which is the case the retry was written for", async () => {
    /* The control. A server that is briefly down is exactly what `drive` must
       keep waiting for — the 404 branch must not take that with it. */
    const engine = createJobEngine(deps);
    advanceRefusal = refusal(500, "Something went wrong");
    engine.start("reader-1");
    await settle();
    engine.receive([job("j1", "running")]);
    await settle();

    expect(advances).toBe(1);
    expect(engine.getSnapshot().driverFailures).toEqual({ j1: 1 });
    expect(vi.getTimerCount(), "gave up instead of waiting").toBe(1);

    await settle(8000);
    expect(advances, "the retry never came round").toBe(2);
  });
});
