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
  IntentOperation,
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
import {
  attemptOf,
  isResult,
  mergedArrival,
  withoutEmpty,
  withServerIds,
  writerOf,
} from "./model.js";
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
    case "intent.succeeded":
    case "intent.failed":
      return op.kind === "intent";
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
 * Tell every repair in flight for this conversation that a row has moved.
 *
 * Called from every place that writes a message into `base` — see
 * `RepairOperation.touched`, which is where the reasoning is. Cheap: there is
 * almost never a repair out, and the map is only rebuilt when there is.
 */
function touching(state: ChatState, threadId: string, ids: readonly string[]): ChatState {
  if (ids.length === 0) return state;
  let operations: Map<OpId, Operation> | null = null;
  for (const [id, op] of state.operations) {
    if (op.kind !== "repair" || op.threadId !== threadId) continue;
    const fresh = ids.filter((m) => !op.touched.includes(m));
    if (fresh.length === 0) continue;
    operations ??= new Map(state.operations);
    operations.set(id, { ...op, touched: [...op.touched, ...fresh] });
  }
  return operations ? { ...state, operations } : state;
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
  /* Anything still waiting on this turn is waiting for a `begin` frame that is
     never coming — see `stranded`. */
  const cleared = touching(stranded(state, op.id), op.threadId, [
    op.replyId,
    ...(op.question ? [op.question.id] : []),
  ]);
  const base = rewrite(cleared.base, op.threadId, (t) => {
    const messages = turnMessages(t.messages, op);
    return messages === t.messages ? t : { ...t, updatedAt: op.at, messages };
  });
  return { ...cleared, base, operations: withoutOp(cleared, op.id) };
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
    case "intent.started":
      return startIntent(state, event);
    case "recovery.started":
      return startRecovery(state, event.op);
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
    case "error.set":
      return state.error === event.error
        ? unchanged(state)
        : { state: { ...state, error: event.error }, commands: NOTHING };
  }
}

/**
 * Start looking for a `pending` answer nobody is streaming.
 *
 * **One writer per row, and this is the only place that is enforced.** Two
 * things register a recovery — the hook's scan of what is on screen, which runs
 * on every render and twice under `StrictMode`, and a turn handing its own row
 * over as it retires — and there used to be a copy of this check on each path.
 * Deleting either one reddened nothing, because the other still held: two
 * copies of an invariant are one untested copy and one tested one, and the
 * untested one is where it will next be got wrong. So both paths come through
 * here, and the probe that deletes the check turns exactly the tests that name
 * it red.
 *
 * Refusing the second is idempotence rather than the admission gate — the gate
 * is for results, and a registration has nothing yet to look up.
 */
function startRecovery(state: ChatState, op: Registering<RecoveryOperation>): Outcome {
  if (writerOf(state, op.messageId)) return unchanged(state);
  const { id, threadId, messageId, until } = op;
  return {
    state: register<RecoveryOperation>(state, op, () => false),
    commands: [{ type: "recover", opId: id, slug: state.slug, threadId, messageId, until }],
  };
}

/**
 * The reader pressed stop, or pressed cancel.
 *
 * **The question this asks is "can the server match this row's name yet?", and
 * the answer is different for the two intents.** That is finding 2 of GPT Sol's
 * review of stage 2, and the reason the old `began` test was not enough:
 *
 * - a **stop** is aimed at one *attempt*. Waiting for the `begin` frame is what
 *   gets it the attempt id, so that a stop pressed on the answer the reader is
 *   watching cannot land on the next one instead. It waits whenever a turn is
 *   writing the row and has not been named;
 * - a **cancel** destroys the whole conversation, and any name the server can
 *   match will do. A *retry* writes into a row the server named long ago — it
 *   came back in a load — so a cancel of one need not wait at all. It waited,
 *   under `began`, and if that retry was refused or failed before its frame the
 *   wish was never consumed by anything.
 *
 * The cancel's tombstone goes down here, in the same transition, and is named
 * after this operation: only this operation's own refusal may lift it, which is
 * what stops a cancel that fails after the reader has deleted the conversation
 * from bringing it back.
 */
