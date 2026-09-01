/**
 * **A poke while the tab is hidden still makes exactly one request.**
 *
 * The rule, and the reason it is a rule: recurring status polls stop dead while
 * nobody is looking, because eight seconds is 450 requests an hour to be told
 * nothing has changed. But an *action* can complete after the reader has
 * switched away — they paste a URL and change tabs while the POST is in flight
 * — and the poke that follows it is the only thing that discovers the job it
 * just created. Drop it and the import never starts, in a tab whose reader is
 * doing something else, which is the failure nobody would ever reproduce.
 *
 * GPT Sol named this as the invariant most likely to be lost in the engine
 * refactor, because the conventional way to write a poller puts
 * `if (!visible()) return` at the top of `poll` and silently eats it — **and
 * nothing in the suite proved it.** `tests/idle-work.test.ts` proves hidden
 * polls stop, that driving continues, that a failed advance is retried, and
 * that coming back polls at once. It has never had a poke in it.
 *
 * Everything is injected, so no server runs: locally the real one advances jobs
 * itself and answers the browser `busy`, which would hide the difference
 * between a client that reconciled and one that did not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";
import { type Advanced, createJobEngine, type JobEngineDeps } from "../src/web/jobEngine.js";

const job = (id: string, status: Job["status"]): Job =>
  ({ id, slug: "a-piece", status, steps: [] }) as unknown as Job;

let jobs: Job[] = [];
let polls = 0;
let advances = 0;
let visible = true;

const deps: JobEngineDeps = {
  listJobs: async () => {
    polls += 1;
    return jobs;
  },
  advance: async (id): Promise<Advanced> => {
    advances += 1;
    /* `busy`, so the driver paces itself on a timer rather than spinning to
       completion inside one flush — the same reason `tests/idle-work.test.ts`
       gives. */
    return { job: job(id, "running"), ran: null, busy: true, done: false };
  },
  visible: () => visible,
  watchVisibility: () => () => {},
};

beforeEach(() => {
  jobs = [];
  polls = 0;
  advances = 0;
  visible = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a poke from a hidden tab", () => {
  it("reconciles once, arms no timer, and drives whatever it found", async () => {
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    /* A subscriber, so the engine is on its idle cadence and the hidden case
       below is a change of behaviour rather than a queue that was asleep
       anyway. */
    engine.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toBe(1);

    visible = false;
    polls = 0;

    /* The action's own `finally`, which is all `poke` is. The job it created is
       waiting in the list the poke is about to fetch. */
    jobs = [job("j1", "running")];
    engine.poke();
    await vi.advanceTimersByTimeAsync(0);

    // One reconciliation, and it happened even though nobody is looking.
    expect(polls).toBe(1);

    /* And no timer was armed by it. Well past the idle interval, and past
       several of them, there is still exactly the one request. */
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls).toBe(1);

    /* The point of making the request at all: the job it found is being driven,
       hidden or not. Driving is work the reader asked for; polling is work we
       invented. */
    expect(advances).toBeGreaterThan(1);
  });

  it("still polls immediately when the reader comes back", async () => {
    /* The other side of the same coin, kept here because the assertion above —
       "no second poll for a minute" — would also pass if polling had simply
       broken. */
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    engine.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    visible = false;
    await vi.advanceTimersByTimeAsync(60_000);
    polls = 0;

    visible = true;
    engine.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toBe(1);

    // And now the clock is running again, because somebody is looking.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls).toBeGreaterThan(3);
  });
});
