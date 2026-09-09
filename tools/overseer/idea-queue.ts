/**
 * THE QUEUE OF IDEAS — an append-only log of who authorised what.
 *
 * Greg, 2026-09-08: *"add a mode for 'Queued ideas' that shows a list of ideas
 * that will each get turned into a prompt for their own new-claude agent …
 * this would be much better if it was NDJSON, to make it easier to append,
 * query, include metadata etc."*
 *
 * **This file is not a todo list; it is an authorisation record.**
 * [overseer.md](../../docs/project/overseer.md)'s gate 3 ends *"nothing
 * dispatched that Greg did not queue"*, and its stated test is *"is it in the
 * queue?"*. Everything odd-looking below follows from that one sentence.
 *
 * The plan is
 * [260909b](../../docs/plans/260909b-queued-ideas-mode-the-overseer-queue-as-ndjson.md);
 * GPT Sol reviewed it before any of this was built and found the two holes that
 * shaped it, both marked below.
 *
 * ## Why events rather than one line per item
 *
 * Greg said NDJSON, which settles the format and not the shape. The rejected
 * shape is one line per item with the file rewritten on every edit: it loses
 * *who moved this to the front, and when*, of a record whose whole purpose is to
 * say who authorised what, and two writers silently lose each other's edit.
 *
 * So: append-only events, folded by `foldQueue`. **The justification is
 * auditability and a serial history, not that "history is free"** — Sol's P1-6,
 * and it was a correction: an event log's costs are the envelope, the strict
 * per-event parse, the transition validation and the idempotency key, all of
 * which are below because they were named.
 *
 * This reuses rather than restates: [`jsonl.ts`](./jsonl.ts) for the append
 * discipline and [`lock.ts`](./lock.ts) for exclusion, both extracted because
 * their rule had been written twice already.
 *
 * ## THREE AXES, NOT ONE STATUS — Sol's P1-7
 *
 * The first draft had a single `status` running `queued | blocked-on-greg |
 * dispatched | done | dropped`, and those are three different questions wearing
 * one field. A running item can *also* be waiting on Greg; an item can be
 * blocked on a lull, on a product answer, or on another file's owner. So:
 *
 *  - **`authority`** — `proposed` or `authorized`. Who says this may happen.
 *  - **`lifecycle`** — `queued`, `dispatched`, `done`, `dropped`. Where it is.
 *  - **`needsGreg` + `waitingOn`** — what it is waiting for, which is a
 *    condition rather than a state.
 *
 * `isDispatchable` is the conjunction, and it is the thing gate 3 should ask
 * instead of "is it in the file?".
 *
 * ## AN AUTHORISATION NAMES THE REVISION IT AUTHORISES — Sol's P0-2
 *
 * The hole this closes: Greg approves *"investigate X"*, an agent edits the
 * text or enlarges the file set, and the changed job is still marked approved.
 * The runbook already forbids acting on an instruction that changed after it was
 * authorised (gate 3's last bullet); nothing in the first draft made that
 * checkable.
 *
 * So every content edit bumps `revision`, and `authority` carries the revision
 * it was granted for. Dispatch requires `authorizedRevision === revision`. An
 * edit by Greg re-authorises in the same act — he is the authority, and making
 * him press twice would train him to press twice. An edit by the Overseer does
 * not, so enrichment lapses the approval and says so on the page.
 *
 * ## GATE 3, MADE MECHANICAL
 *
 * Only Greg can authorise. An `added` by the Overseer is born `proposed`, and an
 * `authorized` event from anyone but Greg is a problem rather than a promotion —
 * see `foldQueue`. The check lives in the FOLD rather than in the writers,
 * because a rule enforced at one entrance has an unguarded second entrance, and
 * there are three (the CLI, the route, a hand-edited file). All three fold.
 *
 * **What this does NOT do, stated plainly because a claimed protection is worse
 * than an admitted gap.** Any process running as this user can append whatever
 * it likes to the file, including `by: "greg"`. That is equally true of the
 * Markdown file this replaces, so nothing is lost — but it means gate 3 is a
 * governance constraint, not an OS capability boundary, and `by` is a
 * self-declaration rather than a proven identity. Sol's P0-1. The route
 * therefore never takes an actor from a request body, and a write path from the
 * page waits on Greg's answer about device-scoped identity.
 *
 * ## A CORRUPT QUEUE MUST NOT READ AS AN EMPTY ONE — Sol's P1-3
 *
 * The Overseer's own store may cold-start, because losing it costs only history.
 * **This file is original human input and is not disposable.** So the fold
 * collects `problems`, a view with any problem is `dispatchable: false`, and
 * `readQueue` distinguishes *never written* from *empty* from *unreadable*.
 * Nothing here quietly skips a line it did not understand and hands back a
 * plausible queue: that is the exact silent success
 * ([silent-success.md](../../docs/reusable/silent-success.md)) that would let a
 * hole in the record read as *nothing was queued*.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { QueueActor, QueueLifecycle, QueueProblemKind } from "../fleet/wire.js";
import { truncateToLastLine, writeAll, type JsonlRepair } from "./jsonl.js";
import { describeLockRefusal, releaseLock, stillOurs, takeLock, type HeldLock } from "./lock.js";

/** Bumped only for a change a previous reader could not survive. */
export const IDEA_QUEUE_SCHEMA = 1;

