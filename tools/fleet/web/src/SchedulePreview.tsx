/**
 * **What the scheduler would run next** — a section on the Overseer tab,
 * directly under the status card. Plan 260910e § D7.
 *
 * The Overseer daemon writes `schedule.json` on every checkpoint tick: each job
 * it holds, the verdict the scheduler's own planner gives it, when it could
 * next run, what ran last, and the pins its authority rests on. This section
 * draws that file, and says the same things `overseer status` prints — the
 * same parser, the same instants London first (`zones.ts` §
 * `zonedLineAgainstFirst`), the same words for each verdict.
 *
 * **It launches nothing and authorises nothing**, and it is not live: every
 * line is as of the instant the daemon wrote the file, which the caveat under
 * the title says with its age.
 *
 * ## Absence is stated
 *
 * Asking, no file, a file the server could not read, a file this page could
 * not read, a schema either side does not know, and this page never reaching
 * the route are six different sentences (`schedule-client.ts` § the arms). A
 * row this build cannot read is its own line naming the job, never a dropped
 * row. docs/project/fleet-dashboard-modes.md § Absence is stated.
 *
 * ## Whose clock
 *
 * Every instant in the file is the box's clock, and so is `servedAt`. Relative
 * ages are measured against the box's clock too — `servedAt` plus the time this
 * browser has held the answer — so a phone whose clock is wrong cannot make a
 * due job look overdue.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type {
  ParsedSchedulePreview,
  SchedulePreviewAttempt,
  SchedulePreviewDocument,
  SchedulePreviewJob,
  SchedulePreviewNext,
  SchedulePreviewRow,
  SchedulePreviewVerdictKind,
} from "../../wire";
import { londonFirstLine } from "../../zones";
import { instantTip } from "./instant";
import { SCHEDULE_POLL_MS, type ScheduleApi, type ScheduleView } from "./schedule-client";
import { Explain } from "./Tooltip";
import { Card, cx, Mono, Pill } from "./ui";
import { formatDuration } from "./view";

/**
 * When the file is older than the caveat allows. The caveat promises at most
 * one 30-second tick; ten ticks, for the reason `OverseerPanel`'s
 * `HEARTBEAT_STALE_MS` is ten — a restart or a loaded box must not shout.
 */
const PREVIEW_STALE_MS = 5 * 60_000;

/**
 * The word each verdict gets — the words `overseer status` prints
 * (`tools/overseer/schedule-preview.ts` § `VERDICT_LABEL`, a node module this
 * page cannot import). The compiler counts the kinds; the wording is kept in
 * step by hand.
 */
const VERDICT_LABEL: Readonly<Record<SchedulePreviewVerdictKind, string>> = {
  "history-lost": "HELD, LEDGER NOT WHOLE",
  "duplicate-id": "DUPLICATE ID",
  unauthorised: "NOT AUTHORISED",
  held: "HELD",
  waiting: "WAITING",
  "not-yet-eligible": "NOT YET ELIGIBLE",
  "dry-run": "DRY RUN",
  "spacing-held": "WAITING FOR SPACING",
  dispatch: "WOULD DISPATCH",
};

/** The box's clock now, as best this page can tell: when the server read the file, plus how long we have held it. */
function boxNowOf(view: { servedAt: string; receivedAtMs: number }, now: number): number {
  return Date.parse(view.servedAt) + Math.max(0, now - view.receivedAtMs);
}

function relative(iso: string, boxNow: number): string {
  const ms = Date.parse(iso) - boxNow;
  return ms >= 0 ? `in ${formatDuration(ms)}` : `${formatDuration(-ms)} ago`;
}

/** One instant, London first, the three clocks behind it, and how far away it is. */
function At({ iso, what, boxNow }: { iso: string; what: string; boxNow: number }): ReactNode {
  return (
    <>
      <Explain tip={instantTip(iso, what)} className="tw:max-w-full tw:whitespace-normal tw:text-left">
        {londonFirstLine(iso) ?? `${iso} (a time this page cannot read)`}
      </Explain>{" "}
      ({relative(iso, boxNow)})
    </>
  );
}

