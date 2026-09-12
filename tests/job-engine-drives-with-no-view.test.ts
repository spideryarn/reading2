/**
 * **An ingest keeps moving with no page mounted at all.**
 *
 * This is the whole point of the engine, stated as the one thing that was not
 * true before it. On Vercel the browser is the worker — `pump` in src/jobs.ts
 * returns early when `VERCEL` is set — and the loop that called
 * `POST /api/jobs/:id/advance` lived inside `useJobs`, which is mounted from
 * `Library`, `AddPage` and `useStepJob`. `App()` is a chain of early returns,
 * so **whether an import kept moving depended on whether the page the reader
 * happened to open mounted one of those three**, and `drive`'s `while (alive())`
 * stopped when it did not. `/profile`, `/design`, `/admin` and the landing page
 * mount none of them.
 *
 * ## Not the reading view, which the first version of this comment said it was
 *
 * `useArc` runs on every owned reading view and reaches `useJobs` through
 * `useStepJob`, so clicking from the shelf into an article kept driving all
 * along. That sentence was mount accounting written from memory rather than
 * from the imports — the same mistake that made the original bug hard to see,
 * so it is corrected here rather than quietly dropped.
 *
 * What survives is the reason that never depended on the count: driving
 * belonged to whichever unrelated feature hook the current route happened to
 * mount, which is working by accident.
 *
 * ## Why this test and not "mount the reading view"
 *
 * The plan's first draft said: mount the reading view and assert `/advance` is
 * still called. That proves the wrong thing, and now doubly so — it was green
 * before the fix as well as after, because that route always did mount a hook.
 * The measurement that means something is the absence of React altogether, and
 * it is writable only because `createJobEngine` takes its dependencies.
 *
 * ## Why it cannot be an end-to-end test
 *
 * Everything here is injected. Against a real local server the browser's
 * advances are answered `busy` — the in-process queue owns the job on this
 * laptop — so a broken driver and a working one look identical, and the bug
 * this file is about is invisible without `VERCEL` set. A fake server that
 * always answers is what makes the assertion mean the client did the work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/types.js";
import { type Advanced, createJobEngine, type JobEngineDeps } from "../src/web/jobEngine.js";

const job = (id: string, status: Job["status"]): Job =>
  ({ id, slug: "a-piece", status, steps: [] }) as unknown as Job;

interface Server {
  jobs: Job[];
  polls: number;
  /** How many list requests fail before the fake server answers. */
  pollFailures: number;
  /** How many list requests return a body the client cannot apply. */
  malformedPolls: number;
  advances: string[];
  /** How many more advances answer "not done yet". */
  stepsLeft: number;
  /** Answer `busy`, as this laptop's in-process queue makes the server do, so
   *  the driver paces itself on a real timer instead of spinning through
   *  microtasks and finishing inside one flush. */
  busy: boolean;
  visible: boolean;
  onVisibility: (() => void) | null;
}

let server: Server;

function deps(): JobEngineDeps {
  return {
    listJobs: async () => {
      server.polls += 1;
      if (server.pollFailures > 0) {
        server.pollFailures -= 1;
        throw new Error("a transient list failure");
      }
      if (server.malformedPolls > 0) {
        server.malformedPolls -= 1;
        return undefined as unknown as Job[];
      }
      return server.jobs;
    },
    advance: async (id): Promise<Advanced> => {
      server.advances.push(id);
      if (server.busy) return { job: job(id, "running"), ran: null, busy: true, done: false };
      if (server.stepsLeft > 0) {
        server.stepsLeft -= 1;
        return { job: job(id, "running"), ran: "fetch", busy: false, done: false };
      }
      server.jobs = [job(id, "done")];
      return { job: job(id, "done"), ran: null, busy: false, done: true };
    },
    visible: () => server.visible,
    watchVisibility: (onChange) => {
      server.onVisibility = onChange;
      return () => {
        server.onVisibility = null;
      };
    },
  };
}

