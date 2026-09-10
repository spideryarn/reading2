/**
 * **The one parser of `occurrences.json`** — plan 260910f-scheduled-dispatch § D7.
 *
 * The daemon, the fleet route and the browser read the file through
 * `tools/fleet/occurrences-parse.ts`. What these tests pin down, each red first:
 *
 * - **it never throws**;
 * - **a state, result kind or `next` kind this build does not know is that
 *   ROW's own `unreadable` arm** — an occurrence row for a state or a result, a
 *   job row for a `next` — never the whole file, and never a different kind;
 * - **a known state paired with a result the classifier never gives it** is an
 *   unreadable row too: `succeeded` on a running launch is exactly the lie D6
 *   exists to stop;
 * - **a top-level field it cannot read makes the file `unreadable`**, and a
 *   schema it does not read is its own answer;
 * - **instants are range-checked**, not just finiteness-checked.
 *
 * No id in this file is a uuid (`tests/fixture-ids.test.ts`).
 */
import { describe, expect, test } from "vitest";

import { LAUNCH_OCCURRENCE_ID, OCCURRENCES_SCHEMA, parseOccurrencesFile } from "../tools/fleet/occurrences-parse.js";
import type { ScheduledOccurrence, ScheduledOccurrencesFile, ScheduledOccurrencesJob } from "../tools/fleet/wire.js";

const SUCCEEDED: ScheduledOccurrence = {
  launchOccurrenceId: "lo-0123456789abcdef0123",
  schedulerOccurrenceId: "parse-occ-job@2026-09-10T11:00:00.000Z#465648545712",
  scheduledAt: "2026-09-10T11:00:00.000Z",
  behaviourHash: "465648545712",
  plannedAt: "2026-09-10T11:00:01.000Z",
  updatedAt: "2026-09-10T11:03:00.000Z",
  attempts: 1,
  state: "completed",
  run: { timeoutMinutes: 5, access: "read-only", account: "pool-a" },
  result: { kind: "succeeded", why: "exit 0, a usable answer, no denials", at: "2026-09-10T11:03:00.000Z" },
  answer: { kind: "present", attempt: 1, bytes: 21, sha256: "0123456789abcdef".repeat(4), usable: true },
  transcriptPath: "/scratch/launches/o/lo-0123456789abcdef0123/a1/transcript.ndjson",
  tmuxSession: null,
  commands: { cancel: null, dispose: null },
};

const UNKNOWN: ScheduledOccurrence = {
  ...SUCCEEDED,
  launchOccurrenceId: "lo-aaaaaaaaaaaaaaaaaaaa",
  schedulerOccurrenceId: "parse-occ-job@2026-09-09T11:00:00.000Z#465648545712",
  scheduledAt: "2026-09-09T11:00:00.000Z",
  state: "outcome-unknown",
  result: { kind: "unknown", why: "the launcher may have run and nothing recorded what it did", at: "2026-09-09T11:05:00.000Z" },
  answer: { kind: "absent" },
  transcriptPath: null,
  commands: { cancel: null, dispose: "npx tsx scripts/overseer-launches.ts dispose lo-aaaaaaaaaaaaaaaaaaaa" },
};

const JOB: ScheduledOccurrencesJob = {
  jobId: "parse-occ-job",
  dispatch: { kind: "live" },
  run: { timeoutMinutes: 5, access: "read-only" },
  next: { kind: "next-due", at: "2026-09-11T11:00:00.000Z" },
  occurrences: [SUCCEEDED, UNKNOWN],
  omitted: 3,
};

const SECOND: ScheduledOccurrencesJob = {
  jobId: "parse-occ-second",
  dispatch: { kind: "dry-run", why: "a fixture" },
  run: { timeoutMinutes: 30, access: "write" },
  next: { kind: "none", why: "not authorised" },
  occurrences: [],
  omitted: 0,
};

const FILE: ScheduledOccurrencesFile = {
  schema: 1,
  writtenAt: "2026-09-10T12:00:00.000Z",
  instanceId: "parse-occ-instance",
  journal: { kind: "whole" },
  jobs: [JOB, SECOND],
};

/** A deep copy the test may vandalise. */
function copy(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(FILE)) as Record<string, unknown>;
}

