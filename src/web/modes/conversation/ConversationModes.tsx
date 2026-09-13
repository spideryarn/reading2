/**
 * **The conversation controller, and the two modes that compose it.** Chat is
 * `ConversationBand` on its own; Remember is `RememberBand`, which is the
 * `?remember=` switch over that same band and the quiz.
 *
 * **One file, and deliberately not two.** `RememberBand` renders
 * `ConversationBand`, so `modes/chat/` beside `modes/remember/` would be one
 * feature module importing another — which A1 forbids alongside importing
 * `App.tsx`. Chat and Remember are two compositions of one conversation
 * controller rather than two features. GPT Sol's review of the plan below,
 * finding F2.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller and the pieces only it uses
 * move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. Both modes are
 * owner-only, so there are no visitor twins. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md,
 * and docs/project/comments.md, docs/project/remember-mode.md and
 * docs/project/quiz.md for the modes themselves.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, useQueryStates } from "nuqs";
import type { BlockId, ChatThread, RememberStance, ThreadKind } from "../../../types.js";
import { currentAt, rememberParam, threadParam, type Mode } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { QuizPanel, RememberSubModeToggle } from "../../QuizPanel.js";
import { useQuiz } from "../../useQuiz.js";
import { useChat } from "../../useChat.js";
import { useLiveConversation } from "../../live/useLiveConversation.js";
import { ChatPanel } from "../../ChatPanel.js";

/**
 * **Remember's two sub-modes, and the one place their URL rules live.**
 *
 * Remember is `recall` — the reader says what they took from the article and the
 * model shows them where that comes apart — or `quiz`, where the questions come
 * from the article instead. One mode, two bands, and `?remember=` says which.
 * docs/plans/260831al-review-quiz-sub-mode.md.
 *
 * ## Why this is a component rather than two conditions up in `Reader`
 *
 * Two reasons, and the second is the one that matters.
 *
 * The cheap one: `?remember=` is meaningless outside Remember mode, and reading it
 * in `Reader` would put a parameter subscription on every render of the reading
 * view for a value only this subtree uses — the same argument `ConversationBand`
 * makes about `?thread=`.
 *
 * The real one: **`?remember=` and `?thread=` collide, and the rules are
 * navigations rather than parsing.** `?mode=remember&remember=quiz&thread=<id>`
 * would otherwise leave a Remember conversation selected and invisible. Both
 * parameters are set through one `useQueryStates`, so switching sub-mode is one
 * history entry rather than two — two would put a half-state on the Back stack,
 * which is the bug remember-mode.md already records for opening a thread of the
 * other kind.
 *
 * Three rules, and all three are here:
 *
 * 1. **switching to Quiz sets `remember=quiz` and clears `thread`, in one
 *    navigation** — pushed, because switching sub-mode is a deliberate act on
 *    the view and Back should undo it;
 * 2. **a pasted URL carrying both: Quiz wins**, and `thread` is dropped with a
 *    *replace* — a push would put the broken combination one Back press away
 *    from the reader we have just rescued from it;
 * 3. **opening a Remember conversation sets `remember=recall` and `thread=<id>`,
 *    also in one** — that one is in `ConversationBand`'s `onThread`, because it
 *    is the same navigation that already moves `?mode=`, and splitting it would
 *    be the two-entry bug again.
 *
 * ## And the live conversation is hung up before the panel goes
 *
 * Switching to Quiz **unmounts** `ConversationBand`, which is what ends any
 * live session: `useLiveConversation`'s unmount cleanup is the only thing that
 * closes the peer connection, and a session left running is listening to the
 * reader and writing into a transcript they are no longer looking at. That is
 * why the two halves are rendered as alternatives rather than one being hidden
 * with CSS — a hidden band is a mounted band.
 */
