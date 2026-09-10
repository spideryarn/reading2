/**
 * **The planner that the tick and the preview share, and the gate order it
 * owns** — plan 260910e § D2.
 *
 * Two kinds of test live here, and the comments say which each one is:
 *
 * - **Red first.** Written before `schedule-plan.ts` existed and watched fail
 *   on the code before it: duplicate ids (the first definition used to dispatch
 *   while the report said neither could be addressed — Sol's P1-5), dry-run,
 *   and fresh document evidence per tick (defect 1 in the plan).
 * - **Characterisation.** Scenarios that already passed on the old `due()` and
 *   the old tick — startup, the interval boundary, missed intervals, a forward
 *   and a backward time jump, a run already in flight, and the report
 *   sequences for sweep + dispatch, history lost, spacing and a rule/session
 *   mix. They are here so the refactor onto the planner is shown not to have
 *   moved them, which is the only thing a refactor of a gate order may not do.
 *
 * Nothing here reads the wall clock, and no id in this file is a uuid:
 * `tests/fixture-ids.test.ts` fails the suite on a uuid shared between two
 * test files.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { OverseerEvent } from "../tools/overseer/diff.js";
import {
  behaviourHash,
  occurrenceId,
  type Arming,
  type AuthorisedJob,
  type BehaviourHash,
  type JobBehaviour,
  type JobDocument,
  type Occurrence,
  type OccurrenceId,
  type OccurrenceKey,
  type SpawnJob,
} from "../tools/overseer/jobs.js";
import { planJobs, resolveEvidence, type DocumentEvidence, type JobPlan, type Launch } from "../tools/overseer/schedule-plan.js";
import { eligibilityOf, schedulerStandingOf, schedulerTick, type OccurrenceLog, type SchedulerReport } from "../tools/overseer/scheduler.js";
import { hours, minutes } from "../tools/overseer/schedules.js";
import { openStore, type OverseerStore } from "../tools/overseer/store.js";

const opened: OverseerStore[] = [];
const roots: string[] = [];
afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function realStore(now: () => Date): OverseerStore {
  const root = mkdtempSync(join(tmpdir(), "overseer-schedule-plan-test-"));
  roots.push(root);
  const result = openStore({ root, now });
  if (!result.ok) throw new Error(`the store would not open: ${JSON.stringify(result.refusal)}`);
  opened.push(result.store);
  return result.store;
}

/** A clock the test moves by hand, backwards as well as forwards. */
function fakeClock(startIso: string): { now: () => Date; set(iso: string): void; advance(ms: number): void } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), set: (iso) => (ms = Date.parse(iso)), advance: (by) => (ms += by) };
}

const ARMED_LONG_AGO: Arming = { kind: "armed", at: "2026-09-01T00:00:00.000Z" };
const NO_SPACING = 0;

/** The one document the session jobs here lean on, and the digest it was pinned at. */
const DOC: JobDocument = { path: "docs/fixture/plan-test-job.md", sha256: "a".repeat(64) };

type Dispatch = JobBehaviour["dispatch"];
const LIVE: Dispatch = { kind: "live" };

/**
 * A session job pinned to its own behaviour and its own document digests —
 * "authorised" for every test that is not ABOUT the pin. Three tests below
 * deliberately hand the tick a reading that disagrees, which is what keeps this
 * self-pinning honest.
 */
function sessionJob(
  id: string,
  options: { dispatch?: Dispatch; documents?: readonly JobDocument[]; everyMs?: number; leaseMs?: number; initialDelayMs?: number; what?: string } = {},
): AuthorisedJob {
  const documents = options.documents ?? [DOC];
  const behaviour: JobBehaviour = { id, what: options.what ?? `run ${id}`, documents, work: { kind: "session" }, dispatch: options.dispatch ?? LIVE };
  return {
    definition: {
      behaviour,
      schedule: { everyMs: options.everyMs ?? hours(3), leaseMs: options.leaseMs ?? hours(1), initialDelayMs: options.initialDelayMs ?? 0 },
    },
    authorisedHash: behaviourHash(behaviour),
    authorisedDocuments: documents,
  };
}

