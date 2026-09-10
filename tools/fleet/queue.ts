/**
 * v0.5 of the fleet dashboard: one ordered queue per session, so that pressing
 * three buttons does not race.
 *
 * Greg, 2026-09-08: "ideally these would queue/steer if it's currently running,
 * so that one could press more than one, in combination with messages". The
 * direction doc calls "queue" the hard word in that sentence and it is right:
 * **an agent that is working cannot be typed at usefully.** Keystrokes sent to
 * a busy Claude Code do not queue themselves anywhere sensible — they land in
 * whatever the terminal is doing — so a dashboard that sends on click either
 * loses the message or interrupts the work, and pressing "pull" then "push"
 * delivers them in whichever order two HTTP handlers happen to finish.
 *
 * So this is the feature, not a nicety. What it buys:
 *
 *  - **order**, which is the whole reason enacted actions queue too. "Push,
 *    then remove the worktree" must not become "remove the worktree, then try
 *    to push": removing a worktree has an effect outside the conversation and
 *    could have run immediately, and running it immediately would delete work
 *    the queued push had not yet saved. Immediacy is worth less than order, so
 *    everything waits its turn. Killing something RIGHT NOW is deliberately not
 *    this queue's job — cancel the queue and call the action directly.
 *    **RETRACTED IN PART, 2026-09-08:** a session-scoped *enacted* action is now
 *    refused at enqueue time, so that ordering guarantee does not currently
 *    extend to one. The reasoning is on the refusal itself in `enqueueAction`,
 *    where whoever undoes it will be standing.
 *  - **one at a time**, because two messages delivered into the same input box
 *    in the same second are one message with the halves interleaved.
 *  - **visibility**, because a queue you cannot see is one that surprises you an
 *    hour later, which here means a sentence arriving in a conversation that has
 *    moved on.
 *
 * WHAT IT IS NOT. It does not deliver anything, does not import a transport,
 * and holds no timer: `next()` is asked, it never fires. The seam is
 * `next()` → the caller delivers → `settle()`. That shape is what makes the
 * whole machine drivable from a test with a fake clock and no waiting, and it
 * is also what keeps the delivery decision in steer.ts where it belongs.
 *
 * DURABILITY IS A PROPERTY OF THE INJECTED RECEIPT JOURNAL, AND THE SNAPSHOT
 * SAYS WHICH ONE IT HAS. A durable journal restores pinned work after a
 * dashboard restart; the memory journal remains deliberately fail-open and
 * carries `PERSISTENCE_WARNING`. A page that hides either warning is a bug:
 * quiet loss is exactly the failure docs/reusable/silent-success.md is about.
 *
 * THERE IS NO AUTOMATIC RETRY, ANYWHERE. A lease that is never settled becomes
 * `stuck` and waits for a person; it does not go back to the head of the queue.
 * From the wide review (A11): "Never auto-retry keystrokes." A retry cannot
 * know whether the first attempt's keys arrived, and a message delivered twice
 * to an agent is worse than one delivered none.
 *
 * **THE ONE CASE THAT ARGUMENT DOES NOT COVER, AND IT IS `release`.** The
 * sentence above turns on the words *cannot know*. `steer.ts` can, sometimes:
 * `SteerFailure` carries `delivery: "none" | "partial" | "unknown"` and a `sent`
 * list of the tmux calls that COMPLETED, and `delivery: "none"` with an empty
 * `sent` is a positive statement that no keystroke left this process — every
 * refusal in that file that fires before the send says so. Putting such an item
 * back is therefore not a retry of anything; nothing was tried. It matters
 * because without it the commonest refusal on this box — the pane started asking
 * a question in the thirteen seconds since the collection — DESTROYS the
 * person's instruction, one item per pass, at exactly the moment they most
 * wanted it delivered. `partial` and `unknown` are the genuinely ambiguous arms
 * and are still never put back. `release` refuses to be called without the
 * transport's own word for it: see `nothingWasSent`.
 */
import { actionById, renderMessage, type Speaker } from "./actions.js";
import { INSTANCE_TOKEN } from "./instance.js";
import type { HoldEvidence, QuarantineBook, QuarantineHoldView } from "./quarantine.js";
import type { ReceiptActor, ReceiptJournal, ReceiptOrigin } from "./receipt-journal.js";
import type { FleetStatus } from "./status.js";
import { checkText, steerableStatus, type Refusal, type SteerFailure } from "./steer.js";
/* A queued item is on the wire verbatim (`{...i, stale, stuck}` in
   routes-actions.ts spreads every field of it), so its shape lives in wire.ts
   where the browser can import it too. Re-exported so `from "./queue.js"` keeps
   working for the twenty-odd call sites. */
import type { QueuedItem, QueuedPayload } from "./wire.js";

export type { QueuedItem, QueuedPayload } from "./wire.js";

/* ------------------------------------------------------------------ *
 * What can be queued — `QueuedPayload` and `QueuedItem`, now in wire.ts and
 * re-exported above, because the browser reads both off the wire.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Bounds.
 * ------------------------------------------------------------------ */

export type QueueLimits = {
  /** Per session. An unbounded queue is a way to accidentally send twenty messages. */
  maxPerSession: number;
  /** Across the fleet, so one runaway caller cannot fill memory with thirty-six queues. */
  maxTotal: number;
  /** An identical payload pressed again inside this window is a double tap, not an intention. */
  doubleTapMs: number;
  /**
   * How long an item may wait before it must be re-armed by hand.
   *
   * The single most valuable guard here, and the reason the clock is injected.
   * Thirty minutes is long enough for a session to finish a stage and short
   * enough that "run the checks" does not arrive at an agent that has since
   * pushed, been told something else, and started a different job. A stale item
   * is NOT deleted — it stays in the snapshot marked stale, and `revive()` puts
   * it back in play, so nothing is lost quietly.
   */
  maxAgeMs: number;
  /** A lease unsettled for longer than this is stuck. It is never retried. */
  leaseMs: number;
};

export const DEFAULT_LIMITS: QueueLimits = {
  maxPerSession: 8,
  maxTotal: 64,
  doubleTapMs: 5_000,
  maxAgeMs: 30 * 60_000,
  leaseMs: 60_000,
};

export const PERSISTENCE_WARNING =
  "Queued items live in the fleet server's memory. Restarting it discards every one of them; nothing here is written to disk.";

export const DURABLE_PERSISTENCE_WARNING =
  "Queued items are written down and survive a restart of the dashboard, unless the tmux server changes or they go stale.";

/* ------------------------------------------------------------------ *
 * When may this queue drain?
 * ------------------------------------------------------------------ */

export type DrainGate =
  /** Deliver now. */
  | { kind: "now" }
  /** Not now, but plausibly soon. The queue keeps its items and waits. */
  | { kind: "later"; why: string }
  /** Not into this session at all, in steer.ts's own words. */
  | { kind: "never"; reason: Refusal };

/**
 * Is this the moment?
 *
 * **`steerableStatus` already decides whether a session may be typed into at
 * all, and this must not decide it a second time differently.** So every
 * refusal reason below comes back out of that function rather than being
 * written here: `waiting` is refused because a job script is on a `sleep` and
 * Claude is not running yet, `shell` because the text would be EXECUTED,
 * `no-claude` because it has exited, `unknown` because the agents call failing
 * turns every Claude row unknown at once. Those sentences live in one place.
 *
 * What this adds is the one thing that function does not answer: `working` is
 * steerable in principle — the pane is a live Claude — and is exactly the state
 * in which the keystrokes go somewhere useless. So `working` is the `later`
 * arm, and it is the arm the whole queue exists for.
 *
 * The switch is exhaustive over `FleetStatus` with a `never`, so an eighth
 * status arm stops this compiling. The two branches then agree with
 * `steerableStatus` by ASKING it rather than by matching lists: if it ever
 * starts permitting a status this file has no rule for, the second branch
 * refuses loudly with a message naming the drift, instead of silently
 * disagreeing. tests/fleet-queue.test.ts checks the two functions agree across
 * every status.
 */
