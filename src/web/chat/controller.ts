/**
 * The thing that holds the state, and the reason this is not a `useReducer`.
 *
 * **`dispatch` applies the event and hands back the new state on the same
 * line.** React's does not: it tells you the answer on the next render, which
 * is after the frame that needed it has been handled. One window needs the
 * synchronous answer — a stop or a cancel pressed in the moment before the
 * `begin` frame, remembered and sent as soon as there is an id the server could
 * match — and it is also what removed `onScreen`, `latest` and `showing` from
 * the hook, three refs that existed only to read current state from outside a
 * render. GPT Sol's third blocker, 2026-08-28;
 * docs/plans/chat-operation-model.md.
 *
 * React sees it through `useSyncExternalStore`, so both derived things are
 * cached: `getSnapshot` is called on every render and must hand back the same
 * reference when nothing has moved.
 *
 * **It is now the only thing that fetches, streams or sets a timer.** Stage 2
 * brought in the turn, the recovery and the 409's repair; there is no
 * `legacy.apply` left for anything to write through, and `run` is gone.
 */
import type { ChatMessage, ChatThread } from "../../types.js";
import { ENDED_UNFINISHED } from "../../messages.js";
import { mintId } from "../../ids.js";
import type {
  ChatCommand,
  ChatEvent,
  ChatInput,
  ChatState,
  OpId,
  ThreadsOutcome,
  WriteOutcome,
} from "./model.js";
import { asOpId, initialState, recoveringIds } from "./model.js";
import type { TurnSink } from "./effects.js";
import { project } from "./project.js";
import { reduce } from "./reduce.js";

/**
 * A lost stream goes back and looks for its answer before it gives up.
 *
 * The server does not stop working when a reader's connection dies — see the
 * note on `stopChat` in src/routes.ts, where letting an abandoned answer finish
 * is a deliberate choice — so by the time the client has noticed the silence,
 * the answer it was watching is usually already on disk, complete. Declaring a
 * failure and offering a retry would make the reader pay twice for something
 * they have already bought.
 *
 * So: ask again every `RECOVER_GAP_MS`, until the server's own turn deadline
 * has passed with room to spare, and only then call it a failure.
 */
const RECOVER_GAP_MS = 3_000;

/**
 * The server's deadline for one turn, which is `CHAT_TIMEOUT_MS` in
 * src/converse.ts.
 *
 * **Copied rather than imported**, and not by preference: importing it would
 * pull src/converse.ts — and with it the OpenRouter client, the tool
 * definitions and jsdom — into the browser bundle, which is what
 * tests/client-imports.test.ts exists to prevent. A copied constant that drifts
 * is exactly the silent failure this repo keeps writing up
 * (docs/reusable/silent-success.md): watching would stop while the server was
 * still legitimately writing, and the reader would be told their answer failed
 * moments before it landed. tests/use-chat-recovery.test.ts imports both and
 * asserts they are equal, which a test may do and the client may not.
 */
export const SERVER_TURN_MS = 120_000;

/**
 * How much longer than the server's own deadline a watch keeps looking.
 *
 * It has to cover **two** server numbers, not one: the turn deadline above, and
 * `CHAT_ORPHAN_GRACE_MS` — 150 seconds, after which a sweep turns an abandoned
 * `pending` row into a failure the watch can then adopt. Stopping first would
 * mean declaring a failure over a row the server was seconds from settling, and
 * the reader would see the answer only on their next reload. A test asserts the
 * sum clears the grace period, because the two numbers live in different files
 * and drifting apart is invisible from either side. Found by a GPT-5.6 review,
 * 2026-08-26.
 */
export const RECOVER_MARGIN_MS = 40_000;

/**
 * How long a recovery keeps looking, measured from **now**.
 *
 * Not from the row's `createdAt`, and that is a fix rather than a
 * simplification. The client stamps `createdAt` when the reader presses Enter,
 * and the server may then spend its whole turn deadline in `settleThread`
 * finishing a superseded answer before this turn starts at all — so a deadline
 * anchored to the stamp can already be spent by the time the first word
 * arrives. Anchoring here is also what lets the window cover the server's
 * orphan sweep for a row inherited from a process that is no longer running.
 * Found by a GPT-5.6 review, 2026-08-26.
 */
