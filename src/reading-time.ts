/**
 * How long the article takes to read, stated once.
 *
 * It lives in a module of its own because two things now say it out loud — the
 * masthead over an article you are already reading (src/web/Masthead.tsx), and
 * the library card you decide from before you open it (src/api.ts). Those run
 * on opposite sides of the wire, so nothing would ever have told us they had
 * drifted: the card would say 47 min, the masthead 54, and both would look
 * perfectly reasonable on their own page. See docs/reusable/silent-success.md.
 *
 * No dependencies, deliberately — the client imports this too, so it must not
 * pull in anything node-side.
 */

/** Words per minute. The middling end of the usual 200–250 range for prose. */
export const WPM = 230;

/** Never zero: a two-line article still takes a moment to read. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / WPM));
}
