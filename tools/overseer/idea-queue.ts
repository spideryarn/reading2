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
 * **AND HERE IS THE HALF THAT IS NOT CLOSED, because a comment claiming more
 * than the code does is worse than one that admits a gap.** `revision` covers
 * the fields *in this file*. It does not cover the documents those fields point
 * at: `source` and `runs` are **paths**, so editing the plan, or editing
 * `engineering-manager.md`, changes the job that will actually be dispatched
 * while the revision — and therefore the approval — sits still. Sol's round-two
 * P0-1, and it is the exact second half of the round-one finding.
 *
 * Closing it means an authorisation naming the **contents**: a digest or a
 * commit for every instruction document, rechecked at dispatch. That belongs
 * with the dispatch design rather than here, because the set of documents a
 * brief uses is decided there — and nothing in this file launches anything, so
 * the gap is not yet reachable. It is stage 4 in the plan, and it is written
 * down rather than remembered.
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
 * **PROOF THAT THIS QUEUE HAS EVER EXISTED — outside the log it describes.**
 *
 * GPT Sol's P1-2 in round two, and it is the one finding that made a false
 * sentence appear on screen. `readQueue` treated *file absent* as
 * `never-written` and a *zero-byte file* as a valid empty queue, so after
 * cutover **deleting the live queue would render "Nothing has been queued here
 * yet"** and truncating it would render "everything in it has been dispatched or
 * dropped". Both reassuring, both false, and the whole file is built on the
 * opposite promise.
 *
 * The distinction cannot be drawn from inside a replaceable log — that is the
 * point. So the first successful append writes this tiny marker beside it, and
 * from then on *no queue file* means **lost**, not new. It is never rewritten
 * and never read for its contents; its existence is the entire signal, which is
 * why a truncated or garbled marker is still proof of initialisation.
 *
 * A deliberate reset is therefore two deletions rather than one, and that is the
 * intended friction: the second one is a person saying they meant it.
 */
export const QUEUE_INIT_FILE = "queue.created";

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
 * **A PRIORITY IS `0`–`1`, OR `null` FOR NOBODY HAS SAID** — and `null` is not
 * a missing number, it is a different claim.
 *
 * Greg, 2026-09-09: *"add a `priority` 0-1 (where 1 is very-high-priority) …
 * so that important stuff can jump to the top."*
 *
 * The three candidate defaults for an item nobody has ranked, and why this is
 * the only honest one:
 *
 *  - `0.5` says *"of middling importance"*, which is an opinion nobody expressed;
 *  - `0` says *"worthless"*, which is a judgement nobody made;
 *  - `null` says *"nobody has said"*, which is what is true.
 *
 * `comparePriority` then sorts the unstated **below** everything stated, which
 * also buys a property worth having: a newly added item cannot silently
 * leapfrog work Greg ranked. The cost is that `add --front` without a priority
 * no longer reaches the front, and the CLI says so out loud rather than leaving
 * it to be discovered.
 *
 * **Out of range REJECTS THE LINE** — see `parseEvent`. Clamping `1000` to `1`
 * would turn a typo into a legitimate-looking top of the queue, and ignoring it
 * would turn the same typo into silence. Both are the silent success this
 * module exists against
 * ([silent-success.md](../../docs/reusable/silent-success.md)).
 */
export function isPriority(u: unknown): u is number | null {
  return u === null || (typeof u === "number" && Number.isFinite(u) && u >= 0 && u <= 1);
}

/**
 * Higher first; the unstated last. **Ordering only — it decides nothing about
 * whether an item may go out.**
 *
 * That separation is the whole basis for priority not lapsing an authorisation
 * (see `IdeaItem.priority`), so it matters that it is visible here: this
 * function returns a sort order and touches no other field. `isDispatchable`
 * has never heard of it.
 */