export const QUEUE_FILE = "queue.jsonl";

/**
 * **The queue's OWN lock, and it cannot borrow the store's.**
 *
 * `overseer.lock` is held by the daemon for its whole lifetime, so anything
 * waiting on it waits forever (Sol's P1-1). This one is taken for the critical
 * section only — repair, fold, version check, append, fsync — and released in a
 * `finally`.
 */
export const QUEUE_LOCK_FILE = "queue.lock";

/**
 * Who recorded an event.
 *
 * **An alias, so there is exactly one declaration.** The union itself lives in
 * [`wire.ts`](../fleet/wire.ts) as `QueueActor`, because it crosses the HTTP
 * boundary and that file is the one home for anything that does — declaring it
 * twice is the precise bug its header was written about. Reaching from here into
 * `tools/fleet/` reads backwards; `attention-classify.ts` and `usage-carry.ts`
 * already do it, and `wire.ts` imports nothing, so nothing comes with it.
 *
 * The narrowing from `Speaker` is the interesting part, and it is argued at
 * `QueueActor`: `dashboard` means *a report, never an instruction*, and a queue
 * write is an instruction.
 *
 * **This is who RECORDED it, which is not who authorised it** — `Authority`
 * below is that, and only Greg can grant it.
 */
export type IdeaActor = QueueActor;

export const IDEA_ACTORS: readonly IdeaActor[] = ["greg", "overseer"];

/** Whether anybody has said this may happen. */
export type Authority =
  /** The Overseer noticed it. Gate 3: *"a job of your own devising is a proposal"*. */
  | { readonly kind: "proposed" }
  /** Greg said yes — to **this** revision of the text, and no later one. */
  | { readonly kind: "authorized"; readonly by: IdeaActor; readonly at: string; readonly revision: number };

/**
 * Where an item has got to — one axis, and only this one is a lifecycle.
 *
 * Aliased from `wire.ts` for the reason `IdeaActor` is.
 */
export type Lifecycle = QueueLifecycle;

/**
 * What the Overseer needs in order to write the brief it would otherwise
 * compose by hand — taken from the briefs actually dispatched on 2026-09-08,
 * not guessed at.
 */
export type IdeaMetadata = {
  /** The plan or doc that holds the detail, repo-relative. */
  readonly source: string | null;
  /** What it waits on, in the queue doc's own terms — `a lull`, `the next gateway edit`. */
  readonly waitingOn: string | null;
  /** A size guess — `XS`, `L`. Free text: it is a guess, never a promise. */
  readonly size: string | null;
  /** Files or areas it touches, for the brief's file set. */
  readonly areas: readonly string[];
  /** The reusable doc the dispatched session should run. */
  readonly runs: string | null;
};

export const EMPTY_METADATA: IdeaMetadata = { source: null, waitingOn: null, size: null, areas: [], runs: null };

/**
 * Where a move puts an item.
 *
 * **ONE PLACEMENT, NOT A REORDERED ARRAY**, which was Sol's answer to the
 * question the plan asked. The rejected shape had the client send the complete
 * ordering; the reason it is wrong is that it cannot be validated — an array is
 * a claim about the whole queue, so a stale one is indistinguishable from an
 * intentional reshuffle, and the fold has to guess.
 *
 * A placement is an intent, and an intent can be checked. Replay is in log
 * order, so an anchor dropped by a *later* event is no problem at all: the move
 * happened first. An anchor missing at the moment its own move replays means the
 * log is invalid — recorded as a problem, never silently rounded to the front or
 * the back, which is how a corrupt record becomes a plausible one.
 */
export type Placement =
  | { readonly at: "front" }
  | { readonly at: "back" }
  | { readonly at: "before"; readonly anchor: string }
  | { readonly at: "after"; readonly anchor: string };

/**
 * The envelope every event carries — Sol's P1-6.
 *
 * `eventId` makes a line citable in a bug report and lets the version name the
 * tail. `commandId` is the idempotency key: *"the append succeeded and the
 * response was lost"* otherwise duplicates an add or a move when the caller
 * retries, and a duplicated add in an authorisation record is the worst kind of
 * duplicate. Null for a write nobody will retry.
 */
export type Envelope = {
  readonly schema: typeof IDEA_QUEUE_SCHEMA;
  readonly eventId: string;
  readonly commandId: string | null;
  readonly at: string;
  /** Who RECORDED this. Authority is a separate question — see `Authority`. */
  readonly by: IdeaActor;
};

