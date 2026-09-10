/**
 * **The schedule preview: what the scheduler would run next, when, under which
 * pin, and why not — before anybody arms it.** Plan 260910e § D1, D6, D7.
 *
 * `schedulePreview` is pure and makes no decisions of its own: every verdict is
 * the shared planner's (`schedule-plan.ts`), so what these tests pin down is the
 * TRANSLATION — each `JobPlan` kind becoming a row that says the right thing,
 * with an absolute instant or an explicit reason where there is none — and the
 * file around it: written atomically by the daemon each checkpoint, read back
 * through the one parser, and printed by `overseer status`.
 *
 * Every store root is a temp directory; `~/.overseer` is never touched, and no
 * id in this file is a uuid (`tests/fixture-ids.test.ts`).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { repoRoot, schedulerWiring } from "../scripts/overseer.js";
import { parseSchedulePreview } from "../tools/fleet/schedule-parse.js";
import type { SchedulePreview, SchedulePreviewJob } from "../tools/fleet/wire.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import { runOverseer } from "../tools/overseer/daemon.js";
import {
  behaviourHash,
  occurrenceId,
  type Arming,
  type AuthorisedJob,
  type BehaviourHash,
  type JobBehaviour,
  type JobDocument,
  type Occurrence,
  type OccurrenceHistory,
  type OccurrenceId,
  type OccurrenceIndex,
  type OccurrenceKey,
} from "../tools/overseer/jobs.js";
import { ruleJobs } from "../tools/overseer/rule-jobs.js";
import { evidenceAsBuilt, planJobs, type DocumentEvidence } from "../tools/overseer/schedule-plan.js";
import {
  listRevision,
  MISSED_RUN_POLICY,
  readSchedulePreviewFile,
  SCHEDULE_PREVIEW_FILE,
  schedulePreview,
  schedulePreviewLines,
  writeSchedulePreview,
} from "../tools/overseer/schedule-preview.js";
import type { HeldCapabilities } from "../tools/overseer/scheduler.js";
import { hours, minutes } from "../tools/overseer/schedules.js";
import { standingJobs } from "../tools/overseer/standing-jobs.js";
import { EVENTS_FILE } from "../tools/overseer/store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-schedule-preview-test-"));
  roots.push(root);
  return root;
}

const NOW = new Date("2026-09-10T12:00:00.000Z");
const at = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString();
const ARMED_LONG_AGO: Arming = { kind: "armed", at: "2026-09-01T00:00:00.000Z" };
const DISARMED: Arming = { kind: "unknown", why: "this daemon is not armed, so there is no arming instant to measure a first run from" };
const ALL: HeldCapabilities = { session: true, rules: true };
const NONE: HeldCapabilities = { session: false, rules: false };

const DOC: JobDocument = { path: "docs/fixture/preview-test-job.md", sha256: "a".repeat(64) };

function sessionJob(
  id: string,
  options: { dispatch?: JobBehaviour["dispatch"]; everyMs?: number; leaseMs?: number; initialDelayMs?: number } = {},
): AuthorisedJob {
  const behaviour: JobBehaviour = { id, what: `run ${id}`, documents: [DOC], work: { kind: "session" }, dispatch: options.dispatch ?? { kind: "live" } };
  return {
    definition: {
      behaviour,
      schedule: { everyMs: options.everyMs ?? hours(3), leaseMs: options.leaseMs ?? hours(1), initialDelayMs: options.initialDelayMs ?? 0 },
    },
    authorisedHash: behaviourHash(behaviour),
    authorisedDocuments: [DOC],
  };
}

function ruleJob(id: string): AuthorisedJob {
  const behaviour: JobBehaviour = {
    id,
    what: `look for ${id}`,
    documents: [],
    work: { kind: "rule", rule: { kind: "wedged-work", minAgeSeconds: 60, policy: "safe-to-kill", disposition: "propose" } },
    dispatch: { kind: "live" },
  };
  return {
    definition: { behaviour, schedule: { everyMs: minutes(15), leaseMs: minutes(2), initialDelayMs: 0 } },
    authorisedHash: behaviourHash(behaviour),
    authorisedDocuments: [],
  };
}

/** The key every hand-built occurrence gets. The hash is for audit only — `lastRunOf` goes by job id. */
function keyed(jobId: string, scheduledAt: string): { id: OccurrenceId; key: OccurrenceKey } {
  const key: OccurrenceKey = { jobId, scheduledAt, behaviourHash: "0123456789ab" as BehaviourHash };
  return { id: occurrenceId(key), key };
}

const base = { instanceId: "preview-test-instance", what: "w" } as const;

