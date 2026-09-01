/**
 * **What a final 401 does, and the two ways back out of it.**
 *
 * `apiFetch` already refreshes the token once and retries once, so a 401 that
 * reaches the engine is the server's settled answer rather than a refresh race
 * (src/web/lib/api.ts). The rule that follows is: stop asking, say so, and stay
 * stopped until something says the credentials are good again. A poller that
 * kept going would fire a 401 a second for as long as the tab is open, and it
 * would do it silently.
 *
 * ## Why the whole file exists, which is the half that was missing
 *
 * The detection was built and the pause was not, and GPT Sol's review of the
 * built code named three holes in it — each of which has a case below:
 *
 *  1. `poll()` had no guard of its own. A `poke` arriving while the poll that
 *     was *about* to 401 was still in flight set `again`, and the `finally`
 *     started one more poll on the way out. If that one succeeded it cleared
 *     `error` and left `authFailed` true: **an engine that has stopped and says
 *     nothing**, which is the shape docs/reusable/silent-success.md is about.
 *  2. Nothing resumed it when the reader's next token arrived. `useSession`
 *     hears every Supabase event, but `App`'s effect depended only on the
 *     reader id — which had not changed — so a pause outlived the thing that
 *     fixed it, until the reader pressed something or reloaded.
 *  3. An action's status was dropped on the floor, so the one refusal that
 *     means "stop asking" was the one this path could not see.
 *
 * Everything is injected. A 401 against the real dev server is not reproducible
 * on demand, and what is being tested is the client's *reaction*, not the
 * server's answer.
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

const EXPIRED = "Your session has expired.";

let polls = 0;
let advances = 0;
/** Each poll's answer, held, so a test can decide what arrives and when. */
let pending: { ok: (jobs: Job[]) => void; no: (err: unknown) => void }[] = [];
/** What the next `/advance` does. */
let advanceRefuses = false;

const deps: JobEngineDeps = {
  listJobs: () => {
    polls += 1;
    return new Promise<Job[]>((resolve, reject) => {
      pending.push({ ok: resolve, no: reject });
    });
  },
  advance: async (id): Promise<Advanced> => {
    advances += 1;
    if (advanceRefuses) throw refusal(401, EXPIRED);
    return { job: job(id, "running"), ran: null, busy: true, done: false };
  },
  visible: () => true,
  watchVisibility: () => () => {},
};

/** Let every promise the engine is waiting on settle, and any timer fire. */
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  polls = 0;
  advances = 0;
  pending = [];
  advanceRefuses = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a final 401 on the job list", () => {
  it("stops everything, says so, and does not creep back on a queued poke", async () => {
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    /* A mounted subscriber, so the idle cadence is armed and "no more requests"
       below is a change of behaviour rather than an engine that was asleep. */
    engine.subscribe(() => {});
    await settle();
    expect(polls, "the session poll never went out").toBe(1);

    /* **Hole 1.** An action's poke lands while the doomed poll is still out,
       which is not a contrivance: an action is what most often precedes a 401,
       and `act` pokes in its own `finally`. */
    engine.poke();
    pending.shift()?.no(refusal(401, EXPIRED));
    await settle();

    expect(engine.getSnapshot()).toMatchObject({ authFailed: true, error: EXPIRED });
    expect(polls, "the queued poke restarted the poller anyway").toBe(1);

    // And it stays stopped. Ten minutes is seventy-five idle polls' worth.
    await settle(10 * 60_000);
    expect({ polls, advances }).toEqual({ polls: 1, advances: 0 });
  });

  it("comes back when the reader's next token arrives, without them doing anything", async () => {
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    await settle();
    pending.shift()?.no(refusal(401, EXPIRED));
    await settle();
    expect(engine.getSnapshot().authFailed).toBe(true);

    /* **Hole 2**, from the engine's side. `App` calls this on a new access
       token for the unchanged reader — see `useJobSession` in useJobs.ts and
       tests/job-session-effect.test.tsx, which drives the same thing through
       the real effect. */
    engine.resume();
    await settle();
    expect(polls, "resume asked for nothing").toBe(2);

    pending.shift()?.ok([job("j1", "running")]);
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ authFailed: false, error: null, loaded: true });
    // And the driver it found is running again, which is what the pause stopped.
    expect(advances).toBeGreaterThan(0);
  });

  it("is a no-op when nothing is paused, so an hourly refresh costs nothing", async () => {
    /* The control for the case above. Tokens refresh about once an hour whether
       or not anything is wrong, and `resume` is called on every one of them. */
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    await settle();
    pending.shift()?.ok([]);
    await settle();
    const before = polls;

    engine.resume();
    engine.resume();
    await settle();
    expect(polls).toBe(before);
  });

  it("comes back on an action that succeeds", async () => {
    /* The other way out, and the one that existed already: the engine stopped
       because the server said no, and this is the server saying yes. */
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    await settle();
    pending.shift()?.no(refusal(401, EXPIRED));
    await settle();
    expect(engine.getSnapshot().authFailed).toBe(true);

    engine.actionSucceeded(engine.epoch());
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ authFailed: false, error: null });
    expect(polls).toBe(2);
  });
});

describe("a final 401 on anything else", () => {
  it("pauses on a refused action, which used to lose the status altogether", async () => {
    /* **Hole 3.** `act` passed only `err.message`, so an action's 401 read as
       an ordinary failure: `error` was set, the poke went out, and the poller
       carried on firing 401s. */
    const engine = createJobEngine(deps);
    engine.start("reader-1");
    await settle();
    pending.shift()?.ok([]);
    await settle();
    const before = polls;

    engine.actionFailed(EXPIRED, 401, engine.epoch());
    await settle(10 * 60_000);

    expect(engine.getSnapshot()).toMatchObject({ authFailed: true, error: EXPIRED });
    expect(polls, "a refused action left the poller running").toBe(before);
  });

  it("pauses on a refused advance, and stops driving", async () => {
    /* The driver is the half that keeps going while the tab is hidden, so it is
       also the half that would sit there failing where nobody could see it. */
    const engine = createJobEngine(deps);
    advanceRefuses = true;
    engine.start("reader-1");
    await settle();
    pending.shift()?.ok([job("j1", "running")]);
    await settle();

    expect(advances).toBe(1);
    expect(engine.getSnapshot()).toMatchObject({ authFailed: true, error: EXPIRED });

    await settle(10 * 60_000);
    expect({ polls, advances }).toEqual({ polls: 1, advances: 1 });
  });
});
