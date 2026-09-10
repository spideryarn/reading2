// @vitest-environment jsdom
/**
 * The browser's polling transport — tools/fleet/web/src/transport.ts.
 *
 * **It had no tests.** `fetchFleetState` was covered in fleet-web.test.tsx and
 * every component test injects a fake transport, which is the right seam for
 * those and leaves the only thing in the client that owns a fetch, a timer and
 * two window listeners untested by anything. Two defects were living in that
 * gap, and both are about what a page owns after somebody has stopped looking
 * at it (260908f § Bounded transport, checkbox 4):
 *
 *   1. `stop()` did not abort the request in flight, so a closed tab left a
 *      fetch running for up to `REQUEST_TIMEOUT_MS`. Invisible, because the
 *      answer was discarded when it eventually came.
 *   2. A manual refresh during an in-flight request did nothing at all — the
 *      press was absorbed by `inFlight` and the next poll came on the ordinary
 *      schedule, or after a backoff if the in-flight request then failed.
 *
 * A real `AbortSignal` and real timers-under-vi throughout: the assertions are
 * about the signal the fetch was actually handed and about how many requests
 * were actually made, not about a spy having been called.
 */
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_INTERVAL_MS, MAX_INTERVAL_MS, REQUEST_TIMEOUT_MS, pollingTransport } from "../tools/fleet/web/src/transport";
import type { Transport } from "../tools/fleet/web/src/transport";
import { useFleetState } from "../tools/fleet/web/src/useFleetState";
import type { FleetState } from "../tools/fleet/web/src/types";

/** The smallest thing `parseFleetState` accepts. Schema 1, no sessions. */
const EMPTY_FLEET = { schema: 1, rows: [] };

type Call = {
  url: string;
  signal: AbortSignal;
  /** Answer this request with a body the parser will accept. */
  ok: (body?: unknown) => void;
  /** Answer it with an HTTP failure. */
  status: (code: number, text: string) => void;
  /** Fail the request itself, the way a dropped network does. */
  fail: (why: string) => void;
};

let calls: Call[] = [];

function stubFetch(): void {
  calls = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    let settle: (value: Response) => void = () => {};
    let refuse: (cause: unknown) => void = () => {};
    const promise = new Promise<Response>((resolve, reject) => {
      settle = resolve;
      refuse = reject;
    });
    const signal = init.signal as AbortSignal;
    // A real abort rejects the fetch, and the transport's error message depends
    // on being able to tell an abort from a refusal — so the stub does it too.
    signal?.addEventListener("abort", () => refuse(new DOMException("aborted", "AbortError")), { once: true });
    calls.push({
      url,
      signal,
      ok: (body: unknown = EMPTY_FLEET) =>
        settle({ ok: true, status: 200, statusText: "OK", json: async () => body } as unknown as Response),
      status: (code, text) =>
        settle({ ok: false, status: code, statusText: text, json: async () => ({}) } as unknown as Response),
      fail: (why) => refuse(new Error(why)),
    });
    return promise;
  });
}

/** Let the microtask queue and any timer under `ms` run. */
async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function sink(): { states: FleetState[]; errors: string[]; onState: (s: FleetState) => void; onError: (m: string) => void } {
  const states: FleetState[] = [];
  const errors: string[] = [];
  return { states, errors, onState: (s) => states.push(s), onError: (m) => errors.push(m) };
}

