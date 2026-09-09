/**
 * **The one way anything in this dashboard types into a pane.**
 *
 * WHAT WENT WRONG WITHOUT IT. Stage 4 gave the fleet a quarantine book: after a
 * send comes back `partial` or `unknown`, the literal text may be sitting in
 * that agent's input box with no Enter behind it, so the session is HELD and
 * nothing else may be delivered into it. Three producers recorded that hold —
 * the drain, the direct steer route, one recipient of a broadcast — and
 * **exactly one of them, `SteeringQueue.next()`, ever asked whether a session
 * was already held before sending.** So the page told the operator a session
 * was held while a direct steer or a broadcast could still type into it, and
 * pressing an `unknown` direct send again could concatenate a second copy of
 * the same sentence onto the first. Duplicate keystrokes are the one thing this
 * whole neighbourhood forbids.
 *
 * WHY A COORDINATOR RATHER THAN A CHECK EVERYBODY REMEMBERS TO MAKE. A rule of
 * the form *call `book.holding()` before you send* is a convention, and the
 * review that found the gap found it precisely because two of three producers
 * had not kept it. So the transport is not handed out any more: `sendMessage`
 * and `answerQuestion` are private to this file, the producers' dependency
 * objects carry a `SendCoordinator` instead, and the check happens **inside
 * this file, on the line above the transport call**. A new producer cannot type
 * at a pane without coming through here, because there is nothing else to call.
 *
 * That is enforced twice rather than described once:
 *
 *  - `tests/fleet-imports.test.ts` fails if any module under `tools/fleet/`
 *    other than this one imports `sendMessage` or `answerQuestion` as a VALUE.
 *  - `tests/fleet-compile-guards.test.ts` fails if a transport ever reappears
 *    as a field on `SteerDeps`, `ActionDeps` or `DrainDeps`.
 *
 * IT ALSO OWNS THE READING, which used to be copied into three files: whether
 * a failure means *nothing left this process* is asked of `nothingWasSent` —
 * the one audited place that reads the `sent` list as well as the summary — and
 * never of `result.delivery` alone. A `delivery: "none"` beside a non-empty
 * list of completed tmux calls is a self-contradicting report, and the honest
 * reading of it is that something went out.
 *
 * WHAT IT DOES NOT DO. It never retries, never observes, and never decides what
 * a producer does afterwards. Two things stay with the producer because they
 * genuinely differ: what an exception means (`ThrowPolicy`), and how an
 * ambiguous send is written down (`UncertainRecording`) — the drain must settle
 * its leased item and hold in ONE queue call, and the other two have no item.
 * Both are required fields, so a fourth producer has to decide rather than
 * inherit.
 *
 * NO CLOCK, NO STATE, NO IMPORT SIDE EFFECTS. The book is injected and the
 * shared one is built lazily, matching `handleSteerRequest` and
 * `sharedQuarantineBook`.
 */
import { nothingWasSent, type UnsentFailure } from "./queue.js";
import type {
  HoldEvidence,
  QuarantineBook,
  QuarantineHoldView,
  SendAttemptEvidence,
  UncertainSendOrigin,
  UncertainSendReading,
} from "./quarantine.js";
import { sharedQuarantineBook } from "./quarantine.js";
import type { FleetStatus } from "./status.js";
import {
  answerQuestion as realAnswerQuestion,
  sendMessage as realSendMessage,
  type SeenQuestion,
  type SteerResult,
  type SteerTarget,
} from "./steer.js";

/**
 * What an exception out of the transport means for this producer.
 *
 * **THE TWO ARMS ARE NOT A PREFERENCE.** A throw is the outcome with the least
 * evidence behind it: the `try` surrounds the whole call, so it cannot say
 * whether the exception happened before the first keystroke or out of the
 * middle of the sequence.
 *
 *  - `hold` is right where there is nothing else holding the session back — the
 *    direct steer route and a broadcast recipient. Without it the uncertainty
 *    is recorded nowhere.
 *  - `leave-the-lease-open` is the drain's, and it is stronger rather than
 *    weaker: the leased item is neither settled nor requeued, so `next()`
 *    reports the session in-flight and then `stuck`, which stops that queue
 *    harder than a hold does and puts the decision in front of a person.
 *    `deliverOne`'s comment argues it at length; this arm is that argument
 *    given a name.
 */
