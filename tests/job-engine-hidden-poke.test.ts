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
/**
 * The engine's own visibility listener, kept so a test can fire it.
 *
 * It used to be `watchVisibility: () => () => {}`, and the "reader comes back"
 * case called `poke()` by hand — so it would have passed on an engine that had
 * stopped subscribing to `visibilitychange` at all, which is the only thing
 * that makes stopping the clock dead safe. GPT Sol, 2026-09-01.
 */
let onVisibility: (() => void) | null = null;

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
  watchVisibility: (onChange) => {
    onVisibility = onChange;
    return () => {
      onVisibility = null;
    };
  },
};

/** What the browser does: change the fact, then tell whoever is listening. */
function look(at: boolean): void {
  visible = at;
  if (!onVisibility) throw new Error("the engine is not watching visibility at all");
  onVisibility();
}

beforeEach(() => {
  jobs = [];
  polls = 0;
  advances = 0;
  visible = true;
  onVisibility = null;
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

    look(false);
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

    look(false);
    await vi.advanceTimersByTimeAsync(60_000);
    polls = 0;

    /* **Through the listener, not by calling `poke` by hand.** The reader
       switching back is a `visibilitychange` event and nothing else, so a test
       that pokes for it proves the poke and leaves the subscription untested —
       and the subscription is the whole safety net under a clock that stops
       dead. */
    look(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toBe(1);

    // And now the clock is running again, because somebody is looking.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls).toBeGreaterThan(3);
  });
});

describe("two mounted subscribers", () => {
  it("still make one poll between them", async () => {
    /* Carried over from the hook this engine replaced, and worth keeping now
       that the subscribers are no longer the thing doing the polling: the shelf
       and a band can be on screen at once, and the reader should not pay twice
       for the same list. Nothing else in the suite counts this. */
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    engine.subscribe(() => {});
    engine.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toBe(1);

    /* And on the cadence afterwards, where a second timer would show up as a
       doubled count rather than as a doubled first request. */
    await vi.advanceTimersByTimeAsync(60_000);
    const both = polls;

    engine.stop();
    polls = 0;
    const alone = createJobEngine(deps);
    alone.start("reader-1");
    alone.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(both).toBe(polls);
    alone.stop();
  });
});

describe("the last idle-cadence subscriber leaving", () => {
  it("cancels an idle poll that was already armed", async () => {
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    const unsubscribe = engine.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(polls).toBe(1);

    /* Closing a band returns the reading view to its quiet state. The poll
       scheduled by the last successful response must not survive that
       unmount and charge the now-idle page one trailing request. */
    unsubscribe();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(polls).toBe(1);
    engine.stop();
  });
});
