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
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Globe, LoaderCircle, X } from "lucide-react";
import type { ClientComment } from "./useComments.js";
import { Tooltip } from "./Tooltip.js";

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
   * The reader typed a follow-up. Takes them to chat rather than growing a
   * transcript in here — Greg's call, see chat-handoff.ts.
   */
  onDiscuss(question: string): void;
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
}: Props) {
  const [followUp, setFollowUp] = useState("");

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
      className={`cmt-dialog${dodging ? " dodging" : ""}`}
      role="dialog"
      aria-label="Explanation"
    >
      <header>
        <span className="cmt-dialog-label">Explanation</span>
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

      {/* The reader's own selection, quoted back. Without it the panel is an
          answer to a question you can no longer see, once the page has scrolled
          or you have stepped to a comment somewhere else entirely. */}
      <blockquote className="cmt-quote">{comment.quote}</blockquote>

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
            {comment.error ?? "Something went wrong."}
            {/* Said out loud, because otherwise the answer below looks like the
                one that just failed. A reader who pressed "search the web" and
                got their old answer back with a red line above it deserves to
                be told which is which. */}
            {comment.answer ? " The answer below is the one you already had." : ""}
          </p>
          <button type="button" className="linky" onClick={onRetry}>
            Try again
          </button>
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

      {/* Between the answer and the footer, so the footer keeps being the row of
          small controls it is, and the header — with its prev/next — is
          untouched. The panel scrolls, so this scrolls with the answer rather
          than pinning to the bottom of a long one. */}
      {comment.status !== "pending" && (
        <form
          className="cmt-followup"
          onSubmit={(e) => {
            e.preventDefault();
            const q = followUp.trim();
            if (!q) return;
            setFollowUp("");
            onDiscuss(q);
          }}
        >
          <input
            type="text"
            value={followUp}
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
          <button type="submit" className="linky" disabled={!followUp.trim()}>
            Ask in chat
          </button>
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
