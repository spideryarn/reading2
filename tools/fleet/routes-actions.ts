/**
 * v0.5 of the fleet dashboard: the HTTP skin over the action vocabulary.
 *
 * `actions.ts` says WHAT can be done and refuses to let the three kinds be
 * confused; `queue.ts` says WHEN it may happen; `steer.ts` says whether a
 * keystroke may go out. This file adds the four questions a network hop asks —
 * is this body anything, did a person on this dashboard ask for it, is it the
 * session they were LOOKING AT, and is it the fortieth in a second — and it
 * asks them the way `routes-steer.ts` does, by importing that file's checks
 * rather than growing a second copy. Two origin checks written in parallel by
 * two agents disagreed once (origin.ts's header), and the weaker one was on the
 * route that could do more.
 *
 * THE CLIENT'S CLAIMS ARE THE INPUT. `paneId`, `sessionId`, `claudeSessionId`,
 * `panePid` and the declared status all come out of the request body, because
 * they are what the person could see when they tapped. Nothing here re-reads
 * them from live tmux, which is why this file imports no value from
 * `collect.ts` — a route that re-derived the target would make every guard
 * downstream compare the box against itself.
 *
 * THE ONE EXCEPTION IS A KILL, AND IT IS AN EXCEPTION IN BOTH DIRECTIONS. No
 * browser can know what is running on this box, so the candidate list comes
 * from `ps` here. A preview binds each confirmable pid to its start tick and
 * boot, and the run INTERSECTS those identities with a fresh rule scan: the
 * scan authorises, and the shown identities bound. A process that no longer
 * matches at that fresh scan is not signalled, and one that started matching
 * after the preview is not either. The rule's mutable inputs can still change
 * after the scan. The final identity read narrows a different window; the
 * pidfd-sized race it cannot close is named beside that read.
 *
 * WHAT ACTUALLY HAPPENS WHERE:
 *
 *  - a **spoken** action or a free-text message is ENQUEUED and nothing is
 *    sent from here. The queue drains when the session is at a prompt, and
 *    whoever drains it does the sending.
 *  - an **enacted** action is either enqueued (for order — "push, then remove
 *    the worktree") or run immediately, and running it needs `mode: "run"`,
 *    `confirm: true`, `FLEET_ACT_ENABLED=1`, and an empty queue for that
 *    session. Four independent gates, because there is no undo.
 *  - a **broadcast** is delivered here, one `sendMessage` per recipient, with
 *    `renderBroadcast` called AT THE MOMENT OF EACH SEND. See `runBroadcast`.
 *
 * `console.log` rather than src/log.ts — server.ts's header has the reason.
 * EVERY ATTEMPT AND EVERY OUTCOME IS LOGGED, and no message text ever is:
 * character counts, pane ids, pause minutes and exit codes only. This box's
 * dashboard log must not become a transcript of what people say to their
 * agents.
 *
 * NO IMPORT SIDE EFFECTS: nothing at module scope runs a command, binds
 * anything, or reads the environment.
 */
import { execFile, execFileSync } from "node:child_process";
import { readlinkSync } from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  actionById,
  boxActions,
  planKillProcesses,
  planKillSession,
  planRemoveWorktree,
  renderBroadcast,
  selectForKill,
  sessionActions,
  staggerMinutes,
  type Action,
  type ActionId,
  type BroadcastAction,
  type EnactedAction,
  type KillPolicy,
  type KillRule,
  type Plan,
  type PlanRefusalRule,
  type ProcRecord,
  type Speaker,
  type Step,
} from "./actions.js";
import {
  sharedReceiptJournal,
  sharedUnknownWithoutHold,
  type UnknownWithoutHold,
} from "./action-stores.js";
import type { FleetSnapshot } from "./collect.js";
import { createDrainCursor, drainOnce, type DrainResult } from "./drain.js";
import {
  readBootIdentity,
  readProcessStart,
  type BootIdentity,
  type ProcessStartTicks,
} from "./execution-identity.js";
import { serverInstanceId } from "./instance.js";
import { sharedQuarantineBook, type ReleaseRefusalRule } from "./quarantine.js";
import {
  beginRecipientReceipt,
  describeChildren,
  recordUnreachedRecipient,
  sendAttemptOutcome,
  type RecipientReceipt,
  summarizeReceipt,
  type AcceptReceiptInput,
  type ReceiptActor,
  type ReceiptJournal,
  type ReceiptJournalStatus,
  type ReceiptOutcome,
  type RecoverySummary,
} from "./receipt-journal.js";
import { lookupRequest, readRequestKey, type RequestKey, type RequestLookup } from "./request-key.js";
import { sharedSendCoordinator, type SendCoordinator, type SendPurpose } from "./send-coordinator.js";
import {
  deliveryGate,
  drainGate,
  SteeringQueue,
  type DrainGate,
  type ClearResult,
  type EnqueueRefusalRule,
  type EnqueueResult,
  type QueuedItem,
} from "./queue.js";
import {
  checkOrigin,
  createRateLimiter,
  MAX_BODY_BYTES,
  parseSpeaker,
  parseStatus,
  parseTarget,
  readBody,
  type BodyStream,
  type Parsed,
  type RateLimiter,
  type RouteErrorCode,
} from "./routes-steer.js";
import type { FleetStatus } from "./status.js";
import type { Delivery, RefusalCode, SteerTarget } from "./steer.js";

/* ------------------------------------------------------------------ *
 * Limits. Exported so a test can drive them rather than sleeping.
 * ------------------------------------------------------------------ */

/**
 * The box route's body is bigger than the steering route's, because a broadcast
 * carries every recipient the page was showing. Thirty-six rows of five
 * identifiers is around 8 KiB, and 16 KiB would have started refusing at about
 * seventy sessions — a cap that fires only on a big fleet is a cap that fires
 * for the first time on the worst night.
 */
export const MAX_BOX_BODY_BYTES = 64 * 1024;

/** A floor between two writes to the same session's queue. */
export const MIN_INTERVAL_MS = 1_000;
/** And a whole-box ceiling, so a script cannot walk every row at once. */
export const BURST_MAX = 12;
export const BURST_WINDOW_MS = 10_000;

/**
 * How long before the fleet may be told to ease off again.
 *
 * A broadcast is thirty-six interruptions and thirty-six pauses. Sent twice in
 * five minutes it is worse than not sent at all: every agent gets two different
 * resume times, the second overwrites the first in whatever order the panes are
 * read, and the stagger — the entire point — is gone. Ten minutes is longer
 * than any plausible double-tap and shorter than the pause it asks for.
 */
export const BROADCAST_COOLDOWN_MS = 10 * 60_000;

/** More recipients than this is a script, not a fleet. */
export const MAX_RECIPIENTS = 80;

/**
 * How long the whole fan-out may take before it stops early.
 *
 * **`sendMessage` is synchronous** — three `execFileSync` tmux calls with
 * ten-second timeouts each — so a broadcast to thirty-six sessions holds this
 * server's single thread for as long as it takes, and while it does, the page,
 * the SSE stream and every other route answer nothing. On a healthy box that is
 * a couple of seconds. On the box this button exists FOR — load 391, tmux calls
 * timing out — thirty-six recipients at ten seconds each is minutes of a
 * dashboard that looks dead, at the moment somebody is staring at it.
 *
 * So the loop hands the event loop back between recipients and gives up at this
 * deadline, naming the rows it never reached. A broadcast that tells thirty of
 * thirty-six is worth having; a dashboard that stops answering is not.
 */
export const BROADCAST_DEADLINE_MS = 90_000;

/**
 * More pids than this in one kill is not a sweep, it is an accident.
 *
 * The batch is REFUSED rather than truncated. A cap that silently kills the
 * first sixty-four is a cap that reports success while doing something other
 * than what was confirmed, and the person's own list is right there to compare
 * against.
 */
export const MAX_KILL_PIDS = 64;

/** A confirmation receipt is deliberately short-lived and process-local. */
export const PREVIEW_TTL_MS = 5 * 60_000;
/** Enough for every action visible on one page, bounded against forgotten receipts. */
export const MAX_ACTION_PREVIEWS = 32;

/** Per step. `worktree:sweep` does a fetch; `kill` returns instantly. */
export const STEP_TIMEOUT_MS = 120_000;

/* ------------------------------------------------------------------ *
 * The wire shapes.
 * ------------------------------------------------------------------ */

/**
 * Everything that can go wrong that is not a `RefusalCode` from steer.ts.
 *
 * `RouteErrorCode` is reused whole rather than re-listed, so a code added to
 * the steering route arrives here and the `Record` below stops compiling until
 * somebody gives it a status.
 */
export type ActionErrorCode =
  | RouteErrorCode
  /** No action with that id. */
  | "no-such-action"
  /** A box action posted at the session route, or the other way round. */
  | "wrong-scope"
  /** `mode` and the action's `effect` do not go together — a spoken "run", say. */
  | "wrong-mode"
  /** The catalogue says this action needs a second tap and the body did not carry one. */
  | "confirm-required"
  /** Running enacted actions is switched off. Dry runs are not. */
  | "acting-disabled"
  /** The queue refused it — full, a double tap, an unsendable message. */
  | "queue-refused"
  /** A durable queue mutation could not be written, so memory was left alone. */
  | "receipt-unavailable"
  /** This session cannot be typed into at all, in steer.ts's own words. */
  | "not-steerable"
  /** No queued item with that id in that session's queue. */
  | "no-such-item"
  /** It is out for delivery, so it cannot be taken back. */
  | "in-flight"
  /** Something is queued for this session, and an immediate effect would jump it. */
  | "queue-not-empty"
  /** `plan*` in actions.ts refused to build the commands. */
  | "plan-refused"
  /** The plan ran and a step failed its gate, so the later steps did not run. */
  | "plan-failed"
  /** `ps` could not be read, so nothing about the box may be believed. */
  | "box-unreadable"
  /** Nothing matched the rule, or nothing survived the intersection. */
  | "nothing-to-kill"
  /** The fleet was told to ease off very recently. */
  | "cooldown"
  /** A run did not name the server-minted preview it is meant to confirm. */
  | "preview-required"
  /** The preview id was never minted here, or was evicted before confirmation. */
  | "preview-unknown"
  /** The preview existed, but its five-minute confirmation window ended. */
  | "preview-expired"
  /** This preview has already crossed the one-way fresh-to-claimed boundary. */
  | "preview-already-used"
  /** The action name or echoed material differs from the preview the person read. */
  | "preview-mismatch"
  /**
   * The page asked to drop a set of items and the queue no longer holds exactly
   * that set — something arrived, went out, or was taken by somebody else
   * between the list being drawn and the tap.
   *
   * Only `clearRoute` raises it, and it is the whole of that route's safety
   * argument: a bulk delete names WHICH items it means, so the one thing it can
   * never do is drop something nobody read. 409 rather than 400 because the
   * body was well formed — the world moved.
   */
  | "stale-view"
  /**
   * The id was minted by a DIFFERENT run of this server, so whatever it names
   * here is not what the person is looking at.
   *
   * **DISTINCT FROM `no-such-item`, WHICH IS THE MISLEADING ONE.** "There is no
   * such item" invites the reader to conclude their instruction was never
   * queued. The truth is that it was queued, the server restarted, the queue
   * went with it, and the id they are holding now points at somebody else's
   * work — see `SteeringQueue.idOrigin` and the note on `push` for what that
   * cost before it was refused.
   *
   * **AND DISTINCT FROM `stale-view`, WHICH ANSWERS A DIFFERENT QUESTION.**
   * That one guards CONCURRENT DRIFT within one run — something arrived, or
   * went out, between the list being drawn and the tap. It cannot catch this:
   * an old `[q1]` posted at a restarted queue that also holds exactly one item
   * called `q1` passes its comparison exactly. Both guards are live and neither
   * subsumes the other.
   *
   * 409 rather than 404 for `stale-view`'s reason: the body was well formed,
   * the world moved.
   */
  | "other-instance"
  /**
   * No hold by that id in this run — `quarantine.ts`'s `no-such-hold`.
   *
   * Its own code rather than `no-such-item`, because the two name different
   * things and a page that could not tell them apart would offer the wrong
   * gesture: an item is something you cancel, a hold is something you release.
   */
  | "no-such-hold"
  /**
   * The hold has moved on since the page drew it — another uncertain send
   * landed on that session — or the version is one this run never minted.
   *
   * **THIS IS THE STALE-PHONE REFUSAL AND IT IS THE POINT OF THE VERSION.**
   * Releasing on a reading two incidents old would clear a hold whose reason
   * the person has never seen. 409, for `stale-view`'s reason.
   */
  | "hold-version-mismatch"
  /**
   * It is already released, with the OTHER gesture. Repeating the SAME gesture
   * is a 200 — that is what makes a lost response recoverable — so this fires
   * only when two different answers are being recorded over each other.
   */
  | "hold-other-gesture"
  /**
   * A tmux restart already ended it: the pane, and whatever was in its input
   * box, are gone. Nothing is being held back, so there is nothing to release.
   */
  | "hold-superseded";

/**
 * A refusal's HTTP status.
 *
 * A `Record` keyed by the union rather than a switch with a default, the same
 * trick and the same reason as `REFUSAL_STATUS` next door: a new code stops
 * this file compiling instead of inheriting somebody's guess.
 *
 * Nothing here is a 200, and `internal` is the only 5xx that means we broke —
 * `acting-disabled` is a 503 because the server is deliberately declining, and
 * a client must not retry it.
 */
export const ACTION_ERROR_STATUS: Record<ActionErrorCode, number> = {
  "bad-request": 400,
  "forbidden-origin": 403,
  "unsupported-media-type": 415,
  "body-too-large": 413,
  "rate-limited": 429,
  "method-not-allowed": 405,
  "answering-disabled": 503,
  /* Inherited from `RouteErrorCode`, and unreachable from THIS file's routes —
     nothing under /api/actions answers with it, because a broadcast reports a
     held recipient row by row rather than refusing the whole fan-out. It is
     here because the union is shared with routes-steer.ts, where it is a 409:
     the request was fine, nothing was typed, and pressing again will not help. */
  "session-held": 409,
  // Request ids, plan 260910d. A malformed key is the client's bug (400); a
  // conflicting or expired one is well formed and the world is not what the
  // client thought (409). Neither is ever a retry permission.
  "bad-request-id": 400,
  "request-id-conflict": 409,
  "request-id-expired": 409,
  internal: 500,
  "no-such-action": 400,
  "wrong-scope": 400,
  "wrong-mode": 400,
  "confirm-required": 400,
  "acting-disabled": 503,
  "queue-refused": 409,
  "receipt-unavailable": 503,
  "not-steerable": 409,
  "no-such-item": 404,
  "in-flight": 409,
  "queue-not-empty": 409,
  "plan-refused": 400,
  // The plan ran and a gate said no. That is the system working — `worktree:check`
  // found something that exists nowhere else — so it is a 4xx with the step
  // outcomes in the body, not a 500 that reads as "the dashboard is broken".
  "plan-failed": 409,
  "box-unreadable": 409,
  "nothing-to-kill": 409,
  cooldown: 429,
  "preview-required": 400,
  "preview-unknown": 404,
  "preview-expired": 409,
  "preview-already-used": 409,
  "preview-mismatch": 409,
  "stale-view": 409,
  "other-instance": 409,
  "no-such-hold": 404,
  "hold-version-mismatch": 409,
  "hold-other-gesture": 409,
  "hold-superseded": 409,
};

/**
 * The book's refusals, as HTTP-visible codes.
 *
 * A `Record` keyed by the union, the same trick as `ENQUEUE_CODE` and for the
 * same reason: a new refusal rule in quarantine.ts stops this compiling rather
 * than inheriting somebody's guess about what to call it.
 */
const RELEASE_CODE: Record<ReleaseRefusalRule, ActionErrorCode> = {
  "no-such-hold": "no-such-hold",
  "version-mismatch": "hold-version-mismatch",
  "other-gesture": "hold-other-gesture",
  "already-superseded": "hold-superseded",
};

/**
 * What a queued item and a queue look like ON THE WIRE.
 *
 * Both are in `./wire.js` and re-exported here, because the browser imports the
 * same two declarations — `web/src/actions-client.ts` derives its parsed view
 * from `QueueView` rather than keeping a twin of it. A field added below is a
 * compile error in `parseQueue` until somebody reads it or names it in that
 * file's `Omit<>`. docs/postmortems/260908b.
 */
import type {
  BroadcastRecipientOutcome,
  BroadcastRecipientClaim,
  FleetActionMaterial,
  FleetActionPreview,
  FleetActionPreviewClaim,
  FleetKillCandidateView,
  KillAttempt,
  KillObservation,
  KillReport,
  PlanRunView,
  PlanStepStatus,
  HoldReleaseGesture,
  PlanStepView,
  QuarantineHoldView,
  QueueView,
  ReceiptSummary,
} from "./wire.js";

export type { QueuedItemView, QueueView } from "./wire.js";
export type { KillAttempt, KillObservation, KillReport } from "./wire.js";

/**
 * A step and a run, after they ran — **declared in `./wire.js` and aliased
 * here**, for `QueueView`'s reason above rather than for tidiness.
 *
 * The browser has to read these now: a `plan-failed` refusal carries the whole
 * run, and `actions-client.ts` used to drop it on the floor and render *this
 * page cannot tell whether the action took effect* over a body that said
 * exactly what had taken effect. A second declaration over there would rot the
 * way `QueueView`'s twin did.
 *
 * `PlanRunView` is parameterised so this side keeps the closed `ActionId` union
 * — a run of an action nobody offers should not typecheck here — while the
 * client reads a plain string, which is what a parse of somebody else's JSON
 * honestly yields.
 */
export type StepStatus = PlanStepStatus;
export type StepOutcome = PlanStepView;
export type PlanRun = PlanRunView<ActionId>;

/** One candidate for a kill, with the named rule that licensed it. */
export type KillCandidate = Omit<FleetKillCandidateView, "rule"> & { rule: KillRule };

/**
 * What became of one recipient of a broadcast.
 *
 * **`outcome` IS THE WHOLE DELIVERY READING, NOT A SUMMARY OF ONE.** It used
 * to carry `sent | refused | …`, and `refused` was the answer for three
 * different fates: a `Delivery` of `none`, a `Delivery` of `partial`, and a
 * throw out of the delivery module. `sendMessage` had already distinguished
 * them and this row threw the distinction away — the same Class B collapse
 * Stage 1 fixed on the *failure* half of an action, one arm over.
 *
 * The vocabulary lives in `wire.js` so the browser reads the same words. There
 * is deliberately no second `delivery` field beside this one: two fields that
 * can disagree is how the next one of these gets written.
 */
export type BroadcastOutcome = {
  paneId: string;
  sessionId: string;
  /** The pause this recipient was asked for, or null when nothing was sent. */
  minutes: number | null;
  outcome: BroadcastRecipientOutcome;
  code: RefusalCode | null;
  why: string | null;
};

/**
 * `Delivery` → the recipient word, and the mapping is total and lossless.
 *
 * A `Record` over steer.ts's closed union rather than a chain of `if`s, so a
 * fifth `Delivery` arm stops this file compiling instead of quietly taking the
 * last branch — the same trick as `ACTION_ERROR_STATUS` above.
 */
const DELIVERY_OUTCOME: Record<Delivery, BroadcastRecipientOutcome> = {
  none: "refused-before-effect",
  partial: "partial",
  unknown: "outcome-unknown",
};

