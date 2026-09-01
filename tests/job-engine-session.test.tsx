/**
 * **A reply from the previous session may not land in this one.**
 *
 * The engine outlives every route and every mount, so it also outlives a change
 * of reader — and a `GET /api/jobs` that was in flight when the old session
 * ended will still resolve. Nothing on the wire says whose it was: a public job
 * omits `ownerId` entirely, so the engine cannot look at the list and work out
 * that it belongs to the person who just signed out. **The session key is the
 * only thing that knows**, which is why `start` takes `user.id` and not a
 * truthy user, and why every request captures a generation and every callback
 * checks it.
 *
 * ## Three things carry that generation, and two of them were added afterwards
 *
 * The poll was fenced from the start. GPT Sol's review of the built code found
 * the other two, and each has a case below:
 *
 * - a **drive loop** claims its job id, and used to release it unconditionally
 *   — so an old loop waking up late handed the *new* session's job back to be
 *   driven a second time;
 * - an **action** is fired by a mounted component rather than by the engine, so
 *   there is no local for it to capture and the epoch has to travel with it.
 *
 * The third half of this — `App`'s own effect, under Strict Mode — is
 * `tests/job-session-effect.test.tsx`, which renders the shipped hook. It used
 * to be a copy of that effect written out here, and a copy stays green while
 * the original drifts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../src/types.js";
import { type Advanced, createJobEngine, type JobEngineDeps } from "../src/web/jobEngine.js";

const job = (id: string, status: Job["status"]): Job =>
  ({ id, slug: id, status, steps: [] }) as unknown as Job;

/** Each poll's answer is held, so the test decides which one lands first. */
let pending: { release: (jobs: Job[]) => void }[] = [];
let polls = 0;

const deps: JobEngineDeps = {
  listJobs: () => {
    polls += 1;
    return new Promise<Job[]>((resolve) => {
      pending.push({ release: resolve });
    });
  },
  advance: async () => ({ job: job("x", "done"), ran: null, busy: false, done: true }),
  visible: () => true,
  watchVisibility: () => () => {},
};

beforeEach(() => {
  pending = [];
  polls = 0;
});

describe("a session that ends while a poll is in flight", () => {
  it("throws away the old reader's answer and keeps the new one's", async () => {
    const engine = createJobEngine(deps);

    engine.start("reader-a");
    expect(polls).toBe(1);
    const old = pending.shift();
    if (!old) throw new Error("the first poll never went out");

    /* Strict Mode's cleanup, or a sign-out. The first poll is still out there. */
    engine.stop();
    engine.start("reader-a");
    expect(polls).toBe(2);
    const fresh = pending.shift();
    if (!fresh) throw new Error("the second poll never went out");

    /* The new session's answer lands first, and then the old one arrives late —
       which is the ordering that makes this a bug rather than a curiosity. */
    fresh.release([job("mine", "done")]);
    await Promise.resolve();
    old.release([job("theirs", "done")]);
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.getSnapshot().jobs.map((j) => j.id)).toEqual(["mine"]);
  });

  it("clears the previous reader's list at once, rather than when the next answer arrives", async () => {
    /* Sign-out has to be immediate. Waiting for a fresh list would leave one
       reader's queue on screen for whoever signs in next, which is the shape of
       failure `tests/public-network-trace.test.tsx` guards for articles. */
    const engine = createJobEngine(deps);
    engine.start("reader-a");
    pending.shift()?.release([job("theirs", "done")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.getSnapshot().jobs).toHaveLength(1);

    engine.stop();
    expect(engine.getSnapshot().jobs).toEqual([]);
    expect(engine.getSnapshot().loaded).toBe(false);
  });

  it("does not announce the old session's completions to the new one", async () => {
    /* The completion sequence is monotonic across sessions and the *events* are
       dropped, so a cursor captured under the old reader can never be met by a
       new reader's event. */
    const engine = createJobEngine(deps);
    engine.start("reader-a");
    engine.receive([job("a", "running")]);
    engine.receive([job("a", "done")]);
    expect(engine.drainCompletions(0).jobs.map((j) => j.id)).toEqual(["a"]);

    const cursorUnderA = engine.completionCursor();
    engine.stop();
    engine.start("reader-b");
    expect(engine.drainCompletions(0).jobs).toEqual([]);

    engine.receive([job("b", "running")]);
    engine.receive([job("b", "done")]);
    // Numbered past the old cursor, never reusing it.
    expect(engine.completionCursor()).toBeGreaterThan(cursorUnderA);
  });
});

