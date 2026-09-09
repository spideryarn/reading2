/**
 * The usage-history record's codec and its incident merge contract.
 *
 * Written before the module, and red first. Every case here exists because GPT
 * Sol found it in one of two plan reviews — the IDs (F…, G…) are its findings,
 * and docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md is the
 * specification. The dead ends are in
 * docs/research/260909a-usage-history-the-dead-ends-and-how-the-plan-was-wrong-twice.md.
 *
 * The theme running through the whole file: **a history record must not be able
 * to claim more than it observed.** Most of these tests are about a wrong answer
 * that would look exactly like a right one on a chart.
 */
import { describe, expect, it } from "vitest";

import {
  LINE_SCHEMA,
  MAX_EPOCH_MS,
  MAX_LINE_BYTES,
  MAX_WHY_CHARS,
  SUMMARY_SCHEMA,
  decodeUsageHistoryLine,
  encodeUsageHistoryLine,
  mergeIncidents,
  type CacheObservation,
  type HistoryIncident,
  type UsageHistoryLine,
} from "../tools/fleet/usage-history-record.js";

const CACHE: CacheObservation = {
  kind: "attributed",
  accountUuid: "eddd4c75-0024-4636-b7ca-d727eaeca66b",
  fetchedAt: "2026-09-09T00:50:35.885Z",
  windows: [
    {
      kind: "value",
      window: "five_hour",
      utilizationPercent: 40,
      resetsAt: "2026-09-09T02:49:59.754Z",
      resetsAtMs: 1788922199754,
    },
    { kind: "unknown", window: "nimbus_quill", why: "no resets_at, so the utilization (0) cannot be checked" },
  ],
};

function pass(over: Partial<UsageHistoryLine> = {}): UsageHistoryLine {
  return {
    lineSchema: LINE_SCHEMA,
    summarySchema: SUMMARY_SCHEMA,
    recordedAt: "2026-09-09T00:50:40.000Z",
    nextDueMs: 300_000,
    pass: {
      kind: "pass",
      collectedAt: "2026-09-09T00:50:35.000Z",
      accountUuid: "eddd4c75-0024-4636-b7ca-d727eaeca66b",
      cache: CACHE,
      scan: { conclusive: true, why: null, incidents: [] },
      publication: { decision: "take-fresh", why: "this scan finished, so it is the better reading" },
    },
    ...over,
  };
}

function incident(over: Partial<HistoryIncident> = {}): HistoryIncident {
  return {
    id: "five_hour@2026-09-09T02:49:59.754Z",
    window: "five_hour",
    resetsAt: "2026-09-09T02:49:59.754Z",
    firstHitAt: "2026-09-09T00:10:00.000Z",
    lastHitAt: "2026-09-09T00:20:00.000Z",
    rejections: 1,
    unidentifiedRejections: 0,
    conversations: 1,
    ...over,
  };
}

