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
 * **Since plan 260910f (scheduled dispatch) a session job starts through the
 * launch protocol and nothing else**, so every tick here that launches a
 * session does it through a REAL launch store and admission owner in a temp
 * dir, with a fake `tmux-headless` launcher that writes down which job each
 * invocation was for (`tests/overseer-scheduled-dispatch.test.ts`'s harness, cut
 * down). A session's history is that journal; the rules keep `events.jsonl`,
 * and the two scenarios that were about a lease are now a rule's, because only
 * a rule has one.
 *
 * Nothing here reads the wall clock, and no id in this file is a uuid:
 * `tests/fixture-ids.test.ts` fails the suite on a uuid shared between two
 * test files.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
} from "../tools/overseer/jobs.js";
import { openLocalAdmission, type LocalAdmission } from "../tools/overseer/launch-admission.js";
import { readArtefacts, writeExitFile } from "../tools/overseer/launch-artefacts.js";
import { composeLaunchProtocol, type LaunchProtocol, type Launcher, type RunSpec } from "../tools/overseer/launch-protocol.js";
import { openLaunchStore, type LaunchStore } from "../tools/overseer/launch-store.js";
import {
  planJobs,
  resolveEvidence,
  type AccountChoice,
  type DocumentEvidence,
  type JobPlan,
  type Launch,
  type ReadDocumentBytes,
} from "../tools/overseer/schedule-plan.js";
import { eligibilityOf, schedulerStandingOf, schedulerTick, type OccurrenceLog, type SchedulerLaunch, type SchedulerReport, type TickInput } from "../tools/overseer/scheduler.js";
import { hours, minutes } from "../tools/overseer/schedules.js";

const roots: string[] = [];
const worlds: World[] = [];
afterEach(() => {
  for (const one of worlds.splice(0)) one.kill();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-schedule-plan-test-"));
  roots.push(root);
  return root;
}

/** A clock the test moves by hand, backwards as well as forwards. */
function fakeClock(startIso: string): { now: () => Date; set(iso: string): void; advance(ms: number): void } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), set: (iso) => (ms = Date.parse(iso)), advance: (by) => (ms += by) };
}

const ARMED_LONG_AGO: Arming = { kind: "armed", at: "2026-09-01T00:00:00.000Z" };
const NO_SPACING = 0;
const RUN: RunSpec = { timeoutMinutes: 30, access: "read-only" };
const ACCOUNTS: AccountChoice = { chosen: { kind: "chosen", account: "pool-a", notes: [] }, standing: () => ({ kind: "clear" }) };

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
  const behaviour: JobBehaviour = { id, what: options.what ?? `run ${id}`, documents, work: { kind: "session", run: RUN }, dispatch: options.dispatch ?? LIVE };
  return {
    definition: {
      behaviour,
      schedule: { everyMs: options.everyMs ?? hours(3), leaseMs: options.leaseMs ?? hours(1), initialDelayMs: options.initialDelayMs ?? 0 },
    },
    authorisedHash: behaviourHash(behaviour),
    authorisedDocuments: documents,
  };
}

