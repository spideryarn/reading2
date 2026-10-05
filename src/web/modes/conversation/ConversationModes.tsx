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
import type { BlockId, ChatThread, SingleThreadKind, ThreadKind, ThreadOrigin } from "../../../types.js";
import { isSingleThreadKind } from "../../../types.js";
import { currentAt, rememberParam, threadParam } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { type QuizArrival, QuizPanel, type QuizSections, RememberSubModeToggle } from "../../QuizPanel.js";
import { type QuizRead, useQuiz } from "../../useQuiz.js";
import type { ReadSoFar } from "../../read-filter.js";
import { useChat } from "../../useChat.js";
import { useExperimental } from "../../useExperimental.js";
import { softKeyboardIsUp } from "../../useVisualViewport.js";
import { useLive } from "../../live/useLive.js";
import { ChatPanel } from "../../ChatPanel.js";
import { chatDraftsFor } from "../../chat-draft.js";

/**
 * **Remember's four sub-modes, and the one place their URL rules live.**
 *
 * Remember is `recall` — the reader says what they took from the article and the
 * model shows them where that comes apart — `tutorial`, where model and reader
 * take short teaching turns, `explore`, where the reader works out what they
 * think and the model starts from what they marked, or `quiz`, where the
 * questions come from the article instead. One mode, four views, and
 * `?remember=` says which.
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
 * Two rules, and both are here:
 *
 * 1. **switching to Quiz sets `remember=quiz` and clears `thread`, in one
 *    navigation** — pushed, because switching sub-mode is a deliberate act on
 *    the view and Back should undo it;
 * 2. **a pasted URL carrying both: Quiz wins**, and `thread` is dropped with a
 *    *replace* — a push would put the broken combination one Back press away
 *    from the reader we have just rescued from it.
 *
 * There was a third — opening a Remember conversation from chat's list set
 * `remember=recall` with it — and it went on 2026-10-01 with the shared list:
 * chat no longer lists Remember conversations, so nothing outside this band
 * opens one (plan 261001m).
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
  quizRead,
  quizArrival,
  onQuizArrivalTaken,
  blocks,
  readSoFar,
  sections,
  onJump,
  onQuizKeys,
}: {
  slug: string;
  /** The opening quiz read, shared with the prose. `useQuizRead` in `OwnedReader`. */
  quizRead: QuizRead;
  /** A question pressed in the prose, to open at — `QuizPanel`'s `arrival`. */
  quizArrival?: QuizArrival | null | undefined;
  onQuizArrivalTaken?: ((taken: QuizArrival) => void) | undefined;
  blocks: Map<string, string>;
  /** The tree and block positions, for the quiz's "Where to look again" — `QuizPanel`'s `sections`. */
  sections: QuizSections;
  /** The reader's reading so far, for the quiz's "only what I've read". Absent when reading time is off. */
  readSoFar?: ReadSoFar | undefined;
  onJump(id: BlockId): void;
  /** The quiz's ← / → handler, up to `Reader` — `QuizPanel`'s `onArrowKeys`. */
  onQuizKeys?: ((handler: ((dir: -1 | 1) => boolean) | null) => void) | undefined;
}) {
  useRenderCount("RememberBand");
  /* Only for which chips the row draws: Explore is behind the switch
     (QuizPanel.tsx § `RememberSubModeToggle`). */
  const { on: experimentalOn } = useExperimental();
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
      experimental={experimentalOn}
      onChange={(next) =>
        /* Rule 1. Both keys in one call, so this is one history entry — and
           `thread: null` on the way to Quiz rather than only on arrival, so
           there is no frame in which the URL says both. Going the other way
           leaves `thread` alone: Recall opens the one Remember conversation
           whatever it says, and writes its id back (`ConversationBand`). */
        void setBoth(
          next === "quiz" ? { remember: next, thread: null } : { remember: next },
          { history: "push" },
        )
      }
    />
  );

  if (remember === "quiz")
    return (
      <QuizSubBand
        slug={slug}
        read={quizRead}
        arrival={quizArrival}
        onArrivalTaken={onQuizArrivalTaken}
        subMode={toggle}
        blocks={blocks}
        readSoFar={readSoFar}
        sections={sections}
        onJump={onJump}
        onArrowKeys={onQuizKeys}
      />
    );
  if (remember === "tutorial")
    return (
      <ConversationBand
        /* Its own key, so Recall and Tutorial never share a mounted band — a
           focus nonce or a latch carried across would belong to the other
           conversation. (Their unsent words are kept apart by kind, not by
           this key: src/web/chat-draft.ts.) */
        key="remember-tutorial"
        slug={slug}
        blocks={blocks}
        onJump={onJump}
        kind="tutorial"
        subMode={toggle}
      />
    );
  if (remember === "explore")
    return (
      <ConversationBand
        /* Its own key, for Tutorial's reason: three conversations, and none of
           them shares a mounted band with another. */
        key="remember-explore"
        slug={slug}
        blocks={blocks}
        onJump={onJump}
        kind="explore"
        subMode={toggle}
      />
    );
  return (
    <ConversationBand
      /* Keyed so that leaving Quiz and coming back starts clean rather than
         carrying the previous visit's focus nonce — the same reason
         `Reader` keys this component on `mode`. */
      key="remember-recall"
      slug={slug}
      blocks={blocks}
      onJump={onJump}
      /* The **persisted thread kind** — src/types.ts § ThreadKind. */
      kind="remember"
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
  read,
  arrival,
  onArrivalTaken,
  subMode,
  blocks,
  readSoFar,
  sections,
  onJump,
  onArrowKeys,
}: {
  slug: string;
  read: QuizRead;
  arrival?: QuizArrival | null | undefined;
  onArrivalTaken?: ((taken: QuizArrival) => void) | undefined;
  subMode: React.ReactNode;
  blocks: Map<string, string>;
  readSoFar?: ReadSoFar | undefined;
  sections: QuizSections;
  onJump(id: BlockId): void;
  onArrowKeys?: ((handler: ((dir: -1 | 1) => boolean) | null) => void) | undefined;
}) {
  useRenderCount("QuizSubBand");
  const owner = useQuiz(slug, read);
  return (
    <QuizPanel
      owner={owner}
      arrival={arrival}
      onArrivalTaken={onArrivalTaken}
      subMode={subMode}
      blocks={blocks}
      readSoFar={readSoFar}
      sections={sections}
      onJump={onJump}
      onArrowKeys={onArrowKeys}
    />
  );
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
 * Two senders, both through `Reader`: the glossary's *Ask in chat*, for a term
 * the article does not contain, and (since 2026-10-04) the button on a Summary
 * paragraph, which hands over the paragraph, quoted
 * (docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md). Greg,
 * 2026-09-11, asked whether the glossary's question should go into the
 * conversation already open or a new one: *"fresh"*. So a handoff never
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
  /**
   * The item the question is about, when the conversation should remember it
   * (`ThreadOrigin`): Debate's *Check this claim in chat* since 2026-10-05.
   * The band keeps it beside the new conversation's words and sends it with
   * the first question. The glossary's and the Summary's handoffs send none.
   * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md.
   */
  readonly origin?: ThreadOrigin;
}