const occurrences = {
  reserved: (jobId: string, reservedAt: string, leaseUntil: string): Occurrence => ({ kind: "reserved", ...keyed(jobId, reservedAt), ...base, reservedAt, leaseUntil }),
  started: (jobId: string, reservedAt: string, leaseUntil: string, pid: number): Occurrence => ({
    kind: "started",
    ...keyed(jobId, reservedAt),
    ...base,
    reservedAt,
    leaseUntil,
    startedAt: reservedAt,
    pid,
  }),
  finished: (jobId: string, reservedAt: string, finishedAt: string, code = 0): Occurrence => ({
    kind: "finished",
    ...keyed(jobId, reservedAt),
    ...base,
    reservedAt,
    finishedAt,
    outcome: { kind: "exited", code },
  }),
  refused: (jobId: string, reservedAt: string, why: string): Occurrence => ({ kind: "refused", ...keyed(jobId, reservedAt), ...base, reservedAt, refusedAt: reservedAt, why }),
  unknown: (jobId: string, reservedAt: string, why: string): Occurrence => ({
    kind: "unknown",
    ...keyed(jobId, reservedAt),
    ...base,
    reservedAt,
    why,
    source: { kind: "derived" },
  }),
};

function indexOf(...list: Occurrence[]): OccurrenceIndex {
  return new Map(list.map((one) => [one.id, one]));
}

type PreviewOverrides = {
  occurrences?: OccurrenceIndex;
  history?: OccurrenceHistory;
  arming?: Arming;
  launchSeparationMs?: number;
  capabilities?: HeldCapabilities;
  evidence?: DocumentEvidence;
  now?: Date;
};

function previewOf(definitions: readonly AuthorisedJob[], over: PreviewOverrides = {}): SchedulePreview {
  return schedulePreview({
    instanceId: "preview-test-instance",
    now: over.now ?? NOW,
    list: { kind: "given", definitions, listRevision: listRevision(definitions), evidence: over.evidence ?? evidenceAsBuilt(definitions) },
    occurrences: over.occurrences ?? new Map(),
    history: over.history ?? { kind: "intact" },
    arming: over.arming ?? ARMED_LONG_AGO,
    launchSeparationMs: over.launchSeparationMs ?? 0,
    capabilities: over.capabilities ?? ALL,
    headline: { kind: "armed", why: "a test", at: NOW.toISOString() },
  });
}

function only(preview: SchedulePreview, jobId: string): SchedulePreviewJob {
  const found = preview.jobs.filter((job) => job.jobId === jobId);
  if (found.length !== 1) throw new Error(`expected one row for ${jobId}, found ${found.length}`);
  return found[0] as SchedulePreviewJob;
}

