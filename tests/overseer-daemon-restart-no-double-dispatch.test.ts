/**
 * Two daemons, one store, the same jobs — and no occurrence dispatched twice.
 * Plan 260910f § Stage 4.
 *
 * `overseer-jobs.test.ts` proves the crash windows at the store level, one
 * `schedulerTick` at a time; `overseer-daemon.test.ts` runs one daemon with jobs.
 * Nothing ran the REAL `runOverseer` twice on one root with the same `jobs`
 * option, which is what a `Restart=always` daemon does every time it is killed.
 * So each test here is: run 1 dispatches and is stopped at a chosen point; run 2
 * opens the same root on a fresh clock with the very same `jobs` object.
 *
 * Three stopping points, because the ledger has three shapes after a stop:
 *
 *  - **mid-lease** — `reserved` + `started`, no `finished` (the dispatcher never
 *    resolves, and the daemon is aborted). Run 2 past the job's due time but
 *    inside the lease must HOLD, not dispatch; past the lease it writes the run
 *    down as unaccounted (`lease-expired`) and only then runs a NEW occurrence.
 *  - **in the spawn window** — `reserved` only: the process died between the
 *    spawn and its acknowledgement. Run 2 writes it down as unaccounted
 *    (`reservation-abandoned`) and never dispatches it.
 *  - **the control** — a run that finished cleanly. Run 2 does not re-dispatch
 *    it either, and a genuinely new occurrence a full period later IS dispatched,
 *    exactly once — so none of this can pass by "never dispatches anything".
 *
 * The source is scripted (sockets are the other file's business); every root is
 * a mkdtemp; no dispatcher here starts a process.
 *
 * **The job is a RULE** since plan 260910f (scheduled dispatch): a session job
 * starts through the launch protocol and writes nothing to `events.jsonl`, so
 * these three ledger shapes are a rule's. Its `observe` stands where the
 * spawner stood — called after the reservation is durable and before `started`
 * — and a never-settling one is what "the dispatcher never resolves" now means.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { runOverseer, type DaemonOptions, type DaemonOutcome } from "../tools/overseer/daemon.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import { behaviourHash, type Arming, type AuthorisedJob, type JobDefinition } from "../tools/overseer/jobs.js";
import { readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import type { ProposingRuleWork } from "../tools/overseer/rule-protocol.js";
import type { RuleObservation } from "../tools/overseer/rules.js";
import type { ReadDocument } from "../tools/overseer/schedule-plan.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import { EVENTS_FILE, LOCK_FILE } from "../tools/overseer/store.js";
import { until } from "./helpers/overseer-until.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-restart-test-"));
  roots.push(root);
  return root;
}

/** A clock the test moves by hand. Each run gets a fresh one — the restart is a new process. */
function fakeClock(startIso: string): { now: () => Date; advance(ms: number): void } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by) => (ms += by) };
}

/**
 * How many passes the jobs scheduler has COMPLETED, read off the injected `log`.
 *
 * On the paths this file's fixture takes (the store writes succeed), every
 * pass plans each definition once and logs one verdict line for it — `held`,
 * `not due…`, `dispatched…` — whether or not it dispatches, so this counts the
 * callback a "nothing was dispatched" assertion is about. It is not exact in
 * general: a failed start acknowledgement logs two lines for one pass. The sweep's
 * `STUCK` / `UNACCOUNTED` lines are extra lines in a pass, not passes, so they
 * are left out. NOT the heartbeat's tick count: that is a separate timer, and it
 * can advance while the scheduler never runs (plan 261004c, review finding F5).
 */
function passes(lines: readonly string[]): number {
  return lines.filter((line) => line.startsWith("job restart-probe: ") && !/^job restart-probe: (STUCK|UNACCOUNTED) /.test(line)).length;
}

/**
 * Wait until the scheduler has demonstrably run `n` MORE passes. A negative
 * assertion goes after this, never after a sleep: over a fixed window it passes
 * vacuously on a box too loaded to fit a pass in (postmortem 260930a).
 */
async function morePasses(lines: readonly string[], n = 5): Promise<void> {
  const before = passes(lines);
  await until(`${n} more scheduler passes after the first ${before}`, () => passes(lines) >= before + n);
}

