/**
 * One pure function, and one gate.
 *
 * `reduce(state, event) => { state, commands }`. It never mutates a `Map`, a
 * `Set`, an operation, a message, a tool array or the event it was handed;
 * `tests/chat-reduce.test.ts` deep-freezes the input, booby-traps the map and
 * the set, and runs every transition twice, because React invokes an updater
 * twice under `StrictMode` and this file's ancestor was bitten by an impure one.
 *
 * See docs/plans/chat-operation-model.md. The shape to keep in mind while
 * reading:
 *
 * - an **input** registers an operation, and cannot be gated, because the
 *   operation it names does not exist yet;
 * - a **result** carries the `opId` of the operation it belongs to, and goes
 *   through the gate at the bottom of this file — the one place an obsolete
 *   answer is refused.
 *
 * Three transitions do **two things at once**, and each is one transition
 * because the pair is one decision:
 *
 * - `turn.refused` drops the turn the server said no to *and* registers the
 *   repair that goes and asks. Split apart, there is a moment where neither is
 *   true and the repair's answer arrives with nothing to admit it;
 * - `turn.disconnected` commits the row, retires the turn *and* hands the row
 *   to the recovery. Split apart, the live turn goes on projecting its pending
 *   row over the answer the recovery finds, so the answer lands and is invisible;
 * - `turn.began` swaps all three of the turn's ids — thread, question and
 *   answer. Two of the three shipped once and surfaced weeks later as "That
 *   message is not in this conversation."
 */
import type { ChatMessage, ChatThread } from "../../types.js";
import type {
  ChatCommand,
  ChatEvent,
  ChatInput,
  ChatResult,
  ChatState,
  DeleteOperation,
  LoadOperation,
  Operation,
  OpId,
  RecoveryOperation,
  Registering,
  RenameOperation,
  RepairOperation,
  Tombstone,
  TurnOperation,
} from "./model.js";
import { isResult, mergedArrival, withoutEmpty, withServerIds, writerOf } from "./model.js";
import { turnMessages } from "./project.js";

export interface Outcome {
  state: ChatState;
  commands: readonly ChatCommand[];
}

const NOTHING: readonly ChatCommand[] = [];

/** Nothing happened, and the *same* state object says so — see the controller. */
function unchanged(state: ChatState): Outcome {
  return { state, commands: NOTHING };
}

/**
 * Is this answer still wanted?
 *
 * The map lookup in `reduce` is most of it: an operation that has retired, or
 * that a later one replaced outright, is not in the map, and its answer is
 * refused whether it succeeded or failed. This adds the second half — that a
 * result must belong to an operation of the matching kind, so that a
 * `rename.failed` cannot be admitted against a load that shares its id.
 */
function accepts(op: Operation, event: ChatResult): boolean {
  switch (event.type) {
    case "load.succeeded":
    case "load.failed":
      return op.kind === "load";
    case "rename.succeeded":
    case "rename.failed":
      return op.kind === "rename";
    case "delete.succeeded":
    case "delete.failed":
      return op.kind === "delete";
    case "turn.began":
    case "turn.delta":
    case "turn.tool":
    case "turn.done":
    case "turn.failed":
    case "turn.disconnected":
    case "turn.refused":
      return op.kind === "turn";
    case "repair.succeeded":
    case "repair.failed":
      return op.kind === "repair";
    case "recovery.found":
    case "recovery.givenUp":
    case "recovery.stopped":
      return op.kind === "recovery";
  }
}

/** The map, with one operation gone. An operation retires when it answers. */
function withoutOp(state: ChatState, id: OpId): ReadonlyMap<OpId, Operation> {
  const next = new Map(state.operations);
  next.delete(id);
  return next;
}

/** The map, with one operation's fields moved on. It has not finished. */
function withOp(state: ChatState, op: Operation): ReadonlyMap<OpId, Operation> {
  const next = new Map(state.operations);
  next.set(op.id, op);
  return next;
}

/**
 * Register an operation, marking whatever it takes over from as superseded.
 *
 * `replaces` says which live operations this one has taken the drawing of. A
 * rename supersedes the previous rename of that conversation; a delete
 * supersedes everything for it. A turn supersedes nothing, because two sends in
 * one conversation are two appends and both belong on screen.
 */
