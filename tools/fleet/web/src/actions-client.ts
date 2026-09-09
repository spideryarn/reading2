/**
 * The action vocabulary, the queues, and the seven requests that touch them —
 * `POST /api/actions/session`, `GET /api/actions`, `POST /api/actions/box`,
 * `POST /api/actions/cancel`, the two recovery gestures
 * `POST /api/actions/revive` and `POST /api/actions/abandon`, and
 * `POST /api/actions/clear`, which empties one session's queue.
 *
 * ## THE RULE THIS FILE KEEPS, WHICH IS steer-client.ts's RULE
 *
 * **Every identifying value in a request body comes verbatim out of the row the
 * person tapped, and nothing here refetches or rebuilds any of them.** The
 * server's safety model is that those values are *stale-but-honest claims* it
 * checks against live tmux; a client that helpfully asked `/api/state` for
 * fresh ids first would make every guard compare the box with itself and still
 * show a green tick. There is a long comment saying so at the top of
 * tools/fleet/routes-steer.ts, and `steerTargetBody` — imported below rather
 * than re-implemented — is the one function that builds those five fields.
 * There is no second copy of it here and there must not be one.
 *
 * The cancel body is the same discipline pointed at a different object: the
 * `sessionId` and the item `id` come off the queue snapshot that was on screen,
 * not from a lookup. `clearBody` is the same rule applied to a whole list, and
 * there the check at the far end is the safety property rather than a nicety —
 * see it.
 *
 * ## THE CATALOGUE IS THE SERVER'S, AND THAT IS WHY THERE IS NO LIST HERE
 *
 * `tools/fleet/actions.ts` says it out loud: *"`ACTIONS` is JSON-serialisable
 * on purpose: the client can render the whole vocabulary from `/api/actions`
 * rather than keeping a second copy of it."* It cannot be imported — it reaches
 * `steer.ts`, which opens `node:child_process`, and this is a browser bundle —
 * so the buttons are **rendered from what the server sends**. That is not a
 * compromise: it is what makes it impossible for a button to exist in the UI
 * and not in the vocabulary, which is the same as saying that everything a
 * person can press, the coordinator agent can press too.
 *
 * The parse below is written in the direction every other parser in this client
 * is written in, and for the same reason:
 *
 *  - **An effect this build has never heard of is `unrecognised`, and is drawn
 *    but not pressable.** Not dropped — a vocabulary that silently loses an
 *    entry is a page claiming the server offers less than it does — and not
 *    rounded to `spoken`, which would type an unknown thing at an agent.
 *  - **`needsConfirm` is TRUE when absent or malformed.** The mild default is
 *    the wrong one here: an action whose gravity the payload did not state gets
 *    the second tap, not the first.
 *  - **A queue with no `volatile`/`warning` still gets the warning**, in this
 *    file's own words, because "nothing said whether these survive a restart"
 *    has to read as "assume they do not" (queue.ts § NOTHING SURVIVES A
 *    RESTART: a page that renders the queue without showing that is a bug).
 *
 * ## THE SHAPES ARE PROVISIONAL AND THIS IS WHERE THEY ARE WRITTEN DOWN
 *
 * The routes were built in parallel with this file, so the field names below
 * are the client's *assumption* and this module is the one place to change when
 * they are reconciled. Everything is read defensively: a field that is not
 * there produces an honest gap on the page rather than an exception, and
 * `catalogue` / `queuesOffered` exist so that "the server sent no actions" and
 * "the server sent an empty list of actions" can be told apart — which is the
 * distinction the whole tool is built around. `catalogue` has a third arm,
 * because the two-answer version of it answered a shape it did not recognise
 * with the wrong one of the two; see `CatalogueReading`.
 *
 * ## Every failure is the SERVER'S sentence
 *
 * `{ok: false, code, why}` comes back written for a person, and `why` knows
 * things this page cannot. Nothing here paraphrases one. The only sentences
 * this file writes are for failures the server never saw — the fetch itself, or
 * an answer that is not this API — and each says plainly that it is local.
 */
/* THE ONE SERVER MODULE THIS BUNDLE MAY IMPORT. `tools/fleet/wire.ts` is a leaf
   with no imports at all, which is what makes it safe here: every other home for
   these types reaches `node:child_process` transitively, and this project has no
   node types. See wire.ts's header. */
import type {
  ActionScope as ActionScopeWire,
  BroadcastAction as BroadcastActionWire,
  EnactedAction as EnactedActionWire,
  HoldBasis,
  HoldOutcome,
  HoldReleaseGesture,
  PlanRunView,
  PlanStepStatus,
  PlanStepView,
  QuarantineHoldView,
  QueuedItemView as QueuedItemViewWire,
  QueueView as QueueViewWire,
  SpokenAction as SpokenActionWire,
  UncertainSendOrigin,
  UncertainSendReading,
} from "../../wire.js";
/* `DeliveryReading` and `parseDelivery` come from steer-client.ts for the same
   reason `steerTargetBody` does: there is one vocabulary for what became of a
   send, and a second copy of it here would be the twin this whole plan is
   about. No cycle — steer-client.ts imports `./types` and nothing else. */
import { parseDelivery, steerTargetBody, type DeliveryReading, type SteerTargetBody } from "./steer-client";
import type { FleetRow } from "./types";

export const ACTIONS_URL = "api/actions";
export const SESSION_ACTION_URL = "api/actions/session";
export const BOX_ACTION_URL = "api/actions/box";
export const CANCEL_URL = "api/actions/cancel";
/** The two recovery gestures. Both take the same body as cancel; see `cancelBody`. */
export const REVIVE_URL = "api/actions/revive";
export const ABANDON_URL = "api/actions/abandon";
/** Emptying one session's queue in a single gesture. Its body is NOT cancel's; see `clearBody`. */
export const CLEAR_URL = "api/actions/clear";
/**
 * The fifth gesture, and the only one that is not about a queued item.
 *
 * `hold/release` rather than `release`, because "release" on its own reads as
 * *let the message go* — the opposite of what it does. It ends a HOLD; it sends
 * nothing.
 */
export const RELEASE_HOLD_URL = "api/actions/hold/release";

/* ------------------------------------------------------------------ *
 * The vocabulary, as this page reads it.
 * ------------------------------------------------------------------ */

/** Where an action is offered. Anything else parses to `unrecognised`. */
export type ActionScope = ActionScopeWire;

/**
 * One entry of the catalogue.
 *
 * The three real arms derive from the shared wire arms. The fourth is this
 * client's, and it is the arm that matters when the two get out of step:
 * an action this build cannot classify is still NAMED on the page, with the
 * reason, and cannot be pressed. Rendering it as a button would mean offering a
 * tap whose consequences nothing on screen can describe.
 */
export type ClientSpokenAction = Omit<
  SpokenActionWire,
  /* Re-typed: an id is parsed from somebody else's JSON, so a newer server's
     spoken action remains usable rather than becoming a type lie. */
  "id"
  /* Declined at the boundary: none. Every remaining field is carried whole. */
> & { id: string };

export type ClientEnactedAction = Omit<
  EnactedActionWire,
  /* Re-typed: a newer server's id must still be named on this page. */
  "id"
  /* Declined at the boundary: none. Every remaining field is carried whole. */
> & { id: string };

export type ClientBroadcastAction = Omit<
  BroadcastActionWire,
  /* Re-typed: `id` is read from JSON, and `stagger` becomes null when an older
     server made no claim about it or this page cannot read the claim. */
  | "id"
  | "stagger"
  /* Declined at the boundary: none. Every remaining field is carried whole. */
> & { id: string; stagger: BroadcastActionWire["stagger"] | null };

export type ClientAction =
  | ClientSpokenAction
  | ClientEnactedAction
  | ClientBroadcastAction
  | {
      effect: "unrecognised";
      id: string;
      scope: ActionScope | null;
      label: string;
      summary: string;
      /** Why this page will not offer it. Shown beside the name. */
      why: string;
    };

