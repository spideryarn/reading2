/**
 * The client half of chat — see docs/plans/260826a-chat-mode.md.
 *
 * The sibling of useComments.ts, with one difference that shapes the whole
 * thing: **the POST is a stream, not an answer.** A comment's POST returns the
 * finished comment and there is nothing to poll; here the response body arrives
 * a few words at a time and the reply is assembled on this side as it comes.
 *
 * Which means `fetch` and a `ReadableStream` reader rather than `EventSource`.
 * `EventSource` is the obvious tool for server-sent events and cannot be used:
 * it only issues GETs, and the question does not belong in a URL — it is
 * arbitrary length and it is the reader's private text, which would then be in
 * every access log between here and the server.
 *
 * **The state lives in src/web/chat/, and this file is a façade over it** —
 * docs/plans/260828v-chat-operation-model.md. Every asynchronous thing chat does is an
 * operation with an id of its own, and every answer to one comes back carrying
 * that id and is admitted or refused at one gate, rather than by a guard
 * written out again at each of ten `await`s from four different vocabularies.
 * Stage 2 finished the job: the turn, the recovery and the 409's repair moved
 * in with the load, the rename and the delete, and with them went `run`,
 * `owned`, `released`, `watched`, `running`, `showing`, `attempts` and the
 * escape hatch they were all writing through.
 *
 * **And the two intents went with them**, which stage 3 was supposed to take.
 * A stop and a cancel were two collections of row ids here, consumed by a
 * callback this hook installed on the controller — so a panel that closed itself
 * on the line after it pressed cancel took the only thing that could send the
 * request with it, and the conversation the reader discarded came back on their
 * next reload. They are operations in the state now; this file dispatches one
 * event and reads nothing back. GPT Sol, reviewing stage 2, 2026-08-28;
 * `IntentOperation` in ./chat/model.ts, tests/chat-unmounted-turn.test.ts.
 *
 * **There are no refs left holding state.** The one that remains holds the
 * controller itself.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type {
  ChatAnchor,
  ChatMessage,
  ChatThread,
  RememberStance,
  ThreadKind,
  ToolRun,
} from "../types.js";
import { mintId } from "../ids.js";
import {
  ChatController,
  recoverUntil,
  type ChatEffects,
  type SpokenLanded,
} from "./chat/controller.js";
export type { SpokenLanded } from "./chat/controller.js";
import {
  appendSpoken,
  askForThreads,
  cancelThread,
  deleteThread,
  renameThread,
  runTurn,
  settledAnswer,
  stopAnswer,
} from "./chat/effects.js";
import { asOpId, writerOf } from "./chat/model.js";

/* `mergedArrival`, `withoutEmpty` and `withServerIds` live in ./chat/model.ts,
   where `reduce` can use them: a module that imports the module importing it is
   a cycle. They are re-exported here so that every reference to
   "useChat.ts § mergedArrival" still lands somewhere true, and so that
   tests/chat-client.test.ts keeps the import it has. */
export { mergedArrival, withoutEmpty, withServerIds } from "./chat/model.js";
export type { Begun } from "./chat/model.js";
/* The three deadlines, re-exported for tests/use-chat-recovery.test.ts, which
   checks the two copied server constants against the server's own. */
export { SERVER_TURN_MS, RECOVER_MARGIN_MS } from "./chat/controller.js";
export { OPEN_TIMEOUT_MS } from "./chat/effects.js";

/**
 * One finished spoken exchange, as the live session hands it over.
 *
 * Deliberately the same field names as `SpokenTurn` in src/chat.ts, which is
 * what the server's store takes: the request body, the store's argument and
 * this object are one vocabulary rather than three that have to be translated
 * between. The only field that is not the ledger's is `expectedTailId`, which
 * belongs to the *session* — see `SpokenOperation`.
 */
export interface SpokenExchange {
  threadId: string;
  /** What the reader said. Empty when the transcription failed — a real state. */
  question: string;
  answer: string;
  /** The row this append claims is last, or `null` for "this thread is empty". */
  expectedTailId: string | null;
  passages?: { blockIds: string[]; why: string }[];
  tools?: ToolRun[];
  /** The reader talked over it, so the text may run past what they heard. */
  interrupted?: boolean;
}