function register<O extends Operation>(
  state: ChatState,
  op: Registering<O>,
  replaces: (other: Operation) => boolean,
): ChatState {
  const operations = new Map<OpId, Operation>();
  for (const [id, other] of state.operations) {
    operations.set(id, replaces(other) ? { ...other, superseded: true } : other);
  }
  operations.set(op.id, { ...op, seq: state.nextSeq, superseded: false } as Operation);
  return { ...state, operations, nextSeq: state.nextSeq + 1 };
}

/** Rewrite one thread in `base`, or hand back the same list if it is not there. */
function rewrite(
  base: readonly ChatThread[],
  id: string,
  edit: (t: ChatThread) => ChatThread,
): readonly ChatThread[] {
  return base.some((t) => t.id === id) ? base.map((t) => (t.id === id ? edit(t) : t)) : base;
}

/** Rewrite one message of one thread. Everything else keeps its reference. */
function rewriteMessage(
  base: readonly ChatThread[],
  threadId: string,
  messageId: string,
  edit: (m: ChatMessage) => ChatMessage,
): readonly ChatThread[] {
  return rewrite(base, threadId, (t) =>
    t.messages.some((m) => m.id === messageId)
      ? { ...t, messages: t.messages.map((m) => (m.id === messageId ? edit(m) : m)) }
      : t,
  );
}

/** The tombstones, with one more on. */
function tombstoned(
  state: ChatState,
  threadId: string,
  mark: Tombstone,
): ReadonlyMap<string, Tombstone> {
  const next = new Map(state.tombstones);
  next.set(threadId, mark);
  return next;
}

/**
 * What a turn has drawn, written into `base`, and the operation retired.
 *
 * **The same function the projection uses**, given the operation's final state.
 * What the reader was looking at and what is written down are then one function
 * of one piece of data rather than two pieces of code that have to agree — and
 * the two that used to do this, an optimistic `setThreads` and a `patchReply`,
 * disagreed twice.
 */
function commit(state: ChatState, op: TurnOperation): ChatState {
  const base = rewrite(state.base, op.threadId, (t) => {
    const messages = turnMessages(t.messages, op);
    return messages === t.messages ? t : { ...t, updatedAt: op.at, messages };
  });
  return { ...state, base, operations: withoutOp(state, op.id) };
}

