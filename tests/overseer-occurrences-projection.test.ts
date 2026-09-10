/**
 * **The occurrences projection: bounded, newest first, with a command only
 * where one applies — and written atomically.** Plan 260910f-scheduled-dispatch § D7.
 *
 * `occurrencesProjection` is pure; `writeOccurrencesFile` is the one line of I/O.
 * Every store root is a temp directory, `~/.overseer` is never touched, and no
 * id here is a uuid (`tests/fixture-ids.test.ts`).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { OCCURRENCES_FILE, OCCURRENCES_PER_JOB, OCCURRENCES_SCHEMA } from "../tools/fleet/occurrences-parse.js";
import { classifyOccurrence, type ObservedLaunch, type ObservedState } from "../tools/overseer/occurrence-result.js";
import { occurrencesProjection, writeOccurrencesFile, type OccurrencesProjectionJob } from "../tools/overseer/occurrences-projection.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-occurrences-"));
  roots.push(root);
  return root;
}

/** `lo-` and 20 hex characters, the last two from `n`. */
const loId = (n: number): string => `lo-${"0".repeat(18)}${n.toString(16).padStart(2, "0")}`;

/** `2026-09-<day>T09:00:00.000Z`. */
const day = (d: number): string => `2026-09-${String(d).padStart(2, "0")}T09:00:00.000Z`;

function observed(n: number, over: Partial<ObservedLaunch> = {}): ObservedLaunch {
  return {
    launchOccurrenceId: loId(n),
    schedulerOccurrenceId: `occ-fixture-${n}`,
    jobId: "schedule-fixture",
    scheduledAt: day(n),
    behaviourHash: "abcdef012345",
    plannedAt: day(n),
    updatedAt: day(n),
    attempts: 1,
    run: { timeoutMinutes: 5, access: "read-only" },
    tmuxSession: null,
    transcriptPath: null,
    answer: { kind: "absent" },
    disposition: null,
    state: { kind: "planned" },
    ...over,
  };
}

function job(observedLaunches: readonly ObservedLaunch[], over: Partial<OccurrencesProjectionJob> = {}): OccurrencesProjectionJob {
  return {
    jobId: "schedule-fixture",
    dispatch: { kind: "live" },
    run: { timeoutMinutes: 5, access: "read-only" },
    next: { kind: "next-due", at: day(28) },
    observed: observedLaunches,
    ...over,
  };
}

function project(jobs: readonly OccurrencesProjectionJob[]) {
  return occurrencesProjection({ writtenAt: "2026-09-10T12:00:00.000Z", instanceId: "instance-fixture", journal: { kind: "whole" }, jobs });
}

function only(observedLaunch: ObservedLaunch) {
  const occurrence = project([job([observedLaunch])]).jobs[0]?.occurrences[0];
  if (occurrence === undefined) throw new Error("the projection dropped the only occurrence");
  return occurrence;
}

describe("the file around the jobs", () => {
  test("carries the schema, the instant, the instance, the journal standing, and each job in the order given", () => {
    const file = occurrencesProjection({
      writtenAt: "2026-09-10T12:00:00.000Z",
      instanceId: "instance-fixture",
      journal: { kind: "history-lost", why: "line 40 did not parse" },
      jobs: [job([], { jobId: "b-job" }), job([], { jobId: "a-job", dispatch: { kind: "dry-run", why: "not armed" }, next: { kind: "due-now" } })],
    });
    expect(file.schema).toBe(OCCURRENCES_SCHEMA);
    expect(file.writtenAt).toBe("2026-09-10T12:00:00.000Z");
    expect(file.instanceId).toBe("instance-fixture");
    expect(file.journal).toEqual({ kind: "history-lost", why: "line 40 did not parse" });
    expect(file.jobs.map((j) => j.jobId)).toEqual(["b-job", "a-job"]);
    expect(file.jobs[1]).toMatchObject({ dispatch: { kind: "dry-run", why: "not armed" }, next: { kind: "due-now" }, occurrences: [], omitted: 0 });
  });

  test("an occurrence for a different job is a bug in the caller, not a row", () => {
    expect(() => project([job([observed(1, { jobId: "someone-else" })])])).toThrow(/someone-else/);
  });
});

describe("the bound and the order", () => {
  test(`keeps the newest ${OCCURRENCES_PER_JOB} by scheduledAt, and counts the rest as omitted`, () => {
    const launches = [3, 14, 1, 9, 12, 5, 7, 2, 11, 4, 13, 6, 8, 10].map((n) => observed(n));
    const projected = project([job(launches)]).jobs[0];
    expect(projected?.occurrences.map((o) => o.scheduledAt)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map(day));
    expect(projected?.omitted).toBe(4);
  });

  test("exactly the bound omits nothing", () => {
    const projected = project([job(Array.from({ length: OCCURRENCES_PER_JOB }, (_, i) => observed(i + 1)))]).jobs[0];
    expect(projected?.occurrences).toHaveLength(OCCURRENCES_PER_JOB);
    expect(projected?.omitted).toBe(0);
  });

  test("a tie on scheduledAt is broken by launch id, the same way every time", () => {
    const a = observed(2, { scheduledAt: day(5) });
    const b = observed(1, { scheduledAt: day(5) });
    const forwards = project([job([a, b])]).jobs[0]?.occurrences.map((o) => o.launchOccurrenceId);
    const backwards = project([job([b, a])]).jobs[0]?.occurrences.map((o) => o.launchOccurrenceId);
    expect(forwards).toEqual([loId(1), loId(2)]);
    expect(backwards).toEqual(forwards);
  });
});