export function drainGate(status: FleetStatus): DrainGate {
  switch (status.kind) {
    case "idle":
    case "needs-you":
    case "working": {
      const refusal = steerableStatus(status);
      if (refusal) return { kind: "never", reason: refusal };
      if (status.kind === "working") {
        return {
          kind: "later",
          why: "it is working, and keystrokes sent to a busy Claude do not queue themselves anywhere useful",
        };
      }
      return { kind: "now" };
    }
    case "waiting":
    case "no-claude":
    case "shell":
    case "unknown": {
      const refusal = steerableStatus(status);
      if (refusal) return { kind: "never", reason: refusal };
      // steer.ts has started permitting a status this queue has no rule for.
      // Refuse and say so: inventing a rule here is how the two drift apart.
      return {
        kind: "never",
        reason: {
          code: "declared-not-steerable",
          why: `steer.ts now permits '${status.kind}' but drainGate has no rule for it — decide there and here together`,
        },
      };
    }
    default: {
      const never: never = status;
      return never;
    }
  }
}

/**
 * May something be delivered into this session RIGHT NOW?
 *
 * **THIS IS A DIFFERENT QUESTION FROM `drainGate`, AND THE DIFFERENCE COST AN
 * INSTRUCTION.** `steerableStatus` answers "may this session be steered at
 * all", and `drainGate` is built on it, which is right for what `drainGate` is
 * for: the enqueue route uses it to refuse an item that could never drain, and
 * there `needs-you` really is a session you may queue for. Used to decide
 * whether to hand an item to `sendMessage` it is WRONG, because `sendMessage`
 * refuses a pane that is showing a dialog (`pane-is-asking`) — so the drain
 * leased the item, the send refused it, and the person's message was destroyed
 * at the moment they most wanted it delivered. Found by GPT Sol, 2026-09-08,
 * before it ever ran.
 *
 * So the ONE difference is `needs-you`, and it is `later` rather than `never`:
 * the agent will stop asking eventually and the instruction should go then.
 * Refusing it permanently would lose the item just as surely, more slowly.
 *
 * Everything else is `drainGate`'s answer, obtained by asking it rather than by
 * copying its list, so the two cannot drift into disagreeing about a status
 * neither of them names. tests/fleet-queue.test.ts asserts they agree on every
 * status except that one.
 */
