/**
 * **What the scheduler has launched** — a section on the Overseer tab,
 * directly under the schedule preview. Plan 260910f-scheduled-dispatch § D7.
 *
 * The preview says what the scheduler WOULD do; this says what it DID, and what
 * came of it. The daemon writes `occurrences.json` at every checkpoint: per
 * session job, its run spec, its next occurrence and its newest occurrences,
 * each with a result read from the evidence (`occurrence-result.ts`) rather
 * than assumed from a spawn.
 *
 * - **The last occurrence is the loud line.** A failure is red and names its
 *   own kind — TIMED OUT, QUOTA REFUSED — never a generic "failed"; UNKNOWN is
 *   the warning tone; SUPERSEDED — set aside on purpose before it launched —
 *   is the quiet tone; SUCCEEDED is never red. Its answer is a link to the
 *   durable answer route, only when there is an answer.
 * - **Cancellation is visible, not a button** (plan D7): a running occurrence
 *   prints its cancel command, an unknown one the command that disposes of it.
 *   Nothing on this card launches, cancels or disposes of anything.
 * - **The transcript is a path, not a link**: it holds every file the job read,
 *   so it is not served.
 *
 * ## Absence is stated
 *
 * The same six arms as the preview's section, each in the voice of whoever
 * failed (`occurrences-client.ts`). A job or an occurrence this build cannot
 * read is its own line. A journal not read whole is said, because an empty
 * list would otherwise read as "nothing ran" — docs/project/fleet-dashboard-modes.md
 * § Absence is stated.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { OccurrenceRow, OccurrencesJobRow, ParsedOccurrencesFile, ParsedOccurrencesJob } from "../../occurrences-parse";
import type { ScheduledOccurrence, ScheduledResult, ScheduledResultKind } from "../../wire";
import { instantTip } from "./instant";
import { answerUrlOf, OCCURRENCES_POLL_MS, type OccurrencesApi, type OccurrencesView } from "./occurrences-client";
import { At, boxNowOf, NextRun } from "./SchedulePreview";
import { Explain } from "./Tooltip";
import { Card, cx, Mono, Pill } from "./ui";
import { formatDuration, type Tone } from "./view";

/** The word each result gets. The compiler counts the kinds. */
const RESULT_LABEL: Readonly<Record<ScheduledResultKind, string>> = {
  pending: "PENDING",
  "admission-waiting": "WAITING FOR ADMISSION",
  running: "RUNNING",
  unknown: "UNKNOWN",
  superseded: "SUPERSEDED",
  "launch-failed": "LAUNCH FAILED",
  "timed-out": "TIMED OUT",
  "quota-refused": "QUOTA REFUSED",
  interrupted: "INTERRUPTED",
  "permission-denied": "PERMISSION DENIED",
  "missing-answer": "MISSING ANSWER",
  failed: "FAILED",
  succeeded: "SUCCEEDED",
};

/**
 * Every failure is `alarm`, and names itself through its label. `unknown` is
 * the warning tone: nothing can say what happened, which is not a failure and
 * is not fine. The four that are not endings are quiet or working.
 * `superseded` is quiet too: the scheduler set it aside on purpose and nothing
 * ran, which is neither a failure (not `alarm`) nor a success (not `work`).
 */
