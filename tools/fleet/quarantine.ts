/**
 * v0.2c of the fleet dashboard: **a session held back after a send nobody can
 * account for.**
 *
 * WHAT THE PROBLEM IS. `sendMessage` ends in one of three readings, and two of
 * them — `partial` and `unknown` — mean the literal text may be sitting in that
 * agent's input box with no Enter behind it. `drain.ts` already refuses to
 * retry such a send, which is right and is the never-retry rule doing its job.
 * What nothing stopped was **the NEXT item**: it drains into the same input box
 * a minute later and concatenates itself onto half a sentence, and the agent
 * reads one instruction that neither person wrote.
 *
 * So an ambiguous send opens a HOLD on that session, and nothing drains into it
 * until a person says what is actually in that input box.
 *
 * WHY IT IS ITS OWN FILE RATHER THAN A FIELD ON THE QUEUE. Three code paths
 * leave the same uncertain input box — the drain, the direct steer route, and
 * one recipient of a broadcast — and only one of them is anywhere near a
 * `SteeringQueue`. `routes-steer.ts` cannot import `routes-actions.ts` (that
 * import already runs the other way, for the rate limiter), so the hold has to
 * live somewhere both can reach. This file imports `instance.ts` and nothing
 * else, so it can be reached from either side without a cycle.
 *
 * NOTHING HERE SENDS, RETRIES, OR OBSERVES. It holds no transport and no
 * timer. **Both release gestures are records rather than actions** — one says a
 * person looked at the terminal and saw the message, the other says the
 * uncertainty is being dropped without a claim in either direction — and
 * neither types a keystroke. The ceiling on all of it is `wire.ts`'s: no agent
 * acknowledges a keystroke, so nothing in this process can find out on its own.
 *
 * NO CLOCK OF ITS OWN. `now` is injected, matching queue.ts and drain.ts, so
 * every test here moves time by assignment.
 */
import { INSTANCE_TOKEN, serverInstanceId } from "./instance.js";
import type {
  HoldOutcome,
  HoldReleaseGesture,
  QuarantineHoldView,
  UncertainSendOrigin,
  UncertainSendReading,
} from "./wire.js";

export type {
  HoldOutcome,
  HoldReleaseGesture,
  QuarantineHoldView,
  UncertainSendOrigin,
  UncertainSendReading,
} from "./wire.js";

/**
 * How many finished holds one session keeps.
 *
 * **THE HISTORY IS FOR THE REPEAT, NOT FOR THE RECORD.** A release is
 * idempotent by being answerable twice, which means the released record has to
 * survive the first answer; the log is where the durable account lives. Three
 * is enough for a phone that lost a response and pressed again, and it is
 * bounded because this is memory in a process that also serves the page.
 *
 * The OPEN hold is never one of these and is never dropped.
 */
export const MAX_CLOSED_PER_SESSION = 3;

/**
 * How many sessions the book will track before it starts forgetting.
 *
 * A ceiling rather than a rule anybody expects to hit: the box runs ~36 agent
 * sessions. **What it evicts is a session with no open hold** — never one that
 * is holding, because dropping that would let the next item drain into an input
 * box we have said we do not understand, which is the whole thing this file
 * exists to prevent. If every tracked session is holding, the map simply grows;
 * a hold is small, and a wrong send is not.
 */
export const MAX_TRACKED_SESSIONS = 256;

/** What separates the run from the number in a hold id. `instance.ts` § the token is hex. */
const ID_SEPARATOR = "-";

/** Which run of the server minted an id — the same three arms as `SteeringQueue.idOrigin`. */
export type IdOrigin = "this-instance" | "other-instance" | "not-instance-qualified";

/**
 * What one producer knows about the send it could not account for.
 *
 * `what` describes the payload and **never contains a word of it** — the same
 * promise steer.ts and drain.ts make, for the same reason: these sentences are
 * logged. A message is described by its length.
 */