/** Does pressing this change the world whether or not an agent cooperates? */
export function isEnacting(action: ClientAction): boolean {
  return action.effect === "enacted";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function scopeOf(v: unknown): ActionScope | null {
  return v === "session" || v === "box" ? v : null;
}

/**
 * One catalogue entry off the wire, or null when it has no id.
 *
 * An id is the only thing that cannot be defaulted: it is what a press posts
 * back, so an entry without one is not an action, it is noise. Everything else
 * degrades to something sayable — a missing label falls back to the id, because
 * a button named `remove-worktree` is worse than a button named "Remove
 * worktree" and infinitely better than a button that is not there.
 */
export function parseAction(v: unknown): ClientAction | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  if (id === null) return null;
  const scope = scopeOf(v["scope"]);
  const label = str(v["label"]) ?? id;
  const summary = str(v["summary"]) ?? "";
  /* TRUE unless the server explicitly said false. See the header: the mild
     default is the wrong one for a field that decides whether a destructive
     thing is one tap or two. */
  const needsConfirm = v["needsConfirm"] !== false;
  const effect = v["effect"];

  if (effect === "spoken") {
    const text = str(v["text"]);
    if (text === null || scope !== "session") {
      return {
        effect: "unrecognised",
        id,
        scope,
        label,
        summary,
        why:
          text === null
            ? "the server called this a spoken action and sent no words for it, so there is nothing to show you before you send it"
            : `the server sent ${scope === null ? "no scope this page understands" : JSON.stringify(scope)} for ${JSON.stringify(id)}, but a spoken action must be addressed to one session`,
      };
    }
    const form = v["form"] === "slash-command" ? "slash-command" : "prose";
    return { effect: "spoken", id, scope, label, summary, needsConfirm, text, form };
  }

  if (effect === "enacted") {
    if (scope === null) {
      return { effect: "unrecognised", id, scope, label, summary, why: `the server sent no scope this page understands for ${JSON.stringify(id)}` };
    }
    return {
      effect: "enacted",
      id,
      scope,
      label,
      summary,
      needsConfirm: true,
      gate:
        str(v["gate"]) ??
        "the server did not say what it checks before doing this, so nothing on this page can tell you what it is about to run",
    };
  }

  if (effect === "broadcast") {
    if (scope !== "box") {
      return {
        effect: "unrecognised",
        id,
        scope,
        label,
        summary,
        why: `the server sent ${scope === null ? "no scope this page understands" : JSON.stringify(scope)} for ${JSON.stringify(id)}, but a broadcast must be addressed to the box`,
      };
    }
    const stagger = isRecord(v["stagger"]) ? v["stagger"] : null;
    const min = stagger !== null && typeof stagger["minMinutes"] === "number" ? stagger["minMinutes"] : null;
    const window = stagger !== null && typeof stagger["windowMinutes"] === "number" ? stagger["windowMinutes"] : null;
    return {
      effect: "broadcast",
      id,
      scope,
      label,
      summary,
      needsConfirm: true,
      stagger: min === null || window === null ? null : { minMinutes: min, windowMinutes: window },
    };
  }

  return {
    effect: "unrecognised",
    id,
    scope,
    label,
    summary,
    why:
      typeof effect === "string"
        ? `this page does not know the action kind ${JSON.stringify(effect)}, so it cannot say what pressing it would do`
        : "the server sent this action without saying what kind of thing it is",
  };
}

/* ------------------------------------------------------------------ *
 * The queues.
 * ------------------------------------------------------------------ */

/** What one waiting item is. `unrecognised` is drawn and can still be cancelled. */
export type QueuedView =
  | { kind: "action"; actionId: string; label: string; text: string | null }
  | { kind: "message"; text: string }
  | { kind: "unrecognised"; why: string };

/**
 * **DERIVED FROM THE WIRE TYPE, NOT WRITTEN BESIDE IT.**
 *
 * `QueuedItemViewWire` is `tools/fleet/wire.ts`'s — the same declaration the
 * route annotates its response with. Every field the server sends is therefore
 * in this type unless it is NAMED in the `Omit<>` below, and `parseQueue`'s
 * object literal does not compile until each one is either parsed or named. A
 * field added on the server is a compile error here; dropping it is a line
 * somebody has to write and a reviewer can see.
 *
 * Which is the whole repair: `stale`, `stuck`, `invalidated` and `deliverable`
 * all reached this file on the wire and were dropped by a hand-written twin,
 * four separate times in one night. docs/postmortems/260908b.
 *
 * The `Omit<>` list is in two halves, and the comment on each is the decision:
 *
 *  - **re-typed** — parsed to something weaker, because a server too old to send
 *    the field has made no claim and this page must not make one for it;
 *  - **deliberately unread** — the page has no use for it.
 */
export type QueueItemView = Omit<
  QueuedItemViewWire,
  /* Re-typed below, each to `| null`. */
  | "payload"
  | "enqueuedAt"
  | "leasedAt"
  | "stale"
  | "stuck"
  | "speaker"
  /* Deliberately unread. The item is only ever addressed within the queue that
     holds it, whose `sessionId` is on the QueueView; and which Claude
     conversation it was queued against is the server's business — it refuses
     the delivery itself. */
  | "sessionId"
  | "claudeSessionId"
> & {
  /** What `cancel` names. */
  id: string;
  payload: QueuedView;
  /** Epoch ms, or null when the server did not say. */
  enqueuedAt: number | null;
  /** Non-null once it has been handed out for delivery — it is going now. */
  leasedAt: number | null;
  /**
   * The server's sentence saying this can never be delivered, or null.
   *
   * Set when the tmux server restarts under the queue: every `$…` handle is
   * re-issued, so the item names a session that no longer exists. **It is
   * parsed here because the field existed on the wire for a day before this
   * page read it** — the item went on being drawn as if it were waiting its
   * turn, which is the same quiet loss the persistence warning below exists to
   * stop. `?? null` rather than a default sentence: a server too old to send
   * the field is not making a claim, and inventing one for it would be the
   * opposite mistake.
   */
  invalidated: string | null;
  /**
   * The queue's word that this has waited past `maxAgeMs`, or null.
   *
   * **THE SECOND FIELD THIS PAGE LET GO PAST IT** (GPT Sol's D2, 2026-09-08).
   * The catalogue route has sent it since the day it was written, and nothing
   * read it, so an item `next()` refuses to deliver was drawn as an ordinary
   * waiting one under copy promising it goes out when the session is next at a
   * prompt. `?? null` for the same reason as `invalidated`: a server too old to
   * send the field is not making a claim, and defaulting to `false` would make
   * one on its behalf.
   */
  stale: boolean | null;
  /**
   * The queue's word that this was handed out for delivery and never settled,
   * or null.
   *
   * Not the same question as `leasedAt !== null`: a lease a second old is a
   * send in progress, and one past `leaseMs` is a delivery nobody will ever
   * confirm, which blocks the whole of that session's queue until a person
   * abandons it. The line between them is `leaseMs`, which is the queue's, so
   * this is asked rather than computed here.
   */
  stuck: boolean | null;
  /**
   * WHO QUEUED IT, or null when the server did not say.
   *
   * The server renders a line naming the sender in front of the words at
   * delivery, so this is not decoration: it is what the receiving agent will be
   * told, shown to the person who can still cancel it. It is also the field
   * that stops this page calling every queued message "Your message" — which it
   * did, and which is a false claim about anything an automated coordinator put
   * there.
   *
   * `null` rather than a default for the reason `stale` is: a server too old to
   * send it has made no claim, and this page must not make one on its behalf.
   */
  speaker: "greg" | "overseer" | null;
};

/**
 * One session's queue.
 *
 * `warning` is never null on the page. queue.ts sends `PERSISTENCE_WARNING` on
 * every snapshot; when it does not, this substitutes the honest version of the
 * same fact rather than showing a queue with no note on it.
 */
export type QueueView = Omit<
  QueueViewWire,
  /* Re-typed below. */
  | "items"
  | "deliverable"
  | "quarantine"
  /* Deliberately unread. `volatile` is always `true` and the sentence in
     `warning` is what the page actually shows; `since` is the snapshot's own
     timestamp and nothing renders it. */
  | "volatile"
  | "since"
> & {
  sessionId: string;
  items: QueueItemView[];
  warning: string;
  /**
   * How many of `items` could still reach a pane, as the QUEUE counts it, or
   * null when the server did not say. Read `hasDeliverable` rather than this.
   */
  deliverable: number | null;
  /** How many items in this queue the page could not read at all. */
  unreadableItems: number;
  /**
   * **The server sent a queue with no readable list of items in it.**
   *
   * Not the same as an empty queue, and the difference is the whole reason this
   * field exists. `items` used to be `Array.isArray(v["items"]) ? v["items"] :
   * []`, so a renamed or missing key produced a perfectly valid queue with
   * nothing in it — and the page then said *"Nothing is waiting."*, which is a
   * confident claim about the box derived from a payload it could not read.
   *
   * That is the same defect this file already carries a long comment about, one
   * field along: `catalogueOffered` turned a shape mismatch into *"this server
   * sent no list of actions at all"*. Found on 2026-09-08 by
   * `fleet-health-history`, who hit it in their own parser and warned the rest
   * of us — the browser is where `wire.ts` cannot reach, because a hand-written
   * parse of an `unknown` is exactly what the compiler has no opinion about.
   */
  itemsUnreadable: boolean;
  /**
   * The hold stopping this session from being drained, or null.
   *
   * **`null` HERE MEANS TWO THINGS AND THE PAGE MUST NOT SAY WHICH.** A server
   * too old to send the field and a server saying there is no hold both land
   * here, exactly as `stale` and `invalidated` do — and the fold is safe in
   * this direction only because the page's one use for the field is to DRAW a
   * hold and offer the two gestures. Drawing nothing when the server said
   * nothing is silence; drawing *nothing is held* would be a claim, and no copy
   * in ActionButtons.tsx makes it.
   */
  quarantine: HoldView | null;
  /**
   * **The server sent a hold this page cannot even ADDRESS.**
   *
   * `itemsUnreadable`'s twin, and it is here for a sharper version of the same
   * reason. A malformed `quarantine` object parses to `null`, and `null` is
   * also what "nothing is held" looks like — so on a queue with no items the
   * whole row would disappear, and with it both gestures. **That is the one
   * failure this stage is most against: a hold nothing can see is a hold
   * nothing can clear.** So a hold that would not parse keeps the row.
   *
   * **IT IS NARROWER THAN IT WAS, DELIBERATELY.** It used to fire when any of
   * `id`, `version` or `why` failed to read, which withheld both gestures from
   * a hold that could perfectly well have been released — a missing sentence
   * cost a person the only way out. Now only the release address counts: if
   * `id` and `version` read, the hold is drawn with both gestures and a generic
   * warning, and this stays false.
   */
  holdUnreadable: boolean;
};

