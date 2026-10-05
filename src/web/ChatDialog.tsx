/**
 * The panel a selection opens — see docs/plans/260826ab-chat-as-gateway.md.
 *
 * Two things in one slot, because they are two moments of one gesture:
 *
 *  - **the ask box**, when the reader has selected something and nothing has
 *    been bought yet: the passage, one input, and two buttons;
 *  - **the conversation**, once they have asked.
 *
 * Before 2026-08-26 letting go of the mouse spent a model call and streamed an
 * explanation into a dialog that was the end of the road. Greg's call: the
 * selection becomes a door into chat, and nothing is spent until somebody asks
 * for something.
 *
 * ## Why it floats rather than switching to chat mode
 *
 * Chat is a mode, and entering it replaces the reading columns. Greg picked the
 * more expensive option with the cost stated in front of him: *"floating chat is
 * probably better, with an easy way to open the full chat."* The article stays
 * on screen behind the panel, and one line gets you to the full view — which is
 * `setMode("chat")` and nothing more, because the panel and the band read the
 * same `?thread=`.
 *
 * ## It is not `ChatPanel` shrunk
 *
 * `ChatPanel` is mostly the thread list, the rename row and the suggestions
 * grid, none of which belongs in a panel about one passage. What it does have
 * is `Conversation` and `Composer`, which are imported here unchanged and given
 * a narrower container. `useChat` lives **here** rather than in `Reader`, and
 * that placement is the point: it calls `setThreads` on every streamed token,
 * so holding it above `TableView` would re-render and re-`annotateHtml` every
 * paragraph of the article hundreds of times while one answer arrives. The
 * reading view reads `useChatAnchors` instead.
 *
 * ## The header does not move
 *
 * Greg, 2026-08-26: *"the cross in the top-right keeps moving as the text
 * streams in."* Two separate causes, and fixing either alone leaves it moving —
 * the box is pinned by its bottom edge so it grows upward, and the whole box
 * scrolls so the header then leaves out of the top. So: three parts, only the
 * middle one scrolls, and a stable height once there is a transcript. The
 * matching rules are in styles.css § the floating panels.
 *
 * ## Three places, one panel
 *
 * Floating in the corner; docked over the Marginalia column (plan 261003p);
 * or, on trial since 261004k, a card in that column level with the block it
 * is about. `Reader` decides and this component is told (`dockRoom`, `card`).
 * It is the same `<aside>` in all three, drawn through one portal whose
 * container is moved — § One panel, one container, moved, below — so a
 * change of place never remounts the conversation.
 */
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, LoaderCircle, MessageSquare, Square, X } from "lucide-react";

import type { BlockId, ChatAnchor, ChatThread, ThreadSummary } from "../types.js";
import { Composer, Conversation } from "./ChatPanel.js";
import { chatDraftsFor } from "./chat-draft.js";
import { askAboutBlock, HELP_QUESTION } from "./chat-handoff.js";
import { shortBlockId } from "./BlockRef.js";
/* **The client's own creation window, imported rather than restated.** This
   rule's whole claim is "longer than a send may legitimately take to open a
   conversation", so a second copy of that number is a way for the claim to
   quietly stop being true. src/web/chat/effects.ts says why it is three
   minutes. */
import { OPEN_TIMEOUT_MS } from "./chat/effects.js";
import { CHAT_DOCK_INSET } from "./layout.js";
import { useChat } from "./useChat.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { keyboardInsetStyle, useVisualViewport } from "./useVisualViewport.js";
import { withVoice } from "./voice.js";

/**
 * What the panel is open on.
 *
 * `draft` is a passage the reader has selected or a paragraph they pressed,
 * with no conversation behind it yet — nothing is stored, and closing it costs
 * nothing. `thread` is a conversation that exists. The two are one union
 * because they occupy one slot and the transition between them has to be
 * atomic: the ask box does not close and a panel open, it becomes one.
 */
export type ChatTarget =
  | {
      kind: "draft";
      anchor: ChatAnchor;
      /** The passage, or a paragraph's opening words — shown above the box. */
      opening: string;
      /**
       * Text to start the box with.
       *
       * Set when the reader typed a follow-up into the explanation panel: their
       * words are carried across and **not sent**. Firing a question typed in
       * one box from another is a model call they did not quite ask for, which
       * is the thing this whole change is about.
       */
      question?: string;
      /**
       * The comment this conversation is being started from, if it is.
       *
       * Set only when the reader ticked "Also ask the AI" on a comment they
       * have just saved. Passed through to the send and no further: the
       * **server** writes the link, because the thread id this client is about
       * to mint is a guess it only finds out was overruled if it was. See
       * docs/plans/260828a-comments-and-bookmarks.md § the Save & ask choreography.
       */
      sourceCommentId?: string;
      /**
       * **The reader pressed "?" rather than opening the composer.**
       *
       * One field, because it is one decision. Three things follow from it and
       * none of them makes sense without the others: the question is
       * `HELP_QUESTION` rather than anything they typed, it is **sent on mount
       * without being shown to them first**, and the block's opening words go
       * into the message so the transcript says which paragraph they were
       * looking at.
       *
       * **Not `question` plus an `autoSend` flag**, which was the first shape.
       * `question` is documented as text carried across and deliberately *not*
       * sent — the reader's half-typed follow-up — so spending a model call
       * from the same field would have made that sentence false at one of its
       * two call sites. Two names for two behaviours.
       */
      help?: true;
    }
  | { kind: "thread"; threadId: string };

interface Props {
  slug: string;
  target: ChatTarget;
  /** Where the reader is, so the answer knows what "here" means. */
  at: string | null;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  /** The reader closed the panel. The URL parameter is the caller's to clear. */
  onClose(): void;
  /** A conversation now exists under this id — point `?thread=` at it. */
  onThread(id: string): void;
  /** Leave the panel and open the same conversation full width. */
  onOpenFull(): void;
  /**
   * **Start a second conversation about the same paragraph.**
   *
   * The door that stage 1 of
   * docs/plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md
   * had to leave open. Before it, the gutter's chat chip always started a new
   * whole-block conversation; after it, the chip *reopens* and never starts
   * one, and the "?" reopens too — so without this there is no gesture anywhere
   * that begins a second conversation about a paragraph, and the change would
   * be a removal rather than a fix. Sol wanted it cut; Fable and Greg kept it,
   * as one more text button in a row that already exists.
   *
   * **It must force a draft**, which is why it is a prop of its own rather than
   * the chip's callback handed down: that one would look at the summaries, find
   * the conversation the reader is standing in, and reopen it.
   */
  onNewConversation?(blockId: BlockId): void;
  /** Told when a thread appears or goes, so the prose can draw or drop its mark. */
  onCreated(summary: ThreadSummary): void;
  onDropped(threadId: string): void;
  /**
   * An answer in this panel has just stopped arriving: finished, failed or
   * stopped. Whoever holds the thread summaries asks for them again, so a mark
   * that shows a conversation's latest line (a Debate claim's) follows a
   * follow-up asked here. Once per answer, never per token. Plan 261005i, F1.
   */
  onSettled?(): void;
  /**
   * **The room the panel has over the marginalia column, in px — or `null` to
   * float in the corner as it always has.** layout.ts § `chatDock` decides;
   * `Reader` passes it.
   *
   * A class and two custom properties on the same `<aside>`, and nothing else:
   * a window dragged across the threshold with a question half typed must keep
   * it, so docking can never be a different element or a different branch.
   * Optional, so a caller with no column has nothing to say.
   */
  dockRoom?: number | null;
  /**
   * **The card: a host in the anchor block's cell to be drawn in, and how wide
   * — or `null` for the panel above** (docked if `dockRoom` says so, else
   * floating). `Reader` decides, and hands a host only when it has one in
   * hand, so "no card" always falls back to something visible.
   * docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md.
   *
   * It wins over `dockRoom` rather than replacing it: `Reader` passes both, and
   * the room is what the panel falls back to the moment the host goes.
   */
  card?: ChatCardPlace | null;
  /**
   * **A count of the presses that asked for a conversation to be open** —
   * the gutter's chip, the "?", a mark, the margin's line, the Comments drawer.
   * They write `?thread=` and nothing else, so a press naming the conversation
   * already open changes nothing this panel could otherwise see, and a
   * collapsed card would sit there ignoring it (GPT Sol on the plan, F1).
   */
  reopen?: number;
}

