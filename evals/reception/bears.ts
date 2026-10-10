/**
 * **What the model answered for `bears`, and what survived** — the F4
 * measurement of
 * [260929h](../../docs/plans/260929h-debate-mode-clearer-sources-and-orders.md)
 * stage 2, reduced to the one field the prompt still asks for.
 *
 * `debate/3` asks every row how much its passage bears on the row's target.
 * `readBearsField` (src/reception.ts) keeps an answer in the vocabulary and drops
 * anything else **silently** — deliberately, because an unjudged row is still a
 * row. But a silent drop is also how a prompt that has stopped emitting the
 * vocabulary would look like a model that simply never answered. So a run
 * reports, over every row the model reported:
 *
 * - **omitted** — no answer at all;
 * - **offered**, split by stop, or **refused** — an answer outside the three;
 * - and, of the rows that were **stored**, how many carry each stop and how
 *   many are unjudged.
 *
 * Every member of the reported array is in that denominator, including a
 * malformed member that production will discard; that member counts as
 * omitted because it offered no field. `omitted + offered + refused = rows`,
 * and `bearsProblems` says so if not.
 *
 * **These counts live in the eval's output and never in the stored artefact.**
 * It calls `readBearsField` — production's own reader, never a copy — so the
 * instrument cannot disagree with the code it measures.
 */
import { readBearsField } from "../../src/reception.js";
import { SOURCES_CLAIMS_BEARS, type SourcesClaimsBears } from "../../src/types.js";

type ByStop = { [K in SourcesClaimsBears]: number };

export interface BearsReport {
  /** Every member of the reported array — the denominator. */
  rows: number;
  omitted: number;
  /** Answers in the vocabulary, by stop. */
  offered: ByStop;
  /** Answers outside it: dropped, never defaulted. */
  refused: number;
  keptRows: number;
  /** Of the stored rows, how many carry each stop. */
  onKeptRows: ByStop;
  /** Stored rows with no `bears` — shown last, as unjudged. */
  unjudgedKept: number;
}

const byStop = (): ByStop => ({ directly: 0, partly: 0, loosely: 0 });

export function emptyBearsReport(): BearsReport {
  return { rows: 0, omitted: 0, offered: byStop(), refused: 0, keptRows: 0, onKeptRows: byStop(), unjudgedKept: 0 };
}

const sum = (s: ByStop): number => s.directly + s.partly + s.loosely;

/** One pass's rows: `reported` is what the fence held, `kept` the group's stored rows. */
export function bearsReport(reported: readonly unknown[], kept: readonly { bears?: unknown }[]): BearsReport {
  const report = emptyBearsReport();
  for (const item of reported) {
    /* Production's `reportedRows` counts every member of the fenced array,
       including a malformed non-object. The field report must use the same
       denominator or it can print a row count the run never produced. A
       non-object offered no `bears`, so it belongs in `omitted`. */
    report.rows += 1;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      report.omitted += 1;
      continue;
    }
    const row = item as Record<string, unknown>;
    const said = row.bears;
    if (said === undefined || said === null || (typeof said === "string" && said.trim() === "")) {
      report.omitted += 1;
      continue;
    }
    const read = readBearsField(row).bears;
    if (read === undefined) report.refused += 1;
    else report.offered[read] += 1;
  }
  report.keptRows = kept.length;
  for (const row of kept) {
    const read = readBearsField(row as Record<string, unknown>).bears;
    if (read === undefined) report.unjudgedKept += 1;
    else report.onKeptRows[read] += 1;
  }
  return report;
}

/** Several passes summed. */
export function sumBearsReports(reports: readonly BearsReport[]): BearsReport {
  const total = emptyBearsReport();
  for (const r of reports) {
    total.rows += r.rows;
    total.omitted += r.omitted;
    total.refused += r.refused;
    total.keptRows += r.keptRows;
    total.unjudgedKept += r.unjudgedKept;
    for (const stop of SOURCES_CLAIMS_BEARS) {
      total.offered[stop] += r.offered[stop];
      total.onKeptRows[stop] += r.onKeptRows[stop];
    }
  }
  return total;
}

/**
 * Refuse to turn a replayable subset into a run-level report. Current runs
 * expect Reception alone; callers replaying a legacy run keep the old explicit
 * direct-plus-claims inventory.
 */
export function completeBearsReport(
  attempts: readonly (
    | { ok: true; pass: "direct" | "claims"; bears: BearsReport }
    | { ok: false; pass: "direct" | "claims" | null }
  )[],
  expected: readonly ("direct" | "claims")[] = ["direct", "claims"],
): BearsReport | null {
  if (attempts.length !== expected.length || attempts.some((attempt) => !attempt.ok)) return null;
  const complete = attempts.filter((attempt): attempt is Extract<(typeof attempts)[number], { ok: true }> => attempt.ok);
  for (const pass of ["direct", "claims"] as const) {
    if (
      complete.filter((attempt) => attempt.pass === pass).length !==
      expected.filter((expectedPass) => expectedPass === pass).length
    ) return null;
  }
  return sumBearsReports(complete.map((attempt) => attempt.bears));
}

/** Arithmetic that must hold. A report that breaks it is measuring itself. */
export function bearsProblems(report: BearsReport): string[] {
  const problems: string[] = [];
  if (report.omitted + sum(report.offered) + report.refused !== report.rows) {
    problems.push(`omitted + offered + refused does not add up to ${String(report.rows)} rows`);
  }
  if (sum(report.onKeptRows) + report.unjudgedKept !== report.keptRows) {
    problems.push(`the stored rows' stops and unjudged do not add up to ${String(report.keptRows)} kept rows`);
  }
  return problems;
}

const stops = (s: ByStop): string => SOURCES_CLAIMS_BEARS.map((stop) => `${stop} ${String(s[stop])}`).join(", ");

/** The report as lines. Counts only. */
export function bearsLines(report: BearsReport, indent = "  "): string[] {
  const lines =
    sum(report.offered) === 0 && report.refused === 0
      ? [`${indent}bears: none offered on ${String(report.rows)} reported row(s) — a pre-debate/3 prompt, or a model ignoring the ask`]
      : [
          `${indent}bears over ${String(report.rows)} reported row(s): omitted ${String(report.omitted)}, ` +
            `refused ${String(report.refused)}, offered ${stops(report.offered)}`,
          `${indent}  on the ${String(report.keptRows)} stored row(s): ${stops(report.onKeptRows)}, unjudged ${String(report.unjudgedKept)}`,
        ];
  for (const problem of bearsProblems(report)) lines.push(`${indent}  ! ${problem}`);
  return lines;
}