export function deliveryGate(status: FleetStatus): DrainGate {
  switch (status.kind) {
    case "needs-you":
      return {
        kind: "later",
        why: "it is asking you a question, and a message typed at a dialog would answer it rather than arrive as a message",
      };
    // Written out one per line rather than as a `default`, so an eighth
    // `FleetStatus` stops this compiling too and somebody decides whether it
    // may be DELIVERED to — not only whether it may be queued for. The two
    // questions have already been confused once.
    case "idle":
    case "working":
    case "waiting":
    case "no-claude":
    case "shell":
    case "unknown":
      return drainGate(status);
    default: {
      const never: never = status;
      return never;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Results.
 * ------------------------------------------------------------------ */

export type EnqueueRefusalRule =
  /** The ids are not shaped like a tmux handle and a Claude uuid. */
  | "bad-target"
  /** `checkText` refused the message — empty, multi-line, a control character, too long. */
  | "bad-text"
  /** No such action id. */
  | "no-such-action"
  /** A box-wide action does not belong in one session's queue. */
  | "wrong-scope"
  /** An action that runs commands rather than typing a sentence. Nothing drains those. */
  | "enacted-not-deliverable"
  | "session-queue-full"
  | "fleet-queue-full"
  /** The same thing, pressed again within the double-tap window. */
  | "double-tap"
  /** The journal's non-terminal admission cap was reached. */
  | "receipt-capacity"
  /**
   * A KEYED enqueue whose `accepted` could not land durably. Refused rather
   * than queued in memory: a key promises that a retry after a lost response
   * finds the first one, and a receipt only this process remembers cannot keep
   * that promise across a restart. Plan 260910d § Write-ahead, the first write.
   */
  | "receipt-unavailable";

/** The idempotency key a caller checked before asking — `request-key.ts`. */
export type EnqueueRequestKey = { requestId: string; fingerprint: string };

export type EnqueueResult =
  | { ok: true; item: QueuedItem; position: number; durable: boolean; receiptId: string }
  | { ok: false; rule: EnqueueRefusalRule; why: string };

export type NextResult =
  /** Nothing waiting. */
  | { kind: "empty" }
  /** Something is out for delivery and has not been settled. One at a time. */
  | { kind: "in-flight"; item: QueuedItem; why: string }
  /**
   * A delivery was started and never settled. **Not retried** — a person
   * decides, with `settle(…, "abandoned")`, because nothing here can tell a
   * request that died before sending from one that died after.
   */
  | { kind: "stuck"; item: QueuedItem; why: string }
  /** The pane holds a different conversation now. The item waits for a person. */
  | { kind: "orphaned"; head: QueuedItem; why: string }
  /** It has waited too long to be sent unasked. `revive()` re-arms it. */
  | { kind: "stale"; head: QueuedItem; why: string }
  /** The session is working. Come back. */
  | { kind: "held"; head: QueuedItem; why: string }
  /**
   * A send to this session came back with no honest account of where it got
   * to, so text may be sitting in its input box unsent. **Nothing goes in
   * behind it until a person says what is there** — see quarantine.ts.
   *
   * A separate arm rather than a `blocked` with a made-up `Refusal`, because
   * it is a fact about a PREVIOUS SEND rather than about the session, the page
   * offers two gestures for it that no other arm has, and folding it into
   * `held` would tell somebody it was going out shortly.
   */
  | { kind: "quarantined"; head: QueuedItem; hold: QuarantineHoldView; why: string }
  /** This session cannot be typed into at all, in steer.ts's words. */
  | { kind: "blocked"; head: QueuedItem; reason: Refusal }
  /** Leased. Deliver it, then `settle`. */
  | { kind: "ready"; item: QueuedItem };

/**
 * What happened to a leased item. **All four remove it**; none requeues.
 *
 *  - `delivered` — the send returned ok.
 *  - `refused` — the send returned a refusal. It is not retried: the refusals
 *    steer.ts returns are about the box being different from the page, and
 *    firing the same keys again a moment later is how a message ends up in the
 *    wrong session.
 *  - `uncertain` — the send returned a refusal that **may still have put text
 *    in the input box**: `partial`, `unknown`, or a `none` the transport's own
 *    `sent` list contradicts. Written by `quarantineLeased` and by nothing
 *    else, because the item leaving and the session being held have to happen
 *    together — see that method.
 *  - `abandoned` — nobody knows. Used to clear a `stuck` lease.
 *
 * **`uncertain` EXISTS BECAUSE `refused` WAS A LIE ABOUT A THIRD OF THEM.**
 * `drain.ts` settled every non-`none` refusal as `refused`, and *refused* reads
 * as *nothing reached them* — the opposite of what a `partial` means. The
 * behaviour was right and only the word was wrong; this is the word.
 */
export type SettleOutcome = "delivered" | "refused" | "uncertain" | "abandoned";

export type SettleResult = { ok: true; item: QueuedItem; outcome: SettleOutcome } | { ok: false; why: string };

/**
 * A refusal that PROVABLY sent nothing, and the only thing `release` accepts.
 *
 * **THE BRAND IS WHAT MAKES THE SENTENCE BELOW TRUE.** This used to be the
 * plain intersection `SteerFailure & { delivery: "none" }`, with a comment
 * saying the type could only be obtained from `nothingWasSent` — and that was
 * false, because an ordinary structural intersection is satisfied by any object
 * literal with the right two fields, so a caller could write one and skip the
 * audit entirely (GPT Sol's D5, 2026-09-08). A comment claiming a guarantee the
 * type does not give is worse than no comment.
 *
 * `UNSENT` is a `declare const` of a unique symbol: there is no runtime value
 * for it anywhere, and it is not exported, so no code outside this module can
 * name the property — the only way to obtain the type is the assertion inside
 * `nothingWasSent`, which is one audited place rather than a rule everybody has
 * to remember.
 *
 * **WHAT IT STILL DOES NOT DO.** The evidence is not tied to the ITEM or to the
 * attempt it came from, so a caller holding a genuine "none sent" from attempt A
 * could hand it to `release` for attempt B, which had partly sent — a duplicate
 * delivery, the thing this file's header forbids. The present call site
 * (`deliverOne`) pairs them correctly and is the only one. Closing that would
 * mean an attempt token minted per `next()` and threaded through the transport,
 * which is a bigger change than a review fix, and it is written down here rather
 * than fixed so the next person can decide with the cost in front of them.
 */
declare const UNSENT: unique symbol;

export type UnsentFailure = SteerFailure & { delivery: "none"; readonly [UNSENT]: true };

/**
 * The transport's own word that no keystroke left this process, or null.
 *
 * BOTH HALVES ARE CHECKED, not just the flag. `delivery` is a summary and
 * `sent` is the evidence — the exact argv of every tmux call that COMPLETED —
 * and if they ever disagree, the honest reading is the one that assumes
 * something went out. A `delivery: "none"` with a non-empty `sent` is a bug in
 * steer.ts, and this returns null for it rather than acting on the summary.
 */
export function nothingWasSent(failure: SteerFailure): UnsentFailure | null {
  if (failure.delivery !== "none") return null;
  if (failure.sent.length > 0) return null;
  return failure as UnsentFailure;
}

export type ReleaseResult = { ok: true; item: QueuedItem } | { ok: false; why: string };

export type ReceiptMutationRefusal = { ok: false; rule: "receipt-unavailable"; why: string };
export type CancelResult =
  | { ok: true; item: QueuedItem }
  | ReceiptMutationRefusal
  | { ok: false; rule: "no-such-item" | "in-flight"; why: string };
export type ClearResult =
  | { ok: true; removed: QueuedItem[]; keptInFlight: QueuedItem | null }
  | ReceiptMutationRefusal;
export type BeginDeliveryResult = { ok: true } | ReceiptMutationRefusal | { ok: false; rule: "not-leased"; why: string };
export type NoteThrewResult = { ok: true } | { ok: false; why: string };

/**
 * Everything a page needs to render one queue — including the fact that it is
 * volatile, which is why that is on the snapshot rather than in a doc.
 */
export type QueueSnapshot = {
  sessionId: string;
  items: readonly QueuedItem[];
  /** Whether accepted queue state is currently memory-only. */
  volatile: boolean;
  warning: string;
  /** When this queue's server process started; restored items may predate it. */
  since: number;
  /**
   * The hold stopping this session from being drained, or null.
   *
   * On the snapshot rather than on a feed of its own for the reason `volatile`
   * is: it is a fact about whether this queue is going anywhere, and a caller
   * that has the items but not this would draw a list of things about to
   * happen that nothing is going to do.
   */
  quarantine: QuarantineHoldView | null;
};

/* ------------------------------------------------------------------ *
 * The queue.
 * ------------------------------------------------------------------ */

const SESSION_HANDLE = /^\$\d+$/;
const CLAUDE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An item the tmux generation has killed, narrowed so its sentence is a
 * `string` rather than a `string | null` nobody can read without a `??`.
 */
type InvalidatedItem = QueuedItem & { invalidated: string };

function isInvalidated(item: QueuedItem): item is InvalidatedItem {
  return item.invalidated !== null;
}

/** The same thing pressed twice? Compared by identity, not by rendered text. */
export function samePayload(a: QueuedPayload, b: QueuedPayload): boolean {
  if (a.kind === "action" && b.kind === "action") return a.action.id === b.action.id;
  if (a.kind === "message" && b.kind === "message") return a.text.trim() === b.text.trim();
  return false;
}

export type QueueOptions = {
  /** Injected, always. There is no `Date.now()` anywhere below. */
  now: () => number;
  /**
   * Which run of the server this queue belongs to — `instance.ts`.
   *
   * **INJECTED FOR THE SAME REASON `now` IS, and it is not a style choice.**
   * The tests have to build two queues with two different ids in one process
   * to prove that an id from a dead run is refused by a live one; a queue that
   * reached for a module-level global would make that test unwritable, and the
   * refusal would then be guarded by nothing.
   */
  serverInstanceId: string;
  /**
   * The one book of per-session holds — `quarantine.ts`.
   *
   * **REQUIRED, AND DELIBERATELY NOT DEFAULTED.** A default would construct a
   * private book for a queue whose sends are recorded in the shared one, and
   * nothing would ever go wrong loudly: the direct steer route would open holds
   * that this queue never consults, and items would go on draining into an
   * input box we had already said we did not understand. That is the
   * missing-join failure this whole file's neighbourhood keeps writing
   * postmortems about (docs/postmortems/260908b), so it is a compile error
   * instead.
   */
  quarantine: QuarantineBook;
  /**
   * The journal which owns the durable identity and material for every item.
   *
   * Required for `quarantine`'s reason above: a private or implicit journal
   * would let the queue acknowledge work which startup never opens again.
   */
  receipts: ReceiptJournal;
  limits?: Partial<QueueLimits>;
};

/**
 * Which run of the server minted an item id — as far as this queue can tell.
 *
 * Three arms rather than a boolean, because the third one is a real and
 * different answer. An id that does not carry a run at all (`q1` from before
 * ids were qualified, something hand-typed, something truncated) is **not
 * evidence of a previous server**, and saying it was would swap one false
 * statement for another. The routes let that arm fall through to their existing
 * "no such item".
 */
export type IdOrigin = "this-instance" | "other-instance" | "not-instance-qualified";

/**
 * What separates the run from the number in an item id.
 *
 * **SAFE BECAUSE THE TOKEN IS LOWERCASE HEX** (`INSTANCE_TOKEN` in
 * instance.ts), so it cannot itself contain a `-`: the FIRST `-` in a qualified
 * id is always the boundary, whatever the half after it turns out to be. The
 * client never needs to know any of this — it stores whatever string it was
 * given and hands it back — but the parse below is what makes the refusal
 * trustworthy, so the reason it cannot be ambiguous is written down beside it.
 */
const ID_SEPARATOR = "-";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Unsafe integer suffixes stay reserved but never poison the mint sequence. */
function currentRunItemSuffix(itemId: string, runId: string): number | null {
  const match = new RegExp(`^${escapeRegExp(runId)}-q([0-9]+)$`).exec(itemId);
  if (match?.[1] === undefined) return null;
  const suffix = Number(match[1]);
  return Number.isSafeInteger(suffix) && suffix >= 0 && suffix < Number.MAX_SAFE_INTEGER ? suffix : null;
}

/**
 * One `SteeringQueue` per fleet server, holding one ordered list per session.
 *
 * A class rather than a module of functions because there is per-server mutable
 * state and exactly one of it, and a module-level `Map` would be shared by
 * every test in the file — which is the shape that produces a suite that passes
 * alone and fails in a batch.
 */
export class SteeringQueue {
  private readonly now: () => number;
  /**
   * The run of the server every id below is stamped with.
   *
   * Public so a refusal can name it: "this server is 0badcafe" is what turns
   * *no such item* into *that was a previous server*.
   */
  readonly serverInstanceId: string;
  private readonly limits: QueueLimits;
  /**
   * The per-session holds. **The first per-session state this class has had**
   * that is not an item list, and it is held rather than owned: three producers
   * write to it and only one of them is anywhere near a queue.
   */
  private readonly quarantine: QuarantineBook;
  private readonly receipts: ReceiptJournal;
  private readonly bySession = new Map<string, QueuedItem[]>();
  /** Durable identity stays private; `QueuedItem` remains the established wire shape. */
  private readonly receiptByItem = new Map<string, string>();
  /** Only these items receive the first-observation restart generation guard. */
  private readonly restoredGeneration = new Map<string, number | null>();
  /** Every retained id, including terminal receipts, is unavailable for minting. */
  private readonly reservedItemIds: Set<string>;
  private seq = 0;
  private readonly startedAt: number;
  /**
   * The tmux server every `$…` in this queue belongs to, or null until the
   * first drain pass tells us. See `noteGeneration`.
   */
  private generation: number | null = null;

  constructor(options: QueueOptions) {
    this.now = options.now;
    this.serverInstanceId = options.serverInstanceId;
    this.quarantine = options.quarantine;
    this.receipts = options.receipts;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.startedAt = options.now();
    this.reservedItemIds = new Set(options.receipts.reservedQueueItemIds());
    for (const itemId of this.reservedItemIds) {
      const suffix = currentRunItemSuffix(itemId, this.serverInstanceId);
      if (suffix !== null) this.seq = Math.max(this.seq, suffix);
    }
  }

  /** The book this queue consults, for whoever has to draw or release a hold. */
  quarantineBook(): QuarantineBook {
    return this.quarantine;
  }

  /** The journal this queue owns, for the receipt read route and composition checks. */
  receiptJournal(): ReceiptJournal {
    return this.receipts;
  }

  /* ---------------- reading ---------------- */

  snapshot(sessionId: string): QueueSnapshot {
    const volatile = !this.receipts.durable();
    return {
      sessionId,
      items: [...(this.bySession.get(sessionId) ?? [])],
      volatile,
      warning: volatile ? PERSISTENCE_WARNING : DURABLE_PERSISTENCE_WARNING,
      since: this.startedAt,
      quarantine: this.quarantine.holding(sessionId),
    };
  }

  /**
   * Every queue there is anything to say about.
   *
   * **ITEMS *OR* A HOLD, AND THE SECOND HALF IS NEW.** This used to be
   * `items.length > 0`, which made the commonest hold invisible: one message is
   * queued, the send comes back `partial`, the item settles `uncertain` and
   * leaves, and what remains is a session nothing may be sent to and no queue
   * at all. A page cannot offer a release gesture for a hold it was never told
   * about, and a hold that outlives every gesture that could clear it is the
   * worst thing in this design.
   */
  snapshots(): QueueSnapshot[] {
    const out: QueueSnapshot[] = [];
    const said = new Set<string>();
    for (const [sessionId, items] of this.bySession) {
      if (items.length === 0) continue;
      said.add(sessionId);
      out.push(this.snapshot(sessionId));
    }
    for (const sessionId of this.quarantine.heldSessions()) {
      if (said.has(sessionId)) continue;
      out.push(this.snapshot(sessionId));
    }
    return out;
  }

  size(sessionId: string): number {
    return this.bySession.get(sessionId)?.length ?? 0;
  }

  totalSize(): number {
    let n = 0;
    for (const items of this.bySession.values()) n += items.length;
    return n;
  }

  /** Is this item past `maxAgeMs`? Exposed so a page can grey it out. */
  isStale(item: QueuedItem): boolean {
    return item.leasedAt === null && this.now() - item.enqueuedAt > this.limits.maxAgeMs;
  }

  /**
   * Is this lease one nobody settled — out longer than `leaseMs`?
   *
   * **THE ONE RULE, ASKED RATHER THAN COPIED.** `next()` uses this for its
   * `stuck` arm and the abandon route uses it to decide whether a person may
   * clear a lease, so the page cannot come to think an item is recoverable a
   * moment before the queue would still call it in flight. Clearing a lease
   * that is genuinely still going out is the one thing the open lease exists to
   * prevent (drain.ts's `deliverOne`), which is why this is not a second
   * comparison written next to a route.
   */
  isStuck(item: QueuedItem): boolean {
    return item.leasedAt !== null && this.now() - item.leasedAt > this.limits.leaseMs;
  }

  /**
   * Which run of the server minted this id — ours, somebody else's, or nobody's.
   *
   * **ASKED OF THE QUEUE RATHER THAN COMPARED AT FOUR ROUTES**, for the reason
   * `isStuck` is: the queue owns the shape of an id, and four copies of a
   * string comparison would drift from it the moment the shape changes. The
   * routes ask; the answer, and the sentence a person reads, come from here.
   *
   * The parse is deliberately conservative. It splits at the FIRST separator —
   * safe because the token is lowercase hex, see `ID_SEPARATOR` — and then
   * demands the token actually LOOK like a run before believing the prefix is
   * one. So a garbled id reports `not-instance-qualified` and the caller says
   * "no such item", which is the honest thing to say about a string nothing
   * ever minted.
   */
  idOrigin(itemId: string): IdOrigin {
    const at = itemId.indexOf(ID_SEPARATOR);
    if (at < 0) return "not-instance-qualified";
    const token = itemId.slice(0, at);
    if (!INSTANCE_TOKEN.test(token)) return "not-instance-qualified";
    return token === this.serverInstanceId ? "this-instance" : "other-instance";
  }

  /**
   * Could this item still reach a pane?
   *
   * Two things make an item permanently undeliverable without removing it from
   * the list: `invalidated` (the tmux generation changed, and `next()` now skips
   * past those) and `isStale` (past `maxAgeMs`, and only a person's `revive()`
   * re-arms it). Both are drawn, because the sentence on them is the point.
   *
   * **IT IS A RULE RATHER THAN A COUNT ON THE PAGE**, for the reason `isStale`
   * is: the page asks whether anything is already ahead of a new message before
   * it offers Queue on an idle session, and a component that answered that from
   * `items.length` would be offering an ordering guarantee over items nothing
   * will ever deliver. A leased item counts — in flight or stuck, it is ahead of
   * whatever is queued behind it.
   */
  isDeliverable(item: QueuedItem): boolean {
    return item.invalidated === null && !this.isStale(item);
  }

  /** How many of one session's items could still go out. `isDeliverable`, counted. */
  deliverableCount(sessionId: string): number {
    return (this.bySession.get(sessionId) ?? []).filter((i) => this.isDeliverable(i)).length;
  }

  /* ---------------- writing ---------------- */

  /** Rebuild every sendable receipt once, under the id it originally owned. */
  restore(): number {
    let restored = 0;
    for (const saved of this.receipts.restorable()) {
      if ([...this.receiptByItem.values()].includes(saved.receiptId)) continue;
      if (this.findItem(saved.queue.itemId) !== null) continue;
      const claudeSessionId = saved.target.claudeSessionId;
      if (claudeSessionId === null) {
        this.receipts.outcome(saved.receiptId, {
          state: "not-sent",
          reason: "lost-at-restart",
          code: null,
          why: "the restored queued receipt did not name a Claude conversation",
        });
        continue;
      }
      const payload: QueuedPayload =
        saved.material.kind === "message"
          ? { kind: "message", text: saved.material.text }
          : { kind: "action", action: saved.material.action };
      const item: QueuedItem = {
        id: saved.queue.itemId,
        sessionId: saved.target.sessionId,
        claudeSessionId,
        payload,
        speaker: saved.material.speaker,
        enqueuedAt: saved.queue.enqueuedAt,
        leasedAt: null,
        invalidated: null,
      };
      const items = this.bySession.get(item.sessionId) ?? [];
      items.push(item);
      items.sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id));
      this.bySession.set(item.sessionId, items);
      this.reservedItemIds.add(item.id);
      this.receiptByItem.set(item.id, saved.receiptId);
      this.restoredGeneration.set(item.id, saved.tmuxGeneration);
      restored += 1;
    }
    return restored;
  }

  /** Exact live-item lookup; restored foreign-run ids remain valid gestures. */
  findItem(itemId: string): QueuedItem | null {
    for (const items of this.bySession.values()) {
      const item = items.find((candidate) => candidate.id === itemId);
      if (item !== undefined) return item;
    }
    return null;
  }

  /**
   * Put an action at the back of a session's queue.
   *
   * The action arrives as an ID, not as an object, because this is where a JSON
   * body from a browser lands: `actionById` is the only way in, so a caller
   * cannot invent an action with different words in it.
   */
  enqueueAction(
    target: { sessionId: string; claudeSessionId: string },
    actionId: string,
    speaker: Speaker,
    origin: ReceiptOrigin = "enqueue",
    request: EnqueueRequestKey | null = null,
  ): EnqueueResult {
    const action = actionById(actionId);
    if (!action) return { ok: false, rule: "no-such-action", why: `there is no action called '${actionId}'` };
    if (action.scope !== "session") {
      // A broadcast or a box-wide kill has no single session to be ordered
      // against. Queuing one per session would send it thirty-six times, or
      // stagger it against the wrong denominator.
      return { ok: false, rule: "wrong-scope", why: `'${action.id}' is a box-wide action and does not belong in one session's queue` };
    }
    // WHAT MAY BE QUEUED IS DECIDED HERE, which is why this refusal lives next
    // to `wrong-scope` rather than in the route: whoever comes to delete it
    // should find it beside the rule it contradicts — the header's argument,
    // two paragraphs up, that enacted actions queue *for ordering*.
    //
    // That argument is right and this is a retreat from it, recorded rather
    // than quietly dropped (2026-09-08). Delivering an enacted item means
    // running a plan of `execFile`s that deletes a directory, from inside the
    // refresh loop — the one code path whose failure takes the dashboard down
    // with it — and that surface is the least-reviewed in the tool, which is
    // exactly why `FLEET_ACT_ENABLED` is off. Ordering across a spoken action
    // and a destructive one is worth less than not running `git worktree
    // remove` from an unreviewed loop.
    //
    // **UNCONDITIONAL, not gated on that flag.** A refusal conditional on it
    // would re-create the silent promise the day somebody turns it on: the
    // queue would start accepting items that still nothing drains. When the
    // drain learns to run plans, this is the first thing to delete.
    //
    // **THE NARROWING IS THE REAL GUARD.** `QueuedPayload` holds a
    // `SpokenAction`, so this is not one check that could be forgotten
    // somewhere else: an enacted action cannot be represented as a queued item
    // at all, and the drain has no branch for one because it cannot compile a
    // branch for a case that cannot exist.
    if (action.effect !== "spoken") {
      return {
        ok: false,
        rule: "enacted-not-deliverable",
        why: `'${action.id}' runs commands on the box rather than typing a sentence, and nothing delivers a queued one — dry-run it to see what it would do, then run it with a confirm`,
      };
    }
    return this.push(target, { kind: "action", action }, speaker, origin, request);
  }

  /**
   * Put a free-text message at the back of a session's queue.
   *
   * `checkText` is steer.ts's, called here so that a message which could never
   * be delivered is refused while somebody is looking at it, rather than
   * failing silently at the head of the queue twenty minutes later. It is the
   * same function the send will use, so the two cannot disagree about what a
   * sendable message is.
   *
   * **AND IT IS ASKED ABOUT THE WORDS THAT WILL ACTUALLY BE TYPED**, which are
   * not the words that were typed in: the line naming the speaker is added at
   * delivery and counts towards the 4000-character limit. Checking the raw text
   * here and the rendered text at the send is exactly the disagreement the
   * paragraph above says cannot happen — a 3,900-character message would be
   * accepted, queued, promised, and refused twenty minutes later for a length
   * nobody could see.
   */
  enqueueMessage(
    target: { sessionId: string; claudeSessionId: string },
    text: string,
    speaker: Speaker,
    origin: ReceiptOrigin = "enqueue",
    request: EnqueueRequestKey | null = null,
  ): EnqueueResult {
    const bad = checkText(text);
    if (bad) return { ok: false, rule: "bad-text", why: bad.why };
    // THE SAME FUNCTION THE DELIVERY WILL CALL, asked here so that a message
    // this speaker may not send is refused while somebody is looking at it —
    // the argument `checkText` is called for one line up. `renderMessage`
    // refuses a slash command from anyone but Greg (see its header); the drain
    // asks again at delivery, and that second ask is the structural one.
    const rendered = renderMessage(text, speaker);
    if (!rendered.ok) return { ok: false, rule: "bad-text", why: rendered.why };
    const afterPrefix = checkText(rendered.text);
    if (afterPrefix) {
      return {
        ok: false,
        rule: "bad-text",
        why: `${afterPrefix.why} — the line saying who is speaking is added when it goes out, and counts towards that`,
      };
    }
    return this.push(target, { kind: "message", text }, speaker, origin, request);
  }

  private push(
    target: { sessionId: string; claudeSessionId: string },
    payload: QueuedPayload,
    speaker: Speaker,
    origin: ReceiptOrigin,
    request: EnqueueRequestKey | null,
  ): EnqueueResult {
    if (!SESSION_HANDLE.test(target.sessionId)) {
      return { ok: false, rule: "bad-target", why: `'${target.sessionId}' is not a tmux session handle` };
    }
    if (!CLAUDE_UUID.test(target.claudeSessionId)) {
      return { ok: false, rule: "bad-target", why: "the expected Claude session id is not a session id" };
    }
    const items = this.bySession.get(target.sessionId) ?? [];
    if (items.length >= this.limits.maxPerSession) {
      return { ok: false, rule: "session-queue-full", why: `this session already has ${items.length} items queued, which is the limit` };
    }
    if (this.totalSize() >= this.limits.maxTotal) {
      return { ok: false, rule: "fleet-queue-full", why: `${this.limits.maxTotal} items are queued across the fleet, which is the limit` };
    }
    const at = this.now();
    // A double tap is a phone problem, not a mistake in the vocabulary: two taps
    // on "Continue" a second apart is one intention. Bounded in TIME rather than
    // forbidden outright, so deliberately queuing the same action twice — "run
    // the checks, then run them again after the merge" — still works.
    const twin = items.find((i) => samePayload(i.payload, payload) && at - i.enqueuedAt < this.limits.doubleTapMs);
    if (twin) {
      return { ok: false, rule: "double-tap", why: `the same thing was queued ${at - twin.enqueuedAt}ms ago; press again in a moment if you meant it` };
    }

    // **`q1` USED TO COME ROUND AGAIN EVERY TIME THIS PROCESS RESTARTED**, and
    // nothing noticed: a phone left open across a restart could cancel, re-arm,
    // abandon or clear a DIFFERENT `q1` from the one it was showing, and get a
    // 200 for it. Measured before it was fixed, 2026-09-08: a dead run's `q1`
    // (a `pull`) posted at a fresh run removed that run's `q1`, which was a
    // `push`, and answered `{"ok":true,"op":"cancelled"}`.
    //
    // **THE QUEUE BEING VOLATILE IS NOT THE PROTECTION IT LOOKS LIKE.** A
    // restart does empty it — and then the very next enqueue starts the counter
    // again and re-issues the same names to different work, which is the state
    // a phone actually meets. So the run is part of the id, `idOrigin` reads it
    // back, and the four routes that accept an id from a client refuse a
    // foreign one by name rather than reporting it as absent.
    let itemId: string;
    do {
      if (this.seq >= Number.MAX_SAFE_INTEGER) this.seq = 0;
      this.seq += 1;
      itemId = `${this.serverInstanceId}${ID_SEPARATOR}q${this.seq}`;
    } while (this.reservedItemIds.has(itemId));
    this.reservedItemIds.add(itemId);
    const item: QueuedItem = {
      id: itemId,
      sessionId: target.sessionId,
      claudeSessionId: target.claudeSessionId,
      payload,
      speaker,
      enqueuedAt: at,
      leasedAt: null,
      invalidated: null,
    };
    const accepted = this.receipts.accept({
      requestId: request?.requestId ?? null,
      fingerprint: request?.fingerprint ?? null,
      op: payload.kind === "message" ? "queued-message" : "queued-action",
      origin,
      actor: { kind: "client-claimed", id: speaker },
      speaker,
      target: {
        sessionId: target.sessionId,
        paneId: null,
        claudeSessionId: target.claudeSessionId,
        tmuxGeneration: this.generation ?? this.receipts.lastGeneration(),
      },
      queue: { itemId, enqueuedAt: at },
      what: payload.kind === "message" ? `message (${payload.text.length} characters)` : `action ${payload.action.id}`,
      material:
        payload.kind === "message"
          ? { kind: "message", text: payload.text, speaker }
          : { kind: "action", action: payload.action, speaker },
    });
    if (!accepted.ok) {
      // KEYED WORK IS NOT QUEUED IN MEMORY. The journal refuses a keyed accept
      // that did not land durably, and so does this: an item only this process
      // remembers is exactly the one a restart forgets, and its retry would
      // find no receipt and be queued a second time.
      if (request !== null) {
        return {
          ok: false,
          rule: "receipt-unavailable",
          why: `nothing was queued: its receipt could not be written durably first (${accepted.why})`,
        };
      }
      return { ok: false, rule: "receipt-capacity", why: accepted.why };
    }
    this.receiptByItem.set(itemId, accepted.receiptId);
    items.push(item);
    this.bySession.set(target.sessionId, items);
    return { ok: true, item, position: items.length, durable: accepted.durable, receiptId: accepted.receiptId };
  }

  /**
   * Take an item out before it is delivered.
   *
   * **A leased item cannot be cancelled**, and pretending otherwise would be the
   * dishonest option: the keys may already be on their way to the pane, and
   * removing the row would tell somebody it did not happen. They get a refusal
   * saying it is being delivered.
   */
  cancel(
    sessionId: string,
    itemId: string,
    actor: ReceiptActor = { kind: "unattributed-http", id: null },
  ): CancelResult {
    const items = this.bySession.get(sessionId);
    const at = items?.findIndex((i) => i.id === itemId) ?? -1;
    if (!items || at < 0) return { ok: false, rule: "no-such-item", why: `no queued item ${itemId} for ${sessionId}` };
    const item = items[at];
    if (!item) return { ok: false, rule: "no-such-item", why: `no queued item ${itemId} for ${sessionId}` };
    if (item.leasedAt !== null) {
      return { ok: false, rule: "in-flight", why: `${itemId} is being delivered right now and cannot be taken back` };
    }
    const receiptId = this.receiptByItem.get(itemId);
    if (receiptId === undefined || !this.receipts.withdrawn([receiptId], "cancelled", actor)) {
      return {
        ok: false,
        rule: "receipt-unavailable",
        why: `${itemId} could not be cancelled because its durable withdrawal could not be written; it is still queued`,
      };
    }
    items.splice(at, 1);
    this.receiptByItem.delete(itemId);
    this.restoredGeneration.delete(itemId);
    return { ok: true, item };
  }

  /** Drop everything waiting. A leased item survives, for the reason above. */
  clear(
    sessionId: string,
    actor: ReceiptActor = { kind: "unattributed-http", id: null },
  ): ClearResult {
    const items = this.bySession.get(sessionId) ?? [];
    const kept = items.filter((i) => i.leasedAt !== null);
    const removed = items.filter((i) => i.leasedAt === null);
    const receiptIds: string[] = [];
    for (const item of removed) {
      const receiptId = this.receiptByItem.get(item.id);
      if (receiptId === undefined) {
        return {
          ok: false,
          rule: "receipt-unavailable",
          why: `${item.id} could not be cleared because its receipt is unavailable; the queue is unchanged`,
        };
      }
      receiptIds.push(receiptId);
    }
    if (receiptIds.length > 0 && !this.receipts.withdrawn(receiptIds, "cleared", actor)) {
      return {
        ok: false,
        rule: "receipt-unavailable",
        why: `the queue for ${sessionId} could not be cleared because its durable withdrawal could not be written; it is unchanged`,
      };
    }
    this.bySession.set(sessionId, kept);
    for (const item of removed) {
      this.receiptByItem.delete(item.id);
      this.restoredGeneration.delete(item.id);
    }
    return { ok: true, removed, keptInFlight: kept[0] ?? null };
  }

  /**
   * Re-arm a stale item, by resetting its clock.
   *
   * Deliberately a separate gesture rather than something `next()` does: the
   * point of staleness is that somebody looks at an old instruction again
   * before it is delivered into a conversation that has moved on.
   */
  revive(sessionId: string, itemId: string): CancelResult {
    const item = (this.bySession.get(sessionId) ?? []).find((i) => i.id === itemId);
    if (!item) return { ok: false, rule: "no-such-item", why: `no queued item ${itemId} for ${sessionId}` };
    if (item.leasedAt !== null) return { ok: false, rule: "in-flight", why: `${itemId} is being delivered right now` };
    item.enqueuedAt = this.now();
    return { ok: true, item };
  }

  /* ---------------- draining ---------------- */

  /**
   * What, if anything, may be delivered right now — and if not, why not.
   *
   * `ctx.claudeSessionId` is the conversation the caller has JUST observed in
   * that pane, not the one it queued against. When they differ the pane has
   * been resumed and every item queued for the old conversation is orphaned;
   * `steer.ts` would refuse the send anyway, but refusing here means the page
   * can say so, and means nothing is even attempted.
   *
   * THE ORDER OF THE CHECKS IS THE DESIGN. Facts about the item first — is
   * something already out, is this queue pointed at a conversation that has
   * gone, has this waited too long — and only then facts about the session.
   * Reversed, a stale item queued against a dead conversation would be reported
   * as merely "held", and would look like it was still going to happen.
   */
  next(sessionId: string, ctx: { status: FleetStatus; claudeSessionId: string }): NextResult {
    const items = this.bySession.get(sessionId) ?? [];
    const at = this.now();

    const leased = items.find((i) => i.leasedAt !== null);
    if (leased && leased.leasedAt !== null) {
      const held = at - leased.leasedAt;
      // `isStuck` rather than the comparison, so this arm and the abandon route
      // cannot disagree about when a person may clear a lease.
      if (this.isStuck(leased)) {
        return {
          kind: "stuck",
          item: leased,
          why: `${leased.id} was handed out ${held}ms ago and never settled — settle it as abandoned; it will not be retried automatically`,
        };
      }
      return { kind: "in-flight", item: leased, why: `${leased.id} is being delivered` };
    }

    // **INVALIDATED ITEMS ARE SKIPPED, NOT STOPPED AT.** The tmux server this
    // was queued against is gone, so the handle names whatever came after it —
    // and that is PERMANENT: no later observation re-issues the old handles
    // back, and nothing settles an item reported `orphaned`. Stopping at one
    // therefore blocks every item queued AFTER the restart, which are exactly
    // the deliverable ones, for the thirty minutes until they are stale too —
    // one dead item taking a whole session's queue down with it, with the page
    // marking only the dead one (GPT Sol's D3, 2026-09-08). They stay in the
    // list, because the sentence on them is the point and a person decides
    // whether to cancel; they are simply not candidates.
    //
    // The `claudeSessionId` arm below is deliberately NOT treated this way. It
    // is a fact about the pane rather than about the item — resume the
    // conversation back and every item in this queue is deliverable again — so
    // skipping past the head there would start delivering items into a
    // conversation the person queued nothing for.
    const head = items.find((i) => i.invalidated === null);
    if (!head) {
      const dead = items.find(isInvalidated);
      if (!dead) return { kind: "empty" };
      // Everything here is undeliverable. Reported as `orphaned` rather than
      // `empty`, because "there is nothing to send" and "nothing here can ever
      // be sent" are opposite claims and the page draws them differently.
      return { kind: "orphaned", head: dead, why: dead.invalidated };
    }

    if (head.claudeSessionId !== ctx.claudeSessionId) {
      return {
        kind: "orphaned",
        head,
        why: `this was queued for conversation ${head.claudeSessionId}, and the pane is running ${ctx.claudeSessionId} now — the session was resumed`,
      };
    }

    if (at - head.enqueuedAt > this.limits.maxAgeMs) {
      return {
        kind: "stale",
        head,
        why: `it has waited ${Math.round((at - head.enqueuedAt) / 60_000)} minutes, and the conversation may have moved on — re-arm it if it is still what you want`,
      };
    }

    // THE HOLD, BEFORE THE GATE AND AFTER THE FACTS ABOUT THE ITEM.
    //
    // Ordered here rather than first because the checks above are all reasons
    // this PARTICULAR item is not going out — it is orphaned, it is stale, one
    // is already in flight — and those are the more specific answer. A hold is
    // a fact about the SESSION, so it belongs with the gate, and before it: a
    // session that may be holding half a sentence must not be handed anything
    // even when the gate says now. It is the gate saying `now` that makes this
    // check load-bearing rather than decorative.
    const hold = this.quarantine.holding(sessionId);
    if (hold !== null) return { kind: "quarantined", head, hold, why: hold.why };

    // `deliveryGate`, NOT `drainGate`. This function is the one that hands an
    // item to a transport, so the question it must ask is "can this be
    // delivered right now", which is strictly narrower than "may this session
    // be steered at all". The difference is `needs-you`, and the cost of
    // getting it wrong here is the person's message destroyed rather than
    // merely delayed — see `deliveryGate`.
    const gate = deliveryGate(ctx.status);
    if (gate.kind === "never") return { kind: "blocked", head, reason: gate.reason };
    if (gate.kind === "later") return { kind: "held", head, why: gate.why };

    head.leasedAt = at;
    return { kind: "ready", item: head };
  }

  /** Persist the attempt boundary after leasing and before any transport call. */
  beginDelivery(sessionId: string, itemId: string): BeginDeliveryResult {
    const item = (this.bySession.get(sessionId) ?? []).find((candidate) => candidate.id === itemId);
    if (item === undefined || item.leasedAt === null) {
      return { ok: false, rule: "not-leased", why: `${itemId} is not leased for delivery in ${sessionId}` };
    }
    const receiptId = this.receiptByItem.get(itemId);
    if (receiptId === undefined) {
      item.leasedAt = null;
      return { ok: false, rule: "receipt-unavailable", why: `${itemId} has no receipt, so no delivery was attempted` };
    }
    const attempted = this.receipts.attempted(receiptId);
    if (!attempted.landed) {
      item.leasedAt = null;
      return {
        ok: false,
        rule: "receipt-unavailable",
        why: `${itemId} is durably accepted but its attempted record could not be written, so nothing was sent`,
      };
    }
    return { ok: true };
  }

  /**
   * Say what happened to the leased item. It leaves the queue either way.
   *
   * There is no outcome that puts it back. See the module header: a retry
   * cannot know whether the first attempt's keys arrived.
   */
  settle(
    sessionId: string,
    itemId: string,
    outcome: SettleOutcome,
    actor: ReceiptActor = { kind: "unattributed-http", id: null },
  ): SettleResult {
    const items = this.bySession.get(sessionId);
    const at = items?.findIndex((i) => i.id === itemId) ?? -1;
    if (!items || at < 0) return { ok: false, why: `no item ${itemId} for ${sessionId}` };
    const item = items[at];
    if (!item) return { ok: false, why: `no item ${itemId} for ${sessionId}` };
    if (item.leasedAt === null) {
      return { ok: false, why: `${itemId} was never handed out, so there is nothing to settle` };
    }
    const receiptId = this.receiptByItem.get(itemId);
    if (receiptId === undefined) return { ok: false, why: `${itemId} has no receipt, so it cannot be settled honestly` };
    if (outcome === "delivered") {
      this.receipts.outcome(receiptId, {
        state: "keys-submitted",
        reason: "transport-ok",
        code: null,
        why: "the transport submitted every key",
      });
    } else if (outcome === "refused") {
      this.receipts.outcome(receiptId, {
        state: "not-sent",
        reason: "undeliverable",
        code: null,
        why: "the queued material could not be rendered into a sendable line",
      });
    } else if (outcome === "abandoned") {
      const state = this.receipts.get(receiptId);
      if (state !== null && state.last.kind !== "outcome" && state.last.kind !== "reconciled") {
        this.receipts.outcome(receiptId, {
          state: "outcome-unknown",
          reason: "lease-abandoned",
          code: null,
          why: "a person abandoned a delivery lease whose outcome could not be established",
        });
      }
      this.receipts.reconcile(receiptId, "lease-abandoned", actor);
    }
    items.splice(at, 1);
    this.receiptByItem.delete(itemId);
    this.restoredGeneration.delete(itemId);
    return { ok: true, item, outcome };
  }

  /**
   * Settle a leased item as `uncertain` **and** hold the session, in one call.
   *
   * **ONE METHOD RATHER THAN `settle()` THEN `hold()`, AND THAT IS THE WHOLE
   * REASON IT EXISTS.** Written as two calls, every caller has a line between
   * them at which the item has gone and the session is not yet held — and the
   * dangerous half is reachable on its own: settle without hold is exactly the
   * behaviour this stage removed, and it looks like working code. A caller
   * cannot write half of this.
   *
   * The item is settled and gone, never requeued: that is the never-retry rule,
   * and `deliverOne`'s comment argues it. What changes is only what it is
   * settled AS, and that the next item is stopped behind it.
   *
   * **THE SETTLE HAPPENS FIRST AND THE HOLD IS UNCONDITIONAL AFTER IT.** If the
   * item cannot be settled — it was never handed out — nothing is held either,
   * because a hold with no send behind it is a session blocked for a bug in the
   * caller.
   */
  quarantineLeased(
    sessionId: string,
    itemId: string,
    evidence: Omit<HoldEvidence, "sessionId">,
  ): { ok: true; item: QueuedItem; outcome: SettleOutcome; hold: QuarantineHoldView } | { ok: false; why: string } {
    const item = (this.bySession.get(sessionId) ?? []).find((candidate) => candidate.id === itemId);
    if (item === undefined || item.leasedAt === null) {
      return { ok: false, why: `${itemId} is not leased for delivery in ${sessionId}` };
    }
    const receiptId = this.receiptByItem.get(itemId);
    if (receiptId === undefined) return { ok: false, why: `${itemId} has no receipt, so it cannot be quarantined honestly` };
    this.receipts.outcome(receiptId, {
      state: "outcome-unknown",
      reason: evidence.reading,
      code: null,
      why: `the queued delivery ended with the transport reading '${evidence.reading}'`,
    });
    const settled = this.settle(sessionId, itemId, "uncertain");
    if (!settled.ok) return { ok: false, why: settled.why };
    const hold = this.quarantine.hold({ ...evidence, sessionId });
    return { ok: true, item: settled.item, outcome: settled.outcome, hold };
  }

  /** Record an ambiguous throw without closing the lease which blocks retries. */
  noteThrew(sessionId: string, itemId: string): NoteThrewResult {
    const item = (this.bySession.get(sessionId) ?? []).find((candidate) => candidate.id === itemId);
    if (item === undefined || item.leasedAt === null) return { ok: false, why: `${itemId} is not leased for delivery in ${sessionId}` };
    const receiptId = this.receiptByItem.get(itemId);
    if (receiptId === undefined) return { ok: false, why: `${itemId} has no receipt, so the throw cannot be recorded` };
    this.receipts.outcome(receiptId, {
      state: "outcome-unknown",
      reason: "threw",
      code: null,
      why: "the delivery module threw and could not establish whether any keystroke was sent",
    });
    return { ok: true };
  }

  /**
   * Put a leased item back, because the transport proved it sent nothing.
   *
   * **THE ONE HOLE IN "NOTHING IS EVER RETRIED", AND IT IS NOT A RETRY.** The
   * header's argument is that a retry cannot know whether the first attempt's
   * keys arrived. `UnsentFailure` is exactly that knowledge, and it can only be
   * built by `nothingWasSent` out of a `SteerFailure` that says `delivery:
   * "none"` with an empty `sent` list. Every refusal in steer.ts that fires
   * before the two `send-keys` calls says so, and the commonest of them on this
   * box is `pane-is-asking` — the pane started showing a dialog in the thirteen
   * seconds since the collection. Without this, that refusal DESTROYS the
   * person's instruction; with it, the item waits for the dialog to be answered.
   *
   * It goes back to the HEAD, not the back, because it never left: the order the
   * person pressed the buttons in is the thing this whole file is for.
   *
   * WHAT STOPS IT LOOPING FOR EVER. Nothing, deliberately, except the two bounds
   * that already exist: one attempt per session per pass, and `maxAgeMs`, after
   * which it is stale and only a person can re-arm it. An item that cannot be
   * delivered is therefore tried about twenty-five times over half an hour and
   * then stops, visibly.
   */
  release(sessionId: string, itemId: string, evidence: UnsentFailure): ReleaseResult {
    const items = this.bySession.get(sessionId);
    const at = items?.findIndex((i) => i.id === itemId) ?? -1;
    if (!items || at < 0) return { ok: false, why: `no item ${itemId} for ${sessionId}` };
    const item = items[at];
    if (!item) return { ok: false, why: `no item ${itemId} for ${sessionId}` };
    if (item.leasedAt === null) {
      return { ok: false, why: `${itemId} was never handed out, so there is nothing to put back` };
    }
    // Belt as well as braces: the type says the caller holds the transport's
    // word for it, and this says so again at the moment of acting. The rule
    // lives here, and a rule that is only enforced at compile time is one an
    // `as` somewhere else can walk past.
    if (evidence.delivery !== "none" || evidence.sent.length > 0) {
      return { ok: false, why: `${itemId} cannot be put back: the transport did not say that nothing was sent` };
    }
    const receiptId = this.receiptByItem.get(itemId);
    if (receiptId === undefined) return { ok: false, why: `${itemId} has no receipt, so it cannot be returned honestly` };
    this.receipts.returned(receiptId, evidence.reason.code);
    item.leasedAt = null;
    // Back in front of every other DELIVERABLE item and behind the dead ones,
    // which is where `next()` found it: since that function skips invalidated
    // items, an unconditional `unshift` would hoist this one above them and
    // reorder the page for no reason. It is almost always already in exactly
    // this position — nothing inserts ahead of the head — but that is an
    // invariant of another function, and this is cheap.
    items.splice(at, 1);
    const firstDeliverable = items.findIndex((i) => i.invalidated === null);
    items.splice(firstDeliverable < 0 ? items.length : firstDeliverable, 0, item);
    return { ok: true, item };
  }

  /** Apply the one restart-only generation check, then forget that provenance. */
  private concludeRestoredForGeneration(tmuxServerPid: number): number {
    const generationUnproven = this.receipts.recovery().generationUnproven;
    let concluded = 0;
    for (const [itemId, recorded] of this.restoredGeneration) {
      if (!generationUnproven && recorded !== null && recorded === tmuxServerPid) continue;
      const item = this.findItem(itemId);
      const receiptId = this.receiptByItem.get(itemId);
      if (item === null || receiptId === undefined) continue;
      const unproven = generationUnproven || recorded === null;
      this.receipts.outcome(receiptId, {
        state: "not-sent",
        reason: unproven ? "tmux-generation-unproven" : "tmux-generation-changed",
        code: null,
        why: unproven
          ? "the restored item had no trustworthy tmux generation, so its session handle could not be used"
          : `the restored item belonged to tmux server ${recorded}, not ${tmuxServerPid}`,
      });
      const items = this.bySession.get(item.sessionId);
      const at = items?.findIndex((candidate) => candidate.id === itemId) ?? -1;
      if (items !== undefined && at >= 0) items.splice(at, 1);
      this.receiptByItem.delete(itemId);
      concluded += 1;
    }
    this.restoredGeneration.clear();
    return concluded;
  }

  /**
   * Tell the queue which tmux server the box is running, and invalidate
   * everything queued against a different one.
   *
   * WHY THE WHOLE QUEUE AT ONCE rather than a generation on each item: nothing
   * per-item would have to be plumbed through the enqueue route, and there is
   * no case where two items in one process were queued against two different
   * tmux servers *and* the earlier one is still valid. One comparison, one
   * sentence, every waiting item marked.
   *
   * A leased item is left alone: it is already out of reach of delivery, and
   * `next()` will report it as in-flight and then stuck for a person.
   *
   * Returns how many were invalidated, for the log — silence about thirty-six
   * items becoming undeliverable would be its own kind of quiet loss.
   */
  noteGeneration(tmuxServerPid: number): number {
    // TOLD IN THE SAME BREATH, so the queue and the book cannot come to
    // disagree about which tmux server the box is running. The book makes its
    // own first-observation distinction; this returns the ITEM count, which is
    // what the drain logs, and `quarantineBook().knownGeneration()` is there
    // for anybody who needs the other half.
    this.quarantine.noteGeneration(tmuxServerPid);
    this.receipts.noteGeneration(tmuxServerPid);
    if (this.generation === null) {
      this.generation = tmuxServerPid;
      return this.concludeRestoredForGeneration(tmuxServerPid);
    }
    if (this.generation === tmuxServerPid) return 0;
    const was = this.generation;
    this.generation = tmuxServerPid;
    let marked = 0;
    for (const items of this.bySession.values()) {
      for (const item of items) {
        if (item.leasedAt !== null || item.invalidated !== null) continue;
        item.invalidated =
          `this was queued against tmux server ${was}, and the box is running ${tmuxServerPid} now — ` +
          "every session handle has been re-issued, so there is no way to know what this would reach";
        marked += 1;
      }
    }
    return marked;
  }

  /** Which tmux server this queue's handles belong to, or null before the first pass. */
  knownGeneration(): number | null {
    return this.generation;
  }
}