/** Where the card goes: `Reader`'s host element, and layout.ts § `chatCard`'s width. */
export interface ChatCardPlace {
  host: HTMLElement;
  width: number;
}

/**
 * **The three places the one panel can be**, decided on every render from the
 * two props. A union so that a card cannot also carry a dock's room, and the
 * class, the style and the attach point are read off one value.
 */
type Placement =
  | { kind: "float" }
  | { kind: "dock"; room: number }
  | { kind: "card"; host: HTMLElement; width: number };

/**
 * **What a move would lose, read before it happens.** Re-parenting a DOM node
 * keeps React's state and drops the browser's: the focused element blurs, and
 * every scroller under it goes back to the top.
 */
interface Kept {
  focus: HTMLElement | null;
  scroll: (readonly [HTMLElement, number])[];
}

function scrollOffsets(root: HTMLElement): Kept["scroll"] {
  const out: (readonly [HTMLElement, number])[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("*")) if (el.scrollTop > 0) out.push([el, el.scrollTop]);
  return out;
}

function keep(root: HTMLElement): Kept {
  const at = document.activeElement;
  return {
    focus: at instanceof HTMLElement && root.contains(at) ? at : null,
    scroll: scrollOffsets(root),
  };
}

function putBack(kept: Kept): void {
  for (const [el, top] of kept.scroll) if (el.scrollTop !== top) el.scrollTop = top;
  /* `preventScroll`: the panel has moved, the reader has not. */
  if (kept.focus?.isConnected && document.activeElement !== kept.focus)
    kept.focus.focus({ preventScroll: true });
}

/**
 * **The collapsed card's second line**: an answer on its way, else the first
 * line of the latest answer, else how many questions there are. The cut is the
 * one `summarise` makes for a summary's `lastLine` (src/routes.ts) — but this
 * reads the live transcript, so it is right while the summary is still stale.
 */
type CardLine =
  | { kind: "answering" }
  | { kind: "answer"; text: string }
  | { kind: "questions"; count: number };

function cardLine(thread: ChatThread, streaming: boolean): CardLine {
  if (streaming) return { kind: "answering" };
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m?.role !== "assistant") continue;
    const first = m.text.trim().split(/\n/)[0]?.trim();
    if (first) return { kind: "answer", text: first };
  }
  return { kind: "questions", count: thread.messages.filter((m) => m.role === "user").length };
}