export type ThrowPolicy = "hold" | "leave-the-lease-open";

/**
 * How an ambiguous send gets written down.
 *
 * `book` is the plain case: open or extend the hold, and there is nothing else
 * to dispose of.
 *
 * `with-the-item` is the drain's, and it exists because the settle and the hold
 * must be ONE queue call. Written as two, there is a line between them at which
 * the item has gone and the session is not yet held — and that half is exactly
 * the bug Stage 4 removed, in code that looks like it works. See
 * `SteeringQueue.quarantineLeased`. The callback throws rather than returning a
 * failure, for the same reason: a producer that carried on would report a
 * session as held when it is not.
 */
export type UncertainRecording =
  | { kind: "book" }
  | { kind: "with-the-item"; hold: (evidence: Omit<HoldEvidence, "sessionId">) => QuarantineHoldView };

/** What one producer knows about the send it is about to make. */
export type SendPurpose = {
  /** Which path this send came down. Recorded on the hold. */
  origin: UncertainSendOrigin;
  /**
   * What is being sent, described **without a word of it** — `message (42
   * characters)`. The same promise steer.ts and drain.ts make, for the same
   * reason: this sentence is stored on the hold, logged, and drawn on a page.
   */
  what: string;
  onThrow: ThrowPolicy;
  record: UncertainRecording;
};

/**
 * What came of one attempt.
 *
 * A union rather than a `SteerResult` plus flags, so that a producer reading a
 * transport result has had to establish that the transport was reached at all.
 * **`held` is the arm this file exists for**: nothing was typed, and no
 * producer can reach it by accident because there is no other way in.
 */
export type SendAttempt =
  | {
      kind: "held";
      /** The hold that stopped it. **The transport was not called.** */
      hold: QuarantineHoldView;
      /** For a person: why nothing was sent, in the hold's own words. */
      why: string;
    }
  | {
      kind: "answered";
      result: SteerResult;
      /**
       * The transport's own word that no keystroke left this process, or null.
       *
       * Read `nothingWasSent`'s doc before acting on it: it is the only thing
       * that licenses putting an item back, because it is the only evidence
       * that a second attempt is not a second keystroke.
       */
      unsent: UnsentFailure | null;
      /** Opened or extended by THIS send, or null when the send was accounted for. */
      hold: QuarantineHoldView | null;
    }
  | {
      kind: "threw";
      error: Error;
      /** Null when the producer's policy was `leave-the-lease-open`. */
      hold: QuarantineHoldView | null;
    };

/**
 * The one object a producer is given. There is no transport beside it.
 *
 * `book()` is here so a composition can be CHECKED rather than trusted:
 * `makeActionRoutes` refuses to build if its queue and its coordinator are
 * looking at two different books, which is the failure a review found could be
 * introduced by changing one `??=` to `=` with the whole suite staying green.
 */
