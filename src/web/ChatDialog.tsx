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
import { askAboutBlock } from "./chat-handoff.js";
import { shortBlockId } from "./BlockRef.js";
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
  onCreated,
  onDropped,
}: Props) {
  const {
    threads,
    loaded,
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
   */
  const starting = target.kind === "thread" && loaded && !thread;

  /* One box per target. Carrying a half-typed question from one passage to the
     next is the bug `CommentDialog` already fixed once: the reader asks about a
     passage they are no longer looking at. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the target is the trigger
  useEffect(() => {
    setDraft(target.kind === "draft" ? (target.question ?? "") : "");
  }, [target.kind === "draft" ? target.anchor.blockId : target.threadId]);

  useEscapeToClose(onClose);

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
      const text = askAboutBlock({
        blockId: target.anchor.blockId,
        ...("quote" in target.anchor ? { quote: target.anchor.quote } : {}),
        question,
      });
      const id = send(
        null,
        text,
        at,
        true,
        (real) => onThread(real),
        target.anchor,
        undefined,
        undefined,
        /* Only ever set when the reader came here by ticking "Also ask the AI"
           on a comment they just saved. The server links the two once it has a
           real thread id; nothing here does, on purpose. */
        target.sourceCommentId,
      );
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

  const stopControl = firstAnswer ? (
    <button
      type="button"
      className="chat-dialog-stop cancel"
      /* **Not the word "Stop".** Chat's stop keeps what arrived, on purpose —
         `ChatMessage.stopped` exists so an answer ending mid-sentence does not
         read as a bug. Putting a destructive control next to a non-destructive
         one and calling both "Stop" is how a reader loses a conversation. */
      title="Stop, and throw this conversation away"
      aria-label="Stop and discard this conversation"
      onClick={() => {
        if (!thread || !tail) return;
        cancelAndDiscard(thread.id, tail.id);
        onDropped(thread.id);
        onClose();
      }}
    >
      <X size={15} />
      <span>Cancel</span>
    </button>
  ) : (
    <button type="button" className="chat-dialog-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
      <X size={15} />
    </button>
  );

  return (
    <aside
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
        {target.kind === "draft" ? (
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
        ) : thread ? (
          <Conversation
            slug={slug}
            thread={thread}
            onJump={onJump}
            recovering={recovering}
            blocks={blocks}
            onSend={(question, useProfile) => send(thread.id, question, at, useProfile)}
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
        ) : (
          /* `?thread=` names a conversation that is not there — a shared link to
             one since deleted, or a tab left open across a delete elsewhere.
             Said plainly rather than silently starting a new one, which would
             point the URL at something the reader never asked for. */
          loaded && <p className="chat-dialog-gone">That conversation no longer exists.</p>
        )}
      </div>

      <footer>
        {target.kind === "draft" ? (
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
          </div>
        )}
        {error && <p className="chat-dialog-error">{error}</p>}
      </footer>
    </aside>
  );
}