beforeEach(() => {
  vi.useFakeTimers();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the polling rhythm", () => {
  it("asks once immediately, then on the interval", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    try {
      await settle();
      expect(calls).toHaveLength(1);
      calls[0]?.ok();
      await settle();
      expect(feed.states).toHaveLength(1);

      await settle(DEFAULT_INTERVAL_MS);
      expect(calls).toHaveLength(2);
    } finally {
      running.stop();
    }
  });

  it("backs off while failing and returns to the interval on the first success", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    try {
      await settle();
      calls[0]?.status(503, "Service Unavailable");
      await settle();
      expect(feed.errors[0]).toContain("503");

      // First failure: the ordinary interval. Second: double it.
      await settle(DEFAULT_INTERVAL_MS);
      expect(calls).toHaveLength(2);
      calls[1]?.status(503, "Service Unavailable");
      await settle();
      await settle(DEFAULT_INTERVAL_MS);
      expect(calls).toHaveLength(2); // not yet — the wait has doubled
      await settle(DEFAULT_INTERVAL_MS);
      expect(calls).toHaveLength(3);

      // And a success puts it straight back.
      calls[2]?.ok();
      await settle();
      await settle(DEFAULT_INTERVAL_MS);
      expect(calls).toHaveLength(4);
      // THE STATE SURVIVED THE FAILURES. A fleet you cannot reach is not an
      // empty fleet — the sink was never handed a null.
      expect(feed.states).toHaveLength(1);
    } finally {
      running.stop();
    }
  });

  it("doubles the wait each failure and then stops at the ceiling", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    try {
      await settle();
      /* The whole curve, asserted to the millisecond rather than sampled.
         **Each request is answered before its wait is measured**, deliberately:
         an unanswered one hits `REQUEST_TIMEOUT_MS` partway through a long
         advance and lands a second failure inside the window being timed,
         which is a test measuring its own arrangement. */
      for (const wait of [DEFAULT_INTERVAL_MS, 10_000, 20_000, 40_000, MAX_INTERVAL_MS, MAX_INTERVAL_MS]) {
        calls[calls.length - 1]?.fail("network down");
        await settle();
        const before = calls.length;
        await settle(wait - 1);
        expect(calls.length).toBe(before);
        await settle(1);
        expect(calls.length).toBe(before + 1);
      }
      // 80s uncapped by the sixth failure; a minute is what it actually waits.
      expect(feed.errors.length).toBeGreaterThanOrEqual(6);
    } finally {
      running.stop();
    }
  });

  it("a request that is never answered times out and says so in words", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    try {
      await settle();
      await settle(REQUEST_TIMEOUT_MS);
      expect(feed.errors[0]).toContain("no answer in 20s");
      expect(calls[0]?.signal.aborted).toBe(true);
    } finally {
      running.stop();
    }
  });

  it("a hidden tab keeps the rhythm without asking", async () => {
    const feed = sink();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const running = pollingTransport()(feed);
    try {
      await settle();
      expect(calls).toHaveLength(0);
      await settle(DEFAULT_INTERVAL_MS * 3);
      // Still nothing asked — but the timer is still running, which is what
      // "keeps the rhythm" means and what the next test depends on.
      expect(calls).toHaveLength(0);

      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      await settle(DEFAULT_INTERVAL_MS);
      expect(calls).toHaveLength(1);
    } finally {
      running.stop();
    }
  });

  it("becoming visible and coming back online each ask immediately", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    try {
      await settle();
      calls[0]?.ok();
      await settle();
      expect(calls).toHaveLength(1);

      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
      expect(calls).toHaveLength(2);
      calls[1]?.ok();
      await settle();

      window.dispatchEvent(new Event("online"));
      await settle();
      expect(calls).toHaveLength(3);
    } finally {
      running.stop();
    }
  });
});