function applyInput(state: ChatState, event: ChatInput): Outcome {
  switch (event.type) {
    case "load.started": {
      /* A later load **replaces** an earlier one outright rather than merely
         superseding it: the earlier one has nothing left to say, and dropping
         it from the map is what makes the gate refuse both its success and its
         failure by the same rule. Two loads of one article is not a
         contrivance — `StrictMode` starts exactly that on every mount, and the
         earlier one can answer last, with the older snapshot. */
      const kept = new Map<OpId, Operation>();
      for (const [id, op] of state.operations) if (op.kind !== "load") kept.set(id, op);
      /* The list itself is deliberately **not** cleared here. A controller is
         made per article, so arriving at one starts from an empty base already;
         wiping it on a second load of the same article would throw away exactly
         what `mergedArrival` exists to protect. */
      const clean: ChatState = { ...state, operations: kept, loadPhase: "loading", error: null };
      return {
        state: register<LoadOperation>(clean, event.op, () => false),
        commands: [{ type: "load", opId: event.op.id, slug: state.slug }],
      };
    }
    case "rename.started": {
      const { threadId, title } = event.op;
      /* **The title goes into `base` now**, exactly as the `put` this replaced
         did, and the operation exists only to admit its own outcome.

         It used to be drawn by the operation and committed when the PATCH
         answered, which was wrong in a way no reducer test could see: a *first
         question* renames its conversation too — `editTurn` on the server says
         so and `edit` mirrors it — so an edit landing while the PATCH was out
         wrote a title into `base` that the operation then drew over and finally
         overwrote. The reader watched the name they had just replaced come
         back. GPT Sol, reviewing stage 1, 2026-08-28;
         tests/chat-title-ownership.test.ts.

         The rule it is an instance of: **an operation projects what can still
         be withdrawn.** A refused edit's discarded turns come back because the
         operation never really removed them. A rename's optimistic change is
         deliberately never withdrawn — a failed rename stays on screen and says
         so — so there is nothing for it to draw, and the last writer to `base`
         wins, which is the reader's own order. An edit's title follows the same
         rule and lands in `base` the same way, which is why nothing here has to
         supersede a rename's *title*: there is no drawing to take over.

         Tombstoned is left alone, which is what `put` did: a conversation the
         reader has discarded is not renamed under them if a refused cancel
         brings it back. */
      const base = state.tombstones.has(threadId)
        ? state.base
        : rewrite(state.base, threadId, (t) => ({ ...t, title }));
      return {
        state: register<RenameOperation>(
          { ...state, base },
          event.op,
          /* Still superseded, and it still matters — for the *error*, not for
             the title. A rename that was replaced must not report its own
             failure over the newer one's success. */
          (other) => other.kind === "rename" && other.threadId === threadId,
        ),
        commands: [{ type: "rename", opId: event.op.id, slug: state.slug, threadId, title }],
      };
    }
    case "delete.started": {
      const { threadId } = event.op;
      /* The tombstone goes down **before** the request leaves, and it is what
         stops a still-open stream's frames putting the conversation back on
         screen while the DELETE is in flight. `final`, so that an unrelated
         cancel failing cannot lift it — see `Tombstone`. */
      const marked: ChatState = {
        ...state,
        tombstones: tombstoned(state, threadId, { by: event.op.id, final: true }),
      };
      return {
        state: register<DeleteOperation>(
          marked,
          event.op,
          /* A delete supersedes everything for that conversation: there will be
             nothing left for the others to draw on, and a recovery still
             polling for a row in it should stop looking. */
          (other) => other.kind !== "load" && other.threadId === threadId,
        ),
        commands: [{ type: "delete", opId: event.op.id, slug: state.slug, threadId }],
      };
    }
    case "turn.started":
      return startTurn(state, event);
    case "recovery.started": {
      /* **One writer per row, and this is where that is enforced.** The scan in
         the hook runs on every render and `StrictMode` runs its effects twice,
         so this arrives repeatedly for the same row; and `turn.disconnected`
         registers one of its own for a row the scan is about to see. Refusing
         the second is idempotence rather than the admission gate — the gate is
         for results, and a registration has nothing yet to look up. */
      if (writerOf(state, event.op.messageId)) return unchanged(state);
      const { id, threadId, messageId, until } = event.op;
      return {
        state: register<RecoveryOperation>(state, event.op, () => false),
        commands: [{ type: "recover", opId: id, slug: state.slug, threadId, messageId, until }],
      };
    }
    case "thread.begun":
      return { state: { ...state, base: [...state.base, event.thread] }, commands: NOTHING };
    case "thread.discarded": {
      /* **Not while a turn is writing into it.** `withoutEmpty` asks the stored
         messages, and a send's rows are in `base` from the moment it is
         registered — but a *retry* or an *edit* draws rather than writes, so a
         conversation whose only turn is being rewritten can have no messages in
         `base` at all and still be one the reader is watching. Discarding it
         would take a live answer off the screen and leave its stream writing
         into nothing. */
      for (const op of state.operations.values()) {
        if (op.kind === "turn" && op.threadId === event.threadId) return unchanged(state);
      }
      /* `withoutEmpty` filters, so it hands back a new array either way; the
         length is what says whether anything actually went. An unchanged state
         has to be the *same object* for the controller's cached projection to
         survive — see `getSnapshot`. */
      const base = withoutEmpty(state.base, event.threadId);
      return base.length === state.base.length
        ? unchanged(state)
        : { state: { ...state, base }, commands: NOTHING };
    }
    case "tombstone.added":
    case "tombstone.removed":
      return mark(state, event);
    case "error.set":
      return state.error === event.error
        ? unchanged(state)
        : { state: { ...state, error: event.error }, commands: NOTHING };
  }
}

/**
 * A send, a retry or an edit, and what it writes down before it draws anything.
 *
 * **Everything a turn is not going to withdraw goes into `base` here, and
 * nothing else does.** For a send that is the conversation it had to invent and
 * the two rows the reader is already looking at; for an edit it is the new
 * title, which follows the rename rule. A retry writes nothing at all: the
 * answer it is replacing has to be able to come back.
 */
function startTurn(
  state: ChatState,
  event: Extract<ChatInput, { type: "turn.started" }>,
): Outcome {
  const op = event.op;
  let base = op.opening ? [...state.base, op.opening] : state.base;
  if (op.shape === "send" && op.question) {
    const { question, reply, at } = op;
    base = rewrite(base, op.threadId, (t) => ({
      ...t,
      updatedAt: at,
      messages: [...t.messages, question, reply],
    }));
  }
  const { title } = op;
  if (title !== null && !state.tombstones.has(op.threadId)) {
    base = rewrite(base, op.threadId, (t) => ({ ...t, title }));
  }
  return {
    state: register<TurnOperation>(
      { ...state, base },
      op,
      /* **A turn supersedes nothing.** Two sends in one conversation are two
         appends and both belong on screen, and a turn that renamed the
         conversation did so by writing to `base` rather than by drawing, so it
         has taken nothing over from the rename beside it. */
      () => false,
    ),
    commands: [
      { type: "turn", opId: op.id, slug: state.slug, threadId: op.threadId, payload: event.payload },
    ],
  };
}

