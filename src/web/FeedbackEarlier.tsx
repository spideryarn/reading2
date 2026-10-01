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
 * So: the date, what they called it, and what they wrote.
 * docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md.
 *
 * > It would be nice if we could provide a way to filter to things that have or
 * > have not been achieved and deployed.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-63)
 *
 * And now whether a change for each one has **shipped** — derived on the server
 * from the report's note, so on production it means "is in the version you are
 * using" — and a filter by it: All · Shipped · Not shipped.
 * docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md.
 *
 * > In Feedback / Earlier / All, add the indicator for whether each suggestion
 * > has shipped or not.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-7D)
 *
 * So in All a row that has not shipped says Not shipped, quietly.
 * docs/plans/261001c-earlier-tab-marks-not-shipped-too.md.
 *
 * ## Once per opening, per filter
 *
 * Each filter is read the first time it is chosen and kept while the reader
 * flips back and forth. Nothing can be filed and then looked for within one
 * opening — a successful send shuts the dialog and thanks the reader in a
 * toast — so reading again would buy no freshness. Shutting the dialog forgets
 * every filter's answer and goes back to All. An answer is stored under the
 * filter that asked for it, and only if it is that filter's latest request in
 * this opening: a generation counter drops anything that lands after the
 * dialog shut, and a per-filter sequence drops a Try again's older twin.
 */
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FEEDBACK_EARLIER_FAILED } from "../messages.js";
import {
  EARLIER_FEEDBACK_LIMIT,
  EARLIER_FEEDBACK_SHOWS,
  FEEDBACK_KINDS,
  type EarlierFeedbackPage,
  type EarlierFeedbackShow,
  type FeedbackKind,
} from "../types.js";
import { apiFetch } from "./lib/api.js";
import { exactly, relativeAgo } from "./relative-time.js";

export type EarlierState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "loaded"; page: EarlierFeedbackPage };

type EarlierStates = Record<EarlierFeedbackShow, EarlierState>;

const IDLE: EarlierStates = { all: { kind: "idle" }, shipped: { kind: "idle" }, unshipped: { kind: "idle" } };

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
      typeof report.body === "string" &&
      typeof report.shipped === "boolean"
    );
  });
}

export interface EarlierFeedback {
  /** The state of the filter showing. */
  earlier: EarlierState;
  show: EarlierFeedbackShow;
  setShow(show: EarlierFeedbackShow): void;
  retry(): void;
}

/**
 * The read, lazily. `wanted` is whether the Earlier tab is showing; `open` is
 * whether the dialog is. The first time both are true for a filter in an
 * opening, it reads.
 */
export function useEarlierFeedback(open: boolean, wanted: boolean): EarlierFeedback {
  const [states, setStates] = useState<EarlierStates>(IDLE);
  const [show, setShow] = useState<EarlierFeedbackShow>("all");
  const generation = useRef(0);
  const sequence = useRef<Record<EarlierFeedbackShow, number>>({ all: 0, shipped: 0, unshipped: 0 });

  const load = useCallback(async (which: EarlierFeedbackShow) => {
    const opening = generation.current;
    const mine = ++sequence.current[which];
    const current = () => opening === generation.current && mine === sequence.current[which];
    const settle = (state: EarlierState) => {
      if (current()) setStates((all) => ({ ...all, [which]: state }));
    };
    settle({ kind: "loading" });
    try {
      const res = await apiFetch(which === "all" ? "/api/feedback" : `/api/feedback?show=${which}`);
      if (!res.ok) {
        settle({ kind: "failed", message: FEEDBACK_EARLIER_FAILED.message });
        return;
      }
      const page: unknown = await res.json();
      settle(
        isEarlierFeedbackPage(page)
          ? { kind: "loaded", page }
          : { kind: "failed", message: FEEDBACK_EARLIER_FAILED.message },
      );
    } catch {
      settle({ kind: "failed", message: FEEDBACK_EARLIER_FAILED.message });
    }
  }, []);

  /* Shut: forget every answer, go back to All, and make any read still in the
     air land nowhere. */
  useEffect(() => {
    if (open) return;
    generation.current += 1;
    setShow("all");
    /* The same object when there is nothing to forget, so a dialog that was
       never on this tab is not re-rendered for being shut. */
    setStates((current) =>
      EARLIER_FEEDBACK_SHOWS.every((which) => current[which].kind === "idle") ? current : IDLE,
    );
  }, [open]);

  const earlier = states[show];
  useEffect(() => {
    if (open && wanted && earlier.kind === "idle") void load(show);
  }, [open, wanted, earlier.kind, show, load]);

  return { earlier, show, setShow, retry: () => void load(show) };
}

