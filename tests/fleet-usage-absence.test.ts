/**
 * **THE ONE MECHANISM THAT CAN NOTICE TWO COPIES OF ONE RULE DRIFTING APART.**
 *
 * `absenceGap` in `tools/overseer/usage.ts` decides whether a scan's silence is
 * a claim; `absenceGapReason` in `tools/fleet/usage-absence.ts` is a mirror of
 * it, and it exists because the fleet cannot import the first without dragging
 * `node:child_process` into the dashboard (`tools/fleet/usage-absence.ts`'s
 * header has the argument in full).
 *
 * **Nothing else makes an edit to one visible in the other.** Two copies of a
 * rule that only ever run in different processes do not disagree loudly — they
 * disagree by one of them quietly accepting a reassuring reading the other
 * would have refused, which is the whole failure this rule exists to prevent.
 * So this file drives both over the same table and asserts they AGREE, case by
 * case, including the ones neither is expected to fire on.
 *
 * If a clause is added to either, add the case here and add it to the other.
 * A test that only checks the fleet copy against itself would pass through the
 * exact drift it is here to catch.
 */
import { describe, expect, it } from "vitest";

import { absenceGapReason, absenceIsSupportable, type AbsenceCoverage } from "../tools/fleet/usage-absence.js";
import type { ScanCoverage } from "../tools/fleet/wire.js";
import { absenceGap, absenceIsConclusive } from "../tools/overseer/usage.js";

/** A scan that looked everywhere and found nothing — the only shape a `none` may have. */
const CONCLUSIVE: ScanCoverage = {
  transcriptsFound: 240,
  transcriptsSelected: 240,
  transcriptsOpened: 240,
  transcriptsUnreadable: 0,
  unreadableWhy: [],
  linesScanned: 232961,
  candidateLines: 27,
  linesParsed: 27,
  malformedCandidates: 0,
  quotaLimitsWithoutErrorSignal: 0,
  truncatedByLimit: false,
  /* Eight days: longer than the longest window a rejection can still be live
     in, which is the last clause of the rule. */
  sinceMs: 8 * 24 * 60 * 60 * 1000,
  tookMs: 41_233,
};

/**
 * One case per clause, plus the conclusive one — **and each is named for the
 * thing a reader would wrongly conclude if it were let through.**
 */
const CASES: { name: string; coverage: ScanCoverage; supportable: boolean }[] = [
  { name: "a scan that looked everywhere", coverage: CONCLUSIVE, supportable: true },
  {
    name: "a scan that opened nothing (the pure zero-means-we-did-not-look case)",
    coverage: { ...CONCLUSIVE, transcriptsOpened: 0 },
    supportable: false,
  },
  {
    name: "a scan that opened transcripts and read no lines",
    coverage: { ...CONCLUSIVE, linesScanned: 0 },
    supportable: false,
  },
  {
    name: "a scan with an unreadable transcript — any one of them could hold the live rejection",
    coverage: { ...CONCLUSIVE, transcriptsUnreadable: 2, unreadableWhy: ["x.jsonl vanished"] },
    supportable: false,
  },
  {
    name: "a candidate line that did not parse — drift in the transcript shape",
    coverage: { ...CONCLUSIVE, candidateLines: 27, linesParsed: 26 },
    supportable: false,
  },
  {
    name: "a rejection-shaped record that could not be read",
    coverage: { ...CONCLUSIVE, malformedCandidates: 1 },
    supportable: false,
  },
  {
    name: "a scan cut short by the transcript bound",
    coverage: { ...CONCLUSIVE, truncatedByLimit: true },
    supportable: false,
  },
  {
    name: "a scan bounded to less than the longest live window",
    coverage: { ...CONCLUSIVE, sinceMs: 24 * 60 * 60 * 1000 },
    supportable: false,
  },
  {
    name: "a scan with no mtime bound at all",
    coverage: { ...CONCLUSIVE, sinceMs: null },
    supportable: true,
  },
  {
    name: "a scan exactly at the seven-day boundary",
    coverage: { ...CONCLUSIVE, sinceMs: 7 * 24 * 60 * 60 * 1000 },
    supportable: true,
  },
];

describe("absenceGapReason mirrors the producer's absenceGap", () => {
  for (const { name, coverage, supportable } of CASES) {
    it(`agrees about ${name}`, () => {
      /* THE VERDICTS MUST MATCH. The prose deliberately does not — the fleet
         copy is shorter, because it renders on a card rather than in a terminal
         — so this compares the decision, which is the part that can be wrong in
         a way nobody sees. */
      expect(absenceIsSupportable(coverage)).toBe(supportable);
      expect(absenceIsConclusive(coverage)).toBe(supportable);
      /* And both say something when they refuse, and nothing when they do not:
         a gap with no sentence is a card with a caveat and no reason on it. */
      expect(absenceGapReason(coverage) === null).toBe(supportable);
      expect(absenceGap(coverage) === null).toBe(supportable);
    });
  }

  it("takes a wire ScanCoverage without an adapter", () => {
    /* `AbsenceCoverage` is structural precisely so neither side needs to import
       the other's type. If `ScanCoverage` stops satisfying it, this stops
       compiling — which is the point of the assignment. */
    const structural: AbsenceCoverage = CONCLUSIVE;
    expect(absenceGapReason(structural)).toBeNull();
  });
});