/**
 * Everything a send may carry beyond the question itself.
 *
 * Every field here is **per turn**, and several are *only* meaningful on the
 * turn that creates a thread — which is said on each rather than assumed.
 *
 * **An object rather than a positional tail**, and that is the point of it: see
 * `ChatApi.send`.
 */
export interface SendOptions {
  /**
   * Whether this answer should be written for the reader's profile.
   *
   * Per turn, not per thread, and composer-only: a chat answer is not an
   * artefact anybody rewrites, so there is nothing to store a preference
   * against and nothing to flip back to. A reader may reasonably want one
   * plain answer in the middle of a conversation that is otherwise theirs.
   * Absent means yes. docs/project/reader-profile.md.
   */
  useProfile?: boolean;
  /**
   * Called if the server gave the thread a different id than the one sent.
   * See the `begin` frame — it lets the caller correct `?thread=` rather than
   * leaving the URL pointing at a conversation that is not there.
   */
  onThreadId?: (id: string) => void;
  /**
   * The passage this conversation is about — **only on the send that creates
   * the thread**. The server 409s an anchor for a thread that already has a
   * different one, rather than quietly ignoring it.
   */
  anchor?: ChatAnchor;
  /**
   * Chat or Remember — **only on the send that creates the thread**, and the
   * server 409s one that contradicts a thread that already exists.
   *
   * Deliberately absent from `retry` and `edit`: their thread already has a
   * kind, and a field a stale tab could send wrongly is a field worth not
   * having. The server refuses one sent with either.
   */
  kind?: ThreadKind;
  /**
   * How much this answer should say — Remember turns only, and the reader's
   * current picker.
   *
   * Also absent from `retry` and `edit`, and that one is not symmetry: a retry
   * re-asks a **stored** question, so it must be asked the way it was asked.
   * `withRetry` on the server carries the stance over from the answer it is
   * replacing; `withEdit` takes it from the answer being replaced. If this rode
   * along instead, moving the picker and then pressing retry would silently
   * rewrite the instruction attached to a stored turn.
   */
  stance?: RememberStance;
  /**
   * **The reader pressed the "?" beside a paragraph rather than typing this.**
   *
   * Report 1R's metadata and report 1S's pedagogy, in one flag. It is stored on
   * the user row and read back off it, so — unlike everything above — a retry or
   * an edit of a help question is still a help question without the client
   * saying anything. Which is exactly why the server refuses it on both. See
   * `ChatMessage.help` in src/types.ts.
   *
   * `true` or absent. The route validates *absent or literal `true`* and 400s
   * anything else, so a `false` on the wire would be a bug that reads as
   * politeness.
   */
  help?: true;
  /**
   * The comment this conversation is being started from — **only on the send
   * that creates the thread**, and passed straight through to the server.
   *
   * The link is written *there*, once the real thread id exists, because the id
   * `send` returns is minted optimistically and the client only hears about an
   * overrule when there is one. See
   * docs/plans/260828a-comments-and-bookmarks.md § the Save & ask choreography.
   */
  sourceCommentId?: string;
}

