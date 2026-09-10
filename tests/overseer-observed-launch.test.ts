/**
 * **`observedOf`: one launch record, as the classifier sees it.** Plan
 * 260910f-scheduled-dispatch § D6, Stage B.
 *
 * The records here are REAL: each is built by writing the protocol's own
 * journal lines and folding them with its own `replayJournal`, so a record
 * this adapter is handed is one the protocol's transition relation allows —
 * a hand-built object could be a state no journal can reach. The `exit.json`
 * readings are real too where the file matters: written with the protocol's
 * `artefactText` into a temp attempt directory and read back with its own
 * `readArtefacts`, so "unreadable" is the reader's word, not the test's.
 *
 * No id here is a uuid (`tests/fixture-ids.test.ts`); every store root is a
 * temp directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { EXIT_FILE, artefactText, readArtefacts, type ArtefactRead, type ExitRecord } from "../tools/overseer/launch-artefacts.js";
import {
  correlationIdOf,
  occurrenceIdOf,
  recoveryOrigin,
  replayJournal,
  reservationKeyOf,
  type ExitFacts,
  type LaunchOccurrenceId,
  type LaunchOrigin,
  type LaunchRecord,
  type LauncherKind,
  type RunSpec,
} from "../tools/overseer/launch-protocol.js";
import { observedOf } from "../tools/overseer/observed-launch.js";
import { classifyOccurrence, type ObservedLaunch } from "../tools/overseer/occurrence-result.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const SHA = "0123456789abcdef".repeat(4);
const SCHEDULED = "2026-09-10T09:00:00.000Z";
const ORIGIN: LaunchOrigin = { kind: "schedule", jobId: "schedule-fixture", scheduledAt: SCHEDULED, behaviourHash: "abcdef012345" };
const ID = occurrenceIdOf(ORIGIN);
const CORRELATION = correlationIdOf(ID, 1);
const RECORD_RUN: RunSpec = { timeoutMinutes: 7, access: "review" };
const CALLER_RUN: RunSpec = { timeoutMinutes: 5, access: "read-only" };
const SCHEDULER_ID = "occ-fixture-1";

/** `2026-09-10T09:00:<s>.000Z`. */
const at = (s: number): string => `2026-09-10T09:00:${String(s).padStart(2, "0")}.000Z`;

/** A good wrapper run's exit facts; each test spoils one thing. */
function facts(over: Partial<ExitFacts> = {}): ExitFacts {
  return {
    ending: { kind: "exited", code: 0 },
    verdict: { kind: "ok" },
    usageLimit: false,
    permissionDenials: 0,
    answer: { path: "/scratch/launches/o/x/a1/answer.md", bytes: 42, sha256: SHA, usable: true },
    transcript: "/scratch/launches/o/x/a1/transcript.ndjson",
    ...over,
  };
}

/* ------------------------------------------------------------------ *
 * Journal lines, as the protocol writes them.
 * ------------------------------------------------------------------ */

type Line = Record<string, unknown>;