describe("encode/decode", () => {
  it("round-trips a pass", () => {
    const decoded = decodeUsageHistoryLine(encodeUsageHistoryLine(pass()));
    expect(decoded.kind).toBe("line");
    if (decoded.kind !== "line") return;
    expect(decoded.line).toEqual(pass());
  });

  it("round-trips a collector failure, which has no collectedAt at all", () => {
    /* GPT Sol F3. The daemon's throw arm is `{kind:"none", at}` — there is no
       `collectedAt` anywhere in it. An earlier draft of this format required one
       on every arm, which would have meant either collapsing every failure into
       the first, dropping them all, or falling back to the checkpoint's
       `writtenAt` and writing the same failure every thirty seconds. */
    const line = pass({ pass: { kind: "collector-failed", at: "2026-09-09T00:55:00.000Z", why: "ENOENT" } });
    const decoded = decodeUsageHistoryLine(encodeUsageHistoryLine(line));
    expect(decoded.kind).toBe("line");
    if (decoded.kind !== "line") return;
    expect(decoded.line.pass).toEqual({ kind: "collector-failed", at: "2026-09-09T00:55:00.000Z", why: "ENOENT" });
  });

  it("encodes one line with no interior newline, because the file is line-delimited", () => {
    const encoded = encodeUsageHistoryLine(pass({ pass: { kind: "collector-failed", at: "2026-09-09T00:55:00.000Z", why: "a\nb" } }));
    expect(encoded.endsWith("\n")).toBe(true);
    expect(encoded.slice(0, -1).includes("\n")).toBe(false);
  });

  it("REFUSES to encode a pass whose source instant is not a real instant", () => {
    /* The record's whole value is that a point can be placed in time. A line
       that cannot be placed is worse than an absent one, because it still
       occupies a position. */
    expect(() => encodeUsageHistoryLine(pass({ pass: { ...pass().pass, collectedAt: "yesterday" } as never }))).toThrow(
      /collectedAt/,
    );
    expect(() =>
      encodeUsageHistoryLine(pass({ pass: { kind: "collector-failed", at: "", why: "x" } })),
    ).toThrow(/at/);
  });

  it("REFUSES to encode a non-finite or non-positive nextDueMs", () => {
    /* GPT Sol G8. Without a cadence on the record, a reader assuming 300 s marks
       every interval of an injected or changed cadence as a recorder failure —
       and adding the field later is a persisted-format change. It is required on
       EVERY arm, failures included. */
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => encodeUsageHistoryLine(pass({ nextDueMs: bad }))).toThrow(/nextDueMs/);
    }
    expect(() =>
      encodeUsageHistoryLine(
        pass({ nextDueMs: Number.NaN, pass: { kind: "collector-failed", at: "2026-09-09T00:55:00.000Z", why: "x" } }),
      ),
    ).toThrow(/nextDueMs/);
  });

  it("REFUSES an epoch that is finite but not representable as a Date", () => {
    /* Finite is not the same as in range, and this is the check that gets
       skipped. `new Date(1e100)` is an ordinary Invalid Date and
       `.toISOString()` on it THROWS — so a number that passed a
       `Number.isFinite` guard at the boundary detonates later, in a renderer,
       with no idea where it came from. The Overseer's own `usage.ts` had the
       same gap on external epochs; caught there first and passed to me by the
       Overseer before I shipped it here. */
    for (const bad of [1e100, -1e100, Number.NaN, 8.64e15 + 1]) {
      const l = pass();
      if (l.pass.kind !== "pass" || l.pass.cache.kind !== "attributed") throw new Error("fixture");
      const w = l.pass.cache.windows[0];
      if (w?.kind !== "value") throw new Error("fixture");
      w.resetsAtMs = bad;
      expect(() => encodeUsageHistoryLine(l), `accepted ${bad}`).toThrow(/resetsAtMs/);
    }
    /* And the boundary itself is fine, so the guard is not off by one. */
    const ok = pass();
    if (ok.pass.kind !== "pass" || ok.pass.cache.kind !== "attributed") throw new Error("fixture");
    const w = ok.pass.cache.windows[0];
    if (w?.kind !== "value") throw new Error("fixture");
    w.resetsAtMs = MAX_EPOCH_MS;
    expect(() => encodeUsageHistoryLine(ok)).not.toThrow();
    expect(() => new Date(MAX_EPOCH_MS).toISOString()).not.toThrow();
  });

  it("truncates an over-long `why` rather than writing an unbounded line", () => {
    const line = pass({ pass: { kind: "collector-failed", at: "2026-09-09T00:55:00.000Z", why: "x".repeat(9_000) } });
    const decoded = decodeUsageHistoryLine(encodeUsageHistoryLine(line));
    expect(decoded.kind).toBe("line");
    if (decoded.kind !== "line" || decoded.line.pass.kind !== "collector-failed") return;
    expect(decoded.line.pass.why.length).toBeLessThanOrEqual(MAX_WHY_CHARS + 40);
    expect(decoded.line.pass.why).toMatch(/truncated/);
  });

  it("keeps a realistic line far under the legal ceiling", () => {
    /* Measured on the live checkpoint 2026-09-09: 140 hits collapse to 9
       clusters, and the projected incidents were ~4.2 KB against 58.4 KB of raw
       hits. The ceiling is 64 KiB; a real line should be nowhere near it, and if
       one ever is, the rotation arithmetic in the store changes. */
    const many = Array.from({ length: 9 }, (_, i) => incident({ id: `five_hour@w${i}`, rejections: 27 }));
    const line = pass({ pass: { ...pass().pass, scan: { conclusive: true, why: null, incidents: many } } as never });
    expect(Buffer.byteLength(encodeUsageHistoryLine(line), "utf8")).toBeLessThan(8 * 1024);
  });

  it("REFUSES to encode a line that would exceed the legal ceiling", () => {
    const many = Array.from({ length: 5_000 }, (_, i) => incident({ id: `five_hour@w${i}` }));
    const line = pass({ pass: { ...pass().pass, scan: { conclusive: true, why: null, incidents: many } } as never });
    expect(() => encodeUsageHistoryLine(line)).toThrow(/MAX_LINE_BYTES|too large/);
    expect(MAX_LINE_BYTES).toBe(64 * 1024);
  });
});

describe("decoding what this build does not understand", () => {
  it("returns an UNSUPPORTED marker for a future summarySchema, not a dropped line", () => {
    /* GPT Sol G7, and this is the P0 in this file. Suppose schema 2 writes
       twelve samples and the dashboard is rolled back to a schema-1 reader. If
       "skip" means "remove from samples", the chart connects the last point
       before that hour to the first one after it and claims continuous
       observation across data it explicitly could not read. The marker has to
       survive POSITIONALLY so the series can be broken. */
    const future = JSON.stringify({ ...pass(), summarySchema: SUMMARY_SCHEMA + 1 });
    const decoded = decodeUsageHistoryLine(future);
    expect(decoded.kind).toBe("unsupported");
    if (decoded.kind !== "unsupported") return;
    expect(decoded.summarySchema).toBe(SUMMARY_SCHEMA + 1);
  });

  it("distinguishes UNREADABLE bytes from an unsupported schema", () => {
    /* Not the same thing, and conflating them loses the only signal that says
       whether the file is corrupt or merely newer than this reader. */
    expect(decodeUsageHistoryLine("{not json").kind).toBe("unreadable");
    expect(decodeUsageHistoryLine(JSON.stringify({ lineSchema: 1 })).kind).toBe("unreadable");
  });

  it("never throws, whatever the bytes are", () => {
    for (const raw of ["", "null", "[]", '"a string"', "{}", '{"summarySchema":"one"}']) {
      expect(() => decodeUsageHistoryLine(raw)).not.toThrow();
    }
  });
});

