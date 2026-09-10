/**
 * **A session job through the launch protocol** — plan 260910f (scheduled
 * dispatch) § Stage B, and the review dispositions F1–F6 beside it.
 *
 * ## The harness
 *
 * A WORLD is a real launch store, a real admission owner and a fake
 * `tmux-headless` launcher, composed by the protocol's own
 * `composeLaunchProtocol`, all in one temp directory. The scheduler is handed
 * exactly the capability `TickInput.launch` names — `launchOccurrence`,
 * `resumeOccurrence`, `abandon` and a read-only `view` — and nothing else.
 *
 * **Every count here is the launcher's own**: `invocations` is appended by the
 * fake launcher when it is called, never by the protocol or the scheduler, so a
 * scheduler that reported a launch without making one could not satisfy it
 * (the launch protocol's F12, one layer out). A "session" is a file under the
 * temp dir that the tmux evidence port looks for; no tmux server is involved.
 *
 * A restart is the world killed and a fresh one opened from the same disk.
 *
 * Nothing here reads the wall clock, touches `~/.overseer` or the default tmux
 * server, and no id is a uuid (`tests/fixture-ids.test.ts`).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { activationVerdict, preflightVerdict } from "../scripts/overseer-activate.js";
import {
  behaviourHash,
  due,
  occurrenceId,
  type Arming,
  type AuthorisedJob,
  type BehaviourHash,
  type JobBehaviour,
  type JobDocument,
  type JobRunSpec,
  type LaunchOccurrence,
  type OccurrenceKey,
  type ScheduleIndex,
} from "../tools/overseer/jobs.js";
import { asReservationKey, openLocalAdmission, type AdmissionOwner, type LocalAdmission } from "../tools/overseer/launch-admission.js";
import { readArtefacts, writeExitFile } from "../tools/overseer/launch-artefacts.js";
import {
  HIDDEN_LAUNCH_ACKNOWLEDGEMENT,
  composeLaunchProtocol,
  occurrenceIdOf,
  scheduleOrigin,
  type CorrelationId,
  type LaunchEvent,
  type LaunchJournal,
  type LaunchOccurrenceId,
  type LaunchProtocol,
  type LaunchRecord,
  type Launcher,
  type RunSpec,
} from "../tools/overseer/launch-protocol.js";
import { LAUNCHES_DIR, LAUNCH_JOURNAL, openLaunchStore, type LaunchStore } from "../tools/overseer/launch-store.js";
import {
  planJobs,
  resolveEvidence,
  type AccountChoice,
  type JobPlan,
  type LaunchHow,
  type ReadDocument,
  type ReadDocumentBytes,
  type Superseded,
} from "../tools/overseer/schedule-plan.js";
import { describeReport, schedulerTick, type OccurrenceLog, type SchedulerLaunch, type SchedulerReport, type TickInput } from "../tools/overseer/scheduler.js";
import { hours, minutes } from "../tools/overseer/schedules.js";

/* ------------------------------------------------------------------ *
 * The harness.
 * ------------------------------------------------------------------ */

class Crash extends Error {}

let clockMs = Date.parse("2026-09-10T10:00:00.000Z");
const now = (): Date => new Date(clockMs);
const advance = (ms: number): void => {
  clockMs += ms;
};

/** What survives a restart: the disk, and the fake launcher's own tally. */
type Machine = {
  readonly root: string;
  readonly invocations: { id: string; correlationId: string; material: string; run: RunSpec | null }[];
  /** Every call the scheduler made on its capability, in order. */
  readonly calls: { op: "launchOccurrence" | "resumeOccurrence" | "abandon"; id: string }[];
  /** The owner answers `unavailable` to a release while this is set. */
  releaseFails: boolean;
};

type World = {
  readonly protocol: LaunchProtocol;
  readonly launch: SchedulerLaunch;
  readonly store: LaunchStore;
  readonly owner: LocalAdmission;
  kill(): void;
};

const roots: string[] = [];
const worlds = new Set<World>();

afterEach(() => {
  for (const world of worlds) world.kill();
  worlds.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  clockMs = Date.parse("2026-09-10T10:00:00.000Z");
});

function machine(): Machine {
  const root = mkdtempSync(join(tmpdir(), "overseer-scheduled-dispatch-"));
  roots.push(root);
  return { root, invocations: [], calls: [], releaseFails: false };
}

const sessionFile = (m: Machine, correlationId: string): string => join(m.root, "sessions", correlationId);