function jobsOf(value: Record<string, unknown>): Record<string, unknown>[] {
  return value["jobs"] as Record<string, unknown>[];
}

function occurrencesOf(value: Record<string, unknown>, job = 0): Record<string, unknown>[] {
  return (jobsOf(value)[job] as Record<string, unknown>)["occurrences"] as Record<string, unknown>[];
}

function parsed(value: unknown) {
  const answer = parseOccurrencesFile(value);
  if (answer.kind !== "parsed") throw new Error(`expected a parsed file, got ${JSON.stringify(answer)}`);
  return answer.file;
}

describe("a file the daemon wrote reads back as exactly what it wrote", () => {
  test("every field survives, each job is a job row and each occurrence an occurrence row", () => {
    const file = parsed(copy());
    expect(file.schema).toBe(OCCURRENCES_SCHEMA);
    expect(file.writtenAt).toBe(FILE.writtenAt);
    expect(file.instanceId).toBe(FILE.instanceId);
    expect(file.journal).toEqual({ kind: "whole" });
    expect(file.jobs).toEqual([
      { kind: "job", job: { ...JOB, occurrences: [{ kind: "occurrence", occurrence: SUCCEEDED }, { kind: "occurrence", occurrence: UNKNOWN }] } },
      { kind: "job", job: { ...SECOND, occurrences: [] } },
    ]);
  });

  test("the journal's two standings that may be missing launches are read with their reasons", () => {
    for (const journal of [
      { kind: "history-lost", why: "a line of the journal is torn" },
      { kind: "not-open", why: "the journal is held by another process" },
    ]) {
      const value = copy();
      value["journal"] = journal;
      expect(parsed(value).journal).toEqual(journal);
    }
  });

  test("the launch id shape is the protocol's: lo- and twenty hex", () => {
    expect(LAUNCH_OCCURRENCE_ID.test("lo-0123456789abcdef0123")).toBe(true);
    for (const bad of ["lo-0123456789abcdef012", "lo-0123456789ABCDEF0123", "lo-0123456789abcdef0123/..", "../lo-0123456789abcdef0123", ""]) {
      expect(LAUNCH_OCCURRENCE_ID.test(bad), bad).toBe(false);
    }
  });
});

