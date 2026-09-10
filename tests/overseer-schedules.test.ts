/**
 * **Stage 8a: the behaviour/schedule split, and the five things GPT Sol found
 * wrong with the design that preceded it.**
 *
 * The plan for Stage 8 was blocked three times over, and every one of these
 * describe blocks is one of the findings turned into something that can go red:
 *
 * - **S8-1** — a schedule edit must not move any pin. The plan's answer was a
 *   script that rewrote the pin literal, which `scripts/overseer-pins.ts`'s own
 *   header forbids in as many words.
 * - **S8-4** — a re-pin used to discard a job's cadence, so the job dispatched
 *   immediately, possibly over a session the old pin had just launched.
 * - **S8-5** — a phase offset does not survive downtime, a restart or a stuck
 *   occurrence. A durable minimum separation between launches does.
 * - **S8-6** — the first run has to be deferred from a durable `armedAt`, not
 *   from process start and not by fabricating a `finished` occurrence.
 * - **S8-7** — `ARMED` must be a claim about the loaded, authorised definitions
 *   rather than about an environment variable.
 * - **S8-3** — one activation command that cannot report success while systemd
 *   is still running the old, disarmed unit.
 *
 * The scheduler tests proper live in `tests/overseer-jobs.test.ts`; this file is
 * the config, the arming record, the two gates and the activation verdict.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { ARMING_FILE, readArming, reconcileArming } from "../tools/overseer/arming.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import { JOBS_ENABLED_VAR } from "../tools/overseer/dispatch.js";
import {
  behaviourHash,
  due,
  JOB_BEHAVIOUR_HASHED_FIELDS,
  lastRunOf,
  lastSessionLaunchOf,
  occurrenceId,
  type Arming,
  type AuthorisedJob,
  type BehaviourHash,
  type JobBehaviour,
  type JobDefinition,
  type Occurrence,
  type OccurrenceId,
  type OccurrenceKey,
  type SpawnJob,
} from "../tools/overseer/jobs.js";
import {
  describeReport,
  eligibilityOf,
  schedulerStandingOf,
  schedulerTick,
  type OccurrenceLog,
  type SchedulerReport,
} from "../tools/overseer/scheduler.js";
import type { ReadDocument } from "../tools/overseer/schedule-plan.js";
import {
  hours,
  LAUNCH_SEPARATION_MS,
  minutes,
  MINIMUM_EVERY_MS,
  STANDING_JOB_SCHEDULES,
  validateLaunchSeparation,
  validateSchedules,
  type ScheduleConfig,
} from "../tools/overseer/schedules.js";
import { AUTHORISED_HASHES, standingJobs } from "../tools/overseer/standing-jobs.js";
import { activationVerdict, ARMING_ENV_FILE, INSTALLED_UNIT, substitutedUnit, UNIT_SOURCE } from "../scripts/overseer-activate.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every session job this file ticks leans on no document, so a tick that asked for one would be a bug — it says so rather than inventing a digest. */
const NO_DOCUMENTS: ReadDocument = (path) => ({ kind: "unreadable", path, why: "no job in this file leans on a document" });

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "overseer-schedules-test-"));
  temporary.push(path);
  return path;
}

// ───────────────────────────────────────────────────────────── S8-1, the split