function eventsIn(root: string): OverseerEvent[] {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as OverseerEvent);
}

/** The scheduler's events for one occurrence, in order. */
function kindsFor(root: string, id: string): string[] {
  return eventsIn(root)
    .filter((event) => "occurrenceId" in event && event.occurrenceId === id)
    .map((event) => event.kind);
}

function notesIn(root: string): DaemonNote[] {
  const read = readNotes(root);
  if (read.kind === "unreadable") throw new Error(read.cause);
  return read.notes;
}

const JOB: JobDefinition = {
  behaviour: {
    id: "restart-probe",
    what: "a rule for the restart test",
    documents: [],
    work: { kind: "rule", rule: { kind: "wedged-work", minAgeSeconds: 4 * 3600, policy: "safe-to-kill", disposition: "propose" } },
    dispatch: { kind: "live" },
  },
  // Due every minute, a two-minute lease: so "past due, inside the lease" is a
  // real window (60–120s after a dispatch), which is where overlap would happen.
  schedule: { everyMs: 60_000, leaseMs: 120_000, initialDelayMs: 0 },
};
const AUTHORISED: AuthorisedJob = { definition: JOB, authorisedDocuments: [], authorisedHash: behaviourHash(JOB.behaviour) };
/** Long before any clock here, with `initialDelayMs: 0`, so a never-run job is due on the first tick. */
const ARMED: Arming = { kind: "armed", at: "2026-09-10T00:00:00.000Z" };
const NO_DOCUMENTS: ReadDocument = (path) => ({ kind: "unreadable", path, why: "no job in this file leans on a document" });

const T0 = "2026-09-10T10:00:00.000Z";
const at = (offsetMs: number): string => new Date(Date.parse(T0) + offsetMs).toISOString();

/**
 * THE ONE `jobs` OPTION both runs are given, and the runner's own tally —
 * every occurrence it was asked to start, across both runs.
 *
 * `observe` is handed the spec and not the occurrence, so the id is read off
 * the disk: the reservation is durable before `observe` is called, so the
 * newest reservation there is this run's.
 */
function jobsWith(root: string, look: () => Promise<RuleObservation>): { jobs: NonNullable<DaemonOptions["jobs"]>; dispatched: string[] } {
  const dispatched: string[] = [];
  const rules: ProposingRuleWork = {
    selfPid: 7171,
    observe: () => {
      const reserved = eventsIn(root).filter((event) => event.kind === "job-occurrence-reserved");
      const newest = reserved.at(-1);
      dispatched.push(newest?.kind === "job-occurrence-reserved" ? newest.occurrenceId : "(no reservation on the disk)");
      return look();
    },
  };
  return {
    dispatched,
    // A short grace: a run still looking when a daemon stops is written off
    // after this, rather than holding the shutdown for the default fifteen seconds.
    jobs: { intervalMs: 5, arming: ARMED, launchSeparationMs: 0, readDocument: NO_DOCUMENTS, definitions: [AUTHORISED], rules, settleGraceMs: 20 },
  };
}
/** A look that never answers: the run stays `started`, which is the mid-lease shape. */
const NEVER = (): Promise<RuleObservation> => new Promise(() => undefined);
/** A look that answers at once with nothing to do: the run settles and finishes. */
const NOTHING = async (): Promise<RuleObservation> => ({ kind: "wedged", candidates: [], scanned: 1 });

/**
 * One daemon on `root`, over a source that yields nothing and ends when
 * `script` returns. The script is handed the controller, so it can stop the
 * daemon by its signal — the way systemd's SIGTERM reaches it.
 */
async function runDaemon(
  root: string,
  clock: ReturnType<typeof fakeClock>,
  jobs: NonNullable<DaemonOptions["jobs"]>,
  script: (controller: AbortController) => Promise<void>,
  lines: string[] = [],
): Promise<DaemonOutcome> {
  const controller = new AbortController();
  return runOverseer({
    root,
    baseUrl: "http://127.0.0.1:0",
    signal: controller.signal,
    now: clock.now,
    tickMs: 5,
    log: (line) => lines.push(line),
    probe: () => ({ read: false, why: "not read in a test" }),
    bootId: () => null,
    recovery: { projectsDir: join(root, "no-transcripts-here") },
    // A source that says nothing and ends when the script does: the first
    // `next()` waits for it and reports done.
    source: () => ({
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<SourceMessage>> => {
          await script(controller);
          return { done: true, value: undefined };
        },
      }),
    }),
    jobs,
  });
}