/** Let every promise the engine is waiting on settle, and any timer fire. */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  server = {
    jobs: [],
    polls: 0,
    pollFailures: 0,
    malformedPolls: 0,
    advances: [],
    stepsLeft: 0,
    busy: false,
    visible: true,
    onVisibility: null,
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the job engine, with nothing rendered", () => {
  it("polls once when the session starts, and drives what it finds to done", async () => {
    server.jobs = [job("j1", "running")];
    server.stepsLeft = 4;

    const engine = createJobEngine(deps());
    engine.start("reader-1");
    await settle();

    /* Five advances: four steps and the one that answers `done`. Nothing was
       mounted, and nothing needed to be. */
    expect(server.advances).toEqual(["j1", "j1", "j1", "j1", "j1"]);
    expect(engine.getSnapshot().loaded).toBe(true);
  });

  it("retries a failed session-start poll and drives the job it then finds", async () => {
    /* A queued job can predate this page load: the reader reloaded, returned
       after signing in, or another tab started it. On a quiet reading view no
       mounted subscriber buys the idle cadence, so the session's own first
       reconciliation has to survive a transient failure by itself. */
    server.jobs = [job("j1", "running")];
    server.pollFailures = 1;
    server.stepsLeft = 1;

    const engine = createJobEngine(deps());
    engine.start("reader-1");
    await settle(30_000);

    expect(server.polls, "the failed opening poll was retried").toBeGreaterThan(1);
    expect(server.advances, "the pre-existing job was discovered and driven").toContain("j1");
    expect(engine.getSnapshot().loaded).toBe(true);
  });

  it("does not discharge reconciliation until the returned job list was applied", async () => {
    /* A 200 with a malformed body is not a successful reconciliation. During
       a rolling client/server change, treating it as one would stop a quiet
       page with the durable job still undiscovered. */
    server.jobs = [job("j1", "running")];
    server.malformedPolls = 1;

    const engine = createJobEngine(deps());
    engine.start("reader-1");
    await settle(30_000);

    expect(server.polls, "the unusable list response was retried").toBeGreaterThan(1);
    expect(server.advances, "the job in the next valid list was driven").toContain("j1");
    expect(engine.getSnapshot().loaded).toBe(true);
  });

  it("keeps driving across a route change that mounts nothing", async () => {
    /* The reader is on the shelf: a subscriber is mounted, and the job is
       found. Then they open their profile — every route-scoped hook unmounts,
       nothing on that page mounts another, and the *only* thing left is the
       engine. */
    server.jobs = [job("j1", "running")];
    server.busy = true;
    const engine = createJobEngine(deps());
    engine.start("reader-1");
    const unsubscribe = engine.subscribe(() => {});
    await settle();

    unsubscribe();
    const before = server.advances.length;
    await settle(5_000);

    expect(server.advances.length).toBeGreaterThan(before);
  });

  it("stops driving once the reader's session ends", async () => {
    /* The other half, and the one that makes the first mean something: `stop`
       is not "leave it running for ever". Sign out and the loop is fenced — the
       durable job is untouched and is reconciled when its owner returns. */
    server.jobs = [job("j1", "running")];
    server.busy = true;
    const engine = createJobEngine(deps());
    engine.start("reader-1");
    await settle();

    engine.stop();
    await settle();
    const after = server.advances.length;
    await settle(10_000);

    expect(server.advances.length).toBe(after);
    expect(engine.getSnapshot()).toEqual({
      jobs: [],
      loaded: false,
      error: null,
      driverFailures: {},
      authFailed: false,
    });
  });

  it("sleeps rather than polling for ever when nothing is running and nobody is watching", async () => {
    /* The cost of making the engine route-independent, and the rule that keeps
       it from becoming an unbounded idle poll on every reading view: an owner
       with nothing in the queue pays one request at session start and then
       nothing at all. */
    const engine = createJobEngine(deps());
    engine.start("reader-1");
    await settle();
    expect(server.polls).toBe(1);

    await settle(120_000);
    expect(server.polls).toBe(1);
  });
});
