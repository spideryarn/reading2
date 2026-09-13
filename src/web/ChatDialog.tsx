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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageSquare, Square, X } from "lucide-react";

import type { BlockId, ChatAnchor, ThreadSummary } from "../types.js";
import { Composer, Conversation } from "./ChatPanel.js";
import { askAboutBlock, HELP_QUESTION } from "./chat-handoff.js";
import { shortBlockId } from "./BlockRef.js";
/* **The client's own creation window, imported rather than restated.** This
   rule's whole claim is "longer than a send may legitimately take to open a
   conversation", so a second copy of that number is a way for the claim to
   quietly stop being true. src/web/chat/effects.ts says why it is three
   minutes. */
import { OPEN_TIMEOUT_MS } from "./chat/effects.js";
import { useChat } from "./useChat.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { keyboardInsetStyle, useVisualViewport } from "./useVisualViewport.js";

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
  } = useChat(slug);

  const thread = target.kind === "thread" ? threads.find((t) => t.id === target.threadId) : undefined;

  /* The paragraph a "New conversation" would be about, or `undefined` if this
     conversation is not anchored to one. See the button in the footer. */
  const newAbout: BlockId | undefined = thread?.anchor?.blockId;

  /* The composer's draft, owned here because `Composer` is remounted whenever
     the panel swaps between its two shapes and would otherwise lose what was
     typed. Same reason `ChatPanel` keeps a map of them. */
  const [draft, setDraft] = useState(target.kind === "draft" ? (target.question ?? "") : "");
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

  /* One box per target. Carrying a half-typed question from one passage to the
     next is the bug `CommentDialog` already fixed once: the reader asks about a
     passage they are no longer looking at. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the target is the trigger
  useEffect(() => {
    setDraft(target.kind === "draft" ? (target.question ?? "") : "");
  }, [target.kind === "draft" ? target.anchor.blockId : target.threadId]);

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
   * **The fallback is the passage's own "…", not a dock button.** There is no
   * Chat button in the dock to fall back to — checked, the dock's labels are
   * Commands, Comments, Metadata, Tweets and Spideryarn, and Chat is a *mode* in
   * the radiogroup rather than a panel. Falling back to a mode switch would put
   * the reader somewhere they never were. The row's `.blk-more` is where they
   * actually were, it is always rendered rather than only while the disclosure
   * is open, and it is where `BlockGutter` itself restores focus on Escape. The
   * row is remembered at mount, because by cleanup the button that names it has
   * gone.
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
  /** The panel itself, so the cleanup can ask whether the focus it is about to destroy was inside it. */
  const box = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
    closeRef.current?.focus();
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
   * So: only when focus was in the composer that is going away, and only on the
   * draft → thread transition. A reader who sent from the keyboard shortcut with
   * focus elsewhere is left where they are, and `?thread=` opened cold still
   * lands on the close control above.
   */
  const wasDraft = useRef(target.kind === "draft");
  /**
   * Read **on the swapping render itself**, which is the only moment the answer
   * exists: the outgoing composer is still focused and still in the document,
   * and React has not committed the replacement yet. A first attempt sampled on
   * the previous *draft* render instead and was always false, because the reader
   * had not started typing when that render happened — the test said so.
   */
  const swapping = wasDraft.current && target.kind === "thread";
  const caretWasInside =
    swapping && typeof document !== "undefined"
      ? box.current?.contains(document.activeElement) === true
      : false;
  useEffect(() => {
    wasDraft.current = target.kind === "draft";
    if (!caretWasInside) return;
    box.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [target.kind, caretWasInside]);
  useEffect(() => {
    const panel = box.current;
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
      const ours = at === null || at === document.body || panel?.contains(at) === true;
      if (!ours) return;
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
        if (back?.isConnected) {
          back.focus();
          return;
        }
        if (row?.isConnected) row.querySelector<HTMLButtonElement>(".blk-more")?.focus();
      });
    };
  }, [opened]);

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
      className="chat-dialog-close"
      onClick={onClose}
      title="Close (Esc)"
      aria-label="Close"
    >
      <X size={15} />
    </button>
  );

  return (
    <aside
      ref={box}
      className="chat-dialog"
      /* `.cmt-dialog`'s geometry and `.cmt-dialog`'s problem: pinned to the
         bottom of the layout viewport, which on iOS is behind the keyboard —
         and this one has a composer in it, so the keyboard is the normal state.
         See CommentDialog.tsx and useVisualViewport.ts. */
      style={keyboardInsetStyle(visible)}
      role="dialog"
      aria-label="Chat about this passage"
    >
      <header>
        <span className="chat-dialog-label">
          <MessageSquare size={12} aria-hidden="true" />
          {target.kind === "draft" ? (
            <>Ask about {shortBlockId(target.anchor.blockId)}</>
          ) : (
            <>{thread?.title ?? "New conversation"}</>
          )}
        </span>
        {stopControl}
      </header>

      <div className="chat-dialog-body">
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
            /* Always a chat. This dialog is what a selection in the prose opens, and a
             Remember turn cannot be anchored to one — so there is no stance picker
             here and never should be. */
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

      <footer>
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
}