describe("S8-1: a schedule edit moves no fingerprint, and a behaviour edit still does", () => {
  const BEHAVIOUR: JobBehaviour = { id: "j", what: "do the thing", documents: [], work: { kind: "session" }, dispatch: { kind: "live" } };
  const SCHEDULE: ScheduleConfig = { everyMs: hours(6), leaseMs: hours(6), initialDelayMs: minutes(30) };

  test("THE ONE THAT MAKES GREG'S CONFIG FILE WORK: every schedule field can move without moving the hash", () => {
    // The whole of S8-1 in four assertions. Before this stage `everyMs` and
    // `leaseMs` were hashed fields of the definition, so editing a number
    // refused the job until somebody re-pinned it — and the plan's answer was a
    // script that rewrote the pin from the WHOLE definition, blessing any prompt
    // or document edit riding beside it.
    //
    // The hash cannot see a schedule at all now, and it cannot because
    // `behaviourHash` is not given one: the argument's type has no schedule in
    // it. That is checkable rather than asserted, and the next test checks it.
    const pinned = behaviourHash(BEHAVIOUR);
    const before: JobDefinition = { behaviour: BEHAVIOUR, schedule: SCHEDULE };
    for (const schedule of [
      { ...SCHEDULE, everyMs: hours(1) },
      { ...SCHEDULE, leaseMs: minutes(5) },
      { ...SCHEDULE, initialDelayMs: 0 },
    ] satisfies ScheduleConfig[]) {
      const after: JobDefinition = { behaviour: before.behaviour, schedule };
      expect(behaviourHash(after.behaviour)).toBe(pinned);
    }
  });

  test("and a behaviour edit still moves it — all four hashed fields", () => {
    const pinned = behaviourHash(BEHAVIOUR);
    expect(behaviourHash({ ...BEHAVIOUR, id: "other" })).not.toBe(pinned);
    expect(behaviourHash({ ...BEHAVIOUR, what: "do something else" })).not.toBe(pinned);
    expect(behaviourHash({ ...BEHAVIOUR, documents: [{ path: "docs/x.md", sha256: "a".repeat(64) }] })).not.toBe(pinned);
    expect(
      behaviourHash({
        ...BEHAVIOUR,
        work: { kind: "rule", rule: { kind: "wedged-work", minAgeSeconds: 60, policy: "safe-to-kill", disposition: "propose" } }, dispatch: { kind: "live" },
      }),
    ).not.toBe(pinned);
  });

  test("THE HASHED FIELD SET IS EXACTLY `keyof JobBehaviour`, so a clock knob cannot creep back in", () => {
    // The structural half. `JOB_BEHAVIOUR_HASHED_FIELDS` is derived from the
    // encoder table, and the table is a mapped type over `keyof JobBehaviour` —
    // so putting `everyMs` back would take a type change (moving the field onto
    // `JobBehaviour`) and a red line here, rather than one added encoder entry.
    // `dispatch` joined on 2026-09-10 (plan 260910e § D5): whether a job may
    // start anything is gate 3's question, so it is hashed. Still no clock knob.
    expect([...JOB_BEHAVIOUR_HASHED_FIELDS].sort()).toEqual(["dispatch", "documents", "id", "what", "work"]);
  });

  test("the SHIPPED jobs are pinned against their behaviour, and rebuilding them with other schedules changes nothing", () => {
    // Against the real checkout, not a fixture: the claim is about the box.
    const built = standingJobs(REPO);
    expect(built.problems).toEqual([]);
    for (const job of built.jobs) {
      const id = job.definition.behaviour.id as keyof typeof AUTHORISED_HASHES;
      expect(`${id} ${behaviourHash(job.definition.behaviour)}`).toBe(`${id} ${AUTHORISED_HASHES[id]}`);
      // The same behaviour under a wildly different schedule is the same
      // authorisation. This is the sentence Greg was promised.
      const retimed: JobDefinition = { behaviour: job.definition.behaviour, schedule: { everyMs: hours(1), leaseMs: minutes(30), initialDelayMs: 0 } };
      expect(behaviourHash(retimed.behaviour)).toBe(AUTHORISED_HASHES[id]);
    }
  });
});

describe("S8-1: the config, and the validation that replaced the re-pin", () => {
  test("the schedules Greg asked for are the ones that ship", () => {
    // > Yes, I'm thinking get-ready-to-deploy every 6h, and feedback-sweep every
    // > 3h — Greg, 2026-09-08
    expect(STANDING_JOB_SCHEDULES["get-ready-to-deploy"].everyMs).toBe(hours(6));
    expect(STANDING_JOB_SCHEDULES["feedback-sweep"].everyMs).toBe(hours(3));
    // The third key is the dry-run fixture (plan 260910e § D5): daily, and it
    // can start nothing as pinned.
    expect(Object.keys(STANDING_JOB_SCHEDULES).sort()).toEqual(["feedback-sweep", "get-ready-to-deploy", "schedule-fixture"]);
    // And the standing jobs actually carry them — a config nothing reads is the
    // failure mode of every config file.
    const built = standingJobs(REPO);
    expect(built.jobs.map((job) => job.definition.schedule.everyMs)).toEqual([hours(6), hours(3), hours(24)]);
  });

  test("the shipped config passes its own validation", () => {
    expect(validateSchedules(STANDING_JOB_SCHEDULES, ["get-ready-to-deploy", "feedback-sweep", "schedule-fixture"])).toEqual([]);
    expect(validateLaunchSeparation(LAUNCH_SEPARATION_MS, STANDING_JOB_SCHEDULES)).toEqual([]);
  });

  test("every way a hand-edited number can be wrong is fatal, and each says which way", () => {
    // Sol's list, verbatim: "missing, malformed, non-finite, non-positive,
    // unknown, or duplicate schedules should be fatal". Duplicate is absent on
    // purpose — a repeated key in a TypeScript object literal does not compile,
    // which is stronger than a runtime check.
    const good: ScheduleConfig = { everyMs: hours(6), leaseMs: hours(6), initialDelayMs: 0 };
    const ids = ["a"];
    expect(validateSchedules({}, ids).join()).toContain("has no entry for a");
    expect(validateSchedules({ a: good, b: good }, ids).join()).toContain("which is not a job this build knows about");
    expect(validateSchedules({ a: null }, ids).join()).toContain("is not an object");
    expect(validateSchedules({ a: { ...good, everyMs: undefined } }, ids).join()).toContain("has no everyMs");
    expect(validateSchedules({ a: { ...good, everyMs: "6h" } }, ids).join()).toContain("not a number");
    expect(validateSchedules({ a: { ...good, everyMs: Number.POSITIVE_INFINITY } }, ids).join()).toContain("not a finite number");
    expect(validateSchedules({ a: { ...good, everyMs: 0 } }, ids).join()).toContain("below the");
    expect(validateSchedules({ a: { ...good, everyMs: -1 } }, ids).join()).toContain("below the");
    expect(validateSchedules({ a: { ...good, everyMs: hours(24 * 30) } }, ids).join()).toContain("above the");
    expect(validateSchedules({ a: { ...good, leaseMs: 1 } }, ids).join()).toContain("below the");
    // THE FLOORS ARE THE ONLY BUDGET THERE IS UNTIL GATE 4 EXISTS, so they are
    // asserted as numbers rather than left to whatever the constants happen to
    // say. Fifteen minutes was the first value for `everyMs`, and two jobs at
    // fifteen minutes is 192 sessions a day against the twelve Greg asked for.
    expect(validateSchedules({ a: { ...good, everyMs: minutes(30) } }, ids).join()).toContain("below the");
    expect(validateSchedules({ a: { ...good, leaseMs: minutes(30) } }, ids).join()).toContain("below the");
    expect(validateSchedules({ a: { ...good, everyMs: hours(1), leaseMs: hours(1) } }, ids)).toEqual([]);
    expect(validateSchedules({ a: { ...good, initialDelayMs: -1 } }, ids).join()).toContain("below the");
    // ZERO IS FINE FOR THE DELAY AND NOWHERE ELSE. "Run as soon as we are armed"
    // is a thing to ask for; "run every 0ms" is not.
    expect(validateSchedules({ a: { ...good, initialDelayMs: 0 } }, ids)).toEqual([]);
  });

  test("a launch spacing at least as long as the shortest cadence is refused rather than clamped", () => {
    // Clamping would run a schedule nobody chose. Refusing disarms, loudly.
    expect(validateLaunchSeparation(hours(3), { a: { everyMs: hours(3), leaseMs: hours(1), initialDelayMs: 0 } }).join()).toContain("starved");
    expect(validateLaunchSeparation(minutes(30), { a: { everyMs: hours(3), leaseMs: hours(1), initialDelayMs: 0 } })).toEqual([]);
  });

  test("`hours` and `minutes` are what they say", () => {
    expect(hours(6)).toBe(21_600_000);
    expect(minutes(90)).toBe(5_400_000);
    expect(MINIMUM_EVERY_MS).toBe(hours(1));
  });
});

