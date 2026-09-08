/**
 * The action vocabulary, the queues, and the six requests that touch them —
 * `POST /api/actions/session`, `GET /api/actions`, `POST /api/actions/box`,
 * `POST /api/actions/cancel`, and the two recovery gestures
 * `POST /api/actions/revive` and `POST /api/actions/abandon`.
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
 * not from a lookup.
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
import { steerTargetBody, type SteerTargetBody } from "./steer-client";
import type { FleetRow } from "./types";

export const ACTIONS_URL = "api/actions";
export const SESSION_ACTION_URL = "api/actions/session";
export const BOX_ACTION_URL = "api/actions/box";
export const CANCEL_URL = "api/actions/cancel";
/** The two recovery gestures. Both take the same body as cancel; see `cancelBody`. */
export const REVIVE_URL = "api/actions/revive";
export const ABANDON_URL = "api/actions/abandon";

/* ------------------------------------------------------------------ *
 * The vocabulary, as this page reads it.
 * ------------------------------------------------------------------ */

/** Where an action is offered. Anything else parses to `unrecognised`. */
export type ActionScope = "session" | "box";

/**
 * One entry of the catalogue.
 *
 * The three real arms mirror `Action` in tools/fleet/actions.ts. The fourth is
 * this client's, and it is the arm that matters when the two get out of step:
 * an action this build cannot classify is still NAMED on the page, with the
 * reason, and cannot be pressed. Rendering it as a button would mean offering a
 * tap whose consequences nothing on screen can describe.
 */
export type ClientAction =
  | {
      effect: "spoken";
      id: string;
      scope: ActionScope;
      label: string;
      summary: string;
      needsConfirm: boolean;
      /** The exact words that go to the agent. These are the product; never paraphrase them. */
      text: string;
      form: "prose" | "slash-command";
    }
  | {
      effect: "enacted";
      id: string;
      scope: ActionScope;
      label: string;
      summary: string;
      /** Always true on this arm, as on the server's. */
      needsConfirm: true;
      /** The named gate that must pass first, in prose, for the confirmation. */
      gate: string;
    }
  | {
      effect: "broadcast";
      id: string;
      scope: ActionScope;
      label: string;
      summary: string;
      needsConfirm: true;
      stagger: { minMinutes: number; windowMinutes: number } | null;
    }
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
    if (text === null || scope === null) {
      return {
        effect: "unrecognised",
        id,
        scope,
        label,
        summary,
        why:
          text === null
            ? "the server called this a spoken action and sent no words for it, so there is nothing to show you before you send it"
            : `the server sent no scope this page understands for ${JSON.stringify(id)}`,
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
    if (scope === null) {
      return { effect: "unrecognised", id, scope, label, summary, why: `the server sent no scope this page understands for ${JSON.stringify(id)}` };
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

export type QueueItemView = {
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
};

/**
 * One session's queue.
 *
 * `warning` is never null on the page. queue.ts sends `PERSISTENCE_WARNING` on
 * every snapshot; when it does not, this substitutes the honest version of the
 * same fact rather than showing a queue with no note on it.
 */
export type QueueView = {
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
};

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

export function parseQueue(v: unknown): QueueView | null {
  if (!isRecord(v)) return null;
  const sessionId = str(v["sessionId"]);
  if (sessionId === null) return null;
  const items: QueueItemView[] = [];
  let unreadableItems = 0;
  const raw = Array.isArray(v["items"]) ? v["items"] : [];
  for (const item of raw) {
    if (!isRecord(item)) {
      unreadableItems += 1;
      continue;
    }
    const id = str(item["id"]);
    const payload = parsePayload(item["payload"]);
    if (id === null || payload === null) {
      unreadableItems += 1;
      continue;
    }
    items.push({
      id,
      payload,
      enqueuedAt: millis(item["enqueuedAt"]),
      leasedAt: millis(item["leasedAt"]),
      invalidated: str(item["invalidated"]),
      stale: flag(item["stale"]),
      stuck: flag(item["stuck"]),
    });
  }
  return {
    sessionId,
    items,
    warning: str(v["warning"]) ?? ASSUMED_VOLATILE_WARNING,
    deliverable: finite(v["deliverable"]),
    unreadableItems,
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
 * Pressing an action button.
 *
 * `steerTargetBody` is imported, not copied: the five identity fields have one
 * builder in this client and adding a second is how they drift. `kind` is
 * additive — a server that only reads `actionId` is unaffected by it — and it
 * exists so that a queued MESSAGE and a queued ACTION can go to one endpoint,
 * which is what makes one ordered queue possible (queue.ts § QueuedPayload:
 * "two queues cannot promise that").
 */
export type SessionActionBody = SteerTargetBody & { kind: "action"; actionId: string };
export type SessionMessageBody = SteerTargetBody & { kind: "message"; text: string };

export function sessionActionBody(row: FleetRow, actionId: string): SessionActionBody {
  return { ...steerTargetBody(row), kind: "action", actionId };
}

export function sessionMessageBody(row: FleetRow, text: string): SessionMessageBody {
  return { ...steerTargetBody(row), kind: "message", text };
}

export type BoxActionBody = { actionId: string; dryRun: boolean };

export function boxActionBody(actionId: string, dryRun: boolean): BoxActionBody {
  return { actionId, dryRun };
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
  | { ok: true; kind: "accepted" }
  | { ok: false; code: string; why: string; status: number | null; from: "server" | "client" };

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
  | { ok: true; dryRun: boolean; dryRunStated: boolean; would: unknown; why: string | null }
  | { ok: false; code: string; why: string; status: number | null; from: "server" | "client" };

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
  box: (actionId: string, dryRun: boolean) => Promise<BoxOutcome>;
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

type Posted = { response: Response; parsed: unknown } | { failure: { code: string; why: string; status: number | null } };

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
    return { failure: { code: "unreachable", why: `this browser could not reach the dashboard: ${describe(cause)}`, status: null } };
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
      },
    };
  }
  return { response, parsed };
}

/** The server's own words when it gave any, and which of us wrote them. */
function refusal(response: Response, parsed: unknown): { ok: false; code: string; why: string; status: number; from: "server" | "client" } {
  const why = isRecord(parsed) && typeof parsed["why"] === "string" ? parsed["why"] : null;
  const code = isRecord(parsed) && typeof parsed["code"] === "string" ? parsed["code"] : null;
  return {
    ok: false,
    code: code ?? "unknown",
    why: why ?? `the server answered ${response.status} without saying why`,
    status: response.status,
    from: why === null ? "client" : "server",
  };
}

function readActionOutcome(response: Response, parsed: unknown): ActionOutcome {
  if (!isRecord(parsed) || parsed["ok"] !== true) return refusal(response, parsed);
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

    async box(actionId, dryRun): Promise<BoxOutcome> {
      const posted = await postJson(BOX_ACTION_URL, boxActionBody(actionId, dryRun), fetchImpl);
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
        would: parsed["would"] ?? parsed["result"] ?? null,
        why: typeof parsed["why"] === "string" ? parsed["why"] : null,
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
  box: (actionId, dryRun) => makeActionsApi().box(actionId, dryRun),
};
