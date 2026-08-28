/**
 * The chat client's state, its events, and the operations in between.
 *
 * The reasoning is in docs/plans/chat-operation-model.md, and the one sentence
 * that produced this directory is GPT Sol's, 2026-08-28:
 *
 * > Every asynchronous action is an operation with its own identity, phase,
 * > intent, and exclusive right to update a particular projection.
 *
 * `src/web/useChat.ts` had none of that, so ten different `await`s each decided
 * for themselves whether they were still entitled to write, from four different
 * vocabularies — and twice the same bug shipped because a guard was added to a
 * success path and not to the failure path beside it.
 *
 * Nothing here has a dependency beyond the shared types. No React, no fetch, no
 * clock: ids and timestamps are minted by the caller and arrive on the event,
 * which is what lets tests/chat-reduce.test.ts run the whole machine without a
 * DOM.
 */
import type { ChatThread, ToolRun } from "../../types.js";

/**
 * The name of one asynchronous action, and **branded** so that a thread id, a
 * message id and an operation id cannot be passed for one another.
 *
 * They are all `spya-…` strings out of the same `mintId()`, so nothing but the
 * type system tells them apart, and the whole admission gate is a lookup by
 * this one.
 */
declare const opIdBrand: unique symbol;
export type OpId = string & { readonly [opIdBrand]: true };

/** Name a freshly minted id as an operation's. Minted outside the reducer. */
export function asOpId(raw: string): OpId {
  return raw as OpId;
}

/**
 * What every operation carries, whatever it is doing.
 *
 * `seq` and `superseded` are filled in by the reducer when the operation is
 * registered, which is why the events below carry operations without them.
 */
interface Registered {
  id: OpId;
  /**
   * Creation order, and the order operations are laid over `base` in.
   *
   * Two operations in one conversation have a defined order and it is this
   * one. A `Map` preserves insertion order, but only for as long as nothing is
   * ever deleted and re-added, which retiring an operation does.
   */
  seq: number;
  /**
   * Has a newer operation taken over what this one draws?
   *
   * A superseded operation **stops projecting immediately** and is still
   * admitted when it answers — its failure still has something to say, it
   * simply has nothing left to draw. Without this, rename A then rename B, with
   * B answering first, commits B, retires it, and lets A — still live, still
   * older — put the replaced title back on screen. GPT Sol, 2026-08-28.
   */
  superseded: boolean;
}

/** The one fetch that fills the list. */
export interface LoadOperation extends Registered {
  kind: "load";
}

/**
 * One conversation, re-fetched because a 409 said the screen is wrong.
 *
 * Registered in the same transition that drops the operation the server
 * refused — they are one decision, and split across two transitions there is a
 * moment where neither is true. Stage 2 constructs this; stage 1 leaves the 409
 * path in the hook.
 */
export interface RepairOperation extends Registered {
  kind: "repair";
  threadId: string;
}

/**
 * A send, a retry or an edit, and the stream it is reading.
 *
 * Stage 2 builds this. The fields are the ones `run` and `drainTurn` already
 * keep in local variables: the words and the tool runs accumulate **in the
 * operation** rather than on the row, because a row is state a later frame
 * cannot read back in time.
 */
export interface TurnOperation extends Registered {
  kind: "turn";
  threadId: string;
  /** The assistant row the words land in. Provisional until the `begin` frame. */
  replyId: string;
  /** Which of the three the reader asked for. They differ only in the payload. */
  shape: "send" | "retry" | "edit";
  text: string;
  tools: readonly ToolRun[];
}

/**
 * A pending answer nobody is streaming, being looked for.
 *
 * Stage 2 builds this too, and it has to arrive with the turn rather than
 * later: a live turn operation would otherwise go on projecting its pending row
 * over the watcher's patch, so the answer would arrive and be invisible.
 */
export interface RecoveryOperation extends Registered {
  kind: "recovery";
  threadId: string;
  messageId: string;
  /** When to stop looking, as a timestamp. Minted outside the reducer. */
  until: number;
}

export interface RenameOperation extends Registered {
  kind: "rename";
  threadId: string;
  title: string;
}

export interface DeleteOperation extends Registered {
  kind: "delete";
  threadId: string;
}

/**
 * Everything asynchronous this hook can be doing.
 *
 * **One map holds every kind, and that is a correction.** An earlier draft had
 * the map hold turns alone with the load's id kept beside it in a field of its
 * own, and Sol refused it: the gate is then a lie, because a load's result
 * carries an `opId` the gate cannot find, so the load needs a second
 * entitlement check somewhere else — which is precisely the shape that produced
 * the two bugs this whole exercise is about. If a thing has an id and can come
 * back late, it is in the map.
 */