/**
 * One `kill -TERM` step's outcome, as evidence about the pid.
 *
 * **THE THREE FAILURES ARE NOT ONE FAILURE.** `kill` exiting non-zero means the
 * process was not there, or is not ours — nothing happened to it, and that is a
 * settled fact. A `kill` that could not be spawned, timed out, or died on a
 * signal settles nothing: the signal may have gone first. Reading the second as
 * the first is how a page tells somebody a process survived when it did not.
 *
 * Takes a step rather than a step-or-nothing: every targeted pid has one, and
 * `killReport` is where that is asserted.
 */
function killObservation(step: StepOutcome): KillObservation {
  if (step.spawnError !== null || step.timedOut || step.code === null) return "not-established";
  return step.code === 0 ? "signal-accepted" : "signal-refused";
}

/**
 * A finished kill plan, as **intent and evidence side by side**.
 *
 * **ONE STEP PER PID IS ASSERTED HERE RATHER THAN COPED WITH.**
 * `planKillProcesses` builds exactly one `kill -TERM <pid>` step per pid, and
 * `runPlan` only stops early on a step it judges `failed` — which a
 * `best-effort` kill step can never be. So a run shorter than the list is a bug
 * in one of those two, not a state to report.
 *
 * It used to be reported. The missing pids came back as `not-attempted` beside
 * a `planCompleted: false`, and both were unreachable: no test could produce
 * either without building a `PlanRun` by hand. An arm no code can reach is
 * decoration on a contract, and it costs a reader the assumption that every
 * word in the vocabulary means something happened.
 *
 * **Throwing loses this run's evidence, and that is the direction to be wrong
 * in.** `guard()` turns it into a 500 that names the mismatch; the alternative
 * is a 200 naming fewer pids than were signalled, which is precisely the defect
 * this stage removed. The `killRoute` log line is written before this is called
 * so the journal still holds the run.
 */
export function killReport(pids: readonly number[], run: PlanRun): KillReport {
  const shortfall = () =>
    new Error(
      `killReport: ${run.steps.length} step(s) for ${pids.length} targeted pid(s) — ` +
        "planKillProcesses builds one step per pid and a best-effort step cannot stop a plan",
    );
  if (run.steps.length !== pids.length) throw shortfall();
  const observed: KillAttempt[] = [];
  for (let i = 0; i < pids.length; i++) {
    const pid = pids[i];
    const step = run.steps[i];
    // `noUncheckedIndexedAccess`, and unreachable after the length check.
    if (pid === undefined || step === undefined) throw shortfall();
    observed.push({ pid, observation: killObservation(step), why: step.verdict });
  }
  return { targeted: [...pids], observed };
}

/**
 * The receipt outcome of a plan that returned — plan 260910d Stage 3.
 * `completed` when every gate passed; `plan-stopped` naming the zero-based step
 * whose gate refused (`PlanRun.stoppedAt`). `detail` is appended to the `why`,
 * bounded counts only.
 */
function planOutcome(run: PlanRun, detail: string): ReceiptOutcome {
  if (run.completed) {
    return { state: "completed", reason: "plan-passed", code: null, why: `every gate passed (${run.steps.length}/${run.planned} steps)${detail}` };
  }
  const k = run.stoppedAt ?? run.steps.length - 1;
  return {
    state: "plan-stopped",
    reason: "gate-refused",
    code: `step-${k}`,
    why: `step ${k} did not pass its gate (${run.steps.length}/${run.planned} steps ran)${detail}`,
  };
}

export type ActionResponse =
  | {
      ok: true;
      op: "catalogue";
      schema: 1;
      actions: { session: readonly Action[]; box: readonly Action[] };
      queues: QueueView[];
      acting: { enabled: boolean; why: string };
      now: number;
      /**
       * Whether a steering hold would survive a dashboard restart — the book's
       * own reading of its hold ledger (`QuarantineBook.durable`). Read by
       * `scripts/fleet-restart-plan.ts`, which lets a restart go ahead over a
       * hold only when this is `true`. On the envelope rather than on
       * `QueueView`, because the web client builds a queue view field by field
       * and a new required field there would stop it compiling.
       */
      holdsDurable: boolean;
    }
  /** `receiptId` is present only on a keyed request (plan 260910d). */
  | { ok: true; op: "enqueued"; item: QueuedItem; position: number; gate: DrainGate; durable: boolean; receiptId?: string }
  /**
   * **A REPLAY: NOTHING HAPPENED ON THIS REQUEST.** The same `requestId` and
   * body were accepted before; this is that receipt, text-free, and it says
   * whether it is still pending.
   */
  | {
      ok: true;
      op: "receipt";
      replay: true;
      receipt: ReceiptSummary;
      /** A broadcast's replay carries its recipients' receipts too (Stage 3). */
      children?: ReceiptSummary[];
    }
  | {
      ok: true;
      op: "receipts";
      schema: 1;
      durable: boolean;
      status: ReceiptJournalStatus;
      recovery: RecoverySummary;
      recent: ReceiptSummary[];
      nonTerminal: ReceiptSummary[];
      unknownWithoutHold: UnknownWithoutHold[];
    }
  | { ok: true; op: "cancelled"; item: QueuedItem }
  /** A stale item's clock reset, so the next pass may deliver it. */
  | { ok: true; op: "revived"; item: QueuedItem }
  /** A lease nobody settled, cleared by a person. It is NOT a claim that nothing was sent. */
  | { ok: true; op: "abandoned"; item: QueuedItem }
  /**
   * A whole session's queue emptied — **and the one item that survived it**.
   *
   * `keptInFlight` is not a detail, it is the safety property: `clear()` keeps
   * an item that has already been leased, because the keystrokes may be on
   * their way and no receipt exists for a keystroke. A response that said only
   * "cleared" would be the ambiguous negative this module keeps writing
   * postmortems about — a person reading it would believe the queue was empty
   * while one instruction was still going out. So both halves are on the wire
   * and the page draws both, by name.
   *
   * Whole items rather than ids: the page has just thrown its own copy away, so
   * the only thing left to name them with is what came back.
   */
  | { ok: true; op: "cleared"; removed: QueuedItem[]; keptInFlight: QueuedItem | null }
  /**
   * A hold ended by a person. **Nothing was sent, in either gesture.**
   *
   * `repeat` is the whole of the idempotence: the same request twice records
   * one gesture and answers 200 both times, and the second answer says it was
   * already done rather than that it has just been done. A phone on a train
   * loses responses, and a recovery gesture that cannot be pressed twice is one
   * that leaves a hold nothing can clear.
   */
  | { ok: true; op: "hold-released"; hold: QuarantineHoldView; repeat: boolean }
  /*
   * THE FOUR ARMS THAT DESCRIBE AN EFFECT, and they agree on two field names.
   *
   * `dryRun` says whether it really happened and `result` holds what happened
   * or would happen; nothing else is at the top level. The page reads exactly
   * those two — see § What a box action answers, above `boxRoute`, for the day
   * these arms each invented their own names and the confirmation in front of
   * `kill-test-suites` rendered the word "null" for it.
   */
  | {
      ok: true;
      op: "dry-run";
      action: ActionId;
      dryRun: true;
      preview?: FleetActionPreview;
      result: { steps: readonly Step[]; candidates?: KillCandidate[]; scanned?: number; unreadable?: number };
    }
  /*
   * `kill` RATHER THAN `killed`, and the rename is the fix rather than a
   * tidy-up. `killed: number[]` was the list of pids the route INTENDED to
   * signal, in the past tense, sitting in the same body as the step outcomes
   * that could contradict it — so a `kill` that found nothing there answered
   * `killed: [5001, 5002]` and the page had no way to know better. `KillReport`
   * keeps the intent and the evidence as two fields; see wire.js.
   */
  /** `receiptId` is present only on a keyed request (plan 260910d Stage 3). */
  | {
      ok: true;
      op: "ran";
      action: ActionId;
      dryRun: false;
      result: { run: PlanRun; kill?: KillReport; skipped?: { pid: number; why: string }[] };
      receiptId?: string;
    }
  | {
      ok: true;
      op: "broadcast-preview";
      action: ActionId;
      dryRun: true;
      preview: FleetActionPreview;
      result: { total: number; recipients: BroadcastOutcome[]; sample: string | null };
    }
  | {
      ok: true;
      op: "broadcast";
      action: ActionId;
      dryRun: false;
      result: { total: number; recipients: BroadcastOutcome[] };
      receiptId?: string;
    }
  | {
      ok: false;
      code: ActionErrorCode;
      why: string;
      /** Present when a plan ran and stopped, so the page can show which step said no. */
      run?: PlanRun;
      /** Present on a keyed request that got as far as its receipt (Stage 3). */
      receiptId?: string;
    };

/* ------------------------------------------------------------------ *
 * Parsing. Every field of every body, checked.
 * ------------------------------------------------------------------ */

function bad<T>(why: string): Parsed<T> {
  return { ok: false, why };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Compare the values JSON actually carries, without recursive descent.
 *
 * Both operands crossed a JSON boundary: the stored arm came from the preview
 * request and the submitted arm came back in the confirmation. Node's
 * `isDeepStrictEqual` is stricter than that wire contract (`-0` differs from
 * `0`) and recursively overflows on a valid, sub-cap nested value. This walks
 * the same data iteratively and treats the two spellings of JSON zero alike.
 */
function sameJsonValue(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  while (pending.length > 0) {
    const pair = pending.pop() as [unknown, unknown];
    const [a, b] = pair;
    if (a === b) continue;
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

    const aArray = Array.isArray(a);
    const bArray = Array.isArray(b);
    if (aArray !== bArray) return false;
    if (aArray && bArray) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i += 1) pending.push([a[i], b[i]]);
      continue;
    }

    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const keys = Object.keys(aRecord);
    if (keys.length !== Object.keys(bRecord).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(bRecord, key)) return false;
      pending.push([aRecord[key], bRecord[key]]);
    }
  }
  return true;
}

/**
 * What the caller wants done with the action.
 *
 * **`enqueue` is the default and `run` must be spelled out**, which is the
 * first of the four gates in front of an irreversible effect. A body that
 * forgot the field, or a client written against an older shape, queues
 * something visible and cancellable rather than deleting a directory.
 */
export type ActionMode = "enqueue" | "dry-run" | "run";

export function parseMode(v: unknown, fallback: ActionMode): Parsed<ActionMode> {
  if (v === undefined || v === null) return { ok: true, value: fallback };
  const s = asString(v);
  if (s === "enqueue" || s === "dry-run" || s === "run") return { ok: true, value: s };
  return bad(`mode must be 'enqueue', 'dry-run' or 'run', not ${JSON.stringify(v)}`);
}

export type SessionActionRequest = {
  target: SteerTarget;
  declaredStatus: FleetStatus;
  what: { kind: "action"; action: Action } | { kind: "message"; text: string };
  mode: ActionMode;
  confirm: boolean;
  /**
   * WHO IS SPEAKING, on the path that carries almost every message.
   *
   * `BoxActionRequest` has had this since it was written and the broadcast
   * route renders with it; this one did not, so the attribution rule reached
   * every fleet-wide broadcast — the rarest thing the tool does — and no
   * single-session instruction at all, which is the one a person taps, the one
   * the queue drains, and the one an automated coordinator will use. It is
   * parsed by the SAME `parseSpeaker`, so there is one answer to "what does
   * silence mean" rather than two that can drift.
   */
  speaker: Speaker;
  /** For `remove-worktree`. The row's own directory and branch, as shown. */
  worktreeDir: string | null;
  branch: string | null;
  /** For `kill-session`. The row's name, as shown. */
  sessionName: string | null;
};

/** `POST /api/actions/session`'s body. */
export function parseSessionBody(raw: unknown): Parsed<SessionActionRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const target = parseTarget(o);
  if (!target.ok) return target;
  const declaredStatus = parseStatus(o.status);
  if (declaredStatus === null) {
    return bad("status is missing or is not a status; send the one the row you tapped was showing");
  }

  const actionId = o.actionId === undefined || o.actionId === null ? null : asString(o.actionId);
  const text = o.text === undefined || o.text === null ? null : asString(o.text);
  if (o.actionId !== undefined && o.actionId !== null && actionId === null) return bad("actionId is not a string");
  if (o.text !== undefined && o.text !== null && text === null) return bad("text is not a string");
  if (actionId === null && text === null) return bad("send either an actionId or a text; this body has neither");
  if (actionId !== null && text !== null) {
    // Not tidiness: a body with both has two answers to "what did the person
    // press", and whichever one this file read first would be the one that
    // happened. Refusing is the only reading with no second interpretation.
    return bad("send either an actionId or a text, not both");
  }

  let what: SessionActionRequest["what"];
  if (actionId !== null) {
    const action = actionById(actionId);
    if (action === null) return bad(`there is no action called '${actionId}'`);
    what = { kind: "action", action };
  } else if (text !== null) {
    what = { kind: "message", text };
  } else {
    return bad("send either an actionId or a text; this body has neither");
  }

  const mode = parseMode(o.mode, "enqueue");
  if (!mode.ok) return mode;
  const speaker = parseSpeaker(o.speaker);
  if (!speaker.ok) return speaker;
  const confirm = o.confirm === true;
  const worktreeDir = asString(o.worktreeDir);
  const branch = asString(o.branch);
  const sessionName = asString(o.sessionName);

  return {
    ok: true,
    value: { target: target.value, declaredStatus, what, mode: mode.value, confirm, speaker: speaker.value, worktreeDir, branch, sessionName },
  };
}

export type Recipient = { target: SteerTarget; declaredStatus: FleetStatus; claimedStatus: unknown };

export type BoxActionRequest =
  | {
      action: Action;
      mode: "dry-run";
      confirm: boolean;
      speaker: "greg" | "overseer";
      /** For a broadcast: the rows the page was showing, verbatim. */
      recipients: Recipient[];
    }
  | {
      action: Action;
      mode: "run";
      confirm: boolean;
      preview: unknown;
      material: unknown;
    };

function parsePreviewClaim(raw: unknown): Parsed<FleetActionPreviewClaim> {
  const o = asRecord(raw);
  if (!o) return bad("preview is not an object");
  const previewId = asString(o.previewId);
  const server = asString(o.serverInstanceId);
  const actionId = asString(o.actionId);
  if (previewId === null || previewId === "") return bad("preview.previewId is missing");
  if (server === null || server === "") return bad("preview.serverInstanceId is missing");
  if (actionId === null || actionId === "") return bad("preview.actionId is missing");
  return { ok: true, value: { previewId, serverInstanceId: server, actionId } };
}

function parseActionMaterial(raw: unknown): Parsed<FleetActionMaterial> {
  const o = asRecord(raw);
  if (!o) return bad("material is not an object");
  if (o.kind === "kill") {
    if (!Array.isArray(o.confirmable)) return bad("kill material.confirmable is not an array");
    if (!Array.isArray(o.excluded)) return bad("kill material.excluded is not an array");
    if (o.confirmable.length > MAX_KILL_PIDS) {
      return bad(`${o.confirmable.length} confirmable processes is more than the ${MAX_KILL_PIDS} this will act on at once`);
    }
    for (const value of o.confirmable) {
      const identity = asRecord(value);
      if (!identity) return bad("a confirmable process identity is not an object");
      const { pid, startTicks, bootId } = identity;
      if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1) return bad(`${JSON.stringify(pid)} is not a pid`);
      if (typeof startTicks !== "number" || !Number.isSafeInteger(startTicks) || startTicks < 0) {
        return bad(`process ${pid}'s startTicks is not a tick count`);
      }
      if (typeof bootId !== "string" || bootId === "") return bad(`process ${pid}'s bootId is missing`);
    }
    for (const value of o.excluded) {
      const item = asRecord(value);
      if (!item) return bad("an excluded process is not an object");
      const { pid, why } = item;
      if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 1) return bad(`${JSON.stringify(pid)} is not a pid`);
      if (typeof why !== "string" || why === "") return bad(`excluded process ${pid} has no reason`);
    }
    return { ok: true, value: o as unknown as Extract<FleetActionMaterial, { kind: "kill" }> };
  }
  if (o.kind === "broadcast") {
    if (o.speaker !== "greg" && o.speaker !== "overseer") return bad("broadcast material.speaker must be 'greg' or 'overseer'");
    if (!Array.isArray(o.recipients)) return bad("broadcast material.recipients is not an array");
    if (o.recipients.length > MAX_RECIPIENTS) {
      return bad(`${o.recipients.length} recipients is more than the ${MAX_RECIPIENTS} this will speak to at once`);
    }
    for (const value of o.recipients) {
      const item = asRecord(value);
      if (!item) return bad("a broadcast recipient claim is not an object");
      const paneId = asString(item.paneId);
      const sessionId = asString(item.sessionId);
      const claudeSessionId = item.claudeSessionId === null ? null : asString(item.claudeSessionId);
      const panePid = item.panePid;
      const minutes = item.minutes;
      if (paneId === null || paneId === "") return bad("a broadcast recipient has no paneId");
      if (sessionId === null || sessionId === "") return bad(`broadcast recipient ${paneId} has no sessionId`);
      if (claudeSessionId === null && item.claudeSessionId !== null) {
        return bad(`broadcast recipient ${paneId} has an invalid claudeSessionId`);
      }
      if (panePid !== null && (typeof panePid !== "number" || !Number.isSafeInteger(panePid) || panePid <= 1)) {
        return bad(`broadcast recipient ${paneId} has an invalid panePid`);
      }
      if (parseStatus(item.status) === null) return bad(`broadcast recipient ${paneId} has no valid status`);
      if (minutes !== null && (typeof minutes !== "number" || !Number.isSafeInteger(minutes) || minutes < 0)) {
        return bad(`broadcast recipient ${paneId} has an invalid stagger`);
      }
    }
    return { ok: true, value: o as unknown as Extract<FleetActionMaterial, { kind: "broadcast" }> };
  }
  return bad("material.kind must be 'kill' or 'broadcast'");
}

/** `POST /api/actions/box`'s body. */
export function parseBoxBody(raw: unknown): Parsed<BoxActionRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  if (Object.hasOwn(o, "pids")) {
    return bad("pids alone are no longer accepted; preview again so each process carries the start-time and boot identity you confirmed");
  }
  const actionId = asString(o.actionId);
  if (actionId === null) return bad("actionId is missing");
  const action = actionById(actionId);
  if (action === null) return bad(`there is no action called '${actionId}'`);
  // DRY RUN BY DEFAULT on the route that can kill things. `enqueue` is
  // meaningless here — there is no single session to be ordered against, which
  // is the same reason `enqueueAction` refuses a box-wide action.
  const mode = parseMode(o.mode, "dry-run");
  if (!mode.ok) return mode;
  if (mode.value === "enqueue") return bad("a box-wide action cannot be queued against one session; use 'dry-run' or 'run'");
  const confirm = o.confirm === true;

  if (mode.value === "run") {
    return { ok: true, value: { action, mode: "run", confirm, preview: o.preview ?? null, material: o.material ?? null } };
  }

  const speaker = parseSpeaker(o.speaker);
  if (!speaker.ok) return speaker;

  const recipients: Recipient[] = [];
  if (o.recipients !== undefined && o.recipients !== null) {
    if (!Array.isArray(o.recipients)) return bad("recipients is present and is not an array");
    if (o.recipients.length > MAX_RECIPIENTS) {
      return bad(`${o.recipients.length} recipients is more than the ${MAX_RECIPIENTS} this will speak to at once`);
    }
    const seen = new Set<string>();
    for (const item of o.recipients) {
      const r = asRecord(item);
      if (!r) return bad("a recipient is not an object");
      const target = parseTarget(r);
      if (!target.ok) return bad(`a recipient is not addressable: ${target.why}`);
      const status = parseStatus(r.status);
      if (status === null) return bad(`recipient ${target.value.paneId} has no status; send the one its row was showing`);
      // DUPLICATES ARE DROPPED, NOT REFUSED. A page that renders a row twice
      // would otherwise send one agent two different pause times and skew every
      // other agent's share of the window; refusing the whole broadcast for a
      // rendering bug would be worse than quietly speaking to each pane once.
      if (seen.has(target.value.paneId)) continue;
      seen.add(target.value.paneId);
      recipients.push({ target: target.value, declaredStatus: status, claimedStatus: r.status });
    }
  }

  return {
    ok: true,
    value: { action, mode: "dry-run", confirm, speaker: speaker.value === "greg" ? "greg" : "overseer", recipients },
  };
}