describe("a manual refresh while a request is already in flight", () => {
  it("produces exactly one fresh attempt, and produces it at once", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    try {
      await settle();
      expect(calls).toHaveLength(1);

      // Somebody taps the button on the stale banner while the poll that made
      // it stale is still open.
      running.refresh();
      await settle();
      // Not two at once: overlapping requests are what `inFlight` is for.
      expect(calls).toHaveLength(1);

      calls[0]?.ok();
      await settle();

      /* **THE DEFECT.** Before this, the press was absorbed: the in-flight
         request finished, `schedule()` set a timer for the ordinary interval,
         and nothing happened for up to five more seconds. The person pressed a
         button and the page did not move. */
      expect(calls).toHaveLength(2);
    } finally {
      running.stop();
    }
  });

  it("two presses during one request are still one fresh attempt", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    try {
      await settle();
      running.refresh();
      running.refresh();
      running.refresh();
      calls[0]?.ok();
      await settle();
      expect(calls).toHaveLength(2);

      // And the rhythm afterwards is the ordinary one, not three queued asks.
      await settle(DEFAULT_INTERVAL_MS - 1);
      expect(calls).toHaveLength(2);
    } finally {
      running.stop();
    }
  });

  it("escapes a backoff rather than being swallowed by one", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    try {
      await settle();
      calls[0]?.status(503, "Service Unavailable");
      await settle();
      await settle(DEFAULT_INTERVAL_MS);
      expect(calls).toHaveLength(2); // the retry, still failing

      running.refresh(); // pressed while that retry is open
      calls[1]?.status(503, "Service Unavailable");
      await settle();

      // The press wins: a fresh attempt now, not after a doubled backoff.
      expect(calls).toHaveLength(3);
    } finally {
      running.stop();
    }
  });
});

describe("stopping — an unmounted page must own nothing", () => {
  it("aborts the request that is still in flight", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal.aborted).toBe(false);

    running.stop();

    /* **THE DEFECT.** The `AbortController` lived inside `tick`, so nothing
       could reach it from `stop()`. A closed tab left a request open for up to
       twenty seconds — on a box that has hit load average 391 — and looked
       fine, because the answer was thrown away when it arrived. */
    expect(calls[0]?.signal.aborted).toBe(true);
  });

  it("tells the sink nothing about a request it abandoned", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    await settle();
    running.stop();
    await settle();
    // The abort rejects the fetch. That must not surface as an error banner on
    // a page that is no longer there — and must not be counted as a failure.
    expect(feed.errors).toEqual([]);
    expect(feed.states).toEqual([]);
  });

  it("removes its window listeners, so a later event asks for nothing", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    await settle();
    calls[0]?.ok();
    await settle();
    running.stop();

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await settle(MAX_INTERVAL_MS);

    expect(calls).toHaveLength(1);
  });

  it("is idempotent, because StrictMode tears every effect down twice", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    await settle();
    expect(() => {
      running.stop();
      running.stop();
      running.stop();
    }).not.toThrow();
    await settle(MAX_INTERVAL_MS);
    expect(calls).toHaveLength(1);
  });

  it("a refresh after stopping does nothing", async () => {
    const feed = sink();
    const running = pollingTransport()(feed);
    await settle();
    running.stop();
    running.refresh();
    await settle(MAX_INTERVAL_MS);
    expect(calls).toHaveLength(1);
  });

  it("a refresh queued before the stop does not fire after it", async () => {
    /* The two fixes meeting. A press lands while a request is open, the page
       unmounts before that request settles, and then it settles — the aborted
       request's own `finally` must not be the thing that launches a fetch on
       behalf of a component that is gone. */
    const feed = sink();
    const running = pollingTransport()(feed);
    await settle();
    running.refresh(); // queued behind the in-flight request
    running.stop(); // …and the page goes away before it settles

    await settle(MAX_INTERVAL_MS);
    expect(calls).toHaveLength(1);
    expect(feed.errors).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * And the join: does closing the view actually call any of that?
 *
 * Every test above drives `stop()` by hand, which proves the transport can
 * clean up and says nothing about whether anything ever asks it to — the gap
 * GPT Sol named in its review of plan 260910c. `useFleetState` owns the only
 * call, in an effect teardown, and it is one line that a refactor could drop
 * without a single component test noticing.
 * ------------------------------------------------------------------ */
describe("unmounting the hook", () => {
  it("stops the transport it started", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const stopped: string[] = [];
    const transport: Transport = () => ({ refresh: () => {}, stop: () => stopped.push("stop") });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const Probe = (): null => {
      useFleetState(transport);
      return null;
    };

    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(stopped).toEqual([]);

    await act(async () => {
      root.unmount();
    });
    // Verified by mutation: deleting `running.stop()` from useFleetState's
    // teardown reds this test and nothing else in the repo.
    expect(stopped).toEqual(["stop"]);
    container.remove();
  });
});
