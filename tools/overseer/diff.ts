/**
 * What changed between two snapshots — the events the Overseer's history is
 * made of.
 *
 * Pure. Nothing here does I/O, and nothing at module scope does anything.
 *
 * ## The two rules that matter, and both are about NOT recording things
 *
 * Every bug this module can have has the same shape: the wrong answer is not an
 * error, it is a **plausible history**. Nothing looks broken afterwards, and
 * there is nothing to grep for. So both of the load-bearing rules here are
 * refusals.
 *
 * **1. Identity is the PAIR (tmux handle, claimed conversation), never the
 * handle alone.** The handle is immutable and is the right address for a live
 * view, which is why `gjd-remote` uses it. For a history it is wrong: a tmux
 * session can be resumed into a different conversation and keep its handle, its
 * name and its pane, so a timeline keyed on the handle splices two
 * conversations into one and shows one agent apparently working continuously.
 * Reached independently by the dashboard agent (from resumption) and by GPT Sol
 * (from handle reuse), 2026-09-08.
 *
 * **The second half of that pair is a claim, and it decays in one direction
 * only.** The uuid comes out of the tmux environment, is pinned there before
 * Claude ever runs, and is never updated afterwards — so a uuid that CHANGES
 * means the pane's conversation changed, and a uuid that DOES NOT change means
 * nothing at all. The pair is still the best key available and is still used;
 * what it cannot do is prove continuity. `ObservedRow.claimedConversationId`
 * has the measurements and `session-replaced` below has the consequence.
 *
 * **2. The diff refuses to run across a tmux generation boundary.**
 * `tmuxServerPid` is the generation. When the tmux server dies its handles
 * start again at `$0`, so a stored `$1643` and a live `$1643` are different
 * sessions wearing one name and nothing inside the row can tell them apart.
 * Diffing across that boundary produces a burst of `session-replaced` that
 * never happened — and a reboot is precisely the event this whole system exists
 * to survive. So a generation change closes out every session from the old
 * world and starts the new one fresh. It is not a variant of "replaced"; it is
 * a rule about when not to compare.
 *
 * **And when the generation cannot be READ, a snapshot with sessions in it is
 * held rather than diffed** — see `DiffOutcome`. "I could not tell which world
 * this is" is not "the same world", and treating it as one lets a reboot slip
 * through between two unreadable readings.
 *
 * ## The canonical key, and why status objects are never compared structurally
 *
 * Measured over the real capture in `tests/fixtures/overseer-snapshots/`: **51
 * status comparisons differed in some field, 2 differed in anything
 * meaningful.** `waiting.secondsLeft` counts down on every collection, so a
 * structural comparison writes fifty-one events a quarter of an hour, of which
 * forty-nine say nothing and the two that matter are buried. An earlier capture
 * measured 36:1 the same way.
 *
 * So the key is `kind`, plus `shell.busy`, plus `unknown.cause`, plus
 * `unknown.reportedStatus`. Countdowns and prose are excluded — see
 * `SessionUnknownCause` in scripts/gjd-remote-tmux.ts, which is where the rule
 * is written down, and `reportedStatus`, which is the one exception and carries
 * its own argument for being one.
 */
import type { SessionState } from "../../scripts/gjd-remote-tmux.js";
import type { AdmissibleSnapshot } from "./admissible.js";
import type { FreshSnapshot, ObservedRow, ObservedStatus } from "./observation.js";

/**
 * A snapshot that has become the world the next one is compared against.
 *
 * **A SEPARATE PERMISSION FROM ADMISSIBILITY, and the P0 came back because it
 * was not.** `admissible()` answers "is this evidence?"; this answers "may this
 * stand as what the fleet WAS?" — and the second is strictly narrower, because
 * a snapshot whose tmux generation nobody could read is perfectly good evidence
 * and a hopeless world. The first fix expressed that by leaving `baseline` off
 * the `held` arm, which discourages a caller and stops nobody: they still hold
 * the snapshot they passed in, and `baseline = b` compiled. GPT Sol, 2026-09-08.
 *
 * So a baseline is a thing only `diff()` can produce. `admissible()` mints
 * something you may diff AGAINST; only a completed diff mints something you may
 * KEEP. `#snapshot` makes that nominal — no literal, spread or other class is
 * assignable — and the class is not exported, so no other module can build one.
 * The first call of a daemon's life is therefore `diff(null, next)`, which is
 * also exactly what a cold start means.
 */