describe("the incident merge contract", () => {
  /* GPT Sol G2. A stable id is NOT a merge contract. The same incident is richer
     on later passes — the card's own committed test constructs exactly that
     sequence: one rejection on the first pass, two rejections and another
     conversation on the second, same id. Keeping the first occurrence
     permanently under-reports; keeping the last lets an incomplete scan replace
     richer evidence with poorer. */

  it("widens the span to the earliest and latest instants ever observed", () => {
    const merged = mergeIncidents([
      { conclusive: true, incidents: [incident({ firstHitAt: "2026-09-09T00:10:00.000Z", lastHitAt: "2026-09-09T00:20:00.000Z" })] },
      { conclusive: true, incidents: [incident({ firstHitAt: "2026-09-09T00:05:00.000Z", lastHitAt: "2026-09-09T00:31:00.000Z" })] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ firstHitAt: "2026-09-09T00:05:00.000Z", lastHitAt: "2026-09-09T00:31:00.000Z" });
  });

  it("takes the LARGEST count from a CONCLUSIVE scan, and says that is what it did", () => {
    /* Counts from disjoint incomplete scans cannot be unioned exactly without
       raw hit ids, which this format deliberately does not store. That is only
       acceptable because the number is labelled "most seen in one complete
       scan" rather than "rejections in these 24 hours" — so the flag that lets
       the UI say so is part of the contract, not a nicety. */
    const merged = mergeIncidents([
      { conclusive: true, incidents: [incident({ rejections: 27, conversations: 16 })] },
      { conclusive: false, incidents: [incident({ rejections: 40, conversations: 30 })] },
    ]);
    expect(merged[0]).toMatchObject({ rejections: 27, conversations: 16, fromConclusiveScan: true });
  });

  it("lets a LATER conclusive scan displace an earlier inconclusive count, even downwards", () => {
    /* Found by mutation, not by writing tests: the suite above only ever put the
       conclusive scan FIRST, and every rule gets that ordering right by
       accident. Reverse it and the bug appears — `Math.max` keeps the stale 40
       while `fromConclusiveScan` still flips to true, so the UI labels a number
       from an incomplete scan as "most seen in one complete scan". A lie, and
       exactly the class this whole file exists to prevent.

       Downwards is not hypothetical: an incident's rejections can fall between
       passes as transcripts age out of the eight-day scan window. The rule is
       not "the larger number wins" — the counts are not comparable across scans
       of different completeness. */
    const merged = mergeIncidents([
      { conclusive: false, incidents: [incident({ rejections: 40, conversations: 30 })] },
      { conclusive: true, incidents: [incident({ rejections: 27, conversations: 16 })] },
    ]);
    expect(merged[0]).toMatchObject({ rejections: 27, conversations: 16, fromConclusiveScan: true });
  });

  it("falls back to the largest inconclusive count, and FLAGS it, when no complete scan saw it", () => {
    const merged = mergeIncidents([
      { conclusive: false, incidents: [incident({ rejections: 3 })] },
      { conclusive: false, incidents: [incident({ rejections: 5 })] },
    ]);
    expect(merged[0]).toMatchObject({ rejections: 5, fromConclusiveScan: false });
  });

  it("marks an incident UNREADABLE when its invariant fields disagree", () => {
    /* Same id, different window or reset instant, means one of the two records
       is lying about what it observed. Picking either would publish a fiction. */
    const merged = mergeIncidents([
      { conclusive: true, incidents: [incident()] },
      { conclusive: true, incidents: [incident({ window: "seven_day" })] },
    ]);
    expect(merged[0]).toMatchObject({ unreadable: true });
  });

  it("keeps an incident with no known hit time, unplaced rather than dropped", () => {
    /* It must not be pinned to scan time — that would claim the rejection
       happened when we happened to look. Listed, unplaced, and the UI says so. */
    const merged = mergeIncidents([{ conclusive: true, incidents: [incident({ firstHitAt: null, lastHitAt: null })] }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ firstHitAt: null, lastHitAt: null, unreadable: false });
  });

  it("does not merge different windows that happen to reset at the same instant", () => {
    const merged = mergeIncidents([
      {
        conclusive: true,
        incidents: [
          incident({ id: "five_hour@t", window: "five_hour" }),
          incident({ id: "seven_day@t", window: "seven_day" }),
        ],
      },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("carries no account identity of any kind", () => {
    /* A transcript 429 carries no account id at all, and the scan covers eight
       days that may span a /login swap. Anything account-shaped on a merged
       incident would be manufactured attribution. */
    const merged = mergeIncidents([{ conclusive: true, incidents: [incident()] }]);
    expect(JSON.stringify(merged)).not.toMatch(/account/i);
  });
});
