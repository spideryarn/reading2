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
  /**
   * The rows the refused turn had already written into `base`, which the
   * server has just said do not exist.
   *
   * Only a **send** has any: it writes its question and its empty answer down
   * at registration, because nothing withdraws the reader's own words — except
   * this, the one case where the server says the turn never happened. A retry
   * and an edit *draw*, so dropping their operation is the whole of putting the
   * screen back and there is nothing here for them.
   *
   * Named rather than implied, because the repair no longer replaces the
   * conversation wholesale: it merges, and a merge that kept everything would
   * keep these two rows for ever.
   */
  drop: readonly string[];
  /**
   * The conversation **as it stood when this repair's request went out**, or
   * `null` if there was none.
   *
   * The whole of the answer to a bug that came back four times. A snapshot from
   * the server is old the moment it is taken, so it may only be written if
   * nothing here has moved since it was asked for — and every earlier attempt
   * tried to work out *which rows* had moved, from ids. That kept failing
   * because the mutations are not all replacements: an edit **truncates**, a
   * refused send leaves rows to **drop**, a thread can be **recreated** after
   * the server says it is gone, and each fix modelled the shapes its author had
   * in mind. Sol's four, found one at a time.
   *
   * This models none of them. The reducer never mutates — tests/helpers/chat-reduce.ts
   * enforces it — so any write to this conversation, by any path, present or
   * future, produces a **new object**. Reference inequality is therefore the
   * exact question "has anything happened here since I asked?", and it has no
   * call sites to forget at: a write added tomorrow is covered by construction.
   * Structural sharing is what keeps it from being indiscriminate — a write to
   * another conversation leaves this reference alone.
   *
   * The cost is stated rather than discovered: **a repair does nothing whenever
   * the reader touched that conversation while it was out**, a rename included.
   * They keep a conversation that is locally right, they still have the 409's
   * error message, and the server's version of events arrives on the next load —
   * which is what happened before any of this. Greg chose that over a fifth
   * narrowing, 2026-08-28.
   */
  saw: ChatThread | null;
}

/** Stop this answer, or throw the whole conversation away. Never both. */
export type Intent = "stop" | "cancel";

/**
 * A stop or a cancel, from the moment the reader presses the button.
 *
 * **It is an operation rather than a wish in a ref, and that is the fix for
 * three separate things.** It used to be a `Set` and a `Map` in `useChat`,
 * consumed by a callback the hook installed on the controller — so when
 * `ChatDialog` closed itself on the same line it pressed cancel, React's effect
 * cleanup cleared the callback and the `begin` frame arrived with nobody left to
 * tell. The request was never sent, the server finished the answer and stored
 * it, and the conversation the reader discarded came back on their next reload.
 * Every test missed it because every test kept the hook mounted. GPT Sol,
 * reviewing stage 2, 2026-08-28; tests/chat-unmounted-turn.test.ts.
 *
 * As an operation it is in the state, so the *reducer* decides when to send it
 * and the *controller* sends it — neither of which React can take away. It also
 * gets the two things every other asynchronous action here has: the admission
 * gate in front of its answer, so a cancel refused after the reader has deleted
 * the conversation cannot report over the delete; and supersession, so it can be
 * taken over by something newer.
 *
 * `intent` is the field that cannot hold both at once, which the plan's stage 3
 * asked for and which arrived here because stage 2 could not ship without it.
 */