export type CancelRequest = { sessionId: string; itemId: string };

/** `POST`/`DELETE /api/actions/cancel`'s body. */
export function parseCancelBody(raw: unknown): Parsed<CancelRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const sessionId = asString(o.sessionId);
  const itemId = asString(o.itemId);
  if (sessionId === null) return bad("sessionId is missing, and it says which queue");
  if (itemId === null) return bad("itemId is missing");
  return { ok: true, value: { sessionId, itemId } };
}

export type ReleaseHoldRequest = { holdId: string; version: number; gesture: HoldReleaseGesture };

/**
 * `POST /api/actions/hold/release`'s body.
 *
 * **THERE IS NO `sessionId` IN IT, AND THAT IS DELIBERATE.** A hold is
 * addressed by its own id and nothing else, so releasing one asks nothing of a
 * snapshot, a queue, a session list or a pane. The failure this stage cares
 * most about is a hold that outlives every gesture that could clear it, and the
 * commonest way to build one is to make the recovery gesture depend on the
 * thing that has gone away. The book knows about holds; that is all this needs.
 *
 * `version` is required for the same reason `clear`'s `itemIds` is: it says
 * WHICH reading the person was looking at. A release built from a reading two
 * incidents old is refused rather than applied.
 */
export function parseReleaseHoldBody(raw: unknown): Parsed<ReleaseHoldRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const holdId = asString(o.holdId);
  if (holdId === null) return bad("holdId is missing, and it says which hold you are answering");
  const version = o.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    return bad("version is missing or is not a whole number — send the one you were shown, so a stale reading cannot release a newer hold");
  }
  const gesture = o.gesture;
  if (gesture !== "operator-confirmed" && gesture !== "abandoned-unknown") {
    return bad(
      "gesture must be 'operator-confirmed' (you looked at the terminal and saw it) or 'abandoned-unknown' (you are dropping the uncertainty). " +
        "Neither sends anything.",
    );
  }
  return { ok: true, value: { holdId, version, gesture } };
}

export type ClearRequest = { sessionId: string; itemIds: string[] };

/**
 * `POST /api/actions/clear`'s body.
 *
 * **`itemIds` IS THE POINT OF THIS BODY AND IT IS NOT OPTIONAL.** The obvious
 * shape — `{sessionId}` alone, since `clear()` takes only that — was rejected:
 * it cannot express *the list I am looking at*, so an item queued by the
 * Overseer between the confirmation being drawn and the tap would be destroyed
 * without ever having been on anybody's screen. The ids come verbatim off the
 * snapshot the person read, exactly as `cancelBody`'s do, and `clearRoute`
 * compares them with what the queue holds NOW; a difference is a refusal, not a
 * best effort. It is the same discipline as the tmux claims in routes-steer.ts:
 * a stale-but-honest claim, checked at the far end, never re-fetched to make
 * itself true.
 *
 * An empty array is accepted here and refused by the route, so that "you sent
 * no ids" and "there is nothing waiting" are two different sentences.
 */
export function parseClearBody(raw: unknown): Parsed<ClearRequest> {
  const o = asRecord(raw);
  if (!o) return bad("the body is not a JSON object");
  const sessionId = asString(o.sessionId);
  if (sessionId === null) return bad("sessionId is missing, and it says which queue");
  const raws = o.itemIds;
  if (!Array.isArray(raws)) {
    return bad("itemIds is missing, and it says which items you were looking at — clearing a queue sight unseen is not offered");
  }
  const itemIds: string[] = [];
  for (const v of raws) {
    const id = asString(v);
    if (id === null) return bad("an entry in itemIds is not a string");
    itemIds.push(id);
  }
  return { ok: true, value: { sessionId, itemIds } };
}

/* ------------------------------------------------------------------ *
 * Running a plan. The contract is actions.ts's, and it is load-bearing.
 * ------------------------------------------------------------------ */

/** One finished subprocess, read honestly. */
export type StepRun = {
  /** The exit code, or null when it died on a signal or never ran. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be run at all (ENOENT and friends). */
  spawnError: string | null;
};

const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

/** The tail of a subprocess's noise, for a person, bounded. */
export function tailOf(text: string, lines = 4, max = 400): string {
  const clean = text
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  const tail = clean.slice(-lines).join(" · ");
  return tail.length > max ? `${tail.slice(0, max)}…` : tail;
}

/**
 * Did this step pass its gate?
 *
 * The `never` on `pass.kind` is doing the same job as the one in
 * `describeAction`: a fourth kind of gate in actions.ts stops this compiling,
 * rather than falling through to whichever branch happened to be last.
 *
 * **A timeout or a spawn failure is never a pass**, including for
 * `stdout-has-line`: a `tmux list-sessions` that was killed at two minutes has
 * told us nothing about whether that name still means that session, and an
 * empty stdout that "does not contain the line" and a stdout we never got are
 * the same absence with very different meanings.
 */
export function judgeStep(step: Step, r: StepRun): { status: StepStatus; verdict: string } {
  const ran = r.spawnError === null && !r.timedOut;
  const exitedZero = ran && r.code === 0;
  const howItEnded = r.spawnError !== null
    ? `it could not be run: ${r.spawnError}`
    : r.timedOut
      ? "it was killed for taking too long"
      : r.code === null
        ? "it died on a signal"
        : `it exited ${r.code}`;

  switch (step.pass.kind) {
    case "exit-zero":
      return exitedZero ? { status: "passed", verdict: "it exited 0" } : { status: "failed", verdict: howItEnded };
    case "stdout-has-line": {
      if (!exitedZero) return { status: "failed", verdict: `${howItEnded}, so its output says nothing` };
      const wanted = step.pass.line.trim();
      const found = r.stdout.split("\n").some((l) => l.trim() === wanted);
      return found
        ? { status: "passed", verdict: `its output contains '${wanted}'` }
        : { status: "failed", verdict: `its output does not contain '${wanted}'` };
    }
    case "best-effort":
      return exitedZero
        ? { status: "passed", verdict: "it exited 0" }
        : { status: "failed-ignored", verdict: `${howItEnded}, which this step is allowed to do` };
    default: {
      const never: never = step.pass;
      return never;
    }
  }
}

/**
 * Run a plan's steps in order, and STOP at the first one that fails.
 *
 * This is the contract written in `Plan`'s doc comment, and it is the reason
 * that comment exists: a runner that carried on would run
 * `worktree:sweep -- remove` after `worktree:check` had said "there is
 * something in here that exists nowhere else", and every guard in actions.ts
 * would have passed on the way to deleting a day's work.
 *
 * `best-effort` is the only kind of failure that does not stop the plan, and it
 * is still RECORDED as `failed-ignored` rather than smoothed into a pass —
 * thirty kills of which eleven found nothing there is a fact worth reading.
 *
 * The steps are sequential and awaited one at a time. Not for tidiness: two
 * `kill`s racing is harmless, but `worktree:check` and `worktree:sweep` in
 * parallel is the whole bug this function exists to prevent, and a runner with
 * two modes would eventually be used in the wrong one.
 */
export async function runPlan(
  plan: Plan,
  io: ActionIo,
  timeoutMs: number = STEP_TIMEOUT_MS,
  /**
   * Told of every step that ran to a judgement, with its zero-based index and
   * outcome, before the next one starts — the step that fails and stops the
   * plan included. A step whose run threw is not reported: it never reached a
   * judgement. The receipt's `progress` records come from here (plan 260910d
   * Stage 3), which is how a crash mid-plan knows how far it got.
   */
  onStepDone?: (index: number, outcome: StepOutcome) => void,
): Promise<PlanRun> {
  const steps: StepOutcome[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    // `noUncheckedIndexedAccess`. Unreachable, and a `break` rather than a
    // `continue`: if the array is not what we think it is, stopping is the
    // direction to be wrong in.
    if (step === undefined) break;
    const r = await io.runStep(step, timeoutMs);
    const j = judgeStep(step, r);
    const outcome: StepOutcome = {
      argv: step.argv,
      cwd: step.cwd,
      why: step.why,
      status: j.status,
      verdict: j.verdict,
      code: r.code,
      timedOut: r.timedOut,
      spawnError: r.spawnError,
      tail: tailOf(r.stderr) || tailOf(r.stdout),
    };
    steps.push(outcome);
    onStepDone?.(i, outcome);
    if (j.status === "failed") {
      return { action: plan.action.id, steps, planned: plan.steps.length, completed: false, stoppedAt: i };
    }
  }
  return { action: plan.action.id, steps, planned: plan.steps.length, completed: true, stoppedAt: null };
}

/* ------------------------------------------------------------------ *
 * Reading the process table.
 * ------------------------------------------------------------------ */

export type ProcScan = { ok: true; procs: ProcRecord[]; unreadable: number } | { ok: false; why: string };

/**
 * `ps -eo pid=,ppid=,rss=,etimes=,args=` — four numeric columns, then the rest.
 *
 * Unparseable lines are skipped rather than failing the scan; a header we did
 * not ask for or a line with a `?` in a numeric column is not a reason to stop
 * knowing about the other fifteen hundred processes. An output with NO
 * parseable lines is a different thing and the caller treats it as one.
 */
export function parsePsArgs(out: string): { pid: number; ppid: number; rssKiB: number; etimeSeconds: number; args: string }[] {
  const rows: { pid: number; ppid: number; rssKiB: number; etimeSeconds: number; args: string }[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, rss, etimes, args] = m;
    if (pid === undefined || ppid === undefined || rss === undefined || etimes === undefined) continue;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      rssKiB: Number(rss),
      etimeSeconds: Number(etimes),
      args: (args ?? "").trim(),
    });
  }
  return rows;
}

/**
 * `ps -eo pid=,comm=` — the pid, then everything else on the line.
 *
 * A SECOND CALL rather than another column on the first, because **`comm` can
 * contain a space** (measured on this box: the tmux server's is `tmux: server`)
 * and a column in the middle of a whitespace-split line would take half of it
 * and shift everything after. Put last it is unambiguous, and `args` needs that
 * position too — so there are two calls and neither has to guess.
 */
export function parsePsComm(out: string): Map<number, string> {
  const byPid = new Map<number, string>();
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = m[1];
    const comm = m[2];
    if (pid === undefined || comm === undefined || comm.trim() === "") continue;
    byPid.set(Number(pid), comm.trim());
  }
  return byPid;
}

/**
 * Join the two listings, and DROP anything whose `comm` we could not read.
 *
 * The dropping is the safety property. `isProtected` matches a prefix of
 * `comm`, so a record with an empty one matches nothing on the protected list —
 * a `claude` we failed to name would arrive at `killVerdict` looking exactly
 * like an ordinary process, and a rule it matched would kill it. Unreadable
 * must not arrive disguised as ordinary; the count is returned so the page can
 * say how many we refused to have an opinion about.
 */
export function mergeProcs(
  rows: readonly { pid: number; ppid: number; rssKiB: number; etimeSeconds: number; args: string }[],
  comms: ReadonlyMap<number, string>,
  cwdOf: (pid: number) => string | null,
): { procs: ProcRecord[]; unreadable: number } {
  const procs: ProcRecord[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const comm = comms.get(r.pid);
    if (comm === undefined || comm === "") {
      unreadable += 1;
      continue;
    }
    procs.push({ pid: r.pid, ppid: r.ppid, comm, args: r.args, cwd: cwdOf(r.pid), rssKiB: r.rssKiB, etimeSeconds: r.etimeSeconds });
  }
  return { procs, unreadable };
}

/* ------------------------------------------------------------------ *
 * The io seam. Everything that touches the box is behind this.
 * ------------------------------------------------------------------ */

export type ActionIo = {
  /** Run one step of a plan. Never a shell — `execFile` with the plan's argv. */
  runStep(step: Step, timeoutMs: number): Promise<StepRun>;
  /** Every process on the box, or why not. */
  listProcesses(): Promise<ProcScan>;
  /** This process, so `killVerdict` can refuse to cut its own branch. */
  selfPid(): number;
  /** The exact start token already defined by execution-identity.ts. */
  readProcessStart(pid: number): ProcessStartTicks;
  /** The boot half of that same identity, read once for a kill request. */
  readBootIdentity(): BootIdentity;
};

/** The repo this file is in — `tools/fleet/` is two levels down from its root. */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** How long a killed process group gets to die politely before SIGKILL. */
const GRACE_MS = 5_000;

/**
 * The real thing.
 *
 * `execFile` with the plan's argv ARRAY, never a shell string, so a directory
 * with a space or a semicolon in it stays a directory. Nothing about the
 * command comes from the request: `plan*` in actions.ts built it, and the only
 * caller-supplied fragments in it went through that file's own validation.
 *
 * **The timeout kills a process GROUP.** `npm run worktree:sweep` is npm, which
 * is a node, which spawns tsx, which runs git; signalling npm alone leaves the
 * git holding a lock in a directory we were about to remove. So the child is
 * `detached`, and the deadline signals `-pid`.
 */
export function realActionIo(): ActionIo {
  return {
    runStep: (step, timeoutMs) =>
      new Promise<StepRun>((resolve) => {
        const bin = step.argv[0];
        if (bin === undefined) {
          resolve({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: "the step has no command in it" });
          return;
        }
        let settled = false;
        const done = (r: StepRun): void => {
          if (settled) return;
          settled = true;
          resolve(r);
        };
        // OUR OWN FLAG, not `err.killed`: the callback cannot tell a deadline we
        // enforced from a SIGTERM somebody else sent, and reporting an outside
        // kill as "timed out" is a sentence about the wrong thing.
        let deadlinePassed = false;
        const options = {
          cwd: step.cwd,
          killSignal: "SIGTERM" as const,
          encoding: "utf8" as const,
          maxBuffer: 8 * 1024 * 1024,
          detached: true,
        };
        const child = execFile(bin, [...step.argv.slice(1)], options, (err, stdout, stderr) => {
          clearTimeout(deadline);
          clearTimeout(hardStop);
          const e = err as (Error & { code?: number | string }) | null;
          done({
            code: e === null ? 0 : typeof e.code === "number" ? e.code : null,
            stdout,
            stderr,
            timedOut: deadlinePassed,
            spawnError: e !== null && typeof e.code === "string" ? `${e.code}: ${e.message}` : null,
          });
        });
        const pid = child.pid;
        const killGroup = (signal: NodeJS.Signals): void => {
          try {
            if (pid === undefined) throw new Error("no pid");
            // The MINUS is the point: a bare pid signals npm and leaves the git.
            process.kill(-pid, signal);
          } catch {
            try {
              child.kill(signal);
            } catch {
              /* already gone, which is the outcome we wanted */
            }
          }
        };
        let hardStop: NodeJS.Timeout | undefined;
        const deadline = setTimeout(() => {
          deadlinePassed = true;
          killGroup("SIGTERM");
          hardStop = setTimeout(() => killGroup("SIGKILL"), GRACE_MS);
          hardStop.unref();
        }, timeoutMs);
        // Neither timer may hold the process open.
        deadline.unref();
      }),

    listProcesses: () =>
      Promise.resolve().then((): ProcScan => {
        try {
          const args = execFileSync("ps", ["-eo", "pid=,ppid=,rss=,etimes=,args="], {
            encoding: "utf8",
            timeout: 10_000,
            maxBuffer: 32 * 1024 * 1024,
          });
          const comm = execFileSync("ps", ["-eo", "pid=,comm="], {
            encoding: "utf8",
            timeout: 10_000,
            maxBuffer: 8 * 1024 * 1024,
          });
          const rows = parsePsArgs(args);
          // AN EMPTY PARSE IS AN ERROR, NOT AN EMPTY BOX. `ps` exiting 0 with
          // nothing we could read means we do not know what is running, and
          // "nothing matched the rule" is the reading that makes the page say
          // the box is clean. config.ts makes the same distinction about binds.
          if (rows.length === 0) return { ok: false, why: "ps returned nothing this could parse, so nothing about the box may be believed" };
          const merged = mergeProcs(rows, parsePsComm(comm), (pid) => {
            try {
              return readlinkSync(`/proc/${pid}/cwd`);
            } catch {
              // Gone between the two reads, or not ours to look at. Null means
              // "we could not tell", and `hasDeletedCwd` refuses to guess.
              return null;
            }
          });
          return { ok: true, procs: merged.procs, unreadable: merged.unreadable };
        } catch (e) {
          return { ok: false, why: `ps could not be read: ${(e as Error).message}` };
        }
      }),

    selfPid: () => process.pid,
    readProcessStart,
    readBootIdentity,
  };
}

/* ------------------------------------------------------------------ *
 * The routes.
 * ------------------------------------------------------------------ */

export type ActionDeps = {
  /** The run which mints every preview id held by these routes. */
  serverInstanceId: string;
  /** The one queue per server. Shared with whatever drains it. */
  queue: SteeringQueue;
  /** Startup-only recovery mismatches; null in hand-built test composition. */
  startupUnknownWithoutHold: UnknownWithoutHold[] | null;
  /**
   * **The only thing here that can type into a pane** — `send-coordinator.ts`.
   *
   * The transport is injected one level down, inside it, so this file's own
   * tests can prove what reaches it without a single keystroke going out (there
   * are ~35 live agent sessions on this box doing other people's work). There
   * is no `sendMessage` beside it on purpose: the broadcast used to hold the
   * transport itself and chose its recipients on `drainGate` alone, so a
   * session the page was showing as HELD was still fanned out to.
   *
   * **IT MUST BE LOOKING AT THE SAME BOOK AS `queue`**, and `makeActionRoutes`
   * refuses to build if it is not — see the check there.
   */
  send: SendCoordinator;
  io: ActionIo;
  now: () => number;
  limiter: RateLimiter;
  log: (line: string) => void;
  /**
   * Whether an enacted action may actually RUN, and whether a broadcast may
   * actually go out. Dry runs are never gated by it.
   *
   * Off unless `FLEET_ACT_ENABLED=1`, and read per request rather than captured
   * at construction, so turning it on is a restart rather than a rebuild. The
   * precedent is `answeringEnabled` in routes-steer.ts and so is the reasoning:
   * the route stays built, tested and reachable, and refuses with a sentence
   * saying why — better than deleting it, and much better than a dashboard on a
   * phone that kills thirty processes because a pocket pressed something.
   */
  actEnabled: () => boolean;
  /**
   * Hand the event loop back between two sends of a broadcast.
   *
   * A dep rather than a bare `setImmediate` so a test can drive a fan-out
   * without depending on the scheduler, and so `BROADCAST_DEADLINE_MS` can be
   * measured against the injected clock rather than against a real wait.
   */
  yieldToLoop: () => Promise<void>;
  /**
   * The checkout `worktree:sweep` and `gjd-remote` are run from, and the root
   * every removable worktree must be under.
   *
   * DECIDED HERE, NOT SENT BY THE CLIENT. It is the one input to a plan that a
   * browser has no business naming: `dir` and `branch` describe the row the
   * person tapped, but the directory we run npm in is ours.
   */
  primaryDir: () => string;
};

