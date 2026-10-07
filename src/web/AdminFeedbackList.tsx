/**
 * One bug report, drawn — and the screenshot behind it.
 *
 * Split out of [AdminPage.tsx](AdminPage.tsx) because the report card is the
 * whole of what `/admin/feedback` has to say, the way
 * [admin-columns.tsx](admin-columns.tsx) is the whole of what the users page
 * has to say about its table. The page keeps the shell, the sort and the
 * refresh; this file keeps the shape of a report.
 *
 * ## Why cards and not a `DataTable`
 *
 * The shelf and the users page are tables because their rows are numbers, and a
 * table is the right shape for numbers: eleven of them line up, and comparing
 * two accounts means reading down a column.
 *
 * A bug report is a box of somebody's prose. Twelve of them in a `<td>` is a
 * page nobody can read, and the comparison a table exists for — *which report
 * is longer* — is not a question anybody has. So:
 * one card per report, newest first, and the sort is the server's single
 * promise rather than eleven of the reader's.
 *
 * ## The rule about what may be added here
 *
 * Everything on this card is either **something the reader typed into the
 * Feedback dialog** or **a value from a closed vocabulary we wrote**. That is
 * the sentence docs/project/feedback.md § The one rule states about what may go
 * *into* a report, and it is the whole reason this page is allowed to read
 * across owners at all — see docs/project/admin.md. A title, a comment, a note
 * or a sentence of article prose reaching this card would be a new decision.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Clock } from "lucide-react";

import type { AdminFeedbackDetail, AdminFeedbackReport, FeedbackKind } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { ReaderFacingError } from "./lib/reader-facing.js";
import { exactly, timeAgo } from "./relative-time.js";

/**
 * What the two mirror timestamps mean, **as words**.
 *
 * `mirror_attempted_at is not null and mirrored_at is null` is the query
 * docs/project/feedback.md advertises for a report Sentry did not take, and
 * being able to see that state is a large part of why this page earns its
 * place — until now nothing read it, because Sentry was the only reader and a
 * report Sentry never received is not in Sentry to be found.
 *
 * Two raw timestamps hide it. A sentence does not.
 */
function mirrorState(report: AdminFeedbackReport): {
  label: string;
  tone: "ok" | "warn" | "quiet";
  detail: string | undefined;
} {
  if (report.mirroredAt) {
    return {
      label: "mirrored to Sentry",
      tone: "ok",
      detail: exactly(report.mirroredAt),
    };
  }
  if (report.mirrorAttemptedAt) {
    /* **The interesting one.** We handed it over and Sentry never said yes: the
       SDK sends asynchronously and swallows transport failures, so this is what
       a dropped mirror looks like from here. The row is still the report — that
       is the whole design — so this is a note about Sentry, not about the
       report, and it says so. */
    return {
      label: "sent to Sentry, not acknowledged",
      tone: "warn",
      detail: exactly(report.mirrorAttemptedAt),
    };
  }
  return { label: "not sent to Sentry", tone: "quiet", detail: undefined };
}

const TONE: Record<"ok" | "warn" | "quiet", string> = {
  ok: "tw:text-ink-faint",
  warn: "tw:text-danger",
  quiet: "tw:text-ink-faint",
};

/**
 * **What the reader wrote**, as one block, in their own order.
 *
 * `whitespace-pre-wrap`, because they pressed Return in a textarea and meant it
 * — a report reflowed into one paragraph loses the numbered steps, which is the
 * half that reproduces the bug. And `break-words` beside it, because a pasted
 * 2,000-character URL with no space in it would otherwise push the card off the
 * page.
 *
 * **Never truncated.** Reports filed before 2026-09-02 carry the three old
 * answers glued together with their headings, so a legacy body can be three
 * times the dialog's current limit — and the oldest reports are the ones most
 * likely to be why somebody opened this page. GPT Sol, 2026-09-02.
 */
function Body({ text }: { text: string }) {
  return (
    <p className="tw:m-0 tw:mt-3 tw:break-words tw:whitespace-pre-wrap tw:text-sm tw:text-foreground">
      {text}
    </p>
  );
}

