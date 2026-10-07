/**
 * The chat panel — a **mode**, in the column band between the spine and the
 * prose.
 *
 * Greg, 2026-08-25, on where it should go:
 *
 * > Can we have it as a panel on top of/replacing/instead of the middle columns
 * > (i.e. L1/L2/L3/etc, to the right of the spine, to the left of the article)?
 * > I'm thinking that this might be a common pattern, that when we switch into
 * > a mode (e.g. Chat, Glossary, etc) we'll want to keep the spine and article,
 * > but reuse the middle sections. In fact, the current "Table of Contents"
 * > middle sections are just such a mode that can be chosen from the bottom-bar
 * > (the default).
 *
 * That reframing is the design. The band between spine and prose is not "the
 * gist columns" any more, it is **whatever mode you are in**, and the table of
 * contents is the default one. So this file is not a special case bolted beside
 * the table; it is the second implementation of a slot, and the layout
 * arithmetic (layout.ts § modeWidth) knows about the slot rather than about
 * chat. See docs/plans/260826a-chat-mode.md.
 *
 * ## Why it is beside the article and not over it
 *
 * Because of the citations. Every claim carries a block id, and a block id is
 * only worth anything if pressing it puts you in front of the paragraph — which
 * a drawer over the article cannot do without closing itself first. Keeping the
 * article on screen is what makes the citation a reading aid rather than a
 * footnote.
 *
 * ## Markdown, and what is still deliberately absent
 *
 * The answers are plain paragraphs by instruction (the FORMAT section of the
 * prompt in src/converse.ts), and that has not changed. What changed on
 * 2026-08-31 is that the shapes the prompt already permits are now **drawn**:
 * before it, a short bullet list — which FORMAT allows in as many words —
 * arrived as one paragraph reading `- one - two - three`. Cited.tsx parses and
 * draws them, and docs/plans/chat-markdown.md says which shapes are read and,
 * more usefully, which are refused.
 *
 * **What has not changed is that none of it is HTML.** Rendering arbitrary
 * model output as markup is the one thing docs/project/security.md is about, so
 * every pass here returns runs of *string* handed to React, which escapes them.
 * The parsing is `mdast-util-from-markdown`'s — the tokenizer remark is built on,
 * which returns an AST and stops. What stays ours is the part no parser can do:
 * a block id has no syntax, it is matched by shape and checked against the
 * article; bare addresses are matched by the same code the server uses; and a
 * link is scheme-checked and prints its real host beside the model's label.
 * docs/plans/chat-markdown.md § The library, and why this one.
 *
 * Three things model syntax reaches that are not text nodes, all of them
 * constrained: the `href` of a link the model wrote, which is opt-in and
 * scheme-checked (Cited.tsx § links, docs/plans/260827ao-chat-web-links.md); an
 * ordered list's `start`, which is a number; and a heading's element name,
 * clamped to h4–h6.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  BookOpen,
  BookMarked,
  Check,
  ClipboardCheck,
  Compass,
  Copy,
  FileText,
  Globe,
  Library,
  Link2,
  LoaderCircle,
  type LucideIcon,
  MessageSquarePlus,
  Pencil,
  Pilcrow,
  RotateCcw,
  Search,
  SendHorizontal,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { withoutCommandLines } from "../citable.js";
import { worthRetrying } from "../messages.js";
import { splitHint } from "../recall-hint.js";
import { MODE_LABEL } from "../title-text.js";
import type {
  BlockId,
  ChatMessage,
  ChatThread,
  Citation,
  ThreadKind,
  ToolRun,
} from "../types.js";
import { isLearnKind } from "../types.js";
import { CitedMarkdown } from "./Cited.js";
import { GuideGreeting } from "./GuideGreeting.js";
import { Button } from "./components/ui/button.js";
import { useChatCommands } from "./CommandChip.js";
import { chipFor } from "./chat-commands.js";
import { holdTarget, roomNeeded } from "./chat-hold.js";
import { ModeSurface } from "./ModeSurface.js";
import { LearnSubModesAbout } from "./LearnAbout.js";
import { PassageLinks } from "./PassageLinks.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { LiveButton } from "./live/LiveButton.js";
import { LiveStatus } from "./live/LiveStatus.js";
import { LiveTail } from "./live/LiveTail.js";
import { liveSize } from "./live/tail.js";
import type { LiveApi } from "./live/useLiveConversation.js";
import { keepDictation } from "./dictation-keep.js";
import { useReaderTranscriber } from "./dictation-upload.js";
import { useCopy } from "./useCopy.js";
import { useDictationField } from "./useDictationField.js";
import { isHeldSendEnter, isImeComposing, isSendEnter } from "./key-chord.js";
import { ControlTip, TipNote, Tooltip } from "./Tooltip.js";
import {
  CHAT_FROM_LABEL,
  GUIDE_LABEL,
  type LearnConversationView,
  narrowed,
  sourcesIn,
  type ThreadSource,
  threadSource,
} from "./thread-source.js";
import { MODE_ICON } from "./mode-icons.js";
import type { ChatFrom } from "./params.js";
import { LEARN_SUB_MODES } from "./sub-modes.js";
import { usePressToggle } from "./usePressToggle.js";
import { withVoice } from "./voice.js";
import { hostOf, isWebUrl } from "../urls.js";
import { exactly, timeAgo } from "./relative-time.js";
import { useNow } from "./useNow.js";
import { useSlow } from "./useSlow.js";
import { putKeyboardAway } from "./useVisualViewport.js";
import { useRenderCount } from "./perf.js";
import { useMedia } from "./media.js";
import { chatDraftsFor } from "./chat-draft.js";
import { rowTitle } from "./chat-list-row.js";

interface Props {
  /**
   * **The conversations this panel may open.** `threadId` is resolved among
   * these and nowhere else. In Learn it is the one conversation; in Chat
   * it is the `chat`-kind ones, which since 2026-10-05 is fewer than the list
   * draws (`listed` below).
   */
  threads: ChatThread[];
  /**
   * **What Chat's list draws**: every conversation about the article but
   * Referee's Candidates, since 2026-10-05 (report `spya-hyfqkq`; plan
   * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md,
   * D5). Absent in Learn, which draws no list, and then the list is
   * `threads`.
   *
   * **A second set, and never merged into `threads`** (the plan review's F3).
   * A Recall conversation in `threads` would be opened here by a `?thread=`
   * carried over from Learn, under a composer that sends the blocks on
   * screen, which the server refuses on any kind but `chat`.
   */
  listed?: ChatThread[] | undefined;
  /** Which source the list is narrowed to (`?chatfrom=`); null or absent is All. */
  from?: ChatFrom | null | undefined;
  onFrom?: ((next: ChatFrom | null) => void) | undefined;
  /**
   * A press on a Learn row: go to that part of Learn, with its
   * conversation named. The band does it in one navigation. Without it a
   * Learn row is drawn and cannot be pressed.
   */
  onOpenLearn?: ((view: LearnConversationView, id: string) => void) | undefined;
  /**
   * **The guide's pinned row, Chat's alone** (plan 261007j): the article's one
   * guide, or `null` before there is one, and how to open it — the stored one
   * or one begun for the press. Drawn above the list and outside its source
   * filter (GPT Sol's F2), so it is there whatever `?chatfrom=` says and even
   * when no conversation is. Absent in Learn, which has no list.
   */
  guide?: { readonly thread: ChatThread | null; onOpen(): void } | undefined;
  /**
   * The live conversation, owned above this component.
   *
   * **Above, and not here**, because this panel is remounted every time the
   * reader switches conversation and a peer connection that a remount destroys
   * is a connection nothing owns. `ConversationBand` holds it, and it is the
   * same object for the life of the article.
   */
  live?: LiveApi | undefined;
  /** Null creates a chat; returning its id lets the panel carry the unsent draft with it. */
  onStartLive?: ((threadId: string | null) => string | undefined) | undefined;
  /** The open conversation, or null for the thread list. From `?thread=`. */
  threadId: string | null;
  onThread(id: string | null): void;
  /** The article, so dictation can be primed with this one's vocabulary. */
  slug: string;
  /**
   * Whether the conversations have been asked for and answered.
   *
   * It means "we have asked", not "it worked" — see `useChat`. What it is for
   * is one thing, and it is not display: **this is the panel's only way to tell
   * "no conversations" from "not asked yet"**, which look identical, and it
   * opens a conversation when there are none.
   *
   * It used to be load-bearing for a second reason, and is not any more: the
   * arriving list was written straight over whatever was on screen, so a
   * conversation minted before it landed was taken with it and the answer
   * streaming into that conversation then patched a row that was not there.
   * That is fixed where it belongs — the list now merges rather than replaces
   * (useChat.ts § `mergedArrival`), so waiting for the fetch is no longer what
   * keeps a new conversation alive.
   */
  loaded: boolean;
  /**
   * Did that fetch fail? `ChatApi.loadFailed`.
   *
   * `loaded` means *we have asked*, and on its own it turned the spinner below
   * straight into "Nothing asked yet." the moment a failing request gave up —
   * the same wrong claim the spinner was added to stop. GPT Sol, 2026-08-27.
   */
  loadFailed: boolean;
  onSend(question: string): void;
  onNew(): void;
  /**
   * The first question of a conversation that does not exist yet — the box
   * under the list.
   *
   * A separate call from `onSend`, and the separation is the safety. `onSend`
   * means *send to the open conversation*, and ConversationBand resolves that against
   * `?thread=` — which is not always null while the list is on screen, because
   * the panel decides between list and conversation with `threads.find`, and a
   * `?thread=` can name a conversation that has been discarded, or one the
   * fetch has not brought yet. Wiring the list's box to `onSend` appended the
   * reader's question to a stored conversation under a placeholder promising a
   * new one; GPT-5.6 found it, 2026-08-27. This one always mints.
   */
  onSendNew(question: string): void;
  /**
   * Forget a conversation nobody ever said anything in.
   *
   * Not the same call as `onDelete`, and the difference is that this one has
   * nothing to delete: an empty conversation exists only in this tab, because
   * nothing is written to disk until the first question is sent. So this is the
   * panel admitting the reader changed their mind, and it is why it takes no
   * confirmation — there is nothing to lose.
   */
  onDiscard(id: string): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  /**
   * **May Learn offer Start over now?** Only when its one conversation is
   * stored, named by the server and has nothing of this tab's in flight — see
   * `settled` in useChat.ts. Chat's delete ignores it.
   */
  canStartOver: boolean;
  /** Answer the last question again, over the top of the answer it has. */
  onRetry(messageId: string): void;
  /** Rewrite one of the reader's questions. Discards everything after it. */
  onEdit(messageId: string, question: string): void;
  /** Stop an answer that is still arriving. What has appeared is kept. */
  onStop(messageId: string): void;
  /**
   * **The reader opened a Recall answer's hint for the first time.** The band
   * records it (`openHint` in useChat.ts) so the hint is still open after a
   * reload. Optional: the hint opens on screen whether or not this is given,
   * and only Recall has hints.
   */
  onHintOpened?: ((messageId: string, hint: string) => void) | undefined;
  /** Jump to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
  /**
   * Answers whose stream the client has lost and is asking the server about.
   *
   * These rows are still `pending` and no words are arriving, so "thinking…"
   * would be a claim about the model that is not true. See `watch` in
   * src/web/useChat.ts.
   */
  recovering: Set<string>;
  /**
   * Every block this article has, id to its plain text.
   *
   * Two jobs in one map: a cited id that is not a key is not turned into a
   * link, and the text is what a chip's tooltip shows — so the reader can check
   * a citation without leaving the conversation, which is most of the point of
   * citing at all.
   */
  blocks: Map<string, string>;
  /**
   * Rises by one each time a *new* conversation is started; the composer takes
   * focus when it changes. See ConversationBand in App.tsx for why a counter, and why
   * opening an existing conversation deliberately does not do this.
   */
  focusNonce: number;
  /** A transport failure. Model failures live on the message that failed. */
  error: string | null;
  /**
   * Which mode this panel is being shown in — chat, or Learn.
   *
   * **One panel with a kind, not two panels.** Everything under here is the
   * same in both: the transcript, the scroll-follow, the citation chips, the
   * tool strip, the retry and the editor, the recovery of a lost stream. What
   * differs is the empty state, the composer's size, and one `<select>`. A
   * second component would have been a second copy of all of the first list in
   * order to vary the second — which is the duplication GPT Sol's review of
   * docs/plans/260827ah-review-mode.md (finding 9) said not to build.
   *
   * Only chat draws a list of conversations. It shows every one about the
   * article, Learn's included (`listed` above); Learn shows its own
   * one and no list.
   */
  kind: ThreadKind;
  /**
   * **The Recall | Tutorial | Explore | Quiz control**, when this panel is one of
   * Learn's conversation views. Absent in chat mode.
   *
   * A slot rather than a `subMode` value with a callback, because the control
   * belongs to `LearnBand` (src/web/App.tsx): the navigation rules behind it —
   * clearing `?thread=` in one step, Quiz winning a pasted collision — are
   * about two parameters this panel knows nothing about. Handing down a rendered
   * node keeps that knowledge where it is, and keeps `ChatPanel` unaware there
   * is a second sub-mode at all.
   */
  subMode?: React.ReactNode;
}

/**
 * What to ask, for a reader looking at an empty conversation.
 *
 * **Every one of these sends you back into the article.** That is the filter,
 * and it is why the most obvious suggestion — "summarise this" — is not here
 * and must not be added: it is the anti-goal
 * ([vision.md](../../docs/project/vision.md)) in a single click, and a chat
 * that opens by offering to replace the reading is not the feature that was
 * argued for in docs/plans/260826a-chat-mode.md.
 *
 * They are borrowed rather than invented. Greg, 2026-08-26: *"borrow ideas from
 * docs/project/original-version/ for suggestions for the user about what to use
 * the Chat for."* Each traces to something that project built or that ours has
 * already planned:
 *
 *  - **Where is it argued** — their criterion highlighting, where the reader
 *    types a criterion in plain words (*"arguments supporting the main thesis"*,
 *    *"statistical evidence"*) and the model marks the passages that match.
 *    original-version/highlighting.md. Here the block ids do the marking.
 *  - **Evidence or assertion** — the same tool, pointed at the distinction it
 *    was most useful for.
 *  - **What it assumes you know** — their glossary: *"the terms this piece uses
 *    in a non-obvious way, defined from the piece itself"*.
 *    original-version/glossary.md, and vision.md's own author's-glossary entry.
 *  - **What the author does not say** — vision.md's *argument view*: "claims,
 *    the support offered for each, and **the moves the author doesn't make**".
 *    The one on this list nothing else in the app can do.
 *  - **Check my understanding** — vision.md's *recall*: "a few durable
 *    questions generated from what the reader actually dwelt on". A reader who
 *    can answer has read it; a reader who cannot has just found out cheaply.
 *
 * The label is what the button says; the `ask` is what is sent, verbatim, so
 * the conversation reads as though the reader typed it. Clicking sends rather
 * than filling the box: these are complete questions, and an extra press to
 * confirm a thing you just chose is a step that buys nothing.
 */
