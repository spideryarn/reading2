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
 */
import { useEffect } from "react";
import type { Comment } from "../types.js";

interface Props {
  comment: Comment;
  onClose(): void;
  onDelete(): void;
  onRetry(): void;
}

export function CommentDialog({ comment, onClose, onDelete, onRetry }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="cmt-dialog" role="dialog" aria-label="Explanation">
      <header>
        <span className="cmt-dialog-label">Explanation</span>
        <button className="cmt-close" onClick={onClose} title="Close (Esc)" aria-label="Close">
          ×
        </button>
      </header>

      {/* The reader's own selection, quoted back. Without it the panel is an
          answer to a question you can no longer see, once the page has scrolled. */}
      <blockquote className="cmt-quote">{comment.quote}</blockquote>

      {comment.status === "pending" && (
        <div className="cmt-loading">
          <span className="cmt-spinner" aria-hidden="true" />
          <span>Reading the article, and searching if it needs to…</span>
        </div>
      )}

      {comment.status === "error" && (
        <div className="cmt-error">
          <p>{comment.error ?? "Something went wrong."}</p>
          <button className="linky" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {comment.status === "done" && comment.answer && (
        <div className="cmt-answer">
          {paragraphs(comment.answer).map((p, i) => (
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
        {/* Said out loud, because "it did some web research" is unfalsifiable
            otherwise — and the model is free to decide it didn't need any. */}
        {comment.status === "done" && (
          <span className="cmt-meta" title={comment.model}>
            {comment.searches
              ? `${comment.searches} web search${comment.searches === 1 ? "" : "es"}`
              : "no web search needed"}
          </span>
        )}
        <button className="linky cmt-delete" onClick={onDelete}>
          Delete
        </button>
      </footer>
    </aside>
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
