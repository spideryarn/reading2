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
 * chat. See docs/plans/chat-mode.md.
 *
 * ## Why it is beside the article and not over it
 *
 * Because of the citations. Every claim carries a block id, and a block id is
 * only worth anything if pressing it puts you in front of the paragraph — which
 * a drawer over the article cannot do without closing itself first. Keeping the
 * article on screen is what makes the citation a reading aid rather than a
 * footnote.
 *
 * ## What is deliberately absent
 *
 * **Markdown.** The answers are plain paragraphs by instruction (the FORMAT
 * section of the prompt in src/converse.ts), and rendering arbitrary model
 * output as HTML is the one thing docs/project/security.md is about. Blank
 * lines split paragraphs; nothing else is interpreted.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MessageSquarePlus, Pencil, SendHorizontal, Trash2, X } from "lucide-react";
import type { BlockId, ChatMessage, ChatThread } from "../types.js";
import { BlockRef } from "./BlockRef.js";
import { isWebUrl } from "../urls.js";
import { splitCitations, splitEmphasis } from "./citations.js";

interface Props {
  threads: ChatThread[];
  /** The open conversation, or null for the thread list. From `?thread=`. */
  threadId: string | null;
  onThread(id: string | null): void;
  onSend(question: string): void;
  onNew(): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
  /** Jump to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
  /** Ids this article actually has — a cited id not in here is not a link. */
  knownIds: Set<string>;
  /** A transport failure. Model failures live on the message that failed. */
  error: string | null;
}

export function ChatPanel({
  threads,
  threadId,
  onThread,
  onSend,
  onNew,
  onRename,
  onDelete,
  onJump,
  knownIds,
  error,
}: Props) {
  const open = threads.find((t) => t.id === threadId) ?? null;

  return (
    /* `mode-band` is the slot — fixed between the spine and the prose, and
       shared with the glossary. `chat` is a hook for anything only this panel
       wants; see § mode band in styles.css. */
    <aside className="mode-band chat" aria-label="Chat about this article">
      <div className="chat-head">
        <h2>{open ? open.title : "Chat"}</h2>
        {open ? (
          <button type="button" className="chat-icon" title="All conversations" onClick={() => onThread(null)}>
            <X size={14} />
          </button>
        ) : (
          <button type="button" className="chat-icon" title="Start a new conversation" onClick={onNew}>
            <MessageSquarePlus size={14} />
          </button>
        )}
      </div>

      {error && <p className="chat-error">{error}</p>}

      {open ? (
        <Conversation thread={open} onJump={onJump} knownIds={knownIds} onSend={onSend} />
      ) : (
        <ThreadList
          threads={threads}
          onOpen={onThread}
          onNew={onNew}
          onRename={onRename}
          onDelete={onDelete}
        />
      )}
    </aside>
  );
}

/**
 * Every conversation about this article, most recently used first.
 *
 * By `updatedAt`, not `createdAt`: coming back to an article you were arguing
 * with yesterday, the thread you want is the one you were last in, and it may
 * well be the oldest one you started.
 */
function ThreadList({
  threads,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: {
  threads: ChatThread[];
  onOpen(id: string): void;
  onNew(): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const sorted = [...threads].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (sorted.length === 0) {
    return (
      <div className="chat-empty">
        <p>Nothing asked yet.</p>
        <p className="chat-empty-hint">
          Ask about anything in the article and the answer will point back at the paragraphs it came
          from — press one to go there.
        </p>
        <button type="button" className="chat-new" onClick={onNew}>
          <MessageSquarePlus size={14} /> New conversation
        </button>
      </div>
    );
  }

  return (
    <ol className="chat-threads">
      {sorted.map((t) => (
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
              <button type="button" className="chat-thread-open" onClick={() => onOpen(t.id)}>
                <span className="chat-thread-title">{t.title}</span>
                <span className="chat-thread-count">
                  {/* Turns, not messages: a reader counts exchanges, and the
                      pending assistant row would otherwise make a conversation
                      look one longer than it is while an answer arrives. */}
                  {Math.ceil(t.messages.length / 2)}
                </span>
              </button>
              <button
                type="button"
                className="chat-icon"
                title="Rename"
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
        </li>
      ))}
    </ol>
  );
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

function Conversation({
  thread,
  onJump,
  knownIds,
  onSend,
}: {
  thread: ChatThread;
  onJump(id: BlockId): void;
  knownIds: Set<string>;
  onSend(question: string): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const last = thread.messages.at(-1);
  const chars = last?.text.length ?? 0;

  /**
   * Follow the answer down as it arrives — but only if the reader is already at
   * the bottom.
   *
   * Scrolling up to re-read an earlier turn while the next one streams in is an
   * ordinary thing to do, and yanking the view back to the bottom every few
   * words would make it impossible. The 60px slack is for the fact that "at the
   * bottom" is never exact once a line is half-rendered.
   *
   * `useLayoutEffect` rather than `useEffect`: the check has to happen against
   * the scroll position from *before* the new text was painted, or the answer
   * that just grew has already moved the bottom out of reach and every reader
   * reads as scrolled-up.
   */
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run triggers — the effect reads a ref, and these are what say "new text has been painted, scroll if we were following"
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chars, thread.messages.length]);

  return (
    <>
      <div className="chat-scroll" ref={scroller}>
        {thread.messages.length === 0 && (
          <p className="chat-empty-hint">
            Ask anything about this article. Answers point back at the paragraphs they came from.
          </p>
        )}
        {thread.messages.map((m) => (
          <Turn key={m.id} message={m} onJump={onJump} knownIds={knownIds} />
        ))}
      </div>
      <Composer onSend={onSend} busy={last?.status === "pending"} />
    </>
  );
}

function Turn({
  message,
  onJump,
  knownIds,
}: {
  message: ChatMessage;
  onJump(id: BlockId): void;
  knownIds: Set<string>;
}) {
  if (message.role === "user") {
    return <div className="chat-turn you">{message.text}</div>;
  }
  const thinking = message.status === "pending" && message.text === "";
  return (
    <div className={`chat-turn model${message.status === "error" ? " failed" : ""}`}>
      {thinking ? (
        <span className="chat-thinking">
          <LoaderCircle className="cmt-spinner" size={13} /> thinking…
        </span>
      ) : (
        <Answer text={message.text} onJump={onJump} knownIds={knownIds} />
      )}
      {message.status === "pending" && message.text !== "" && <span className="chat-cursor" />}
      {message.status === "error" && <p className="chat-failed">{message.error}</p>}
      {message.citations && message.citations.length > 0 && (
        <ul className="chat-sources">
          {/* Filtered again here, and the repetition is deliberate. The server
              refuses a non-http(s) citation before storing it (converse.ts §
              isWebUrl), but `chat.json` is a file on disk that predates this
              check and could be edited by hand — and this is the one place in
              chat where model output reaches an attribute rather than a text
              node. A second cheap check at the boundary that matters. */}
          {message.citations.filter((c) => isWebUrl(c.url)).map((c) => (
            <li key={c.url}>
              <a href={c.url} target="_blank" rel="noreferrer noopener">
                {c.title ?? hostOf(c.url)}
              </a>
            </li>
          ))}
        </ul>
      )}
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
  knownIds,
}: {
  text: string;
  onJump(id: BlockId): void;
  knownIds: Set<string>;
}) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, p) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of one immutable string
        <p key={p}>{renderCitations(para, onJump, knownIds)}</p>
      ))}
    </>
  );
}