export function comparePriority(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

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
        /** `null` when the add did not say. Never invented — see `isPriority`. */
        readonly priority: number | null;
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
    /**
     * **ITS OWN KIND, NOT A KEY INSIDE `edited`**, and that is a fix for a bug
     * rather than a matter of taste.
     *
     * `needsGreg` is a key inside `edited` that `changesContent` deliberately
     * does not count, and the consequence was GPT Sol's round-two P0-2:
     * `edit --by overseer --ready` cleared Greg's blocker with no revision bump.
     * That hole is a *condition inside a function*, which the next person adding
     * an optional key to `edited` has to already know about. A separate kind
     * makes the exclusion **structural**: `changesContent` never sees one of
     * these, so there is no way to write a priority change that accidentally
     * counts as content. `null` clears it back to unstated.
     */
    | { readonly kind: "prioritized"; readonly id: string; readonly priority: number | null }
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
   * How much somebody wants this done, or `null` for nobody has said —
   * `isPriority` and `comparePriority` above.
   *
   * **PRIORITY IS ORDERING, NOT CONTENT, and that is the call this whole field
   * turns on.** Every content edit bumps `revision`, and an edit by anyone but
   * Greg therefore lapses his approval (Sol's P0-2). A priority does neither,
   * for three reasons:
   *
   *  - the queue already has an ordering axis and it lapses nothing — `moved`
   *    is writable by the Overseer today and bumps no revision, and a priority
   *    is a coarser spelling of the same intent. `move --front` preserving an
   *    approval while `--priority 0.9` lapsed it would be incoherent;
   *  - it grants the Overseer no power it lacks. It already chooses which
   *    dispatchable item to take (the queue is explicitly not FIFO), and it can
   *    already move anything to the front. What this adds is that the choice
   *    becomes durable, attributed and visible instead of living in one
   *    session's head — strictly more auditable, not less;
   *  - what must not move does not move. **`isDispatchable` never reads this
   *    field.** An unauthorised item at `1` sorts to the top of the list and is
   *    still not dispatchable, and its row still says *proposal*.
   *
   * **The residual risk, named rather than waved off: this is a salience
   * vector.** An Overseer proposal at `0.9` sits at the top of the list Greg
   * reads on his phone, which is a way of pressing for attention it did not
   * have before. It is not an authorisation vector, and Greg asked the Overseer
   * to apply his banding — so every `prioritized` event carries `by`, and *who
   * pushed this up the list* stays answerable.
   */
  readonly priority: number | null;
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
  priority: number | null;
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
  /* **THE COMMON CASE IS O(1), and it was O(n) until GPT Sol measured it.** Every
     `added` goes to the back, so filtering and rewriting the whole array each
     time made a back-appended seed quadratic: it timed 41ms for 1,000 items,
     686ms for 5,000 and 2.37s for 10,000 — and the route folds synchronously in
     the dashboard's single process, so at the top of that range one GET stalls
     every session, action and heartbeat. Sixteen items are fine either way; this
     costs two lines and removes the shape of the problem rather than its current
     size. Sol's P2-3, and its advice was to trigger on measured GET latency
     rather than a guessed item count. */
  if (placement.at === "back" && !order.includes(id)) {
    order.push(id);
    return { ok: true };
  }
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
    case "prioritized":
      return event.priority === null ? "priority cleared" : `prioritised at ${event.priority}`;
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
        priority: event.priority,
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
        /* **CLEARING `needsGreg` IS GREG'S ALONE; SETTING IT IS ANYBODY'S.**
           GPT Sol's P0-2 in round two, which it reproduced: `needsGreg` was
           writable by any actor and excluded from `changesContent`, so
           `edit <id> --by overseer --ready` cleared Greg's blocker without
           bumping the revision or lapsing his approval — and the item came out
           `isDispatchable`. An honestly attributed Overseer edit could
           therefore answer a question only Greg can answer.
           The asymmetry is the fix, and it is the safe direction on both
           sides: *noticing* that something needs him is exactly what the
           coordinator is for, and *deciding it no longer does* is the answer
           itself. */
        if (event.needsGreg === true) item.needsGreg = true;
        else if (event.needsGreg === false) {
          if (event.by === "greg") item.needsGreg = false;
          else {
            problem(
              "unauthorized-authorization",
              `${event.by} tried to clear needsGreg on ${event.id}; only Greg can answer his own question`,
              event.eventId,
            );
          }
        }
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
        /* **A SETTLED ITEM CANNOT BE MOVED, AND THAT GUARD BELONGS HERE.**
           `done`/`dropped` take an item out of `order`, and without this a
           later `moved` puts it straight back in as an invisible ordering
           anchor: GPT Sol reproduced `A,B,C → done A → move A front → move C
           after A`, which yields a visible order of `C,B` with no problem
           recorded. That is the stale-anchor bug this file already claims to
           have fixed, re-entering through a different door — which is why the
           check is on the transition rather than inside `place`. */
        if (!IN_PLAY.includes(item.lifecycle)) {
          problem("illegal-transition", `${event.id} was moved while ${item.lifecycle}`, event.eventId);
          break;
        }
        const placed = place(order, event.id, event.placement);
        if (!placed.ok) {
          problem("missing-anchor", placed.why, event.eventId);
          break;
        }
        item.lastTouchedAt = event.at;
        item.history.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
        break;
      }
      case "prioritized": {
        /* **THE SAME GUARD `moved` HAS, FOR THE SAME REASON.** A settled item
           is out of the ordering, so a priority written against it is a stale
           intent getting a defined answer — and a defined answer to a stale
           intent is worse than a refusal, because nothing says it happened.

           Note what is NOT here: no actor check, and no revision bump. Anybody
           may reorder — that is what `moved` already allows — and reordering is
           not editing. `changesContent` never sees this event. */
        if (!IN_PLAY.includes(item.lifecycle)) {
          problem("illegal-transition", `${event.id} was prioritised while ${item.lifecycle}`, event.eventId);
          break;
        }
        item.priority = event.priority;
        item.lastTouchedAt = event.at;
        item.history.push({ kind: event.kind, at: event.at, by: event.by, what: describeTouch(event) });
        break;
      }
      case "dispatched": {
        /* **THE FOLD CHECKS WHAT THE GATE WOULD HAVE CHECKED, not merely the
           lifecycle.** GPT Sol's P1-3 in round two: this arm asked only
           `lifecycle === "queued"`, so an unauthorised item, one whose approval
           had lapsed, or one still waiting on Greg could become `dispatched`
           with nothing recorded — a dispatch nobody agreed to, sitting in the
           record looking exactly like permission.

           Written out rather than calling `isDispatchable`, because that takes
           a finished view and this is mid-replay: the question here is whether
           the item was dispatchable **at this point in the history**, which is
           the only version of the question a log can answer. The clean-queue
           clause is deliberately absent for the same reason — problems found
           later in the file cannot retrospectively make an earlier dispatch
           wrong. */
        if (item.lifecycle !== "queued") {
          problem("illegal-transition", `${event.id} was dispatched while ${item.lifecycle}`, event.eventId);
          break;
        }
        if (item.authority.kind !== "authorized") {
          problem("illegal-transition", `${event.id} was dispatched while nobody had authorised it`, event.eventId);
          break;
        }
        if (item.authority.revision !== item.revision) {
          problem(
            "illegal-transition",
            `${event.id} was dispatched at revision ${item.revision}, authorised only for ${item.authority.revision}`,
            event.eventId,
          );
          break;
        }
        if (item.needsGreg) {
          problem("illegal-transition", `${event.id} was dispatched while still waiting on Greg`, event.eventId);
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
    priority: m.priority,
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

  /* **THE ORDER THE QUEUE IS ACTUALLY IN IS DECIDED HERE**, once, rather than
     at the three edges that render it (`list`, the route, the panel).

     That is the same argument 260909b makes for computing `ready` server-side:
     three call sites is three chances to forget, and the two that forgot would
     disagree with the one that did not. It matters more than it looks, because
     `waitingAhead` and `itemWait` walk this array to say *"N items ahead of
     it"* — sorted at the edges, they would be counting an order nobody sees.

     `order` itself stays PLACEMENT order and is not touched, so `--front` and
     `--before` keep their meaning and still decide the order within a band.
     The index tiebreak is written out rather than leaning on
     `Array.prototype.sort` being stable: stability would do the job, but the
     explicit key says what the second key IS to the next reader, and it is what
     a mutation check swaps. */
  const placed: IdeaItem[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item !== undefined && IN_PLAY.includes(item.lifecycle)) placed.push(freeze(item));
  }
  const items: IdeaItem[] = placed
    .map((item, index) => ({ item, index }))
    .sort((a, b) => comparePriority(a.item.priority, b.item.priority) || a.index - b.index)
    .map((decorated) => decorated.item);
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

/**
 * Metadata, or null when a field is present and wrong.
 *
 * **PRESENT-BUT-INVALID IS NOT ABSENT**, and the difference is the whole of GPT
 * Sol's P1-1 in round two. The lenient version of this function defaulted a
 * malformed `metadata` to empty, a numeric `title` to `null`, and anything other
 * than literal `true` for `needsGreg` to `false` — so Sol fed in a Greg-added
 * event carrying `needsGreg: "yes"`, `metadata: null` and `title: 42`, and it
 * parsed with no problem at all into an authorised, unblocked, **dispatchable**
 * item. A route straight around `problems`, which is the mechanism the whole
 * file leans on.
 *
 * So: a missing key is a default, and a key that is there and of the wrong type
 * rejects the line. `undefined` from `asStringOrNull` means *present and not a
 * string*, which is why the `?? null` that used to swallow it is gone.
 */
function asMetadata(u: unknown): IdeaMetadata | null {
  /* An absent `metadata` is the empty one; `null` is spelled by every writer
     here for "none", so it is accepted as the same thing. Anything else that is
     not an object is a rejection. */
  if (u === undefined || u === null) return EMPTY_METADATA;
  if (!isRecord(u)) return null;

  const fields: Record<"source" | "waitingOn" | "size" | "runs", string | null> = {
    source: null,
    waitingOn: null,
    size: null,
    runs: null,
  };
  for (const key of ["source", "waitingOn", "size", "runs"] as const) {
    if (!(key in u)) continue;
    const value = asStringOrNull(u[key]);
    /* `undefined` here means PRESENT AND NOT A STRING — the whole point. */
    if (value === undefined) return null;
    fields[key] = value;
  }

  let areas: readonly string[] = [];
  if ("areas" in u) {
    const raw = u["areas"];
    if (!Array.isArray(raw) || raw.some((a) => typeof a !== "string")) return null;
    areas = raw as string[];
  }
  return { ...fields, areas };
}

/**
 * A metadata patch, `undefined` for "not mentioned", or `null` for "present and
 * wrong" — three outcomes, because two of them are legitimate and one is a
 * rejection. Same rule as `asMetadata`: a wrong type is refused, never defaulted.
 */
function asMetadataPatch(u: unknown): Partial<IdeaMetadata> | undefined | null {
  if (u === undefined) return undefined;
  if (!isRecord(u)) return null;
  const patch: Record<string, unknown> = {};
  for (const key of ["source", "waitingOn", "size", "runs"] as const) {
    if (!(key in u)) continue;
    const value = asStringOrNull(u[key]);
    if (value === undefined) return null;
    patch[key] = value;
  }
  if ("areas" in u) {
    const raw = u["areas"];
    if (!Array.isArray(raw) || raw.some((a) => typeof a !== "string")) return null;
    patch["areas"] = raw as string[];
  }
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
      /* Absent is `null`; present and not a string is a REJECTION. */
      const title = "title" in json ? asStringOrNull(json["title"]) : null;
      if (title === undefined) return null;
      const metadata = asMetadata(json["metadata"]);
      if (metadata === null) return null;
      /* **`needsGreg` MUST BE A BOOLEAN IF IT IS THERE AT ALL.** It used to be
         `json["needsGreg"] === true`, which read `"yes"` as *no* — turning a
         blocked item into a dispatchable one by way of a typo. */
      if ("needsGreg" in json && typeof json["needsGreg"] !== "boolean") return null;
      /* Absent means nobody has said, which is `null`. Present and not a
         priority rejects the line — never clamped, never dropped. */
      if ("priority" in json && !isPriority(json["priority"])) return null;
      const priority = "priority" in json && isPriority(json["priority"]) ? json["priority"] : null;
      return {
        ...envelope,
        kind: "added",
        id,
        text,
        title,
        metadata,
        placement,
        needsGreg: json["needsGreg"] === true,
        priority,
      };
    }
    case "edited": {
      if ("text" in json && typeof json["text"] !== "string") return null;
      const text = typeof json["text"] === "string" ? json["text"] : undefined;
      const title = "title" in json ? asStringOrNull(json["title"]) : undefined;
      if ("title" in json && title === undefined) return null;
      const metadata = asMetadataPatch(json["metadata"]);
      if (metadata === null) return null;
      if ("needsGreg" in json && typeof json["needsGreg"] !== "boolean") return null;
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
    case "prioritized": {
      /* **MUST BE PRESENT.** Absent is not "clear it": an event that names no
         priority is a writer that lost its argument, and treating that as an
         intentional clear would silently un-rank an item. */
      if (!("priority" in json) || !isPriority(json["priority"])) return null;
      return { ...envelope, kind: "prioritized", id, priority: json["priority"] };
    }
    case "dispatched": {
      const session = json["session"];
      if (typeof session !== "string" || session === "") return null;
      const plan = "plan" in json ? asStringOrNull(json["plan"]) : null;
      if (plan === undefined) return null;
      return { ...envelope, kind: "dispatched", id, session, plan };
    }
    case "done":
      return { ...envelope, kind: "done", id };
    case "dropped": {
      const why = "why" in json ? asStringOrNull(json["why"]) : null;
      if (why === undefined) return null;
      return { ...envelope, kind: "dropped", id, why };
    }
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
  /** No queue file and no marker: nobody has ever used this queue. */
  | { kind: "never-written"; path: string }
  | { kind: "queue"; view: QueueView; path: string }
  /**
   * Includes **lost**: a marker with no log behind it, or an initialised queue
   * whose file is now empty. Carries its own sentence, and the page draws this
   * arm loudly rather than as an empty list.
   */
  | { kind: "unreadable"; why: string; path: string };

/**
 * Read and fold, or say why not.
 *
 * Unparseable lines become `problems`, which makes the view undispatchable — a
 * queue quietly two items short is exactly the failure this file's discipline
 * exists to prevent, and a silent skip would manufacture it.
 */
/**
 * The file's events, parsed, with unparseable lines dropped.
 *
 * Split out of `readQueue` so the pre-write fold and the read fold are the same
 * parse — two copies of that would be two answers to *what does the file say*,
 * and the pre-write check would eventually bless a batch the reader then
 * rejects. Callers that need to know about the bad lines use `readQueue`.
 */
function readEvents(root: string): IdeaEvent[] {
  const file = path.join(root, QUEUE_FILE);
  if (!existsSync(file)) return [];
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const events: IdeaEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event !== null) events.push(event);
  }
  return events;
}

export function readQueue(root: string = queueRoot()): QueueRead {
  const file = path.join(root, QUEUE_FILE);
  /* **THE READER REFUSES A RELATIVE ROOT TOO, and the comment above used to
     claim this while only the WRITER did it** — Sol found the gap. A relative
     root follows the process's cwd, so two callers started from different
     directories read two different apparent queues and neither can tell. */
  if (!path.isAbsolute(root)) {
    return {
      kind: "unreadable",
      why: `the queue directory must be an absolute path, not '${root}' — a relative one follows the caller's cwd`,
      path: file,
    };
  }
  const initialised = existsSync(path.join(root, QUEUE_INIT_FILE));
  if (!existsSync(file)) {
    /* **THE DISTINCTION SOL'S P1-2 IS ABOUT.** A marker with no log behind it
       is a queue that was lost, not one that never began. */
    if (initialised) {
      return {
        kind: "unreadable",
        why:
          `${file} is gone, but ${QUEUE_INIT_FILE} beside it says this queue was initialised — so this is a ` +
          `LOST queue, not a new one. Nothing should be dispatched until somebody has looked.`,
        path: file,
      };
    }
    return { kind: "never-written", path: file };
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (cause) {
    return { kind: "unreadable", why: `could not read ${file}: ${String(cause)}`, path: file };
  }
  if (text.trim() === "" && initialised) {
    return {
      kind: "unreadable",
      why:
        `${file} is empty, but ${QUEUE_INIT_FILE} says this queue was initialised — so it has been truncated ` +
        `rather than emptied by dropping its items. Nothing should be dispatched until somebody has looked.`,
      path: file,
    };
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

/**
 * Put down the "this queue exists" marker, once.
 *
 * `wx` so it is written exactly once and never rewritten, and a failure is
 * swallowed **only** for the already-exists case: any other failure would mean
 * the directory is unusable, which the append about to follow will report
 * properly. Nothing reads the contents — the file's existence is the signal —
 * so the line inside it is for a person who finds it and wonders.
 */
function writeInitMarker(root: string): void {
  const marker = path.join(root, QUEUE_INIT_FILE);
  if (existsSync(marker)) return;
  try {
    const fd = openSync(marker, "wx");
    try {
      writeAll(
        fd,
        `this queue was initialised at ${new Date().toISOString()}\n` +
          `Its existence is the whole signal: with this file present and ${QUEUE_FILE} absent or empty,\n` +
          `the queue has been LOST rather than never used. Delete both to reset deliberately.\n`,
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* Somebody else created it first, which is the outcome we wanted. */
  }
}

export type AppendResult =
  | { ok: true; view: QueueView; path: string; repaired: JsonlRepair }
  | {
      ok: false;
      code: "stale-version" | "locked" | "unreadable" | "refused" | "would-break";
      why: string;
    };

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

    /* **THE MARKER GOES DOWN BEFORE THE FIRST RECORD, not after.** Written the
       other way round, a crash in between leaves a log with no marker — which
       reads as a brand-new queue, which is the exact false sentence the marker
       exists to prevent. The opposite order fails safe: a marker with no log is
       reported as LOST, which is the reading that makes somebody look. */
    writeInitMarker(root);

    /* **FOLD THE CANDIDATE BEFORE WRITING IT, AND REFUSE IF IT WOULD ADD A
       PROBLEM.** GPT Sol's P1-3 in round two, and the sharpest finding of the
       round: this used to append first and hand back the folded view
       afterwards, so `move` with a missing anchor, or `done` on an unknown id,
       would write an **irreparable** problem and still print a tick. In an
       append-only log with no problem-resolution event, the only repair left is
       editing the file by hand — of an authorisation record.

       Comparing counts rather than contents because the existing problems are
       already in `current`: what is being asked is only *does this batch make
       it worse*. A queue that already has problems can still be appended to,
       which matters — otherwise one bad line would freeze the record forever
       and leave no way to write the note explaining it. */
    const candidate = foldQueue([...readEvents(root), ...events], []);
    if (candidate.problems.length > current.problems.length) {
      const added = candidate.problems.slice(current.problems.length);
      return {
        ok: false,
        code: "would-break",
        why:
          `refusing to write: these ${events.length} event(s) would put ${added.length} new problem(s) into the ` +
          `record, and an append-only log has no way to take them back — ` +
          added.map((p) => `${p.kind}: ${p.why}`).join("; "),
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
