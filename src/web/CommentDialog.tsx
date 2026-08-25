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
import type { Comment } from "../types.js";
import { Tooltip } from "./Tooltip.js";

interface Props {
  comment: Comment;
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
}

export function CommentDialog({
  comment,
  position,
  total,
  pending,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onClose,
  onDelete,
  onRetry,
}: Props) {
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

      {comment.status === "pending" && (
        <div className="cmt-loading">
          <LoaderCircle className="cmt-spinner" size={13} />
          <span>Reading the article, and searching if it needs to…</span>
        </div>
      )}

      {comment.status === "error" && (
        <div className="cmt-error">
          <p>{comment.error ?? "Something went wrong."}</p>
          <button type="button" className="linky" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {comment.status === "done" && comment.answer && (
        <div className="cmt-answer">
          {paragraphs(comment.answer).map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rebuilt whole on each answer, no child state
            <p key={i}>{p}</p>
          ))}
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

      <footer>
        {comment.status === "done" && <SearchBadge comment={comment} />}
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
function SearchBadge({ comment }: { comment: Comment }) {
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
