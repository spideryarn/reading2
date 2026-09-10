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
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { runOverseer, type DaemonOptions, type DaemonOutcome } from "../tools/overseer/daemon.js";
import type { OverseerEvent } from "../tools/overseer/diff.js";
import {
  behaviourHash,
  occurrenceId,
  type Arming,
  type AuthorisedJob,
  type JobDefinition,
  type JobOutcome,
  type JobSpawn,
  type SpawnJob,
} from "../tools/overseer/jobs.js";
import { readNotes, type DaemonNote } from "../tools/overseer/notes.js";
import type { ReadDocument } from "../tools/overseer/schedule-plan.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import { EVENTS_FILE, LOCK_FILE } from "../tools/overseer/store.js";

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

/** Real milliseconds, only so the daemon's timers fire. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`);
    await sleep(5);
  }
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
  behaviour: { id: "restart-probe", what: "a job for the restart test", documents: [], work: { kind: "session" }, dispatch: { kind: "live" } },
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
 * THE ONE `jobs` OPTION both runs are given, and the dispatcher's own tally —
 * every occurrence it was asked to start, across both runs.
 */
function jobsWith(settle: (id: string) => JobSpawn): { jobs: NonNullable<DaemonOptions["jobs"]>; dispatched: string[] } {
  const dispatched: string[] = [];
  const spawn: SpawnJob = (_definition, key) => {
    const id = occurrenceId(key);
    dispatched.push(id);
    return settle(id);
  };
  return {
    dispatched,
    jobs: { intervalMs: 5, arming: ARMED, launchSeparationMs: 0, readDocument: NO_DOCUMENTS, definitions: [AUTHORISED], spawn },
  };
}
const NEVER: JobSpawn = { kind: "spawned", pid: 7171, done: new Promise<JobOutcome>(() => undefined) };

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
    const { jobs, dispatched } = jobsWith(() => NEVER);

    // ── RUN 1: dispatched, started, never finished — then stopped by the signal.
    const first = await runDaemon(root, fakeClock(T0), jobs, async (controller) => {
      await waitFor("the first dispatch", () => dispatched.length >= 1);
      await sleep(40); // many more jobs ticks, none of which may dispatch again
      controller.abort();
    });
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
        await sleep(60);
        duringLease = {
          dispatched: dispatched.length,
          kinds: kindsFor(root, original),
          held: lines.some((line) => line.includes("job restart-probe: held")),
        };
        // Past the lease, on the daemon's own clock.
        clock.advance(60_000);
        await waitFor("a dispatch after the lease ran out", () => dispatched.length >= 2);
        await sleep(40);
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
  }, 20_000);

  test("killed IN THE SPAWN WINDOW: run 2 writes the reservation down as abandoned and never dispatches it", async () => {
    const root = tempRoot();
    // A pid that is certainly dead: a child that has already exited. The lock is
    // overwritten with it from INSIDE the dispatcher, so the reservation lands,
    // the spawn happens, and the acknowledgement is refused — the bytes a
    // `kill -9` between spawn and `started` leaves (overseer-jobs.test.ts, row 3).
    // A dead holder is what lets run 2 take the lock over, as it would after a kill.
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid;
    if (deadPid === undefined) throw new Error("could not mint a dead pid");
    const { jobs, dispatched } = jobsWith(() => {
      // THE FIRST DISPATCH ONLY. The same `jobs` object serves run 2, whose own
      // dispatch must not take run 2's lock away.
      if (dispatched.length > 1) return NEVER;
      writeFileSync(
        join(root, LOCK_FILE),
        `${JSON.stringify({ pid: deadPid, instanceId: "a-daemon-that-was-killed", hostname: hostname(), startedAt: T0 })}\n`,
      );
      return NEVER;
    });

    const first = await runDaemon(root, fakeClock(T0), jobs, async () => {
      await waitFor("the first dispatch", () => dispatched.length >= 1);
      await sleep(40);
    });
    // It lost its lock, so it stopped writing — which is the point of the lock.
    expect(first.kind).toBe("lock-lost");
    expect(dispatched).toHaveLength(1);
    const [original] = dispatched;
    if (original === undefined) throw new Error("no dispatch");
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved"]);

    // ── RUN 2, ten seconds on: inside the period, so nothing new is due yet.
    const clock = fakeClock(at(10_000));
    let beforePeriod: { dispatched: number; kinds: string[] } | null = null;
    const second = await runDaemon(root, clock, jobs, async (controller) => {
      await sleep(60);
      beforePeriod = { dispatched: dispatched.length, kinds: kindsFor(root, original) };
      clock.advance(60_000);
      await waitFor("the next occurrence, a full period on", () => dispatched.length >= 2);
      await sleep(40);
      controller.abort();
    });
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
  }, 20_000);

  test("THE CONTROL: a cleanly finished run is not re-dispatched, and a genuinely new occurrence is dispatched exactly once", async () => {
    const root = tempRoot();
    const { jobs, dispatched } = jobsWith(() => ({ kind: "spawned", pid: 7272, done: Promise.resolve({ kind: "exited", code: 0 }) }));

    const first = await runDaemon(root, fakeClock(T0), jobs, async (controller) => {
      await waitFor("the first run to finish", () => eventsIn(root).some((event) => event.kind === "job-occurrence-finished"));
      await sleep(40);
      controller.abort();
    });
    expect(first.kind).toBe("stopped");
    expect(dispatched).toHaveLength(1);
    const [original] = dispatched;
    if (original === undefined) throw new Error("no dispatch");
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "job-occurrence-finished"]);

    // ── RUN 2, ten seconds on, then a full period on.
    const clock = fakeClock(at(10_000));
    let beforePeriod = -1;
    const second = await runDaemon(root, clock, jobs, async (controller) => {
      await sleep(60);
      beforePeriod = dispatched.length;
      clock.advance(60_000);
      await waitFor("the next occurrence, a full period on", () => dispatched.length >= 2);
      await sleep(60); // more ticks: the new one must not be dispatched twice either
      controller.abort();
    });
    expect(second.kind).toBe("stopped");

    expect(beforePeriod).toBe(1);
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).not.toBe(original);
    expect(dispatched[1]).toContain(`@${at(70_000)}#`);
    // The finished run stays finished: nothing unaccounted anywhere.
    expect(kindsFor(root, original)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "job-occurrence-finished"]);
    expect(notesIn(root).filter((note) => note.kind === "job-unaccounted")).toEqual([]);
    expect(existsSync(join(root, LOCK_FILE))).toBe(false);
  }, 20_000);
});
