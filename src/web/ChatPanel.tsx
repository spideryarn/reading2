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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  BookOpen,
  BookMarked,
  Check,
  ClipboardCheck,
  Copy,
  FileText,
  Globe,
  Library,
  Link2,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  Search,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { worthRetrying } from "../messages.js";
import type {
  BlockId,
  ChatMessage,
  ChatThread,
  Citation,
  RememberStance,
  ThreadKind,
  ToolRun,
} from "../types.js";
import { CitedMarkdown } from "./Cited.js";
import { ModeSurface } from "./ModeSurface.js";
import { PassageLinks } from "./PassageLinks.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { LiveButton } from "./live/LiveButton.js";
import { LiveStatus } from "./live/LiveStatus.js";
import type { LiveApi } from "./live/useLiveConversation.js";
import { sendForTranscription } from "./dictation-upload.js";
import { useDictationField } from "./useDictationField.js";
import { hostOf, isWebUrl } from "../urls.js";
import { TooltipGroup } from "./Tooltip.js";
import { exactly, timeAgo } from "./relative-time.js";
import { useNow } from "./useNow.js";
import { useSlow } from "./useSlow.js";
import { useRenderCount } from "./perf.js";

interface Props {
  threads: ChatThread[];
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
  /** Answer the last question again, over the top of the answer it has. */
  onRetry(messageId: string): void;
  /** Rewrite one of the reader's questions. Discards everything after it. */
  onEdit(messageId: string, question: string): void;
  /** Stop an answer that is still arriving. What has appeared is kept. */
  onStop(messageId: string): void;
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
   * Which mode this panel is being shown in — chat, or Remember.
   *
   * **One panel with a kind, not two panels.** Everything under here is the
   * same in both: the transcript, the scroll-follow, the citation chips, the
   * tool strip, the retry and the editor, the recovery of a lost stream. What
   * differs is the empty state, the composer's size, and one `<select>`. A
   * second component would have been a second copy of all of the first list in
   * order to vary the second — which is the duplication GPT Sol's review of
   * docs/plans/260827ah-review-mode.md (finding 9) said not to build.
   *
   * The list of conversations is **shared**: Greg's call, 2026-08-27. Both
   * modes show every thread for this article, and a Remember thread carries a tag.
   */
  kind: ThreadKind;
  /**
   * The stance the next Remember answer will be asked for, and how to change it.
   *
   * Above the composer because the composer is keyed by thread id and remounts;
   * seeded by the band from the last answer in the open conversation, so a
   * reader who picked Socratic yesterday finds it still on Socratic. Unused in
   * chat mode. See docs/plans/260827ah-review-mode.md § Where the stance picker's value
   * lives.
   */
  stance: RememberStance;
  onStance(next: RememberStance): void;
  /**
   * **The Recall | Quiz control**, when this panel is the Recall half of
   * Remember. Absent in chat mode.
   *
   * A slot rather than a `subMode` value with a callback, because the control
   * belongs to `RememberBand` (src/web/App.tsx): the navigation rules behind it —
   * clearing `?thread=` in one step, Quiz winning a pasted collision — are
   * about two parameters this panel knows nothing about. Handing down a rendered
   * node keeps that knowledge where it is, and keeps `ChatPanel` unaware there
   * is a second sub-mode at all.
   */
  subMode?: React.ReactNode;
  /**
   * **An unsent question for one conversation**, handed over from another mode
   * — today, the glossary's *Ask in chat*. Used as that keyed composer's initial
   * draft, so it is exactly what the reader would have had if they had typed it:
   * in the box, editable, cleared by Escape, and enough to stop `leave`
   * discarding the conversation. Sent only by Send.
   * `ChatHandoff` in src/web/modes/conversation/ConversationModes.tsx.
   */
  seed?: { threadId: string; text: string } | null | undefined;
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
  threadId,
  onThread,
  onSend,
  onNew,
  onSendNew,
  onDiscard,
  onRename,
  onDelete,
  onRetry,
  onEdit,
  onStop,
  onJump,
  recovering,
  blocks,
  focusNonce,
  error,
  kind,
  stance,
  onStance,
  subMode,
  live,
  onStartLive,
  seed,
}: Props) {
  useRenderCount("ChatPanel");
  const remember = kind === "remember";
  const open = threads.find((t) => t.id === threadId) ?? null;
  // A stopped session retains recovery text. It must never appear in a different thread.
  const shownLive: LiveApi | undefined = live && (live.threadId === open?.id || !live.threadId)
    ? live
    : live ? { ...live, phase: "idle", error: null, lines: [], tools: [], pointers: [],
      pendingTools: [], deviceLabel: null, notice: null, placement: null, playbackBlocked: false, hasUnsavedLines: false,
      hearing: false, speaking: false, thinking: false, threadId: null } : undefined;

  /**
   * What the reader has typed and not sent yet, per conversation.
   *
   * Here rather than in the composer because two different things need it, and
   * neither is the composer. Switching conversation used to carry the half-typed
   * question across into the next one, because the composer kept it in its own
   * state and nothing remounted it; and closing an empty conversation has to
   * know whether there was anything in the box before it throws the
   * conversation away.
   *
   * A ref rather than state: nothing above the composer renders from it, and
   * putting it in state would repaint the whole transcript on every keystroke.
   * The composer is keyed by thread id, so it reads this once on mount and owns
   * the value from then on.
   *
   * Two limits worth knowing rather than discovering. It lives as long as this
   * panel does, so a draft does not survive switching to another mode and back
   * — chat mode is unmounted, and the empty conversation it belonged to goes
   * with it. And it is keyed by thread id, so on the rare occasion the server
   * overrules an optimistic thread id (`begin` in useChat.ts — a collision, or
   * an id somebody typed into the URL) the composer remounts under the new id
   * and the draft, the scroll position and the caret are lost with it.
   */
  const drafts = useRef(new Map<string, string>());

  /**
   * The draft a keyed composer should adopt on mount.
   *
   * A lookup during render rather than a write: React may abandon a render, so
   * mutating `drafts` here would let an uncommitted tree change the committed
   * panel. The composer owns the returned value from mount onwards and writes
   * every reader edit into `drafts`, including Escape's empty string — which is
   * why this asks `has` rather than for a truthy value: a question the reader
   * cleared must not come back as the seed.
   */
  const draftFor = (id: string): string => {
    if (drafts.current.has(id)) return drafts.current.get(id) ?? "";
    if (seed?.threadId !== id) return "";
    return seed.text;
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
   * Separate from `drafts` and `focused` above rather than sharing them, and
   * each for its own reason. The draft belongs to no conversation — that is the
   * whole point of the box — so there is no id to key it by; a question typed
   * there and abandoned for a row in the list is still there when you come
   * back. And the nonce counter has to be a *different* counter, because
   * spending the panel's one here would leave the real composer unfocused the
   * next time a new conversation was started.
   */
  const listDraft = useRef("");
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
   * the list. Only off the screen, and only for as long as chat mode stays
   * open: an unsent draft is not stored anywhere, so it does not survive
   * switching modes or reloading. See `drafts` above.
   */
  const leave = async () => {
    // A new spoken thread has no chat rows until its first exchange is flushed.
    if (open && live?.threadId === open.id && live.phase !== "idle" && live.phase !== "failed") {
      await live.stop();
    }
    const unsavedSpeech = live?.threadId === open?.id && (live?.lines.length ?? 0) > 0;
    if (open && !unsavedSpeech && open.messages.length === 0 && draftFor(open.id).trim() === "") {
      drafts.current.delete(open.id);
      onDiscard(open.id);
    }
    onThread(null);
  };

  return (
    /* `mode-band` is the slot — fixed between the spine and the prose, and
       shared with the glossary. `chat` is a hook for anything only this panel
       wants; see § mode band in styles.css. */
    <ModeSurface
      feature={`chat${remember ? " remember" : ""}`}
      label={remember ? "Remember what you took from this article" : "Chat about this article"}
      head={
        <>
          <h2>{open ? open.title : remember ? "Remember" : "Chat"}</h2>
          {subMode}
          {open ? (
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
              title={remember ? "Start remembering" : "Start a new conversation"}
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
          onRetry={onRetry}
          onEdit={onEdit}
          onStop={onStop}
          focusNonce={focusNonce}
          focused={focused}
          draft={draftFor(open.id)}
          onDraft={(text) => drafts.current.set(open.id, text)}
          /* The OPEN conversation's kind, not the mode's. The list is shared,
             so a reader in Remember mode can open a chat — and when they do, the
             transcript in front of them is a chat and its composer must be
             chat's. Reading the mode here instead would put a stance picker
             under a conversation whose answers ignore it. */
          kind={open.kind}
          stance={stance}
          onStance={onStance}
          live={shownLive}
          onStartLive={onStartLive ? () => onStartLive(open.id) : undefined}
        />
      ) : threads.length === 0 && !loaded ? (
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
      ) : threads.length === 0 && loadFailed ? (
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
            threads={threads}
            onOpen={onThread}
            onNew={onNew}
            onRename={onRename}
            onDelete={onDelete}
            remember={remember}
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
              draft={listDraft.current}
              onDraft={(text) => {
                listDraft.current = text;
              }}
              placeholder={remember ? "Say what you took from this…" : "Ask something new…"}
              kind={kind}
              stance={stance}
              onStance={onStance}
              live={kind === "chat" ? shownLive : undefined}
              onStartLive={kind === "chat" && onStartLive ? () => {
                const id = onStartLive(null);
                if (id) {
                  drafts.current.set(id, listDraft.current);
                  listDraft.current = "";
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
function ArmedDelete({ onDelete }: { onDelete(): void }) {
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
      title={armed ? "Press again to delete this conversation" : "Delete this conversation"}
      onClick={() => (armed ? onDelete() : setArmed(true))}
    >
      <Trash2 size={14} />
    </button>
  );
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
function ChatListLoading() {
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
          <span>Fetching your conversations…</span>
        </>
      )}
    </div>
  );
}

/**
 * Every conversation about this article, most recently used first.
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
  onOpen,
  onNew,
  onRename,
  onDelete,
  remember,
}: {
  threads: ChatThread[];
  onOpen(id: string): void;
  onNew(): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  /** Which mode the reader pressed to get here — it only changes the wording. */
  remember: boolean;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  /* Read once here and passed to every row, so two rows a minute apart in the
     same paint cannot disagree about what "now" is. useNow.ts § why. */
  const now = useNow();
  const sorted = [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (sorted.length === 0) {
    return (
      <div className="chat-empty">
        <p>{remember ? "Nothing remembered yet." : "Nothing asked yet."}</p>
        <p className="chat-empty-hint">
          {remember
            ? "Say what you took from this article and I'll point at the places it comes apart from the piece — and at the paragraphs worth another look."
            : "Ask about anything in the article and the answer will point back at the paragraphs it came from — press one to go there."}
        </p>
        <button type="button" className="chat-new" onClick={onNew}>
          <MessageSquarePlus size={14} /> {remember ? "Start remembering" : "New conversation"}
        </button>
      </div>
    );
  }

  return (
    <ol className="chat-threads">
      {sorted.map((t) => {
        const last = lastSaid(t);
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
              <div className="chat-thread">
                <button
                  type="button"
                  className="chat-thread-open"
                  /* The title in full and the timestamps exactly — not the
                     preview line, which is a hint rather than something to read
                     here, and which the row has already cut. A `title` attribute
                     rather than the Tooltip component, because this one is plain
                     text over several lines and wants the browser's own delay:
                     a tooltip that appears the instant the pointer crosses a
                     list is a list you cannot read. */
                  title={describe(t)}
                  onClick={() => onOpen(t.id)}
                >
                  <span className="chat-thread-title">{t.title}</span>
                  {last && <span className="chat-thread-last">{last}</span>}
                  <span className="chat-thread-meta">
                    {/* The list is shared between the two modes (Greg's call,
                        2026-08-27), so the row has to say which it is — "times
                        I explained myself" and "questions I asked" are not the
                        same thing to go looking for, and the titles alone do
                        not tell them apart. Only Remember threads are tagged:
                        chat is the older and commoner kind, and tagging both
                        would put a label on every row to distinguish a minority.

                        `t.kind` is the **persisted** thread kind —
                        src/types.ts § ThreadKind. */}
                    {t.kind === "remember" && <span className="chat-thread-kind">remember</span>}
                    <span className="chat-thread-count">{turns(t)}</span>
                    {/* Recency, because the question a list of conversations
                        answers is "which was I in?". The exact time is in the
                        tooltip above. */}
                    <span className="chat-thread-when">{timeAgo(t.updatedAt, now) ?? "at some point"}</span>
                  </span>
                </button>
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
              </div>
            )}
          </li>
        );
      })}
    </ol>
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
function lastSaid(t: ChatThread): string | undefined {
  for (let i = t.messages.length - 1; i >= 0; i--) {
    const said = t.messages[i]?.text.replace(/\s+/g, " ").trim();
    if (said) return said.length > LAST_MAX ? `${said.slice(0, LAST_MAX)}…` : said;
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
  const lines = [t.title, "", `Started ${exactly(t.createdAt) ?? "at some point"}`];
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
  onRetry,
  onEdit,
  onStop,
  focusNonce,
  focused,
  draft,
  onDraft,
  kind,
  stance,
  onStance,
  live,
  onStartLive,
}: {
  /** The article, so the composer's dictation can be primed with its vocabulary. */
  slug: string;
  thread: ChatThread;
  onJump(id: BlockId): void;
  /** See `recovering` in Props. */
  recovering: Set<string>;
  blocks: Map<string, string>;
  onSend(question: string): void;
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
   * is rather than silently getting a chat. The stance below is optional
   * because a chat has none, and `ChatDialog` — which is always a chat —
   * therefore passes nothing.
   */
  kind: ThreadKind;
  stance?: RememberStance;
  onStance?: ((next: RememberStance) => void) | undefined;
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
   * Follow the answer down as it arrives — but only if the reader is already at
   * the bottom.
   *
   * Scrolling up to re-read an earlier turn while the next one streams in is an
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run triggers — the effect reads a ref, and these are what say "new text has been painted, scroll if we were following"
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
    /* And this half **only ever clears**, which is the whole discipline.
       Content growing must never decide the reader has scrolled away — that was
       the bug the note above describes. But content *shrinking* can strand a
       "Latest" button pointing at a bottom already on screen, and no scroll
       event need fire to say so: an edit that discards three turns can leave a
       transcript shorter than the panel, with nothing to scroll to and a pill
       offering to take you there. Seen in a browser pass, 2026-08-26. */
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) {
      stick.current = true;
      setAway(false);
    }
    /* `last?.status` is in here for a reason that is easy to leave out and was.
       The frame that ends an answer usually changes neither of the other two —
       `done` carries the same text the deltas already built, and adds no row —
       while adding the action row and, if the model searched, the whole list of
       sources. So the one commit that reliably grows the transcript by more
       than the 60px slack was the one commit this effect did not run on: the
       reader was pinned to the bottom, the answer finished, and they were left
       above the sources with no Latest button either, because `away` is only
       ever cleared in here. That is the *same* bug the note above describes,
       surviving its own fix in the dependency array. Found by a GPT-5.6 review,
       2026-08-26. */
  }, [chars, thread.messages.length, last?.status]);

  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = true;
    setAway(false);
    el.scrollTop = el.scrollHeight;
  };

  return (
    <>
      <div
        className="chat-scroll"
        ref={scroller}
        /* The one place `stick` is decided — see the note above. Fired by the
           reader's own scrolling and by the effect's `scrollTop = scrollHeight`
           alike, and both mean the same thing here: this is where the view is
           now. `away` is set beside it rather than derived later, so a button
           and a ref cannot end up disagreeing about where the reader is. */
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          stick.current = atBottom;
          setAway(!atBottom);
        }}
      >
        {thread.messages.length === 0 &&
          (kind === "remember" ? <RememberInvitation /> : <Suggestions onAsk={(q) => onSend(q)} />)}
        {thread.messages.map((m, i) => (
          <Turn
            key={m.id}
            message={m}
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
        busy={busy}
        onStop={busy && last ? () => onStop(last.id) : undefined}
        focusNonce={focusNonce}
        focused={focused}
        draft={draft}
        onDraft={onDraft}
        kind={kind}
        {...(stance ? { stance } : {})}
        {...(onStance ? { onStance } : {})}
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
 * The opening state of a **Remember thread**, which is not a list of suggestions and
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
function RememberInvitation() {
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

function Turn({
  message,
  onJump,
  recovering,
  blocks,
  onRetry,
  onEdit,
  canEdit,
  editing,
  onEditing,
  discards,
}: {
  message: ChatMessage;
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
  useEffect(() => {
    if (wasEditing.current && !editing) pencil.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

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
      <div className="chat-turn you">
        {message.text}
        {message.editedAt && (
          /* The only trace that this conversation once went elsewhere. Without
             it, a reader coming back to a thread they edited reads answers that
             do not quite match the questions and has no way to know why. */
          <span className="chat-edited" title="You rewrote this question">
            edited
          </span>
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
  /* "thinking…" only while nothing at all is happening. Once a tool is running
     the strip below says what, which is a better answer to the same question —
     and both at once reads as two spinners for one wait. */
  const thinking =
    message.status === "pending" &&
    message.text === "" &&
    (message.tools?.length ?? 0) === 0 &&
    !recovering;
  return (
    <div className={`chat-turn model${message.status === "error" ? " failed" : ""}`}>
      <ToolStrip tools={message.tools} searches={message.searches} />
      {thinking ? (
        <span className="chat-thinking">
          <LoaderCircle className="cmt-spinner" size={13} /> thinking…
        </span>
      ) : message.text === "" ? /* Stopped before a word arrived, or failed
          before one did. `Answer` splits on blank lines and would render one
          empty paragraph, which is a stray gap above the line that explains
          it. */ null : (
        <Answer
          text={message.text}
          onJump={onJump}
          blocks={blocks}
          /* Tooltips only once the answer has landed — see Cited.tsx. */
          live={message.status === "pending"}
        />
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
        message.status === "pending" && message.text !== "" && <span className="chat-cursor" />
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
          {/* **Which stance produced this answer**, on Remember turns only.
              A Socratic reply and a Respond reply to the same words look very
              different, and a reader who moved the picker three turns ago has
              no other way to tell why. It is also the honest label for a retry,
              which re-asks in the voice the answer was originally asked in
              rather than in whatever the picker says now.
              Not on `balanced`: that is the default and most answers are it, so
              labelling them would put a tag on nearly every turn to distinguish
              a minority — the same call the thread list's Remember tag makes. */}
          {message.stance && message.stance !== "balanced" && (
            <span className="chat-stance-tag" title={`Asked for a ${message.stance} reply`}>
              {message.stance}
            </span>
          )}
          {message.text !== "" && <CopyAnswer text={message.text} />}
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
 * The tick is not decoration either. `navigator.clipboard` is a promise that
 * can reject — no permission, a browser that will not do it from this event —
 * and a copy button that has visibly done nothing is the silent-success shape
 * (docs/reusable/silent-success.md). So the state has three values, not two,
 * and a refusal says so.
 *
 * **The guard is a statement rather than `navigator.clipboard?.writeText(…)`,
 * and that is not style.** Optional chaining short-circuits the *whole* chain,
 * `.catch` included: where there is no clipboard object the expression is
 * `undefined`, nothing throws, nothing rejects, and `state` stays `"idle"` —
 * a copy button that quietly does nothing, inside the very component whose
 * comment claims that cannot happen. And "no clipboard object" is not exotic:
 * `navigator.clipboard` is undefined in every insecure context, which includes
 * reaching this app at `http://192.168.1.x:5273` from a phone. Written the
 * careless way first, caught in review, 2026-08-26.
 */
function CopyAnswer({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  // Cleared on a timer, and the timer is cleaned up: a reader who leaves the
  // thread mid-tick would otherwise get a setState on an unmounted component.
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);
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
      onClick={() => {
        if (!navigator.clipboard) {
          setState("failed");
          return;
        }
        navigator.clipboard
          .writeText(text)
          .then(() => setState("copied"))
          .catch(() => setState("failed"));
      }}
    >
      {state === "copied" ? (
        <ClipboardCheck size={12} />
      ) : state === "failed" ? (
        <X size={12} />
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
    <div className="chat-turn you editing">
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
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canAsk) onDone(value);
          }
        }}
      />
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
          disabled={!canAsk}
          onClick={() => onDone(value)}
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
  return (
    /* One group for the whole answer, so moving along a row of citations shows
       each card immediately instead of waiting out the open delay again. Same
       reason the dock's placeholder buttons share one — Tooltip.tsx. */
    <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={500}>
      {/* The blocks, the chips, the hover cards, the web links and the marks
          all live in Cited.tsx, shared with the summary panel. Two copies of
          what a citation looks like would drift, and a chip that means
          something slightly different depending on which band it is in is
          worse than either version. */}
      <CitedMarkdown
        text={text}
        blocks={blocks}
        onJump={onJump}
        live={live}
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
      />
    </TooltipGroup>
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
  busy,
  onStop,
  focusNonce,
  focused,
  draft,
  onDraft,
  placeholder,
  kind = "chat",
  stance = "balanced",
  onStance,
  live,
  onStartLive,
  continuesLive,
  blocks,
  onJump,
}: {
  slug: string;
  onSend(question: string): void;
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
   * Chat or Remember. **Everything that makes this box work is shared** — the
   * draft, the focus nonce, the auto-resize, Enter to send, the Escape ladder,
   * the key-propagation stop that keeps the article's ↑/↓ out of the caret, the
   * `readOnly` gate while a transcript is arriving, the dictation button and
   * strip. Those are the parts that are subtle and the parts where a second
   * copy would drift; a Remember box that reimplemented the Escape ladder would
   * be a bug nobody found for a month.
   *
   * What the kind changes is layout and one control: a box six rows tall
   * instead of one, and a stance `<select>`. Greg, 2026-08-27: *"the input box
   * should be much larger for Review mode, and probably emphasise the
   * microphone UI, because talking will be much less annoying than typing."*
   */
  kind?: ThreadKind;
  /** The stance the next Remember answer will be asked for. Ignored in chat. */
  stance?: RememberStance;
  onStance?: ((next: RememberStance) => void) | undefined;
  /** Optional on surfaces without a live-session owner, such as ChatDialog. */
  live?: LiveApi | undefined;
  /** Begin one. The panel supplies or creates the conversation. */
  onStartLive?: (() => void) | undefined;
  continuesLive?: boolean | undefined;
  blocks?: ReadonlyMap<string, string> | undefined;
  onJump?: ((id: BlockId) => void) | undefined;
}) {
  /* Seeded from the draft and owned here from then on. The panel keeps the map
     because it outlives this component; this keeps the value because typing
     into it must not repaint the transcript above. */
  const [value, setValue] = useState(draft);
  const remember = kind === "remember";
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
   * (`seed` in `ChatPanel`), `focus()` alone left the caret before the first
   * word — measured in Chrome — so the reader's first keystroke landed in front
   * of the question rather than after it.
   */
  useEffect(() => {
    if (focusNonce > focused.current) {
      focused.current = focusNonce;
      const el = box.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [focusNonce, focused]);

  // Height follows content. Reset to `auto` first, or the box can only ever
  // grow: `scrollHeight` of an element already tall enough is its own height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect measures the DOM rather than reading `value`, but `value` is what changed it
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    /* Twice chat's ceiling for a Remember turn. A chat question is a sentence; a
       spoken Remember turn is a paragraph or three, and a box that stops growing at
       160px turns the reader's own words into a four-line scrolling window they
       cannot read back before sending. `rows` below sets the floor; this sets
       the roof. */
    el.style.height = `${Math.min(el.scrollHeight, remember ? 360 : 160)}px`;
  }, [value, remember]);

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
  const dictate = useDictationField({
    value,
    onChange: (next) => {
      setValue(next);
      onDraft(next);
    },
    box,
    context: { kind: "article", slug },
    transcribe: sendForTranscription,
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
    if (dictate.readOnly || dictate.dictation.armed) return;
    const question = value.trim();
    if (question === "" || busy) return;
    setValue("");
    onDraft("");
    if (live && live.phase !== "idle" && live.phase !== "failed") await live.stop();
    onSend(question);
  };

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
        rows={remember ? 6 : 1}
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
            : remember
              ? "Tell me what you took from this, in your own words. Ramble — it doesn't need to be tidy."
              : (placeholder ?? "Ask about this article…")
        }
        onChange={(e) => {
          setValue(e.target.value);
          // The panel keeps the draft so it survives this component; see
          // `drafts` in ChatPanel.
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
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          /* Escape, in three steps, most-urgent first.

             It has to be a ladder rather than one action because the composer
             swallows every key press (see above), so Escape has no other
             meaning available to it — and the three things a reader wants from
             it here are genuinely different: stop the answer, drop the question
             I was typing, give me the reading keys back. Doing them in that
             order means the destructive one is never reached by accident: you
             cannot clear a draft you have not typed, and you cannot blur while
             there is anything else Escape could still be for. */
          if (e.key === "Escape") {
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
        <button
          type="submit"
          className="chat-send"
          /* `armed` beside `readOnly` for the reason `submit` above gives — and
             a button the guard would refuse must not look pressable, or the
             reader presses Send while talking and nothing at all happens. */
          disabled={busy || dictate.readOnly || dictate.dictation.armed || value.trim() === ""}
          title="Send (Enter)"
        >
          {/* 18 in the 36px box (--control-h); the stroke stays the house 1.75.
              docs/plans/260912c-send-button-icon-and-primary-style.md. */}
          {busy ? <LoaderCircle className="cmt-spinner" size={18} /> : <SendHorizontal size={18} />}
        </button>
      )}
      {dictate.dictation.supported &&
        (remember ? (
          /* **Labelled, and first in the row.** Greg asked for the microphone to
             be emphasised here because talking a paragraph is so much less
             annoying than typing one — and an unlabelled icon among three other
             unlabelled icons is not an invitation to talk, it is a control you
             have to already know about. The button itself is the SAME component
             chat uses (`DictationButton`, over `useDictationField`), so the four
             phases, the disabled-while-transcribing rule and the article's own
             glossary priming all come along unchanged. Only the label is new. */
          <span className="chat-talk">
            <DictationButton dictation={dictate.dictation} toggle={toggleDictation} disabled={busy} />
            <span className="chat-talk-label" aria-hidden="true">
              {dictate.dictation.armed ? "Listening…" : dictate.readOnly ? "Writing it down…" : "Talk"}
            </span>
          </span>
        ) : (
          <DictationButton dictation={dictate.dictation} toggle={toggleDictation} disabled={busy} />
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
          labelled={remember}
          continues={continuesLive}
        />
      )}
      {remember && onStance && (
        /* **A native `<select>`, not a custom radiogroup**, and that is a
           keyboard decision rather than a lazy one. The dock already owns a
           roving-tabindex radiogroup for the modes; a second one *inside* the
           composer would sit where arrow keys are already the caret's, and the
           article's own ↑/↓ navigation is a third claimant. A select has all of
           this for free and announces itself correctly. GPT Sol's review of
           docs/plans/260827ah-review-mode.md.

           Its own `onKeyDown` stop, for the same reason the textarea has one:
           this form sits inside the reading view, whose keynav listens on the
           window. */
        <label className="chat-stance">
          <span className="chat-stance-label">Reply</span>
          <select
            value={stance}
            disabled={busy}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => onStance(e.target.value as RememberStance)}
            title="How much the answer should say"
          >
            <option value="balanced">Balanced</option>
            <option value="respond">Respond</option>
            <option value="socratic">Socratic</option>
            <option value="signposts">Signposts</option>
          </select>
        </label>
      )}
      <DictationStrip dictation={dictate.dictation} />
      {live && onStartLive && <LiveStatus
        live={live}
        onRestart={onStartLive}
        blocks={blocks}
        onJump={onJump}
        onType={() => {
          void (async () => {
            if (live.phase !== "idle" && live.phase !== "failed") await live.stop();
            box.current?.focus();
          })();
        }}
        onDictate={dictate.dictation.supported && !busy && !dictate.readOnly ? toggleDictation : undefined}
      />}
    </form>
  );
}