export function recoverUntil(): number {
  return Date.now() + SERVER_TURN_MS + RECOVER_MARGIN_MS;
}

/**
 * The world, as the controller is allowed to touch it.
 *
 * Passed in rather than imported, for two reasons: it keeps a controller whose
 * effects are an argument drivable by a test with no `fetch` in it at all; and
 * it is the seam that stops this file growing a second copy of the "is this
 * answer still wanted?" question — none of these knows anything about
 * operations.
 *
 * **None of them may reject.** Each maps every way its request can end — a body
 * that says `error`, a non-2xx, a dead network — onto one outcome, because to a
 * reader they are the same thing and used to be handled in three places. That
 * is what lets the decision about whether the answer is still wanted be taken
 * once, at the gate, instead of having a second copy in a `catch`.
 */
export interface ChatEffects {
  loadThreads(slug: string): Promise<ThreadsOutcome>;
  renameThread(slug: string, threadId: string, title: string): Promise<WriteOutcome>;
  deleteThread(slug: string, threadId: string): Promise<WriteOutcome>;
  /** Open one turn's stream and tell the sink every frame. */
  runTurn(
    slug: string,
    threadId: string,
    payload: Record<string, unknown>,
    sink: TurnSink,
  ): Promise<void>;
  /** The server's copy of one answer, once it has stopped moving. */
  settledAnswer(slug: string, threadId: string, messageId: string): Promise<ChatMessage | null>;
  /** Stop one answer. `{ stopped: false }` is a success — see the note there. */
  stopAnswer(
    slug: string,
    threadId: string,
    messageId: string,
    attempt: string | null,
  ): Promise<WriteOutcome>;
  /** Stop the answer and throw the conversation away, in one request. */
  cancelThread(
    slug: string,
    threadId: string,
    messageId: string,
    attempt: string | null,
  ): Promise<WriteOutcome>;
}

/** What React reads: the state, and the two things derived from it. */
export interface ChatSnapshot {
  state: ChatState;
  threads: readonly ChatThread[];
  /** Answers this tab has lost the stream of and is asking the server about. */
  recovering: Set<string>;
}

export class ChatController {
  readonly slug: string;
  #effects: ChatEffects;
  #current: ChatSnapshot;
  #listeners = new Set<() => void>();
  /**
   * What each live send wants to be told if the server overrules its thread id.
   *
   * Kept beside the state rather than in it, because it is a callback rather
   * than data: the reducer must stay a pure function of what it is handed, and
   * a function in the state is something a test that compares two states cannot
   * compare. Pruned when its operation retires.
   */
  #onThreadId = new Map<OpId, (id: string) => void>();

  /** No side effects here — the hook builds one during a render. */
  constructor(slug: string, effects: ChatEffects) {
    this.slug = slug;
    this.#effects = effects;
    const state = initialState(slug);
    this.#current = { state, threads: project(state), recovering: recoveringIds(state) };
  }

  subscribe = (onChange: () => void): (() => void) => {
    this.#listeners.add(onChange);
    return () => {
      this.#listeners.delete(onChange);
    };
  };

  getSnapshot = (): ChatSnapshot => this.#current;

  /** The state as it is **now**, readable from an event handler. */
  get state(): ChatState {
    return this.#current.state;
  }

  /** What is on screen now. The old `latest` and `onScreen` refs, answered. */
  get threads(): readonly ChatThread[] {
    return this.#current.threads;
  }

  /**
   * Start a send, a retry or an edit.
   *
   * Its own method rather than a plain `dispatch`, for one reason: `onThreadId`
   * belongs to this one send and is a callback, so it cannot ride on the event
   * without putting a function in the state.
   */
  startTurn(event: Extract<ChatInput, { type: "turn.started" }>, onThreadId?: (id: string) => void): void {
    if (onThreadId) this.#onThreadId.set(event.op.id, onThreadId);
    this.dispatch(event);
  }