describe("each verdict the planner can give becomes a row that says so", () => {
  test("history lost: every row held, the last attempt NOT KNOWN rather than `never`, and no next run", () => {
    const preview = previewOf([sessionJob("a"), ruleJob("r")], { history: { kind: "lost", why: "the log has a hole" } });
    for (const row of preview.jobs) {
      expect(row.verdict.kind).toBe("history-lost");
      expect(row.verdict.sentence).toContain("the log has a hole");
      expect(row.verdict.next.kind).toBe("none");
      // A LOST LEDGER READ AS "NEVER RUN" is C3 arriving through the preview.
      expect(row.lastAttempt.kind).toBe("not-known");
    }
    expect(preview.history).toEqual({ kind: "lost", why: "the log has a hole" });
  });

  test("a duplicate id: both definitions refused, with no next run", () => {
    const preview = previewOf([sessionJob("twin"), sessionJob("twin", { everyMs: hours(6) }), sessionJob("bystander")]);
    expect(preview.jobs.map((row) => `${row.jobId}:${row.verdict.kind}`)).toEqual(["twin:duplicate-id", "twin:duplicate-id", "bystander:dispatch"]);
    expect(preview.jobs[0]?.verdict.next).toEqual({ kind: "none", why: expect.stringContaining("share") });
  });

  test("a document edited since it was pinned: unauthorised, the drift named, and both digests on the row", () => {
    const job = sessionJob("edited");
    const evidence: DocumentEvidence = new Map([["edited", [{ kind: "read", path: DOC.path, sha256: "c".repeat(64) }]]]);
    const row = only(previewOf([job], { evidence }), "edited");
    expect(row.verdict.kind).toBe("unauthorised");
    if (row.verdict.kind !== "unauthorised") return;
    expect(row.verdict.drift).toEqual([`${DOC.path}: pinned aaaaaaaa…, now cccccccc… — edited since it was authorised`]);
    expect(row.verdict.next.kind).toBe("none");
    expect(row.documents).toEqual([
      { path: DOC.path, pinned: { kind: "pinned", sha256: DOC.sha256 }, current: { kind: "read", sha256: "c".repeat(64), when: "this-checkpoint" }, changed: "yes" },
    ]);
    // The fingerprint it has NOW, beside the pin it fails to match — re-pinning is copying the first into the second.
    expect(row.behaviourHash.kind).toBe("computed");
    expect(row.behaviourHash.kind === "computed" && row.behaviourHash.hash).not.toBe(row.authorisedHash);
  });

  test("an unreadable document: unauthorised, `changed` is cannot-tell rather than no, and no fingerprint is claimed", () => {
    const evidence: DocumentEvidence = new Map([["gone", [{ kind: "unreadable", path: DOC.path, why: "ENOENT" }]]]);
    const row = only(previewOf([sessionJob("gone")], { evidence }), "gone");
    expect(row.verdict.kind).toBe("unauthorised");
    expect(row.documents[0]?.changed).toBe("cannot-tell");
    expect(row.documents[0]?.current).toEqual({ kind: "unreadable", why: "ENOENT" });
    expect(row.behaviourHash.kind).toBe("not-computed");
  });

  test("a run in flight: held, next run after it settles, and the lease on the row", () => {
    const leaseUntil = at(minutes(50));
    const row = only(previewOf([sessionJob("busy")], { occurrences: indexOf(occurrences.reserved("busy", at(-minutes(10)), leaseUntil)) }), "busy");
    expect(row.verdict.kind).toBe("held");
    expect(row.verdict.next).toEqual({ kind: "after-in-flight-settles", leaseUntil });
  });

  test("never run on a DISARMED daemon: held, first run its own delay after somebody arms it", () => {
    const job = sessionJob("fresh", { initialDelayMs: hours(2) });
    const row = only(previewOf([job], { arming: DISARMED, capabilities: NONE }), "fresh");
    expect(row.verdict.kind).toBe("held");
    expect(row.verdict.next).toEqual({ kind: "after-arming", initialDelayMs: hours(2) });
  });

  test("never run on an ARMED daemon whose arming instant is lost: held, and no next run is invented", () => {
    const row = only(previewOf([sessionJob("fresh")], { arming: { kind: "unknown", why: "armed.json could not be written" }, capabilities: ALL }), "fresh");
    expect(row.verdict.kind).toBe("held");
    expect(row.verdict.next).toEqual({ kind: "none", why: expect.stringContaining("armed.json could not be written") });
  });

  test("waiting: the next run is an ABSOLUTE instant, measured from the last run", () => {
    const row = only(previewOf([sessionJob("steady")], { occurrences: indexOf(occurrences.finished("steady", at(-hours(1)), at(-hours(1)))) }), "steady");
    expect(row.verdict.kind).toBe("waiting");
    expect(row.verdict.next).toEqual({ kind: "next-due", at: at(hours(2)) });
  });

  test("not yet eligible: never run, and its first eligible instant", () => {
    const row = only(previewOf([sessionJob("new", { initialDelayMs: minutes(30) })], { arming: { kind: "armed", at: at(-minutes(10)) } }), "new");
    expect(row.verdict.kind).toBe("not-yet-eligible");
    expect(row.verdict.next).toEqual({ kind: "first-eligible", at: at(minutes(20)) });
  });

  test("dry-run: due now, and the sentence says nothing is reserved or launched", () => {
    const row = only(previewOf([sessionJob("fixture", { dispatch: { kind: "dry-run", why: "a fixture" } })]), "fixture");
    expect(row.verdict.kind).toBe("dry-run");
    expect(row.verdict.next).toEqual({ kind: "due-now" });
    expect(row.verdict.sentence).toContain("nothing is reserved or launched");
    expect(row.dispatch).toEqual({ kind: "dry-run", why: "a fixture" });
  });

  test("dispatch, then spacing: the second session waits on the first's PROPOSED launch, and says it assumed it", () => {
    const preview = previewOf([sessionJob("first"), sessionJob("second")], { launchSeparationMs: minutes(30) });
    expect(preview.jobs.map((row) => row.verdict.kind)).toEqual(["dispatch", "spacing-held"]);
    expect(preview.jobs[0]?.verdict.next).toEqual({ kind: "due-now" });
    expect(preview.jobs[0]?.verdict.sentence).toContain("assume");
    expect(preview.jobs[1]?.verdict.next).toEqual({ kind: "next-due", at: at(minutes(30)) });
    expect(preview.caveat).toContain("assume");
  });

  test("dispatch on a daemon holding no session dispatcher says nothing will start it", () => {
    const row = only(previewOf([sessionJob("due")], { capabilities: NONE }), "due");
    expect(row.verdict.kind).toBe("dispatch");
    expect(row.verdict.sentence).toContain("no session dispatcher");
  });

  test("a daemon holding no session dispatcher does not space later rows against a launch it cannot make", () => {
    const preview = previewOf([sessionJob("first"), sessionJob("second")], {
      capabilities: NONE,
      launchSeparationMs: minutes(30),
    });
    expect(preview.jobs.map((row) => row.verdict.kind)).toEqual(["dispatch", "dispatch"]);
  });

  test("the fixed facts of every row: resource class, the lease labelled as the launcher's, and what is NOT built", () => {
    const preview = previewOf([sessionJob("s", { leaseMs: hours(6) }), ruleJob("r")]);
    expect(only(preview, "s")).toMatchObject({
      resourceClass: "claude-session",
      schedule: { everyMs: hours(3), launcherLeaseMs: hours(6), initialDelayMs: 0 },
      sessionTimeout: "not built",
      sessionNoOverlap: "not enforced",
      prompt: "run s",
    });
    expect(only(preview, "r").resourceClass).toBe("in-process-rule");
    // A rule's documents are the loaded code's digests, and the row says which reading it is.
    expect(only(preview, "r").documents).toEqual([]);
  });
});