/** Shorter than the toggle's "A problem": this is a label on a row, not a choice. */
const KIND_WORD: Record<FeedbackKind, string> = {
  problem: "Problem",
  suggestion: "Suggestion",
};

const SHOW_WORD: Record<EarlierFeedbackShow, string> = {
  all: "All",
  shipped: "Shipped",
  unshipped: "Not shipped",
};

/** Said literally, per filter: "not shipped" includes declined, so never "outstanding". */
const EMPTY: Record<EarlierFeedbackShow, string> = {
  all: "You haven't sent us any feedback yet.",
  shipped: "None of your reports has a shipped change yet.",
  unshipped: "Every report you've sent has a shipped change.",
};

const SHIPPED_TITLE = "We shipped a change for this, and it is in the version of Spideryarn you're using.";

/** Careful, because "not shipped" is only "no note marks it shipped": it may be
 *  declined, waiting, on its way, or — with a missing note — already here. */
const UNSHIPPED_TITLE = "This isn't marked as shipped in the version of Spideryarn you're using.";

/**
 * `12 Sept 2026, 10:45 · 3d ago` — the exact time and how long ago, both.
 * Greg, 2026-09-30 (spya-d9xdhs): *"can we include the exact timestamp and
 * maybe a human-readable `3d ago` or `3h ago`?"* The narrow form is his;
 * past relative-time.ts's 30-day threshold it is left off and the exact time
 * stands alone. `createdAt` is checked parseable on the way in (above), so the
 * `?? iso` is unreachable rather than a fallback anyone sees.
 */
function when(iso: string, now: number): string {
  const exact = exactly(iso) ?? iso;
  const ago = relativeAgo(iso, now, "narrow");
  return ago === undefined ? exact : `${exact} · ${ago}`;
}

/**
 * All · Shipped · Not shipped. `aria-pressed` buttons in a fieldset, the same shape as the
 * Problem / Suggestion toggle; every one `type="button"` so none can submit
 * the hidden Write form.
 */
export function EarlierFilter({
  show,
  onShow,
}: {
  show: EarlierFeedbackShow;
  onShow(show: EarlierFeedbackShow): void;
}) {
  return (
    <fieldset className="fb-kind">
      <legend className="fb-kind-legend">Show</legend>
      {EARLIER_FEEDBACK_SHOWS.map((which) => (
        <button
          key={which}
          type="button"
          className="fb-show-button"
          aria-pressed={show === which}
          onClick={() => onShow(which)}
        >
          {SHOW_WORD[which]}
        </button>
      ))}
    </fieldset>
  );
}

/** What the Earlier panel shows, in each of its four states. */
export function EarlierList({
  earlier,
  show,
  retry,
}: {
  earlier: EarlierState;
  show: EarlierFeedbackShow;
  retry(): void;
}) {
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
      /* Once per render, so every row is measured from the same moment. */
      const now = Date.now();
      if (reports.length === 0) {
        return <p className="fb-earlier-status">{EMPTY[show]}</p>;
      }
      return (
        <>
          <ol className="fb-earlier-list">
            {reports.map((report) => (
              <li key={report.id} className="fb-earlier-item">
                <p className="fb-earlier-meta">
                  <time dateTime={report.createdAt}>{when(report.createdAt, now)}</time>
                  {report.kind === null ? null : ` · ${KIND_WORD[report.kind]}`}
                  {report.shipped ? (
                    <>
                      {" · "}
                      <span className="fb-earlier-shipped" title={SHIPPED_TITLE}>
                        Shipped
                      </span>
                    </>
                  ) : show === "all" ? (
                    /* Only in All (SPIDERYARN-READING2-7D): there an absence
                       would not read as an answer, while in Not shipped every
                       row would say it. */
                    <>
                      {" · "}
                      <span className="fb-earlier-unshipped" title={UNSHIPPED_TITLE}>
                        Not shipped
                      </span>
                    </>
                  ) : null}
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