export type Operation =
  | LoadOperation
  | RepairOperation
  | TurnOperation
  | RecoveryOperation
  | RenameOperation
  | DeleteOperation;

/** An operation as its caller hands it over: the reducer adds the rest. */
export type Registering<O extends Operation> = Omit<O, "seq" | "superseded">;

/** Where the one fetch that fills the list has got to. */
export type LoadPhase = "loading" | "ready" | "failed";

export interface ChatState {
  slug: string;
  /** What this tab believes, before anything in flight is laid over it. */
  base: readonly ChatThread[];
  /** Everything asynchronous that is happening, each under an id of its own. */
  operations: ReadonlyMap<OpId, Operation>;
  /**
   * Conversations the reader deleted. Deletions win over every projection.
   *
   * In the state rather than in `base`, because the set is consulted by things
   * that are not writing to `base` at all: a cancel adds one before its request
   * leaves, a refused cancel takes it away again, and every late patch in the
   * hook asks whether the conversation is still there. A base updater cannot
   * stand in for it. GPT Sol, 2026-08-28.
   */
  tombstones: ReadonlySet<string>;
  /**
   * Where the one fetch that fills the list got to — **and it outlives that
   * fetch's operation**, which is why it is a field rather than a lookup.
   *
   * An operation retires when it finishes; `loaded` and `loadFailed` have to
   * stay answerable long afterwards, because the panel reads them on every
   * render. "We have asked" is a fact about the past.
   */
  loadPhase: LoadPhase;
  /** A failure of the *transport*. Model failures live on the message. */
  error: string | null;
  /** The next `seq`. In the state so that the reducer stays a pure function. */
  nextSeq: number;
}

export function initialState(slug: string): ChatState {
  return {
    slug,
    base: [],
    operations: new Map(),
    tombstones: new Set(),
    loadPhase: "loading",
    error: null,
    nextSeq: 0,
  };
}

/**
 * The reader doing something, or this code starting something.
 *
 * **Inputs are ungated**, and they have to be: an input is what *registers* an
 * operation, and a registration's operation does not exist yet by definition,
 * so a gate that rejects anything it cannot find would reject every one of
 * them. Registration and admission are different kinds of event and one gate
 * cannot do both — Sol's second refusal, and this split is the answer to it.
 */
export type ChatInput =
  | { type: "load.started"; op: Registering<LoadOperation> }
  | { type: "rename.started"; op: Registering<RenameOperation> }
  | { type: "delete.started"; op: Registering<DeleteOperation> }
  /** A new, empty conversation. Local: nothing is stored until you send. */
  | { type: "thread.begun"; thread: ChatThread }
  /** Forgetting one. A no-op on anything with a message in it. */
  | { type: "thread.discarded"; threadId: string }
  | { type: "tombstone.added"; threadId: string }
  | { type: "tombstone.removed"; threadId: string }
  | { type: "error.set"; error: string | null }
  /**
   * The escape hatch, and **it exists in stage 1 and no other.**
   *
   * `run`, the watcher and the 409 repair still live in the hook and still
   * carry their own guards, so while there are no turn operations this merely
   * relocates their writes. The moment turn projection starts it becomes an
   * opaque write to the base underneath a live operation, and neither an
   * allowlist nor a slug check makes that safe — a slug cannot tell two loads
   * of one article apart. Hence the assertion in `reduce`, and hence stage 2
   * deleting this. GPT Sol, 2026-08-28.
   */
  | {
      type: "legacy.apply";
      update: (prev: readonly ChatThread[]) => readonly ChatThread[];
    };

/**
 * The world answering: a response, a failure, a timeout.
 *
 * **Every one of these carries the `opId` of the operation it belongs to**, and
 * every one goes through the one gate at the top of `reduce`. That is the point
 * of the whole exercise: there is one place an obsolete result is refused, so
 * it cannot be missing from a path, because there are no other paths.
 */
export type ChatResult =
  | { type: "load.succeeded"; opId: OpId; threads: readonly ChatThread[] }
  | { type: "load.failed"; opId: OpId; error: string }
  | { type: "rename.succeeded"; opId: OpId }
  | { type: "rename.failed"; opId: OpId; error: string }
  | { type: "delete.succeeded"; opId: OpId }
  | { type: "delete.failed"; opId: OpId; error: string };

/**
 * A result without an `opId` must not compile, and this is what says so.
 *
 * A comment asking the next person to remember would be the fourth staleness
 * vocabulary this file is trying to get rid of. Adding a member to `ChatResult`
 * that the gate cannot look up turns this line red instead.
 */
type _EveryResultIsAddressed = ChatResult extends { opId: OpId } ? true : never;
const _resultsAreAddressed: _EveryResultIsAddressed = true;
void _resultsAreAddressed;

export type ChatEvent = ChatInput | ChatResult;

