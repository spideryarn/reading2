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
 * NOTHING SURVIVES A RESTART, AND IT SAYS SO. Every snapshot carries
 * `volatile: true` and `PERSISTENCE_WARNING`, and a page that renders the queue
 * without showing that is a bug: the alternative is a queue that quietly loses
 * items when the dashboard is restarted, and quiet loss is exactly the failure
 * docs/reusable/silent-success.md is about. Persistence belongs to the
 * Overseer's store, which is somebody else's stage.
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
import { actionById, type SpokenAction } from "./actions.js";
import type { FleetStatus } from "./status.js";
import { checkText, steerableStatus, type Refusal, type SteerFailure } from "./steer.js";

/* ------------------------------------------------------------------ *
 * What can be queued.
 * ------------------------------------------------------------------ */

/**
 * An action or a free-text message, in ONE queue.
 *
 * Greg asked for them combined — "one could press more than one, in
 * combination with messages" — and combining them is not a convenience: a
 * message that says "actually do X instead" must land after the button that
 * says "do X" and before the one that says "push", and two queues cannot
 * promise that.
 */
/**
 * **`SpokenAction`, not `Action`, and that is a boundary rather than a
 * convenience.** An enacted action — `remove-worktree`, `kill-session` — cannot
 * be REPRESENTED as a queued item, so nothing downstream needs a defensive
 * branch for one and nobody can add a second way in. See `enqueueAction` for
 * why the retreat was made and what to delete first when it is reversed.
 */
export type QueuedPayload = { kind: "action"; action: SpokenAction } | { kind: "message"; text: string };

export type QueuedItem = {
  /** Stable for the life of the item, and what `cancel` and `settle` name. */
  id: string;
  /** tmux's session handle (`$1643`) — which queue this is in. */
  sessionId: string;
  /**
   * The CONVERSATION this was queued against, and the field that stops the
   * commonest wrong delivery.
   *
   * A pane can be resumed into a different Claude conversation while an item
   * waits (`gjd-remote resume` keeps the pane and the tmux session and starts a
   * new conversation), and then everything else about the target still matches.
   * steer.ts refuses that at send time because `SteerTarget` carries the uuid;
   * this field is what lets the QUEUE refuse it first, and say why on the page,
   * instead of the person seeing a send fail for an obscure reason.
   */
  claudeSessionId: string;
  payload: QueuedPayload;
  enqueuedAt: number;
  /** When `next()` handed it out. Null while it is waiting. */
  leasedAt: number | null;
  /**
   * Why this can never be delivered, or null. Set by `noteGeneration`.
   *
   * A tmux server restart takes every session with it and RE-ISSUES the same
   * `$…` and `%…` handles to whatever comes next, so an item queued against the
   * old server names a session that no longer exists — and names it with digits
   * that now belong to somebody else. There is no per-item field that could
   * catch that (`claudeSessionId` survives a resume, `panePid` is optional), so
   * it is caught for the whole queue at once, when the generation changes.
   *
   * A SENTENCE RATHER THAN A BOOLEAN, and the item stays in the snapshot
   * carrying it: the page shows why it will not happen. Deleting the items
   * would be the quiet loss this file's header is about.
   */
  invalidated: string | null;
};

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
  | "double-tap";

export type EnqueueResult =
  | { ok: true; item: QueuedItem; position: number }
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
  /** This session cannot be typed into at all, in steer.ts's words. */
  | { kind: "blocked"; head: QueuedItem; reason: Refusal }
  /** Leased. Deliver it, then `settle`. */
  | { kind: "ready"; item: QueuedItem };

/**
 * What happened to a leased item. **All three remove it**; none requeues.
 *
 *  - `delivered` — the send returned ok.
 *  - `refused` — the send returned a refusal. It is not retried: the refusals
 *    steer.ts returns are about the box being different from the page, and
 *    firing the same keys again a moment later is how a message ends up in the
 *    wrong session.
 *  - `abandoned` — nobody knows. Used to clear a `stuck` lease.
 */
export type SettleOutcome = "delivered" | "refused" | "abandoned";

export type SettleResult = { ok: true; item: QueuedItem; outcome: SettleOutcome } | { ok: false; why: string };