const planned = (s: number, options: { origin?: LaunchOrigin; launcherKind?: LauncherKind; run?: RunSpec | null } = {}): Line => {
  const origin = options.origin ?? ORIGIN;
  const launcherKind = options.launcherKind ?? "tmux-headless";
  return {
    v: 1,
    kind: "planned",
    occurrenceId: occurrenceIdOf(origin),
    at: at(s),
    origin,
    material: { sha256: SHA, bytes: 120 },
    launcherKind,
    run: options.run === undefined ? (launcherKind === "tmux" ? null : RECORD_RUN) : options.run,
    admissionClass: "claude-session",
  };
};
const line = (kind: string, s: number, more: Line = {}, id: LaunchOccurrenceId = ID): Line => ({ v: 1, kind, occurrenceId: id, at: at(s), ...more });
const waiting = (s: number) => line("waiting-admission", s, { why: "the one claude-session slot is held" });
const reserved = (s: number, id: LaunchOccurrenceId = ID) => line("reserved", s, { reservationKey: reservationKeyOf(id), slot: "slot-1", ownerId: "owner-fixture", how: "granted" }, id);
const launching = (s: number, id: LaunchOccurrenceId = ID) => line("launching", s, { attempt: 1, correlationId: correlationIdOf(id, 1) }, id);
const running = (s: number) => line("observed-running", s, { attempt: 1, evidence: { kind: "tmux-session", sessionId: "$7" } });
const completedExit = (s: number, f: ExitFacts = facts()) => line("completed", s, { attempt: 1, evidence: { kind: "exit-record", ...f } });
const completedReboot = (s: number) => line("completed", s, { attempt: 1, evidence: { kind: "rebooted", recordedBootId: "boot-one", currentBootId: "boot-two" } });
const unknown = (s: number) => line("outcome-unknown", s, { attempt: 1, why: "no start.json and no session", looked: ["no exit.json"] });
const refused = (s: number) => line("failed-before-launch", s, { attempt: null, proof: "admission-refused", why: "the owner said no" });
const released = (s: number, state: "completed" | "failed-before-launch") => line("released", s, { licence: { kind: "terminal", state }, ownerSaid: "released" });
const disposed = (s: number) => line("disposed", s, { actor: "greg", requestId: "request-fixture-1", decision: "ended", why: "Greg checked the box" });

/** The record the protocol's own fold makes of these lines — refusing, loudly, a history it would call lost. */
function recordOf(lines: readonly Line[], id: LaunchOccurrenceId = ID): LaunchRecord {
  const { fold, status } = replayJournal(lines.map((l) => JSON.stringify(l)));
  if (status.kind !== "whole") throw new Error(`the fixture journal is not one the protocol accepts: ${status.why}`);
  const record = fold.occurrences.get(id);
  if (record === undefined) throw new Error(`the fold has no ${id}`);
  return record;
}

/* ------------------------------------------------------------------ *
 * exit.json, written and read by the protocol's own functions.
 * ------------------------------------------------------------------ */

function exitDir(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-observed-launch-"));
  roots.push(root);
  const dir = join(root, "a1");
  mkdirSync(dir);
  return dir;
}

function readExit(text: string): ArtefactRead<ExitRecord> {
  const dir = exitDir();
  writeFileSync(join(dir, EXIT_FILE), text);
  return readArtefacts(dir, CORRELATION).exit;
}

const exitText = (f: ExitFacts, s = 30): string => artefactText({ v: 1, kind: "exit", correlationId: CORRELATION, at: at(s), ...f });

function observe(record: LaunchRecord, exit: ArtefactRead<ExitRecord> | null = null): ObservedLaunch {
  const result = observedOf(record, { exit, run: CALLER_RUN, schedulerOccurrenceId: SCHEDULER_ID });
  if ("kind" in result && result.kind === "not-schedule") throw new Error(`not a schedule record: ${result.why}`);
  return result as ObservedLaunch;
}

describe("the fields every state carries", () => {
  test("identity from the origin, times and attempts from the record, the scheduler key from the caller", () => {
    const o = observe(recordOf([planned(1), reserved(2), launching(3)]));
    expect(o).toMatchObject({
      launchOccurrenceId: ID,
      schedulerOccurrenceId: SCHEDULER_ID,
      jobId: "schedule-fixture",
      scheduledAt: SCHEDULED,
      behaviourHash: "abcdef012345",
      plannedAt: at(1),
      updatedAt: at(3),
      attempts: 1,
    });
  });

  test("the run spec is the record's — what actually launched — not the caller's", () => {
    expect(observe(recordOf([planned(1)])).run).toEqual(RECORD_RUN);
  });

  test("a tmux launch pins no run spec, so the caller's is used", () => {
    expect(observe(recordOf([planned(1, { launcherKind: "tmux" })])).run).toEqual(CALLER_RUN);
  });

  test("a recovery origin is not a schedule row", () => {
    const origin = recoveryOrigin("candidate-fixture-1");
    const record = recordOf([planned(1, { origin })], occurrenceIdOf(origin));
    const result = observedOf(record, { exit: null, run: CALLER_RUN, schedulerOccurrenceId: SCHEDULER_ID });
    expect(result).toMatchObject({ kind: "not-schedule" });
    if ("why" in result) expect(result.why).toContain("recovery");
  });
});