export function realActionDeps(): ActionDeps {
  const instanceId = serverInstanceId();
  return {
    // ONE INSTANCE ID PER PROCESS, minted at the composition root and passed
    // down. Later stages reuse it for request ids and preview identity, which
    // is why it is `instance.ts`'s to mint rather than the queue's.
    // ONE RUN ID AND ONE BOOK PER PROCESS. `serverInstanceId()` is memoised in
    // instance.ts because the quarantine book is built in a different file —
    // `routes-steer.ts` has to reach it and cannot reach this one — and two
    // mints would put two different run ids in one process's refusal messages.
    queue: new SteeringQueue({
      now: () => Date.now(),
      serverInstanceId: instanceId,
      quarantine: sharedQuarantineBook(),
      receipts: sharedReceiptJournal(),
    }),
    startupUnknownWithoutHold: sharedUnknownWithoutHold(),
    // THE SAME BOOK, REACHED THE SAME WAY. `sharedSendCoordinator()` is built
    // over `sharedQuarantineBook()`, so the queue above and the transport below
    // are looking at one set of holds — which is what makes a hold opened by a
    // message typed from the phone stop the drain a minute later.
    send: sharedSendCoordinator(),
    serverInstanceId: instanceId,
    io: realActionIo(),
    now: () => Date.now(),
    limiter: createRateLimiter({ minIntervalMs: MIN_INTERVAL_MS, burstMax: BURST_MAX, burstWindowMs: BURST_WINDOW_MS }),
    log: (line) => console.log(line),
    actEnabled: () => process.env["FLEET_ACT_ENABLED"] === "1",
    yieldToLoop: () => new Promise<void>((r) => setImmediate(r)),
    primaryDir: () => repoRoot(),
  };
}

export type ActionRoutes = {
  /** True when this request was ours — mounted the way `serveStatic` is. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
  /**
   * One delivery pass over a fresh snapshot, at most one item per session.
   *
   * ON THE ROUTES OBJECT RATHER THAN BESIDE IT, so that draining and filling
   * are the same object's two halves. `deps.queue` is private to this closure,
   * and that is the point: there is no way to reach the drain without the queue
   * the routes filled, because there is no second constructor to call.
   */
  drain(snapshot: FleetSnapshot): DrainResult;
  /**
   * Put one free-text line in a session's queue, without going through HTTP.
   *
   * Here for the same reason `drain` is: `deps.queue` is private to the
   * closure, so the only way to reach the queue the routes fill is through the
   * object that filled it. `enqueueSharedMessage` at the bottom of this file is
   * the door; see its comment for who uses it and why it is this narrow.
   */
  enqueueMessage(
    target: { sessionId: string; claudeSessionId: string },
    text: string,
    speaker: Speaker,
    /** The broadcast this item is one recipient of (plan 260910d Stage 3). */
    parentReceiptId?: string | null,
  ): EnqueueResult;
};

function respond(res: ServerResponse, status: number, body: ActionResponse, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

function refuse(
  res: ServerResponse,
  code: ActionErrorCode,
  why: string,
  run?: PlanRun,
  extra: Record<string, string> = {},
  tag: { receiptId?: string } = {},
): void {
  respond(res, ACTION_ERROR_STATUS[code], { ok: false, code, why, ...(run === undefined ? {} : { run }), ...tag }, extra);
}

/**
 * Is any of these ids from a run of the server that is no longer this one?
 *
 * **ONE HELPER RATHER THAN FOUR COPIES**, because there are four routes that
 * take an item id from a client and match it by string equality — cancel,
 * revive, abandon and clear — and a guard that exists on three of them is a
 * guard whoever adds the fifth route will not know about. The judgment itself
 * is `SteeringQueue.idOrigin`'s: the queue owns the shape of an id.
 *
 * Takes a LIST because `clear` posts one. A foreign-run id is valid when the
 * queue has restored that exact item: the old page still names the same work,
 * and letting it cancel before another drain is the safe recovery gesture.
 * Only an absent foreign id is stale enough to refuse.
 *
 * Returns the sentence, or null. The caller refuses — it does not, because each
 * of the four writes its own log line and this must not become the place that
 * decides what a route logs.
 */
function fromAnotherRun(queue: SteeringQueue, itemIds: readonly string[]): string | null {
  const foreign = itemIds.find((id) => queue.idOrigin(id) === "other-instance" && queue.findItem(id) === null);
  if (foreign === undefined) return null;
  return (
    `${foreign} was queued by a different run of this dashboard; this one is ${queue.serverInstanceId}. ` +
    "After the restart, no restored queue item has that exact id, so it cannot safely name work in this run. " +
    "Reload the page and look at what is actually queued."
  );
}

/**
 * A known request id, answered — plan 260910d § The fingerprint.
 *
 * A replay is a 200 carrying the stored receipt and **nothing else happens**:
 * not the parse, not the limiter, not the queue. The receipt says whether it is
 * still pending. The two refusals do nothing either, and say so.
 */
function answerRequestLookup(
  res: ServerResponse,
  found: Exclude<RequestLookup, { kind: "fresh" }>,
  log: (line: string) => void,
  journal: ReceiptJournal | null = null,
  label = "action session",
): void {
  switch (found.kind) {
    case "replay": {
      const receipt = summarizeReceipt(found.receipt);
      /* A BROADCAST ANSWERS WITH ITS CHILDREN TOO. The parent says only that
         the fan-out came to an end; what became of each recipient is on that
         recipient's own receipt. */
      const children =
        journal !== null && found.receipt.accepted.op === "broadcast"
          ? journal.childrenOf(found.receipt.receiptId).map(summarizeReceipt)
          : null;
      log(`${label}: REPLAY receipt=${receipt.receiptId} state=${receipt.state} — nothing was done on this request`);
      respond(res, 200, { ok: true, op: "receipt", replay: true, receipt, ...(children === null ? {} : { children }) });
      return;
    }
    case "conflict":
      log(`${label}: refused code=request-id-conflict`);
      refuse(res, "request-id-conflict", found.why);
      return;
    case "expired":
      log(`${label}: refused code=request-id-expired`);
      refuse(res, "request-id-expired", found.why);
      return;
    default: {
      const never: never = found;
      void never;
    }
  }
}

/** Test-only fallback for compositions that open the two stores by hand. */
function recoveredUnknownWithoutHold(queue: SteeringQueue): UnknownWithoutHold[] {
  const receipts = queue.receiptJournal();
  const recovery = receipts.recovery();
  const ids = new Set([...recovery.interrupted, ...recovery.recoveryBlocked]);
  for (const conclusion of recovery.wouldConclude) {
    if (
      conclusion.state === "outcome-unknown" &&
      (conclusion.reason === "interrupted" || conclusion.reason === "recovery-blocked")
    ) {
      ids.add(conclusion.receiptId);
    }
  }
  const grouped = new Map<string, string[]>();
  for (const receiptId of ids) {
    const receipt = receipts.get(receiptId);
    if (receipt === null || receipt.accepted.target === null) continue;
    const sessionId = receipt.accepted.target.sessionId;
    if (queue.quarantineBook().holding(sessionId) !== null) continue;
    const sessionReceipts = grouped.get(sessionId) ?? [];
    sessionReceipts.push(receiptId);
    grouped.set(sessionId, sessionReceipts);
  }
  return [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sessionId, receiptIds]) => ({ sessionId, receiptIds: receiptIds.sort((a, b) => a.localeCompare(b)) }));
}

function answerClear(
  res: ServerResponse,
  result: ClearResult,
  sessionId: string,
  itemCount: number,
  log: (line: string) => void,
): void {
  if (!result.ok) {
    log(`action clear: refused code=receipt-unavailable session=${sessionId} items=${itemCount}`);
    refuse(res, "receipt-unavailable", result.why);
    return;
  }
  log(`action clear: REMOVED ${result.removed.length} session=${sessionId} kept=${result.keptInFlight?.id ?? "-"}`);
  respond(res, 200, { ok: true, op: "cleared", removed: result.removed, keptInFlight: result.keptInFlight });
}

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const v = headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

/** The bit of a request that identifies the caller, for the log. Never the body. */
function who(req: IncomingMessage): string {
  return `from=${req.socket?.remoteAddress ?? "-"} origin=${header(req.headers, "origin") ?? "-"}`;
}

const ACTING_DISABLED_WHY =
  "running an enacted action is disabled on this server: set FLEET_ACT_ENABLED=1 and restart it. " +
  "Dry runs work either way — ask what it would do, and do it in the terminal if that is what you want.";

/**
 * The map of enqueue refusals onto HTTP-visible codes.
 *
 * Keyed by the union so a new refusal rule in queue.ts stops this compiling.
 * They are nearly all `queue-refused`, and the exceptions are the two the page
 * must be able to tell apart: an action that does not belong here at all, and a
 * target that is not an address.
 */
const ENQUEUE_CODE: Record<EnqueueRefusalRule, ActionErrorCode> = {
  "bad-target": "bad-request",
  "bad-text": "bad-request",
  "no-such-action": "no-such-action",
  "wrong-scope": "wrong-scope",
  // `wrong-mode` rather than `queue-refused`, because that is precisely what it
  // is: the action is fine and enqueueing is the wrong thing to do with it. The
  // page can then offer the dry run, which is the alternative the queue's own
  // sentence names.
  "enacted-not-deliverable": "wrong-mode",
  "session-queue-full": "queue-refused",
  "fleet-queue-full": "queue-refused",
  "double-tap": "queue-refused",
  "receipt-capacity": "queue-refused",
  "receipt-unavailable": "receipt-unavailable",
};

/** Every reason `plan*` can refuse, as one code. They are all "your input was wrong". */
const PLAN_REFUSAL_CODE: Record<PlanRefusalRule, ActionErrorCode> = {
  "bad-input": "plan-refused",
  "not-a-worktree": "plan-refused",
  "never-the-primary-checkout": "plan-refused",
  "no-pids": "nothing-to-kill",
};