/**
 * **The reader's one Remember conversation, out of whatever the list holds.**
 *
 * The server keeps at most one per article (plan 261001m § 1), but this tab can
 * briefly hold more: an empty one it began before a refetch brought the stored
 * one, or a second tab's. So: one with something in it over an empty one, then
 * the earliest, then the id — a total order, so every render picks the same.
 * Pure and exported for that reason.
 */
export function oneRemember(
  threads: readonly ChatThread[],
  kind: SingleThreadKind = "remember",
): ChatThread | null {
  let best: ChatThread | null = null;
  for (const t of threads) {
    if (t.kind !== kind) continue;
    if (!best || before(t, best)) best = t;
  }
  return best;
}

function before(a: ChatThread, b: ChatThread): boolean {
  const said = Number(a.messages.length > 0) - Number(b.messages.length > 0);
  if (said !== 0) return said > 0;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.id < b.id;
}

/**
 * `kind` — which mode mounted the band, chat or Remember — and what goes with
 * each.
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
type ConversationVisibilityByKind = {
  chat: {
    /**
     * The blocks on screen now, read when the reader presses Send or Save and
     * sent with the question. Reader owns it because Reader knows whether a
     * band is lying over the prose, when it answers `[]`.
     *
     * Required on chat rather than optional for every band: otherwise Reader
     * can omit the one prop that connects the DOM reading to the request and
     * all lower-level payload tests still pass (GPT Sol, code review of
     * docs/plans/261001q-chat-knows-the-blocks-on-screen.md).
     */
    kind: "chat";
    onScreen: () => readonly BlockId[];
  };
  remember: {
    /** Remember must never report a screenful to its prompt. */
    kind: "remember";
    onScreen?: never;
  };
  /** Remember's Tutorial: the same rule as Recall's. */
  tutorial: {
    kind: "tutorial";
    onScreen?: never;
  };
  /** Remember's Explore: about the reader's thinking, not where they are on the page. */
  explore: {
    kind: "explore";
    onScreen?: never;
  };
};