/**
 * **THE GUARANTEE IN THIS FILE IS PROCESS-LOCAL, AND STAGE 4b CHANGED HOW MUCH
 * THAT COSTS — WITHOUT CHANGING THE RULE.**
 *
 * What it used to say, and what was true until 2026-09-09: the book lived only
 * in memory, so a CHILD PROCESS — a spawned script, a worker, anything with its
 * own module graph — called `sharedSendCoordinator()` and got a **fresh, empty
 * book**. `holding()` answered `null` for every session on the box, and the send
 * went into a pane that might be holding half a sentence.
 *
 * **WHAT IS NOW TRUE.** `hold-ledger.ts` writes holds to disk, so a process that
 * calls `openSharedQuarantine()` starts with the holds the last one left, and a
 * DASHBOARD RESTART no longer forgets them. That is the P0 this file's last
 * paragraph pointed at, and it is closed.
 *
 * **WHAT IS STILL NOT TRUE, AND THE RULE IS UNCHANGED: DO NOT SEND KEYSTROKES
 * FROM A CHILD PROCESS.** Three reasons, and each is enough on its own:
 *
 *  - The child's book is a SNAPSHOT taken when it started. A hold the parent
 *    opened a second later is invisible to it, and that is the dangerous
 *    direction: it types into a session the parent's page is drawing as held.
 *  - The parent holds the ledger's writer lock, so the child is **read-only** —
 *    its own ambiguous sends are recorded nowhere, and the next start will not
 *    know about them.
 *  - A child that never calls `openSharedQuarantine()` — which is every child
 *    that is not this dashboard — still gets the fresh, empty book described
 *    above.
 *
 * **None of the three enforcements can see any of that.** The import walk in
 * `tests/fleet-imports.test.ts` checks who may hold the transport, and the child
 * legitimately holds a coordinator. `tests/fleet-compile-guards.test.ts` checks
 * dependency types, which are correct. `tests/fleet-send-composition.test.ts`
 * asserts one book across two compositions **within one process**, which is the
 * failure it was written for and is silent about this one. So this stays written
 * down rather than guarded: if something in a child needs to type, it must ask
 * the parent, because the parent owns the book and the lock.
 *
 * Found 2026-09-09 by `dashboard-titles-descriptions-detail`, which had been
 * asked to build a child-process send and abandoned it after reading the
 * paragraph above about the check and the call being adjacent. It reasoned from
 * the header to the consequence without having been there for the bug, which is
 * the whole reason the header says what it says rather than merely doing it.
 */
export type SendCoordinator = {
  message(target: SteerTarget, text: string, declaredStatus: FleetStatus, purpose: SendPurpose): SendAttempt;
  answer(target: SteerTarget, seen: SeenQuestion, optionIndex: number, declaredStatus: FleetStatus, purpose: SendPurpose): SendAttempt;
  /** The book this coordinator checks and records in. */
  book(): QuarantineBook;
};

export type SendCoordinatorDeps = {
  book: QuarantineBook;
  /**
   * The delivery module, injected so that tests can prove what reaches it
   * without a single keystroke going out — there are ~37 live agent sessions on
   * this box doing other people's work. It is injected HERE, one level below
   * the routes, because the routes must not be able to see it.
   */
  sendMessage: typeof realSendMessage;
  answerQuestion: typeof realAnswerQuestion;
};

