/**
 * What the sparse work observations say beside the denser box-health record.
 *
 * `work-series.ts` owns every evidence rule. This component receives the same
 * `HistoryPlot` as the load chart, uses its server-clock window unchanged, and
 * only turns that projection into HTML and fixed-unit SVG. In particular it
 * never treats a health carrier timestamp as a work timestamp.
 */
import type { ReactNode } from "react";

import type { TimeLabel } from "./HealthHistory";
import type { HistoryView } from "./health-history-client";
import { describeDuration, type HistoryPlot } from "./history-series";
import {
  projectWorkHistory,
  type UnavailableReason,
  type WorkHistoryProjection,
  type WorkRow,
  type WorkScan,
} from "./work-series";

const PLOT_W = 1000;
const ROW_H = 18;

export function WorkHistory({
  view,
  plot,
  at,
}: {
  view: Extract<HistoryView, { kind: "history" }>;
  plot: HistoryPlot;
  at: TimeLabel;
}): ReactNode {
  const work = projectWorkHistory(view, plot);
  const window = describeDuration(work.toMs - work.fromMs);

  return (
    <section className="tw:mt-4 tw:border-t tw:border-line tw:pt-3" aria-labelledby="work-history-heading">
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-x-3 tw:gap-y-1">
        <h3 id="work-history-heading" className="tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase">
          Work beside the load
        </h3>
        <span className="tw:text-[12px] tw:text-ink-faint">
          {sourceCount(work)} distinct work observation{sourceCount(work) === 1 ? "" : "s"} in this {window} window
        </span>
      </div>

      <WorkAnswer work={work} at={at} />
      <PeakLine peak={work.peak} at={at} />

      <div className="tw:mt-3 tw:space-y-1 tw:text-[12px] tw:text-ink-faint">
        <p>Ranked by how long each job was observed running, not by how much CPU or memory it used — the box does not measure per-job cost.</p>
        <p>Work is retained about every five minutes during an uninterrupted dashboard run, and once on startup. A job that started and finished between retained readings may not be here at all.</p>
      </div>
    </section>
  );
}

function sourceCount(work: WorkHistoryProjection): number {
  switch (work.kind) {
    case "no-records":
      return 0;
    case "all-unavailable":
      return work.observations.length;
    case "empty-scan":
      return work.scans.length + work.unavailable.length;
    case "groups":
      return work.scans.length + work.unavailable.length;
  }
}

function WorkAnswer({ work, at }: { work: WorkHistoryProjection; at: TimeLabel }): ReactNode {
  if (work.kind === "no-records") {
    const detail =
      work.reason === "no-health-samples-in-window"
        ? "The health record itself has no carrier samples here, so it cannot say whether work ran."
        : work.reason === "work-retention-newer-than-window"
        ? "Work retention is newer than this window; this does not say that nothing ran."
        : work.reason === "no-due-turn-in-window"
          ? "Work tracking exists, but no work-reading turn fell inside this window; this does not say that nothing ran."
          : "The work events carried by these samples have source timestamps outside this window, so they are not drawn here.";
    return (
      <div className="tw:mt-2 tw:rounded-md tw:bg-quiet-wash tw:p-3 tw:text-[13px] tw:text-ink-soft">
        <p className="tw:font-medium tw:text-ink">No work records in this window.</p>
        <p className="tw:mt-1">{detail}</p>
      </div>
    );
  }

  if (work.kind === "all-unavailable") {
    return (
      <div className="tw:mt-2 tw:rounded-md tw:bg-unknown-wash tw:p-3 tw:text-[13px] tw:text-unknown-ink">
        <p className="tw:font-medium">Every work record in this window was unavailable.</p>
        <UnavailableReasons reasons={work.reasons} />
      </div>
    );
  }

  if (work.kind === "empty-scan") {
    return (
      <div className="tw:mt-2">
        <p className="tw:rounded-md tw:bg-work-wash tw:p-3 tw:text-[13px] tw:text-work-ink">
          Nothing recognised was running in {work.scans.length} successful scan{work.scans.length === 1 ? "" : "s"}.
        </p>
        <ScanUncertainty scans={work.scans} at={at} />
        <RepeatedReadings readings={work.unchangedReadings} at={at} />
        <UnavailableReasons reasons={work.reasons} />
      </div>
    );
  }

  return (
    <div className="tw:mt-2">
      <ol className="tw:space-y-3">
        {work.rows.map((row) => (
          <WorkRowView key={`${row.session}:${row.recogniser}`} row={row} work={work} at={at} />
        ))}
      </ol>
      {work.emptyScans.length > 0 ? (
        <p className="tw:mt-2 tw:text-[12px] tw:text-work-ink">
          Nothing recognised was running in {work.emptyScans.length} other successful scan{work.emptyScans.length === 1 ? "" : "s"}.
        </p>
      ) : null}
      <ScanUncertainty scans={work.scans} at={at} />
      <RepeatedReadings readings={work.unchangedReadings} at={at} />
      <UnavailableReasons reasons={work.reasons} />
    </div>
  );
}