/**
 * *Problem*, *suggestion*, or **not specified** — and the third is drawn rather
 * than left blank.
 *
 * Greg, 2026-09-02: *"don't default to Problem. Default to null/unknown."* So
 * `null` is a real answer, and it is also every report filed before the toggle
 * existed. A page that simply omitted the chip would make "they did not say"
 * and "we forgot to render it" the same thing on screen.
 */
function Kind({ kind }: { kind: FeedbackKind | null }) {
  return (
    <span
      className={`tw:rounded-full tw:border tw:border-border tw:px-2 tw:py-0.5 ${
        kind === null ? "tw:text-ink-faint tw:italic" : "tw:text-muted-foreground"
      }`}
    >
      {kind === null ? "kind not specified" : kind}
    </span>
  );
}

/**
 * The screenshot, fetched only when somebody opens it.
 *
 * **`apiFetch` and a blob URL, not `<img src="/api/admin/…">`.** Authentication
 * here is an `Authorization: Bearer` header rather than a cookie
 * (lib/api.ts § A header rather than a cookie), and an `<img>` sends no headers
 * — so a plain `src` would arrive unauthenticated and 401. The same dance is in
 * Metadata.tsx and SourceLink.tsx.
 *
 * ## Two effects, and the split is the bug fix
 *
 * The first draft had one effect that fetched, called `setUrl`, and revoked
 * `made` in its cleanup — with `url` in its dependency list. So the `setUrl`
 * re-rendered the component, the dependency changed, the cleanup ran, and it
 * revoked the very URL it had just handed to state: an `<img>` pointing at
 * nothing, intermittently, depending on render timing. GPT Sol found it,
 * 2026-09-02.
 *
 * So: **one effect fetches, and one owns the lifetime of the URL.** The
 * revoking effect depends on the URL and nothing else, which is the only thing
 * it should react to. A page whose screenshots were all opened would otherwise
 * hold every PNG alive until the tab closed.
 */
function Screenshot({ ownerId, id, bytes }: { ownerId: string; id: string; bytes: number }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || url || error) return;
    /* The component may unmount, or the details may close, while the bytes are
       in flight. `live` is what stops a `setState` on a gone component and,
       more importantly, stops an orphaned object URL being created with nobody
       left to revoke it. */
    let live = true;
    void apiFetch(
      `/api/admin/feedback/${encodeURIComponent(ownerId)}/${encodeURIComponent(id)}/screenshot`,
    )
      .then(async (res) => {
        /* `res.ok` before `blob()`: an error body is perfectly good bytes, and
           without this the reader would get a broken image rather than the
           sentence saying what went wrong. */
        if (!res.ok) throw new ReaderFacingError(`The screenshot did not load (${res.status}).`);
        const made = URL.createObjectURL(await res.blob());
        if (live) setUrl(made);
        else URL.revokeObjectURL(made);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open, ownerId, id, url, error]);

  /* **The URL's whole lifetime, and nothing else's.** Revoked when it is
     replaced and when this component goes. */
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <details
      className="tw:mt-3"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="tw:cursor-pointer tw:text-xs tw:text-muted-foreground">
        <Camera size={12} className="tw:mr-1 tw:inline" />
        Screenshot ({Math.round(bytes / 1024)} KB)
      </summary>
      {error ? (
        <p className="tw:mt-2 tw:text-xs tw:text-danger">{error}</p>
      ) : url ? (
        <img
          src={url}
          alt="What the reader was looking at when they filed this report"
          className="tw:mt-2 tw:h-auto tw:max-w-full tw:rounded-md tw:border tw:border-border"
        />
      ) : (
        <p className="tw:mt-2 tw:text-xs tw:text-muted-foreground">Loading…</p>
      )}
    </details>
  );
}

/**
 * The diagnostics blob, fetched only when somebody opens it.
 *
 * **Not in the list response**, and that is a size decision rather than a taste
 * one: the allowlist permits something like 179 KB of JSON per report
 * (src/feedback-payload.ts), so a page of them would be tens of megabytes of
 * something nobody has opened, over whatever the platform's response ceiling
 * is. GPT Sol, 2026-09-02. The list carries the *version*, which is enough to
 * know there is a blob and to label the toggle.
 */