export type IdeaEvent = Envelope &
  (
    | {
        readonly kind: "added";
        readonly id: string;
        /** Greg's words, verbatim. Never rewritten by anything but an explicit `edited`. */
        readonly text: string;
        readonly title: string | null;
        readonly metadata: IdeaMetadata;
        readonly placement: Placement;
        /** True when this is waiting on a person, not on a slot. */
        readonly needsGreg: boolean;
      }
    | {
        readonly kind: "edited";
        readonly id: string;
        /**
         * Only the fields that changed. **An absent key means "leave it alone"
         * and an explicit `null` means "clear it"** — two different intentions
         * that one optional field cannot express, which is why `title` is
         * `string | null` inside an optional key.
         */
        readonly text?: string;
        readonly title?: string | null;
        readonly metadata?: Partial<IdeaMetadata>;
        readonly needsGreg?: boolean;
      }
    /** Greg says yes, to the revision named. Nobody else's is honoured. */
    | { readonly kind: "authorized"; readonly id: string; readonly revision: number }
    | { readonly kind: "moved"; readonly id: string; readonly placement: Placement }
    | {
        readonly kind: "dispatched";
        readonly id: string;
        /** The tmux session, so the row on Sessions and the row here are the same work. */
        readonly session: string;
        readonly plan: string | null;
      }
    | { readonly kind: "done"; readonly id: string }
    | { readonly kind: "dropped"; readonly id: string; readonly why: string | null }
  );

export type IdeaEventKind = IdeaEvent["kind"];

/** One thing that happened to an item, for the row's own history. */
export type IdeaTouch = {
  readonly kind: IdeaEventKind;
  readonly at: string;
  readonly by: IdeaActor;
  /** A short phrase for the UI — `moved to the front`, `dropped: superseded`. */
  readonly what: string;
};

/**
 * Something the log says that this reader cannot accept.
 *
 * **Collected rather than thrown, and never ignored.** A fold that threw would
 * take the whole page down for one bad line; a fold that skipped would hand back
 * a plausible queue that is missing an authorisation. So each one is named, and
 * their presence is what makes a view undispatchable.
 */
export type QueueProblem = {
  /** Aliased from `wire.ts`, like the two above: the page prints these. */
  readonly kind: QueueProblemKind;
  readonly why: string;
  /** The event's own id, where there was one to quote. */
  readonly eventId: string | null;
};

/** An item, as the fold leaves it. */
export type IdeaItem = {
  readonly id: string;
  readonly text: string;
  readonly title: string | null;
  readonly metadata: IdeaMetadata;
  readonly authority: Authority;
  readonly lifecycle: Lifecycle;
  readonly needsGreg: boolean;
  /**
   * Bumped by every content edit. **The number an authorisation names**, and
   * what makes "approved, then changed" visible — see the header, Sol's P0-2.
   */
  readonly revision: number;
  readonly addedBy: IdeaActor;
  readonly addedAt: string;
  /** Null until something changes it — never backfilled from `addedAt`, which would invent an edit. */
  readonly lastTouchedAt: string | null;
  readonly dispatchedTo: string | null;
  readonly dispatchedAt: string | null;
  readonly plan: string | null;
  readonly droppedWhy: string | null;
  /** Oldest first. The provenance the event-log shape was chosen for. */
  readonly history: readonly IdeaTouch[];
};

/**
 * An opaque token naming the exact state a client saw — Sol's P1-1.
 *
 * A count **and** the last event's id, rather than a bare count: two different
 * histories can be the same length, and a count alone cannot tell *behind* from
 * *different*. Compared while holding the lock; a mismatch is refused, never
 * merged.
 */
export type QueueVersion = { readonly events: number; readonly lastEventId: string | null };

export const VERSION_ZERO: QueueVersion = { events: 0, lastEventId: null };

export function sameVersion(a: QueueVersion, b: QueueVersion): boolean {
  return a.events === b.events && a.lastEventId === b.lastEventId;
}

/** For a URL or a CLI flag. `0` for an empty queue. */
export function spellVersion(v: QueueVersion): string {
  return v.lastEventId === null ? `${v.events}` : `${v.events}.${v.lastEventId}`;
}

export function parseVersion(text: string): QueueVersion | null {
  /* **`Number("")` IS 0, NOT NaN**, so an empty string would otherwise parse as
     "the queue is empty" — a client that sent no version at all would be
     treated as one that had looked and seen nothing. A test caught it. */
  if (text.trim() === "") return null;
  const dot = text.indexOf(".");
  const count = Number(dot === -1 ? text : text.slice(0, dot));
  if (!Number.isInteger(count) || count < 0) return null;
  if (dot === -1) return count === 0 ? VERSION_ZERO : null;
  const id = text.slice(dot + 1);
  return id === "" ? null : { events: count, lastEventId: id };
}

/**
 * The whole queue, folded.
 *
 * `items` holds everything still in play — `queued` and `dispatched` — in queue
 * order. `settled` holds `done` and `dropped`, most recently settled first,
 * because their queue position stopped meaning anything the moment they left it.
 */
export type QueueView = {
  readonly schema: typeof IDEA_QUEUE_SCHEMA;
  readonly version: QueueVersion;
  readonly items: readonly IdeaItem[];
  readonly settled: readonly IdeaItem[];
  /** Named, never hidden. Any of these makes the queue undispatchable. */
  readonly problems: readonly QueueProblem[];
};

export const EMPTY_VIEW: QueueView = {
  schema: IDEA_QUEUE_SCHEMA,
  version: VERSION_ZERO,
  items: [],
  settled: [],
  problems: [],
};