function startIntent(
  state: ChatState,
  event: Extract<ChatInput, { type: "intent.started" }>,
): Outcome {
  const { id, intent, threadId, messageId } = event.op;
  const writer = writerOf(state, messageId);
  const turn = writer && writer.kind === "turn" ? writer : undefined;
  /* A send and an edit both invent the answer row's id, so only the `begin`
     frame can give it a name the server would recognise. A retry re-uses the
     stored row, which has had one all along. */
  const named = !turn || turn.began || turn.shape === "retry";
  const sendNow = intent === "stop" ? !turn || turn.began : named;
  const waitingOn = sendNow || !turn ? null : turn.id;
  const op: Registering<IntentOperation> = {
    id,
    kind: "intent",
    intent,
    threadId,
    messageId,
    attempt: attemptOf(writer),
    waitingOn,
  };
  /* A wish still waiting for a name is replaced outright rather than
     superseded: it has never been sent, so it has nothing to report and nothing
     to draw, and leaving it in the map would let it fire later. That is the old
     `stopWanted.current.delete(...)` a cancel used to do to a stop on the same
     row, and it is the same rule in both directions — one of them fires, ever. */
  const kept = new Map<OpId, Operation>();
  const replaced = new Set<string>();
  for (const [otherId, other] of state.operations) {
    if (other.kind === "intent" && other.waitingOn !== null && other.messageId === messageId) {
      replaced.add(otherId);
      continue;
    }
    kept.set(otherId, other);
  }
  /* The conversation leaves the screen at once, whatever the server ends up
     saying — the reader pressed a destructive button. A standing tombstone is
     never overwritten, so a cancel arriving after a delete cannot take the
     delete's permanence away — but one laid by a *wish this event has just
     replaced* is inherited, because otherwise nothing left could ever lift it
     and a refused cancel would leave the screen and the server disagreeing. */
  const standing = state.tombstones.get(threadId);
  const inherit = standing && !standing.final && replaced.has(standing.by);
  const marked: ChatState =
    intent === "cancel" && (!standing || inherit)
      ? { ...state, tombstones: tombstoned(state, threadId, { by: id, final: false }) }
      : state;
  const clean: ChatState = { ...marked, operations: kept };
  return {
    state: register<IntentOperation>(
      clean,
      op,
      /* And one already in flight is superseded, so that its answer — which is
         now about a wish the reader has replaced — reports nothing. */
      (other) => other.kind === "intent" && other.messageId === messageId,
    ),
    commands: waitingOn
      ? NOTHING
      : [
          {
            type: "intent",
            opId: id,
            slug: state.slug,
            intent,
            threadId,
            messageId,
            attempt: op.attempt,
          },
        ],
  };
}

/**
 * The turn has been named: send every wish that was waiting for that.
 *
 * **Emitted by the reducer and performed by the controller**, which is the whole
 * of finding 1. It used to be a callback the hook installed on the controller
 * and cleared in an effect cleanup, so a dialog that closed itself on the line
 * after it pressed cancel took the only thing that could send the request with
 * it — see `IntentOperation`.
 *
 * Addressed by `waitingOn` rather than found by row id, which is the other half:
 * ids change here, and a retry re-uses one.
 */
function wishesNamed(
  state: ChatState,
  turn: TurnOperation,
  threadId: string,
  messageId: string,
  attempt: string | null,
): { operations: ReadonlyMap<OpId, Operation>; commands: ChatCommand[] } {
  const operations = new Map<OpId, Operation>(state.operations);
  const commands: ChatCommand[] = [];
  for (const [id, op] of state.operations) {
    if (op.kind !== "intent" || op.waitingOn !== turn.id) continue;
    if (op.superseded) {
      /* Something newer has taken this conversation over — a delete supersedes
         everything for it — so there is nothing left to ask the server for, and
         a wish that is neither sent nor dropped is an operation that never
         retires. */
      operations.delete(id);
      continue;
    }
    operations.set(id, { ...op, threadId, messageId, attempt, waitingOn: null });
    commands.push({
      type: "intent",
      opId: id,
      slug: state.slug,
      intent: op.intent,
      threadId,
      messageId,
      attempt,
    });
  }
  return { operations, commands };
}