export function makeSendCoordinator(deps: SendCoordinatorDeps): SendCoordinator {
  /**
   * The check, and then the call. **These two lines are the whole point of the
   * file**, and nothing may come between them: no logging, no rendering, no
   * gate. A hold is a fact about the session's input box, and the moment that
   * matters is the instant before something is typed into it.
   */
  function attempt(target: SteerTarget, purpose: SendPurpose, fire: () => SteerResult): SendAttempt {
    const standing = deps.book.holding(target.sessionId);
    if (standing !== null) {
      return {
        kind: "held",
        hold: standing,
        why:
          "nothing was sent: this session is held after an earlier send nobody could account for, " +
          `and a second one now could land behind half a sentence. ${standing.why}`,
      };
    }

    /**
     * **WRITTEN DOWN BEFORE THE KEYSTROKES, AND THE WINDOW IS THE POINT.**
     *
     * Stage 4b. If this process dies inside `fire()` — or between these two
     * lines — the next one finds an attempt nobody accounted for and rebuilds a
     * hold from it, because that is exactly the case where nobody can say what
     * is in the input box. Without it a restart admitted keystrokes again with
     * nobody told, while the tmux server and the half-typed sentence were still
     * there.
     *
     * **IT DOES NOT BREAK THE ADJACENCY THE FILE INSISTS ON.** The rule above
     * is that nothing may come between the check and the call that could change
     * the answer or add a decision: this is neither. It cannot refuse, it
     * cannot yield — the process is single-threaded and the append is
     * synchronous — and a ledger that will not write records the failure and
     * lets the send proceed, leaving the fleet where Stage 4 left it rather
     * than making a full disk a reason the dashboard cannot type.
     *
     * It goes AFTER the hold check, not before, because a send that was refused
     * is not an attempt to type and must leave nothing behind to resolve.
     */
    const attempted: SendAttemptEvidence = {
      sessionId: target.sessionId,
      paneId: target.paneId,
      claudeSessionId: target.claudeSessionId,
      origin: purpose.origin,
      what: purpose.what,
    };
    deps.book.noteAttempt(attempted);

    let result: SteerResult;
    try {
      result = fire();
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      /* NEITHER ARM RESOLVES THE ATTEMPT. A throw is the outcome with the least
         evidence behind it, so the ledger keeps it and a restart rebuilds a
         hold — which is strictly better than the drain's open lease, since the
         lease is memory and does not survive one either. */
      if (purpose.onThrow === "leave-the-lease-open") return { kind: "threw", error, hold: null };
      return { kind: "threw", error, hold: record(target, purpose, "threw") };
    }

    // OUTSIDE THE `try`, DELIBERATELY. `with-the-item` throws when a leased item
    // cannot be settled, and that throw is a bug in the caller rather than a
    // report about the pane — catching it here would relabel it as a transport
    // failure and hide the one condition the drain wants loud.
    /* THE TWO ANSWERS THAT ACCOUNT FOR A SEND, and the only two that take the
       attempt off the ledger — `SendResolution` says why a producer may write
       no others. */
    if (result.ok) {
      deps.book.resolveAttempt(target.sessionId, "delivered");
      return { kind: "answered", result, unsent: null, hold: null };
    }
    const unsent = nothingWasSent(result);
    if (unsent !== null) {
      deps.book.resolveAttempt(target.sessionId, "nothing-was-sent");
      return { kind: "answered", result, unsent, hold: null };
    }
    // WHICH OF THE THREE READINGS THIS IS, read off the transport rather than
    // assumed. `delivery: "none"` reaching this line means `nothingWasSent`
    // refused to certify it — the summary said nothing was sent and the `sent`
    // list named tmux calls that completed — and the honest reading of that
    // disagreement is the one that assumes something went out.
    const reading: UncertainSendReading =
      result.delivery === "partial" ? "partial" : result.delivery === "unknown" ? "unknown" : "none-contradicted";
    return { kind: "answered", result, unsent: null, hold: record(target, purpose, reading) };
  }

  function record(target: SteerTarget, purpose: SendPurpose, reading: UncertainSendReading): QuarantineHoldView {
    const evidence: Omit<HoldEvidence, "sessionId"> = {
      paneId: target.paneId,
      claudeSessionId: target.claudeSessionId,
      reading,
      origin: purpose.origin,
      what: purpose.what,
    };
    if (purpose.record.kind === "with-the-item") return purpose.record.hold(evidence);
    return deps.book.hold({ ...evidence, sessionId: target.sessionId });
  }

  return {
    message: (target, text, declaredStatus, purpose) =>
      attempt(target, purpose, () => deps.sendMessage(target, text, declaredStatus)),
    answer: (target, seen, optionIndex, declaredStatus, purpose) =>
      attempt(target, purpose, () => deps.answerQuestion(target, seen, optionIndex, declaredStatus)),
    book: () => deps.book,
  };
}

/**
 * The one coordinator this process sends through, built on first use.
 *
 * Lazy for `sharedQuarantineBook`'s reason, and over `sharedQuarantineBook()`
 * rather than a book of its own: the direct steer route and the action queue
 * have to be looking at the SAME holds, and a second book would record direct
 * uncertainty where the drain never looks. That join is asserted in
 * `tests/fleet-send-composition.test.ts` rather than left to this comment.
 */
let shared: SendCoordinator | null = null;

export function sharedSendCoordinator(): SendCoordinator {
  shared ??= makeSendCoordinator({
    book: sharedQuarantineBook(),
    sendMessage: realSendMessage,
    answerQuestion: realAnswerQuestion,
  });
  return shared;
}
