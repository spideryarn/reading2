/**
 * **The conversation controller, and the two modes that compose it.** Chat is
 * `ConversationBand` on its own; Learn is `LearnBand`, which is the
 * `?learn=` switch over that same band and the quiz.
 *
 * **One file, and deliberately not two.** `LearnBand` renders
 * `ConversationBand`, so `modes/chat/` beside `modes/learn/` would be one
 * feature module importing another — which A1 forbids alongside importing
 * `App.tsx`. Chat and Learn are two compositions of one conversation
 * controller rather than two features. GPT Sol's review of the plan below,
 * finding F2.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established two days earlier: a mode's controller and the pieces only it uses
 * move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. Both modes are
 * owner-only, so there are no visitor twins. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md,
 * and docs/project/comments.md, docs/project/learn-mode.md and
 * docs/project/quiz.md for the modes themselves.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, useQueryStates } from "nuqs";
import type {
  BlockId,
  ChatAnchor,
  ChatThread,
  SingleThreadKind,
  ThreadKind,
  ThreadOrigin,
} from "../../../types.js";
import { isLearnKind } from "../../../types.js";
import { chatFromParam, currentAt, guideParam, modeParam, learnParam, threadParam } from "../../params.js";
import { listedInChat, openableInChat, sourcesIn } from "../../thread-source.js";
import { useRenderCount } from "../../perf.js";
import { type QuizArrival, QuizPanel, type QuizSections, LearnSubModeToggle } from "../../QuizPanel.js";
import { type QuizRead, useQuiz } from "../../useQuiz.js";
import type { ReadSoFar } from "../../read-filter.js";
import { useChat } from "../../useChat.js";
import { useExperimental } from "../../useExperimental.js";
import { softKeyboardIsUp } from "../../useVisualViewport.js";
import { useLive } from "../../live/useLive.js";
import { ChatPanel } from "../../ChatPanel.js";
import { chatDraftsFor } from "../../chat-draft.js";

/**
 * **Learn's four sub-modes, and the one place their URL rules live.**
 *
 * Learn is `recall` — the reader says what they took from the article and the
 * model shows them where that comes apart — `tutorial`, where model and reader
 * take short teaching turns, `explore`, where the reader works out what they
 * think and the model starts from what they marked, or `quiz`, where the
 * questions come from the article instead. One mode, four views, and
 * `?learn=` says which.
 * docs/plans/260831al-review-quiz-sub-mode.md.
 *
 * ## Why this is a component rather than two conditions up in `Reader`
 *
 * Two reasons, and the second is the one that matters.
 *
 * The cheap one: `?learn=` is meaningless outside Learn mode, and reading it
 * in `Reader` would put a parameter subscription on every render of the reading
 * view for a value only this subtree uses — the same argument `ConversationBand`
 * makes about `?thread=`.
 *
 * The real one: **`?learn=` and `?thread=` collide, and the rules are
 * navigations rather than parsing.** `?mode=learn&learn=quiz&thread=<id>`
 * would otherwise leave a Learn conversation selected and invisible. Both
 * parameters are set through one `useQueryStates`, so switching sub-mode is one
 * history entry rather than two — two would put a half-state on the Back stack,
 * which is the bug learn-mode.md already records for opening a thread of the
 * other kind.
 *
 * Two rules, and both are here:
 *
 * 1. **switching to Quiz sets `learn=quiz` and clears `thread`, in one
 *    navigation** — pushed, because switching sub-mode is a deliberate act on
 *    the view and Back should undo it;
 * 2. **a pasted URL carrying both: Quiz wins**, and `thread` is dropped with a
 *    *replace* — a push would put the broken combination one Back press away
 *    from the reader we have just rescued from it.
 *
 * Opening a Learn row from Chat sets mode, sub-mode and thread together
 * in `ConversationBand` below; that navigation does not belong to this toggle.
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
export function LearnBand({
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
  useRenderCount("LearnBand");
  /* Only for which chips the row draws: Explore is behind the switch
     (QuizPanel.tsx § `LearnSubModeToggle`). */
  const { on: experimentalOn } = useExperimental();
  const [{ learn, thread }, setBoth] = useQueryStates({
    learn: learnParam,
    thread: threadParam,
  });

  /* Rule 2. A *replace*, and an effect rather than a render-time fix-up,
     because writing to the URL during render is what React refuses. It settles
     on the first commit and then never fires again, since `thread` is null. */
  useEffect(() => {
    if (learn === "quiz" && thread !== null) {
      void setBoth({ thread: null }, { history: "replace" });
    }
  }, [learn, thread, setBoth]);

  const toggle = (
    <LearnSubModeToggle
      value={learn}
      slug={slug}
      experimental={experimentalOn}
      onChange={(next) =>
        /* Rule 1. Both keys in one call, so this is one history entry — and
           `thread: null` on the way to Quiz rather than only on arrival, so
           there is no frame in which the URL says both. Going the other way
           leaves `thread` alone: Recall opens the one Learn conversation
           whatever it says, and writes its id back (`ConversationBand`). */
        void setBoth(
          next === "quiz" ? { learn: next, thread: null } : { learn: next },
          { history: "push" },
        )
      }
    />
  );

  if (learn === "quiz")
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
  if (learn === "tutorial")
    return (
      <ConversationBand
        /* Its own key, so Recall and Tutorial never share a mounted band — a
           focus nonce or a latch carried across would belong to the other
           conversation. (Their unsent words are kept apart by kind, not by
           this key: src/web/chat-draft.ts.) */
        key="learn-tutorial"
        slug={slug}
        blocks={blocks}
        onJump={onJump}
        kind="tutorial"
        subMode={toggle}
      />
    );
  if (learn === "explore")
    return (
      <ConversationBand
        /* Its own key, for Tutorial's reason: three conversations, and none of
           them shares a mounted band with another. */
        key="learn-explore"
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
      key="learn-recall"
      slug={slug}
      blocks={blocks}
      onJump={onJump}
      /* The **persisted thread kind** — src/types.ts § ThreadKind. */
      kind="learn"
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
 * Written as an `Exclude` rather than as `"chat" | "learn"` so that a fifth
 * kind arrives here as a compile error and somebody has to decide which side of
 * the line it is on.
 *
 * `guide` is on the far side too: it is a conversation the Chat band opens
 * (one per article, pinned above Chat's list), not a band of its own, so no
 * mode mounts this band with it. docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md
 * (GPT Sol's F2: single-thread, openable in Chat, and Learn are three ideas).
 */
type ConversationKind = Exclude<ThreadKind, "candidates" | "guide">;

/**
 * **A question another mode has handed to chat, for a fresh conversation:
 * sent as its first question, or put in its composer to wait** (`send`).
 *
 * The senders are all in `Reader` (§ `handToChat`): *Ask in chat* in Glossary,
 * Citations and Debate, Debate's *Check this claim in chat*, and the button
 * on a Summary paragraph, which hands over the paragraph, quoted
 * (docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md). Greg,
 * 2026-09-11, asked whether the glossary's question should go into the
 * conversation already open or a new one: *"fresh"*. So a handoff never
 * touches another conversation's draft.
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
export type ChatHandoff = ChatHandoffToChat | ChatHandoffToGuide;

/**
 * **Where a handoff goes — required, so a sender has to say** (plan 261007j,
 * GPT Sol's F2). Every *Ask in chat* in the app starts a fresh chat, as Greg
 * asked on 2026-09-11 (*"fresh"*), whatever conversation the band has open —
 * the guide included. The command bar's *Ask the guide* row (stage 3) targets
 * the article's one guide instead: open it, existing or new, and send there.
 */
interface ChatHandoffBase {
  readonly slug: string;
  readonly question: string;
  /**
   * **Whether the press that handed this over was the Send.** Greg,
   * 2026-10-06 (spya-x896vu): *"When I click "ask in Chat" anywhere,
   * automatically submit the input (rather than just prefilling the input box
   * and waiting for me to hit send)"*. Until then every handoff waited in the
   * box. `true` for a question that is complete as handed over; `false` for
   * the Summary paragraph's, which is a quoted paragraph and an empty line
   * where the reader's question goes, so there is nothing to ask yet.
   * Required, so a new sender has to say.
   * docs/plans/261006j-ask-in-chat-sends-the-question.md.
   */
  readonly send: boolean;
}

/** To the guide: open it (or begin it) and send, or wait in its box. Nothing else rides along. */
export interface ChatHandoffToGuide extends ChatHandoffBase {
  readonly target: "guide";
}

/** A fresh chat — every *Ask in chat* sender in `Reader` § `handToChat`. */
export interface ChatHandoffToChat extends ChatHandoffBase {
  readonly target: "chat";
  /**
   * The item the question is about, when the conversation should remember it
   * (`ThreadOrigin`): Debate's *Check this claim in chat* since 2026-10-05,
   * and *Ask in chat* on a Glossary entry or a Citations row since 2026-10-06
   * (docs/plans/261006d-glossary-and-citations-ask-in-chat-with-origin.md).
   * The band keeps it beside the new conversation and sends it with the
   * first question. The Summary's handoff sends none, and nor does the
   * glossary's other one, for a typed word the article does not contain.
   * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md.
   */
  readonly origin?: ThreadOrigin;
  /** A passage the handed-over question is about. */
  readonly anchor?: ChatAnchor;
  /** The saved comment that asked this question, when there is one. */
  readonly sourceCommentId?: string;
}

/**
 * **The reader's one Learn conversation, out of whatever the list holds.**
 *
 * The server keeps at most one per article (plan 261001m § 1), but this tab can
 * briefly hold more: an empty one it began before a refetch brought the stored
 * one, or a second tab's. So: one with something in it over an empty one, then
 * the earliest, then the id — a total order, so every render picks the same.
 * Pure and exported for that reason.
 */
export function oneLearn(
  threads: readonly ChatThread[],
  /* Any single-thread kind: Learn's three, and since plan 261007j the guide,
     which Chat's band picks the same way. */
  kind: SingleThreadKind = "learn",
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
 * `kind` — which mode mounted the band, chat or Learn — and what goes with
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
  learn: {
    /** Learn must never report a screenful to its prompt. */
    kind: "learn";
    onScreen?: never;
  };
  /** Learn's Tutorial: the same rule as Recall's. */
  tutorial: {
    kind: "tutorial";
    onScreen?: never;
  };
  /** Learn's Explore: about the reader's thinking, not where they are on the page. */
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
 * may create or join: tests/learn-own-thread.test.tsx holds the two
 * together. Tutorial has none yet because Greg said Live "doesn't work very
 * well at the moment"; Explore has none for the same reason, and because a
 * spoken turn carries no notes digest.
 */
export const OFFERS_LIVE: Readonly<Record<ConversationKind, boolean>> = {
  chat: true,
  learn: true,
  tutorial: false,
  explore: false,
};

type ConversationBandProps = {
  slug: string;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  /**
   * A question to open a fresh conversation with, sent or left in its box —
   * see `ChatHandoff`. Only chat mode is handed one.
   */
  handoff?: ChatHandoff | null | undefined;
  /** The band has taken `handoff` (or refused it); the owner should forget it. */
  onHandoffTaken?: (() => void) | undefined;
  /** The fresh conversation a sent handoff opened, including a corrected id. */
  onHandoffThread?: ((handoff: ChatHandoff, threadId: string) => void) | undefined;
  /** An answer settled, including after this band has gone. */
  onSettled?: (() => void) | undefined;
  /**
   * **The Recall | Tutorial | Explore | Quiz control**, when this band is one of Learn's
   * conversation views. Absent in chat mode. Built by `LearnBand` above and passed straight
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
  onHandoffThread,
  onSettled,
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
  } = useChat(slug, onSettled);
  /**
   * **The conversations this band may open: this mode's kind, and only it.**
   *
   * The list was shared between chat and Learn from 2026-08-27 until report
   * `spya-peszam` (Greg, 2026-10-01): *"The Learn mode should be its own
   * single, special conversation thread (not visible from Chat, nor should
   * other Chat threads be visible in Learn mode)."* Plan 261001m § 4.
   *
   * **The "not visible from Chat" half of that changed on 2026-10-05**, for
   * report `spya-hyfqkq`: Chat's list now shows Learn's conversations too
   * (`listed` below; plan
   * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md,
   * D5). The other half stands, and so does this filter: Learn shows only
   * its own one conversation, and what Chat may *open* is still only a chat.
   */
  /* Origins come from the server, through a load or the successful `begin`
     frame. A held draft may have been refused, so it cannot label a row. */
  /* **Chat's band opens the guide as well as its chats** (plan 261007j, GPT
     Sol's F2: `openableInChat`). Everything below that resolves the open
     conversation, or where a question goes, reads this set — so a `?thread=`
     naming the guide opens it here, and the kind a send carries is the open
     conversation's, never the band's (`sendTo`). */
  const threads = useMemo(
    () => everyThread.filter((t) => (kind === "chat" ? openableInChat(t.kind) : t.kind === kind)),
    [everyThread, kind],
  );
  /**
   * **What Chat's list draws: every conversation but Referee's Candidates.**
   *
   * A second set beside `threads`, and the two are kept apart on purpose (the
   * plan review's F3). Everything below that decides which conversation is
   * open, where a question goes or whose unsent words are whose reads
   * `threads`. Only two things read this one: the panel's list, and the
   * arrival rule's "is there anything to show".
   */
  const listed = useMemo(() => everyThread.filter(listedInChat), [everyThread]);
  const [thread, setThread] = useQueryState("thread", threadParam);
  /** `?chatfrom=`: which source Chat's list is narrowed to. Null is All. */
  const [from, setFrom] = useQueryState("chatfrom", chatFromParam);
  /* For a press on a Learn row, which changes three parameters at once. */
  /* Closed on a line of its own: tests/last-view.test.ts reads the keys of
     every `useQueryStates` call by that shape. */
  const [{ mode: modeNow }, setWhere] = useQueryStates({
    mode: modeParam,
    learn: learnParam,
    thread: threadParam,
  });
  /* Recall, Tutorial and Explore: each one conversation per article, no
     list. Named for Learn because that is where all three live. */
  const single = isLearnKind(kind) ? kind : null;
  const learning = single !== null;
  /**
   * Start over has two ordered waits: Live must finish writing its last spoken
   * exchange, then the DELETE must finish. While either is true Learn has no
   * composer and none of its callbacks may start another write.
   */
  const [resetting, setResetting] = useState<"idle" | "stopping-live" | "deleting">("idle");
  const resettingNow = useRef(false);
  /**
   * **Learn's one conversation, derived during render** — never chosen in an
   * effect, so there is no frame in which the panel is handed a `?thread=` that
   * names nothing and draws a list. `?thread=` follows it (the effect below)
   * rather than leading it: a chat's id or a stale one in Learn's URL is
   * simply overruled. GPT Sol's plan review, F6.
   */
  const found = useMemo(() => (single ? oneLearn(threads, single) : null), [single, threads]);
  const theLearn = resetting === "idle" ? found : null;
  /** The open conversation's id: Learn's one, or what `?thread=` says in chat. */
  const current = learning ? (theLearn?.id ?? null) : thread;
  /**
   * **The open conversation's kind**, which is what a send, an edit and Live
   * go by — not the band's (GPT Sol's F2). In Chat it is `chat` or `guide`;
   * with nothing open, a send mints a conversation of the band's kind.
   */
  const openKind: ThreadKind = threads.find((t) => t.id === current)?.kind ?? kind;
  /**
   * **This article's guide, in Chat's band** — one per article, chosen like
   * Learn's (`oneLearn`): one with something in it over an empty one this tab
   * began before the list brought the stored one. `null` until there is one;
   * the pinned row is drawn either way, and a press begins it (`openGuide`).
   */
  const theGuide = useMemo(() => (kind === "chat" ? oneLearn(threads, "guide") : null), [kind, threads]);

  /* The address follows Learn's conversation, by *replace* — this corrects
     the URL; it is not a step the reader took. */
  useEffect(() => {
    if (!theLearn || thread === theLearn.id) return;
    void setThread(theLearn.id, { history: "replace" });
  }, [theLearn, thread, setThread]);

  /* An empty Learn conversation that lost to the stored one — begun before a
     refetch brought the real one — is this tab's alone, so it is dropped rather
     than left to resurface. `discard` is a no-op on anything with a message. */
  useEffect(() => {
    if (!theLearn) return;
    for (const t of threads) if (t.id !== theLearn.id && t.messages.length === 0) discard(t.id);
  }, [theLearn, threads, discard]);

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
  /* A draft recovered onto a forced list must survive another mode change
     before its row is opened. Empty local rows go with this band; keeping its
     destination lets the next visit recover the words and pending origin. */
  const heldOnList = useRef<string | null>(null);
  useEffect(() => {
    for (const t of threads) if (named(t.id)) drafts.clearOrigin(t.id);
  }, [threads, named, drafts]);

  /* **A guide this tab began, beaten by the stored one**, is reconciled — as
     an empty Learn conversation is below — and if it was the one on screen,
     the reader is moved to the stored guide with their unsent words. By
     *replace*: this corrects the address.

     Usually both rows are still in this controller and the loop finds the
     empty local one. A mode change can unmount the band before the server's
     `begin` frame corrects the id, though: the next controller then has only
     the stored guide. `drafts.guide()` is the durable evidence of the missing
     optimistic row, so reconcile that id as well. */
  useEffect(() => {
    if (!theGuide) return;
    const reconcile = (id: string) => {
      drafts.moveThread(id, theGuide.id);
      if (drafts.destination() === id) drafts.setDestination(theGuide.id);
      if (id === thread) void setThread(theGuide.id, { history: "replace" });
      discard(id);
    };
    const begun = drafts.guide();
    if (begun !== undefined && begun !== theGuide.id) reconcile(begun);
    for (const t of threads) {
      if (t.kind !== "guide" || t.id === theGuide.id || t.messages.length > 0) continue;
      if (t.id !== begun) reconcile(t.id);
    }
  }, [theGuide, threads, thread, drafts, discard, setThread]);
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
   * `named` answers from the controller, which re-renders this band when it
   * changes. The effect above forgets confirmed entries; the server's row
   * carries the origin from then on.
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
  /* `focus` is false for one caller: a handed-over question that is sent on
     arrival (the handoff effect below), where there is nothing to type. */
  const beginHere = useCallback((focus: boolean) => {
    heldOnList.current = null;
    setPendingLive(null);
    const id = begin(kind);
    /* Begun here, in this tab, and nothing submitted to it: the one kind of
       conversation the arrival rule may begin again on the way back. Chat's
       only — Learn's words are kept by kind and need no such mark. */
    if (kind === "chat") drafts.markFresh(id);
    void setThread(id);
    if (focus) setFocusNonce((n) => n + 1);
    return id;
  }, [begin, setThread, kind, drafts]);
  const startNew = useCallback(() => beginHere(true), [beginHere]);

  /**
   * **Open this article's guide in the band: the stored one, or one begun
   * here** (plan 261007j). One per article, so there is nothing to choose:
   * the pinned row, `?guide=1` and a handoff that targets the guide all come
   * here. A guide begun here is local until its first question, like any new
   * conversation; the server folds a first turn into a guide it already holds
   * and says so in the `begin` frame (src/chat.ts § `targetOf`), which is the
   * id `send`'s `onThreadId` puts in the address.
   *
   * `wanted` is an id to begin it under — the one this tab began before a
   * mode change took it away, so its words come back with it. Through a ref
   * for the stored guide, because a handoff's effect can run before this
   * render's `theGuide` is the newest.
   */
  const guideNow = useRef(theGuide);
  guideNow.current = theGuide;
  const openGuide = useCallback(
    (focus: boolean, wanted?: string): string => {
      heldOnList.current = null;
      setPendingLive(null);
      const stored = guideNow.current;
      /* `begin` with an id this tab already holds returns it unchanged, so a
         second open in one commit (StrictMode) is the same guide. */
      const id = stored?.id ?? begin("guide", wanted ?? drafts.guide());
      if (!stored) drafts.setGuide(id);
      if (wanted !== undefined && wanted !== id) drafts.moveThread(wanted, id);
      drafts.setDestination(id);
      void setThread(id);
      if (focus) setFocusNonce((n) => n + 1);
      return id;
    },
    [begin, setThread, drafts],
  );

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
    heldOnList.current = null;
  }, [slug, kind]);

  /**
   * **Take a handed-over question: a fresh conversation, and the question
   * either sent to it as its first (`handoff.send`), or in its box with the
   * caret and nothing sent.**
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
   * **A question that sends goes through `sendTo` below, the function behind
   * the panel's Send**, so the origin, the blocks on screen, the "submitted"
   * mark and a corrected id are one path for a typed question and a handed
   * one. `taken` is what makes one press one model call. It takes no caret:
   * there is nothing to type, a caret on a phone raises the keyboard over the
   * answer, and on a laptop it stops ↑/↓ stepping the article. Through a ref
   * because `sendTo` is rebuilt every render and this effect must not re-run
   * for that. docs/plans/261006j-ask-in-chat-sends-the-question.md.
   *
   * **A question that waits is written into the article's drafts here, once, as that
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
  const sendToRef = useRef<
    (id: string | null, question: string, first?: ChatHandoffToChat, as?: ThreadKind) => void
  >(() => {});
  useEffect(() => {
    if (!handoff) return;
    /* Asked in another article: not this conversation's question. */
    const ours = handoff.slug === slug;
    if (ours) started.current = true;
    if (taken.current === handoff) return;
    const take = () => {
      if (taken.current === handoff) return;
      taken.current = handoff;
      if (ours && handoff.target === "guide") {
        /* The one guide, not a fresh conversation: the bar's *Ask the guide*
           (plan 261007j). Sent as a guide turn, whatever the band had open. */
        const id = openGuide(!handoff.send);
        if (handoff.send) sendToRef.current(id, handoff.question, undefined, "guide");
        else drafts.setThread(id, handoff.question);
      } else if (ours && handoff.target === "chat") {
        /* A fresh chat, even with the guide open: `beginHere` mints the
           band's kind, which here is `chat`. */
        const id = beginHere(!handoff.send);
        /* Under the conversation's id, so it goes wherever its words go, and
           before the send, which reads it (`pendingOrigin`). */
        if (handoff.origin) drafts.setOrigin(id, handoff.origin);
        if (handoff.send) {
          sendToRef.current(id, handoff.question, handoff);
          onHandoffThread?.(handoff, id);
        } else drafts.setThread(id, handoff.question);
      }
      onHandoffTaken?.();
    };
    if (!ours || !handoff.send) {
      take();
      return;
    }

    /* `useChat` drops navigation callbacks in its effect cleanup, correctly:
       a real unmount must not repoint a later screen. StrictMode also performs
       that cleanup once immediately after mount. Sending inside this effect's
       first setup registered `onThreadId` just before that synthetic cleanup,
       so a corrected server id could never reach the URL. Queue the paid work;
       the first setup cancels its task and the replayed setup performs it once,
       after the cleanup. Production has one setup and the same one microtask
       delay. The synchronous `started` latch above still prevents the arrival
       effect from beginning another conversation meanwhile. */
    let live = true;
    queueMicrotask(() => {
      if (live) take();
    });
    return () => {
      live = false;
    };
  }, [handoff, slug, beginHere, openGuide, onHandoffTaken, onHandoffThread, drafts]);

  /**
   * **`?guide=1`: open the guide, whether or not it exists** (params.ts §
   * `guideParam`). Once the list has answered, so a stored guide is opened
   * rather than a second begun beside it; then the address says
   * `?thread=<its id>` and the flag goes, both by replacement rather than a new
   * history step. It spends the
   * arrival latch, as a handoff does, so the rule below does not open a chat
   * over it. After the handoff effect and before the arrival rule, for the
   * reason that order is given above.
   */
  const [askGuide, setAskGuide] = useQueryState("guide", guideParam);
  useEffect(() => {
    if (kind !== "chat" || askGuide !== true || !loaded) return;
    started.current = true;
    openGuide(false);
    void setAskGuide(null);
  }, [kind, askGuide, loaded, openGuide, setAskGuide]);

  /**
   * **Arriving in chat: one decision, in this order**, made once per visit and
   * only when the list has answered.
   *
   * 1. A handed-over question wins (the effect above has spent the latch).
   * 2. **A known non-chat URL shows the list.** Unsent chat words remain on
   *    their row; missing fresh drafts and pending origins get a local row.
   * 3. **Otherwise, the reader left words or a pending origin, and is put back with them.** Only the
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
   *    - it is not listed, and has a pending origin after submission → resume
   *      the same id, so a late stored first turn remains part of its history;
   *    - it is not listed, and something *was* submitted without a pending origin → nothing. The
   *      first question's write has not landed, or another tab deleted it;
   *      beginning another would send a follow-up without its history. The
   *      words stay in the store, under its id.
   * 4. Otherwise the rule above: no conversations of any listed kind, so start one.
   *
   * **Steps 2 and 3 are not taken on a failed load.** `loaded` means "we have asked",
   * and a list that failed to arrive has no conversations in it whatever the
   * server holds, so "not listed" would be a claim about nothing. Step 4 is
   * left as it was on a failed load.
   *
   * One effect rather than two, because two arrival rules are two answers to
   * one question and the second undid the first: a reader back on the list
   * with words in its box was handed a new empty conversation by step 3.
   * Plan 261004j, and GPT Sol's two reviews of it (F1–F3, F6, F7).
   */
  /**
   * **A `?thread=` naming a conversation of another kind is cleared, and the
   * list shown** (the plan review's F3). It gets here two ways: carried over
   * from Learn, which writes its conversation's id into the address, or
   * pasted. The panel could not have opened it (it is not in `threads`), so
   * this only makes the address say what is on screen.
   *
   * Only once the list has shown what kind it is: an id the list does not
   * hold may be a first question still being written, which the note on the
   * latch above says not to clear. By *replace*: this corrects the address;
   * it is not a step the reader took. Before the arrival rule, so that when
   * that rule puts the reader back in the chat they left, its write is the
   * later of the two.
   *
   * **Only while the address still says Chat** (`modeNow`). A press on a
   * Learn row writes `mode=learn` and that conversation's id together,
   * and this band can render once more before it is unmounted: without the
   * check it cleared the id the press had just written.
   */
  useEffect(() => {
    if (kind !== "chat" || modeNow !== "chat" || !loaded || thread === null) return;
    if (everyThread.some((t) => t.id === thread && !openableInChat(t.kind))) {
      void setThread(null, { history: "replace" });
    }
  }, [kind, modeNow, loaded, thread, everyThread, setThread]);

  /**
   * **A filter whose source this article has no conversation from becomes
   * All**, by replace, once the list has answered (the plan review's F6). The
   * panel already reads such a choice as All; this keeps the address from
   * holding a word that would start narrowing the list later, unasked.
   */
  useEffect(() => {
    if (kind !== "chat" || !loaded || loadFailed || from === null) return;
    if (!sourcesIn(listed).includes(from)) void setFrom(null, { history: "replace" });
  }, [kind, loaded, loadFailed, from, listed, setFrom]);

  useEffect(() => {
    if (learning || !loaded) return;
    if (!arrived.current) {
      arrived.current = true;
      const was = drafts.destination();
      if (!started.current && !loadFailed && everyThread.some((t) => t.id === thread && !openableInChat(t.kind))) {
        /* A known non-chat URL means the list, even if this tab left words in
           another chat. Stored chats already have a selectable row. Recover
           a missing draft as a row too, without selecting it or sending it. */
        if (was && !threads.some((t) => t.id === was)
          && ((drafts.thread(was) ?? "").trim() !== "" || drafts.origin(was))
          && (drafts.isFresh(was) || drafts.origin(was))) {
          const id = drafts.isFresh(was) ? begin(kind) : begin(kind, was);
          if (id !== was) {
            drafts.markFresh(id);
            drafts.moveThread(was, id);
          }
          drafts.setDestination(id);
          heldOnList.current = id;
        }
      } else if (!started.current && was && drafts.origin(was) && !everyThread.some((t) => t.id === was)
        && !threads.some((t) => t.id === thread)
        && (!drafts.isFresh(was) || loadFailed)) {
        /* A submitted first turn may have landed without acknowledgement.
           Resume its exact id, never mint another: a later Send will join
           that history if it exists and resend the identical origin. */
        started.current = true;
        begin(kind, was);
        void setThread(was, { history: "replace" });
        setFocusNonce((n) => n + 1);
      } else if (loadFailed || started.current || was === undefined) {
        /* Nothing to recover, or no ground to recover it on. */
      } else if (was === null) {
        if (drafts.list().trim() !== "") started.current = true;
      } else if ((drafts.thread(was) ?? "").trim() !== "" || drafts.origin(was) !== undefined) {
        if (threads.some((t) => t.id === thread)) {
          /* The reader's own choice. */
        } else if (threads.some((t) => t.id === was)) {
          /* This corrects the address; it is not a step the reader took. */
          void setThread(was, { history: "replace" });
        } else if (was === drafts.guide()) {
          /* The guide this tab began, gone with the band: begin it again
             under the same id, words and all — never as a chat (plan 261007j). */
          started.current = true;
          openGuide(true, was);
        } else if (drafts.isFresh(was)) {
          started.current = true;
          drafts.moveThread(was, startNew());
        }
      }
    }
    if (started.current) return;
    /* `listed`, not `threads`, since 2026-10-05: an article whose only
       conversations are Learn's has rows to show, and a blank chat begun
       over them would hide the list this visit was for. The box under the
       list and the + in the header still start one. */
    /* Nor when the guide has been talked to: its pinned row is something to
       show (plan 261007j). An empty guide is not. */
    if (listed.length === 0 && !(theGuide && theGuide.messages.length > 0)) {
      started.current = true;
      startNew();
    }
  }, [learning, loaded, loadFailed, threads, listed, everyThread, thread, setThread, startNew, drafts, begin, kind, theGuide, openGuide]);

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
    if (threads.some((t) => t.id === thread)) {
      heldOnList.current = null;
      drafts.setDestination(thread);
    } else if (!loadFailed && heldOnList.current === null) drafts.setDestination(null);
  }, [kind, loaded, loadFailed, threads, thread, drafts]);

  /**
   * **Learn has a conversation whenever it can have one** — on arrival with
   * none, and after Start over. No latch: there is no list to come back to and
   * no close button, so "nothing open" is never a state the reader asked for.
   * It cannot loop, because `begin` inserts its conversation on the spot.
   *
   * **Not while a delete is out** (`deleting`), and that is GPT Sol's P0 on
   * the plan, F1. The server folds a new Learn thread's first turn into the
   * article's existing one, so a question typed into a fresh conversation
   * before Start over's DELETE has landed would be appended to the very thread
   * the DELETE then removes. With nothing begun there is no composer, so there
   * is nowhere to type it. A refused delete puts the old conversation back
   * (`restoreOnFailure` in `onDelete` below), and then there is nothing to
   * begin.
   */
  useEffect(() => {
    if (!learning || !loaded || theLearn || deleting || resetting !== "idle") return;
    startNew();
  }, [learning, loaded, theLearn, deleting, resetting, startNew]);

  /* A failed DELETE restores the old thread; a successful one leaves none. In
     either case the operation retiring is what lets Learn draw again. */
  useEffect(() => {
    if (resetting !== "deleting" || deleting) return;
    resettingNow.current = false;
    setResetting("idle");
  }, [resetting, deleting]);
  /* Read, never written, and not a subscription — see `currentAt` in
     params.ts. It is passed to the model so that "this bit" and "what he just
     said" resolve to where the reader actually is. */
  const at = currentAt();

  /**
   * **Send `question` to the conversation `to`** — the panel's Send, with
   * `to`, and a handed-over question that sends on arrival, with the
   * conversation the handoff effect has just begun (which `to` does not
   * name until the next render).
   */
  const sendTo = (
    to: string | null,
    question: string,
    first?: ChatHandoffToChat,
    /* The kind of conversation `to` is, when this render cannot see it yet —
       a guide a handoff has just begun. Otherwise the open thread's own. */
    as?: ThreadKind,
  ): void => {
    if (resettingNow.current) return;
    // `send` returns the thread it went to, minted here when this is a new
    // conversation — so the URL can name it before the request lands.
    /* **The conversation's kind, never the band's** (GPT Sol's F2 on plan
       261007j): Chat's band opens the guide too, and a guide turn sent as
       `chat` would be refused (409) or answered with the wrong prompt. A new
       conversation (`to` names nothing yet) is the band's kind. The server
       refuses a kind that contradicts an existing thread rather than taking
       our word for it, so this being wrong is a 409 rather than a corrupted
       transcript. */
    const sendKind: ThreadKind = as ?? threads.find((t) => t.id === to)?.kind ?? kind;
    const origin = sendKind === "chat" ? pendingOrigin(to) : undefined;
    const id = send(to, question, at, {
      onThreadId: (corrected) => void setThread(corrected),
      ...((first || (origin && to)) ? {
        /* Data survives a mode change; URL navigation above does not. */
        onConfirmed: (confirmed: string) => {
          /* This is data too: the comment must learn the server's id even if
             the band has unmounted and its navigation callback was detached. */
          if (first && confirmed !== to) onHandoffThread?.(first, confirmed);
          /* Accepted residual (review CR-6, plan 261005i): this moves the
             draft's bookkeeping to a corrected id, but a band that was
             closed and reopened before `begin` arrived still addresses the
             guess. The server corrects a chat's id only when the guess
             equals an existing message id in this article (about one in a
             million), and then a follow-up from the reopened composer
             starts a separate conversation with no origin. The first
             conversation and its origin are intact. */
          if (origin && to && confirmed !== to) {
            drafts.moveThread(to, confirmed);
            if (drafts.destination() === to) drafts.setDestination(confirmed);
          }
          if (origin && to) drafts.clearOrigin(confirmed);
        },
      } : {}),
      kind: sendKind,
      /* The blocks on screen are a chat's alone: the server refuses them on
         any other kind (src/routes.ts). */
      ...(onScreen && sendKind === "chat" ? { visible: onScreen() } : {}),
      ...(origin ? { origin } : {}),
      ...(first?.anchor ? { anchor: first.anchor } : {}),
      ...(first?.sourceCommentId ? { sourceCommentId: first.sourceCommentId } : {}),
    });
    /* Something has now been sent to it, so it is no longer a conversation
       the arrival rule may begin again — whatever is typed into its box
       afterwards, and whether or not this write ever lands. */
    drafts.submitted(id);
    if (id !== to) void setThread(id);
  };
  sendToRef.current = sendTo;

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
      /* Learn is handed its one conversation and nothing else, so the panel
         has nothing it could list. */
      threads={learning ? (theLearn ? [theLearn] : []) : threads}
      /* Chat's list, its filter, and the way from a Learn row back to
         Learn. None of them for Learn, which has no list. */
      listed={kind === "chat" ? listed : undefined}
      from={kind === "chat" ? from : undefined}
      onFrom={kind === "chat" ? (next) => void setFrom(next) : undefined}
      /* **One navigation for all three**, so Back from Learn is one press
         and there is no entry on the stack that says Chat with a Recall
         conversation open. Pushed, as a press on the bar's Learn is.
         Learn's band would write its conversation's id itself; naming it
         here means the address is right from the first frame. */
      /* The guide's pinned row: Chat's alone, drawn whether or not the guide
         exists yet (plan 261007j). */
      guide={kind === "chat" ? { thread: theGuide, onOpen: () => void openGuide(true) } : undefined}
      onOpenLearn={kind === "chat" ? (view, id) => {
        setPendingLive(null);
        void setWhere({ mode: "learn", learn: view, thread: id }, { history: "push" });
      } : undefined}
      threadId={current}
      /* Open a conversation from the list, or close one back to it — chat's
         only, since Learn has neither. The panel calls this for a chat's
         row and `onOpenLearn` for a Learn row. */
      onThread={(id) => {
        heldOnList.current = null;
        drafts.setDestination(id);
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
         src/chat.ts stays chat | learn). Omitted here rather than refused
         by the server, so there is no button. */
      /* Nor on a conversation whose origin the server does not have yet
         (`awaitsOrigin` above): no button, and the callback is refused too. */
      /* Nor in the guide, which is typed (plan 261007j). */
      live={OFFERS_LIVE[kind] && openKind !== "guide" && !awaitsOrigin(current) ? live : undefined}
      onStartLive={!OFFERS_LIVE[kind] ? undefined : (id) => {
        if (resettingNow.current) return;
        if (awaitsOrigin(id)) return;
        if (id && threads.find((t) => t.id === id)?.kind === "guide") return;
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
      onSend={(question) => sendTo(current, question)}
      /* The box under the list. `null` rather than `thread` is the whole
         difference: it mints whatever `?thread=` still says, which on the list
         is either nothing, a conversation the fetch has not brought yet, or one
         that was closed and discarded. The nonce goes up for the same reason
         `startNew` raises it — this *is* a new conversation being started, and
         the reader who typed to start it should still have a caret when it
         opens, in the composer that has just replaced the one they typed into. */
      onSendNew={(question) => {
        if (resettingNow.current) return;
        heldOnList.current = null;
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
      canStartOver={learning && current !== null && settled(current)}
      onRename={rename}
      onDelete={(id) => {
        /* **Start over.** The conversation leaves the screen at once, and the
           fresh one is begun only when the server has answered — see the
           Learn effect above. If the server refuses, the old one comes back. */
        if (learning) {
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
           Learn's box as it is — a refused delete puts the conversation
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
      /* What was on screen goes with a chat's edit, as with its send, and with
         nothing else's. */
      onEdit={(messageId, question) =>
        current && edit(current, messageId, question, at, openKind === "chat" ? onScreen?.() : undefined)
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
