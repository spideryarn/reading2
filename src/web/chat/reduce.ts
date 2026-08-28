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
 */
import type { ChatThread } from "../../types.js";
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
  Registering,
  RenameOperation,
} from "./model.js";
import { isResult, mergedArrival, withoutEmpty } from "./model.js";

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
  }
}

/** The map, with one operation gone. An operation retires when it answers. */
function withoutOp(state: ChatState, id: OpId): ReadonlyMap<OpId, Operation> {
  const next = new Map(state.operations);
  next.delete(id);
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
      return {
        state: register<RenameOperation>(
          state,
          event.op,
          (other) => other.kind === "rename" && other.threadId === threadId,
        ),
        commands: [{ type: "rename", opId: event.op.id, slug: state.slug, threadId, title }],
      };
    }
    case "delete.started": {
      const { threadId } = event.op;
      /* The tombstone goes down **before** the request leaves, and it is what
         stops a still-open stream's frames putting the conversation back on
         screen while the DELETE is in flight. */
      const tombstoned: ChatState = {
        ...state,
        tombstones: new Set(state.tombstones).add(threadId),
      };
      return {
        state: register<DeleteOperation>(
          tombstoned,
          event.op,
          /* A delete supersedes everything for that conversation: there will be
             nothing left for the others to draw on. */
          (other) => other.kind !== "load" && other.threadId === threadId,
        ),
        commands: [{ type: "delete", opId: event.op.id, slug: state.slug, threadId }],
      };
    }
    case "thread.begun":
      return { state: { ...state, base: [...state.base, event.thread] }, commands: NOTHING };
    case "thread.discarded": {
      /* `withoutEmpty` filters, so it hands back a new array either way; the
         length is what says whether anything actually went. An unchanged state
         has to be the *same object* for the controller's cached projection to
         survive — see `getSnapshot`. */
      const base = withoutEmpty(state.base, event.threadId);
      return base.length === state.base.length
        ? unchanged(state)
        : { state: { ...state, base }, commands: NOTHING };
    }
    case "tombstone.added": {
      if (state.tombstones.has(event.threadId)) return unchanged(state);
      const tombstones = new Set(state.tombstones);
      tombstones.add(event.threadId);
      return { state: { ...state, tombstones }, commands: NOTHING };
    }
    case "tombstone.removed": {
      if (!state.tombstones.has(event.threadId)) return unchanged(state);
      const tombstones = new Set(state.tombstones);
      tombstones.delete(event.threadId);
      return { state: { ...state, tombstones }, commands: NOTHING };
    }
    case "error.set":
      return state.error === event.error
        ? unchanged(state)
        : { state: { ...state, error: event.error }, commands: NOTHING };
    case "legacy.apply": {
      assertNoTurn(state);
      const base = event.update(state.base);
      return base === state.base
        ? unchanged(state)
        : { state: { ...state, base }, commands: NOTHING };
    }
  }
}

/**
 * The tripwire on the escape hatch, and it is deliberately loud.
 *
 * `legacy.apply` is safe only while nothing projects a turn: it is then a
 * relocation of updaters that still carry their own guards. Once a turn
 * operation exists it is an opaque write to the base underneath a live
 * operation, and neither an allowlist nor a slug check makes that safe — a slug
 * cannot tell two loads of one article apart. Stage 2 deletes the event and
 * this with it.
 */
function assertNoTurn(state: ChatState): void {
  if (!import.meta.env.DEV) return;
  for (const op of state.operations.values()) {
    if (op.kind === "turn") {
      throw new Error(
        "legacy.apply ran while a turn operation was live — see docs/plans/chat-operation-model.md, stage 2",
      );
    }
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
    case "rename.failed": {
      /* **Both outcomes commit the new title to `base`**, and the failure doing
         so is deliberate rather than an oversight: a failed rename stays on
         screen today and still will. Reverting it would be a second surprise on
         top of the first, and the message says what happened.

         Unless this operation was superseded, in which case it has nothing left
         to draw and must not write: a newer rename of the same conversation is
         either already committed or still in flight, and committing this one
         over it is how the reader watches a title they replaced come back. */
      const base =
        op.kind === "rename" && !op.superseded
          ? rewrite(state.base, op.threadId, (t) => ({ ...t, title: op.title }))
          : state.base;
      return {
        state: {
          ...state,
          base,
          operations: withoutOp(state, op.id),
          ...(event.type === "rename.failed"
            ? { error: `Couldn't rename that conversation: ${event.error}` }
            : {}),
        },
        commands: NOTHING,
      };
    }
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