describe("each occurrence", () => {
  test("restates the observed fields and takes its result from classifyOccurrence", () => {
    const input = observed(4, {
      state: { kind: "completed", attempt: 2, evidence: { kind: "rebooted" } },
      attempts: 2,
      transcriptPath: "/scratch/launches/o/x/a2/transcript.ndjson",
      answer: { kind: "present", attempt: 2, bytes: 120, sha256: "0123456789abcdef".repeat(4), usable: true },
      updatedAt: "2026-09-04T09:10:00.000Z",
    });
    expect(only(input)).toEqual({
      launchOccurrenceId: loId(4),
      schedulerOccurrenceId: "occ-fixture-4",
      scheduledAt: day(4),
      behaviourHash: "abcdef012345",
      plannedAt: day(4),
      updatedAt: "2026-09-04T09:10:00.000Z",
      attempts: 2,
      state: "completed",
      run: { timeoutMinutes: 5, access: "read-only" },
      result: classifyOccurrence(input),
      answer: { kind: "present", attempt: 2, bytes: 120, sha256: "0123456789abcdef".repeat(4), usable: true },
      transcriptPath: "/scratch/launches/o/x/a2/transcript.ndjson",
      tmuxSession: null,
      commands: { cancel: null, dispose: null },
    });
  });
});

describe("the cancel command", () => {
  test.each<ObservedState>([
    { kind: "launching", attempt: 1 },
    { kind: "observed-running", attempt: 1 },
  ])("is the exact kill-session line while %j", (state) => {
    expect(only(observed(1, { state, tmuxSession: "sched-fixture.a1" })).commands).toEqual({ cancel: "tmux kill-session -t '=sched-fixture.a1'", dispose: null });
  });

  test.each<ObservedState>([
    { kind: "planned" },
    { kind: "waiting-admission", why: "held" },
    { kind: "reserved" },
    { kind: "completed", attempt: 1, evidence: { kind: "rebooted" } },
    { kind: "failed-before-launch", attempt: null, proof: "admission-refused", why: "no slot" },
  ])("is absent when %j, even with a session name", (state) => {
    expect(only(observed(1, { state, tmuxSession: "sched-fixture" })).commands.cancel).toBeNull();
  });

  test("is absent with no session name", () => {
    expect(only(observed(1, { state: { kind: "observed-running", attempt: 1 } })).commands.cancel).toBeNull();
  });

  test.each(["it's; rm -rf ~", "has space", "", "a".repeat(65), "quote'd", "$(whoami)"])("refuses the session name %j rather than quoting a guess", (name) => {
    expect(only(observed(1, { state: { kind: "observed-running", attempt: 1 }, tmuxSession: name })).commands.cancel).toBeNull();
  });

  test("is absent once Greg has disposed of it", () => {
    const disposed = observed(1, {
      state: { kind: "observed-running", attempt: 1 },
      tmuxSession: "sched-fixture",
      disposition: { decision: "ended", why: "it ended", at: day(2) },
    });
    expect(only(disposed).commands.cancel).toBeNull();
  });
});

describe("the dispose command", () => {
  const unknown: ObservedState = { kind: "outcome-unknown", attempt: 1, why: "the supervisor vanished" };

  test("is the exact overseer-launches line when the outcome is unknown", () => {
    expect(only(observed(7, { state: unknown, tmuxSession: "sched-fixture" })).commands).toEqual({
      cancel: null,
      dispose: `npx tsx scripts/overseer-launches.ts dispose ${loId(7)} --as not-running --why "<reason>"`,
    });
  });

  test.each<ObservedState>([
    { kind: "launching", attempt: 1 },
    { kind: "observed-running", attempt: 1 },
    { kind: "completed", attempt: 1, evidence: { kind: "rebooted" } },
    { kind: "reserved" },
  ])("is absent when %j", (state) => {
    expect(only(observed(7, { state })).commands.dispose).toBeNull();
  });

  test.each(["lo-0123", "lo-0123456789ABCDEF0123", "xx-0123456789abcdef0123", "lo-0123456789abcdef0123-a1", "lo-0123456789abcdef0123; rm"])(
    "refuses the id %j",
    (id) => {
      expect(only(observed(7, { state: unknown, launchOccurrenceId: id })).commands.dispose).toBeNull();
    },
  );

  test("is absent once it has been disposed of — the protocol refuses a second disposition", () => {
    expect(only(observed(7, { state: unknown, disposition: { decision: "not-running", why: "gone", at: day(8) } })).commands.dispose).toBeNull();
  });
});

describe("writeOccurrencesFile", () => {
  test("round-trips through JSON.parse to an equal object and leaves no temp file behind", () => {
    const root = tempRoot();
    const file = project([job([observed(1), observed(2, { state: { kind: "outcome-unknown", attempt: 1, why: "cannot tell" } })])]);
    expect(writeOccurrencesFile(root, file)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(join(root, OCCURRENCES_FILE), "utf8"))).toEqual(file);
    expect(readdirSync(root)).toEqual([OCCURRENCES_FILE]);
  });

  test("overwrites the previous file whole", () => {
    const root = tempRoot();
    writeOccurrencesFile(root, project([job([observed(1), observed(2)])]));
    const second = project([job([])]);
    expect(writeOccurrencesFile(root, second)).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(join(root, OCCURRENCES_FILE), "utf8"))).toEqual(second);
    expect(readdirSync(root)).toEqual([OCCURRENCES_FILE]);
  });

  test("a store it cannot write to is a result, not a throw", () => {
    const missing = join(tempRoot(), "no-such-directory");
    const result = writeOccurrencesFile(missing, project([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toContain(OCCURRENCES_FILE);
  });
});