export interface ChatApi {
  threads: ChatThread[];
  /**
   * Has the first fetch come back?
   *
   * The caller opens a new conversation when there are none, and "none" is
   * indistinguishable from "not asked yet" without this — so every visit to
   * chat mode would create a thread before the reader's real ones had arrived,
   * and then not create one when they legitimately had none.
   */
  loaded: boolean;
  /**
   * Did that first fetch fail?
   *
   * **`loaded` says we have asked, not that it worked, and the panel's empty
   * state needs the difference.** Without this the list falls straight from the
   * spinner into "Nothing asked yet." the moment the request gives up — the
   * same false claim the spinner was added to stop, one beat later. GPT Sol,
   * reviewing that first fix, 2026-08-27.
   *
   * Not `error !== null`. `error` carries any failure of any request in this
   * hook — a stop, a delete, an answer that would not start — and outlives the
   * one that caused it. This is about the one fetch that fills the list.
   */
  loadFailed: boolean;
  /**
   * **Ask for the thread list again.**
   *
   * One caller: Candidates' automatic run, for the one case a press cannot be
   * answered from what is on screen — a first read that *failed* is not an
   * answer to *is there a thread yet*, so it is answered by reading again rather
   * than by starting a paid turn. useAutoRun.ts § A failed read is not an
   * answer.
   *
   * **Safe by construction rather than by a guard here.** It dispatches a second
   * `load.started`, and registering a second load drops the first from the map
   * in reduce.ts — so the first load's success *and* its failure are refused by
   * the same rule, which is exactly the arrangement the effect below relies on
   * for `StrictMode`'s two loads. Nothing needs to be cancelled.
   */
  reload(): void;
  /**
   * Answers whose stream this client has lost, and is now asking the server
   * about. The row is still `pending`, but nothing is arriving and the panel
   * should say so rather than go on claiming to be thinking.
   *
   * Derived from the recovery operations that exist, rather than stored: "we
   * are looking for this" is exactly what a `RecoveryOperation` *is*, and two
   * places recording the same fact is how they came to disagree before.
   */
  recovering: Set<string>;
  /* No `streaming` flag here, and its absence is deliberate.
     One was exported and nothing used it — the composer takes its `busy` state
     from the *message* it is waiting on, which is the honest source: sends can
     overlap across threads, and a single boolean would have been set false by
     whichever finished first while another was still arriving. A wrong answer
     nobody was asking for. Removed after a GPT-5.6 review, 2026-08-26. */
  /**
   * Send a question. Returns the thread id it went to — minted here when the
   * reader is starting a new conversation, so `?thread=` can point at something
   * from the first frame rather than after the round trip.
   *
   * **Three positional arguments and then one options object**, and the change
   * is not tidiness. This took nine positionals, and call sites read
   * `send(text, at, true, undefined, undefined, undefined, id)` — which is
   * exactly the shape that lets a new field land in the wrong slot with the
   * compiler agreeing, because half of them are `string | undefined`. This repo
   * has already had a field silently never reach the server
   * (tests/chat-kind-reaches-the-server.test.tsx), and adding a tenth was the
   * moment to stop.
   */
  send(threadId: string | null, question: string, at: string | null, opts?: SendOptions): string;
  /**
   * Answer the same question again, replacing the answer in place.
   *
   * Only the last answer in a thread — the server refuses anything else with a
   * 409, and the panel only offers the button there. See `retryTurn` in
   * src/chat.ts for why a conversation with a rewritten middle is worse than
   * one you cannot rewrite.
   */
  retry(threadId: string, messageId: string): void;
  /**
   * Rewrite one of the reader's questions and ask it again.
   *
   * **Discards every turn after it.** `discardedAfter` in the panel is how it
   * says so before the reader commits — and the discard is now something the
   * *operation* draws, so a server that refuses the edit puts every one of
   * those turns back by having the operation dropped.
   */
  edit(threadId: string, messageId: string, question: string, at: string | null): void;
  /**
   * Stop an answer that is still arriving. What has already appeared is kept.
   *
   * Needs the *server's* id for the message, which arrives in the `begin`
   * frame — so a stop pressed in the moment before that is remembered and sent
   * once, when there is an id the server can match, rather than posting an id
   * the server has never heard of and quietly doing nothing.
   */
  stop(threadId: string, messageId: string): void;
  /**
   * Stop the first answer of a conversation and throw the conversation away.
   *
   * For the reader who selected a sentence, saw an answer start, and changed
   * their mind — Greg's call, 2026-08-26. Not the same button as `stop`, and
   * deliberately not the same word in the panel either: `✕ Cancel` against
   * `⏹ Stop`, because one destroys and one does not.
   *
   * One request. Stopping and then deleting is a race that eats a question
   * arriving in the gap — see `cancelChat` in src/routes.ts.
   */
  cancelAndDiscard(threadId: string, messageId: string): void;
  /**
   * **Write one finished spoken exchange into the conversation.**
   *
   * Live conversation's only way in, and it goes through the same controller as
   * every typed turn — an operation with an id, a projection it alone may
   * update, a 409 that repairs, not a second writer beside the first. The whole
   * point of putting spoken turns in the thread is that the typed turn after
   * them can see what was said, and that only works if there is one thread and
   * one set of rules about writing to it.
   *
   * Returns where it landed, because the caller needs the stored id of the
   * answer to claim as the *next* exchange's tail. See `SpokenLanded`.
   */
  speak(spoken: SpokenExchange, onThreadId?: (id: string) => void): Promise<SpokenLanded>;
  /** Start an empty conversation locally. Nothing is stored until you send. */
  begin(kind?: ThreadKind): string;
  /**
   * Forget an empty conversation. Local only, and a no-op on anything that has
   * a message in it — see `withoutEmpty`.
   */
  discard(threadId: string): void;
  rename(threadId: string, title: string): void;
  remove(threadId: string): void;
  /** A failure of the *transport*. Model failures live on the message. */
  error: string | null;
}

