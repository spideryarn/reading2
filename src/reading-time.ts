/**
 * How long the article takes to read, stated once.
 *
 * It lives in a module of its own because two things now say it out loud — the
 * masthead over an article you are already reading (src/web/Masthead.tsx), and
 * the library card you decide from before you open it (src/library-scalars.ts). Those run
 * on opposite sides of the wire, so nothing would ever have told us they had
 * drifted: the card would say 47 min, the masthead 54, and both would look
 * perfectly reasonable on their own page. See docs/reusable/silent-success.md.
 *
 * No dependencies, deliberately — the client imports this too, so it must not
 * pull in anything node-side.
 */

/**
 * Words per minute: the average for an adult reading English non-fiction
 * silently, from Brysbaert's 2019 meta-analysis of 190 studies (J. Memory and
 * Language 109). It was 230, "the middling end of the usual 200–250 range",
 * until 2026-10-05 — a fair folk number; this one has a source.
 *
 * **A flat rate, and it does not know how hard the piece is.** Why not, and
 * what it would take: docs/research/261005a-reading-time-estimates-and-text-difficulty.md.
 */
export const WPM = 238;

/**
 * The ends of the range the same paper gives: "most adults fall in the range of
 * 175 to 300 wpm" for non-fiction. The card that explains the estimate says
 * this range out loud (src/web/ReadTimeCard.tsx), because reading pace varies
 * between readers as well as between texts.
 */
export const WPM_QUICK = 300;
export const WPM_SLOW = 175;

function minutesAt(words: number, wpm: number): number {
  return Math.max(1, Math.round(Math.max(0, words) / wpm));
}

/** Never zero: a two-line article still takes a moment to read. */
export function readingMinutes(words: number): number {
  return minutesAt(words, WPM);
}

/** The minutes a quick and a slow reader would take: `quick` ≤ `readingMinutes` ≤ `slow`. */
export function readingRange(words: number): { quick: number; slow: number } {
  return { quick: minutesAt(words, WPM_QUICK), slow: minutesAt(words, WPM_SLOW) };
}