export const SUGGESTIONS: { label: string; ask: string }[] = [
  {
    label: "Where is the main claim argued?",
    ask: "What is the central claim of this piece, and which paragraphs actually argue for it?",
  },
  {
    label: "Evidence or assertion?",
    ask: "Which parts of this article offer real evidence, and which are asserted without support?",
  },
  {
    label: "What does it assume I know?",
    ask: "What terms, people or debates does this piece assume I already know? Define them as this article uses them.",
  },
  {
    label: "What does the author not say?",
    ask: "What obvious objection or counter-argument does the author never address?",
  },
  {
    label: "Check my understanding",
    ask: "Ask me two questions that would show whether I have followed the argument so far. Don't answer them.",
  },
  /* The sixth, added 2026-08-26 with the tools. It is here for a reason the
     other five are not: **nothing else on screen says chat can now search the
     reader's own library.** A capability nobody knows about is a capability
     nobody uses, and a suggestion is the cheapest way to be told.

     It passes the same filter the others do — it sends the reader back into
     reading, and it is the one suggestion here that sends them into a *different*
     piece. It can legitimately come back with "nothing", which is a fine answer
     on a shelf of three articles and the reason the wording asks rather than
     promises. docs/project/chat-tools.md. */
  {
    label: "What else have I read about this?",
    ask: "Search my library: have I read anything else that bears on this article's main argument? If not, say so plainly.",
  },
];

export function ChatPanel({
  slug,
  loaded,
  loadFailed,
  threads,
  listed,
  from,
  onFrom,
  onOpenLearn,
  guide,
  threadId,
  onThread,
  onSend,
  onNew,
  onSendNew,
  onDiscard,
  onRename,
  onDelete,
  canStartOver,
  onRetry,
  onEdit,
  onStop,
  onHintOpened,
  onJump,
  recovering,
  blocks,
  focusNonce,
  error,
  kind,
  subMode,
  live,
  onStartLive,
}: Props) {
  useRenderCount("ChatPanel");
  /* **Learn's layout, for all three of its conversations** — Recall,
     Tutorial and Explore are each one thread per article, dictated into a tall
     box, with no list (`LEARN_KINDS`, src/types.ts). What differs between them
     is words, decided per kind below. */
  const learn = isLearnKind(kind);
  /* Among `threads`, never among `listed`: what the list draws and what may
     be open here are two sets (Props § `listed`). */
  const open = threads.find((t) => t.id === threadId) ?? null;
  /** What the list draws. */
  const rows = listed ?? threads;
  // A stopped session retains recovery text. It must never appear in a different thread.
  const shownLive: LiveApi | undefined = live && (live.threadId === open?.id || !live.threadId)
    ? live
    : live ? { ...live, phase: "idle", step: null, error: null, lines: [], tools: [], pointers: [],
      pendingTools: [], deviceLabel: null, notice: null, placement: null, playbackBlocked: false, hasUnsavedLines: false,
      hearing: false, speaking: false, thinking: false, threadId: null, reconnecting: false,
      measuringInput: false, quietInput: false, stall: null } : undefined;

  /**
   * What the reader has typed and not sent yet: per conversation in chat, per
   * kind in Learn, and one more for the box under chat's list.
   *
   * Above the composer because two different things need it, and neither is
   * the composer. Switching conversation used to carry the half-typed question
   * across into the next one, because the composer kept it in its own state
   * and nothing remounted it; and closing an empty conversation has to know
   * whether there was anything in the box before it throws the conversation
   * away.
   *
   * **And not in this panel either, since 2026-10-04.** It was a ref here, and
   * a ref goes when the reader switches mode, so a question typed and not sent
   * was gone on the way back with nothing said. It is the article's store now
   * (src/web/chat-draft.ts), which lives as long as the page —
   * docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md.
   * Still not state: nothing above the composer renders from it, and state
   * would repaint the whole transcript on every keystroke. The composer is
   * keyed by thread id, so it reads this once on mount and owns the value from
   * then on.
   *
   * Two limits worth knowing rather than discovering. It is memory and nothing
   * else, so a reload or a closed tab takes it. And chat's is keyed by thread
   * id, so on the rare occasion the server overrules an optimistic thread id
   * (`begin` in useChat.ts — a collision, or an id somebody typed into the
   * URL) the composer remounts under the new id and the draft, the scroll
   * position and the caret are lost with it.
   */
  const drafts = chatDraftsFor(slug);

  /**
   * The draft a keyed composer should adopt on mount.
   *
   * A lookup during render and never a write: React may abandon a render, so
   * mutating the store here would let an uncommitted tree change what the
   * committed panel reads. The composer owns the returned value from mount
   * onwards and writes every reader edit back, including Escape's empty string
   * — so a question handed over from another mode, which the band writes into
   * the store once (`ChatHandoff` in ConversationModes.tsx), does not come
   * back after the reader has cleared it.
   *
   * **Learn's is by kind, not by id.** Recall, Tutorial and Explore are each
   * one conversation per article and the band decides which conversation that
   * is — it can be a different one on the way back, when a stored one has
   * arrived or Start over has begun another — so the words go to whichever it
   * picked. GPT Sol's review of the plan above, F4.
   */
  const draftFor = (id: string): string =>
    isLearnKind(kind) ? drafts.learn(kind) : (drafts.thread(id) ?? "");
  const setDraftFor = (id: string, text: string): void => {
    if (isLearnKind(kind)) drafts.setLearn(kind, text);
    else drafts.setThread(id, text);
  };

  /**
   * The highest `focusNonce` the composer has already acted on.
   *
   * Lives here, above the keyed composer, precisely because it has to survive
   * the composer being remounted. Keying the conversation by thread id is what
   * gives each one its own draft — and it also means a plain "open the
   * conversation I was in yesterday" mounts a fresh composer, which would take
   * the caret on the strength of a nonce raised minutes ago for a different
   * conversation. Focus in the textarea turns the article's ↑/↓ into caret
   * movement, so taking it uninvited is not cosmetic.
   *
   * It defeats a remount caused by the reader changing conversation, which is
   * the one that happens. It does not defeat a remount caused by the *same*
   * conversation being renamed underneath it — see `drafts` above — where the
   * nonce is already spent and the caret is lost.
   */
  const focused = useRef(0);

  /**
   * The same two things again, for the box under the thread list.
   *
   * Its draft is the store's `list`, apart from the per-conversation ones: it
   * belongs to no conversation — that is the whole point of the box — so there
   * is no id to key it by; a question typed there and abandoned for a row in
   * the list, or for another mode, is still there when you come back. And the
   * nonce counter has to be a *different* counter from `focused`, because
   * spending the panel's one here would leave the real composer unfocused the
   * next time a new conversation was started.
   */
  const listFocused = useRef(0);

  /**
   * Leave the open conversation, discarding it if it never became one.
   *
   * Greg, 2026-08-26: *"If I start a new conversation and then close it, it
   * shouldn't store unless there was at least some text in the input box."*
   *
   * So the test is both halves: no messages **and** an empty box. A draft is
   * enough to keep it, because the draft lives under the conversation's id and
   * throwing the conversation away would take the reader's unsent words off the
   * screen with it — which is the one outcome worse than a stray "New chat" in
   * the list. The words outlive a mode change but not a reload, and a kept
   * conversation outlives a mode change only if it is the one the reader was
   * in when they left: one closed here with words in it, and then left for
   * another conversation or for the list, goes with the band and takes its
   * words with it. See `drafts` above, and § Deliberately not built in
   * docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md.
   */
  const leave = async () => {
    // A new spoken thread has no chat rows until its first exchange is flushed.
    if (open && live?.threadId === open.id && live.phase !== "idle" && live.phase !== "failed") {
      await live.stop();
    }
    const unsavedSpeech = live?.threadId === open?.id && (live?.lines.length ?? 0) > 0;
    if (open && !unsavedSpeech && open.messages.length === 0 && draftFor(open.id).trim() === "") {
      drafts.dropThread(open.id);
      onDiscard(open.id);
    }
    onThread(null);
  };

  return (
    /* `mode-band` is the slot — fixed between the spine and the prose, and
       shared with the glossary. `chat` is a hook for anything only this panel
       wants; see § mode band in styles.css. */
    <ModeSurface
      feature={`chat${learn ? " learn" : ""}`}
      /* Learn's Recall half is this same panel, so its (i) says Learn's words. */
      mode={learn ? "learn" : "chat"}
      /* …and then its visible parts, a line each (spya-usyhwy). */
      about={
        learn ? (
          <LearnSubModesAbout
            current={kind === "tutorial" ? "tutorial" : kind === "explore" ? "explore" : "recall"}
          />
        ) : undefined
      }
      label={
        kind === "tutorial"
          ? "A tutorial on this article"
          : kind === "explore"
            ? "Explore what you think about this article"
            : learn
            ? "Recall what you took from this article"
            : "Chat about this article"
      }
      head={
        <>
          {/* **The header says the mode's name** (Learn; Remember until 2026-10-05), never the thread's title: there
              is one Learn conversation per article, so the title names
              nothing the reader could mistake it for — and it is their first
              sixty characters, often "Um, so…". Plan 261001m § 4. */}
          {/* **Read out, not drawn, beside the sub-mode chips.** Four chips left
              the word one letter wide in a narrow band (the browser pass on
              261003l), and the Dock already says which mode this is — the
              reason Quiz's own row dropped its name on 2026-09-05. */}
          <h2 className={learn && subMode ? "sr-only" : undefined}>
            {learn ? (
              MODE_LABEL.learn
            ) : open?.kind === "guide" ? (
              /* One per article, so its name rather than its first question. */
              GUIDE_LABEL
            ) : open ? (
              /* The title is the reader's first question, or their rename. */
              <span className="chat-head-title">{open.title}</span>
            ) : (
              "Chat"
            )}
          </h2>
          {subMode}
          {learn ? (
            /* **Start over, and nothing else.** No close, because there is no
               list to go back to; no new, because there is one Learn
               conversation; no rename, which only the list offered. The same
               two-press delete chat has, relabelled for what it does here —
               the band first finishes Live, then begins the fresh conversation
               once the server has confirmed the delete. **Not rendered at all**
               until the conversation is stored and settled (`canStartOver`):
               an empty one has nothing to start over from, and one still being
               answered or not yet named by the server would need a DELETE held
               for a name. Plan 261001m § 4 and F1. */
            open && canStartOver && (
              <ArmedDelete
                key={open.id}
                onDelete={() => onDelete(open.id)}
                title="Start over — delete this conversation"
                armedTitle="Press again to delete this conversation and start over"
              />
            )
          ) : open ? (
            <>
              {/* The same delete the list offers, where the reader actually is.
                  Greg, 2026-08-26: *"Also add a Delete button within a chat."*
                  Asking twice rather than once, unlike the list — see
                  ArmedDelete — because in here the whole conversation is on the
                  screen and there is nothing to put it back. */}
              <ArmedDelete key={open.id} onDelete={() => onDelete(open.id)} />
              <button type="button" className="chat-icon" title="All conversations" onClick={() => void leave()}>
                <X size={14} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="chat-icon"
              title="Start a new conversation"
              onClick={onNew}
            >
              <MessageSquarePlus size={14} />
            </button>
          )}
        </>
      }
    >
      {/* **No `foot`, and that is the documented exception.** Chat's composer
          is built deep inside `Conversation`, which owns the scroller ref, the
          stick-to-bottom logic and the draft, and returns the transcript and
          the composer as one fragment — so `Conversation` goes into `children`
          whole rather than being cut in half to fill a slot.
          § There is a `foot` slot, in
          docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md */}
      {error && <p className="chat-error">{error}</p>}

      {open ? (
        <Conversation
          /* Keyed, so that switching conversation gets a fresh transcript and a
             fresh composer rather than the previous one's scroll position, open
             editor and half-typed question. */
          key={open.id}
          slug={slug}
          thread={open}
          onJump={onJump}
          recovering={recovering}
          blocks={blocks}
          onSend={onSend}
          onSubmitStarted={open.kind === "chat" ? () => drafts.submitted(open.id) : undefined}
          onRetry={onRetry}
          onEdit={onEdit}
          onStop={onStop}
          onHintOpened={onHintOpened}
          focusNonce={focusNonce}
          focused={focused}
          draft={draftFor(open.id)}
          onDraft={(text) => setDraftFor(open.id, text)}
          /* The OPEN conversation's kind, not the mode's. Each mode opens only
             its own kind (plan 261001m; Chat lists the others since 2026-10-05
             and still does not open them), so the two agree on every path the
             band takes; reading the thread is still the honest source. */
          kind={open.kind}
          live={shownLive}
          onStartLive={onStartLive ? () => onStartLive(open.id) : undefined}
        />
      ) : learn ? (
        /* **Learn never draws a list, not even for a frame.** The band
           derives its one conversation during render (ConversationBand), so
           this is reached only before the first fetch lands, in the beat before
           an empty band begins its conversation, and while Start over's DELETE
           is out — and in none of them is there anywhere for a question to go.
           Plan 261001m, F1 and F6. */
        <ChatListLoading what={`your ${MODE_LABEL.learn} conversation`} />
      ) : rows.length === 0 && !loaded ? (
        /* **Not the empty list, which is a claim we cannot make yet.** On a
           slow connection the first fetch takes seconds, and for all of them
           the panel used to say "Nothing asked yet." to a reader who knew
           perfectly well that they had asked things — then replaced it with the
           conversations when the request landed. Greg, 2026-08-27: *"it
           initially told me there were no chats (even though I knew there
           were)! … Better to show a loading spinner when loading, rather than
           default to the empty/initial state (which is wrong and worrying)."*

           `threads.length === 0` as well as `!loaded`, because a list can have
           something in it before the fetch lands — press `+`, type a draft,
           close it, and `leave` keeps that conversation. Showing a spinner over
           the reader's own conversation would be its own lie.

           Behind `useSlow`, so a fetch that finishes in 40ms draws nothing at
           all. A spinner that flashes and vanishes reads as breakage, and
           empty-until-slow is what App.tsx does for the article itself —
           useSlow.ts, and docs/project/web-client.md § Empty is not the same as
           not asked yet. */
        <ChatListLoading />
      ) : rows.length === 0 && loadFailed ? (
        /* And the state one beat later. `loaded` means "we have asked", so a
           request that gave up used to drop out of the spinner and into
           "Nothing asked yet." — the identical false claim, arrived at from the
           other side. GPT Sol found it reviewing the fix above, 2026-08-27.

           The transport error is printed above this by `chat-error`, so this
           line does not repeat it; what it does is refuse to make the claim.

           It also does not promise the conversations survived. This fires on
           any failure `readJson` throws — a 500, a non-JSON 200, a dropped
           connection — and only the last of those is evidence about the server
           at all. GPT Sol's third finding, on the same review. See `loadFailed`
           in Props. */
        <div className="chat-empty">
          <p>Couldn't load your conversations. Reload to try again.</p>
        </div>
      ) : (
        <>
          <ThreadList
            threads={rows}
            guide={guide}
            from={from ?? null}
            onFrom={onFrom}
            onOpen={onThread}
            onOpenLearn={onOpenLearn}
            onNew={onNew}
            onRename={onRename}
            onDelete={onDelete}
          />
          {/* The list's own composer. Typing here and pressing Enter starts a
              conversation and sends the question into it in one go, which is
              what the reader was going to do with the + button and then the box
              anyway. Greg, 2026-08-27: *"add a text input box at the bottom
              that (when a message is input) automatically starts a new chat, to
              save the user a click."*

              **`onSendNew`, not `onSend`, and the guard is about the fetch
              rather than about the URL.** Two reviews on 2026-08-27 went at
              this, and both findings were the same shape: *the list being on
              screen does not mean what it looks like it means.* The panel
              decides between list and conversation with `threads.find`, so the
              list is also what a reader sees while the first fetch is in
              flight, and `?thread=` can still name a conversation — one from a
              bookmark that has not arrived, or one that was closed and
              discarded. `onSend` resolves against exactly that id, so the box
              wired to it would have appended the question to a stored
              conversation under a placeholder promising a new one.
              `onSendNew` mints whatever the URL says, which is the only thing
              this box ever means.

              `loaded` avoids offering a new conversation before the list has
              arrived. Once loaded, an empty list gets the composer too: after
              closing an unused thread, Live must still be available to begin
              the first spoken conversation. `mergedArrival` in useChat already
              protects newly created threads from an older fetch response.

              `focusNonce={0}` on purpose: this box must never take the caret.
              The nonce is for a reader who has just *asked* for somewhere to
              type, and arriving at a list is not that — a focused textarea
              turns the article's ↑/↓ into caret movement, and nothing on screen
              would say why. See `focusNonce` in Props. */}
          {loaded && (
            <Composer
              slug={slug}
              onSend={onSendNew}
              busy={false}
              focusNonce={0}
              focused={listFocused}
              draft={drafts.list()}
              onDraft={(text) => drafts.setList(text)}
              placeholder="Ask something new…"
              kind={kind}
              live={kind === "chat" ? shownLive : undefined}
              onStartLive={kind === "chat" && onStartLive ? () => {
                const id = onStartLive(null);
                if (id) {
                  drafts.setThread(id, drafts.list());
                  drafts.setList("");
                }
              } : undefined}
            />
          )}
        </>
      )}
    </ModeSurface>
  );
}