/**
 * Every name this tab has for one conversation, moved to the server's, at once.
 *
 * **`turn.began` swaps the thread, the question and the answer, and there were
 * two more names for the same thing that it left behind.** The tombstone is
 * keyed by thread id, so a cancel pressed before the frame laid one under an id
 * that stops existing here — and the conversation the reader had just discarded
 * came back on screen under the server's name, with its own refusal no longer
 * able to find the tombstone to lift. And every *other* operation is keyed by
 * thread id too: a second question typed into a new conversation before the
 * first frame arrives registers a turn naming it the only way it can, and that
 * turn then draws into a conversation that is not there, so the answer arrives
 * nowhere.
 *
 * The rule the half-swap keeps teaching: **if a name changes, everything
 * holding that name changes with it, in the same transition.** The first time it
 * was two message ids out of three and came back weeks later as "That message is
 * not in this conversation."; this is the same lesson one level up. GPT Sol
 * reported it against stage 2 and again after the first round of fixes, because
 * every test in the repo pushed back the id the client had guessed.
 */
function renamed(state: ChatState, from: string, to: string): ChatState {
  if (from === to) return state;
  const operations = new Map<OpId, Operation>();
  for (const [id, op] of state.operations) {
    operations.set(id, op.kind !== "load" && op.threadId === from ? { ...op, threadId: to } : op);
  }
  const standing = state.tombstones.get(from);
  let tombstones = state.tombstones;
  if (standing) {
    const next = new Map(state.tombstones);
    next.delete(from);
    /* A tombstone already under the server's own id was laid by something that
       knew the real name, so it wins — unless this one is a deletion, which
       wins over everything. */
    const already = next.get(to);
    if (!already || standing.final) next.set(to, standing);
    tombstones = next;
  }
  return { ...state, operations, tombstones };
}

/**
 * A turn is retiring, and anything still waiting on it will wait for ever.
 *
 * A wish only ever waits for a `begin` frame, so a turn that ends without one
 * leaves it stranded. It used to be stranded in a `Set` in the hook, under a row
 * id that a *later* retry re-uses — so the next attempt's frame matched it and
 * stopped an answer the reader had just asked for.
 *
 * Both are dropped rather than sent. There is nothing to stop: the turn is over.
 * And there is nothing to cancel by name: the server never wrote this row down
 * under a name this tab knows, so the tombstone — already laid, and deliberately
 * left standing — is the whole of the discard the reader asked for.
 */
function stranded(state: ChatState, turnId: OpId): ChatState {
  let dropped: Map<OpId, Operation> | null = null;
  for (const [id, op] of state.operations) {
    if (op.kind !== "intent" || op.waitingOn !== turnId) continue;
    dropped ??= new Map(state.operations);
    dropped.delete(id);
  }
  return dropped ? { ...state, operations: dropped } : state;
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
      /* Everything else keyed on the name this tab invented — the tombstone, and
         every operation that named the conversation before the server did. */
      const moved = renamed({ ...state, base }, op.threadId, begun.threadId);
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
      /* **And this is the instant a waiting stop or cancel can be sent**, with
         the id, the attempt and the tail the server itself minted. One
         transition, so there is no moment in which the row has a name and the
         wish has not been consumed. */
      const wishes = wishesNamed(
        { ...moved, operations: withOp(moved, named) },
        op,
        begun.threadId,
        begun.messageId,
        begun.attempt ?? null,
      );
      return {
        state: { ...moved, operations: wishes.operations },
        commands: [
          ...wishes.commands,
          {
            type: "named",
            opId: op.id,
            wasThreadId: op.threadId,
            threadId: begun.threadId,
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
      /* Through the same door the scan comes through, so the one-writer rule
         has one copy — `startRecovery`, which refuses this if a recovery the
         scan started has already taken the row. */
      return startRecovery(committed, recovery);
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
        /* **Only a send has rows to drop.** It wrote its question and its empty
           answer into `base` at registration, because nothing withdraws the
           reader's own words — except this, the one case where the server says
           the turn never happened. A retry and an edit drew theirs, and dropping
           the operation has already put those back. */
        drop:
          op.shape === "send"
            ? [op.replyId, ...(op.question ? [op.question.id] : [])]
            : [],
        /* Nothing yet: it collects what is written from now until it answers. */
        touched: [],
      };
      const cleared = stranded(state, op.id);
      const dropped: ChatState = {
        ...cleared,
        operations: withoutOp(cleared, op.id),
        error: event.error,
      };
      return {
        state: register<RepairOperation>(
          dropped,
          repair,
          /* **Repairs supersede each other**, which they did not, so an older
             snapshot could land over a newer one for the same conversation.
             They are both answers to "what does the server have?" and only the
             later question is worth an answer. */
          (other) => other.kind === "repair" && other.threadId === op.threadId,
        ),
        commands: [
          { type: "repair", opId: repair.id, slug: state.slug, threadId: repair.threadId },
        ],
      };
    }
    default:
      return unchanged(state);
  }
}