/**
 * A hold, as this page reads it.
 *
 * **DERIVED FROM THE WIRE TYPE**, the same as `QueueItemView` and for the same
 * reason: a field added on the server is a compile error here until somebody
 * reads it or names it in the `Omit<>`. The re-typed fields become `| null`,
 * because a server too old to send one has made no claim and this page must not
 * make one on its behalf.
 */
export type HoldView = Omit<
  QuarantineHoldView,
  /* Re-typed below, each to `| null`. */
  | "why"
  | "reading"
  | "origin"
  | "outcome"
  | "openedAt"
  | "lastSendAt"
  | "incidents"
  | "tmuxGeneration"
  | "basis"
  /* Deliberately unread. The hold is only ever drawn inside the queue whose
     `sessionId` the page already has; the pane and the conversation are the
     server's business; and which run recorded it is what its own id carries —
     the route refuses a foreign one by name rather than the page parsing it. */
  | "sessionId"
  | "paneId"
  | "claudeSessionId"
  | "serverInstanceId"
> & {
  /** What `releaseHold` names, with the version below. Opaque, like an item id. */
  id: string;
  /**
   * **SENT BACK VERBATIM WITH THE RELEASE, AND THAT IS THE SAFETY PROPERTY.**
   * It says which reading the person was looking at, so a phone that has been
   * in a pocket since another uncertain send landed is refused rather than
   * clearing a hold whose reason nobody has read.
   */
  version: number;
  /**
   * The server's sentence — what a person decides from — or **null when it did
   * not read**.
   *
   * `| null` since the review of Stage 4, and the nullability is the fix rather
   * than a loosening. `why` used to be load-bearing in the parse: one bad
   * descriptive field rejected the whole object, so a hold with a perfectly
   * readable `id` and `version` became **unclearable**, both gestures withheld
   * over a missing sentence. The address and the description are now parsed
   * separately: if the page can address the hold it can release it, and a
   * missing sentence is answered with a generic warning rather than with the
   * removal of the only way out.
   */
  why: string | null;
  /** What was read about the most recent send, or null when the server did not say. */
  reading: UncertainSendReading | null;
  /** Which send path it came down, or null when the server did not say. */
  origin: UncertainSendOrigin | null;
  /** How many uncertain sends this hold has absorbed, or null. */
  incidents: number | null;
  openedAt: number | null;
  lastSendAt: number | null;
  /** The tmux server it was opened against, or null. */
  tmuxGeneration: number | null;
  /** The first tmux server seen after it opened, or null. `wire.ts` says why. */
  firstSeenGeneration: number | null;
  /** Where the hold has got to, or null when the server did not say. */
  outcome: HoldOutcome | null;
  /**
   * Whether the server watched this hold open or read it off a disk at
   * startup, or null when it did not say.
   *
   * **NULL IS NOT `observed-here`.** A server too old to send the field has
   * made no claim, and drawing a rehydrated hold as one this dashboard watched
   * happen is the exact overstatement `HoldBasis` exists to stop. The page says
   * nothing extra when this is null.
   */
  basis: HoldBasis | null;
};

/**
 * Is this session being held back right now?
 *
 * **A FUNCTION RATHER THAN `quarantine !== null`, because a released or
 * superseded hold is still on the wire.** The server keeps the record so the
 * page can say what happened to it; treating any record as a live hold would
 * grey out a session nothing is stopping. A hold whose `outcome` the server did
 * not describe is treated as live, which is the conservative direction: showing
 * a stopped queue that is not stopped is a smaller failure than showing a
 * flowing one that is.
 */
export function isHolding(hold: HoldView | null): boolean {
  if (hold === null) return false;
  return hold.outcome === null || hold.outcome.kind === "holding";
}

/**
 * Is anything in this queue genuinely ahead of a message queued now?
 *
 * The page offers Queue on an idle session only when something is already in
 * the line, because ordering is then the only thing the queue is for. **An item
 * that will never be delivered is ahead of nothing**: an `invalidated` one
 * (permanent) and a `stale` one (nothing sends it unasked) are both in `items`
 * and neither is a reason to prefer the slower button, so `items.length` is the
 * wrong question. The count is the queue's own rule — `isDeliverable` — because
 * a second opinion in a component would drift from it.
 *
 * A server too old to send the count falls back to "is there anything at all",
 * which is what this page asked before the field existed: over-offering a
 * button is a smaller failure than hiding one on the strength of a field
 * nobody sent.
 */
export function hasDeliverable(queue: QueueView | null): boolean {
  if (queue === null) return false;
  if (queue.deliverable !== null) return queue.deliverable > 0;
  return queue.items.length > 0;
}

export const ASSUMED_VOLATILE_WARNING =
  "The server did not say whether these survive a restart, so assume they do not: nothing here is known to be written to disk.";

/** A finite number the server actually sent, or null. NaN and Infinity are not numbers here. */
function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function millis(v: unknown): number | null {
  return finite(v);
}

/** A boolean the server actually sent, or null. An absent flag is not a `false`. */
function flag(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function parsePayload(v: unknown): QueuedView | null {
  if (!isRecord(v)) return null;
  if (v["kind"] === "message") {
    const text = str(v["text"]);
    return text === null ? { kind: "unrecognised", why: "a queued message with no text in it" } : { kind: "message", text };
  }
  if (v["kind"] === "action") {
    /* Both spellings accepted: queue.ts holds the whole `Action`, and a route
       that flattens it to an id is the obvious simplification somebody may
       make. Neither is worth a round trip to find out. */
    const action = isRecord(v["action"]) ? v["action"] : null;
    const actionId = str(v["actionId"]) ?? (action === null ? null : str(action["id"]));
    if (actionId === null) return { kind: "unrecognised", why: "a queued action with no id on it" };
    const label = (action === null ? null : str(action["label"])) ?? str(v["label"]) ?? actionId;
    const text = action === null ? null : str(action["text"]);
    return { kind: "action", actionId, label, text };
  }
  return null;
}

/**
 * One item, as the server sends it — or null when this page cannot read it.
 *
 * Extracted from `parseQueue` rather than copied beside it, because the clear
 * response carries items too (`removed`, `keptInFlight`) and a second hand-
 * written reading of the same shape is precisely the twin declaration
 * docs/postmortems/260908b is about. There is one reading of a queued item on
 * this page.
 *
 * `stale` and `stuck` are absent from the items a clear hands back — they are
 * the queue's judgment about delivery and a removed item has no delivery — and
 * `flag()` turns that absence into `null`, which is "no claim made" rather than
 * `false`. That is the same rule as everywhere else here and it is why the
 * clear card never calls `itemState`.
 */
export function parseQueueItem(v: unknown): QueueItemView | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  const payload = parsePayload(v["payload"]);
  if (id === null || payload === null) return null;
  return {
    id,
    payload,
    enqueuedAt: millis(v["enqueuedAt"]),
    leasedAt: millis(v["leasedAt"]),
    invalidated: str(v["invalidated"]),
    stale: flag(v["stale"]),
    stuck: flag(v["stuck"]),
    speaker: v["speaker"] === "greg" || v["speaker"] === "overseer" ? v["speaker"] : null,
  };
}

/**
 * One hold, as the server sends it — or null when this page cannot **address**
 * it.
 *
 * **THE RELEASE ADDRESS IS PARSED ON ITS OWN, AND ONLY IT IS LOAD-BEARING.**
 * `id` and `version` are what a release is built from: without an id there is
 * nothing to name, and without a version the release would be built from a
 * reading nobody can pin, which is what stops a phone that has been in a pocket
 * clearing a hold that has since absorbed another incident. Everything else —
 * `why` included — folds to `null`, meaning *no claim*, the way `stale` and
 * `speaker` do.
 *
 * **`why` USED TO BE LOAD-BEARING HERE AND THAT WAS THE BUG.** One bad
 * descriptive field rejected the whole object, so a hold this page could
 * perfectly well have released became one it drew as unreadable and offered no
 * way out of. A missing sentence is a reason to warn; it is never a reason to
 * take away the only gestures that end a hold.
 */