  /**
   * Apply one event, tell React, then go and do what the reducer asked for.
   *
   * The commands run last on purpose: a command that answers instantly would
   * otherwise re-enter with a result for an operation that had not finished
   * being registered.
   */
  dispatch = (event: ChatEvent): ChatState => {
    const before = this.#current;
    const { state, commands } = reduce(before.state, event);
    if (state !== before.state) {
      /* Rebuilt only when something it is made of moved. `getSnapshot` is
         called on every render, and a fresh array each time is an infinite
         render loop rather than a slow one. */
      const drawn =
        state.base !== before.state.base ||
        state.operations !== before.state.operations ||
        state.tombstones !== before.state.tombstones;
      const chasing = state.operations !== before.state.operations;
      this.#current = {
        state,
        threads: drawn ? project(state) : before.threads,
        recovering: chasing ? recoveringIds(state) : before.recovering,
      };
      if (chasing) this.#prune(state);
      /* A copy, because a listener may unsubscribe while being told. */
      for (const listener of [...this.#listeners]) listener();
    }
    for (const command of commands) this.#perform(command);
    return state;
  };

  /** Forget the callbacks of turns that have finished. */
  #prune(state: ChatState): void {
    if (this.#onThreadId.size === 0) return;
    for (const id of [...this.#onThreadId.keys()]) {
      if (!state.operations.has(id)) this.#onThreadId.delete(id);
    }
  }

  #perform(command: ChatCommand): void {
    switch (command.type) {
      case "load":
        this.#settle(
          this.#effects.loadThreads(command.slug),
          (outcome) =>
            outcome.ok
              ? { type: "load.succeeded", opId: command.opId, threads: outcome.threads }
              : { type: "load.failed", opId: command.opId, error: outcome.error },
          (error) => ({ type: "load.failed", opId: command.opId, error }),
        );
        return;
      case "rename":
        this.#settle(
          this.#effects.renameThread(command.slug, command.threadId, command.title),
          (outcome) =>
            outcome.ok
              ? { type: "rename.succeeded", opId: command.opId }
              : { type: "rename.failed", opId: command.opId, error: outcome.error },
          (error) => ({ type: "rename.failed", opId: command.opId, error }),
        );
        return;
      case "delete":
        this.#settle(
          this.#effects.deleteThread(command.slug, command.threadId),
          (outcome) =>
            outcome.ok
              ? { type: "delete.succeeded", opId: command.opId }
              : { type: "delete.failed", opId: command.opId, error: outcome.error },
          (error) => ({ type: "delete.failed", opId: command.opId, error }),
        );
        return;
      case "turn":
        this.#stream(command.opId, command.slug, command.threadId, command.payload);
        return;
      case "repair":
        /* One conversation, because the screen is wrong about that one. The
           narrowing is not tidiness: replacing the whole list put a snapshot
           taken before an unrelated send over the top of that send's rows, and
           every later frame then patched a row that was not there — an answer
           that arrives nowhere. A 409 in one conversation has nothing to say
           about another. Found by a GPT-5.6 review, 2026-08-26. */
        this.#settle(
          this.#effects.loadThreads(command.slug),
          (outcome) =>
            outcome.ok
              ? {
                  type: "repair.succeeded",
                  opId: command.opId,
                  thread: outcome.threads.find((t) => t.id === command.threadId) ?? null,
                }
              : { type: "repair.failed", opId: command.opId, error: outcome.error },
          (error) => ({ type: "repair.failed", opId: command.opId, error }),
        );
        return;
      case "recover":
        void this.#recover(command.opId, command.slug, command.threadId, command.messageId, command.until);
        return;
      case "intent":
        /* **The stop and the cancel are performed here now, and that is the
           whole of GPT Sol's finding 1.** They used to be `fetch`es in the hook,
           fired by a callback the hook installed on this object and cleared in
           an effect cleanup — so `ChatDialog`, which closes itself on the line
           after it presses cancel, unmounted before the `begin` frame arrived
           and the request was never sent at all. The controller outlives the
           hook because the stream still holds it, and it is what the reducer
           asks. tests/chat-unmounted-turn.test.ts. */
        this.#settle(
          command.intent === "cancel"
            ? this.#effects.cancelThread(
                command.slug,
                command.threadId,
                command.messageId,
                command.attempt,
              )
            : this.#effects.stopAnswer(
                command.slug,
                command.threadId,
                command.messageId,
                command.attempt,
              ),
          (outcome) =>
            outcome.ok
              ? { type: "intent.succeeded", opId: command.opId }
              : { type: "intent.failed", opId: command.opId, error: outcome.error },
          (error) => ({ type: "intent.failed", opId: command.opId, error }),
        );
        return;
      case "named":
        if (command.wasThreadId !== command.threadId) {
          // The URL is pointing at an id the server did not accept. Tell the
          // caller so `?thread=` can follow, or a reload lands on a
          // conversation that does not exist.
          this.#onThreadId.get(command.opId)?.(command.threadId);
        }
        return;
    }
  }

  /** One turn's stream, every frame of it an event carrying this turn's id. */
  #stream(opId: OpId, slug: string, threadId: string, payload: Record<string, unknown>): void {
    const sink: TurnSink = {
      began: (begun) => {
        this.dispatch({ type: "turn.began", opId, begun });
      },
      delta: (text) => {
        this.dispatch({ type: "turn.delta", opId, text });
      },
      tool: (index, run) => {
        this.dispatch({ type: "turn.tool", opId, index, run });
      },
      done: (done) => {
        this.dispatch({ type: "turn.done", opId, done });
      },
      failed: (error, text) => {
        this.dispatch({
          type: "turn.failed",
          opId,
          error,
          ...(text === undefined ? {} : { text }),
        });
      },
      refused: (error) => {
        this.dispatch({ type: "turn.refused", opId, error, repair: { id: asOpId(mintId()) } });
      },
      disconnected: (error) => {
        this.dispatch({
          type: "turn.disconnected",
          opId,
          error,
          recovery: { id: asOpId(mintId()), until: recoverUntil() },
        });
      },
    };
    void this.#effects.runTurn(slug, threadId, payload, sink).catch((e: Error) => {
      /* `runTurn` catches its own failures, so this cannot fire against the
         effects in effects.ts — it is here so that one later changed into a
         function that throws joins the same path rather than becoming a second
         one. That is the shape the two worst bugs in this file's history had. */
      this.dispatch({ type: "turn.failed", opId, error: e.message });
    });
  }

  /**
   * Go and find out whether an answer nobody is streaming ever finished.
   *
   * It ends in one of three ways: the row settles on the server and is adopted;
   * the operation stops being live — the reader deleted the conversation, or
   * another writer took the row — and it says nothing; or the window closes and
   * the row becomes a failure the reader can retry.
   *
   * **The entitlement question is asked of the same map the gate reads**, and
   * that is the point of asking it here at all: it is not a second vocabulary,
   * it is an early exit from a loop whose writes still go through the gate.
   */
  async #recover(
    opId: OpId,
    slug: string,
    threadId: string,
    messageId: string,
    until: number,
  ): Promise<void> {
    /** Is this still the operation looking for this row? */
    const live = (): boolean => {
      const op = this.state.operations.get(opId);
      return !!op && op.kind === "recovery" && !op.superseded;
    };
    try {
      for (;;) {
        /* Checked after the await as well as before it. A recovery outlives
           several round trips, and the reader can delete the conversation in
           any of them. */
        if (!live()) break;
        const settled = await this.#effects.settledAnswer(slug, threadId, messageId);
        if (!live()) break;
        if (settled) {
          this.dispatch({ type: "recovery.found", opId, message: settled });
          return;
        }
        if (Date.now() >= until) {
          this.dispatch({ type: "recovery.givenUp", opId, error: ENDED_UNFINISHED.message });
          return;
        }
        await new Promise((r) => setTimeout(r, RECOVER_GAP_MS));
      }
    } catch {
      /* `settledAnswer` swallows its own failures, so this is the same
         belt-and-braces as `#stream`'s: an effect that starts throwing must not
         leave an operation live for ever with nothing coming. */
    }
    this.dispatch({ type: "recovery.stopped", opId });
  }

  /**
   * One request, one event back, whichever way it ends.
   *
   * The rejection branch cannot fire against the effects in effects.ts, which
   * catch their own failures — it is here so that an effect later changed into
   * one that throws joins the same path rather than becoming a second one. That
   * is the shape the two worst bugs in this file's history had: a guard on the
   * success path and a separate place to remember for the failure.
   */
  #settle<T>(
    work: Promise<T>,
    done: (outcome: T) => ChatEvent,
    threw: (error: string) => ChatEvent,
  ): void {
    void work.then(
      (outcome) => this.dispatch(done(outcome)),
      (e: Error) => this.dispatch(threw(e.message)),
    );
  }
}