/**
 * Delete, but only if you say so twice.
 *
 * One press arms it — the icon turns red and its tooltip changes to say what
 * the next press will do — and a second press within a few seconds deletes.
 * Not a `window.confirm`, which blocks the tab and cannot be styled, and not an
 * Undo strip like the shelf's, because a deleted conversation is really gone
 * rather than archived and there would be nothing to put back.
 *
 * **Deliberately stricter than the same button on the list.** There, the row is
 * one of several and its title is right beside the mouse; here, the thing you
 * are about to destroy is the page you are reading, and a single stray click
 * takes an hour of argument with it.
 *
 * The timeout disarms it, so a button left red on a panel nobody has touched
 * for a minute cannot be pressed by accident later. Mounted with `key={id}`, so
 * changing conversation gives it a fresh unarmed one.
 */
function ArmedDelete({
  onDelete,
  title = "Delete this conversation",
  armedTitle = "Press again to delete this conversation",
}: {
  onDelete(): void;
  /** What the button says at rest, and once armed. Learn calls it Start over. */
  title?: string;
  armedTitle?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), DISARM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={`chat-icon danger${armed ? " armed" : ""}`}
      title={armed ? armedTitle : title}
      onClick={() => (armed ? onDelete() : setArmed(true))}
    >
      <Trash2 size={14} />
    </button>
  );
}

/** Where Learn's composer turns compact — see `short` in `Composer`. */
const SHORT_VIEWPORT = "(max-height: 500px)";

/**
 * **The composer's floor and roof**: the rows it rests at, and the height in
 * px it may grow to with what is typed or dictated.
 *
 * Chat is one row growing to 160px — a question is a sentence. Learn is six
 * rows growing to 360px: a spoken Learn turn is a paragraph or three, and a
 * box that stops at 160px turns the reader's own words into a four-line
 * scrolling window they cannot read back before sending. On a short viewport
 * Learn rests at two rows and grows to 30% of the viewport, so the
 * transcript stays in view. 45% was the first figure, and at 844×390 a
 * six-line answer left one clipped line of transcript above the box (browser
 * check, 2026-10-01). Plan 261001m § 5.
 */
function boxSize(learn: boolean, short: boolean): { rows: number; roof: () => number } {
  if (!learn) return { rows: 1, roof: () => 160 };
  if (!short) return { rows: 6, roof: () => 360 };
  return { rows: 2, roof: () => Math.round(window.innerHeight * 0.3) };
}

/** How long an armed delete stays armed. */
const DISARM_MS = 4000;

/**
 * What the panel shows instead of an empty list while the first fetch is out.
 *
 * Nothing for the first `SLOW_AFTER_MS`, then a spinner and a sentence naming
 * what is being waited for — the rule in useSlow.ts, and the same shape
 * CommentDialog and JobProgress use. It says "your conversations" rather than
 * "Loading…" because the reader is waiting for a specific thing and the
 * sentence is free.
 *
 * Deliberately renders the empty `div` rather than `null` in the fast case, so
 * the panel does not change height when the spinner appears.
 */
function ChatListLoading({ what = "your conversations" }: { what?: string }) {
  const slow = useSlow(true);
  /* `role="status"`, because the words arrive 600ms after the panel does and a
     line that simply appears is silent to a screen reader. Polite by
     definition, so the reader is told when they next pause rather than
     interrupted. GPT Sol, 2026-08-27. */
  return (
    <div className="chat-loading" role="status">
      {slow && (
        <>
          <LoaderCircle className="cmt-spinner" size={13} />
          <span>Fetching {what}…</span>
        </>
      )}
    </div>
  );
}

/**
 * Every conversation about this article, most recently used first.
 *
 * **Every one, since 2026-10-05**: Recall's, Tutorial's and Explore's as well
 * as the chats, each with an icon at its head for where it came from, and a
 * filter above them when they came from more than one place. It showed only
 * chats from 2026-10-01 (plan 261001m) until report `spya-hyfqkq` asked for
 * all of them; plan
 * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md,
 * D5. Referee's Candidates thread is never here.
 *
 * By `updatedAt`, not `createdAt`: coming back to an article you were arguing
 * with yesterday, the thread you want is the one you were last in, and it may
 * well be the oldest one you started.
 *
 * ## Why a row is three lines rather than one
 *
 * Greg, 2026-08-26: *"add more metadata about the chats (even if it makes each
 * row multi-line), with a slightly longer title, hover-tooltip, recency (e.g.
 * '3d ago')."*
 *
 * A one-line row said the title and a bare number, and the title is the first
 * thing you typed — which, days later, is often the least useful sentence in
 * the conversation. So the row now says where the conversation *got to* (the
 * last thing said in it) and when you were last in it, and the title is allowed
 * to wrap to two lines instead of being cut at the width of the panel. The
 * exact timestamps stay in the row's tooltip, which is the rule the shelf
 * follows too — see relative-time.ts.
 */