/**
 * The server's copy of one conversation, laid under what this tab knows.
 *
 * **A repair used to replace the conversation outright**, guarded only against a
 * turn that was live at the instant it landed — and a snapshot is old from the
 * moment it is taken, so everything that finished in between was overwritten by
 * a copy of the conversation as it stood before it happened. GPT Sol's finding 3
 * on stage 2: a rename that had already succeeded went back to its old title, a
 * send that completed first had its rows removed, and two repairs of one
 * conversation could land in either order. And when a turn *was* live it was
 * thrown away instead, so the external turns that caused the 409 stayed missing
 * until the next reload — the repair failing at the one job it has.
 *
 * So it merges, on three rules:
 *
 * - **the server's messages are the record**, because that is what the repair
 *   went to ask for and it is the only party that knows what the 409 was about;
 * - **a row this tab has that the server does not is kept**, and appended. It is
 *   an optimistic row of a send in flight, or one from a turn that started after
 *   the snapshot was taken; either way it is newer than the snapshot by
 *   construction. This is `mergedArrival`'s rule and it holds for the same
 *   reason — see its docstring. The exception is `drop`: the rows of the refused
 *   send itself, which the server has just said do not exist;
 * - **the title is never taken from the server.** A title is not withdrawn and
 *   the last writer to `base` wins, which is the reader's own order — a rename
 *   they made while the repair was out is that order, and the snapshot is not.
 *   The cost, and it is deliberate: a rename made in *another* tab is not picked
 *   up by a repair, and arrives on the next load with everything else.
 *
 * A live turn is no longer a reason to refuse. It draws over `base`, so the
 * merge is re-projected under it; its rows are either the server's already or
 * kept as this tab's own.
 */
function merged(mine: ChatThread, fresh: ChatThread, op: RepairOperation): ChatThread {
  const known = new Set(fresh.messages.map((m) => m.id));
  const extra = mine.messages.filter((m) => !known.has(m.id) && !op.drop.includes(m.id));
  /* A row this tab rewrote while the repair was out keeps this tab's version,
     **in the server's position**, because the id is the same row and only its
     contents are newer here. Without this the snapshot put back the answer a
     retry had replaced, the question an edit had rewritten, and the spinner a
     recovery had just resolved — three rows the "absent from the snapshot" rule
     could not see, because every one of them keeps its id. */
  const messages = op.touched.length
    ? fresh.messages.map((m) => (op.touched.includes(m.id) ? (byId(mine, m.id) ?? m) : m))
    : fresh.messages;
  return {
    ...fresh,
    title: mine.title,
    /* ISO-8601, so the later string is the later moment. */
    updatedAt: fresh.updatedAt > mine.updatedAt ? fresh.updatedAt : mine.updatedAt,
    messages: extra.length === 0 ? messages : [...messages, ...extra],
  };
}

