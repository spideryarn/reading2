// @vitest-environment jsdom
/**
 * **THE ACTIONS FEED GETS THE TRANSPORT'S MANNERS, AND SAYS HOW OLD IT IS** —
 * Stage 4 of docs/plans/260910c, ledger row F5 (and the hook half of F8).
 *
 * Before this stage `useActions` polled every ten seconds and skipped a hidden
 * tab, and that was all: it did not re-read on becoming visible or on coming
 * back online, it DROPPED a refresh asked for while a read was in flight, it
 * had no deadline and no abort — so one read that never settled stopped the
 * poll for the life of the tab — and it offered no age, so a queue read four
 * minutes ago looked exactly like one read now.
 *
 * These drive the hook directly through a small probe component, on vitest's
 * fake clock throughout, beside `fleet-feed-freshness.test.tsx` (Stage 3's
 * twin for the recent-messages feed). Drawing the age beside SessionDetail's
 * queue is a later half of the stage and is not tested here.
 *
 * ## The test that asserts nothing happens
 *
 * "Never requests /api/state" passes trivially against a hook that requests
 * nothing at all, and against a fetch spy that never fires. So it also asserts
 * the spy DID see this hook's own `api/actions` reads and the action's POST —
 * the negative claim counts only beside the positive one, on the same recorder.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeActionsApi,
  parseActionsFeed,
  type ActionsApi,
  type ActionsFeed,
  type FeedOutcome,
} from "../tools/fleet/web/src/actions-client";
import type { FleetRow } from "../tools/fleet/web/src/types";
import {
  ACTIONS_POLL_MS,
  ACTIONS_READ_DEADLINE_MS,
  useActions,
  type ActionsUi,
} from "../tools/fleet/web/src/useActions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.parse("2026-09-10T11:00:00.000Z");
/** Long enough that the poll never fires inside a test that is not about the poll. */
const NO_POLL = 3_600_000;

let host: HTMLDivElement;
let root: Root;
let mounted = false;
let latest: ActionsUi | null = null;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  setVisibility("visible", false);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  latest = null;
});

afterEach(() => {
  if (mounted) unmount();
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setVisibility("visible", false);
});

/* ------------------------------------------------------------------ *
 * Fixtures.
 * ------------------------------------------------------------------ */

/** jsdom's `visibilityState` is a prototype getter with no setter, so it is redefined. */
function setVisibility(state: "visible" | "hidden", announce = true): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  if (announce) document.dispatchEvent(new Event("visibilitychange"));
}

/** Move the fake clock and flush every promise and render it releases. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Draws the hook's error, so "the error is drawn" is read off the DOM rather than off a variable. */
function Probe({ api, intervalMs }: { api: ActionsApi | undefined; intervalMs: number }) {
  const ui = useActions(api, intervalMs);
  latest = ui;
  return <p data-probe="error">{ui.error ?? ""}</p>;
}

async function mount(api: ActionsApi | undefined, intervalMs: number = NO_POLL): Promise<void> {
  await act(async () => {
    root.render(<Probe api={api} intervalMs={intervalMs} />);
  });
  mounted = true;
  await advance(0);
}

function unmount(): void {
  act(() => root.unmount());
  mounted = false;
}

function ui(): ActionsUi {
  if (latest === null) throw new Error("the probe never rendered");
  return latest;
}

function drawnError(): string {
  return host.querySelector("[data-probe=error]")?.textContent ?? "";
}

/** A distinct feed each call, so an assertion can tell WHICH answer the hook kept by identity. */
function aFeed(): ActionsFeed {
  const feed = parseActionsFeed({ actions: { session: [], box: [] }, queues: [] });
  if (feed === null) throw new Error("the fixture is not this API");
  return feed;
}

type Call = { signal: AbortSignal | undefined; resolve: (outcome: FeedOutcome) => void; settled: boolean };

/**
 * An actions api whose every feed answer the test hands back by hand, which
 * records the signal it was given and how many reads were ever unsettled at
 * once. It **ignores** the signal: the hook's deadline and its discarding must
 * hold against a client that does not honour abort, which is what F5 asked for.
 * Every mutation throws — nothing in these tests should call one by accident.
 */
function manualApi(): { api: ActionsApi; calls: Call[]; maxUnsettled: () => number } {
  const calls: Call[] = [];
  let unsettled = 0;
  let max = 0;
  const refuse = (): never => {
    throw new Error("no mutation belongs in this fixture");
  };
  const api: ActionsApi = {
    feed: (signal?: AbortSignal) =>
      new Promise<FeedOutcome>((resolve) => {
        unsettled += 1;
        max = Math.max(max, unsettled);
        const call: Call = {
          signal,
          settled: false,
          resolve: (outcome) => {
            if (call.settled) return;
            call.settled = true;
            unsettled -= 1;
            resolve(outcome);
          },
        };
        calls.push(call);
      }),
    run: refuse,
    queueMessage: refuse,
    cancel: refuse,
    revive: refuse,
    abandon: refuse,
    clear: refuse,
    releaseHold: refuse,
    boxPreview: refuse,
    boxConfirm: refuse,
  };
  return { api, calls, maxUnsettled: () => max };
}

