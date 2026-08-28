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
import type { ChatMessage, ChatThread, Citation, ToolRun } from "../../types.js";

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
 * Who put a tombstone down, and whether anything is allowed to lift it.
 *
 * A bare `Set<string>` could not answer either question, and that cost a
 * conversation: cancel a first answer, delete the conversation while the cancel
 * is still out, and the cancel's refusal took the *delete's* tombstone off — so
 * a conversation the reader deleted came back. Deletions are supposed to win
 * over every projection, and here one lost to an unrelated request failing.
 *
 * `final` is the delete's. Nothing lifts it, in either order: a cancel that
 * arrives afterwards does not overwrite it, and a cancel that arrived first is
 * overwritten by it.
 */
export interface Tombstone {
  /** The operation, or the request, that laid it. */
  by: string;
  /** A deletion. Never lifted. */
  final: boolean;
}

/**
 * A send, a retry or an edit, and the stream it is reading.
 *
 * The words and the tool runs accumulate **in the operation** — on `reply`,
 * which is the row itself — rather than being read back off the list. That is
 * where `drainTurn` kept them and it is for the same reason: two deltas in one
 * tick would each append to the same stale text.
 *
 * **The three shapes differ in what they draw, and that is not an accident of
 * how they were written.** An operation projects what can still be *withdrawn*:
 *
 * - a **send** puts its two rows into `base` at registration, exactly as it
 *   always has, and the operation draws only the answer row's contents. The
 *   rows are not withdrawn by anything — a refused send is repaired by fetching
 *   the conversation — and putting them in `base` is what keeps two sends in one
 *   conversation in the reader's own order however they finish, and what lets
 *   `mergedArrival` see them;
 * - a **retry** draws a blanked row over the answer it replaces, so a refusal
 *   simply puts the old answer back;
 * - an **edit** draws the rewritten question, the discard of everything under
 *   it, and the new answer. That is the whole payoff: a refused edit's turns
 *   come back because they never left.
 */