/**
 * A refusal that PROVABLY sent nothing, and the only thing `release` accepts.
 *
 * The intersection is not decoration: `SteerFailure` is not a discriminated
 * union on `delivery`, so narrowing `f.delivery === "none"` at a call site
 * narrows the property and NOT the object, and a caller cannot manufacture one
 * of these by writing an `if`. The only way to obtain the type is
 * `nothingWasSent`, which is one audited place rather than a rule everybody has
 * to remember.
 */
export type UnsentFailure = SteerFailure & { delivery: "none" };

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

export type CancelResult = { ok: true; item: QueuedItem } | { ok: false; why: string };

/**
 * Everything a page needs to render one queue — including the fact that it is
 * volatile, which is why that is on the snapshot rather than in a doc.
 */
export type QueueSnapshot = {
  sessionId: string;
  items: readonly QueuedItem[];
  /** Always true today. Present so the day it is false, callers notice. */
  volatile: true;
  warning: string;
  /** When this queue's server process started. Items cannot predate it. */
  since: number;
};

/* ------------------------------------------------------------------ *
 * The queue.
 * ------------------------------------------------------------------ */

const SESSION_HANDLE = /^\$\d+$/;
const CLAUDE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The same thing pressed twice? Compared by identity, not by rendered text. */
export function samePayload(a: QueuedPayload, b: QueuedPayload): boolean {
  if (a.kind === "action" && b.kind === "action") return a.action.id === b.action.id;
  if (a.kind === "message" && b.kind === "message") return a.text.trim() === b.text.trim();
  return false;
}