describe("a restarted daemon does not dispatch an occurrence twice", () => {
  test("killed MID-LEASE: run 2 past the due time holds; past the lease it writes the run down and starts only a NEW one", async () => {
    const root = tempRoot();
    const { jobs, dispatched } = jobsWith(root, NEVER);

    // ── RUN 1: dispatched, started, never finished — then stopped by the signal.
    const firstLines: string[] = [];
    const first = await runDaemon(
      root,
      fakeClock(T0),
      jobs,
      async (controller) => {
        await until("the first dispatch", () => dispatched.length >= 1);
        await morePasses(firstLines); // counted, none of which may dispatch again
        controller.abort();
      },
      firstLines,
    );
    expect(first.kind).toBe("stopped");
    expect(dispatched).toHaveLength(1);
    const [original] = dispatched;
    if (original === undefined) throw new Error("no dispatch");
    expect(original).toContain(`@${T0}#`);
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved", "job-occurrence-started"]);
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);

    // ── RUN 2: a fresh clock 90s on — PAST the 60s due time, INSIDE the 120s lease.
    const clock = fakeClock(at(90_000));
    const lines: string[] = [];
    let duringLease: { dispatched: number; kinds: string[]; held: boolean } | null = null;
    const second = await runDaemon(
      root,
      clock,
      jobs,
      async (controller) => {
        await morePasses(lines);
        duringLease = {
          dispatched: dispatched.length,
          kinds: kindsFor(root, original),
          held: lines.some((line) => line.includes("job restart-probe: held")),
        };
        // Past the lease, on the daemon's own clock.
        clock.advance(60_000);
        await until("a dispatch after the lease ran out", () => dispatched.length >= 2);
        await morePasses(lines);
        controller.abort();
      },
      lines,
    );
    expect(second.kind).toBe("stopped");

    // Inside the lease: NOT dispatched, and not called unknown either — the
    // child can outlive the daemon that started it, so "in flight" is the truth.
    expect(duringLease).toEqual({ dispatched: 1, kinds: ["job-occurrence-reserved", "job-occurrence-started"], held: true });

    // Past it: written down as unaccounted, durably, and never re-run...
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "job-occurrence-unknown"]);
    const unaccounted = notesIn(root).filter((note) => note.kind === "job-unaccounted");
    expect(unaccounted).toHaveLength(1);
    expect(unaccounted[0]?.kind === "job-unaccounted" && unaccounted[0].occurrenceId).toBe(original);
    expect(unaccounted[0]?.kind === "job-unaccounted" && unaccounted[0].reason).toBe("lease-expired");
    // ...and the job's NEXT occurrence, a different key at the new instant, runs once.
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).not.toBe(original);
    expect(dispatched[1]).toContain(`@${at(150_000)}#`);
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);
  });

  test("killed IN THE SPAWN WINDOW: run 2 writes the reservation down as abandoned and never dispatches it", async () => {
    const root = tempRoot();
    // A pid that is certainly dead: a child that has already exited. The lock is
    // overwritten with it from INSIDE the dispatcher, so the reservation lands,
    // the spawn happens, and the acknowledgement is refused — the bytes a
    // `kill -9` between spawn and `started` leaves (overseer-jobs.test.ts, row 3).
    // A dead holder is what lets run 2 take the lock over, as it would after a kill.
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    if (deadPid === undefined) throw new Error("could not mint a dead pid");
    const { jobs, dispatched } = jobsWith(root, () => {
      // THE FIRST DISPATCH ONLY. The same `jobs` object serves run 2, whose own
      // dispatch must not take run 2's lock away.
      if (dispatched.length > 1) return NEVER();
      writeFileSync(
        join(root, LOCK_FILE),
        `${JSON.stringify({ pid: deadPid, instanceId: "a-daemon-that-was-killed", hostname: hostname(), startedAt: T0 })}\n`,
      );
      return NEVER();
    });

    const firstLines: string[] = [];
    const first = await runDaemon(
      root,
      fakeClock(T0),
      jobs,
      async () => {
        await until("the first dispatch", () => dispatched.length >= 1);
        // Until a write has found the lock gone and said so, which halts the
        // scheduler. It was a fixed 40 ms while the daemon stopped without a
        // word (plan 261004g).
        await until("the daemon to say the lock is gone", () => firstLines.some((line) => line.includes("the lock is gone")));
      },
      firstLines,
    );
    // It lost its lock, so it stopped writing — which is the point of the lock.
    expect(first.kind).toBe("lock-lost");
    expect(dispatched).toHaveLength(1);
    const [original] = dispatched;
    if (original === undefined) throw new Error("no dispatch");
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved"]);

    // ── RUN 2, ten seconds on: inside the period, so nothing new is due yet.
    const clock = fakeClock(at(10_000));
    let beforePeriod: { dispatched: number; kinds: string[] } | null = null;
    const lines: string[] = [];
    const second = await runDaemon(
      root,
      clock,
      jobs,
      async (controller) => {
        await morePasses(lines);
        beforePeriod = { dispatched: dispatched.length, kinds: kindsFor(root, original) };
        clock.advance(60_000);
        await until("the next occurrence, a full period on", () => dispatched.length >= 2);
        await morePasses(lines);
        controller.abort();
      },
      lines,
    );
    expect(second.kind).toBe("stopped");

    // Written down once, as the abandoned reservation it is, and not retried.
    expect(beforePeriod).toEqual({ dispatched: 1, kinds: ["job-occurrence-reserved", "job-occurrence-unknown"] });
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved", "job-occurrence-unknown"]);
    const unaccounted = notesIn(root).filter((note) => note.kind === "job-unaccounted");
    expect(unaccounted).toHaveLength(1);
    expect(unaccounted[0]?.kind === "job-unaccounted" && unaccounted[0].occurrenceId).toBe(original);
    expect(unaccounted[0]?.kind === "job-unaccounted" && unaccounted[0].reason).toBe("reservation-abandoned");
    // The job itself is not stranded: its next occurrence ran, once.
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).not.toBe(original);
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);
  });

  test("THE CONTROL: a cleanly finished run is not re-dispatched, and a genuinely new occurrence is dispatched exactly once", async () => {
    const root = tempRoot();
    const { jobs, dispatched } = jobsWith(root, NOTHING);

    const firstLines: string[] = [];
    const first = await runDaemon(
      root,
      fakeClock(T0),
      jobs,
      async (controller) => {
        await until("the first run to finish", () => eventsIn(root).some((event) => event.kind === "job-occurrence-finished"));
        await morePasses(firstLines);
        controller.abort();
      },
      firstLines,
    );
    expect(first.kind).toBe("stopped");
    expect(dispatched).toHaveLength(1);
    const [original] = dispatched;
    if (original === undefined) throw new Error("no dispatch");
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "rule-settled", "job-occurrence-finished"]);

    // ── RUN 2, ten seconds on, then a full period on.
    const clock = fakeClock(at(10_000));
    let beforePeriod = -1;
    const lines: string[] = [];
    const second = await runDaemon(
      root,
      clock,
      jobs,
      async (controller) => {
        await morePasses(lines);
        beforePeriod = dispatched.length;
        clock.advance(60_000);
        await until("the next occurrence, a full period on", () => dispatched.length >= 2);
        await morePasses(lines); // more passes: the new one must not be dispatched twice either
        controller.abort();
      },
      lines,
    );
    expect(second.kind).toBe("stopped");

    expect(beforePeriod).toBe(1);
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).not.toBe(original);
    expect(dispatched[1]).toContain(`@${at(70_000)}#`);
    // The finished run stays finished: nothing unaccounted anywhere.
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "rule-settled", "job-occurrence-finished"]);
    expect(notesIn(root).filter((note) => note.kind === "job-unaccounted")).toEqual([]);
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);
  });
});