function ThreadList({
  threads,
  guide,
  from,
  onFrom,
  onOpen,
  onOpenLearn,
  onNew,
  onRename,
  onDelete,
}: {
  threads: ChatThread[];
  guide?: { readonly thread: ChatThread | null; onOpen(): void } | undefined;
  from: ChatFrom | null;
  onFrom?: ((next: ChatFrom | null) => void) | undefined;
  onOpen(id: string): void;
  onOpenLearn?: ((view: LearnConversationView, id: string) => void) | undefined;
  onNew(): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  /* Read once here and passed to every row, so two rows a minute apart in the
     same paint cannot disagree about what "now" is. useNow.ts § why. */
  const now = useNow();

  /* **The guide, pinned**: above the filter and every row, never narrowed by
     it, and drawn whether or not it exists yet (plan 261007j, GPT Sol's F2). */
  const pinned = guide && <GuideRow guide={guide} now={now} />;

  if (threads.length === 0) {
    return (
      <>
      {pinned}
      <div className="chat-empty">
        <p>Nothing asked yet.</p>
        <p className="chat-empty-hint">
          Ask about anything in the article and the answer will point back at the paragraphs it came from — press one to go there.
        </p>
        <button type="button" className="chat-new" onClick={onNew}>
          <MessageSquarePlus size={14} /> New conversation
        </button>
      </div>
      </>
    );
  }

  /* **The filter**, drawn only when there is something to choose between. A
     choice this list has no conversation from reads as All, so a stale
     `?chatfrom=` can never leave an empty list with no control on screen to
     explain it; the band replaces the parameter too (`ConversationBand`). */
  const sources = sourcesIn(threads);
  const chosen = from !== null && sources.includes(from) ? from : null;
  const sorted = narrowed(threads, chosen).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  /* One slot at the head of every row when any row has an icon, so the titles
     of the rows without one still start on the same line down the list. */
  /* The pinned guide always has one, so its title lines up with theirs. */
  const anySource = guide !== undefined || threads.some((t) => threadSource(t) !== null);

  return (
    <>
      {pinned}
      {sources.length > 1 && onFrom && (
        /* No `role="group"`, as Learn's chips have none (QuizPanel.tsx §
           `LearnSubModeToggle`): each button says what it is and whether
           it is pressed. Words, so no card. */
        <div className="chat-from">
          {([null, ...sources] as const).map((word) => (
            <button
              key={word ?? "all"}
              type="button"
              className={`chat-from-btn${chosen === word ? " on" : ""}`}
              aria-pressed={chosen === word}
              onClick={() => onFrom(word)}
            >
              {word === null ? "All" : CHAT_FROM_LABEL[word]}
            </button>
          ))}
        </div>
      )}
      <ol className="chat-threads">
        {sorted.map((t) => {
          const last = lastSaid(t);
          const source = threadSource(t);
          /* **A Learn row is a way back to Learn, not a conversation of
             this band's.** It is named for its part of Learn (its stored
             title is the first sixty characters said, often "Um, so…"), a
             press goes there, and it has no rename and no delete: Learn
             has one conversation per part and its delete is *Start over*,
             which lives there. Plan 261005i, D5. */
          const view = source?.learn;
          return (
            <li key={t.id}>
              {renaming === t.id ? (
                <RenameRow
                  initial={t.title}
                  onDone={(title) => {
                    if (title.trim() !== "") onRename(t.id, title.trim());
                    setRenaming(null);
                  }}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <div className="chat-thread" data-thread={t.id}>
                  {anySource && (
                    <span className="chat-thread-lead">
                      {source && <ThreadSourceMark source={source} />}
                    </span>
                  )}
                  <button
                    type="button"
                    className="chat-thread-open"
                    /* The title in full and the timestamps exactly — not the
                       preview line, which is a hint rather than something to read
                       here, and which the row has already cut. A `title` attribute
                       rather than the Tooltip component, because this one is plain
                       text over several lines and wants the browser's own delay:
                       a tooltip that appears the instant the pointer crosses a
                       list is a list you cannot read. A Learn row says first
                       where the press goes, since it leaves Chat. */
                    title={
                      view
                        ? `Open in ${MODE_LABEL.learn} › ${LEARN_SUB_MODES[view].label}\n${describe(t)}`
                        : describe(t)
                    }
                    onClick={() => (view ? onOpenLearn?.(view, t.id) : onOpen(t.id))}
                  >
                    {/* The first question in full where the stored title is only its
                        first sixty characters — chat-list-row.ts. */}
                    <span className="chat-thread-title">
                      {view ? LEARN_SUB_MODES[view].label : rowTitle(t)}
                    </span>
                    {/* Usually the model's reply, but the reader's question when
                        that was the last thing said — so the row says whose. */}
                    {last && (
                      <span
                        className={
                          last.role === "assistant" ? "chat-thread-last model" : "chat-thread-last you"
                        }
                      >
                        {last.text}
                      </span>
                    )}
                    <span className="chat-thread-meta">
                      {/* No kind tag in words: where a row came from is the icon
                          at its head (`ThreadSourceMark`). The list showed only
                          chats from 2026-10-01 (plan 261001m) until 2026-10-05,
                          when report spya-hyfqkq asked for every conversation
                          here, marked (plan 261005i, D5). */}
                      <span className="chat-thread-count">{turns(t)}</span>
                      {/* Recency, because the question a list of conversations
                          answers is "which was I in?". The exact time is in the
                          tooltip above. */}
                      <span className="chat-thread-when">{timeAgo(t.updatedAt, now) ?? "at some point"}</span>
                    </span>
                  </button>
                  {!view && (
                    <div className="chat-thread-actions">
                      <button
                        type="button"
                        className="chat-icon"
                        title="Rename this conversation"
                        onClick={() => setRenaming(t.id)}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className="chat-icon danger"
                        title="Delete this conversation"
                        onClick={() => onDelete(t.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * **The guide's row, pinned above Chat's list** (plan 261007j) — one per
 * article, so it is named for what it is, not for its first question, and it
 * wears an icon no mode has: `Compass` (docs/project/icons.md, one glyph one
 * meaning). Before the guide exists it says what it is for; after, where it
 * got to, as every row does. No rename and no delete here: it is not one of
 * many, and its delete is in its own header, as a chat's is.
 */
function GuideRow({
  guide,
  now,
}: {
  guide: { readonly thread: ChatThread | null; onOpen(): void };
  now: number;
}) {
  const t = guide.thread;
  const last = t ? lastSaid(t) : undefined;
  return (
    <div className="chat-guide" data-guide="">
      <span className="chat-thread-lead">
        <span className="chat-guide-mark">
          <Compass size={12} aria-hidden="true" />
        </span>
      </span>
      <button
        type="button"
        className="chat-thread-open"
        title={t && t.messages.length > 0 ? describe(t) : "Your guide to reading this piece, and to Spideryarn"}
        onClick={guide.onOpen}
      >
        <span className="chat-thread-title">{GUIDE_LABEL}</span>
        {last ? (
          <span className={last.role === "assistant" ? "chat-thread-last model" : "chat-thread-last you"}>
            {last.text}
          </span>
        ) : (
          <span className="chat-thread-last">How to read this piece, and where to start</span>
        )}
        {t && t.messages.length > 0 && (
          <span className="chat-thread-meta">
            <span className="chat-thread-count">{turns(t)}</span>
            <span className="chat-thread-when">{timeAgo(t.updatedAt, now) ?? "at some point"}</span>
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * **Where a row's conversation came from**: the source mode's own icon from
 * the bar (mode-icons.ts; docs/project/icons.md), with a card saying so and,
 * where the source has words, quoting them (`threadSource`,
 * src/web/thread-source.ts). Not drawn for a plain chat. Plan 261005i, D5.
 *
 * **It leads the row**, in a slot every row has when any row has an icon
 * (`chat-thread-lead`), so titles line up. Stage one drew it after the title,
 * when one row in many had one.
 *
 * A button, and the card is controlled (`usePressToggle`, as every band's (i)
 * is), so a finger's tap opens it and the keyboard can reach it; hover and
 * focus open it too. A sibling of the row's own button and not inside it, so
 * pressing the icon never opens the row, and the card and the row's `title`
 * are never both on screen. The quote takes the face of whoever wrote it:
 * the author's for the article's words, the reader's for an angle they typed
 * (`ThreadSource.voice`).
 */
function ThreadSourceMark({ source }: { source: ThreadSource }) {
  const { open, onOpenChange, trigger } = usePressToggle();
  /* A passage is not a mode and has no icon on the bar. */
  const Icon: LucideIcon = source.mode === null ? Pilcrow : MODE_ICON[source.mode];
  return (
    <Tooltip
      placement="top"
      open={open}
      onOpenChange={onOpenChange}
      content={
        <TipNote>
          {source.label}
          {source.quote !== undefined && (
            <span className={withVoice("chat-thread-source-quote", source.voice ?? "author")}>“{source.quote}”</span>
          )}
        </TipNote>
      }
    >
      <button
        type="button"
        className="chat-thread-source"
        aria-label={source.label}
        aria-expanded={open}
        {...trigger}
      >
        <Icon size={12} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/** `4 turns`, or `1 turn`. */
function turns(t: ChatThread): string {
  /* Turns, not messages: a reader counts exchanges, and the pending assistant
     row would otherwise make a conversation look one longer than it is while an
     answer arrives. */
  const n = Math.ceil(t.messages.length / 2);
  return n === 1 ? "1 turn" : `${n} turns`;
}

/** How much of the last thing said a row shows. One line at the panel's width. */
const LAST_MAX = 120;

/**
 * The last thing said in the conversation, for the second line of the row.
 *
 * The *title* is the reader's first question, which days later is often the
 * least useful sentence in the thread — it says what they went in wanting, not
 * what they came out with. This says where it got to.
 *
 * An answer still arriving has no text yet, so this falls back down the
 * messages rather than printing a blank line; if nothing has any text — a
 * conversation whose first answer has not started — it returns undefined and
 * the row simply has one line fewer.
 */
function lastSaid(t: ChatThread): { text: string; role: ChatMessage["role"] } | undefined {
  for (let i = t.messages.length - 1; i >= 0; i--) {
    const message = t.messages[i];
    const said = message?.text.replace(/\s+/g, " ").trim();
    if (message && said) {
      return { text: said.length > LAST_MAX ? `${said.slice(0, LAST_MAX)}…` : said, role: message.role };
    }
  }
  return undefined;
}

/**
 * The row's hover tooltip: the title in full, and the timestamps exactly.
 *
 * Newlines in a `title` attribute are honoured by every browser we care about,
 * and this is the one place the *exact* timestamps live — the row prints "3
 * days ago" because that is the question a reader is asking, and the tooltip
 * keeps the answer they occasionally need instead.
 */
function describe(t: ChatThread): string {
  const lines = [rowTitle(t), "", `Started ${exactly(t.createdAt) ?? "at some point"}`];
  /* Only worth a line of its own once the two differ. A conversation with one
     question in it would otherwise print the same timestamp twice. */
  if (t.updatedAt !== t.createdAt) lines.push(`Last message ${exactly(t.updatedAt) ?? "unknown"}`);
  lines.push(turns(t));
  return lines.join("\n");
}

function RenameRow({
  initial,
  onDone,
  onCancel,
}: {
  initial: string;
  onDone(title: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <div className="chat-thread renaming">
      <input
        ref={ref}
        className="chat-rename"
        /* Enter saves the name — see the handler below. */
        enterKeyHint="done"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Stopped here, not left to bubble: Escape reaches the drawer's
          // capture-phase listener otherwise (Dock.tsx), and Enter would
          // reach nothing but is worth being explicit about.
          e.stopPropagation();
          // After the stop, so a composing key is still contained: Enter that
          // accepts an input method's candidate is not a save, and its Escape
          // is not a cancel (key-chord.ts § isImeComposing).
          if (isImeComposing(e)) return;
          if (e.key === "Enter") onDone(value);
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="button" className="chat-icon" title="Save" onClick={() => onDone(value)}>
        <Check size={12} />
      </button>
      <button type="button" className="chat-icon" title="Cancel" onClick={onCancel}>
        <X size={12} />
      </button>
    </div>
  );
}

export function Conversation({
  slug,
  thread,
  onJump,
  recovering,
  blocks,
  onSend,
  onSubmitStarted,
  onRetry,
  onEdit,
  onStop,
  onHintOpened,
  focusNonce,
  focused,
  draft,
  onDraft,
  kind,
  visible = true,
  sized = "fixed",
  live,
  onStartLive,
}: {
  /** The article, so the composer's dictation can be primed with its vocabulary. */
  slug: string;
  thread: ChatThread;
  /** See `onHintOpened` in Props. Absent where nothing records the press. */
  onHintOpened?: ((messageId: string, hint: string) => void) | undefined;
  onJump(id: BlockId): void;
  /** See `recovering` in Props. */
  recovering: Set<string>;
  blocks: Map<string, string>;
  onSend(question: string): void;
  /** See Composer: submission begins before the awaited Live hang-up. */
  onSubmitStarted?: (() => void) | undefined;
  onRetry(messageId: string): void;
  onEdit(messageId: string, question: string): void;
  onStop(messageId: string): void;
  focusNonce: number;
  /** See `focused` in ChatPanel — it outlives this component on purpose. */
  focused: { current: number };
  /** Whatever was left in the box last time this conversation was open. */
  draft: string;
  onDraft(text: string): void;
  /**
   * **This conversation's** kind — see the call site in `ChatPanel`.
   *
   * Required rather than defaulted, so that a new caller has to decide which it
   * is rather than silently getting a chat.
   */
  kind: ThreadKind;
  /** A collapsed dialog keeps its conversation mounted, but hidden geometry
   * must not change whether the reader is following the latest answer. */
  visible?: boolean | undefined;
  /**
   * Whether the transcript's height is the panel's (`fixed`: the band, the
   * floating and docked dialog) or its own content's up to a cap (`content`:
   * the card in the Marginalia column). It decides whether a held answer may
   * be given room — § A streamed answer stays where it starts, below.
   */
  sized?: "fixed" | "content" | undefined;
  /** The live session bound to this conversation, if the panel offers one. */
  live?: LiveApi | undefined;
  onStartLive?: (() => void) | undefined;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const last = thread.messages.at(-1);
  const chars = last?.text.length ?? 0;
  const busy = last?.status === "pending";
  /**
   * Which question the reader is rewriting, if any.
   *
   * State here rather than inside each `Turn`, so that opening a second editor
   * closes the first. Two open at once is not a mode anybody wants and it makes
   * the "this will discard N turns" count below ambiguous about which N.
   */
  const [editing, setEditing] = useState<string | null>(null);
  /** Whether the reader has scrolled up, which is what shows the jump button. */
  const [away, setAway] = useState(false);

  /**
   * Follow new content down — but only if the reader is already at the bottom,
   * and **never a typed answer as it streams**: that is the hold, below. What
   * is left to follow is a Live conversation's spoken lines and their saved
   * turns.
   *
   * Scrolling up to re-read an earlier turn while the next one arrives is an
   * ordinary thing to do, and yanking the view back to the bottom every few
   * words would make it impossible. The 60px slack is for the fact that "at the
   * bottom" is never exact once a line is half-rendered.
   *
   * **`stick` changes only when the reader scrolls**, never when the content
   * grows, and that is the fix for a bug this had in its first version. It used
   * to be recomputed in a layout effect after every commit, which measures the
   * DOM *after* the new content is in it — so any commit that added more than
   * 60px at once decided the reader had scrolled away, when all that had
   * happened was the page getting taller under them. The commit that does that
   * routinely is the last one: `done` adds the action row and, if the model
   * searched, the whole source list. The reader was pinned to the bottom, the
   * answer finished, and from then on nothing followed anything — with no
   * "Latest" button either, because `away` was updated from a different effect
   * that the same commit did not trigger. One source now, and it is the only
   * event that means what it says. Found in review, 2026-08-26.
   */
  const stick = useRef(true);
  /**
   * `away` as this render saw it, so the effect below can leave it alone when
   * it is already clear. A same-value `setAway(false)` is not free — it does
   * not take React's eager bailout — so it queued a render per streamed word,
   * and an update left pending after every commit is what carried React's
   * nested-update counter to #185 in a buffered answer. Hygiene, not the fix:
   * that is the controller's notification window.
   * docs/postmortems/260915a-a-store-notified-per-frame-turns-a-buffered-stream-into-an-update-loop.md
   *
   * A ref and not a dependency, because the array below is the list of things
   * that mean "new text has been painted" and `away` is not one of them.
   */
  const awayNow = useRef(away);
  awayNow.current = away;
  /* **The live words are the end of the conversation too** (LiveTail, after
     the saved turns), so they count as content — an empty thread with a first
     spoken exchange arriving is not "empty" — and their growth is "new text
     has been painted". GPT Sol, plan review 261002j. */
  const liveLines = live?.lines ?? [];
  const liveChars = liveSize(liveLines);
  const empty = thread.messages.length === 0 && liveLines.length === 0;
  const toolsNow = (last?.tools ?? []).map((run) => run.status).join() + (last?.searches ?? "");
  /**
   * ## A streamed answer stays where it starts
   *
   * Greg, 2026-10-05: *"it immediately starts scrolling down so I can't read
   * from the beginning of the response. What I would prefer is if it streams
   * in, but stays in position."* So when an answer starts, the question is put
   * at the top of the panel **once**, and from then on nothing the stream does
   * moves the transcript. The reader starts at the first sentence, and it is
   * still there when they finish it. "Latest" appears when the answer outgrows
   * the panel, and one press of it jumps; it does not start following.
   *
   * - **Room.** A scroller cannot put its last item at the top unless a
   *   panel's height of content follows it, so `.chat-room` after the last
   *   turn is exactly that tall and shrinks as the answer grows into it.
   * - **The hold starts on a rising edge**: the last message *becoming*
   *   pending, or a different number of turns under a pending one. Not on the
   *   message's id: Retry keeps the id, and the server's `begin` frame changes
   *   it in the middle of an answer.
   * - **Live ends it.** Spoken lines are heard rather than read from the top,
   *   and they arrive after the saved turns without changing the last message,
   *   so the first one retires the hold and its room in the same pass.
   * - **A card gets room only at its cap** (`sized`). Below it the card's
   *   height is its content's, and room would inflate it by most of a screen.
   *   A transcript that overflows is a card at its cap, where room is free.
   * - **Held on screen, not only left alone.** Not moving `scrollTop` is not
   *   enough: a tool row drawn above text already being read pushes it down a
   *   row, and a panel that grows taller (the "Latest" pill leaving, a
   *   shrinking composer) makes the browser clamp `scrollTop`. So the hold
   *   remembers where its anchor is **on screen** — the answer's words once
   *   there are any, the question until then — and puts it back. A reader's
   *   own scroll is told apart by its scroll event, which re-records.
   *
   * The arithmetic is chat-hold.ts; the plan, the measurement and GPT Sol's
   * review are docs/plans/261005f-a-streamed-answer-stays-where-it-starts.md.
   */
  const room = useRef<HTMLDivElement>(null);
  const hold = useRef<{
    /** How many turns there were when it started. */
    count: number;
    /** False until the question has been put in place, and again after the
     * panel was hidden, which loses a scroll position. */
    placed: boolean;
    /** The `scrollTop` it was placed at. */
    target: number;
    /** Whether the anchor is the answer's words, or still the question. */
    words: boolean;
    /** Where the anchor was on screen, from the scroller's top edge. */
    seenAt: number;
    /** The scroll position `settle` or the reader most recently chose. A later
     * scroll event at this same position came from our own write, not them. */
    top: number;
    /** The largest reachable `scrollTop` when `top` was recorded. A clamp is
     * only possible if this maximum has since fallen. */
    max: number;
  } | null>(null);
  /**
   * What a hold keeps still: the answer's first words once there are any, and
   * until then the question (or the waiting answer, when nothing was asked).
   */
  const anchorIn = (el: HTMLElement) => {
    const turns = el.querySelectorAll<HTMLElement>(":scope > [data-turn]");
    const answer = turns[turns.length - 1];
    if (!answer) return null;
    const before = turns[turns.length - 2];
    const question = before?.dataset.turn === "user" ? before : null;
    /* Explicit rather than "the first element after the tool strip": an
       unsupported CommonMark block is deliberately rendered as a bare text
       node, in which case querySelector would find the cursor at the END of
       the answer and hold that instead of its first line. */
    const first = answer.querySelector<HTMLElement>(":scope > .chat-answer-anchor");
    const words = first !== null;
    return { answer, question, words, node: first ?? question ?? answer };
  };
  /** Record where a held answer's anchor is now: the view was moved on purpose. */
  const noteAnchor = (el: HTMLElement) => {
    const h = hold.current;
    const at = h?.placed ? anchorIn(el) : null;
    if (!h || !at) return;
    h.words = at.words;
    h.seenAt = at.node.getBoundingClientRect().top - el.getBoundingClientRect().top;
    h.top = el.scrollTop;
    h.max = Math.max(0, el.scrollHeight - el.clientHeight);
  };
  const wasBusy = useRef(false);
  const sizedNow = useRef(sized);
  sizedNow.current = sized;
  /**
   * Size the room, place or compensate, and say whether there is more below.
   * Every read is before the first write, so a streamed word costs the one
   * layout it already did. Called by the effect and by the resize observer.
   */
  const settle = () => {
    const el = scroller.current;
    const gap = room.current;
    const h = hold.current;
    if (!el || !gap || !h) return;
    const at = anchorIn(el);
    if (!at) return;
    const edge = el.getBoundingClientRect().top;
    const was = el.scrollTop;
    const onScreen = (n: Element) => n.getBoundingClientRect().top - edge;
    const seen = onScreen(at.node);
    const client = el.clientHeight;
    const roomNow = gap.offsetHeight;
    const natural = el.scrollHeight - roomNow;
    const placing = !h.placed;
    let top = was;
    if (placing) {
      h.target = holdTarget({
        questionTop: at.question ? onScreen(at.question) + was : null,
        answerTop: onScreen(at.answer) + was,
        clientHeight: client,
        pad: Number.parseFloat(getComputedStyle(el).paddingTop) || 0,
      });
      top = h.target;
    } else if (h.words === at.words && h.seenAt < client) {
      /* Put the anchor back where it was. Only when it was on screen or above
         it: content arriving below what the reader is looking at is no reason
         to move them. */
      top = was + (seen - h.seenAt);
    }
    const roomy = sizedNow.current === "fixed" || natural > client + 1;
    /* Room for the placement, and for wherever the view is now: shrinking it
       must never clamp a reader who scrolled down into it. */
    const roomFor = (to: number) =>
      roomy ? roomNeeded({ target: to, clientHeight: client, naturalHeight: natural }) : 0;
    let want = roomFor(Math.max(h.target, top));
    /* Where it actually lands. A card below its cap has nowhere to scroll to,
       and a target it never reached must not ask for room later. */
    top = Math.max(0, Math.min(top, natural + want - client));
    if (placing) {
      h.target = top;
      h.placed = true;
      want = roomFor(top);
    }
    h.words = at.words;
    h.seenAt = seen + was - top;
    h.top = top;
    h.max = Math.max(0, natural + want - client);
    if (want !== roomNow) gap.style.height = `${want}px`;
    if (was !== top) el.scrollTop = top;
    /* Nobody scrolled, so no scroll event will say the answer has grown past
       the fold. Guarded, because a same-value set is not free: see `awayNow`. */
    const atBottom = natural + want - top - client < 60;
    if (awayNow.current !== !atBottom) setAway(!atBottom);
  };
  const settleNow = useRef(settle);
  settleNow.current = settle;

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run triggers — the effect reads refs, and these are what say "something has been painted"
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const count = thread.messages.length;
    const speaking = liveLines.length > 0;
    const h = hold.current;
    if (speaking || (h && !busy && h.count !== count)) {
      hold.current = null;
      if (room.current) room.current.style.height = "0px";
    } else if (busy && (!wasBusy.current || !h || h.count !== count)) {
      hold.current = {
        count,
        placed: false,
        target: 0,
        words: false,
        seenAt: 0,
        top: el.scrollTop,
        max: Math.max(0, el.scrollHeight - el.clientHeight),
      };
      /* A new typed attempt deliberately places the reader at the new latest
         turn. Its growing away from the bottom must not erase that follow
         intent: if Live speaks next, it still follows unless the reader has
         actually scrolled in the meantime. */
      stick.current = true;
    }
    wasBusy.current = busy;
    if (!visible) {
      /* A hidden panel has no scroll position to keep; place again when it
         comes back. */
      if (hold.current) hold.current.placed = false;
      return;
    }
    if (hold.current) {
      settle();
      return;
    }
    /* **An empty conversation reads from the top.** There is no latest turn to
       follow, and what is in the scroller is the opening hint and the
       suggestions, read top down. Following "the bottom" here scrolled a
       landscape phone's short band (207px of scroller, 308px of suggestions)
       past the hint and the first question on mount, so they looked clipped off
       the top of the band. Plan 261001n. */
    if (empty) el.scrollTop = 0;
    else if (stick.current) el.scrollTop = el.scrollHeight;
    /* And this half **only ever clears**, which is the whole discipline.
       Content growing must never decide the reader has scrolled away — that was
       the bug the note above describes. But content *shrinking* can strand a
       "Latest" button pointing at a bottom already on screen, and no scroll
       event need fire to say so: an edit that discards three turns can leave a
       transcript shorter than the panel, with nothing to scroll to and a pill
       offering to take you there. Seen in a browser pass, 2026-08-26. */
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) {
      stick.current = true;
      if (awayNow.current) setAway(false);
    }
    /* `last?.status` is in here for a reason that is easy to leave out and was:
       the frame that ends an answer usually changes neither the text nor the
       row count, while adding the action row and, if the model searched, the
       whole list of sources. Found by a GPT-5.6 review, 2026-08-26. `toolsNow`
       is the same kind of thing: a tool row starting or finishing changes the
       turn's height and none of the others. */
  }, [chars, thread.messages.length, last?.status, toolsNow, liveChars, liveLines.length, live?.hasUnsavedLines, live?.phase, visible, sized]);

  /* **The panel changing size is not a streamed word**, and the room depends
     on the panel's height: the "Latest" pill, a growing composer, a keyboard.
     jsdom has no `ResizeObserver`. */
  useEffect(() => {
    const el = scroller.current;
    if (!el || !visible || typeof ResizeObserver === "undefined") return;
    const seen = new ResizeObserver(() => {
      if (hold.current?.placed) settleNow.current();
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [visible]);

  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setAway(false);
    el.scrollTop = el.scrollHeight;
    /* Now, not when the scroll event arrives: a streamed word can land first,
       and would put a held answer back where it was. */
    noteAnchor(el);
  };

  return (
    <>
      <div
        className={`chat-scroll${busy ? " streaming" : ""}`}
        ref={scroller}
        /* The one event that can say the reader changed `stick` — see the note
           above. The browser fires it for our own scroll writes too, so a hold
           records its last chosen position and those events are ignored for
           follow intent. `away` still describes the geometry either way. */
        onScroll={(e) => {
          if (!visible) return;
          const el = e.currentTarget;
          /* An empty conversation counts as following, wherever the reader
             has scrolled the suggestions to: there is no latest turn to be
             away from, so no "Latest" pill, and the first question sent from
             halfway down them must still be followed by its answer. */
          const atBottom =
            empty || el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          const h = hold.current;
          /* **A clamp is not the reader.** When the panel grows taller under a
             hold (the "Latest" pill leaving as a question is sent, the composer
             shrinking back to one row) the room is briefly too short and the
             browser pulls `scrollTop` down to the new maximum. If anything
             forced a layout first, this event arrives *before* the resize
             observer, and recording it as the reader's choice left a follow-up
             question 36px low (the second browser pass of plan 261005f). Its
             signature is a maximum that has actually fallen since the hold
             was recorded, with the view clamped to that new end. Comparing the
             maxima matters: a high-DPI wheel can move a reader 0.6px from the
             ordinary bottom, which is both more than the movement tolerance
             and less than the end tolerance. A Latest press records both its
             position and maximum synchronously before this event arrives. */
          const max = Math.max(0, el.scrollHeight - el.clientHeight);
          if (
            h?.placed &&
            max < h.max &&
            el.scrollTop < h.top - 0.5 &&
            max - el.scrollTop < 1
          ) {
            settle();
            return;
          }
          /* `settle` writes scrollTop to place or compensate a hold, and the
             browser reports that write through this same event. Only a
             different position is evidence that the reader moved. */
          if (!h || Math.abs(el.scrollTop - h.top) > 0.5) stick.current = atBottom;
          if (awayNow.current !== !atBottom) setAway(!atBottom);
          /* The reader moved, so this is where a held answer's anchor now is.
             Our own writes and a browser's clamp fire this too, after `settle`
             has already put things back, and record what it left. */
          noteAnchor(el);
        }}
      >
        {empty &&
          (kind === "guide" ? (
            <GuideGreeting slug={slug} onAsk={(q) => onSend(q)} />
          ) : kind === "tutorial" ? (
            <TutorialInvitation />
          ) : kind === "explore" ? (
            <ExploreInvitation onAsk={(q) => onSend(q)} />
          ) : kind === "learn" ? (
            <LearnInvitation />
          ) : (
            <Suggestions onAsk={(q) => onSend(q)} />
          ))}
        {thread.messages.map((m, i) => (
          <Turn
            key={m.id}
            message={m}
            kind={kind}
            onHintOpened={onHintOpened}
            onJump={onJump}
            recovering={recovering.has(m.id)}
            blocks={blocks}
            /* Only the last answer may be retried — see `retryTurn` in
               src/chat.ts. The button is hidden rather than shown-and-refused,
               because a button that exists and always says no is worse than one
               that was never there. */
            onRetry={i === thread.messages.length - 1 ? onRetry : undefined}
            /* And nothing may be edited while an answer is arriving: the edit
               would discard the row being written into. The server settles the
               stream first and would cope, but offering it mid-answer invites
               the reader to do something they would then watch half-happen. */
            onEdit={onEdit}
            /* The pencil goes away while an answer is arriving; an editor
               already OPEN does not. Withdrawing `onEdit` wholesale unmounted a
               half-typed rewrite the moment the reader asked something else —
               and then remounted it, by itself, with the original text back in
               it, because `editing` still named the row. Found in review. */
            canEdit={!busy}
            editing={editing === m.id}
            onEditing={(on) => setEditing(on ? m.id : null)}
            /* How many turns an edit here would throw away. Counted from the
               rendered list rather than passed down, so it cannot drift from
               what is on screen. */
            discards={thread.messages.length - i - 1}
          />
        ))}
        {/* The spoken words still on their way to being saved, as the end of
            this same conversation. ./live/LiveTail.tsx. */}
        {live && <LiveTail live={live} />}
        {/* What lets a held question reach the top: § A streamed answer stays
            where it starts. Sized by `settle`, and zero outside a hold. */}
        <div className="chat-room" ref={room} aria-hidden="true" />
      </div>
      {/* The jump button sits *outside* the scroller so it does not scroll with
          it, and only exists while the reader is somewhere else — a permanent
          one is a permanent claim that you are lost. */}
      {away && (
        <button type="button" className="chat-to-bottom" onClick={toBottom} title="Jump to the latest">
          <ArrowDown size={13} /> Latest
        </button>
      )}
      {/*
        What a screen reader is told, and deliberately not the answer itself.

        The canonical chat pattern is a polite live region round the transcript,
        and it is wrong here: the text of an answer changes on every token, so
        the region fires a hundred times and a screen reader reads a growing
        prefix of the same paragraph over and over. Announcing the *finished*
        text once instead means putting the whole answer in the DOM twice.

        So the region carries a status line and nothing else. It tells you when
        to go and read, and the answer stays in one place to be read. See the
        streaming-accessibility note in docs/plans/260826a-chat-mode.md.
      */}
      <p className="sr-only" aria-live="polite">
        {busy
          ? "Answering."
          : last?.role === "assistant" && last.status === "done"
            ? last.stopped
              ? "Answer stopped."
              : "Answer ready."
            : last?.status === "error"
              ? "The answer failed."
              : ""}
      </p>
      <Composer
        slug={slug}
        onSend={onSend}
        onSubmitStarted={onSubmitStarted}
        busy={busy}
        onStop={busy && last ? () => onStop(last.id) : undefined}
        focusNonce={focusNonce}
        focused={focused}
        draft={draft}
        onDraft={onDraft}
        kind={kind}
        {...(live ? { live } : {})}
        {...(onStartLive ? { onStartLive } : {})}
        continuesLive={thread.messages.length > 0}
        blocks={blocks}
        onJump={onJump}
      />
    </>
  );
}

/**
 * The opening state of a **Learn thread**, which is not a list of suggestions and
 * must not become one.
 *
 * Chat's `Suggestions` are complete questions that send on click, and that
 * shape cannot be borrowed here: the content has to come from the reader. A
 * button reading "the argument in one sentence" would be putting words in their
 * mouth, which is the one thing this mode must not do — the whole point is to
 * find out what THEY took from it.
 *
 * So the nudges are prose. They are there because "say what you took from it"
 * is a genuinely hard instruction to obey from a standing start, and naming
 * three ways in is the cheapest help that does not contaminate the answer.
 */
function LearnInvitation() {
  return (
    <div className="chat-suggest">
      <p className="chat-empty-hint">
        Say what you took from this article, in your own words. I'll point at the places it comes
        apart from the piece — and at the paragraphs worth another look.
      </p>
      <p className="chat-empty-hint">
        It doesn't need to be tidy. Talking is usually easier than typing, and rambling is fine.
      </p>
      <p className="chat-empty-hint">
        Stuck for a way in? Try the argument in one sentence, the part you're least sure of, or what
        you'd tell someone about it.
      </p>
    </div>
  );
}

/**
 * **Tutorial's empty state asks the opening question**, so the reader speaks
 * first and the model never writes an unprompted turn. Greg, `spya-j0scgz`:
 * *"I think it might start with the sort of basic recall question. You know,
 * what do you remember about the article? But it may be that the user says
 * nothing. I haven't read it yet."*
 *
 * **It offers, and does not ask them to say so.** Greg, `spya-hw8mhz`,
 * 2026-10-03: *"I don't think the user should have to say that they haven't
 * read it … you're letting them know it's okay if they haven't read/finished
 * it."* The composer's placeholder and `readItFor` in src/converse.ts say the
 * same thing in the same way.
 */
function TutorialInvitation() {
  return (
    <div className="chat-suggest">
      <p className="chat-empty-hint">
        What do you remember about this article? It's fine if you haven't read it yet, or haven't
        finished — we can start from wherever you are.
      </p>
      <p className="chat-empty-hint">
        We'll take short turns: a little of the piece at a time, with a link to the passage, and then
        a question for you to answer in your own words.
      </p>
    </div>
  );
}

/**
 * **The ways into Explore the empty state offers**, each sent as the reader's
 * first message exactly as written — so what they pressed is what they see in
 * the transcript, and what `EXPLORE_SYSTEM` (src/converse.ts) answers.
 *
 * One per thing Greg asked Explore to do (2026-10-03, quoted in
 * docs/project/learn-mode.md § Explore): start from *"my comments, my
 * highlights, my chat threads"*; *"apply to interesting cases of my own"*; and
 * *"situate the article in terms of the wider world"*. Exported for
 * tests/learn-panel.test.tsx.
 */
export const EXPLORE_STARTERS: readonly string[] = [
  "Start from what I've marked and discussed",
  "Help me apply this to my own work",
  "Where does this sit in the wider world?",
  /* The fourth, 2026-10-05. Greg (spya-mvmpks): Explore is *"also about
     exploring potential problems and criticisms and concerns"*. A request,
     like the other three: it puts no view of the piece in the reader's mouth.
     evals/learn-explore.ts sends these same words as its critic's turn 1. */
  "Where might this piece be wrong, or missing something?",
];

/**
 * **Explore's empty state says what it is for and offers four ways in.**
 *
 * Buttons, where Recall's invitation above refuses them — and the difference
 * is what the button would say. A Recall starter would be the reader's account
 * of the piece, written by us. These are requests: each asks the model to make
 * a move and puts no view in the reader's mouth, so Chat's `Suggestions` shape
 * fits. The reader may also just type or talk; the box below says so.
 *
 * The words here are the app's, so they are set in the app's face. Nothing the
 * reader marked is drawn here — the notes go to the model, not onto this
 * screen — so there is nothing to set in the reader's
 * (docs/project/fonts.md).
 */
function ExploreInvitation({ onAsk }: { onAsk(question: string): void }) {
  return (
    <div className="chat-suggest">
      <p className="chat-empty-hint">
        What do you think about this piece? Explore starts from what you've highlighted, noted and
        talked about here, and helps you take your own ideas further.
      </p>
      <p className="chat-empty-hint">
        It can try the piece on cases of your own, look at where it may be weak, and look up what
        others have said about it.
      </p>
      <ul>
        {EXPLORE_STARTERS.map((starter) => (
          <li key={starter}>
            <button type="button" className="chat-suggest-btn" onClick={() => onAsk(starter)}>
              {starter}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The opening state of a conversation: a line about what this is for, and five
 * things worth asking.
 *
 * Shown only while the thread is empty. It is not a placeholder for the panel —
 * it is the panel's most useful screen, because "what do I even ask an article"
 * is the actual barrier, and a blank box answers it with nothing.
 */
function Suggestions({ onAsk }: { onAsk(question: string): void }) {
  return (
    <div className="chat-suggest">
      <p className="chat-empty-hint">
        Ask anything about this article. Answers cite the paragraphs they came from — press one to go
        there.
      </p>
      <ul>
        {SUGGESTIONS.map((s) => (
          <li key={s.label}>
            <button type="button" className="chat-suggest-btn" onClick={() => onAsk(s.ask)}>
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Exported for tests/chat-turn-waiting-spinner.test.tsx, which renders one
    turn in each of its waiting states; nothing else imports it. */
export function Turn({
  message,
  kind,
  onJump,
  recovering,
  blocks,
  onRetry,
  onEdit,
  onHintOpened,
  canEdit,
  editing,
  onEditing,
  discards,
}: {
  message: ChatMessage;
  /**
   * The conversation's kind. Only Recall (`learn`) keeps an answer's last
   * `Hint:` paragraph behind a button; every other kind draws it as written.
   */
  kind: ThreadKind;
  /**
   * The reader opened this answer's hint for the first time. The hint opens
   * from local state whatever this does; it is how the press gets recorded.
   */
  onHintOpened?: ((messageId: string, hint: string) => void) | undefined;
  onJump(id: BlockId): void;
  /** This answer's stream is lost and the client is asking the server about it. */
  recovering: boolean;
  blocks: Map<string, string>;
  /** Present only on the last message. See the call site. */
  onRetry?: ((messageId: string) => void) | undefined;
  onEdit(messageId: string, question: string): void;
  /** Whether the pencil is offered. False while an answer is arriving. */
  canEdit: boolean;
  editing: boolean;
  onEditing(on: boolean): void;
  /** Turns an edit here would discard. */
  discards: number;
}) {
  /**
   * Where the caret goes when an edit box closes.
   *
   * The editor takes focus when it opens, so cancelling it — Escape, or the X —
   * unmounts the focused element and leaves focus on `document.body`. For a
   * reader using the keyboard that is not a small thing: they lose their place
   * in the transcript entirely and have to Tab back from the top. Putting it on
   * the pencil they opened it from is the least surprising place, and it is
   * where they were. Found by a GPT-5.6 review, 2026-08-26.
   *
   * It does nothing whenever the pencil is not there to receive it, which is
   * any time an answer is arriving: after a submitted edit, and also after a
   * *cancelled* one if the reader started another answer while the box was
   * open. `canEdit` withdraws the pencil in both cases and the caret falls back
   * to the body, as it did before. Restoring focus to something that is about
   * to be withdrawn would be worse.
   */
  const pencil = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  const commands = useChatCommands() ?? undefined;
  useEffect(() => {
    if (wasEditing.current && !editing) pencil.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  /* **Recall's hint.** The model writes it as the answer's last paragraph and
     `splitHint` says which part it is; anything that is not exactly that shape
     comes back whole and is drawn as written. Split here, not inside `Answer`,
     so that what is drawn and what is copied are one `{ body, hint }`.

     Open is the reader's last press here, or else the stored first press — read
     on every render, because the stored time can arrive after this turn is
     drawn (stream recovery, or the write's own answer). The press is keyed to
     the attempt: a retry puts a new answer in the same row, and its hint starts
     closed. src/recall-hint.ts; docs/project/learn-mode.md. */
  const { body, hint } =
    kind === "learn" && message.role === "assistant"
      ? splitHint(message.text)
      : { body: message.text, hint: null };
  /* `createdAt` moves on retry, which is what makes it the attempt. */
  const attempt = message.createdAt;
  const [pressed, setPressed] = useState<{ attempt: string; open: boolean } | null>(null);
  /* **Nothing to press, and nothing drawn, until the answer has settled.** A
     press is therefore always on the final hint, and is reported the moment it
     happens: no press is ever held here waiting for the answer to land, where
     leaving the conversation would lose it. The hint is the last paragraph, so
     the button is about a second later than it could be. */
  const hintOffered = hint !== null && message.status !== "pending";
  const hintOpen = hintOffered && (pressed?.attempt === attempt ? pressed.open : message.hintOpenedAt !== undefined);
  const hintId = useId();
  const toggleHint = () => {
    if (hint === null || !hintOffered) return;
    const opening = !hintOpen;
    setPressed({ attempt, open: opening });
    /* Every opening press asks until the stored time comes back, so a write
       that failed is tried again; the controller drops a request that is
       already out or already answered (`startHint` in chat/reduce.ts). */
    if (opening && message.hintOpenedAt === undefined) onHintOpened?.(message.id, hint);
  };

  if (message.role === "user") {
    if (editing) {
      return (
        <EditQuestion
          text={message.text}
          discards={discards}
          onCancel={() => onEditing(false)}
          /* The pencil is withdrawn while an answer is arriving and an editor
             already open is deliberately left alone — closing it would destroy
             a half-typed rewrite. But left alone it could still be *submitted*,
             which discards the row being streamed into and contradicts the rule
             the pencil is enforcing. So the editor stays, and its Ask-again is
             what waits. Found by a GPT-5.6 review, 2026-08-26. */
          canAsk={canEdit}
          onDone={(next) => {
            onEditing(false);
            // An edit to the same words is not an edit. Re-running would throw
            // away the answers below to arrive at the same question.
            if (next.trim() !== "" && next.trim() !== message.text.trim()) {
              onEdit(message.id, next.trim());
            }
          }}
        />
      );
    }
    return (
      <div className="chat-turn you" data-turn="user">
        {message.text}
        {message.editedAt && (
          /* The only trace that this conversation once went elsewhere. Without
             it, a reader coming back to a thread they edited reads answers that
             do not quite match the questions and has no way to know why. */
          <span className="chat-edited" title="You rewrote this question">
            edited
          </span>
        )}
        {/* **The row keeps its height while an answer arrives**, with nothing in
            it to press. It used to be withdrawn whole, so every question in the
            transcript grew a row the moment an answer finished, and the answer
            being read moved down by one (seen in the browser check of plan
            261005f). The pencil itself is still absent, which is what the focus
            fallback above relies on. */}
        {!canEdit && (
          <div className="chat-actions held" aria-hidden="true">
            <span className="chat-icon">
              <Pencil size={12} />
            </span>
          </div>
        )}
        {canEdit && (
          <div className="chat-actions">
            <button
              ref={pencil}
              type="button"
              className="chat-icon"
              title="Rewrite this question"
              onClick={() => onEditing(true)}
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
      </div>
    );
  }
  /* **The waiting line: whenever no word has arrived and nothing else on the
     turn is spinning.**

     Not while a tool is running: the strip below says what, which is a better
     answer to the same question — and both at once reads as two spinners for
     one wait.

     It used to stop there, at "no tool row at all", and that left a state with
     nothing spinning anywhere: every tool row finished and no text yet. The
     model has its results and is writing its first word, which on a question
     that reaches for the web is seconds long. So the test is "is a row
     *running*", not "is there a row".

     Not gated on `useSlow`: the reader has already sent a question, and the
     turn is drawn empty, so this acknowledges the send immediately.
     docs/project/loading-spinner.md. */
  const tools = message.tools ?? [];
  /* A streamed chunk can be only a leading newline. It is not the first word
     yet, so the waiting line and cursor must agree about visible text. */
  const hasText = body.trim() !== "";
  const waiting =
    message.status === "pending" &&
    !hasText &&
    !recovering &&
    !tools.some((run) => run.status === "running");
  /* The word stays "thinking…" after a tool has finished too. A finished tool
     does not mean the answer is being written: the model may ask for another
     (src/converse.ts runs rounds), so a line that named the next step would be
     guessing. GPT Sol, plan 261003p F5. */
  return (
    <div className={`chat-turn model${message.status === "error" ? " failed" : ""}`} data-turn="assistant">
      <ToolStrip tools={message.tools} searches={message.searches} />
      {/* The stable top of prose, including prose CitedMarkdown renders as a
          bare text node. Conversation holds this point, not the streaming
          cursor at the other end of the answer. */}
      {hasText && <span className="chat-answer-anchor" aria-hidden="true" />}
      {waiting ? (
        <span className="chat-thinking">
          <LoaderCircle className="cmt-spinner" size={16} /> thinking…
        </span>
      ) : !hasText ? /* Stopped before a word arrived, or failed
          before one did. `Answer` splits on blank lines and would render one
          empty paragraph, which is a stray gap above the line that explains
          it. */ null : (
        <Answer
          text={body}
          onJump={onJump}
          blocks={blocks}
          /* Tooltips only once the answer has landed — see Cited.tsx. */
          live={message.status === "pending"}
        />
      )}
      {hint !== null && hintOffered && (
        /* Offered once the answer has settled; while it arrives the hint is
           simply not drawn (`hintOffered` above). The label is ours; the hint
           under it is the model's words, drawn by the same `Answer` so its
           block ids are chips. */
        <div className="chat-hint">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="chat-hint-btn"
            aria-expanded={hintOpen}
            {...(hintOpen ? { "aria-controls": hintId } : {})}
            onClick={toggleHint}
          >
            Hint
          </Button>
          {hintOpen && (
            <div id={hintId} className="chat-hint-text">
              <Answer text={hint} onJump={onJump} blocks={blocks} live={false} />
            </div>
          )}
        </div>
      )}
      {/* Where the blinking cursor would be, and instead of it — because a cursor
          says "more is coming here in a moment", which is the one thing that is
          not true. Nothing is arriving: this browser has lost the stream and is
          asking the server whether the answer finished without it. "thinking…"
          would be worse still, being a claim about the model, and it is the
          claim the reader already sat through for two minutes. The row stays
          `pending`, so Stop is still offered — the answer really may still be
          being written, just not to us. */}
      {recovering && message.status === "pending" ? (
        <span className="chat-thinking reconnecting">
          <LoaderCircle className="cmt-spinner" size={13} /> connection lost — checking whether the
          answer finished…
        </span>
      ) : (
        message.status === "pending" && hasText && <span className="chat-cursor" />
      )}
      {message.status === "error" && <p className="chat-failed">{message.error}</p>}
      {message.truncated && (
        /* Styled as a failure, unlike `stopped` two lines down — because it is
           one. Nobody asked for this answer to end here, and the retry above is
           the thing to do about it. */
        <p className="chat-failed">
          This answer ran out of room and stopped mid-sentence. Try again.
        </p>
      )}
      {message.stopped && (
        /* Not styled as a failure, because it is not one. An answer that ends
           mid-sentence with nothing to explain it is the thing that reads like
           a bug; one line saying who ended it is the whole fix. */
        <p className="chat-stopped">You stopped this answer.</p>
      )}
      {message.interrupted && (
        /* Covers speaking over the model, early hangup and provider failure.
           The provider does not supply a transcript trimmed to played audio. */
        <p className="chat-stopped">This spoken answer ended early. Its transcript may include words you did not hear.</p>
      )}
      {message.passages && message.passages.length > 0 && (
        /* **The pointers a spoken answer made instead of citing.**

           A typed answer carries `[spya-k3m9qt]` in its own text and `Answer`
           above makes each one pressable. A spoken answer deliberately has
           none: it is forbidden to say an id aloud, and is given `show_passage`
           instead. So without this the stored transcript is an *uncited claim*,
           which is the one thing the chat contract exists to prevent — the
           reader would have the companion's word for it and no way back to the
           prose. docs/plans/260831l-live-conversation-in-chat.md § 1b. */
        <PassageLinks passages={message.passages} onJump={onJump} />
      )}
      <WebSources citations={message.citations} />
      {message.status !== "pending" && (
        <div className="chat-actions">
          {message.text !== "" && (
            <CopyAnswer
              /* What is on screen: the hint goes with it only while it is open. */
              text={withoutCommandLines(
                hintOpen ? message.text : body,
                (raw) => commands !== undefined && chipFor(raw, commands, blocks) !== null,
              )}
            />
          )}
          {/* "Answer again" is a regenerate, not only a retry — it is offered on
              a perfectly good answer too. So the extra condition is narrow: it
              disappears only when this turn *failed*, and failed in a way that
              says another go cannot work. Asking again after a refusal the
              service will repeat costs a call and returns the same sentence.
              src/messages.ts § worthRetrying. */}
          {onRetry && (message.status !== "error" || worthRetrying(message.error)) && (
            <button
              type="button"
              className="chat-icon"
              title="Answer again"
              onClick={() => onRetry(message.id)}
            >
              <RotateCcw size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the model did before it answered.
 *
 * A strip above the answer, one line per tool, in the order they ran. It appears
 * the moment the first tool starts and stays on the finished answer for good —
 * Greg's call, 2026-08-26, over the cheaper option of a live line that vanishes:
 *
 * > A live line, kept afterwards.
 *
 * The cost of keeping it is a `tools` array on every stored message that used
 * one. What it buys is that a reader coming back to a thread a month later can
 * see **why an answer said what it said** — which page it read, which of their
 * own articles it found — rather than having to take a confident paragraph on
 * trust. That is the same argument the block-id citations are built on, pointed
 * at the half of an answer that does not come from the article.
 *
 * ## Web searches are a row here too, and they are not a `ToolRun`
 *
 * OpenRouter's web search runs inside the provider, so nothing on this side sees
 * it start or finish — all that comes back is a count in `searches`. It is
 * rendered as one synthetic row rather than left out, because from the reader's
 * side "it searched the web twice" belongs in exactly this list; and it says
 * only the number, because **we do not know what it searched for** and a made-up
 * query would be the most convincing wrong thing on the screen.
 */
function ToolStrip({
  tools,
  searches,
}: {
  tools: ToolRun[] | undefined;
  searches: number | undefined;
}) {
  const runs = tools ?? [];
  const webSearches = searches ?? 0;
  if (runs.length === 0 && webSearches === 0) return null;
  return (
    <ul className="chat-tools">
      {webSearches > 0 && (
        <li className="chat-tool">
          <Globe size={12} aria-hidden />
          <span className="chat-tool-label">
            searched the web
            {/* The count, not a list. See the header. */}
            {webSearches > 1 ? ` (${webSearches} searches)` : ""}
          </span>
        </li>
      )}
      {runs.map((run, i) => (
        <li
          /* Indexed, and it has to be: the same tool with the same arguments can
             legitimately run twice in one answer (two library searches with
             different phrasings is the ordinary case), so name-plus-label is not
             unique. The list only ever grows and only ever changes in place —
             `useChat` assigns by index — so the index is stable for as long as
             the row exists. */
          // biome-ignore lint/suspicious/noArrayIndexKey: that rule is about lists which reorder or splice. This one only grows, and useChat assigns into it by index — so the index IS the row's identity, and name-plus-label is not unique.
          key={`${i}-${run.name}`}
          className={`chat-tool${run.status === "running" ? " running" : ""}${run.status === "error" ? " error" : ""}`}
        >
          {run.status === "running" ? (
            <LoaderCircle className="cmt-spinner" size={12} aria-hidden />
          ) : (
            <ToolIcon name={run.name} />
          )}
          <span className="chat-tool-label">{run.label}</span>
          {run.detail && <span className="chat-tool-detail">{run.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * The glyph for a tool, by name.
 *
 * A switch on the server's tool names, which is exactly the coupling
 * src/chat-tools.ts avoids for the *words* — the label and the detail are
 * written there so a new tool reads correctly here without anyone touching this
 * file. An icon cannot travel that way (it is a component, not a string), so a
 * tool this switch has not heard of falls through to a magnifying glass rather
 * than to nothing. A slightly wrong icon beside correct words is a much smaller
 * failure than a blank row.
 */
function ToolIcon({ name }: { name: string }) {
  switch (name) {
    case "read_web_page":
      return <Globe size={12} aria-hidden />;
    case "search_library":
      return <Library size={12} aria-hidden />;
    case "read_library_passage":
      return <BookOpen size={12} aria-hidden />;
    case "article_links":
      return <Link2 size={12} aria-hidden />;
    case "article_glossary":
    /* The reader's own notes: a page of writing, like the glossary's. */
    case "reader_notes":
      return <FileText size={12} aria-hidden />;
    case "article_citations":
      return <BookMarked size={12} aria-hidden />;
    default:
      return <Search size={12} aria-hidden />;
  }
}

/**
 * **The web pages a search brought back, under the answer, headed as such** —
 * so the reader can see which half of the answer is the web, not only read it
 * in the prose (report 3D; docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md).
 *
 * Filtered again here, and the repetition is deliberate. The server refuses a
 * non-http(s) citation before storing it (converse.ts § isWebUrl), but an older
 * stored row predates that check and could hold anything — and this is the one
 * place in chat where model output reaches an attribute rather than a text node.
 * A second cheap check at the boundary that matters.
 *
 * And it filters **before** deciding whether to draw: an array holding only a
 * non-web URL is non-empty and lists nothing, so a guard on the unfiltered array
 * would put "From the web" over an empty list (Sol F10).
 */
export function WebSources({ citations }: { citations: Citation[] | undefined }) {
  const web = (citations ?? []).filter((c) => isWebUrl(c.url));
  if (web.length === 0) return null;
  return (
    <div className="chat-sources">
      <p className="chat-sources-label">From the web</p>
      <ul>
        {web.map((c) => (
          <li key={c.url}>
            <a href={c.url} target="_blank" rel="noreferrer noopener">
              {c.title?.trim() || hostOf(c.url)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Put an answer on the clipboard.
 *
 * **What is copied is the model's own text, block ids and all.** They look like
 * noise outside the app and they are the opposite: they are the provenance, and
 * an answer pasted into a note without them is exactly the confident unsourced
 * claim vision.md names as an anti-goal. Stripping them would make the pasted
 * version *less* checkable than the one on screen.
 *
 * The tick is not decoration either. A clipboard write returns a promise that
 * can reject — no permission, a browser that will not do it from this event —
 * and a copy button that has visibly done nothing is the silent-success shape
 * (docs/reusable/silent-success.md). So the state has three values, not two,
 * and a refusal says so.
 *
 * The write itself is `useCopy`'s: the guard for a browser with no clipboard,
 * the newest-press-wins token and the timer that takes the tick away again are
 * explained once, in useCopy.ts.
 */
function CopyAnswer({ text }: { text: string }) {
  /* 1.6 seconds for a tick and for a refusal alike. */
  const { state, copy } = useCopy({ copiedMs: 1600, failedMs: 1600 });
  /* The outcome is announced as well as drawn.

     A tick replacing a clipboard is the whole feedback this button gives, and a
     glyph swap inside a button is not an event: a screen reader is told nothing
     at all, so a copy that *failed* is indistinguishable from one that worked —
     the silent-success shape, with the reader's clipboard still holding whatever
     was in it. The live region says which. It also survives the 1.6s timer
     resetting the icon, because it has already been spoken by then. Found by a
     GPT-5.6 review, 2026-08-26. */
  return (
    <button
      type="button"
      className="chat-icon"
      title={
        state === "failed"
          ? "Your browser would not allow the copy — an insecure connection is the usual reason"
          : "Copy this answer"
      }
      onClick={() => copy(text)}
    >
      {state === "copied" ? (
        <ClipboardCheck size={12} />
      ) : state === "failed" ? (
        <TriangleAlert size={12} />
      ) : (
        <Copy size={12} />
      )}
      <span className="sr-only" aria-live="polite">
        {state === "copied"
          ? "Answer copied."
          : state === "failed"
            ? "Copy refused by the browser."
            : ""}
      </span>
    </button>
  );
}

/**
 * Rewriting a question, in place, with the cost of it stated.
 *
 * The count is the entire safety mechanism, and it is a sentence rather than a
 * modal on purpose. A confirmation dialog in front of an edit is a tax on every
 * typo fix, and readers learn to dismiss it without reading — so it stops
 * protecting the case it was put there for. A line that says *what will happen*
 * before you commit is read once and believed.
 *
 * Enter submits and Escape cancels, matching the rename box above; Shift+Enter
 * makes a newline, matching the composer below. Every key press is stopped from
 * bubbling for the reason the composer gives: the article's ↑/↓ navigation is
 * on the window and would scroll the page under the reader's caret.
 */
function EditQuestion({
  text,
  discards,
  canAsk,
  onDone,
  onCancel,
}: {
  text: string;
  discards: number;
  /** False while an answer is arriving — see the call site. */
  canAsk: boolean;
  onDone(next: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(text);
  /**
   * **A press that is refused says so.** While an answer is arriving the edit
   * cannot go (see the call site), and Enter used to do nothing at all and the
   * tick merely greyed out — a reader who pressed Enter saw no answer and no
   * reason. Investigating spya-f3b6ab; the class is in
   * docs/postmortems/261002g-a-refusal-with-no-voice.md. Cleared when asking
   * becomes possible again, so the sentence never outlives its cause.
   */
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (canAsk) setHeld(false);
  }, [canAsk]);
  const ask = () => {
    if (canAsk) onDone(value);
    else setHeld(true);
  };
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus();
    // The caret at the end rather than the whole question selected: the common
    // edit is adding a clause, and a select-all turns the first keystroke into
    // a delete of everything.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <div className="chat-turn you editing" data-turn="user">
      <textarea
        ref={box}
        className="chat-edit-box"
        /* Enter asks again — the composer's arrangement, and its `enterKeyHint`
           for the same reason. */
        enterKeyHint="send"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          /* Not the Escape that dismisses an input method's candidates, which
             would throw the rewrite away. After the stop, as in the composer. */
          if (e.key === "Escape" && !isImeComposing(e)) onCancel();
          if (isSendEnter(e)) {
            e.preventDefault();
            ask();
          }
          if (isHeldSendEnter(e)) e.preventDefault();
        }}
      />
      {held && !canAsk && (
        <p className="chat-discard-warning chat-edit-held" role="status">
          An answer is still arriving. Ask again once it has finished — your rewrite is kept.
        </p>
      )}
      {discards > 0 && (
        <p className="chat-discard-warning">
          Asking again will discard the {discards} message{discards === 1 ? "" : "s"} below.
        </p>
      )}
      <div className="chat-actions">
        <button
          type="button"
          className="chat-icon"
          title={canAsk ? "Ask again (Enter)" : "Wait for the answer above to finish"}
          /* `aria-disabled`, not `disabled`, so a press still reaches `ask` and
             can say why it was refused — the composer's Send does the same. */
          aria-disabled={!canAsk || undefined}
          onClick={ask}
        >
          <Check size={12} />
        </button>
        <button type="button" className="chat-icon" title="Cancel (Esc)" onClick={onCancel}>
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

/**
 * An answer, with `[spya-k3m9qt]` turned into something you can press.
 *
 * **The whole feature is in this function**, so it is worth being precise about
 * what it does and does not do:
 *
 *  - It splits on the *shape* of one of our ids rather than on anything the
 *    model was told to write. So a model that forgets the brackets still gets
 *    working links, and a model that invents `[see above]` does not get a
 *    broken one.
 *  - An id this article does not have is rendered as **plain text**, not as a
 *    link that goes nowhere. A dead link that scrolls to nothing is the worse
 *    failure: the reader presses it, the page does not move, and there is no
 *    way to tell that from a bug in the scrolling. It is still a silent
 *    failure, which is why the server counts them (`unknownIds` in
 *    src/converse.ts) — this is the half a reader can live with, and the log is
 *    where anybody would find out it was happening.
 *  - The brackets around a run of ids are dropped, and the ids inside are drawn
 *    as chips. Keeping them would put punctuation around something that no
 *    longer reads as text.
 *
 * Text is rendered as text — never `dangerouslySetInnerHTML`. This is model
 * output, and the article's own HTML is sanitised twice before it is trusted
 * (docs/project/security.md); nothing here earns an exemption from that.
 */
function Answer({
  text,
  onJump,
  blocks,
  live,
}: {
  text: string;
  onJump(id: BlockId): void;
  blocks: Map<string, string>;
  live: boolean;
}) {
  /* The blocks, the chips, the web links and the marks all live in Cited.tsx,
     shared with Quiz and Candidates. Two copies of what a citation looks like
     would drift, and a chip that means something slightly different depending
     on which band it is in is worse than either version. The chips' hover card
     is the one every block link shares (BlockLinkCard.tsx), which also moves
     from chip to chip without a second wait — what a `TooltipGroup` here used
     to do. */
  /* The executor a command chip presses through, where the reading view put
     one round this panel — chat and the chat dialog, never Learn. `null`
     everywhere else, and a `[cmd:…]` is then plain text. CommandChip.tsx. */
  const commands = useChatCommands() ?? undefined;
  return (
    <CitedMarkdown
      text={text}
      blocks={blocks}
      onJump={onJump}
      /* Only the **end** of an answer still arriving can be half-written, and
         a bare URL cut in half is a link that goes somewhere wrong for the
         second before the rest lands. Everything above it is finished text.
         citations.ts § splitLinks, Cited.tsx § drawBlocks. */
      partial={live}
      /* Chat, and only chat, for both of the opt-in flags. The prompt here
         has a rule governing what a model may link (converse.ts § LINKING TO
         THE WEB) and asks for the shapes this draws; the summary prompt asks
         for plain sentences and has neither. Cited.tsx § links,
         Cited.tsx § CitedMarkdown. */
      links
      commands={commands}
    />
  );
}

/**
 * The box you type into.
 *
 * Enter sends, Shift-Enter makes a new line — the convention every chat has, so
 * doing anything else would be a surprise for no gain. The textarea grows with
 * what is in it up to a limit, because a question worth asking is often two
 * sentences and a single-line input makes it feel like it should not be.
 */
export function Composer({
  slug,
  onSend,
  onSubmitStarted,
  busy,
  onStop,
  focusNonce,
  focused,
  draft,
  onDraft,
  placeholder,
  kind = "chat",
  live,
  onStartLive,
  continuesLive,
  blocks,
  onJump,
}: {
  slug: string;
  onSend(question: string): void;
  /** The reader has submitted, even if Live must finish before `onSend`. */
  onSubmitStarted?: (() => void) | undefined;
  busy: boolean;
  /** Present only while an answer is arriving. */
  onStop?: (() => void) | undefined;
  focusNonce: number;
  focused: { current: number };
  draft: string;
  onDraft(text: string): void;
  /**
   * What the empty box says, when "Ask about this article…" would be a lie
   * about where the question is going — the box under the thread list starts a
   * conversation rather than continuing one.
   */
  placeholder?: string;
  /**
   * Chat or Learn. **Everything that makes this box work is shared** — the
   * draft, the focus nonce, the auto-resize, Enter to send, the Escape ladder,
   * the key-propagation stop that keeps the article's ↑/↓ out of the caret, the
   * `readOnly` gate while a transcript is arriving, the dictation button and
   * strip. Those are the parts that are subtle and the parts where a second
   * copy would drift; a Learn box that reimplemented the Escape ladder would
   * be a bug nobody found for a month.
   *
   * What the kind changes is layout: a box six rows tall instead of one, and
   * the microphone first. (A stance `<select>` sat here too until 2026-10-02,
   * when Recall became one voice.) Greg, 2026-08-27: *"the input box
   * should be much larger for Review mode, and probably emphasise the
   * microphone UI, because talking will be much less annoying than typing."*
   */
  kind?: ThreadKind;
  /** Optional on surfaces without a live-session owner, such as ChatDialog. */
  live?: LiveApi | undefined;
  /** Begin one. The panel supplies or creates the conversation. */
  onStartLive?: (() => void) | undefined;
  continuesLive?: boolean | undefined;
  blocks?: ReadonlyMap<string, string> | undefined;
  onJump?: ((id: BlockId) => void) | undefined;
}) {
  /* Seeded from the draft and owned here from then on. The words are kept
     above (`drafts` in ChatPanel) because they have to outlive this component;
     this keeps the value because typing into it must not repaint the
     transcript above. */
  const [value, setValue] = useState(draft);
  /* Recall's, Tutorial's and Explore's box alike: tall, microphone first. */
  const learn = isLearnKind(kind);
  /**
   * **A short band gets a short box.** On a landscape phone the band is about
   * 338px tall, and six rows at rest took 280 of it — the transcript the reader
   * is answering had 58px. So below 500px of viewport height (a landscape
   * phone; no laptop window is that short) Learn's box rests at two rows and
   * grows to 30% of the viewport, still following what is typed or dictated.
   * Plan 261001m § 5. Chat's one-row box is unchanged.
   */
  const short = useMedia(SHORT_VIEWPORT);
  const size = useMemo(() => boxSize(learn, short), [learn, short]);
  const box = useRef<HTMLTextAreaElement>(null);

  /**
   * Take focus when a new conversation has just been started.
   *
   * Greg, 2026-08-26: *"when a new chat is started, move focus to the input
   * box."* Which is the only time it is right — see ConversationBand in App.tsx. The
   * guard on `0` is what keeps a plain page load, or the reader opening a
   * conversation they already had, from stealing the caret; a focused textarea
   * turns ↑ / ↓ from "step through the article" into "move the cursor", and
   * nothing on screen would say why.
   *
   * **The caret goes to the end.** A new conversation's box is usually empty,
   * where that changes nothing; when it was started with a question handed over
   * (`ChatHandoff` in ConversationModes.tsx), `focus()` alone left the caret before the first
   * word — measured in Chrome — so the reader's first keystroke landed in front
   * of the question rather than after it.
   */
  useEffect(() => {
    if (focusNonce > focused.current) {
      focused.current = focusNonce;
      const el = box.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
      /* And the box shows it. A handed-over summary paragraph is taller than
         the box's roof, and Chrome left it scrolled to the top: the reader saw
         the start of the quote and not the line they were to type on
         (browser check, plan 261004a). */
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [focusNonce, focused]);

  // Height follows content. Reset to `auto` first, or the box can only ever
  // grow: `scrollHeight` of an element already tall enough is its own height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect measures the DOM rather than reading `value`, but `value` is what changed it
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    /* `rows` below sets the floor; this sets the roof. `boxSize` says why each. */
    el.style.height = `${Math.min(el.scrollHeight, size.roof())}px`;
  }, [value, size]);

  /**
   * **Dictation, in the box where it is worth most.**
   *
   * `{ kind: "article", slug }` is what tells the server to prime the
   * transcriber with this article's glossary — which is exactly the vocabulary
   * a reader asking about this article is about to use. Measured on 2026-08-27:
   * with the terms supplied the model got this app's own jargon right every run;
   * without them it made the same mistakes as every dedicated speech-to-text
   * model. docs/plans/260827x-dictation-two-pass.md. (They went *in the prompt*
   * until 2026-09-07 and go in `keywords` now — the finding is about telling it
   * the words, not about where they sit;
   * docs/plans/260907c-dictation-onto-an-openai-transcriber.md.)
   */
  const transcribe = useReaderTranscriber();
  const dictate = useDictationField({
    value,
    onChange: (next) => {
      setValue(next);
      onDraft(next);
    },
    box,
    context: { kind: "article", slug },
    transcribe,
    keep: keepDictation(`chat:${slug}`),
    /* A double press on Stop also sends (dictation.md § A double press). */
    onDone: () => void submit(),
  });

  // A Live ticket can still be pending before Live claims the microphone.
  // Cancel that attempt as well as any active capture; otherwise its late
  // ticket would claim the microphone after the reader chose dictation.
  const toggleDictation = () => {
    void (async () => {
      if (live && live.phase !== "idle" && live.phase !== "failed") await live.stop();
      if (box.current) dictate.toggle();
    })();
  };

  /**
   * Send — and **hand over from the live session first, awaited.**
   *
   * One modality at a time, because there is only ever one speaker and one
   * response scheduler. The reader may hold a draft while talking; pressing
   * Send gracefully ends the conversation, waits for its last exchange to be
   * written down, and only then uses the proven typed path.
   *
   * **The `await` is the whole of it.** A typed turn claims the conversation's
   * tail, and a flush still in flight is about to move it — so an unawaited
   * handoff turns the expected-tail guard into a 409 we inflicted on ourselves,
   * which the reader would see as their question being refused for no reason.
   * docs/plans/260831l-live-conversation-in-chat.md § 1d.
   *
   * The box is cleared before the wait rather than after, which is the same
   * optimism this button has always had: the question is on its way, and text
   * the reader types during the handoff is theirs and is not thrown away.
   */
  const submit = async () => {
    /* **Not while the microphone is involved, and that is two states.**
       `readOnly` is `transcribing` alone — the two seconds *after* the reader
       presses stop — and sending then would post the recogniser's rough guess a
       moment before the good words arrived, which is the one outcome the
       two-pass design must not produce. `armed` is the microphone still being
       **on**, and that is the state this box actually reaches now that its Enter
       key says Send: press it mid-sentence and the question goes with Chrome's
       live guesses in it — or, on Safari and Firefox, with nothing that was said
       at all — and the microphone keeps running afterwards. GPT Sol's plan
       review item 3, then its code review of 2026-09-04 for the half that was
       missing. docs/project/dictation.md § Adding it to a box. */
    if (dictate.busy) return;
    const question = value.trim();
    if (question === "" || busy) return;
    const submittedBox = box.current;
    const handoff = live && live.phase !== "idle" && live.phase !== "failed";
    // Revoke never-submitted recovery before the wait: another draft can be
    // typed and the mode left while this question is already on its way.
    onSubmitStarted?.();
    setValue("");
    onDraft("");
    if (handoff) await live.stop();
    onSend(question);
    /* The question has gone and the answer arrives under the keys: let go of
       a soft keyboard, and only a soft one (useVisualViewport.ts §
       `putKeyboardAway`; Greg, spya-gmtt4b). A live handoff can wait long
       enough for the reader to begin another draft, which still owns the
       keyboard. Without that await React has not committed the clear yet. */
    if (
      submittedBox && box.current === submittedBox && document.activeElement === submittedBox &&
      (!handoff || submittedBox.value === "")
    ) putKeyboardAway(submittedBox);
  };
  /** Every state `submit` refuses, so the Send button can say so before a press. */
  const unavailable = busy || dictate.busy || value.trim() === "";

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={box}
        className="chat-input"
        /* Six rows rather than one, so the box LOOKS like somewhere to put a
           paragraph before a word is in it. The height then follows the content
           exactly as chat's does. */
        rows={size.rows}
        value={value}
        /* **Send, because Enter really does send here** — see the handler below.
           This is the exception among the app's textareas: everywhere else Enter
           is a newline and the soft keyboard must not promise otherwise.
           docs/project/touch.md § What the Enter key promises. */
        enterKeyHint="send"
        readOnly={dictate.readOnly}
        placeholder={
          busy
            ? "Waiting for the answer…"
            : kind === "guide"
              ? "Why are you reading this, or what would help?"
              : kind === "tutorial"
              ? "What do you remember about it? It's fine if you haven't read it yet."
              : kind === "explore"
                ? "What do you make of it? Say what's on your mind, or where you'd like to take it."
                : learn
                ? "Tell me what you took from this, in your own words. Ramble — it doesn't need to be tidy."
                : (placeholder ?? "Ask about this article…")
        }
        onChange={(e) => {
          setValue(e.target.value);
          // Kept above this component so the words survive it; see `drafts`
          // in ChatPanel.
          onDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          /* Every key press in here is stopped from bubbling, and that is not
             tidiness: the article's ↑/↓ navigation listens on the window
             (keynav.ts) and would scroll the page while the reader was moving
             the caret through their own question.

             It does **not** hold against Dock.tsx, and an earlier version of
             this comment claimed it did. That listener is registered on
             `window` in the *capture* phase, so it has already run and called
             `stopImmediatePropagation` before React's root listener — and
             therefore this handler — is reached at all. While the drawer is
             open, Escape closes the drawer and the ladder below never runs.
             That is the right order (the drawer is over everything, and closing
             the thing in front of you is what Escape is for), but it is the
             drawer winning rather than this stopping it. Found by a GPT-5.6
             review, 2026-08-26. */
          e.stopPropagation();
          if (isSendEnter(e)) {
            e.preventDefault();
            void submit();
          }
          /* A handoff puts the caret here with the question already written.
             The Enter that made it, still held, neither sends nor adds lines. */
          if (isHeldSendEnter(e)) e.preventDefault();
          /* Escape, in three steps, most-urgent first.

             It has to be a ladder rather than one action because the composer
             swallows every key press (see above), so Escape has no other
             meaning available to it — and the three things a reader wants from
             it here are genuinely different: stop the answer, drop the question
             I was typing, give me the reading keys back. Doing them in that
             order means the destructive one is never reached by accident: you
             cannot clear a draft you have not typed, and you cannot blur while
             there is anything else Escape could still be for.

             **None of them for an Escape that belongs to an input method.** A
             reader typing Japanese or Chinese presses it to dismiss the
             candidate list, and the second rung emptied their question. The
             test sits here, after the `stopPropagation` above, so a composing
             key is still contained like every other. */
          if (e.key === "Escape" && !isImeComposing(e)) {
            if (onStop) onStop();
            else if (value !== "") {
              setValue("");
              onDraft("");
            }
            else box.current?.blur();
          }
        }}
      />
      {/* Stop *replaces* send while an answer is arriving, rather than sitting
          beside it. Two buttons in a 400px composer is one too many, and the
          send button was disabled in that state anyway — so the space was
          already spoken for by a control that could not be pressed. */}
      {onStop ? (
        <button type="button" className="chat-send stop" onClick={onStop} title="Stop (Esc)">
          <Square size={14} fill="currentColor" />
        </button>
      ) : (
        /* The keys on a card rather than an OS `title` — Greg, 2026-09-29:
           *"Add a tooltip to the send-message button with keyboard shortcuts."* */
        <Tooltip
          placement="top"
          keepSide
          className="tip-soon"
          content={<ControlTip head="Send" what="Enter to send." how="Shift+Enter for a new line." />}
        >
          <button
            type="submit"
            className="chat-send"
            aria-label="Send"
            /* `armed` beside `readOnly` for the reason `submit` above gives — and
               a button the guard would refuse must not look pressable, or the
               reader presses Send while talking and nothing at all happens.

               **`aria-disabled`, not `disabled`**, so the card still opens: an
               empty box is exactly when a reader wonders how to send, and a
               natively disabled button is no reliable tooltip trigger
               (docs/project/tooltips.md § the shelf's action row). The click is
               stopped here, and `submit` refuses the same states anyway. */
            aria-disabled={unavailable || undefined}
            onClick={unavailable ? (e) => e.preventDefault() : undefined}
          >
            {/* 18 in the 36px box (--control-h); the stroke stays the house 1.75.
                docs/plans/260912c-send-button-icon-and-primary-style.md. */}
            {busy ? <LoaderCircle className="cmt-spinner" size={18} /> : <SendHorizontal size={18} />}
          </button>
        </Tooltip>
      )}
      {dictate.dictation.supported &&
        (learn ? (
          /* **Labelled, and first in the row.** Greg asked for the microphone to
             be emphasised here because talking a paragraph is so much less
             annoying than typing one — and an unlabelled icon among three other
             unlabelled icons is not an invitation to talk, it is a control you
             have to already know about. The button itself is the SAME component
             chat uses (`DictationButton`, over `useDictationField`), so the four
             phases, the disabled-while-transcribing rule and the article's own
             glossary priming all come along unchanged. Only the label is new. */
          <span className="chat-talk">
            <DictationButton dictation={dictate.dictation} toggle={toggleDictation} disabled={busy} again={dictate.again} sendingAfter={dictate.sendingAfter} />
            <span className="chat-talk-label" aria-hidden="true">
              {dictate.dictation.armed ? "Listening…" : dictate.readOnly ? "Writing it down…" : "Talk"}
            </span>
          </span>
        ) : (
          <DictationButton dictation={dictate.dictation} toggle={toggleDictation} disabled={busy} again={dictate.again} sendingAfter={dictate.sendingAfter} />
        ))}
      {/* **Beside the microphone, not instead of it.** They are different
          things: one turns speech into text in this box, the other holds a
          conversation. Pressing either while the other is running politely ends
          it. The Composer cancels pending Live startup before dictation;
          `mic-lock.ts` arbitrates captures, because WebKit supports one
          microphone source at a time.
          The list's control creates its own thread before connecting. */}
      {live && onStartLive && (
        <LiveButton
          live={live}
          onStart={onStartLive}
          disabled={busy || dictate.readOnly}
          labelled={learn}
          continues={continuesLive}
        />
      )}
      <DictationStrip dictation={dictate.dictation} sendingAfter={dictate.sendingAfter} />
      {live && onStartLive && <LiveStatus
        live={live}
        onRestart={onStartLive}
        blocks={blocks}
        onJump={onJump}
      />}
    </form>
  );
}