function ruleJob(id: string, documents: readonly JobDocument[] = []): AuthorisedJob {
  const behaviour: JobBehaviour = {
    id,
    what: `look for ${id}`,
    documents,
    work: { kind: "rule", rule: { kind: "wedged-work", minAgeSeconds: 60, policy: "safe-to-kill", disposition: "propose" } },
    dispatch: LIVE,
  };
  return {
    definition: { behaviour, schedule: { everyMs: minutes(15), leaseMs: minutes(2), initialDelayMs: 0 } },
    authorisedHash: behaviourHash(behaviour),
    authorisedDocuments: documents,
  };
}

/** Every document reads back exactly as pinned, and every read is counted. */
function pinnedReader(reads: string[] = []): (path: string) => { kind: "read"; path: string; sha256: string } {
  return (path) => {
    reads.push(path);
    return { kind: "read", path, sha256: path === DOC.path ? DOC.sha256 : "b".repeat(64) };
  };
}

/** A store that records what it was asked to append. Its index does not move — the tests that need it to use `realStore`. */
function fakeStore(
  occurrences: Map<OccurrenceId, Occurrence> = new Map(),
  history: OccurrenceLog["occurrenceHistory"] = { kind: "intact" },
): OccurrenceLog & { appended: OverseerEvent[] } {
  const appended: OverseerEvent[] = [];
  return {
    instanceId: "plan-test-instance",
    occurrences,
    occurrenceHistory: history,
    appended,
    append(events) {
      appended.push(...events);
      return { ok: true, appended: events.length, cursor: { events: appended.length, bytes: 0 } };
    },
  };
}

function spawner(settle: "never" | "on-demand" = "never"): { spawn: SpawnJob; started: string[]; finishAll(): void } {
  const started: string[] = [];
  const finishers: (() => void)[] = [];
  return {
    started,
    finishAll: () => {
      for (const finish of finishers.splice(0)) finish();
    },
    spawn: (definition) => {
      started.push(definition.behaviour.id);
      const done =
        settle === "never"
          ? new Promise<never>(() => undefined)
          : new Promise<{ kind: "exited"; code: number }>((resolve) => finishers.push(() => resolve({ kind: "exited", code: 0 })));
      return { kind: "spawned", pid: 5151, done };
    },
  };
}

function key(jobId: string, at: string): OccurrenceKey {
  return { jobId, scheduledAt: at, behaviourHash: "0123456789ab" as BehaviourHash };
}

function settledAt(jobId: string, at: string): Occurrence {
  const k = key(jobId, at);
  return { kind: "finished", id: occurrenceId(k), key: k, reservedAt: at, instanceId: "an-earlier-instance", what: "x", finishedAt: at, outcome: { kind: "exited", code: 0 } };
}

function startedAt(jobId: string, at: string, leaseUntil: string): Occurrence {
  const k = key(jobId, at);
  return { kind: "started", id: occurrenceId(k), key: k, reservedAt: at, instanceId: "plan-test-instance", what: "x", leaseUntil, startedAt: at, pid: 7171 };
}

function index(...occurrences: Occurrence[]): Map<OccurrenceId, Occurrence> {
  return new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
}