export type HoldEvidence = {
  /** tmux's session handle (`$1643`). The hold is per session, like the queue. */
  sessionId: string;
  /** The pane the send was aimed at, or null when the producer had none to give. */
  paneId: string | null;
  claudeSessionId: string | null;
  reading: UncertainSendReading;
  origin: UncertainSendOrigin;
  /** What was being sent, described without its words — `message (42 characters)`. */
  what: string;
};

export type ReleaseRequest = {
  holdId: string;
  /** The version the person was looking at. See `QuarantineHoldView.version`. */
  version: number;
  gesture: HoldReleaseGesture;
};

/**
 * Why a release did not happen.
 *
 * Every arm is a different thing to tell a person holding a phone, which is why
 * there is no catch-all: *there is no such hold* and *somebody else already
 * dealt with it differently* and *this restarted, so it let go by itself* lead
 * to three different next moves.
 */
export type ReleaseRefusalRule =
  /** Nothing by that id, in this run of the server. */
  | "no-such-hold"
  /** The hold has moved on since the page drew it — another send landed on it. */
  | "version-mismatch"
  /** It is already released, and with the OTHER gesture. */
  | "other-gesture"
  /** A tmux restart already ended it. Nothing is being held back. */
  | "already-superseded";

export type ReleaseHoldResult =
  | {
      ok: true;
      hold: QuarantineHoldView;
      /**
       * True when this exact request had already been answered.
       *
       * The point of the field is that a lost HTTP response is recoverable by
       * pressing again: the second press did not record a second gesture, and
       * the page should not say it did.
       */
      repeat: boolean;
    }
  | { ok: false; rule: ReleaseRefusalRule; why: string; hold: QuarantineHoldView | null };

export type QuarantineOptions = {
  /** Injected, always. There is no `Date.now()` below. */
  now: () => number;
  /**
   * Which run of the server this book belongs to — `instance.ts`.
   *
   * Injected for `SteeringQueue`'s reason: the tests build two books with two
   * ids in one process to prove an id from a dead run is refused by a live one,
   * and a class that reached for a module-level global makes that unwritable.
   */
  serverInstanceId: string;
};

/**
 * The sentence a person decides from.
 *
 * **NONE OF THESE SAYS THE MESSAGE DID NOT ARRIVE**, and that is the whole
 * discipline: `refused` was the word this code used for a `partial` send, and
 * *refused* reads as *nothing reached them*, which is the opposite fact. Each
 * arm says what was read and stops.
 */
function whyHeld(e: HoldEvidence): string {
  const tail =
    " Nothing else will be delivered to this session until somebody says what is actually in that input box — " +
    "there is no receipt for a keystroke, so this dashboard cannot find out on its own.";
  switch (e.reading) {
    case "partial":
      return (
        `Part of a send to this session arrived and the sequence did not finish (${e.what}), ` +
        "so the text may be sitting in its input box with no Enter behind it." +
        tail
      );
    case "unknown":
      return (
        `A send to this session (${e.what}) came back with no account of how far it got, ` +
        "so it may be sitting in its input box and it may have gone in." +
        tail
      );
    case "threw":
      return (
        `A send to this session (${e.what}) threw, and the exception cannot say whether it happened ` +
        "before the keystrokes or after them." +
        tail
      );
    case "none-contradicted":
      return (
        `A send to this session (${e.what}) reported that nothing was sent and named tmux calls that ` +
        "completed anyway — the two disagree, and the honest reading of that is that something may have gone out." +
        tail
      );
    default: {
      const never: never = e.reading;
      return never;
    }
  }
}

/**
 * What a gesture asserted, in words.
 *
 * **`operator-confirmed` IS A PERSON'S CLAIM AND SAYS SO.** The plan's rule:
 * a human check is labelled *confirmed by an operator*, never *observed*. The
 * dashboard read nothing; somebody looked at a terminal and told it what they
 * saw, and if they were wrong the record is wrong in the way a person's report
 * is wrong, which is a different thing from a measurement being wrong.
 *
 * **`abandoned-unknown` MAKES NO CLAIM IN EITHER DIRECTION**, and the half that
 * is easy to get wrong is the second one: it must not read as *nothing was
 * delivered*. All it does is stop holding.
 */
