/**
 * The usage chart's Codex series: the same honesty rules as the Claude lines,
 * for the observation each record carries beside its Claude pass.
 *
 * Plan 261007n. Each test is one of that plan's rules.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import type {
  CodexBucketView,
  CodexRecordedObservationView,
  CodexWindowView,
  UsageHistorySample,
  UsageHistoryView,
} from "../tools/fleet/web/src/usage-history-client";
import { CLOCK_SKEW_UNMEASURED } from "../tools/fleet/web/src/types";
import { UsageHistory } from "../tools/fleet/web/src/UsageHistory";
import { plotUsageHistory } from "../tools/fleet/web/src/usage-history-series";

const T0 = Date.parse("2026-10-07T00:00:00.000Z");
const FIVE_MIN = 300_000;
const WEEK = 10_080;

function win(pct: number, minutes = WEEK, slot: "primary" | "secondary" = "primary"): CodexWindowView {
  return {
    kind: "value",
    slot,
    windowMinutes: minutes,
    usedPercent: pct,
    resetsAt: "2026-10-14T00:00:00.000Z",
    resetsAtMs: Date.parse("2026-10-14T00:00:00.000Z"),
  };
}

function bucket(limitId: string, windows: CodexWindowView[], limitName: string | null = null): CodexBucketView {
  return {
    limitId,
    limitName,
    windows,
    planType: "pro",
    credits: null,
    individualLimit: null,
    spendControlReached: false,
    rateLimitReachedType: null,
  };
}

function codexValue(
  buckets: CodexBucketView[],
  over: { accountId?: string | null; readAtMs?: number } = {},
): (atMs: number) => CodexRecordedObservationView {
  return (atMs) => ({
    kind: "value",
    accountId: over.accountId === undefined ? "cx-A" : over.accountId,
    readAt: new Date(over.readAtMs ?? atMs - 2_000).toISOString(),
    buckets,
    resetCredits: null,
  });
}

const general = (pct: number) => codexValue([bucket("codex", [win(pct)])]);

function sample(
  atMs: number,
  codex: ((atMs: number) => CodexRecordedObservationView) | null,
  over: { claudeFailed?: boolean; nextDueMs?: number } = {},
): UsageHistorySample {
  const line = {
    nextDueMs: over.nextDueMs ?? FIVE_MIN,
    recordedAt: new Date(atMs).toISOString(),
    pass: over.claudeFailed
      ? { kind: "collector-failed" as const, at: new Date(atMs).toISOString(), why: "ENOENT" }
      : {
          kind: "pass" as const,
          collectedAt: new Date(atMs).toISOString(),
          accountUuid: "acct-A",
          cache: {
            kind: "attributed" as const,
            accountUuid: "acct-A",
            fetchedAt: new Date(atMs).toISOString(),
            windows: [],
          },
          scan: { conclusive: true, why: null, incidents: [] },
          publication: { decision: "take-fresh" as const, why: "finished" },
        },
  };
  return { kind: "sample", sourceAtMs: atMs, line: codex === null ? line : { ...line, codex: codex(atMs) } };
}

function view(samples: UsageHistorySample[], over: Partial<Extract<UsageHistoryView, { kind: "history" }>> = {}) {
  return {
    kind: "history" as const,
    windowHours: 24,
    fromMs: T0 - 24 * 60 * 60 * 1000,
    toMs: T0 + 60 * 60 * 1000,
    samples,
    predecessor: null,
    holes: [],
    earliestAt: null,
    rotated: false,
    unreadableLines: 0,
    unsupportedLines: 0,
    recorder: { lastRecordedAt: null, expectedEveryMs: null, overdueByMs: null },
    refreshMs: 60_000,
    latestCodex: { kind: "absent" as const, why: "not part of this chart fixture" },
    ...over,
  };
}

const at = (n: number) => T0 + n * FIVE_MIN;
const runValues = (runs: { value: number }[][]) => runs.filter((r) => r.length > 0).map((r) => r.map((p) => p.value));

describe("the Codex series", () => {
  it("plots one line per bucket and window duration, keyed by duration not slot", () => {
    /* The same 7-day window reported first as primary and then as secondary is
       one line: the slot is a position, the duration names the window. */
    const plot = plotUsageHistory(
      view([
        sample(at(0), codexValue([bucket("codex", [win(10, WEEK, "primary")])])),
        sample(at(1), codexValue([bucket("codex", [win(12, WEEK, "secondary")])])),
        sample(
          at(2),
          codexValue([
            bucket("codex_bengalfox", [win(30, 300), win(5, WEEK, "secondary")], "GPT-Bengal"),
            bucket("codex", [win(14)]),
          ]),
        ),
      ]),
    );
    const generalLine = plot.codex.series.find((s) => s.limitId === "codex" && s.windowMinutes === WEEK);
    expect(generalLine?.general).toBe(true);
    expect(generalLine?.points.map((p) => p.value)).toEqual([10, 12, 14]);
    expect(runValues(generalLine?.runs ?? [])).toEqual([[10, 12, 14]]);
    const specific = plot.codex.series.filter((s) => s.limitId === "codex_bengalfox");
    expect(specific.map((s) => [s.windowMinutes, s.general, s.limitName])).toEqual([
      [300, false, "GPT-Bengal"],
      [WEEK, false, "GPT-Bengal"],
    ]);
  });

  it("places each point at the record's source instant, the clock every cut uses", () => {
    const plot = plotUsageHistory(view([sample(at(0), codexValue([bucket("codex", [win(10)])], { readAtMs: at(0) - 9_000 }))]));
    expect(plot.codex.series[0]?.points[0]?.atMs).toBe(at(0));
  });

  it("does NOT cut a Codex line when only the Claude pass failed", () => {
    const plot = plotUsageHistory(
      view([sample(at(0), general(10)), sample(at(1), general(11), { claudeFailed: true }), sample(at(2), general(12))]),
    );
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10, 11, 12]]);
  });

  it("BREAKS every Codex line at an unknown observation — never a zero", () => {
    const unknown = () => ({ kind: "unknown" as const, why: "failed to fetch codex rate limits", retryable: true });
    const plot = plotUsageHistory(view([sample(at(0), general(10)), sample(at(1), unknown), sample(at(2), general(12))]));
    expect(plot.codex.series[0]?.points.map((p) => p.value)).toEqual([10, 12]);
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
    expect(plot.codex.notObserved).toBe(1);
  });

  it("breaks every Codex line at a legacy record with no Codex observation", () => {
    const plot = plotUsageHistory(view([sample(at(0), general(10)), sample(at(1), null), sample(at(2), general(12))]));
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("applies the record-level cuts: a recorder gap breaks the Codex line too", () => {
    const plot = plotUsageHistory(view([sample(at(0), general(10)), sample(at(10), general(12))]));
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("applies the record-level cuts: an unsupported record breaks the Codex line too", () => {
    const plot = plotUsageHistory(
      view([
        sample(at(0), general(10)),
        { kind: "unsupported", summarySchema: 9, why: "written by summarySchema 9" },
        sample(at(1), general(12)),
      ]),
    );
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("applies the record-level cuts: a clock regression splits the Codex runs", () => {
    const plot = plotUsageHistory(view([sample(at(2), general(10)), sample(at(1), general(12))]));
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("breaks a line whose window the next record did not carry", () => {
    const plot = plotUsageHistory(
      view([
        sample(at(0), general(10)),
        sample(at(1), codexValue([bucket("codex_bengalfox", [win(30, 300)])])),
        sample(at(2), general(12)),
      ]),
    );
    const line = plot.codex.series.find((s) => s.limitId === "codex");
    expect(runValues(line?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("keeps an unknown window as a NAMED row with its reason, never drawn", () => {
    const plot = plotUsageHistory(
      view([
        sample(
          at(0),
          codexValue([
            bucket("codex", [{ kind: "unknown", slot: "secondary", windowMinutes: null, why: "no duration reported" }]),
          ]),
        ),
      ]),
    );
    expect(plot.codex.series).toEqual([]);
    expect(plot.codex.unknownWindows).toEqual([
      { limitId: "codex", limitName: null, windowMinutes: null, slot: "secondary", why: "no duration reported" },
    ]);
  });

  it("draws NEITHER of two windows with the same bucket and duration in one record, and cuts there", () => {
    const plot = plotUsageHistory(
      view([
        sample(at(0), general(10)),
        sample(at(1), codexValue([bucket("codex", [win(11, WEEK, "primary"), win(90, WEEK, "secondary")])])),
        sample(at(2), general(12)),
      ]),
    );
    const line = plot.codex.series.find((s) => s.limitId === "codex");
    expect(line?.points.map((p) => p.value)).toEqual([10, 12]);
    expect(runValues(line?.runs ?? [])).toEqual([[10], [12]]);
    expect(plot.codex.unknownWindows.map((w) => w.why)).toEqual([
      "this record carried two 10080-minute windows for this bucket, so neither was drawn",
    ]);
  });

  it("cuts at a duplicate duration even when one of its windows is unknown", () => {
    const ambiguous = codexValue([bucket("codex", [
      win(11),
      { kind: "unknown", slot: "secondary", windowMinutes: WEEK, why: "no reset instant" },
    ])]);
    const plot = plotUsageHistory(view([sample(at(0), general(10)), sample(at(1), ambiguous), sample(at(2), general(12))]));
    expect(plot.codex.series[0]?.points.map((p) => p.value)).toEqual([10, 12]);
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
    expect(plot.codex.unknownWindows.map((w) => w.why)).toContain("no reset instant");
    expect(plot.codex.unknownWindows.map((w) => w.why)).toContain(
      "this record carried two 10080-minute windows for this bucket, so neither was drawn",
    );
  });

  it("counts value observations with no drawable windows as not observed", () => {
    const unknown = codexValue([bucket("codex", [
      { kind: "unknown", slot: "primary", windowMinutes: WEEK, why: "no reset instant" },
    ])]);
    const controlled = codexValue([{ ...bucket("codex", [win(20)]), spendControlReached: true }]);
    const plot = plotUsageHistory(view([
      sample(at(0), general(10)),
      sample(at(1), unknown),
      sample(at(2), controlled),
      sample(at(3), codexValue([])),
      sample(at(4), general(12)),
    ]));
    expect(plot.codex.notObserved).toBe(3);
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("forms NO series from an observation that named no account", () => {
    const plot = plotUsageHistory(view([sample(at(0), codexValue([bucket("codex", [win(10)])], { accountId: null }))]));
    expect(plot.codex.series).toEqual([]);
    expect(plot.codex.notObserved).toBe(1);
  });

  it("keeps two Codex accounts on separate lines, never joined across a login swap", () => {
    const plot = plotUsageHistory(
      view([
        sample(at(0), codexValue([bucket("codex", [win(10)])], { accountId: "cx-A" })),
        sample(at(1), codexValue([bucket("codex", [win(70)])], { accountId: "cx-B" })),
      ]),
    );
    expect(plot.codex.series.map((s) => [s.accountId, s.points.map((p) => p.value)])).toEqual([
      ["cx-A", [10]],
      ["cx-B", [70]],
    ]);
  });

  it("draws NEITHER of two windows in one slot", () => {
    const plot = plotUsageHistory(
      view([sample(at(0), codexValue([bucket("codex_bengalfox", [win(30, 300, "primary"), win(5, WEEK, "primary")])]))]),
    );
    expect(plot.codex.series).toEqual([]);
    expect(plot.codex.unknownWindows.map((w) => w.why)).toEqual([
      "this record carried duplicate primary windows, so neither was drawn",
    ]);
  });

  it("draws NEITHER of two buckets with one id, and cuts the line there", () => {
    const plot = plotUsageHistory(
      view([
        sample(at(0), general(10)),
        sample(at(1), codexValue([bucket("codex", [win(11)]), bucket("codex", [win(90)])])),
        sample(at(2), general(12)),
      ]),
    );
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
    expect(plot.codex.unknownWindows.map((w) => w.why)).toEqual([
      "the reading carried duplicate codex buckets, so neither was drawn",
    ]);
  });

  it("withholds the general bucket under a spend control, as the live card does", () => {
    const controlled = { ...bucket("codex", [win(10)]), spendControlReached: null };
    const limited = { ...bucket("codex", [win(10)]), individualLimit: { limit: "5", used: "1", remainingPercent: 80, resetsAt: 0 } };
    expect(plotUsageHistory(view([sample(at(0), codexValue([controlled]))])).codex.series).toEqual([]);
    expect(plotUsageHistory(view([sample(at(0), codexValue([limited]))])).codex.series).toEqual([]);
    /* A model-specific bucket does not take the general control. */
    const specific = { ...bucket("codex_bengalfox", [win(10)]), spendControlReached: null };
    expect(plotUsageHistory(view([sample(at(0), codexValue([specific]))])).codex.series).toHaveLength(1);
  });

  it("cuts an existing line at an unknown window, rather than joining over it", () => {
    const unknownWindow = codexValue([
      bucket("codex", [{ kind: "unknown", slot: "primary", windowMinutes: WEEK, why: "no reset instant" }]),
    ]);
    const plot = plotUsageHistory(view([sample(at(0), general(10)), sample(at(1), unknownWindow), sample(at(2), general(12))]));
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("cuts an existing line at an observation that named no account", () => {
    const anonymous = codexValue([bucket("codex", [win(50)])], { accountId: null });
    const plot = plotUsageHistory(view([sample(at(0), general(10)), sample(at(1), anonymous), sample(at(2), general(12))]));
    expect(runValues(plot.codex.series[0]?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("does not rejoin account A's line across a spell on account B", () => {
    const a = (pct: number) => codexValue([bucket("codex", [win(pct)])], { accountId: "cx-A" });
    const b = (pct: number) => codexValue([bucket("codex", [win(pct)])], { accountId: "cx-B" });
    const plot = plotUsageHistory(view([sample(at(0), a(10)), sample(at(1), b(70)), sample(at(2), a(12))]));
    const lineA = plot.codex.series.find((s) => s.accountId === "cx-A");
    expect(runValues(lineA?.runs ?? [])).toEqual([[10], [12]]);
  });

  it("leaves the Claude series untouched by Codex lines", () => {
    const plot = plotUsageHistory(view([sample(at(0), general(10)), sample(at(1), general(12))]));
    expect(plot.accounts).toEqual([]);
  });
});

describe("the Codex half of the chart, drawn", () => {
  const html = (samples: UsageHistorySample[]) =>
    renderToStaticMarkup(createElement(UsageHistory, { view: view(samples), skew: CLOCK_SKEW_UNMEASURED }));

  it("draws the general limit under its own heading, and the model-specific ones collapsed", () => {
    const out = html([
      sample(at(0), codexValue([bucket("codex", [win(10)]), bucket("codex_bengalfox", [win(30, 300)], "GPT-Bengal")])),
      sample(at(1), codexValue([bucket("codex", [win(12)]), bucket("codex_bengalfox", [win(31, 300)], "GPT-Bengal")])),
    ]);
    expect(out).toContain(">Claude</h4>");
    expect(out).toContain(">Codex</h4>");
    expect(out).toContain('aria-label="Codex general usage over the last 24 hours"');
    expect(out).toMatch(/<details[^>]*><summary[^>]*>1 model-specific limit<\/summary>/);
    expect(out).not.toMatch(/<details[^>]*open/);
    expect(out).toContain("GPT-Bengal · 5 hours");
  });

  it("says so, rather than drawing an empty general chart, when only model-specific limits were read", () => {
    const out = html([sample(at(0), codexValue([bucket("codex_bengalfox", [win(30, 300)], "GPT-Bengal")]))]);
    expect(out).toContain("No general Codex usage reading to plot in this period.");
    expect(out).not.toContain("Codex general usage over");
  });

  it("keeps a duration's colour across chart groups and when another duration enters history", () => {
    const legendTone = (out: string, label: string) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = out.match(new RegExp(`<span style="color:([^"]+)">[^<]+</span> ${escaped}</span>`));
      expect(match, `legend entry for ${label}`).not.toBeNull();
      return match?.[1];
    };
    const alone = html([sample(at(0), general(10))]);
    const together = html([sample(at(0), codexValue([
      bucket("codex", [win(10)]),
      bucket("model", [win(20, 300), win(30, WEEK, "secondary")], "Model"),
    ]))]);
    const expandedGeneral = html([sample(at(0), codexValue([
      bucket("codex", [win(20, 300), win(10, WEEK, "secondary")]),
    ]))]);
    expect(legendTone(together, "Model · 7 days")).toBe(legendTone(together, "7 days"));
    expect(legendTone(expandedGeneral, "7 days")).toBe(legendTone(alone, "7 days"));
    expect(expandedGeneral.indexOf("5 hours</span>")).toBeLessThan(expandedGeneral.indexOf("7 days</span>"));
  });

  it("identifies accounts across both chart groups and keeps their dash encoding consistent", () => {
    const generalA = sample(at(0), codexValue([bucket("codex", [win(10)])], { accountId: "cx-A" }));
    const specificB = sample(at(1), codexValue([bucket("model", [win(20)], "Model")], { accountId: "cx-B" }));
    const disjoint = html([generalA, specificB]);
    expect(disjoint).toContain("7 days · cx-A</span>");
    expect(disjoint).toContain("Model · 7 days · cx-B</span>");
    const bothB = sample(at(2), codexValue([
      bucket("codex", [win(30)]), bucket("model", [win(21)], "Model"),
    ], { accountId: "cx-B" }));
    const together = html([generalA, specificB, bothB]);
    expect(together.match(/stroke-dasharray="6 4"/g)).toHaveLength(2);
  });

  it("reserves space for percentage labels outside the SVG", () => {
    const out = html([sample(at(0), general(10))]);
    /* The HTML scale must have a gutter before the stretched SVG starts. */
    expect(out).toMatch(/class="[^"]*tw:relative[^"]*tw:pl-8[^"]*"/);
  });

  it("aligns the rejection strip with both providers' chart time axes", () => {
    const reading = sample(at(0), codexValue([
      bucket("codex", [win(10)]), bucket("model", [win(20)], "Model"),
    ]));
    if (reading.kind !== "sample" || reading.line.pass.kind !== "pass" || reading.line.pass.cache.kind !== "attributed") {
      throw new Error("fixture must carry an attributed Claude pass");
    }
    reading.line.pass.cache.windows = [{
      kind: "value", window: "five_hour", utilizationPercent: 40,
      resetsAt: new Date(at(0) + FIVE_MIN).toISOString(), resetsAtMs: at(0) + FIVE_MIN,
    }];
    reading.line.pass.scan.incidents = [{
      id: "five_hour@test", window: "five_hour", resetsAt: new Date(at(0) + FIVE_MIN).toISOString(),
      firstHitAt: new Date(at(0)).toISOString(), lastHitAt: new Date(at(0)).toISOString(),
      rejections: 1, unidentifiedRejections: 0, conversations: 1,
    }];
    const dom = new JSDOM(html([reading]));
    try {
      const axes = [...dom.window.document.querySelectorAll('svg[role="img"]')];
      expect(axes).toHaveLength(4);
      for (const axis of axes) {
        expect(axis.parentElement?.classList.contains("tw:pl-8"), axis.getAttribute("aria-label") ?? "axis").toBe(true);
      }
    } finally {
      dom.window.close();
    }
  });

  it("renders singleton readings as fixed-size round markers", () => {
    const out = html([sample(at(0), general(10))]);
    /* A round-capped zero-length stroke is a dot in CSS pixels. A viewBox
       circle scales into a narrow ellipse on a 390px phone. */
    const markers = [...out.matchAll(/<line ([^>]*stroke-linecap="round"[^>]*)>/g)];
    expect(markers).toHaveLength(1);
    const attrs = markers[0]?.[1] ?? "";
    const attr = (name: string) => attrs.match(new RegExp(`${name}="([^"]+)"`))?.[1];
    expect(attr("x1")).toBe(attr("x2"));
    expect(attr("y1")).toBe(attr("y2"));
    expect(attr("stroke-width")).toBe("4");
    expect(attr("vector-effect")).toBe("non-scaling-stroke");
  });
});