function Diagnostics({ ownerId, id, version }: { ownerId: string; id: string; version: number }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<AdminFeedbackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || payload || error) return;
    let live = true;
    void apiFetch(`/api/admin/feedback/${encodeURIComponent(ownerId)}/${encodeURIComponent(id)}`)
      .then((res) => readJson<{ report: AdminFeedbackDetail }>(res))
      .then((body) => {
        if (live) setPayload(body.report);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open, ownerId, id, payload, error]);

  return (
    <details
      className="tw:mt-3"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="tw:cursor-pointer tw:text-xs tw:text-muted-foreground">
        Diagnostics (v{version})
      </summary>
      {error ? (
        <p className="tw:mt-2 tw:text-xs tw:text-danger">{error}</p>
      ) : payload ? (
        /* Rendered as its own JSON rather than picked apart into fields. The
           blob is versioned precisely so an old report stays readable when the
           shape changes (src/types.ts § FeedbackDiagnosticsPayload), and a
           renderer that knew the shape would be the thing that stops that being
           true. */
        <pre className="tw:mt-2 tw:max-h-96 tw:overflow-auto tw:rounded-md tw:bg-muted tw:p-3 tw:text-[0.7rem] tw:text-muted-foreground">
          {JSON.stringify(payload.diagnostics?.payload ?? null, null, 2)}
        </pre>
      ) : (
        <p className="tw:mt-2 tw:text-xs tw:text-muted-foreground">Loading…</p>
      )}
    </details>
  );
}

/** A correlation handle: a short label and a value worth copying. */
function Handle({ label, value }: { label: string; value: string }) {
  return (
    <span className="tw:whitespace-nowrap">
      <span className="tw:text-ink-faint">{label} </span>
      <code className="tw:font-mono tw:text-[0.7rem] tw:text-muted-foreground">{value}</code>
    </span>
  );
}

/**
 * **Ignore, and Undo** — the one thing on this page that writes.
 *
 * Greg, 2026-10-03 (`spya-g95x4j`): *"I just saw feedback that I wished I could
 * delete, and there wasn't a way to do it, or at least mark it as to be
 * ignored."* A mark rather than a delete: it sets one timestamp on the row,
 * the report stays in the list with its words, and Undo clears it. What it
 * buys is that `scripts/feedback-unswept.ts` stops handing the report to the
 * agents that work through them. docs/plans/261003j-….
 *
 * **Drawn from the server's answer, not from the press.** The card changes
 * when the PATCH comes back with the row, so a write that failed leaves the
 * card as it was and says so beside the button, which can be pressed again.
 * The write itself is the hook's, because it has to take turns with the
 * list's own requests — useAdminFeedback.ts § `setIgnored`.
 */
type OnIgnore = (report: AdminFeedbackReport, ignored: boolean) => Promise<void>;

function IgnoreControl({
  report,
  now,
  disabled,
  onIgnore,
}: {
  report: AdminFeedbackReport;
  now: number;
  disabled: boolean;
  onIgnore: OnIgnore;
}) {
  const [error, setError] = useState<string | null>(null);
  const ignored = report.ignoredAt !== null;

  const press = () => {
    setError(null);
    onIgnore(report, !ignored).catch((e: unknown) => {
      setError(describeFetchFailure(e instanceof Error ? e : new Error(String(e))));
    });
  };

  return (
    <span className="tw:inline-flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
      {report.ignoredAt !== null && (
        <span className="tw:text-ink-faint" title={exactly(report.ignoredAt)}>
          Ignored {timeAgo(report.ignoredAt, now) ?? ""}
        </span>
      )}
      <button
        type="button"
        onClick={press}
        disabled={disabled}
        title={
          ignored
            ? "Stop ignoring this report, so it is worked through like any other"
            : "Leave this report out of the ones we work through. It stays here and can be undone."
        }
        className="tw:inline-flex tw:h-7 tw:items-center tw:rounded-full tw:border tw:border-border tw:bg-transparent tw:px-3 tw:text-xs tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground tw:disabled:opacity-50"
      >
        {ignored ? "Undo" : "Ignore"}
      </button>
      {error && (
        <span role="alert" className="tw:basis-full tw:text-danger">
          That did not save. {error}
        </span>
      )}
    </span>
  );
}