export function ChatDialog({
  slug,
  target,
  at,
  blocks,
  onJump,
  onClose,
  onThread,
  onOpenFull,
  onNewConversation,
  onCreated,
  onDropped,
  onSettled,
  dockRoom = null,
  card = null,
  reopen = 0,
}: Props) {
  const {
    threads,
    loaded,
    loadFailed,
    recovering,
    send,
    retry,
    edit,
    stop,
    cancelAndDiscard,
    remove,
    error,
  } = useChat(slug, onSettled);

  const thread = target.kind === "thread" ? threads.find((t) => t.id === target.threadId) : undefined;

  /* The paragraph a "New conversation" would be about, or `undefined` if this
     conversation is not anchored to one. See the button in the footer. */
  const newAbout: BlockId | undefined = thread?.anchor?.blockId;

  /* The composer's draft, owned here because `Composer` is remounted whenever
     the panel swaps between its two shapes and would otherwise lose what was
     typed. Same reason `ChatPanel` keeps a map of them.

     The target key travels with the text so a different thread (or draft block)
     gets its own initial value in the render that mounts its Composer. An effect
     is too late: Composer seeds local state from `draft` once, so it would keep
     the previous thread's half-typed question even after the parent cleared its
     copy.

     **That is the passage arm's draft, and only its.** A conversation's unsent
     words are the article's (src/web/chat-draft.ts), the same entry Chat
     mode's composer reads and writes, because the two are one conversation
     seen from two places and never at once: entering Chat unmounts this
     dialog, and leaving Chat can mount it on the conversation that was open.
     Two private copies would be two different half-questions, and a delete
     pressed here would leave Chat's copy behind for a conversation that is
     gone. GPT Sol's review of
     docs/plans/261004j-chat-keeps-an-unsent-question-across-a-mode-change.md,
     F5. A passage draft is about a paragraph and belongs to no conversation
     yet, so it stays here. */
  const drafts = chatDraftsFor(slug);
  const draftTarget = target.kind === "draft" ? `draft:${target.anchor.blockId}` : `thread:${target.threadId}`;
  const initialDraft = target.kind === "draft" ? (target.question ?? "") : "";
  const [draftState, setDraftState] = useState(() => ({ target: draftTarget, text: initialDraft }));
  const threadTarget = target.kind === "thread" ? target.threadId : null;
  const draft =
    threadTarget !== null
      ? (drafts.thread(threadTarget) ?? "")
      : draftState.target === draftTarget
        ? draftState.text
        : initialDraft;
  const setDraft = useCallback(
    (text: string) => {
      if (threadTarget !== null) drafts.setThread(threadTarget, text);
      else setDraftState({ target: draftTarget, text });
    },
    [draftTarget, threadTarget, drafts],
  );
  const focused = useRef(0);

  /* Mounted means on screen here, as it does for `.cmt-dialog`. */
  const visible = useVisualViewport(true);

  /**
   * A conversation the reader has just started, still being minted.
   *
   * Between pressing Ask and the `begin` frame there is a thread id we guessed
   * and no stored conversation. The panel must show the conversation in that
   * window — that is the whole feel of the thing — so `target` is moved to
   * `thread` immediately by the caller, and this covers the gap where
   * `threads.find` comes back empty.
   *
   * **`loaded` is not `!loadFailed`**, and the difference is the one fix this
   * condition took away from stage 3. `useChat.loaded` means *the request
   * finished*; a failed GET produces no threads, which without `loadFailed`
   * reads exactly like a conversation that is not there — so an outage told the
   * reader their work had been deleted. `loadFailed` has carried that
   * distinction since 2026-08-27 and this panel was ignoring it.
   *
   * ## How long it waits before saying the conversation is gone
   *
   * `missing` is the observation — a load that **succeeded** and does not have
   * this id. On its own that used to mean "Starting…" for ever, which made
   * "That conversation no longer exists" below unreachable and left a stale
   * `?thread=` spinning with no Stop, no Delete and no retry. Harmless while
   * every conversation began with the reader typing one; the "?" is what makes
   * it permanent, because that button **reopens from a summary** rather than
   * always starting a fresh draft the way the chat button does. Press "?",
   * close before the `begin` frame, have the POST fail, press again — and every
   * later press lands back on the same endless spinner. GPT Sol, four passes.
   *
   * **The wait is the whole of the evidence, and it needs nothing else.** Two
   * earlier fixes tried to know *who created the id*, and both were worse than
   * the defect:
   *
   *  1. *"This panel did not mint it, so it is gone"* — a panel is not the
   *     operation's lifetime. The send outlives the unmount, so reopening gives
   *     a new panel an empty ref while a real POST is still in the air: live
   *     conversations declared dead and their shortcuts thrown away.
   *  2. The inverse, *"we minted it and no row in 30s"* — provable, and it
   *     **never fires**, because `send` inserts the thread optimistically
   *     before the request leaves (useChat.ts). `!thread` is false for exactly
   *     the ids this panel minted. It passed only against a mock that omitted
   *     that insert.
   *
   * Provenance turned out to be the wrong question. `OPEN_TIMEOUT_MS` is how long
   * the client itself allows a send to open a conversation, so a **successful**
   * load that still lacks the id after that long is not waiting for anything.
   * That is true whoever created it, which is why no ref survives here.
   *
   * It costs a long spinner once, in a case that was previously permanent, and
   * then repairs itself: `gone` drops the summary, so the next press mints a
   * real conversation instead of returning here. The normal path never starts
   * the timer at all — the optimistic insert means `missing` is false for a
   * conversation this panel just began.
   *
   * **`loaded` is not `!loadFailed`.** A failed GET produces no threads, which
   * without that term reads exactly like a conversation that is not there — so
   * an outage told the reader their work had been deleted, and an earlier draft
   * of this rule would have *acted* on it and dropped the summary.
   */
  const missing = target.kind === "thread" && loaded && !loadFailed && !thread;

  /**
   * **The id we have waited the whole creation window for — an id, not a flag.**
   *
   * A boolean here is a bug, and it is a subtle one: after conversation A times
   * out, a straight swap to a missing conversation B renders once with the
   * verdict still true, and anything reading it in *that* render has condemned
   * B on a clock started for A. Storing which id was waited out makes the
   * comparison below true only of the thing it was measured for, so the
   * transfer cannot happen and no reset effect is needed. GPT Sol, fifth pass,
   * 2026-09-05 — my swap test missed it by swapping before the first deadline.
   */
  const [timedOut, setTimedOut] = useState<string | null>(null);
  const missingId = missing && target.kind === "thread" ? target.threadId : null;
  useEffect(() => {
    if (!missingId) return;
    const t = setTimeout(() => setTimedOut(missingId), OPEN_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [missingId]);

  /**
   * **Waited out, and therefore *offered a way forward* rather than declared
   * dead.**
   *
   * The conclusion this panel is entitled to draw is weaker than it looks, and
   * three separate things stop it being "the conversation does not exist":
   * `useChat` makes one GET and never refreshes, so the snapshot is old however
   * long we wait; a failed request can come back as a cached synthetic 200, so
   * `loadFailed` is not always false-negative-proof; and the client's timeout
   * does not bound the *server*, which persists the thread before it installs
   * the listener that would notice the browser leaving. A write that timed out
   * has an ambiguous outcome by construction.
   *
   * So nothing is dropped automatically. Two earlier drafts did — one on sight,
   * one on this timer — and both were inferring a deletion from evidence that
   * cannot support one, which is how you lose a reader's live conversation.
   * What the reader gets instead is the truth and a button: this has not
   * started, and here is how to move on. Pressing it is *their* decision to
   * abandon this page's shortcut to it, which is the only authority available.
   *
   * That still closes the route stage 3 opened. The dead button came from
   * `helpThreadFor` returning a stale summary for ever; one press of Start over
   * removes it, and the next "?" mints a real conversation.
   */
  const stalled = missing && target.kind === "thread" && timedOut === target.threadId;
  const starting = missing && !stalled;

  useEscapeToClose(onClose);

  /**
   * ## The dialog gives the keyboard back
   *
   * The same modeless lifecycle `CommentDialog` has (§ *The dialog takes focus,
   * and gives it back*) and the Comments drawer before it, and it is here for
   * the same reason: **this box takes focus and then unmounts the element
   * holding it.** The `draft` arm focuses its composer (`focusNonce={1}`), so
   * closing the dialog drops the reader on `<body>` and their next Tab starts
   * again from the top of the article.
   *
   * **The opener is a real control and it is always gone**, which is stronger
   * than `CommentDialog`'s case rather than weaker. A chat draft is opened from
   * the block gutter's Help button (`reader/Reader.tsx § helpAboutBlock`, wired
   * to `BlockGutter`'s `onHelp`), and that handler calls `setOpen(false)`
   * **before** `onHelp(id)` — so the disclosure collapses and takes the pressed
   * button with it. `isConnected` is therefore not defensive tidiness here, it
   * is the ordinary path, and the fallback is what actually runs.
   *
   * **The ordinary fallback is the passage's own "…", not a mode button.** There
   * is no Chat button in the dock to fall back to — Chat is a mode in the
   * radiogroup — and choosing one would put the reader somewhere they never
   * were. The row's `.blk-more` is where a gutter opener came from, it is always
   * rendered rather than only while the disclosure is open, and it is where
   * `BlockGutter` itself restores focus on Escape. The row is remembered at
   * mount, because by cleanup the button that names it has gone.
   *
   * A question reopened from the Comments drawer has no article row: closing
   * the drawer removes that opener in the same commit that mounts this dialog.
   * In that one path the Comments button is the stable place the reader came
   * through, matching `CommentDialog`'s drawer lifecycle.
   *
   * **No trap and no `aria-modal`**, unchanged — the prose behind stays live,
   * which is the whole point of a modeless dialog and is argued at length in
   * `CommentDialog`.
   *
   * GPT Sol F42, 2026-09-07. Its sibling finding about `AnnotateDialog` was
   * **not** built, and the reason is written in the plan: Annotate is reachable
   * only through `onMouseUp` after a drag across the prose, and a drag across
   * non-focusable text has already blurred to `<body>` — measured in Chrome —
   * so it opens from body and returns to body, losing nothing.
   */
  /**
   * **Captured during the first render, not in an effect**, and that is the one
   * subtle thing here. React runs a child's effects before its parent's, and the
   * composer inside this panel focuses itself on mount — so a parent effect
   * asking `document.activeElement` gets *the composer*, not the control the
   * reader pressed. It recorded the panel as its own opener and restored focus
   * to a textarea that was being deleted. A test caught it; the lazy
   * initialiser below runs before any of that.
   *
   * `CommentDialog` does not hit this because it takes focus in the same effect
   * that records the opener, so the read happens first by construction.
   */
  const [opened] = useState(() => {
    const at = typeof document === "undefined" ? null : document.activeElement;
    const opener = at instanceof HTMLElement ? at : null;
    /* The row is remembered now too, while the button that names it is still in
       the document — by cleanup the disclosure has collapsed and taken it. */
    return { opener, row: opener?.closest("tr[data-block]") ?? null };
  });
  /**
   * **Which arm the dialog opened in, frozen at mount.**
   *
   * `target` changes underneath a mounted dialog — a draft becomes a thread the
   * moment the first question is sent — so anything keyed on the *current* kind
   * would fire then. That is precisely the moment focus must not move: the
   * reader has just typed, and the composer is where they are.
   */
  const [openedAs] = useState(() => target.kind);
  /** The panel itself, so a change of conversation can ask whether the caret was in its composer. */
  const box = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * ## One panel, one container, moved
   *
   * The `<aside>` is **always** drawn through a portal into one `<div>` this
   * component makes once, and that `<div>` is what moves: into the card's host
   * in the anchor block's cell, or back to `home` — a mount point where the
   * panel has always been in the tree, inside `.reader`, so the docked rule
   * still finds `--marg-left`. Plan 261004k § 1.
   *
   * **The portal's target never changes, so nothing under it remounts.** The
   * first design switched `createPortal` on and off, and GPT Sol's probe (F5)
   * showed what that costs: React keeps this component and remounts everything
   * drawn through the portal, so `Conversation` lost its scroll position and an
   * open question editor, and a running dictation was aborted by its own
   * cleanup. A window dragged across the threshold with a question half typed,
   * a section folded over an open chat, Marginalia switched off — each is a
   * move, and none of them may be a remount.
   *
   * **Events are unaffected by where the container sits.** React bubbles
   * through the React tree, so a click or a mouse-up in the card never reaches
   * `TableView`'s handlers on the cell it is physically inside: no row is
   * selected, no selection is read, no comment opens.
   */
  const [container] = useState(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.className = "chat-dialog-mount";
    return el;
  });
  const home = useRef<HTMLDivElement | null>(null);
  /**
   * **Attached as the mount point's ref lands, not in an effect.** React
   * attaches a ref before it runs the layout effects of the siblings after it,
   * and the portal is the sibling after: so the panel is in the document by the
   * time the composer inside it measures its own `scrollHeight` to size itself
   * (ChatPanel.tsx § Height follows content). A detached textarea measures 0.
   * tests/chat-dialog-in-column.test.tsx holds the order.
   */
  const setHome = useCallback(
    (el: HTMLDivElement | null) => {
      home.current = el;
      if (el && container && container.parentNode === null) el.appendChild(container);
    },
    [container],
  );

  /* **A host that has left the document is not somewhere to draw** (plan § 3,
     never nothing). `Reader` learns its host has gone from a ref callback, one
     commit after the cell that held it was unmounted. */
  const place: Placement =
    card?.host.isConnected === true
      ? { kind: "card", host: card.host, width: card.width }
      : dockRoom !== null
        ? { kind: "dock", room: dockRoom }
        : { kind: "float" };
  const cardHost = place.kind === "card" ? place.host : null;
  const cardWidth = place.kind === "card" ? place.width : null;

  /**
   * **Read on the render that is about to move it**, for `composerHeld`'s
   * reason below: it is the only moment the answer exists. When the card's
   * cell is unmounted in the same commit that takes the card away (Marginalia
   * switched off, a resize under the threshold), the container has left the
   * document — and the focus and every scroll offset with it — before any
   * effect of this component runs.
   */
  /* Save even when the host prop still names the current parent: Reader can
     replace that host in this commit, before its ref reports the new node. */
  const kept = container !== null ? keep(container) : null;
  /* **No dependency list, on purpose**: the host can leave the document
     without any prop of this component changing, so where the container is has
     to be checked after every commit. It is two comparisons when nothing has
     moved. */
  useLayoutEffect(() => {
    if (!container) return;
    /* Asked again here: the host can be unmounted by the very commit this
       effect belongs to. */
    const to = cardHost?.isConnected ? cardHost : home.current;
    if (!to) return;
    /* The width is the host's to carry: it is the positioned box
       `useMarginLayout` measures, and the panel is in flow inside it. */
    if (to === cardHost && cardWidth !== null) {
      const width = `${cardWidth}px`;
      if (to.style.getPropertyValue("--chat-card-w") !== width)
        to.style.setProperty("--chat-card-w", width);
    }
    if (container.parentNode !== to) {
      to.appendChild(container);
      if (kept) putBack(kept);
    }
  });

  /**
   * ## Opening an existing conversation lands the keyboard somewhere
   *
   * The `draft` arm focuses its composer (`focusNonce={1}`); the `thread` arm
   * passes `{0}` and focused **nothing at all**, so arriving at `?thread=` left
   * the reader wherever they had been — the same shape as the gap GPT Sol found
   * in the Dock drawer, which A2 fixed there and not here.
   *
   * **The composer is deliberately not the target**, and passing `{1}` here
   * would be undoing a decision rather than filling a gap. Greg, 2026-08-26:
   * *"when a new chat is started, move focus to the input box"* — and
   * `ChatPanel`'s own note says that is *"the only time it is right"*, because a
   * focused textarea turns ↑ / ↓ from "step through the article" into "move the
   * cursor" with nothing on screen to say why (docs/project/keyboard.md).
   *
   * So it is the close control: it exists in every state this dialog can open
   * in — thread, loading, and the conversation-has-gone case — where a heading
   * may not; it is already a tab stop and already the reader's way out; and it
   * is what `CommentDialog` does, so this is the established pattern rather than
   * a second one. GPT Sol F44 and its follow-up, 2026-09-07.
   */
  useEffect(() => {
    if (openedAs !== "thread") return;
    /* **`preventScroll`, for the card.** The floating and docked panels are
       fixed to the window, where focus scrolls nothing. The card is in the
       page: a cold `?thread=` with `at=` somewhere else would be dragged to
       the card by this focus, against the position the address asked for
       (plan 261004k § Focus must not scroll the page). */
    closeRef.current?.focus({ preventScroll: true });
  }, [openedAs]);

  /**
   * ## Sending the first question does not cost the reader the caret
   *
   * `target` changes underneath this dialog: the moment a draft is sent it
   * becomes a thread, and the draft arm's composer is **unmounted by the swap** —
   * before the dialog closes at all. So the reader presses Enter and focus falls
   * to `<body>`, mid-conversation, with the panel still open in front of them.
   *
   * **This was recorded as a known gap and left alone, and that was the wrong
   * call.** The argument for leaving it was that choosing a destination changes
   * what happens after Enter, which is product. GPT Sol's answer on the stage-5a
   * review is the one that settles it: *"If the outgoing composer held focus,
   * moving focus to its semantic replacement preserves an existing interaction;
   * it does not apply the disputed policy."* The disputed policy is "focus every
   * reopened thread's composer", which this is not — the condition below is
   * exactly that the reader was already typing.
   *
   * So: only when focus was in the composer that is going away. A reader who
   * sent from the keyboard shortcut with focus elsewhere is left where they
   * are, and `?thread=` opened cold still lands on the close control above.
   */
  /**
   * ## The caret follows the composer
   *
   * Draft → thread was the first case and not the only one. `Conversation` is
   * keyed on the thread's id, so **every** change of conversation under a
   * mounted dialog unmounts the composer: thread → thread (Back and Forward;
   * another paragraph's chip or "?" in Safari, where a pressed button takes no
   * focus), and thread → draft, where the draft arm's `focusNonce={1}` is
   * already spent if the dialog opened as a draft. qi-7dvah74y, plan 261004l
   * § B.
   *
   * One rule covers them, and it asks about the DOM rather than about `target`:
   * **a commit that removes a composer holding focus owes the focus to the
   * composer that replaces it.** The composer is its `<form>` — the box, and
   * the Send a first question may have been pressed with — and nothing wider:
   * not Close, not the footer's controls, not the question editor, which is a
   * rewrite of one question in the conversation being left and has no
   * replacement in the next (GPT Sol's plan review, F4).
   *
   * Read **on the render itself**, which is the only moment the answer exists:
   * the outgoing composer is still focused and still in the document, and
   * React has not committed the replacement yet. A first attempt sampled on the
   * previous render instead and was always false, because the reader had not
   * started typing when that render happened — the test said so.
   */
  const focusedNow = typeof document === "undefined" ? null : document.activeElement;
  const composerHeld =
    focusedNow instanceof HTMLElement && box.current?.contains(focusedNow) === true
      ? focusedNow.closest<HTMLElement>(".chat-composer")
      : null;
  /**
   * **Owed, rather than paid at once**, because the replacement may not be
   * there yet: a conversation whose transcript is still arriving draws a
   * spinner and no composer. It is paid on the first commit that has one, and
   * forgiven if the reader has put focus anywhere in the meantime.
   */
  const caretOwed = useRef(false);
  /* A focus visit followed by blur between commits still cancels the debt.
     Sampling only activeElement below would mistake that for uninterrupted
     waiting on the replacement. */
  useLayoutEffect(() => {
    const forgive = () => {
      caretOwed.current = false;
    };
    document.addEventListener("focusin", forgive);
    return () => document.removeEventListener("focusin", forgive);
  }, []);
  /* **A layout effect, after the move above**: the card changes cell in the
     same commit as a switch to another paragraph's conversation, and focus
     cannot be given to a box that is not in the document yet. No dependency
     list, for the reason the move has none. */
  useLayoutEffect(() => {
    if (composerHeld && !composerHeld.isConnected) caretOwed.current = true;
    if (!caretOwed.current) return;
    const at = document.activeElement;
    if (at !== null && at !== document.body) {
      caretOwed.current = false;
      return;
    }
    const next = box.current?.querySelector<HTMLTextAreaElement>(".chat-composer textarea");
    if (!next) return;
    caretOwed.current = false;
    /* `preventScroll`: the card is in the page, and the reader has not moved. */
    next.focus({ preventScroll: true });
  });
  useEffect(() => {
    /* **The mount point, not the `<aside>`**, since 261004k: the aside is in a
       container that may be sitting in the card's host, which this component
       does not own and React will not detach. `home` is React's, so it is the
       element whose leaving the document means this dialog has. With no
       document there is no portal and the aside is drawn in place. */
    const panel: HTMLElement | null = container ? home.current : box.current;
    const back = opened.opener;
    const row = opened.row;
    return () => {
      /* **"Is the focus we are about to destroy ours?"** — not "has focus gone
         to the body", which was the first attempt and is wrong here: React runs
         this cleanup *before* it detaches the subtree, so the composer is still
         the active element at this point and the body test never fires. A test
         caught it. `CommentDialog` keeps a `dialogRef` to ask the same question.

         The distinction is the one `EditableTitle` makes (TitleEditor.tsx § the
         pencil and the input swap): a reader who has already clicked something
         real must be left on it. Here "real" means anything outside this
         panel. */
      const at = document.activeElement;
      const ours =
        at === null || at === document.body || (container ?? panel)?.contains(at) === true;
      /**
       * **Deferred, because a cleanup is not proof of an unmount.**
       *
       * `main.tsx` wraps the app in `<StrictMode>`, which runs every effect
       * setup → cleanup → setup on mount. So this cleanup fires once while the
       * dialog is perfectly well mounted, and restoring there put focus back on
       * the Help button and left a reader who had just opened a draft with no
       * caret in the composer — a regression introduced *by* this fix, and
       * invisible to any test that does not use StrictMode. GPT Sol found it on
       * the stage-5a review; `tests/chat-dialog-gives-focus-back.test.tsx`
       * § under StrictMode is the test that proved it.
       *
       * `isConnected` cannot be asked *now*: React runs cleanups before it
       * detaches the subtree, so the panel is still in the document either way —
       * which is the same fact that made the `body` test wrong above. Asked one
       * microtask later it separates them cleanly: a real unmount has detached
       * by then, StrictMode's synthetic cycle has not.
       *
       * The `activeElement` question stays synchronous, because by the microtask
       * focus has already fallen to `<body>` and the answer would be useless.
       */
      queueMicrotask(() => {
        if (panel?.isConnected !== false) return;
        /* A real unmount. The container goes with it — React removed the
           `<aside>` from it, but in the card it is sitting in `Reader`'s host,
           which nobody else will empty. Here rather than in a cleanup of its
           own for the reason this is deferred: StrictMode's cycle must not
           detach a panel that is staying. */
        container?.remove();
        if (!ours) return;
        if (back?.isConnected) {
          back.focus();
          return;
        }
        const gutter = row?.isConnected
          ? row.querySelector<HTMLButtonElement>(".blk-more")
          : null;
        if (gutter) {
          gutter.focus();
          return;
        }
        document.querySelector<HTMLButtonElement>('.dock button[aria-label="Comments"]')?.focus();
      });
    };
  }, [opened, container]);

  /**
   * The answer currently arriving, if one is.
   *
   * `pending` on the **last** message only. A `pending` row anywhere else is a
   * turn something else is writing, and offering to stop it from here would
   * stop an answer the reader is not watching.
   */
  const tail = thread?.messages[thread.messages.length - 1];
  const streaming = tail?.role === "assistant" && tail.status === "pending";

  /**
   * Is this the very first answer of a conversation the reader just started?
   *
   * Two messages — their question and the answer being written — is exactly the
   * shape the server accepts a cancel for. Anything longer is a conversation
   * they have been having, and the button changes meaning accordingly.
   */
  const firstAnswer = streaming && thread?.messages.length === 2;

  /**
   * ## The card collapses to one line, and only the reader collapses it
   *
   * Plan 261004k § 5. An expanded card pushes every later note down the
   * column; collapsed, it is about one note tall and they go back beside their
   * blocks. **Nothing collapses by itself**: it opens expanded, always, and
   * stays that way until the reader presses Collapse.
   *
   * **The conversation it was pressed on and the `reopen` count at the time,
   * not a flag.** An id, for `timedOut`'s reason above: a boolean would carry
   * over to the next conversation opened in the slot. And the count, so that
   * any press asking for a conversation to be open — including this one, which
   * is already open and so changes no other prop — makes the comparison below
   * false, with no effect to reset anything (GPT Sol on the plan, F1).
   *
   * **Only the card, and only a conversation that has loaded.** The floating
   * and docked panels have nothing to collapse to, so a card that falls back
   * to one (a folded section, a narrower window) is shown whole and collapses
   * again when it returns. A draft has no collapsed state: it is already
   * short, and collapsing it would hide the box it was opened to type in.
   */
  const [shut, setShut] = useState<{ threadId: string; reopen: number } | null>(null);
  const selectedThread = target.kind === "thread" ? target.threadId : null;
  /* A mounted URL change leaves the former conversation behind. Its collapse
     must not return if the reader comes back to that thread later. */
  useLayoutEffect(() => {
    if (shut && shut.threadId !== selectedThread) setShut(null);
  }, [shut, selectedThread]);
  const collapsible = place.kind === "card" && thread !== undefined;
  const collapsed = collapsible && shut?.threadId === thread.id && shut.reopen === reopen;
  const shutRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  /** The transcript's offsets at the press: a hidden scroller forgets its own. */
  const shutScroll = useRef<Kept["scroll"]>([]);
  const wasCollapsed = useRef(collapsed);
  useLayoutEffect(() => {
    if (wasCollapsed.current === collapsed) return;
    wasCollapsed.current = collapsed;
    if (!collapsed) putBack({ focus: null, scroll: shutScroll.current });
    /* **The keyboard follows the press**, because the control that was pressed
       has just been hidden: Collapse → the card, the card → Collapse. Only
       when the focus was ours to move — a card expanded by a press on the
       gutter's chip leaves the reader on the chip. */
    const at = document.activeElement;
    const ours = at === null || at === document.body || container?.contains(at) === true;
    if (ours) (collapsed ? shutRef : collapseRef).current?.focus({ preventScroll: true });
  }, [collapsed, container]);

  /**
   * **The composer is brought into view when it is typed in, in the card.**
   *
   * The fixed panel stays above an iPad's keyboard by its bottom anchor
   * (`--kb-inset`); the card has none. It is page content, which Safari scrolls
   * a focused field into view for, and its height is capped to the visible
   * viewport — and this asks as well, on focus and whenever the visible
   * viewport changes under a focused composer. `nearest`, so a composer already
   * in view moves nothing. **Not proved on the box**: desktop Chrome at an
   * iPad's size has no Safari keyboard (GPT Sol on the plan, F6).
   */
  const inCard = place.kind === "card";
  const showComposer = useCallback(() => {
    const composer = box.current?.querySelector<HTMLElement>(".chat-composer");
    if (!composer?.contains(document.activeElement)) return;
    /* Drafts compose in the footer; loaded threads compose in the body. */
    const el = composer.closest<HTMLElement>("footer") ?? composer;
    /* jsdom has no `scrollIntoView`. */
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `visible` is the re-run trigger — the keyboard arriving or leaving is a new visible viewport, and the effect reads the DOM.
  useEffect(() => {
    if (!inCard) return;
    showComposer();
  }, [inCard, visible, showComposer]);

  const ask = useCallback(
    (question: string) => {
      if (target.kind !== "draft") return;
      /**
       * **`askAboutBlock` quotes nothing unless it is handed something to
       * quote, and a block anchor has nothing.** A selection anchor carries the
       * words; `{ blockId }` on its own does not, so a "?" press would have
       * sent `About block k3m9qt:` — the bare six-character code Greg
       * specifically ruled out when this message was designed (chat-handoff.ts
       * quotes him). The words are already on the target, shown above the box;
       * this is the line that also puts them in what gets sent.
       *
       * **Only for the "?"**, and that is a smaller claim than it looks. The
       * chat button opens the composer, where the reader sees the opening above
       * their cursor and then types; the "?" sends with nobody having read
       * anything. Widening this to every draft would be a change to a message
       * that has been shipping since 2026-08-26, so it is a question for Greg
       * rather than a thing to slip in here — the plan records it as open.
       */
      const quote =
        "quote" in target.anchor ? target.anchor.quote : target.help ? target.opening : undefined;
      const text = askAboutBlock({
        blockId: target.anchor.blockId,
        ...(quote ? { quote } : {}),
        question,
      });
      const id = send(null, text, at, {
        onThreadId: (real) => onThread(real),
        anchor: target.anchor,
        /* **The "?" says so on the wire.** The draft has known which button
           opened it since 2026-09-04 and used it, three lines up, to decide what
           the opening quotes — but never told the server, so nothing was stored
           about the press and the answer was written with the ordinary prompt.
           Reports 1R and 1S, both of them, are this one field arriving.
           `true` or absent: the route refuses a `false`. */
        ...(target.help ? { help: true as const } : {}),
        /* Only ever set when the reader came here by ticking "Also ask the AI"
           on a comment they just saved. The server links the two once it has a
           real thread id; nothing here does, on purpose. */
        ...(target.sourceCommentId ? { sourceCommentId: target.sourceCommentId } : {}),
      });
      onThread(id);
      /* The prose is told at once, with the id we have. If the server mints a
         different one, `onThread` above corrects the URL and the summary is
         reconciled on the next load — a mark briefly keyed on a guess is a mark
         in the right place under the wrong name, which is invisible and
         self-healing. Not drawing it at all until the round trip lands is the
         visible failure: the reader asks, and the words they selected go blank. */
      onCreated({
        id,
        title: text.slice(0, 60),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        anchor: target.anchor,
        /* Always a chat. This dialog is what a selection in the prose opens,
           and a Remember turn has no selection to open from — the route refuses
           an anchor sent with `kind: "remember"`. So every mark the reading view
           draws belongs to a chat, which is the property the overlay in
           App.tsx relies on. */
        kind: "chat",
        turns: 1,
      });
    },
    [target, send, at, onThread, onCreated],
  );

  /**
   * **The "?" sends itself, once, and this ref is the whole of "once".**
   *
   * The latch is a ref rather than state because it has to be true *before*
   * React can re-render — and because a state update here would itself be a
   * render, which is the loop this is preventing. It holds the block it sent
   * for, not a boolean: pressing "?" on one paragraph, then another, then back
   * to the first is three presses and must be able to be three sends, which a
   * boolean would have silently made two.
   *
   * **Three things fire this effect twice and each is real.** StrictMode mounts
   * every component, tears it down and mounts it again in development, so an
   * un-latched send here spends two model calls on every press for anyone
   * running the dev server. `ask` is rebuilt whenever `target` changes
   * identity, which App does on unrelated state. And the panel remounts when
   * the reader moves between the floating slot and chat mode.
   *
   * **Two *presses* need no guard of their own, and App used to have one.** The
   * send lives here, in a component that mounts once, so two taps that both
   * land before that mount collapse into one draft and one send; taps that
   * straddle it meet this ref, or the reopen in `helpAboutBlock`. A third guard
   * there was deleted on 2026-09-05 once a test proved its absence could not be
   * observed — the reasoning is in App.tsx beside `helpAboutBlock`.
   */
  const sentHelpFor = useRef<string | null>(null);
  useEffect(() => {
    if (target.kind !== "draft" || !target.help) return;
    if (sentHelpFor.current === target.anchor.blockId) return;
    sentHelpFor.current = target.anchor.blockId;
    ask(HELP_QUESTION);
  }, [target, ask]);

  /**
   * **The X in the corner closes. It has never destroyed anything since
   * 2026-09-05, and it used to.**
   *
   * While a new conversation's first answer was arriving, this was the *only*
   * control in the header and it meant "cancel and throw this away" — it called
   * `cancelAndDiscard`, aborted the answer on the server and deleted the
   * thread. Reasonable when every conversation began with the reader typing a
   * question and watching it: the X was next to the thing they had just
   * started, and cancelling was the likeliest thing they wanted.
   *
   * **The "?" makes it a trap.** That button exists so a reader can ask for
   * help and *keep scrolling* — Greg, 2026-09-04, wanting to "click I need help
   * here, and keep scrolling around and reading while the LLM is generating".
   * The gesture for going back to reading is tapping the X in the corner, and on
   * an iPad there is no Esc to do it safely instead. So the single most likely
   * thing a reader does after pressing "?" destroyed the answer they had just
   * paid for, with nothing on screen saying so — the shape
   * docs/reusable/silent-success.md is about, where the control works perfectly
   * and does the opposite of the feature.
   *
   * **Closing costs nothing, which is the fact that makes this safe rather than
   * merely kinder.** The answer goes on being written and stored after the
   * reader leaves (src/routes.ts: *"A reader who leaves does not cancel the
   * answer"*), the thread is already in the summaries so the paragraph keeps its
   * count, and pressing "?" on that paragraph again reopens it
   * (`helpThreadFor`). Nothing is orphaned by walking away.
   *
   * The discard did not disappear — it moved to the footer, where there is room
   * to say what it does. GPT Sol's condition: *two* controls had to change, not
   * one, or a first answer would have had no way to stop at all.
   */
  const stopControl = (
    <button
      ref={closeRef}
      type="button"
      className="chat-dialog-close close-x"
      onClick={onClose}
      title="Close (Esc)"
      aria-label="Close"
    >
      <X size={15} />
    </button>
  );

  const line = collapsed ? cardLine(thread, streaming) : null;
  const placeClass = place.kind === "card" ? " in-column" : place.kind === "dock" ? " docked" : "";

  const aside = (
    <aside
      ref={box}
      /* The template form, like `.cmt-dialog`'s: tests/linky-is-scoped.test.ts
         looks for the scoping class at the start of a `className`. */
      className={`chat-dialog${placeClass}${collapsed ? " collapsed" : ""}`}
      /* `.cmt-dialog`'s geometry and `.cmt-dialog`'s problem: pinned to the
         bottom of the layout viewport, which on iOS is behind the keyboard —
         and this one has a composer in it, so the keyboard is the normal state.
         See CommentDialog.tsx and useVisualViewport.ts.

         Docked, it keeps all of that and moves sideways only: the room and the
         inset are written here for dialogs.css § `.chat-dialog.docked` to read,
         the inset from layout.ts so the stylesheet has no second copy of it.

         In the column it has no geometry of its own to write — the host
         carries the width — and keeps `--kb-inset` for its `max-height`. */
      style={
        place.kind !== "dock"
          ? keyboardInsetStyle(visible)
          : ({
              ...keyboardInsetStyle(visible),
              "--chat-dock-room": `${place.room}px`,
              "--chat-dock-inset": `${CHAT_DOCK_INSET}px`,
            } as CSSProperties)
      }
      role="dialog"
      aria-label="Chat about this passage"
      onFocus={inCard ? showComposer : undefined}
    >
      {/* **Collapsed, the whole card is this one button** — and the rest of the
          panel is hidden rather than unmounted, because `Conversation` owns an
          open question editor and a running dictation, and a press on Collapse
          should cost the reader neither. The title is the reader's own words
          and the answer's line the model's, each in its face (fonts.md). */}
      {collapsed && line && (
        <button
          ref={shutRef}
          type="button"
          className="chat-card-shut"
          aria-expanded={false}
          title="Open this conversation again"
          onClick={() => setShut(null)}
        >
          <span className="chat-card-head">
            <MessageSquare size={12} aria-hidden="true" />
            <span className="chat-dialog-title">{thread.title}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
          {line.kind === "answering" ? (
            <span className="chat-card-line">
              <LoaderCircle className="chat-dialog-spinner" size={12} aria-hidden="true" />
              answering…
            </span>
          ) : line.kind === "answer" ? (
            <span className={withVoice("chat-card-line", "ai")}>{line.text}</span>
          ) : (
            <span className="chat-card-line">
              {line.count} {line.count === 1 ? "question" : "questions"}
            </span>
          )}
        </button>
      )}
      <header hidden={collapsed}>
        <span className="chat-dialog-label">
          <MessageSquare size={12} aria-hidden="true" />
          {target.kind === "draft" ? (
            <>Ask about {shortBlockId(target.anchor.blockId)}</>
          ) : (
            /* A thread's title is the reader's own words; the fallback is ours. */
            thread ? (
              <span className="chat-dialog-title">{thread.title}</span>
            ) : (
              <>New conversation</>
            )
          )}
        </span>
        <span className="chat-dialog-tools">
          {collapsible && (
            <button
              ref={collapseRef}
              type="button"
              className="chat-dialog-collapse"
              aria-expanded={true}
              aria-label="Collapse"
              title="Collapse to one line. The conversation stays open."
              onClick={() => {
                if (container) shutScroll.current = scrollOffsets(container);
                setShut({ threadId: thread.id, reopen });
              }}
            >
              <ChevronUp size={18} aria-hidden="true" />
            </button>
          )}
          {stopControl}
        </span>
      </header>

      <div className="chat-dialog-body" hidden={collapsed}>
        {target.kind === "draft" && target.help ? (
          /* **A help draft is a draft for one paintless instant, and must not
              say so.** The auto-send is a passive effect, and React does not
              promise a passive effect runs before paint — so the ordinary draft
              body below can reach the screen, showing a composer and the words
              "Nothing is asked until you send" over a press that has already
              bought an answer. Two frames of copy that contradicts the action.
              GPT Sol's stage 3 review, finding 5. */
          <div className="chat-dialog-loading">
            <LoaderCircle className="chat-dialog-spinner" size={13} />
            <span>Asking…</span>
          </div>
        ) : target.kind === "draft" ? (
          <>
            {"quote" in target.anchor ? (
              <blockquote className="chat-dialog-quote">{target.anchor.quote}</blockquote>
            ) : (
              <p className="chat-dialog-opening">{target.opening}</p>
            )}
            {/* Said out loud, because the previous behaviour spent a model call
                here without being asked and a reader who knew that needs telling
                it has stopped. */}
            <p className="chat-dialog-hint">Nothing is asked until you send.</p>
          </>
        ) : starting ? (
          <div className="chat-dialog-loading">
            <LoaderCircle className="chat-dialog-spinner" size={13} />
            <span>Starting…</span>
          </div>
        ) : stalled && target.kind === "thread" ? (
          /* **The end of the spinner that used to have no end**, and both lines
             of it are chosen against the temptation to sound more certain.

             *"We didn't see this conversation start"* rather than "it never
             started": the paragraph above is an argument that we cannot know,
             and an earlier draft of this copy asserted the very thing that
             argument rules out. Sol caught the contradiction between the
             comment and the sentence, 2026-09-05.

             *"Forget this attempt"* rather than "Start over", because the click
             does not start anything — it drops the client's shortcut and
             closes. Naming it for what it performs is also what makes the
             consequence honest: what the reader gives up is this page's route
             back to a conversation that may exist, and a reload may bring it
             back. Pressing "?" again is what starts the replacement, and that
             now works, because the stale summary was what routed every press
             here. */
          <div className="chat-dialog-gone">
            <p>We didn't see this conversation start, and can't tell whether it was saved.</p>
            <button
              type="button"
              className="linky"
              onClick={() => {
                onDropped(target.threadId);
                onClose();
              }}
            >
              Forget this attempt
            </button>
          </div>
        ) : thread ? (
          <Conversation
            /* Unlike the full Chat panel, this modeless dialog can stay mounted
               while `?thread=` changes underneath it. A conversation owns its
               scroll position, follow-the-latest ref, Latest pill and open
               editor, so none of those may cross from one id to the next. */
            key={thread.id}
            slug={slug}
            thread={thread}
            onJump={onJump}
            recovering={recovering}
            blocks={blocks}
            onSend={(question) => send(thread.id, question, at)}
            onRetry={(messageId) => retry(thread.id, messageId)}
            onEdit={(messageId, question) => edit(thread.id, messageId, question, at)}
            onStop={(messageId) => stop(thread.id, messageId)}
            focusNonce={0}
            focused={focused}
            draft={draft}
            onDraft={setDraft}
            visible={!collapsed}
            /* The card's height is its content's; the corner and the dock have
               the panel's. Said here, not left to a stylesheet, because the
               transcript's room is sized in JS (ChatPanel.tsx § A streamed
               answer stays where it starts). */
            sized={inCard ? "content" : "fixed"}
            /* Always a chat. This dialog is what a selection in the prose opens,
               and a Remember turn cannot be anchored to one. */
          kind="chat"
        />
        ) : loadFailed ? (
          /* **A request that failed is not a conversation that is gone**, and
             this branch exists because saying the second when the first is true
             is worse than saying nothing: the reader is told their work has
             been deleted by what is actually a dropped connection.
             `useChat.loadFailed` carries exactly that distinction and this
             panel was ignoring it. GPT Sol, second pass on stage 3,
             2026-09-05 — where the same conflation was about to make an outage
             *delete* summaries. */
          /* **Not "it is still there", which was the first wording and claims
             something a failed request cannot know.** The point is only to stop
             the reader concluding the opposite. GPT Sol, 2026-09-05. */
          <p className="chat-dialog-gone">
            Could not load that conversation. We couldn't check whether it still exists.
          </p>
        ) : (
          /* `?thread=` names a conversation that is not there — a shared link to
             one since deleted, or a tab left open across a delete elsewhere.
             Said plainly rather than silently starting a new one, which would
             point the URL at something the reader never asked for. */
          loaded && <p className="chat-dialog-gone">That conversation no longer exists.</p>
        )}
      </div>

      <footer hidden={collapsed}>
        {/* Nothing under a help draft either, for the reason the body gives:
            the question is already sent, so a composer offering to send it is
            the same contradiction one row down. */}
        {target.kind === "draft" && target.help ? null : target.kind === "draft" ? (
          <Composer
            slug={slug}
            onSend={ask}
            busy={false}
            focusNonce={1}
            focused={focused}
            draft={draft}
            onDraft={setDraft}
          />
        ) : (
          <div className="chat-dialog-actions">
            <button type="button" className="linky" onClick={onOpenFull}>
              Open in full chat
            </button>
            {/* **The only way to start a *second* conversation about a
                paragraph**, since the gutter's chip began reopening — see
                `onNewConversation` above.

                Gated on the conversation being anchored to a paragraph at
                all — one started in the Chat band is about the article and has
                no paragraph to offer. A conversation started from a *selection*
                does have one, and gets the button too: the chip on that
                paragraph now reopens the selection thread, so this is the only
                way left to start a whole-block one there.

                Read off the stored thread rather than off `target`, which
                carries an id and nothing else — so the button appears with the
                transcript rather than before it. */}
            {onNewConversation && newAbout && (
              <button
                type="button"
                className="linky"
                onClick={() => onNewConversation(newAbout)}
                title="Start another conversation about this paragraph"
              >
                New conversation
              </button>
            )}
            {thread && !streaming && (
              <button
                type="button"
                className="linky chat-dialog-delete"
                onClick={() => {
                  remove(thread.id);
                  /* Its unsent words go with it, so Chat mode does not find
                     them waiting for a conversation that is gone. */
                  drafts.dropThread(thread.id);
                  onDropped(thread.id);
                  onClose();
                }}
              >
                Delete
              </button>
            )}
            {streaming && !firstAnswer && tail && thread && (
              <button
                type="button"
                className="linky"
                onClick={() => stop(thread.id, tail.id)}
                title="Stop this answer. What has arrived is kept."
              >
                <Square size={11} /> Stop
              </button>
            )}
            {/* **The discard, moved down here from the header X.**

                It is the same call it always was — `cancelAndDiscard` aborts the
                answer on the server *and* deletes the thread, which the server
                only accepts for a two-message conversation, which is exactly
                what `firstAnswer` means. What has changed is that it is now a
                word rather than an ✕, sitting beside "Open in full chat" where
                the reader is choosing what to do with a conversation, instead of
                in the corner where they are trying to leave.

                **Not called "Stop".** The Stop above keeps what arrived —
                `ChatMessage.stopped` exists so an answer ending mid-sentence
                does not read as a bug — and two adjacent controls with one name
                and opposite consequences is how a reader loses a conversation.
                The two are never on screen together anyway, which is what the
                `!firstAnswer` above and the `firstAnswer` here say. */}
            {firstAnswer && tail && thread && (
              <button
                type="button"
                className="linky chat-dialog-delete"
                onClick={() => {
                  cancelAndDiscard(thread.id, tail.id);
                  drafts.dropThread(thread.id);
                  onDropped(thread.id);
                  onClose();
                }}
                title="Stop this answer and throw the conversation away"
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {error && <p className="chat-dialog-error">{error}</p>}
      </footer>
    </aside>
  );

  /* No document, no container to portal into: drawn in place. */
  if (!container) return aside;
  return (
    <>
      {/* Before the portal, on purpose — `setHome` above. */}
      <div ref={setHome} className="chat-dialog-home" />
      {createPortal(aside, container)}
    </>
  );
}