/** One message of one thread, or nothing. */
function byId(thread: ChatThread, id: string): ChatMessage | undefined {
  return thread.messages.find((m) => m.id === id);
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
          error: `Couldn't rename that conversation: ${event.error}`,
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
      if (op.kind !== "repair") return { state: retired, commands: NOTHING };
      const fresh = event.thread;
      const base = fresh
        ? rewrite(retired.base, op.threadId, (t) => merged(t, fresh, op))
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
      if (op.kind !== "recovery") return { state: retired, commands: NOTHING };
      /* Only this row, and only by patching it. Replacing the whole thread with
         the server's copy is the mistake `repair` documents at length: it puts a
         snapshot taken before an unrelated send over the top of that send's
         rows.
         Defaulted before the spread, the same rule the `done` frame follows:
         the stored row omits a field it has nothing to say about, so a spread
         alone cannot clear one left over from the attempt this watch is
         recovering. */
      const noted = touching(retired, op.threadId, [op.messageId]);
      const base = rewriteMessage(noted.base, op.threadId, op.messageId, (m) => ({
        ...m,
        stopped: false,
        truncated: false,
        tools: [],
        error: "",
        ...event.message,
      }));
      return { state: { ...noted, base }, commands: NOTHING };
    }
    case "recovery.givenUp": {
      const retired = { ...state, operations: withoutOp(state, op.id) };
      if (op.kind !== "recovery") return { state: retired, commands: NOTHING };
      const noted = touching(retired, op.threadId, [op.messageId]);
      const base = rewriteMessage(noted.base, op.threadId, op.messageId, (m) => ({
        ...m,
        status: "error" as const,
        error: event.error,
      }));
      return { state: { ...noted, base }, commands: NOTHING };
    }
    case "recovery.stopped":
      /* The reader deleted the conversation, or left the article. Nothing to
         say and nothing to write; the point of the event is that the operation
         stops existing, so `recovering` stops claiming this row is being chased. */
      return { state: { ...state, operations: withoutOp(state, op.id) }, commands: NOTHING };
    case "intent.succeeded":
      /* `{ stopped: false }` comes back here too, and it is not a failure: the
         answer had already finished, or another tab got there first. Nothing to
         write either way — the still-open stream's own `done` frame is what ends
         a stopped turn, which is what keeps the screen and the file agreeing. */
      return { state: { ...state, operations: withoutOp(state, op.id) }, commands: NOTHING };
    case "intent.failed": {
      const retired = { ...state, operations: withoutOp(state, op.id) };
      /* **Superseded, so it says nothing** — and this is the one that was
         missing. The reader cancelled the first answer, then deleted the
         conversation outright while the cancel was still out; the delete
         supersedes everything for that conversation, so when the cancel came
         back refused it had nothing to report. It used to write "Couldn't
         discard that conversation…" over a delete that had succeeded, from a
         `catch` in the hook with no operation behind it and therefore no gate in
         front of it. GPT Sol's finding 4 on stage 2. */
      if (op.kind !== "intent") return { state: retired, commands: NOTHING };
      if (op.intent === "stop") {
        return {
          state: { ...retired, error: `Couldn't stop that answer: ${event.error}` },
          commands: NOTHING,
        };
      }
      /* **The tombstone comes off and the error goes on, in one transition.**
         A 409 means the server refused because the conversation has moved on —
         another tab asked something else — and the reader must not be left
         believing they discarded a conversation that is still there. Only this
         operation's own tombstone, and never a delete's: `by` is this
         operation's id, so a match is proof rather than a coincidence. */
      const standing = retired.tombstones.get(op.threadId);
      const error = `Couldn't discard that conversation: ${event.error}`;
      if (!standing || standing.final || standing.by !== op.id) {
        return { state: { ...retired, error }, commands: NOTHING };
      }
      const tombstones = new Map(retired.tombstones);
      tombstones.delete(op.threadId);
      return { state: { ...retired, tombstones, error }, commands: NOTHING };
    }
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
    /**
     * **A superseded operation retires, and does nothing else.**
     *
     * This used to be asked branch by branch, and the branches disagreed: a
     * superseded repair's *success* was silent and its *failure* still wrote
     * `error`, so the reader could be told a repair had failed moments after a
     * newer one succeeded. That is bug 10 and bug 12's shape exactly — the
     * guard put on the success path and forgotten on the failure path beside
     * it — and it is the shape this gate was built to make impossible. The gate
     * was finding the operation and never asking whether it still had standing.
     *
     * So it is asked once, here, for every kind. The rule reads the same in all
     * of them: something newer has taken over what this operation was doing, so
     * it has nothing left to draw and nothing left to say. It is still
     * *admitted* — that is what lets it retire rather than sit in the map for
     * ever, which is the distinction the plan draws.
     */
    if (op.superseded) {
      /* A turn is superseded only by a delete of its conversation, and a wish
         waiting on it would then wait for ever. */
      const cleared = op.kind === "turn" ? stranded(state, op.id) : state;
      return { state: { ...cleared, operations: withoutOp(cleared, op.id) }, commands: NOTHING };
    }
    return applyResult(state, event, op);
  }
  return applyInput(state, event);
}