function call(calls: Call[], index: number): Call {
  const c = calls[index];
  if (c === undefined) throw new Error(`there is no read ${index}; there were ${calls.length}`);
  return c;
}

async function answer(c: Call, outcome: FeedOutcome): Promise<void> {
  await act(async () => {
    c.resolve(outcome);
  });
  await advance(0);
}

/** A session row as `parseFleetState` produces it — every field named, as in fleet-feed-freshness. */
function staleRow(): FleetRow {
  const status: FleetRow["status"] = { kind: "working" };
  return {
    id: "$9",
    paneId: "%7",
    name: "session-nine",
    title: null,
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    execution: {
      kind: "verified",
      token: { boot: "boot-s4a", pid: 4242, startTicks: 17 },
      harness: "claude-code",
      conversation: { kind: "verified", id: "conv-seen-by-the-person" },
    },
    repo: null,
    worktree: null,
    startedAt: "2026-09-10T10:00:00.000Z",
    status,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: 4242,
    claudeSessionId: "conv-seen-by-the-person",
    rawStatus: status,
    rawQuestion: null,
  };
}

/* ------------------------------------------------------------------ *
 * 1. Visible and online.
 * ------------------------------------------------------------------ */

describe("useActions re-reads on the two moments its number is most likely wrong", () => {
  it("reads at once when a hidden tab becomes visible, and stops listening on unmount", async () => {
    setVisibility("hidden", false);
    const { api, calls } = manualApi();
    await mount(api);
    // A hidden tab skips the mount read — the premise, not the subject.
    expect(calls).toHaveLength(0);

    setVisibility("visible");
    await advance(0);
    expect(calls).toHaveLength(1);

    await answer(call(calls, 0), { ok: true, feed: aFeed() });
    unmount();
    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);
    expect(calls).toHaveLength(1);
  });

  it("reads at once when the browser comes back online, and stops listening on unmount", async () => {
    const { api, calls } = manualApi();
    await mount(api);
    await answer(call(calls, 0), { ok: true, feed: aFeed() });
    expect(calls).toHaveLength(1);

    window.dispatchEvent(new Event("online"));
    await advance(0);
    expect(calls).toHaveLength(2);

    await answer(call(calls, 1), { ok: true, feed: aFeed() });
    unmount();
    window.dispatchEvent(new Event("online"));
    await advance(0);
    expect(calls).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * 2. One pending refresh.
 * ------------------------------------------------------------------ */

describe("a refresh asked for during a read", () => {
  it("becomes exactly one more read after it — never dropped, never two at once", async () => {
    const { api, calls, maxUnsettled } = manualApi();
    await mount(api);
    expect(calls).toHaveLength(1);

    // Three asks during one read: a mutation's refresh, a retry button, and
    // coming back online — they coalesce into one.
    act(() => ui().refresh());
    act(() => ui().refresh());
    window.dispatchEvent(new Event("online"));
    await advance(0);
    expect(calls).toHaveLength(1);

    await answer(call(calls, 0), { ok: true, feed: aFeed() });
    expect(calls).toHaveLength(2);

    await answer(call(calls, 1), { ok: true, feed: aFeed() });
    await advance(ACTIONS_READ_DEADLINE_MS);
    expect(calls).toHaveLength(2);
    expect(maxUnsettled()).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 3. A read that never answers.
 * ------------------------------------------------------------------ */

describe("a feed promise that never settles", () => {
  it("is released by the hook's own deadline, the error is drawn, and the next poll reads", async () => {
    const { api, calls } = manualApi();
    await mount(api, ACTIONS_POLL_MS);
    expect(calls).toHaveLength(1);
    expect(ui().asked).toBe(false);

    await advance(ACTIONS_READ_DEADLINE_MS);
    expect(ui().asked).toBe(true);
    expect(ui().error).toMatch(/did not answer within 8s/);
    expect(drawnError()).toBe(ui().error);
    expect(call(calls, 0).signal?.aborted).toBe(true);
    expect(ui().lastGoodAt).toBeNull();

    await advance(ACTIONS_POLL_MS - ACTIONS_READ_DEADLINE_MS);
    expect(calls).toHaveLength(2);
    expect(call(calls, 1).signal?.aborted).toBe(false);
  });

  it("is ordered below the poll, so a lost read never costs more than the tick it was on", () => {
    expect(ACTIONS_READ_DEADLINE_MS).toBeLessThan(ACTIONS_POLL_MS);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The signal, unmount, and a late answer.
 * ------------------------------------------------------------------ */

describe("the abort seam (F5)", () => {
  it("makeActionsApi passes the signal to fetch", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const fetchStub = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      return { ok: true, status: 200, json: async () => ({ actions: { session: [], box: [] }, queues: [] }) };
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const outcome = await makeActionsApi(fetchStub).feed(controller.signal);
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual([controller.signal]);
  });

  it("httpActionsApi's default instance passes it through as well", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init?.signal);
      return { ok: true, status: 200, json: async () => ({ actions: { session: [], box: [] }, queues: [] }) };
    });
    await mount(undefined);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("hands the api a live signal, and unmount aborts it and leaves no timer behind", async () => {
    const { api, calls } = manualApi();
    await mount(api, ACTIONS_POLL_MS);
    const signal = call(calls, 0).signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await advance(ACTIONS_POLL_MS * 3);
    expect(calls).toHaveLength(1);
  });

  it("discards an answer that arrives after its deadline, keeping the newer one", async () => {
    const { api, calls } = manualApi();
    await mount(api, ACTIONS_POLL_MS);
    await advance(ACTIONS_POLL_MS); // the first read times out, the poll starts the second
    expect(calls).toHaveLength(2);

    const newer = aFeed();
    await answer(call(calls, 1), { ok: true, feed: newer });
    expect(ui().feed).toBe(newer);
    const stamped = ui().lastGoodAt;
    expect(stamped).toBe(T0 + ACTIONS_POLL_MS);

    await advance(1_000);
    await answer(call(calls, 0), { ok: true, feed: aFeed() });
    expect(ui().feed).toBe(newer);
    expect(ui().lastGoodAt).toBe(stamped);
    expect(ui().error).toBeNull();

    // And a late FAILURE is not drawn over a good read either.
    await answer(call(calls, 0), { ok: false, why: "late and wrong" });
    expect(ui().error).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 5. lastGoodAt.
 * ------------------------------------------------------------------ */

describe("lastGoodAt", () => {
  it("is this browser's clock at each good read, and a failure neither moves it nor clears the feed", async () => {
    const { api, calls } = manualApi();
    await mount(api);
    expect(ui().lastGoodAt).toBeNull();
    expect(ui().pollMs).toBe(NO_POLL);

    await advance(1_500);
    const first = aFeed();
    await answer(call(calls, 0), { ok: true, feed: first });
    expect(ui().lastGoodAt).toBe(T0 + 1_500);

    await advance(4_000);
    act(() => ui().refresh());
    await advance(0);
    await answer(call(calls, 1), { ok: false, why: "the server answered 503 without saying why" });
    expect(ui().error).toBe("the server answered 503 without saying why");
    expect(drawnError()).toBe("the server answered 503 without saying why");
    expect(ui().lastGoodAt).toBe(T0 + 1_500);
    expect(ui().feed).toBe(first);

    // A read that never answers is a failure too, and moves nothing either.
    act(() => ui().refresh());
    await advance(ACTIONS_READ_DEADLINE_MS);
    expect(ui().error).toMatch(/did not answer/);
    expect(ui().lastGoodAt).toBe(T0 + 1_500);
    expect(ui().feed).toBe(first);

    act(() => ui().refresh());
    await advance(0);
    await answer(call(calls, 3), { ok: true, feed: aFeed() });
    expect(ui().error).toBeNull();
    expect(ui().lastGoodAt).toBe(T0 + 1_500 + 4_000 + ACTIONS_READ_DEADLINE_MS);
  });
});

/* ------------------------------------------------------------------ *
 * 6. What must not change.
 * ------------------------------------------------------------------ */

describe("the rule this stage must not break (useActions.ts § What it does after a mutation)", () => {
  it("never requests /api/state, and a confirmed action sends the row as seen and then re-reads only the queues", async () => {
    const requests: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      const body = url.endsWith("api/actions")
        ? { ok: true, op: "catalogue", actions: { session: [], box: [] }, queues: [] }
        : { ok: true, queued: true, position: 1 };
      return { ok: true, status: 200, statusText: "OK", json: async () => body };
    });

    const row = staleRow();
    await mount(undefined, ACTIONS_POLL_MS);
    window.dispatchEvent(new Event("online"));
    await advance(0);
    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);

    // What SessionDetail's `onQueue` does: send with the row it was handed,
    // then refresh.
    const before = requests.length;
    let outcome: Awaited<ReturnType<ActionsApi["queueMessage"]>> | null = null;
    await act(async () => {
      outcome = await ui().api.queueMessage(row, "hello");
    });
    act(() => ui().refresh());
    await advance(0);
    await advance(ACTIONS_POLL_MS);

    // The positive half: the recorder saw this hook's reads and the POST.
    expect(outcome).not.toBeNull();
    expect(requests.filter((r) => r.method === "GET" && r.url === "api/actions").length).toBeGreaterThanOrEqual(4);
    const after = requests.slice(before);
    expect(after.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST api/actions/session",
      "GET api/actions",
      "GET api/actions",
    ]);
    // The claims sent are the ones the person was looking at, not re-read.
    const sent = after[0]?.body as Record<string, unknown>;
    expect(sent["paneId"]).toBe(row.paneId);
    expect(sent["claudeSessionId"]).toBe(row.claudeSessionId);
    expect(sent["panePid"]).toBe(row.panePid);

    // The negative half, on the same recorder.
    expect(requests.filter((r) => r.url.includes("api/state"))).toEqual([]);
  });
});