class BaselineBox {
  readonly #snapshot: FreshSnapshot;

  constructor(snapshot: FreshSnapshot) {
    this.#snapshot = snapshot;
  }

  /** The world, for a caller that wants to log which collection it is standing on. */
  get snapshot(): FreshSnapshot {
    return this.#snapshot;
  }
}

export type Baseline = BaselineBox;

/**
 * Can this snapshot stand as the world the next one is compared against?
 *
 * ONE PREDICATE, TWO CALLERS, AND THAT IS THE WHOLE DESIGN. `diff()` asks it
 * before comparing and `baselineOf()` asks it before promoting, so there is no
 * way to obtain a baseline the differ would have refused — not by keeping the
 * snapshot you passed in, and not by re-blessing bytes off the disk. Writing
 * the test twice is how the two would come apart.
 *
 * **It is a question about the VALUE, not about where the value came from.**
 * That is what makes it hold: a provenance rule ("only `diff()` may mint one")
 * is one API call away from being wrong forever, and this one cannot be, because
 * the property is checkable on any snapshot at any time.
 *
 * The property: a snapshot with sessions in it and no readable `tmuxServerPid`
 * cannot be placed in a world. Its `$7` may be a fresh allocation wearing an
 * old number, so comparing anything to it attributes one session's history to
 * another. An EMPTY fleet with an unreadable generation is fine — there are no
 * handles to equate — and refusing it would stall the history over a payload
 * that cannot mislead anyone.
 */
function unplaceable(snapshot: FreshSnapshot): boolean {
  return snapshot.tmuxServerPid === null && snapshot.rows.length > 0;
}

/**
 * A baseline from a snapshot that did not come out of a `diff()` — the restart
 * path, and the only other way to get one.
 *
 * **WHY THIS EXISTS.** S4 persists the last good snapshot as the producer's own
 * wire bytes and, after a crash, re-parses and re-blesses them. That snapshot is
 * genuinely admissible and has no diff behind it, so without this the daemon
 * would have to restart with `diff(null, …)` — which announces every session on
 * the box as newly seen, every time it restarts. A history that says the fleet
 * appeared out of nothing each morning is the same class of fiction as the one
 * the P0 was about, arrived at from the other end.
 *
 * **WHY IT IS NOT A HOLE.** It refuses exactly what `diff()` holds, by calling
 * the same predicate: a snapshot whose world cannot be placed is not a baseline
 * however it was obtained, so a caller holding one this module just held gets
 * `null` here too.
 *
 * **READ THE NULL.** `diff(baselineOf(x), next)` compiles when this returns
 * null and quietly means "cold start", which announces the whole fleet. Branch
 * on it and say something; do not pass it straight through.
 */
export function baselineOf(snapshot: AdmissibleSnapshot): Baseline | null {
  const fresh = snapshot.snapshot;
  return unplaceable(fresh) ? null : new BaselineBox(fresh);
}

/** Which session, in the best terms available — one of which is not a fact. */
export type SessionIdentity = {
  /** tmux's own session handle, `$1991`. Unique within one tmux server and meaningless across two. */
  tmuxId: string;
  /**
   * What the tmux environment claims is running in the pane. Null for a shell,
   * a `setup`, and a legacy session that never pinned one — and stale for any
   * pane whose Claude has been replaced since launch. Not an identity; see
   * `ObservedRow.claimedConversationId`, which also says why this is a plain
   * string rather than a branded one.
   */
  claimedConversationId: string | null;
};

/**
 * The identity as one comparable string.
 *
 * Branded so it cannot be passed where a name or a handle is wanted: the three
 * ids in this system are all strings and two of them start with `$`, and the
 * cost of mixing them up is a history rather than a crash.
 */
export type SessionKey = string & { readonly __brand: "overseer-session-key" };

/**
 * A space separates the halves and the second half is TAGGED, and the tag is
 * the part doing the work: without it, "no conversation" and "a conversation
 * whose id happens to be the empty string" are one key. `claudeId` comes out of
 * a tmux environment variable that anybody can set by hand, so "that cannot
 * happen" is not available here — `sessionState` already carries an arm for
 * somebody having set it to something that is not a session id.
 *
 * A space is unambiguous because the left half is `$` and digits and nothing
 * else, which the parser checks.
 */
export function sessionKey(identity: SessionIdentity): SessionKey {
  const conversation =
    identity.claimedConversationId === null ? "none" : `claims:${identity.claimedConversationId}`;
  return `${identity.tmuxId} ${conversation}` as SessionKey;
}