export function parseHold(v: unknown): HoldView | null {
  if (!isRecord(v)) return null;
  const id = str(v["id"]);
  const version = finite(v["version"]);
  if (id === null || version === null) return null;
  const reading = v["reading"];
  const origin = v["origin"];
  return {
    id,
    version,
    why: str(v["why"]),
    reading:
      reading === "partial" || reading === "unknown" || reading === "threw" || reading === "none-contradicted"
        ? reading
        : null,
    origin: origin === "queued-delivery" || origin === "direct-steer" || origin === "broadcast" ? origin : null,
    incidents: finite(v["incidents"]),
    openedAt: millis(v["openedAt"]),
    lastSendAt: millis(v["lastSendAt"]),
    tmuxGeneration: finite(v["tmuxGeneration"]),
    firstSeenGeneration: finite(v["firstSeenGeneration"]),
    outcome: parseHoldOutcome(v["outcome"]),
    basis: parseHoldBasis(v["basis"]),
  };
}

/**
 * How much this hold's record is entitled to claim, or null.
 *
 * **AN UNRECOGNISED `kind` IS NULL RATHER THAN THE HARMLESS-LOOKING ARM**, the
 * same rule `parseHoldOutcome` keeps: `observed-here` would be the tempting
 * default and it is a claim — *this dashboard was there* — which is the one
 * thing a page must never invent on a server's behalf.
 */
function parseHoldBasis(v: unknown): HoldBasis | null {
  if (!isRecord(v)) return null;
  if (v["kind"] === "observed-here") return { kind: "observed-here" };
  if (v["kind"] === "rehydrated-hold") {
    const recordedAt = millis(v["recordedAt"]);
    return recordedAt === null ? null : { kind: "rehydrated-hold", recordedAt };
  }
  if (v["kind"] === "rehydrated-attempt") {
    const attemptedAt = millis(v["attemptedAt"]);
    return attemptedAt === null ? null : { kind: "rehydrated-attempt", attemptedAt };
  }
  return null;
}

/**
 * Where a hold has got to, or null when the server said nothing this page knows.
 *
 * **AN UNRECOGNISED `kind` IS `null`, NOT `holding`.** The two would be drawn
 * the same way — `isHolding` treats an absent outcome as live — but they are
 * different facts and the fold happens in one named place rather than by a
 * parse quietly picking the safe-looking arm.
 */
function parseHoldOutcome(v: unknown): HoldOutcome | null {
  if (!isRecord(v)) return null;
  if (v["kind"] === "holding") return { kind: "holding" };
  const at = millis(v["at"]);
  const what = str(v["what"]);
  if (v["kind"] === "released") {
    const gesture = v["gesture"];
    if (gesture !== "operator-confirmed" && gesture !== "abandoned-unknown") return null;
    if (at === null || what === null) return null;
    return { kind: "released", gesture, at, what };
  }
  if (v["kind"] === "superseded") {
    const was = finite(v["was"]);
    const now = finite(v["now"]);
    if (at === null || what === null || was === null || now === null) return null;
    return { kind: "superseded", at, was, now, what };
  }
  return null;
}

export function parseQueue(v: unknown): QueueView | null {
  if (!isRecord(v)) return null;
  const sessionId = str(v["sessionId"]);
  if (sessionId === null) return null;
  const items: QueueItemView[] = [];
  let unreadableItems = 0;
  /* ABSENT IS NOT EMPTY. A queue whose item list this page cannot read is not a
     queue with nothing in it — see `itemsUnreadable`. */
  const rawItems = v["items"];
  const itemsUnreadable = !Array.isArray(rawItems);
  const raw = Array.isArray(rawItems) ? rawItems : [];
  for (const item of raw) {
    const read = parseQueueItem(item);
    if (read === null) {
      unreadableItems += 1;
      continue;
    }
    items.push(read);
  }
  const rawHold = v["quarantine"];
  const hold = parseHold(rawHold);
  return {
    sessionId,
    items,
    warning: str(v["warning"]) ?? ASSUMED_VOLATILE_WARNING,
    deliverable: finite(v["deliverable"]),
    unreadableItems,
    itemsUnreadable,
    quarantine: hold,
    /* PRESENT AND UNADDRESSABLE, not merely absent. `null` and `undefined` are
       the server saying there is no hold (or an older server saying nothing); an
       object whose id or version would not parse is a hold this page cannot
       release, and the row has to survive so that at least the FACT of it is on
       screen. Anything less than that — a bad `why`, an unknown `reading` — is
       drawn with both gestures and a warning. */
    holdUnreadable: rawHold !== null && rawHold !== undefined && hold === null,
  };
}

/* ------------------------------------------------------------------ *
 * The whole feed.
 * ------------------------------------------------------------------ */

/**
 * What `GET /api/actions` gave us.
 *
 * **The two `…Offered` flags are the point of this type.** An empty catalogue
 * and a server that sent no catalogue are opposite claims — one says *there is
 * nothing you can do*, the other says *this page could not find out what you
 * can do* — and collapsing them into `actions: []` is how a page comes to draw
 * a calm empty panel over a server it is failing to read. Same argument as
 * `collected` on the sessions list.
 */
export type ActionsFeed = {
  actions: ClientAction[];
  catalogue: CatalogueReading;
  unreadableActions: number;
  queues: QueueView[];
  queuesOffered: boolean;
  /**
   * Whether this server will act at all, as it said. See `ActingReading`.
   *
   * Read rather than inferred: `FLEET_ACT_ENABLED` is off by default, so on the
   * live page every enacted button and every broadcast refuses — and until this
   * field was parsed the only way to find that out was to press one.
   */
  acting: ActingReading;
};

/**
 * What this page found where the catalogue should be. **THREE ANSWERS, NOT TWO.**
 *
 * `catalogueOffered: boolean` used to live here, and the missing third answer is
 * how every action button on the dashboard came to be invisible for the life of
 * the feature (2026-09-08). The route sends `actions: {session, box}`; this
 * parser asked `Array.isArray(actions)`, which is false for an object, and the
 * `false` flowed into `catalogueOffered` — so the page drew *"this server sent
 * no list of actions at all… it is probably older than this page"* over a server
 * that had just sent the whole vocabulary. A shape mismatch became a confident
 * claim about the server, in the direction that makes it nobody's fault.
 *
 * The distinction the flag existed for is still right and is kept: *an empty
 * catalogue and a server that sent no catalogue are opposite claims.* What it
 * could not say is the third thing — **there was something there and this page
 * could not read it** — which is the arm a shape change lands in, and it names
 * the page rather than the server.
 */
export type CatalogueReading =
  /** `actions` was there and this page read it. Whatever it found is in `actions`. */
  | { kind: "read" }
  /** No `actions` field at all. */
  | { kind: "absent" }
  /** Something was there, and it is not a catalogue this build understands. */
  | { kind: "unreadable"; why: string };

/**
 * The catalogue, in the shape the route actually sends it.
 *
 * **`{session: Action[], box: Action[]}`, and nothing else is accepted.** Being
 * tolerant of a flat array here is what would let the next fixture disagree with
 * the server and still pass; the route has never sent one, so an array is
 * `unreadable` like anything else. Each arm is read independently — a server
 * that sent `session` and not `box` has still sent a catalogue — and the entries
 * are flattened into one list, because `scope` is on every entry and
 * `sessionActions`/`boxActions` filter by it.
 */
function parseCatalogue(raw: unknown): { reading: CatalogueReading; actions: ClientAction[]; unreadable: number } {
  if (raw === undefined || raw === null) return { reading: { kind: "absent" }, actions: [], unreadable: 0 };
  if (!isRecord(raw)) {
    return {
      reading: {
        kind: "unreadable",
        why: `it sent ${Array.isArray(raw) ? "a plain list" : JSON.stringify(typeof raw)} where the catalogue should be, and this page expects one list of session actions and one of box actions`,
      },
      actions: [],
      unreadable: 0,
    };
  }
  const arms = [raw["session"], raw["box"]];
  if (!arms.some((arm) => Array.isArray(arm))) {
    return {
      reading: {
        kind: "unreadable",
        why: "the catalogue it sent has neither a list of session actions nor a list of box actions in it",
      },
      actions: [],
      unreadable: 0,
    };
  }
  const actions: ClientAction[] = [];
  let unreadable = 0;
  for (const arm of arms) {
    if (!Array.isArray(arm)) continue;
    for (const item of arm) {
      const one = parseAction(item);
      if (one === null) unreadable += 1;
      else actions.push(one);
    }
  }
  return { reading: { kind: "read" }, actions, unreadable };
}