/**
 * A tombstone going down or coming off, and who is allowed to do either.
 *
 * **Only the one who laid it may lift it, and a delete's is never lifted.**
 * Without the first half, cancel → delete → the cancel's refusal removed the
 * *delete's* tombstone and a conversation the reader had deleted came back.
 * Deletions are supposed to win over every projection; there, one lost to an
 * unrelated request failing. Without the second, the same thing happens through
 * anything that later learns to send this event with an id it did not mint.
 */
function mark(
  state: ChatState,
  event: Extract<ChatInput, { type: "tombstone.added" | "tombstone.removed" }>,
): Outcome {
  const standing = state.tombstones.get(event.threadId);
  if (event.type === "tombstone.added") {
    /* A standing tombstone is never overwritten, so that a cancel arriving
       after a delete cannot take the delete's provenance — and therefore its
       permanence — away. */
    if (standing) return unchanged(state);
    return {
      state: {
        ...state,
        tombstones: tombstoned(state, event.threadId, { by: event.by, final: false }),
      },
      commands: NOTHING,
    };
  }
  if (!standing || standing.final || standing.by !== event.by) return unchanged(state);
  const tombstones = new Map(state.tombstones);
  tombstones.delete(event.threadId);
  return { state: { ...state, tombstones }, commands: NOTHING };
}

/** One frame's worth of change to the answer row, and nothing else moves. */
function moved(state: ChatState, op: TurnOperation, reply: ChatMessage): Outcome {
  return { state: { ...state, operations: withOp(state, { ...op, reply }) }, commands: NOTHING };
}

