/** Recognition and ancestry are pure; procfs only produces rows; the repeating
 * task only caches completed passes. A request handler never walks `/proc`. */
import { readFile, readdir } from "node:fs/promises";

import { recogniseHarnessCommand } from "../overseer/harness.js";
import { isBrowserProgram, isVitestRunner } from "./actions.js";
import { parseProcStat } from "./execution-identity.js";
import type { AdmissionCensusClass, AdmissionCensusCounts, AdmissionCensusState } from "./wire.js";

export type CensusProcRow =
  | {
      kind: "read";
      pid: number;
      ppid: number;
      comm: string;
      /** Whitespace is U+2423 and an empty element is U+2400, preserving argv boundaries in this ps-shaped string. */
      args: string;
      startTicks: number;
      changedUnderRead: boolean;
    }
  | { kind: "unreadable"; pid: number; why: string };

export type CensusProcIo = {
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string): Promise<string | Buffer>;
};

const PROC = "/proc";
const MAX_ANCESTOR_HOPS = 64;
const DEFAULT_PROC_IO: CensusProcIo = {
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path),
};

/** Classify one stable row using only the recognisers owned elsewhere. */
export function recogniseCensusClass(row: Extract<CensusProcRow, { kind: "read" }>): AdmissionCensusClass | null {
  // An empty argv is a readable procfs fact for kernel threads and zombies.
  // In particular, comm alone must not turn a dead Chrome zombie into a live browser root.
  if (row.args === "") return null;
  if (isBrowserProgram(row)) return "browser";

  const harness = recogniseHarnessCommand(row.args);
  if (harness !== null) return harness.found === "codex-batch" ? "codex-batch" : null;

  if (isVitestRunner(row)) return "test";
  return null;
}

function isChromeHelper(row: Extract<CensusProcRow, { kind: "read" }>, censusClass: AdmissionCensusClass): boolean {
  return censusClass === "browser" && row.args.split(" ").some((token) => token.startsWith("--type="));
}

function isVitestWorker(row: Extract<CensusProcRow, { kind: "read" }>, censusClass: AdmissionCensusClass): boolean {
  return censusClass === "test" && row.args.split(" ").some((token) => token.includes("/node_modules/vitest/dist/workers/"));
}

type AncestryAnswer = "root" | "nested" | "uncertain";

function ancestryAnswer(
  candidate: Extract<CensusProcRow, { kind: "read" }>,
  censusClass: AdmissionCensusClass,
  byPid: ReadonlyMap<number, CensusProcRow>,
): AncestryAnswer {
  let child = candidate;
  const visited = new Set<number>([candidate.pid]);

  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop += 1) {
    const parentPid = child.ppid;
    // Only the kernel boundary is terminal. PID 1 is still a process and is
    // walked when readable; if a namespace hides it, that positive parent is
    // uncertain by the same rule as any other missing ancestor.
    if (parentPid === 0) return "root";
    if (visited.has(parentPid)) return "uncertain";

    const parent = byPid.get(parentPid);
    if (parent === undefined || parent.kind === "unreadable" || parent.changedUnderRead) return "uncertain";
    // A real parent must have started no later than its child. Equal ticks are valid.
    if (parent.startTicks > child.startTicks) return "uncertain";
    // Empty argv is readable, but as an ancestor it describes a kernel thread
    // or zombie. It cannot settle a cross-row ancestry assembled over time.
    if (parent.args === "") return "uncertain";

    visited.add(parentPid);
    if (recogniseCensusClass(parent) === censusClass) return "nested";
    child = parent;
  }
  return "uncertain";
}

/** Fold one process-table observation into recognised roots. */
export function foldCensus(rows: readonly CensusProcRow[]): AdmissionCensusCounts {
  const census: AdmissionCensusCounts = {
    byClass: {
      test: { roots: 0, uncertain: 0 },
      "codex-batch": { roots: 0, uncertain: 0 },
      browser: { roots: 0, uncertain: 0 },
    },
    changedUnderRead: 0,
    unreadable: 0,
    processesSeen: rows.length,
  };
  const byPid = new Map(rows.map((candidate) => [candidate.pid, candidate] as const));

  for (const candidate of rows) {
    if (candidate.kind === "unreadable") {
      census.unreadable += 1;
      continue;
    }
    if (candidate.changedUnderRead) {
      census.changedUnderRead += 1;
      continue;
    }
    const censusClass = recogniseCensusClass(candidate);
    if (
      censusClass === null ||
      isChromeHelper(candidate, censusClass) ||
      isVitestWorker(candidate, censusClass)
    ) continue;

    const answer = ancestryAnswer(candidate, censusClass, byPid);
    if (answer === "root") census.byClass[censusClass].roots += 1;
    else if (answer === "uncertain") census.byClass[censusClass].uncertain += 1;
  }
  return census;
}

function said(cause: unknown): string {
  try {
    const rendered = cause instanceof Error ? cause.message : String(cause);
    return rendered.trim() === "" ? "the census pass failed without a readable cause" : rendered;
  } catch {
    return "the census pass failed with a cause that could not be rendered";
  }
}

function unreadable(pid: number, step: string, why: string): CensusProcRow {
  return { kind: "unreadable", pid, why: `/proc/${pid}/${step} could not be read: ${why}` };
}

function text(value: string | Buffer): string {
  return typeof value === "string" ? value : value.toString("utf8");
}

