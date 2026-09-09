/** Turn the classifier's in-memory reading into the smaller persisted shape. */
import type { OverseerWork, PaneJob, PaneWork } from "../fleet/wire.js";
import { identityOf, sessionKey } from "./diff.js";
import type { ObservedRow } from "./observation.js";
import {
  classifyPaneWork,
  resolveExecutable,
  type ChildJob,
  type ProcessStart,
  type ProcessTableReading,
  type WorkReading,
} from "./work.js";

/**
 * `ps etimes` counts whole seconds, so a derived start can appear about one
 * second after a simultaneous collection. Two seconds rejects the gap this
 * daemon itself creates without treating that imprecision as pid reuse.
 *
 * This is only a backstop: a reused pid belonging to a process born before the
 * inventory still passes. Closing the race requires sampling the process table
 * in the same collection pass that reads the pane pids.
 */
export const REUSE_TOLERANCE_MS = 2_000;

/**
 * Keep only the executable and a safe leading subcommand.
 *
 * This replaces the first draft's argument redactor. By the time `ps` gives us
 * text, quoting and argument boundaries are gone; no list of option names can
 * promise to catch positional secrets or a prompt. Dropping the tail is the
 * guarantee, so do not reintroduce a redactor here.
 */
export function safeCommand(command: string): string {
  const resolved = resolveExecutable(command);
  if (resolved === null) return "";
  const first = resolved.args.trim().split(/\s+/, 1)[0];
  return first !== undefined && /^[A-Za-z][A-Za-z0-9._-]*$/.test(first)
    ? `${resolved.name} ${first}`
    : resolved.name;
}

function iso(start: ProcessStart): string | null {
  return start.known ? new Date(start.atMs).toISOString() : null;
}

function paneJobOf(job: ChildJob, atMs: number): PaneJob {
  return {
    recogniser: job.recogniser,
    label: job.label,
    startedAt: iso(job.started),
    ranForMs: job.started.known ? Math.max(0, atMs - job.started.atMs) : null,
    pid: job.pid,
    depth: job.depth,
    command: safeCommand(job.command),
  };
}

/** Convert one pane's classifier result without carrying its duplicate clock. */
export function paneWorkOf(input: {
  reading: WorkReading;
  /** The `collectedAt` of the inventory that named this pane pid, in ms. */
  sourceCollectedAtMs: number;
}): PaneWork {
  const { reading, sourceCollectedAtMs } = input;
  if (reading.kind === "cannot-tell") return reading;

  if (reading.paneStarted.known && reading.paneStarted.atMs > sourceCollectedAtMs + REUSE_TOLERANCE_MS) {
    return {
      kind: "cannot-tell",
      cause: "pane-younger-than-inventory",
      why:
        `the process now holding the pane pid started after the inventory that named it ` +
        `(beyond the ${REUSE_TOLERANCE_MS} ms process-clock tolerance), so the pid may have been reused`,
    };
  }

  const paneCommand = safeCommand(reading.paneCommand);
  const paneStartedAt = iso(reading.paneStarted);
  if (reading.kind === "no-child-work") {
    return { kind: "none", inspected: reading.inspected, paneCommand, paneStartedAt };
  }

  const [first, ...rest] = reading.jobs;
  const jobs: readonly [PaneJob, ...PaneJob[]] = [
    paneJobOf(first, reading.atMs),
    ...rest.map((job) => paneJobOf(job, reading.atMs)),
  ];
  return { kind: "work", jobs, inspected: reading.inspected, paneCommand, paneStartedAt };
}

/** Classify every row from one process-table instant. */
export function scanPaneWork(input: {
  rows: readonly ObservedRow[];
  reading: ProcessTableReading;
  sourceCollectedAt: string;
  /** Used only for the `probe-failed` arm's `attemptedAt`; a successful scan takes its clock from
   *  the reading itself. */
  attemptedAt: string;
}): OverseerWork {
  const { rows, reading, sourceCollectedAt, attemptedAt } = input;
  if (!reading.read) return { kind: "probe-failed", why: reading.why, attemptedAt, sourceCollectedAt };

  const sourceCollectedAtMs = Date.parse(sourceCollectedAt);
  return {
    kind: "scan",
    scannedAt: new Date(reading.atMs).toISOString(),
    sourceCollectedAt,
    panes: rows.map((row) => ({
      key: sessionKey(identityOf(row)),
      work: paneWorkOf({ reading: classifyPaneWork(row.panePid, reading), sourceCollectedAtMs }),
    })),
  };
}
