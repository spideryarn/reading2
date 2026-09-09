/**
 * **One instant, said three ways, behind whatever the page had room to print.**
 *
 * > include timezone because I'm bouncing between London/Athens
 * >
 * > — Greg, 2026-09-08 (`tools/fleet/zones.ts`)
 *
 * The dashboard prints times two ways and both throw something away. A relative
 * age (*4m ago*, *up 9m*) is the right thing to read at a glance and cannot be
 * compared against anything — a log line, a commit, a message in another
 * window. A raw ISO string (`2026-09-09T05:51:02.547Z`) can be compared against
 * all of those and is unreadable as a time of day, in a city, by a person.
 *
 * A card is where the other one goes. `zonedLine` already exists, is already
 * reachable from the browser bundle (`deploys-client.ts` is the precedent —
 * `zones.ts` is a leaf with no imports, which is why it may be imported here at
 * all), and already puts the `(+1d)` on a zone whose calendar date differs,
 * because *"02:40 Athens"* beside *"23:40 UTC"* otherwise reads as three hours
 * in the past.
 *
 * ## What the second paragraph has to say, and why it is not a freshness note
 *
 * **Every timestamp on this page is the box's clock**, and that is the thing a
 * reader cannot see and would not think to doubt. The transcript feed states it
 * outright — `wire.ts` § `FeedTurn.at`: the ISO is *"on the box's clock, exactly
 * as the transcript wrote it — never shifted to the browser's"*. So the honest
 * `how` is about whose clock produced the number, not about how old it is: the
 * masthead already carries the age and the skew, and repeating either here
 * would be a second answer to a question already answered on screen.
 *
 * **`null` in, `null` out is not an option here** — the caller has an instant it
 * has already drawn, so a card that refused to render would leave the one
 * unreadable timestamp on the page as the only one with no explanation. An
 * instant `zonedLine` cannot read says so instead.
 */
import { zonedLine } from "../../zones";
import type { Tip } from "./Tooltip";

/**
 * The card for an instant the page has printed, however it printed it.
 *
 * `head` is deliberately the same three words everywhere. These cards appear on
 * dozens of rows and a reader who has opened one has learnt what all of them
 * are; a per-site heading would make one mechanism look like twenty.
 */
export function instantTip(iso: string, whatItIs = "This time"): Tip {
  const line = zonedLine(iso);
  return {
    head: "The exact time",
    what:
      line === null
        ? `${whatItIs} was recorded as “${iso}”, which is not a time this page can read.`
        : `${whatItIs}, in the three clocks this box renders: ${line}.`,
    /* Not *"and it may be stale"*: the masthead owns freshness and says it with
       a number. What is unguessable is whose clock this is — and that a wrong
       clock on the box moves every one of these together, silently. */
    how: "Taken from the box's own clock and printed unshifted, so it can be compared against a log line or a commit. Nothing here corrects it against the clock in front of you.",
  };
}