function parseStatRow(raw: string):
  | { ok: true; ppid: number; startTicks: number; comm: string }
  | { ok: false; why: string } {
  if (raw.length === 0) return { ok: false, why: "the file was empty" };
  const parsed = parseProcStat(raw);
  if (!parsed.ok) return parsed;
  const open = raw.indexOf("(");
  const close = raw.lastIndexOf(")");
  if (open === -1 || close <= open) return { ok: false, why: "the stat line has no complete command name" };
  return { ok: true, ppid: parsed.ppid, startTicks: parsed.startTicks, comm: raw.slice(open + 1, close) };
}

function encodeCmdline(raw: string): string {
  if (raw.length === 0) return "";
  const argv = raw.split("\0");
  if (argv.at(-1) === "") argv.pop();
  return argv.map((argument) => argument === "" ? "␀" : argument.replace(/\s/g, "␣")).join(" ");
}

async function readOneProcRow(pid: number, io: CensusProcIo): Promise<CensusProcRow> {
  let beforeRaw: string;
  try {
    beforeRaw = text(await io.readFile(`${PROC}/${pid}/stat`));
  } catch (cause) {
    return unreadable(pid, "stat", said(cause));
  }
  const before = parseStatRow(beforeRaw);
  if (!before.ok) return unreadable(pid, "stat", before.why);

  let args: string;
  try {
    args = encodeCmdline(text(await io.readFile(`${PROC}/${pid}/cmdline`)));
  } catch (cause) {
    return unreadable(pid, "cmdline", said(cause));
  }
  let afterRaw: string;
  try {
    afterRaw = text(await io.readFile(`${PROC}/${pid}/stat`));
  } catch (cause) {
    return unreadable(pid, "stat", said(cause));
  }
  const after = parseStatRow(afterRaw);
  if (!after.ok) return unreadable(pid, "stat", after.why);

  return {
    kind: "read",
    pid,
    ppid: before.ppid,
    comm: before.comm,
    args,
    startTicks: before.startTicks,
    changedUnderRead:
      before.ppid !== after.ppid ||
      before.startTicks !== after.startTicks ||
      before.comm !== after.comm,
  };
}

/** Read every numeric `/proc` entry, retaining a row for each per-pid failure. */
export async function readProcRows(io: CensusProcIo = DEFAULT_PROC_IO): Promise<CensusProcRow[]> {
  // Enumeration is deliberately not caught: no table is a failed pass, not an empty census.
  const entries = await io.readdir(PROC);
  const rows: CensusProcRow[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    rows.push(await readOneProcRow(pid, io));
  }
  return rows;
}

type CensusTimer = { unref?(): unknown };

export type StartCensusTaskOptions = {
  readRows: () => Promise<CensusProcRow[]>;
  fold?: (rows: readonly CensusProcRow[]) => AdmissionCensusCounts;
  cadenceMs: number;
  nowMs: () => number;
  setTimer?: (callback: () => void, delayMs: number) => CensusTimer;
  log?: (message: string) => void;
};

export type CensusTask = { read(): AdmissionCensusState; stop(): void };

/** Start an immediate pass and end-chain later passes behind unreferenced timers. */
export function startCensusTask(options: StartCensusTaskOptions): CensusTask {
  const fold = options.fold ?? foldCensus;
  const setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  let stopped = false;
  let taskStartedAtMs: number;
  try {
    taskStartedAtMs = options.nowMs();
  } catch {
    taskStartedAtMs = Date.now();
  }
  let state: AdmissionCensusState = {
    kind: "not-yet-computed",
    label: "observed",
    startedAtMs: taskStartedAtMs,
  };

  const recordFailure = (cause: unknown): void => {
    const previous = state;
    const lastGood =
      previous.kind === "value"
        ? {
            census: previous.census,
            startedAtMs: previous.startedAtMs,
            completedAtMs: previous.completedAtMs,
          }
        : previous.kind === "failed"
          ? previous.lastGood
          : null;
    let failedAtMs: number;
    try {
      failedAtMs = options.nowMs();
    } catch {
      failedAtMs = Date.now();
    }
    const why = said(cause);
    state = { kind: "failed", label: "observed", why, failedAtMs, cadenceMs: options.cadenceMs, lastGood };
    try {
      options.log?.(`admission census: ${why}`);
    } catch {
      // Reporting a failed observation may not fail the server too.
    }
  };

  const runPass = async (): Promise<void> => {
    if (stopped) return;
    try {
      const startedAtMs = options.nowMs();
      const rows = await options.readRows();
      if (stopped) return;
      const census = fold(rows);
      const completedAtMs = options.nowMs();
      if (completedAtMs < startedAtMs) {
        throw new Error(`the census clock moved backwards during the pass (${startedAtMs} to ${completedAtMs})`);
      }
      state = {
        kind: "value",
        label: "observed",
        census,
        startedAtMs,
        completedAtMs,
        durationMs: Math.max(0, completedAtMs - startedAtMs),
        cadenceMs: options.cadenceMs,
      };
    } catch (cause) {
      recordFailure(cause);
    }

    if (stopped) return;
    try {
      const timer = setTimer(() => {
        // Both the pass and the next scheduling attempt are caught in runPass.
        void runPass();
      }, options.cadenceMs);
      timer.unref?.();
    } catch (cause) {
      recordFailure(cause);
    }
  };

  // Immediate but asynchronous: callers can observe not-yet-computed.
  void runPass();

  return {
    read: () => state,
    stop() {
      stopped = true;
    },
  };
}