/**
 * Everything the controller is allowed to do to the world.
 *
 * Module-level, so its identity is stable and the controller need not be
 * rebuilt to get at it. Every one of these lives in ./chat/effects.ts and none
 * of them rejects — see the note there.
 */
const chatEffects: ChatEffects = {
  loadThreads: askForThreads,
  renameThread,
  deleteThread,
  runTurn,
  appendSpoken,
  settledAnswer,
  stopAnswer,
  cancelThread,
};


/**
 * What a thread is called before the reader has said anything in it.
 *
 * A `Record<ThreadKind, string>` rather than a ternary, so a fourth kind is a
 * compile error here instead of a thread quietly called "New chat". The
 * placeholder matters because the list is shared: "New chat" sitting in a list
 * the reader reached by pressing Remember is a small lie, and it is the row they
 * are about to type into. The real title arrives with the first thing they say.
 *
 * `kind` at the call site is the **persisted** thread kind — src/types.ts §
 * ThreadKind.
 */
const NEW_THREAD_TITLE: Record<ThreadKind, string> = {
  chat: "New chat",
  remember: "Remembering",
  candidates: "Finding reviewers",
};

export function useChat(slug: string): ChatApi {
  /**
   * The state, the operations in flight and the tombstones — all of it, and one
   * of it per article.
   *
   * See src/web/chat/controller.ts for why this is a controller rather than a
   * `useReducer`. What it buys here is the four refs that used to answer
   * questions about *now* from outside a render — `onScreen`, `latest`,
   * `showing` and `gone` — all of which are `controller.state` now, read on the
   * same line they are asked about.
   *
   * **Latched in a ref rather than a `useMemo`**, because the two are not the
   * same promise: React is explicitly allowed to throw a `useMemo` cache away
   * and rebuild it, and rebuilding this one would silently empty the reader's
   * conversation list. Constructing a controller has no side effects — it fills
   * in an initial state and nothing else — so doing it during a render is safe,
   * and the effect below is what starts the load.
   *
   * A new controller per slug is also what clears everything the last article
   * left behind: its error, its tombstones, its list, its phase, and every
   * operation it had in flight. An abandoned article's repair or recovery
   * dispatches into a controller nothing is reading any more, which is what the
   * `showing` ref used to be for. The hook used to clear this by hand and
   * missed `error` for as long as chat has existed.
   */
  const held = useRef<ChatController | null>(null);
  if (!held.current || held.current.slug !== slug) {
    held.current = new ChatController(slug, chatEffects);
  }
  const controller = held.current;
  const { state, threads, recovering } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );

  /**
   * The one fetch that fills the list — an operation, which is the whole reason
   * this effect is two lines rather than fifty.
   *
   * **The guard is not here at all**, and that is the point. The load used to
   * be guarded by two refs — one naming the article, one numbering the load —
   * re-stated by hand at every place that wrote anything, and twice the file got
   * it wrong in the same way: the success path guarded and the failure path
   * not, so a superseded load that *failed* put an error over a list that was on
   * screen and correct. Now both of its answers come back carrying its id and go
   * through the gate in reduce.ts, and registering a second load drops the first
   * from the map, so its success and its failure are refused by the same rule.
   * Two loads of one article is not a contrivance: `StrictMode` starts exactly
   * that.
   */
  /* One sentence, two callers: the opening read below and `reload` on the
     interface. Written out rather than inlined twice so the two cannot come to
     disagree about what a load is. */
  const startLoad = useCallback(() => {
    controller.dispatch({ type: "load.started", op: { id: asOpId(mintId()), kind: "load" } });
  }, [controller]);

  useEffect(() => {
    startLoad();
    /* **And when this hook goes, the callbacks go with it.** The controller
       outlives it on purpose — the stream still holds it, so a cancel waiting
       for the `begin` frame is still sent after the panel closed — but
       `onThreadId` is the panel's own `setThread`, and calling that from a
       conversation the reader has left reopens or repoints whatever they are
       looking at now. What the controller decides for itself survives; what it
       was doing on somebody else's behalf does not. */
    return () => {
      controller.detach();
    };
  }, [controller, startLoad]);

  /**
   * Hand one finished spoken exchange to the controller.
   *
   * **The rows are minted here and are provisional**, exactly as a send's are:
   * the server writes its own ids and hands back the conversation, and the
   * drawn pair is replaced by the stored pair in one transition. Unlike a
   * send's they are not written into `base` — a spoken append is the one write
   * the server can refuse outright, and drawing them is what lets the refusal
   * be a dropped map entry rather than a repair race. `SpokenOperation`.
   *
   * Both rows are `done` on arrival. There is nothing pending: the conversation
   * happened, and this is the transcript of it.
   */
  const speak = useCallback(
    (spoken: SpokenExchange, onThreadId?: (id: string) => void): Promise<SpokenLanded> => {
      const now = new Date().toISOString();
      const question: ChatMessage = {
        id: mintId(),
        role: "user",
        text: spoken.question,
        createdAt: now,
        status: "done",
      };
      const reply: ChatMessage = {
        id: mintId(),
        role: "assistant",
        text: spoken.answer,
        createdAt: now,
        status: "done",
        /* Conditional throughout, never `x: undefined` — the same rule
           `withSpokenTurn` follows on the server, and for the same reason:
           these two rows are compared against the stored ones. */
        ...(spoken.passages && spoken.passages.length > 0 ? { passages: spoken.passages } : {}),
        ...(spoken.tools && spoken.tools.length > 0 ? { tools: spoken.tools } : {}),
        ...(spoken.interrupted ? { interrupted: true } : {}),
      };
      return controller.appendSpoken(
        {
          id: asOpId(mintId()),
          kind: "spoken",
          threadId: spoken.threadId,
          question,
          reply,
          expectedTailId: spoken.expectedTailId,
          at: now,
        },
        onThreadId,
      );
    },
    [controller],
  );

  /**
   * The reader pressed stop.
   *
   * **One dispatch, and the reducer decides everything else** — whether there is
   * yet a name the server could match, which attempt is being stopped, and
   * therefore whether the request goes out now or at the `begin` frame. All of
   * that used to be worked out here, from a `Set` of row ids that the hook then
   * had to consume through a callback on the controller. The callback was
   * cleared on unmount, so a panel that closed itself lost the wish entirely —
   * see `IntentOperation` in ./chat/model.ts.
   *
   * The row is not touched either way: the server answers the still-open stream
   * with a `done` frame carrying whatever had arrived, and letting that frame be
   * the one thing that ends a turn is what keeps the screen and the file
   * agreeing.
   */
  const stop = useCallback(
    (threadId: string, messageId: string) => {
      controller.dispatch({
        type: "intent.started",
        op: { id: asOpId(mintId()), intent: "stop", threadId, messageId },
      });
    },
    [controller],
  );

  /**
   * Stop the first answer of a conversation, and throw the conversation away.
   *
   * The same dispatch, with the other intent — a field the type will not let
   * hold both at once, which is what stops a cancel and a stop both firing at
   * one row. The tombstone goes down in the same transition and is named after
   * this operation, so only this operation's own refusal can lift it.
   */
  const cancelAndDiscard = useCallback(
    (threadId: string, messageId: string) => {
      controller.dispatch({
        type: "intent.started",
        op: { id: asOpId(mintId()), intent: "cancel", threadId, messageId },
      });
    },
    [controller],
  );

  /**
   * Every `pending` answer with nobody behind it gets a recovery.
   *
   * One scan of what is on screen, on every change to it. Cheap, and it is the
   * only place a recovery starts that is not a stream ending — a row that
   * arrived from a load or from a remount is the same row and gets the same
   * treatment, rather than two code paths that have to agree.
   *
   * The case it was written for is the one that was actually reported and that
   * an in-`run` recovery misses entirely: the hook *remounts* (Vite Fast Refresh
   * in development, `StrictMode` on every mount), the old hook's stream dies
   * with it, and the new hook loads a `pending` row from the server with no
   * clock and no stream. That spins for ever unless something notices the row is
   * nobody's. Found by a GPT-5.6 review, 2026-08-26.
   *
   * `recovery.started` is refused for a row that already has a writer, which is
   * what makes `StrictMode`'s doubled effect harmless — and what makes this
   * scan and `turn.disconnected` unable to start two recoveries for one row.
   */
  useEffect(() => {
    for (const thread of threads) {
      for (const message of thread.messages) {
        if (message.role !== "assistant" || message.status !== "pending") continue;
        if (writerOf(controller.state, message.id)) continue;
        controller.dispatch({
          type: "recovery.started",
          op: {
            id: asOpId(mintId()),
            kind: "recovery",
            threadId: thread.id,
            messageId: message.id,
            until: recoverUntil(),
            /* Nobody has told us which attempt this row is on: it arrived from
               the server or from a hook that is gone. A stop on it then names
               the row and lets the server decide, which is what it did before
               there was an attempt at all. */
            attempt: null,
          },
        });
      }
    }
  }, [threads, controller]);

  /**
   * A new, empty conversation — local only.
   *
   * Nothing is written to disk until the reader actually sends something, so
   * pressing "New chat" and changing your mind leaves no empty thread behind to
   * clean up. The server's `beginTurn` accepts this id when the first message
   * arrives, which is what makes the optimistic id safe.
   */
  const begin = useCallback(
    (kind: ThreadKind = "chat") => {
      const id = mintId();
      const at = new Date().toISOString();
      /* Straight into `base`, with no operation over it. Starting a
         conversation is synchronous and local — nothing leaves the tab, so
         there is nothing that can arrive late and nothing to admit. */
      controller.dispatch({
        type: "thread.begun",
        thread: {
          id,
          /* `NEW_THREAD_TITLE` above, which is where the reasoning is. */
          title: NEW_THREAD_TITLE[kind ?? "chat"],
          createdAt: at,
          updatedAt: at,
          /* An empty thread exists only in this tab, so this kind is a promise
             rather than a record — the send that follows is what tells the
             server, and the server's answer is what makes it true. But the panel
             filters and tags on it in the meantime, so it has to be right now. */
          kind,
          messages: [],
        },
      });
      return id;
    },
    [controller],
  );

  /**
   * Forget an empty conversation the reader changed their mind about.
   *
   * No tombstone, unlike `remove`: nothing is in flight for a thread with no
   * messages — a send inserts its two rows before the request leaves — so there
   * is no late frame that could put this one back. Local, like `begin`.
   */
  const discard = useCallback(
    (threadId: string) => {
      controller.dispatch({ type: "thread.discarded", threadId });
    },
    [controller],
  );

  const send = useCallback(
    (
      threadId: string | null,
      question: string,
      at: string | null,
      opts: SendOptions = {},
    ): string => {
      const { onThreadId, anchor, kind, stance, help, sourceCommentId } = opts;
      const useProfile = opts.useProfile ?? true;
      const id = threadId ?? mintId();
      const now = new Date().toISOString();
      const replyId = mintId();

      /* Both rows go into `base` at registration, before the request leaves —
         the same optimistic insert this has always done, and deliberately not
         something the operation draws. Nothing withdraws them: a send that is
         refused is repaired by fetching the conversation, not by taking the
         reader's own words off the screen. Two more things depend on their
         being in `base`: `mergedArrival` protects a conversation it can see,
         and two sends in one conversation keep the reader's order however they
         finish, which drawing them in completion order would not.

         Their ids are provisional: the server mints its own and says so in the
         `begin` frame, and all three are swapped there in one transition. */
      const question_: ChatMessage = {
        id: mintId(),
        role: "user",
        text: question,
        createdAt: now,
        status: "done",
      };
      const reply: ChatMessage = {
        id: replyId,
        role: "assistant",
        text: "",
        createdAt: now,
        status: "pending",
        /* The optimistic row's own copy. The server writes the authoritative
           one onto its pending row in the same write as the question, but the
           client does not read that back until the next load — so without this
           the stance tag on an answer appeared only after a reload, which is
           precisely the state a reader is never in while they are watching the
           answer arrive. Found in a browser pass, 2026-08-28. */
        ...(stance ? { stance } : {}),
      };
      controller.startTurn(
        {
          type: "turn.started",
          op: {
            id: asOpId(mintId()),
            kind: "turn",
            shape: "send",
            threadId: id,
            replyId,
            reply,
            question: question_,
            editing: null,
            opening: controller.state.base.some((t) => t.id === id)
              ? null
              : {
                  id,
                  title: question.slice(0, 60),
                  createdAt: now,
                  updatedAt: now,
                  /* The optimistic row's own guess, and it has to be right
                     rather than defaulted: this thread is rendered — and
                     filtered by kind in the panel — in the frame before the
                     server answers. A `?? "chat"` here would flash a new
                     Remember thread into the list as a chat. */
                  kind: kind ?? "chat",
                  messages: [],
                },
            title: null,
            /* Whether the `begin` frame's title belongs to this conversation is
               **not decided here any more**. It was, from the message count on
               screen, and that is a caller answering a question about the state:
               the count cannot know about a rename the reader has not made yet,
               so a name they had just typed was overwritten by a slice of the
               question. `startTurn` in chat/reduce.ts asks `unnamed` and the live
               renames instead. GPT Sol, 2026-08-28. */
            at: now,
            began: false,
            attempt: null,
          },
          /* The anchor rides only on the request, never into the optimistic
             thread above. The row on screen is a guess until the `begin` frame
             replaces it with the server's, and inventing an `anchor` for it
             would put a mark in the prose for a conversation that might yet be
             minted under another id. The mark is drawn from `useChatAnchors`,
             which is told once the server has agreed. */
          payload: {
            question,
            at,
            ...(useProfile ? {} : { useProfile: false }),
            ...(anchor ? { anchor } : {}),
            /* Sent for every kind but the default. A body with no `kind` means
               chat, which is what every caller written before this feature meant,
               and what keeps an old tab working.

               **This was `kind === "remember"` until 2026-09-01**, written when
               Remember was the only second kind. Candidates arrived as the third
               and this line did not widen, so a Candidates turn posted no kind,
               the server stored it as chat and answered it with chat's prompt,
               and the panel's whole shortlist — including every honesty line it
               owes an editor — sat behind an early return nothing could reach.
               Comparing against the default is the shape that survives a fourth
               kind; naming one member is the shape that does not.
               tests/chat-kind-reaches-the-server.test.tsx. */
            ...(kind && kind !== "chat" ? { kind } : {}),
            ...(stance ? { stance } : {}),
            /* Sent only when it is true, which is the only value there is. The
               route refuses `false` outright rather than reading it as absent,
               so this must never write one. */
            ...(help ? { help: true as const } : {}),
            ...(sourceCommentId ? { sourceCommentId } : {}),
          },
        },
        onThreadId,
      );
      return id;
    },
    [controller],
  );

  const retry = useCallback(
    (threadId: string, messageId: string) => {
      const now = new Date().toISOString();
      const replaced = controller.threads
        .find((t) => t.id === threadId)
        ?.messages.find((m) => m.id === messageId);
      /* Blanked field by field, for the same reason `retryTurn` rebuilds the
         stored row rather than spreading it: `citations`, `searches`, `tools`
         and the old `error` all belong to the answer being replaced, and any
         one of them left behind sits under text that never mentioned it. A
         stale tool strip is the loudest of them — it claims a web page was read
         for an answer that never saw one.

         **Drawn rather than written**, which is the difference stage 2 makes:
         the answer being replaced is still in `base`, untouched, so a server
         that refuses the retry puts it back by having this operation dropped —
         no fetch, no merge rule, no timing argument. */
      const reply: ChatMessage = {
        id: messageId,
        role: "assistant",
        text: "",
        createdAt: now,
        status: "pending",
        /* **The one field carried across**, mirroring `withRetry` on the server
           exactly — see the note there. Everything else belongs to the attempt
           being replaced; this is the instruction that produced it, and a retry
           re-asks the same question the same way.
           Without it the row loses its stance for as long as the tab lives,
           which then seeds the picker with `balanced` and makes the *next* turn
           quietly change voice. GPT Sol's review of the built code, finding 2. */
        ...(replaced?.stance ? { stance: replaced.stance } : {}),
      };
      controller.startTurn({
        type: "turn.started",
        op: {
          id: asOpId(mintId()),
          kind: "turn",
          shape: "retry",
          threadId,
          replyId: messageId,
          reply,
          question: null,
          editing: null,
          opening: null,
          title: null,
          at: now,
          began: false,
          attempt: null,
        },
        // No `at`: a retry re-asks the stored question, and where the reader has
        // scrolled to since is not part of it.
        payload: { retry: messageId },
      });
    },
    [controller],
  );

  const edit = useCallback(
    (threadId: string, messageId: string, question: string, at: string | null) => {
      const now = new Date().toISOString();
      const replyId = mintId();
      /* Read **before** anything is drawn, which is the whole point: this is
         what the reader was looking at when they pressed save, and the server
         refuses the edit if the conversation has moved past it. Absent only for
         a thread this tab has never seen the server's version of, in which case
         there is nothing after the question to be lost.

         Off the controller rather than the `onScreen` ref this used to mirror
         `threads` into. That ref existed because `edit` must not close over
         `threads` — it would be a new function on every delta of every
         streaming answer — and the controller answers the same question
         synchronously without one. */
      const thread = controller.threads.find((t) => t.id === threadId);
      const expectedTailId = thread?.messages.at(-1)?.id;
      const index = thread?.messages.findIndex((m) => m.id === messageId) ?? -1;
      const target = index < 0 ? undefined : thread?.messages[index];
      const replaced = index < 0 ? undefined : thread?.messages[index + 1];
      controller.startTurn({
        type: "turn.started",
        op: {
          id: asOpId(mintId()),
          kind: "turn",
          shape: "edit",
          threadId,
          replyId,
          reply: {
            id: replyId,
            role: "assistant",
            text: "",
            createdAt: now,
            status: "pending",
            /* From the answer being **replaced** — the row under the question —
               not from the tail of the thread, mirroring `withEdit` on the
               server. An edit discards later turns whose stances may differ, so
               taking the last one would answer a rewritten early question in the
               voice of a turn that no longer exists. */
            ...(replaced?.role === "assistant" && replaced.stance
              ? { stance: replaced.stance }
              : {}),
          },
          /* The rewritten question and the discard of everything under it are
             both **drawn**, and that is the payoff the whole projection was
             built for: an edit destroys, and a server that refuses it puts every
             discarded turn back by having this one entry dropped from a map. */
          question: target ? { ...target, text: question, editedAt: now } : null,
          editing: messageId,
          opening: null,
          /* The same rule the server applies in `withEdit` (src/chat.ts):
             the first question names the thread, so rewriting it renames the
             thread. Straight into `base`, like a rename's — a title is never
             withdrawn, so the last writer wins and that writer is the reader's
             own order.
             tests/chat-title-ownership.test.ts. */
          title: index === 0 ? question.slice(0, 60) : null,
          at: now,
          began: false,
          attempt: null,
        },
        payload: { edit: messageId, question, at, ...(expectedTailId ? { expectedTailId } : {}) },
      });
    },
    [controller],
  );

  /**
   * Give a conversation a new name.
   *
   * The title goes into `base` at once and the operation exists only to admit
   * its own outcome — an operation projects what can still be withdrawn, and
   * this is never withdrawn. A rename that fails stays on screen, with a line in
   * `error` saying what happened; reverting it would be a second surprise on top
   * of the first. Two renames of one conversation are still safe in either
   * order: the second supersedes the first, so the first cannot report a failure
   * over a newer title the reader is looking at.
   */
  const rename = useCallback(
    (threadId: string, title: string) => {
      controller.dispatch({
        type: "rename.started",
        op: { id: asOpId(mintId()), kind: "rename", threadId, title },
      });
    },
    [controller],
  );

  /**
   * Delete a conversation.
   *
   * The tombstone goes down as the operation is registered — one transition,
   * because they are one decision — and it is what keeps the conversation gone:
   * a late frame of an answer that was still arriving, or a list fetched before
   * the delete, cannot put it back. It is `final`, so an unrelated cancel
   * failing cannot lift it either, and it is deliberately never rolled back.
   */
  const remove = useCallback(
    (threadId: string) => {
      controller.dispatch({
        type: "delete.started",
        op: { id: asOpId(mintId()), kind: "delete", threadId },
      });
    },
    [controller],
  );

  return {
    /* `ChatApi` promises a plain array and nothing mutates it — ChatPanel
       copies before it sorts. The projection is `readonly` so that the reducer
       cannot be handed something it might write to. */
    threads: threads as ChatThread[],
    /* Derived, not stored. "We have asked" is true of both the answers a load
       can come back with, and only `loading` is neither. */
    loaded: state.loadPhase !== "loading",
    loadFailed: state.loadPhase === "failed",
    reload: startLoad,
    recovering,
    send,
    speak,
    cancelAndDiscard,
    retry,
    edit,
    stop,
    begin,
    discard,
    rename,
    remove,
    error: state.error,
  };
}
