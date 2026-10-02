/**
 * **The arc prompt's version**, in a module that imports nothing, so the reader
 * may read it without bundling src/arc.ts and everything that imports. The
 * history of each bump is on `PROMPT_VERSION` in src/arc.ts.
 *
 * The reader compares a payload's arc against it (src/web/useArc.ts): an arc
 * an older prompt wrote stays on screen while the owner's open writes a new
 * one. docs/plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md § 2.
 */
export const ARC_PROMPT_VERSION = "arc/6";

const numberOf = (version: string | undefined): number | null => {
  const m = /^arc\/(\d+)$/.exec(version ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * **Was this arc written by an older prompt than this build's?** Strictly
 * older, and only a version that parses: a build rolled back past `arc/6` must
 * not rewrite an `arc/6` arc with `arc/5`, and a version it cannot read is not
 * evidence of anything. The same rule as Quotes' `isOutdated` (src/quotes.ts).
 * GPT Sol, plan review of 261002g.
 *
 * `currentVersion` defaults to the live constant. Supplying it lets the
 * regression test exercise the first two-digit boundary (`arc/9` → `arc/10`)
 * before the app itself reaches it; the production path never supplies it.
 */
export function isArcOutdated(
  version: string | undefined,
  currentVersion = ARC_PROMPT_VERSION,
): boolean {
  const theirs = numberOf(version);
  const ours = numberOf(currentVersion);
  return theirs !== null && ours !== null && theirs < ours;
}
