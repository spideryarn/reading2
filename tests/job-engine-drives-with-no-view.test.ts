/**
 * **An ingest keeps moving with no page mounted at all.**
 *
 * This is the whole point of the engine, stated as the one thing that was not
 * true before it. On Vercel the browser is the worker — `pump` in src/jobs.ts
 * returns early when `VERCEL` is set — and the loop that called
 * `POST /api/jobs/:id/advance` lived inside `useJobs`, which is mounted from
 * the shelf, the add page and the reading-view bands. `App()` is a chain of
 * early returns, so a route change unmounted every one of them and `drive`'s
 * `while (alive())` stopped. **Paste a URL, click into the article to read
 * while you wait, and the import stopped.**
 *
 * ## Why this test and not "mount the reading view"
 *
 * The plan's first draft said: mount the reading view and assert `/advance` is
 * still called. That proves the wrong thing. After the fix *nothing*
 * route-scoped drives, so a reading-view test is green before and after — it
 * would only ever have been measuring whichever hook happened to be on that
 * page. The measurement that means something is the absence of React
 * altogether, and it is writable only because `createJobEngine` takes its
 * dependencies.
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

  it("keeps driving across the route change that used to stop it", async () => {
    /* The reader is on the shelf: a subscriber is mounted, and the job is
       found. Then they click into the article, every route-scoped hook
       unmounts, and the *only* thing left is the engine. */
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