describe("the last attempt, in every state the ledger can hold", () => {
  const lastOf = (occurrence: Occurrence | null, jobId = "j") =>
    only(previewOf([sessionJob(jobId)], { occurrences: occurrence === null ? new Map() : indexOf(occurrence) }), jobId).lastAttempt;

  test("never", () => {
    expect(lastOf(null)).toEqual({ kind: "never" });
  });

  test("finished — and the sentence that `finished` is the gjd-remote launcher exiting, not the session", () => {
    const attempt = lastOf(occurrences.finished("j", at(-hours(1)), at(-hours(1) + 4000), 0));
    expect(attempt).toMatchObject({ kind: "finished", reservedAt: at(-hours(1)), finishedAt: at(-hours(1) + 4000), outcome: { kind: "exited", code: 0 } });
    expect(attempt.kind === "finished" && attempt.meaning).toContain("gjd-remote");
    expect(attempt.kind === "finished" && attempt.meaning).toContain("not the session");
  });

  test("refused, with the runner's reason", () => {
    expect(lastOf(occurrences.refused("j", at(-hours(1)), "no dispatcher"))).toMatchObject({ kind: "refused", refusedAt: at(-hours(1)), why: "no dispatcher" });
  });

  test("unknown, with why, and that nothing wrote it down yet", () => {
    expect(lastOf(occurrences.unknown("j", at(-hours(1)), "a daemon died in the spawn window"))).toMatchObject({
      kind: "unknown",
      why: "a daemon died in the spawn window",
      noticed: { kind: "derived" },
    });
  });

  test("in flight — reserved, and started with its pid and lease", () => {
    expect(lastOf(occurrences.reserved("j", at(-minutes(5)), at(minutes(55))))).toMatchObject({ kind: "reserved", leaseUntil: at(minutes(55)) });
    expect(lastOf(occurrences.started("j", at(-minutes(5)), at(minutes(55)), 4321))).toMatchObject({ kind: "started", pid: 4321, leaseUntil: at(minutes(55)) });
  });

  test("the newest occurrence, by its scheduled instant — the same one the planner's clock reads", () => {
    // The older one first in the map on purpose: insertion order must not be what wins.
    const both = only(
      previewOf([sessionJob("j")], { occurrences: indexOf(occurrences.refused("j", at(-hours(5)), "old"), occurrences.finished("j", at(-hours(2)), at(-hours(2)))) }),
      "j",
    );
    expect(both.lastAttempt.kind).toBe("finished");
    expect(both.verdict.next).toEqual({ kind: "next-due", at: at(hours(1)) });
  });
});

describe("listRevision: which job list the daemon holds", () => {
  const LIST = [sessionJob("one"), ruleJob("two")];
  const revise = (edit: (job: AuthorisedJob) => AuthorisedJob): string => listRevision([edit(LIST[0] as AuthorisedJob), LIST[1] as AuthorisedJob]);
  const withSchedule = (job: AuthorisedJob, schedule: Partial<AuthorisedJob["definition"]["schedule"]>): AuthorisedJob => ({
    ...job,
    definition: { ...job.definition, schedule: { ...job.definition.schedule, ...schedule } },
  });
  const withBehaviour = (job: AuthorisedJob, behaviour: Partial<JobBehaviour>): AuthorisedJob => ({
    ...job,
    definition: { ...job.definition, behaviour: { ...job.definition.behaviour, ...behaviour } },
  });

  test("is a short, stable hash of the list", () => {
    expect(listRevision(LIST)).toMatch(/^[0-9a-f]{12}$/);
    expect(listRevision(LIST)).toBe(listRevision([...LIST]));
  });

  test("moves with each job's id, pin, every schedule field, dispatch mode, and the order", () => {
    const was = listRevision(LIST);
    const moved = {
      id: revise((job) => withBehaviour(job, { id: "renamed" })),
      authorisedHash: revise((job) => ({ ...job, authorisedHash: "ffffffffffff" as BehaviourHash })),
      everyMs: revise((job) => withSchedule(job, { everyMs: hours(4) })),
      leaseMs: revise((job) => withSchedule(job, { leaseMs: hours(2) })),
      initialDelayMs: revise((job) => withSchedule(job, { initialDelayMs: minutes(5) })),
      dispatch: revise((job) => withBehaviour(job, { dispatch: { kind: "dry-run", why: "paused" } })),
      order: listRevision([LIST[1] as AuthorisedJob, LIST[0] as AuthorisedJob]),
      removed: listRevision([LIST[0] as AuthorisedJob]),
    };
    for (const [what, revision] of Object.entries(moved)) expect(revision, what).not.toBe(was);
  });

  test("does NOT move when a document is edited — that is the per-tick check's business, not the list's", () => {
    const edited = revise((job) => withBehaviour(job, { documents: [{ path: DOC.path, sha256: "d".repeat(64) }] }));
    expect(edited).toBe(listRevision(LIST));
  });
});