describe("what it does not know, it says it does not know — per row", () => {
  test("A STATE THIS BUILD DOES NOT KNOW makes that occurrence row unreadable, and only that row", () => {
    const value = copy();
    (occurrencesOf(value)[0] as Record<string, unknown>)["state"] = "paused-by-greg";
    const file = parsed(value);
    const job = file.jobs[0];
    if (job?.kind !== "job") throw new Error("expected the job row to survive");
    expect(job.job.occurrences[0]).toEqual({ kind: "unreadable", launchOccurrenceId: SUCCEEDED.launchOccurrenceId, why: expect.stringContaining("paused-by-greg") });
    // THE NEXT ROW, THE JOB AND THE OTHER JOB ARE UNTOUCHED.
    expect(job.job.occurrences[1]).toEqual({ kind: "occurrence", occurrence: UNKNOWN });
    expect(job.job.omitted).toBe(3);
    expect(file.jobs[1]?.kind).toBe("job");
  });

  test("a result kind it does not know is an unreadable occurrence row, never mapped to another kind", () => {
    const value = copy();
    (occurrencesOf(value)[0] as Record<string, unknown>)["result"] = { kind: "partly-succeeded", why: "w", at: null };
    const job = parsed(value).jobs[0];
    if (job?.kind !== "job") throw new Error("expected the job row");
    expect(job.job.occurrences[0]).toEqual({ kind: "unreadable", launchOccurrenceId: SUCCEEDED.launchOccurrenceId, why: expect.stringContaining("partly-succeeded") });
  });

  test("a known result the classifier never gives that state is an unreadable row — `succeeded` on a running launch above all", () => {
    for (const state of ["planned", "reserved", "waiting-admission", "launching", "observed-running", "outcome-unknown", "failed-before-launch"]) {
      const value = copy();
      (occurrencesOf(value)[0] as Record<string, unknown>)["state"] = state;
      const job = parsed(value).jobs[0];
      if (job?.kind !== "job") throw new Error("expected the job row");
      expect(job.job.occurrences[0]?.kind, state).toBe("unreadable");
    }
  });

  test("a disposed open launch reads as interrupted, which the classifier does give it", () => {
    for (const state of ["launching", "observed-running", "outcome-unknown"]) {
      const value = copy();
      const occurrence = occurrencesOf(value)[0] as Record<string, unknown>;
      occurrence["state"] = state;
      occurrence["result"] = { kind: "interrupted", why: "disposed by Greg with no exit record", at: "2026-09-10T11:04:00.000Z" };
      const job = parsed(value).jobs[0];
      if (job?.kind !== "job") throw new Error("expected the job row");
      expect(job.job.occurrences[0]?.kind, state).toBe("occurrence");
    }
  });

  test("SUPERSEDED IS READ ONLY ON failed-before-launch, and as an ending it carries an instant (M13)", () => {
    const superseded = { kind: "superseded", why: "superseded by fedcba987654", at: "2026-09-10T11:04:00.000Z" };
    const ok = copy();
    const row = occurrencesOf(ok)[0] as Record<string, unknown>;
    row["state"] = "failed-before-launch";
    row["result"] = superseded;
    row["answer"] = { kind: "absent" };
    const okJob = parsed(ok).jobs[0];
    if (okJob?.kind !== "job") throw new Error("expected the job row");
    expect(okJob.job.occurrences[0]).toMatchObject({ kind: "occurrence", occurrence: { state: "failed-before-launch", result: superseded } });

    for (const state of ["planned", "reserved", "waiting-admission", "launching", "observed-running", "outcome-unknown", "completed"]) {
      const value = copy();
      const other = occurrencesOf(value)[0] as Record<string, unknown>;
      other["state"] = state;
      other["result"] = superseded;
      other["answer"] = { kind: "absent" };
      const job = parsed(value).jobs[0];
      if (job?.kind !== "job") throw new Error("expected the job row");
      expect(job.job.occurrences[0]?.kind, state).toBe("unreadable");
    }

    const undated = copy();
    const noInstant = occurrencesOf(undated)[0] as Record<string, unknown>;
    noInstant["state"] = "failed-before-launch";
    noInstant["result"] = { ...superseded, at: null };
    noInstant["answer"] = { kind: "absent" };
    const undatedJob = parsed(undated).jobs[0];
    if (undatedJob?.kind !== "job") throw new Error("expected the job row");
    expect(undatedJob.job.occurrences[0]?.kind).toBe("unreadable");
  });

  test("result instants follow the classifier: open rows have none, unknown and endings have one", () => {
    const pendingWithEnding = copy();
    const pending = occurrencesOf(pendingWithEnding)[0] as Record<string, unknown>;
    pending["state"] = "planned";
    pending["result"] = { kind: "pending", why: "planned", at: "2026-09-10T11:03:00.000Z" };

    const unknownWithoutReading = copy();
    const unknown = occurrencesOf(unknownWithoutReading)[0] as Record<string, unknown>;
    unknown["state"] = "outcome-unknown";
    unknown["result"] = { kind: "unknown", why: "cannot tell", at: null };

    const successWithoutEnding = copy();
    (occurrencesOf(successWithoutEnding)[0] as Record<string, unknown>)["result"] = { kind: "succeeded", why: "ok", at: null };

    for (const value of [pendingWithEnding, unknownWithoutReading, successWithoutEnding]) {
      const job = parsed(value).jobs[0];
      if (job?.kind !== "job") throw new Error("expected the job row");
      expect(job.job.occurrences[0]?.kind).toBe("unreadable");
    }
  });

  test("succeeded requires the usable non-empty answer of an existing attempt", () => {
    const answers: unknown[] = [
      { kind: "absent" },
      { ...SUCCEEDED.answer, usable: false },
      { ...SUCCEEDED.answer, bytes: 0 },
      { ...SUCCEEDED.answer, attempt: 2 },
    ];
    for (const answer of answers) {
      const value = copy();
      (occurrencesOf(value)[0] as Record<string, unknown>)["answer"] = answer;
      const job = parsed(value).jobs[0];
      if (job?.kind !== "job") throw new Error("expected the job row");
      expect(job.job.occurrences[0]?.kind, JSON.stringify(answer)).toBe("unreadable");
    }
  });

  test("an unknown access or answer kind is an unreadable occurrence row", () => {
    const access = copy();
    (occurrencesOf(access)[0] as Record<string, unknown>)["run"] = { timeoutMinutes: 5, access: "root" };
    const answer = copy();
    (occurrencesOf(answer)[0] as Record<string, unknown>)["answer"] = { kind: "streamed" };
    for (const value of [access, answer]) {
      const job = parsed(value).jobs[0];
      if (job?.kind !== "job") throw new Error("expected the job row");
      expect(job.job.occurrences[0]?.kind).toBe("unreadable");
    }
  });

  test("AN OCCURRENCE'S RUN SPEC NAMES ITS POOL ACCOUNT: a handle or null, never missing or malformed", () => {
    const tmux = copy();
    (occurrencesOf(tmux)[0] as Record<string, unknown>)["run"] = { timeoutMinutes: 5, access: "read-only", account: null };
    const tmuxJob = parsed(tmux).jobs[0];
    if (tmuxJob?.kind !== "job") throw new Error("expected the job row");
    expect(tmuxJob.job.occurrences[0]).toMatchObject({ kind: "occurrence", occurrence: { run: { timeoutMinutes: 5, access: "read-only", account: null } } });

    for (const run of [
      { timeoutMinutes: 5, access: "read-only" },
      { timeoutMinutes: 5, access: "read-only", account: "Pool A" },
      { timeoutMinutes: 5, access: "read-only", account: "-pool" },
      { timeoutMinutes: 5, access: "read-only", account: 7 },
      { timeoutMinutes: 5, access: "read-only", account: "" },
    ]) {
      const value = copy();
      (occurrencesOf(value)[0] as Record<string, unknown>)["run"] = run;
      const job = parsed(value).jobs[0];
      if (job?.kind !== "job") throw new Error("expected the job row");
      expect(job.job.occurrences[0], JSON.stringify(run)).toEqual({ kind: "unreadable", launchOccurrenceId: SUCCEEDED.launchOccurrenceId, why: expect.stringContaining("account") });
      /* ONLY THAT ROW. */
      expect(job.job.occurrences[1]?.kind).toBe("occurrence");
    }
  });

  test("a JOB's run spec names no account — its authority has none — and one written there is not read back", () => {
    const value = copy();
    (jobsOf(value)[0] as Record<string, unknown>)["run"] = { timeoutMinutes: 5, access: "read-only", account: "pool-a" };
    const job = parsed(value).jobs[0];
    if (job?.kind !== "job") throw new Error("expected the job row");
    expect(job.job.run).toEqual({ timeoutMinutes: 5, access: "read-only" });
  });

  test("a present answer without the sha256 it was judged on — missing, short, upper-case, not a string — is an unreadable occurrence row", () => {
    const good = "0123456789abcdef".repeat(4);
    for (const sha256 of [undefined, good.slice(1), good.toUpperCase(), `${good}0`, 42, null]) {
      const value = copy();
      const answer = { kind: "present", attempt: 1, bytes: 21, usable: true, ...(sha256 === undefined ? {} : { sha256 }) };
      (occurrencesOf(value)[0] as Record<string, unknown>)["answer"] = answer;
      const job = parsed(value).jobs[0];
      if (job?.kind !== "job") throw new Error("expected the job row");
      expect(job.job.occurrences[0], String(sha256)).toEqual({ kind: "unreadable", launchOccurrenceId: SUCCEEDED.launchOccurrenceId, why: expect.stringContaining("sha256") });
      /* ONLY THAT ROW. */
      expect(job.job.occurrences[1]?.kind).toBe("occurrence");
    }
  });

  test("an occurrence row whose launch id is not the protocol's shape is unreadable, and carries no id to link", () => {
    const value = copy();
    (occurrencesOf(value)[0] as Record<string, unknown>)["launchOccurrenceId"] = "../../etc/passwd";
    const job = parsed(value).jobs[0];
    if (job?.kind !== "job") throw new Error("expected the job row");
    expect(job.job.occurrences[0]).toEqual({ kind: "unreadable", launchOccurrenceId: null, why: expect.any(String) });
  });

  test("A NEXT KIND IT DOES NOT KNOW makes that JOB row unreadable, naming the job, and leaves the other job", () => {
    const value = copy();
    (jobsOf(value)[0] as Record<string, unknown>)["next"] = { kind: "whenever" };
    const file = parsed(value);
    expect(file.jobs[0]).toEqual({ kind: "unreadable", jobId: "parse-occ-job", why: expect.stringContaining("whenever") });
    expect(file.jobs[1]?.kind).toBe("job");
  });

  test("a job row with no id, or an omitted count that is not a count, is an unreadable job row", () => {
    const value = copy();
    delete (jobsOf(value)[0] as Record<string, unknown>)["jobId"];
    (jobsOf(value)[1] as Record<string, unknown>)["omitted"] = -1;
    const file = parsed(value);
    expect(file.jobs[0]).toEqual({ kind: "unreadable", jobId: null, why: expect.any(String) });
    expect(file.jobs[1]).toEqual({ kind: "unreadable", jobId: "parse-occ-second", why: expect.stringContaining("omitted") });
  });
});