function whatWasSaid(gesture: HoldReleaseGesture): string {
  switch (gesture) {
    case "operator-confirmed":
      return (
        "A person at this dashboard said they looked at the terminal and saw what was in the input box. " +
        "That is their claim, not something this server observed."
      );
    case "abandoned-unknown":
      return (
        "The uncertainty was dropped without being resolved. Whether that send reached the input box is " +
        "still not known, and this record does not claim it did or that it did not — the hold simply stopped."
      );
    default: {
      const never: never = gesture;
      return never;
    }
  }
}

/** One session's holds: at most one open, plus a bounded tail of finished ones. */
type SessionHolds = {
  open: QuarantineHoldView | null;
  /** Most recent last. Bounded by `MAX_CLOSED_PER_SESSION`. */
  closed: QuarantineHoldView[];
};

/**
 * The one book per fleet server, holding at most one open hold per session.
 *
 * A class rather than a module of `Map`s for `SteeringQueue`'s reason: a
 * module-level map is shared by every test in a file, which is the shape that
 * produces a suite passing alone and failing in a batch.
 */
export class QuarantineBook {
  private readonly now: () => number;
  /** Public so a refusal can name it — "this server is 0badcafe". */
  readonly serverInstanceId: string;
  private readonly bySession = new Map<string, SessionHolds>();
  private seq = 0;
  /** The tmux server every handle here belongs to, or null until somebody says. */
  private generation: number | null = null;

  constructor(options: QuarantineOptions) {
    this.now = options.now;
    this.serverInstanceId = options.serverInstanceId;
  }

  /* ---------------- reading ---------------- */

  /** The hold stopping this session, or null. This is the question `next()` asks. */
  holding(sessionId: string): QuarantineHoldView | null {
    return this.bySession.get(sessionId)?.open ?? null;
  }

  /** Every session with an open hold — what a page needs to draw them all. */
  heldSessions(): string[] {
    const out: string[] = [];
    for (const [sessionId, holds] of this.bySession) {
      if (holds.open !== null) out.push(sessionId);
    }
    return out;
  }

  /** Any hold this run still remembers, whatever became of it. */
  find(holdId: string): QuarantineHoldView | null {
    for (const holds of this.bySession.values()) {
      if (holds.open?.id === holdId) return holds.open;
      const closed = holds.closed.find((h) => h.id === holdId);
      if (closed) return closed;
    }
    return null;
  }

  /**
   * Which run of the server minted this id — ours, somebody else's, or nobody's.
   *
   * The same three arms and the same conservative parse as
   * `SteeringQueue.idOrigin`, and deliberately a second implementation rather
   * than an import: the two id spaces are different (`…-q3` and `…-h3`) and
   * each owner should own the shape of its own ids. What they share is the
   * CONTRACT — `INSTANCE_TOKEN` — which is imported rather than restated.
   */
  idOrigin(holdId: string): IdOrigin {
    const at = holdId.indexOf(ID_SEPARATOR);
    if (at < 0) return "not-instance-qualified";
    const token = holdId.slice(0, at);
    if (!INSTANCE_TOKEN.test(token)) return "not-instance-qualified";
    return token === this.serverInstanceId ? "this-instance" : "other-instance";
  }

  /** Which tmux server this book's handles belong to, or null before anybody said. */
  knownGeneration(): number | null {
    return this.generation;
  }

  /* ---------------- writing ---------------- */