/**
 * **THE TEST GATE 3 SHOULD ASK, instead of "is it in the queue?".**
 *
 * All five clauses, and each rules out a real way of dispatching something
 * nobody agreed to:
 *
 *  - the queue read cleanly — a hole in the record is not a licence;
 *  - somebody authorised it — and only Greg can;
 *  - they authorised **this** revision, not an earlier one since edited;
 *  - it has not already been dispatched, finished or dropped;
 *  - and it is not waiting on a person.
 */
export function isDispatchable(view: QueueView, item: IdeaItem): boolean {
  return (
    view.problems.length === 0 &&
    item.authority.kind === "authorized" &&
    item.authority.revision === item.revision &&
    item.lifecycle === "queued" &&
    !item.needsGreg
  );
}

/** Why this one may not be dispatched, for a page or a log line. Null when it may. */
export function whyNotDispatchable(view: QueueView, item: IdeaItem): string | null {
  if (view.problems.length > 0) {
    return `the queue has ${view.problems.length} unresolved problem(s), so nothing in it is dispatchable`;
  }
  if (item.authority.kind === "proposed") return "nobody has authorised this yet — it is a proposal";
  if (item.authority.revision !== item.revision) {
    return (
      `authorised at revision ${item.authority.revision} and edited since (now ${item.revision}), ` +
      `so the approval no longer names what this says`
    );
  }
  if (item.lifecycle !== "queued") return `it is ${item.lifecycle}`;
  if (item.needsGreg) return "it is waiting on Greg, not on a slot";
  return null;
}

/* ------------------------------------------------------------------ *
 * The fold. Pure, total, and the interesting half of this module.
 * ------------------------------------------------------------------ */

const IN_PLAY: readonly Lifecycle[] = ["queued", "dispatched"];

type Mutable = {
  id: string;
  text: string;
  title: string | null;
  metadata: IdeaMetadata;
  authority: Authority;
  lifecycle: Lifecycle;
  needsGreg: boolean;
  revision: number;
  addedBy: IdeaActor;
  addedAt: string;
  lastTouchedAt: string | null;
  dispatchedTo: string | null;
  dispatchedAt: string | null;
  plan: string | null;
  droppedWhy: string | null;
  history: IdeaTouch[];
  settledAt: string | null;
};

function mergeMetadata(base: IdeaMetadata, patch: Partial<IdeaMetadata>): IdeaMetadata {
  return {
    source: patch.source === undefined ? base.source : patch.source,
    waitingOn: patch.waitingOn === undefined ? base.waitingOn : patch.waitingOn,
    size: patch.size === undefined ? base.size : patch.size,
    areas: patch.areas === undefined ? base.areas : [...patch.areas],
    runs: patch.runs === undefined ? base.runs : patch.runs,
  };
}

/**
 * Put `id` where the placement says, or say why it could not.
 *
 * `order` is mutated. An anchor that is not present is a **problem**, not a
 * fallback: rounding a missing anchor to the front or the back invents an
 * ordering nobody asked for, in the one file whose ordering is the instruction.
 */
export function place(order: string[], id: string, placement: Placement): { ok: true } | { ok: false; why: string } {
  const without = order.filter((o) => o !== id);
  if (placement.at === "front") {
    order.splice(0, order.length, id, ...without);
    return { ok: true };
  }
  if (placement.at === "back") {
    order.splice(0, order.length, ...without, id);
    return { ok: true };
  }
  if (placement.anchor === id) return { ok: false, why: `cannot place ${id} relative to itself` };
  const anchorAt = without.indexOf(placement.anchor);
  if (anchorAt === -1) {
    return { ok: false, why: `no item ${placement.anchor} to place ${id} ${placement.at}` };
  }
  const cut = placement.at === "before" ? anchorAt : anchorAt + 1;
  order.splice(0, order.length, ...without.slice(0, cut), id, ...without.slice(cut));
  return { ok: true };
}

function describePlacement(placement: Placement): string {
  switch (placement.at) {
    case "front":
      return "to the front";
    case "back":
      return "to the back";
    case "before":
      return `before ${placement.anchor}`;
    case "after":
      return `after ${placement.anchor}`;
  }
}

function describeTouch(event: IdeaEvent): string {
  switch (event.kind) {
    case "added":
      return event.placement.at === "front" ? "added at the front" : "added";
    case "edited": {
      const parts: string[] = [];
      if (event.text !== undefined) parts.push("text");
      if (event.title !== undefined) parts.push("title");
      if (event.metadata !== undefined) parts.push("metadata");
      if (event.needsGreg !== undefined) parts.push(event.needsGreg ? "now waiting on Greg" : "no longer waiting on Greg");
      return parts.length === 0 ? "edited nothing" : `edited ${parts.join(", ")}`;
    }
    case "authorized":
      return `authorised revision ${event.revision}`;
    case "moved":
      return `moved ${describePlacement(event.placement)}`;
    case "dispatched":
      return `dispatched as ${event.session}`;
    case "done":
      return "done";
    case "dropped":
      return event.why === null ? "dropped" : `dropped: ${event.why}`;
  }
}