/**
 * Whether this server will actually DO anything, in its own words.
 *
 * `FLEET_ACT_ENABLED` gates every enacted action and every broadcast, and it is
 * off by default. The route sends the flag under a comment that says exactly
 * why — *"TOLD, NOT INFERRED: the page cannot honestly warn about a flag it has
 * never been told, and the alternative is a person discovering it by tapping
 * and getting a 503"* — and for the life of the feature this parser did not
 * read it, so the alternative is what happened.
 *
 * Three arms rather than a boolean, for the reason `CatalogueReading` has
 * three: *off* and *this server never said* are different sentences, and a
 * `false` that meant both would either cry wolf at every older server or say
 * nothing at the one place a warning is owed.
 */
export type ActingReading =
  /** It said acting is on. The buttons will be tried. */
  | { kind: "on" }
  /** It said acting is off, in `why` — which is the server's sentence, never one written here. */
  | { kind: "off"; why: string }
  /** No `acting` field. Nothing is claimed, and nothing is warned. */
  | { kind: "not-told" };

const ACTING_OFF_FALLBACK =
  "this server did not say why, only that acting is switched off";

function parseActing(raw: unknown): ActingReading {
  if (!isRecord(raw)) return { kind: "not-told" };
  const enabled = raw["enabled"];
  if (enabled === true) return { kind: "on" };
  if (enabled === false) return { kind: "off", why: str(raw["why"]) ?? ACTING_OFF_FALLBACK };
  return { kind: "not-told" };
}

/**
 * The one sentence to put in front of a button that will refuse, or null.
 *
 * Null when acting is on AND when the server never said — silence is not a
 * warning, and a page that warned on silence would put a red line on every
 * older server for ever.
 */
export function actingWarning(feed: ActionsFeed | null): string | null {
  if (feed === null || feed.acting.kind !== "off") return null;
  return feed.acting.why;
}

export function parseActionsFeed(raw: unknown): ActionsFeed | null {
  if (!isRecord(raw)) return null;
  const catalogue = parseCatalogue(raw["actions"]);
  const actions = catalogue.actions;
  const unreadableActions = catalogue.unreadable;
  const rawQueues = raw["queues"];
  const queues: QueueView[] = [];
  if (Array.isArray(rawQueues)) {
    for (const item of rawQueues) {
      const one = parseQueue(item);
      if (one !== null) queues.push(one);
    }
  }
  return {
    actions,
    catalogue: catalogue.reading,
    unreadableActions,
    queues,
    queuesOffered: Array.isArray(rawQueues),
    acting: parseActing(raw["acting"]),
  };
}

/** The session-scope entries, which is `sessionActions()` read off the wire. */
export function sessionActions(feed: ActionsFeed | null): ClientAction[] {
  return (feed?.actions ?? []).filter((a) => a.scope === "session");
}

/** The box-scope entries, which is `boxActions()` read off the wire. */
export function boxActions(feed: ActionsFeed | null): ClientAction[] {
  return (feed?.actions ?? []).filter((a) => a.scope === "box");
}

/** One session's queue out of the feed, or null when there is none. */
export function queueFor(feed: ActionsFeed | null, sessionId: string): QueueView | null {
  return feed?.queues.find((q) => q.sessionId === sessionId) ?? null;
}

/* ------------------------------------------------------------------ *
 * The bodies. Pure functions of what was on screen.
 * ------------------------------------------------------------------ */

/**
 * WHO IS SPEAKING, and from this page it is always a person.
 *
 * The server prepends a line saying which of Greg and the Overseer sent a
 * message, because every message reaches an agent as an ordinary user turn and
 * a coordinator's suggestion must not read as an instruction from Greg
 * (tools/fleet/actions.ts § `Speaker`). `parseSpeaker` defaults an absent field
 * to the WEAKER claim, so omitting it here would be safe — and would mean every
 * message a person taps out arrived labelled as an automated coordinator's.
 * Saying it is both the honest answer and the one the server's comment asks
 * for: "a caller that wants Greg's authority has to ask for it in as many
 * words."
 *
 * A literal rather than a parameter because this bundle only ever runs in front
 * of a person. The day something automated posts these bodies it will not be
 * this file, and it will have to say so itself.
 */
const GREG = "greg" as const;

/**
 * Pressing an action button.
 *
 * `steerTargetBody` is imported, not copied: the five identity fields have one
 * builder in this client and adding a second is how they drift. `kind` is
 * additive — a server that only reads `actionId` is unaffected by it — and it
 * exists so that a queued MESSAGE and a queued ACTION can go to one endpoint,
 * which is what makes one ordered queue possible (queue.ts § QueuedPayload:
 * "two queues cannot promise that").
 */
export type SessionActionBody = SteerTargetBody & { kind: "action"; actionId: string; speaker: "greg" };
export type SessionMessageBody = SteerTargetBody & { kind: "message"; text: string; speaker: "greg" };

export function sessionActionBody(row: FleetRow, actionId: string): SessionActionBody {
  return { ...steerTargetBody(row), kind: "action", actionId, speaker: GREG };
}

export function sessionMessageBody(row: FleetRow, text: string): SessionMessageBody {
  return { ...steerTargetBody(row), kind: "message", text, speaker: GREG };
}

/**
 * `mode`, WHICH IS THE FIELD THE ROUTE READS.
 *
 * This said `dryRun: boolean` until 2026-09-08 and the route has only ever
 * parsed `mode` — so every box action ever pressed on this page was a dry run,
 * including the one behind the second tap, and the panel then said "Done."
 * over it. `parseMode` defaults this route to `dry-run`, which is why the
 * mismatch was survivable rather than dangerous; it is still a button that has
 * never once done what it says.
 *
 * `confirm` is the second half of the same silence. The route refuses a `run`
 * of an action whose `needsConfirm` is true unless the body says so, and this
 * page never said so — so even a body that had reached the route as a run would
 * have been refused `confirm-required`. It is `!dryRun` rather than a parameter
 * because on this page the only thing that asks for a real run IS the second
 * tap: `commit` runs after the person has read the preview, which is exactly
 * the claim the field makes. A caller that wants to run without confirming
 * should not be calling this function.
 *
 * `speaker` is sent for the same reason `sessionActionBody` sends one: a
 * broadcast is rendered with the sender's name in front of it, and an absent
 * field means the weaker claim.
 *
 * `recipients` IS WHO THE BROADCAST IS FOR, AND WITHOUT IT THERE IS NOBODY.
 * This body had no such field until 2026-09-09, so `broadcastRoute` refused
 * every press on its first line — `a broadcast needs recipients` — before it
 * selected anybody, and the button had never once reached a session. The rule
 * it refuses on is deliberate and is the route's to keep: a broadcast must act
 * on **the list the person was actually looking at**, not on a list the server
 * re-fetches behind them, so the caller has to say what it saw.
 *
 * So these are the rows the page is showing, mapped through the SAME
 * `steerTargetBody` the session path uses: the identifiers and the server's own
 * `rawStatus` object, copied off the snapshot and not re-read. The discipline is
 * `cancelBody`'s and `clearBody`'s — a stale-but-honest claim, checked at the
 * far end — and rebuilding or refreshing the list here would defeat the point,
 * because a claim the client refreshed to make true is a claim about nothing.
 * The status in particular must be `rawStatus` rather than the parsed
 * `row.status`: see steer-client.ts § `SteerTargetBody`.
 *
 * An enacted kill reads `pids` rather than this field and has the same gap;
 * that is the preview envelope's to close, not this function's.
 */
export type BoxActionBody = {
  actionId: string;
  mode: "dry-run" | "run";
  confirm: boolean;
  speaker: "greg";
  recipients: SteerTargetBody[];
};

/**
 * The rows that are ADDRESSES, which is not all of them — and sending the rest
 * cost the fix its first evening.
 *
 * `parseTarget` requires a `paneId` and a `claudeSessionId` on every recipient
 * and **refuses the whole request over any one that lacks either**, which is
 * right for a route: an unaddressable target is a caller bug, not a delivery
 * outcome. A real fleet always holds a few — a shell, and a session too old to
 * have pinned a conversation id — so a body carrying the page's rows entirely
 * raw was answered `400 a recipient is not addressable` by the running server
 * on 2026-09-09, with 23 rows in it. One shell on the box and the broadcast
 * still reached nobody.
 *
 * This is NOT the client second-guessing the server's selection rule. Which
 * rows may be SPOKEN TO stays entirely the route's: a working session, a shell,
 * a session at a dialog are all sent, and come back `held` or `blocked` with
 * the reason. What is dropped here is only what steer-client.ts already calls
 * unsteerable-by-construction — *a null `claudeSessionId` means the row cannot
 * be steered at all* — because it is not a claim about a session, it is a row
 * with nowhere to send anything.
 *
 * And the narrowing is not silent: `BoxActions` counts what this drops and says
 * so under the confirmation, because a denominator that quietly shrank would be
 * this whole stage's own defect one layer up.
 */
export function addressableRows(rows: readonly FleetRow[]): FleetRow[] {
  return rows.filter((row) => row.paneId !== null && row.claudeSessionId !== null);
}