  /**
   * Record an ambiguous send, and hold the session.
   *
   * **A SECOND UNCERTAIN SEND EXTENDS THE HOLD RATHER THAN OPENING ANOTHER.**
   * Two holds on one session would be two things to release for one input box,
   * and the second would go on blocking after the first was cleared — a hold
   * that outlives the gesture that could clear it is exactly the failure this
   * stage is against. So the version goes up instead, which is also what stops
   * a phone that saw version 1 from releasing a hold that has since absorbed
   * another incident.
   */
  hold(evidence: HoldEvidence): QuarantineHoldView {
    const at = this.now();
    const holds = this.bySession.get(evidence.sessionId) ?? { open: null, closed: [] };
    const existing = holds.open;
    if (existing !== null) {
      const extended: QuarantineHoldView = {
        ...existing,
        version: existing.version + 1,
        lastSendAt: at,
        incidents: existing.incidents + 1,
        reading: evidence.reading,
        origin: evidence.origin,
        paneId: evidence.paneId ?? existing.paneId,
        claudeSessionId: evidence.claudeSessionId ?? existing.claudeSessionId,
        why: whyHeld(evidence),
      };
      holds.open = extended;
      this.bySession.set(evidence.sessionId, holds);
      return extended;
    }
    this.seq += 1;
    const opened: QuarantineHoldView = {
      id: `${this.serverInstanceId}${ID_SEPARATOR}h${this.seq}`,
      version: 1,
      sessionId: evidence.sessionId,
      paneId: evidence.paneId,
      claudeSessionId: evidence.claudeSessionId,
      serverInstanceId: this.serverInstanceId,
      tmuxGeneration: this.generation,
      openedAt: at,
      lastSendAt: at,
      incidents: 1,
      reading: evidence.reading,
      origin: evidence.origin,
      why: whyHeld(evidence),
      outcome: { kind: "holding" },
    };
    holds.open = opened;
    this.bySession.set(evidence.sessionId, holds);
    this.evict();
    return opened;
  }

  /**
   * End a hold. **Nothing is sent, in either gesture.**
   *
   * IDEMPOTENT BY ANSWERING THE SAME REQUEST THE SAME WAY. A phone on a train
   * loses responses, and the second press must not be a second gesture or a
   * dead end; `repeat: true` is how the page can say *this was already done*
   * rather than *done*. The key is the pair `(holdId, version)` — a version is
   * what the page was looking at, so a release built from a stale reading is
   * refused rather than applied to a hold that has changed underneath it.
   */
  release(request: ReleaseRequest): ReleaseHoldResult {
    const hold = this.find(request.holdId);
    if (hold === null) {
      return {
        ok: false,
        rule: "no-such-hold",
        hold: null,
        why:
          `there is no hold called ${request.holdId} in this run of the dashboard (${this.serverInstanceId}). ` +
          "Reload the page and look at what is actually being held.",
      };
    }
    if (hold.version !== request.version) {
      const direction =
        request.version < hold.version
          ? `another uncertain send has landed on ${hold.sessionId} since then, and it is at version ${hold.version}`
          : `this run never minted a version ${request.version} of it — it is at ${hold.version}`;
      return {
        ok: false,
        rule: "version-mismatch",
        hold,
        why: `that hold was read at version ${request.version}: ${direction}. Look at it again before deciding.`,
      };
    }
    const outcome = hold.outcome;
    if (outcome.kind === "superseded") {
      return {
        ok: false,
        rule: "already-superseded",
        hold,
        why:
          `the tmux server changed from ${outcome.was} to ${outcome.now} after that hold was opened, so the pane it ` +
          "was about is gone along with whatever was in its input box. Nothing is being held back; there is nothing left to release.",
      };
    }
    if (outcome.kind === "released") {
      if (outcome.gesture === request.gesture) return { ok: true, hold, repeat: true };
      return {
        ok: false,
        rule: "other-gesture",
        hold,
        why: `that hold was already released as '${outcome.gesture}', and a second, different answer would overwrite what somebody recorded.`,
      };
    }
    const released: QuarantineHoldView = {
      ...hold,
      outcome: { kind: "released", gesture: request.gesture, at: this.now(), what: whatWasSaid(request.gesture) },
    };
    this.close(released);
    return { ok: true, hold: released, repeat: false };
  }