export function makeActionRoutes(overrides: Partial<ActionDeps> = {}): ActionRoutes {
  const deps: ActionDeps = { ...realActionDeps(), ...overrides };
  /**
   * **ONE BOOK, CHECKED RATHER THAN TRUSTED.**
   *
   * The queue asks its book whether a session is held before it leases
   * anything, and the coordinator asks its own on the line above the transport.
   * If those are two different books, each of them is right about half the
   * holds and the page is wrong about all of them — a message typed from the
   * phone would be recorded where the drain never looks.
   *
   * That is not hypothetical: a review showed that changing one `??=` to `=` in
   * `quarantine.ts` split the two compositions apart **with the whole suite
   * staying green**, because every producer's test injected its own book and
   * nothing joined the real ones. A comment saying "they are the same book"
   * would have gone on being true-looking. This throws instead, at
   * construction, before anything can be typed anywhere.
   */
  if (deps.send.book() !== deps.queue.quarantineBook()) {
    throw new Error(
      "the action routes were built with a send coordinator and a queue looking at two different quarantine books: " +
        "a hold recorded by one would be invisible to the other, and the drain would go on delivering into a session " +
        "the page says nothing may be sent to.",
    );
  }
  deps.queue.restore();
  const unknownWithoutHold = deps.startupUnknownWithoutHold ?? recoveredUnknownWithoutHold(deps.queue);
  /** When the fleet was last told to ease off. Server-lifetime, like the queue. */
  let lastBroadcastAt: number | null = null;
  type PreviewEntry = { preview: FleetActionPreview; state: "fresh" | "claimed" };
  const previews = new Map<string, PreviewEntry>();
  let nextPreview = 1;

  function purgeExpired(at: number, requestedId?: string): boolean {
    let requestedExpired = false;
    for (const [id, entry] of previews) {
      if (entry.preview.expiresAt > at) continue;
      if (id === requestedId) requestedExpired = true;
      previews.delete(id);
    }
    return requestedExpired;
  }

  function mintPreview(
    actionId: string,
    material: FleetActionMaterial,
  ): { ok: true; preview: FleetActionPreview } | { ok: false; why: string; retryAfterMs: number } {
    const at = deps.now();
    purgeExpired(at);
    if (previews.size >= MAX_ACTION_PREVIEWS) {
      const oldestFresh = [...previews].find(([, entry]) => entry.state === "fresh");
      if (oldestFresh !== undefined) {
        previews.delete(oldestFresh[0]);
      } else {
        const expiresAt = Math.min(...[...previews.values()].map((entry) => entry.preview.expiresAt));
        return {
          ok: false,
          why:
            `all ${MAX_ACTION_PREVIEWS} preview slots are retaining already-submitted receipts until they expire; ` +
            "wait before asking for another preview",
          retryAfterMs: Math.max(1, expiresAt - at),
        };
      }
    }
    const preview: FleetActionPreview = {
      schema: "fleet-action-preview/1",
      previewId: `${deps.serverInstanceId}-p${nextPreview++}`,
      serverInstanceId: deps.serverInstanceId,
      actionId,
      expiresAt: at + PREVIEW_TTL_MS,
      material,
    };
    previews.set(preview.previewId, { preview, state: "fresh" });
    return { ok: true, preview };
  }
  /**
   * WHERE THE NEXT DRAIN PASS STARTS. Server-lifetime state, built here rather
   * than inside `drainOnce` for the reason on `DrainCursor`: the drain is a
   * pure function of its inputs, and the one thing it has to remember between
   * passes belongs beside the queue it rotates over. There is one of these per
   * `ActionRoutes`, so it cannot be shared between two tests any more than the
   * queue can.
   */
  const drainCursor = createDrainCursor();

  /* ---------------- GET /api/actions ---------------- */

  function catalogue(res: ServerResponse): void {
    const queues: QueueView[] = deps.queue.snapshots().map((s) => ({
      sessionId: s.sessionId,
      // `stale` and `stuck` are the QUEUE's rules, asked rather than
      // recomputed. A page that decided staleness for itself would be a second
      // opinion about when an instruction is too old to deliver, and the two
      // would drift.
      items: s.items.map((i) => ({ ...i, stale: deps.queue.isStale(i), stuck: deps.queue.isStuck(i) })),
      // AND SO IS THIS. The page asks "is anything already ahead of the message
      // I am about to queue" before it offers Queue on an idle session, and
      // `items.length` is the wrong answer to that question: an invalidated or
      // stale item is in the list and is ahead of nothing.
      deliverable: deps.queue.deliverableCount(s.sessionId),
      volatile: s.volatile,
      warning: s.warning,
      since: s.since,
      // THE QUEUE'S OWN, verbatim. A queue is in `snapshots()` when it has
      // items OR this, which is what makes a hold with nothing left behind it
      // reach the page at all — see `SteeringQueue.snapshots`.
      quarantine: s.quarantine,
    }));
    respond(res, 200, {
      ok: true,
      op: "catalogue",
      schema: 1,
      actions: { session: sessionActions(), box: boxActions() },
      queues,
      // TOLD, NOT INFERRED — state.ts's `answeringEnabled` and its reasoning:
      // the page cannot honestly warn about a flag it has never been told, and
      // the alternative is a person discovering it by tapping and getting a 503.
      acting: { enabled: deps.actEnabled(), why: deps.actEnabled() ? "" : ACTING_DISABLED_WHY },
      now: deps.now(),
      // The ledger's own reading, never assumed — see the field's type.
      holdsDurable: deps.queue.quarantineBook().durable(),
    });
  }

  function receipts(res: ServerResponse): void {
    const journal = deps.queue.receiptJournal();
    respond(res, 200, {
      ok: true,
      op: "receipts",
      schema: 1,
      durable: journal.durable(),
      status: journal.status(),
      recovery: journal.recovery(),
      recent: journal.recent(50).map(summarizeReceipt),
      nonTerminal: journal.nonTerminal().map(summarizeReceipt),
      unknownWithoutHold,
    });
  }

  /* ---------------- POST /api/actions/session ---------------- */

  /**
   * Build the plan for a session-scoped enacted action.
   *
   * The two plan functions get their `primaryDir` from us and everything else
   * from the row the person tapped. `worktreeDir` gets one bound this file adds
   * on top of `planRemoveWorktree`'s: it must be under THIS checkout's
   * `.claude/worktrees/`. `isUnderWorktreesDir` accepts that shape anywhere on
   * the filesystem, which is right for a general-purpose guard and too loose
   * for a route — step 2 runs `worktree:sweep` in our own checkout, so a
   * worktree belonging to some other repo could never have been removed by it
   * anyway, and refusing here says so instead of failing halfway.
   */
  function planFor(req: SessionActionRequest, action: EnactedAction): { ok: true; plan: Plan } | { ok: false; code: ActionErrorCode; why: string } {
    const primaryDir = deps.primaryDir();
    if (action.id === "remove-worktree") {
      if (req.worktreeDir === null || req.branch === null) {
        return { ok: false, code: "bad-request", why: "removing a worktree needs worktreeDir and branch, from the row you tapped" };
      }
      const root = `${primaryDir.replace(/\/+$/, "")}/.claude/worktrees/`;
      if (!req.worktreeDir.startsWith(root)) {
        return {
          ok: false,
          code: "plan-refused",
          why: `'${req.worktreeDir}' is not under ${root}, and this server only removes worktrees of the checkout it is running from`,
        };
      }
      const p = planRemoveWorktree(action, { dir: req.worktreeDir, branch: req.branch, primaryDir });
      return p.ok ? { ok: true, plan: p.plan } : { ok: false, code: PLAN_REFUSAL_CODE[p.rule], why: p.why };
    }
    if (action.id === "kill-session") {
      if (req.sessionName === null) {
        return { ok: false, code: "bad-request", why: "killing a session needs sessionName, from the row you tapped" };
      }
      const p = planKillSession(action, { name: req.sessionName, sessionId: req.target.sessionId, primaryDir });
      return p.ok ? { ok: true, plan: p.plan } : { ok: false, code: PLAN_REFUSAL_CODE[p.rule], why: p.why };
    }
    // kill-test-suites and kill-safe-processes are box-scoped and never reach
    // here; the scope check above refuses them first.
    return { ok: false, code: "wrong-scope", why: `'${action.id}' is not an action one session can be asked for` };
  }

  /* ---------------- receipts for enacted plans and broadcasts ---------------- *
   *
   * Plan 260910d Stage 3. The order is the plan's § Write-ahead, and every
   * helper below is one step of it:
   *
   *   accepted (synchronously, before the first await; fail-closed when keyed)
   *   → attempted (before the first step or send; fail-closed when durable)
   *   → a `progress` per finished step (fail-open)
   *   → the outcome (fail-open: a lost line recovers as outcome-unknown).
   *
   * A check that can only run AFTER the one-way door and refuses concludes the
   * receipt `not-sent`/`refused-before-attempt`, so no accepted receipt is left
   * hanging by a refusal.
   */

  /** A receipt this request holds, and what its response may say about it. */
  type Held = {
    receiptId: string;
    /** Only a keyed request is told its receipt id: that is the request that can ask again. */
    tag: { receiptId?: string };
  };
  type Keyed = Extract<RequestKey, { kind: "keyed" }>;

  /**
   * Accept, or answer and return null. A keyed accept that cannot land runs
   * nothing and is refused 503 — otherwise the effect runs, the response is
   * lost, and the retry finds no reservation and runs it again (Sol F1). An
   * unkeyed accept that cannot land durably lives in memory (the journal's
   * fail-open) and the effect goes ahead, as for every unkeyed action.
   */
  function acceptOrAnswer(res: ServerResponse, input: AcceptReceiptInput, keyed: Keyed | null, label: string): Held | null {
    const journal = deps.queue.receiptJournal();
    const accepted = journal.accept(input);
    if (!accepted.ok) {
      // The lookup and this accept are synchronous with no `await` between, so a
      // duplicate id cannot be a race — but if it ever is, it is a replay.
      if (keyed !== null) {
        const again = lookupRequest(journal, keyed, deps.now());
        if (again.kind === "replay") {
          answerRequestLookup(res, again, deps.log, journal, label);
          return null;
        }
      }
      deps.log(`${label}: refused code=receipt-unavailable why=${accepted.why}`);
      refuse(res, "receipt-unavailable", `nothing was done: this action could not be given a receipt first (${accepted.why})`);
      return null;
    }
    return { receiptId: accepted.receiptId, tag: keyed === null ? {} : { receiptId: accepted.receiptId } };
  }

  /** Fail-open, and says so in the log when it did not land. */
  function settle(held: Held, arm: ReceiptOutcome, label: string): void {
    if (!deps.queue.receiptJournal().outcome(held.receiptId, arm)) {
      deps.log(`${label}: receipt=${held.receiptId} outcome ${arm.state}/${arm.reason} was not recorded`);
    }
  }

  /** For a throw out of a route: settle only a receipt still mid-attempt. */
  function settleIfAttempted(held: Held, arm: ReceiptOutcome, label: string): void {
    if (deps.queue.receiptJournal().get(held.receiptId)?.last.kind === "attempted") settle(held, arm, label);
  }

  /** A check after the one-way door said no. Nothing was attempted, and the receipt says so. */
  function refuseAfterDoor(
    res: ServerResponse,
    held: Held | null,
    code: ActionErrorCode,
    why: string,
    label: string,
    extra: Record<string, string> = {},
  ): void {
    if (held !== null) settle(held, { state: "not-sent", reason: "refused-before-attempt", code, why }, label);
    refuse(res, code, why, undefined, extra, held?.tag ?? {});
  }

  /**
   * `attempted`, before the first step or send. Fail-closed for a durably
   * accepted receipt: without it a crash after the effect would read, on
   * restart, as "accepted and never attempted" — proof that nothing happened,
   * over something that did. False: answered 503, nothing done.
   */
  function attemptOrRefuse(res: ServerResponse, held: Held, label: string): boolean {
    if (deps.queue.receiptJournal().attempted(held.receiptId).landed) return true;
    settle(
      held,
      { state: "not-sent", reason: "attempt-not-recorded", code: null, why: "the record that this was being attempted could not be written, so nothing was done" },
      label,
    );
    deps.log(`${label}: refused code=receipt-unavailable receipt=${held.receiptId} why=attempt-not-recorded`);
    refuse(
      res,
      "receipt-unavailable",
      "nothing was done: the record that this was being attempted could not be written, and without it a restart could not tell whether it happened",
      undefined,
      {},
      held.tag,
    );
    return false;
  }

  /**
   * `runPlan`, with a `progress` record per finished step — fail-open, because a
   * lost line only makes a crash report fewer completed steps, the conservative
   * direction — and `outcome-unknown`/`threw` if it throws, after which the
   * throw goes on to `guard`. The caller settles a run that returned.
   */
  async function runRecorded(plan: Plan, held: Held, label: string): Promise<PlanRun> {
    const journal = deps.queue.receiptJournal();
    try {
      return await runPlan(plan, deps.io, STEP_TIMEOUT_MS, (index, step) => {
        if (!journal.progress(held.receiptId, index, step.status, step.verdict)) {
          deps.log(`${label}: receipt=${held.receiptId} progress step=${index} was not recorded`);
        }
      });
    } catch (e) {
      settle(
        held,
        { state: "outcome-unknown", reason: "threw", code: null, why: "the plan runner threw, so no step after the recorded progress can be accounted for" },
        label,
      );
      throw e;
    }
  }

  /** One recipient's child receipt, as `beginRecipientReceipt` and `recordUnreachedRecipient` take it. */
  function recipientReceipt(parent: Held, rec: Recipient, who: { actor: ReceiptActor; speaker: Speaker | null }, what: string): RecipientReceipt {
    return {
      parentReceiptId: parent.receiptId,
      actor: who.actor,
      speaker: who.speaker,
      what,
      target: {
        sessionId: rec.target.sessionId,
        paneId: rec.target.paneId,
        claudeSessionId: rec.target.claudeSessionId,
        tmuxGeneration: deps.send.book().knownGeneration() ?? deps.queue.receiptJournal().lastGeneration(),
      },
    };
  }

  /** Accept and attempt one recipient's child, on the line above its send. `ok: false`: send nothing. */
  function beginChild(
    parent: Held,
    rec: Recipient,
    who: { actor: ReceiptActor; speaker: Speaker | null },
    what: string,
    label: string,
  ): { ok: true; receiptId: string } | { ok: false; why: string } {
    const child = beginRecipientReceipt(deps.queue.receiptJournal(), recipientReceipt(parent, rec, who, what));
    if (!child.ok) deps.log(`${label}: not sent session=${rec.target.sessionId} code=receipt-unavailable`);
    return child;
  }

  /** A recipient the deadline cut off: accounted for by a child that was never attempted. */
  function recordNotReached(parent: Held, rec: Recipient, who: { actor: ReceiptActor; speaker: Speaker | null }, what: string, label: string): void {
    if (!recordUnreachedRecipient(deps.queue.receiptJournal(), recipientReceipt(parent, rec, who, what))) {
      deps.log(`${label}: receipt for the unreached ${rec.target.sessionId} was not recorded`);
    }
  }

  async function sessionRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BODY_BYTES);
    if (parsed === null) return;
    // THE KEY IS READ AND LOOKED UP BEFORE THE PARSE, plan 260910d § The
    // fingerprint (Sol F16). `parseSessionBody` resolves `actionId` against
    // today's catalogue, so a replay asked after a deploy that retired the
    // action would otherwise be refused as a bad request — and the person who
    // lost the first response would never learn it had been queued.
    const key = readRequestKey("actions-session", parsed);
    if (key.kind === "bad") {
      deps.log("action session: refused code=bad-request-id");
      refuse(res, "bad-request-id", key.why);
      return;
    }
    if (key.kind === "keyed") {
      const found = lookupRequest(deps.queue.receiptJournal(), key, deps.now());
      if (found.kind !== "fresh") {
        answerRequestLookup(res, found, deps.log);
        return;
      }
    }
    const body = parseSessionBody(parsed);
    if (!body.ok) {
      deps.log(`action session: refused code=bad-request why=${body.why}`);
      refuse(res, "bad-request", body.why);
      return;
    }
    const r = body.value;
    const target = r.target;
    // Note what is NOT in this line: the message, and the action's words.
    const shape = r.what.kind === "action" ? `action=${r.what.action.id}` : `chars=${r.what.text.length}`;
    deps.log(
      `action session: pane=${target.paneId} session=${target.sessionId} claude=${target.claudeSessionId} ` +
        `declared=${r.declaredStatus.kind} mode=${r.mode} speaker=${r.speaker} ${shape}`,
    );

    if (r.what.kind === "action" && r.what.action.scope !== "session") {
      refuse(res, "wrong-scope", `'${r.what.action.id}' is a box-wide action; post it to /api/actions/box`);
      return;
    }
    // THE SECOND TAP, DERIVED FROM THE CATALOGUE rather than from a list here.
    // `needsConfirm` is `true` as a literal type on every enacted action, so a
    // new one is covered the day it is added and nobody has to remember this
    // line. A spoken action that Greg later marks as needing a confirm gets the
    // same treatment for free.
    if (r.what.kind === "action" && r.what.action.needsConfirm && !r.confirm) {
      refuse(res, "confirm-required", `'${r.what.action.id}' needs confirming: ${describeConfirm(r.what.action)}`);
      return;
    }

    if (r.mode === "enqueue") {
      await enqueue(r, res, key.kind === "keyed" ? key : null);
      return;
    }

    // From here down it is an enacted action being planned or run.
    if (r.what.kind !== "action") {
      refuse(res, "wrong-mode", "a free-text message can only be enqueued; it is delivered when the session is at a prompt");
      return;
    }
    const action = r.what.action;
    if (action.effect !== "enacted") {
      refuse(res, "wrong-mode", `'${action.id}' is a ${action.effect} action: enqueue it, and it goes out when the session is at a prompt`);
      return;
    }

    const built = planFor(r, action);
    if (!built.ok) {
      deps.log(`action session: refused code=${built.code} action=${action.id} why=${built.why}`);
      refuse(res, built.code, built.why);
      return;
    }

    if (r.mode === "dry-run") {
      respond(res, 200, { ok: true, op: "dry-run", action: action.id, dryRun: true, result: { steps: built.plan.steps } });
      return;
    }

    if (!deps.actEnabled()) {
      deps.log(`action session: refused code=acting-disabled action=${action.id} pane=${target.paneId}`);
      refuse(res, "acting-disabled", ACTING_DISABLED_WHY);
      return;
    }
    // NOTHING MAY JUMP THE QUEUE. queue.ts's header: "Push, then remove the
    // worktree" must not become "remove the worktree, then try to push", and
    // its own instruction for doing something right now is to cancel the queue
    // first. So an immediate enacted run against a session with anything
    // waiting is refused, and the person is told what is in the way.
    const waiting = deps.queue.size(target.sessionId);
    if (waiting > 0) {
      refuse(
        res,
        "queue-not-empty",
        `${waiting} item(s) are queued for ${target.sessionId}, and this would happen before them — cancel them first if that is what you want`,
      );
      return;
    }

    const rate = deps.limiter.check(target.sessionId, deps.now());
    if (!rate.ok) {
      refuse(res, "rate-limited", rate.why, undefined, { "retry-after": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) });
      return;
    }
    deps.limiter.record(target.sessionId, deps.now());

    /* ACCEPTED HERE, SYNCHRONOUSLY, RIGHT AFTER THE LIMITER — plan 260910d
       Stage 3. The request id was looked up at the top of this function and
       nothing since has awaited, so no second request can have accepted the
       same id in between. This is what lets a keyed run be honoured at all:
       Stage 2 refused one, because nothing recorded an enacted run and a retry
       after a lost response would have run the plan twice. */
    const label = "action session";
    const keyed = key.kind === "keyed" ? key : null;
    const held = acceptOrAnswer(
      res,
      {
        requestId: keyed?.requestId ?? null,
        fingerprint: keyed?.fingerprint ?? null,
        op: "enacted-session",
        origin: "enacted",
        actor: { kind: "client-claimed", id: r.speaker },
        speaker: r.speaker,
        target: {
          sessionId: target.sessionId,
          paneId: target.paneId,
          claudeSessionId: target.claudeSessionId,
          tmuxGeneration: deps.send.book().knownGeneration() ?? deps.queue.receiptJournal().lastGeneration(),
        },
        what: `action ${action.id} (${built.plan.steps.length} steps)`,
        queue: null,
      },
      keyed,
      label,
    );
    if (held === null) return;
    if (!attemptOrRefuse(res, held, label)) return;

    deps.log(
      `action session: RUNNING action=${action.id} steps=${built.plan.steps.length} session=${target.sessionId} receipt=${held.receiptId}`,
    );
    const run = await runRecorded(built.plan, held, label);
    deps.log(
      `action session: ${run.completed ? "DONE" : "STOPPED"} action=${action.id} ` +
        `ran=${run.steps.length}/${built.plan.steps.length} stoppedAt=${run.stoppedAt ?? "-"}`,
    );
    settle(held, planOutcome(run, ""), label);
    if (!run.completed) {
      const stopped = run.stoppedAt === null ? null : run.steps[run.stoppedAt];
      refuse(res, "plan-failed", `step ${(run.stoppedAt ?? 0) + 1} did not pass its gate: ${stopped?.verdict ?? "unknown"}`, run, {}, held.tag);
      return;
    }
    respond(res, 200, { ok: true, op: "ran", action: action.id, dryRun: false, result: { run }, ...held.tag });
  }

  async function enqueue(
    r: SessionActionRequest,
    res: ServerResponse,
    request: Extract<RequestKey, { kind: "keyed" }> | null,
  ): Promise<void> {
    // REFUSE NOW WHAT COULD NEVER DRAIN. `drainGate` asks `steerableStatus`, so
    // the sentence a person reads is steer.ts's own — "it is a shell, which
    // would EXECUTE the message" rather than "queued". Without this, an item
    // aimed at a shell or a dead Claude sits in the queue looking like
    // something that is going to happen, until it goes stale half an hour
    // later. `later` (the session is working) is exactly what the queue is for
    // and is NOT refused.
    const gate = drainGate(r.declaredStatus);
    if (gate.kind === "never") {
      deps.log(`action session: refused code=not-steerable pane=${r.target.paneId} why=${gate.reason.code}`);
      refuse(res, "not-steerable", gate.reason.why);
      return;
    }

    const rate = deps.limiter.check(r.target.sessionId, deps.now());
    if (!rate.ok) {
      refuse(res, "rate-limited", rate.why, undefined, { "retry-after": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) });
      return;
    }

    const t = { sessionId: r.target.sessionId, claudeSessionId: r.target.claudeSessionId };
    const result: EnqueueResult =
      r.what.kind === "action"
        ? deps.queue.enqueueAction(t, r.what.action.id, r.speaker, "enqueue", request)
        : deps.queue.enqueueMessage(t, r.what.text, r.speaker, "enqueue", request);
    if (!result.ok) {
      // The journal refuses an id it already holds. The lookup in
      // `sessionRoute` and this accept are synchronous with no `await`
      // between, so that cannot be a race — but if it ever is, it is a
      // replay, not a failure.
      if (request !== null && result.rule === "receipt-unavailable") {
        const again = lookupRequest(deps.queue.receiptJournal(), request, deps.now());
        if (again.kind === "replay") {
          answerRequestLookup(res, again, deps.log);
          return;
        }
      }
      deps.log(`action session: refused code=${ENQUEUE_CODE[result.rule]} rule=${result.rule}`);
      refuse(res, ENQUEUE_CODE[result.rule], result.why);
      return;
    }
    // SPENT ONLY ONCE SOMETHING HAPPENED, which is Sol's F18 next door: a
    // refused request must not push the person's own next legitimate press
    // further away.
    deps.limiter.record(r.target.sessionId, deps.now());
    // THE GATE WE REPORT IS THE DELIVERY ONE, and it is not the one we refused
    // on. The refusal above is "could this session ever be typed into"; this
    // field answers the different question the page asks — "does this go now or
    // wait" — and the two differ on `needs-you`, where the drain holds an item
    // until the dialog has been dealt with. Reporting `now` there would promise
    // a delivery that the very next pass declines to make.
    const willGo = deliveryGate(r.declaredStatus);
    deps.log(
      `action session: QUEUED id=${result.item.id} session=${r.target.sessionId} speaker=${r.speaker} position=${result.position} gate=${willGo.kind}`,
    );
    respond(res, 200, {
      ok: true,
      op: "enqueued",
      item: result.item,
      position: result.position,
      gate: willGo,
      durable: result.durable,
      ...(request === null ? {} : { receiptId: result.receiptId }),
    });
  }

  /* ---------------- POST/DELETE /api/actions/cancel ---------------- */

  async function cancelRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BODY_BYTES);
    if (parsed === null) return;
    const body = parseCancelBody(parsed);
    if (!body.ok) {
      refuse(res, "bad-request", body.why);
      return;
    }
    const { sessionId, itemId } = body.value;
    const foreign = fromAnotherRun(deps.queue, [itemId]);
    if (foreign !== null) {
      deps.log(`action cancel: refused code=other-instance session=${sessionId} item=${itemId}`);
      refuse(res, "other-instance", foreign);
      return;
    }
    const result = deps.queue.cancel(sessionId, itemId);
    if (!result.ok) {
      if (result.rule === "receipt-unavailable") {
        deps.log(`action cancel: refused code=receipt-unavailable session=${sessionId} item=${itemId}`);
        refuse(res, "receipt-unavailable", result.why);
        return;
      }
      // The queue returns one sentence for both failures, and the page needs to
      // tell them apart: "there is nothing there" and "it is going out right
      // now" call for different words on the button. Classified by asking the
      // snapshot, so the SENTENCE still comes from the queue and only the
      // status code is decided here.
      const present = deps.queue.snapshot(sessionId).items.some((i) => i.id === itemId);
      const code: ActionErrorCode = present ? "in-flight" : "no-such-item";
      deps.log(`action cancel: refused code=${code} session=${sessionId} item=${itemId}`);
      refuse(res, code, result.why);
      return;
    }
    deps.log(`action cancel: REMOVED id=${itemId} session=${sessionId}`);
    respond(res, 200, { ok: true, op: "cancelled", item: result.item });
  }

  /* ---------------- POST /api/actions/revive ---------------- */

  /**
   * Re-arm an item that has waited past `maxAgeMs`.
   *
   * **THE ROUTE EXISTS BECAUSE THE QUEUE'S ANSWER OTHERWISE HAS NO LISTENER.**
   * `next()` refuses a stale item and says *"re-arm it if it is still what you
   * want"*; `revive()` was written for exactly that and nothing reached it, so
   * the page drew an item under copy promising delivery that no pass would ever
   * make — this stage's own bug in a state nobody had looked at (GPT Sol's D2).
   *
   * Deliberately a person's gesture rather than something `next()` does: the
   * point of staleness is that somebody looks at an old instruction again
   * before it lands in a conversation that has moved on.
   *
   * Written like `cancelRoute` in every respect that is a rule — the same body,
   * the same origin check inside `parsedBody`, the same two failure codes
   * classified off the snapshot so the SENTENCE stays the queue's.
   */
  async function reviveRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BODY_BYTES);
    if (parsed === null) return;
    // The same two fields, so the same parser. A second one would be a second
    // place for `sessionId` to stop being checked.
    const body = parseCancelBody(parsed);
    if (!body.ok) {
      refuse(res, "bad-request", body.why);
      return;
    }
    const { sessionId, itemId } = body.value;
    const foreign = fromAnotherRun(deps.queue, [itemId]);
    if (foreign !== null) {
      deps.log(`action revive: refused code=other-instance session=${sessionId} item=${itemId}`);
      refuse(res, "other-instance", foreign);
      return;
    }
    const result = deps.queue.revive(sessionId, itemId);
    if (!result.ok) {
      const present = deps.queue.snapshot(sessionId).items.some((i) => i.id === itemId);
      const code: ActionErrorCode = present ? "in-flight" : "no-such-item";
      deps.log(`action revive: refused code=${code} session=${sessionId} item=${itemId}`);
      refuse(res, code, result.why);
      return;
    }
    deps.log(`action revive: RE-ARMED id=${itemId} session=${sessionId}`);
    respond(res, 200, { ok: true, op: "revived", item: result.item });
  }

  /* ---------------- POST /api/actions/abandon ---------------- */

  /**
   * Clear a lease nobody settled, so the rest of that session's queue can move.
   *
   * **IT IS NOT A CLAIM THAT NOTHING WAS SENT, AND THE COPY MUST NOT MAKE ONE.**
   * `drain.ts` leaves the lease open when `sendMessage` throws precisely because
   * nothing can tell a request that died before the keystrokes from one that
   * died after; the message may be in that agent's input box already. This route
   * is the missing half of that design — *"a person decides"* had no way for a
   * person to decide, so one thrown send wedged that session's queue for ever
   * (GPT Sol's D4). `settle(…, "abandoned")` is the queue's own word for it.
   *
   * **THE IN-FLIGHT/STUCK LINE IS `queue.isStuck`, NOT A COMPARISON HERE.** The
   * queue owns `leaseMs`; a second copy of the rule in this file would let the
   * page offer the button a moment before `next()` would agree, and abandoning a
   * send that is still going out is the one thing the open lease prevents.
   */
  async function abandonRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BODY_BYTES);
    if (parsed === null) return;
    const body = parseCancelBody(parsed);
    if (!body.ok) {
      refuse(res, "bad-request", body.why);
      return;
    }
    const { sessionId, itemId } = body.value;
    const foreign = fromAnotherRun(deps.queue, [itemId]);
    if (foreign !== null) {
      deps.log(`action abandon: refused code=other-instance session=${sessionId} item=${itemId}`);
      refuse(res, "other-instance", foreign);
      return;
    }
    const item = deps.queue.snapshot(sessionId).items.find((i) => i.id === itemId);
    if (!item) {
      deps.log(`action abandon: refused code=no-such-item session=${sessionId} item=${itemId}`);
      refuse(res, "no-such-item", `no queued item ${itemId} for ${sessionId}`);
      return;
    }
    if (item.leasedAt === null) {
      // Nothing was ever handed out, so there is no lease to clear and no
      // ambiguity to resolve. The gesture that fits is named, because a refusal
      // that does not say what to press instead is a dead end.
      deps.log(`action abandon: refused code=bad-request session=${sessionId} item=${itemId}`);
      refuse(res, "bad-request", `${itemId} has not been handed out to anything, so there is no delivery to abandon — cancel it instead`);
      return;
    }
    if (!deps.queue.isStuck(item)) {
      deps.log(`action abandon: refused code=in-flight session=${sessionId} item=${itemId}`);
      refuse(res, "in-flight", `${itemId} was handed out a moment ago and may still be going out; abandoning it now could clear a lease while the keystrokes are on their way`);
      return;
    }
    const result = deps.queue.settle(sessionId, itemId, "abandoned");
    if (!result.ok) {
      // Only reachable if the queue changed under us, which it cannot today —
      // this handler never yields between the read and the write.
      deps.log(`action abandon: refused code=no-such-item session=${sessionId} item=${itemId}`);
      refuse(res, "no-such-item", result.why);
      return;
    }
    deps.log(`action abandon: ABANDONED id=${itemId} session=${sessionId}`);
    respond(res, 200, { ok: true, op: "abandoned", item: result.item });
  }

  /* ---------------- POST /api/actions/clear ---------------- */

  /**
   * Empty one session's queue in a single gesture.
   *
   * **THE ROUTE EXISTS BECAUSE `clear()` HAD NO CALLER.** It was written,
   * bounded and tested — two call sites, both in tests/fleet-queue.test.ts —
   * and nothing in the product could reach it: `revive()`'s shape exactly, and
   * instance 9 of docs/postmortems/260908b. A method reachable only from its own
   * test looks healthy from every angle except the one that asks *who calls
   * this?*
   *
   * **The set is checked, not just the session.** `itemIds` says which items the
   * person was reading; this compares that with the queue's own droppable set
   * and refuses `stale-view` on any difference. So a bulk delete can only ever
   * destroy things that were on screen — see `parseClearBody` for the shape that
   * was rejected, and why. The comparison is on the SET rather than the order,
   * because the page draws them in the queue's order and nothing here depends on
   * it.
   *
   * **`keptInFlight` is the answer, not a footnote.** `clear()` deliberately
   * keeps a leased item, for `cancel()`'s reason: the keystrokes may already
   * have left and there is no receipt for a keystroke. Reporting "cleared"
   * without saying so would leave a person believing nothing more is going out
   * while one instruction still is.
   *
   * Written like `cancelRoute` in every respect that is a rule — the same origin
   * check inside `parsedBody`, the same `refuse`/`respond` helpers, the same
   * habit of letting the queue's own sentence be the one a person reads.
   */
  async function clearRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BODY_BYTES);
    if (parsed === null) return;
    const body = parseClearBody(parsed);
    if (!body.ok) {
      refuse(res, "bad-request", body.why);
      return;
    }
    const { sessionId, itemIds } = body.value;
    // **BEFORE `droppable` AND BEFORE THE `stale-view` COMPARISON**, and the
    // order is the point rather than an accident. Both of those would answer
    // this case with a code that describes something else — "nothing is waiting"
    // when the queue is empty after a restart, and "the list has changed" when
    // it is not — and neither can catch the case where the ids happen to line
    // up, which is the one that destroys somebody's instruction.
    const foreign = fromAnotherRun(deps.queue, itemIds);
    if (foreign !== null) {
      deps.log(`action clear: refused code=other-instance session=${sessionId} items=${itemIds.length}`);
      refuse(res, "other-instance", foreign);
      return;
    }
    const items = deps.queue.snapshot(sessionId).items;
    // The queue's rule for "can still be taken back", asked of the queue rather
    // than restated: `cancel()` refuses a leased item and `clear()` keeps one,
    // and a third opinion here would drift from both.
    const droppable = items.filter((i) => i.leasedAt === null).map((i) => i.id);
    if (droppable.length === 0) {
      deps.log(`action clear: refused code=no-such-item session=${sessionId}`);
      refuse(res, "no-such-item", `nothing is waiting in ${sessionId}'s queue that could be taken out of it`);
      return;
    }
    const asked = new Set(itemIds);
    const gone = droppable.filter((id) => !asked.has(id));
    const extra = itemIds.filter((id) => !droppable.includes(id));
    if (gone.length > 0 || extra.length > 0) {
      // Both directions named, because they mean opposite things to a person:
      // something ARRIVED that they have not read, or something they meant to
      // drop has already gone out. Either way the answer is to look again.
      const why =
        `the queue for ${sessionId} has changed since that list was drawn` +
        (gone.length > 0 ? ` — ${gone.join(", ")} ${gone.length === 1 ? "is" : "are"} waiting and was not in it` : "") +
        (extra.length > 0 ? ` — ${extra.join(", ")} ${extra.length === 1 ? "is" : "are"} no longer waiting` : "") +
        ". Look at it again and clear what is actually there.";
      deps.log(`action clear: refused code=stale-view session=${sessionId} gone=${gone.length} extra=${extra.length}`);
      refuse(res, "stale-view", why);
      return;
    }
    const result = deps.queue.clear(sessionId);
    answerClear(res, result, sessionId, itemIds.length, deps.log);
  }

  /* ---------------- POST /api/actions/hold/release ---------------- */

  /**
   * End a hold on a session. **Neither gesture sends anything.**
   *
   * `quarantine.ts` explains what a hold is; this is the only way out of one
   * that is not a tmux restart. Two gestures, and the difference between them
   * is what gets written down rather than what happens:
   *
   *  - **`operator-confirmed`** — *I looked at the terminal and saw it.* A
   *    person's claim, stored as a person's claim. The dashboard observed
   *    nothing, and no copy anywhere may say it did.
   *  - **`abandoned-unknown`** — *Abandon the uncertainty.* It stops holding and
   *    **claims nothing in either direction**. The half that is easy to get
   *    wrong is the second one: it must not read as *nothing was delivered*,
   *    which is `abandonRoute`'s lesson one route along.
   *
   * **IT ASKS NOTHING OF A SNAPSHOT, A QUEUE OR A PANE.** A hold whose session
   * has ended, whose queue is empty, or whose pane is gone is exactly the hold
   * somebody needs to clear, so every one of those would be the wrong thing to
   * require. The id and the version are the whole of the address.
   *
   * **AND IT IS IDEMPOTENT BY ANSWERING THE SAME THING TWICE.** A phone loses
   * responses; a recovery gesture that only works once is one that leaves a
   * hold nothing can clear. The key is `(holdId, version)`, and a repeat comes
   * back 200 with `repeat: true` rather than recording a second gesture.
   */
  async function releaseHoldRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BODY_BYTES);
    if (parsed === null) return;
    const body = parseReleaseHoldBody(parsed);
    if (!body.ok) {
      deps.log(`action hold: refused code=bad-request why=${body.why}`);
      refuse(res, "bad-request", body.why);
      return;
    }
    const { holdId, version, gesture } = body.value;
    const book = deps.queue.quarantineBook();
    /**
     * **A HOLD ID FROM THE PREVIOUS RUN IS ANSWERED, AND A QUEUE ID IS NOT.
     * THAT INCONSISTENCY IS DELIBERATE — DO NOT "FIX" IT.**
     *
     * Stage 2 made queue ids die with the process that minted them, and Stage 4b
     * makes holds survive one. Both are right, and the distinction is what each
     * id NAMES: **a queue id names volatile state and should die with it; a hold
     * id names a fact about the world that outlived the process** — there may
     * still be half a sentence in that input box, and the tmux server that is
     * holding it did not restart just because this dashboard did.
     *
     * So the test is not *whose token is on the front of it* but *is this a hold
     * this run is actually holding*: an id the book has is answerable whoever
     * minted it, because `hold-ledger.ts` rebuilt it here at startup with its
     * original id, precisely so that a phone which was looking at the page
     * before the restart can still release what it was looking at. Only an id
     * this run has nothing for AND that names another run is refused — and it
     * still comes before the release, for `clearRoute`'s reason.
     */
    if (book.find(holdId) === null && book.idOrigin(holdId) === "other-instance") {
      const why =
        `${holdId} was recorded by a different run of this dashboard; this one is ${book.serverInstanceId}, ` +
        "and it was not among the holds carried forward when this one started — so nothing is being held back on " +
        "its account. Reload the page and look at what is actually held.";
      deps.log(`action hold: refused code=other-instance hold=${holdId}`);
      refuse(res, "other-instance", why);
      return;
    }
    const result = book.release({ holdId, version, gesture });
    if (!result.ok) {
      deps.log(`action hold: refused code=${RELEASE_CODE[result.rule]} hold=${holdId} v${version} gesture=${gesture}`);
      refuse(res, RELEASE_CODE[result.rule], result.why);
      return;
    }
    deps.log(
      `action hold: ${result.repeat ? "ALREADY-RELEASED" : "RELEASED"} hold=${holdId} v${version} ` +
        `session=${result.hold.sessionId} gesture=${gesture} — nothing was sent`,
    );
    respond(res, 200, { ok: true, op: "hold-released", hold: result.hold, repeat: result.repeat });
  }

  /* ---------------- POST /api/actions/box ---------------- */

  function validatePreview(r: Extract<BoxActionRequest, { mode: "run" }>, res: ServerResponse): PreviewEntry | null {
    if (r.preview === null) {
      refuse(res, "preview-required", `preview '${r.action.id}' again, read the result, and confirm the receipt it returns`);
      return null;
    }
    const parsedClaim = parsePreviewClaim(r.preview);
    if (!parsedClaim.ok) {
      refuse(res, "preview-mismatch", `the preview claim is malformed: ${parsedClaim.why}. Preview '${r.action.id}' again and confirm that receipt`);
      return null;
    }
    const claim = parsedClaim.value;
    if (claim.serverInstanceId !== deps.serverInstanceId) {
      refuse(
        res,
        "other-instance",
        `${claim.previewId} claims a different server run from this dashboard, so it cannot name a preview held here. ` +
          "Reload the page, look at the current preview, and confirm that one if it is still right.",
      );
      return null;
    }

    // Purging is the first table operation. Its return preserves the difference
    // between "expired while this table still held it" and "not held now"
    // without retaining dead receipts; an unclaimed preview may also have been
    // evicted for capacity.
    const requestedExpired = purgeExpired(deps.now(), claim.previewId);
    if (requestedExpired) {
      refuse(res, "preview-expired", `${claim.previewId} expired; preview '${r.action.id}' again and read the current list before confirming`);
      return null;
    }
    const entry = previews.get(claim.previewId);
    if (entry === undefined) {
      refuse(res, "preview-unknown", `${claim.previewId} is not a preview held by this server; preview '${r.action.id}' again and read it before confirming`);
      return null;
    }
    if (entry.state === "claimed") {
      refuse(
        res,
        "preview-already-used",
        `${claim.previewId} was already submitted for '${entry.preview.actionId}'; look at what happened before acting again`,
      );
      return null;
    }
    const parsedMaterial = parseActionMaterial(r.material);
    const materialKind = r.action.effect === "broadcast" ? "broadcast" : r.action.effect === "enacted" ? "kill" : null;
    if (claim.actionId !== r.action.id) {
      refuse(
        res,
        "preview-mismatch",
        `the preview claim names '${claim.actionId}', but this request asks for '${r.action.id}'; preview the action you mean and confirm that receipt`,
      );
      return null;
    }
    if (claim.actionId !== entry.preview.actionId || entry.preview.actionId !== r.action.id) {
      refuse(
        res,
        "preview-mismatch",
        `${claim.previewId} belongs to '${entry.preview.actionId}', not '${r.action.id}'; preview the action you mean and confirm that receipt`,
      );
      return null;
    }
    if (materialKind === null) {
      refuse(res, "preview-mismatch", `'${r.action.id}' has no confirmable box material; preview the action again`);
      return null;
    }
    if (!parsedMaterial.ok) {
      refuse(
        res,
        "preview-mismatch",
        `the material submitted for ${claim.previewId} is malformed: ${parsedMaterial.why}. Preview '${r.action.id}' again and confirm without changing it`,
      );
      return null;
    }
    if (parsedMaterial.value.kind !== materialKind) {
      refuse(
        res,
        "preview-mismatch",
        `the material submitted for ${claim.previewId} is '${parsedMaterial.value.kind}', but '${r.action.id}' needs '${materialKind}' material; preview it again`,
      );
      return null;
    }
    if (!sameJsonValue(parsedMaterial.value, entry.preview.material)) {
      refuse(
        res,
        "preview-mismatch",
        `the material submitted for ${claim.previewId} differs from the material this server previewed; preview '${r.action.id}' again and confirm without changing it`,
      );
      return null;
    }
    return entry;
  }

  /**
   * ## What a box action answers, and why every arm answers it the same way
   *
   * Two fields on all four 200s, plus the server receipt on both previews:
   *
   *  - **`dryRun`** — whether this REALLY happened. Read off the answer rather
   *    than remembered from the request by everything downstream, because a
   *    server that ignored the flag and killed seventeen processes would
   *    otherwise be reported on the page as having answered a question.
   *  - **`result`** — what it did, or what it would do: the steps, the
   *    candidate pids, the recipients, the sample sentence. Whatever this
   *    holds, `RawValue` in ActionButtons.tsx draws it, and it is the entire
   *    content of the confirmation a person reads before pressing *kill*.
   *  - **`preview`** — the material the two dry-run arms minted and retained.
   *    The run must echo it exactly; `result` remains beside it for the current
   *    diagnostic rendering until Stage 3 gives the material its own view.
   *
   * **THE UNIFORMITY IS THE FIX, not tidiness.** Until 2026-09-08 each arm
   * invented its own top-level field names — `steps`, `candidates`, `killed`,
   * `skipped`, `recipients`, `sample` — while `actions-client.ts` read
   * `parsed["would"] ?? parsed["result"]`, a name no arm has ever sent. Both
   * ends were internally coherent and disagreed about a *word*, so both
   * compiled, both were tested, and the panel in front of `kill-test-suites`
   * rendered the literal grey word "null" where the consequences belong. That
   * is instance #11 of
   * docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md,
   * and the durable repair is the shared wire type in § Stage v0.8a; this is
   * the half of it that stops the page lying today. **A new arm here that
   * invents a field name instead of filling `result` re-opens it.**
   */
  async function boxRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = await parsedBody(req, res, MAX_BOX_BODY_BYTES);
    if (parsed === null) return;
    // THE KEY IS READ AND LOOKED UP BEFORE THE PARSE, plan 260910d § The
    // fingerprint (Sol F16). A confirmed kill names a preview this server minted,
    // and a restart forgets every preview — so a replay has to be answered from
    // the receipt before anything asks whether that preview still exists.
    const key = readRequestKey("actions-box", parsed);
    if (key.kind === "bad") {
      deps.log("action box: refused code=bad-request-id");
      refuse(res, "bad-request-id", key.why);
      return;
    }
    if (key.kind === "keyed") {
      const found = lookupRequest(deps.queue.receiptJournal(), key, deps.now());
      if (found.kind !== "fresh") {
        answerRequestLookup(res, found, deps.log, deps.queue.receiptJournal(), "action box");
        return;
      }
    }
    const body = parseBoxBody(parsed);
    if (!body.ok) {
      deps.log(`action box: refused code=bad-request why=${body.why}`);
      refuse(res, "bad-request", body.why);
      return;
    }
    const r = body.value;
    deps.log(
      `action box: action=${r.action.id} mode=${r.mode} confirm=${r.confirm}` +
        (r.mode === "dry-run"
          ? ` recipients=${r.recipients.length}`
          : ` preview=${asString(asRecord(r.preview)?.previewId) ?? "none"}`),
    );

    if (r.action.scope !== "box") {
      refuse(res, "wrong-scope", `'${r.action.id}' is a session action; post it to /api/actions/session`);
      return;
    }
    if (r.mode === "run" && r.action.needsConfirm && !r.confirm) {
      refuse(res, "confirm-required", `'${r.action.id}' needs confirming: ${describeConfirm(r.action)}`);
      return;
    }
    if (r.mode === "run" && !deps.actEnabled()) {
      deps.log(`action box: refused code=acting-disabled action=${r.action.id}`);
      refuse(res, "acting-disabled", ACTING_DISABLED_WHY);
      return;
    }

    let confirmed: PreviewEntry | null = null;
    let held: Held | null = null;
    if (r.mode === "run") {
      confirmed = validatePreview(r, res);
      if (confirmed === null) return;
      const cooldownWas = lastBroadcastAt;

      if (r.action.effect === "broadcast") {
        const at = deps.now();
        if (lastBroadcastAt !== null && at - lastBroadcastAt < BROADCAST_COOLDOWN_MS) {
          const left = BROADCAST_COOLDOWN_MS - (at - lastBroadcastAt);
          deps.log(`action box: refused code=cooldown action=${r.action.id} leftMs=${left}`);
          refuse(
            res,
            "cooldown",
            `the fleet was told to ease off ${Math.round((at - lastBroadcastAt) / 60_000)} minutes ago; a second one now would give every agent two different resume times`,
            undefined,
            { "retry-after": String(Math.max(1, Math.ceil(left / 1000))) },
          );
          return;
        }
        lastBroadcastAt = at;
      } else {
        const rate = deps.limiter.check("box", deps.now());
        if (!rate.ok) {
          refuse(res, "rate-limited", rate.why, undefined, { "retry-after": String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) });
          return;
        }
        deps.limiter.record("box", deps.now());
      }

      /* THE RECEIPT IS ACCEPTED AT THE ONE-WAY DOOR, SYNCHRONOUSLY — plan
         260910d Stage 3. The request id was looked up above with no `await`
         since. A keyed accept that cannot land refuses before the preview is
         claimed, so nothing happened and the preview can still be confirmed;
         the ease-off cooldown taken just above is handed back for the same
         reason. A box run claims nobody (it has no speaker field), so its actor
         is unattributed; a broadcast's speaker is the one its preview stored. */
      const keyed = key.kind === "keyed" ? key : null;
      const material = confirmed.preview.material;
      held = acceptOrAnswer(
        res,
        {
          requestId: keyed?.requestId ?? null,
          fingerprint: keyed?.fingerprint ?? null,
          op: r.action.effect === "broadcast" ? "broadcast" : "enacted-box",
          origin: r.action.effect === "broadcast" ? "broadcast" : "enacted",
          target: null,
          actor: { kind: "unattributed-http", id: null },
          speaker: material.kind === "broadcast" ? material.speaker : null,
          what: `action ${r.action.id}`,
          queue: null,
        },
        keyed,
        "action box",
      );
      if (held === null) {
        if (r.action.effect === "broadcast") lastBroadcastAt = cooldownWas;
        return;
      }

      // One synchronous assignment is the one-way door. Nothing below this
      // line runs before it and the first await is inside the action route, so
      // a second confirmation observes the tombstone rather than another fresh
      // receipt.
      confirmed.state = "claimed";
    }

    /* A throw out of either route is a bug, answered by `guard` — but the
       receipt must not be left mid-attempt in this run for it. (A crash would be
       concluded `interrupted` at the next start; a throw is not a crash.) */
    const threw: ReceiptOutcome = {
      state: "outcome-unknown",
      reason: "threw",
      code: null,
      why: "the action route threw after the attempt began, so what took effect cannot be told",
    };
    switch (r.action.effect) {
      case "enacted":
        try {
          await killRoute(r, r.action, res, confirmed?.preview.material, held);
        } catch (e) {
          if (held !== null) settleIfAttempted(held, threw, "action box");
          throw e;
        }
        return;
      case "broadcast":
        try {
          await broadcastRoute(r, r.action, res, confirmed?.preview.material, held);
        } catch (e) {
          if (held !== null) settleIfAttempted(held, threw, "action box");
          throw e;
        }
        return;
      // No `spoken` arm, and that is the type system rather than an omission:
      // every spoken action is `scope: "session"` as a literal, so the check
      // above has already narrowed it away. The day a box-scoped spoken action
      // is added, this switch stops compiling and somebody decides what it does.
      default: {
        const never: never = r.action;
        return never;
      }
    }
  }

  /**
   * Kill what a named rule licenses, bounded by what the person was shown.
   *
   * **THE FRESH SCAN AUTHORISES AND THE SHOWN LIST BOUNDS**, and both halves
   * matter. Without the scan, a page from ten minutes ago decides what dies,
   * and `killVerdict`'s own header says it judges a snapshot. Without the
   * intersection, confirming "kill 3 test suites" kills the eleven that started
   * while the dialog was open — which is a different, larger action than the
   * one anybody agreed to.
   */
  async function killRoute(
    r: BoxActionRequest,
    action: EnactedAction,
    res: ServerResponse,
    confirmed: FleetActionMaterial | undefined,
    /** The receipt a run accepted at the one-way door; null for a dry run. */
    held: Held | null,
  ): Promise<void> {
    const label = "action box";
    const policy: KillPolicy | null =
      action.id === "kill-test-suites" ? "test-suites" : action.id === "kill-safe-processes" ? "safe-to-kill" : null;
    if (policy === null) {
      refuseAfterDoor(res, held, "wrong-scope", `'${action.id}' is not a box-wide kill`, label);
      return;
    }

    const scan = await deps.io.listProcesses();
    if (!scan.ok) {
      deps.log(`action box: refused code=box-unreadable action=${action.id} why=${scan.why}`);
      refuseAfterDoor(res, held, "box-unreadable", scan.why, label);
      return;
    }
    const candidatesFrom = (procs: readonly ProcRecord[]): KillCandidate[] => {
      const parents = new Map<number, number>(procs.map((p) => [p.pid, p.ppid]));
      const chosen = selectForKill(procs, policy, { selfPid: deps.io.selfPid(), parents });
      const byPid = new Map(procs.map((p) => [p.pid, p]));
      return chosen.map((c) => {
        const p = byPid.get(c.pid);
        return {
          pid: c.pid,
          rule: c.rule,
          why: c.why,
          comm: p?.comm ?? "",
          // Bounded: a command line can be a kilobyte of arguments, and the page
          // is a phone.
          args: (p?.args ?? "").slice(0, 200),
          rssKiB: p?.rssKiB ?? 0,
          etimeSeconds: p?.etimeSeconds ?? 0,
        };
      });
    };
    const candidates = candidatesFrom(scan.procs);

    if (r.mode === "dry-run") {
      const boot = deps.io.readBootIdentity();
      if (!boot.read) {
        deps.log(`action box: refused code=box-unreadable action=${action.id} why=${boot.why}`);
        refuse(res, "box-unreadable", `the box boot identity could not be read, so no process identity can be confirmed: ${boot.why}`);
        return;
      }
      // Bracket the candidate snapshot with process identity. Without both
      // sides, a pid can turn over after `ps` and the preview joins the old
      // process's displayed command/rule to the replacement's start token.
      const before = new Map(candidates.map((candidate) => [candidate.pid, deps.io.readProcessStart(candidate.pid)]));
      const settledScan = await deps.io.listProcesses();
      if (!settledScan.ok) {
        deps.log(`action box: refused code=box-unreadable action=${action.id} why=${settledScan.why}`);
        refuse(res, "box-unreadable", `the process table could not be re-read while identities were being confirmed: ${settledScan.why}`);
        return;
      }
      const firstPids = new Set(candidates.map((candidate) => candidate.pid));
      const settledByPid = new Map(
        candidatesFrom(settledScan.procs)
          .filter((candidate) => firstPids.has(candidate.pid))
          .map((candidate) => [candidate.pid, candidate]),
      );
      const displayed = candidates.map((candidate) => settledByPid.get(candidate.pid) ?? candidate);
      const confirmable: { pid: number; startTicks: number; bootId: string }[] = [];
      const excluded: { pid: number; why: string }[] = [];
      for (const candidate of candidates) {
        const start = before.get(candidate.pid);
        if (start === undefined || !start.read) {
          excluded.push({ pid: candidate.pid, why: start?.why ?? "the process identity was not read" });
          continue;
        }
        if (!settledByPid.has(candidate.pid)) {
          excluded.push({ pid: candidate.pid, why: "the process no longer matched the rule when the preview was confirmed" });
          continue;
        }
        const after = deps.io.readProcessStart(candidate.pid);
        if (!after.read) {
          excluded.push({ pid: candidate.pid, why: after.why });
          continue;
        }
        if (after.ticks !== start.ticks) {
          excluded.push({ pid: candidate.pid, why: "the pid changed process while the preview was being built" });
          continue;
        }
        confirmable.push({ pid: candidate.pid, startTicks: after.ticks, bootId: boot.id });
      }
      if (confirmable.length > MAX_KILL_PIDS) {
        deps.log(
          `action box: refused code=plan-refused action=${action.id} confirmable=${confirmable.length} max=${MAX_KILL_PIDS}`,
        );
        refuse(
          res,
          "plan-refused",
          `the rule found ${confirmable.length} confirmable processes, more than the ${MAX_KILL_PIDS} this will signal at once; nothing was previewed`,
        );
        return;
      }
      const material: FleetActionMaterial = { kind: "kill", confirmable, excluded };
      const minted = mintPreview(action.id, material);
      if (!minted.ok) {
        deps.log(`action box: refused code=rate-limited action=${action.id} why=preview-capacity`);
        refuse(res, "rate-limited", minted.why, undefined, {
          "retry-after": String(Math.max(1, Math.ceil(minted.retryAfterMs / 1000))),
        });
        return;
      }
      const planned = planKillProcesses(action, { pids: confirmable.map((c) => c.pid), cwd: deps.primaryDir() });
      deps.log(`action box: DRY-RUN action=${action.id} candidates=${displayed.length} scanned=${settledScan.procs.length}`);
      respond(res, 200, {
        ok: true,
        op: "dry-run",
        action: action.id,
        // THE TWO FIELDS THE CONFIRMATION PANEL IS BUILT OUT OF, and they are
        // named here rather than left for a reader to infer from `op`. See
        // § What a box action answers, above `boxRoute`.
        dryRun: true,
        preview: minted.preview,
        result: {
          steps: planned.ok ? planned.plan.steps : [],
          candidates: displayed,
          scanned: settledScan.procs.length,
          unreadable: settledScan.unreadable,
        },
      });
      return;
    }

    if (confirmed?.kind !== "kill") {
      refuseAfterDoor(res, held, "preview-mismatch", `the stored preview for '${action.id}' was not kill material; preview it again`, label);
      return;
    }
    const shown = new Map(confirmed.confirmable.map((identity) => [identity.pid, identity]));
    const current = new Map(candidates.map((candidate) => [candidate.pid, candidate]));
    const stillLicensed = confirmed.confirmable.filter((identity) => current.has(identity.pid));
    const skipped: { pid: number; why: string }[] = [];
    for (const c of candidates) {
      if (!shown.has(c.pid)) skipped.push({ pid: c.pid, why: "it matches the rule now and was not on the list you confirmed" });
    }
    let ruleChanged = 0;
    for (const identity of confirmed.confirmable) {
      if (current.has(identity.pid)) continue;
      ruleChanged += 1;
      skipped.push({ pid: identity.pid, why: "it was on the list you confirmed and no longer matches the rule" });
    }

    // This detects turnover that happened while the preview was open. It does
    // not close the exit-and-pid-reuse gap after EACH candidate's read: for an
    // early candidate that gap also includes the remaining identity reads and
    // earlier signal steps. The durable fix is a pidfd, which Node cannot open
    // without a native dependency or helper binary.
    const boot = deps.io.readBootIdentity();
    if (!boot.read) {
      refuseAfterDoor(
        res,
        held,
        "box-unreadable",
        `the box boot identity could not be re-read, so none of the confirmed processes can be verified: ${boot.why}`,
        label,
      );
      return;
    }
    const pids: number[] = [];
    let replaced = 0;
    let unreadableIdentity = 0;
    for (const identity of stillLicensed) {
      if (boot.id !== identity.bootId) {
        replaced += 1;
        skipped.push({ pid: identity.pid, why: "the box boot changed, so that pid is now a different process" });
        continue;
      }
      const start = deps.io.readProcessStart(identity.pid);
      if (!start.read) {
        unreadableIdentity += 1;
        skipped.push({ pid: identity.pid, why: `its process identity could no longer be read, so it may have exited or been replaced: ${start.why}` });
        continue;
      }
      if (start.ticks !== identity.startTicks) {
        replaced += 1;
        skipped.push({ pid: identity.pid, why: "that pid is now a different process; its start tick changed after the preview" });
        continue;
      }
      pids.push(identity.pid);
    }
    if (pids.length === 0) {
      const reasons = [
        ruleChanged > 0 ? `${ruleChanged} no longer match the rule` : null,
        replaced > 0 ? `${replaced} are now different processes` : null,
        unreadableIdentity > 0 ? `${unreadableIdentity} could no longer be identified` : null,
      ].filter((part): part is string => part !== null);
      deps.log(`action box: refused code=nothing-to-kill action=${action.id} shown=${shown.size} matched=${candidates.length}`);
      refuseAfterDoor(
        res,
        held,
        "nothing-to-kill",
        `nothing on the list you confirmed can still be signalled${reasons.length > 0 ? `: ${reasons.join("; ")}` : ""} — look again and confirm the new list`,
        label,
      );
      return;
    }

    const built = planKillProcesses(action, { pids, cwd: deps.primaryDir() });
    if (!built.ok) {
      refuseAfterDoor(res, held, PLAN_REFUSAL_CODE[built.rule], built.why, label);
      return;
    }
    // A run always holds a receipt: `boxRoute` accepts one at the door before
    // calling here. Reaching this without one is a bug, and `guard` answers it.
    if (held === null) throw new Error("a confirmed kill reached its plan without a receipt");
    if (!attemptOrRefuse(res, held, label)) return;
    deps.log(`action box: KILLING action=${action.id} pids=${pids.join(",")} receipt=${held.receiptId}`);
    const run = await runRecorded(built.plan, held, label);
    /* THE OUTCOME BEFORE `killReport`, which throws on a run short of steps —
       and its `why` carries the observations as COUNTS, read by the same
       `killObservation` the report uses. Never an argv. */
    const observed = new Map<KillObservation, number>();
    for (const step of run.steps) observed.set(killObservation(step), (observed.get(killObservation(step)) ?? 0) + 1);
    settle(
      held,
      planOutcome(
        run,
        ` — signal-accepted ${observed.get("signal-accepted") ?? 0}, signal-refused ${observed.get("signal-refused") ?? 0}, ` +
          `not-established ${observed.get("not-established") ?? 0} of ${pids.length} targeted; ${skipped.length} skipped`,
      ),
      label,
    );
    /* THE RUN FIRST, BEFORE THE REPORT IS BUILT, because `killReport` throws on
       a run short of steps — and if it ever does, this line is the only record
       left of a kill that has already happened. */
    deps.log(`action box: ${run.completed ? "DONE" : "STOPPED"} action=${action.id} steps=${run.steps.length}/${pids.length}`);
    /* THEN WHAT CAME BACK, PID BY PID, so the log says the same thing the body
       does. A line reading `killed=3` beside a body naming two refusals is the
       version of this defect that survives in the journal after the page has
       been closed. */
    const report = killReport(pids, run);
    const accepted = report.observed.filter((o) => o.observation === "signal-accepted").length;
    deps.log(`action box: action=${action.id} signal-accepted=${accepted}/${report.targeted.length}`);
    respond(res, 200, { ok: true, op: "ran", action: action.id, dryRun: false, result: { run, kill: report, skipped }, ...held.tag });
  }

  /**
   * Tell every steerable session the box is loaded, each with its own resume
   * time.
   *
   * **THE STAGGER IS BOUND, THEN RECOMPUTED AT THE SEND.** The preview stores
   * each recipient's promised minutes; the run checks the same
   * `staggerMinutes(index, total, action.stagger)` immediately before rendering
   * the sentence. The words are still rendered at delivery rather than stored,
   * but they cannot silently acquire a different pause from the one displayed.
   *
   * **THE DENOMINATOR IS WHO WE ARE ACTUALLY SPEAKING TO**, not how many rows
   * the page sent. Counting the sessions we skip would leave gaps at both ends
   * of the window and hand somebody the far end for no reason.
   */
  async function broadcastRoute(
    r: BoxActionRequest,
    action: BroadcastAction,
    res: ServerResponse,
    confirmed: FleetActionMaterial | undefined,
    /** The parent receipt a run accepted at the one-way door; null for a dry run. */
    held: Held | null,
  ): Promise<void> {
    const label = "action box";
    let recipients: Recipient[];
    let speaker: Speaker;
    const promisedMinutes = new Map<string, number | null>();
    if (r.mode === "dry-run") {
      recipients = r.recipients;
      speaker = r.speaker;
    } else {
      if (confirmed?.kind !== "broadcast") {
        refuseAfterDoor(res, held, "preview-mismatch", `the stored preview for '${action.id}' was not broadcast material; preview it again`, label);
        return;
      }
      speaker = confirmed.speaker;
      recipients = [];
      for (const claim of confirmed.recipients) {
        const status = parseStatus(claim.status);
        if (claim.claudeSessionId === null || status === null) {
          refuseAfterDoor(res, held, "preview-mismatch", `${claim.paneId} in the stored preview is no longer a complete recipient claim; preview again`, label);
          return;
        }
        recipients.push({
          target: {
            paneId: claim.paneId,
            sessionId: claim.sessionId,
            claudeSessionId: claim.claudeSessionId,
            ...(claim.panePid === null ? {} : { panePid: claim.panePid }),
          },
          declaredStatus: status,
          claimedStatus: claim.status,
        });
        promisedMinutes.set(claim.paneId, claim.minutes);
      }
    }

    if (recipients.length === 0) {
      refuseAfterDoor(res, held, "bad-request", "a broadcast needs recipients: send the rows the page is showing, with the status each one had", label);
      return;
    }

    // Who can actually be spoken to, in the page's order. `drainGate` is the
    // queue's rule and it asks `steerableStatus`, so a shell — where the text
    // would be EXECUTED — and a session that is working are both left out here
    // rather than being refused one at a time by the delivery module.
    const deliverable: Recipient[] = [];
    const outcomes: BroadcastOutcome[] = [];
    const gates = new Map<string, DrainGate>();
    for (const rec of recipients) {
      const gate = drainGate(rec.declaredStatus);
      gates.set(rec.target.paneId, gate);
      if (r.mode === "run") {
        if (promisedMinutes.get(rec.target.paneId) !== null) deliverable.push(rec);
      } else if (gate.kind === "now") deliverable.push(rec);
    }
    const total = deliverable.length;
    if (total === 0) {
      refuseAfterDoor(res, held, "not-steerable", `none of the ${recipients.length} rows you sent is at a prompt right now, so there is nobody to tell`, label);
      return;
    }

    if (r.mode === "dry-run") {
      let index = 0;
      const claims: BroadcastRecipientClaim[] = [];
      for (const rec of recipients) {
        const gate = gates.get(rec.target.paneId);
        let minutes: number | null = null;
        if (gate?.kind === "now") {
          minutes = staggerMinutes(index, total, action.stagger);
          outcomes.push({
            paneId: rec.target.paneId,
            sessionId: rec.target.sessionId,
            // The SAME function the send will call, with the same arguments, so
            // the preview cannot promise a spread the delivery does not keep.
            minutes,
            /* `would-send` RATHER THAN `sent`. A preview and a delivery used
               the same word, so a row of a dry run was indistinguishable from
               a row of a real fan-out by anything but the envelope around it —
               and the envelope is exactly what got misread the day this panel
               reported every dry run as "Done." */
            outcome: "would-send",
            code: null,
            why: "it is at a prompt and would be told to pause for this long",
          });
          index += 1;
        } else {
          outcomes.push(skippedOutcome(rec, gate));
        }
        claims.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          claudeSessionId: rec.target.claudeSessionId,
          panePid: rec.target.panePid ?? null,
          status: rec.claimedStatus,
          minutes,
        });
      }
      const first = deliverable[0];
      const minted = mintPreview(action.id, { kind: "broadcast", speaker, recipients: claims });
      if (!minted.ok) {
        deps.log(`action box: refused code=rate-limited action=${action.id} why=preview-capacity`);
        refuse(res, "rate-limited", minted.why, undefined, {
          "retry-after": String(Math.max(1, Math.ceil(minted.retryAfterMs / 1000))),
        });
        return;
      }
      respond(res, 200, {
        ok: true,
        op: "broadcast-preview",
        action: action.id,
        dryRun: true,
        preview: minted.preview,
        result: {
          total,
          recipients: outcomes,
          // One recipient's exact words, so the person can read what is about to
          // be said to thirty-six agents before it is said.
          sample: first === undefined ? null : renderBroadcast(action, { index: 0, total }, speaker),
        },
      });
      return;
    }

    // A run always holds its parent receipt: `boxRoute` accepts one at the door.
    if (held === null) throw new Error("a confirmed broadcast reached its fan-out without a receipt");
    const parent = held;
    /* THE PARENT'S `attempted` BEFORE THE FIRST RECIPIENT, fail-closed when it
       was accepted durably: a crash mid fan-out must read, on restart, as an
       attempt that began — `outcome-unknown`/`interrupted` — never as a
       broadcast that was proven not to have started. */
    if (!attemptOrRefuse(res, parent, label)) return;
    const who = { actor: { kind: "unattributed-http", id: null } satisfies ReceiptActor, speaker };
    const childWhat = `action ${action.id}, one recipient`;

    const at = deps.now();

    let index = 0;
    /* `submitted`, NOT `sent`. It counts the rows whose tmux calls all
       completed, which is the strongest thing this route can count. */
    let submitted = 0;
    for (const rec of recipients) {
      const gate = gates.get(rec.target.paneId);
      if (gate?.kind !== "now") {
        outcomes.push(skippedOutcome(rec, gate));
        continue;
      }
      if (deps.now() - at > BROADCAST_DEADLINE_MS) {
        // Out of time. NOT an error, and not a silent stop: the rows we never
        // reached are named one by one, so nobody reads "broadcast sent" over
        // the top of sixteen agents who were told nothing.
        recordNotReached(parent, rec, who, childWhat, label);
        outcomes.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          minutes: null,
          outcome: "not-reached",
          code: null,
          why: `the broadcast ran out of time after ${Math.round((deps.now() - at) / 1000)}s and stopped before this row`,
        });
        continue;
      }
      /**
       * What this send is, for the coordinator — and therefore for the hold.
       *
       * **THE THIRD PRODUCER, AND IT IS THE SAME BOOK AS THE OTHER TWO.** A
       * fan-out that half-reached six agents used to leave six half-filled
       * input boxes and no record anywhere; the queue would then drain into
       * them one by one. The construction check at the top of this function is
       * what makes "the same book" a fact rather than a comment.
       *
       * **AND THE READING GOES THE OTHER WAY TOO**, which is the half this
       * route was missing: a recipient that is ALREADY held is not sent to at
       * all. Recipients used to be chosen on `drainGate` alone, so a broadcast
       * would type into every session the page was showing as quarantined.
       */
      const purpose: SendPurpose = {
        origin: "broadcast",
        what: `action ${action.id}`,
        onThrow: "hold",
        record: { kind: "book" },
      };
      const computedMinutes = staggerMinutes(index, total, action.stagger);
      const minutes = promisedMinutes.get(rec.target.paneId);
      if (minutes === undefined || minutes === null || minutes !== computedMinutes) {
        throw new Error(
          `stored preview ${r.mode === "run" ? asString(asRecord(r.preview)?.previewId) ?? "unknown" : "unknown"} promised ${String(minutes)} minutes ` +
            `for ${rec.target.paneId}, but the action now computes ${computedMinutes}`,
        );
      }
      // RENDERED HERE, ONE LINE ABOVE THE SEND. Not above the loop, not in the
      // parse, not in the queue.
      const text = renderBroadcast(action, { index, total }, speaker);
      index += 1;
      /* THIS RECIPIENT'S OWN RECEIPT, accepted and attempted on the line above
         its send, and settled on the line below it exactly as a direct steer
         is. No receipt, no send: the row says so, and `index` has already
         advanced, so the stagger keeps the gap it keeps for a held session. */
      const child = beginChild(parent, rec, who, childWhat, label);
      if (!child.ok) {
        outcomes.push({ paneId: rec.target.paneId, sessionId: rec.target.sessionId, minutes: null, outcome: "refused-before-effect", code: null, why: child.why });
        continue;
      }
      const attempt = deps.send.message(rec.target, text, rec.declaredStatus, purpose);
      settle({ receiptId: child.receiptId, tag: {} }, sendAttemptOutcome(attempt), label);
      if (attempt.hold !== null) {
        deps.log(
          `action box: HELD session=${rec.target.sessionId} hold=${attempt.hold.id} v${attempt.hold.version} ` +
            `reading=${attempt.hold.reading}`,
        );
      }
      if (attempt.kind === "held") {
        /* **NOTHING WAS TYPED AT THIS ONE.** It was already holding text
           nobody can account for, and a broadcast sentence landing behind half
           of somebody else's would be read by the agent as one instruction that
           neither person wrote.

           `held` is the existing arm for *not now*, and it is the right one
           here: `skippedOutcome` uses it for a session that is working. The
           sentence is what distinguishes them, and it is the hold's own.

           `minutes: null` and the gap it leaves in the stagger are deliberate.
           `index` has already advanced, so the remaining recipients keep the
           resume times they would have had — the alternative is renumbering a
           fan-out around a session that was told nothing, which would make the
           minutes depend on who happened to be held. */
        outcomes.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          minutes: null,
          outcome: "held",
          code: null,
          why: attempt.why,
        });
        continue;
      }
      if (attempt.kind === "threw") {
        /* **A THROW IS THE CASE WITH THE LEAST EVIDENCE BEHIND IT**, and it
           answered `refused` — the reading that says nothing reached them. The
           exception carries no `Delivery`, so the honest arm is the one that
           claims nothing either way.

           **AND THE `try` IS AROUND THE WHOLE CALL**, so it cannot say WHEN.
           `fire()` may throw out of the middle of a tmux sequence, and it may
           throw before the first keystroke — a bad target, a refused spawn.
           The sentence said *partway through the send*, which asserts the
           first and is false of the second. The hold above is the consequence,
           and the coordinator opened it. */
        outcomes.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          minutes,
          outcome: "outcome-unknown",
          code: null,
          why:
            `the delivery module threw while handling this recipient: ${attempt.error.message}. ` +
            "Nothing here can tell whether any of it reached the pane.",
        });
        continue;
      }
      const result = attempt.result;
      if (result.ok) {
        submitted += 1;
        outcomes.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          minutes,
          outcome: "keys-submitted",
          code: null,
          why: null,
        });
      } else {
        /* THE READING THE TRANSPORT ALREADY MADE, kept rather than flattened.
           `partial` is not `refused`: the text is in that agent's input box
           and the next Enter anybody presses submits it.

           **AND KEEPING THE WORD WAS NEVER THE WHOLE ANSWER.** The text is
           still in that box after this response has been drawn, so the session
           is held too — asked of `nothingWasSent`, which reads the `sent` list
           as well as the summary, rather than of `result.delivery` alone. That
           reading is the coordinator's now, and the HELD line above is logged
           from the hold it opened. */
        outcomes.push({
          paneId: rec.target.paneId,
          sessionId: rec.target.sessionId,
          minutes,
          outcome: DELIVERY_OUTCOME[result.delivery],
          code: result.reason.code,
          why: result.reason.why,
        });
      }
      // BETWEEN EVERY SEND, not at the end. Each one blocks this thread for as
      // long as tmux takes, and this is the only chance the poll, the stream and
      // every other route get while a fan-out is in progress.
      await deps.yieldToLoop();
    }
    // Counts and minutes, never a word of what was said.
    const unreached = outcomes.filter((x) => x.outcome === "not-reached").length;
    /* THE AMBIGUOUS ROWS GET THEIR OWN NUMBER IN THE JOURNAL. `told=30/36`
       over six sessions holding half a message is the line somebody reads a
       week later, and it must not be the only line. */
    const unsure = outcomes.filter((x) => x.outcome === "partial" || x.outcome === "outcome-unknown").length;
    deps.log(
      `action box: BROADCAST action=${action.id} speaker=${speaker} keys-submitted=${submitted}/${total} of ${recipients.length} rows` +
        (unsure > 0 ? ` (${unsure} may or may not have landed)` : "") +
        (unreached > 0 ? ` (ran out of time before ${unreached})` : ""),
    );
    settle(
      parent,
      { state: "completed", reason: "fan-out-finished", code: null, why: describeChildren(deps.queue.receiptJournal(), parent.receiptId) },
      label,
    );
    respond(res, 200, { ok: true, op: "broadcast", action: action.id, dryRun: false, result: { total, recipients: outcomes }, ...parent.tag });
  }

  function skippedOutcome(rec: Recipient, gate: DrainGate | undefined): BroadcastOutcome {
    if (gate?.kind === "later") {
      return { paneId: rec.target.paneId, sessionId: rec.target.sessionId, minutes: null, outcome: "held", code: null, why: gate.why };
    }
    if (gate?.kind === "never") {
      return {
        paneId: rec.target.paneId,
        sessionId: rec.target.sessionId,
        minutes: null,
        outcome: "blocked",
        code: gate.reason.code,
        why: gate.reason.why,
      };
    }
    return {
      paneId: rec.target.paneId,
      sessionId: rec.target.sessionId,
      minutes: null,
      outcome: "blocked",
      code: null,
      why: "this row was not classified, so nothing was sent to it",
    };
  }

  /* ---------------- shared plumbing ---------------- */

  /**
   * The CSRF triple, the body cap and the JSON parse, or a response already
   * sent. `null` means "answered, stop".
   */
  async function parsedBody(req: IncomingMessage, res: ServerResponse, limit: number): Promise<unknown | null> {
    const headerCheck = checkOrigin(req.headers);
    if (!headerCheck.ok) {
      deps.log(`action: refused code=${headerCheck.code} why=${headerCheck.why} ${who(req)}`);
      refuse(res, headerCheck.code, headerCheck.why);
      return null;
    }
    const body = await readBody(req as unknown as BodyStream, limit);
    if (!body.ok) {
      deps.log(`action: refused code=${body.code} bytes=${body.bytesRead}`);
      refuse(res, body.code, body.why);
      return null;
    }
    try {
      return JSON.parse(body.text) as unknown;
    } catch (e) {
      deps.log("action: refused code=bad-request why=not-json");
      refuse(res, "bad-request", `the body is not JSON: ${(e as Error).message}`);
      return null;
    }
  }

  return {
    drain(snapshot) {
      return drainOnce(snapshot, { queue: deps.queue, cursor: drainCursor, send: deps.send, log: deps.log, now: deps.now });
    },
    /* Straight through to the same queue the HTTP enqueue route fills. It does
       NOT repeat that route's `drainGate` refusal or its rate limiter: both of
       those are the HTTP caller's gate on a person tapping a button, and the
       broadcast route has made its own cut with the same `drainGate` before it
       gets here. What is not skipped is anything the queue itself enforces —
       `checkText`, `renderMessage`'s slash rule, the per-session and fleet
       caps, the double-tap window — because those live in `enqueueMessage`. */
    enqueueMessage(target, text, speaker, parentReceiptId = null) {
      return deps.queue.enqueueMessage(target, text, speaker, "broadcast", null, parentReceiptId);
    },
    handle(req, res) {
      const pathname = (req.url ?? "/").split("?")[0] ?? "/";
      if (pathname !== "/api/actions" && !pathname.startsWith("/api/actions/")) return false;
      const method = req.method ?? "GET";
      // Logged BEFORE anything can refuse it, so an attempt turned away at the
      // door still leaves a trace — a write path whose log records only the
      // successes is one you cannot investigate. Reads are NOT logged: the page
      // polls the catalogue, and a line per poll per phone would bury the write
      // lines this file exists to leave behind.
      if (method !== "GET" && method !== "HEAD") deps.log(`action ${method} ${pathname}: attempt ${who(req)}`);

      if (pathname === "/api/actions") {
        if (method !== "GET" && method !== "HEAD") {
          refuse(res, "method-not-allowed", "the catalogue and the queues are a GET", undefined, { allow: "GET" });
          return true;
        }
        catalogue(res);
        return true;
      }
      if (pathname === "/api/actions/receipts") {
        if (method !== "GET" && method !== "HEAD") {
          refuse(res, "method-not-allowed", "receipts are a read-only GET", undefined, { allow: "GET" });
          return true;
        }
        receipts(res);
        return true;
      }
      // Every write is a POST (cancel also takes DELETE, because that is what a
      // client naturally reaches for). A GET at any of these is a link somebody
      // sent or a browser prefetching, and neither may act.
      if (pathname === "/api/actions/session" || pathname === "/api/actions/box") {
        if (method !== "POST") {
          refuse(res, "method-not-allowed", "acting is POST only", undefined, { allow: "POST" });
          return true;
        }
        // Floating on purpose: `handler` in server.ts is synchronous, and these
        // cannot reject — every path inside them is caught below.
        void guard(pathname === "/api/actions/session" ? sessionRoute(req, res) : boxRoute(req, res), res);
        return true;
      }
      if (pathname === "/api/actions/cancel") {
        if (method !== "POST" && method !== "DELETE") {
          refuse(res, "method-not-allowed", "cancelling is POST or DELETE", undefined, { allow: "POST, DELETE" });
          return true;
        }
        void guard(cancelRoute(req, res), res);
        return true;
      }
      // The two recovery gestures. POST only, unlike cancel: neither is the
      // thing a client naturally reaches for a DELETE with, and both CHANGE an
      // item rather than removing one.
      if (pathname === "/api/actions/revive" || pathname === "/api/actions/abandon") {
        if (method !== "POST") {
          refuse(res, "method-not-allowed", "this is POST only", undefined, { allow: "POST" });
          return true;
        }
        void guard(pathname === "/api/actions/revive" ? reviveRoute(req, res) : abandonRoute(req, res), res);
        return true;
      }
      // POST only, though it removes things and cancel takes a DELETE for that
      // reason. This body is not addressed by its URL — it carries the whole
      // list of ids the person was looking at (`parseClearBody`) — and a DELETE
      // whose meaning lives entirely in its body is the awkward shape, not the
      // natural one.
      if (pathname === "/api/actions/clear") {
        if (method !== "POST") {
          refuse(res, "method-not-allowed", "clearing a queue is POST only", undefined, { allow: "POST" });
          return true;
        }
        void guard(clearRoute(req, res), res);
        return true;
      }
      // The fifth gesture, and the only one that is not about a queued item.
      // POST for `revive` and `abandon`'s reason: it changes a record rather
      // than removing one, and it must be safe to send twice.
      if (pathname === "/api/actions/hold/release") {
        if (method !== "POST") {
          refuse(res, "method-not-allowed", "releasing a hold is POST only", undefined, { allow: "POST" });
          return true;
        }
        void guard(releaseHoldRoute(req, res), res);
        return true;
      }
      // Ours by prefix and not a route. Claimed rather than returned false, so
      // nothing under web/dist/ can ever answer for a path in this namespace.
      refuse(res, "bad-request", `there is no action route at ${pathname}`);
      return true;
    },
  };

  /**
   * The one 5xx in the file. Only a bug reaches here — every expected failure
   * is a refusal with a code — and the response says `internal` so a client can
   * tell a broken server from a stale view.
   */
  async function guard(work: Promise<void>, res: ServerResponse): Promise<void> {
    try {
      await work;
    } catch (e) {
      const why = `the action route threw: ${(e as Error).message}`;
      deps.log(`action: FAILED ${why}`);
      try {
        refuse(res, "internal", why);
      } catch {
        /* the response was already sent; the log line is the record */
      }
    }
  }
}