describe("the file as a whole", () => {
  test("a schema this build does not read is its own answer, with both numbers and a reason", () => {
    const value = copy();
    value["schema"] = 2;
    expect(parseOccurrencesFile(value)).toEqual({ kind: "unsupported-schema", saw: 2, known: 1, why: expect.stringContaining("2") });
  });

  test("anything that is not an occurrences file is unreadable, with a reason, and nothing throws", () => {
    for (const json of [null, 42, "occurrences", [], {}, { schema: "1" }]) {
      const answer = parseOccurrencesFile(json);
      expect(answer.kind).toBe("unreadable");
      if (answer.kind === "unreadable") expect(answer.why.length).toBeGreaterThan(0);
    }
  });

  test("a top-level field it cannot read makes the FILE unreadable — a journal kind it does not know included", () => {
    const journal = copy();
    journal["journal"] = { kind: "half-open", why: "w" };
    const instance = copy();
    instance["instanceId"] = "  ";
    const jobs = copy();
    jobs["jobs"] = "none";
    for (const value of [journal, instance, jobs]) expect(parseOccurrencesFile(value).kind).toBe("unreadable");
  });
});

describe("instants are range-checked, not just finiteness-checked", () => {
  test("writtenAt that is a finite number, past Date's range or not canonical ISO makes the file unreadable", () => {
    for (const writtenAt of [1e300, "+275760-09-13T00:00:00.001Z", "2026-09-10", "tomorrow"]) {
      const value = copy();
      value["writtenAt"] = writtenAt;
      expect(parseOccurrencesFile(value).kind, String(writtenAt)).toBe("unreadable");
    }
  });

  test("an occurrence instant out of range makes that occurrence row unreadable; a result `at` may be null", () => {
    const value = copy();
    (occurrencesOf(value)[0] as Record<string, unknown>)["plannedAt"] = "+275760-09-13T00:00:00.001Z";
    const job = parsed(value).jobs[0];
    if (job?.kind !== "job") throw new Error("expected the job row");
    expect(job.job.occurrences.map((row) => row.kind)).toEqual(["unreadable", "occurrence"]);

    const pending = copy();
    const occurrence = occurrencesOf(pending)[0] as Record<string, unknown>;
    occurrence["state"] = "planned";
    occurrence["result"] = { kind: "pending", why: "planned, not yet reserved", at: null };
    const pendingJob = parsed(pending).jobs[0];
    if (pendingJob?.kind !== "job") throw new Error("expected the job row");
    expect(pendingJob.job.occurrences[0]?.kind).toBe("occurrence");
  });

  test("a next instant out of range makes the job row unreadable", () => {
    const value = copy();
    (jobsOf(value)[0] as Record<string, unknown>)["next"] = { kind: "next-due", at: "+275760-09-13T00:00:00.001Z" };
    expect(parsed(value).jobs.map((row) => row.kind)).toEqual(["unreadable", "job"]);
  });
});