describe("the missed-run policy is what the planner does", () => {
  test(`${MISSED_RUN_POLICY}: three days down on a three-hour job is ONE dispatch plan, then held`, () => {
    expect(MISSED_RUN_POLICY).toBe("one-run");
    const job = sessionJob("sweep", { everyMs: hours(3), leaseMs: hours(1) });
    const lastRun = occurrences.finished("sweep", at(-hours(72)), at(-hours(72)));
    const launched: string[] = [];
    const input = {
      definitions: [job],
      history: { kind: "intact" } as const,
      arming: ARMED_LONG_AGO,
      launchSeparationMs: 0,
      evidence: evidenceAsBuilt([job]),
    };
    const first = planJobs({ ...input, occurrences: indexOf(lastRun), nowMs: NOW.getTime() }, (one) => {
      launched.push(one.definition.behaviour.id);
      return true;
    });
    expect(first.map((plan) => plan.kind)).toEqual(["dispatch"]);
    // What the tick would have written for that one dispatch. Twenty-four missed
    // intervals and no replay: every later tick inside the lease is held, and
    // after it settles the job waits a whole interval from THAT run.
    const reservation = occurrences.reserved("sweep", NOW.toISOString(), at(hours(1)));
    for (const later of [30_000, minutes(10), minutes(59)]) {
      const plans = planJobs({ ...input, occurrences: indexOf(lastRun, reservation), nowMs: NOW.getTime() + later }, () => true);
      expect(plans.map((plan) => plan.kind)).toEqual(["held"]);
    }
    const settled = occurrences.finished("sweep", NOW.toISOString(), at(minutes(1)));
    const after = planJobs({ ...input, occurrences: indexOf(lastRun, settled), nowMs: NOW.getTime() + minutes(2) }, () => true);
    expect(after.map((plan) => plan.kind)).toEqual(["waiting"]);
    expect(launched).toEqual(["sweep"]);
    // And the file says which policy it is describing.
    expect(previewOf([job]).missedRunPolicy.kind).toBe(MISSED_RUN_POLICY);
  });
});

describe("the file: written atomically, read back through the one parser", () => {
  test("round-trips exactly, each job a `job` row", () => {
    const root = tempRoot();
    const preview = previewOf([sessionJob("a"), ruleJob("r")], { occurrences: indexOf(occurrences.finished("a", at(-hours(1)), at(-hours(1)))) });
    expect(writeSchedulePreview(root, preview)).toEqual({ ok: true });
    expect(existsSync(join(root, `${SCHEDULE_PREVIEW_FILE}.tmp`))).toBe(false);
    const read = readSchedulePreviewFile(root);
    expect(read.kind).toBe("preview");
    if (read.kind !== "preview") return;
    expect(read.preview.jobs).toEqual(preview.jobs.map((job) => ({ kind: "job", job })));
    expect({ ...read.preview, jobs: [] }).toEqual({ ...preview, jobs: [] });
  });

  test("absent, unreadable and a newer schema are three different answers", () => {
    const root = tempRoot();
    expect(readSchedulePreviewFile(root)).toEqual({ kind: "absent" });
    writeFileSync(join(root, SCHEDULE_PREVIEW_FILE), "{ not json");
    expect(readSchedulePreviewFile(root).kind).toBe("unreadable");
    writeFileSync(join(root, SCHEDULE_PREVIEW_FILE), JSON.stringify({ schema: 7 }));
    expect(readSchedulePreviewFile(root)).toEqual({ kind: "unsupported-schema", schema: 7 });
  });

  test("a write that cannot land says why rather than throwing", () => {
    const root = tempRoot();
    mkdirSync(join(root, `${SCHEDULE_PREVIEW_FILE}.tmp`));
    const result = writeSchedulePreview(root, previewOf([sessionJob("a")]));
    expect(result.ok).toBe(false);
  });
});