function applyTurn(state: ChatState, event: ChatResult, op: TurnOperation): Outcome {
  switch (event.type) {
    case "turn.began": {
      const { begun } = event;
      /* **All three ids, in one transition.** `base` holds the rows a send put
         there and the question a retry is re-asking; the operation holds the
         rest. Nothing between these two lines can observe a half-swapped turn,
         which is the state that shipped once and came back weeks later as "That
         message is not in this conversation." */
      const base = withServerIds(state.base, op.threadId, op.replyId, begun, op.namesThread);
      const named: TurnOperation = {
        ...op,
        threadId: begun.threadId,
        replyId: begun.messageId,
        reply: { ...op.reply, id: begun.messageId },
        /* The rewritten question takes the server's name for it. `editing` —
           the *stored* question this edit replaces — deliberately does not: it
           is the handle this operation finds its place in `base` by, and `base`
           still calls that row what it called it a moment ago. */
        question:
          op.question && begun.questionId
            ? { ...op.question, id: begun.questionId }
            : op.question,
        began: true,
        attempt: begun.attempt ?? null,
      };
      return {
        state: { ...state, base, operations: withOp(state, named) },
        commands: [
          {
            type: "named",
            opId: op.id,
            wasThreadId: op.threadId,
            wasReplyId: op.replyId,
            threadId: begun.threadId,
            replyId: begun.messageId,
            attempt: begun.attempt ?? null,
          },
        ],
      };
    }
    case "turn.delta":
      /* Appended to the operation rather than read back off the row. That was
         `drainTurn`'s own reason and it still holds: the row is what the reader
         is looking at, and two deltas arriving in one tick would each append to
         the same stale copy of it. */
      return moved(state, op, { ...op.reply, text: op.reply.text + event.text });
    case "turn.tool": {
      /* A tool starting, or the same tool finishing. **Assigned by index rather
         than appended**, which is what makes the row that says "searching your
         library…" become the row that says what it found, in place, rather than
         a second row underneath it. Copied first, because the array on the row
         is the one React has already rendered. */
      const tools = (op.reply.tools ?? []).slice();
      tools[event.index] = event.run;
      return moved(state, op, { ...op.reply, tools });
    }
    case "turn.done": {
      /* `stopped` and `tools` are both defaulted *before* the spread, for one
         reason: the server omits each of them when there is nothing to say, so
         a spread alone cannot clear a stale one. This row may be a retry of one
         that *was* stopped, and a complete answer wearing "Stopped" underneath
         it is what leaving the field off looks like. */
      const reply: ChatMessage = {
        ...op.reply,
        stopped: false,
        truncated: false,
        tools: [],
        ...event.done,
        status: "done",
      };
      return { state: commit(state, { ...op, reply }), commands: NOTHING };
    }
    case "turn.failed": {
      // The partial answer is kept — the reader watched it appear, and taking
      // it away on failure is more confusing than leaving it there with the
      // failure attached. The server stores it too.
      const reply: ChatMessage = {
        ...op.reply,
        ...(event.text === undefined ? {} : { text: event.text || op.reply.text }),
        status: "error",
        error: event.error,
      };
      return { state: commit(state, { ...op, reply }), commands: NOTHING };
    }
    case "turn.disconnected": {
      /* **Nothing to look for.** Until the `begin` frame, `replyId` is a name
         this client invented and no amount of asking the server will find it —
         so a stream lost before then is a plain failure rather than the
         recovery's business. The watcher used to spend two and a half minutes
         politely asking about an invented id and showing "connection lost,
         checking…" the whole time. */
      if (!op.began) {
        const reply: ChatMessage = { ...op.reply, status: "error", error: event.error };
        return { state: commit(state, { ...op, reply }), commands: NOTHING };
      }
      /* Committed **and** handed over, in one transition. The row stays
         `pending` and goes into `base` as it stands; the recovery is what is
         left writing to it. If the turn stayed live for even one transition
         longer it would go on projecting this row over whatever the recovery
         found, and the answer would arrive and be invisible. */
      const committed = commit(state, op);
      const recovery: Registering<RecoveryOperation> = {
        id: event.recovery.id,
        kind: "recovery",
        threadId: op.threadId,
        messageId: op.replyId,
        until: event.recovery.until,
        /* The attempt goes with the row. A stop pressed while "connection lost
           — checking…" is on screen still has to name the answer the reader was
           watching, and this operation is the one that inherited it. */
        attempt: op.attempt,
      };
      /* Exactly one writer, still: the turn has just retired, so the only way
         this finds one is a recovery the scan started for the same row. */
      if (writerOf(committed, op.replyId)) return { state: committed, commands: NOTHING };
      return {
        state: register<RecoveryOperation>(committed, recovery, () => false),
        commands: [
          {
            type: "recover",
            opId: recovery.id,
            slug: state.slug,
            threadId: recovery.threadId,
            messageId: recovery.messageId,
            until: recovery.until,
          },
        ],
      };
    }
    case "turn.refused": {
      /* **The refusal and the repair are one decision**, so they are one
         transition. Dropping the operation is the whole of putting the screen
         back: a retry's blanked row un-blanks and an edit's discarded turns
         return, because neither was ever taken away — they were drawn over.
         The repair then goes and asks, because the server refused for a reason
         and this tab does not know what it is. */
      const repair: Registering<RepairOperation> = {
        id: event.repair.id,
        kind: "repair",
        threadId: op.threadId,
      };
      const dropped: ChatState = {
        ...state,
        operations: withoutOp(state, op.id),
        error: event.error,
      };
      return {
        state: register<RepairOperation>(dropped, repair, () => false),
        commands: [
          { type: "repair", opId: repair.id, slug: state.slug, threadId: repair.threadId },
        ],
      };
    }
    default:
      return unchanged(state);
  }
}