/** Which half of the union this is. The gate applies to one of them. */
export function isResult(event: ChatEvent): event is ChatResult {
  return "opId" in event;
}

/**
 * What the reducer asks the controller to go and do.
 *
 * The state changes here; the fetching happens out there. Each command carries
 * the `opId` its answer must come back under, so the controller cannot invent
 * one and the gate always has something to look up.
 */
export type ChatCommand =
  | { type: "load"; opId: OpId; slug: string }
  | { type: "rename"; opId: OpId; slug: string; threadId: string; title: string }
  | { type: "delete"; opId: OpId; slug: string; threadId: string };

/** Either this article's conversations, or why they are not here. */
export type ThreadsOutcome =
  | { ok: true; threads: ChatThread[] }
  | { ok: false; error: string };

/** Either the write stuck, or why it did not. */
export type WriteOutcome = { ok: true } | { ok: false; error: string };

/**
 * Drop a conversation that never had anything said in it.
 *
 * The guard is the whole function, and it leans on an invariant that has to
 * hold on the other side of the wire: **an empty thread exists only in the tab
 * that started it.** Given that, dropping it costs nothing and touches no
 * server. A thread with a message in it is on disk, and removing it here would
 * take it off the screen while leaving it in the file — a deletion that did not
 * delete, undone by the next reload. That is why the id alone is not enough to
 * authorise this, and why `remove` (which does talk to the server) stays a
 * separate call.
 *
 * The invariant is not free: src/chat.ts had an unused `createThread` that
 * wrote an empty thread straight to disk, and one caller of it would have made
 * this function exactly the deletion-that-does-not-delete above. It was deleted
 * rather than left lying there, and the note in its place says why. Found by a
 * GPT-5.6 review, 2026-08-26.
 *
 * Lives here rather than in useChat.ts, which still exports it for the panel
 * and for tests/chat-client.test.ts, because `reduce` needs it and a module
 * that imports the hook it is imported by is a cycle.
 */
export function withoutEmpty(threads: readonly ChatThread[], id: string): ChatThread[] {
  return threads.filter((t) => !(t.id === id && t.messages.length === 0));
}

/**
 * The list the server has just handed us, on top of what this tab already
 * knows — used only for the load on arrival.
 *
 * The arriving list used to be written straight over `threads`, on the
 * reasoning that there is nothing on screen when a panel has only just mounted.
 * That is true for exactly as long as the fetch takes, and no longer: on a slow
 * connection the reader can press `+`, type a question, send it and watch the
 * answer arrive, all before the response to a request made at mount lands.
 * Every one of those is in the list the snapshot then replaced, and the send is
 * the one that costs — its rows go, and each later frame of the answer patches
 * a row that is not there, so the answer arrives nowhere and the reader is
 * looking at a list with no sign they ever asked. Greg hit the visible half of
 * this on a slow connection, 2026-08-27; GPT Sol found this half while
 * reviewing the composer under the list, which made it easy to reach.
 *
 * So the server's list is **added to** what is on screen and never applied over
 * it. Two rules:
 *
 * - **A row already on screen wins.** Not "unless the server's is newer",
 *   because ours is newer by construction: a controller is made per article, so
 *   everything in `prev` was put there afterwards, by this tab, from a send
 *   this tab is watching. The server's copy of the same conversation is at best
 *   equal and at worst the half-written one it had when it answered — the
 *   question stored, the answer still streaming — and a response that crawls
 *   back over a slow connection can be that stale even after the send it is
 *   behind has finished. Preferring ours needs no timing argument at all, which
 *   is what makes it right; a narrower rule that only protected conversations
 *   with a send **still running** left exactly that window open.
 * - **Deletions win**, which `put` has always said and the arriving list did
 *   not. A conversation the reader deleted while the fetch was out is still in
 *   the snapshot, because the send that created it told the server; putting it
 *   back reads as the delete button not working.
 *
 * Both rules are the arrival load's alone. Neither is safe for `refreshThread`,
 * where the screen is the thing known to be wrong and a thread the server does
 * not have is one somebody else deleted — which is why that branch takes the
 * server's copy, and deletes on its absence.
 *
 * `deleted` is passed in rather than read off the state, so this stays a pure
 * function of its arguments.
 */
export function mergedArrival(
  prev: readonly ChatThread[],
  fresh: readonly ChatThread[],
  deleted: ReadonlySet<string>,
): ChatThread[] {
  const ours = new Set(prev.map((t) => t.id));
  /* Appended rather than merged into place, because nothing downstream reads
     this order: ThreadList sorts by `updatedAt`, and the panel finds the open
     conversation by id. */
  return [...prev, ...fresh.filter((t) => !ours.has(t.id) && !deleted.has(t.id))];
}
