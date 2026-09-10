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
 * live somewhere both can reach. This file imports `instance.ts` and
 * `hold-ledger.ts`, both leaves, so it can still be reached from either side
 * without a cycle.
 *
 * THE BOOK IS NO LONGER ONLY MEMORY. `hold-ledger.ts` writes an unresolved
 * attempt down **before** the keystrokes and takes it off the list only when
 * something accounted for it, so a dashboard restart rebuilds the holds instead
 * of quietly forgetting them — Stage 4b, and the P0 the Stage 4 review found.
 * The ledger is injected and optional: a book without one behaves exactly as it
 * did before, which is what every test here uses.
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
import type { AttemptRecord, HeldRecord, HoldLedger, HoldResolution } from "./hold-ledger.js";
import { INSTANCE_TOKEN, serverInstanceId } from "./instance.js";
import type {
  HoldReleaseGesture,
  QuarantineHoldView,
  UncertainSendOrigin,
  UncertainSendReading,
} from "./wire.js";

export type {
  HoldBasis,
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

/**
 * What a producer knows **before** it types — everything on `HoldEvidence`
 * except the one thing that does not exist yet.
 *
 * `reading` is missing because nothing has been read: this is written down on
 * the line above the transport call, and the whole reason for writing it there
 * is the case where nobody ever finds out how far the send got. A type that
 * asked for a reading here would have to be given an invented one.
 */
export type SendAttemptEvidence = Omit<HoldEvidence, "reading">;

/**
 * The two ways a send accounts for itself, and therefore the only two a
 * producer may use to take its attempt off the ledger.
 *
 * Narrower than `HoldResolution` on purpose: `released` and `superseded` are
 * this book's to write, and a transport that could write them would be able to
 * clear a hold by reporting on itself.
 */
export type SendResolution = Extract<HoldResolution, "delivered" | "nothing-was-sent">;

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
  /**
   * Where holds are written down, or null for a book that is only memory.
   *
   * **OPTIONAL, AND NOT BECAUSE DURABILITY IS OPTIONAL.** Every test here
   * builds a book without one, because a test that wrote to a real directory
   * would be a test that could take the live dashboard's writer lock. The one
   * production composition in `action-stores.ts` always installs one before
   * the server can be asked to type, and `tests/fleet-hold-restart.test.ts`
   * guards that ordering.
   */
  ledger?: HoldLedger | null;
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
 * The sentence for a hold this process did not watch open.
 *
 * **IT SAYS WHAT IT DOES NOT KNOW, FIRST.** A rehydrated record has exactly one
 * thing a live hold has not got: the run that could have told you what happened
 * is gone. The temptation is to read the ledger line back as though this
 * dashboard had seen it, and the sentence a person decides from is precisely
 * where that would do damage.
 */
function whyRehydratedHold(e: HoldEvidence): string {
  return (
    `${whyHeld(e)} This record was rebuilt when the dashboard restarted, from what the previous run wrote down ` +
    "before it ended — so nothing in it has been re-checked since, and if somebody released it in the seconds " +
    "before that run stopped, this is holding a session nothing is wrong with."
  );
}

/**
 * The sentence for an attempt nobody ever accounted for — **the least this
 * dashboard can ever know and still be holding a session.**
 *
 * The line was written on the instant before the keystrokes, and nothing was
 * written after it. So this cannot say how far the send got, and it cannot say
 * that it was made at all: the process may have died between writing the line
 * and calling the transport. Both readings end in the same place — somebody has
 * to look at the terminal — which is why one hold covers both rather than two
 * arms splitting a distinction nobody can act on differently.
 */
function whyUnaccountedAttempt(what: string, at: number): string {
  return (
    `This dashboard wrote down that it was about to send to this session (${what}) and then stopped before it ` +
    `could record what happened, at ${new Date(at).toISOString()}. It cannot say how far that send got, or ` +
    "whether it was made at all. Nothing else will be delivered here until somebody says what is actually in " +
    "that input box — there is no receipt for a keystroke, so this dashboard cannot find out on its own."
  );
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

  /** Where holds are written down, or null for a book that is only memory. */
  private readonly ledger: HoldLedger | null;

  constructor(options: QuarantineOptions) {
    this.now = options.now;
    this.serverInstanceId = options.serverInstanceId;
    this.ledger = options.ledger ?? null;
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

  /**
   * Whether a hold opened now would survive a dashboard restart: the hold
   * ledger is present, this process holds its writer lock, and its last write
   * did not fail.
   *
   * **READ OFF THE LEDGER'S OWN STATUS, NEVER ASSUMED FROM HAVING BEEN HANDED
   * ONE.** A ledger that is locked out by another dashboard, or whose last write
   * failed, is a restart that may lose the hold — and saying otherwise would let
   * `scripts/fleet-restart-plan.ts`, which reads this as the catalogue's
   * `holdsDurable`, restart over a session whose hold then silently vanished.
   */
  durable(): boolean {
    if (this.ledger === null) return false;
    const status = this.ledger.status();
    return status.lockedOutBy === null && status.failure === null;
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
      this.writeHold(extended, evidence.what);
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
      // NOTHING HAS BEEN SEEN AFTER THIS HOLD YET, by definition. It stays null
      // for ever on a hold that knew its generation at opening: that hold has a
      // claim about the world already, and this field is only the repair for
      // one that has none. See `QuarantineHoldView.firstSeenGeneration`.
      firstSeenGeneration: null,
      openedAt: at,
      lastSendAt: at,
      incidents: 1,
      reading: evidence.reading,
      origin: evidence.origin,
      why: whyHeld(evidence),
      outcome: { kind: "holding" },
      basis: { kind: "observed-here" },
    };
    holds.open = opened;
    this.bySession.set(evidence.sessionId, holds);
    this.evict();
    this.writeHold(opened, evidence.what);
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
    /* AFTER `close`, not before: the ledger line says *this session has been
       accounted for*, and writing it while the hold was still open would leave
       a crash in between with a session the file calls clear and the page calls
       held. In this order the two disagree only in the safe direction. */
    this.resolve(released.sessionId, "released");
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
   *
   * **AND A HOLD THAT KNEW NO GENERATION IS NOT SKIPPED FOR EVER**, which is
   * where this landed the first time. Saying *no later change proves anything
   * about it* is true of the first observation and false of the second: two
   * different tmux servers seen after the hold opened means one replaced the
   * other, whichever of them the send went to. So the first is recorded on
   * `firstSeenGeneration` — a fact about what happened AFTER, deliberately not
   * written into `tmuxGeneration`, which is a claim about the moment of the
   * send — and the next distinct one supersedes. Without it the "one refresh
   * cycle" window was indefinite.
   */
  noteGeneration(tmuxServerPid: number): number {
    this.generation = tmuxServerPid;
    const at = this.now();
    let superseded = 0;
    for (const holds of this.bySession.values()) {
      const open = holds.open;
      if (open === null) continue;

      // The ordinary case: the hold knows which tmux server it was opened
      // against, and this is a different one.
      if (open.tmuxGeneration !== null) {
        if (open.tmuxGeneration === tmuxServerPid) continue;
        this.close({
          ...open,
          outcome: {
            kind: "superseded",
            at,
            was: open.tmuxGeneration,
            now: tmuxServerPid,
            what:
              `the tmux server was ${open.tmuxGeneration} when this was opened and is ${tmuxServerPid} now — ` +
              "every pane went with it, so whatever was in that input box is gone and there is nothing left to hold back.",
          },
        });
        this.resolve(open.sessionId, "superseded");
        superseded += 1;
        continue;
      }

      // Opened before this server had been told anything. The FIRST thing we
      // hear afterwards is recorded and nothing else: it may well be the same
      // tmux server the send went to, so it is not evidence of a restart.
      if (open.firstSeenGeneration === null) {
        holds.open = { ...open, firstSeenGeneration: tmuxServerPid };
        continue;
      }
      if (open.firstSeenGeneration === tmuxServerPid) continue;
      // The SECOND, and it is different. Whichever server the send went to, one
      // of these two replaced the other, and every pane went with it.
      this.close({
        ...open,
        outcome: {
          kind: "superseded",
          at,
          was: open.firstSeenGeneration,
          now: tmuxServerPid,
          what:
            "this dashboard had not been told which tmux server it was reading when this was opened, so it cannot " +
            `say which one the send went to — but it has seen ${open.firstSeenGeneration} and then ${tmuxServerPid} ` +
            "since, and one of those replaced the other. Every pane went with it, so whatever was in that input box " +
            "is gone and there is nothing left to hold back.",
        },
      });
      this.resolve(open.sessionId, "superseded");
      superseded += 1;
    }
    return superseded;
  }

  /* ---------------- durability ---------------- */

  /**
   * **WRITE DOWN THAT WE ARE ABOUT TO TYPE, BEFORE WE TYPE.**
   *
   * Called by `send-coordinator.ts` on the line between the hold check and the
   * transport call, and the gap between this line and that one is the entire
   * reason the ledger exists: a crash inside the transport must leave a record
   * behind, because that is precisely the case where nobody can say what is in
   * the input box and nothing else knows to ask.
   *
   * **IT IS NOT A HOLD AND IT DOES NOT BLOCK ANYTHING IN THIS PROCESS.** The
   * live book is unchanged by it; what it changes is what the NEXT process
   * finds. And it cannot refuse — a ledger that will not write records the
   * failure and the send goes out anyway, leaving the fleet exactly where Stage
   * 4 left it rather than making a full disk a reason the dashboard cannot type.
   */
  noteAttempt(evidence: SendAttemptEvidence): void {
    this.ledger?.noteAttempt({
      at: this.now(),
      sessionId: evidence.sessionId,
      paneId: evidence.paneId,
      claudeSessionId: evidence.claudeSessionId,
      origin: evidence.origin,
      what: evidence.what,
      serverInstanceId: this.serverInstanceId,
      tmuxGeneration: this.generation,
    });
  }

  /**
   * The send accounted for itself, so the attempt above is no longer a reason
   * to hold anything after a restart.
   *
   * **ONLY TWO ANSWERS COUNT AS ACCOUNTING** — see `SendResolution`. An
   * exception out of the transport is not one of them and must not be made into
   * one: it is the outcome with the least evidence behind it, and its attempt
   * stays on the ledger so a restart rebuilds a hold from it.
   */
  resolveAttempt(sessionId: string, how: SendResolution): void {
    this.resolve(sessionId, how);
  }

  /**
   * Rebuild the holds the previous run left behind. **Nothing is sent, ever.**
   *
   * A hold is a REFUSAL TO DELIVER, not a queue of work, so there is no arm
   * here that re-sends anything — and there must never be one. What comes back
   * is a session nothing may be typed into until a person says what is in its
   * input box, which is the same thing the live book produces and reached a
   * different way.
   *
   * **A REHYDRATED ID FROM THE PREVIOUS RUN IS KEPT, AND THIS IS A DELIBERATE
   * TENSION WITH STAGE 2.** `SteeringQueue` prefixes queue ids with the server
   * instance so an id minted by a dead process is refused by a live one, and
   * that is right: a queue id names volatile state and should die with it. **A
   * hold id names a fact about the WORLD that outlived the process** — there is
   * still text in an input box — so it is kept, and the release route answers
   * it. Anyone tempted to make the two consistent should change the route's
   * comment, not this: the inconsistency is the point.
   *
   * An attempt that never became a hold has no id to keep, because no hold was
   * ever minted for it, so this run mints one of its own.
   */
  rehydrate(): { holds: number; attempts: number; skipped: number } {
    let holds = 0;
    let attempts = 0;
    let skipped = 0;
    for (const state of this.ledger?.live() ?? []) {
      if (this.holding(state.sessionId) !== null) {
        /* **THE LIVE HOLD WINS, AND THE COUNT SAYS SO RATHER THAN THE FILE
           BEING SILENT ABOUT IT.** Produced by a second `rehydrate()` on a book
           that already came back holding — which is what a caller that forgot
           it had already started does. Overwriting a live hold with a record
           read off a disk is the one direction that loses information, so it
           refuses and counts. */
        skipped += 1;
        continue;
      }
      const rebuilt = state.kind === "held" ? this.fromHeldRecord(state) : this.fromAttemptRecord(state);
      const existing = this.bySession.get(state.sessionId) ?? { open: null, closed: [] };
      existing.open = rebuilt;
      this.bySession.set(state.sessionId, existing);
      if (state.kind === "held") holds += 1;
      else attempts += 1;
    }
    return { holds, attempts, skipped };
  }

  /**
   * A hold the previous run wrote down after its send returned.
   *
   * Everything a live hold says about the send, it can say — that run read the
   * transport's answer and recorded it. **The id and the version are kept**, so
   * a phone that was looking at the page before the restart can still release
   * exactly what it was looking at.
   */
  private fromHeldRecord(record: HeldRecord): QuarantineHoldView {
    const evidence: HoldEvidence = {
      sessionId: record.sessionId,
      paneId: record.paneId,
      claudeSessionId: record.claudeSessionId,
      reading: record.reading,
      origin: record.origin,
      what: record.what,
    };
    return {
      id: record.holdId,
      version: record.version,
      sessionId: record.sessionId,
      paneId: record.paneId,
      claudeSessionId: record.claudeSessionId,
      /* THE RUN THAT OPENED IT, not this one. It is what the id carries, and
         overwriting it would make the id and the field disagree. */
      serverInstanceId: record.serverInstanceId,
      tmuxGeneration: record.tmuxGeneration,
      /* Not stored — `hold-ledger.ts` § `tmuxGeneration` says why nothing could
         have written a non-null one. This run makes its own first observation. */
      firstSeenGeneration: null,
      openedAt: record.openedAt,
      lastSendAt: record.lastSendAt,
      incidents: record.incidents,
      reading: record.reading,
      origin: record.origin,
      why: whyRehydratedHold(evidence),
      outcome: { kind: "holding" },
      basis: { kind: "rehydrated-hold", recordedAt: record.at },
    };
  }

  /**
   * A hold over an attempt nobody ever accounted for.
   *
   * **IT KNOWS LESS THAN ANY OTHER HOLD, AND THE TYPE SAYS SO**: no `openedAt`,
   * no `lastSendAt`, no `reading`, because no process survived to read one. The
   * moment on the basis is when the line was written, which is *before* the
   * send — a different fact from when a hold opened, and labelled as one.
   */
  private fromAttemptRecord(record: AttemptRecord): QuarantineHoldView {
    this.seq += 1;
    return {
      id: `${this.serverInstanceId}${ID_SEPARATOR}h${this.seq}`,
      version: 1,
      sessionId: record.sessionId,
      paneId: record.paneId,
      claudeSessionId: record.claudeSessionId,
      serverInstanceId: record.serverInstanceId,
      tmuxGeneration: record.tmuxGeneration,
      firstSeenGeneration: null,
      openedAt: null,
      lastSendAt: null,
      /* One recorded incident: the attempt. `incidents` counts what the record
         covers, and it is never zero — see `QuarantineHoldView.incidents`. */
      incidents: 1,
      reading: null,
      origin: record.origin,
      why: whyUnaccountedAttempt(record.what, record.at),
      outcome: { kind: "holding" },
      basis: { kind: "rehydrated-attempt", attemptedAt: record.at },
    };
  }

  /**
   * One `held` line, carrying whatever the book now says about this hold.
   *
   * **AND NOTHING AT ALL WHEN THE HOLD CANNOT SAY WHEN IT OPENED.** That is one
   * case: a live send landing on a hold rehydrated from an attempt nobody
   * accounted for. There is still no moment at which anything opened, and
   * writing the send's own timestamp into `openedAt` would put a claim on disk
   * that nothing ever observed — which the next start would read back as a
   * fact, one restart further from anyone who could contradict it. The attempt
   * line stays exactly as it is: the session goes on being held either way, and
   * what is given up is precision this dashboard never had.
   */
  private writeHold(hold: QuarantineHoldView, what: string): void {
    if (this.ledger === null) return;
    const openedAt = hold.openedAt;
    const lastSendAt = hold.lastSendAt;
    if (openedAt === null || lastSendAt === null || hold.reading === null) return;
    this.ledger.noteHold({
      at: this.now(),
      sessionId: hold.sessionId,
      holdId: hold.id,
      version: hold.version,
      openedAt,
      lastSendAt,
      incidents: hold.incidents,
      reading: hold.reading,
      origin: hold.origin,
      what,
      paneId: hold.paneId,
      claudeSessionId: hold.claudeSessionId,
      serverInstanceId: hold.serverInstanceId,
      tmuxGeneration: hold.tmuxGeneration,
    });
  }

  private resolve(sessionId: string, how: HoldResolution): void {
    this.ledger?.noteResolved({ at: this.now(), sessionId, how });
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
let sharedLedger: HoldLedger | null = null;

/** Whether somebody has already been handed the process-wide book. */
export function sharedQuarantineWasOpened(): boolean {
  return shared !== null;
}

/**
 * Install the ledger before constructing the process-wide book.
 *
 * The action-store composition takes the one writer claim shared by holds and
 * receipts, then hands the already-opened ledger in here before any route can
 * ask for the book.
 */
export function installSharedQuarantineLedger(
  ledger: HoldLedger | null,
  options: { now: () => number; serverInstanceId: string },
): {
  book: QuarantineBook;
  rehydrated: { holds: number; attempts: number; skipped: number };
} {
  if (shared !== null) {
    throw new Error("the shared quarantine book was built before its ledger was opened");
  }
  sharedLedger = ledger;
  shared = new QuarantineBook({
    now: options.now,
    serverInstanceId: options.serverInstanceId,
    ledger,
  });
  const book = shared;
  return {
    book,
    rehydrated: ledger === null ? { holds: 0, attempts: 0, skipped: 0 } : book.rehydrate(),
  };
}

export function sharedQuarantineBook(): QuarantineBook {
  shared ??= new QuarantineBook({
    now: () => Date.now(),
    serverInstanceId: serverInstanceId(),
    ledger: sharedLedger,
  });
  return shared;
}

/** Reset the quarantine half before the surrounding composition releases its shared lock. */
export function resetSharedQuarantineStateForActionStores(): void {
  sharedLedger?.close();
  sharedLedger = null;
  shared = null;
}