export function boxActionBody(actionId: string, dryRun: boolean, rows: readonly FleetRow[]): BoxActionBody {
  return {
    actionId,
    mode: dryRun ? "dry-run" : "run",
    confirm: !dryRun,
    speaker: GREG,
    recipients: addressableRows(rows).map(steerTargetBody),
  };
}

/**
 * Cancelling a queued item.
 *
 * Deliberately NOT a `SteerTargetBody`. Cancelling removes something from the
 * dashboard's own memory and types nothing at any pane, so the tmux claims
 * would be decoration — and requiring them would mean an item could not be
 * cancelled from a view that has the queue but not the row, which is exactly
 * the fleet-wide view on the Orchestrator tab. Both fields still come verbatim
 * off the snapshot the person was looking at.
 */
export type CancelBody = { sessionId: string; itemId: string };

export function cancelBody(sessionId: string, itemId: string): CancelBody {
  return { sessionId, itemId };
}

/**
 * Emptying a queue, and **the list is what makes it safe**.
 *
 * `itemIds` is what this page had on screen and offered to drop, copied off the
 * snapshot in the same spirit as everything else in this file: a stale-but-
 * honest claim, checked at the far end. The server compares it with the queue's
 * own droppable set and refuses `stale-view` on any difference, so an item that
 * arrived between the confirmation being drawn and the tap cannot be destroyed
 * unread — which is the one thing a bulk delete must not do.
 *
 * The obvious body was `{sessionId}` alone, since `clear()` takes only that.
 * It was rejected here and in routes-actions.ts for the same reason: it cannot
 * say *the list I read*, and there is then nothing to check against.
 */
export type ClearBody = { sessionId: string; itemIds: string[] };

export function clearBody(sessionId: string, itemIds: readonly string[]): ClearBody {
  return { sessionId, itemIds: [...itemIds] };
}

/**
 * Ending a hold, and **neither gesture sends anything.**
 *
 * No `sessionId`: a hold is addressed by its own id, so this works for a
 * session that has ended, whose queue is empty, or whose pane is gone — which
 * are exactly the holds somebody most needs to clear. `version` is `itemIds`'s
 * counterpart: it says which reading was on screen, so a phone that has been in
 * a pocket since another uncertain send landed is refused rather than clearing
 * a hold whose reason nobody has read.
 *
 * Sending the same body twice is safe and is the point — a lost response is
 * recoverable by pressing again, and the answer says `repeat`.
 */
export type ReleaseHoldBody = { holdId: string; version: number; gesture: HoldReleaseGesture };

export function releaseHoldBody(holdId: string, version: number, gesture: HoldReleaseGesture): ReleaseHoldBody {
  return { holdId, version, gesture };
}

/* ------------------------------------------------------------------ *
 * Outcomes.
 * ------------------------------------------------------------------ */

/**
 * What became of a press.
 *
 * **`accepted` is the arm that stops this file guessing.** The server may
 * answer `{ok: true}` and say nothing about whether the thing was queued or
 * typed at the pane, and a client that filled that in — "Queued." — would be
 * making a claim nobody made, about the one distinction this feature exists
 * for. So there are three arms, and the third says what it is: taken, and the
 * queue below is what to believe.
 */
/* ------------------------------------------------------------------ *
 * What the server said it DID, read rather than dropped.
 * ------------------------------------------------------------------ */

/**
 * One step of a plan the server ran, as this page reads it.
 *
 * **`status` gains an `unrecognised` arm and the rest is the shared type.**
 * The `Omit<…> & {…}` idiom, for the reason `ClientAction` uses it: a word this
 * build has never heard of must land somewhere visible rather than being
 * dropped or being silently read as one of the three we know — and the step
 * whose status we cannot read is, by construction, the interesting one.
 */
export type StepReading = Omit<PlanStepView, "status"> & { status: PlanStepStatus | "unrecognised" };

/** A plan run off the wire. `action` is a plain string: it is somebody else's vocabulary. */
export type PlanRunReading = Omit<PlanRunView, "steps"> & { steps: StepReading[] };

