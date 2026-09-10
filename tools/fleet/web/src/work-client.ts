/**
 * The browser boundary for stored and live work readings.
 *
 * These unions come from `wire.ts`, which is safe to import as types but is not
 * a runtime validator. Keeping the parser in one leaf means a historical
 * `workTurn` and the live `currentWork` field cannot quietly acquire different
 * ideas of what a scan or an unavailable reading means.
 *
 * Timestamps are preserved for history: its geometry is arithmetic entirely
 * on the server clock. Live state supplies a conversion callback so its ages
 * are compared with the browser clock after the same boundary correction as
 * the rest of `/api/state`.
 */
import type { StoredWork, StoredWorkGroup, StoredWorkTurn, WorkFeed } from "../../wire.js";

export type CurrentWorkView =
  | WorkFeed
  | { kind: "not-reported" }
  | { kind: "payload-unreadable"; why: string };

export const CURRENT_WORK_NOT_REPORTED: CurrentWorkView = { kind: "not-reported" };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonBlank(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function timestamp(value: unknown): string | null {
  const text = nonBlank(value);
  if (text === null) return null;
  const at = new Date(text);
  /* The producer writes `toISOString()`. Accepting Date.parse's larger dialect
     would let values such as "0" become confident clock readings. */
  return Number.isNaN(at.getTime()) || at.toISOString() !== text ? null : text;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseTiming(raw: unknown, jobs: number): StoredWorkGroup["timing"] | null {
  const source = record(raw);
  if (source === null) return null;
  if (source["kind"] === "unknown") return { kind: "unknown" };

  const oldestStartedAt = timestamp(source["oldestStartedAt"]);
  const longestRanForMs = count(source["longestRanForMs"]);
  if (oldestStartedAt === null || longestRanForMs === null) return null;
  if (source["kind"] === "known") {
    return { kind: "known", oldestStartedAt, longestRanForMs };
  }
  if (source["kind"] === "partial") {
    const knownJobs = count(source["knownJobs"]);
    if (knownJobs === null || knownJobs === 0 || knownJobs >= jobs) return null;
    return { kind: "partial", knownJobs, oldestStartedAt, longestRanForMs };
  }
  return null;
}

function parseGroup(raw: unknown): StoredWorkGroup | null {
  const source = record(raw);
  if (source === null) return null;
  const session = nonBlank(source["session"]);
  const recogniser = nonBlank(source["recogniser"]);
  const jobs = count(source["jobs"]);
  if (session === null || recogniser === null || jobs === null || jobs === 0) return null;
  const timing = parseTiming(source["timing"], jobs);
  /* Absent on every record written before names were stored, and null when the
     register could not supply one. Both render as the key, so both arrive here
     as null — health-history.ts's `parseStoredWorkGroup` says why that collapse
     is deliberate rather than lenient. */
  const sessionName = nonBlank(source["sessionName"]);
  return timing === null ? null : { session, sessionName, recogniser, jobs, timing };
}

export function parseStoredWork(raw: unknown): StoredWork | null {
  const source = record(raw);
  if (source === null) return null;
  const why = nonBlank(source["why"]);

  if (source["kind"] === "not-yet-run") {
    const asOf = timestamp(source["asOf"]);
    return asOf === null || why === null ? null : { kind: "not-yet-run", asOf, why };
  }
  if (source["kind"] === "probe-failed") {
    const attemptedAt = timestamp(source["attemptedAt"]);
    const sourceCollectedAt = timestamp(source["sourceCollectedAt"]);
    return attemptedAt === null || sourceCollectedAt === null || why === null
      ? null
      : { kind: "probe-failed", attemptedAt, sourceCollectedAt, why };
  }
  if (source["kind"] === "checkpoint-unavailable") {
    const checkedAt = timestamp(source["checkedAt"]);
    return checkedAt === null || why === null ? null : { kind: "checkpoint-unavailable", checkedAt, why };
  }
  if (source["kind"] !== "scan" || !Array.isArray(source["groups"])) return null;

  const scannedAt = timestamp(source["scannedAt"]);
  const groupsDropped = count(source["groupsDropped"]);
  const panes = record(source["panes"]);
  const work = panes === null ? null : count(panes["work"]);
  const none = panes === null ? null : count(panes["none"]);
  const cannotTell = panes === null ? null : count(panes["cannotTell"]);
  if (scannedAt === null || groupsDropped === null || work === null || none === null || cannotTell === null) return null;

  const groups: StoredWorkGroup[] = [];
  for (const rawGroup of source["groups"]) {
    const group = parseGroup(rawGroup);
    if (group === null) return null;
    groups.push(group);
  }
  return { kind: "scan", scannedAt, groups, groupsDropped, panes: { work, none, cannotTell } };
}

export function parseStoredWorkTurn(raw: unknown): StoredWorkTurn | null {
  const source = record(raw);
  if (source === null) return null;
  if (source["kind"] === "not-due") return { kind: "not-due" };
  if (source["kind"] !== "due") return null;
  const result = parseStoredWork(source["result"]);
  return result === null ? null : { kind: "due", result };
}

function shiftTiming(timing: StoredWorkGroup["timing"], shift: (value: string) => string): StoredWorkGroup["timing"] {
  if (timing.kind === "unknown") return timing;
  return { ...timing, oldestStartedAt: shift(timing.oldestStartedAt) };
}

function shiftWork(work: StoredWork, shift: (value: string) => string): StoredWork {
  switch (work.kind) {
    case "not-yet-run":
      return { ...work, asOf: shift(work.asOf) };
    case "probe-failed":
      return { ...work, attemptedAt: shift(work.attemptedAt), sourceCollectedAt: shift(work.sourceCollectedAt) };
    case "checkpoint-unavailable":
      return { ...work, checkedAt: shift(work.checkedAt) };
    case "scan":
      return {
        ...work,
        scannedAt: shift(work.scannedAt),
        groups: work.groups.map((group) => ({ ...group, timing: shiftTiming(group.timing, shift) })),
      };
  }
}

export function parseCurrentWork(raw: unknown, shift: (value: string) => string): CurrentWorkView {
  if (raw === undefined) return CURRENT_WORK_NOT_REPORTED;
  const source = record(raw);
  if (source === null) return { kind: "payload-unreadable", why: "the current-work field is not an object" };
  if (source["kind"] === "checkpoint-absent") return { kind: "checkpoint-absent" };
  if (source["kind"] === "checkpoint-unreadable") {
    const why = nonBlank(source["why"]);
    return why === null
      ? { kind: "payload-unreadable", why: "the current-work checkpoint failure gave no reason" }
      : { kind: "checkpoint-unreadable", why };
  }
  if (source["kind"] !== "published") {
    return { kind: "payload-unreadable", why: `this page does not know current work ${JSON.stringify(source["kind"] ?? null)}` };
  }
  const coordinatorWrittenAt = timestamp(source["coordinatorWrittenAt"]);
  const work = parseStoredWork(source["work"]);
  if (coordinatorWrittenAt === null || work === null) {
    return { kind: "payload-unreadable", why: "the published current-work reading has a shape this page cannot read" };
  }
  return { kind: "published", coordinatorWrittenAt: shift(coordinatorWrittenAt), work: shiftWork(work, shift) };
}