export function identityOf(row: ObservedRow): SessionIdentity {
  return { tmuxId: row.id, claimedConversationId: row.claimedConversationId };
}

/**
 * A status reduced to what a change in it would MEAN.
 *
 * Branded for the same reason as `SessionKey`: it is a string that looks like a
 * status name and is not one, and comparing it to `status.kind` by accident
 * would be true often enough to look right.
 */
export type StatusKey = string & { readonly __brand: "overseer-status-key" };

/**
 * The canonical transition key.
 *
 * A SWITCH WITH A `never` DEFAULT rather than a lookup table, because the
 * `never` is what breaks the build the day `SessionState` grows an arm — and
 * the failure mode of a missed arm here is that two genuinely different states
 * share a key and the transition between them is never recorded. That is
 * invisible in every test that does not already know about the new arm.
 */
export function statusKey(status: SessionState): StatusKey {
  switch (status.kind) {
    case "needs-you":
    case "working":
    case "idle":
    case "no-claude":
      return status.kind as StatusKey;
    // `secondsLeft` IS DELIBERATELY ABSENT. It counts down on every collection,
    // and including it is the single mistake that would make this log useless
    // — see the module comment for the measurement. What that costs is a wait
    // RESTARTED between two collections, which this key cannot see and
    // `session-wait-restarted` catches with an implied deadline instead.
    case "waiting":
      return "waiting" as StatusKey;
    // `busy` is in, because it is the difference between a shell grinding
    // through `npm test` and one sitting at a prompt, and null is a third
    // answer ("could not ask") rather than a missing one.
    case "shell":
      return `shell:${String(status.busy)}` as StatusKey;
    // `cause` is in and `why` is out: `why` is OUR sentence, reworded freely and
    // interpolating the box's error text, so two calls a minute apart can
    // describe one unchanging situation. `reportedStatus` is in despite looking
    // like the same kind of thing, because it is the BOX'S observation and
    // changes only when the box says something different — without it, a Claude
    // Code that reports `compacting` and then `waiting-for-input` produces one
    // key and the intermediate state is lost. GPT Sol's S1-1.
    case "unknown":
      return `unknown:${status.cause}${status.reportedStatus === undefined ? "" : `:${status.reportedStatus}`}` as StatusKey;
    default: {
      const never: never = status;
      throw new Error(`no transition key for status ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Why a session stopped being in the snapshot.
 *
 * Two arms rather than one, because they are two different facts and only one
 * of them is about that session. `absent-from-snapshot` means this session went
 * away while the world carried on; `tmux-server-changed` means the world went
 * away and took every session with it, so the timestamp on the event is when we
 * NOTICED rather than when it happened.
 */
export type GoneReason = "absent-from-snapshot" | "tmux-server-changed";

/**
 * What the differ writes down.
 *
 * Every arm carries the identity and the key, so a reader of the log never has
 * to recompute one, and the `at`/`tmuxServerPid` pair so an event can be placed
 * in a world as well as in time. `tmuxServerPid` is the generation the EVENT'S
 * session belonged to — the old one for a gone event across a boundary — since
 * an address is meaningless without it.
 *
 * `session-replaced` is not accompanied by a `tmux-session-gone` and a
 * `session-seen`. Emitting those two would be false twice over: the tmux
 * session did not go anywhere, and the new conversation is not something that
 * merely appeared. One event, carrying both identities, is the thing that
 * actually happened.
 *
 * ## `session-replaced` FIRING IS EVIDENCE; ITS SILENCE IS NOT
 *
 * Read this before trusting the absence of one. The uuid is pinned into the
 * tmux environment at `tmux new-session -e …` and is never written again, so
 * when a pane's Claude exits and another starts in that pane, the row goes on
 * naming the first conversation and **this event does not fire in exactly the
 * case it was invented for.** Measured on the live box, 2026-09-08.
 *
 * The consequence is worth spelling out because it is not a failure anyone will
 * notice: a consumer keyed on a stale claim does not error and does not return
 * nothing. It returns real, well-formed, correctly-attributed content — from a
 * conversation that is not on the screen. That is the most convincing wrong
 * answer available, and it is the same class as every other hazard on this
 * page: a plausible history rather than a broken one.
 *
 * **What would resolve it, when a stage exists that may do I/O:** the
 * transcript's `lastModified`. A transcript TAIL is ~4.5 ms and under 1% of the
 * bytes of a 33 MB file, so liveness evidence is affordable — it is not
 * affordable HERE, because this stage is pure. Whatever supplies it should
 * arrive as an extra argument to `diff()` rather than as a reshaping of these
 * events; no seam is built for it yet, because a speculative one would be
 * structure bought against a signal nobody has measured through.
 *
 * Note also that `meta.dir` will not find that transcript: `EnterWorktree`
 * moves the file to the worktree's slug while `dir` names the primary.
 */
export type OverseerEvent =
  | {
      kind: "session-seen";
      at: string;
      tmuxServerPid: number | null;
      key: SessionKey;
      identity: SessionIdentity;
      /** The whole row: this is the event the register is built from, and `meta.dir` is not recoverable later. */
      row: ObservedRow;
    }
  | {
      kind: "session-status";
      at: string;
      tmuxServerPid: number | null;
      key: SessionKey;
      identity: SessionIdentity;
      from: StatusKey;
      to: StatusKey;
      /** The status itself as well as the key, so the log says `waiting` with its countdown and orders by the key. */
      status: SessionState;
    }
  | {
      kind: "tmux-session-gone";
      at: string;
      tmuxServerPid: number | null;
      key: SessionKey;
      identity: SessionIdentity;
      /** Carried for legibility: a grep of the log should name the agent, not only its handle. */
      name: string;
      why: GoneReason;
    }
  | {
      kind: "session-replaced";
      at: string;
      tmuxServerPid: number | null;
      /** The NEW pair. The old one is `previous`. */
      key: SessionKey;
      identity: SessionIdentity;
      previous: SessionIdentity;
      previousKey: SessionKey;
      row: ObservedRow;
    }
  /**
   * A NEW WAIT, on a session that was already waiting — the transition the
   * canonical key cannot see.
   *
   * `statusKey` maps every wait to `"waiting"`, which is right and is what
   * keeps the log from filling with countdowns, but it means `secondsLeft: 60`
   * followed by `secondsLeft: 3600` is one key and the history reads as a
   * single uninterrupted wait when what really happened is that a wait ended
   * and an hour-long one began. GPT Sol's S2-03.
   *
   * DEADLINES, NOT KEY MATERIAL. Putting `secondsLeft` in the key would bring
   * back the fifty-one events the measurement above is about. What separates
   * the two cases is the IMPLIED DEADLINE — when the observation was taken,
   * plus what was left — which an ordinary countdown holds still and a
   * restarted wait shoves later. See `waitDeadlineToleranceMs`, which asks the
   * producer how uncertain this particular pair of readings is rather than
   * assuming a number.
   *
   * A deadline that moves EARLIER is silent. That is a countdown, a wait
   * shortened by hand, or jitter; none of it is a new wait, and the wait's end
   * will announce itself when the status changes.
   */
  | {
      kind: "session-wait-restarted";
      at: string;
      tmuxServerPid: number | null;
      key: SessionKey;
      identity: SessionIdentity;
      /** What the wait was going to end at, as implied by the previous snapshot. */
      previousDeadline: string;
      /** What it is going to end at now. Later than the one above by more than the tolerance. */
      deadline: string;
      /** The waiting status itself, so the log can say how long the new wait is. */
      status: SessionState;
    };

/**
 * The part of the deadline bound that is not measured: whole-second rounding on
 * both countdowns, plus a second of slack for a clock the box adjusted.
 *
 * `secondsLeft` is an integer, so each implied deadline is already up to a
 * second away from the real one, and the difference of two of them up to two.
 */
export const WAIT_DEADLINE_ROUNDING_MS = 2_000;

/**
 * How far an implied deadline may drift later, for THIS pair of collections,
 * before it is a new wait rather than the same one seen twice.
 *
 * **NOT A CONSTANT, AND IT WAS ONE FOR A DAY.** Two wrong answers came before
 * this, and both are worth keeping because the second looks like the first's
 * lesson learned:
 *
 * 1. **120 s, sized from the collection interval.** Wrong because jitter
 *    CANCELS: the producer derives `secondsLeft` from a real deadline rather
 *    than sampling it independently, so a later collection carries a
 *    proportionally smaller countdown and the sum does not move. Measured on
 *    the live box, 2026-09-08 05:43–05:49 UTC — six consecutive collections,
 *    three `waiting` sessions, implied deadline stable to **72 ms**, and it did
 *    not move when a collection was MISSED and the interval doubled. A 120 s
 *    tolerance would have hidden a wait restarted from 60 s to 120 s, which is
 *    the defect S2-03 is about.
 * 2. **10 s, sized from the spread of collection durations in that capture.**
 *    Right about the term that moves — the countdown is read off the pane early
 *    in a run and `collectedAt` is stamped when the run ends, so the implied
 *    deadline carries the run's length — but wrong to freeze it. Every
 *    collection in that capture took 3.8–3.9 s. On a loaded box they take
 *    5.7–11.0 s (the fixtures README), and there is no ceiling: a 4 s
 *    collection followed by a 20 s one moves the deadline ~16 s later with no
 *    wait having changed, and a fixed 10 s bound calls that a restart. GPT Sol.
 *
 * **The producer tells us the number.** `tookMs` is on every snapshot, so the
 * sampling uncertainty is bounded rather than assumed: the countdown was read
 * somewhere inside the later collection, so its implied deadline is at most
 * that collection's own duration too late. Nothing about the earlier collection
 * enters — its duration can only push its deadline LATER, which makes the
 * difference smaller, and a difference that shrinks is not reported anyway.
 *
 * The cost, stated rather than hidden: **on a collection that took twenty
 * seconds, a wait extended by less than twenty-two is invisible.** That is the
 * right side to err on — a false positive is a fabricated event, which is this
 * module's worst outcome, and the smallest restart worth recording is minutes
 * long — and unlike a constant it tightens automatically on a healthy box,
 * where the bound is about six seconds.
 */
export function waitDeadlineToleranceMs(nextTookMs: number): number {
  return nextTookMs + WAIT_DEADLINE_ROUNDING_MS;
}

/**
 * How two snapshots' tmux generations relate.
 *
 * THREE ARMS, NOT A BOOLEAN, and `unverifiable` is why. A null generation means
 * the box could not be asked — a tmux busy enough to time out a listing is
 * exactly the box this tooling is for — and treating "I could not tell" as "it
 * changed" would close out the entire fleet every time the box was under load,
 * which is when it is least true and most alarming. `generationDrift()` in
 * tools/fleet/collect.ts makes the same call for the same reason, one layer
 * down.
 */
export type GenerationRelation = "same" | "changed" | "unverifiable";

export function generationRelation(before: number | null, after: number | null): GenerationRelation {
  if (before === null || after === null) return "unverifiable";
  return before === after ? "same" : "changed";
}

/**
 * Why a snapshot was not diffed, as a token the daemon can switch on.
 *
 * A union of one, deliberately: a second reason is a compile error at every
 * caller that thought there was only one, which is the point of naming it at
 * all rather than returning a bare sentence.
 */
export type HoldReason = "generation-unreadable";

/**
 * What `diff()` did — and, crucially, whether the baseline may move.
 *
 * A DISCRIMINATED UNION RATHER THAN AN ARRAY, so that "we could not safely
 * compare these" is a thing the caller has to answer for.
 *
 * **WITHHOLDING `baseline` FROM THE `held` ARM IS NOT WHAT STOPS THE CALLER**,
 * and believing it was is how the P0 survived its first fix. The caller still
 * holds the snapshot it passed in; `baseline = b` compiled and nothing said a
 * word. What stops it is `Baseline` being a type this module alone can produce,
 * and only from a snapshot that passes `unplaceable` — so the shape of this
 * union is a convenience for reading the result, and the guarantee lives in the
 * type of the thing it carries. GPT Sol's S2-01, twice.
 *
 * **A hold is not silence, and it must not become silence.** "Correct and
 * unavailable" and "nothing is happening" look identical in an event log, and
 * telling them apart is most of why the Overseer exists. So the `held` arm
 * carries both a token to switch on and the sentence to write down, and the
 * daemon stage is expected to record it. A degradation EVENT would have been
 * the other way to do this; it is not, because every arm of `OverseerEvent` is
 * about one session and this is about the Overseer's own condition — an arm
 * with no session in it would be the first thing to make that union incoherent.
 */
export type DiffOutcome =
  | { kind: "diffed"; events: OverseerEvent[]; baseline: Baseline }
  | { kind: "held"; why: HoldReason; reason: string };

/**
 * The events between two accepted snapshots.
 *
 * `previous` is null for the first snapshot after a cold start, which yields a
 * `session-seen` per row — correct, and the reason S3 needs a checkpoint: a
 * daemon that restarts without one re-announces sessions it already knew about.
 *
 * Order is deterministic and is part of the contract, because these events are
 * appended to a log and read back in order: closures first, in the previous
 * snapshot's row order, then everything else in the next snapshot's row order.
 * A `session-seen` for a handle that a `tmux-session-gone` in the same batch
 * refers to is therefore always the later of the two.
 *
 * ## THE BLIND SPOT THIS CANNOT COVER, stated because absence is invisible
 *
 * A session that starts after one snapshot and exits before the next is not in
 * either of them, so it appears in no event and the history says it never ran.
 * No pure differ can do better: there is no evidence in the two payloads from
 * which to derive one. It is a SAMPLING limit rather than a bug — the window is
 * one collection interval, about 70 s — and it is worth knowing about for the
 * same reason as the stale-claim asymmetry on `session-replaced`: the log's
 * silence about a session is not a statement that nothing happened. The only
 * fixes are outside this module (a shorter interval, or the producer telling us
 * what it saw between collections), and neither is worth buying yet. GPT Sol's
 * S2-08. Also in tests/fixtures/overseer-snapshots/README.md, under what the
 * fixtures do not cover.
 */
export function diff(previous: Baseline | null, next: AdmissibleSnapshot): DiffOutcome {
  const nextSnapshot = next.snapshot;
  const at = nextSnapshot.clock.at;

  // BEFORE ANYTHING IS COMPARED, AND BEFORE THE BASELINE COULD MOVE. A snapshot
  // with sessions in it and no readable generation cannot be placed in a world:
  // if tmux restarted between it and the last one, its `$7` is a fresh
  // allocation wearing an old number, and diffing it produces either silence
  // (handle, claim and status happen to coincide) or a status transition
  // attributed to a session that no longer exists. `100 → null → 200` used to
  // be two `unverifiable` steps, both diffed, which is how a reboot could pass
  // through this module leaving no trace. Holding keeps the baseline at the
  // last snapshot whose world is known, so the reboot is found — as a
  // generation CHANGE — the moment a readable generation arrives.
  //
  // AN EMPTY FLEET IS EXEMPT, and not as a convenience: there are no handles to
  // equate, so there is nothing a wrong guess about the world could
  // mis-attribute. A drained box with an unreadable generation is still
  // evidence, and refusing it would stall the history over a payload that
  // cannot mislead anyone.
  //
  // ONLY `next` IS CHECKED, and `previous` needs no check because the TYPE has
  // already made it. Every `Baseline` in existence went through `unplaceable`
  // — here or in `baselineOf()` — so a `previous` with rows and no generation
  // cannot be constructed. This used to be an argument about callers being
  // disciplined, which is what GPT Sol reopened the P0 over.
  if (unplaceable(nextSnapshot)) {
    return {
      kind: "held",
      why: "generation-unreadable",
      reason:
        `the collection at ${at} lists ${nextSnapshot.rows.length} sessions and no tmux generation, ` +
        `so its handles cannot be told apart from the ones already recorded`,
    };
  }

  if (previous === null) {
    return {
      kind: "diffed",
      events: nextSnapshot.rows.map((row) => seen(row, at, nextSnapshot.tmuxServerPid)),
      baseline: new BaselineBox(nextSnapshot),
    };
  }

  const previousSnapshot = previous.snapshot;

  const relation = generationRelation(previousSnapshot.tmuxServerPid, nextSnapshot.tmuxServerPid);
  switch (relation) {
    case "changed":
      // A DIFFERENT WORLD, so nothing is compared across it. Every handle in
      // `previous` belonged to a tmux server that no longer exists, and every
      // handle in `next` is a fresh allocation that may reuse the same number.
      // The alternative — matching them up — produces a burst of replacements
      // that reads as a plausible afternoon and describes a reboot.
      return {
        kind: "diffed",
        events: [
          ...previousSnapshot.rows.map((row) => gone(row, at, previousSnapshot.tmuxServerPid, "tmux-server-changed")),
          ...nextSnapshot.rows.map((row) => seen(row, at, nextSnapshot.tmuxServerPid)),
        ],
        baseline: new BaselineBox(nextSnapshot),
      };
    case "same":
    case "unverifiable":
      break;
    default: {
      const never: never = relation;
      throw new Error(`unhandled generation relation ${String(never)}`);
    }
  }

  // Keyed by HANDLE, not by identity, because that is the question being asked
  // here: is this tmux session still there, and if so is it still the same
  // conversation? Identity keys the register; the handle keys the comparison.
  const before = new Map(previousSnapshot.rows.map((row) => [row.id, row]));
  const after = new Map(nextSnapshot.rows.map((row) => [row.id, row]));

  const events: OverseerEvent[] = [];

  for (const row of previousSnapshot.rows) {
    // Only the tmux session going removes a row. Claude exiting does NOT — the
    // row stays and becomes `no-claude` — which is why this event has the word
    // `tmux` in it and why a consumer must not read it as "the agent finished".
    if (!after.has(row.id)) events.push(gone(row, at, previousSnapshot.tmuxServerPid, "absent-from-snapshot"));
  }

  for (const row of nextSnapshot.rows) {
    const was = before.get(row.id);
    if (was === undefined) {
      events.push(seen(row, at, nextSnapshot.tmuxServerPid));
      continue;
    }
    // ONE-WAY EVIDENCE. A changed claim means the conversation changed; an
    // unchanged one means nothing, because the tmux environment is written once
    // — see `session-replaced` above for what that costs a consumer.
    if (was.claimedConversationId !== row.claimedConversationId) {
      events.push({
        kind: "session-replaced",
        at,
        tmuxServerPid: nextSnapshot.tmuxServerPid,
        key: sessionKey(identityOf(row)),
        identity: identityOf(row),
        previous: identityOf(was),
        previousKey: sessionKey(identityOf(was)),
        row,
      });
      continue;
    }
    // THE ONE THING THE CANONICAL KEY DELIBERATELY CANNOT SEE. Both statuses
    // key as `waiting`, so without this a wait that ended and was replaced by a
    // longer one is one unbroken wait in the history. See
    // `session-wait-restarted`.
    const restarted = waitRestart(was.status, previousSnapshot.clock.atMs, row.status, nextSnapshot);
    if (restarted !== null) {
      events.push({
        kind: "session-wait-restarted",
        at,
        tmuxServerPid: nextSnapshot.tmuxServerPid,
        key: sessionKey(identityOf(row)),
        identity: identityOf(row),
        previousDeadline: restarted.previousDeadline,
        deadline: restarted.deadline,
        status: row.status,
      });
      continue;
    }
    const from = statusKey(was.status);
    const to = statusKey(row.status);
    // THE ONE LINE THE MEASUREMENT IS ABOUT. `from === to` on two structurally
    // different statuses is the normal case, not a near miss.
    if (from === to) continue;
    events.push({
      kind: "session-status",
      at,
      tmuxServerPid: nextSnapshot.tmuxServerPid,
      key: sessionKey(identityOf(row)),
      identity: identityOf(row),
      from,
      to,
      status: row.status,
    });
  }

  return { kind: "diffed", events, baseline: new BaselineBox(nextSnapshot) };
}

/**
 * The two implied deadlines, when a wait was pushed materially later.
 *
 * Null when either status is not a wait — a wait that ENDED is an ordinary
 * status transition and is already recorded as one — and null when the deadline
 * held still or came closer, which is what a countdown does.
 */
function waitRestart(
  before: ObservedStatus,
  beforeAtMs: number,
  after: ObservedStatus,
  afterSnapshot: FreshSnapshot,
): { previousDeadline: string; deadline: string } | null {
  if (before.kind !== "waiting" || after.kind !== "waiting") return null;
  const previousDeadlineMs = beforeAtMs + before.secondsLeft * 1000;
  const deadlineMs = afterSnapshot.clock.atMs + after.secondsLeft * 1000;
  // The bound comes off the later collection itself — see `waitDeadlineToleranceMs`.
  if (deadlineMs - previousDeadlineMs <= waitDeadlineToleranceMs(afterSnapshot.tookMs)) return null;
  return {
    previousDeadline: new Date(previousDeadlineMs).toISOString(),
    deadline: new Date(deadlineMs).toISOString(),
  };
}

function seen(row: ObservedRow, at: string, tmuxServerPid: number | null): OverseerEvent {
  return {
    kind: "session-seen",
    at,
    tmuxServerPid,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    row,
  };
}

function gone(row: ObservedRow, at: string, tmuxServerPid: number | null, why: GoneReason): OverseerEvent {
  return {
    kind: "tmux-session-gone",
    at,
    tmuxServerPid,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    name: row.name,
    why,
  };
}