function ruleJob(id: string, documents: readonly JobDocument[] = [], schedule = { everyMs: minutes(15), leaseMs: minutes(2), initialDelayMs: 0 }): AuthorisedJob {
  const behaviour: JobBehaviour = {
    id,
    what: `look for ${id}`,
    documents,
    work: { kind: "rule", rule: { kind: "wedged-work", minAgeSeconds: 60, policy: "safe-to-kill", disposition: "propose" } },
    dispatch: LIVE,
  };
  return {
    definition: { behaviour, schedule },
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

/** The same documents' bytes, as the material reader sees them: the pinned digest, and some text. */
const pinnedBytes: ReadDocumentBytes = (path) => ({ kind: "read", path, sha256: path === DOC.path ? DOC.sha256 : "b".repeat(64), bytes: Buffer.from(`the text of ${path}\n`, "utf8") });

/** The rules' ledger: records what it was asked to append. Its index does not move. A session job writes nothing to it. */
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

/* ------------------------------------------------------------------ *
 * A real launch protocol, cut down.
 * ------------------------------------------------------------------ */

type World = {
  readonly launch: SchedulerLaunch;
  readonly protocol: LaunchProtocol;
  readonly store: LaunchStore;
  /** The job each launcher invocation was for, in order — the launcher's own tally, read back from the journal's record. */
  readonly started: string[];
  /** Every launch still in flight ends now, with an exit record, and reconciliation settles it. */
  endAll(): void;
  kill(): void;
};

function world(now: () => Date, options: { readonly refuseFirst?: boolean } = {}): World {
  const root = tempRoot();
  const opened = openLaunchStore({ root, now });
  if (!opened.ok) throw new Error(`launch store refused: ${JSON.stringify(opened.refusal)}`);
  const owned = openLocalAdmission({ root, now });
  if (!owned.ok) throw new Error(`owner refused: ${JSON.stringify(owned.refusal)}`);
  const store = opened.store;
  const owner: LocalAdmission = owned.owner;
  const sessions = join(root, "sessions");
  const started: string[] = [];
  let refusals = options.refuseFirst === true ? 1 : 0;
  const launcher: Launcher = {
    kind: "tmux-headless",
    launch(input) {
      if (refusals > 0) {
        refusals -= 1;
        return { kind: "refused-before-effect", why: "the test's launcher refused this one before doing anything" };
      }
      const origin = store.fold().occurrences.get(input.occurrenceId)?.origin;
      started.push(origin?.kind === "schedule" ? origin.jobId : "?");
      mkdirSync(sessions, { recursive: true });
      writeFileSync(join(sessions, input.correlationId), "");
      return { kind: "started", detail: "a pretend tmux session" };
    },
  };
  const protocol = composeLaunchProtocol({
    journal: store,
    owner,
    launchers: { "tmux-headless": launcher },
    evidence: {
      artefacts: (dir, correlationId) => readArtefacts(dir, correlationId),
      identity: () => ({ kind: "cannot-tell", why: "no process is probed in this test" }),
      boot: () => ({ read: true, id: "boot-one" }),
      tmux: (correlationId) => (existsSync(join(sessions, correlationId)) ? { kind: "found", sessionId: "$1" } : { kind: "absent" }),
    },
    now,
  });
  let closed = false;
  const made: World = {
    protocol,
    store,
    started,
    launch: {
      launchOccurrence: protocol.launchOccurrence,
      resumeOccurrence: protocol.resumeOccurrence,
      abandon: protocol.abandon,
      view: () => ({ status: () => store.status(), fold: () => store.fold(), attemptDir: (id, attempt) => store.attemptDir(id, attempt) }),
    },
    endAll() {
      for (const record of store.fold().occurrences.values()) {
        if (record.state !== "launching" && record.state !== "observed-running") continue;
        const { attempt, correlationId } = record.current;
        writeExitFile(store.attemptDir(record.id, attempt), {
          v: 1,
          kind: "exit",
          correlationId,
          at: now().toISOString(),
          ending: { kind: "exited", code: 0 },
          verdict: { kind: "ok" },
          usageLimit: false,
          permissionDenials: 0,
          answer: null,
          transcript: null,
        });
        unlinkSync(join(sessions, correlationId));
      }
      protocol.reconcile();
    },
    kill() {
      if (closed) return;
      closed = true;
      store.close();
      owner.close();
    },
  };
  worlds.push(made);
  return made;
}

/** The jobs the launch journal holds occurrences of, in fold order. */
function planned(w: World): string[] {
  return [...w.store.fold().occurrences.values()].map((record) => (record.origin.kind === "schedule" ? record.origin.jobId : "?"));
}

/** A tick with this file's defaults: every capability a session needs, and whatever the test overrides. */
function tick(w: World | null, input: Pick<TickInput, "definitions" | "now"> & Partial<TickInput>): readonly SchedulerReport[] {
  return schedulerTick({
    store: fakeStore(),
    launch: w?.launch,
    accounts: ACCOUNTS,
    readDocument: pinnedReader(),
    readDocumentBytes: pinnedBytes,
    arming: ARMED_LONG_AGO,
    launchSeparationMs: NO_SPACING,
    ...input,
  });
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

/** `job:outcome` for a launch, `job:kind` for everything else. */
function kinds(reports: readonly SchedulerReport[]): string[] {
  return reports.map((report) => (report.kind === "launch" ? `${report.jobId}:${report.outcome.kind}` : `${report.jobId}:${report.kind}`));
}

// ───────────────────────────────────────────────────────────── red first

describe("duplicate ids: every definition sharing an id is refused BEFORE anything is planned (red first)", () => {
  test("ZERO LAUNCHES, and both duplicates are refused — not the second one only", () => {
    // RED FIRST, on the code before `schedule-plan.ts`: the loop refused an id
    // only when it met it the SECOND time, so the first definition had already
    // been reserved and spawned while the report said "neither can be addressed"
    // (Sol's P1-5). The assertion that matters is the launch count, not the
    // presence of a refusal — the old code had a refusal too.
    const w = world(() => new Date("2026-09-10T12:00:00.000Z"));
    const store = fakeStore();
    const reports = tick(w, {
      definitions: [sessionJob("twin"), sessionJob("twin", { what: "something else entirely" }), sessionJob("bystander")],
      store,
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(w.started).toEqual(["bystander"]);
    expect(kinds(reports)).toEqual(["twin:duplicate-id", "twin:duplicate-id", "bystander:invoked"]);
    // AND NOTHING WAS PLANNED FOR EITHER TWIN, in either ledger. A plan is the
    // first durable write of a launch.
    expect(planned(w)).toEqual(["bystander"]);
    expect(store.appended).toEqual([]);
  });

  test("the duplicate is refused wherever it sits in the list, including last", () => {
    const w = world(() => new Date("2026-09-10T12:00:00.000Z"));
    const reports = tick(w, {
      definitions: [sessionJob("bystander"), ruleJob("twin"), sessionJob("twin")],
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(w.started).toEqual(["bystander"]);
    expect(reports.filter((report) => report.jobId === "twin").map((report) => report.kind)).toEqual(["duplicate-id", "duplicate-id"]);
  });
});

describe("dry-run: due, and nothing reserved or launched (red first)", () => {
  test("a due dry-run job reports `dry-run`, writes NOTHING to either ledger, and does not count against spacing", () => {
    // RED FIRST: before `dispatch` existed the field was invisible and the job
    // was simply dispatched.
    const w = world(() => new Date("2026-09-10T12:00:00.000Z"));
    const store = fakeStore();
    const reports = tick(w, {
      definitions: [sessionJob("fixture", { dispatch: { kind: "dry-run", why: "a harmless fixture nobody has made live" } }), sessionJob("real")],
      store,
      // A LIVE GATE, and the second job still launches: a dry run started
      // nothing, so it must not ration the job behind it.
      launchSeparationMs: minutes(30),
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(kinds(reports)).toEqual(["fixture:dry-run", "real:invoked"]);
    expect(w.started).toEqual(["real"]);
    // A last attempt that never happened would corrupt the ledger.
    expect(planned(w)).toEqual(["real"]);
    expect(store.appended).toEqual([]);
    const dry = reports[0];
    expect(dry?.kind === "dry-run" && dry.why).toContain("a harmless fixture nobody has made live");
  });

  test("and it stays due, every tick, rather than acquiring a last run it never had", () => {
    const clock = fakeClock("2026-09-10T12:00:00.000Z");
    const w = world(clock.now);
    const store = fakeStore();
    const input = { definitions: [sessionJob("fixture", { dispatch: { kind: "dry-run", why: "fixture" } })], store, now: clock.now };
    expect(kinds(tick(w, input))).toEqual(["fixture:dry-run"]);
    clock.advance(minutes(1));
    expect(kinds(tick(w, input))).toEqual(["fixture:dry-run"]);
    expect(store.appended).toEqual([]);
    expect(planned(w)).toEqual([]);
  });
});

describe("fresh document evidence, every tick (red first)", () => {
  test("A DOCUMENT EDITED AFTER THE DAEMON BUILT ITS DEFINITIONS IS REFUSED, not launched under the old digest", () => {
    // RED FIRST, and this is defect 1 of the plan: the definition in memory
    // still names the old digest and still matches its pin, while the session it
    // launches would follow the document as it is now — so between an edit and
    // the next restart, unattended authority grew silently.
    const w = world(() => new Date("2026-09-10T12:00:00.000Z"));
    const reports = tick(w, {
      definitions: [sessionJob("sweep")],
      readDocument: (path) => ({ kind: "read", path, sha256: "c".repeat(64) }),
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(w.started).toEqual([]);
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
    const w = world(() => new Date("2026-09-10T12:00:00.000Z"));
    const reports = tick(w, {
      definitions: [sessionJob("sweep")],
      readDocument: (path) => ({ kind: "unreadable", path, why: "ENOENT: it has gone" }),
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(w.started).toEqual([]);
    expect(kinds(reports)).toEqual(["sweep:unauthorised"]);
    expect(reports[0]?.kind === "unauthorised" && reports[0].why).toContain("ENOENT: it has gone");
  });

  test("a rule job keeps its LOAD-TIME digests: its documents are never re-read", () => {
    // Characterisation on the old code (which read nothing), and a guard on the
    // new: a rule's "documents" are the source of code already loaded into the
    // daemon, so re-reading them would refuse a rule whose running code has not
    // moved (plan § D3).
    const reads: string[] = [];
    const reports = tick(null, {
      definitions: [ruleJob("wedged", [{ path: "tools/overseer/rules.ts", sha256: "d".repeat(64) }])],
      readDocument: pinnedReader(reads),
      now: () => new Date("2026-09-10T12:00:00.000Z"),
    });
    // REFUSED at `start` for want of a `rules` capability — which is to say it
    // got past the authorisation gate on its load-time digest.
    expect(kinds(reports)).toEqual(["wedged:refused"]);
    expect(reads).toEqual([]);
  });

  test("a session job that reads back exactly as pinned launches, and the documents were read THIS tick", () => {
    const reads: string[] = [];
    const w = world(() => new Date("2026-09-10T12:00:00.000Z"));
    tick(w, { definitions: [sessionJob("sweep")], readDocument: pinnedReader(reads), now: () => new Date("2026-09-10T12:00:00.000Z") });
    expect(w.started).toEqual(["sweep"]);
    expect(reads).toEqual([DOC.path]);
  });
});

// ─────────────────────────────────────────────────────── characterisation

describe("the planner scenarios of plan § D2 (characterisation: these passed on the old `due()`)", () => {
  const NOW = "2026-09-10T12:00:00.000Z";

  /** A launch made at `startIso` and ended at `endIso`: the journal then says the job last ran, and ended, then. */
  function ranAndEnded(job: AuthorisedJob, startIso: string, endIso: string): { w: World; clock: ReturnType<typeof fakeClock> } {
    const clock = fakeClock(startIso);
    const w = world(clock.now);
    expect(kinds(tick(w, { definitions: [job], now: clock.now }))).toEqual([`${job.definition.behaviour.id}:invoked`]);
    clock.set(endIso);
    w.endAll();
    return { w, clock };
  }

  test("startup: arming unknown holds a never-run job, loudly", () => {
    const w = world(() => new Date(NOW));
    const reports = tick(w, { definitions: [sessionJob("fresh")], arming: { kind: "unknown", why: "armed.json is missing" }, now: () => new Date(NOW) });
    expect(kinds(reports)).toEqual(["fresh:held"]);
    expect(reports[0]?.kind === "held" && reports[0].why).toContain("armed.json is missing");
  });

  test("startup: armed, it is not-yet-eligible until armedAt + initialDelayMs, and due at exactly that instant", () => {
    const job = sessionJob("fresh", { initialDelayMs: hours(2) });
    const arming: Arming = { kind: "armed", at: "2026-09-10T10:00:00.000Z" };
    const clock = fakeClock("2026-09-10T12:00:00.000Z");
    clock.advance(-1);
    const w = world(clock.now);
    const early = tick(w, { definitions: [job], arming, now: clock.now });
    expect(early).toEqual([{ kind: "not-yet-eligible", jobId: "fresh", firstEligibleAt: "2026-09-10T12:00:00.000Z", remainingMs: 1 }]);
    clock.advance(1);
    const onTime = tick(w, { definitions: [job], arming, now: clock.now });
    expect(kinds(onTime)).toEqual(["fresh:invoked"]);
  });

  test("interval boundary: ended + everyMs − 1 is waiting, ended + everyMs is due", () => {
    const job = sessionJob("steady", { everyMs: hours(3) });
    const { w, clock } = ranAndEnded(job, "2026-09-10T08:55:00.000Z", "2026-09-10T09:00:00.000Z");
    clock.set(new Date(Date.parse("2026-09-10T09:00:00.000Z") + hours(3) - 1).toISOString());
    expect(tick(w, { definitions: [job], now: clock.now })).toEqual([{ kind: "waiting", jobId: "steady", remainingMs: 1 }]);
    clock.advance(1);
    expect(kinds(tick(w, { definitions: [job], now: clock.now }))).toEqual(["steady:invoked"]);
  });

  test("missed intervals: three days down on a 3h job is ONE launch across repeated ticks, then held", () => {
    const job = sessionJob("steady", { everyMs: hours(3), leaseMs: hours(1) });
    const { w, clock } = ranAndEnded(job, "2026-09-07T12:00:00.000Z", "2026-09-07T12:05:00.000Z");
    // The box is down for three days: twenty-four intervals missed.
    clock.advance(hours(72));
    w.protocol.reconcile();
    expect(kinds(tick(w, { definitions: [job], now: clock.now }))).toEqual(["steady:invoked"]);
    for (let i = 0; i < 5; i += 1) {
      clock.advance(30_000);
      w.protocol.reconcile();
      expect(kinds(tick(w, { definitions: [job], now: clock.now }))).toEqual(["steady:held"]);
    }
    // One run for the whole outage, not a replay of it.
    expect(w.started).toEqual(["steady", "steady"]);
  });

  test("forward time jump: a clock thirty days ahead is one run, not thirty days of them", () => {
    const job = sessionJob("steady");
    const { w, clock } = ranAndEnded(job, "2026-09-10T11:55:00.000Z", NOW);
    clock.set(new Date(Date.parse(NOW) + hours(24 * 30)).toISOString());
    expect(kinds(tick(w, { definitions: [job], now: clock.now }))).toEqual(["steady:invoked"]);
    clock.advance(30_000);
    expect(kinds(tick(w, { definitions: [job], now: clock.now }))).toEqual(["steady:held"]);
    expect(w.started).toEqual(["steady", "steady"]);
    expect(planned(w)).toEqual(["steady", "steady"]);
  });

  test("backward time jump: the next run stays at the absolute ended + everyMs", () => {
    // The clock goes back an hour past the last run's end. `due` measures from
    // it, so the remaining time grows by exactly the jump — the next run is
    // still at ended + everyMs on the calendar, not everyMs from "now".
    const job = sessionJob("steady", { everyMs: hours(3) });
    const { w, clock } = ranAndEnded(job, "2026-09-10T11:55:00.000Z", NOW);
    clock.set(new Date(Date.parse(NOW) - hours(1)).toISOString());
    expect(tick(w, { definitions: [job], now: clock.now })).toEqual([{ kind: "waiting", jobId: "steady", remainingMs: hours(4) }]);
  });

  test("a session launch in flight holds its job with NO lease: before, at and long after the old lease would have run out, and it is never retried", () => {
    // Re-scoped by plan 260910f (scheduled dispatch): a session no longer has a
    // lease — "timeout alone is not proof" — so it is held until evidence or
    // Greg moves it. The lease scenario below is a rule's now.
    const job = sessionJob("busy", { everyMs: hours(3), leaseMs: hours(1) });
    const clock = fakeClock("2026-09-10T11:00:00.000Z");
    const w = world(clock.now);
    expect(kinds(tick(w, { definitions: [job], now: clock.now }))).toEqual(["busy:invoked"]);
    for (const at of ["2026-09-10T11:30:00.000Z", "2026-09-10T12:00:01.000Z", "2026-09-10T18:00:00.000Z"]) {
      clock.set(at);
      w.protocol.reconcile();
      expect(kinds(tick(w, { definitions: [job], now: clock.now }))).toEqual(["busy:held"]);
    }
    expect(w.started).toEqual(["busy"]);
  });

  test("a RULE already running: held inside its lease; released as STUCK after it, and never retried", () => {
    // The lease scenario, on the one kind of job that still has a lease.
    const reservedAt = "2026-09-10T11:00:00.000Z";
    const leaseUntil = "2026-09-10T12:00:00.000Z";
    const job = ruleJob("busy", [], { everyMs: hours(3), leaseMs: hours(1), initialDelayMs: 0 });
    const inside = tick(null, { definitions: [job], store: fakeStore(index(startedAt("busy", reservedAt, leaseUntil))), now: () => new Date("2026-09-10T11:30:00.000Z") });
    expect(kinds(inside)).toEqual(["busy:held"]);
    const after = tick(null, { definitions: [job], store: fakeStore(index(startedAt("busy", reservedAt, leaseUntil))), now: () => new Date("2026-09-10T12:00:01.000Z") });
    // The sweep reports it and releases the guard; the job then measures its
    // cadence from the reservation, so it WAITS rather than going again.
    expect(kinds(after)).toEqual(["busy:stuck", "busy:waiting"]);
  });
});

describe("report sequences the refactor must not move (characterisation)", () => {
  const NOW = new Date("2026-09-10T12:00:00.000Z");

  test("sweep first, then dispatch, in one tick", () => {
    // A rule's, since only a rule is swept: the stuck run is reported, the guard
    // released, and the same tick then reaches the rule's `start` — refused here
    // for want of a rule runner, which is past every gate.
    const stuck = startedAt("busy", "2026-09-10T06:00:00.000Z", "2026-09-10T07:00:00.000Z");
    const job = ruleJob("busy", [], { everyMs: hours(3), leaseMs: hours(1), initialDelayMs: 0 });
    const reports = tick(null, { definitions: [job], store: fakeStore(index(stuck)), now: () => NOW });
    expect(kinds(reports)).toEqual(["busy:stuck", "busy:refused"]);
  });

  test("a lost history holds every job WHOSE HISTORY IT IS — duplicates included, because gate 1 comes before the id check (F2)", () => {
    // The rules' ledger lost: the rule is held, and the session twins still meet
    // the duplicate gate, because their history is the launch journal.
    const w = world(() => NOW);
    const ledgerLost = tick(w, {
      definitions: [sessionJob("a"), sessionJob("a"), ruleJob("r")],
      store: fakeStore(new Map(), { kind: "lost", why: "the log had a hole in it" }),
      now: () => NOW,
    });
    expect(kinds(ledgerLost)).toEqual(["a:duplicate-id", "a:duplicate-id", "r:history-lost"]);
    // No launch journal at all: the session twins are held on it BEFORE the id
    // check, and the rule, whose ledger is whole, is not.
    const noJournal = tick(null, { definitions: [sessionJob("a"), sessionJob("a"), ruleJob("r")], now: () => NOW });
    expect(kinds(noJournal)).toEqual(["a:history-lost", "a:history-lost", "r:refused"]);
    expect(w.started).toEqual([]);
  });

  test("a session / rule / session mix under a live gate: launched, refused, spacing-held", () => {
    const w = world(() => NOW);
    const reports = tick(w, { definitions: [sessionJob("first"), ruleJob("rule"), sessionJob("second")], launchSeparationMs: minutes(30), now: () => NOW });
    expect(kinds(reports)).toEqual(["first:invoked", "rule:refused", "second:spacing-held"]);
    expect(w.started).toEqual(["first"]);
  });

  test("a launcher that REFUSES moves no spacing clock, so the next session job still goes (characterisation)", () => {
    const w = world(() => NOW, { refuseFirst: true });
    const reports = tick(w, { definitions: [sessionJob("first"), sessionJob("second")], launchSeparationMs: minutes(30), now: () => NOW });
    expect(kinds(reports)).toEqual(["first:failed-before-launch", "second:invoked"]);
    expect(w.started).toEqual(["second"]);
  });
});

// ─────────────────────────────── the planner itself, as the preview will read it

describe("planJobs, asked directly — the verdicts the preview will print", () => {
  const NOW_MS = Date.parse("2026-09-10T12:00:00.000Z");

  function plan(
    definitions: readonly AuthorisedJob[],
    options: {
      occurrences?: Map<OccurrenceId, Occurrence>;
      /** The launch journal's history — every session job's. */
      sessionHistory?: OccurrenceLog["occurrenceHistory"];
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
        history: { rules: { kind: "intact" }, sessions: options.sessionHistory ?? { kind: "intact" } },
        arming: ARMED_LONG_AGO,
        launchSeparationMs: options.separationMs ?? NO_SPACING,
        nowMs: options.nowMs ?? NOW_MS,
        evidence: options.evidence ?? resolveEvidence(definitions, pinnedReader()),
        accounts: ACCOUNTS,
      },
      {
        launch: (job, how) => {
          launched.push(job.definition.behaviour.id);
          return options.launch?.(job, how) ?? true;
        },
        supersede: () => {
          throw new Error("no test in this describe has a waiting launch to supersede");
        },
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
    expect(plan(twins, { sessionHistory: { kind: "lost", why: "a hole" } }).plans.map((one) => one.kind)).toEqual(["history-lost", "history-lost"]);
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