/** Whether an `edited` touched the CONTENT — which is what a revision counts. */
function changesContent(event: Extract<IdeaEvent, { kind: "edited" }>): boolean {
  return event.text !== undefined || event.title !== undefined || event.metadata !== undefined;
}

/**
 * Events to the current queue.
 *
 * **Pure and total: it never throws.** Everything it cannot accept becomes a
 * `QueueProblem`, and any problem makes the whole view undispatchable — which is
 * the safe direction, because the alternative is a plausible queue with an
 * authorisation missing from it.
 */
export function foldQueue(events: readonly IdeaEvent[], seedProblems: readonly QueueProblem[] = []): QueueView {
  const byId = new Map<string, Mutable>();
  const problems: QueueProblem[] = [...seedProblems];
  const order: string[] = [];
  let lastEventId: string | null = null;

  const problem = (kind: QueueProblem["kind"], why: string, eventId: string | null): void => {
    problems.push({ kind, why, eventId });
  };

  for (const event of events) {
    lastEventId = event.eventId;

    if (event.kind === "added") {
      if (byId.has(event.id)) {
        /* Not "last one wins": the first `added` is the one whose provenance is
           real, and letting a later line replace Greg's words is the one edit
           this file must never make silently. Recorded as a problem, because a
           duplicate id means something upstream is wrong. */
        problem("duplicate-item", `${event.id} was added twice; the second was ignored`, event.eventId);
        continue;
      }
      byId.set(event.id, {
        id: event.id,
        text: event.text,
        title: event.title,
        metadata: { ...event.metadata, areas: [...event.metadata.areas] },
        /* **Greg adding it IS the authorisation** — he typed it, and making him
           then press Approve would be a ceremony he would learn to click
           through. The Overseer adding it is a proposal, per gate 3. */
        authority:
          event.by === "greg" ? { kind: "authorized", by: "greg", at: event.at, revision: 0 } : { kind: "proposed" },
        lifecycle: "queued",
        needsGreg: event.needsGreg,
        revision: 0,
        addedBy: event.by,
        addedAt: event.at,
        lastTouchedAt: null,
        dispatchedTo: null,
        dispatchedAt: null,
        plan: null,
        droppedWhy: null,
        history: [{ kind: "added", at: event.at, by: event.by, what: describeTouch(event) }],
        settledAt: null,
      });
      const placed = place(order, event.id, event.placement);
      if (!placed.ok) problem("missing-anchor", placed.why, event.eventId);
      continue;
    }

    const item = byId.get(event.id);
    if (item === undefined) {
      problem("unknown-item", `${event.kind} names ${event.id}, which was never added`, event.eventId);
      continue;
    }

    switch (event.kind) {
      case "edited": {
        if (event.text !== undefined) item.text = event.text;
        if (event.title !== undefined) item.title = event.title;
        if (event.metadata !== undefined) item.metadata = mergeMetadata(item.metadata, event.metadata);
        if (event.needsGreg !== undefined) item.needsGreg = event.needsGreg;
        if (changesContent(event)) {
          item.revision += 1;
          /* **AN EDIT BY GREG RE-AUTHORISES; ANYONE ELSE'S LAPSES IT.** He is
             the authority, so his edit and his approval are one act. The
             Overseer enriching an item cannot carry his approval forward onto
             words he has not seen — which is the whole of Sol's P0-2. Nothing
             is destroyed: the item stays in the queue, visibly awaiting a fresh
             yes. */
          if (event.by === "greg" && item.authority.kind === "authorized") {
            item.authority = { kind: "authorized", by: "greg", at: event.at, revision: item.revision };
          }
        }
        item.lastTouchedAt = event.at;
        item.history.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
        break;
      }
      case "authorized": {
        if (event.by !== "greg") {
          /* Gate 3's core, and the reason the check is here rather than in the
             writers: the CLI, the route and a hand-edited file are three
             entrances and this is the one thing all three pass through. */
          problem(
            "unauthorized-authorization",
            `${event.by} tried to authorise ${event.id}; only Greg can authorise`,
            event.eventId,
          );
          break;
        }
        if (event.revision !== item.revision) {
          /* An approval for a revision that is not the current one is stale on
             arrival — it names words that have already changed. */
          problem(
            "illegal-transition",
            `authorisation of ${event.id} names revision ${event.revision}, which is not the current ${item.revision}`,
            event.eventId,
          );
          break;
        }
        item.authority = { kind: "authorized", by: "greg", at: event.at, revision: event.revision };
        item.lastTouchedAt = event.at;
        item.history.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
        break;
      }
      case "moved": {
        const placed = place(order, event.id, event.placement);
        if (!placed.ok) {
          problem("missing-anchor", placed.why, event.eventId);
          break;
        }
        item.lastTouchedAt = event.at;
        item.history.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
        break;
      }
      case "dispatched": {
        if (item.lifecycle !== "queued") {
          problem(
            "illegal-transition",
            `${event.id} was dispatched while ${item.lifecycle}`,
            event.eventId,
          );
          break;
        }
        item.lifecycle = "dispatched";
        item.dispatchedTo = event.session;
        item.dispatchedAt = event.at;
        item.plan = event.plan;
        item.lastTouchedAt = event.at;
        item.history.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
        break;
      }
      case "done":
      case "dropped": {
        if (!IN_PLAY.includes(item.lifecycle)) {
          problem("illegal-transition", `${event.id} was ${event.kind} while ${item.lifecycle}`, event.eventId);
          break;
        }
        item.lifecycle = event.kind === "done" ? "done" : "dropped";
        if (event.kind === "dropped") item.droppedWhy = event.why;
        item.settledAt = event.at;
        /* **OUT OF THE ORDERING, NOT JUST OUT OF THE RENDER** — and a test
           caught the difference. Leaving a settled id in `order` keeps it
           usable as an anchor, so `moved B after A` resolves to a position
           against an item that left the queue an hour earlier: a defined answer
           to a stale intent, which is worse than a refusal because nothing says
           it happened. `done` and `dropped` are terminal, so nothing needs it
           back. */
        const settledAt = order.indexOf(event.id);
        if (settledAt !== -1) order.splice(settledAt, 1);
        item.lastTouchedAt = event.at;
        item.history.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
        break;
      }
    }
  }

  const freeze = (m: Mutable): IdeaItem => ({
    id: m.id,
    text: m.text,
    title: m.title,
    metadata: m.metadata,
    authority: m.authority,
    lifecycle: m.lifecycle,
    needsGreg: m.needsGreg,
    revision: m.revision,
    addedBy: m.addedBy,
    addedAt: m.addedAt,
    lastTouchedAt: m.lastTouchedAt,
    dispatchedTo: m.dispatchedTo,
    dispatchedAt: m.dispatchedAt,
    plan: m.plan,
    droppedWhy: m.droppedWhy,
    history: m.history,
  });

  const items: IdeaItem[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item !== undefined && IN_PLAY.includes(item.lifecycle)) items.push(freeze(item));
  }
  const settled = [...byId.values()]
    .filter((m) => !IN_PLAY.includes(m.lifecycle))
    .sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""))
    .map(freeze);

  return {
    schema: IDEA_QUEUE_SCHEMA,
    version: { events: events.length, lastEventId },
    items,
    settled,
    problems,
  };
}

