/**
 * **The Feedback dialog's Earlier tab** — the signed-in reader's own previous
 * reports, as a list. The read and the panel; FeedbackDialog.tsx owns the tabs
 * and the guards that keep the hidden Write panel switched off.
 *
 * > In the feedback dialog box, it would be nice to have a tab showing previous
 * > feedback that this user has provided, just as a kind of list. I mean, it
 * > would be amazing if we could indicate which ones have been acted on, but I
 * > suspect that will involve access to the database that you currently don't
 * > have. So do the simplest thing first.
 * >
 * > — Greg, 2026-09-12 (SPIDERYARN-READING2-3R)
 *
 * So: the date, what they called it, and what they wrote. **Not** what came of
 * each one — the plan names what that would take.
 * docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md.
 *
 * ## Once per opening
 *
 * The list is read the first time the tab is chosen and kept while the reader
 * flips back and forth. Nothing can be filed and then looked for within one
 * opening — a send ends on the thank-you panel, which has no tabs — so reading
 * again would buy no freshness. Shutting the dialog forgets it, and a
 * generation counter drops an answer that lands after that: the same shape as
 * `shotGeneration` in the dialog.
 */
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FEEDBACK_EARLIER_FAILED } from "../messages.js";
import {
  EARLIER_FEEDBACK_LIMIT,
  FEEDBACK_KINDS,
  type EarlierFeedbackPage,
  type FeedbackKind,
} from "../types.js";
import { apiFetch } from "./lib/api.js";

export type EarlierState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "loaded"; page: EarlierFeedbackPage };

/** A 200 is only success when it carries the wire shape the panel can render. */
function isEarlierFeedbackPage(value: unknown): value is EarlierFeedbackPage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.reports) || typeof page.more !== "boolean") return false;
  return page.reports.every((value: unknown) => {
    if (typeof value !== "object" || value === null) return false;
    const report = value as Record<string, unknown>;
    return (
      typeof report.id === "string" &&
      typeof report.createdAt === "string" &&
      !Number.isNaN(Date.parse(report.createdAt)) &&
      (report.kind === null || FEEDBACK_KINDS.some((kind) => kind === report.kind)) &&
      typeof report.body === "string"
    );
  });
}

/**
 * The read, lazily. `wanted` is whether the Earlier tab is showing; `open` is
 * whether the dialog is. The first time both are true in an opening, it reads.
 */
export function useEarlierFeedback(
  open: boolean,
  wanted: boolean,
): { earlier: EarlierState; retry(): void } {
  const [earlier, setEarlier] = useState<EarlierState>({ kind: "idle" });
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setEarlier({ kind: "loading" });
    try {
      const res = await apiFetch("/api/feedback");
      if (!res.ok) {
        if (mine === generation.current) {
          setEarlier({ kind: "failed", message: FEEDBACK_EARLIER_FAILED.message });
        }
        return;
      }
      const page: unknown = await res.json();
      if (mine !== generation.current) return;
      setEarlier(
        isEarlierFeedbackPage(page)
          ? { kind: "loaded", page }
          : { kind: "failed", message: FEEDBACK_EARLIER_FAILED.message },
      );
    } catch {
      if (mine === generation.current) {
        setEarlier({ kind: "failed", message: FEEDBACK_EARLIER_FAILED.message });
      }
    }
  }, []);

  /* Shut: forget the list, and make any read still in the air land nowhere. */
  useEffect(() => {
    if (open) return;
    generation.current += 1;
    /* The same object when there is nothing to forget, so a dialog that was
       never on this tab is not re-rendered for being shut. */
    setEarlier((current) => (current.kind === "idle" ? current : { kind: "idle" }));
  }, [open]);

  useEffect(() => {
    if (open && wanted && earlier.kind === "idle") void load();
  }, [open, wanted, earlier.kind, load]);

  return { earlier, retry: () => void load() };
}

/** Shorter than the toggle's "A problem": this is a label on a row, not a choice. */
const KIND_WORD: Record<FeedbackKind, string> = {
  problem: "Problem",
  suggestion: "Suggestion",
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** What the Earlier panel shows, in each of its four states. */
export function EarlierList({ earlier, retry }: { earlier: EarlierState; retry(): void }) {
  switch (earlier.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <p className="fb-earlier-status" role="status">
          <LoaderCircle className="cmt-spinner" size={14} aria-hidden="true" />
          Loading what you've sent us
        </p>
      );
    case "failed":
      return (
        <div className="fb-failed" role="alert">
          <p>{earlier.message}</p>
          <div className="fb-failed-outs">
            <button type="button" className="fb-copy" onClick={retry}>
              Try again
            </button>
          </div>
        </div>
      );
    case "loaded": {
      const { reports, more } = earlier.page;
      if (reports.length === 0) {
        return <p className="fb-earlier-status">You haven't sent us any feedback yet.</p>;
      }
      return (
        <>
          <ol className="fb-earlier-list">
            {reports.map((report) => (
              <li key={report.id} className="fb-earlier-item">
                <p className="fb-earlier-meta">
                  <time dateTime={report.createdAt}>{when(report.createdAt)}</time>
                  {report.kind === null ? null : ` · ${KIND_WORD[report.kind]}`}
                </p>
                {/* Text, never markup, and whole: the reader wrote it, and a
                    clamp would need an expander. `pre-wrap` keeps their lines. */}
                <p className="fb-earlier-body">{report.body}</p>
              </li>
            ))}
          </ol>
          {more ? (
            <p className="fb-earlier-status">Showing your {EARLIER_FEEDBACK_LIMIT} most recent.</p>
          ) : null}
        </>
      );
    }
    default: {
      const unreachable: never = earlier;
      return unreachable;
    }
  }
}
