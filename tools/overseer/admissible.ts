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
 *  - it is late. Since 2026-09-10 the producer stamps each payload with the
 *    dashboard run that composed it and the collection its rows came from
 *    (docs/plans/260910d), and when both this payload and the last accepted
 *    one carry a readable stamp they are ordered by that rather than by the
 *    clock: a payload from a run already replaced, or an older collection of
 *    the same run, is refused; one collection wearing two clocks is a contract
 *    failure. When either is unstamped, the clock orders them as it always has.
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
import type { FreshSnapshot, ObservedRow, ObservedSnapshot, ParseResult, SourceOrdering } from "./observation.js";

/** A readable producer stamp — the only arm the run-and-collection rules read. */
type Stamped = Extract<SourceOrdering, { kind: "stamped" }>;

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
 * **WHAT THIS IS: NOMINAL.** `#snapshot` is an ECMAScript private field, which
 * TypeScript treats nominally — no object literal, no spread and no other class
 * is assignable to this type, because none of them carries that declaration —
 * and the class is not exported, so no other module can `new` one. Only the
 * type escapes.
 *
 * **WHAT THIS IS NOT: IMMUTABLE AT RUNTIME.** `readonly` is compile-time and
 * shallow. `Object.assign(box.snapshot, { error: "boom" })` compiles, and so
 * does `row.status.secondsLeft = 0` a level down. Nothing in this codebase does
 * either — checked across daemon.ts, store.ts, notes.ts and work.ts — and a
 * grep for `Object.assign` is what keeps that true. The freeze that would close
 * it was weighed and declined: it would walk the opaque `question` and `health`
 * JSON this module deliberately does not interpret, and freeze rows the store's
 * register holds by reference, which is more surface than the thing it guards.
 *
 * So the guarantee, at its true strength: **no forgery without a cast or a
 * mutation, and both are greppable.** `diff()` backs it up where it would cost
 * the most — one `unplaceable` assertion on its `previous`, at the single point
 * where a mutated baseline would bridge two tmux worlds.
 *
 * What it asserts, exactly: this snapshot parsed, its producer had really
 * collected, its last collection did not fail, and it comes AFTER the last one
 * accepted — by run and collection when both carry a readable producer stamp,
 * by clock when either does not. (It used to say "its clock is at or beyond
 * the last one accepted", which stopped being true on 2026-09-10: a newer
 * collection from the same dashboard run, or any collection from a new run, is
 * accepted whatever its clock says.) What it does NOT assert is that its contents are true
 * about the box — nothing at this stage can know that. Nor does it assert that
 * the snapshot may become HISTORY: that is `Baseline` in diff.ts, a separate
 * type for a separate permission, because "safe to compare against" and "safe
 * to keep as the world" are not the same claim.
 */
class AdmissibleBox {
  readonly #snapshot: FreshSnapshot;

  constructor(snapshot: FreshSnapshot) {
    this.#snapshot = snapshot;
  }