describe("each of the eight states", () => {
  test("planned", () => {
    expect(observe(recordOf([planned(1)])).state).toEqual({ kind: "planned" });
  });

  test("waiting-admission carries the owner's reason", () => {
    expect(observe(recordOf([planned(1), waiting(2)])).state).toEqual({ kind: "waiting-admission", why: "the one claude-session slot is held" });
  });

  test("reserved", () => {
    expect(observe(recordOf([planned(1), reserved(2)])).state).toEqual({ kind: "reserved" });
  });

  test("launching carries its attempt", () => {
    expect(observe(recordOf([planned(1), reserved(2), launching(3)])).state).toEqual({ kind: "launching", attempt: 1 });
  });

  test("observed-running carries its attempt", () => {
    expect(observe(recordOf([planned(1), reserved(2), launching(3), running(4)])).state).toEqual({ kind: "observed-running", attempt: 1 });
  });

  test("outcome-unknown carries the protocol's why", () => {
    expect(observe(recordOf([planned(1), reserved(2), launching(3), unknown(4)])).state).toEqual({ kind: "outcome-unknown", attempt: 1, why: "no start.json and no session" });
  });

  test("failed-before-launch carries its proof, its why and its endedAt", () => {
    expect(observe(recordOf([planned(1), refused(2)])).state).toEqual({ kind: "failed-before-launch", attempt: null, proof: "admission-refused", why: "the owner said no", endedAt: at(2) });
  });

  test("completed with an exit record carries the journal's facts and its endedAt", () => {
    const state = observe(recordOf([planned(1), reserved(2), launching(3), completedExit(5)])).state;
    expect(state).toEqual({ kind: "completed", attempt: 1, evidence: { kind: "exit-record", ...facts() }, endedAt: at(5) });
  });

  test("completed by a reboot", () => {
    expect(observe(recordOf([planned(1), reserved(2), launching(3), completedReboot(5)])).state).toEqual({ kind: "completed", attempt: 1, evidence: { kind: "rebooted" }, endedAt: at(5) });
  });

  test("and the classifier reads the good completed record as succeeded — the positive control", () => {
    const record = recordOf([planned(1), reserved(2), launching(3), completedExit(5)]);
    expect(classifyOccurrence(observe(record, readExit(exitText(facts())))).kind).toBe("succeeded");
  });
});

describe("endedAt, not updatedAt, dates an ending", () => {
  test("a completed record released later is dated by its completion", () => {
    const record = recordOf([planned(1), reserved(2), launching(3), completedExit(5), released(40, "completed")]);
    expect(record.updatedAt).toBe(at(40));
    const result = classifyOccurrence(observe(record));
    expect(result.kind).toBe("succeeded");
    expect(result.at).toBe(at(5));
  });

  test("a failed-before-launch record released later is dated by its failure", () => {
    const record = recordOf([planned(1), reserved(2), line("failed-before-launch", 4, { attempt: null, proof: "material-mismatch", why: "material.txt moved" }), released(40, "failed-before-launch")]);
    expect(record.updatedAt).toBe(at(40));
    expect(classifyOccurrence(observe(record)).at).toBe(at(4));
  });
});

describe("the tmux session", () => {
  test.each([
    ["launching", [planned(1), reserved(2), launching(3)]],
    ["observed-running", [planned(1), reserved(2), launching(3), running(4)]],
  ] as const)("is the correlation id while %s", (_name, lines) => {
    expect(observe(recordOf(lines)).tmuxSession).toBe(CORRELATION);
  });

  test.each([
    ["planned", [planned(1)]],
    ["reserved", [planned(1), reserved(2)]],
    ["outcome-unknown", [planned(1), reserved(2), launching(3), unknown(4)]],
    ["completed", [planned(1), reserved(2), launching(3), completedExit(5)]],
  ] as const)("is null when %s", (_name, lines) => {
    expect(observe(recordOf(lines)).tmuxSession).toBeNull();
  });

  test.each(["headless", "tmux"] as const)("is null for a %s launch, whose session is not named after the correlation id", (launcherKind) => {
    const lines = [planned(1, { launcherKind }), reserved(2), launching(3)];
    expect(observe(recordOf(lines)).tmuxSession).toBeNull();
  });
});

