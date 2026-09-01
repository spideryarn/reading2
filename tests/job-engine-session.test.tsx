// @vitest-environment jsdom
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
 * ## Strict Mode is not a special case, it is the ordinary one
 *
 * React runs mount effects twice in development, so `App`'s effect really does
 * fire `start → stop → start` on every load, with the first poll still in
 * flight across the middle. That is the same sequence as a fast sign-out and
 * sign-in, and if the fence is wrong it shows up as a snapshot that flickers
 * back to a stale list — which reads as a race and is deterministic.
 *
 * Both halves are here: the sequence at the engine's own seam, and the effect
 * `App.tsx` actually writes, rendered under `<StrictMode>`.
 */
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Job } from "../src/types.js";
import { createJobEngine, type JobEngineDeps } from "../src/web/jobEngine.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("the effect App.tsx writes, under Strict Mode", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("ends with exactly one live session after start → stop → start", async () => {
    const engine = createJobEngine(deps);
    const Gate = ({ readerId }: { readerId: string | null }) => {
      useEffect(() => {
        if (!readerId) return;
        engine.start(readerId);
        return () => engine.stop();
      }, [readerId]);
      return null;
    };

    await act(async () => {
      root.render(
        createElement(StrictMode, null, createElement(Gate, { readerId: "reader-a" })),
      );
    });

    /* Two polls, because Strict Mode really did mount twice — and the released
       first one must not be able to write. */
    const first = pending.shift();
    const second = pending.shift();
    if (!first || !second) throw new Error(`expected two polls, saw ${polls}`);

    second.release([job("live", "running")]);
    await act(async () => {
      await Promise.resolve();
    });
    first.release([job("stale", "done")]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(engine.getSnapshot().jobs.map((j) => j.id)).toEqual(["live"]);
    // And the stale reply announced nothing to anybody.
    expect(engine.drainCompletions(0).jobs).toEqual([]);
  });
});