export function RememberBand({
  slug,
  blocks,
  onJump,
  onMode,
}: {
  slug: string;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  onMode(next: Mode): void;
}) {
  useRenderCount("RememberBand");
  const [{ remember, thread }, setBoth] = useQueryStates({
    remember: rememberParam,
    thread: threadParam,
  });

  /* Rule 2. A *replace*, and an effect rather than a render-time fix-up,
     because writing to the URL during render is what React refuses. It settles
     on the first commit and then never fires again, since `thread` is null. */
  useEffect(() => {
    if (remember === "quiz" && thread !== null) {
      void setBoth({ thread: null }, { history: "replace" });
    }
  }, [remember, thread, setBoth]);

  const toggle = (
    <RememberSubModeToggle
      value={remember}
      slug={slug}
      onChange={(next) =>
        /* Rule 1. Both keys in one call, so this is one history entry — and
           `thread: null` on the way to Quiz rather than only on arrival, so
           there is no frame in which the URL says both. Going the other way
           leaves `thread` alone: the reader is going back to a list, and the
           conversation they last had open is the right thing to find. */
        void setBoth(
          next === "quiz" ? { remember: next, thread: null } : { remember: next },
          { history: "push" },
        )
      }
    />
  );

  if (remember === "quiz")
    return <QuizSubBand slug={slug} subMode={toggle} blocks={blocks} onJump={onJump} />;
  return (
    <ConversationBand
      /* Keyed so that leaving Quiz and coming back starts clean rather than
         carrying the previous visit's focus nonce and stance — the same reason
         `Reader` keys this component on `mode`. */
      key="remember-recall"
      slug={slug}
      blocks={blocks}
      onJump={onJump}
      /* The **persisted thread kind** — src/types.ts § ThreadKind. */
      kind="remember"
      onMode={onMode}
      subMode={toggle}
    />
  );
}

/**
 * The quiz, and the fetch and the poller that belong to it.
 *
 * A component of its own for `GlossaryBand`'s surviving reason rather than
 * `ConversationBand`'s: **`useStepJob` subscribes to the job engine**, which
 * holds it on its idle cadence — one small request every eight seconds for the
 * life of the band. A reader who never opens Quiz should not pay for that, and
 * hooks cannot be called conditionally, so the condition has to be a component
 * boundary.
 */
function QuizSubBand({
  slug,
  subMode,
  blocks,
  onJump,
}: {
  slug: string;
  subMode: React.ReactNode;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
}) {
  useRenderCount("QuizSubBand");
  const owner = useQuiz(slug);
  return <QuizPanel owner={owner} subMode={subMode} blocks={blocks} onJump={onJump} />;
}

/**
 * Chat, and the fetch that belongs to it.
 *
 * A component of its own for one reason: **`useChat` fetches on mount**, and
 * calling it up in `Reader` would charge every reader of every article a
 * request for a conversation almost none of them will open. Hooks cannot be
 * called conditionally, so the condition has to be a component boundary. Same
 * reasoning as the `drawer` prop in Dock.tsx, which exists so the metadata page
 * does not pay for comments it has no use for.
 *
 * `?thread=` lives here too, for the same reason — it is meaningless outside
 * chat mode, and reading it in `Reader` would put a parameter subscription on
 * every render of the reading view for a value only this component uses.
 */
/**
 * **The two kinds this band is for**, which is not every `ThreadKind`.
 *
 * `candidates` is a thread of Referee mode's making and belongs to
 * `CandidatesPanel`; it has no mode of its own to be followed into from here.
 * Written as an `Exclude` rather than as `"chat" | "remember"` so that a fifth
 * kind arrives here as a compile error and somebody has to decide which side of
 * the line it is on.
 */
type ConversationKind = Exclude<ThreadKind, "candidates">;