// ────────────────────────────────────────────────────────── S8-4, the lineage

describe("S8-4: a re-pin no longer discards a job's cadence", () => {
  const OLD: JobBehaviour = { id: "feedback-sweep", what: "the old instruction", documents: [], work: { kind: "session" }, dispatch: { kind: "live" } };
  const NEW: JobBehaviour = { id: "feedback-sweep", what: "the new instruction", documents: [], work: { kind: "session" }, dispatch: { kind: "live" } };

  function ran(behaviour: JobBehaviour, at: string, kind: "finished" | "started"): Occurrence {
    const key: OccurrenceKey = { jobId: behaviour.id, scheduledAt: at, behaviourHash: behaviourHash(behaviour) };
    const id = occurrenceId(key);
    const common = { id, key, reservedAt: at, instanceId: "instance-1", what: behaviour.what };
    return kind === "finished"
      ? { kind: "finished", ...common, finishedAt: at, outcome: { kind: "exited", code: 0 } }
      : { kind: "started", ...common, leaseUntil: "2999-01-01T00:00:00.000Z", startedAt: at, pid: 999 };
  }

  test("a run under the OLD behaviour still counts toward the NEW one's cadence", () => {
    // The defect: `lastRunOf` used to skip any occurrence whose hash differed
    // from the definition in front of it, so a re-pin made the whole history
    // vanish, `due` read the emptiness as `never`, and the job fired at once.
    const index = new Map<OccurrenceId, Occurrence>();
    const run = ran(OLD, "2026-09-09T10:00:00.000Z", "finished");
    index.set(run.id, run);
    expect(behaviourHash(OLD)).not.toBe(behaviourHash(NEW));
    const last = lastRunOf(index, NEW.id, Date.parse("2026-09-09T10:30:00.000Z"));
    expect(last).toEqual({ kind: "settled", at: "2026-09-09T10:00:00.000Z" });
    // And therefore NOT due: half an hour into a three-hour cadence.
    const verdict = due({ everyMs: hours(3), leaseMs: hours(6), initialDelayMs: 0 }, last, Date.parse("2026-09-09T10:30:00.000Z"), {
      kind: "armed",
      at: "2026-09-01T00:00:00.000Z",
    });
    expect(verdict.kind).toBe("not-due");
  });

  test("AND AN UNSETTLED LEGACY RUN STILL HOLDS THE JOB — the half that could have started two sessions", () => {
    // The dangerous half. A session dispatched under the old pin is `started`
    // and in flight; a re-pin used to hide it, so the next tick would launch a
    // second one over the top of it.
    const index = new Map<OccurrenceId, Occurrence>();
    const run = ran(OLD, "2026-09-09T10:00:00.000Z", "started");
    index.set(run.id, run);
    const last = lastRunOf(index, NEW.id, Date.parse("2026-09-09T10:01:00.000Z"));
    expect(last.kind).toBe("in-flight");
    const verdict = due({ everyMs: hours(3), leaseMs: hours(6), initialDelayMs: 0 }, last, Date.parse("2026-09-09T10:01:00.000Z"), {
      kind: "armed",
      at: "2026-09-01T00:00:00.000Z",
    });
    expect(verdict.kind).toBe("held");
  });

  test("another job's history is still another job's — lineage is the id, not everything in the index", () => {
    const index = new Map<OccurrenceId, Occurrence>();
    const run = ran(OLD, "2026-09-09T10:00:00.000Z", "finished");
    index.set(run.id, run);
    expect(lastRunOf(index, "get-ready-to-deploy", Date.parse("2026-09-09T10:30:00.000Z"))).toEqual({ kind: "never" });
  });
});