/** What the confirmation dialog should say, from the catalogue rather than from here. */
function describeConfirm(action: Action): string {
  switch (action.effect) {
    case "enacted":
      return action.gate;
    case "broadcast":
      return `it speaks to every steerable session, each with its own resume time across ${action.stagger.windowMinutes} minutes`;
    case "spoken":
      return action.summary;
    default: {
      const never: never = action;
      return never;
    }
  }
}

/**
 * The mounted routes, built once, on first use rather than at import.
 *
 * Lazy because the queue and the rate limiter are STATE, and a module-scope one
 * would be built by anything that so much as imports a type from here — the
 * same reason `handleSteerRequest` is lazy next door.
 *
 * **The queue this builds is this module's own.** Anything that drains it must
 * be handed the same `SteeringQueue`; two instances would be two queues, and
 * the one the page can see would be the one nothing delivers from.
 */
let shared: ActionRoutes | null = null;

export function handleActionRequest(req: IncomingMessage, res: ServerResponse): boolean {
  shared ??= makeActionRoutes();
  return shared.handle(req, res);
}

/**
 * The refresh loop's way in, THROUGH THE SAME `shared` the routes answer from.
 *
 * Written exactly like `handleActionRequest` above, and for the reason in that
 * comment: two `SteeringQueue`s would be two queues, and the one the page can
 * see would be the one nothing delivers from. That is not a hypothetical — it
 * is the shape of the bug this stage exists to fix, one step further along.
 */