export interface TurnOperation extends Registered {
  kind: "turn";
  /** Which of the three the reader asked for. */
  shape: "send" | "retry" | "edit";
  /** The conversation. Replaced by the `begin` frame if the server overrules it. */
  threadId: string;
  /** The assistant row the words land in. Provisional until the `begin` frame. */
  replyId: string;
  /** That row, as the frames have left it. The accumulator. */
  reply: ChatMessage;
  /**
   * The reader's row.
   *
   * Written into `base` at registration for a send; **drawn** for an edit,
   * which is a rewrite of a stored question and has to be undoable; `null` for
   * a retry, which re-asks a question already on screen.
   */
  question: ChatMessage | null;
  /** An edit's target: this question and everything under it is replaced. */
  editing: string | null;
  /** The conversation this send had to invent. Written to `base` at registration. */
  opening: ChatThread | null;
  /**
   * A title this turn writes straight into `base`.
   *
   * An edit of the *first* question renames its conversation — `editTurn` on
   * the server says so. It goes into `base` rather than being drawn, for the
   * reason a rename's does: a title is never withdrawn, so the last writer wins
   * and that writer is the reader's own order. See `rename.started` in
   * reduce.ts, and tests/chat-title-ownership.test.ts.
   */
  title: string | null;
  /**
   * Does the `begin` frame's title belong to this conversation?
   *
   * True only for the turn that *creates* it. `withServerIds` used to work this
   * out from "the thread has two messages or fewer", which is the same thing
   * for the case it was written for and wrong for the second send into a
   * one-turn conversation: it would put the server's stored title back over a
   * rename the reader had just made.
   */
  namesThread: boolean;
  /** `updatedAt` for the conversation. Minted outside the reducer. */
  at: string;
  /**
   * Has the server named these rows?
   *
   * Until it has, `replyId` is a name this client invented and no amount of
   * looking on the server will find it — so a stream lost before `begin` cannot
   * be recovered and goes straight to a failure. It is also what tells a stop or
   * a cancel whether there is yet an id the server could match.
   */
  began: boolean;
  /**
   * Which attempt at that row this is, from the `begin` frame.
   *
   * A retry reuses the row, so the id names a place rather than an answer. Sent
   * with a stop so the server can tell "stop the answer I am watching" from
   * "stop whatever happens to be there when this arrives" — `Live.attempt` in
   * src/routes.ts. `null` means the server did not say.
   */
  attempt: string | null;
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
  /**
   * The attempt the lost stream was watching, carried over from the turn.
   *
   * So that a stop pressed while "connection lost — checking…" is on screen
   * still names the answer the reader was watching. This is what the `attempts`
   * ref used to hold, and holding it here is what lets that ref go: an attempt
   * is a fact about one writer, and the recovery is the writer that inherited it.
   */
  attempt: string | null;
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
  tombstones: ReadonlyMap<string, Tombstone>;
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
    tombstones: new Map(),
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
  /**
   * A send, a retry or an edit. Everything it puts on screen is on the op;
   * `payload` is what goes in the request body, which nothing draws.
   */
  | {
      type: "turn.started";
      op: Registering<TurnOperation>;
      payload: Record<string, unknown>;
    }
  /**
   * A `pending` answer with nobody behind it, being looked for.
   *
   * Registered from two places and they must not both take it: the hook's scan
   * of what is on screen, and `turn.disconnected` below, which hands its own
   * row over in the same transition it retires in. The reducer refuses a second
   * recovery for a row that already has one — that is idempotence rather than
   * the admission gate, which is for results.
   */
  | { type: "recovery.started"; op: Registering<RecoveryOperation> }
  /** A new, empty conversation. Local: nothing is stored until you send. */
  | { type: "thread.begun"; thread: ChatThread }
  /** Forgetting one. A no-op on anything with a message in it. */
  | { type: "thread.discarded"; threadId: string }
  /** `by` is who is laying it, and it is what a removal has to match. */
  | { type: "tombstone.added"; threadId: string; by: string }
  | { type: "tombstone.removed"; threadId: string; by: string }
  | { type: "error.set"; error: string | null };

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
  | { type: "delete.failed"; opId: OpId; error: string }
  /**
   * The server's names for this turn's three rows — thread, question and
   * answer — **swapped in one transition**.
   *
   * Two of the three shipped once and surfaced weeks later as "That message is
   * not in this conversation.", so this is deliberately one event and not
   * three: there is no state in which some of the ids are the server's.
   */
  | { type: "turn.began"; opId: OpId; begun: Begun }
  /** One chunk of the answer. Appended to the operation, not read off the row. */
  | { type: "turn.delta"; opId: OpId; text: string }
  /** A tool starting, or the same tool finishing — assigned by index. */
  | { type: "turn.tool"; opId: OpId; index: number; run: ToolRun }
  /** The `done` frame: the finished answer, and everything it came with. */
  | { type: "turn.done"; opId: OpId; done: TurnDone }
  /**
   * The turn is over and there is nothing to recover.
   *
   * The `error` frame inside a 200, a request that never opened, a non-2xx that
   * is not a 409. `text` is the partial answer where the server sent one back;
   * what arrived is kept, because the reader watched it appear.
   */
  | { type: "turn.failed"; opId: OpId; error: string; text?: string }
  /**
   * The stream stopped without ending, or ended without saying how.
   *
   * The server does not stop working when a reader's connection dies, so the
   * answer is usually already on disk. **The turn hands the row to the recovery
   * in one transition** — it commits what it has, retires, and registers the
   * operation that goes looking. Split across two, the live turn would go on
   * projecting its pending row over the answer when it arrived, so the answer
   * would land and be invisible. GPT Sol's second blocker, 2026-08-28.
   *
   * Unless the server never named the row, in which case there is nothing to
   * look for and `error` is what the reader is told. The reducer decides that,
   * because `began` is a fact about the operation.
   */
  | {
      type: "turn.disconnected";
      opId: OpId;
      error: string;
      /**
       * The id and the deadline for the operation that takes the row over. The
       * rest of it — which conversation, which row, which attempt — is a fact
       * about the turn, so the reducer fills it in rather than the caller
       * repeating it and getting one of them wrong.
       */
      recovery: { id: OpId; until: number };
    }
  /**
   * A 409: the server refused a turn this client had already performed.
   *
   * **Dropping the turn and registering the repair is one transition**, because
   * they are one decision — this conversation on screen is wrong, drop what made
   * it wrong and go and ask. Split across two there is a moment where neither is
   * true, and the repair's answer arrives with nothing to admit it.
   */
  | {
      type: "turn.refused";
      opId: OpId;
      error: string;
      /** Only the id: which conversation to repair is the turn's own. */
      repair: { id: OpId };
    }
  /** The server's copy of one conversation. `null` means it does not have it. */
  | { type: "repair.succeeded"; opId: OpId; thread: ChatThread | null }
  | { type: "repair.failed"; opId: OpId; error: string }
  /** The answer, found on the server, once it had stopped moving. */
  | { type: "recovery.found"; opId: OpId; message: ChatMessage }
  /** The window closed and the answer never settled. */
  | { type: "recovery.givenUp"; opId: OpId; error: string }
  /** Nobody is looking any more, and there is nothing to say about it. */
  | { type: "recovery.stopped"; opId: OpId };

/** What the `done` frame carries — the finished answer, and its receipts. */
export interface TurnDone {
  text: string;
  citations?: Citation[];
  searches?: number;
  tools?: ToolRun[];
  truncated?: boolean;
  model?: string;
  stopped?: boolean;
}

/**
 * What the `begin` frame carries: the ids the server actually minted.
 *
 * The client guesses all of them — a thread id so `?thread=` can be in the URL
 * before anything is sent, and two message ids so the reader's words and the
 * empty answer beneath them can be on screen the instant Enter is pressed. Then
 * the server writes the turn to disk under ids of its own, and every guess that
 * is still on screen is a name for a row that does not exist anywhere else.
 */
export interface Begun {
  threadId: string;
  title: string;
  /** The assistant row the answer streams into. */
  messageId: string;
  /** The question above it. Absent from older servers; see `withServerIds`. */
  questionId?: string;
  /**
   * Which attempt at that row this is.
   *
   * A retry writes into the same row, so the id alone does not say *which*
   * answer a stop was pressed on. Sent back with the stop so the server can
   * refuse one aimed at an answer that has already finished — see `Live.attempt`
   * in src/routes.ts.
   */
  attempt?: string;
}

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
  | { type: "delete"; opId: OpId; slug: string; threadId: string }
  /** Open the POST, and read the stream until it ends one of its five ways. */
  | {
      type: "turn";
      opId: OpId;
      slug: string;
      /** The id in the request body. The server may answer with another. */
      threadId: string;
      payload: Record<string, unknown>;
    }
  /** Ask about one conversation, because the screen is wrong about it. */
  | { type: "repair"; opId: OpId; slug: string; threadId: string }
  /** Go and find out whether an answer nobody is streaming ever finished. */
  | {
      type: "recover";
      opId: OpId;
      slug: string;
      threadId: string;
      messageId: string;
      /** When to stop looking, as a timestamp. */
      until: number;
    }
  /**
   * The server has named a turn's rows, and something outside the state wants
   * to know.
   *
   * Two things do, and both have to happen at exactly this instant: the panel's
   * `?thread=` when the server overruled the thread id, and a stop or a cancel
   * the reader pressed before there was an id the server could match. A command
   * rather than a callback on the operation, so that the reducer stays a pure
   * function of data.
   */
  | {
      type: "named";
      opId: OpId;
      /** What the row was called when the reader was looking at it. */
      wasThreadId: string;
      wasReplyId: string;
      /** And what the server calls it. */
      threadId: string;
      replyId: string;
      attempt: string | null;
    };

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
  deleted: { has(id: string): boolean },
): ChatThread[] {
  const ours = new Set(prev.map((t) => t.id));
  /* Appended rather than merged into place, because nothing downstream reads
     this order: ThreadList sorts by `updatedAt`, and the panel finds the open
     conversation by id. */
  return [...prev, ...fresh.filter((t) => !ours.has(t.id) && !deleted.has(t.id))];
}