/** The live ids, in order. */
export function currentOrder(view: QueueView): string[] {
  return view.items.map((item) => item.id);
}

/**
 * How many items are ahead of this one **and actually dispatchable**.
 *
 * Not merely `queued`: an item nobody has authorised, or one whose approval
 * lapsed when it was edited, is not ahead of you in any sense that costs you
 * time. Nor is a `dispatched` one — that is already running, so counting it
 * would double-count the fleet's own capacity — nor one waiting on Greg, which
 * is waiting for an answer rather than for a slot.
 *
 * Null when the id is not in the ordered queue at all.
 */
export function waitingAhead(view: QueueView, id: string): number | null {
  let ahead = 0;
  for (const item of view.items) {
    if (item.id === id) return ahead;
    if (isDispatchable(view, item)) ahead += 1;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Parsing. Nothing here trusts the file.
 * ------------------------------------------------------------------ */

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === "object" && u !== null && !Array.isArray(u);
}

function asActor(u: unknown): IdeaActor | null {
  return u === "greg" || u === "overseer" ? u : null;
}

function asIso(u: unknown): string | null {
  if (typeof u !== "string" || u === "") return null;
  return Number.isNaN(Date.parse(u)) ? null : u;
}

function asStringOrNull(u: unknown): string | null | undefined {
  if (u === null) return null;
  if (typeof u === "string") return u;
  return undefined;
}

function asMetadata(u: unknown): IdeaMetadata {
  if (!isRecord(u)) return EMPTY_METADATA;
  const areas = Array.isArray(u["areas"]) ? u["areas"].filter((a): a is string => typeof a === "string") : [];
  return {
    source: asStringOrNull(u["source"]) ?? null,
    waitingOn: asStringOrNull(u["waitingOn"]) ?? null,
    size: asStringOrNull(u["size"]) ?? null,
    areas,
    runs: asStringOrNull(u["runs"]) ?? null,
  };
}

function asMetadataPatch(u: unknown): Partial<IdeaMetadata> | undefined {
  if (!isRecord(u)) return undefined;
  const patch: Record<string, unknown> = {};
  for (const key of ["source", "waitingOn", "size", "runs"] as const) {
    if (key in u) patch[key] = asStringOrNull(u[key]) ?? null;
  }
  if (Array.isArray(u["areas"])) patch["areas"] = u["areas"].filter((a): a is string => typeof a === "string");
  return Object.keys(patch).length === 0 ? undefined : (patch as Partial<IdeaMetadata>);
}

/** A placement, or null. An anchor that is not an id is not a placement. */
export function asPlacement(u: unknown): Placement | null {
  if (!isRecord(u)) return null;
  const at = u["at"];
  if (at === "front" || at === "back") return { at };
  if (at !== "before" && at !== "after") return null;
  const anchor = u["anchor"];
  if (typeof anchor !== "string" || !ID_RULE.test(anchor)) return null;
  return { at, anchor };
}

/**
 * One line to an event, or null.
 *
 * **A line this reader cannot understand is counted, never guessed at.** An
 * event with a missing `by` is not defaulted to `greg`: that would mint an
 * authorisation out of a parse failure, which is the one thing this file must
 * not do.
 */
export function parseEvent(line: string): IdeaEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  if (json["schema"] !== IDEA_QUEUE_SCHEMA) return null;
  const at = asIso(json["at"]);
  const by = asActor(json["by"]);
  const id = json["id"];
  const eventId = json["eventId"];
  if (at === null || by === null) return null;
  if (typeof id !== "string" || !ID_RULE.test(id)) return null;
  if (typeof eventId !== "string" || eventId === "") return null;
  const commandId = typeof json["commandId"] === "string" ? json["commandId"] : null;
  const envelope: Envelope = { schema: IDEA_QUEUE_SCHEMA, eventId, commandId, at, by };

  switch (json["kind"]) {
    case "added": {
      const text = json["text"];
      if (typeof text !== "string" || text.trim() === "") return null;
      const placement = asPlacement(json["placement"]);
      if (placement === null) return null;
      return {
        ...envelope,
        kind: "added",
        id,
        text,
        title: asStringOrNull(json["title"]) ?? null,
        metadata: asMetadata(json["metadata"]),
        placement,
        needsGreg: json["needsGreg"] === true,
      };
    }
    case "edited": {
      const text = typeof json["text"] === "string" ? json["text"] : undefined;
      const title = "title" in json ? asStringOrNull(json["title"]) : undefined;
      const metadata = asMetadataPatch(json["metadata"]);
      const needsGreg = typeof json["needsGreg"] === "boolean" ? json["needsGreg"] : undefined;
      return {
        ...envelope,
        kind: "edited",
        id,
        ...(text === undefined ? {} : { text }),
        ...(title === undefined ? {} : { title }),
        ...(metadata === undefined ? {} : { metadata }),
        ...(needsGreg === undefined ? {} : { needsGreg }),
      };
    }
    case "authorized": {
      const revision = json["revision"];
      if (!Number.isInteger(revision) || (revision as number) < 0) return null;
      return { ...envelope, kind: "authorized", id, revision: revision as number };
    }
    case "moved": {
      const placement = asPlacement(json["placement"]);
      if (placement === null) return null;
      return { ...envelope, kind: "moved", id, placement };
    }
    case "dispatched": {
      const session = json["session"];
      if (typeof session !== "string" || session === "") return null;
      return { ...envelope, kind: "dispatched", id, session, plan: asStringOrNull(json["plan"]) ?? null };
    }
    case "done":
      return { ...envelope, kind: "done", id };
    case "dropped":
      return { ...envelope, kind: "dropped", id, why: asStringOrNull(json["why"]) ?? null };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * The file.
 * ------------------------------------------------------------------ */

/**
 * Where the queue lives.
 *
 * `~/.overseer/`, beside the store the Overseer already treats as the record —
 * **an assumption pending Greg**, logged on 2026-09-09. The alternative is a
 * file in the repo: versioned and visible from Greg's Mac, but a live page
 * editing a checked-in file leaves the shared primary dirty and hands `git
 * merge` authority over the live order. Sol agreed with the box file and named
 * the useful third shape, which is not a database: one canonical runtime file
 * off the repo, a checked-in deterministic migration seed
 * ([`idea-queue-seed.ts`](./idea-queue-seed.ts)), and `export` for a copy —
 * neither of the latter being a live authority.
 *
 * `OVERSEER_QUEUE_DIR` overrides it, and **a relative path is refused rather
 * than resolved**: a relative store follows the process's cwd, so two callers
 * started from different directories get two different queues and neither can
 * tell.
 */
export function queueRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["OVERSEER_QUEUE_DIR"];
  if (override !== undefined && override !== "") return override;
  return path.join(homedir(), ".overseer");
}

/**
 * What a read found — Sol's P1-3, and the arms are the point.
 *
 * **`never-written` is not `empty`.** A queue file that has never existed is a
 * queue nobody has used; an existing file that folds to nothing has had
 * everything dropped. Drawn as the same blank list those become one claim, and
 * the wrong one is the one that reads as *nothing is queued* over a lost record.
 *
 * **`unreadable` is neither.** The file is there and this build cannot make
 * sense of it, which is a producer and a consumer come apart — and it must never
 * render as a healthy empty queue, because this file, unlike the Overseer's
 * store, is original human input and is not disposable.
 */
export type QueueRead =
  | { kind: "never-written"; path: string }
  | { kind: "queue"; view: QueueView; path: string }
  | { kind: "unreadable"; why: string; path: string };

/**
 * Read and fold, or say why not.
 *
 * Unparseable lines become `problems`, which makes the view undispatchable — a
 * queue quietly two items short is exactly the failure this file's discipline
 * exists to prevent, and a silent skip would manufacture it.
 */
export function readQueue(root: string = queueRoot()): QueueRead {
  const file = path.join(root, QUEUE_FILE);
  if (!existsSync(file)) return { kind: "never-written", path: file };
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (cause) {
    return { kind: "unreadable", why: `could not read ${file}: ${String(cause)}`, path: file };
  }
  const events: IdeaEvent[] = [];
  const problems: QueueProblem[] = [];
  let lineNumber = 0;
  for (const line of text.split("\n")) {
    lineNumber += 1;
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event === null) {
      problems.push({
        kind: "unreadable-line",
        why: `line ${lineNumber} is not an event this build understands`,
        eventId: null,
      });
    } else {
      events.push(event);
    }
  }
  return { kind: "queue", view: foldQueue(events, problems), path: file };
}

