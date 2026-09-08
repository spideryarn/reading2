/**
 * `3 days ago` — a timestamp said the way a reader thinks about it.
 *
 * Greg asked for these on 2026-08-26, and they are worth more than an absolute
 * date on exactly the fields the shelf sorts by: *when did I last open this* is
 * a question about distance from now, and "20 Aug 2026" makes you do the
 * subtraction yourself.
 *
 * **Relative only while it is still relative.** Past about a month, "43 days
 * ago" is worse than the date — nobody counts in days at that range — so it
 * hands back to an absolute date. That switch is the one decision in here.
 *
 * The exact time is never lost: everything that prints one of these keeps the
 * full timestamp in a tooltip or a `title`.
 *
 * Pure, and takes `now` as an argument, because a function that reads the clock
 * is a function nothing can test.
 */

/** How far past which a date reads better as a date. */
const ABSOLUTE_AFTER_DAYS = 30;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `numeric: "auto"` is what turns -1 day into "yesterday" rather than "1 day
 * ago". It is the only reason to use `Intl.RelativeTimeFormat` over arithmetic
 * and a string, and it is also the reason this cannot be tested against exact
 * English: a different locale says something else, correctly.
 */
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** `12 Aug 2026`. */
function absolute(t: number): string {
  return new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * How long ago, or the date if that is too long ago.
 *
 * `undefined` for absent and for unparseable alike — the two are the same thing
 * to a reader, and collapsing them here means no caller has to check for `NaN`.
 * That matters more than it looks: `Date.parse("soon")` is `NaN`, `NaN` in a
 * comparison is `false` in both directions, and a sort built on it silently
 * does nothing.
 */
export function timeAgo(iso: string | undefined, now: number): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;

  /* A timestamp in the future is a clock disagreeing with itself — the server's
     against the browser's — not a fact about the article. Clamped rather than
     rendered, because "in 4 seconds" next to an article you just opened reads
     as a bug in a way that "just now" does not. */
  const ago = Math.max(0, now - t);

  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return relative.format(-Math.round(ago / MINUTE), "minute");
  if (ago < DAY) return relative.format(-Math.round(ago / HOUR), "hour");
  if (ago < ABSOLUTE_AFTER_DAYS * DAY) return relative.format(-Math.round(ago / DAY), "day");
  return absolute(t);
}

/** `25 Aug 2026, 14:02` — where precision is the point, and the tooltip has room. */
export function exactly(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t)
    ? undefined
    : new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * `640ms`, `6.1s`, `1m 12s` — a duration in the unit a person would have used.
 *
 * The other half of this file's job: `timeAgo` says *when*, this says *how
 * long*. Both are wall-clock milliseconds turned into the sentence somebody
 * would have said, and both are pure so a test can pin them.
 *
 * **It lived in `Tweets.tsx` from 2026-08-26 to 2026-09-08**, where it showed
 * how long a thread took to write. The metadata page's step rows wanted the same
 * string ("how long it took" —
 * docs/plans/260908a-exact-time-and-duration-on-the-metadata-step-rows.md) and
 * a second copy was written before anybody noticed the first, which is exactly
 * the *"two ways to do one thing"* CLAUDE.md warns about. This is the one, and
 * the two behaviours below are what the merge settled.
 *
 * **Milliseconds below a second**, which the Tweets copy did not have — it said
 * `0.5s`. The difference between 30ms and 900ms is the difference between a
 * copied row and a real read, and on this page it is the thing worth seeing.
 * No thread has ever been fast enough for that branch to change what Tweets
 * shows.
 *
 * **`an unknown time` for a non-finite or negative input**, which the metadata
 * copy did not have — it is why Tweets shows this at all. Greg's original asked
 * the SDK for its own timings, got empty values back, and rendered them as
 * `0ms`: a duration that reads as *instant* rather than as *we don't know*. The
 * metadata card never reaches this branch, because `tookFor` returns `null`
 * first (`Metadata.tsx`) — a card that said "took an unknown time" beside a
 * timestamp it is certain of would be worse than one that says nothing.
 *
 * **Every boundary is decided on the rounded number, not the raw one.** Rounding
 * after the comparison gives `1000ms`, `60.0s` — the Tweets copy had that one —
 * and `3m 60s`, from a 239.6s run whose minutes were floored before its seconds
 * were rounded up.
 */
export function howLong(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "an unknown time";
  const whole = Math.round(ms);
  /* `16ms`, not `16 ms`, unlike SI and unlike `weight` in Metadata.tsx: the
     card there is 22rem and its line already carries a full date with a
     timezone, so a space here is a place the quantity can break across two
     lines — seen in a browser, with `16` above and `ms` below. The two units
     under it have no space either. */
  if (whole < 1000) return `${whole}ms`;
  const tenths = Math.round(ms / 100) / 10;
  if (tenths < 60) return `${tenths.toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds - minutes * 60}s`;
}