function kinds(reports: readonly SchedulerReport[]): string[] {
  return reports.map((report) => `${report.jobId}:${report.kind}`);
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

// ───────────────────────────────────────────────────────────── red first

describe("duplicate ids: every definition sharing an id is refused BEFORE anything is planned (red first)", () => {
  test("ZERO SPAWNS, and both duplicates are refused — not the second one only", () => {
    // RED FIRST, on the code before `schedule-plan.ts`: the loop refused an id
    // only when it met it the SECOND time, so the first definition had already
    // been reserved and spawned while the report said "neither can be addressed"
    // (Sol's P1-5). The assertion that matters is the spawn count, not the
    // presence of a refusal — the old code had a refusal too.
    const spawn = spawner();
    const store = fakeStore();
    const reports = schedulerTick({
      definitions: [sessionJob("twin"), sessionJob("twin", { what: "something else entirely" }), sessionJob("bystander")],
      store,
      spawn: spawn.spawn,
      readDocument: pinnedReader(),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(spawn.started).toEqual(["bystander"]);
    expect(kinds(reports)).toEqual(["twin:duplicate-id", "twin:duplicate-id", "bystander:dispatched"]);
    // AND NOTHING WAS RESERVED FOR EITHER TWIN. A reservation is a launch as far
    // as the ledger is concerned.
    expect(store.appended.filter((event) => event.kind === "job-occurrence-reserved" && event.jobId === "twin")).toEqual([]);
  });

  test("the duplicate is refused wherever it sits in the list, including last", () => {
    const spawn = spawner();
    const reports = schedulerTick({
      definitions: [sessionJob("bystander"), ruleJob("twin"), sessionJob("twin")],
      store: fakeStore(),
      spawn: spawn.spawn,
      readDocument: pinnedReader(),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(spawn.started).toEqual(["bystander"]);
    expect(reports.filter((report) => report.jobId === "twin").map((report) => report.kind)).toEqual(["duplicate-id", "duplicate-id"]);
  });
});

describe("dry-run: due, and nothing reserved or launched (red first)", () => {
  test("a due dry-run job reports `dry-run`, writes NOTHING to the ledger, and does not count against spacing", () => {
    // RED FIRST: before `dispatch` existed the field was invisible and the job
    // was simply dispatched.
    const spawn = spawner();
    const store = fakeStore();
    const reports = schedulerTick({
      definitions: [sessionJob("fixture", { dispatch: { kind: "dry-run", why: "a harmless fixture nobody has made live" } }), sessionJob("real")],
      store,
      spawn: spawn.spawn,
      readDocument: pinnedReader(),
      arming: ARMED_LONG_AGO,
      // A LIVE GATE, and the second job still dispatches: a dry run started
      // nothing, so it must not ration the job behind it.
      launchSeparationMs: minutes(30),
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(kinds(reports)).toEqual(["fixture:dry-run", "real:dispatched"]);
    expect(spawn.started).toEqual(["real"]);
    // A last attempt that never happened would corrupt the ledger.
    expect(store.appended.filter((event) => "jobId" in event && event.jobId === "fixture")).toEqual([]);
    const dry = reports[0];
    expect(dry?.kind === "dry-run" && dry.why).toContain("a harmless fixture nobody has made live");
  });

  test("and it stays due, every tick, rather than acquiring a last run it never had", () => {
    const spawn = spawner();
    const store = fakeStore();
    const clock = fakeClock("2026-09-10T12:00:00.000Z");
    const input = {
      definitions: [sessionJob("fixture", { dispatch: { kind: "dry-run", why: "fixture" } })],
      store,
      spawn: spawn.spawn,
      readDocument: pinnedReader(),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: clock.now,
    };
    expect(kinds(schedulerTick(input))).toEqual(["fixture:dry-run"]);
    clock.advance(minutes(1));
    expect(kinds(schedulerTick(input))).toEqual(["fixture:dry-run"]);
    expect(store.appended).toEqual([]);
  });
});

describe("fresh document evidence, every tick (red first)", () => {
  test("A DOCUMENT EDITED AFTER THE DAEMON BUILT ITS DEFINITIONS IS REFUSED, not dispatched under the old digest", () => {
    // RED FIRST, and this is defect 1 of the plan: the definition in memory
    // still names the old digest and still matches its pin, while the session it
    // launches is told to follow the document ON DISK — so between an edit and
    // the next restart, unattended authority grew silently.
    const spawn = spawner();
    const reports = schedulerTick({
      definitions: [sessionJob("sweep")],
      store: fakeStore(),
      spawn: spawn.spawn,
      readDocument: (path) => ({ kind: "read", path, sha256: "c".repeat(64) }),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(spawn.started).toEqual([]);
    expect(kinds(reports)).toEqual(["sweep:unauthorised"]);
    const refused = reports[0];
    if (refused?.kind !== "unauthorised") throw new Error("expected a refusal");
    // THE SENTENCE NAMES THE DOCUMENT AND BOTH DIGESTS (plan § D4), so a person
    // knows which file to read before re-pinning.
    expect(refused.why).toContain(DOC.path);
    expect(refused.why).toContain("aaaaaaaa");
    expect(refused.why).toContain("cccccccc");
  });

  test("a document that cannot be read this tick refuses the job with a sentence", () => {
    const spawn = spawner();
    const reports = schedulerTick({
      definitions: [sessionJob("sweep")],
      store: fakeStore(),
      spawn: spawn.spawn,
      readDocument: (path) => ({ kind: "unreadable", path, why: "ENOENT: it has gone" }),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(spawn.started).toEqual([]);
    expect(kinds(reports)).toEqual(["sweep:unauthorised"]);
    expect(reports[0]?.kind === "unauthorised" && reports[0].why).toContain("ENOENT: it has gone");
  });

  test("a rule job keeps its LOAD-TIME digests: its documents are never re-read", () => {
    // Characterisation on the old code (which read nothing), and a guard on the
    // new: a rule's "documents" are the source of code already loaded into the
    // daemon, so re-reading them would refuse a rule whose running code has not
    // moved (plan § D3).
    const reads: string[] = [];
    const reports = schedulerTick({
      definitions: [ruleJob("wedged", [{ path: "tools/overseer/rules.ts", sha256: "d".repeat(64) }])],
      store: fakeStore(),
      readDocument: pinnedReader(reads),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    // REFUSED at `start` for want of a `rules` capability — which is to say it
    // got past the authorisation gate on its load-time digest.
    expect(kinds(reports)).toEqual(["wedged:refused"]);
    expect(reads).toEqual([]);
  });

  test("a session job that reads back exactly as pinned dispatches, and the documents were read THIS tick", () => {
    const reads: string[] = [];
    const spawn = spawner();
    schedulerTick({
      definitions: [sessionJob("sweep")],
      store: fakeStore(),
      spawn: spawn.spawn,
      readDocument: pinnedReader(reads),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(spawn.started).toEqual(["sweep"]);
    expect(reads).toEqual([DOC.path]);
  });
});

// ─────────────────────────────────────────────────────── characterisation

describe("the planner scenarios of plan § D2 (characterisation: these passed on the old `due()`)", () => {
  const NOW = "2026-09-10T12:00:00.000Z";

  function tickAt(definitions: readonly AuthorisedJob[], store: OccurrenceLog, now: () => Date, arming: Arming = ARMED_LONG_AGO, spawn = spawner()): readonly SchedulerReport[] {
    return schedulerTick({ definitions, store, spawn: spawn.spawn, readDocument: pinnedReader(), arming, launchSeparationMs: NO_SPACING, now });
  }

  test("startup: arming unknown holds a never-run job, loudly", () => {
    const reports = tickAt([sessionJob("fresh")], fakeStore(), () => new Date(NOW), { kind: "unknown", why: "armed.json is missing" });
    expect(kinds(reports)).toEqual(["fresh:held"]);
    expect(reports[0]?.kind === "held" && reports[0].why).toContain("armed.json is missing");
  });

  test("startup: armed, it is not-yet-eligible until armedAt + initialDelayMs, and due at exactly that instant", () => {
    const job = sessionJob("fresh", { initialDelayMs: hours(2) });
    const arming: Arming = { kind: "armed", at: "2026-09-10T10:00:00.000Z" };
    const early = tickAt([job], fakeStore(), () => new Date(Date.parse("2026-09-10T12:00:00.000Z") - 1), arming);
    expect(early).toEqual([{ kind: "not-yet-eligible", jobId: "fresh", firstEligibleAt: "2026-09-10T12:00:00.000Z", remainingMs: 1 }]);
    const spawn = spawner();
    const onTime = tickAt([job], fakeStore(), () => new Date("2026-09-10T12:00:00.000Z"), arming, spawn);
    expect(kinds(onTime)).toEqual(["fresh:dispatched"]);
  });

  test("interval boundary: last + everyMs − 1 is waiting, last + everyMs is due", () => {
    const job = sessionJob("steady", { everyMs: hours(3) });
    const last = "2026-09-10T09:00:00.000Z";
    const store = (): OccurrenceLog => fakeStore(index(settledAt("steady", last)));
    const before = tickAt([job], store(), () => new Date(Date.parse(last) + hours(3) - 1));
    expect(before).toEqual([{ kind: "waiting", jobId: "steady", remainingMs: 1 }]);
    const on = tickAt([job], store(), () => new Date(Date.parse(last) + hours(3)));
    expect(kinds(on)).toEqual(["steady:dispatched"]);
  });

  test("missed intervals: three days down on a 3h job is ONE dispatch across repeated ticks, then held", async () => {
    const clock = fakeClock("2026-09-07T12:00:00.000Z");
    const store = realStore(clock.now);
    const spawn = spawner("on-demand");
    const job = sessionJob("steady", { everyMs: hours(3), leaseMs: hours(1) });
    expect(kinds(tickAt([job], store, clock.now, ARMED_LONG_AGO, spawn))).toEqual(["steady:dispatched"]);
    spawn.finishAll();
    await settle();
    // The box is down for three days: twenty-four intervals missed.
    clock.advance(hours(72));
    expect(kinds(tickAt([job], store, clock.now, ARMED_LONG_AGO, spawn))).toEqual(["steady:dispatched"]);
    for (let i = 0; i < 5; i += 1) {
      clock.advance(30_000);
      expect(kinds(tickAt([job], store, clock.now, ARMED_LONG_AGO, spawn))).toEqual(["steady:held"]);
    }
    // One run for the whole outage, not a replay of it.
    expect(spawn.started).toEqual(["steady", "steady"]);
  });

  test("forward time jump: a clock thirty days ahead is one run, not thirty days of them", () => {
    const spawn = spawner();
    const store = fakeStore(index(settledAt("steady", NOW)));
    const reports = tickAt([sessionJob("steady")], store, () => new Date(Date.parse(NOW) + hours(24 * 30)), ARMED_LONG_AGO, spawn);
    expect(kinds(reports)).toEqual(["steady:dispatched"]);
    expect(spawn.started).toEqual(["steady"]);
    expect(store.appended.filter((event) => event.kind === "job-occurrence-reserved")).toHaveLength(1);
  });

  test("backward time jump: the next run stays at the absolute last + everyMs", () => {
    // The clock goes back an hour past the last run. `due` measures from the
    // last run, so the remaining time grows by exactly the jump — the next run
    // is still at last + everyMs on the calendar, not everyMs from "now".
    const reports = tickAt([sessionJob("steady", { everyMs: hours(3) })], fakeStore(index(settledAt("steady", NOW))), () => new Date(Date.parse(NOW) - hours(1)));
    expect(reports).toEqual([{ kind: "waiting", jobId: "steady", remainingMs: hours(4) }]);
  });

  test("already running: held inside its lease; released as STUCK after it, and never retried", () => {
    const reservedAt = "2026-09-10T11:00:00.000Z";
    const leaseUntil = "2026-09-10T12:00:00.000Z";
    const job = sessionJob("busy", { everyMs: hours(3), leaseMs: hours(1) });
    const spawn = spawner();
    const inside = tickAt([job], fakeStore(index(startedAt("busy", reservedAt, leaseUntil))), () => new Date("2026-09-10T11:30:00.000Z"), ARMED_LONG_AGO, spawn);
    expect(kinds(inside)).toEqual(["busy:held"]);
    const after = tickAt([job], fakeStore(index(startedAt("busy", reservedAt, leaseUntil))), () => new Date("2026-09-10T12:00:01.000Z"), ARMED_LONG_AGO, spawn);
    // The sweep reports it and releases the guard; the job then measures its
    // cadence from the reservation, so it WAITS rather than going again.
    expect(kinds(after)).toEqual(["busy:stuck", "busy:waiting"]);
    expect(spawn.started).toEqual([]);
  });
});

describe("report sequences the refactor must not move (characterisation)", () => {
  const NOW = new Date("2026-09-10T12:00:00.000Z");

  test("sweep first, then dispatch, in one tick", () => {
    const spawn = spawner();
    const stuck = startedAt("busy", "2026-09-10T06:00:00.000Z", "2026-09-10T07:00:00.000Z");
    const reports = schedulerTick({
      definitions: [sessionJob("busy")],
      store: fakeStore(index(stuck)),
      spawn: spawn.spawn,
      readDocument: pinnedReader(),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: () => NOW,
    });
    expect(kinds(reports)).toEqual(["busy:stuck", "busy:dispatched"]);
  });

  test("history lost holds every job — duplicates included, because gate 1 comes before the id check", () => {
    const spawn = spawner();
    const reports = schedulerTick({
      definitions: [sessionJob("a"), sessionJob("a"), ruleJob("r")],
      store: fakeStore(new Map(), { kind: "lost", why: "the log had a hole in it" }),
      spawn: spawn.spawn,
      readDocument: pinnedReader(),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: NO_SPACING,
      now: () => NOW,
    });
    expect(kinds(reports)).toEqual(["a:history-lost", "a:history-lost", "r:history-lost"]);
    expect(spawn.started).toEqual([]);
  });

  test("a session / rule / session mix under a live gate: dispatched, refused, spacing-held", () => {
    const spawn = spawner();
    const reports = schedulerTick({
      definitions: [sessionJob("first"), ruleJob("rule"), sessionJob("second")],
      store: fakeStore(),
      spawn: spawn.spawn,
      readDocument: pinnedReader(),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: minutes(30),
      now: () => NOW,
    });
    expect(kinds(reports)).toEqual(["first:dispatched", "rule:refused", "second:spacing-held"]);
    expect(spawn.started).toEqual(["first"]);
  });

  test("a runner that REFUSES moves no spacing clock, so the next session job still goes (characterisation)", () => {
    let calls = 0;
    const spawn: SpawnJob = () => {
      calls += 1;
      return calls === 1 ? { kind: "refused", why: "not this one" } : { kind: "spawned", pid: 6161, done: new Promise<never>(() => undefined) };
    };
    const reports = schedulerTick({
      definitions: [sessionJob("first"), sessionJob("second")],
      store: fakeStore(),
      spawn,
      readDocument: pinnedReader(),
      arming: ARMED_LONG_AGO,
      launchSeparationMs: minutes(30),
      now: () => NOW,
    });
    expect(kinds(reports)).toEqual(["first:refused", "second:dispatched"]);
  });
});

// ─────────────────────────────── the planner itself, as the preview will read it

describe("planJobs, asked directly — the verdicts the preview will print", () => {
  const NOW_MS = Date.parse("2026-09-10T12:00:00.000Z");

  function plan(
    definitions: readonly AuthorisedJob[],
    options: {
      occurrences?: Map<OccurrenceId, Occurrence>;
      history?: OccurrenceLog["occurrenceHistory"];
      separationMs?: number;
      nowMs?: number;
      evidence?: DocumentEvidence;
      launch?: Launch;
    } = {},
  ): { plans: readonly JobPlan[]; launched: string[] } {
    const launched: string[] = [];
    const plans = planJobs(
      {
        definitions,
        occurrences: options.occurrences ?? new Map(),
        history: options.history ?? { kind: "intact" },
        arming: ARMED_LONG_AGO,
        launchSeparationMs: options.separationMs ?? NO_SPACING,
        nowMs: options.nowMs ?? NOW_MS,
        evidence: options.evidence ?? resolveEvidence(definitions, pinnedReader()),
      },
      (job) => {
        launched.push(job.definition.behaviour.id);
        return options.launch?.(job) ?? true;
      },
    );
    return { plans, launched };
  }

  test("a waiting job carries its next run as an ABSOLUTE instant: last + everyMs", () => {
    const { plans } = plan([sessionJob("steady", { everyMs: hours(3) })], { occurrences: index(settledAt("steady", "2026-09-10T10:00:00.000Z")) });
    expect(plans[0]?.kind === "waiting" && plans[0].nextDueAt).toBe("2026-09-10T13:00:00.000Z");
  });

  test("backward time jump: the next run does not move with the clock", () => {
    // The tick-level test above sees this as a longer `remainingMs`; the
    // preview sees the instant, and the instant is what must hold still.
    const last = "2026-09-10T12:00:00.000Z";
    for (const nowMs of [NOW_MS, NOW_MS - hours(1), NOW_MS - hours(5)]) {
      const { plans } = plan([sessionJob("steady", { everyMs: hours(3) })], { occurrences: index(settledAt("steady", last)), nowMs });
      expect(plans[0]?.kind === "waiting" && plans[0].nextDueAt).toBe("2026-09-10T15:00:00.000Z");
    }
  });

  test("THE SPACING CLOCK MOVES ONLY ON `true`: a launch that did not start a session rations nothing", () => {
    const jobs = [sessionJob("first"), sessionJob("second")];
    const refused = plan(jobs, { separationMs: minutes(30), launch: () => false });
    expect(refused.plans.map((one) => one.kind)).toEqual(["dispatch", "dispatch"]);
    expect(refused.launched).toEqual(["first", "second"]);
    const started = plan(jobs, { separationMs: minutes(30) });
    expect(started.plans.map((one) => one.kind)).toEqual(["dispatch", "spacing-held"]);
    expect(started.launched).toEqual(["first"]);
    // And the held one says when, absolutely.
    expect(started.plans[1]?.kind === "spacing-held" && started.plans[1].nextDueAt).toBe("2026-09-10T12:30:00.000Z");
  });

  test("duplicates never reach `launch`, and history-lost is asked first", () => {
    const twins = [sessionJob("twin"), sessionJob("twin")];
    expect(plan(twins).launched).toEqual([]);
    expect(plan(twins).plans.map((one) => one.kind)).toEqual(["duplicate-id", "duplicate-id"]);
    expect(plan(twins, { history: { kind: "lost", why: "a hole" } }).plans.map((one) => one.kind)).toEqual(["history-lost", "history-lost"]);
  });

  test("A SESSION JOB WITH NO READING IS REFUSED, not waved through on the digest it was built with", () => {
    // Fail closed: a caller that forgot to read is not evidence that nothing moved.
    const { plans, launched } = plan([sessionJob("sweep")], { evidence: new Map() });
    expect(plans.map((one) => one.kind)).toEqual(["unauthorised"]);
    expect(launched).toEqual([]);
  });

  test("an unauthorised verdict names the document that moved and both digests (plan § D4)", () => {
    const evidence = resolveEvidence([sessionJob("sweep")], (path) => ({ kind: "read", path, sha256: "c".repeat(64) }));
    const { plans } = plan([sessionJob("sweep")], { evidence });
    const [only] = plans;
    if (only?.kind !== "unauthorised") throw new Error("expected a refusal");
    expect(only.drift).toEqual([`${DOC.path}: pinned aaaaaaaa…, now cccccccc… — edited since it was authorised`]);
  });

  test("dry-run never reaches `launch`; a rule's documents are never in the evidence", () => {
    const dry = sessionJob("fixture", { dispatch: { kind: "dry-run", why: "fixture" } });
    const rule = ruleJob("wedged", [{ path: "tools/overseer/rules.ts", sha256: "d".repeat(64) }]);
    const reads: string[] = [];
    const evidence = resolveEvidence([dry, rule], pinnedReader(reads));
    expect(reads).toEqual([DOC.path]);
    expect([...evidence.keys()]).toEqual(["fixture"]);
    const { plans, launched } = plan([dry, rule], { evidence });
    expect(plans.map((one) => one.kind)).toEqual(["dry-run", "dispatch"]);
    expect(launched).toEqual(["wedged"]);
  });

  test("THE JOB HANDED TO `launch` CARRIES THIS TICK'S DIGESTS, not the ones it was loaded with", () => {
    // A definition built from an older checkout — its loaded digest is stale —
    // whose document now reads back exactly as pinned. It is authorised on the
    // fresh reading, so what is launched (and keyed) is the fresh reading.
    const pinned = sessionJob("sweep");
    const stale: AuthorisedJob = {
      ...pinned,
      definition: { ...pinned.definition, behaviour: { ...pinned.definition.behaviour, documents: [{ path: DOC.path, sha256: "9".repeat(64) }] } },
    };
    const handed: AuthorisedJob[] = [];
    plan([stale], {
      evidence: resolveEvidence([stale], pinnedReader()),
      launch: (job) => {
        handed.push(job);
        return true;
      },
    });
    expect(handed.map((job) => job.definition.behaviour.documents)).toEqual([[DOC]]);
    expect(behaviourHash(handed[0]!.definition.behaviour)).toBe(pinned.authorisedHash);
  });
});

describe("eligibility and the headline, made of the same evidence as the tick", () => {
  const HELD = { session: true, rules: true };
  const AT = "2026-09-10T12:00:00.000Z";

  test("a dry-run job is its own arm — not eligible, and not a fault either", () => {
    // Not `ineligible`: the activation preflight stops on any `ineligible`, and
    // a harmless fixture doing exactly what it was pinned to do must not stop a
    // box being armed.
    const dry = sessionJob("fixture", { dispatch: { kind: "dry-run", why: "the harmless fixture" } });
    const [one] = eligibilityOf([dry], HELD);
    expect(one?.kind).toBe("dry-run");
    expect(one?.kind === "dry-run" && one.why).toContain("the harmless fixture");
    // It cannot earn ARMED on its own…
    expect(schedulerStandingOf({ jobs: { definitions: [dry], held: HELD }, detail: undefined, at: AT }).kind).toBe("blocked");
    // …and it does not stop a live job earning it.
    const beside = schedulerStandingOf({ jobs: { definitions: [dry, sessionJob("real")], held: HELD }, detail: undefined, at: AT });
    expect(beside.kind).toBe("armed");
    expect(beside.why).toContain("1 of 2");
  });

  test("a dry-run job needs no unavailable launch capability and still cannot stop activation", () => {
    const dry = sessionJob("fixture", { dispatch: { kind: "dry-run", why: "the harmless fixture" } });
    const [one] = eligibilityOf([dry], { session: false, rules: false });
    expect(one?.kind).toBe("dry-run");
  });

  test("duplicate definitions cannot earn ARMED when the planner will refuse every one", () => {
    const twins = [sessionJob("twin"), sessionJob("twin")];
    expect(eligibilityOf(twins, HELD).map((one) => one.kind)).toEqual(["ineligible", "ineligible"]);
    const standing = schedulerStandingOf({ jobs: { definitions: twins, held: HELD }, detail: undefined, at: AT });
    expect(standing.kind).toBe("blocked");
    expect(standing.why).toContain("share this id");
  });

  test("the headline over FRESH evidence is BLOCKED when a document moved, and ARMED over the evidence it was built with", () => {
    const definitions = [sessionJob("sweep")];
    const moved = resolveEvidence(definitions, (path) => ({ kind: "read", path, sha256: "c".repeat(64) }));
    const fresh = schedulerStandingOf({ jobs: { definitions, held: HELD, evidence: moved }, detail: undefined, at: AT });
    expect(fresh.kind).toBe("blocked");
    expect(fresh.why).toContain(DOC.path);
    expect(schedulerStandingOf({ jobs: { definitions, held: HELD }, detail: undefined, at: AT }).kind).toBe("armed");
  });
});