/**
 * **A question another mode has handed to chat, to be put in a fresh
 * conversation's composer and not sent.**
 *
 * Today there is one sender: the glossary's *Ask in chat*, for a term the
 * article does not contain. Greg, 2026-09-11, asked whether the question should
 * go into the conversation already open or a new one: *"fresh"*. So it never
 * touches another conversation's draft, and it spends nothing until Send.
 *
 * **A prop, owned by `Reader`, and deliberately not the module-level cell that
 * src/web/chat-handoff.ts used to be.** That cell was deleted for three real
 * bugs — a question outliving its article, outliving the moment, and firing
 * twice under StrictMode — and each has an answer here rather than a timer:
 *
 * - `slug` is the article it was asked in; a band on another article drops it.
 * - `Reader` clears it the moment this band has taken it (`onHandoffTaken`), so
 *   it cannot wait for a later visit to chat mode.
 * - The band remembers **which object** it took, so StrictMode running the
 *   effect twice in one commit mints one conversation, not two.
 *
 * Nor is it in the URL: the question is the reader's text, which
 * docs/project/logging.md keeps out of addresses.
 */
export interface ChatHandoff {
  readonly slug: string;
  readonly question: string;
}

/** Is this a thread the reader's own conversation panel may show and open? */
function isConversationThread(t: ChatThread): t is ChatThread & { kind: ConversationKind } {
  return t.kind !== "candidates";
}