/**
 * Replace this turn's provisional ids with the server's, in `base`.
 *
 * Pure, and exported, for the reason `withRetry` and `withEdit` are in
 * src/chat.ts: it is a rule about ids that nothing renders, so a mistake in it
 * is invisible until something else needs one of those ids for real. That is
 * exactly how the question id came to be missed — the assistant row was swapped
 * from the first version and the user row was not, nothing on screen changed,
 * and it surfaced weeks later as "That message is not in this conversation."
 * the first time a reader edited a question without reloading first.
 *
 * The question is found by position rather than by id, because its id is the
 * one thing here that is not trustworthy: it is the row immediately above the
 * pending answer, which is what a turn *is*.
 *
 * **`namesThread` is an argument rather than a guess**, and that is a fix. It
 * used to be read off the list as `t.messages.length <= 2`, which says "this is
 * the first turn" for the case it was written for and something else entirely
 * for the *second* send into a one-turn conversation: the server's stored title
 * would land over a rename the reader had made a moment earlier. Only the turn
 * that creates a conversation names it, and only the turn knows that.
 */
export function withServerIds(
  threads: readonly ChatThread[],
  current: string,
  pendingId: string,
  begun: Begun,
  namesThread: boolean,
): ChatThread[] {
  return threads.map((t) =>
    t.id !== current
      ? t
      : {
          ...t,
          id: begun.threadId,
          // The title is cut on a word boundary on the server; the optimistic
          // one is a blunt 60-character slice that would otherwise stay on
          // screen until the next reload.
          title: namesThread ? begun.title : t.title,
          messages: t.messages.map((m, i) => {
            if (m.id === pendingId) return { ...m, id: begun.messageId };
            if (begun.questionId && m.role === "user" && t.messages[i + 1]?.id === pendingId) {
              return { ...m, id: begun.questionId };
            }
            return m;
          }),
        },
  );
}

/**
 * Is somebody in this tab writing that answer row?
 *
 * The one question the recovery scan has to answer, and it cannot be answered
 * from the row: `pending` on screen means "somebody is answering this" and says
 * nothing about whether that somebody is still here. A stream in another tab, a
 * stream in a hook that has since unmounted, and this hook's own live stream
 * all look identical.
 *
 * This is what the `owned` map and the `watched` map both used to answer, from
 * two vocabularies. There is one now, and it is the same map the gate reads.
 */
export function writerOf(state: ChatState, messageId: string): Operation | undefined {
  for (const op of state.operations.values()) {
    if (op.kind === "turn" && op.replyId === messageId) return op;
    if (op.kind === "recovery" && op.messageId === messageId) return op;
  }
  return undefined;
}

/** Answers this tab has lost the stream of and is asking the server about. */
export function recoveringIds(state: ChatState): Set<string> {
  const ids = new Set<string>();
  for (const op of state.operations.values()) {
    if (op.kind === "recovery" && !op.superseded) ids.add(op.messageId);
  }
  return ids;
}
