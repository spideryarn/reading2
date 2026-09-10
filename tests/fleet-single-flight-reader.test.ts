/**
 * **THE SHARED READ CORE, TESTED ON ITS OWN PROMISES** — the machinery that
 * `useActions.ts` (`actionsReader`) and `FeedPanel.tsx` (`feedReader`) both
 * delegate to since plan 260910c's extraction.
 *
 * The two hooks' suites (fleet-actions-freshness, fleet-feed-freshness) prove
 * the behaviour through React. These prove the core directly, with a read
 * double whose every call is recorded and whose promise the test settles by
 * hand — including one that ignores its signal and never settles, because a
 * deadline that waits for the read to honour abort is not a deadline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { singleFlightReader, type SingleFlightOptions } from "../tools/fleet/web/src/single-flight-reader";

type Outcome = { ok: true; value: string } | { ok: false; why: string };

type Call = {
  signal: AbortSignal;
  resolve: (value: string) => void;
  reject: (cause: unknown) => void;
};

const DEADLINE = 8_000;

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse("2026-09-10T12:00:00.000Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A reader over a hand-settled read, recording every call, start and settle. */
function harness(extra: Partial<SingleFlightOptions<Outcome>> = {}) {
  const calls: Call[] = [];
  const settled: Outcome[] = [];
  const events: string[] = [];
  const reader = singleFlightReader<Outcome>({
    read: (signal) =>
      new Promise<Outcome>((resolve, reject) => {
        events.push("read");
        calls.push({ signal, resolve: (value) => resolve({ ok: true, value }), reject });
      }),
    deadlineMs: DEADLINE,
    noAnswer: (why) => ({ ok: false, why }),
    onSettle: (outcome) => {
      events.push("settle");
      settled.push(outcome);
    },
    onStart: () => events.push("start"),
    onIdle: () => events.push("idle"),
    ...extra,
  });
  return { reader, calls, settled, events };
}

function call(calls: Call[], index: number): Call {
  const found = calls[index];
  if (found === undefined) throw new Error(`no read #${index + 1}; ${calls.length} made`);
  return found;
}

/** Let the read double's promise callbacks run. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("one read in flight", () => {
  it("starts a read on request, hands it a live signal, and delivers its answer", async () => {
    const { reader, calls, settled, events } = harness();
    reader.request();
    expect(calls).toHaveLength(1);
    expect(reader.reading()).toBe(true);
    expect(call(calls, 0).signal.aborted).toBe(false);

    call(calls, 0).resolve("first");
    await flush();
    expect(settled).toEqual([{ ok: true, value: "first" }]);
    expect(reader.reading()).toBe(false);
    expect(events).toEqual(["start", "read", "settle", "idle"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("turns any number of requests during a read into exactly one more, after it", async () => {
    const { reader, calls, settled } = harness();
    reader.request();
    for (let i = 0; i < 5; i += 1) reader.request();
    expect(calls).toHaveLength(1);

    call(calls, 0).resolve("first");
    await flush();
    expect(calls).toHaveLength(2);
    expect(reader.reading()).toBe(true);

    call(calls, 1).resolve("second");
    await flush();
    expect(calls).toHaveLength(2);
    expect(settled).toEqual([
      { ok: true, value: "first" },
      { ok: true, value: "second" },
    ]);
    expect(reader.reading()).toBe(false);
  });

  it("says idle only when nothing follows, and starts the pending read in its place", async () => {
    const { reader, calls, events } = harness();
    reader.request();
    reader.request();
    call(calls, 0).resolve("first");
    await flush();
    expect(events).toEqual(["start", "read", "settle", "start", "read"]);
    call(calls, 1).resolve("second");
    await flush();
    expect(events.slice(5)).toEqual(["settle", "idle"]);
  });

  it("records a rejected read as no answer, in the core's words", async () => {
    const { reader, calls, settled } = harness();
    reader.request();
    call(calls, 0).reject(new Error("socket hang up"));
    await flush();
    expect(settled).toEqual([{ ok: false, why: "the read failed before it answered: socket hang up" }]);
    expect(reader.reading()).toBe(false);
  });
});

describe("a deadline that does not trust the read", () => {
  it("settles a read that ignores its signal and never resolves, and aborts that signal", async () => {
    const { reader, calls, settled } = harness();
    reader.request();
    await vi.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(settled).toEqual([]);
    expect(reader.reading()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(call(calls, 0).signal.aborted).toBe(true);
    expect(settled).toEqual([
      {
        ok: false,
        why: "the dashboard did not answer within 8s, so this page stopped waiting — the box may be loaded, or the read stuck",
      },
    ]);
    expect(reader.reading()).toBe(false);
    reader.request();
    expect(calls).toHaveLength(2);
  });

  it("carries a request made during a hung read through the deadline", async () => {
    const { reader, calls } = harness();
    reader.request();
    reader.request();
    await vi.advanceTimersByTimeAsync(DEADLINE);
    expect(calls).toHaveLength(2);
    expect(call(calls, 1).signal.aborted).toBe(false);
  });

  it("discards a late answer, and delivers the newer read's instead", async () => {
    const { reader, calls, settled } = harness();
    reader.request();
    await vi.advanceTimersByTimeAsync(DEADLINE);
    reader.request();
    call(calls, 0).resolve("late");
    await flush();
    expect(settled).toHaveLength(1);
    expect(reader.reading()).toBe(true);

    call(calls, 1).resolve("newer");
    await flush();
    expect(settled.map((o) => (o.ok ? o.value : "failed"))).toEqual(["failed", "newer"]);
  });
});

describe("discard and stop", () => {
  it("discard aborts the read, drops the pending one and its answer, and stays usable", async () => {
    const { reader, calls, settled } = harness();
    reader.request();
    reader.request();
    reader.discard();
    expect(call(calls, 0).signal.aborted).toBe(true);
    expect(reader.reading()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    call(calls, 0).resolve("stale");
    await flush();
    expect(settled).toEqual([]);
    expect(calls).toHaveLength(1);

    reader.request();
    expect(calls).toHaveLength(2);
  });

  it("stop aborts the read, discards its answer, leaves no timer, and refuses later requests", async () => {
    const { reader, calls, settled } = harness();
    reader.request();
    reader.request();
    reader.stop();
    expect(call(calls, 0).signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    call(calls, 0).resolve("after stop");
    await flush();
    await vi.advanceTimersByTimeAsync(DEADLINE * 2);
    expect(settled).toEqual([]);

    reader.request();
    expect(calls).toHaveLength(1);
    expect(reader.reading()).toBe(false);
  });
});

describe("the caller's gate", () => {
  it("starts nothing and queues nothing when admit refuses a free slot", () => {
    const { reader, calls, events } = harness({ admit: () => false });
    reader.request();
    expect(calls).toHaveLength(0);
    expect(reader.reading()).toBe(false);
    expect(events).toEqual([]);
  });

  it("does not consult admit for a request during a read, but does for the pending read coming due", async () => {
    let open = true;
    const asked: number[] = [];
    const { reader, calls, events } = harness({
      admit: () => {
        asked.push(calls.length);
        return open;
      },
    });
    reader.request();
    reader.request();
    expect(asked).toEqual([0]);

    open = false;
    call(calls, 0).resolve("first");
    await flush();
    expect(asked).toEqual([0, 1]);
    expect(calls).toHaveLength(1);
    // Refused by the gate, so the caller owns it: no start and no idle.
    expect(events).toEqual(["start", "read", "settle"]);
  });
});