export function FeedbackCard({
  report,
  now,
  disabled,
  onIgnore,
}: {
  report: AdminFeedbackReport;
  now: number;
  /** The list is loading or another write is out — useAdminFeedback.ts § `setIgnored`. */
  disabled: boolean;
  onIgnore: OnIgnore;
}) {
  const mirror = mirrorState(report);
  const when = timeAgo(report.createdAt, now) ?? "";
  const ignored = report.ignoredAt !== null;
  /* An ignored report is dimmed, not hidden: Greg can see what he ignored and
     take it back. The control row below stays at full strength, so Undo is
     not itself faint. */
  const dim = ignored ? "tw:opacity-50" : "";

  return (
    <li
      data-ignored={ignored ? "true" : undefined}
      className="tw:mb-4 tw:list-none tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-4"
    >
      <div
        className={`tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-x-4 tw:gap-y-1 ${dim}`}
      >
        <span className="tw:text-sm tw:text-foreground">{report.reporterEmail}</span>
        <span className="tw:text-xs tw:text-muted-foreground" title={exactly(report.createdAt)}>
          {when}
        </span>
      </div>

      <div
        className={`tw:mt-1 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:text-xs tw:text-muted-foreground ${dim}`}
      >
        {/* The kind, the environment, the slug — and, below, the whole address
            the reader was on. This comment said "never the URL" while sitting
            directly above the element that renders it, from 2026-09-02 until a
            cross-family review found it on 2026-09-03. The address does carry
            `?q=`, `?find=` and whole third-party addresses, which is why storing
            it was a decision Greg made out loud and why the reader is told —
            docs/project/feedback.md § The one rule. */}
        <Kind kind={report.kind} />
        <span>{report.environment}</span>
        {/* **The address, as text and not a link.** It is a value a browser
            posted, so `isWebUrl` at the route is what keeps a `javascript:`
            string out of the column — but an inbox is not a place to be one
            click from following a stranger's URL, and the admin reading this
            can copy it. `break-all` because an `/add/<whole third-party URL>`
            has no spaces in it and would otherwise push the card off the page.
            `null` is a report from a bundle older than 2026-09-02. */}
        <span className="tw:break-all">{report.url ?? "an older client"}</span>
        {report.slug && <code className="tw:font-mono tw:text-[0.7rem]">{report.slug}</code>}
        <span className={`tw:inline-flex tw:items-center tw:gap-1 ${TONE[mirror.tone]}`}>
          {mirror.tone === "ok" ? (
            <CheckCircle2 size={11} />
          ) : mirror.tone === "warn" ? (
            <AlertTriangle size={11} />
          ) : (
            <Clock size={11} />
          )}
          <span title={mirror.detail}>{mirror.label}</span>
        </span>
      </div>

      <div className={dim}>
        <Body text={report.body} />
      </div>

      {report.screenshotBytes !== null && report.screenshotBytes > 0 && (
        <Screenshot ownerId={report.ownerId} id={report.id} bytes={report.screenshotBytes} />
      )}

      {report.diagnosticsVersion !== null && (
        <Diagnostics
          ownerId={report.ownerId}
          id={report.id}
          version={report.diagnosticsVersion}
        />
      )}

      {/* **The correlation handles**, which are Greg's *"anything else that will
          help us correlate it with our Vercel logs"*. `vercel_id` is the only
          thing in this repo that ties a browser to a line in one. */}
      <div className="tw:mt-3 tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1 tw:border-t tw:border-border tw:pt-2 tw:text-xs">
        <Handle label="report" value={report.id} />
        {report.buildCommit && (
          <Handle label="build" value={report.buildCommit.slice(0, 8)} />
        )}
        {report.requestVercelId && <Handle label="vercel" value={report.requestVercelId} />}
        {report.sentryEventId && <Handle label="sentry" value={report.sentryEventId} />}
        {/* Whether they *ticked the box*, which is a different fact from whether
            there is a blob — "they said yes and there was nothing to collect" is
            a bug in the collector, and only this pair can tell you. */}
        {report.consented && report.diagnosticsVersion === null && (
          <span className="tw:text-danger">consented, but no diagnostics arrived</span>
        )}
        {/* Pushed to the right-hand end of the row, where a wrapped row puts
            it on a line of its own. */}
        <span className="tw:ml-auto">
          <IgnoreControl report={report} now={now} disabled={disabled} onIgnore={onIgnore} />
        </span>
      </div>
    </li>
  );
}