/* ------------------------------------------------------------------ *
 * One job.
 * ------------------------------------------------------------------ */

function Dispatch({ dispatch }: { dispatch: SchedulePreviewJob["dispatch"] }): ReactNode {
  if (dispatch.kind === "live") {
    return (
      <span data-dispatch="live" className="tw:text-[12px] tw:text-ink-faint">
        live
      </span>
    );
  }
  return (
    <span data-dispatch="dry-run" className="tw:inline-flex tw:min-w-0 tw:flex-wrap tw:items-baseline tw:gap-x-1.5">
      <Explain
        tip={{
          head: "Dry run",
          what: "When this job is due the scheduler records it and launches nothing.",
          how: "Dry-run is part of the job's fingerprint, so making it live is a re-pin somebody has to authorise, not a switch.",
        }}
      >
        <Pill tone="unknown">dry run</Pill>
      </Explain>
      <span className="tw:text-[12px] tw:text-unknown-ink">{dispatch.why}</span>
    </span>
  );
}

function NextRun({ next, boxNow }: { next: SchedulePreviewNext; boxNow: number }): ReactNode {
  switch (next.kind) {
    case "due-now":
      return <>due now</>;
    case "next-due":
      return <At iso={next.at} what="When it is next due" boxNow={boxNow} />;
    case "first-eligible":
      return (
        <>
          first eligible <At iso={next.at} what="When it is first eligible" boxNow={boxNow} />
        </>
      );
    case "after-in-flight-settles":
      return (
        <>
          after the run in flight settles — its launcher lease runs to{" "}
          <At iso={next.leaseUntil} what="When the launcher's lease runs out" boxNow={boxNow} />
        </>
      );
    case "after-arming":
      return <>{formatDuration(next.initialDelayMs)} after the scheduler is armed</>;
    case "none":
      return <>none — {next.why}</>;
    default: {
      const never: never = next;
      return <>{JSON.stringify(never)}</>;
    }
  }
}

/** The state word, with what the ledger can and cannot see behind it — `finished` over-promises for a session job. */
function State({ word, meaning }: { word: string; meaning: string }): ReactNode {
  return (
    <Explain
      tip={{
        head: "What the ledger saw",
        what: meaning,
        how: "The occurrence ledger records the scheduler's own attempts; it is not a record of what the work itself did.",
      }}
    >
      {word}
    </Explain>
  );
}

function LastAttempt({ attempt, boxNow }: { attempt: SchedulePreviewAttempt; boxNow: number }): ReactNode {
  switch (attempt.kind) {
    case "never":
      return <>never run</>;
    case "not-known":
      return <span className="tw:text-unknown-ink">NOT KNOWN — {attempt.why}</span>;
    case "reserved":
      return (
        <>
          <State word="reserved" meaning={attempt.meaning} /> <At iso={attempt.reservedAt} what="When it was reserved" boxNow={boxNow} />, no start
          recorded yet; lease until <At iso={attempt.leaseUntil} what="When its lease runs out" boxNow={boxNow} />
        </>
      );
    case "started":
      return (
        <>
          <State word="started" meaning={attempt.meaning} /> <At iso={attempt.startedAt} what="When it started" boxNow={boxNow} /> as pid {attempt.pid}
          {"; lease until "}
          <At iso={attempt.leaseUntil} what="When its lease runs out" boxNow={boxNow} />
        </>
      );
    case "finished":
      return (
        <>
          <State word="finished" meaning={attempt.meaning} /> <At iso={attempt.finishedAt} what="When it finished" boxNow={boxNow} />:{" "}
          {attempt.outcome.kind === "exited" ? `exit ${attempt.outcome.code}` : <span className="tw:text-alarm-ink">failed — {attempt.outcome.why}</span>}
        </>
      );
    case "refused":
      return (
        <>
          <State word="refused" meaning={attempt.meaning} /> <At iso={attempt.refusedAt} what="When it was refused" boxNow={boxNow} />: {attempt.why}
        </>
      );
    case "unknown":
      return (
        <span className="tw:text-unknown-ink">
          UNKNOWN — reserved <At iso={attempt.reservedAt} what="When it was reserved" boxNow={boxNow} /> and nothing can say what happened: {attempt.why}
          {attempt.noticed.kind === "recorded" ? (
            <>
              {" "}
              (written down <At iso={attempt.noticed.at} what="When a later daemon wrote this down" boxNow={boxNow} />)
            </>
          ) : null}
        </span>
      );
    default: {
      const never: never = attempt;
      return <>{JSON.stringify(never)}</>;
    }
  }
}