describe("the preview's own claims describe this daemon", () => {
  test("does not promise a fixed 30-second age when the daemon's checkpoint interval is configurable", () => {
    expect(previewOf([sessionJob("a")]).caveat).toContain("one checkpoint tick");
    expect(previewOf([sessionJob("a")]).caveat).not.toContain("30s");
  });

  test("the long-lived daemon does not reach the CLI and remote-tmux modules for one duration formatter", () => {
    const source = readFileSync(join(repoRoot(), "tools/overseer/schedule-preview.ts"), "utf8");
    expect(source).not.toContain('from "./status-cli.js"');
  });
});

describe("the CLI block", () => {
  const CHANGED_TO = "c".repeat(64);

  function linesFor(preview: SchedulePreview, checkoutRevision: string): string[] {
    const root = tempRoot();
    writeSchedulePreview(root, preview);
    return schedulePreviewLines(readSchedulePreviewFile(root), { listRevision: checkoutRevision }, NOW.getTime() + 20_000);
  }

  test("with no file and no checkpoint context: the possible pre-build daemon and the checkout's list are named", () => {
    const lines = schedulePreviewLines({ kind: "absent" }, { listRevision: "0a1b2c3d4e5f" }, NOW.getTime()).join("\n");
    expect(lines).toContain("predates this build");
    expect(lines).toContain("0a1b2c3d4e5f");
  });

  test("no file beside a current checkpoint does not claim that current daemon predates this build", () => {
    const lines = schedulePreviewLines(
      { kind: "absent" },
      { listRevision: "0a1b2c3d4e5f", runningInstanceId: "current-daemon" },
      NOW.getTime(),
    ).join("\n");
    expect(lines).toContain("current-daemon");
    expect(lines).toContain("has not completed a successful preview write");
    expect(lines).not.toContain("the running daemon predates this build");
  });

  test("with a file: a line per fact per job, the next run London first, and a changed document with both digests", () => {
    const edited = sessionJob("edited");
    const steady = sessionJob("steady");
    const definitions = [edited, steady, ruleJob("rule")];
    const evidence: DocumentEvidence = new Map([
      ["edited", [{ kind: "read", path: DOC.path, sha256: CHANGED_TO }]],
      ["steady", [{ kind: "read", path: DOC.path, sha256: DOC.sha256 }]],
    ]);
    const preview = previewOf(definitions, { evidence, occurrences: indexOf(occurrences.finished("steady", at(-hours(1)), at(-hours(1)))) });
    const text = linesFor(preview, listRevision(definitions)).join("\n");
    for (const id of ["edited", "steady", "rule"]) expect(text).toContain(id);
    expect(text).toContain("NOT AUTHORISED");
    // BOTH DIGESTS, in full — `sha256sum` prints the full one, so that is what a reader compares.
    expect(text).toContain(DOC.sha256);
    expect(text).toContain(CHANGED_TO);
    expect(text).toContain("the same list this checkout builds");
    const nextLine = text.split("\n").find((line) => line.includes("next") && line.includes("London"));
    expect(nextLine, text).toBeDefined();
    expect(nextLine?.indexOf("London")).toBeLessThan(nextLine?.indexOf("UTC") ?? -1);
    expect(text).toContain("not built");
    expect(text).toContain("not enforced");
  });

  test("a daemon holding a different list says a restart loads the checkout's", () => {
    const preview = previewOf([sessionJob("a")]);
    const text = linesFor(preview, "fedcba987654").join("\n");
    expect(text).toContain(`the running daemon holds list ${listRevision([sessionJob("a")])}; this checkout builds fedcba987654 — a restart loads it`);
  });

  test("a preview left by a previous daemon instance does not claim what the current daemon holds", () => {
    const preview = previewOf([sessionJob("a")]);
    const root = tempRoot();
    writeSchedulePreview(root, preview);
    const text = schedulePreviewLines(
      readSchedulePreviewFile(root),
      { listRevision: listRevision([sessionJob("a")]), runningInstanceId: "a-new-daemon-instance" },
      NOW.getTime(),
    ).join("\n");
    expect(text).toContain("a-new-daemon-instance");
    expect(text).toContain("does not say which list the current daemon holds");
    expect(text).not.toContain("the running daemon holds list");
  });

  test("an unreadable row is printed as unreadable, and the others still print", () => {
    const preview = previewOf([sessionJob("a"), sessionJob("b")]);
    const damaged = JSON.parse(JSON.stringify(preview)) as { jobs: Record<string, unknown>[] };
    (damaged.jobs[0] as Record<string, unknown>)["verdict"] = { kind: "from-the-future", sentence: "s", next: { kind: "due-now" } };
    const lines = schedulePreviewLines(parseSchedulePreview(damaged), { listRevision: "x" }, NOW.getTime()).join("\n");
    expect(lines).toMatch(/a\s+UNREADABLE/);
    expect(lines).toContain("from-the-future");
    expect(lines).toMatch(/\bb\b/);
  });
});

