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
 * docs/plans/260828v-chat-operation-model.md.
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
  Registering,
  SpokenOperation,
  ThreadsOutcome,
  WriteOutcome,
} from "./model.js";
import { asOpId, initialState, recoveringIds } from "./model.js";
import type { SpokenOutcome, TurnSink } from "./effects.js";
import { project, storedSpoken } from "./project.js";
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
/** A spoken handoff waits for this one read, so it must also have an ending. */
const SPOKEN_REPAIR_MS = 10_000;

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
  loadThreads(slug: string, signal?: AbortSignal): Promise<ThreadsOutcome>;
  renameThread(slug: string, threadId: string, title: string): Promise<WriteOutcome>;
  deleteThread(slug: string, threadId: string): Promise<WriteOutcome>;
  /** Open one turn's stream and tell the sink every frame. */
  runTurn(
    slug: string,
    threadId: string,
    payload: Record<string, unknown>,
    sink: TurnSink,
  ): Promise<void>;
  /** Write one finished spoken exchange. One request, no stream. */
  appendSpoken(
    slug: string,
    threadId: string,
    body: Record<string, unknown>,
  ): Promise<SpokenOutcome>;
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

/**
 * Where a spoken exchange ended up, told to whoever wrote it.
 *
 * `tailId` is the whole reason this type exists: it is the id the **next**
 * exchange must claim, and it is the server's, so nothing but the answer to
 * this write can supply it.
 *
 * `conflict` is kept separate from an ordinary failure because it means
 * something different to the caller. A failure is "those words are not saved";
 * a conflict is "the repaired conversation could not confirm this pair". The
 * waiter stays pending while that repair reads; an exact stored pair resolves
 * successfully with the server's tail, and an unresolved conflict ends Live.
 */