function Fingerprint({ job }: { job: SchedulePreviewJob }): ReactNode {
  if (job.behaviourHash.kind === "not-computed") {
    return (
      <span className="tw:text-unknown-ink">
        NO FINGERPRINT — {job.behaviourHash.why}; pinned <Mono>{job.authorisedHash}</Mono>
      </span>
    );
  }
  if (job.behaviourHash.hash === job.authorisedHash) {
    return (
      <>
        fingerprint <Mono>{job.behaviourHash.hash}</Mono>, matching its pin
      </>
    );
  }
  return (
    <span className="tw:text-alarm-ink">
      fingerprints as <Mono>{job.behaviourHash.hash}</Mono>, pinned <Mono>{job.authorisedHash}</Mono> —{" "}
      <strong>NOT the job that was authorised</strong>
    </span>
  );
}

function DocumentLine({ document }: { document: SchedulePreviewDocument }): ReactNode {
  const pinned =
    document.pinned.kind === "pinned" ? (
      <>
        pinned <Mono>{document.pinned.sha256}</Mono>
      </>
    ) : (
      "never pinned"
    );
  let now: ReactNode;
  switch (document.current.kind) {
    case "read":
      now = (
        <>
          , now <Mono>{document.current.sha256}</Mono> ({document.current.when === "this-checkpoint" ? "read this checkpoint" : "as loaded"})
        </>
      );
      break;
    case "unreadable":
      now = <span className="tw:text-unknown-ink">; COULD NOT BE READ — {document.current.why}</span>;
      break;
    case "absent":
      now = "; no longer among the documents it leans on";
      break;
    default: {
      const never: never = document.current;
      now = <>{JSON.stringify(never)}</>;
    }
  }
  return (
    <li data-document-changed={document.changed} className="tw:min-w-0 tw:break-words">
      <Mono>{document.path}</Mono>: {pinned}
      {now}
      {document.changed === "yes" ? (
        <>
          {" "}
          — <strong className="tw:text-alarm-ink">CHANGED since it was authorised</strong>
        </>
      ) : document.changed === "no" ? (
        <> — as pinned</>
      ) : null}
    </li>
  );
}