/**
 * **The stale loop's `finally`**, which is the one legacy invariant the
 * refactor silently lost: *one drive loop per job*.
 *
 * `stop` clears the whole `driving` map — it has to, because the next session
 * is entitled to drive the same durable job — so after `stop → start` there are
 * legitimately two loops for one id, one of them fenced and merely waiting for
 * its `/advance` to answer. When it did, its `finally` deleted the id, and the
 * next poll found the job unclaimed and started a *third* loop. The server
 * lease keeps two writers from corrupting anything, which is exactly why this
 * was invisible: nothing failed, requests just doubled and `driverFailures`
 * stopped meaning anything.
 *
 * The `/advance` is held rather than the poll, which is the difference between
 * this and the cases above — deferring only the poll never reaches the loop.
 */
describe("a drive loop that outlives the session that started it", () => {
  let advances: string[] = [];
  let held: ((advanced: Advanced) => void)[] = [];
  let list: Job[] = [];

  const driving: JobEngineDeps = {
    listJobs: async () => list,
    advance: (id) => {
      advances.push(id);
      return new Promise<Advanced>((resolve) => held.push(resolve));
    },
    visible: () => true,
    watchVisibility: () => () => {},
  };

  /** Real timers here, so the engine's own one-second retry cannot fire. */
  const flush = () => new Promise((go) => setTimeout(go, 0));

  it("gives the job back to nobody when it finally exits", async () => {
    advances = [];
    held = [];
    list = [job("j1", "running")];

    const engine = createJobEngine(driving);
    engine.start("reader-a");
    await flush();
    expect(advances, "the first session never started driving").toEqual(["j1"]);

    /* Sign out and back in — or Strict Mode. The first loop is still parked
       inside its `/advance`, and the second one is not a bug. */
    engine.stop();
    engine.start("reader-a");
    await flush();
    expect(advances).toEqual(["j1", "j1"]);

    // The old session's advance answers at last, and its loop unwinds.
    held[0]?.({ job: job("j1", "running"), ran: "fetch", busy: false, done: false });
    await flush();

    /* Anything that finds the job from here on must see it as already driven.
       `receive` is a poll's answer without the timer, which is what the next
       tick of the clock would have done anyway. */
    engine.receive([job("j1", "running")]);
    await flush();

    expect(advances, "a third loop started on a job already being driven").toEqual(["j1", "j1"]);
    engine.stop();
  });
});

/**
 * **An action is the one request the engine did not start**, so it is the one
 * whose fence has to be handed to it.
 *
 * `useJobs.act` captures `epoch()` before the fetch goes out and hands it back
 * with the outcome. Without that, an add reader A pressed a moment before
 * signing out resolves inside reader B's engine and clears B's error, lifts B's
 * authentication pause and pokes B's queue — none of which A's add knows
 * anything about.
 */
describe("an action that resolves after the session it belongs to has ended", () => {
  it("cannot write into the next reader's engine", () => {
    const engine = createJobEngine(deps);
    engine.start("reader-a");
    const epochA = engine.epoch();

    engine.stop();
    engine.start("reader-b");

    /* B is paused on a final 401 of its own, with the server's sentence on
       screen. Both halves are what the stale action would overwrite. */
    engine.actionFailed("Your session has expired.", 401, engine.epoch());
    expect(engine.getSnapshot()).toMatchObject({
      authFailed: true,
      error: "Your session has expired.",
    });

    // A's add finally answers. It does not speak for B.
    engine.actionSucceeded(epochA);
    expect(engine.getSnapshot()).toMatchObject({
      authFailed: true,
      error: "Your session has expired.",
    });
    engine.actionFailed("A's add was refused", null, epochA);
    expect(engine.getSnapshot().error).toBe("Your session has expired.");

    /* The control, without which the assertions above would also pass on an
       engine that had simply stopped listening to actions: B's own action does
       lift B's pause. */
    engine.actionSucceeded(engine.epoch());
    expect(engine.getSnapshot()).toMatchObject({ authFailed: false, error: null });
    engine.stop();
  });
});