function stepStatus(v: unknown): PlanStepStatus | "unrecognised" {
  return v === "passed" || v === "failed" || v === "failed-ignored" ? v : "unrecognised";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The `run` on a refusal, or null when the body carried none.
 *
 * **THIS IS THE WHOLE OF DEFECT C.** `routes-actions.ts` puts a complete
 * `PlanRun` on a `plan-failed` refusal — which step ran, which one said no, and
 * in whose words — and `refusal()` read `code` and `why` and threw the rest
 * away. The card then printed *this page cannot tell whether the action took
 * effect* over a body that said, step by step, exactly what had taken effect.
 *
 * Null rather than an empty run when it is absent, because *the server did not
 * describe a run* and *the server described a run of no steps* are different
 * facts and only the first is common.
 */
export function parsePlanRun(v: unknown): PlanRunReading | null {
  if (!isRecord(v)) return null;
  const raw = v["steps"];
  if (!Array.isArray(raw)) return null;
  const steps: StepReading[] = [];
  for (const s of raw) {
    if (!isRecord(s)) continue;
    steps.push({
      argv: Array.isArray(s["argv"]) ? s["argv"].filter((a): a is string => typeof a === "string") : [],
      cwd: str(s["cwd"]) ?? "",
      why: str(s["why"]) ?? "",
      status: stepStatus(s["status"]),
      verdict: str(s["verdict"]) ?? "",
      code: num(s["code"]),
      timedOut: s["timedOut"] === true,
      spawnError: str(s["spawnError"]),
      tail: str(s["tail"]) ?? "",
    });
  }
  return {
    action: str(v["action"]) ?? "",
    steps,
    /* A server that predates the field says nothing, and `steps.length` is the
       only floor available — never a guess at a larger plan. It makes the card
       say *2 of 2*, which is what this page could honestly read before the
       field existed. */
    planned: num(v["planned"]) ?? steps.length,
    /* `=== true`, so a body that omitted the field is NOT read as completed.
       The safe default for a claim of completeness is the one that claims
       less. */
    completed: v["completed"] === true,
    stoppedAt: num(v["stoppedAt"]),
  };
}

/**
 * One state and how many rows are in it.
 *
 * **`state` IS A STRING RATHER THAN A UNION**, and that is the deliberate half.
 * The server's vocabulary is in `wire.ts` and this page knows it, but a page
 * that refused a word it had not heard of would DROP the rows that had changed
 * — which is the one group a reader most needs to see. So an unknown word is
 * counted and rendered verbatim; `BOX_STATE_COPY` in ActionButtons.tsx supplies
 * a sentence for the ones we know and falls back to the word for the rest.
 */
export type StateCount = { state: string; count: number };

/**
 * **PER-RECIPIENT AND PER-PID STATE, COUNTED — not a single total.**
 *
 * A broadcast answers `total: 3` and thirty-six rows; a kill answers a list of
 * pids. Both used to reach the page as an undifferentiated blob under
 * `RawValue`, where a fan-out that half-landed and one that was declined draw
 * the same shape and the heading above them said "Done." either way.
 *
 * Null on `BoxOutcome` when the answer carried nothing this page recognises —
 * never an empty count list, which would read as *nothing was in any state*.
 */
export type BoxEffectReading =
  | { kind: "broadcast"; recipients: number; states: StateCount[] }
  | { kind: "kill"; targeted: number; states: StateCount[] };

/** Counts by state word, in first-seen order, so the rendering is stable. */
function countStates(rows: readonly unknown[], field: string): StateCount[] {
  const counts: StateCount[] = [];
  for (const row of rows) {
    const state = (isRecord(row) ? str(row[field]) : null) ?? "unstated";
    const found = counts.find((c) => c.state === state);
    if (found) found.count += 1;
    else counts.push({ state, count: 1 });
  }
  return counts;
}

/**
 * The `result` of a 200, read for the two shapes that describe an effect.
 *
 * Deliberately narrow: it recognises the two arms `routes-actions.ts` sends and
 * returns null for everything else, including a dry run's preview. `RawValue`
 * still draws the whole answer underneath — this is a reading ON TOP of it, not
 * a replacement for it, so a field this function has never heard of is still on
 * the page.
 */
export function parseBoxEffect(result: unknown): BoxEffectReading | null {
  if (!isRecord(result)) return null;
  const recipients = result["recipients"];
  if (Array.isArray(recipients)) {
    return { kind: "broadcast", recipients: recipients.length, states: countStates(recipients, "outcome") };
  }
  const kill = result["kill"];
  if (isRecord(kill) && Array.isArray(kill["observed"])) {
    /* The pids the server SET OUT to signal. Falling back to the evidence list
       when it is missing rather than to zero: the two are the same length on
       every server that sends both, and the denominator a reader sees must not
       shrink because a field went absent. */
    const targeted = Array.isArray(kill["targeted"]) ? kill["targeted"].length : kill["observed"].length;
    return { kind: "kill", targeted, states: countStates(kill["observed"], "observation") };
  }
  return null;
}

export type ActionOutcome =
  | { ok: true; kind: "queued"; position: number | null; why: string | null }
  | { ok: true; kind: "delivered"; sent: string[][] }
  /**
   * One of the three gestures that change an item already in the queue.
   *
   * Its own arm because the three say different things and none of them says
   * "Queued." — which is what the page used to put on screen after a cancel,
   * because the response carries an `item` and that was read as an enqueue.
   * Untrue prose is a defect (§ Stage v0.5f), and "Queued." over an abandoned
   * delivery is the reassuring half of a contradiction.
   */
  | { ok: true; kind: "queue-changed"; op: QueueOp }
  /**
   * A queue emptied, **with the item that survived it**.
   *
   * Its own arm rather than a fourth `QueueOp`, and that is the whole design:
   * an `op` is a word, and this answer has a fact in it that a word cannot
   * carry. `clear()` keeps a leased item on purpose — the keystrokes may have
   * gone — so "cleared" on its own is an ambiguous negative, and the page must
   * be unable to draw it without saying which item stayed. Flattening three
   * facts into one label is the mistake docs/postmortems/260908b ends on.
   *
   * `removed` may be short of what the server actually dropped when an item was
   * unreadable; `unreadable` counts those, so the card can say the list is
   * short rather than quietly presenting it as complete.
   */
  | { ok: true; kind: "queue-cleared"; removed: QueueItemView[]; keptInFlight: QueueItemView | null; unreadable: number }
  /**
   * A hold ended. **Nothing was sent, in either gesture.**
   *
   * Its own arm rather than a fourth `QueueOp` for `queue-cleared`'s reason:
   * `repeat` is a fact a word cannot carry, and the two answers a person needs
   * to be able to tell apart are *that has been recorded* and *that was already
   * recorded, and your first press did work*. A phone loses responses; the
   * whole reason this gesture is idempotent is so pressing again is safe, and
   * a card that could not say which press had counted would waste it.
   */
  | { ok: true; kind: "hold-released"; gesture: HoldReleaseGesture; repeat: boolean }
  | { ok: true; kind: "accepted" }
  /**
   * **A FAILURE IS NOT THE SAME THING AS AN ABSENCE OF EFFECT**, and this arm
   * had no field in which to say so.
   *
   * `from: "client"` means the reply never arrived — the fetch threw, or the
   * body would not parse. The request itself may well have run: these actions
   * delete worktrees, kill processes and type sentences into other people's
   * conversations, and none of that can be taken back. The page printed
   * "Nothing happened." over every one of them, which is the sentence that
   * sends a person to press it again.
   *
   * `delivery` is REQUIRED, and its four arms are the ones steer-client.ts
   * already established. Optional would let a producer omit it silently and
   * leave the renderer picking a default, which is the same defect wearing a
   * question mark. `not-told` is the arm for a body that carried no delivery —
   * and, because `parseDelivery` folds them together, for one that carried a
   * word this build cannot read.
   *
   * **What this field is NOT.** `Delivery` is about keystrokes: it is minted by
   * `fire()` in steer.ts from a sequence of `tmux send-keys` calls. It has no
   * opinion about whether a queue changed, a worktree went, or a process died.
   * A whole-action outcome is a different fact and there is no field for it
   * yet — do not borrow this one for it, and see `ACTION_DELIVERY_COPY` in
   * ActionButtons.tsx, which is where the temptation actually lands.
   *
   * **`run` IS THAT WHOLE-ACTION CONTRACT, FOR ONE REFUSAL.** `plan-failed`
   * carries the plan the server ran — see `parsePlanRun`. It is REQUIRED and
   * nullable rather than optional, for `delivery`'s reason: a producer that may
   * omit a field leaves the renderer picking a default, which is this defect
   * wearing a question mark. `null` means the body said nothing about a run,
   * which is true of every other refusal on these routes.
   */
  | {
      ok: false;
      code: string;
      why: string;
      status: number | null;
      from: "server" | "client";
      delivery: DeliveryReading;
      run: PlanRunReading | null;
    };

export type QueueOp = "cancelled" | "revived" | "abandoned";

function queueOp(v: unknown): QueueOp | null {
  return v === "cancelled" || v === "revived" || v === "abandoned" ? v : null;
}

/**
 * What became of a box action.
 *
 * `dryRun` is read back off the ANSWER rather than remembered from the request.
 * A server that ignored the flag and killed things would otherwise be reported
 * on this page as having answered a question — which is the single worst thing
 * this panel could get wrong, and the one place where believing our own request
 * instead of the reply would hide it.
 */
export type BoxOutcome =
  | {
      ok: true;
      dryRun: boolean;
      dryRunStated: boolean;
      /**
       * WHAT THE BOX DID, OR WOULD DO, in the server's own structure — the
       * steps, the candidate pids, the recipients, the sample sentence.
       *
       * **One name, and it is the server's** (`routes-actions.ts` §
       * What a box action answers). This used to read `would ?? result`, and
       * neither of those was a field any route had ever sent, so the panel a
       * person reads before pressing *kill* rendered the literal grey word
       * "null" — every 200 answered, every test passed, and the two hand-written
       * declarations simply disagreed about a word. An alias here is what made
       * that survivable; there is one name now on purpose.
       *
       * `null` means the server sent nothing under it, which the panel says out
       * loud rather than drawing as an empty preview.
       */
      result: unknown;
      why: string | null;
      /**
       * **THE SAME ANSWER, READ RATHER THAN DUMPED.** `result` above is drawn
       * by `RawValue`, which knows no schema and so cannot tell a fan-out that
       * half-landed from one that was declined — both are a list of objects.
       * This is the per-recipient and per-pid state, counted, so the card can
       * say which; `null` when the answer carried neither shape.
       *
       * It does not replace `result`, it sits above it. Nothing the server
       * sends stops being on the page.
       */
      effect: BoxEffectReading | null;
    }
  /** Same arm, same reasoning, and here the request kills processes. See `ActionOutcome`. */
  | {
      ok: false;
      code: string;
      why: string;
      status: number | null;
      from: "server" | "client";
      delivery: DeliveryReading;
      run: PlanRunReading | null;
    };

export type FeedOutcome = { ok: true; feed: ActionsFeed } | { ok: false; why: string };

/** The seam, the same shape as `SteerApi` and for the same reason. */
export type ActionsApi = {
  feed: () => Promise<FeedOutcome>;
  run: (row: FleetRow, actionId: string) => Promise<ActionOutcome>;
  queueMessage: (row: FleetRow, text: string) => Promise<ActionOutcome>;
  cancel: (sessionId: string, itemId: string) => Promise<ActionOutcome>;
  /** Re-arm a stale item's clock, so the next drain pass may deliver it. */
  revive: (sessionId: string, itemId: string) => Promise<ActionOutcome>;
  /** Clear a lease nobody settled. It recalls nothing; see the confirmation copy. */
  abandon: (sessionId: string, itemId: string) => Promise<ActionOutcome>;
  /**
   * Empty one session's queue. `itemIds` is the list the person read — see
   * `clearBody` — and an item already going out is kept, not dropped.
   */
  clear: (sessionId: string, itemIds: readonly string[]) => Promise<ActionOutcome>;
  /**
   * End a hold on a session. **Neither gesture sends anything** — see
   * `releaseHoldBody`. Safe to call twice with the same arguments.
   */
  releaseHold: (holdId: string, version: number, gesture: HoldReleaseGesture) => Promise<ActionOutcome>;
  /**
   * A box-wide action. **`rows` is required, and it is the fix for a button
   * that could not reach anybody** — see `boxActionBody`. It is the list the
   * page is showing, verbatim; a caller with nothing on screen passes an empty
   * array and gets the server's refusal, which is the true answer.
   */
  box: (actionId: string, dryRun: boolean, rows: readonly FleetRow[]) => Promise<BoxOutcome>;
};

/** A thrown thing, as a sentence. Never "[object Object]". */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

function parseSent(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  const out: string[][] = [];
  for (const call of v) {
    if (!Array.isArray(call)) continue;
    out.push(call.filter((a): a is string => typeof a === "string"));
  }
  return out;
}

/**
 * `delivery` on the failure half because **this is where the fact is known**.
 *
 * Both failures below are the same fact — no answer came back — and the honest
 * reading of that is `unknown`, never `none`. `none` would be this browser
 * claiming, on no evidence at all, that a request it never heard the end of had
 * no effect.
 */
type Posted =
  | { response: Response; parsed: unknown }
  | { failure: { code: string; why: string; status: number | null; delivery: DeliveryReading; run: PlanRunReading | null } };

async function postJson(url: string, body: unknown, fetchImpl: typeof fetch): Promise<Posted> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      // The exact content type is half the CSRF defence: a cross-site HTML form
      // cannot set a header. Same as steer-client.ts.
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    });
  } catch (cause) {
    // The request may have been received and acted on; what failed is our
    // hearing the answer. `unknown`, and it is not a hedge.
    return {
      failure: {
        code: "unreachable",
        why: `this browser could not reach the dashboard: ${describe(cause)}`,
        status: null,
        delivery: { kind: "unknown" },
        // No answer arrived, so there is no run to read — never "a run of no steps".
        run: null,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    return {
      failure: {
        code: "not-json",
        why: `the server answered ${response.status} and the body was not JSON: ${describe(cause)}`,
        status: response.status,
        // A status arrived and the words did not. Whatever it did, it did not
        // tell us — and an unreadable body is not a body that said `none`.
        delivery: { kind: "unknown" },
        run: null,
      },
    };
  }
  return { response, parsed };
}

/** The server's own words when it gave any, and which of us wrote them. */
function refusal(
  response: Response,
  parsed: unknown,
): {
  ok: false;
  code: string;
  why: string;
  status: number;
  from: "server" | "client";
  delivery: DeliveryReading;
  run: PlanRunReading | null;
} {
  const why = isRecord(parsed) && typeof parsed["why"] === "string" ? parsed["why"] : null;
  const code = isRecord(parsed) && typeof parsed["code"] === "string" ? parsed["code"] : null;
  return {
    ok: false,
    code: code ?? "unknown",
    why: why ?? `the server answered ${response.status} without saying why`,
    status: response.status,
    from: why === null ? "client" : "server",
    /* `parseDelivery`, so a word this build has never heard of lands on
       `not-told` rather than on the first branch of a chain of ifs. Most
       refusals on these routes carry no `delivery` at all and are meant not to:
       nothing had been sent when they were written, and the route inventing a
       `none` would be worse than its silence. */
    delivery: parseDelivery(isRecord(parsed) ? parsed["delivery"] : undefined),
    /* AND THE RUN, WHICH THIS FUNCTION USED TO DROP. `plan-failed` is the only
       refusal that carries one today, and it is the one whose card was least
       able to say what had happened — see `parsePlanRun`. */
    run: parsePlanRun(isRecord(parsed) ? parsed["run"] : undefined),
  };
}

function readActionOutcome(response: Response, parsed: unknown): ActionOutcome {
  if (!isRecord(parsed) || parsed["ok"] !== true) return refusal(response, parsed);
  /* BEFORE `queueOp` and before the `item` check, for the same reason `cleared`
     is: this response carries a `hold`, and a reading that fell through to the
     bottom would draw "Done." over the one gesture whose whole value is saying
     precisely what was and was not recorded. The gesture is read off the HOLD
     the server sent back rather than off the request, so a server that recorded
     something else cannot be reported as having agreed with us. */
  if (parsed["op"] === "hold-released") {
    const outcome = parseHoldOutcome(isRecord(parsed["hold"]) ? parsed["hold"]["outcome"] : undefined);
    if (outcome !== null && outcome.kind === "released") {
      return { ok: true, kind: "hold-released", gesture: outcome.gesture, repeat: parsed["repeat"] === true };
    }
    /* The server said it released a hold and did not say how. `accepted` rather
       than inventing a gesture: the page then says the server answered without
       saying what it recorded, which is true, instead of putting a sentence
       about somebody looking at a terminal over a body that never said so. */
    return { ok: true, kind: "accepted" };
  }
  /* BEFORE `queueOp`, and deliberately not one of its words: reading this as a
     bare "cleared" would drop `keptInFlight`, which is the only thing on this
     response that a person must not be left guessing about. */
  if (parsed["op"] === "cleared") {
    const raw = Array.isArray(parsed["removed"]) ? parsed["removed"] : [];
    const removed: QueueItemView[] = [];
    let unreadable = 0;
    for (const item of raw) {
      const read = parseQueueItem(item);
      if (read === null) unreadable += 1;
      else removed.push(read);
    }
    return { ok: true, kind: "queue-cleared", removed, keptInFlight: parseQueueItem(parsed["keptInFlight"]), unreadable };
  }
  /* FIRST, because these responses also carry an `item` and would otherwise be
     read as an enqueue and drawn as "Queued." */
  const op = queueOp(parsed["op"]);
  if (op !== null) return { ok: true, kind: "queue-changed", op };
  /* `queued === false` is a positive claim that it went out now; anything else
     is read off the fields that are actually there, and if none of them are,
     the third arm says so rather than picking one. */
  if (parsed["queued"] === true || isRecord(parsed["item"])) {
    const position = typeof parsed["position"] === "number" && Number.isFinite(parsed["position"]) ? parsed["position"] : null;
    return { ok: true, kind: "queued", position, why: typeof parsed["why"] === "string" ? parsed["why"] : null };
  }
  if (parsed["queued"] === false || Array.isArray(parsed["sent"])) {
    return { ok: true, kind: "delivered", sent: parseSent(parsed["sent"]) };
  }
  return { ok: true, kind: "accepted" };
}

export function makeActionsApi(fetchImpl: typeof fetch = fetch): ActionsApi {
  const send = async (url: string, body: unknown): Promise<ActionOutcome> => {
    const posted = await postJson(url, body, fetchImpl);
    if ("failure" in posted) return { ...posted.failure, ok: false, from: "client" };
    return readActionOutcome(posted.response, posted.parsed);
  };

  return {
    async feed(): Promise<FeedOutcome> {
      let response: Response;
      try {
        response = await fetchImpl(ACTIONS_URL, { cache: "no-store" });
      } catch (cause) {
        return { ok: false, why: `this browser could not reach the dashboard: ${describe(cause)}` };
      }
      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (cause) {
        return { ok: false, why: `the server answered ${response.status} and the body was not JSON: ${describe(cause)}` };
      }
      if (!response.ok) {
        const why = isRecord(parsed) && typeof parsed["why"] === "string" ? parsed["why"] : null;
        return { ok: false, why: why ?? `the server answered ${response.status} without saying why` };
      }
      const feed = parseActionsFeed(parsed);
      if (feed === null) return { ok: false, why: "the server answered something that is not this API" };
      return { ok: true, feed };
    },

    run: (row, actionId) => send(SESSION_ACTION_URL, sessionActionBody(row, actionId)),
    queueMessage: (row, text) => send(SESSION_ACTION_URL, sessionMessageBody(row, text)),
    cancel: (sessionId, itemId) => send(CANCEL_URL, cancelBody(sessionId, itemId)),
    revive: (sessionId, itemId) => send(REVIVE_URL, cancelBody(sessionId, itemId)),
    abandon: (sessionId, itemId) => send(ABANDON_URL, cancelBody(sessionId, itemId)),
    clear: (sessionId, itemIds) => send(CLEAR_URL, clearBody(sessionId, itemIds)),
    releaseHold: (holdId, version, gesture) => send(RELEASE_HOLD_URL, releaseHoldBody(holdId, version, gesture)),

    async box(actionId, dryRun, rows): Promise<BoxOutcome> {
      const posted = await postJson(BOX_ACTION_URL, boxActionBody(actionId, dryRun, rows), fetchImpl);
      if ("failure" in posted) return { ...posted.failure, ok: false, from: "client" };
      const { response, parsed } = posted;
      if (!isRecord(parsed) || parsed["ok"] !== true) return refusal(response, parsed);
      const stated = typeof parsed["dryRun"] === "boolean";
      return {
        ok: true,
        /* The ANSWER's flag, not the request's. See `BoxOutcome`. When the
           server did not state one, `dryRunStated` is false and the panel says
           it cannot tell — it does not fall back to what it asked for. */
        dryRun: stated ? parsed["dryRun"] === true : dryRun,
        dryRunStated: stated,
        result: parsed["result"] ?? null,
        why: typeof parsed["why"] === "string" ? parsed["why"] : null,
        effect: parseBoxEffect(parsed["result"]),
      };
    },
  };
}

/**
 * The default instance. A getter rather than a module-scope binding, for the
 * reason in steer-client.ts: binding `fetch` at import time makes it unstubbable
 * in a test that imports this module first.
 */
export const httpActionsApi: ActionsApi = {
  feed: () => makeActionsApi().feed(),
  run: (row, actionId) => makeActionsApi().run(row, actionId),
  queueMessage: (row, text) => makeActionsApi().queueMessage(row, text),
  cancel: (sessionId, itemId) => makeActionsApi().cancel(sessionId, itemId),
  revive: (sessionId, itemId) => makeActionsApi().revive(sessionId, itemId),
  abandon: (sessionId, itemId) => makeActionsApi().abandon(sessionId, itemId),
  clear: (sessionId, itemIds) => makeActionsApi().clear(sessionId, itemIds),
  releaseHold: (holdId, version, gesture) => makeActionsApi().releaseHold(holdId, version, gesture),
  box: (actionId, dryRun, rows) => makeActionsApi().box(actionId, dryRun, rows),
};
