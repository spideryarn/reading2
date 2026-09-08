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
 * **It is `duplicate` only if the payload agrees**, though. Two bodies that
 * disagree under one `collectedAt` are not a repeat of anything, and since
 * 2026-09-08 they are a `reject` naming the inconsistency — see
 * `collectionDisagreement` below, and GPT Sol's S2-05.
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
import type { FreshSnapshot, ObservedRow, ObservedSnapshot, ParseResult } from "./observation.js";

/**
 * A snapshot this function accepted, and the only thing `diff()` will take.
 *
 * **A WRAPPER, NOT A BRAND, AND THE SECOND ATTEMPT AT THIS.** The first was
 * `FreshSnapshot & { [ADMISSIBLE]: … }`, an intersection — and an intersection
 * brand rides along on a spread. `{ ...accepted, error: "boom" }` kept the
 * brand, needed no cast, and produced a snapshot claiming a gate had approved
 * it while carrying the one field that gate exists to refuse; `diff()` would
 * then turn a failed collection into a fleet's worth of false disappearances.
 * Mutating `accepted.error` did the same thing without even a spread. GPT Sol
 * found both, 2026-09-08, after the brand was already in.
 *
 * The box closes both. `#snapshot` is an ECMAScript private field, which
 * TypeScript treats NOMINALLY: no object literal, no spread, and no other class
 * is assignable to this type, because none of them has that declaration. The
 * class itself is not exported, so no other module can `new` one — only the
 * type escapes. And `snapshot` hands back a `FreshSnapshot` whose own fields
 * are `readonly`, so the copy a caller reads cannot be edited into a lie
 * either.
 *
 * What it asserts, exactly: this snapshot parsed, its producer had really
 * collected, its last collection did not fail, and its clock is at or beyond
 * the last one accepted. What it does NOT assert is that its contents are true
 * about the box — nothing at this stage can know that. Nor does it assert that
 * the snapshot may become HISTORY: that is `Baseline` in diff.ts, a separate
 * type for a separate permission, because "safe to compare against" and "safe
 * to keep as the world" are not the same claim.
 *
 * A cast still forges one, as a cast forges anything. The point is that it now
 * takes a cast rather than an object literal.
 */
class AdmissibleBox {
  readonly #snapshot: FreshSnapshot;

  constructor(snapshot: FreshSnapshot) {
    this.#snapshot = snapshot;
  }

  /** What was accepted. Readonly throughout, so reading it cannot un-accept it. */
  get snapshot(): FreshSnapshot {
    return this.#snapshot;
  }
}

export type AdmissibleSnapshot = AdmissibleBox;

/**
 * The verdict, with the sentence that goes in the log beside it.
 *
 * `accept` carries the snapshot, branded — so a caller cannot reach a snapshot
 * this function refused, and `diff()` cannot be handed the startup placeholder
 * however carelessly the call is written. The reason is on every arm, including
 * `accept`: a history that says only "accepted" cannot be read backwards to
 * work out what the daemon thought it was doing.
 */
export type Admissibility =
  | { verdict: "accept"; reason: string; snapshot: AdmissibleSnapshot }
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
export function admissible(previous: AdmissibleSnapshot | null, next: ParseResult<ObservedSnapshot>): Admissibility {
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
  // true, so the snapshot satisfies `FreshSnapshot`. THE `new` IS THE GATE —
  // the one place in the Overseer where an `AdmissibleSnapshot` comes into
  // existence, after every rule above has run, and unreachable from any other
  // module because `AdmissibleBox` is not exported.
  const bless = (fresh: FreshSnapshot): AdmissibleSnapshot => new AdmissibleBox(fresh);
  const fresh: FreshSnapshot = { ...snapshot, clock: snapshot.clock };

  if (previous === null) {
    return { verdict: "accept", reason: "the first collection this Overseer has seen", snapshot: bless(fresh) };
  }

  if (fresh.clock.atMs === previous.snapshot.clock.atMs) {
    // EQUAL CLOCKS ARE ONLY A DUPLICATE IF THE PAYLOAD AGREES, and until
    // 2026-09-08 this arm did not look (GPT Sol's S2-05). A successful payload
    // wearing a `collectedAt` is a copy of one collection — the SSE cache and a
    // poll both serve the same `statePayload()` — so two bodies that disagree
    // under one clock are not a repeat of anything. They are two producers on
    // one port, or a reboot the clock did not record, and the disagreement is
    // the only evidence of it there will ever be. Calling that a duplicate
    // throws the evidence away and goes quiet, which is this codebase's worst
    // failure shape rather than its safest one.
    const disagreement = collectionDisagreement(previous.snapshot, fresh);
    if (disagreement !== null) {
      return {
        verdict: "reject",
        reason:
          `two different collections claim the same clock (${fresh.clock.at}): ${disagreement}. ` +
          `The producer makes equal-clock payloads identical, so this is a contract failure rather than a repeat.`,
      };
    }
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
  if (fresh.clock.atMs < previous.snapshot.clock.atMs) {
    return {
      verdict: "reject",
      reason:
        `the dashboard's clock went backwards: this collection says ${fresh.clock.at} ` +
        `and the last one accepted said ${previous.snapshot.clock.at}`,
    };
  }

  return { verdict: "accept", reason: `a collection from ${fresh.clock.at}`, snapshot: bless(fresh) };
}

/**
 * What two payloads wearing one clock disagree about, or null if they agree.
 *
 * WHAT IS COMPARED IS THE COLLECTION, NOT THE PAYLOAD, and the difference is
 * the whole design of this function. `health` is re-probed on its own schedule
 * and is carried verbatim by this module precisely because it is not
 * interpreted here; `refreshMs` and `answeringEnabled` describe the dashboard's
 * configuration rather than its reading of the box. Comparing those would let
 * the Overseer reject a perfectly ordinary duplicate over a field it has
 * declared it does not read — a false alarm that would stall the history, which
 * is the same silence this rule exists to prevent, arrived at from the other
 * side.
 *
 * So the comparison is `rows`, `tmuxServerPid` and `tookMs`: everything the
 * collection with that `collectedAt` on it actually said about the box.
 *
 * Serialised rather than walked field by field. The rows carry `question` as
 * opaque JSON, which no structural comparison written here could keep up with,
 * and both bodies are built by the same parser in the same field order from
 * payloads the same producer serialised — so identical collections give
 * identical strings, and the only false positive available is a producer that
 * reordered its own keys between two responses.
 */
function collectionDisagreement(previous: FreshSnapshot, next: FreshSnapshot): string | null {
  if (previous.tmuxServerPid !== next.tmuxServerPid) {
    return `the tmux generation is ${String(previous.tmuxServerPid)} in one and ${String(next.tmuxServerPid)} in the other`;
  }
  if (previous.rows.length !== next.rows.length) {
    return `one lists ${previous.rows.length} sessions and the other ${next.rows.length}`;
  }
  if (previous.tookMs !== next.tookMs) {
    return `one took ${previous.tookMs}ms to collect and the other ${next.tookMs}ms`;
  }
  const differing = next.rows.find((row, index) => rowText(row) !== rowText(previous.rows[index]));
  if (differing !== undefined) return `the row for ${differing.id} (${differing.name}) differs`;
  return null;
}

function rowText(row: ObservedRow | undefined): string {
  return JSON.stringify(row ?? null);
}