/** The view, whichever arm came back — `never-written` folds to the empty one. */
export function viewOf(read: QueueRead): QueueView | null {
  if (read.kind === "queue") return read.view;
  if (read.kind === "never-written") return EMPTY_VIEW;
  return null;
}

export type AppendResult =
  | { ok: true; view: QueueView; path: string; repaired: JsonlRepair }
  | { ok: false; code: "stale-version" | "locked" | "unreadable" | "refused"; why: string };

/**
 * Append events under the lock, then re-read — Sol's P1-1 transaction.
 *
 * **The lock spans repair, fold, version check, append and fsync**, and nothing
 * else: not the request body, not a launch, not the response. Read-then-append
 * with a gap in the middle is two writers both finding the version they
 * expected.
 *
 * `expect` is optional so the CLI can append without one; the route always
 * passes it, and a mismatch is refused rather than merged.
 *
 * `stillOurs` is re-checked after the repair, because clearing a lock left by a
 * provably dead process cannot be made atomic and two starts can both prove the
 * same corpse dead (`lock.ts` § the residual race).
 */
export function appendEvents(
  events: readonly IdeaEvent[],
  options: { root?: string; expect?: QueueVersion; now?: () => Date } = {},
): AppendResult {
  const root = options.root ?? queueRoot();
  if (!path.isAbsolute(root)) {
    return { ok: false, code: "refused", why: `the queue directory must be an absolute path, not '${root}'` };
  }
  if (events.length === 0) return { ok: false, code: "refused", why: "nothing to append" };
  try {
    mkdirSync(root, { recursive: true });
  } catch (cause) {
    return { ok: false, code: "refused", why: `could not make ${root}: ${String(cause)}` };
  }

  const lockPath = path.join(root, QUEUE_LOCK_FILE);
  const taken = takeLock(lockPath, options.now ?? (() => new Date()));
  if (!taken.ok) return { ok: false, code: "locked", why: describeLockRefusal(taken.refusal, lockPath) };
  const lock: HeldLock = taken.lock;

  try {
    const file = path.join(root, QUEUE_FILE);
    let repaired: JsonlRepair;
    try {
      repaired = truncateToLastLine(file);
    } catch (cause) {
      return { ok: false, code: "refused", why: `could not repair ${file}: ${String(cause)}` };
    }
    if (!stillOurs(lock, lockPath)) {
      return { ok: false, code: "locked", why: "lost the queue lock while repairing the file; nothing was written" };
    }

    const before = readQueue(root);
    if (before.kind === "unreadable") return { ok: false, code: "unreadable", why: before.why };
    const current = viewOf(before) ?? EMPTY_VIEW;
    if (options.expect !== undefined && !sameVersion(options.expect, current.version)) {
      return {
        ok: false,
        code: "stale-version",
        why:
          `the queue has moved on: you sent version ${spellVersion(options.expect)} and it is now ` +
          `${spellVersion(current.version)}. Nothing was written — look again before writing.`,
      };
    }

    const body = events.map((event) => `${JSON.stringify(event)}\n`).join("");
    const fd = openSync(file, "a");
    try {
      writeAll(fd, body);
      /* **BEFORE THE LOCK IS RELEASED.** An authorisation that is in the page
         cache and not on the disk is one a power cut turns into a dispatch
         nobody approved. The Overseer's own store makes the same trade. */
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    const after = readQueue(root);
    if (after.kind === "unreadable") return { ok: false, code: "unreadable", why: after.why };
    return { ok: true, view: viewOf(after) ?? EMPTY_VIEW, path: file, repaired };
  } finally {
    releaseLock(lock, lockPath);
  }
}

/* ------------------------------------------------------------------ *
 * Minting.
 * ------------------------------------------------------------------ */

/**
 * A queue id: `qi-` and eight characters.
 *
 * Its own alphabet rather than a uuid, because these get typed at a CLI and read
 * off a phone screen. No `i`, `l`, `o`, `u`, `0` or `1` — the pairs that get
 * misread, and `u` because removing it removes a family of unfortunate words.
 */
const ID_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

export function mintId(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)] ?? "2";
  return `qi-${out}`;
}

/** `qi-` and eight of the alphabet. Checked wherever an id arrives from outside. */
export const ID_RULE = new RegExp(`^qi-[${ID_ALPHABET}]{8}$`);

/** An event id. A uuid, because nobody types one. */
export function mintEventId(): string {
  return randomUUID();
}

/** The envelope for a write this process is making now. */
export function envelope(by: IdeaActor, options: { at?: string; commandId?: string | null } = {}): Envelope {
  return {
    schema: IDEA_QUEUE_SCHEMA,
    eventId: mintEventId(),
    commandId: options.commandId ?? null,
    at: options.at ?? new Date().toISOString(),
    by,
  };
}
