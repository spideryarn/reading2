/**
 * The explanation panel — see docs/project/comments.md.
 *
 * A floating dialog rather than a fourth column, decided by Greg on 2026-08-25:
 *
 * > Perhaps we shouldn't add it as a column of its own … Perhaps for now let's
 * > have them show up as a dialog box to avoid screwing up the existing UI,
 * > until we come up with a better plan.
 *
 * A real column would have to enter layout.ts's shrink-then-drop arithmetic,
 * take `pin-right` off the prose, and thread through the rowSpan geometry in
 * TableView. A dialog touches none of that, which is the whole point of it being
 * the first move rather than the last one.
 *
 * It shows **one** comment, which is why it carries prev/next: several questions
 * can be in flight at once, and the panel is how you get back to the ones you
 * are not looking at. Reading order, not ask order — see comment-nav.ts.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Globe, LoaderCircle, X } from "lucide-react";
import { PROVIDER_UNREADABLE, worthRetrying } from "../messages.js";
import type { ClientComment } from "./useComments.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { Tooltip } from "./Tooltip.js";
import { parseRoute } from "./router.js";
import { useDictationField } from "./useDictationField.js";

interface Props {
  comment: ClientComment;
  /** 1-based position in reading order, and how many there are. */
  position: number;
  total: number;
  /** How many *other* comments are still waiting on the model. */
  pending: number;
  /** Null at the ends — the arrows stop rather than wrap (comment-nav.ts). */
  onPrev(): void;
  onNext(): void;
  hasPrev: boolean;
  hasNext: boolean;
  onClose(): void;
  onDelete(): void;
  onRetry(): void;
  /** Ask again and search properly — for an answer the reader has judged thin. */
  onDeepen(): void;
  /**
   * The reader typed a follow-up.
   *
   * Opens a conversation rather than growing a transcript in here — Greg's
   * call, see chat-handoff.ts. Since 2026-08-26 that conversation is the
   * floating panel rather than chat mode, and it carries this comment's anchor,
   * so the passage keeps its mark and the new chat is tied to the same words.
   */
  onDiscuss(question: string): void;
  /** Save the reader's own words, or `null` to clear them back to a bookmark. */
  onEdit(body: string | null): void;
  /**
   * Open the conversation this comment started, if it still exists.
   *
   * Absent when there is nothing to open — either the comment never started one
   * or the reader has since deleted it. **Whether the thread is really there is
   * the caller's to decide**, because only the caller has the summary list; a
   * `threadId` on the comment is advisory and can point at nothing.
   */
  onOpenThread?: (() => void) | undefined;
}