function world(m: Machine, options: { readonly dieAfter?: LaunchEvent["kind"] } = {}): World {
  const opened = openLaunchStore({ root: m.root, now });
  if (!opened.ok) throw new Error(`launch store refused: ${JSON.stringify(opened.refusal)}`);
  const ownerOpened = openLocalAdmission({ root: m.root, now });
  if (!ownerOpened.ok) throw new Error(`owner refused: ${JSON.stringify(ownerOpened.refusal)}`);
  const store = opened.store;
  const real = ownerOpened.owner;
  let dead = false;

  // DIES ONCE THE NAMED LINE IS ON THE DISK — the bytes a crash at that point
  // leaves. The protocol's own guard turns the throw into a failed append, and
  // every later call on this world throws too.
  const journal: LaunchJournal = {
    status: () => store.status(),
    fold: () => store.fold(),
    attemptDir: (id, attempt) => store.attemptDir(id, attempt),
    append(event) {
      if (dead) throw new Crash("after death");
      const wrote = store.append(event);
      if (wrote.ok && options.dieAfter === event.kind) {
        dead = true;
        throw new Crash(`after ${event.kind}`);
      }
      return wrote;
    },
    writeMaterial: (id, bytes) => store.writeMaterial(id, bytes),
    readMaterial: (id) => store.readMaterial(id),
    writeIntent: (id, attempt, intent) => store.writeIntent(id, attempt, intent),
  };
  const owner: AdmissionOwner = {
    ownerId: real.ownerId,
    reserve: (key, cls) => real.reserve(key, cls),
    lookup: (key) => real.lookup(key),
    release: (key, because) => (m.releaseFails ? { kind: "unavailable", why: "the test's owner will not release just now" } : real.release(key, because)),
    inventory: () => real.inventory(),
  };
  const launcher: Launcher = {
    kind: "tmux-headless",
    launch(input) {
      if (dead) throw new Crash("after death");
      m.invocations.push({ id: input.occurrenceId, correlationId: input.correlationId, material: input.material.bytes.toString("utf8"), run: input.run });
      mkdirSync(join(m.root, "sessions"), { recursive: true });
      writeFileSync(sessionFile(m, input.correlationId), "");
      return { kind: "started", detail: "a pretend tmux session" };
    },
  };
  const protocol = composeLaunchProtocol({
    journal,
    owner,
    launchers: { "tmux-headless": launcher },
    evidence: {
      artefacts: (dir, correlationId) => readArtefacts(dir, correlationId),
      identity: () => ({ kind: "cannot-tell", why: "no process is probed in this test" }),
      boot: () => ({ read: true, id: "boot-one" }),
      tmux: (correlationId) => (existsSync(sessionFile(m, correlationId)) ? { kind: "found", sessionId: "$1" } : { kind: "absent" }),
    },
    now,
  });
  // THE SCHEDULER'S WHOLE CAPABILITY, with every call it makes written down.
  const launch: SchedulerLaunch = {
    launchOccurrence: (request) => {
      m.calls.push({ op: "launchOccurrence", id: occurrenceIdOf(request.origin) });
      return protocol.launchOccurrence(request);
    },
    resumeOccurrence: (id) => {
      m.calls.push({ op: "resumeOccurrence", id });
      return protocol.resumeOccurrence(id);
    },
    abandon: (id, why) => {
      m.calls.push({ op: "abandon", id });
      return protocol.abandon(id, why);
    },
    view: () => ({ status: () => store.status(), fold: () => store.fold(), attemptDir: (id, attempt) => store.attemptDir(id, attempt) }),
  };
  let closed = false;
  const made: World = {
    protocol,
    launch,
    store,
    owner: real,
    kill() {
      dead = true;
      if (closed) return;
      closed = true;
      store.close();
      real.close();
      worlds.delete(made);
    },
  };
  worlds.add(made);
  return made;
}

function restart(m: Machine, old: World): World {
  old.kill();
  return world(m);
}

/** Take the one `claude-session` slot, so the next occurrence has to wait for admission. */
const OCCUPANT = asReservationKey("test-occupant");
function occupy(w: World): void {
  if (OCCUPANT === null) throw new Error("the occupant key is not a key");
  expect(w.owner.reserve(OCCUPANT, "claude-session").kind).toBe("reserved");
}
function free(w: World): void {
  if (OCCUPANT === null) throw new Error("the occupant key is not a key");
  expect(w.owner.release(OCCUPANT, { kind: "disposed", requestId: "test-free" }).kind).toBe("released");
}

/** The child ended: exit.json written into the attempt directory, and its pretend session gone. */
function childEnded(m: Machine, w: World, id: string, correlationId: string): void {
  writeExitFile(w.store.attemptDir(id as LaunchOccurrenceId, 1), {
    v: 1,
    kind: "exit",
    correlationId: correlationId as CorrelationId,
    at: now().toISOString(),
    ending: { kind: "exited", code: 0 },
    verdict: { kind: "ok" },
    usageLimit: false,
    permissionDenials: 0,
    answer: null,
    transcript: null,
  });
  unlinkSync(sessionFile(m, correlationId));
}

const recordsOf = (w: World): LaunchRecord[] => [...w.store.fold().occurrences.values()];