export function drainSharedQueues(snapshot: FleetSnapshot): DrainResult {
  shared ??= makeActionRoutes();
  return shared.drain(snapshot);
}

/**
 * **The broadcast route's way in, THROUGH THE SAME `shared` the routes answer
 * from.** The third instance of the decision the two comments above already
 * make: two `SteeringQueue`s would be two queues, and the one the page can see
 * would be the one nothing delivers from.
 *
 * Added on 2026-09-09 for `routes-broadcast.ts`, at that session's request and
 * with this file's owner's agreement. A free-text broadcast has to reach the
 * sessions that are WORKING — on this box that is most of them most of the
 * time, so a fan-out that could only type at sessions already at a prompt
 * reached about a third of the fleet while calling itself a broadcast to all
 * agents.
 *
 * **NARROW ON PURPOSE, and the narrowness is the whole design.** It would have
 * been one line shorter to export the queue. A broadcast route has no business
 * reaching `settle`, `release`, `revive` or the quarantine surface, and the
 * cheapest moment to decide that is before anything needs them.
 *
 * `text` is the RAW line and must stay raw. `enqueueMessage` calls
 * `renderMessage` only to apply the slash rule and to length-check *with* the
 * prefix — which counts towards the limit, so a message that fits raw can fail
 * rendered — and then pushes the raw parameter (`queue.ts:722`); `drain.ts:306`
 * renders again at delivery. Handing it an already-prefixed string prefixes it
 * twice, which reads as clumsy rather than as a bug and fails nothing.
 *
 * **`rule` TRAVELS, and narrowing it away was the first version of this
 * function.** `bad-text` is a fact about the MESSAGE — it will fail identically
 * for every recipient, so a fan-out to twenty sessions has one truth to report,
 * not twenty — while a queue cap or the double-tap window is a fact about THAT
 * recipient, and twenty of those really are twenty facts. A caller that cannot
 * tell them apart cannot render either honestly. Collapsing it is the
 * lossy-join half of docs/postmortems/260908b: the producer said the careful
 * thing and the consumer threw the distinction away.
 *
 * **AND SO DOES `durable`** — plan 260910d, the Stage 1b review's F36. This door
 * used to drop the queue's own `durable` bit, so a broadcast answered *queued*
 * for a recipient whose receipt lived only in this process's memory and would
 * not survive a restart. `receiptId` travels for the same reason: the item's
 * receipt is that recipient's child of the broadcast (`parentReceiptId`).
 */
export function enqueueSharedMessage(
  target: { sessionId: string; claudeSessionId: string },
  text: string,
  speaker: Speaker,
  parentReceiptId: string | null = null,
): { ok: true; position: number; durable: boolean; receiptId: string } | { ok: false; rule: EnqueueRefusalRule; why: string } {
  shared ??= makeActionRoutes();
  const result = shared.enqueueMessage(target, text, speaker, parentReceiptId);
  return result.ok
    ? { ok: true, position: result.position, durable: result.durable, receiptId: result.receiptId }
    : { ok: false, rule: result.rule, why: result.why };
}
