/**
 * **WHEN IS "NO REJECTION WAS FOUND" A CLAIM, AND WHEN IS IT A SILENCE?**
 *
 * One predicate over `ScanCoverage`, in a leaf with no imports, so that the
 * fleet server's projection and the browser's own parser can both refuse a
 * reassuring reading that its own numbers do not support — without either of
 * them inventing a second rule.
 *
 * ## Why it is here rather than imported from the producer
 *
 * `absenceGap` in `tools/overseer/usage.ts` is the authority and this is a
 * mirror of it, clause for clause. It cannot be the same function: that module
 * reaches `node:child_process` and `node:fs`, and importing it into
 * `tools/fleet/` would close the cycle the seam exists to prevent and drag the
 * Overseer's whole module graph into the process you reach for when something
 * else is broken (`tools/fleet/attention.ts` § the file is the contract). It
 * cannot live in `wire.ts` either, which may hold no runtime values. So: a
 * leaf, imported by both sides of the boundary, which is the smallest thing
 * that stops there being three copies.
 *
 * **IF `absenceGap` GAINS A CLAUSE, THIS MUST TOO.** The two are checked against
 * each other by `tests/fleet-usage-absence.test.ts`, which drives both over the
 * same table — the only mechanism that can notice them drifting, since nothing
 * makes one file's edit visible in the other.
 *
 * ## Why a consumer checks it at all when the producer already refuses
 *
 * `summariseRateLimitScan` will not return `none` unless the absence is
 * conclusive, so on a healthy box this predicate never fires. It is here for the
 * payload that is not healthy: a hand-edited checkpoint, a partially written
 * file, a producer from a build that had a bug. **The failure it prevents is
 * the most expensive one this subsystem has** — a card reading *nothing is
 * blocking this account* over *scanned 0 of 0 transcripts, 0 lines* — and it
 * costs one call at each boundary. docs/reusable/silent-success.md.
 *
 * It only ever refuses MORE than the producer would. That is the safe
 * direction: the cost of a false refusal is a caveat on screen, and the cost of
 * a false acceptance is a reader who stops looking.
 */

/**
 * The longest window a rejection can still be in force in, in milliseconds.
 *
 * Restated rather than imported for the reason this whole file is — the
 * constant is `LONGEST_ACTIVE_WINDOW_MS` in `tools/overseer/usage.ts` and lives
 * behind a `node:child_process` import. Seven days is Anthropic's `seven_day`
 * window and is not a tuning knob.
 */
const LONGEST_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What a scan's own counts say is missing from its silence, or `null` when
 * nothing is.
 *
 * The shape a `ScanCoverage` must have — the fields, not the type, so this file
 * imports nothing. `wire.ts`'s `ScanCoverage` satisfies it structurally, which
 * is what makes it callable from both sides without either importing the other.
 */
export type AbsenceCoverage = {
  transcriptsFound: number;
  transcriptsSelected: number;
  transcriptsOpened: number;
  transcriptsUnreadable: number;
  unreadableWhy: readonly string[];
  linesScanned: number;
  candidateLines: number;
  linesParsed: number;
  malformedCandidates: number;
  truncatedByLimit: boolean;
  sinceMs: number | null;
};

export function absenceGapReason(coverage: AbsenceCoverage): string | null {
  if (coverage.transcriptsOpened === 0) {
    return `no transcript was opened (found ${coverage.transcriptsFound}, selected ${coverage.transcriptsSelected}, unreadable ${coverage.transcriptsUnreadable}) — this says nothing about whether a limit was hit`;
  }
  if (coverage.linesScanned === 0) {
    return `${coverage.transcriptsOpened} transcript(s) were opened and 0 lines were read — nothing was actually examined`;
  }
  if (coverage.transcriptsUnreadable > 0) {
    return `${coverage.transcriptsUnreadable} transcript(s) could not be read — any one of them could hold the rejection that is in force`;
  }
  if (coverage.candidateLines > coverage.linesParsed) {
    return `${coverage.candidateLines - coverage.linesParsed} of ${coverage.candidateLines} candidate line(s) did not parse — that is drift in the transcript shape rather than a half-written record`;
  }
  if (coverage.malformedCandidates > 0) {
    return `${coverage.malformedCandidates} record(s) looked like rejections and could not be read — the transcript shape has probably changed, so an absence cannot be trusted`;
  }
  if (coverage.truncatedByLimit) {
    return `the scan stopped at ${coverage.transcriptsSelected} of ${coverage.transcriptsFound} transcripts, so it did not look everywhere a rejection could be`;
  }
  if (coverage.sinceMs !== null && coverage.sinceMs < LONGEST_ACTIVE_WINDOW_MS) {
    return `the scan only covered transcripts modified in the last ${Math.round(coverage.sinceMs / 3_600_000)}h, and a seven-day rejection can still be in force ${Math.round(LONGEST_ACTIVE_WINDOW_MS / 3_600_000)}h after the transcript holding it was last written`;
  }
  return null;
}

/** The boolean half, for a caller that does not need the sentence. */
export function absenceIsSupportable(coverage: AbsenceCoverage): boolean {
  return absenceGapReason(coverage) === null;
}