/**
 * **Which kinds of conversation offer Live**, the spoken one
 * (docs/project/live-conversation.md). A capability per kind, written out for
 * every kind, so a new one has to say — it was a `kind === "tutorial"` check
 * until Explore, which would have got a Live button by default and a 400 from
 * the server on its first spoken turn (GPT Sol's review of plan 261003l, PR-5).
 *
 * It has to agree with `SpokenKind` in src/chat.ts, the kinds a spoken turn
 * may create or join: tests/remember-own-thread.test.tsx holds the two
 * together. Tutorial has none yet because Greg said Live "doesn't work very
 * well at the moment"; Explore has none for the same reason, and because a
 * spoken turn carries no notes digest.
 */
export const OFFERS_LIVE: Readonly<Record<ConversationKind, boolean>> = {
  chat: true,
  remember: true,
  tutorial: false,
  explore: false,
};

type ConversationBandProps = {
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
   * **The Recall | Tutorial | Explore | Quiz control**, when this band is one of Remember's
   * conversation views. Absent in chat mode. Built by `RememberBand` above and passed straight
   * through to `ChatPanel`, which is where it is drawn.
   */
  subMode?: React.ReactNode;
} & ConversationVisibilityByKind[ConversationKind];

export function ConversationBand({
  slug,
  blocks,
  onJump,
  kind,
  subMode,
  handoff,
  onHandoffTaken,
  onScreen,
}: ConversationBandProps) {
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
    openHint,
    remove,
    deleting,
    settled,
    named,
    speak,
    error,
  } = useChat(slug);
  /**
   * **This mode's conversations, and only this mode's.**
   *
   * The list was shared between chat and Remember from 2026-08-27 until report
   * `spya-peszam` (Greg, 2026-10-01): *"The Remember mode should be its own
   * single, special conversation thread (not visible from Chat, nor should
   * other Chat threads be visible in Remember mode)."* So a thread of the other
   * kind is not here at all, and neither is Candidates, which is Referee mode's
   * machinery. Plan 261001m § 4.
   */
  /* **And a conversation this tab started from an item wears its origin at
     once.** The row in this tab is the one the tab made, and the `begin` frame
     that names it carries no origin, so without this the list would show no
     source for it until a reload. The origin is the one sent with the turn
     that created the thread (`pendingOrigin` below), shown only once the
     server has the thread. A thread that arrived in a load has its own. */
  const threads = useMemo(() => {
    const held = chatDraftsFor(slug);
    return everyThread
      .filter((t) => t.kind === kind)
      .map((t) => {
        if (t.origin) return t;
        const origin = held.origin(t.id);
        return origin && named(t.id) ? { ...t, origin } : t;
      });
  }, [everyThread, kind, slug, named]);
  const [thread, setThread] = useQueryState("thread", threadParam);
  /* Recall, Tutorial and Explore: each one conversation per article, no
     list. Named for Remember because that is where all three live. */
  const single = isSingleThreadKind(kind) ? kind : null;
  const remembering = single !== null;
  /**
   * Start over has two ordered waits: Live must finish writing its last spoken
   * exchange, then the DELETE must finish. While either is true Remember has no
   * composer and none of its callbacks may start another write.
   */
  const [resetting, setResetting] = useState<"idle" | "stopping-live" | "deleting">("idle");
  const resettingNow = useRef(false);
  /**
   * **Remember's one conversation, derived during render** — never chosen in an
   * effect, so there is no frame in which the panel is handed a `?thread=` that
   * names nothing and draws a list. `?thread=` follows it (the effect below)
   * rather than leading it: a chat's id or a stale one in Remember's URL is
   * simply overruled. GPT Sol's plan review, F6.
   */
  const remembered = useMemo(() => (single ? oneRemember(threads, single) : null), [single, threads]);
  const theRemember = resetting === "idle" ? remembered : null;
  /** The open conversation's id: Remember's one, or what `?thread=` says in chat. */
  const current = remembering ? (theRemember?.id ?? null) : thread;

  /* The address follows Remember's conversation, by *replace* — this corrects
     the URL; it is not a step the reader took. */
  useEffect(() => {
    if (!theRemember || thread === theRemember.id) return;
    void setThread(theRemember.id, { history: "replace" });
  }, [theRemember, thread, setThread]);

  /* An empty Remember conversation that lost to the stored one — begun before a
     refetch brought the real one — is this tab's alone, so it is dropped rather
     than left to resurface. `discard` is a no-op on anything with a message. */
  useEffect(() => {
    if (!theRemember) return;
    for (const t of threads) if (t.id !== theRemember.id && t.messages.length === 0) discard(t.id);
  }, [theRemember, threads, discard]);

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
  const selectedThread = useRef(current);
  selectedThread.current = current;
  const [pendingLive, setPendingLive] = useState<{ id: string; from: string | null } | null>(null);
  /**
   * **This article's unsent words, and where Chat was** — src/web/chat-draft.ts.
   * They outlive this band, which is the point: the band goes on every mode
   * change. The panel reads and writes the words; what the band does with the
   * store is the part only it can know — which conversations it began and
   * whether anything has been submitted to them, where a handed-over question
   * goes, and where the reader was when they left (the arrival rule below).
   * docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md.
   */
  const drafts = chatDraftsFor(slug);
  /**
   * `speak`, as the live session is handed it: **a spoken exchange is a
   * submission**, and it is one the typed draft knows nothing about — the
   * reader may hold words in the box while talking, and they do not change.
   * So "never submitted" is revoked here, where the exchange is written, and
   * not where the draft is. GPT Sol's review of the plan above, F9.
   */
  const speakAndMark = useCallback<typeof speak>(
    (spoken, onThreadId) => {
      drafts.submitted(spoken.threadId);
      return speak(spoken, onThreadId);
    },
    [drafts, speak],
  );
  /**
   * **Where this conversation was started from, while the server does not have
   * it yet** — the origin a handoff left beside the conversation's words
   * (`ChatDrafts.origin`), or `undefined`.
   *
   * The server stores an origin on the insert that creates the thread and at
   * no other time, so it is offered on every Send until the thread exists
   * there (`named`), and on none after. A first Send that fails leaves it
   * pending, so the next one carries it again; an identical origin for a
   * thread that already has it is let through, so a Send that did land
   * without this tab hearing is harmless too.
   *
   * The store keeps the origin after that, for `threads` above to show; what
   * ends "pending" is the server having the thread, not the entry going.
   * `named` answers from the controller, which re-renders this band when it
   * changes.
   */
  const pendingOrigin = (id: string | null): ThreadOrigin | undefined =>
    kind === "chat" && id !== null && !named(id) ? drafts.origin(id) : undefined;
  /**
   * **No Live until the first typed Send has landed** (plan 261005i, F4). A
   * spoken first exchange creates the thread by its own route, which carries
   * no origin, and the thread would then never have one. So while one is
   * pending the control is not handed down and the start callback does
   * nothing; a spoken first turn with an origin is a later stage.
   */
  const awaitsOrigin = (id: string | null): boolean => pendingOrigin(id) !== undefined;

  /**
   * **The live conversation, owned here** — above the panel, above the keyed
   * transcript, for the life of the article.
   *
   * `ChatPanel` is remounted every time the reader switches conversation, and a
   * peer connection that a remount destroys is a connection nothing owns: the
   * microphone stays open, the events go nowhere, and the exchange in flight is
   * never written down. docs/plans/260831l-live-conversation-in-chat.md § 5.
   *
   * The four things it is given are the four things a live session cannot
   * work out for itself:
   *
   * - `speak`, which is `useChat`'s — so a spoken exchange goes through the
   *   same controller as every typed turn, as an operation with an identity and
   *   a projection, rather than a second writer beside it;
   * - `blocks`, so a passage the model points at is checked against this
   *   article before it is shown or stored (`shownPassage`, live/session-shared.ts);
   * - `tailNow`, so the seeding barrier can tell whether the conversation moved
   *   while the session was connecting;
   * - `onThreadId`, so `?thread=` follows if the server names the conversation
   *   something other than what this tab invented.
   *
   * `useLive` holds both engines' hooks (Realtime and GPT-Live) and hands back
   * the one that owns the call, as the same `LiveApi`. ../../live/useLive.ts.
   */
  const live = useLive(slug, {
    speak: speakAndMark,
    blocks,
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
    /* Start over owns this hang-up and awaits it before DELETE. Letting this
       navigation reaction start a second stop would put the same flush back in
       a race with the deletion. */
    if (resetting !== "idle") return;
    if (live.phase === "idle" || live.phase === "failed") return;
    if (live.threadId && live.threadId !== current) void hangUp.current();
  }, [current, live.phase, live.threadId, resetting]);

  useEffect(() => {
    if (!pendingLive) return;
    if (current !== pendingLive.id) {
      if (current !== pendingLive.from) setPendingLive(null);
      return;
    }
    if (live.phase !== "idle" && live.phase !== "failed") return;
    // Selection must reach the render before start, or the navigation effect above
    // mistakes a just-created session for one the reader has already left.
    setPendingLive(null);
    live.start({ threadId: pendingLive.id });
  }, [pendingLive, current, live.phase, live.start]);

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
    /* Begun here, in this tab, and nothing submitted to it: the one kind of
       conversation the arrival rule may begin again on the way back. Chat's
       only — Remember's words are kept by kind and need no such mark. */
    if (kind === "chat") drafts.markFresh(id);
    void setThread(id);
    setFocusNonce((n) => n + 1);
    return id;
  }, [begin, setThread, kind, drafts]);

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
   * **What does survive a mode switch, since 2026-10-04, is the reader's unsent
   * words and where they were** (`drafts` above), and the effect below reads
   * them before it falls back on this rule: a reader who left words in the
   * box is put back with them rather than handed an empty conversation. See
   * "Arriving in chat" there.
   *
   * `thread` is deliberately *not* in this rule's condition. `?thread=` can
   * name a conversation that no longer exists — leave chat mode with an empty
   * new one open and the URL keeps its id while the panel takes the
   * conversation with it — and a reader coming back to that URL should get a
   * conversation, not a list they did not ask for. Starting one overwrites the
   * stale id, which is why there is no separate effect clearing it: an effect
   * that cleared the URL whenever the id was missing would also fire in the
   * window between a first question being sent and the server having written
   * it down.
   */
  const started = useRef(false);
  /** Has this visit's arrival been decided? Spent once the list has answered. */
  const arrived = useRef(false);
  /* `kind` as well as `slug`. This component is now mounted by two modes, and
     React will reuse the instance if it ever renders in the same position for
     both — at which point the latch would still be spent from the mode the
     reader just left, and arriving in the other one would show a list rather
     than a fresh conversation. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads nothing, and changing article or mode is exactly when the latch stops meaning anything
  useEffect(() => {
    started.current = false;
    arrived.current = false;
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
   *
   * **The question is written into the article's drafts here, once, as that
   * conversation's unsent words** — exactly what the reader would have had if
   * they had typed it: in the box, editable, cleared by Escape, enough to stop
   * the panel's `leave` discarding the conversation, and still there after a
   * look at another mode. It used to ride down to the panel as a `seed` prop
   * that was looked up during render and never stored, so a question the
   * reader had not touched was in the box and nowhere else. GPT Sol's review
   * of plan 261004j, F10. The write is in this effect, after `startNew`
   * returns and before the render that mounts the composer, so the composer's
   * one read finds it.
   */
  const taken = useRef<ChatHandoff | null>(null);
  useEffect(() => {
    if (!handoff) return;
    /* Asked in another article: not this conversation's question. */
    const ours = handoff.slug === slug;
    if (ours) started.current = true;
    if (taken.current === handoff) return;
    taken.current = handoff;
    if (ours) {
      const id = startNew();
      drafts.setThread(id, handoff.question);
      /* Beside the words, under the same id, so it goes wherever they go. */
      if (handoff.origin) drafts.setOrigin(id, handoff.origin);
    }
    onHandoffTaken?.();
  }, [handoff, slug, startNew, onHandoffTaken, drafts]);

  /**
   * **Arriving in chat: one decision, in this order**, made once per visit and
   * only when the list has answered.
   *
   * 1. A handed-over question wins (the effect above has spent the latch).
   * 2. **The reader left words unsent, and is put back with them.** Only the
   *    place they were in is ever recovered (`drafts.destination`), so an older
   *    conversation with words in it cannot take over the list or another
   *    conversation:
   *    - they were on the list, with words in its box → the list, and no
   *      conversation is started over it, because the new conversation's empty
   *      composer would be drawn where the box with the words is;
   *    - `?thread=` already names one of the listed conversations → nothing;
   *      the reader chose that one, by a link or by Back;
   *    - the conversation they were in is listed → open it, by *replace*. This
   *      is the case the address cannot be trusted for: Recall writes its own
   *      conversation's id over `?thread=` and Quiz clears it, so the words
   *      were kept and no composer was mounted to show them;
   *    - it is not listed, and was never submitted to → begin another and move
   *      the words across. A conversation with no message exists only in the
   *      tab that began it, and went with the band;
   *    - it is not listed, and something *was* submitted to it → nothing. The
   *      first question's write has not landed, or another tab deleted it;
   *      beginning another would send a follow-up without its history. The
   *      words stay in the store, under its id.
   * 3. Otherwise the rule above: no conversations, so start one.
   *
   * **Step 2 is not taken on a failed load.** `loaded` means "we have asked",
   * and a list that failed to arrive has no conversations in it whatever the
   * server holds, so "not listed" would be a claim about nothing. Step 3 is
   * left as it was on a failed load.
   *
   * One effect rather than two, because two arrival rules are two answers to
   * one question and the second undid the first: a reader back on the list
   * with words in its box was handed a new empty conversation by step 3.
   * Plan 261004j, and GPT Sol's two reviews of it (F1–F3, F6, F7).
   */
  useEffect(() => {
    if (remembering || !loaded) return;
    if (!arrived.current) {
      arrived.current = true;
      const was = drafts.destination();
      if (loadFailed || started.current || was === undefined) {
        /* Nothing to recover, or no ground to recover it on. */
      } else if (was === null) {
        if (drafts.list().trim() !== "") started.current = true;
      } else if ((drafts.thread(was) ?? "").trim() !== "") {
        if (threads.some((t) => t.id === thread)) {
          /* The reader's own choice. */
        } else if (threads.some((t) => t.id === was)) {
          /* This corrects the address; it is not a step the reader took. */
          void setThread(was, { history: "replace" });
        } else if (drafts.isFresh(was)) {
          started.current = true;
          drafts.moveThread(was, startNew());
        }
      }
    }
    if (started.current) return;
    if (threads.length === 0) {
      started.current = true;
      startNew();
    }
  }, [remembering, loaded, loadFailed, threads, thread, setThread, startNew, drafts]);

  /**
   * **Where chat is, written down for the next visit** — the conversation on
   * screen, or `null` for the list. Read by the arrival rule above, and by
   * nothing else.
   *
   * After that rule, and only once the list has answered: before then
   * `?thread=` is whatever the last mode left in it, and recording that would
   * overwrite the very thing the rule is about to read. A failed load cannot
   * establish that a conversation is absent, so it cannot record the list.
   * A positively matched local conversation is still known, though: `begin`
   * can have supplied it independently of that failed fetch.
   *
   * "On screen" is the panel's own test — `?thread=` names a conversation in
   * the list — rather than `thread` alone, which can name nothing.
   */
  useEffect(() => {
    if (kind !== "chat" || !loaded) return;
    if (threads.some((t) => t.id === thread)) drafts.setDestination(thread);
    else if (!loadFailed) drafts.setDestination(null);
  }, [kind, loaded, loadFailed, threads, thread, drafts]);

  /**
   * **Remember has a conversation whenever it can have one** — on arrival with
   * none, and after Start over. No latch: there is no list to come back to and
   * no close button, so "nothing open" is never a state the reader asked for.
   * It cannot loop, because `begin` inserts its conversation on the spot.
   *
   * **Not while a delete is out** (`deleting`), and that is GPT Sol's P0 on
   * the plan, F1. The server folds a new Remember thread's first turn into the
   * article's existing one, so a question typed into a fresh conversation
   * before Start over's DELETE has landed would be appended to the very thread
   * the DELETE then removes. With nothing begun there is no composer, so there
   * is nowhere to type it. A refused delete puts the old conversation back
   * (`restoreOnFailure` in `onDelete` below), and then there is nothing to
   * begin.
   */
  useEffect(() => {
    if (!remembering || !loaded || theRemember || deleting || resetting !== "idle") return;
    startNew();
  }, [remembering, loaded, theRemember, deleting, resetting, startNew]);

  /* A failed DELETE restores the old thread; a successful one leaves none. In
     either case the operation retiring is what lets Remember draw again. */
  useEffect(() => {
    if (resetting !== "deleting" || deleting) return;
    resettingNow.current = false;
    setResetting("idle");
  }, [resetting, deleting]);
  /* Read, never written, and not a subscription — see `currentAt` in
     params.ts. It is passed to the model so that "this bit" and "what he just
     said" resolve to where the reader actually is. */
  const at = currentAt();

  return (
    <ChatPanel
      slug={slug}
      /* Not for display — the panel offers its "start a new one" box only once
         this is true. It went in because a conversation minted before the first
         fetch landed was wiped by it; that is fixed at source now
         (`mergedArrival` in useChat.ts), so what this does is keep the box off
         a list the reader cannot see yet. See the composer under `ThreadList`. */
      loaded={loaded}
      loadFailed={loadFailed}
      /* Remember is handed its one conversation and nothing else, so the panel
         has nothing it could list. */
      threads={remembering ? (theRemember ? [theRemember] : []) : threads}
      threadId={current}
      /* Open a conversation from the list, or close one back to it — chat's
         only, since Remember has neither. Every row is this mode's kind now, so
         there is no other mode to follow it into. */
      onThread={(id) => {
        setPendingLive(null);
        void setThread(id);
      }}
      onNew={startNew}
      /* **Owned above this panel**, which is remounted on every conversation
         switch — see the note where the hook is called. */
      /* **No Live in Tutorial or Explore, yet** (`OFFERS_LIVE` above). Short
         alternating turns are ideal spoken, and Greg said so, but also that
         Live "doesn't work very well at the moment" — so both are typed or
         dictated first, and a spoken turn cannot create one (`SpokenKind` in
         src/chat.ts stays chat | remember). Omitted here rather than refused
         by the server, so there is no button. */
      /* Nor on a conversation whose origin the server does not have yet
         (`awaitsOrigin` above): no button, and the callback is refused too. */
      live={OFFERS_LIVE[kind] && !awaitsOrigin(current) ? live : undefined}
      onStartLive={!OFFERS_LIVE[kind] ? undefined : (id) => {
        if (resettingNow.current) return;
        if (awaitsOrigin(id)) return;
        if (!id && kind !== "chat") return;
        const next = id ?? begin("chat");
        /* Begun here like `startNew`'s, and as unsent until its first spoken
           exchange is written (`speakAndMark` above). */
        if (!id) drafts.markFresh(next);
        setPendingLive({ id: next, from: current });
        void setThread(next);
        return next;
      }}
      /* Local only — an empty conversation was never written down. See
         `withoutEmpty` in useChat.ts. */
      onDiscard={discard}
      onSend={(question) => {
        if (resettingNow.current) return;
        // `send` returns the thread it went to, minted here when this is a new
        // conversation — so the URL can name it before the request lands.
        /* This mode's kind: every conversation the band can open is of it now.
           The server refuses a kind that contradicts an existing thread rather
           than taking our word for it, so this being wrong is a 409 rather than
           a corrupted transcript. */
        const origin = pendingOrigin(current);
        const id = send(current, question, at, {
          onThreadId: (corrected) => {
            /* The server named the conversation something else: its origin
               follows, so the list still says where it came from. */
            if (origin && current) {
              drafts.setOrigin(corrected, origin);
              drafts.clearOrigin(current);
            }
            void setThread(corrected);
          },
          kind,
          ...(onScreen ? { visible: onScreen() } : {}),
          ...(origin ? { origin } : {}),
        });
        /* Something has now been sent to it, so it is no longer a conversation
           the arrival rule may begin again — whatever is typed into its box
           afterwards, and whether or not this write ever lands. */
        drafts.submitted(id);
        if (id !== current) void setThread(id);
      }}
      /* The box under the list. `null` rather than `thread` is the whole
         difference: it mints whatever `?thread=` still says, which on the list
         is either nothing, a conversation the fetch has not brought yet, or one
         that was closed and discarded. The nonce goes up for the same reason
         `startNew` raises it — this *is* a new conversation being started, and
         the reader who typed to start it should still have a caret when it
         opens, in the composer that has just replaced the one they typed into. */
      onSendNew={(question) => {
        if (resettingNow.current) return;
        /* `null` for the thread, so this mints a new one — and therefore this
           mode's kind, not any open conversation's. */
        const id = send(null, question, at, {
          onThreadId: (corrected) => void setThread(corrected),
          kind,
          ...(onScreen ? { visible: onScreen() } : {}),
        });
        void setThread(id);
        /* **Not on a soft keyboard.** The send lets go of the keys there so
           the answer can be read (useVisualViewport.ts § `putKeyboardAway`),
           and a raised nonce would have the replacement composer take focus
           and bring them straight back. Asked before the old box blurs, which
           is after this returns. GPT Sol, plan review of 261003h. */
        if (!softKeyboardIsUp()) setFocusNonce((n) => n + 1);
      }}
      /* **Start over is offered only on a settled conversation** — stored,
         named by the server, nothing of this tab's still out for it (`settled`
         in useChat.ts). So its DELETE is never held waiting for a name, and
         never races this tab's own write. Plan 261001m. */
      canStartOver={remembering && current !== null && settled(current)}
      onRename={rename}
      onDelete={(id) => {
        /* **Start over.** The conversation leaves the screen at once, and the
           fresh one is begun only when the server has answered — see the
           Remember effect above. If the server refuses, the old one comes back. */
        if (remembering) {
          /* The panel offers no button otherwise; this is the same rule held
             where the request is made, not a second one. */
          if (resettingNow.current || !settled(id)) return;
          resettingNow.current = true;
          setResetting("stopping-live");
          void (async () => {
            try {
              if (live.phase !== "idle" && live.phase !== "failed") await live.stop();
            } finally {
              setResetting("deleting");
              remove(id, { restoreOnFailure: true });
            }
          })();
          return;
        }
        remove(id);
        /* And its unsent words go with it: kept, they would be words for a
           conversation that is not there. (Not Start over above, which leaves
           Remember's box as it is — a refused delete puts the conversation
           back, and the words should still be under it. Plan 261004j, F8.) */
        drafts.dropThread(id);
        // Back to the list rather than to a conversation that is not there.
        if (id === thread) void setThread(null);
      }}
      /* All three carry the *open* thread rather than a thread id from the
         panel, because the panel only ever shows one and the id it would send
         back is the one it was given. `current` is non-null wherever these can
         be pressed — the conversation view is what renders them. */
      onRetry={(messageId) => current && retry(current, messageId)}
      onEdit={(messageId, question) =>
        current && edit(current, messageId, question, at, onScreen?.())
      }
      onStop={(messageId) => current && stop(current, messageId)}
      onHintOpened={(messageId, hint) => current && openHint(current, messageId, hint)}
      onJump={onJump}
      recovering={recovering}
      blocks={blocks}
      focusNonce={focusNonce}
      error={error}
      kind={kind}
      subMode={subMode}
    />
  );
}
