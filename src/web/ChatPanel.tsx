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
import { BlockRef, shortBlockId } from "./BlockRef.js";
import { isWebUrl } from "../urls.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { snippet, splitCitations, splitEmphasis } from "./citations.js";

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
   * focus when it changes. See ChatBand in App.tsx for why a counter, and why
   * opening an existing conversation deliberately does not do this.
   */
  focusNonce: number;
  /** A transport failure. Model failures live on the message that failed. */
  error: string | null;
}

/**
 * What to ask, for a reader looking at an empty conversation.
 *
 * **Every one of these sends you back into the article.** That is the filter,
 * and it is why the most obvious suggestion — "summarise this" — is not here
 * and must not be added: it is the anti-goal
 * ([vision.md](../../docs/project/vision.md)) in a single click, and a chat
 * that opens by offering to replace the reading is not the feature that was
 * argued for in docs/plans/chat-mode.md.
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
];

export function ChatPanel({
  threads,
  threadId,
  onThread,
  onSend,
  onNew,
  onRename,
  onDelete,
  onJump,
  blocks,
  focusNonce,
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
        <Conversation
          thread={open}
          onJump={onJump}
          blocks={blocks}
          onSend={onSend}
          focusNonce={focusNonce}
        />
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
  blocks,
  onSend,
  focusNonce,
}: {
  thread: ChatThread;
  onJump(id: BlockId): void;
  blocks: Map<string, string>;
  onSend(question: string): void;
  focusNonce: number;
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
        {thread.messages.length === 0 && <Suggestions onAsk={onSend} />}
        {thread.messages.map((m) => (
          <Turn key={m.id} message={m} onJump={onJump} blocks={blocks} />
        ))}
      </div>
      <Composer onSend={onSend} busy={last?.status === "pending"} focusNonce={focusNonce} />
    </>
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
  blocks,
}: {
  message: ChatMessage;
  onJump(id: BlockId): void;
  blocks: Map<string, string>;
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
        <Answer
          text={message.text}
          onJump={onJump}
          blocks={blocks}
          /* Tooltips only once the answer has landed — see renderCitations. */
          live={message.status === "pending"}
        />
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
      {text.split(/\n{2,}/).map((para, p) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of one immutable string
        <p key={p}>{renderCitations(para, onJump, blocks, live)}</p>
      ))}
    </TooltipGroup>
  );
}

function renderCitations(
  para: string,
  onJump: (id: BlockId) => void,
  blocks: Map<string, string>,
  live: boolean,
): (string | React.ReactElement)[] {
  return splitCitations(para, blocks).map((seg, i) =>
    seg.kind === "text" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments of one immutable string, rebuilt whole
      <Fragment key={`t${i}`}>{emphasised(seg.text)}</Fragment>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: segments of one immutable string, rebuilt whole
      <span className="chat-cite" key={`c${i}`}>
        {seg.ids.map((id) =>
          live ? (
            /* **No tooltip while the answer is still arriving.** The whole
               answer re-renders on every streamed token, so a Floating UI
               instance per chip would be a dozen `useFloating` hooks created
               and torn down a hundred times during one reply. Once the message
               is `done` it re-renders no more, and the tooltips cost nothing —
               which is also the only time anybody is reading carefully enough
               to hover one. The native `title` on BlockRef covers the gap. */
            <BlockRef key={id} id={id} onJump={onJump} />
          ) : (
            <Tooltip
              key={id}
              placement="top"
              className="tip-cite"
              content={<CitedBlock id={id} text={blocks.get(id) ?? ""} />}
            >
              <span className="chat-cite-hit">
                <BlockRef id={id} onJump={onJump} />
              </span>
            </Tooltip>
          ),
        )}
      </span>
    ),
  );
}

/**
 * What a citation chip shows on hover: **the paragraph itself**.
 *
 * Greg, 2026-08-26, asked for a rich tooltip here, and the only content worth
 * putting in one is the thing the citation points at. A chip saying
 * "go to this passage" tells the reader what clicking does; a chip showing the
 * passage lets them decide whether to click at all — and, more to the point,
 * lets them check the model against the article without leaving the sentence
 * they are reading. That check is the whole justification for the feature
 * (docs/plans/chat-mode.md § Say the awkward thing first), and until now it
 * cost a jump and a scroll back.
 *
 * Truncated, deliberately and not generously. Enough to recognise the
 * paragraph and see whether it says what the answer claims; not enough to read
 * instead of going there. The original version learned the same thing about
 * search results and kept two lengths for it —
 * docs/project/original-version/search-and-chat.md.
 */
function CitedBlock({ id, text }: { id: BlockId; text: string }) {
  const shown = snippet(text);
  return (
    <>
      <div className="tip-cite-head">{shortBlockId(id)}</div>
      {shown === "" ? (
        // A block with no text of its own — an image, a figure. Saying so beats
        // an empty card that looks like a tooltip that failed to load.
        <p className="tip-cite-empty">This block has no text of its own.</p>
      ) : (
        <p className="tip-cite-text">{shown}</p>
      )}
      <div className="tip-cite-go">Click to go there</div>
    </>
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
function Composer({
  onSend,
  busy,
  focusNonce,
}: {
  onSend(question: string): void;
  busy: boolean;
  focusNonce: number;
}) {
  const [value, setValue] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  /**
   * Take focus when a new conversation has just been started.
   *
   * Greg, 2026-08-26: *"when a new chat is started, move focus to the input
   * box."* Which is the only time it is right — see ChatBand in App.tsx. The
   * guard on `0` is what keeps a plain page load, or the reader opening a
   * conversation they already had, from stealing the caret; a focused textarea
   * turns ↑ / ↓ from "step through the article" into "move the cursor", and
   * nothing on screen would say why.
   */
  useEffect(() => {
    if (focusNonce > 0) box.current?.focus();
  }, [focusNonce]);

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
