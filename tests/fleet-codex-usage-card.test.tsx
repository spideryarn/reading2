// @vitest-environment jsdom
/**
 * The Codex subscription reading, from the history route's payload to pixels.
 *
 * The first test deliberately crosses the browser parser. A component test fed
 * a hand-built view cannot catch `parseSample` rebuilding a history line and
 * dropping its additive `codex` field — the exact silent-success bug stage 4
 * exists to close.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usageHistoryPayload } from "../tools/fleet/routes-usage-history.js";
import type { CodexObservation, CodexWindowObservation } from "../tools/fleet/usage-history-record.js";
import type { UsageHistoryReader, UsageHistorySample } from "../tools/fleet/usage-history.js";
import { useUsageHistoryView } from "../tools/fleet/web/src/UsageHistory";
import { UsageCard } from "../tools/fleet/web/src/UsagePanel";
import {
  newestCodexObservation,
  parseUsageHistory,
  type CodexObservationView,
  type UsageHistoryApi,
  type UsageHistoryView,
} from "../tools/fleet/web/src/usage-history-client";
import { CLOCK_SKEW_UNMEASURED } from "../tools/fleet/web/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const READ_AT = new Date(NOW - 2 * 60 * 60_000).toISOString();
const RESET_AT = new Date(NOW + 3 * 24 * 60 * 60_000).toISOString();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function codex(over: Partial<Extract<CodexObservation, { kind: "value" }>> = {}): Extract<CodexObservation, { kind: "value" }> {
  return {
    kind: "value",
    accountId: "account-redacted",
    readAt: READ_AT,
    resetCredits: 2,
    buckets: [
      {
        limitId: "codex",
        limitName: null,
        planType: "pro",
        credits: { hasCredits: false, unlimited: false, balance: "0" },
        individualLimit: null,
        spendControlReached: false,
        rateLimitReachedType: null,
        windows: [
          {
            kind: "value",
            slot: "primary",
            windowMinutes: 10_080,
            usedPercent: 24,
            resetsAt: RESET_AT,
            resetsAtMs: Date.parse(RESET_AT),
          },
        ],
      },
    ],
    ...over,
  };
}

function valueWindow(
  over: Partial<Extract<CodexWindowObservation, { kind: "value" }>> = {},
): Extract<CodexWindowObservation, { kind: "value" }> {
  return {
    kind: "value",
    slot: "primary",
    windowMinutes: 10_080,
    usedPercent: 24,
    resetsAt: RESET_AT,
    resetsAtMs: Date.parse(RESET_AT),
    ...over,
  };
}

function sample(observation: CodexObservation | undefined, atMs = NOW): UsageHistorySample {
  const line = {
    lineSchema: 1,
    summarySchema: 1,
    recordedAt: new Date(atMs).toISOString(),
    nextDueMs: 300_000,
    pass: { kind: "collector-failed" as const, at: new Date(atMs).toISOString(), why: "Claude failed" },
    ...(observation === undefined ? {} : { codex: observation }),
  };
  return { kind: "sample", sourceAtMs: atMs, line };
}

function routeView(samples: UsageHistorySample[]): UsageHistoryView {
  const store: UsageHistoryReader = {
    read: () => ({
      kind: "read",
      samples,
      predecessor: null,
      holes: [],
      earliestAt: samples[0]?.kind === "sample" ? samples[0].line.recordedAt : null,
      rotated: false,
      unreadableLines: 0,
      unsupportedLines: 0,
      files: 1,
    }),
  };
  const payload = usageHistoryPayload({ store, refreshMs: 60_000, nowMs: () => NOW }, 24);
  return parseUsageHistory(JSON.parse(JSON.stringify(payload)));
}

function draw(observation: CodexObservationView | null): void {
  act(() =>
    root.render(
      <UsageCard
        usage={null}
        codex={observation}
        now={NOW}
        receivedAt={NOW}
        skew={CLOCK_SKEW_UNMEASURED}
      />,
    ),
  );
}

function screen(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

function historyView(latestCodex: CodexObservationView): Extract<UsageHistoryView, { kind: "history" }> {
  return {
    kind: "history",
    windowHours: 24,
    fromMs: NOW - 86_400_000,
    toMs: NOW,
    samples: [],
    predecessor: null,
    holes: [],
    earliestAt: null,
    rotated: false,
    unreadableLines: 0,
    unsupportedLines: 0,
    recorder: { lastRecordedAt: null, expectedEveryMs: null, overdueByMs: null },
    refreshMs: 60_000,
    latestCodex,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("route payload → browser parser → Codex account card", () => {
  it("keeps the additive Codex field and renders it even when the Claude pass failed", () => {
    const view = routeView([sample(codex())]);
    draw(newestCodexObservation(view));

    expect(screen()).toContain("Codex subscription");
    expect(screen()).toContain("7 days");
    expect(screen()).toContain("24% used");
    expect(screen()).toContain("Reading taken 2h ago");
    expect(screen()).toContain("2 reset credits");
  });

  it("does not trust Codex from a sample whose Claude pass makes the whole sample unreadable", () => {
    const store: UsageHistoryReader = {
      read: () => ({
        kind: "read",
        samples: [sample(codex({ buckets: [{ ...codex().buckets[0]!, windows: [valueWindow({ usedPercent: 0 })] }] }))],
        predecessor: null,
        holes: [],
        earliestAt: READ_AT,
        rotated: false,
        unreadableLines: 0,
        unsupportedLines: 0,
        files: 1,
      }),
    };
    const raw = JSON.parse(JSON.stringify(usageHistoryPayload({ store, refreshMs: 60_000, nowMs: () => NOW }, 24))) as {
      samples: { line: { pass: unknown } }[];
    };
    raw.samples[0]!.line.pass = null;

    const view = parseUsageHistory(raw);
    expect(view.kind === "history" ? view.samples : []).toHaveLength(0);
    draw(newestCodexObservation(view));

    expect(screen()).toContain("newest history sample was unreadable");
    expect(screen()).not.toContain("0% used");
  });
});

describe("usage-history polling order", () => {
  it("does not let an older request overwrite a newer response", async () => {
    vi.useFakeTimers();
    const first = deferred<UsageHistoryView>();
    const second = deferred<UsageHistoryView>();
    let calls = 0;
    const api: UsageHistoryApi = {
      window: () => {
        calls += 1;
        return calls === 1 ? first.promise : second.promise;
      },
    };
    const Probe = () => {
      const view = useUsageHistoryView({ api, refreshNonce: 0, active: true });
      return <p>{view?.kind === "history" ? view.latestCodex.kind : view?.kind ?? "loading"}</p>;
    };
    act(() => root.render(<Probe />));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(calls).toBe(2);

    second.resolve(historyView({ kind: "unknown", why: "newer failure", retryable: true }));
    await act(async () => undefined);
    expect(screen()).toBe("unknown");

    first.resolve(historyView(codex()));
    await act(async () => undefined);
    expect(screen()).toBe("unknown");
  });
});

describe("the tolerant browser boundary", () => {
  function rawSample(rawCodex: unknown, include = true): Record<string, unknown> {
    const raw = sample(codex()) as Extract<UsageHistorySample, { kind: "sample" }>;
    const { codex: _discardFixtureCodex, ...lineWithoutCodex } = raw.line;
    return {
      ...raw,
      line: {
        ...lineWithoutCodex,
        ...(include ? { codex: rawCodex } : {}),
      },
    };
  }

  function rawView(samples: unknown[], holes: unknown[] = []): UsageHistoryView {
    return parseUsageHistory({
      schema: 1,
      kind: "history",
      windowHours: 24,
      fromMs: NOW - 86_400_000,
      toMs: NOW,
      samples,
      predecessor: null,
      holes,
      earliestAt: null,
      rotated: false,
      unreadableLines: 0,
      unsupportedLines: 0,
      recorder: { lastRecordedAt: null, expectedEveryMs: null, overdueByMs: null },
      refreshMs: 60_000,
    });
  }

  it("degrades malformed Codex data without costing the Claude observation", () => {
    const view = rawView([rawSample({ kind: "value", readAt: "not a date" })]);
    expect(view.kind).toBe("history");
    if (view.kind !== "history") return;
    expect(view.samples[0]?.kind).toBe("sample");
    const first = view.samples[0];
    if (first?.kind === "sample") {
      expect(first.line.pass.kind).toBe("collector-failed");
      expect(first.line.codex?.kind).toBe("unknown");
    }
  });

  it("keeps an absent legacy field distinct from a malformed present field", () => {
    const absent = newestCodexObservation(rawView([rawSample(undefined, false)]));
    const malformed = newestCodexObservation(rawView([rawSample({ kind: "value", buckets: "no" })]));
    expect(absent.kind).toBe("absent");
    expect(malformed.kind).toBe("unknown");
  });

  it("preserves a producer unknown arm and an over-100 value without trusting malformed nested fields", () => {
    const producerUnknown = newestCodexObservation(
      rawView([rawSample({ kind: "unknown", why: "authentication required", retryable: false })]),
    );
    expect(producerUnknown).toEqual({ kind: "unknown", why: "authentication required", retryable: false });

    const over = codex({ buckets: [{ ...codex().buckets[0]!, windows: [valueWindow({ usedPercent: 137 })] }] });
    const preserved = newestCodexObservation(rawView([rawSample(over)]));
    expect(preserved.kind === "value" ? preserved.buckets[0]?.windows[0] : null).toMatchObject({ usedPercent: 137 });

    const malformedNested = JSON.parse(JSON.stringify(codex())) as Record<string, unknown>;
    const bucket = (malformedNested.buckets as Record<string, unknown>[])[0]!;
    bucket.windows = [{ kind: "unknown", slot: "primary", windowMinutes: "seven days", why: "missing" }];
    expect(newestCodexObservation(rawView([rawSample(malformedNested)])).kind).toBe("unknown");
  });

  it.each([
    ["unknown", rawSample({ kind: "unknown", why: "fetch failed", retryable: true })],
    ["absent", rawSample(undefined, false)],
    ["omitted", { kind: "omitted", sourceAtMs: NOW + 1, why: "too large" }],
    ["unsupported", { kind: "unsupported", summarySchema: 2, why: "newer build" }],
    ["unreadable", { definitely: "not a sample" }],
  ])("lets a newer %s attempt supersede an older value in file order", (_name, newer) => {
    const olderButLaterReadAt = codex({ readAt: new Date(NOW + 60_000).toISOString() });
    const selected = newestCodexObservation(rawView([rawSample(olderButLaterReadAt), newer]));
    expect(selected.kind).not.toBe("value");
  });

  it("lets a trailing unreadable physical line supersede the last readable value", () => {
    const selected = newestCodexObservation(
      rawView([rawSample(codex())], [{ afterAt: new Date(NOW).toISOString(), beforeAt: null }]),
    );
    expect(selected).toMatchObject({ kind: "unknown" });
    if (selected.kind === "unknown") expect(selected.why).toContain("newest usage-history line");
  });
});

describe("Codex card claims", () => {
  it("withholds every number when the provider did not identify the account", () => {
    draw(codex({ accountId: null }));
    expect(screen()).toContain("Account not attributed");
    expect(screen()).toContain("cannot be shown without knowing which account they belong to");
    expect(screen()).not.toContain("24% used");
    expect(screen()).not.toContain("2 reset credits");
  });

  it("uses durations rather than slots, keeps unfamiliar windows, and preserves over-100 values", () => {
    const reading = codex({
      buckets: [
        {
          ...codex().buckets[0]!,
          windows: [
            valueWindow({ usedPercent: 137 }),
            {
              kind: "value",
              slot: "secondary",
              windowMinutes: 1_440,
              usedPercent: 8,
              resetsAt: RESET_AT,
              resetsAtMs: Date.parse(RESET_AT),
            },
          ],
        },
        {
          ...codex().buckets[0]!,
          limitId: "codex_model",
          limitName: "A model",
          windows: [valueWindow({ windowMinutes: 300, usedPercent: 3 })],
        },
      ],
    });
    draw(reading);
    expect(screen()).toContain("7 days");
    expect(screen()).toContain("1,440 minutes");
    expect(screen()).toContain("5 hours");
    expect(screen()).toContain("137% used");
    expect(container.querySelector('[data-slot="codex-utilization-bar"]')?.getAttribute("style")).toContain("width: 100%");
  });

  it("never promotes a model bucket to general headroom and never calls ChatGPT credits API credits", () => {
    const model = { ...codex().buckets[0]!, limitId: "codex_model", limitName: "A model" };
    draw(codex({ buckets: [model] }));
    expect(screen()).toContain("General Codex headroom is unknown");
    expect(screen()).toContain("A model");
    expect(screen()).not.toContain("API credits");
  });

  it("does not turn missing windows or reset credits into zero", () => {
    draw(codex({ buckets: [{ ...codex().buckets[0]!, windows: [] }], resetCredits: null }));
    expect(screen()).toContain("carried no windows");
    expect(screen()).toContain("did not report reset credits");
    expect(screen()).not.toContain("0% used");
    expect(screen()).not.toContain("0 reset credits");
  });

  it("states a reached limit instead of letting the percentage imply headroom", () => {
    draw(codex({ buckets: [{ ...codex().buckets[0]!, rateLimitReachedType: "weekly" }] }));
    expect(screen()).toMatch(/reported a reached limit.*weekly/i);
  });

  it("time-qualifies backend limit states after their window has reset", () => {
    const past = new Date(NOW - 60_000).toISOString();
    draw(codex({
      readAt: new Date(NOW - 60 * 60_000).toISOString(),
      buckets: [{
        ...codex().buckets[0]!,
        rateLimitReachedType: "weekly",
        windows: [valueWindow({ resetsAt: past, resetsAtMs: Date.parse(past) })],
      }],
    }));
    expect(screen()).toContain("When this reading was taken, the backend reported a reached limit — weekly");
    expect(screen()).toContain("already reset 1m ago");

    draw(codex({ buckets: [{ ...codex().buckets[0]!, spendControlReached: true }] }));
    expect(screen()).toContain("When this reading was taken, the backend reported that spend control was reached.");
  });

  it.each([
    [
      "unknown spend-control state",
      { spendControlReached: null },
      "spend-control state was reached or unavailable",
    ],
    [
      "an individual spend limit",
      {
        spendControlReached: false,
        individualLimit: { limit: "10", used: "10", remainingPercent: 0, resetsAt: Math.floor(NOW / 1000) },
      },
      "an individual spend limit was reported",
    ],
  ])("withholds general percentages when the persisted reading carries %s", (_name, over, why) => {
    const general = { ...codex().buckets[0]!, ...over, windows: [valueWindow({ usedPercent: 0 })] };
    const view = routeView([sample(codex({ buckets: [general] }))]);
    draw(newestCodexObservation(view));

    expect(screen()).toContain("General headroom");
    expect(screen()).toContain(why);
    expect(screen()).not.toContain("0% used");
  });

  it("re-derives live expiry and does not display an expired percentage", () => {
    const past = new Date(NOW - 1_000).toISOString();
    draw(codex({ buckets: [{ ...codex().buckets[0]!, windows: [valueWindow({ usedPercent: 91, resetsAt: past, resetsAtMs: Date.parse(past) })] }] }));
    expect(screen()).toContain("already reset");
    expect(screen()).not.toContain("91% used");
  });

  it("withholds decision numbers when the reading instant is in the future", () => {
    draw(codex({ readAt: new Date(NOW + 60 * 60_000).toISOString(), resetCredits: 2 }));
    expect(screen()).toContain("reading instant is in the future or cannot be compared");
    expect(screen()).not.toContain("24% used");
    expect(screen()).not.toContain("2 reset credits");
  });

  it("rejects duplicate bucket ids and duplicate slots instead of picking the first", () => {
    const general = codex().buckets[0]!;
    draw(codex({ buckets: [general, { ...general, windows: [valueWindow({ usedPercent: 88 })] }] }));
    expect(screen()).toContain("duplicate codex buckets");
    expect(screen()).not.toContain("24% used");
    expect(screen()).not.toContain("88% used");

    draw(codex({ buckets: [{ ...general, windows: [valueWindow(), valueWindow({ usedPercent: 77 })] }] }));
    expect(screen()).toContain("duplicate primary windows");
    expect(screen()).not.toContain("24% used");
    expect(screen()).not.toContain("77% used");
  });
});