export function ConversationBand({
  slug,
  blocks,
  onJump,
  kind,
  subMode,
  onMode,
  handoff,
  onHandoffTaken,
}: {
  slug: string;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  /**
   * A question to open a fresh conversation with, unsent — see `ChatHandoff`.
   * Only chat mode is handed one.
   */
  handoff?: ChatHandoff | null | undefined;
  /** The band has taken `handoff` (or refused it); the owner should forget it. */
  onHandoffTaken?: (() => void) | undefined;
  /**
   * Which mode mounted this — chat, or Remember.
   *
   * **One component for both, and not two.** Everything in here is the same for
   * either: one `useChat(slug)`, one `?thread=`, one focus nonce, one
   * once-per-visit latch. A near-copy would have been a second chat state
   * machine beside the first, which is what GPT Sol's review of
   * docs/plans/260827ah-review-mode.md (finding 7) said not to build — and the
   * unmount/remount path around this one already has a race worth not having
   * twice.
   *
   * **Not `ThreadKind`.** The union grew a third member on 2026-09-01 and this
   * band is for two of them — see `ConversationKind` above.
   */
  kind: ConversationKind;
  /**
   * **The Recall | Quiz control**, when this band is the Recall half of
   * Remember. Absent in chat mode. Built by `RememberBand` above and passed straight
   * through to `ChatPanel`, which is where it is drawn.
   */
  subMode?: React.ReactNode;
  /**
   * Switch mode, for when the reader opens a thread of the *other* kind.
   *
   * The list is shared (Greg's call, 2026-08-27), so a Remember thread is
   * reachable from
   * chat mode and vice versa. Opening one has to move `?mode=` as well as
   * `?thread=` or the conversation would be answered with the wrong prompt.
   */
  onMode(next: Mode): void;
}) {
  useRenderCount("ConversationBand");
  const {
    threads: everyThread,
    loaded,
    loadFailed,
    recovering,
    send,
    retry,
    edit,
    stop,
    begin,
    discard,
    rename,
    remove,
    speak,
    error,
  } = useChat(slug);
  /**
   * **The reader's conversations — which is not every thread in the article.**
   *
   * The list is shared between chat and Remember on purpose (Greg's call,
   * 2026-08-27), so a Remember row is pressable from chat mode and the band
   * follows it into its own mode. Candidates is **not** in that arrangement and
   * must not be: it is Referee mode's machinery rather than a reader's
   * conversation, it lives at `?mode=referee&referee=candidates` where this band
   * cannot navigate, and a Candidates row opened here would be answered with
   * chat's prompt with nothing on screen saying so — the exact bug the shared
   * list already produced once for Remember (GPT Sol's review of
   * docs/plans/260827ah-review-mode.md, finding 7).
   *
   * The filter is a **type guard**, so `onThread` below can hand `target.kind`
   * straight to `onMode`. `ThreadKind` and `Mode` used to agree on every member
   * and stopped agreeing the day `candidates` arrived; narrowing here is what
   * keeps that assignment honest instead of casting it.
   */
  const threads = useMemo(() => everyThread.filter(isConversationThread), [everyThread]);
  const [thread, setThread] = useQueryState("thread", threadParam);
  /* Write-only, for rule 3 in `onThread` below — the value itself is
     `RememberBand`'s to read. A setter with no reader still subscribes, which is
     the cost, and it is paid only by a band the reader has opened. */
  const [, setRemember] = useQueryState("remember", rememberParam);

  /**
   * The conversations as they are **now**, for a callback that outlives a render.
   *
   * `tailNow` below is read once, minutes after the session started, from
   * inside the hook. Captured directly it would be the list as it was at
   * connect time — which is the one value it must not be, since the whole
   * question it answers is "has this conversation moved since then?".
   */
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const selectedThread = useRef(thread);
  selectedThread.current = thread;
  const [pendingLive, setPendingLive] = useState<{ id: string; from: string | null } | null>(null);
  /**
   * The text a handed-over question starts its conversation's composer with.
   * `ChatPanel` treats it as that conversation's initial draft — see `seed`
   * there. Carries its slug, so a band that outlives an article change does not
   * offer it to the next one.
   */
  const [seed, setSeed] = useState<{
    slug: string;
    threadId: string;
    text: string;
  } | null>(null);

  /**
   * **The live conversation, owned here** — above the panel, above the keyed
   * transcript, for the life of the article.
   *
   * `ChatPanel` is remounted every time the reader switches conversation, and a
   * peer connection that a remount destroys is a connection nothing owns: the
   * microphone stays open, the events go nowhere, and the exchange in flight is
   * never written down. docs/plans/260831l-live-conversation-in-chat.md § 5.
   *
   * The three things it is given are the three things a live session cannot
   * work out for itself:
   *
   * - `speak`, which is `useChat`'s — so a spoken exchange goes through the
   *   same controller as every typed turn, as an operation with an identity and
   *   a projection, rather than a second writer beside it;
   * - `tailNow`, so the seeding barrier can tell whether the conversation moved
   *   while the session was connecting;
   * - `onThreadId`, so `?thread=` follows if the server names the conversation
   *   something other than what this tab invented.
   */
  const live = useLiveConversation(slug, {
    speak,
    tailNow: (id) => threadsRef.current.find((t) => t.id === id)?.messages.at(-1)?.id ?? null,
    onThreadId: (id, startedThreadId) => {
      // A delayed spoken append may finish after the reader has left its thread.
      if (selectedThread.current === startedThreadId) void setThread(id);
    },
  });

  /**
   * **A session belongs to one conversation, so leaving that conversation ends
   * it.**
   *
   * Not cosmetic. A session is *seeded* from its thread and *appends* to it, so
   * one left running while the reader reads a different conversation is
   * listening to them and writing what they say into a transcript they are not
   * looking at. The panel is remounted on a thread switch and the session is
   * not — that is the whole reason it is owned up here — so nothing else would
   * notice.
   *
   * Deliberately not awaited: this is a reaction to a navigation that has
   * already happened, and the flush it starts finishes on its own through the
   * chat controller, which outlives this component for exactly that reason.
   * The Send handoff is the path that has to wait, and it does.
   */
  const hangUp = useRef(live.stop);
  hangUp.current = live.stop;
  useEffect(() => {
    if (live.phase === "idle" || live.phase === "failed") return;
    if (live.threadId && live.threadId !== thread) void hangUp.current();
  }, [thread, live.phase, live.threadId]);

  useEffect(() => {
    if (!pendingLive) return;
    if (thread !== pendingLive.id) {
      if (thread !== pendingLive.from) setPendingLive(null);
      return;
    }
    if (live.phase !== "idle" && live.phase !== "failed") return;
    // Selection must reach the render before start, or the navigation effect above
    // mistakes a just-created session for one the reader has already left.
    setPendingLive(null);
    live.start({ threadId: pendingLive.id });
  }, [pendingLive, thread, live.phase, live.start]);

  /**
   * A counter that goes up whenever a *new* conversation is started, so the
   * composer knows to take focus.
   *
   * A counter and not a boolean, because "start another new chat" has to be
   * distinguishable from the last one — a boolean that is already `true` fires
   * no effect. And a counter rather than focusing from here directly, because
   * the element belongs to the composer: reaching down for it would mean a ref
   * threaded through two components that otherwise share nothing.
   *
   * Deliberately NOT raised when an existing conversation is opened. Focus in
   * the textarea means ↑/↓ stop stepping the article (keynav.ts ignores keys
   * typed into one), so taking it is only right when the reader has just asked
   * for somewhere to type.
   */
  const [focusNonce, setFocusNonce] = useState(0);
  const startNew = useCallback(() => {
    setPendingLive(null);
    const id = begin(kind);
    void setThread(id);
    setFocusNonce((n) => n + 1);
    return id;
  }, [begin, setThread, kind]);

  /**
   * How many conversations **of this kind** the reader has.
   *
   * The list is shared, so `threads.length` is the wrong count for the latch
   * below: a reader with three chats and no Remember threads would press
   * Remember and be
   * shown three chats, which is not what "start a new one if there are none"
   * ever meant. GPT Sol's review of docs/plans/260827ah-review-mode.md, finding 7.
   */
  const ownKind = threads.filter((t) => t.kind === kind).length;

  /**
   * **An empty chat opens a conversation rather than an empty list.**
   *
   * Greg, 2026-08-26: *"By default, if no existing Chats, start a new one."*
   * The list is worth showing when there is something in it; when there is not,
   * it is a page whose only content is a button, and pressing that button is
   * the only thing anyone was ever going to do.
   *
   * `loaded` is what makes this safe. Without it, "no threads" and "the fetch
   * has not come back" are the same state, so every visit would create a thread
   * before the reader's real ones arrived — and having created one, would not
   * create one on the visit where they genuinely had none. See useChat.ts.
   *
   * It cannot loop: `begin` inserts its conversation into `threads` on the spot,
   * so the condition is false by the next render.
   *
   * **Once per visit to chat mode, and the latch is what makes closing a
   * conversation work at all.** An empty conversation the reader closes is
   * discarded (see `onDiscard` below), which puts the panel back into exactly
   * the state this effect fires on — nothing stored, nothing open — so without
   * the latch the close button would hand them a brand-new empty conversation
   * and read as broken. "By default" means on arrival; a reader who has just
   * closed the only conversation asked for the list.
   *
   * Be exact about "once", because the obvious reading is wrong: the latch is a
   * ref in a component that is unmounted whenever the reader switches to
   * another mode, so coming back to chat starts a conversation again. That is
   * the behaviour we want — arriving in chat mode is the arrival this rule is
   * about — but it does mean the latch does not survive a mode switch, and any
   * future reasoning that assumes it does will be wrong. It is reset on `slug`
   * as well, for the case the panel stays mounted across a change of article.
   *
   * `thread` is deliberately *not* in the condition. `?thread=` can name a
   * conversation that no longer exists — leave chat mode with an empty new one
   * open and the URL keeps its id while the panel takes the conversation with
   * it — and a reader coming back to that URL should get a conversation, not a
   * list they did not ask for. Starting one overwrites the stale id, which is
   * why there is no separate effect clearing it: an effect that cleared the URL
   * whenever the id was missing would also fire in the window between a first
   * question being sent and the server having written it down.
   */
  const started = useRef(false);
  /* `kind` as well as `slug`. This component is now mounted by two modes, and
     React will reuse the instance if it ever renders in the same position for
     both — at which point the latch would still be spent from the mode the
     reader just left, and arriving in the other one would show a list rather
     than a fresh conversation. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads nothing, and changing article or mode is exactly when the latch stops meaning anything
  useEffect(() => {
    started.current = false;
  }, [slug, kind]);

  /**
   * **Take a handed-over question: a fresh conversation, the question in its
   * box, the caret in the box, and nothing sent.**
   *
   * Declared after the latch reset above and before the arrival rule below, and
   * the order is the point: all three can run in one commit, and this one spends
   * the latch so the arrival rule does not start a *second* empty conversation
   * beside it. It does not wait for `loaded` — `begin` inserts the conversation
   * on the spot, and `mergedArrival` (useChat.ts) keeps it when the list lands.
   *
   * `taken` is the StrictMode guard: React runs a mount's effects twice in one
   * commit in development, before `Reader` has had a chance to clear the prop,
   * and a check on the object's identity is what turns that into one
   * conversation. The same shape as the activation tokens (src/web/activation.ts).
   *
   * **The latch is spent on every run, before the `taken` check**, and that
   * order is a fix rather than a style. StrictMode re-runs the reset effect
   * above too, so a latch spent only on the first run was un-spent by the
   * second — and the reader who closed the handed-over conversation before the
   * list arrived was handed a new empty one by the arrival rule.
   * tests/conversation-band-handoff.test.tsx caught it.
   */
  const taken = useRef<ChatHandoff | null>(null);
  useEffect(() => {
    if (!handoff) return;
    /* Asked in another article: not this conversation's question. */
    const ours = handoff.slug === slug;
    if (ours) started.current = true;
    if (taken.current === handoff) return;
    taken.current = handoff;
    if (ours) setSeed({ slug, threadId: startNew(), text: handoff.question });
    onHandoffTaken?.();
  }, [handoff, slug, startNew, onHandoffTaken]);

  useEffect(() => {
    if (!loaded || started.current) return;
    if (ownKind === 0) {
      started.current = true;
      startNew();
    }
  }, [loaded, ownKind, startNew]);
  /* Read, never written, and not a subscription — see `currentAt` in
     params.ts. It is passed to the model so that "this bit" and "what he just
     said" resolve to where the reader actually is. */
  const at = currentAt();

  /**
   * The stance the next Remember answer will be asked for.
   *
   * **Not in the URL**, for the rule url-state.md keeps: it changes nothing on
   * screen, only what the next answer is asked for. The closest existing thing
   * is chat's profile checkbox, which is component state for the same reason.
   *
   * **Seeded from the last answer in the open conversation**, so a reader who
   * chose Socratic and comes back tomorrow finds it still on Socratic — the
   * stance is stored on every answer anyway, for the transcript's sake, so this
   * memory is free. `picked` is what makes it a seed rather than a leash: once
   * the reader has touched the control it is theirs, and reopening a thread
   * does not overrule them mid-session.
   */
  const [picked, setPicked] = useState<RememberStance | null>(null);
  const open = threads.find((t) => t.id === thread);
  const lastStance = [...(open?.messages ?? [])]
    .reverse()
    .find((m) => m.role === "assistant" && m.stance)?.stance;
  const stance: RememberStance = picked ?? lastStance ?? "balanced";

  return (
    <ChatPanel
      slug={slug}
      seed={seed?.slug === slug ? { threadId: seed.threadId, text: seed.text } : null}
      /* Not for display — the panel offers its "start a new one" box only once
         this is true. It went in because a conversation minted before the first
         fetch landed was wiped by it; that is fixed at source now
         (`mergedArrival` in useChat.ts), so what this does is keep the box off
         a list the reader cannot see yet. See the composer under `ThreadList`. */
      loaded={loaded}
      loadFailed={loadFailed}
      threads={threads}
      threadId={thread}
      /**
       * Open a conversation — and follow it into its own mode if it is not the
       * one we are in.
       *
       * The list is shared, so a Remember row is pressable from chat mode.
       * Moving `?thread=` without `?mode=` would leave one open in a panel
       * that asks with chat's prompt and shows no stance picker, and the
       * transcript would give no sign why. Both setters fire in the same event,
       * so they land in one navigation rather than putting a chat-mode-plus-
       * Remember-thread entry on the Back stack in between.
       */
      onThread={(id) => {
        setPendingLive(null);
        const target = id ? threads.find((t) => t.id === id) : null;
        /* `ThreadKind` and `Mode` are separate vocabularies (src/types.ts,
           src/modes.ts) that agree on the two *conversation* kinds — since
           2026-09-01, when `review` became `remember` in the column as well as
           the URL. So this assigns rather than maps, and the compiler is what
           keeps that true: `threads` above is narrowed to those two, and the day
           `candidates` was added to `ThreadKind` this line went red until it
           was. A third vocabulary sharing two of three names is exactly the
           overlap that reads as identity until it isn't. */
        if (target && target.kind !== kind) onMode(target.kind);
        /* **Rule 3**: opening a Remember conversation lands on the Recall half,
           because a conversation is what Recall is and Quiz has nowhere to put
           one. Set unconditionally rather than only when crossing from chat,
           so a stale `?remember=quiz` on the URL cannot survive a thread being
           opened from anywhere. nuqs batches every setter fired in one event
           into a single navigation, which is what the two lines above already
           rely on — so this is still one entry on the Back stack, not three.
           `rememberParam` defaults to `recall`, so this writes nothing to the URL
           in the ordinary case. */
        if (!target || target.kind === "remember") void setRemember("recall");
        void setThread(id);
      }}
      onNew={startNew}
      /* **Owned above this panel**, which is remounted on every conversation
         switch — see the note where the hook is called. */
      live={live}
      onStartLive={(id) => {
        if (!id && kind !== "chat") return;
        const next = id ?? begin("chat");
        setPendingLive({ id: next, from: thread });
        void setThread(next);
        return next;
      }}
      /* Local only — an empty conversation was never written down. See
         `withoutEmpty` in useChat.ts. */
      onDiscard={discard}
      onSend={(question) => {
        // `send` returns the thread it went to, minted here when this is a new
        // conversation — so the URL can name it before the request lands.
        /* The OPEN conversation's kind where there is one, and this mode's
           where there is not — a first message is what decides a new thread's
           kind, and after that the thread decides. The server refuses a kind
           that contradicts an existing thread rather than taking our word for
           it, so this being wrong is a 409 rather than a corrupted transcript. */
        const sendKind = open?.kind ?? kind;
        const id = send(thread, question, at, {
          onThreadId: (corrected) => void setThread(corrected),
          kind: sendKind,
          ...(sendKind === "remember" ? { stance } : {}),
        });
        if (id !== thread) void setThread(id);
      }}
      /* The box under the list. `null` rather than `thread` is the whole
         difference: it mints whatever `?thread=` still says, which on the list
         is either nothing, a conversation the fetch has not brought yet, or one
         that was closed and discarded. The nonce goes up for the same reason
         `startNew` raises it — this *is* a new conversation being started, and
         the reader who typed to start it should still have a caret when it
         opens, in the composer that has just replaced the one they typed into. */
      onSendNew={(question) => {
        /* `null` for the thread, so this mints a new one — and therefore this
           mode's kind, not any open conversation's. */
        const id = send(null, question, at, {
          onThreadId: (corrected) => void setThread(corrected),
          kind,
          ...(kind === "remember" ? { stance } : {}),
        });
        void setThread(id);
        setFocusNonce((n) => n + 1);
      }}
      onRename={rename}
      onDelete={(id) => {
        remove(id);
        // Back to the list rather than to a conversation that is not there.
        if (id === thread) void setThread(null);
      }}
      /* All three carry the *open* thread rather than a thread id from the
         panel, because the panel only ever shows one and the id it would send
         back is the one it was given. `thread` is non-null wherever these can
         be pressed — the conversation view is what renders them. */
      onRetry={(messageId) => thread && retry(thread, messageId)}
      onEdit={(messageId, question) => thread && edit(thread, messageId, question, at)}
      onStop={(messageId) => thread && stop(thread, messageId)}
      onJump={onJump}
      recovering={recovering}
      blocks={blocks}
      focusNonce={focusNonce}
      error={error}
      kind={kind}
      stance={stance}
      onStance={setPicked}
      subMode={subMode}
    />
  );
}