// ─────────────────────────────────────────────────────── S8-6, the arming fact

describe("S8-6: `armedAt` is durable, and the first run is deferred honestly", () => {
  test("a never-run job is not due until armedAt + initialDelayMs, and the sentence says so", () => {
    const schedule: ScheduleConfig = { everyMs: hours(6), leaseMs: hours(6), initialDelayMs: minutes(30) };
    const arming: Arming = { kind: "armed", at: "2026-09-09T12:00:00.000Z" };
    const early = due(schedule, { kind: "never" }, Date.parse("2026-09-09T12:10:00.000Z"), arming);
    expect(early).toEqual({ kind: "not-yet-eligible", firstEligibleAt: "2026-09-09T12:30:00.000Z", remainingMs: minutes(20) });
    const later = due(schedule, { kind: "never" }, Date.parse("2026-09-09T12:30:00.000Z"), arming);
    expect(later.kind).toBe("due");
  });

  test("MISSING OR UNREADABLE ARMING FAILS CLOSED, not open", () => {
    // Both wrong guesses are available and both are bad: "armed just now" defers
    // for ever, "armed long ago" dispatches everything at once.
    const held = due({ everyMs: hours(6), leaseMs: hours(6), initialDelayMs: 0 }, { kind: "never" }, Date.now(), {
      kind: "unknown",
      why: "the file is gone",
    });
    expect(held.kind).toBe("held");
    if (held.kind !== "held") return;
    expect(held.why).toContain("the file is gone");
  });

  test("NO SYNTHETIC OCCURRENCE: the ledger stays empty and `lastRunOf` goes on saying `never`", () => {
    // The forbidden implementation was writing a fake `finished` occurrence at
    // arming time so the jobs looked recently run. A fabricated run in a ledger
    // whose whole value is that it can be believed is worse than an early
    // dispatch.
    const store = tempDir();
    reconcileArming({ storeDir: store, armed: true, now: () => new Date("2026-09-09T12:00:00.000Z") });
    // Exactly one file, and it is not an event log.
    expect(readFileSync(join(store, ARMING_FILE), "utf8")).toContain("2026-09-09T12:00:00.000Z");
    expect(lastRunOf(new Map(), "get-ready-to-deploy", Date.now())).toEqual({ kind: "never" });
  });

  test("A RESTART DOES NOT POSTPONE THE FIRST RUN AGAIN — the whole reason it is on disk", () => {
    // "If it is relative to process startup, every restart postpones the first
    // run again; a repeatedly restarting service may remain armed for ever
    // without dispatching." — S8-6.
    const store = tempDir();
    const first = reconcileArming({ storeDir: store, armed: true, now: () => new Date("2026-09-09T12:00:00.000Z") });
    const second = reconcileArming({ storeDir: store, armed: true, now: () => new Date("2026-09-09T12:05:00.000Z") });
    const third = reconcileArming({ storeDir: store, armed: true, now: () => new Date("2026-09-09T18:00:00.000Z") });
    expect(first).toEqual({ kind: "armed", at: "2026-09-09T12:00:00.000Z" });
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  test("coming up DISARMED clears it, so arming again starts a fresh delay", () => {
    const store = tempDir();
    reconcileArming({ storeDir: store, armed: true, now: () => new Date("2026-09-09T12:00:00.000Z") });
    const off = reconcileArming({ storeDir: store, armed: false, now: () => new Date("2026-09-09T13:00:00.000Z") });
    expect(off.kind).toBe("unknown");
    expect(readArming(store)).toEqual({ kind: "absent" });
    const again = reconcileArming({ storeDir: store, armed: true, now: () => new Date("2026-09-09T14:00:00.000Z") });
    expect(again).toEqual({ kind: "armed", at: "2026-09-09T14:00:00.000Z" });
  });

  test("a corrupt record is `unknown` with a sentence, never a silently invented instant", () => {
    const store = tempDir();
    writeFileSync(join(store, ARMING_FILE), "{not json", "utf8");
    expect(readArming(store).kind).toBe("unusable");
    expect(reconcileArming({ storeDir: store, armed: true, now: () => new Date() }).kind).toBe("unknown");
    writeFileSync(join(store, ARMING_FILE), JSON.stringify({ armedAt: "the other day" }), "utf8");
    expect(reconcileArming({ storeDir: store, armed: true, now: () => new Date() }).kind).toBe("unknown");
  });
});

// ────────────────────────────────────────────────────── S8-5, the launch gate

describe("S8-5: a durable minimum separation between session launches", () => {
  const ARMED: Arming = { kind: "armed", at: "2026-09-01T00:00:00.000Z" };
  const NOW = new Date("2026-09-09T12:00:00.000Z");

  function sessionJob(id: string): AuthorisedJob {
    const behaviour: JobBehaviour = { id, what: `run ${id}`, documents: [], work: { kind: "session" }, dispatch: { kind: "live" } };
    return {
      definition: { behaviour, schedule: { everyMs: hours(6), leaseMs: hours(6), initialDelayMs: 0 } },
      authorisedDocuments: [],
      authorisedHash: behaviourHash(behaviour),
    };
  }

  /** A store that records what it was asked to append, so a test can see what actually landed. */
  function fakeStore(occurrences: Map<OccurrenceId, Occurrence> = new Map()): OccurrenceLog & { appended: OverseerEvent[] } {
    const appended: OverseerEvent[] = [];
    return {
      instanceId: "instance-1",
      occurrences,
      occurrenceHistory: { kind: "intact" },
      appended,
      append(events) {
        appended.push(...events);
        return { ok: true, appended: events.length, cursor: { events: appended.length, bytes: 0 } };
      },
    };
  }

  function spawner(): { spawn: SpawnJob; started: string[] } {
    const started: string[] = [];
    return {
      started,
      spawn: (definition) => {
        started.push(definition.behaviour.id);
        return { kind: "spawned", pid: 4242, done: new Promise<never>(() => undefined) };
      },
    };
  }

  test("TWO JOBS DUE IN ONE TICK: one is dispatched and the other is VISIBLY waiting", () => {
    // The catch-up case, which is the one a phase offset cannot survive: after
    // downtime both jobs are overdue in the same tick, whatever their phase was.
    const spawn = spawner();
    const reports = schedulerTick({
      definitions: [sessionJob("get-ready-to-deploy"), sessionJob("feedback-sweep")],
      store: fakeStore(),
      spawn: spawn.spawn,
      arming: ARMED,
      launchSeparationMs: minutes(30),
      readDocument: NO_DOCUMENTS,
      now: () => NOW,
    });
    expect(spawn.started).toEqual(["get-ready-to-deploy"]);
    const spaced = reports.find((report) => report.kind === "spacing-held");
    expect(spaced).toBeDefined();
    // VISIBLE, not silent. A skip nobody can see is how a job stops running
    // without anybody noticing.
    expect(spaced?.jobId).toBe("feedback-sweep");
    if (spaced?.kind !== "spacing-held") throw new Error("expected a spacing hold");
    expect(spaced.remainingMs).toBe(minutes(30));
    expect(spaced.why).toContain("waits");
  });

  test("AND IT IS DURABLE: a reservation from a previous process still holds the next launch", () => {
    // The half an in-memory counter would get wrong. A daemon restarted a minute
    // after launching a session must not launch another one.
    const key: OccurrenceKey = {
      jobId: "get-ready-to-deploy",
      scheduledAt: "2026-09-09T11:50:00.000Z",
      behaviourHash: "aaaaaaaaaaaa" as BehaviourHash,
    };
    const id = occurrenceId(key);
    const occurrences = new Map<OccurrenceId, Occurrence>([
      [
        id,
        {
          kind: "finished",
          id,
          key,
          reservedAt: "2026-09-09T11:50:00.000Z",
          instanceId: "a-previous-instance",
          what: "run it",
          finishedAt: "2026-09-09T11:51:00.000Z",
          outcome: { kind: "exited", code: 0 },
        },
      ],
    ]);
    const spawn = spawner();
    const reports = schedulerTick({
      // BOTH jobs, which is what the box always has: the gate reads the ledger
      // for the session jobs this daemon knows about, and a job absent from the
      // list is one that is not being scheduled at all. `lastSessionLaunchOf`
      // names that limitation.
      definitions: [sessionJob("get-ready-to-deploy"), sessionJob("feedback-sweep")],
      store: fakeStore(occurrences),
      spawn: spawn.spawn,
      arming: ARMED,
      launchSeparationMs: minutes(30),
      readDocument: NO_DOCUMENTS,
      now: () => NOW,
    });
    expect(spawn.started).toEqual([]);
    const spaced = reports.filter((report) => report.kind === "spacing-held").map((report) => report.jobId);
    expect(spaced).toEqual(["feedback-sweep"]);
    // `get-ready-to-deploy` is not spaced, it is simply not due — ten minutes
    // into a six-hour cadence. Two different facts, two different reports.
    expect(reports.find((report) => report.jobId === "get-ready-to-deploy")?.kind).toBe("waiting");
    // AND NOTHING WAS RESERVED. The gate is before the reservation, so a spaced
    // job leaves no trace that would ration the next one.
    expect(reports.some((report) => report.kind === "dispatched")).toBe(false);
  });

  test("a rule is not rationed by it, because a rule is not a session", () => {
    const behaviour: JobBehaviour = {
      id: "wedged-work",
      what: "look",
      documents: [],
      work: { kind: "rule", rule: { kind: "wedged-work", minAgeSeconds: 60, policy: "safe-to-kill", disposition: "propose" } }, dispatch: { kind: "live" },
    };
    const rule: AuthorisedJob = {
      definition: { behaviour, schedule: { everyMs: minutes(15), leaseMs: minutes(30), initialDelayMs: 0 } },
      authorisedDocuments: [],
      authorisedHash: behaviourHash(behaviour),
    };
    const spawn = spawner();
    const reports = schedulerTick({
      definitions: [sessionJob("get-ready-to-deploy"), rule],
      store: fakeStore(),
      spawn: spawn.spawn,
      // A rule with no `rules` capability is REFUSED rather than dispatched,
      // which is a settled outcome and exactly what this test wants: it proves
      // the rule reached `start`, past the spacing gate.
      arming: ARMED,
      launchSeparationMs: minutes(30),
      readDocument: NO_DOCUMENTS,
      now: () => NOW,
    });
    expect(spawn.started).toEqual(["get-ready-to-deploy"]);
    const forRule = reports.filter((report) => report.jobId === "wedged-work");
    expect(forRule.map((report) => report.kind)).not.toContain("spacing-held");
    expect(forRule.map((report) => report.kind)).toContain("refused");
  });

  test("`lastSessionLaunchOf` counts an uncertain run and ignores a refused one", () => {
    // A refusal means nothing started, so it must not ration. An `unknown` means
    // something MAY have started, and rationing is where the uncertain case
    // takes the cautious side.
    const make = (jobId: string, at: string, kind: "refused" | "unknown"): Occurrence => {
      const key: OccurrenceKey = { jobId, scheduledAt: at, behaviourHash: "aaaaaaaaaaaa" as BehaviourHash };
      const id = occurrenceId(key);
      const common = { id, key, reservedAt: at, instanceId: "i", what: "x" };
      return kind === "refused"
        ? { kind: "refused", ...common, refusedAt: at, why: "no dispatcher" }
        : { kind: "unknown", ...common, why: "nobody said", source: { kind: "derived" } };
    };
    const refused = make("a", "2026-09-09T11:00:00.000Z", "refused");
    const unknown = make("a", "2026-09-09T10:00:00.000Z", "unknown");
    const index = new Map<OccurrenceId, Occurrence>([
      [refused.id, refused],
      [unknown.id, unknown],
    ]);
    expect(lastSessionLaunchOf(index, new Set(["a"]))).toEqual({ kind: "at", at: "2026-09-09T10:00:00.000Z", jobId: "a" });
    expect(lastSessionLaunchOf(index, new Set(["b"]))).toEqual({ kind: "none" });
  });
});

// ─────────────────────────────────────────────── S8-7, the honest ARMED word

describe("S8-7: `ARMED` is a fact about the loaded definitions, not about an env var", () => {
  function job(id: string, work: JobBehaviour["work"], pinned: string | null): AuthorisedJob {
    const behaviour: JobBehaviour = { id, what: `run ${id}`, documents: [], work, dispatch: { kind: "live" } };
    return {
      definition: { behaviour, schedule: { everyMs: hours(6), leaseMs: hours(6), initialDelayMs: 0 } },
      authorisedDocuments: [],
      authorisedHash: (pinned ?? behaviourHash(behaviour)) as BehaviourHash,
    };
  }

  test("a job whose pin no longer matches is INELIGIBLE, whatever the environment says", () => {
    const [one] = eligibilityOf([job("get-ready-to-deploy", { kind: "session" }, "deadbeef1234")], { session: true, rules: true });
    expect(one?.kind).toBe("ineligible");
    if (one?.kind !== "ineligible") return;
    expect(one.why).toContain("deadbeef1234");
  });

  test("a session job in a process holding no dispatcher is INELIGIBLE, not merely quiet", () => {
    const [one] = eligibilityOf([job("get-ready-to-deploy", { kind: "session" }, null)], { session: false, rules: true });
    expect(one?.kind).toBe("ineligible");
    if (one?.kind !== "ineligible") return;
    expect(one.why).toContain("no session dispatcher");
  });

  test("an authorised job whose capability is held is eligible, and says nothing about the clock", () => {
    expect(eligibilityOf([job("get-ready-to-deploy", { kind: "session" }, null)], { session: true, rules: true })).toEqual([
      { kind: "eligible", jobId: "get-ready-to-deploy" },
    ]);
  });

  const AT = "2026-09-09T12:00:00.000Z";

  test("THE HEADLINE ITSELF: switched on with nothing runnable is BLOCKED, not ARMED", () => {
    // The defect, stated as a state: systemd active, the daemon healthy, the
    // status page's first line reading `ARMED`, and both standing jobs
    // unauthorised. A person reading that line would have been told the opposite
    // of the truth by the one thing they trusted.
    const standing = schedulerStandingOf({
      jobs: { definitions: [job("get-ready-to-deploy", { kind: "session" }, "deadbeef1234")], held: { session: true, rules: true } },
      detail: undefined,
      at: AT,
    });
    expect(standing.kind).toBe("blocked");
    expect(standing.why).toContain("NOT ONE loaded job can run");
    expect(standing.why).toContain("deadbeef1234");
  });

  test("and switched on with NO definitions at all is BLOCKED too, which used to be ARMED as well", () => {
    // A document that could not be read drops its job, so this is what a typo in
    // a path actually produces — the C1 failure with the environment variable
    // still saying yes.
    expect(schedulerStandingOf({ jobs: { definitions: [], held: { session: true, rules: true } }, detail: undefined, at: AT }).kind).toBe("blocked");
  });

  test("one runnable job out of two is ARMED, and the word counts them", () => {
    const standing = schedulerStandingOf({
      jobs: {
        definitions: [job("get-ready-to-deploy", { kind: "session" }, null), job("feedback-sweep", { kind: "session" }, "deadbeef1234")],
        held: { session: true, rules: true },
      },
      detail: undefined,
      at: AT,
    });
    expect(standing.kind).toBe("armed");
    expect(standing.why).toContain("1 of 2");
  });

  test("no jobs supplied at all is OFF — and OFF and BLOCKED are different states", () => {
    expect(schedulerStandingOf({ jobs: undefined, detail: undefined, at: AT }).kind).toBe("off");
  });

  test("a rules-only daemon is not ARMED on the strength of a session job it cannot start", () => {
    // The capability half. Under `rules-only` the process holds no dispatcher,
    // so a session job is ineligible — and a headline that ignored that would
    // claim the standing jobs were scheduled by a daemon structurally incapable
    // of starting one.
    const standing = schedulerStandingOf({
      jobs: { definitions: [job("get-ready-to-deploy", { kind: "session" }, null)], held: { session: false, rules: true } },
      detail: undefined,
      at: AT,
    });
    expect(standing.kind).toBe("blocked");
    expect(standing.why).toContain("no session dispatcher");
  });
});

// ──────────────────────────────────────────── S8-3, the activation command

describe("S8-3: the activation command cannot report success on the old unit", () => {
  const BASE = {
    installedUnit: "the unit",
    expectedUnit: "the unit",
    systemdActive: true,
    systemdDetail: "active",
    checkpointWrittenAt: "2026-09-09T12:00:10.000Z",
    checkpointScheduler: "armed" as const,
    restartedAt: "2026-09-09T12:00:00.000Z",
    eligibility: [{ kind: "eligible" as const, jobId: "get-ready-to-deploy" }, { kind: "eligible" as const, jobId: "feedback-sweep" }],
    requiredJobIds: ["get-ready-to-deploy", "feedback-sweep"],
    armed: true,
  };

  test("the happy path is the only one that exits zero", () => {
    expect(activationVerdict(BASE).ok).toBe(true);
  });

  test("A DRY-RUN JOB IS NEITHER A PROBLEM NOR CALLED ELIGIBLE — it is named as never dispatching", () => {
    // The fixture (plan 260910e D5) is pinned dry-run on purpose. It must not
    // stop activation, and "schedule-fixture is eligible" in the success notes
    // would tell whoever armed the box that a job will run which never will.
    const verdict = activationVerdict({
      ...BASE,
      eligibility: [...BASE.eligibility, { kind: "dry-run" as const, jobId: "schedule-fixture", why: "pinned as dry-run" }],
      requiredJobIds: [...BASE.requiredJobIds, "schedule-fixture"],
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.notes.join("\n")).not.toContain("schedule-fixture is eligible");
    expect(verdict.notes.join("\n")).toContain("schedule-fixture is dry-run");
  });

  test("THE FINDING ITSELF: the installed unit is not the one this checkout would install", () => {
    // `systemctl daemon-reload` rereads /etc/systemd/system/overseer.service and
    // never copies the repo file into it — so a daemon-reload/enable/restart
    // sequence restarts the OLD unit and every command in it exits zero.
    const verdict = activationVerdict({ ...BASE, installedUnit: "the unit as it was three deploys ago" });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join()).toContain("never copies the repo file into it");
  });

  test("no unit installed at all", () => {
    expect(activationVerdict({ ...BASE, installedUnit: null }).ok).toBe(false);
  });

  test("systemd does not say active", () => {
    const verdict = activationVerdict({ ...BASE, systemdActive: false, systemdDetail: "failed" });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join()).toContain("failed");
  });

  test("A STALE CHECKPOINT IS NOT A FRESH ONE, and it looks exactly like one", () => {
    // The previous daemon's opinion of a unit that no longer exists. Without the
    // comparison this is a file with a plausible timestamp in it.
    const verdict = activationVerdict({ ...BASE, checkpointWrittenAt: "2026-09-09T11:59:00.000Z" });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join()).toContain("before the restart");
  });

  test("no checkpoint at all after the restart", () => {
    expect(activationVerdict({ ...BASE, checkpointWrittenAt: null }).ok).toBe(false);
  });

  test("the daemon's OWN verdict is BLOCKED — switched on, nothing runnable", () => {
    const verdict = activationVerdict({ ...BASE, checkpointScheduler: "blocked" });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join()).toContain("not one loaded job can run");
  });

  test("armed was asked for and the daemon reports OFF", () => {
    expect(activationVerdict({ ...BASE, checkpointScheduler: "off", armed: true }).ok).toBe(false);
    // And the same reading is CORRECT when nothing was meant to be armed.
    expect(activationVerdict({ ...BASE, checkpointScheduler: "off", armed: false }).ok).toBe(true);
  });

  test("a named job is ineligible, or absent from the definitions entirely", () => {
    expect(
      activationVerdict({ ...BASE, eligibility: [{ kind: "ineligible", jobId: "feedback-sweep", why: "its pin moved" }, BASE.eligibility[0]!] }).ok,
    ).toBe(false);
    expect(activationVerdict({ ...BASE, eligibility: [BASE.eligibility[0]!] }).ok).toBe(false);
    expect(activationVerdict({ ...BASE, eligibility: [BASE.eligibility[0]!] }).problems.join()).toContain("not among the loaded job definitions");
  });

  test("the unit it would install is the checked-in one with the placeholder gone and the arming file named", () => {
    const source = readFileSync(join(REPO, UNIT_SOURCE), "utf8");
    const substituted = substitutedUnit(source, "greg");
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    expect(substituted.text).not.toContain("@USER@");
    expect(substituted.text).toContain("User=greg");
    // NO LEADING `-`. A missing arming file must be an error rather than a
    // silent disarm — S8-8.
    expect(substituted.text).toContain(`EnvironmentFile=${ARMING_ENV_FILE}`);
    expect(substituted.text).not.toContain(`EnvironmentFile=-${ARMING_ENV_FILE}`);
    expect(INSTALLED_UNIT).toBe("/etc/systemd/system/overseer.service");
  });

  test("a unit that does not read the arming file is refused before it can be installed", () => {
    const refused = substitutedUnit("[Service]\nUser=@USER@\n", "greg");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.why).toContain(ARMING_ENV_FILE);
  });

  test("no user to substitute is refused rather than installed with a placeholder", () => {
    expect(substitutedUnit("User=@USER@", "").ok).toBe(false);
  });
});