describe("the daemon writes it on every checkpoint tick, and a disarmed daemon dispatches nothing", () => {
  /** Real milliseconds, only so the timers fire; the daemon's own clock is a fixed one. */
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  function eventsIn(root: string): OverseerEvent[] {
    const path = join(root, EVENTS_FILE);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as OverseerEvent);
  }

  async function runDaemon(
    root: string,
    options: { preview?: Parameters<typeof runOverseer>[0]["preview"]; log?: string[]; during?: () => void } = {},
  ): Promise<void> {
    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: () => NOW,
      tickMs: 5,
      log: (line) => options.log?.push(line),
      // No payload at all: the preview is written by the checkpoint ticker,
      // which runs whether or not the dashboard has said anything.
      source: () =>
        (async function* () {
          await sleep(50);
          options.during?.();
          await sleep(50);
          // A SOURCE THAT SAYS NOTHING, on purpose — it only holds the daemon
          // open while the ticker runs. `yield*` over nothing makes it a
          // generator in the linter's eyes without inventing a payload.
          yield* [];
        })(),
      // NO `jobs`, ever, in this describe: the scheduler is off.
      ...(options.preview === undefined ? {} : { preview: options.preview }),
    });
    expect(outcome.kind).toBe("stopped");
  }

  /** A job that would be DISPATCHED if this daemon were armed — so "nothing was dispatched" is not vacuous. */
  const due = sessionJob("would-dispatch");
  const fixture = sessionJob("dry", { dispatch: { kind: "dry-run", why: "a fixture" } });
  const PREVIEW_OPTION = {
    definitions: [due, fixture],
    readDocument: (path: string) => ({ kind: "read" as const, path, sha256: DOC.sha256 }),
    capabilities: NONE,
    listRevision: listRevision([due, fixture]),
    arming: ARMED_LONG_AGO,
    launchSeparationMs: 0,
  };

  test("scheduler OFF: schedule.json holds every job, and not one occurrence is written", async () => {
    const root = tempRoot();
    await runDaemon(root, { preview: PREVIEW_OPTION });
    const read = readSchedulePreviewFile(root);
    expect(read.kind).toBe("preview");
    if (read.kind !== "preview") return;
    expect(read.preview.headline.kind).toBe("off");
    expect(read.preview.list).toEqual({ kind: "given", listRevision: PREVIEW_OPTION.listRevision });
    expect(read.preview.capabilities).toEqual(NONE);
    const rows = read.preview.jobs.map((row) => (row.kind === "job" ? `${row.job.jobId}:${row.job.verdict.kind}` : "unreadable"));
    expect(rows).toEqual(["would-dispatch:dispatch", "dry:dry-run"]);
    // THE ASSERTION THAT MATTERS: it previewed a dispatch and made none.
    expect(eventsIn(root).filter((event) => event.kind.startsWith("job-occurrence") || event.kind.startsWith("rule-"))).toEqual([]);
  });

  test("one checkpoint uses one document reading for both its headline and its preview rows", async () => {
    const root = tempRoot();
    const job = sessionJob("one-reading");
    let readings = 0;
    const readDocument = (path: string) => ({
      kind: "read" as const,
      path,
      // Each checkpoint currently asks twice: the headline sees the pin and the
      // row sees the edit. A single evidence snapshot alternates across ticks,
      // but the two claims inside each file always agree.
      sha256: ++readings % 2 === 1 ? DOC.sha256 : "f".repeat(64),
    });
    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: () => NOW,
      tickMs: 5,
      log: () => {},
      source: () =>
        (async function* () {
          await sleep(50);
          yield* [];
        })(),
      jobs: {
        definitions: [job],
        spawn: () => ({ kind: "refused", why: "the test never starts a process" }),
        arming: ARMED_LONG_AGO,
        launchSeparationMs: 0,
        readDocument,
        // Keep the live scheduler out of this reproduction. Only the checkpoint
        // ticker is under test, and no dispatch path is entered.
        intervalMs: hours(24),
      },
      preview: {
        definitions: [job],
        readDocument,
        capabilities: { session: true, rules: false },
        listRevision: listRevision([job]),
        arming: ARMED_LONG_AGO,
        launchSeparationMs: 0,
      },
    });
    const read = readSchedulePreviewFile(root);
    if (read.kind !== "preview") throw new Error(`expected a preview, got ${read.kind}`);
    const row = read.preview.jobs[0];
    if (row?.kind !== "job") throw new Error("expected a readable job row");
    expect([
      ["armed", "dispatch"],
      ["blocked", "unauthorised"],
    ]).toContainEqual([read.preview.headline.kind, row.job.verdict.kind]);
  });

  test("an armed daemon previews the arming, capabilities, spacing and document reader its live scheduler actually uses", async () => {
    const root = tempRoot();
    const definitions = [sessionJob("first"), sessionJob("second")];
    await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: new AbortController().signal,
      now: () => NOW,
      tickMs: 5,
      log: () => {},
      source: () =>
        (async function* () {
          await sleep(50);
          yield* [];
        })(),
      jobs: {
        definitions,
        spawn: () => ({ kind: "refused", why: "the test never starts a process" }),
        arming: ARMED_LONG_AGO,
        launchSeparationMs: minutes(30),
        readDocument: (path) => ({ kind: "read", path, sha256: DOC.sha256 }),
        intervalMs: hours(24),
      },
      // Deliberately contradictory copies. They exist for a disarmed daemon;
      // once `jobs` exists they must not overrule what the live ticker holds.
      preview: {
        definitions,
        readDocument: (path) => ({ kind: "read", path, sha256: "f".repeat(64) }),
        capabilities: NONE,
        listRevision: listRevision(definitions),
        arming: DISARMED,
        launchSeparationMs: 0,
      },
    });
    const read = readSchedulePreviewFile(root);
    if (read.kind !== "preview") throw new Error(`expected a preview, got ${read.kind}`);
    expect(read.preview.capabilities).toEqual({ session: true, rules: false });
    expect(read.preview.arming).toEqual({ kind: "armed", at: ARMED_LONG_AGO.at });
    expect(read.preview.jobs.map((row) => (row.kind === "job" ? row.job.verdict.kind : "unreadable"))).toEqual(["dispatch", "spacing-held"]);
  });

  test("a daemon handed no job list writes a file that says so, rather than no file", async () => {
    const root = tempRoot();
    await runDaemon(root);
    const read = readSchedulePreviewFile(root);
    if (read.kind !== "preview") throw new Error(`expected a preview, got ${read.kind}`);
    expect(read.preview.list.kind).toBe("not-given");
    expect(read.preview.jobs).toEqual([]);
    expect(schedulePreviewLines(read, { listRevision: "x" }, NOW.getTime()).join("\n")).toContain("given no job list");
  });

  test("a write that keeps failing is logged ONCE, its recovery once, and the daemon carries on", async () => {
    const root = tempRoot();
    const log: string[] = [];
    // A directory where the temp file goes: every write fails, for real.
    const blocker = join(root, `${SCHEDULE_PREVIEW_FILE}.tmp`);
    mkdirSync(blocker);
    await runDaemon(root, { preview: PREVIEW_OPTION, log, during: () => rmSync(blocker, { recursive: true, force: true }) });
    const said = log.filter((line) => line.includes("schedule preview"));
    expect(said.filter((line) => line.includes("NOT WRITTEN"))).toHaveLength(1);
    expect(said.filter((line) => line.includes("written again"))).toHaveLength(1);
    expect(readSchedulePreviewFile(root).kind).toBe("preview");
  });
});