function applyResult(state: ChatState, event: ChatResult, op: Operation): Outcome {
  switch (event.type) {
    case "load.succeeded":
      return {
        state: {
          ...state,
          /* `mergedArrival` rather than a fresh merge rule: the server's list is
             added to what is on screen and never applied over it, and deletions
             win. Its docstring is the reasoning. */
          base: mergedArrival(state.base, event.threads, state.tombstones),
          operations: withoutOp(state, op.id),
          loadPhase: "ready",
        },
        commands: NOTHING,
      };
    case "load.failed":
      return {
        state: {
          ...state,
          operations: withoutOp(state, op.id),
          /* Still counts as having asked — the panel reads `loaded` as "we have
             asked", not "it worked", so a reader whose server is down can open
             a conversation and watch the send fail with a reason rather than
             face a spinner that never resolves. `failed` is what stops it then
             claiming they have asked nothing. */
          loadPhase: "failed",
          error: event.error,
        },
        commands: NOTHING,
      };
    case "rename.succeeded":
      /* Nothing to write. The title went into `base` when the operation was
         registered, and this is only the entitlement to have been told. */
      return { state: { ...state, operations: withoutOp(state, op.id) }, commands: NOTHING };
    case "rename.failed":
      /* The title stays on screen — reverting it would be a second surprise on
         top of the first, and the message says what happened.

         **Unless a later rename replaced this one**, in which case it has
         nothing to say. The reader is looking at the newer title; telling them
         the rename failed would be reporting a rename that succeeded, or is
         still in flight, as failed. The newer operation reports its own
         outcome. */
      return {
        state: {
          ...state,
          operations: withoutOp(state, op.id),
          ...(op.superseded
            ? {}
            : { error: `Couldn't rename that conversation: ${event.error}` }),
        },
        commands: NOTHING,
      };
    case "delete.succeeded":
      return { state: { ...state, operations: withoutOp(state, op.id) }, commands: NOTHING };
    case "delete.failed":
      /* Not rolled back either — the tombstone stays and the conversation stays
         off screen. Same reasoning as the rename above. */
      return {
        state: {
          ...state,
          operations: withoutOp(state, op.id),
          error: `Couldn't delete that conversation: ${event.error}`,
        },
        commands: NOTHING,
      };
    case "repair.succeeded": {
      const retired = { ...state, operations: withoutOp(state, op.id) };
      if (op.kind !== "repair" || op.superseded) return { state: retired, commands: NOTHING };
      /* **Not over a live turn.** The argument is `refreshThread`'s own and it
         is about age rather than tidiness: anything a turn is writing into this
         conversation is newer than the snapshot the server just answered with,
         so replacing the conversation would put an older copy over rows the
         reader is watching arrive. The turn this repair was fired *for* is
         already gone — dropping it and registering this were one transition. */
      for (const other of retired.operations.values()) {
        if (other.kind === "turn" && other.threadId === op.threadId) {
          return { state: retired, commands: NOTHING };
        }
      }
      const base = event.thread
        ? rewrite(retired.base, op.threadId, () => event.thread as ChatThread)
        : /* The server does not have it at all: it was deleted, or it was never
             written down. Either way it is not a conversation. */
          retired.base.filter((t) => t.id !== op.threadId);
      return { state: { ...retired, base }, commands: NOTHING };
    }
    case "repair.failed":
      return {
        state: { ...state, operations: withoutOp(state, op.id), error: event.error },
        commands: NOTHING,
      };
    case "recovery.found": {
      const retired = { ...state, operations: withoutOp(state, op.id) };
      if (op.kind !== "recovery" || op.superseded) return { state: retired, commands: NOTHING };
      /* Only this row, and only by patching it. Replacing the whole thread with
         the server's copy is the mistake `repair` documents at length: it puts a
         snapshot taken before an unrelated send over the top of that send's
         rows.
         Defaulted before the spread, the same rule the `done` frame follows:
         the stored row omits a field it has nothing to say about, so a spread
         alone cannot clear one left over from the attempt this watch is
         recovering. */
      const base = rewriteMessage(retired.base, op.threadId, op.messageId, (m) => ({
        ...m,
        stopped: false,
        truncated: false,
        tools: [],
        error: "",
        ...event.message,
      }));
      return { state: { ...retired, base }, commands: NOTHING };
    }
    case "recovery.givenUp": {
      const retired = { ...state, operations: withoutOp(state, op.id) };
      if (op.kind !== "recovery" || op.superseded) return { state: retired, commands: NOTHING };
      const base = rewriteMessage(retired.base, op.threadId, op.messageId, (m) => ({
        ...m,
        status: "error" as const,
        error: event.error,
      }));
      return { state: { ...retired, base }, commands: NOTHING };
    }
    case "recovery.stopped":
      /* The reader deleted the conversation, or left the article. Nothing to
         say and nothing to write; the point of the event is that the operation
         stops existing, so `recovering` stops claiming this row is being chased. */
      return { state: { ...state, operations: withoutOp(state, op.id) }, commands: NOTHING };
    default:
      return applyTurn(state, event, op as TurnOperation);
  }
}

/**
 * The whole machine.
 *
 * The three lines under the `isResult` check are the ones that matter. Every
 * result in the system passes through them, so an obsolete answer is refused in
 * one place rather than at ten `await`s that each remembered a different subset
 * of the guards.
 */
export function reduce(state: ChatState, event: ChatEvent): Outcome {
  if (isResult(event)) {
    const op = state.operations.get(event.opId);
    if (!op || !accepts(op, event)) return unchanged(state);
    return applyResult(state, event, op);
  }
  return applyInput(state, event);
}