function JobRow({ job, boxNow }: { job: SchedulePreviewJob; boxNow: number }): ReactNode {
  const changed = job.documents.filter((document) => document.changed === "yes");
  const unread = job.documents.filter((document) => document.changed === "cannot-tell");
  const dry = job.dispatch.kind === "dry-run";
  return (
    <li
      data-schedule-job={job.jobId}
      className={cx("tw:min-w-0 tw:rounded-lg tw:border tw:p-3 tw:text-[13px]", dry ? "tw:border-dashed tw:border-unknown" : "tw:border-rule")}
    >
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        <span className="tw:font-mono tw:font-medium tw:break-all">{job.jobId}</span>
        <span className="tw:text-[12px] tw:text-ink-faint">{job.resourceClass === "claude-session" ? "a Claude session" : "a rule inside the daemon"}</span>
        <Dispatch dispatch={job.dispatch} />
      </div>

      <p data-slot="verdict" className={cx("tw:mt-1 tw:break-words", job.verdict.kind === "unauthorised" ? "tw:text-alarm-ink" : "tw:text-ink-soft")}>
        <strong>{VERDICT_LABEL[job.verdict.kind]}</strong> — {job.verdict.sentence}
      </p>
      {job.verdict.kind === "unauthorised" && job.verdict.drift.length > 0 ? (
        <ul className="tw:mt-1 tw:list-disc tw:pl-5 tw:text-[12px] tw:break-words tw:text-alarm-ink">
          {job.verdict.drift.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      {/* THE ACCEPTANCE SENTENCE, ON THE ROW ITSELF. A document edited since it
          was pinned is the one thing this card must not hide behind a
          disclosure — the roadmap's "a changed document is named". */}
      {changed.length > 0 ? (
        <p data-slot="documents-changed" className="tw:mt-1 tw:font-medium tw:break-words tw:text-alarm-ink">
          CHANGED since it was authorised: {changed.map((document) => document.path).join(", ")}
        </p>
      ) : null}
      {unread.length > 0 ? (
        <p data-slot="documents-unread" className="tw:mt-1 tw:break-words tw:text-unknown-ink">
          could not be read, so nobody can say whether it changed: {unread.map((document) => document.path).join(", ")}
        </p>
      ) : null}

      <p data-slot="next" className="tw:mt-1 tw:break-words tw:text-ink-soft">
        <span className="tw:text-ink-faint">next: </span>
        <NextRun next={job.verdict.next} boxNow={boxNow} />
      </p>
      <p data-slot="last" className="tw:mt-0.5 tw:break-words tw:text-ink-soft">
        <span className="tw:text-ink-faint">last: </span>
        <LastAttempt attempt={job.lastAttempt} boxNow={boxNow} />
      </p>

      <details className="tw:mt-2 tw:min-w-0 tw:text-[12px] tw:text-ink-soft">
        <summary className="tw:cursor-pointer tw:text-ink-faint">The prompt, its pin, its clock and its documents</summary>
        <div className="tw:mt-2 tw:space-y-2">
          <pre className="tw:font-mono tw:text-[12px] tw:break-words tw:whitespace-pre-wrap">{job.prompt}</pre>
          <p className="tw:break-words">
            <Fingerprint job={job} />
          </p>
          <ul className="tw:space-y-0.5">
            <li>
              every {formatDuration(job.schedule.everyMs)}, launcher lease {formatDuration(job.schedule.launcherLeaseMs)}, first run{" "}
              {formatDuration(job.schedule.initialDelayMs)} after arming
            </li>
            <li>session timeout: {job.sessionTimeout}</li>
            <li>session no-overlap: {job.sessionNoOverlap}</li>
          </ul>
          {job.documents.length === 0 ? (
            <p>It leans on no documents.</p>
          ) : (
            <ul className="tw:space-y-1">
              {job.documents.map((document) => (
                <DocumentLine key={document.path} document={document} />
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

function Row({ row, boxNow }: { row: SchedulePreviewRow; boxNow: number }): ReactNode {
  if (row.kind === "job") return <JobRow job={row.job} boxNow={boxNow} />;
  return (
    <li data-schedule-row-unreadable={row.jobId ?? ""} className="tw:min-w-0 tw:rounded-lg tw:border tw:border-l-4 tw:border-rule tw:border-l-unknown tw:p-3 tw:text-[13px] tw:break-words">
      <span className="tw:font-mono tw:break-all">{row.jobId ?? "(a row with no readable id)"}</span>
      <span className="tw:text-unknown-ink"> — this page cannot read this row: {row.why}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * The preview.
 * ------------------------------------------------------------------ */

function Caveat({ preview, boxNow }: { preview: ParsedSchedulePreview; boxNow: number }): ReactNode {
  const ageMs = boxNow - Date.parse(preview.writtenAt);
  /* AN AGE IN THE FUTURE IS UNREADABLE, NOT FRESH — OverseerPanel.tsx § ageMs. */
  const stale = ageMs < 0 ? "unknown" : ageMs > PREVIEW_STALE_MS ? "yes" : "no";
  return (
    <p data-slot="schedule-caveat" data-stale={stale} className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-ink-faint">
      <Explain tip={instantTip(preview.writtenAt, "When the daemon wrote this preview")} className="tw:whitespace-normal tw:text-left">
        {ageMs < 0 ? "Written at a time after the dashboard read it" : `Written ${formatDuration(ageMs)} ago`}
      </Explain>{" "}
      by daemon instance <Mono>{preview.instanceId}</Mono>. {preview.caveat} Nothing on this card launches or authorises anything.
      {stale === "yes" ? (
        <strong className="tw:block tw:mt-1 tw:text-alarm-ink">
          That is older than the caveat allows: the daemon has not rewritten this file for {formatDuration(ageMs)}, so every line below may be out of
          date.
        </strong>
      ) : stale === "unknown" ? (
        <strong className="tw:block tw:mt-1 tw:text-unknown-ink">So how old it is cannot be told.</strong>
      ) : null}
    </p>
  );
}

function Headline({ preview }: { preview: ParsedSchedulePreview }): ReactNode {
  const tone = preview.headline.kind === "blocked" ? "tw:text-alarm-ink" : preview.headline.kind === "unknown" ? "tw:text-unknown-ink" : "tw:text-ink";
  return (
    <p data-slot="schedule-headline" className={cx("tw:mt-3 tw:text-[13px] tw:break-words", tone)}>
      <strong>{preview.headline.kind.toUpperCase()}</strong> — {preview.headline.why}
    </p>
  );
}

function Facts({ preview, boxNow }: { preview: ParsedSchedulePreview; boxNow: number }): ReactNode {
  return (
    <ul className="tw:mt-1 tw:space-y-0.5 tw:text-[12px] tw:break-words tw:text-ink-soft">
      <li>
        this daemon holds: session dispatcher {preview.capabilities.session ? "yes" : "no"}, rule runner {preview.capabilities.rules ? "yes" : "no"}
      </li>
      <li>
        arming:{" "}
        {preview.arming.kind === "armed" ? (
          <>
            armed at <At iso={preview.arming.at} what="When the scheduler was armed" boxNow={boxNow} />
          </>
        ) : (
          <>none — {preview.arming.why}</>
        )}
      </li>
      <li className={preview.history.kind === "lost" ? "tw:font-medium tw:text-alarm-ink" : undefined}>
        history: {preview.history.kind === "intact" ? "the occurrence ledger is whole" : `LOST, so every job is held — ${preview.history.why}`}
      </li>
      {preview.list.kind === "given" ? (
        <li>
          <Explain
            tip={{
              head: "Which job list",
              what: "A short hash over every job's id, pin, schedule and dispatch mode, in order.",
              how: "`overseer status` compares it with the list its own checkout builds, and says when a restart would load a different one. This page has no checkout to compare against.",
            }}
          >
            job list
          </Explain>{" "}
          <Mono>{preview.list.listRevision}</Mono>
        </li>
      ) : null}
      <li>
        missed runs: {preview.missedRunPolicy.kind} — {preview.missedRunPolicy.sentence}
      </li>
    </ul>
  );
}

function Preview({
  view,
  now,
  currentInstanceId,
}: {
  view: Extract<ScheduleView, { kind: "preview" }>;
  now: number;
  currentInstanceId: string | null;
}): ReactNode {
  const { preview } = view;
  const boxNow = boxNowOf(view, now);
  const anotherInstance = currentInstanceId !== null && currentInstanceId !== preview.instanceId;
  return (
    <>
      {anotherInstance ? (
        <p data-slot="schedule-instance-mismatch" className="tw:mt-2 tw:font-medium tw:text-[13px] tw:break-words tw:text-alarm-ink">
          FROM ANOTHER DAEMON INSTANCE — this preview was written by <Mono>{preview.instanceId}</Mono>, while the current checkpoint belongs to{" "}
          <Mono>{currentInstanceId}</Mono>. It does not describe the current daemon.
        </p>
      ) : null}
      <Caveat preview={preview} boxNow={boxNow} />
      <Headline preview={preview} />
      <Facts preview={preview} boxNow={boxNow} />
      {preview.list.kind === "not-given" ? (
        <p data-slot="schedule-empty" className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">
          The running daemon was given no job list ({preview.list.why}), so it previews nothing.
        </p>
      ) : preview.jobs.length === 0 ? (
        <p data-slot="schedule-empty" className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">
          The daemon's job list holds no jobs.
        </p>
      ) : (
        <ol className="tw:mt-3 tw:space-y-2">
          {preview.jobs.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two rows CAN share a job id — that is the `duplicate-id` verdict this card exists to draw — and the order is the scheduler's walk, replaced whole on every read.
            <Row key={`${index}:${row.kind === "job" ? row.job.jobId : (row.jobId ?? "")}`} row={row} boxNow={boxNow} />
          ))}
        </ol>
      )}
    </>
  );
}

/** Each kind of nothing, in the voice of whoever failed to answer. */
function Body({ view, now, currentInstanceId }: { view: ScheduleView | null; now: number; currentInstanceId: string | null }): ReactNode {
  const quiet = "tw:mt-2 tw:text-[13px] tw:break-words";
  if (view === null) {
    return (
      <p data-schedule-state="asking" className={cx(quiet, "tw:text-ink-faint")}>
        Asking the dashboard for the scheduler's preview…
      </p>
    );
  }
  switch (view.kind) {
    case "preview":
      return <Preview view={view} now={now} currentInstanceId={currentInstanceId} />;
    case "absent":
      return (
        <p data-schedule-state="absent" className={cx(quiet, "tw:text-ink-soft")}>
          No preview — {view.why}.
        </p>
      );
    case "unreadable":
      return (
        <p data-schedule-state="unreadable" data-source={view.source} className={cx(quiet, "tw:text-alarm-ink")}>
          {view.source === "server"
            ? `The dashboard could not read the scheduler's preview — ${view.why}.`
            : `This page could not read the preview the dashboard sent — ${view.why}. The dashboard and this page may be different builds; reload the page.`}
        </p>
      );
    case "unsupported-schema":
      return (
        <p data-schedule-state="unsupported-schema" data-source={view.source} className={cx(quiet, "tw:text-alarm-ink")}>
          {view.source === "server"
            ? `The preview is schema ${view.schema} and this dashboard reads schema ${view.known}, so the daemon that wrote it is a different build from this dashboard.`
            : `The preview is schema ${view.schema} and this page reads schema ${view.known} — reload the page, or rebuild the client.`}
        </p>
      );
    case "no-answer":
      return (
        <p data-schedule-state="no-answer" className={cx(quiet, "tw:text-unknown-ink")}>
          This page got no answer from the dashboard's schedule route — {view.why}.
        </p>
      );
    default: {
      const never: never = view;
      return <p className={quiet}>{JSON.stringify(never)}</p>;
    }
  }
}

export function SchedulePreview({ api, now, currentInstanceId }: { api: ScheduleApi; now: number; currentInstanceId: string | null }): ReactNode {
  const [view, setView] = useState<ScheduleView | null>(null);

  /* A GENERATION TOKEN, so an older answer that resolves late cannot replace a
     newer one — HealthHistory.tsx § the same guard, for the same reason. */
  const generation = useRef(0);
  const latest = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    void api.read().then((next) => {
      if (mine > latest.current) {
        latest.current = mine;
        setView(next);
      }
    });
  }, [api]);

  useEffect(() => {
    load();
    const timer = setInterval(load, SCHEDULE_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <section data-section="schedule-preview" className="tw:mb-3">
      <Card className="tw:min-w-0 tw:p-4">
        <h2 className="tw:font-medium">What the scheduler would run next</h2>
        <Body view={view} now={now} currentInstanceId={currentInstanceId} />
      </Card>
    </section>
  );
}