export interface IntentOperation extends Registered {
  kind: "intent";
  intent: Intent;
  threadId: string;
  /**
   * The answer row this is aimed at, **as the server would name it**.
   *
   * Provisional only while `waitingOn` is set; rewritten to the server's name in
   * the same transition that consumes the wish.
   */
  messageId: string;
  /**
   * Which attempt at that row, so the server can refuse a stop aimed at an
   * answer that has already finished. `null` means nobody has told us.
   */
  attempt: string | null;
  /**
   * The turn whose `begin` frame this is waiting for, or `null` if the request
   * has already gone out.
   *
   * **Addressed to the operation, not looked up by row id.** A row id is not
   * enough: it changes at `turn.began`, a retry reuses one, and a wish left
   * behind by a turn that died before it was named then matched the *next*
   * attempt at the same row and stopped an answer the reader had just asked for.
   */
  waitingOn: OpId | null;
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
  /**
   * The operation that laid it, and the only one that may lift it.
   *
   * A cancel lays its own as it registers and lifts it as it is refused, both
   * inside one transition — so this is an `OpId`, and a match is proof rather
   * than a coincidence. There were two loose events for laying and lifting one
   * of these until 2026-08-28; they went with the last thing that sent them,
   * because a second way of doing this is a second copy of the rule.
   */
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
  /**
   * The conversation this send had to invent. Written to `base` at registration.
   *
   * **An argument, not a fact the operation keeps.** `startTurn` puts it in
   * `base`, records it in `unnamed`, and registers the operation with `null`
   * here — so after registration this is always `null`, and a read of it can
   * never come back with the provisional thread id. `turn.began` moves every
   * name this tab invented to the server's, and this was the one field it could
   * not reach: GPT Sol, 2026-08-28. Renaming it instead would have kept a
   * snapshot that is stale in every other field — no question, no answer, the
   * title as it was — wearing a current id. The conversation is in `base`;
   * `null` says to look there.
   */
  opening: ChatThread | null;
  /**
   * A title this turn writes straight into `base`.
   *
   * An edit of the *first* question renames its conversation — `withEdit` on
   * the server says so. It goes into `base` rather than being drawn, for the
   * reason a rename's does: a title is never withdrawn, so the last writer wins
   * and that writer is the reader's own order. See `rename.started` in
   * reduce.ts, and tests/chat-title-ownership.test.ts.
   */
  title: string | null;
  /**
   * Does the `begin` frame's title belong to this conversation?
   *
   * True for the turn that *creates* it, and for an edit of the first question,
   * which renames it — `withEdit` on the server says so. The frame's title is
   * worth taking because the server cuts on a word boundary and the optimistic
   * one is a blunt 60-character slice.
   *
   * **Reducer-owned, like `seq`, `superseded` and `held`** — which is why
   * `Registering` omits it. It has now been got wrong from two directions and
   * both were the same mistake, a caller answering a question about the state:
   * `withServerIds` used to read it off the list as "two messages or fewer",
   * which said "the first turn" for the case its author had in mind and
   * something else for the second send into a one-turn conversation; so it was
   * made an argument, and the hook then worked it out from the message count on
   * screen and handed over a guess that went stale the moment the reader renamed
   * the conversation. GPT Sol asked for it to come inside on 2026-08-28, and the
   * two facts it needs — `unnamed`, and whether a rename is live for this
   * conversation — are both here and nowhere else. `startTurn` decides it and
   * `readerNamed` withdraws it, which is the same rule from the two sides the
   * reader can arrive from.
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
 * **One finished spoken exchange, on its way to disk.**
 *
 * Live conversation's counterpart to a send, and the shape differs for one
 * reason: both halves are already known. Nothing streams, nothing is pending,
 * and there is no second frame to wait for — the browser talked to OpenAI
 * directly and this operation is the only thing that talks to us about it.
 *
 * **It draws its two rows rather than writing them into `base`**, which is the
 * opposite of a send, and the rule is the one `project.ts` states: an operation
 * projects what can still be *withdrawn*. A send's rows stay because the reader
 * typed them and nothing takes them back. These can be taken back — the server
 * refuses an append behind a conversation that has moved on — and when it does,
 * dropping this operation is the whole of putting the screen right.
 *
 * ## Why there is no client-minted id for the exchange
 *
 * Because `expectedTailId` is already the idempotency. A POST replayed after it
 * succeeded presents a tail the first attempt has moved, so it conflicts rather
 * than appending twice — which is also what makes the retry in
 * `effects.appendSpoken` safe. `SpokenTurn` in src/chat.ts, and
 * docs/plans/live-conversation-in-chat.md § 1.
 */
export interface SpokenOperation extends Registered {
  kind: "spoken";
  /** The conversation. Replaced by the server's name if it overrules this one. */
  threadId: string;
  /** The reader's words. Empty when the transcription failed — a real state. */
  question: ChatMessage;
  /** The companion's words, as the ledger assembled them. */
  reply: ChatMessage;
  /**
   * **The row this append claims is last, and it is a claim about the *server*,
   * not about the screen.**
   *
   * It comes from the live session — the `/live` ticket's `tailId` for the
   * first exchange, and the previous exchange's stored answer id after that —
   * rather than being read off `base` here. That is deliberate: reading it off
   * the projection would pick up ids this tab invented and has not had
   * confirmed, and a guard whose value is a name the server has never heard of
   * conflicts every time, for a reason nobody could see.
   */
  expectedTailId: string | null;
  /** `updatedAt` for the conversation. Minted outside the reducer. */
  at: string;
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

/**
 * Registered, and **not sent yet**, because the server cannot match the name.
 *
 * A rename and a delete both name a conversation, and a conversation the server
 * has not written down is called something this tab invented — see
 * `ChatState.unnamed`. `renameThread` and `deleteThread` in src/chat.ts are a
 * `map` and a `filter` over the stored list, so a request naming one of those
 * changes nothing and answers `200`: the reader is told the delete worked, and
 * the real conversation comes back on their next reload. The silent success this
 * repo keeps writing up — docs/reusable/silent-success.md.
 *
 * **So it is held rather than sent and compensated for.** The `begin` frame is
 * the server saying the thread is on disk, so it is also the first moment a
 * mutation can be addressed; the reducer emits the command there
 * (`renamed` in reduce.ts) and the operation is ordinary from then on.
 *
 * What this replaced was an `outstanding` counter and a second request issued
 * from `renamed()`, and GPT Sol found two holes in it on 2026-08-28: the doomed
 * request could answer *first*, retiring the operation before there was anything
 * left to reissue; and in the **common case there is no rename at all**, because
 * `beginTurn` accepts the client's thread id when it is free — so `renamed()`
 * returned at its first line and the compensation only ever ran on the rarer
 * branch. Closing the window took both of them out.
 *
 * **A held operation may wait for ever, and that is deliberate.** A turn that
 * dies before its frame leaves nothing on the server to rename or delete, so
 * there is nothing to send; keeping it held rather than dropping it is what
 * carries the reader's rename into the *next* question they ask in that
 * conversation. It costs one entry in a map that goes when the article does.
 */
interface Held {
  held: boolean;
}

export interface RenameOperation extends Registered, Held {
  kind: "rename";
  threadId: string;
  title: string;
}

export interface DeleteOperation extends Registered, Held {
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
  | SpokenOperation
  | RecoveryOperation
  | RenameOperation
  | DeleteOperation
  | IntentOperation;

/**
 * An operation as its caller hands it over: the reducer adds the rest.
 *
 * `seq`, `superseded`, `held` and `namesThread` are all answers to questions
 * about the *state*, so the reducer owns them. A caller that filled one in would
 * be the second vocabulary this directory exists to remove — and `held`
 * especially: "has the server named this conversation?" is exactly the question
 * a caller outside the state would have to guess at, which is how `namesThread`
 * came to be wrong, twice. It is in this list now rather than in the argument
 * list, which is the whole of the fix: the hook can no longer supply an answer,
 * right or wrong.
 */
export type Registering<O extends Operation> = Omit<
  O,
  "seq" | "superseded" | "held" | "namesThread"
>;

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
  /**
   * Conversations this tab invented that the server has not confirmed.
   *
   * **The one question a mutation has to ask before it leaves**: can the server
   * match this name? A thread that arrived in a load or in a repair is the
   * server's own, so the default — not in here — is "yes", and nothing has to be
   * recorded for the overwhelming majority of conversations. An id enters at the
   * two places this tab invents a conversation, `thread.begun` and a send's
   * `opening`, and leaves at the one place the server names one, `turn.began`.
   *
   * **Recorded rather than inferred from a live turn, on 2026-08-28, for a
   * reason worth keeping.** The obvious derivation — "is there
   * a turn for this conversation that has not begun?" — is right for the case it
   * is written for and wrong twice over: the turn can retire before the frame,
   * and two sends into one new conversation mean the turn you happened to pick
   * may die while the other names it. It is also blind to a conversation renamed
   * before anything has been asked in it, which has no turn at all. That is the
   * same shape as `withServerIds` working `namesThread` out from the message
   * count — a rule that reads the right answer for the case its author had in
   * mind. See `Held`.
   */
  unnamed: ReadonlySet<string>;
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
    unnamed: new Set(),
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
   * A finished spoken exchange, on its way to disk.
   *
   * Everything it puts on screen is on the op, like a turn's; unlike a turn's
   * there is no separate `payload`, because the two rows and the tail guard
   * *are* the request. The effect builds the body from them, so there is one
   * copy of what a spoken exchange is rather than two that have to agree.
   */
  | { type: "spoken.started"; op: Registering<SpokenOperation> }
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
  /**
   * The reader pressed stop, or pressed cancel.
   *
   * Deliberately **not** a `Registering<IntentOperation>`: the three fields left
   * off — `attempt`, `waitingOn` and, for a cancel, the tombstone — are all
   * answers to "who is writing that row *now*", which is a question about the
   * state and therefore the reducer's to answer. A caller that worked them out
   * for itself would be the second staleness vocabulary this directory exists to
   * remove.
   */
  | {
      type: "intent.started";
      op: { id: OpId; intent: Intent; threadId: string; messageId: string };
    }
  /** A new, empty conversation. Local: nothing is stored until you send. */
  | { type: "thread.begun"; thread: ChatThread }
  /** Forgetting one. A no-op on anything with a message in it. */
  | { type: "thread.discarded"; threadId: string }
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
  /**
   * The exchange is on disk, and this is the server's copy of the conversation
   * it landed in — **including the ids it actually minted**.
   *
   * The whole thread rather than the two rows, because that is what the write
   * returns and because the conversation may not have existed before this: the
   * server may have had to create it, and may have overruled the id this tab
   * invented for it. The drawn rows go the moment this is admitted, replaced by
   * the ones underneath.
   */
  | { type: "spoken.succeeded"; opId: OpId; thread: ChatThread }
  /**
   * A 409: the conversation moved on since the live session read its tail.
   *
   * Somebody typed a turn, or edited one away, or this very request already
   * succeeded and its response was lost. All three want the same answer — drop
   * what was drawn and go and look — so they are one event, and it carries the
   * repair's id for the same reason `turn.refused` does: dropping and repairing
   * are one decision, and split across two transitions there is a moment where
   * neither is true.
   */
  | { type: "spoken.refused"; opId: OpId; error: string; repair: { id: OpId } }
  /** Every attempt failed to reach the server. The exchange is not stored. */
  | { type: "spoken.failed"; opId: OpId; error: string }
  /** The server's copy of one conversation. `null` means it does not have it. */
  | { type: "repair.succeeded"; opId: OpId; thread: ChatThread | null }
  | { type: "repair.failed"; opId: OpId; error: string }
  /** The answer, found on the server, once it had stopped moving. */
  | { type: "recovery.found"; opId: OpId; message: ChatMessage }
  /** The window closed and the answer never settled. */
  | { type: "recovery.givenUp"; opId: OpId; error: string }
  /** Nobody is looking any more, and there is nothing to say about it. */
  | { type: "recovery.stopped"; opId: OpId }
  /**
   * The stop or the cancel landed.
   *
   * `{ stopped: false }` is one of these, not a failure: it means the answer had
   * already finished, or another tab got there first.
   */
  | { type: "intent.succeeded"; opId: OpId }
  /**
   * It did not. For a cancel this is the refusal that puts the conversation
   * back, and the tombstone comes off **in the same transition** as the error is
   * written — one decision, so there is no moment where the conversation is back
   * with nothing said about it.
   */
  | { type: "intent.failed"; opId: OpId; error: string };

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
  /**
   * Write one finished spoken exchange. One request, one answer, no stream.
   *
   * The body is built by the effect from the operation's own rows, so that
   * "what a spoken exchange is" has one definition rather than a copy here and
   * a copy in the reducer that have to agree about, say, whether an empty
   * `passages` array is sent as a key.
   */
  | {
      type: "spoken";
      opId: OpId;
      slug: string;
      threadId: string;
      question: string;
      answer: string;
      expectedTailId: string | null;
      passages?: { blockIds: string[]; why: string }[];
      tools?: ToolRun[];
      interrupted?: boolean;
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
   * Stop one answer, or throw one conversation away. One request either way.
   *
   * Emitted either at `intent.started`, when the row already has a name the
   * server can match, or at `turn.began`, which is the instant one that did not
   * gets one. **Once**, either way — docs/postmortems/cancel-before-begin.md.
   */
  | {
      type: "intent";
      opId: OpId;
      slug: string;
      intent: Intent;
      threadId: string;
      messageId: string;
      attempt: string | null;
    }
  /**
   * The server has overruled a turn's thread id, and the panel's `?thread=` has
   * to follow or a reload lands on a conversation that is not there.
   *
   * The only thing left outside the state that has to hear about `begin`. A stop
   * or a cancel waiting for this frame used to be the other one, through a
   * callback the hook installed — and losing that callback on unmount is how a
   * discarded conversation came back. It is an `IntentOperation` now, and the
   * command above is how it leaves.
   */
  | {
      type: "named";
      opId: OpId;
      /** What the conversation was called when the reader was looking at it. */
      wasThreadId: string;
      /** And what the server calls it. */
      threadId: string;
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

/**
 * Which attempt at that row the writer is on, or `null` if nobody has said.
 *
 * A turn and the recovery that inherits its row are the only two things that
 * know — which is what let the `attempts` map go: an attempt is a fact about one
 * writer, not about a row.
 */
export function attemptOf(op: Operation | undefined): string | null {
  if (!op) return null;
  return op.kind === "turn" || op.kind === "recovery" ? op.attempt : null;
}

/** Answers this tab has lost the stream of and is asking the server about. */
export function recoveringIds(state: ChatState): Set<string> {
  const ids = new Set<string>();
  for (const op of state.operations.values()) {
    if (op.kind === "recovery" && !op.superseded) ids.add(op.messageId);
  }
  return ids;
}