describe("the answer and the transcript", () => {
  test("come from a completed exit record, with the attempt that wrote them", () => {
    const o = observe(recordOf([planned(1), reserved(2), launching(3), completedExit(5)]));
    expect(o.answer).toEqual({ kind: "present", attempt: 1, bytes: 42, sha256: SHA, usable: true });
    expect(o.transcriptPath).toBe("/scratch/launches/o/x/a1/transcript.ndjson");
  });

  test("an exit record with no answer is absent", () => {
    const o = observe(recordOf([planned(1), reserved(2), launching(3), completedExit(5, facts({ answer: null, transcript: null }))]));
    expect(o.answer).toEqual({ kind: "absent" });
    expect(o.transcriptPath).toBeNull();
  });

  test("a reboot has none", () => {
    const o = observe(recordOf([planned(1), reserved(2), launching(3), completedReboot(5)]));
    expect(o.answer).toEqual({ kind: "absent" });
    expect(o.transcriptPath).toBeNull();
  });

  test("an exit.json the journal has not folded yet does not end a running occurrence", () => {
    const o = observe(recordOf([planned(1), reserved(2), launching(3), running(4)]), readExit(exitText(facts())));
    expect(o.state.kind).toBe("observed-running");
    expect(o.answer).toEqual({ kind: "absent" });
    expect(classifyOccurrence(o).kind).toBe("running");
  });
});

describe("the attempt's exit.json must confirm the journal's copy", () => {
  const record = () => recordOf([planned(1), reserved(2), launching(3), completedExit(5)]);

  test("an identical exit.json confirms it", () => {
    expect(observe(record(), readExit(exitText(facts()))).state).toMatchObject({ evidence: { kind: "exit-record" } });
  });

  test("an unreadable exit.json is never a success: failed, with the reader's reason, and no answer", () => {
    const exit = readExit("{ this is not json");
    expect(exit.kind).toBe("unreadable");
    const o = observe(record(), exit);
    expect(o.state).toMatchObject({ kind: "completed", evidence: { kind: "exit-unconfirmed" } });
    expect(o.answer).toEqual({ kind: "absent" });
    const result = classifyOccurrence(o);
    expect(result.kind).toBe("failed");
    expect(result.why).toContain("not JSON");
  });

  test("an exit.json saying something else than the journal is failed, never either one's success", () => {
    const o = observe(record(), readExit(exitText(facts({ answer: { path: "/scratch/other.md", bytes: 42, sha256: SHA, usable: true } }))));
    expect(o.state).toMatchObject({ evidence: { kind: "exit-unconfirmed" } });
    expect(classifyOccurrence(o).kind).toBe("failed");
  });

  test("an absent exit.json leaves the journal's copy standing — the journal is the ledger", () => {
    const dir = exitDir();
    const exit = readArtefacts(dir, CORRELATION).exit;
    expect(exit.kind).toBe("absent");
    expect(classifyOccurrence(observe(record(), exit)).kind).toBe("succeeded");
  });
});

describe("the disposition", () => {
  test("is carried, reduced to decision, why and when", () => {
    const o = observe(recordOf([planned(1), reserved(2), launching(3), running(4), disposed(9)]));
    expect(o.disposition).toEqual({ decision: "ended", why: "Greg checked the box", at: at(9) });
    expect(o.state.kind).toBe("observed-running");
    expect(classifyOccurrence(o)).toMatchObject({ kind: "interrupted", at: at(9) });
  });

  test("is null when nobody disposed of it", () => {
    expect(observe(recordOf([planned(1)])).disposition).toBeNull();
  });
});