  /**
   * Tell the book which tmux server the box is running, and let go of every
   * hold opened against a different one.
   *
   * **A PROVEN GENERATION CHANGE IS THE ONE THING THAT ENDS A HOLD WITHOUT A
   * PERSON.** It is not a guess: a tmux restart takes every pane with it, so
   * the input box that may be holding half a message no longer exists. Going on
   * blocking the session handle — which has been RE-ISSUED to something else
   * entirely — would hold back a session that has nothing to do with the send.
   *
   * The record is kept as `superseded` rather than deleted, for the reason
   * `invalidated` items stay in the queue: the sentence is the point, and a
   * hold that vanished would look like one that was never opened.
   *
   * **THE FIRST OBSERVATION IS NOT A CHANGE**, and neither is learning a
   * generation a hold was opened without. `noteGeneration` in queue.ts makes
   * the same distinction and for the same reason: "we had not been told" is not
   * evidence that anything restarted.
   */
  noteGeneration(tmuxServerPid: number): number {
    const was = this.generation;
    this.generation = tmuxServerPid;
    if (was === null || was === tmuxServerPid) return 0;
    const at = this.now();
    let superseded = 0;
    for (const holds of this.bySession.values()) {
      const open = holds.open;
      // A hold with no generation on it was opened before this server had been
      // told which tmux server it was reading. That is a gap in our knowledge
      // rather than evidence about the pane, so it keeps holding.
      if (open === null || open.tmuxGeneration === null || open.tmuxGeneration === tmuxServerPid) continue;
      const outcome: HoldOutcome = {
        kind: "superseded",
        at,
        was: open.tmuxGeneration,
        now: tmuxServerPid,
        what:
          `the tmux server was ${open.tmuxGeneration} when this was opened and is ${tmuxServerPid} now — ` +
          "every pane went with it, so whatever was in that input box is gone and there is nothing left to hold back.",
      };
      this.close({ ...open, outcome });
      superseded += 1;
    }
    return superseded;
  }

  /* ---------------- housekeeping ---------------- */

  /** Move a hold out of the open slot and into the bounded history. */
  private close(hold: QuarantineHoldView): void {
    const holds = this.bySession.get(hold.sessionId) ?? { open: null, closed: [] };
    holds.open = null;
    holds.closed.push(hold);
    while (holds.closed.length > MAX_CLOSED_PER_SESSION) holds.closed.shift();
    this.bySession.set(hold.sessionId, holds);
  }

  /**
   * Forget the oldest session that is not holding anything, if there are too
   * many. **Never one that is holding** — see `MAX_TRACKED_SESSIONS`.
   */
  private evict(): void {
    if (this.bySession.size <= MAX_TRACKED_SESSIONS) return;
    for (const [sessionId, holds] of this.bySession) {
      if (holds.open !== null) continue;
      this.bySession.delete(sessionId);
      if (this.bySession.size <= MAX_TRACKED_SESSIONS) return;
    }
  }
}

/**
 * The one book this process uses, built on first use rather than at import.
 *
 * **BOTH ROUTE FILES REACH IT AND THEY CANNOT REACH EACH OTHER**, which is the
 * whole reason it lives here: `routes-actions.ts` already imports
 * `routes-steer.ts` for the rate limiter, so the steering route cannot import
 * the queue's composition root to find the book. This is the composition root
 * for the one thing both of them write to, and it follows `handleSteerRequest`
 * and `handleActionRequest` exactly — lazy, because a module-scope instance
 * would be built by anything that so much as imports a type from here, and NO
 * IMPORT SIDE EFFECTS is the rule this directory keeps.
 *
 * Tests inject their own; nothing in a test should ever reach this.
 */
let shared: QuarantineBook | null = null;

export function sharedQuarantineBook(): QuarantineBook {
  shared ??= new QuarantineBook({ now: () => Date.now(), serverInstanceId: serverInstanceId() });
  return shared;
}
