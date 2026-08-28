/**
 * The thing that holds the state, and the reason this is not a `useReducer`.
 *
 * **`dispatch` applies the event and hands back the new state on the same
 * line.** React's does not: it tells you the answer on the next render, which
 * is after the frame that needed it has been handled. One window needs the
 * synchronous answer — a stop pressed in the moment before the `begin` frame,
 * remembered and sent as soon as there is an id to send it with — and it is
 * also what removes `onScreen` and `latest` from the hook, two refs that exist
 * only to read current state from outside a render. GPT Sol's third blocker,
 * 2026-08-28; docs/plans/chat-operation-model.md.
 *
 * React sees it through `useSyncExternalStore`, so the projection is cached:
 * `getSnapshot` is called on every render and must hand back the same reference
 * when nothing has moved.
 *
 * **It is not yet the only thing that fetches.** In stage 1 it performs the
 * load, the rename and the delete; `run`, the watcher and the 409 repair are
 * still in the hook, talking to it through `legacy.apply`. Stage 2 brings them
 * in. Saying which stage this is matters — the first draft of the plan promised
 * the end state as though it were the starting one.
 */
import type { ChatThread } from "../../types.js";
import type {
  ChatCommand,
  ChatEvent,
  ChatState,
  ThreadsOutcome,
  WriteOutcome,
} from "./model.js";
import { initialState } from "./model.js";
import { project } from "./project.js";
import { reduce } from "./reduce.js";

/**
 * The world, as the controller is allowed to touch it.
 *
 * Passed in rather than imported, for two reasons: the request functions live
 * in useChat.ts, which imports this file, and a module that imports the module
 * importing it is a cycle; and a controller whose effects are an argument can
 * be driven by a test with no fetch in it at all.
 *
 * **None of these may reject.** Each maps every way its request can end — a
 * body that says `error`, a non-2xx, a dead network — onto one outcome, because
 * to a reader they are the same thing and used to be handled in three places.
 * That is what lets the decision about whether the answer is still wanted be
 * taken once, at the gate, instead of having a second copy in a `catch`.
 */
export interface ChatEffects {
  loadThreads(slug: string): Promise<ThreadsOutcome>;
  renameThread(slug: string, threadId: string, title: string): Promise<WriteOutcome>;
  deleteThread(slug: string, threadId: string): Promise<WriteOutcome>;
}

/** What React reads: the state, and the projection built from it. */
export interface ChatSnapshot {
  state: ChatState;
  threads: readonly ChatThread[];
}

export class ChatController {
  readonly slug: string;
  #effects: ChatEffects;
  #current: ChatSnapshot;
  #listeners = new Set<() => void>();

  /** No side effects here — the hook builds one during a render. */
  constructor(slug: string, effects: ChatEffects) {
    this.slug = slug;
    this.#effects = effects;
    const state = initialState(slug);
    this.#current = { state, threads: project(state) };
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
      const moved =
        state.base !== before.state.base ||
        state.operations !== before.state.operations ||
        state.tombstones !== before.state.tombstones;
      this.#current = { state, threads: moved ? project(state) : before.threads };
      /* A copy, because a listener may unsubscribe while being told. */
      for (const listener of [...this.#listeners]) listener();
    }
    for (const command of commands) this.#perform(command);
    return state;
  };

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
    }
  }

  /**
   * One request, one event back, whichever way it ends.
   *
   * The rejection branch cannot fire against the effects in useChat.ts, which
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