function recordOf(w: World, id: string): LaunchRecord {
  const record = w.store.fold().occurrences.get(id as LaunchOccurrenceId);
  if (record === undefined) throw new Error(`${id} is not in the journal`);
  return record;
}

/* ------------------------------------------------------------------ *
 * The jobs.
 * ------------------------------------------------------------------ */

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

const DOC_TEXT = "Reply with the single line `sweep ran` and stop.\n";
const DOC: JobDocument = { path: "docs/fixture/scheduled-dispatch-job.md", sha256: sha(DOC_TEXT) };
const RUN: JobRunSpec = { timeoutMinutes: 30, access: "read-only" };
const ARMED: Arming = { kind: "armed", at: "2026-09-10T08:00:00.000Z" };

function sessionJob(id: string, options: { what?: string; everyMs?: number; initialDelayMs?: number; run?: JobRunSpec } = {}): AuthorisedJob {
  const behaviour: JobBehaviour = {
    id,
    what: options.what ?? `Follow ${DOC.path}.`,
    documents: [DOC],
    work: { kind: "session", run: options.run ?? RUN },
    dispatch: { kind: "live" },
  };
  return {
    definition: { behaviour, schedule: { everyMs: options.everyMs ?? hours(3), leaseMs: hours(1), initialDelayMs: options.initialDelayMs ?? 0 } },
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

/** The document reads back exactly as pinned, every tick. */
const readDocument: ReadDocument = (path) => ({ kind: "read", path, sha256: DOC.sha256 });
/** Its bytes, as the material reader sees them — the pinned text, unless a test says otherwise. */
const readBytes =
  (text = DOC_TEXT): ReadDocumentBytes =>
  (path) => ({ kind: "read", path, sha256: sha(text), bytes: Buffer.from(text, "utf8") });

const ACCOUNTS: AccountChoice = { chosen: { kind: "chosen", account: "pool-a", notes: [] }, standing: () => ({ kind: "clear" }) };

/** The events.jsonl ledger, which a session job no longer writes to. Whole, and empty. */
function ledger(history: OccurrenceLog["occurrenceHistory"] = { kind: "intact" }): OccurrenceLog & { appended: number } {
  const log = {
    instanceId: "scheduled-dispatch-test",
    occurrences: new Map(),
    occurrenceHistory: history,
    appended: 0,
    append(events: readonly unknown[]) {
      log.appended += events.length;
      return { ok: true as const, appended: events.length, cursor: { events: log.appended, bytes: 0 } };
    },
  };
  return log;
}

function tick(w: World | null, definitions: readonly AuthorisedJob[], over: Partial<TickInput> = {}): readonly SchedulerReport[] {
  return schedulerTick({
    definitions,
    store: ledger(),
    launch: w?.launch,
    accounts: ACCOUNTS,
    readDocument,
    readDocumentBytes: readBytes(),
    arming: ARMED,
    launchSeparationMs: 0,
    now,
    ...over,
  });
}

/** `job:outcome` for a launch, `job:kind` for everything else. */
function said(reports: readonly SchedulerReport[]): string[] {
  return reports.map((report) => (report.kind === "launch" ? `${report.jobId}:${report.outcome.kind}` : `${report.jobId}:${report.kind}`));
}

/* ------------------------------------------------------------------ *
 * Red first.
 * ------------------------------------------------------------------ */

describe("one occurrence, one launcher invocation, whatever the restarts", () => {
  test("A RESTART AFTER INVOCATION AND BEFORE ANY RECEIPT, then ten ticks: exactly one launcher invocation", () => {
    const m = machine();
    let w = world(m);
    const job = sessionJob("sweep");
    expect(said(tick(w, [job]))).toEqual(["sweep:invoked"]);
    expect(m.invocations).toHaveLength(1);
    // Killed with the launch `launching` on the disk, no start.json and no exit.json.
    w = restart(m, w);
    for (let i = 0; i < 10; i += 1) {
      advance(hours(4)); // past the three-hour cadence every time
      w.protocol.reconcile();
      expect(said(tick(w, [job]))).toEqual(["sweep:held"]);
    }
    expect(m.invocations).toHaveLength(1);
    // AND A SESSION JOB WROTE NOTHING TO events.jsonl: the launch journal is its one ledger (D2).
    const log = ledger();
    tick(w, [job], { store: log });
    expect(log.appended).toBe(0);
  });

  test("A RESTART AFTER `planned`: the next tick resumes that occurrence and invokes the launcher once, with the same origin (F1)", () => {
    const m = machine();
    let w = world(m, { dieAfter: "planned" });
    const job = sessionJob("sweep");
    tick(w, [job]);
    expect(recordsOf(w).map((record) => record.state)).toEqual(["planned"]);
    const planned = recordsOf(w)[0]?.id;
    w = restart(m, w);
    expect(said(tick(w, [job]))).toEqual(["sweep:invoked"]);
    for (let i = 0; i < 5; i += 1) {
      advance(minutes(1));
      w.protocol.reconcile();
      tick(w, [job]);
    }
    expect(m.invocations.map((one) => one.id)).toEqual([planned]);
    // RESUMED, NOT RE-PLANNED: the scheduler never calls launchOccurrence for an id already in the journal.
    expect(m.calls.map((call) => `${call.op}:${call.id === planned ? "same" : "other"}`)).toEqual(["launchOccurrence:same", "resumeOccurrence:same"]);
  });

  test("A `waiting` FOLLOWED BY FREE CAPACITY invokes exactly once, with the same origin (F1)", () => {
    const m = machine();
    const w = world(m);
    occupy(w);
    const job = sessionJob("sweep");
    expect(said(tick(w, [job]))).toEqual(["sweep:waiting"]);
    advance(minutes(1));
    expect(said(tick(w, [job]))).toEqual(["sweep:waiting"]);
    free(w);
    advance(minutes(1));
    expect(said(tick(w, [job]))).toEqual(["sweep:invoked"]);
    advance(minutes(1));
    expect(said(tick(w, [job]))).toEqual(["sweep:held"]);
    expect(m.invocations).toHaveLength(1);
    expect(new Set(m.calls.map((call) => call.id)).size).toBe(1);
    expect(m.calls.map((call) => call.op)).toEqual(["launchOccurrence", "resumeOccurrence", "resumeOccurrence"]);
  });

  test("OUTCOME-UNKNOWN HOLDS ITS JOB THROUGH A DUE INSTANT — timeout alone is not proof", () => {
    const m = machine();
    const w = world(m);
    const job = sessionJob("sweep");
    tick(w, [job]);
    const [only] = m.invocations;
    if (only === undefined) throw new Error("expected an invocation");
    // The session is gone and it left no exit.json: nothing can say how it ended.
    unlinkSync(sessionFile(m, only.correlationId));
    w.protocol.reconcile();
    expect(recordOf(w, only.id).state).toBe("outcome-unknown");
    for (const step of [hours(3), hours(3), hours(24)]) {
      advance(step);
      w.protocol.reconcile();
      const reports = tick(w, [job]);
      expect(said(reports)).toEqual(["sweep:held"]);
      expect(reports[0]?.kind === "held" && reports[0].why).toContain("outcome-unknown");
    }
    expect(m.invocations).toHaveLength(1);
  });

  test("A DAY OF DOWNTIME GIVES ONE LAUNCH, not one per missed interval", () => {
    const m = machine();
    let w = world(m);
    const job = sessionJob("sweep");
    tick(w, [job]);
    const [first] = m.invocations;
    if (first === undefined) throw new Error("expected an invocation");
    advance(minutes(20));
    childEnded(m, w, first.id, first.correlationId);
    w.protocol.reconcile();
    expect(recordOf(w, first.id).state).toBe("completed");
    // Down for a day: eight three-hour intervals missed.
    w = restart(m, w);
    advance(hours(24));
    w.protocol.reconcile();
    expect(said(tick(w, [job]))).toEqual(["sweep:invoked"]);
    for (let i = 0; i < 5; i += 1) {
      advance(30_000);
      w.protocol.reconcile();
      expect(said(tick(w, [job]))).toEqual(["sweep:held"]);
    }
    expect(m.invocations).toHaveLength(2);
  });
});

describe("a moved revision supersedes the occurrence that is waiting (F1, Fable's P1–P5, and the replaced arm)", () => {
  test("THE OLD ONE IS SUPERSEDED AND NEVER LAUNCHED; the new revision launches once", () => {
    const m = machine();
    const w = world(m);
    occupy(w);
    const a = sessionJob("sweep");
    expect(said(tick(w, [a]))).toEqual(["sweep:waiting"]);
    const [waiting] = recordsOf(w);
    if (waiting === undefined) throw new Error("expected a waiting occurrence");
    // The instruction is edited and re-authorised while it waits.
    const b = sessionJob("sweep", { what: "Follow the fixture document, and say which revision you are." });
    advance(minutes(1));
    const reports = tick(w, [b]);
    expect(said(reports)).toEqual(["sweep:superseded", "sweep:waiting"]);
    const superseded = recordOf(w, waiting.id);
    expect(superseded.state === "failed-before-launch" && superseded.proof).toBe("superseded");
    free(w);
    advance(minutes(1));
    expect(said(tick(w, [b]))).toEqual(["sweep:invoked"]);
    expect(m.invocations.map((one) => one.id)).not.toContain(waiting.id);
    expect(m.invocations).toHaveLength(1);
  });

  test("A ROLLBACK ABANDONS THE REPLACEMENT and a FRESH occurrence launches once; the original id is never asked for again", () => {
    const m = machine();
    const w = world(m);
    occupy(w);
    const a = sessionJob("sweep");
    const b = sessionJob("sweep", { what: "The second revision." });
    tick(w, [a]);
    const original = recordsOf(w)[0]?.id;
    advance(minutes(1));
    tick(w, [b]); // A abandoned, B planned and waiting
    advance(minutes(1));
    const rolledBack = tick(w, [a]); // B abandoned, A' planned: a NEW id, dated by B's abandonment
    expect(said(rolledBack)).toEqual(["sweep:superseded", "sweep:waiting"]);
    const states = recordsOf(w).map((record) => record.state);
    expect(states).toEqual(["failed-before-launch", "failed-before-launch", "waiting-admission"]);
    const fresh = recordsOf(w)[2]?.id;
    expect(fresh).not.toBe(original);
    free(w);
    advance(minutes(1));
    expect(said(tick(w, [a]))).toEqual(["sweep:invoked"]);
    for (let i = 0; i < 3; i += 1) {
      advance(minutes(1));
      tick(w, [a]);
    }
    expect(m.invocations.map((one) => one.id)).toEqual([fresh]);
    // THE ORIGINAL ID IS PASSED TO THE PROTOCOL EXACTLY TWICE — planned, then
    // abandoned — and never again, by any operation.
    expect(m.calls.filter((call) => call.id === original).map((call) => call.op)).toEqual(["launchOccurrence", "abandon"]);
  });
});

describe("the material handed to the child is pinned (D3)", () => {
  test("A MATERIAL/DIGEST RACE REFUSES: a document edited between the gate's reading and the material's is not launched", () => {
    const m = machine();
    const w = world(m);
    const reports = tick(w, [sessionJob("sweep")], { readDocumentBytes: readBytes("An edited document that nobody authorised.\n") });
    expect(said(reports)).toEqual(["sweep:material-moved"]);
    expect(m.invocations).toEqual([]);
    // Nothing is planned: a refusal here is a report, not an occurrence.
    expect(recordsOf(w)).toEqual([]);
  });

  test("the child is handed the job's instruction, then each document verbatim under its path and digest, on the pinned run spec", () => {
    const m = machine();
    const w = world(m);
    tick(w, [sessionJob("sweep")]);
    const [only] = m.invocations;
    // THE JOB'S AUTHORISED TIMEOUT AND ACCESS, ON THE POOL ACCOUNT THE PLANNER CHOSE (M11).
    expect(only?.run).toEqual({ ...RUN, account: "pool-a" });
    expect(only?.material).toContain(`Follow ${DOC.path}.`);
    expect(only?.material).toContain(DOC_TEXT);
    expect(only?.material).toContain(DOC.path);
    expect(only?.material).toContain(DOC.sha256);
    expect(only?.material).toContain("not the copies on disk");
    // Planned as a scheduled origin, on the tmux-headless launcher, in the claude-session class.
    const [record] = recordsOf(w);
    expect(record?.origin.kind).toBe("schedule");
    expect(record?.launcherKind).toBe("tmux-headless");
    expect(record?.admissionClass).toBe("claude-session");
  });
});

describe("the clocks read the launch, not the plan (F3, F4)", () => {
  test("A DELAYED ADMISSION, THEN A RESTART: spacing counts from the launch's `launchingAt`, not its plan (F3)", () => {
    const m = machine();
    let w = world(m);
    occupy(w);
    const first = sessionJob("first");
    // Not eligible until 12:00:30 — after the first one finally launches at 12:00.
    const second = sessionJob("second", { initialDelayMs: hours(4) + 30_000 });
    const jobs = [first, second];
    const separation = { launchSeparationMs: minutes(30) };
    expect(said(tick(w, jobs, separation))).toEqual(["first:waiting", "second:not-yet-eligible"]);
    // Two hours in the admission queue.
    advance(hours(2));
    free(w);
    expect(said(tick(w, jobs, separation))).toEqual(["first:invoked", "second:not-yet-eligible"]);
    // And the daemon restarts at once.
    w = restart(m, w);
    advance(minutes(1));
    const reports = tick(w, jobs, separation);
    expect(said(reports)).toEqual(["first:held", "second:spacing-held"]);
    expect(reports[1]?.kind === "spacing-held" && reports[1].remainingMs).toBe(minutes(29));
  });

  test("A TERMINAL EVENT, THEN A RELEASE SIX HOURS LATER: the cadence counts from `endedAt` (F4)", () => {
    const m = machine();
    const w = world(m);
    const job = sessionJob("sweep", { everyMs: hours(3) });
    tick(w, [job]);
    const [first] = m.invocations;
    if (first === undefined) throw new Error("expected an invocation");
    advance(hours(1));
    childEnded(m, w, first.id, first.correlationId);
    m.releaseFails = true;
    w.protocol.reconcile();
    const ended = recordOf(w, first.id);
    expect(ended.state).toBe("completed");
    expect(ended.reservation.kind).toBe("held");
    advance(hours(6));
    m.releaseFails = false;
    w.protocol.reconcile();
    expect(recordOf(w, first.id).reservation.kind).toBe("released");
    // Six hours after it ended, on a three-hour cadence: due. Measured from the release it would be waiting.
    advance(minutes(1));
    expect(said(tick(w, [job]))).toEqual(["sweep:invoked"]);
  });
});

describe("history authority is per ledger (F2)", () => {
  test("THE events.jsonl LEDGER LOST holds the rules only: a session job still launches", () => {
    const m = machine();
    const w = world(m);
    const reports = tick(w, [sessionJob("sweep"), ruleJob("wedged")], { store: ledger({ kind: "lost", why: "the log had a hole" }) });
    expect(said(reports)).toEqual(["sweep:invoked", "wedged:history-lost"]);
  });

  test("THE LAUNCH JOURNAL LOST holds the session jobs only, with the protocol's reason; a rule is not held", () => {
    const m = machine();
    mkdirSync(join(m.root, LAUNCHES_DIR), { recursive: true });
    writeFileSync(join(m.root, LAUNCHES_DIR, LAUNCH_JOURNAL), "this is not a journal line\n");
    const w = world(m);
    expect(w.store.status().kind).toBe("history-lost");
    const reports = tick(w, [sessionJob("sweep"), ruleJob("wedged")]);
    expect(said(reports)).toEqual(["sweep:history-lost", "wedged:refused"]);
    expect(reports[0]?.kind === "history-lost" && reports[0].why).toContain("launch journal");
    expect(m.invocations).toEqual([]);
  });

  function resetLine(carried: readonly Record<string, unknown>[]): string {
    return `${JSON.stringify({
      v: 1,
      kind: "history-reset",
      at: "2026-09-10T09:00:00.000Z",
      actor: "greg",
      requestId: "reset-one",
      why: "the old journal had a hole",
      preservedAs: "launches.jsonl.lost",
      lostAt: { line: 3, why: "a torn line" },
      acknowledgement: HIDDEN_LAUNCH_ACKNOWLEDGEMENT,
      carried,
    })}\n`;
  }

  test("A CARRIED UNATTRIBUTABLE ENTRY HOLDS EVERY SESSION JOB, and only Greg's dispose moves it", () => {
    const m = machine();
    mkdirSync(join(m.root, LAUNCHES_DIR), { recursive: true });
    const nobody = `lo-${"ab".repeat(10)}`;
    writeFileSync(
      join(m.root, LAUNCHES_DIR, LAUNCH_JOURNAL),
      resetLine([{ occurrenceId: nobody, lastSeen: null, ownerHeld: null, origin: null, plannedAt: null }]),
    );
    const w = world(m);
    expect(w.store.status().kind).toBe("whole");
    const reports = tick(w, [sessionJob("sweep"), sessionJob("other"), ruleJob("wedged")]);
    expect(said(reports)).toEqual(["sweep:held", "other:held", "wedged:refused"]);
    expect(reports[0]?.kind === "held" && reports[0].why).toContain("unattributable");
    expect(m.invocations).toEqual([]);
  });

  test("a scheduled occurrence carried across a history reset holds ITS job, and no other", () => {
    const m = machine();
    mkdirSync(join(m.root, LAUNCHES_DIR), { recursive: true });
    const origin = scheduleOrigin({ jobId: "sweep", scheduledAt: "2026-09-10T07:00:00.000Z", behaviourHash: behaviourHash(sessionJob("sweep").definition.behaviour) });
    writeFileSync(
      join(m.root, LAUNCHES_DIR, LAUNCH_JOURNAL),
      resetLine([{ occurrenceId: occurrenceIdOf(origin), lastSeen: "launching", ownerHeld: null, origin, plannedAt: "2026-09-10T07:00:01.000Z" }]),
    );
    const w = world(m);
    const reports = tick(w, [sessionJob("sweep"), sessionJob("other")]);
    expect(said(reports)).toEqual(["sweep:held", "other:invoked"]);
  });
});

describe("what a report may claim", () => {
  test("`invoked` IS NEVER `succeeded`: the report says the launcher was called, and not that anything finished", () => {
    const m = machine();
    const w = world(m);
    const [report] = tick(w, [sessionJob("sweep")]);
    if (report?.kind !== "launch") throw new Error(`expected a launch report, got ${report?.kind}`);
    expect(report.outcome.kind).toBe("invoked");
    const line = describeReport(report);
    expect(line).toContain("INVOKED");
    expect(line).not.toMatch(/succeed|success|complete|finished|dispatched/i);
  });

  test("A MOVED RUN SPEC RE-PINS: timeout and access are in the fingerprint", () => {
    const base = sessionJob("sweep").definition.behaviour;
    const longer: JobBehaviour = { ...base, work: { kind: "session", run: { ...RUN, timeoutMinutes: RUN.timeoutMinutes + 1 } } };
    const wider: JobBehaviour = { ...base, work: { kind: "session", run: { ...RUN, access: "write" } } };
    expect(behaviourHash(longer)).not.toBe(behaviourHash(base));
    expect(behaviourHash(wider)).not.toBe(behaviourHash(base));
    expect(behaviourHash(wider)).not.toBe(behaviourHash(longer));
  });
});

/* ------------------------------------------------------------------ *
 * The planner's account and supersession rules, asked directly. Written after
 * the coordinator's two refinements had landed in schedule-plan.ts; each was
 * watched red by mutating the planner (see the report), not by writing first.
 * ------------------------------------------------------------------ */

describe("a waiting occurrence's pinned account, and the replacement's due instant", () => {
  const WHOLE = { kind: "intact" } as const;

  /** A waiting launch occurrence for `job`, planned at 09:00, on `account` (null: a record from before 2b). */
  function waiting(job: AuthorisedJob, account: string | null, hash: string = job.authorisedHash): LaunchOccurrence {
    const key: OccurrenceKey = { jobId: job.definition.behaviour.id, scheduledAt: "2026-09-10T09:00:00.000Z", behaviourHash: hash as BehaviourHash };
    return {
      kind: "launch",
      id: occurrenceId(key),
      key,
      reservedAt: "2026-09-10T09:00:01.000Z",
      launchId: occurrenceIdOf(scheduleOrigin(key)),
      standing: { kind: "resumable", state: "waiting-admission", account, why: "waiting for admission: the one slot is taken" },
    };
  }

  function planOf(
    job: AuthorisedJob,
    index: ScheduleIndex,
    accounts: AccountChoice,
    supersede: (why: string) => Superseded = () => ({ kind: "replaced", at: now().toISOString() }),
  ): { plans: readonly JobPlan[]; launched: LaunchHow[]; superseded: string[] } {
    const launched: LaunchHow[] = [];
    const superseded: string[] = [];
    const plans = planJobs(
      {
        definitions: [job],
        occurrences: index,
        history: { rules: WHOLE, sessions: WHOLE },
        arming: ARMED,
        launchSeparationMs: 0,
        nowMs: clockMs,
        evidence: resolveEvidence([job], readDocument),
        accounts,
      },
      {
        launch: (_job, how) => {
          launched.push(how);
          return true;
        },
        supersede: (_job, _occurrence, why) => {
          superseded.push(why);
          return supersede(why);
        },
      },
    );
    return { plans, launched, superseded };
  }

  const indexOf = (...occurrences: LaunchOccurrence[]): ScheduleIndex => new Map(occurrences.map((one) => [one.id, one]));
  const choosing = (account: string, standing: AccountChoice["standing"]): AccountChoice => ({ chosen: { kind: "chosen", account, notes: [] }, standing });

  test("A RESUME NEVER RE-CHOOSES: its pinned account held is `usage-held` naming it — not abandoned, and no sibling planned", () => {
    const job = sessionJob("sweep");
    const accounts = choosing("pool-b", (handle) => (handle === "pool-a" ? { kind: "held", why: "at its five-hour limit", until: "2026-09-10T13:00:00.000Z" } : { kind: "clear" }));
    const { plans, launched, superseded } = planOf(job, indexOf(waiting(job, "pool-a")), accounts);
    const [only] = plans;
    if (only?.kind !== "usage-held") throw new Error(`expected usage-held, got ${only?.kind}`);
    expect(only.account).toBe("pool-a");
    expect(only.why).toContain("pool-a");
    expect(only.until).toBe("2026-09-10T13:00:00.000Z");
    expect(launched).toEqual([]);
    expect(superseded).toEqual([]);
  });

  test("its pinned account clear: resumed on that account, whichever one a new plan would choose", () => {
    const job = sessionJob("sweep");
    const occurrence = waiting(job, "pool-a");
    const { plans, launched } = planOf(job, indexOf(occurrence), choosing("pool-b", () => ({ kind: "clear" })));
    expect(plans.map((one) => one.kind)).toEqual(["resume"]);
    expect(launched).toEqual([{ kind: "resume", occurrence }]);
  });

  test("its pinned account GONE: abandoned with the reason, and a replacement plans this tick — due now, on the chosen account", () => {
    const job = sessionJob("sweep");
    const accounts = choosing("pool-b", (handle) => (handle === "pool-a" ? { kind: "gone", why: "its credential was revoked" } : { kind: "clear" }));
    const { plans, launched, superseded } = planOf(job, indexOf(waiting(job, "pool-a")), accounts);
    expect(superseded).toEqual(["pinned account pool-a is no longer usable: its credential was revoked"]);
    expect(plans.map((one) => one.kind)).toEqual(["dispatch"]);
    // DUE AT THE ABANDONMENT'S OWN INSTANT: a new key, so a new id, and no interval lost.
    expect(launched).toEqual([{ kind: "new-session", dueAt: now().toISOString(), account: "pool-b" }]);
  });

  test("gone, and no account may be chosen: abandoned, and the replacement is `usage-held`", () => {
    const job = sessionJob("sweep");
    const accounts: AccountChoice = {
      chosen: { kind: "held", why: "every pool account is at its limit", until: null },
      standing: () => ({ kind: "gone", why: "no longer registered" }),
    };
    const { plans, launched, superseded } = planOf(job, indexOf(waiting(job, "pool-a")), accounts);
    expect(superseded).toHaveLength(1);
    expect(plans.map((one) => one.kind)).toEqual(["usage-held"]);
    expect(launched).toEqual([]);
  });

  test("a record that names no account (before 2b) is gated by the account choice a new plan would be", () => {
    const job = sessionJob("sweep");
    const held: AccountChoice = { chosen: { kind: "held", why: "the box is critical", until: null }, standing: () => ({ kind: "clear" }) };
    expect(planOf(job, indexOf(waiting(job, null)), held).plans.map((one) => one.kind)).toEqual(["usage-held"]);
    expect(planOf(job, indexOf(waiting(job, null)), ACCOUNTS).plans.map((one) => one.kind)).toEqual(["resume"]);
  });

  test("a new plan with no account to run on is `usage-held`, and says until when", () => {
    const job = sessionJob("sweep");
    const accounts: AccountChoice = { chosen: { kind: "held", why: "every pool account is at its limit", until: "2026-09-10T15:00:00.000Z" }, standing: () => ({ kind: "clear" }) };
    const { plans, launched } = planOf(job, new Map(), accounts);
    const [only] = plans;
    expect(only?.kind === "usage-held" && only.until).toBe("2026-09-10T15:00:00.000Z");
    expect(launched).toEqual([]);
  });

  test("A REFUSED ABANDON PLANS NOTHING: a moved revision whose waiting occurrence cannot be abandoned is held", () => {
    const job = sessionJob("sweep");
    const { plans, launched } = planOf(job, indexOf(waiting(job, null, "0123456789ab")), ACCOUNTS, () => ({ kind: "refused", why: "the journal would not take the line" }));
    const [only] = plans;
    expect(only?.kind).toBe("held");
    expect(only?.kind === "held" && only.why).toContain("could not be abandoned");
    expect(launched).toEqual([]);
  });

  test("`replaced` releases its due instant: `due()` answers due at the abandonment's own instant, whatever the cadence", () => {
    const schedule = { everyMs: hours(3), leaseMs: hours(1), initialDelayMs: 0 };
    expect(due(schedule, { kind: "replaced", at: "2026-09-10T09:30:00.000Z" }, clockMs, ARMED)).toEqual({
      kind: "due",
      sinceMs: clockMs - Date.parse("2026-09-10T09:30:00.000Z"),
      dueAt: "2026-09-10T09:30:00.000Z",
    });
  });
});

describe("activation with stale live pins (F6)", () => {
  const stale = { kind: "ineligible" as const, jobId: "get-ready-to-deploy", why: "its behaviour moved" };
  const input = {
    problems: [],
    eligibility: [stale, { kind: "dry-run" as const, jobId: "schedule-fixture", why: "pinned as dry-run" }],
    sessionJobIds: new Set(["get-ready-to-deploy", "schedule-fixture"]),
    requiredJobIds: ["get-ready-to-deploy", "schedule-fixture"],
  };

  test("DISARMED: a stale live session pin is a WARNING, and the install goes ahead", () => {
    const verdict = preflightVerdict({ ...input, armedAfter: false });
    expect(verdict.blockers).toEqual([]);
    expect(verdict.warnings.join("\n")).toContain("get-ready-to-deploy");
  });

  test("--arm: the same stale pin BLOCKS", () => {
    const verdict = preflightVerdict({ ...input, armedAfter: true });
    expect(verdict.blockers.join("\n")).toContain("get-ready-to-deploy");
  });

  test("ALREADY ARMED, no flag: it blocks too, because the result would be armed", () => {
    // `armedAfter` is what the command computes from the arming file when neither flag is passed.
    const verdict = preflightVerdict({ ...input, armedAfter: true });
    expect(verdict.blockers).not.toEqual([]);
  });

  test("and after the restart, a disarmed daemon with a stale pin is a note, not a failure", () => {
    const base = {
      installedUnit: "the unit",
      expectedUnit: "the unit",
      systemdActive: true,
      systemdDetail: "active",
      checkpointWrittenAt: "2026-09-10T12:00:10.000Z",
      restartedAt: "2026-09-10T12:00:00.000Z",
      eligibility: input.eligibility,
      requiredJobIds: input.requiredJobIds,
      sessionJobIds: input.sessionJobIds,
    };
    expect(activationVerdict({ ...base, checkpointScheduler: "off", armed: false }).ok).toBe(true);
    expect(activationVerdict({ ...base, checkpointScheduler: "armed", armed: true }).ok).toBe(false);
  });
});