function renderCitations(
  para: string,
  onJump: (id: BlockId) => void,
  known: Set<string>,
): (string | React.ReactElement)[] {
  return splitCitations(para, known).map((seg, i) =>
    seg.kind === "text" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments of one immutable string, rebuilt whole
      <Fragment key={`t${i}`}>{emphasised(seg.text)}</Fragment>
    ) : (
      /* No <Tooltip> around these, and it is a performance decision rather than
         a design one. The whole answer re-renders on **every streamed token**,
         so a Floating UI instance per chip means a dozen `useFloating` hooks
         created and torn down a hundred times during one answer, for a hover
         hint. BlockRef already carries the full id in a native `title`. */
      // biome-ignore lint/suspicious/noArrayIndexKey: segments of one immutable string, rebuilt whole
      <span className="chat-cite" key={`c${i}`} title="Go to this passage">
        {seg.ids.map((id) => (
          <BlockRef key={id} id={id} onJump={onJump} />
        ))}
      </span>
    ),
  );
}

/**
 * A URL's host, for a citation that arrived without a title.
 *
 * `new URL()` throws rather than returning null, and this runs during render —
 * so one malformed URL used to take the whole panel down with it, replacing the
 * conversation with a blank screen. Everything reaching here has passed
 * `isWebUrl` and therefore parses, which makes the fallback unreachable; it is
 * here because "unreachable" and "cannot happen" are different claims, and the
 * cost of being wrong about the difference is the reader's whole conversation.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * `**a term**` as a real `<strong>`, and everything else as it was written.
 *
 * Text in, React elements out — never HTML. See splitEmphasis in citations.ts
 * for what is interpreted (bold, and nothing else) and why that list is short
 * on purpose.
 */
function emphasised(text: string): (string | React.ReactElement)[] {
  return splitEmphasis(text).map((run, i) =>
    run.bold ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one immutable string, rebuilt whole
      <strong key={`b${i}`}>{run.text}</strong>
    ) : (
      run.text
    ),
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
function Composer({ onSend, busy }: { onSend(question: string): void; busy: boolean }) {
  const [value, setValue] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  // Height follows content. Reset to `auto` first, or the box can only ever
  // grow: `scrollHeight` of an element already tall enough is its own height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect measures the DOM rather than reading `value`, but `value` is what changed it
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const submit = () => {
    const question = value.trim();
    if (question === "" || busy) return;
    onSend(question);
    setValue("");
  };

  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={box}
        className="chat-input"
        rows={1}
        value={value}
        placeholder={busy ? "Waiting for the answer…" : "Ask about this article…"}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          /* Every key press in here is stopped from bubbling, and that is not
             tidiness. The article's ↑/↓ navigation listens on the window
             (keynav.ts) and would scroll the page while the reader was moving
             the caret through their own question; Dock.tsx listens for Escape
             in the capture phase. Neither should hear anything typed into a
             text box. */
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" className="chat-send" disabled={busy || value.trim() === ""} title="Send (Enter)">
        {busy ? <LoaderCircle className="cmt-spinner" size={14} /> : <SendHorizontal size={14} />}
      </button>
    </form>
  );
}