export function CommentDialog({
  comment,
  position,
  total,
  pending,
  onDeepen,
  onDiscuss,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onClose,
  onDelete,
  onRetry,
  onEdit,
  onOpenThread,
}: Props) {
  const [followUp, setFollowUp] = useState("");
  const followUpBox = useRef<HTMLInputElement>(null);
  /* The other box in this app with an article in scope, and therefore the other
     one whose transcription gets the glossary as its vocabulary — the reader is
     asking about a passage they have just read, and the words in it are the
     words they are about to say. docs/plans/dictation-two-pass.md.

     **The slug comes from the address rather than from a prop**, which is one
     fewer thing for `App.tsx` to thread through and is exactly as true: this
     dialog only ever exists over an article, and the address is what says which
     one. `parseRoute` is the same function the router uses, so there is no
     second parser to disagree with it. Read on every render because it is a
     string comparison, and because a reader who navigates while the dialog is
     open should not have a stale slug in the next request. */
  const route = parseRoute(location.pathname);
  const dictate = useDictationField({
    value: followUp,
    onChange: setFollowUp,
    box: followUpBox,
    context: route.kind === "read" ? { kind: "article", slug: route.slug } : { kind: "profile" },
  });

  /**
   * Is text arriving right now?
   *
   * `pending` alone cannot say: it is also the state of a question that has not
   * started, and of an answer being replaced by a deeper search — which still
   * has the *old* text on screen. So the cursor and the greying key off this,
   * and the answer's own identity is what distinguishes them.
   */
  const stale = comment.replacing === true;
  const streaming = comment.status === "pending" && Boolean(comment.answer) && !stale;

  /* One box per comment. Stepping to the next comment with a half-typed
     question used to carry it across, so the reader asked about a passage they
     were no longer looking at. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the trigger; the effect reads nothing
  useEffect(() => {
    setFollowUp("");
  }, [comment.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Get out of the way while the reader is dragging out a new selection.
   *
   * The panel is pinned bottom-right, over the prose column — which is exactly
   * where the next sentence they want to ask about probably is. Since asking
   * several questions at once is the point (Greg, 2026-08-25: "kick off multiple
   * selection-searches at the same time"), the panel covering the text is a real
   * obstruction rather than a cosmetic one.
   *
   * Only for a drag that *starts* in the prose, so pressing one of the dialog's
   * own buttons doesn't make it vanish under the reader's finger.
   */
  const [dodging, setDodging] = useState(false);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("td.text .prose")) setDodging(true);
    };
    const up = () => setDodging(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <aside
      /* `busy` holds the box at a constant height while an answer is arriving.
         Two separate things used to move the ✕ under the reader's finger — the
         box is pinned by its BOTTOM edge so it grew upward with every paragraph,
         and the whole box scrolled so the header then left out of the top — and
         fixing either alone leaves it moving. This is the first half; the
         `.cmt-body` wrapper below is the second. Greg, 2026-08-26: "the cross in
         the top-right keeps moving as the text streams in."

         Not a permanently constant height, which would put a two-line
         explanation in a 34rem box. The relax-to-fit happens when the answer
         settles, by which time the reader is no longer aiming at a button. */
      className={`cmt-dialog${dodging ? " dodging" : ""}${
        comment.status === "pending" ? " busy" : ""
      }`}
      role="dialog"
      /* **Not always an explanation any more.** A comment with no answer is the
         reader's own mark on the passage, and calling that "Explanation" to a
         screen reader would announce the model's voice over theirs. The three
         cases in one expression, because the visible label below must say the
         same thing. */
      aria-label={comment.status === "none" ? (comment.body ? "Comment" : "Bookmark") : "Explanation"}
    >
      <header>
        <span className="cmt-dialog-label">
          {comment.status === "none" ? (comment.body ? "Comment" : "Bookmark") : "Explanation"}
        </span>
        {/* Only worth the room once there is somewhere to go. */}
        {total > 1 && (
          <span className="cmt-nav">
            <button type="button" onClick={onPrev} disabled={!hasPrev} title="Previous comment, up the article" aria-label="Previous comment">
              <ChevronLeft size={15} />
            </button>
            <span className="cmt-count" aria-live="polite">
              {position} / {total}
            </span>
            <button type="button" onClick={onNext} disabled={!hasNext} title="Next comment, down the article" aria-label="Next comment">
              <ChevronRight size={15} />
            </button>
          </span>
        )}
        <button type="button" className="cmt-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <X size={15} />
        </button>
      </header>

      <div className="cmt-body">
      {/* The reader's own selection, quoted back. Without it the panel is an
          answer to a question you can no longer see, once the page has scrolled
          or you have stepped to a comment somewhere else entirely. */}
      <blockquote className="cmt-quote">{comment.quote}</blockquote>

      {/* **The reader's own words, above the model's.** Whose panel this is
          shows in the order: what they wrote comes first, and an explanation —
          which only a comment made before 2026-08-28 has — sits underneath it.
          Editable in place, because a note you cannot change is a note you stop
          making. */}
      <CommentBody
        key={comment.id}
        body={comment.body ?? ""}
        onSave={onEdit}
      />

      {onOpenThread && (
        <button type="button" className="linky cmt-open-thread" onClick={onOpenThread}>
          Open the conversation this started
        </button>
      )}

      {/* The spinner is only for the wait before any words. Once text is
          arriving the answer below says everything this line would, and two
          things saying it reads as a stall. `streaming` is the state a
          non-streamed version of this panel had no name for. */}
      {comment.status === "pending" && !streaming && (
        <div className="cmt-loading">
          <LoaderCircle className="cmt-spinner" size={13} />
          <span>
            {comment.answer
              ? "Searching the web, and rewriting this…"
              : "Reading the article, and searching if it needs to…"}
          </span>
        </div>
      )}

      {comment.status === "error" && (
        <div className="cmt-error">
          <p>
            {/* copy.md's avoid-list names "Something went wrong" by name, for
                saying nothing. It can only appear if a comment reached `error`
                status with no message stored, which nothing does today — but a
                fallback nobody expects to see is exactly where a rule stops
                being followed, and this one sat five lines from the button the
                whole retry change was about. */}
            {comment.error ?? PROVIDER_UNREADABLE.message}
            {/* Said out loud, because otherwise the answer below looks like the
                one that just failed. A reader who pressed "search the web" and
                got their old answer back with a red line above it deserves to
                be told which is which. */}
            {comment.answer ? " The answer below is the one you already had." : ""}
          </p>
          {/* Not offered when the message itself says another go cannot work —
              out of credit, no key, a request the service will refuse again.
              copy.md calls telling somebody to retry into a wall "the expensive
              mistake", and a button is a more emphatic way of saying it than a
              sentence. src/messages.ts § worthRetrying; an error this app did
              not write still gets the button. */}
          {worthRetrying(comment.error) && (
            <button type="button" className="linky" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}

      {/* Rendered whatever the status, because there are now four states that
          can have text in them and only one of them is `done`: an answer
          arriving a few words at a time, an answer being replaced by a deeper
          search, a half answer kept from a stream that broke, and the finished
          thing. Keying on `done` was right when the only way to have text was
          to have all of it. */}
      {comment.answer && (
        <div className={`cmt-answer${stale ? " stale" : ""}`} aria-busy={streaming}>
          {paragraphs(comment.answer).map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rebuilt whole on each answer, no child state
            <p key={i}>{p}</p>
          ))}
          {streaming && <span className="cmt-cursor" aria-hidden="true" />}
        </div>
      )}

      {comment.citations && comment.citations.length > 0 && (
        <div className="cmt-sources">
          <div className="cmt-sources-label">Sources</div>
          <ol>
            {comment.citations.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noreferrer noopener">
                  {c.title ?? hostOf(c.url)}
                </a>
                <span className="cmt-host">{hostOf(c.url)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      </div>

      {/* Outside `.cmt-body`, so it is pinned rather than scrolling away with a
          long answer. It used to scroll with it, deliberately — but that was
          when the whole panel scrolled and the footer was the only fixed thing.
          Now that the transcript is the only part that moves, a composer that
          slid off the bottom would be the same complaint as the moving ✕. */}
      {comment.status !== "pending" && (
        <form
          className="cmt-followup"
          onSubmit={(e) => {
            e.preventDefault();
            /* Not while a transcript is on its way: `readOnly` stops typing and
               not Enter, and sending here would hand chat the rough guess a
               moment before the good words landed. GPT Sol's plan review. */
            if (dictate.readOnly) return;
            const q = followUp.trim();
            if (!q) return;
            setFollowUp("");
            onDiscuss(q);
          }}
        >
          <input
            type="text"
            ref={followUpBox}
            value={followUp}
            readOnly={dictate.readOnly}
            onChange={(e) => setFollowUp(e.target.value)}
            /* Escape closes the dialog from a window listener, which would eat
               a half-typed question without warning. Stopped here so the first
               Escape clears the box and the second closes the panel. */
            onKeyDown={(e) => {
              if (e.key === "Escape" && followUp) {
                e.stopPropagation();
                setFollowUp("");
              }
            }}
            placeholder="Ask a follow-up…"
            aria-label="Ask a follow-up question about this passage"
          />
          {dictate.dictation.supported && (
            <DictationButton dictation={dictate.dictation} toggle={dictate.toggle} />
          )}
          <button
            type="submit"
            className="linky"
            disabled={dictate.readOnly || !followUp.trim()}
          >
            Ask in chat
          </button>
          <DictationStrip dictation={dictate.dictation} />
        </form>
      )}

      <footer>
        {comment.status === "done" && <SearchBadge comment={comment} />}
        {/* Not "Try again", which is what the error state offers and means
            something else. This is the reader saying the answer was thin, and
            the model is told exactly that. Hidden while one is running, because
            two overlapping re-asks race to write the same row. */}
        {comment.status !== "pending" && (
          <Tooltip
            content={
              <>
                <strong>Search the web properly.</strong> Replaces this answer with one that goes
                and looks, rather than answering from what the model already knew.
              </>
            }
          >
            <button type="button" className="linky cmt-deepen" onClick={onDeepen}>
              Search the web
            </button>
          </Tooltip>
        )}
        {/* Said here rather than in the panel body, because the whole point of
            firing several at once is that you go on reading while they run. */}
        {pending > 0 && (
          <span className="cmt-inflight">
            <LoaderCircle className="cmt-spinner" size={10} />
            {pending} still working
          </span>
        )}
        <button type="button" className="linky cmt-delete" onClick={onDelete}>
          Delete
        </button>
      </footer>
    </aside>
  );
}

/**
 * Whether the model went to the web, as a globe you can hover.
 *
 * Greg, 2026-08-25: "indicate (with an icon + hover-tooltip or similar) in the
 * dialog box whether or not a web search was used."
 *
 * Two states, and the *absence* of a search is as much a fact as its presence —
 * the model chooses per question (comments.md#decision-web-research), so a
 * silent icon would leave the reader unable to tell "checked and it was fine"
 * from "never looked". So the un-searched globe is drawn too, struck through and
 * dimmed, rather than omitted — Lucide's `GlobeOff` (see docs/project/icons.md).
 */
function SearchBadge({ comment }: { comment: ClientComment }) {
  const searched = (comment.searches ?? 0) > 0;
  const sources = comment.citations?.length ?? 0;
  return (
    <Tooltip
      placement="top"
      className="tip-search"
      content={
        searched ? (
          <>
            <strong>Checked the web.</strong> The model ran{" "}
            {comment.searches === 1 ? "one search" : `${comment.searches} searches`}
            {sources > 0 && ` and cited ${sources === 1 ? "one source" : `${sources} sources`}`},
            listed above.
          </>
        ) : (
          <>
            <strong>No web search.</strong> Answered from the article alone — the model judged it
            already knew enough. It decides per question, so this is a choice, not a setting.
          </>
        )
      }
    >
      {/* tabIndex is what makes the tooltip reachable without a mouse: Tooltip.tsx
          opens on focus (useFocus), so this is the keyboard path to the
          explanation. The rule is right in general — a focusable non-interactive
          element is usually a dead stop for a keyboard user — but here removing it
          would take accessibility away rather than add it. */}
      <span
        className={`cmt-search ${searched ? "on" : "off"}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the tooltip
        tabIndex={0}
        role="img"
        aria-label={
          searched
            ? `Checked the web: ${comment.searches} search${comment.searches === 1 ? "" : "es"}`
            : "No web search — answered from the article alone"
        }
      >
        <Globe size={13} aria-hidden="true">
          {/* Lucide's own `GlobeOff` is the wrong tool at this size: it draws the
              globe as arc fragments knocked out around the slash, and below
              ~16px those fragments turn to mush. One whole globe and one clean
              diagonal survives being small. The diagonal has to run past the
              circle at both ends — stopped short it reads as another line *of*
              the globe rather than a line through it. `aria-hidden` is passed
              by hand because Lucide stops adding it the moment an icon has
              children — docs/project/icons.md. */}
          {!searched && <path d="M2.5 21.5 21.5 2.5" key="struck" />}
        </Globe>
        {searched && <span className="cmt-search-n">{comment.searches}</span>}
      </span>
    </Tooltip>
  );
}

/**
 * Blank-line-separated paragraphs, rendered as text.
 *
 * Text, not HTML: this is model output landing next to the author's prose, and
 * the one thing vision.md § Principles will not have is generated content that
 * can dress itself up as the article. React escapes it for us; there is no
 * `dangerouslySetInnerHTML` on this path and there should never be one.
 */
function paragraphs(answer: string): string[] {
  return answer
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The reader's own words on a comment, editable in place.
 *
 * ## Why it commits on blur rather than with a Save button
 *
 * A button is one more thing to hit, and the failure it protects against —
 * losing what you typed — is the one this actually causes: a reader who edits a
 * note and then presses the ✕ or steps to the next comment loses the edit,
 * because the button was never pressed. Blur fires for all three of those, so
 * committing there is what keeps the words. ⌘/Ctrl+Enter commits too, for the
 * reader who wants to say "done" with the keyboard.
 *
 * **Keyed on the comment id by the caller**, so stepping between comments
 * remounts this and cannot carry one reader's half-edited note onto another
 * passage — the same bug the follow-up box below fixed once already.
 *
 * The empty string is sent as `null`: a cleared box is a comment becoming a
 * bare bookmark again, and `""` is not a value the store may hold.
 */
function CommentBody({ body, onSave }: { body: string; onSave(next: string | null): void }) {
  const [draft, setDraft] = useState(body);
  /* What is actually stored, so a commit that changes nothing sends nothing. A
     PATCH per blur would rewrite `updatedAt` every time the reader clicked
     through a comment, and "edited just now" on a note they only looked at is a
     small lie the panel would then have to tell. */
  const saved = useRef(body);

  const commit = () => {
    const next = draft.trim();
    if (next === saved.current) return;
    saved.current = next;
    onSave(next === "" ? null : next);
  };

  return (
    <textarea
      className="cmt-note"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
          return;
        }
        /* Escape closes the dialog from a window listener, which would throw
           away an uncommitted edit without warning. The first Escape puts the
           stored words back; the second closes the panel. */
        if (e.key === "Escape" && draft !== saved.current) {
          e.stopPropagation();
          setDraft(saved.current);
        }
      }}
      placeholder="Add a comment…"
      aria-label="Your comment on this passage"
      rows={2}
    />
  );
}