// ─────────────────────────────────────── the arming file itself, and the unit

describe("S8-8: arming is runtime state in a REQUIRED environment file", () => {
  const UNIT = readFileSync(join(REPO, UNIT_SOURCE), "utf8");
  const PROVISION = readFileSync(join(REPO, "infra/hetzner/provision.sh"), "utf8");

  test("the unit reads /etc/overseer.env, and NOT optionally", () => {
    expect(UNIT).toContain(`EnvironmentFile=${ARMING_ENV_FILE}`);
    expect(UNIT).not.toContain(`EnvironmentFile=-${ARMING_ENV_FILE}`);
  });

  test("THE UNIT NEVER HARDCODES THE ARMING, in any form", () => {
    // Hardcoding it makes every ordinary restart a re-arm, and a repo edit plus
    // a unit install the only way to disarm paid work at 3am. It is also one
    // careless edit away from arming a box: a unit file is exactly the sort of
    // file somebody skims and completes.
    expect(UNIT).not.toContain(`Environment=${JOBS_ENABLED_VAR}`);
    expect(UNIT).not.toMatch(new RegExp(`^Environment=.*${JOBS_ENABLED_VAR}`, "m"));
  });

  test("provisioning creates it ONCE, disarmed, and never overwrites an existing one", () => {
    // Whether this box may spend money unattended is its owner's decision, taken
    // at some later moment. A provisioning run that rewrote the file would
    // silently undo it — in either direction.
    expect(PROVISION).toContain("if test -e /etc/overseer.env; then");
    expect(PROVISION).toContain("left exactly as it is");
    expect(effective(PROVISION)).toContain(`${JOBS_ENABLED_VAR}=0`);
    // Atomic, like every other file provisioning writes into /etc.
    expect(PROVISION).toContain('mv -f -T "$overseer_env_tmp" /etc/overseer.env');
  });

  test("NOTHING THAT SHIPS ARMS ANYTHING — 8a is deliberately inert", () => {
    // Stage 8a arms nothing, and this is the assertion that says so rather than
    // a promise in a commit message.
    //
    // **Comments are stripped first, and that is not a loophole.** All three
    // files discuss `OVERSEER_JOBS_ENABLED=1` at length — the unit explains why
    // it does NOT hardcode it, and the activation command's usage block shows
    // the flag that writes it — so a raw substring search would go red on
    // exactly the documentation that makes the choice legible. What must not
    // exist is an EFFECTIVE line setting it.
    for (const [name, text] of [
      ["the unit", UNIT],
      ["provision.sh", PROVISION],
      ["the activation command", readFileSync(join(REPO, "scripts/overseer-activate.ts"), "utf8")],
    ] as const) {
      expect(`${name}: ${effective(text).includes(`${JOBS_ENABLED_VAR}=1`)}`).toBe(`${name}: false`);
    }
    // And the guard on the guard: with comments left in, all three DO mention
    // it — so a stripper that silently removed everything would make the
    // assertion above vacuous, which is the shape of every check that never
    // failed. (docs/reusable/silent-success.md.)
    expect(UNIT).toContain(`${JOBS_ENABLED_VAR}=1`);
  });
});

