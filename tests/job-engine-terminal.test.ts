/**
 * **`watchTerminal` — the job engine telling a caller once when a job ends.**
 *
 * The batch upload holds one of its three slots until the file's job has
 * ended, so a seam that hears only `done` would stall the batch on the first
 * failure, and one that hears only the poll would stall it behind a hidden tab.
 * Plan 261001m § What Sol's plan review changed, item 4: done, error and
 * cancelled; completion while the tab is hidden; completion seen only through
 * `/advance`; a job trimmed before the next poll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";
import {
  type Advanced,
  createJobEngine,
  type JobEngineDeps,
  type TerminalOutcome,
} from "../src/web/jobEngine.js";

const job = (id: string, status: Job["status"]): Job =>
  ({ id, slug: `slug-${id}`, status, steps: [] }) as unknown as Job;

/** The list the next poll answers with, and how many polls there were. */
let list: Job[] = [];
let polls = 0;
/** What the next `/advance` says, by job id. Missing means "still busy". */
let advanceAnswer: Record<string, Job["status"]> = {};
let hidden = false;
let onVisibility: (() => void) | null = null;
/** A list request held open until the test lets it go. */
let held: { resolve: (jobs: Job[]) => void } | null = null;
let hold = false;

const deps: JobEngineDeps = {
  listJobs: () => {
    polls += 1;
    if (hold) {
      return new Promise<Job[]>((resolve) => {
        held = { resolve };
      });
    }
    return Promise.resolve(list);
  },
  advance: async (id): Promise<Advanced> => {
    const status = advanceAnswer[id] ?? "running";
    const done = status !== "running" && status !== "queued";
    return { job: job(id, status), ran: null, busy: !done, done };
  },
  visible: () => !hidden,
  watchVisibility: (cb) => {
    onVisibility = cb;
    return () => {
      onVisibility = null;
    };
  },
};

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  list = [];
  polls = 0;
  advanceAnswer = {};
  hidden = false;
  onVisibility = null;
  held = null;
  hold = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** An engine started for one reader, its first poll landed on `initial`. */
async function started(initial: Job[] = []) {
  list = initial;
  const engine = createJobEngine(deps);
  engine.start("reader-1");
  await settle();
  return engine;
}

function watch(engine: ReturnType<typeof createJobEngine>, id: string) {
  const heard: TerminalOutcome[] = [];
  engine.watchTerminal(id, (o) => heard.push(o));
  return heard;
}

describe("watchTerminal", () => {
  it.each([
    ["done", "done"],
    ["error", "error"],
    ["cancelled", "cancelled"],
  ] as const)("hears a job that ends %s in the list", async (status, kind) => {
    /* `/advance` never answers terminal here, so the list is the only source. */
    const engine = await started([job("j1", "running")]);
    const heard = watch(engine, "j1");
    list = [job("j1", status)];
    await settle(1000);
    expect(heard.map((o) => o.kind)).toEqual([kind]);
    /* Once only, however many more lists say so. */
    await settle(3000);
    expect(heard).toHaveLength(1);
  });

  it("hears a completion that only /advance reports, behind a hidden tab", async () => {
    const engine = await started([job("j1", "running")]);
    const heard = watch(engine, "j1");
    hidden = true;
    onVisibility?.();
    const pollsWhenHidden = polls;
    /* The list would still say running; nobody asks it while hidden. */
    advanceAnswer.j1 = "done";
    await settle(10_000);
    expect(polls, "polled while hidden").toBe(pollsWhenHidden);
    expect(heard.map((o) => o.kind)).toEqual(["done"]);
  });

  it("hears an error that only /advance reports", async () => {
    const engine = await started([job("j1", "running")]);
    const heard = watch(engine, "j1");
    advanceAnswer.j1 = "error";
    await settle(5000);
    expect(heard.map((o) => o.kind)).toEqual(["error"]);
  });

  it("reports a job trimmed before the next poll as vanished", async () => {
    const engine = await started([job("j1", "running")]);
    const heard = watch(engine, "j1");
    list = [];
    await settle(1000);
    expect(heard.map((o) => o.kind)).toEqual(["vanished"]);
  });

  it("never calls a job vanished from a list that was asked before it was watched", async () => {
    const engine = await started([]);
    hold = true;
    engine.poke();
    await settle();
    expect(held, "the poll did not go out").not.toBeNull();
    /* The POST that made j1 lands while that list is on the wire. */
    const heard = watch(engine, "j1");
    hold = false;
    held?.resolve([]);
    await settle();
    expect(heard, "an older list's silence was read as a vanishing").toEqual([]);
    /* The next list, asked after, does count — and here it has the job. */
    list = [job("j1", "done")];
    await settle(1000);
    expect(heard.map((o) => o.kind)).toEqual(["done"]);
  });

  it("keeps asking while a watcher waits, even with nothing busy and nobody subscribed", async () => {
    const engine = await started([]);
    const before = polls;
    const heard = watch(engine, "j1");
    /* The job appears only on a later list. */
    await settle(1000);
    expect(polls).toBeGreaterThan(before);
    expect(heard.map((o) => o.kind)).toEqual(["vanished"]);
  });

  it("keeps a watcher's timer when the last ordinary subscriber leaves", async () => {
    const engine = await started([]);
    const leave = engine.subscribe(() => {});
    await settle();
    const heard = watch(engine, "j1");
    const before = polls;
    leave();
    await settle(1000);
    expect(polls, "the subscriber took the watcher's poll timer with it").toBeGreaterThan(before);
    expect(heard.map((outcome) => outcome.kind)).toEqual(["vanished"]);
  });

  it("reports a job already terminal in the snapshot, but not synchronously", async () => {
    const engine = await started([job("j1", "error")]);
    const heard = watch(engine, "j1");
    expect(heard, "called inside watchTerminal").toEqual([]);
    await settle();
    expect(heard.map((o) => o.kind)).toEqual(["error"]);
  });

  it("drops every watcher, uncalled, when the session ends", async () => {
    const engine = await started([job("j1", "running")]);
    const heard = watch(engine, "j1");
    engine.stop();
    engine.start("reader-2");
    list = [job("j1", "done")];
    await settle(2000);
    expect(heard, "a previous reader's watcher heard the next reader's list").toEqual([]);
  });

  it("stops listening when the caller unsubscribes", async () => {
    const engine = await started([]);
    const heard: TerminalOutcome[] = [];
    const off = engine.watchTerminal("j1", (o) => heard.push(o));
    off();
    const before = polls;
    list = [job("j1", "done")];
    await settle(1000);
    expect(heard).toEqual([]);
    expect(polls, "an abandoned watcher left a poll behind").toBe(before);
  });
});