  /** What was accepted. The live object, not a copy — see the type's comment. */
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
 * rejected would let a stale broadcast set the ordering mark and stall or
 * misorder everything after it.
 *
 * `next` is the parse RESULT rather than a snapshot, so that a failed parse
 * gets a verdict from the same function as everything else; see the module
 * comment.
 */
export function admissible(
  previous: AdmissibleSnapshot | null,
  next: ParseResult<ObservedSnapshot>,
  /**
   * The dashboard runs this daemon has seen replaced by a later one. REQUIRED
   * rather than defaulted to an empty set, so that a call site which forgot it
   * is a compile error rather than a gate that quietly accepts a dead run's
   * late payload as a new run. A caller with none passes an empty set in as
   * many words, which is true of it.
   */
  retired: ReadonlySet<string>,
): Admissibility {
  if (!next.ok) return { verdict: "reject", reason: `the payload is not a snapshot: ${next.reason}` };

  const snapshot = next.value;

  // BY RUN AND COLLECTION WHEN BOTH SIDES CAN SAY, and only then. When either
  // is unstamped or its stamp unreadable, `stamps` is null, every rule below
  // that mentions it is skipped, and the clock rules at the end apply exactly
  // as they did before stamps existed. Stamped-after-unstamped is deliberately
  // one of those cases: an upgrade is a restart and could be called a new run,
  // but so could a stamped producer whose stamp was briefly unreadable, and the
  // two cannot be told apart — the clock is yesterday's answer and safe in both.
  const before = previous?.snapshot.ordering;
  const stamps: { before: Stamped; next: Stamped } | null =
    before?.kind === "stamped" && snapshot.ordering.kind === "stamped" ? { before, next: snapshot.ordering } : null;

  if (stamps !== null) {
    // A REPLACED RUN FIRST, before anything else about the payload is read.
    // Whatever it says — an error, a placeholder, rows — it is a previous
    // dashboard process speaking late, and none of it is news about the box.
    // Accepting it would diff across two runs of the producer, which can flap
    // every session in the fleet.
    if (retired.has(stamps.next.instance)) {
      return {
        verdict: "reject",
        reason:
          `this payload is from dashboard run ${stamps.next.instance}, which has been replaced by a later run; ` +
          `a previous run's payload arriving late is not news about the box`,
      };
    }
    // OUT OF ORDER BEFORE THE ERROR CHECK, and that order is the point of this
    // rule sitting here. An old error publication arriving after a newer
    // success would otherwise be told "the dashboard's last collection failed"
    // — a sentence about a failure that has already recovered. What is true of
    // it is that it is late.
    if (stamps.next.instance === stamps.before.instance && ordinal(stamps.next) < ordinal(stamps.before)) {
      return {
        verdict: "reject",
        reason:
          `this payload is out of order: dashboard run ${stamps.next.instance} has already delivered collection ` +
          `${String(stamps.before.inventory)}, and this one carries ${describeInventory(stamps.next)} (publication ${stamps.next.publication})`,
      };
    }
  }

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
    // A NEW RUN THAT HAS NOT COLLECTED YET IS A RESTART, and the sentence has
    // to say so: a dashboard restart is ordinary, and "never collected" on its
    // own reads as a fault. (A SAME-run payload with no collection after one
    // with a collection never reaches here: it is out of order, above.)
    if (stamps !== null && stamps.next.instance !== stamps.before.instance) {
      return {
        verdict: "reject",
        reason:
          `a new dashboard run (${stamps.next.instance}, after ${stamps.before.instance}) has not collected yet — ` +
          `a restart is normal — so its empty row list is a placeholder rather than an empty box`,
      };
    }
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

  if (stamps !== null) {
    // A NEW RUN IS ACCEPTED WHATEVER ITS CLOCK SAYS. The source is sequential
    // and single, and a dashboard process cannot change runs without
    // restarting, so an unseen run is a later run. The one payload that could
    // contradict that — a previous run's, arriving late — is what `retired`
    // refused above. A restart onto a clock that was stepped back is exactly
    // the case the clock rule used to stall on.
    if (stamps.next.instance !== stamps.before.instance) {
      return {
        verdict: "accept",
        reason: `the first collection from a new dashboard run (${stamps.next.instance}, after ${stamps.before.instance}), from ${fresh.clock.at}`,
        snapshot: bless(fresh),
      };
    }
    // SAME RUN, SAME COLLECTION: a duplicate whatever `servedAt`, `health` or
    // `publication` say — those change between keeps and are not ordering
    // facts. But only if the collection agrees, and here the clock is PART of
    // the collection: one collection wearing two `collectedAt`s is an old
    // snapshot re-stamped, which would otherwise move `lastGoodSnapshotAt` and
    // tell the watchdog it measured something it did not.
    if (stamps.next.inventory === stamps.before.inventory) {
      const disagreement = collectionDisagreement(previous.snapshot, fresh);
      if (disagreement !== null) {
        return {
          verdict: "reject",
          reason:
            `two payloads claim to be collection ${String(stamps.next.inventory)} of dashboard run ${stamps.next.instance}: ${disagreement}. ` +
            `The producer publishes one collection with one body and one clock, so this is a contract failure rather than a repeat.`,
        };
      }
      return {
        verdict: "duplicate",
        reason: `collection ${String(stamps.next.inventory)} of dashboard run ${stamps.next.instance} again (${fresh.clock.at}), which is what a reconnect and a poll both give`,
      };
    }
    // SAME RUN, NEWER COLLECTION — lower was refused above — and accepted
    // whatever the clock did. A collection is newer because the producer
    // counted it, not because its timestamp is larger.
    return {
      verdict: "accept",
      reason: `collection ${String(stamps.next.inventory)} of dashboard run ${stamps.next.instance}, from ${fresh.clock.at}`,
      snapshot: bless(fresh),
    };
  }

  // NOT BOTH STAMPED: TODAY'S CLOCK RULES, EXACTLY.
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
 * Where a stamp sits in its run: its collection ordinal, with "never collected"
 * (null) below every collection. Within one run the inventory never goes back
 * to null, so a null arriving after a number is a publication from before the
 * run's first collection, delivered late — the same fact as a lower ordinal.
 */
function ordinal(stamp: Stamped): number {
  return stamp.inventory ?? 0;
}

function describeInventory(stamp: Stamped): string {
  return stamp.inventory === null ? "no collection at all (it was published before the run's first)" : `collection ${stamp.inventory}`;
}

/**
 * What two payloads claiming one collection disagree about, or null if they
 * agree. "One collection" is the same clock when either payload is unstamped,
 * and the same run and collection ordinal when both are stamped.
 *
 * THE CLOCK IS COMPARED FIRST, and only the stamped case can fail it: equal
 * clocks are how the unstamped caller got here. For a stamped pair it is the
 * whole point — one collection re-published under a later `collectedAt` is an
 * old snapshot wearing a new timestamp, and accepting it would move
 * `lastGoodSnapshotAt` without anything having been measured.
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
  if (previous.clock.atMs !== next.clock.atMs) {
    return `one says it was collected at ${previous.clock.at} and the other at ${next.clock.at}`;
  }
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
