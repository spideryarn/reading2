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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  ClipboardCheck,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  SendHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { BlockId, ChatMessage, ChatThread } from "../types.js";
import { CitedText } from "./Cited.js";
import { isWebUrl } from "../urls.js";
import { TooltipGroup } from "./Tooltip.js";

interface Props {
  threads: ChatThread[];
  /** The open conversation, or null for the thread list. From `?thread=`. */
  threadId: string | null;
  onThread(id: string | null): void;
  onSend(question: string): void;
  onNew(): void;
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
  onDiscard,
  onRename,
  onDelete,
  onRetry,
  onEdit,
  onStop,
  onJump,
  blocks,
  focusNonce,
  error,
}: Props) {
  const open = threads.find((t) => t.id === threadId) ?? null;

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
  const leave = () => {
    if (open && open.messages.length === 0 && (drafts.current.get(open.id) ?? "").trim() === "") {
      drafts.current.delete(open.id);
      onDiscard(open.id);
    }
    onThread(null);
  };

  return (
    /* `mode-band` is the slot — fixed between the spine and the prose, and
       shared with the glossary. `chat` is a hook for anything only this panel
       wants; see § mode band in styles.css. */
    <aside className="mode-band chat" aria-label="Chat about this article">
      <div className="chat-head">
        <h2>{open ? open.title : "Chat"}</h2>
        {open ? (
          <button type="button" className="chat-icon" title="All conversations" onClick={leave}>
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
          /* Keyed, so that switching conversation gets a fresh transcript and a
             fresh composer rather than the previous one's scroll position, open
             editor and half-typed question. */
          key={open.id}
          thread={open}
          onJump={onJump}
          blocks={blocks}
          onSend={onSend}
          onRetry={onRetry}
          onEdit={onEdit}
          onStop={onStop}
          focusNonce={focusNonce}
          focused={focused}
          draft={drafts.current.get(open.id) ?? ""}
          onDraft={(text) => drafts.current.set(open.id, text)}
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
  onRetry,
  onEdit,
  onStop,
  focusNonce,
  focused,
  draft,
  onDraft,
}: {
  thread: ChatThread;
  onJump(id: BlockId): void;
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
  }, [chars, thread.messages.length]);

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
        {thread.messages.length === 0 && <Suggestions onAsk={onSend} />}
        {thread.messages.map((m, i) => (
          <Turn
            key={m.id}
            message={m}
            onJump={onJump}
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
        streaming-accessibility note in docs/plans/chat-mode.md.
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
        onSend={onSend}
        busy={busy}
        onStop={busy && last ? () => onStop(last.id) : undefined}
        focusNonce={focusNonce}
        focused={focused}
        draft={draft}
        onDraft={onDraft}
      />
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
  onRetry,
  onEdit,
  canEdit,
  editing,
  onEditing,
  discards,
}: {
  message: ChatMessage;
  onJump(id: BlockId): void;
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
  if (message.role === "user") {
    if (editing) {
      return (
        <EditQuestion
          text={message.text}
          discards={discards}
          onCancel={() => onEditing(false)}
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
  const thinking = message.status === "pending" && message.text === "";
  return (
    <div className={`chat-turn model${message.status === "error" ? " failed" : ""}`}>
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
      {message.status === "pending" && message.text !== "" && <span className="chat-cursor" />}
      {message.status === "error" && <p className="chat-failed">{message.error}</p>}
      {message.stopped && (
        /* Not styled as a failure, because it is not one. An answer that ends
           mid-sentence with nothing to explain it is the thing that reads like
           a bug; one line saying who ended it is the whole fix. */
        <p className="chat-stopped">You stopped this answer.</p>
      )}
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
      {message.status !== "pending" && (
        <div className="chat-actions">
          {message.text !== "" && <CopyAnswer text={message.text} />}
          {onRetry && (
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
  onDone,
  onCancel,
}: {
  text: string;
  discards: number;
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
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onDone(value);
          }
        }}
      />
      {discards > 0 && (
        <p className="chat-discard-warning">
          Asking again will discard the {discards} message{discards === 1 ? "" : "s"} below.
        </p>
      )}
      <div className="chat-actions">
        <button type="button" className="chat-icon" title="Ask again (Enter)" onClick={() => onDone(value)}>
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
      {text.split(/\n{2,}/).map((para, p) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs of one immutable string
        <p key={p}>
          {/* The chips, the hover cards and the bold runs all live in
              Cited.tsx, shared with the summary panel. Two copies of what a
              citation looks like would drift, and a chip that means something
              slightly different depending on which band it is in is worse than
              either version. */}
          <CitedText text={para} blocks={blocks} onJump={onJump} live={live} />
        </p>
      ))}
    </TooltipGroup>
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
  onStop,
  focusNonce,
  focused,
  draft,
  onDraft,
}: {
  onSend(question: string): void;
  busy: boolean;
  /** Present only while an answer is arriving. */
  onStop?: (() => void) | undefined;
  focusNonce: number;
  focused: { current: number };
  draft: string;
  onDraft(text: string): void;
}) {
  /* Seeded from the draft and owned here from then on. The panel keeps the map
     because it outlives this component; this keeps the value because typing
     into it must not repaint the transcript above. */
  const [value, setValue] = useState(draft);
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
    if (focusNonce > focused.current) {
      focused.current = focusNonce;
      box.current?.focus();
    }
  }, [focusNonce, focused]);

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
    onDraft("");
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
        onChange={(e) => {
          setValue(e.target.value);
          // The panel keeps the draft so it survives this component; see
          // `drafts` in ChatPanel.
          onDraft(e.target.value);
        }}
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
          <Square size={12} fill="currentColor" />
        </button>
      ) : (
        <button type="submit" className="chat-send" disabled={busy || value.trim() === ""} title="Send (Enter)">
          {busy ? <LoaderCircle className="cmt-spinner" size={14} /> : <SendHorizontal size={14} />}
        </button>
      )}
    </form>
  );
}