const RESULT_TONE: Readonly<Record<ScheduledResultKind, Tone>> = {
  pending: "idle",
  "admission-waiting": "idle",
  running: "work",
  unknown: "unknown",
  superseded: "idle",
  "launch-failed": "alarm",
  "timed-out": "alarm",
  "quota-refused": "alarm",
  interrupted: "alarm",
  "permission-denied": "alarm",
  "missing-answer": "alarm",
  failed: "alarm",
  succeeded: "work",
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function ResultPill({ result }: { result: ScheduledResult }): ReactNode {
  const tone = RESULT_TONE[result.kind];
  return (
    <span data-slot="result" data-result={result.kind} data-tone={tone} className="tw:inline-flex">
      <Pill tone={tone}>{RESULT_LABEL[result.kind]}</Pill>
    </span>
  );
}

function Answer({ occurrence }: { occurrence: ScheduledOccurrence }): ReactNode {
  const { answer } = occurrence;
  if (answer.kind === "absent") {
    return (
      <p data-slot="answer" className="tw:break-words tw:text-ink-faint">
        no answer file
      </p>
    );
  }
  return (
    <p data-slot="answer" className="tw:break-words">
      <a
        data-slot="answer-link"
        href={answerUrlOf(occurrence.launchOccurrenceId)}
        target="_blank"
        rel="noopener noreferrer"
        className="tw:font-medium tw:underline tw:underline-offset-2"
      >
        answer
      </a>
      {answer.usable ? null : <span className="tw:font-medium tw:text-alarm-ink"> (empty or unusable)</span>}{" "}
      <span className="tw:text-ink-faint">
        — attempt a{answer.attempt}, {plural(answer.bytes, "byte")}
      </span>
    </p>
  );
}

function Command({ label, command }: { label: string; command: string }): ReactNode {
  return (
    <div data-slot="command" className="tw:mt-1 tw:min-w-0 tw:rounded tw:bg-quiet-wash tw:px-2 tw:py-1 tw:break-words">
      <span className="tw:text-[12px] tw:text-ink-faint">{label}: </span>
      <Mono>{command}</Mono>
    </div>
  );
}

/** One occurrence: the pill, the evidence, when, the answer, and what a person could run. */
function Occurrence({ occurrence, boxNow }: { occurrence: ScheduledOccurrence; boxNow: number }): ReactNode {
  const { result } = occurrence;
  return (
    <div data-occurrence={occurrence.launchOccurrenceId} className="tw:min-w-0 tw:space-y-0.5">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        <ResultPill result={result} />
        <span className={cx("tw:break-words", RESULT_TONE[result.kind] === "alarm" ? "tw:text-alarm-ink" : "tw:text-ink-soft")}>{result.why}</span>
      </div>
      <p className="tw:break-words tw:text-ink-soft">
        <span className="tw:text-ink-faint">due </span>
        <At iso={occurrence.scheduledAt} what="The due instant it was launched for" boxNow={boxNow} />
        {result.at === null ? (
          "; no ending yet"
        ) : (
          <>
            {"; "}
            <span className="tw:text-ink-faint">recorded </span>
            <At iso={result.at} what="When the evidence for this result was recorded" boxNow={boxNow} />
          </>
        )}
        {"; "}
        {plural(occurrence.attempts, "attempt")}; state{" "}
        <Explain
          tip={{
            head: "The launch protocol's state",
            what: "Where the launch journal has this occurrence. The pill is what the evidence says came of it.",
            how: "A disposed occurrence keeps its state and reads as interrupted.",
          }}
        >
          <Mono>{occurrence.state}</Mono>
        </Explain>
      </p>
      <p data-slot="occurrence-run" className="tw:break-words tw:text-[12px] tw:text-ink-faint">
        ran with timeout {occurrence.run.timeoutMinutes} min, access {occurrence.run.access},{" "}
        {occurrence.run.account === null ? (
          "no pool account recorded"
        ) : (
          <>
            pool account <Mono>{occurrence.run.account}</Mono>
          </>
        )}
      </p>
      <Answer occurrence={occurrence} />
      {occurrence.transcriptPath === null ? null : (
        <p className="tw:break-words tw:text-ink-faint">
          transcript, not served because it holds every file the job read: <Mono>{occurrence.transcriptPath}</Mono>
        </p>
      )}
      {occurrence.tmuxSession === null ? null : (
        <p className="tw:break-words tw:text-ink-soft">
          in tmux session <Mono>{occurrence.tmuxSession}</Mono>
        </p>
      )}
      {occurrence.commands.cancel === null ? null : <Command label="to cancel it, run" command={occurrence.commands.cancel} />}
      {occurrence.commands.dispose === null ? null : <Command label="to dispose of it, run" command={occurrence.commands.dispose} />}
    </div>
  );
}

function Row({ row, boxNow }: { row: OccurrenceRow; boxNow: number }): ReactNode {
  if (row.kind === "occurrence") return <Occurrence occurrence={row.occurrence} boxNow={boxNow} />;
  return (
    <p data-occurrence-unreadable={row.launchOccurrenceId ?? ""} className="tw:break-words">
      <span className="tw:font-mono tw:break-all">{row.launchOccurrenceId ?? "(an occurrence with no readable id)"}</span>
      <span className="tw:text-unknown-ink"> — this page cannot read this occurrence: {row.why}</span>
    </p>
  );
}

function JobRow({ job, boxNow, journalWhole }: { job: ParsedOccurrencesJob; boxNow: number; journalWhole: boolean }): ReactNode {
  const [latest, ...earlier] = job.occurrences;
  return (
    <li data-occurrences-job={job.jobId} className="tw:min-w-0 tw:rounded-lg tw:border tw:border-rule tw:p-3 tw:text-[13px]">
      <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1">
        <span className="tw:font-mono tw:font-medium tw:break-all">{job.jobId}</span>
        <span data-slot="run" className="tw:text-[12px] tw:text-ink-faint">
          timeout {job.run.timeoutMinutes} min, access {job.run.access}
        </span>
        {job.dispatch.kind === "dry-run" ? (
          <span className="tw:inline-flex tw:min-w-0 tw:flex-wrap tw:items-baseline tw:gap-x-1.5">
            <Pill tone="unknown">dry run</Pill>
            <span className="tw:text-[12px] tw:text-unknown-ink">{job.dispatch.why}</span>
          </span>
        ) : null}
      </div>

      <p data-slot="next" className="tw:mt-1 tw:break-words tw:text-ink-soft">
        <span className="tw:text-ink-faint">next: </span>
        <NextRun next={job.next} boxNow={boxNow} />
      </p>

      <div data-slot="last-occurrence" className="tw:mt-2 tw:min-w-0">
        <p className="tw:text-[12px] tw:text-ink-faint">last:</p>
        {latest === undefined ? (
          <p className="tw:text-ink-soft">
            never launched
            {journalWhole ? null : (
              <span className="tw:text-unknown-ink"> — as far as this file can tell: the launch journal was not read whole, so a launch may be missing</span>
            )}
          </p>
        ) : (
          <Row row={latest} boxNow={boxNow} />
        )}
      </div>

      {earlier.length > 0 ? (
        <details data-slot="earlier-occurrences" className="tw:mt-2 tw:min-w-0 tw:text-[12px] tw:text-ink-soft">
          <summary className="tw:cursor-pointer tw:text-ink-faint">{plural(earlier.length, "earlier occurrence")}</summary>
          <ol className="tw:mt-2 tw:space-y-2">
            {earlier.map((row, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: an unreadable row may carry no id, and the list is replaced whole on every read.
              <li key={index} className="tw:border-t tw:border-rule tw:pt-2">
                <Row row={row} boxNow={boxNow} />
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {job.omitted > 0 ? (
        <p data-slot="omitted" className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
          {plural(job.omitted, "older occurrence")} not in this file; the launch protocol's <Mono>overseer-launches list</Mono> has them.
        </p>
      ) : null}
    </li>
  );
}

function JobLine({ row, boxNow, journalWhole }: { row: OccurrencesJobRow; boxNow: number; journalWhole: boolean }): ReactNode {
  if (row.kind === "job") return <JobRow job={row.job} boxNow={boxNow} journalWhole={journalWhole} />;
  return (
    <li
      data-occurrences-job-unreadable={row.jobId ?? ""}
      className="tw:min-w-0 tw:rounded-lg tw:border tw:border-l-4 tw:border-rule tw:border-l-unknown tw:p-3 tw:text-[13px] tw:break-words"
    >
      <span className="tw:font-mono tw:break-all">{row.jobId ?? "(a job with no readable id)"}</span>
      <span className="tw:text-unknown-ink"> — this page cannot read this job: {row.why}</span>
    </li>
  );
}

function Journal({ file }: { file: ParsedOccurrencesFile }): ReactNode {
  const { journal } = file;
  if (journal.kind === "whole") {
    return (
      <p data-slot="journal" data-journal="whole" className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
        The launch journal was read whole.
      </p>
    );
  }
  return (
    <p data-slot="journal" data-journal={journal.kind} className="tw:mt-2 tw:text-[13px] tw:font-medium tw:break-words tw:text-unknown-ink">
      The list below may be missing launches:{" "}
      {journal.kind === "history-lost" ? "the launch journal's history is not whole" : "the launch journal could not be opened"} — {journal.why}.
    </p>
  );
}

function Occurrences({ view, now }: { view: Extract<OccurrencesView, { kind: "occurrences" }>; now: number }): ReactNode {
  const { file } = view;
  const boxNow = boxNowOf(view, now);
  const ageMs = boxNow - Date.parse(file.writtenAt);
  const journalWhole = file.journal.kind === "whole";
  return (
    <>
      <p data-slot="occurrences-caveat" className="tw:mt-1 tw:text-[12px] tw:break-words tw:text-ink-faint">
        <Explain tip={instantTip(file.writtenAt, "When the daemon wrote this record")} className="tw:whitespace-normal tw:text-left">
          {ageMs < 0 ? "Written at a time after the dashboard read it" : `Written ${formatDuration(ageMs)} ago`}
        </Explain>{" "}
        by daemon instance <Mono>{file.instanceId}</Mono>; every state is as of then. Nothing on this card launches, cancels or disposes of
        anything — the commands are for a person to run.
      </p>
      <Journal file={file} />
      {file.jobs.length === 0 ? (
        <p data-slot="occurrences-empty" className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">
          The daemon's record lists no session jobs.
        </p>
      ) : (
        <ol className="tw:mt-3 tw:space-y-2">
          {file.jobs.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an unreadable row may carry no id, and the order is the definition order, replaced whole on every read.
            <JobLine key={`${index}:${row.kind === "job" ? row.job.jobId : (row.jobId ?? "")}`} row={row} boxNow={boxNow} journalWhole={journalWhole} />
          ))}
        </ol>
      )}
    </>
  );
}

/** Each kind of nothing, in the voice of whoever failed to answer. */
function Body({ view, now }: { view: OccurrencesView | null; now: number }): ReactNode {
  const quiet = "tw:mt-2 tw:text-[13px] tw:break-words";
  if (view === null) {
    return (
      <p data-occurrences-state="asking" className={cx(quiet, "tw:text-ink-faint")}>
        Asking the dashboard what the scheduler has launched…
      </p>
    );
  }
  switch (view.kind) {
    case "occurrences":
      return <Occurrences view={view} now={now} />;
    case "absent":
      return (
        <p data-occurrences-state="absent" className={cx(quiet, "tw:text-ink-soft")}>
          No record of launches — {view.why}.
        </p>
      );
    case "unreadable":
      return (
        <p data-occurrences-state="unreadable" data-source={view.source} className={cx(quiet, "tw:text-alarm-ink")}>
          {view.source === "server"
            ? `The dashboard could not read what the scheduler has launched — ${view.why}.`
            : `This page could not read the record the dashboard sent — ${view.why}. The dashboard and this page may be different builds; reload the page.`}
        </p>
      );
    case "unsupported-schema":
      return (
        <p data-occurrences-state="unsupported-schema" data-source={view.source} className={cx(quiet, "tw:text-alarm-ink")}>
          {view.source === "server"
            ? `The record is schema ${view.schema} and this dashboard reads schema ${view.known}, so the daemon that wrote it is a different build from this dashboard.`
            : `The record is schema ${view.schema} and this page reads schema ${view.known} — reload the page, or rebuild the client.`}
        </p>
      );
    case "no-answer":
      return (
        <p data-occurrences-state="no-answer" className={cx(quiet, "tw:text-unknown-ink")}>
          This page got no answer from the dashboard's occurrences route — {view.why}.
        </p>
      );
    default: {
      const never: never = view;
      return <p className={quiet}>{JSON.stringify(never)}</p>;
    }
  }
}

export function ScheduledOccurrences({ api, now }: { api: OccurrencesApi; now: number }): ReactNode {
  const [view, setView] = useState<OccurrencesView | null>(null);

  /* A GENERATION TOKEN, so an older answer that resolves late cannot replace a
     newer one — SchedulePreview.tsx § the same guard. */
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
    const timer = setInterval(load, OCCURRENCES_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <section data-section="scheduled-occurrences" className="tw:mb-3">
      <Card className="tw:min-w-0 tw:p-4">
        <h2 className="tw:font-medium">What the scheduler has launched</h2>
        <Body view={view} now={now} />
      </Card>
    </section>
  );
}
