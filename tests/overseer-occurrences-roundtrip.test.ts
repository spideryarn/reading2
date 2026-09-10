/**
 * **The writer and the one parser, checked against each other.** Plan
 * 260910f-scheduled-dispatch § D7.
 *
 * `occurrences-projection.ts` writes `occurrences.json`; `occurrences-parse.ts`
 * is what the route and the browser read it with. Each has its own tests, and
 * each could pass while the other drifted — the parser pairs every state with
 * the results the classifier can give it, so a ladder change on one side would
 * make real rows unreadable on the page. So: one occurrence for every result
 * kind the classifier can produce, written by the real writer, read back by the
 * real route reader and the real parser, and not one row unreadable.
 *
 * No id here is a uuid (`tests/fixture-ids.test.ts`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { parseOccurrencesFile } from "../tools/fleet/occurrences-parse.js";
import { readOccurrencesFile } from "../tools/fleet/routes-occurrences.js";
import type { ScheduledResultKind } from "../tools/fleet/wire.js";
import { classifyOccurrence, type ObservedExitRecord, type ObservedLaunch, type ObservedState } from "../tools/overseer/occurrence-result.js";
import { occurrencesProjection, writeOccurrencesFile } from "../tools/overseer/occurrences-projection.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const loId = (n: number): string => `lo-${"1".repeat(18)}${n.toString(16).padStart(2, "0")}`;
const at = (n: number): string => new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString();

const okExit: ObservedExitRecord = {
  kind: "exit-record",
  ending: { kind: "exited", code: 0 },
  timedOut: false,
  answerUsable: true,
  verdict: { kind: "ok" },
  usageLimit: false,
  permissionDenials: 0,
};

/** One state per result kind the ladder can reach, plus a disposition. */
const CASES: readonly { state: ObservedState; disposed?: boolean }[] = [
  { state: { kind: "planned" } },
  { state: { kind: "waiting-admission", why: "the slot is held by another launch" } },
  { state: { kind: "reserved" } },
  { state: { kind: "launching", attempt: 1 } },
  { state: { kind: "observed-running", attempt: 1 } },
  { state: { kind: "outcome-unknown", attempt: 1, why: "no start record and no session" } },
  { state: { kind: "outcome-unknown", attempt: 1, why: "no start record and no session" }, disposed: true },
  { state: { kind: "failed-before-launch", attempt: null, proof: "launcher-refused", why: "no tmux server" } },
  { state: { kind: "completed", attempt: 1, evidence: { ...okExit, ending: { kind: "supervisor-failed", why: "spawn failed" } } } },
  { state: { kind: "completed", attempt: 1, evidence: { ...okExit, timedOut: true, ending: { kind: "signalled", signal: "SIGTERM" } } } },
  { state: { kind: "completed", attempt: 1, evidence: { ...okExit, usageLimit: true, ending: { kind: "exited", code: 1 } } } },
  { state: { kind: "completed", attempt: 1, evidence: { kind: "rebooted" } } },
  { state: { kind: "completed", attempt: 1, evidence: { ...okExit, permissionDenials: 2 } } },
  { state: { kind: "completed", attempt: 1, evidence: { ...okExit, answerUsable: false } } },
  { state: { kind: "completed", attempt: 1, evidence: { ...okExit, ending: { kind: "exited", code: 3 }, verdict: { kind: "failed", cause: "nonzero", why: "exit 3" } } } },
  { state: { kind: "completed", attempt: 1, evidence: okExit } },
];

function observed(n: number, state: ObservedState, disposed: boolean): ObservedLaunch {
  const open = state.kind !== "planned" && state.kind !== "waiting-admission" && state.kind !== "reserved";
  return {
    launchOccurrenceId: loId(n),
    schedulerOccurrenceId: `occ-roundtrip-${n}`,
    jobId: `job-${n}`,
    scheduledAt: at(n),
    behaviourHash: "abcdef012345",
    plannedAt: at(n),
    updatedAt: at(n + 1),
    attempts: open ? 1 : 0,
    run: { timeoutMinutes: 5, access: "read-only" },
    tmuxSession: state.kind === "observed-running" || state.kind === "launching" ? `job-${n}-0901-0000` : null,
    transcriptPath: state.kind === "completed" ? `/scratch/launches/o/${loId(n)}/a1/transcript.ndjson` : null,
    answer: state.kind === "completed" ? { kind: "present", attempt: 1, bytes: 42, usable: true } : { kind: "absent" },
    disposition: disposed ? { decision: "ended", why: "Greg checked the box", at: at(n + 2) } : null,
    state,
  };
}

describe("occurrences.json, written by the real writer and read by the real parser", () => {
  test("every result kind the classifier gives survives the round trip, and no row is unreadable", () => {
    const launches = CASES.map((one, index) => observed(index + 1, one.state, one.disposed === true));
    // THE CASES REALLY DO COVER THE LADDER — or this test would be proving
    // less than its name says.
    const kinds = new Set<ScheduledResultKind>(launches.map((launch) => classifyOccurrence(launch).kind));
    const every: readonly ScheduledResultKind[] = [
      "pending",
      "admission-waiting",
      "running",
      "unknown",
      "launch-failed",
      "timed-out",
      "quota-refused",
      "interrupted",
      "permission-denied",
      "missing-answer",
      "failed",
      "succeeded",
    ];
    expect([...kinds].sort()).toEqual([...every].sort());

    const file = occurrencesProjection({
      writtenAt: "2026-09-10T12:00:00.000Z",
      instanceId: "instance-roundtrip",
      journal: { kind: "whole" },
      jobs: launches.map((launch) => ({
        jobId: launch.jobId,
        dispatch: { kind: "live" },
        run: launch.run,
        next: { kind: "next-due", at: "2026-09-11T00:00:00.000Z" },
        observed: [launch],
      })),
    });
    const root = mkdtempSync(join(tmpdir(), "overseer-occurrences-roundtrip-"));
    roots.push(root);
    expect(writeOccurrencesFile(root, file)).toEqual({ ok: true });

    const read = readOccurrencesFile(root);
    if (read.kind !== "read") throw new Error(`the route reader did not read the file: ${JSON.stringify(read)}`);
    const parsed = parseOccurrencesFile(read.json);
    expect(parsed.kind).toBe("parsed");
    const text = JSON.stringify(parsed);
    expect(text).not.toContain('"unreadable"');
    // Every occurrence came back as an occurrence, with its result intact.
    for (const job of file.jobs) {
      for (const occurrence of job.occurrences) {
        expect(text).toContain(`"launchOccurrenceId":"${occurrence.launchOccurrenceId}"`);
        expect(text).toContain(JSON.stringify(occurrence.result).slice(1, -1));
      }
    }
  });
});