describe("the wiring the shipped CLI does", () => {
  test("schedulerWiring always hands over a preview — the full list, the capabilities held, and the checkout's revision — and still no jobs when off", () => {
    const off = schedulerWiring({}, DISARMED);
    expect(off.jobs).toBeUndefined();
    expect(off.preview.definitions.map((job) => job.definition.behaviour.id)).toEqual([
      "get-ready-to-deploy",
      "feedback-sweep",
      "schedule-fixture",
      "wedged-work",
      "launch-mode",
    ]);
    expect(off.preview.capabilities).toEqual(NONE);
    expect(off.preview.arming).toEqual(DISARMED);
    // THE REVISION `overseer status` COMPARES AGAINST, built the same way from the same checkout.
    const checkout = [...standingJobs(repoRoot()).jobs, ...ruleJobs(repoRoot()).jobs];
    expect(off.preview.listRevision).toBe(listRevision(checkout));
    // It is not something the daemon can dispatch from: it carries no spawner and no rule runner.
    expect(Object.keys(off.preview).sort()).toEqual(["arming", "capabilities", "definitions", "launchSeparationMs", "listRevision", "readDocument"]);
  });

  test("the capabilities follow the arming", () => {
    expect(schedulerWiring({ OVERSEER_RULES_ENABLED: "1" }, ARMED_LONG_AGO).preview.capabilities).toEqual({ session: false, rules: true });
    expect(schedulerWiring({ OVERSEER_JOBS_ENABLED: "1" }, ARMED_LONG_AGO).preview.capabilities).toEqual(ALL);
  });
});