function WorkRowView({
  row,
  work,
  at,
}: {
  row: WorkRow;
  work: Extract<WorkHistoryProjection, { kind: "groups" }>;
  at: TimeLabel;
}): ReactNode {
  const x = (atMs: number): number => ((atMs - work.fromMs) / (work.toMs - work.fromMs)) * PLOT_W;
  const partialCounts = [...new Set(row.observations.flatMap((observation) =>
    observation.timing.kind === "partial"
      ? [observation.jobs - observation.timing.knownJobs]
      : [],
  ))];
  const longest = row.longest.timing;
  const timing =
    longest.kind === "unknown"
      ? "Measured timing unavailable"
      : longest.kind === "partial"
        ? `Longest measured run ${describeDuration(longest.longestRanForMs)} among ${longest.knownJobs} of ${row.longest.jobs} jobs`
        : `Longest measured run ${describeDuration(longest.longestRanForMs)}`;

  return (
    <li>
      <div className="tw:flex tw:flex-wrap tw:items-baseline tw:justify-between tw:gap-x-3 tw:gap-y-1">
        <span className="tw:min-w-0 tw:text-[13px] tw:text-ink">
          <span className="tw:mr-2 tw:text-ink-faint">{row.rank}</span>
          <span className="tw:font-medium tw:break-all">{row.session}</span>
          <span className="tw:ml-2 tw:text-ink-soft">{row.label}</span>
        </span>
        <span className="tw:text-[12px] tw:text-ink-faint">{timing}</span>
      </div>
      <svg
        viewBox={`0 0 ${PLOT_W} ${ROW_H}`}
        preserveAspectRatio="none"
        className="tw:mt-1 tw:block tw:h-[18px] tw:w-full tw:rounded-sm tw:bg-panel-raised"
        role="img"
        aria-label={`${row.session}, ${row.recogniser}: observed ${row.observations.length} time${row.observations.length === 1 ? "" : "s"}. ${timing}.`}
      >
        <line x1={0} x2={PLOT_W} y1={ROW_H / 2} y2={ROW_H / 2} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {row.observations.map((observation) => (
          <rect
            key={observation.atMs}
            x={Math.max(0, Math.min(PLOT_W - 3, x(observation.atMs) - 1.5))}
            y={2}
            width={3}
            height={ROW_H - 4}
            rx={1}
            fill="var(--work)"
          />
        ))}
      </svg>
      <div className="tw:mt-1 tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1 tw:text-[12px] tw:text-ink-faint">
        {row.observations.map((observation) => (
          <span key={observation.atMs}>{observationLabel(observation.atMs, observation.firstCarrierAtMs, at)}</span>
        ))}
      </div>
      {partialCounts.map((missing) => (
        <p key={missing} className="tw:mt-1 tw:text-[12px] tw:text-unknown-ink">
          Timing was unavailable for {missing} of these jobs.
        </p>
      ))}
    </li>
  );
}

function observationLabel(sourceAtMs: number, carrierAtMs: number, at: TimeLabel): string {
  const delta = carrierAtMs - sourceAtMs;
  if (Math.abs(delta) < 1_000) return `observed at ${at(sourceAtMs)}`;
  const relation = delta > 0 ? "before" : "after";
  return `observed at ${at(sourceAtMs)} — ${deltaWords(Math.abs(delta))} ${relation} this point`;
}

function deltaWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 1) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function ScanUncertainty({ scans, at }: { scans: WorkScan[]; at: TimeLabel }): ReactNode {
  const uncertain = scans.filter((scan) => scan.panes.cannotTell > 0);
  const truncated = scans.filter((scan) => scan.groupsDropped > 0);
  if (uncertain.length === 0 && truncated.length === 0) return null;
  return (
    <div className="tw:mt-2 tw:space-y-1 tw:text-[12px] tw:text-unknown-ink">
      {truncated.map((scan) => (
        <p key={`truncated:${scan.atMs}`}>
          {scan.groupsDropped} lower-ranked group{scan.groupsDropped === 1 ? " was" : "s were"} omitted from this scan to keep the stored reading bounded ({at(scan.atMs)}).
        </p>
      ))}
      {uncertain.map((scan) => (
        <p key={`unreadable:${scan.atMs}`}>
          {scan.panes.cannotTell} pane{scan.panes.cannotTell === 1 ? "" : "s"} could not be read at this sample ({at(scan.atMs)}).
        </p>
      ))}
    </div>
  );
}

function RepeatedReadings({
  readings,
  at,
}: {
  readings: { atMs: number; copies: number; consecutiveCopies: number }[];
  at: TimeLabel;
}): ReactNode {
  const repeated = readings.filter((reading) => reading.consecutiveCopies > 0);
  if (repeated.length === 0) return null;
  return (
    <div className="tw:mt-2 tw:space-y-1 tw:text-[12px] tw:text-unknown-ink">
      {repeated.map((reading) => (
        <p key={reading.atMs}>
          This reading is the same one as the previous sample's ({at(reading.atMs)}; {reading.copies} carrier samples, one observation).
        </p>
      ))}
    </div>
  );
}

function UnavailableReasons({ reasons }: { reasons: UnavailableReason[] }): ReactNode {
  if (reasons.length === 0) return null;
  return (
    <ul className="tw:mt-2 tw:space-y-1 tw:text-[12px] tw:text-unknown-ink">
      {reasons.map((reason) => (
        <li key={`${reason.kind}:${reason.why}`}>
          {reason.kind === "source"
            ? `${reason.observations} unavailable observation${reason.observations === 1 ? "" : "s"}: ${reason.why}`
            : `${reason.records} unreadable work record${reason.records === 1 ? "" : "s"}: ${reason.why}`}
        </li>
      ))}
    </ul>
  );
}

function PeakLine({ peak, at }: { peak: WorkHistoryProjection["peak"]; at: TimeLabel }): ReactNode {
  if (peak.kind === "none") {
    return <p className="tw:mt-3 tw:text-[12px] tw:text-ink-faint">No load reading exists in this window, so there is no peak to relate to work.</p>;
  }
  const nearby = peak.nearestWork;
  const nearest =
    nearby.kind === "none"
      ? "No nearby work reading exists within the six-minute nearby window."
      : `Nearest work scan: observed at ${at(nearby.atMs)} — ${deltaWords(Math.abs(nearby.deltaMs))} ${nearby.deltaMs <= 0 ? "before" : "after"} the load reading.`;
  return (
    <div className="tw:mt-3 tw:rounded-md tw:bg-panel-raised tw:p-3 tw:text-[12px] tw:text-ink-soft">
      <p>
        <span className="tw:font-medium tw:text-ink">Peak load {peak.load.toFixed(2)}× cores.</span>{" "}
        The peak line names the load sample's timestamp: {at(peak.loadAtMs)}. {nearest}
      </p>
      {peak.attribution.kind === "unknown" ? (
        <p className="tw:mt-1 tw:text-unknown-ink">
          Memory attribution collected in the same health survey turn could not be read: {peak.attribution.why}.
        </p>
      ) : (
        <p className="tw:mt-1">
          Memory attribution collected in the same health survey turn:{" "}
          {peak.attribution.groups.length === 0
            ? "no process groups were reported"
            : peak.attribution.groups
                .map((group) => `${group.kind} — ${group.procs} process${group.procs === 1 ? "" : "es"}, ${group.rssKiB.toLocaleString()} KiB`)
                .join("; ")}
          {peak.attribution.groupsDropped > 0
            ? `; ${peak.attribution.groupsDropped} smaller group${peak.attribution.groupsDropped === 1 ? "" : "s"} not shown`
            : ""}
          .
        </p>
      )}
    </div>
  );
}
