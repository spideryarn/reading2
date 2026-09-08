/**
 * Is this payload evidence about the box, or is it something that merely looks
 * like evidence?
 *
 * Everything the Overseer writes down is derived by diffing two snapshots, so
 * this is the gate the whole history hangs off. Nothing here does I/O, and
 * nothing at module scope does anything.
 *
 * ## Three arms, and the middle one is the ordinary case
 *
 *     accept | duplicate | reject
 *
 * **`duplicate` is normal, not degraded.** The Overseer subscribes to
 * `/api/live` AND polls `/api/state` when the stream drops, the SSE stream
 * pushes its cached snapshot to a subscriber on reconnect, and the dashboard
 * collects on a ~70s chain while a poll runs more often than that. So receiving
 * a collection you already have is what mostly happens. An earlier draft of
 * this treated a repeated `collectedAt` as degradation, which would have raised
 * a continuous alarm about two entirely healthy processes — GPT Sol's F6,
 * docs/plans/260908b-overseer-store-and-clock.md.
 *
 * **`reject` means the payload cannot be believed**, and its causes are all
 * things the producer really does emit:
 *
 *  - `error` non-null. The dashboard's catch sets `lastError`, **leaves the old
 *    `snapshot` in place, and calls `broadcast(statePayload())` anyway**
 *    (verified in `tools/fleet/server.ts`, in the code rather than in its
 *    comment). So a failed refresh is pushed down the SSE stream carrying rows
 *    from a collection that may be minutes old, wearing its old `collectedAt`.
 *  - never collected. Before the first collection `fleetState()` substitutes
 *    `rows: []` with `collectedAt: null`, so a poll against a just-restarted
 *    dashboard gets an empty fleet and a null clock. Diffing that against a
 *    register of thirty-six sessions is thirty-six manufactured disappearances.
 *  - the payload did not parse. Handled here rather than at the call site so
 *    there is one place that decides what to do about a snapshot, and no way to
 *    hold an unparsed body and a verdict at the same time.
 *
 * ## What is deliberately NOT a rule
 *
 * **There is no "rows must be non-empty" check.** It was in the first draft and
 * is removed (Sol F5): a drained or freshly rebooted box legitimately has zero
 * sessions, and that is evidence worth recording rather than a fault. The case
 * it was really guarding — the startup placeholder — is caught by the clock,
 * and the case it was imagined to catch — a regressed 35-of-36 payload — would
 * be non-empty anyway and is the strict parser's job.
 */
import type { FreshSnapshot, ObservedSnapshot, ParseResult } from "./observation.js";

/**
 * The verdict, with the sentence that goes in the log beside it.
 *
 * `accept` carries the snapshot, narrowed to `FreshSnapshot` — so a caller
 * cannot reach a snapshot this function refused, and `diff()` cannot be handed
 * the startup placeholder however carelessly the call is written. The reason is
 * on every arm, including `accept`: a history that says only "accepted" cannot
 * be read backwards to work out what the daemon thought it was doing.
 */
export type Admissibility =
  | { verdict: "accept"; reason: string; snapshot: FreshSnapshot }
  | { verdict: "duplicate"; reason: string }
  | { verdict: "reject"; reason: string };

/**
 * Decide about one payload, given the last one that was accepted.
 *
 * `previous` is the last ACCEPTED snapshot and is null until one has been —
 * not "the last one that arrived". Comparing against something that was
 * rejected would let a stale broadcast set the high-water mark and stall
 * everything after it.
 *
 * `next` is the parse RESULT rather than a snapshot, so that a failed parse
 * gets a verdict from the same function as everything else; see the module
 * comment.
 */
export function admissible(previous: FreshSnapshot | null, next: ParseResult<ObservedSnapshot>): Admissibility {
  if (!next.ok) return { verdict: "reject", reason: `the payload is not a snapshot: ${next.reason}` };

  const snapshot = next.value;

  // ERROR BEFORE CLOCK, deliberately. A failed refresh keeps the previous
  // collection's `collectedAt` untouched, so on a dashboard that has collected
  // once and failed since, the clock rule alone would call this a duplicate —
  // true, and the wrong sentence. What is actually happening is that the
  // producer is broken, which is a fact the Overseer records rather than a
  // silence it sits in.
  if (snapshot.error !== null) {
    return { verdict: "reject", reason: `the dashboard's last collection failed: ${snapshot.error}` };
  }

  if (!snapshot.clock.collected) {
    return {
      verdict: "reject",
      reason: "the dashboard has never collected, so its empty row list is a placeholder rather than an empty box",
    };
  }

  // The narrowing above is what makes this cast-free: `clock.collected` is
  // true, so the snapshot satisfies `FreshSnapshot`.
  const fresh: FreshSnapshot = { ...snapshot, clock: snapshot.clock };

  if (previous === null) {
    return { verdict: "accept", reason: "the first collection this Overseer has seen", snapshot: fresh };
  }

  if (fresh.clock.atMs === previous.clock.atMs) {
    return {
      verdict: "duplicate",
      reason: `the same collection as the last one (${fresh.clock.at}), which is what a reconnect and a poll both give`,
    };
  }

  // A CLOCK THAT WENT BACKWARDS IS NOT A DUPLICATE, and this is the one place
  // this file goes beyond what the plan spells out. "Has not advanced" covers
  // both equal and earlier, and treating them alike would be quieter: earlier
  // would be a silent no-op. But equal has an innocent explanation that happens
  // every minute, and earlier has none — a second producer on the same port, a
  // box whose clock was stepped back under a running dashboard, a cached body
  // served after a fresher one. All three are worth a sentence somebody reads.
  // It is also self-clearing: once the producer's clock passes the high-water
  // mark, snapshots are accepted again, whereas calling it a duplicate stalls
  // the history for as long as the skew lasts, silently.
  if (fresh.clock.atMs < previous.clock.atMs) {
    return {
      verdict: "reject",
      reason:
        `the dashboard's clock went backwards: this collection says ${fresh.clock.at} ` +
        `and the last one accepted said ${previous.clock.at}`,
    };
  }

  return { verdict: "accept", reason: `a collection from ${fresh.clock.at}`, snapshot: fresh };
}