/**
 * A file with its comment lines removed, so an assertion about what a file DOES
 * is not an assertion about what it says.
 *
 * `#` covers the unit files and the shell script, `//` and a leading `*` cover
 * TypeScript and its block comments. Crude, and it does not need to be more:
 * over-stripping can only make the searches above find less, and every one of
 * them is a `not.toContain`, so the failure direction is a red test rather than
 * a missed arming — except for the one positive assertion beside it, which is
 * there for exactly that reason.
 */
function effective(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"));
    })
    .join("\n");
}

// ────────────────────────────────────────── the reports a reader actually sees

describe("the two new states are readable in the log", () => {
  test("both say what a person needs, and neither is a bare 'skipped'", () => {
    const lines: SchedulerReport[] = [
      { kind: "not-yet-eligible", jobId: "feedback-sweep", firstEligibleAt: "2026-09-09T13:30:00.000Z", remainingMs: minutes(90) },
      { kind: "spacing-held", jobId: "feedback-sweep", remainingMs: minutes(20), why: "a Claude session was launched 600s ago" },
    ];
    const described = lines.map((report) => describeReport(report));
    expect(described[0]).toContain("never run; first eligible at 2026-09-09T13:30:00.000Z");
    expect(described[1]).toContain("WAITING FOR SPACING");
  });
});