export type SpokenLanded =
  | { ok: true; threadId: string; tailId: string }
  | { ok: false; conflict: boolean; error: string };

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
  /**
   * What each spoken append has promised its caller.
   *
   * Beside the state for the same reason `#onThreadId` is: it is a callback,
   * and a function in the state is something a test comparing two states cannot
   * compare.
   *
   * It exists because live conversation needs one thing the panel does not —
   * **the tail the next exchange must claim**. Exchanges are ordered: the
   * second one's `expectedTailId` is the first one's *stored* answer id, which
   * does not exist until the first has landed. So the session has to wait, and
   * the promise is what it waits on. It is also what makes the Send handoff
   * awaitable, which docs/plans/260831l-live-conversation-in-chat.md § 1d asks for by
   * name: an unawaited flush racing the typed POST turns the tail guard into a
   * 409 we inflicted on ourselves.
   */
  #spokenWaiters = new Map<OpId, (landed: SpokenLanded) => void>();

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
   * Write one finished spoken exchange, and **say where it landed**.
   *
   * The one operation that hands its caller a promise. Everything else in this
   * class is fire-and-forget because nothing outside needs to know when it
   * finished; a live session does, twice over — it cannot start the next
   * exchange until it knows the stored id of this one's answer, and the Send
   * button cannot hand over to the typed path until the queue is empty.
   *
   * **It resolves rather than rejects, and it resolves even when the result is
   * refused at the gate.** A superseded operation — the reader deleted the
   * conversation mid-sentence — has nothing to draw and says nothing to the
   * state, but the session still has to be told, or it waits for ever holding a
   * microphone. The promise is a fact about the *request*, not about whether
   * the answer was still wanted.
   */
  appendSpoken(
    op: Registering<SpokenOperation>,
    onThreadId?: (id: string) => void,
  ): Promise<SpokenLanded> {
    if (onThreadId) this.#onThreadId.set(op.id, onThreadId);
    const landed = new Promise<SpokenLanded>((resolve) => {
      this.#spokenWaiters.set(op.id, resolve);
    });
    this.dispatch({ type: "spoken.started", op });
    return landed;
  }

  /** Tell whoever is waiting on this append, once and once only. */
  #landed(opId: OpId, result: SpokenLanded): void {
    const waiting = this.#spokenWaiters.get(opId);
    if (!waiting) return;
    this.#spokenWaiters.delete(opId);
    waiting(result);
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

  /**
   * The consumer that owns these callbacks has gone. Stop calling it.
   *
   * **The controller deliberately outlives the hook** — the stream still holds
   * it, which is what lets a cancel pressed before the `begin` frame still be
   * sent after the dialog closed itself. That is right for everything the
   * reducer decides, because none of it touches the screen. It is wrong for
   * `#onThreadId`, which is the panel's `setThread`: called after the reader
   * closed the dialog or moved to another article, it reopens or repoints
   * whatever they are looking at *now*, because the server corrected an id in a
   * conversation they have left. Unsubscribing removes the render listener and
   * says nothing about this. GPT Sol, 2026-08-28.
   *
   * Only the callbacks go. The intent commands are the controller's own work and
   * carry on, which is the whole distinction: what this object decides for
   * itself survives the unmount, and what it was doing on somebody else's behalf
   * does not.
   */
  detach(): void {
    this.#onThreadId.clear();
  }

  /** Forget the callbacks of turns that have finished. */
  #prune(state: ChatState): void {
    if (this.#onThreadId.size === 0) return;
    for (const id of [...this.#onThreadId.keys()]) {
      if (!state.operations.has(id)) this.#onThreadId.delete(id);
    }
  }

  /**
   * **`#spokenWaiters` is deliberately not pruned here, and not cleared by
   * `detach`.** A waiter is not a callback into the screen — it is the answer to
   * "did that get written down?", which the live session needs whatever the
   * panel is doing, and which arrives *after* the operation has retired. Pruning
   * it on retirement would drop it in the one moment it exists to be used.
   * `#landed` deletes each one as it fires, and `#write` fires exactly one per
   * append on every path including a throw, so the map cannot grow.
   */

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
      case "spoken":
        this.#write(command);
        return;
      case "repair":
        this.#repair(command);
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

  /**
   * One spoken exchange, written — and the waiter told, **after** the event.
   *
   * Deliberately not `#settle`. Two things have to happen in order: the state
   * has to see the result (so the reader's rows are the server's, or gone), and
   * only then may the session be told where the conversation now ends. Told
   * first, it could start the next exchange against a projection that has not
   * caught up — and every exchange after that would be claiming a tail from a
   * screen this tab had not finished updating.
   */
  #write(command: Extract<ChatCommand, { type: "spoken" }>): void {
    const opId = command.opId;
    void this.#effects
      .appendSpoken(command.slug, command.threadId, {
        question: command.question,
        answer: command.answer,
        /* **Sent even when it is `null`, and that is the point.** `null` means
           "I believe this conversation is empty" and the server refuses a body
           with no `expectedTailId` at all — the two are different claims and
           the endpoint keeps them different, so a spread that dropped the key
           would turn a guard into a 400. */
        expectedTailId: command.expectedTailId,
        ...(command.passages ? { passages: command.passages } : {}),
        ...(command.tools ? { tools: command.tools } : {}),
        ...(command.interrupted ? { interrupted: true } : {}),
      })
      .then(
        (outcome) => {
          if (outcome.ok) {
            this.dispatch({ type: "spoken.succeeded", opId, thread: outcome.thread });
            const tail = outcome.thread.messages.at(-1);
            /* A thread with no messages in it cannot come back from a
               successful append — the write puts two there — so this is an
               impossible shape rather than an empty one, and treating it as a
               failure is what stops the next exchange claiming `null` and
               conflicting for a reason nobody could read. */
            this.#landed(
              opId,
              tail
                ? { ok: true, threadId: outcome.thread.id, tailId: tail.id }
                : { ok: false, conflict: false, error: "That exchange was saved to nowhere." },
            );
            return;
          }
          if (outcome.conflict || outcome.uncertain) {
            this.#checkSpoken(opId, outcome.error);
            return;
          }
          this.dispatch({ type: "spoken.failed", opId, error: outcome.error });
          this.#landed(opId, { ok: false, conflict: outcome.conflict, error: outcome.error });
        },
        (e: Error) => {
          /* `appendSpoken` catches its own failures, so this cannot fire
             against the effect in effects.ts — it is here so that one later
             changed into a function that throws joins the same path rather than
             becoming a second one, and above all so the waiter is still told.
             A promise nobody resolves is a live session holding a microphone
             for ever. */
          this.#checkSpoken(opId, e.message);
        },
      );
  }

  /** A refusal or a lost response needs the same one read before we can decide. */
  #checkSpoken(opId: OpId, error: string): void {
    const repairId = asOpId(mintId());
    const state = this.dispatch({ type: "spoken.refused", opId, error, repair: { id: repairId } });
    // A deleted/superseded append cannot register a repair, but its caller
    // still needs an answer. Otherwise the repair owns the waiter now.
    if (!state.operations.has(repairId)) this.#landed(opId, { ok: false, conflict: true, error });
  }

  /** One conversation only; a spoken append keeps its waiter until this read lands. */
  #repair(command: Extract<ChatCommand, { type: "repair" }>): void {
    const operation = this.state.operations.get(command.opId);
    const spoken = operation?.kind === "repair" ? operation.spoken : undefined;
    const result = (outcome: ThreadsOutcome): ChatEvent => outcome.ok
      ? { type: "repair.succeeded", opId: command.opId,
          thread: outcome.threads.find((t) => t.id === command.threadId) ?? null }
      : { type: "repair.failed", opId: command.opId, error: outcome.error };
    if (!spoken) {
      this.#settle(this.#effects.loadThreads(command.slug), result,
        (error) => ({ type: "repair.failed", opId: command.opId, error }));
      return;
    }
    const abort = new AbortController();
    let finished = false;
    const finish = (outcome: ThreadsOutcome) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      // Project the authoritative rows before releasing the live copy. The
      // reducer's existing identity guard still refuses stale repair snapshots.
      this.dispatch(result(outcome));
      const fresh = outcome.ok ? outcome.threads.find((t) => t.id === command.threadId) : undefined;
      const current = this.state.base.find((t) => t.id === command.threadId);
      const answer = storedSpoken(fresh, spoken.operation);
      const landed = answer && storedSpoken(current, spoken.operation);
      // Only the recovered answer belongs to this live model's history. Later
      // server turns must still trip the next append's existing tail guard.
      this.#landed(spoken.operation.id, landed
        ? { ok: true, threadId: command.threadId, tailId: answer.id }
        : { ok: false, conflict: true, error: outcome.ok ? spoken.error : outcome.error });
    };
    const deadline = setTimeout(() => {
      finish({ ok: false, error: "Couldn’t confirm that the spoken exchange was saved in time. Your words are still here." });
      abort.abort();
    }, SPOKEN_REPAIR_MS);
    // Catch synchronous throws as well as rejected effects, and ignore a late
    // response after timeout so it cannot replace the restored live words.
    void Promise.resolve().then(() => this.#effects.loadThreads(command.slug, abort.signal)).then(
      finish,
      (error: Error) => finish({ ok: false, error: error.message }),
    );
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
