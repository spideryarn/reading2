// @vitest-environment jsdom
/**
 * **The Readiness panel polls at the interval the server names.**
 *
 * The effect that set the timer ran before the first answer and did not run
 * again when one arrived, so the 120-second fallback was the only interval the
 * panel ever used until Refresh was pressed. GPT Sol reproduced it with fake
 * timers on 2026-10-06. The server's own default is also 120 seconds
 * (tools/fleet/server.ts § `READINESS_REFRESH_MS`), which is why nobody saw it.
 *
 * The plan is docs/plans/261006j-sixth-sweep-s7-s8-robots-check-and-readiness-poll.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReadinessPanel } from "../tools/fleet/web/src/ReadinessPanel";
import { makeReadinessApi, parseReadiness, type ReadinessApi, type ReadinessView } from "../tools/fleet/web/src/readiness-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHA = "1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-09-09T06:00:00.000Z");
const SKEW = { kind: "known", ms: 0 } as const;

function answer(refreshMs: unknown): Extract<ReadinessView, { kind: "readiness" }> {
  const view = parseReadiness({
    schema: 1,
    kind: "readiness",
    collectedAt: "2026-09-09T06:00:00.000Z",
    windowHours: 24,
    refreshMs,
    readings: [],
    verdict: { kind: "ready", sha: SHA, evidence: [], caveat: "…" },
    dev: { kind: "known", devSha: SHA, primarySha: SHA, primaryBehind: 0, trunkGap: 3, observedAt: "…", caveat: "…" },
    diagnostics: {
      unreadableRecords: [],
      unreadableLogs: [],
      unreadableRoots: [],
      scanTruncated: false,
      rootsTruncated: false,
      logsSkippedForBudget: 0,
      checkoutsScanned: 13,
      storeRefused: null,
      tmuxWhy: null,
    },
  });
  if (view.kind !== "readiness") throw new Error(`the fixture did not parse: ${JSON.stringify(view)}`);
  return view;
}

/** Answers in turn, repeating the last one; counts every request. */
function api(answers: ReadinessView[], calls: { n: number }): ReadinessApi {
  return {
    fetch: async () => {
      const next = answers[Math.min(calls.n, answers.length - 1)];
      calls.n += 1;
      if (!next) throw new Error("no answer to give");
      return next;
    },
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function mount(source: ReadinessApi, refreshNonce = 0): Promise<void> {
  await act(async () => {
    root.render(<ReadinessPanel api={source} nowMs={NOW} skew={SKEW} refreshNonce={refreshNonce} />);
  });
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the Readiness panel's polling", () => {
  it("fetches again after the server's interval, without Refresh, and once per interval after that", async () => {
    const calls = { n: 0 };
    await mount(api([answer(30_000)], calls));
    /* The first answer arriving is not itself a reason to ask again. */
    expect(calls.n).toBe(1);
    await wait(29_999);
    expect(calls.n).toBe(1);
    await wait(1);
    expect(calls.n).toBe(2);
    await wait(30_000);
    expect(calls.n).toBe(3);
    await wait(30_000 * 4);
    expect(calls.n).toBe(7);
  });

  it("stops when unmounted", async () => {
    const calls = { n: 0 };
    await mount(api([answer(30_000)], calls));
    await wait(30_000);
    expect(calls.n).toBe(2);
    act(() => root.unmount());
    await wait(30_000 * 5);
    expect(calls.n).toBe(2);
    root = createRoot(host);
  });

  it("follows the interval when a later answer changes it, with one timer and no extra fetch", async () => {
    const calls = { n: 0 };
    await mount(api([answer(30_000), answer(60_000)], calls));
    await wait(30_000);
    expect(calls.n).toBe(2);
    await wait(59_999);
    expect(calls.n).toBe(2);
    await wait(1);
    expect(calls.n).toBe(3);
  });

  it("keeps a number that is zero or absurd inside fifteen seconds and ten minutes", async () => {
    const fast = { n: 0 };
    await mount(api([answer(0)], fast));
    await wait(14_999);
    expect(fast.n).toBe(1);
    await wait(1);
    expect(fast.n).toBe(2);
    act(() => root.unmount());
    root = createRoot(host);

    const slow = { n: 0 };
    await mount(api([answer(24 * 60 * 60_000)], slow));
    await wait(10 * 60_000 - 1);
    expect(slow.n).toBe(1);
    await wait(1);
    expect(slow.n).toBe(2);
  });

  it("uses two minutes when there is no answer to take a number from", async () => {
    const calls = { n: 0 };
    await mount(api([{ kind: "unavailable", why: "the server answered 503" }], calls));
    await wait(119_999);
    expect(calls.n).toBe(1);
    await wait(1);
    expect(calls.n).toBe(2);
  });

  it("keeps polling after the HTTP adapter catches a failed fetch", async () => {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const failed = makeReadinessApi(network);
    const load = vi.fn<ReadinessApi["fetch"]>()
      .mockImplementationOnce(failed.fetch)
      .mockResolvedValue(answer(30_000));
    await mount({ fetch: load });
    expect(host.textContent).toContain("could not reach the server: offline");
    await wait(120_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("dev is green");
    await wait(30_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("waits for each new interval when successful answers alternate between two numbers", async () => {
    const calls = { n: 0 };
    await mount(api([answer(15_000), answer(30_000), answer(15_000), answer(30_000)], calls));
    expect(calls.n).toBe(1);
    await wait(15_000);
    expect(calls.n).toBe(2);
    await wait(29_999);
    expect(calls.n).toBe(2);
    await wait(1);
    expect(calls.n).toBe(3);
    await wait(15_000);
    expect(calls.n).toBe(4);
  });

  /* What the old comment feared, in its worst form: every answer names a
     different interval. Still never faster than the floor. */
  it("is not turned into a busy loop by an interval that changes on every answer", async () => {
    const calls = { n: 0 };
    const flapping: ReadinessView[] = [];
    for (let i = 0; i < 50; i++) flapping.push(i % 2 === 0 ? answer(15_000) : { kind: "unavailable", why: "flapping" });
    await mount(api(flapping, calls));
    await wait(15_000 * 4);
    expect(calls.n).toBeLessThanOrEqual(5);
  });

  it("still fetches at once when Refresh is pressed", async () => {
    const calls = { n: 0 };
    const source = api([answer(30_000)], calls);
    await mount(source, 0);
    await mount(source, 1);
    expect(calls.n).toBe(2);
  });

  it("restarts the timer on Refresh, giving the new answer a full interval", async () => {
    const calls = { n: 0 };
    const source = api([answer(30_000)], calls);
    await mount(source, 0);
    await wait(29_999);
    await mount(source, 1);
    expect(calls.n).toBe(2);
    await wait(1);
    expect(calls.n).toBe(2);
    await wait(29_999);
    expect(calls.n).toBe(3);
  });

  it("ignores a pre-Refresh poll that arrives after the refreshed answer", async () => {
    const old = answer(30_000);
    const newer: ReadinessView = {
      ...old,
      verdict: { kind: "not-ready", sha: SHA, failing: [], evidence: [], caveat: "newer reading" },
    };
    let resolvePoll!: (view: ReadinessView) => void;
    const fetch = vi.fn<ReadinessApi["fetch"]>()
      .mockResolvedValueOnce(old)
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePoll = resolve; }))
      .mockResolvedValueOnce(newer);
    const source = { fetch };
    await mount(source, 0);
    await wait(30_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await mount(source, 1);
    expect(host.textContent).toContain("dev is not green");
    await act(async () => { resolvePoll(old); });
    expect(host.textContent).toContain("dev is not green");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