export type QueueOptions = {
  /** Injected, always. There is no `Date.now()` anywhere below. */
  now: () => number;
  limits?: Partial<QueueLimits>;
};

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
  private readonly limits: QueueLimits;
  private readonly bySession = new Map<string, QueuedItem[]>();
  private seq = 0;
  private readonly startedAt: number;
  /**
   * The tmux server every `$…` in this queue belongs to, or null until the
   * first drain pass tells us. See `noteGeneration`.
   */
  private generation: number | null = null;

  constructor(options: QueueOptions) {
    this.now = options.now;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.startedAt = options.now();
  }

  /* ---------------- reading ---------------- */

  snapshot(sessionId: string): QueueSnapshot {
    return {
      sessionId,
      items: [...(this.bySession.get(sessionId) ?? [])],
      volatile: true,
      warning: PERSISTENCE_WARNING,
      since: this.startedAt,
    };
  }

  /** Every queue that has anything in it. For the header count and the Overseer. */
  snapshots(): QueueSnapshot[] {
    const out: QueueSnapshot[] = [];
    for (const [sessionId, items] of this.bySession) {
      if (items.length > 0) out.push(this.snapshot(sessionId));
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

  /* ---------------- writing ---------------- */

  /**
   * Put an action at the back of a session's queue.
   *
   * The action arrives as an ID, not as an object, because this is where a JSON
   * body from a browser lands: `actionById` is the only way in, so a caller
   * cannot invent an action with different words in it.
   */
  enqueueAction(target: { sessionId: string; claudeSessionId: string }, actionId: string): EnqueueResult {
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
    return this.push(target, { kind: "action", action });
  }

  /**
   * Put a free-text message at the back of a session's queue.
   *
   * `checkText` is steer.ts's, called here so that a message which could never
   * be delivered is refused while somebody is looking at it, rather than
   * failing silently at the head of the queue twenty minutes later. It is the
   * same function the send will use, so the two cannot disagree about what a
   * sendable message is.
   */
  enqueueMessage(target: { sessionId: string; claudeSessionId: string }, text: string): EnqueueResult {
    const bad = checkText(text);
    if (bad) return { ok: false, rule: "bad-text", why: bad.why };
    return this.push(target, { kind: "message", text });
  }

  private push(target: { sessionId: string; claudeSessionId: string }, payload: QueuedPayload): EnqueueResult {
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

    // **`q1` COMES ROUND AGAIN EVERY TIME THIS PROCESS RESTARTS**, and nothing
    // here notices. A phone left open across a restart can therefore cancel —
    // or, when there is a route for it, settle — a DIFFERENT `q1` from the one
    // it is showing. That is a real defect and it already applies to `cancel`;
    // it is noted here rather than fixed because the fix is a per-process
    // prefix on the id and every caller that stores one, which is somebody
    // else's stage (GPT Sol, 2026-09-08).
    this.seq += 1;
    const item: QueuedItem = {
      id: `q${this.seq}`,
      sessionId: target.sessionId,
      claudeSessionId: target.claudeSessionId,
      payload,
      enqueuedAt: at,
      leasedAt: null,
      invalidated: null,
    };
    items.push(item);
    this.bySession.set(target.sessionId, items);
    return { ok: true, item, position: items.length };
  }

  /**
   * Take an item out before it is delivered.
   *
   * **A leased item cannot be cancelled**, and pretending otherwise would be the
   * dishonest option: the keys may already be on their way to the pane, and
   * removing the row would tell somebody it did not happen. They get a refusal
   * saying it is being delivered.
   */
  cancel(sessionId: string, itemId: string): CancelResult {
    const items = this.bySession.get(sessionId);
    const at = items?.findIndex((i) => i.id === itemId) ?? -1;
    if (!items || at < 0) return { ok: false, why: `no queued item ${itemId} for ${sessionId}` };
    const item = items[at];
    if (!item) return { ok: false, why: `no queued item ${itemId} for ${sessionId}` };
    if (item.leasedAt !== null) {
      return { ok: false, why: `${itemId} is being delivered right now and cannot be taken back` };
    }
    items.splice(at, 1);
    return { ok: true, item };
  }

  /** Drop everything waiting. A leased item survives, for the reason above. */
  clear(sessionId: string): { removed: QueuedItem[]; keptInFlight: QueuedItem | null } {
    const items = this.bySession.get(sessionId) ?? [];
    const kept = items.filter((i) => i.leasedAt !== null);
    const removed = items.filter((i) => i.leasedAt === null);
    this.bySession.set(sessionId, kept);
    return { removed, keptInFlight: kept[0] ?? null };
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
    if (!item) return { ok: false, why: `no queued item ${itemId} for ${sessionId}` };
    if (item.leasedAt !== null) return { ok: false, why: `${itemId} is being delivered right now` };
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
      if (held > this.limits.leaseMs) {
        return {
          kind: "stuck",
          item: leased,
          why: `${leased.id} was handed out ${held}ms ago and never settled — settle it as abandoned; it will not be retried automatically`,
        };
      }
      return { kind: "in-flight", item: leased, why: `${leased.id} is being delivered` };
    }

    const head = items[0];
    if (!head) return { kind: "empty" };

    // The tmux server this was queued against is gone, so the handle at the top
    // of this queue names whatever came after it. Reported as `orphaned` — the
    // same arm as a resumed conversation, because it is the same fact: the
    // address still resolves and no longer means what it meant.
    if (head.invalidated !== null) {
      return { kind: "orphaned", head, why: head.invalidated };
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

  /**
   * Say what happened to the leased item. It leaves the queue either way.
   *
   * There is no outcome that puts it back. See the module header: a retry
   * cannot know whether the first attempt's keys arrived.
   */
  settle(sessionId: string, itemId: string, outcome: SettleOutcome): SettleResult {
    const items = this.bySession.get(sessionId);
    const at = items?.findIndex((i) => i.id === itemId) ?? -1;
    if (!items || at < 0) return { ok: false, why: `no item ${itemId} for ${sessionId}` };
    const item = items[at];
    if (!item) return { ok: false, why: `no item ${itemId} for ${sessionId}` };
    if (item.leasedAt === null) {
      return { ok: false, why: `${itemId} was never handed out, so there is nothing to settle` };
    }
    items.splice(at, 1);
    return { ok: true, item, outcome };
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
    item.leasedAt = null;
    // It is already at the head — `next()` only ever leases `items[0]` — but
    // that is an invariant of another function, and this one is cheap.
    items.splice(at, 1);
    items.unshift(item);
    return { ok: true, item };
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
    if (this.generation === null) {
      this.generation = tmuxServerPid;
      return 0;
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
