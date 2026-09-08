/**
 * Job occurrences, the lease, and the four crash windows.
 *
 * **Every test here is about a run that did or did not happen while nobody was
 * looking**, so almost none of them assert on the return value of the call that
 * was supposed to do the work. They assert on the BYTES IN `events.jsonl` and on
 * what a *second* store, opened afterwards from those bytes, derives — because
 * the failure this whole area has is a plausible history rather than a broken
 * one, and a scheduler that returns `{dispatched}` while having spawned nothing
 * looks exactly like one that worked.
 *
 * ## The crash-window table, one test per row
 *
 * GPT Sol's review of docs/plans/260908g-… contains a table of where a crash can
 * land relative to the spawn, and its point is that **ordering cannot close the
 * middle rows, only name them**. So rows 2 and 3 are asserted to produce the
 * SAME on-disk shape and the SAME derived state, deliberately: that
 * indistinguishability is the finding, and a test that made them different would
 * be testing a claim the code has no right to make.
 *
 * ## The clock is always injected
 *
 * Nothing here calls `Date.now()`, so a lease can run out in the middle of a
 * synchronous test without a timer.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { JobEvent, OverseerEvent } from "../tools/overseer/diff.js";
import {
  JOB_DEFINITION_HASHED_FIELDS,
  UNKNOWN_RETENTION,
  adoptOccurrence,
  authorisationOf,
  definitionHash,
  due,
  foldOccurrences,
  lastRunOf,
  leaseExpired,
  occurrenceId,
  standingOf,
  stuckOccurrences,
  type AuthorisedJob,
  type JobDefinition,
  type Occurrence,
  type OccurrenceId,
} from "../tools/overseer/jobs.js";
import type { JobSpawn, SpawnJob } from "../tools/overseer/jobs.js";
import { describeReport, schedulerTick, type LostRecord, type OccurrenceLog, type SchedulerReport } from "../tools/overseer/scheduler.js";
import {
  EVENTS_FILE,
  LOCK_FILE,
  RECONCILE_FILE,
  describeOpening,
  openStore,
  readCheckpoint,
  type AppendResult,
  type OverseerStore,
} from "../tools/overseer/store.js";

const opened: OverseerStore[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-jobs-test-"));
  roots.push(root);
  return root;
}

/** A clock the test moves by hand. There is no other clock in this file. */
function fakeClock(startIso: string): { now: () => Date; advance(ms: number): void } {
  let ms = Date.parse(startIso);
  return { now: () => new Date(ms), advance: (by) => (ms += by) };
}

function mustOpen(root: string, now: () => Date): OverseerStore {
  const result = openStore({ root, now });
  if (!result.ok) throw new Error(`the store would not open: ${JSON.stringify(result.refusal)}`);
  opened.push(result.store);
  return result.store;
}

/** Close a store the way a crash would not — but leave the bytes exactly as a crash would. */
function closeStore(store: OverseerStore): void {
  const index = opened.indexOf(store);
  if (index !== -1) opened.splice(index, 1);
  store.close();
}

function eventsIn(root: string): OverseerEvent[] {
  const path = join(root, EVENTS_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as OverseerEvent);
}

function kindsIn(root: string): string[] {
  return eventsIn(root).map((event) => event.kind);
}

const JOB: JobDefinition = {
  id: "get-ready-to-deploy",
  everyMs: 60_000,
  leaseMs: 120_000,
  what: "npm run get-ready-to-deploy",
  documents: [],
  work: { kind: "session" },
};

/**
 * A job pinned to its own current fingerprint, which is what "authorised" means
 * for every test here that is not ABOUT the pin.
 *
 * Self-pinning in the helper is safe precisely because two tests below do the
 * opposite deliberately: `authorisationOf` and the scheduler are both exercised
 * against a pin that does NOT match, so a gate that stopped working would go red
 * there rather than being hidden here.
 */
function authorised(definition: JobDefinition): AuthorisedJob {
  return { definition, authorisedHash: definitionHash(definition) };
}

/** A spawn that succeeds and whose work settles when the test says so. */
function spawnRecorder(options: { pid?: number; settle?: "immediately" | "never" } = {}): {
  spawn: SpawnJob;
  calls: JobDefinition[];
  finish(code: number): void;
} {
  const calls: JobDefinition[] = [];
  let resolve: ((code: number) => void) | null = null;
  const spawn: SpawnJob = (definition) => {
    calls.push(definition);
    const done =
      options.settle === "never"
        ? new Promise<never>(() => undefined)
        : new Promise<{ kind: "exited"; code: number }>((r) => {
            resolve = (code) => r({ kind: "exited", code });
          });
    return { kind: "spawned", pid: options.pid ?? 4242, done };
  };
  return { spawn, calls, finish: (code) => resolve?.(code) };
}

/** Let the `done` promise's `.then` run. The completion append is a microtask, not a timer. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function tick(store: OccurrenceLog, spawn: SpawnJob, now: () => Date, definitions: readonly JobDefinition[] = [JOB]): readonly SchedulerReport[] {
  return schedulerTick({ definitions: definitions.map(authorised), store, spawn, now });
}

function reportKinds(reports: readonly SchedulerReport[]): string[] {
  return reports.map((report) => report.kind);
}

describe("a definition's fingerprint", () => {
  test("is stable, and moves when any field of the definition moves", () => {
    expect(definitionHash(JOB)).toBe(definitionHash({ ...JOB }));
    expect(definitionHash({ ...JOB, what: `${JOB.what} --force` })).not.toBe(definitionHash(JOB));
    expect(definitionHash({ ...JOB, everyMs: 61_000 })).not.toBe(definitionHash(JOB));
    expect(definitionHash({ ...JOB, leaseMs: 1 })).not.toBe(definitionHash(JOB));
    expect(definitionHash({ ...JOB, id: "other" })).not.toBe(definitionHash(JOB));
  });

  test("THE FIELD LIST IS THE TYPE'S OWN, so a field added later cannot sit outside the fingerprint", () => {
    // GPT Sol's SC-4. The assertions above name today's fields by hand, and the
    // destructure they were written against is not exhaustive in TypeScript — so
    // a seventh field on `JobDefinition` would compile perfectly and never reach
    // the hash that authorises the job.
    //
    // `JOB_DEFINITION_HASHED_FIELDS` is derived from the encoder table rather
    // than typed out here, so reverting to a destructure deletes the table and
    // takes this test with it; and a new field is a compile error in the table
    // before it is ever a red line here.
    expect([...JOB_DEFINITION_HASHED_FIELDS].sort()).toEqual(Object.keys(JOB).sort());
  });

  test("cannot be fooled by a field that contains the canonical form's own separators", () => {
    // THE TEST THIS REPLACED WAS NAMED FOR A PROPERTY IT DID NOT TEST. It used
    // `{id:"ab", what:"c"}` against `{id:"a", what:"bc"}`, which the field
    // labels and newlines already separate — so deleting the length prefixes
    // left it green, and mutation testing said so.
    //
    // These two are a REAL collision without the prefixes: `what` is a prompt
    // and prompts have newlines in them, so a definition whose id carries the
    // rest of the canonical form inside it hashes the same as the honest one.
    // Two different authorised instructions with one fingerprint is exactly the
    // edit the hash exists to detect.
    const a = definitionHash({ id: "x\neveryMs:5\nleaseMs:6\nwhat:y", everyMs: 1, leaseMs: 2, what: "z", documents: [], work: { kind: "session" } });
    const b = definitionHash({ id: "x", everyMs: 5, leaseMs: 6, what: "y\neveryMs:1\nleaseMs:2\nwhat:z", documents: [], work: { kind: "session" } });
    expect(a).not.toBe(b);
  });

  test("an edited definition inherits no history — AND THAT IS NOT WHAT STOPS IT RUNNING", async () => {
    // THIS TEST USED TO STOP AT THE FIRST HALF, and GPT Sol's C2 was that the
    // half it stopped at is the unsafe one: a job with no history reads as
    // `never`, `due()` calls `never` immediately due, so an edit dispatched the
    // edited version AT ONCE — the exact opposite of the runbook's "never act on
    // a job definition that changed after it was authorised".
    //
    // So both halves, and the second is the one that matters: history
    // separation, then the gate that actually refuses.
    const index = new Map<OccurrenceId, Occurrence>();
    const key = { jobId: JOB.id, scheduledAt: "2026-09-08T10:00:00.000Z", definitionHash: definitionHash(JOB) };
    index.set(occurrenceId(key), {
      kind: "finished",
      id: occurrenceId(key),
      key,
      reservedAt: "2026-09-08T10:00:00.000Z",
      instanceId: "i1",
      what: JOB.what,
      finishedAt: "2026-09-08T10:00:05.000Z",
      outcome: { kind: "exited", code: 0 },
    });
    const edited: JobDefinition = { ...JOB, what: "rm -rf /" };
    expect(lastRunOf(index, JOB, Date.parse("2026-09-08T10:00:10.000Z")).kind).toBe("settled");
    expect(lastRunOf(index, edited, Date.parse("2026-09-08T10:00:10.000Z")).kind).toBe("never");
    // AND `never` IS DUE. Stated here rather than left implicit, because this is
    // the step the old test walked past: without the pin, the two lines above
    // are a dispatch rather than a defence.
    expect(due(edited, { kind: "never" }, Date.parse("2026-09-08T10:00:10.000Z")).kind).toBe("due");

    // THE GATE. The pin still names the definition that was authorised, so the
    // edited one is refused and nothing is spawned and nothing is written down.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T10:00:10.000Z");
    const store = mustOpen(root, clock.now);
    const runner = spawnRecorder();
    const reports = schedulerTick({
      definitions: [{ definition: edited, authorisedHash: definitionHash(JOB) }],
      store,
      spawn: runner.spawn,
      now: clock.now,
    });
    expect(reportKinds(reports)).toEqual(["unauthorised"]);
    expect(runner.calls).toEqual([]);
    expect(kindsIn(root)).toEqual([]);
    await settle();
    expect(kindsIn(root)).toEqual([]);
  });

  test("the pin says both hashes, because re-authorising means copying the second one", () => {
    const edited: JobDefinition = { ...JOB, what: "rm -rf /" };
    const verdict = authorisationOf({ definition: edited, authorisedHash: definitionHash(JOB) });
    expect(verdict.kind).toBe("unauthorised");
    if (verdict.kind !== "unauthorised") return;
    expect(verdict.authorised).toBe(definitionHash(JOB));
    expect(verdict.found).toBe(definitionHash(edited));
    expect(verdict.why).toContain(definitionHash(edited));
    expect(authorisationOf({ definition: JOB, authorisedHash: definitionHash(JOB) }).kind).toBe("authorised");
  });

  test("editing the DOCUMENT a job points at moves the fingerprint, even though the instruction is unchanged", () => {
    // The runbook's own words, under gate 3: "The jobs here ARE documents, so
    // editing a doc could otherwise enlarge what you may do unattended." A
    // fingerprint over the prompt alone covers the pointer and not the thing
    // pointed at, so this is the case that makes the pin worth having at all.
    const before: JobDefinition = { ...JOB, documents: [{ path: "docs/reusable/get-ready-to-deploy.md", sha256: "aaaa" }] };
    const after: JobDefinition = { ...JOB, documents: [{ path: "docs/reusable/get-ready-to-deploy.md", sha256: "bbbb" }] };
    expect(before.what).toBe(after.what);
    expect(definitionHash(before)).not.toBe(definitionHash(after));
    expect(authorisationOf({ definition: after, authorisedHash: definitionHash(before) }).kind).toBe("unauthorised");
    // And the count is in the canonical form, so a second document is a
    // different job rather than a longer string that happens to concatenate.
    expect(definitionHash({ ...JOB, documents: [] })).not.toBe(definitionHash(before));
  });
});

describe("due(), which is state-based on purpose", () => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");

  test("a job that has never run is due", () => {
    expect(due(JOB, { kind: "never" }, now)).toEqual({ kind: "due", sinceMs: 0 });
  });

  test("a job that finished a moment ago is not, and says how long is left", () => {
    const verdict = due(JOB, { kind: "settled", at: new Date(now - 20_000).toISOString() }, now);
    expect(verdict).toEqual({ kind: "not-due", remainingMs: 40_000 });
  });

  test("a job due while the daemon was down is due on the next tick, however long it was down", () => {
    // The argument for hand-rolling rather than cron, which skips silently, or
    // `systemd Persistent=true`, which catches up exactly once. Three hours of
    // downtime does not become three runs and does not become none.
    const verdict = due(JOB, { kind: "settled", at: new Date(now - 3 * 3600_000).toISOString() }, now);
    expect(verdict.kind).toBe("due");
  });

  test("a run in flight holds the job whatever the interval says", () => {
    const verdict = due(
      JOB,
      { kind: "in-flight", since: new Date(now - 3600_000).toISOString(), leaseUntil: new Date(now + 60_000).toISOString() },
      now,
    );
    expect(verdict.kind).toBe("held");
  });

  test("a run nobody could account for anchors the interval rather than stopping the job for ever", () => {
    // The S6 shape, at the arithmetic level: an unresolved occurrence must not
    // be a permanent hold, because one crash would then be a job that never runs
    // again — with a green heartbeat over it.
    const stale = { kind: "unresolved", at: new Date(now - 3600_000).toISOString(), why: "…" } as const;
    expect(due(JOB, stale, now).kind).toBe("due");
    const recent = { kind: "unresolved", at: new Date(now - 1_000).toISOString(), why: "…" } as const;
    expect(due(JOB, recent, now).kind).toBe("not-due");
  });
});

describe("the lease", () => {
  const key = { jobId: JOB.id, scheduledAt: "2026-09-08T12:00:00.000Z", definitionHash: definitionHash(JOB) };
  const started: Occurrence = {
    kind: "started",
    id: occurrenceId(key),
    key,
    reservedAt: "2026-09-08T12:00:00.000Z",
    instanceId: "i1",
    leaseUntil: "2026-09-08T12:02:00.000Z",
    what: JOB.what,
    startedAt: "2026-09-08T12:00:00.100Z",
    pid: 4242,
  };

  test("is in flight before its deadline and stuck after it", () => {
    expect(standingOf(started, Date.parse("2026-09-08T12:01:00.000Z"))).toEqual({
      kind: "in-flight",
      leaseUntil: "2026-09-08T12:02:00.000Z",
      remainingMs: 60_000,
    });
    expect(standingOf(started, Date.parse("2026-09-08T12:03:00.000Z"))).toEqual({
      kind: "stuck",
      leaseUntil: "2026-09-08T12:02:00.000Z",
      overdueMs: 60_000,
    });
  });

  test("a settled run has no deadline left to miss", () => {
    const finished: Occurrence = {
      kind: "finished",
      id: started.id,
      key,
      reservedAt: started.reservedAt,
      instanceId: "i1",
      what: JOB.what,
      finishedAt: "2026-09-08T12:00:30.000Z",
      outcome: { kind: "exited", code: 0 },
    };
    expect(leaseExpired(finished, Date.parse("2027-01-01T00:00:00.000Z"))).toBe(false);
    expect(stuckOccurrences(new Map([[finished.id, finished]]), Date.parse("2027-01-01T00:00:00.000Z"))).toEqual([]);
  });

  test("a stuck run is NOT reported as in flight, which is the whole of the S6 fix", () => {
    const index = new Map([[started.id, started]]);
    expect(lastRunOf(index, JOB, Date.parse("2026-09-08T12:01:00.000Z")).kind).toBe("in-flight");
    expect(lastRunOf(index, JOB, Date.parse("2026-09-08T12:03:00.000Z")).kind).toBe("unresolved");
  });
});

describe("failing closed", () => {
  test("a store whose append is REFUSED produces no dispatch and no reservation on disk", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const runner = spawnRecorder();

    // A REAL REFUSAL, not a stub: another holder's claim in the lock file makes
    // `stillOurs` false, which is exactly what a second daemon does, and
    // `append` refuses rather than interleaving.
    writeFileSync(
      join(root, LOCK_FILE),
      `${JSON.stringify({ pid: process.pid, instanceId: "somebody-else", hostname: "box", startedAt: "2026-09-08T11:00:00.000Z" })}\n`,
    );

    const reports = tick(store, runner.spawn, clock.now);
    expect(reportKinds(reports)).toEqual(["not-dispatched"]);
    expect(runner.calls).toEqual([]);
    expect(kindsIn(root)).toEqual([]);
  });

  test("a store whose append THROWS produces no dispatch either", () => {
    // The other shape of the same failure — a full disk, a closed fd — and it
    // has to be caught rather than propagated, or a scheduler tick would take
    // the daemon down instead of declining one job.
    const runner = spawnRecorder();
    const store: OccurrenceLog = {
      instanceId: "i1",
      occurrences: new Map(),
      occurrenceHistory: { kind: "intact" },
      append() {
        throw new Error("ENOSPC: no space left on device");
      },
    };
    const reports = tick(store, runner.spawn, fakeClock("2026-09-08T12:00:00.000Z").now);
    expect(reportKinds(reports)).toEqual(["not-dispatched"]);
    expect(runner.calls).toEqual([]);
    const [only] = reports;
    expect(only?.kind === "not-dispatched" && only.why).toContain("ENOSPC");
  });

  test("two definitions sharing an id dispatch once and say so, rather than twice in silence", () => {
    // They would mint the same key at the same instant, so the second run's
    // acknowledgement overwrites the first's: one occurrence in the log, two
    // children on the box, and nothing anywhere saying there were two.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const runner = spawnRecorder({ settle: "never" });
    const reports = tick(store, runner.spawn, clock.now, [JOB, { ...JOB, what: "something else entirely" }]);
    expect(reportKinds(reports)).toEqual(["dispatched", "not-dispatched"]);
    expect(runner.calls).toHaveLength(1);
  });

  test("the reservation is on the disk BEFORE the spawn is called, not after", () => {
    // The ordering itself, asserted from inside the runner: by the time anything
    // can be spawned, a reader opening the log must already be able to see that
    // we were about to.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    let seenAtSpawnTime: string[] = [];
    const spawn: SpawnJob = () => {
      seenAtSpawnTime = kindsIn(root);
      return { kind: "spawned", pid: 4242, done: new Promise<never>(() => undefined) };
    };
    tick(store, spawn, clock.now);
    expect(seenAtSpawnTime).toEqual(["job-occurrence-reserved"]);
  });
});

describe("the crash windows, one test per row of the review's table", () => {
  /**
   * Row 1 — the crash lands before the reservation is durable.
   *
   * Nothing is on the disk, so a restart recomputes the due run and it happens.
   * The cost of this row is a run that was decided and never made; what it must
   * NOT be is a run that is suppressed for ever.
   */
  test("row 1: nothing durable, so a restart simply runs it", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const first = mustOpen(root, clock.now);
    expect(kindsIn(root)).toEqual([]);
    closeStore(first);

    const second = mustOpen(root, clock.now);
    const runner = spawnRecorder();
    expect(reportKinds(tick(second, runner.spawn, clock.now))).toEqual(["dispatched"]);
    expect(runner.calls).toHaveLength(1);
  });

  /**
   * Rows 2 and 3 — the two windows that cannot be told apart, and the test says
   * so by producing them two different ways and comparing.
   *
   * Row 2 is a crash after the reservation and before the spawn: nothing ran.
   * Row 3 is a crash after a spawn that succeeded and before the acknowledgement
   * landed: something is running. **Both leave one `job-occurrence-reserved` and
   * nothing after it**, and no restart can separate them — which is why the
   * derived state is `unknown` and why it is never retried.
   */
  test("rows 2 and 3: the two windows leave identical bytes and both derive `unknown`", async () => {
    // Row 2, built by reserving and then dying before the spawn.
    const rootTwo = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const storeTwo = mustOpen(rootTwo, clock.now);
    const key = { jobId: JOB.id, scheduledAt: "2026-09-08T12:00:00.000Z", definitionHash: definitionHash(JOB) };
    const reservation: JobEvent = {
      kind: "job-occurrence-reserved",
      at: "2026-09-08T12:00:00.000Z",
      jobId: key.jobId,
      scheduledAt: key.scheduledAt,
      definitionHash: key.definitionHash,
      occurrenceId: occurrenceId(key),
      instanceId: storeTwo.instanceId,
      leaseUntil: "2026-09-08T12:02:00.000Z",
      what: JOB.what,
    };
    expect(storeTwo.append([reservation]).ok).toBe(true);
    closeStore(storeTwo);

    // Row 3, built by running the real scheduler with a spawn that SUCCEEDS and
    // an acknowledgement that never lands — the crash in the window itself.
    const rootThree = tempRoot();
    const storeThree = mustOpen(rootThree, clock.now);
    const runner = spawnRecorder({ settle: "never" });
    let appends = 0;
    const crashing: OccurrenceLog = {
      instanceId: storeThree.instanceId,
      get occurrences() {
        return storeThree.occurrences;
      },
      occurrenceHistory: { kind: "intact" },
      append(events): AppendResult {
        appends += 1;
        // The first append — the reservation — really lands. The second, the
        // acknowledgement, is the one the crash eats.
        if (appends === 1) return storeThree.append(events);
        return { ok: false, reason: "lock-lost", holder: null };
      },
    };
    const reports = tick(crashing, runner.spawn, clock.now);
    expect(runner.calls).toHaveLength(1);
    expect(reportKinds(reports)).toEqual(["dispatched", "not-dispatched"]);
    closeStore(storeThree);
    await settle();

    // THE SAME BYTES. Not "similar": one reservation each, nothing after it.
    expect(kindsIn(rootTwo)).toEqual(["job-occurrence-reserved"]);
    expect(kindsIn(rootThree)).toEqual(["job-occurrence-reserved"]);

    // THE SAME DERIVED STATE, in a new instance, which is what a restart is.
    for (const root of [rootTwo, rootThree]) {
      const restarted = mustOpen(root, clock.now);
      const occurrences = [...restarted.occurrences.values()];
      expect(occurrences).toHaveLength(1);
      const [only] = occurrences;
      // NARROWED RATHER THAN CAST, and the compiler insisted: `why` is not a
      // field of every arm, which is the point of the union. A test that reached
      // for `.why` on a bare `Occurrence` did not compile.
      expect(only?.kind).toBe("unknown");
      if (only?.kind !== "unknown") return;
      expect(only.why).toMatch(/can tell which/);
      expect(only.source.kind).toBe("derived");
      closeStore(restarted);
    }
  });

  test("rows 2 and 3: the restart writes the unknown down and never re-dispatches that occurrence", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const first = mustOpen(root, clock.now);
    const key = { jobId: JOB.id, scheduledAt: "2026-09-08T12:00:00.000Z", definitionHash: definitionHash(JOB) };
    const abandoned = occurrenceId(key);
    first.append([
      {
        kind: "job-occurrence-reserved",
        at: "2026-09-08T12:00:00.000Z",
        jobId: key.jobId,
        scheduledAt: key.scheduledAt,
        definitionHash: key.definitionHash,
        occurrenceId: abandoned,
        instanceId: first.instanceId,
        leaseUntil: "2026-09-08T12:02:00.000Z",
        what: JOB.what,
      },
    ]);
    closeStore(first);

    // Ten seconds later, well inside the two-minute lease: the interval has not
    // elapsed either, so the only thing this tick should do is write down what
    // it cannot account for.
    clock.advance(10_000);
    const second = mustOpen(root, clock.now);
    const runner = spawnRecorder();
    const reports = tick(second, runner.spawn, clock.now);

    expect(reportKinds(reports)).toEqual(["unaccounted", "waiting"]);
    expect(runner.calls).toEqual([]);
    expect(kindsIn(root)).toEqual(["job-occurrence-reserved", "job-occurrence-unknown"]);

    // AND IT IS SAID ONCE. A crash that put a line in the log every tick for
    // ever would be a different kind of blindness.
    expect(reportKinds(tick(second, runner.spawn, clock.now))).toEqual(["waiting"]);
    expect(kindsIn(root)).toEqual(["job-occurrence-reserved", "job-occurrence-unknown"]);

    // Once the interval has passed, the job runs again — a NEW occurrence, at a
    // new instant. The abandoned one is never dispatched.
    clock.advance(120_000);
    const later = tick(second, runner.spawn, clock.now);
    expect(reportKinds(later)).toEqual(["dispatched"]);
    const [dispatched] = later;
    expect(dispatched?.kind === "dispatched" && dispatched.occurrenceId).not.toBe(abandoned);
  });

  /**
   * Row 4 — the crash lands after the child did its work and before the
   * completion was recorded.
   *
   * On disk that is `reserved` + `started`, which is a different shape from rows
   * 2 and 3 and a genuinely different fact: we know a process existed. What we
   * do not know is how it ended, so the lease is what resolves it.
   */
  test("row 4: a started run whose completion was never recorded becomes stuck when its lease runs out", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const first = mustOpen(root, clock.now);
    const runner = spawnRecorder({ pid: 9191, settle: "never" });
    expect(reportKinds(tick(first, runner.spawn, clock.now))).toEqual(["dispatched"]);
    expect(kindsIn(root)).toEqual(["job-occurrence-reserved", "job-occurrence-started"]);
    closeStore(first);

    // Inside the lease, a restart still says "in flight". The child can outlive
    // the daemon that started it, so this is not a contradiction.
    clock.advance(60_000);
    const second = mustOpen(root, clock.now);
    expect([...second.occurrences.values()][0]?.kind).toBe("started");
    expect(reportKinds(tick(second, runner.spawn, clock.now))).toEqual(["held"]);
    closeStore(second);

    // Past it, it is stuck — reported, written down, and released.
    clock.advance(120_000);
    const third = mustOpen(root, clock.now);
    const reports = tick(third, runner.spawn, clock.now);
    const [stuck] = reports;
    expect(stuck?.kind).toBe("stuck");
    expect(stuck?.kind === "stuck" && stuck.overdueMs).toBe(60_000);
    expect(stuck?.kind === "stuck" && stuck.why).toContain("pid 9191");
    expect(kindsIn(root)).toContain("job-occurrence-unknown");
  });
});

describe("the lease as the overlap guard", () => {
  test("a job whose work never settles does not run twice while the lease holds", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const runner = spawnRecorder({ settle: "never" });

    expect(reportKinds(tick(store, runner.spawn, clock.now))).toEqual(["dispatched"]);
    clock.advance(90_000); // past the 60s interval, inside the 120s lease
    expect(reportKinds(tick(store, runner.spawn, clock.now))).toEqual(["held"]);
    expect(runner.calls).toHaveLength(1);
  });

  test("and IS reported and released once the lease runs out — the dead job wearing a green light", () => {
    // GPT Sol's S6 in one test. Under the in-memory guard this replaces, the
    // second half of this test is what could never happen: the field stayed
    // non-null for ever, every tick declined to overlap, and the job was dead
    // behind a healthy heartbeat.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const runner = spawnRecorder({ settle: "never" });
    tick(store, runner.spawn, clock.now);

    clock.advance(180_000); // past the 120s lease
    const reports = tick(store, runner.spawn, clock.now);
    // REPORTED FIRST, then dispatched: one tick both raises the alarm and
    // recovers, rather than costing a whole interval of silence.
    expect(reportKinds(reports)).toEqual(["stuck", "dispatched"]);
    expect(runner.calls).toHaveLength(2);

    // And the log says both things, in order.
    expect(kindsIn(root)).toEqual([
      "job-occurrence-reserved",
      "job-occurrence-started",
      "job-occurrence-unknown",
      "job-occurrence-reserved",
      "job-occurrence-started",
    ]);
  });

  test("a stuck run stays visible in the checkpoint rather than being tidied away", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const runner = spawnRecorder({ settle: "never" });
    tick(store, runner.spawn, clock.now);
    store.checkpoint({ lastGoodSnapshotAt: null, tick: true });

    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    expect(read.checkpoint.jobs.occurrences).toHaveLength(1);
    // A READER CAN SEE IT IS STUCK WITHOUT ASKING THE DAEMON, which is the point
    // of storing the deadline rather than a boolean: a boolean written now would
    // go on saying "fine" for as long as the daemon was dead.
    expect(stuckOccurrences(new Map(read.checkpoint.jobs.occurrences.map((o) => [o.id, o])), Date.parse("2026-09-08T12:05:00.000Z"))).toHaveLength(1);
  });
});

describe("catching up across a restart", () => {
  test("a job due while the daemon was down runs on the next tick", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const first = mustOpen(root, clock.now);
    const runner = spawnRecorder();
    tick(first, runner.spawn, clock.now);
    runner.finish(0);
    await settle();
    expect(kindsIn(root)).toEqual(["job-occurrence-reserved", "job-occurrence-started", "job-occurrence-finished"]);
    closeStore(first);

    // Three hours down, with a sixty-second interval. Cron would have skipped
    // every one of those and said nothing.
    clock.advance(3 * 3600_000);
    const second = mustOpen(root, clock.now);
    const after = spawnRecorder();
    expect(reportKinds(tick(second, after.spawn, clock.now))).toEqual(["dispatched"]);
    expect(after.calls).toHaveLength(1);
  });

  test("and it runs ONCE, not once per missed interval", () => {
    // The other half, and the one a catch-up scheduler gets wrong: three hours
    // of downtime is one run, not a hundred and eighty.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const runner = spawnRecorder({ settle: "never" });
    clock.advance(3 * 3600_000);
    tick(store, runner.spawn, clock.now);
    tick(store, runner.spawn, clock.now);
    expect(runner.calls).toHaveLength(1);
  });
});

describe("what the runner says", () => {
  test("a refusal is recorded as a fact: it did not run, and we know it", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const spawn: SpawnJob = () => ({ kind: "refused", why: "the worktree is gone" });
    const reports = tick(store, spawn, clock.now);
    expect(reportKinds(reports)).toEqual(["refused"]);
    expect(kindsIn(root)).toEqual(["job-occurrence-reserved", "job-occurrence-refused"]);
    // A REFUSAL SETTLES THE OCCURRENCE, so the interval starts again from it —
    // a job whose precondition keeps failing must not spin.
    expect(reportKinds(tick(store, spawn, clock.now))).toEqual(["waiting"]);
  });

  test("a runner that THROWS is recorded as unknown, not as a refusal", () => {
    // The distinction the whole file is about. `refused` claims the job did not
    // start; a function that broke its own contract has told us nothing about
    // whether a process exists, and guessing "it did not" is how a duplicate
    // gets started later.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const spawn: SpawnJob = () => {
      throw new Error("spawn ENOENT");
    };
    expect(reportKinds(tick(store, spawn, clock.now))).toEqual(["unaccounted"]);
    expect(kindsIn(root)).toEqual(["job-occurrence-reserved", "job-occurrence-unknown"]);
  });

  test("a rejected promise is a finish, because the runner watched it and is telling us", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    const spawn: SpawnJob = () => ({ kind: "spawned", pid: 7, done: Promise.reject(new Error("the child was killed")) });
    tick(store, spawn, clock.now);
    await settle();
    const last = eventsIn(root).at(-1);
    expect(last?.kind).toBe("job-occurrence-finished");
    expect(last?.kind === "job-occurrence-finished" && last.outcome).toEqual({ kind: "failed", why: "the child was killed" });
  });
});

describe("the fold", () => {
  const key = { jobId: JOB.id, scheduledAt: "2026-09-08T12:00:00.000Z", definitionHash: definitionHash(JOB) };
  const id = occurrenceId(key);
  const reservation: JobEvent = {
    kind: "job-occurrence-reserved",
    at: "2026-09-08T12:00:00.000Z",
    jobId: key.jobId,
    scheduledAt: key.scheduledAt,
    definitionHash: key.definitionHash,
    occurrenceId: id,
    instanceId: "instance-a",
    leaseUntil: "2026-09-08T12:02:00.000Z",
    what: JOB.what,
  };

  test("reads OUR OWN reservation as in flight and somebody else's as unknown", () => {
    expect(foldOccurrences([reservation], new Map(), "instance-a").get(id)?.kind).toBe("reserved");
    expect(foldOccurrences([reservation], new Map(), "instance-b").get(id)?.kind).toBe("unknown");
  });

  test("drops an acknowledgement for a run it has never seen reserved", () => {
    // Half a record is not an occurrence: the key material is only on the
    // reservation, and inventing the rest would put a run in the index that
    // nothing authorised.
    const started: JobEvent = { kind: "job-occurrence-started", at: "2026-09-08T12:00:01.000Z", occurrenceId: id, pid: 1, leaseUntil: "2026-09-08T12:02:00.000Z" };
    expect(foldOccurrences([started], new Map(), "instance-a").size).toBe(0);
  });

  test("does nothing at all with the session arms it shares a union with", () => {
    const index = foldOccurrences(
      [{ kind: "tmux-session-gone", at: "2026-09-08T12:00:00.000Z", tmuxServerPid: 1, key: "x" as never, identity: { tmuxId: "$1", claimedConversationId: null }, name: "n", why: "absent-from-snapshot" }],
      new Map(),
      "instance-a",
    );
    expect(index.size).toBe(0);
  });

  test("a reservation restored FROM A CHECKPOINT is re-judged too, not only one replayed from the log", () => {
    // THE PATH MUTATION TESTING FOUND UNCOVERED. Every crash-window test above
    // closes the store without checkpointing first, so the occurrence comes back
    // through the log replay — and replacing `adoptOccurrence(...)` with the
    // stored value left the whole suite green. A daemon that ran for thirty
    // seconds before it died has a checkpoint, which is the ordinary case, and
    // on that path a `reserved` was coming back as in flight and holding its job
    // until the lease ran out.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const first = mustOpen(root, clock.now);
    const key = { jobId: JOB.id, scheduledAt: "2026-09-08T12:00:00.000Z", definitionHash: definitionHash(JOB) };
    first.append([
      {
        kind: "job-occurrence-reserved",
        at: "2026-09-08T12:00:00.000Z",
        jobId: key.jobId,
        scheduledAt: key.scheduledAt,
        definitionHash: key.definitionHash,
        occurrenceId: occurrenceId(key),
        instanceId: first.instanceId,
        leaseUntil: "2026-09-08T12:02:00.000Z",
        what: JOB.what,
      },
    ]);
    // The checkpoint AFTER the append, so its cursor covers the event and the
    // restart has nothing left to replay — which is what puts the occurrence on
    // the checkpoint path rather than the log path.
    first.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    closeStore(first);

    const second = mustOpen(root, clock.now);
    expect(second.opening.start.kind).toBe("resumed");
    expect(second.opening.eventsReplayed).toBe(0);
    const [restored] = [...second.occurrences.values()];
    expect(restored?.kind).toBe("unknown");
  });

  test("a checkpoint's reserved occurrence is re-judged on the way back in", () => {
    // The checkpoint stores a FOLD, so it stores a derivation: `reserved`
    // because the instance that folded it was the one that wrote it. Restoring
    // that verbatim would carry "in flight" across the restart that disproves it.
    const mine = foldOccurrences([reservation], new Map(), "instance-a").get(id);
    expect(mine).toBeDefined();
    if (mine === undefined) return;
    expect(adoptOccurrence(mine, "instance-a").kind).toBe("reserved");
    expect(adoptOccurrence(mine, "instance-b").kind).toBe("unknown");
  });

  test("keeps every unsettled run and only the newest settled one per job", () => {
    const index = new Map<OccurrenceId, Occurrence>();
    const events: JobEvent[] = [];
    for (let n = 0; n < 5; n += 1) {
      const at = new Date(Date.parse("2026-09-08T12:00:00.000Z") + n * 60_000).toISOString();
      const k = { jobId: JOB.id, scheduledAt: at, definitionHash: definitionHash(JOB) };
      const oid = occurrenceId(k);
      events.push({ kind: "job-occurrence-reserved", at, jobId: k.jobId, scheduledAt: at, definitionHash: k.definitionHash, occurrenceId: oid, instanceId: "instance-a", leaseUntil: at, what: JOB.what });
      events.push({ kind: "job-occurrence-finished", at, occurrenceId: oid, outcome: { kind: "exited", code: 0 } });
    }
    foldOccurrences(events, index, "instance-a");
    expect(index.size).toBe(1);
    expect([...index.values()][0]?.key.scheduledAt).toBe("2026-09-08T12:04:00.000Z");
  });

  test("bounds the unknowns it carries, because one arrives per crash and nothing ever clears them", () => {
    const index = new Map<OccurrenceId, Occurrence>();
    const events: JobEvent[] = [];
    for (let n = 0; n < UNKNOWN_RETENTION + 10; n += 1) {
      const at = new Date(Date.parse("2026-09-08T12:00:00.000Z") + n * 60_000).toISOString();
      const k = { jobId: JOB.id, scheduledAt: at, definitionHash: definitionHash(JOB) };
      events.push({ kind: "job-occurrence-reserved", at, jobId: k.jobId, scheduledAt: at, definitionHash: k.definitionHash, occurrenceId: occurrenceId(k), instanceId: "somebody-else", leaseUntil: at, what: JOB.what });
    }
    foldOccurrences(events, index, "instance-a");
    expect(index.size).toBe(UNKNOWN_RETENTION);
  });
});

describe("the log as a corruption boundary", () => {
  test("a reservation whose id is not the id of its own key is refused, not adopted", () => {
    // ALSO FOUND BY MUTATION TESTING: deleting the recomputation left the suite
    // green, because nothing wrote a line with a mismatched id. It matters
    // because every later event addresses the run by that id — a `started` and a
    // `finished` land on whatever the reservation claimed to be called — so a
    // hand-edited or foreign line would attach a whole run's history to an
    // address nothing else uses. The store's existing all-or-nothing rule turns
    // that into a cold start with a sentence, which is the loud outcome.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const key = { jobId: JOB.id, scheduledAt: "2026-09-08T12:00:00.000Z", definitionHash: definitionHash(JOB) };
    writeFileSync(
      join(root, EVENTS_FILE),
      `${JSON.stringify({
        kind: "job-occurrence-reserved",
        at: "2026-09-08T12:00:00.000Z",
        jobId: key.jobId,
        scheduledAt: key.scheduledAt,
        definitionHash: key.definitionHash,
        occurrenceId: "somebody-elses-idea-of-a-name",
        instanceId: "instance-a",
        leaseUntil: "2026-09-08T12:02:00.000Z",
        what: JOB.what,
      })}\n`,
    );
    const store = mustOpen(root, clock.now);
    expect(store.opening.start.kind).toBe("cold");
    expect(store.occurrences.size).toBe(0);
    expect(store.opening.unreadableLines).toBe(1);

    // AND THE SCHEDULER MUST REFUSE ON IT. This is where the test used to stop,
    // and GPT Sol's C3 is that stopping here passes over the dangerous half: an
    // empty occurrence map reads as "this job has never run", `due` calls that
    // immediately due, and a cold start would therefore RE-RUN whatever was in
    // the unreadable bytes. A cold start is not permission.
    expect(store.occurrenceHistory.kind).toBe("lost");
    const runner = spawnRecorder();
    const before = kindsIn(root);
    const reports = tick(store, runner.spawn, clock.now);
    expect(reportKinds(reports)).toEqual(["history-lost"]);
    expect(runner.calls).toEqual([]);
    // Nothing written either: a held job leaves no reservation behind. (The one
    // line already there is the hand-written corrupt one this test wrote.)
    expect(kindsIn(root)).toEqual(before);
    expect(before).toHaveLength(1);
    const [only] = reports;
    expect(only?.kind === "history-lost" && only.why).toContain("log-has-holes");
  });

  test("a log too large to replay holds the jobs as well, because the reason it is empty is the same", () => {
    // The other door into the same empty map: `openStore` refuses a range above
    // its ceiling rather than allocating for it. The `why` differs and the
    // consequence must not.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const first = mustOpen(root, clock.now);
    const key = { jobId: JOB.id, scheduledAt: "2026-09-08T11:00:00.000Z", definitionHash: definitionHash(JOB) };
    first.append([
      {
        kind: "job-occurrence-reserved",
        at: "2026-09-08T11:00:00.000Z",
        jobId: key.jobId,
        scheduledAt: key.scheduledAt,
        definitionHash: key.definitionHash,
        occurrenceId: occurrenceId(key),
        instanceId: first.instanceId,
        leaseUntil: "2026-09-08T11:02:00.000Z",
        what: JOB.what,
      },
      { kind: "job-occurrence-finished", at: "2026-09-08T11:00:30.000Z", occurrenceId: occurrenceId(key), outcome: { kind: "exited", code: 0 } },
    ]);
    closeStore(first);

    const opened = openStore({ root, now: clock.now, replayCeilingBytes: 10 });
    if (!opened.ok) throw new Error("the store would not open");
    const second = opened.store;
    // Pushed so afterEach closes it — the helper that does this also opens it.
    roots.push(root);
    expect(second.opening.start.kind).toBe("cold");
    expect(second.occurrences.size).toBe(0);
    expect(second.occurrenceHistory.kind).toBe("lost");
    const runner = spawnRecorder();
    expect(reportKinds(tick(second, runner.spawn, clock.now))).toEqual(["history-lost"]);
    expect(runner.calls).toEqual([]);
    second.close();
  });

  test("an ordinary first start is INTACT, because there is nothing there to have lost", () => {
    // The line between the two: `cold` on an empty store is the beginning of
    // life, not a hole. Reading every cold start as lost history would be a
    // scheduler that could never dispatch its first run — the mirror of the bug,
    // and just as silent.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const store = mustOpen(root, clock.now);
    expect(store.opening.start.kind).toBe("cold");
    expect(store.occurrenceHistory).toEqual({ kind: "intact" });
    const runner = spawnRecorder({ settle: "never" });
    expect(reportKinds(tick(store, runner.spawn, clock.now))).toEqual(["dispatched"]);
  });

  test("the hold SURVIVES A RESTART, or it would last exactly one daemon lifetime", async () => {
    // THE LAUNDERING PATH, and it is the one that makes the difference between
    // a protection and a delay. A start that lost history holds its jobs and
    // then writes an ordinary checkpoint whose cursor is at the end of the log —
    // so the next start replays a clean tail onto an empty ledger and reads as
    // intact, with nobody having decided anything. The verdict is carried in the
    // checkpoint for exactly this reason.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    writeFileSync(join(root, EVENTS_FILE), "this line is not json at all\n");
    const first = mustOpen(root, clock.now);
    expect(first.occurrenceHistory.kind).toBe("lost");
    first.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    closeStore(first);

    const second = mustOpen(root, clock.now);
    expect(second.opening.start.kind).toBe("resumed");
    expect(second.occurrenceHistory.kind).toBe("lost");
    const runner = spawnRecorder();
    expect(reportKinds(tick(second, runner.spawn, clock.now))).toEqual(["history-lost"]);
    expect(runner.calls).toEqual([]);
    // And it is said out loud in the sentence the daemon writes into its start
    // note, rather than being a field only the scheduler ever reads.
    expect(describeOpening(second.opening)).toContain("SCHEDULED JOBS ARE HELD");
    await settle();
  });

  test("a reconcile file clears the hold ONCE, and is consumed rather than left switched on", () => {
    // The one way out, and it has to be an act rather than a setting: a file
    // left in place would turn "somebody decided this once" into "this
    // protection is off for ever".
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    writeFileSync(join(root, EVENTS_FILE), "this line is not json at all\n");
    const first = mustOpen(root, clock.now);
    expect(first.occurrenceHistory.kind).toBe("lost");
    first.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    closeStore(first);

    writeFileSync(join(root, RECONCILE_FILE), JSON.stringify({ at: "2026-09-08T12:05:00.000Z", why: "checked gjd-remote ls; nothing ran" }));
    const second = mustOpen(root, clock.now);
    expect(second.occurrenceHistory).toEqual({ kind: "intact" });
    expect(second.opening.occurrencesReconciled).toContain("nothing ran");
    expect(describeOpening(second.opening)).toContain("reconciled by hand");
    // CONSUMED. The file is gone, so the next loss holds again.
    expect(existsSync(join(root, RECONCILE_FILE))).toBe(false);
    const runner = spawnRecorder({ settle: "never" });
    expect(reportKinds(tick(second, runner.spawn, clock.now))).toEqual(["dispatched"]);
  });

  test("a checkpoint pointing past the end of a shrunken log holds the jobs too", () => {
    // The log was truncated or replaced under a perfectly good checkpoint, so
    // the bytes that said what had run are gone. `openStore` already rebuilds
    // from scratch here; what it must not do is call the result a full history.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const first = mustOpen(root, clock.now);
    const key = { jobId: JOB.id, scheduledAt: "2026-09-08T11:00:00.000Z", definitionHash: definitionHash(JOB) };
    first.append([
      {
        kind: "job-occurrence-reserved",
        at: "2026-09-08T11:00:00.000Z",
        jobId: key.jobId,
        scheduledAt: key.scheduledAt,
        definitionHash: key.definitionHash,
        occurrenceId: occurrenceId(key),
        instanceId: first.instanceId,
        leaseUntil: "2026-09-08T11:02:00.000Z",
        what: JOB.what,
      },
    ]);
    first.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    closeStore(first);
    // The log goes back to nothing while the checkpoint goes on describing it.
    writeFileSync(join(root, EVENTS_FILE), "");

    const second = mustOpen(root, clock.now);
    expect(second.occurrenceHistory.kind).toBe("lost");
    const runner = spawnRecorder();
    expect(reportKinds(tick(second, runner.spawn, clock.now))).toEqual(["history-lost"]);
    expect(runner.calls).toEqual([]);
  });
});

describe("the appends AFTER the reservation, which used to be silent", () => {
  // GPT Sol's C5. The pre-spawn append is genuinely fail-closed and stays so;
  // every LATER one had its result thrown away, so a refusal or a completion
  // that the store would not take left the durable history saying one thing
  // while the report said another. None of these may throw: the alternative to
  // a note is losing the child's outcome as well.

  /** A store whose appends land until `failFrom`, and are refused from it on. */
  function failingAfter(real: OverseerStore, failFrom: number): { store: OccurrenceLog; appends: () => number } {
    let appends = 0;
    return {
      appends: () => appends,
      store: {
        instanceId: real.instanceId,
        get occurrences() {
          return real.occurrences;
        },
        occurrenceHistory: { kind: "intact" },
        append(events): AppendResult {
          appends += 1;
          if (appends >= failFrom) return { ok: false, reason: "lock-lost", holder: null };
          return real.append(events);
        },
      },
    };
  }

  test("a refusal the store would not take is REPORTED, not swallowed", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const real = mustOpen(root, clock.now);
    const { store } = failingAfter(real, 2);
    const reports = tick(store, () => ({ kind: "refused", why: "the binary is missing" }), clock.now);
    // BOTH facts, in this order: the runner refused, AND we could not write that
    // down. Reporting only the first is what made the report disagree with the
    // history; reporting only the second would lose the runner's answer.
    expect(reportKinds(reports)).toEqual(["refused", "unrecorded"]);
    const lost = reports[1];
    expect(lost?.kind === "unrecorded" && lost.fact).toBe("refused");
    // And the durable state is the honest one: a reservation with nothing after
    // it, which a later instance reads as `unknown`.
    expect(kindsIn(root)).toEqual(["job-occurrence-reserved"]);
  });

  test("a runner that throws, whose `unknown` cannot be written down, says both things", () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const real = mustOpen(root, clock.now);
    const { store } = failingAfter(real, 2);
    const reports = tick(
      store,
      () => {
        throw new Error("the runner is broken");
      },
      clock.now,
    );
    expect(reportKinds(reports)).toEqual(["unaccounted", "unrecorded"]);
    const lost = reports[1];
    expect(lost?.kind === "unrecorded" && lost.fact).toBe("unknown");
  });

  test("a completion the store would not take reaches onLostRecord, because the tick has already returned", async () => {
    // THE ONE THAT CANNOT BE A REPORT. The work settles later, so there is no
    // tick left to return anything to — and an append that fails here leaves the
    // ledger saying `started` for ever while the child has finished.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const real = mustOpen(root, clock.now);
    const { store } = failingAfter(real, 3);
    const runner = spawnRecorder();
    const lost: LostRecord[] = [];
    const reports = schedulerTick({
      definitions: [{ definition: JOB, authorisedHash: definitionHash(JOB) }],
      store,
      spawn: runner.spawn,
      now: clock.now,
      onLostRecord: (record) => lost.push(record),
    });
    expect(reportKinds(reports)).toEqual(["dispatched"]);
    expect(lost).toEqual([]);
    runner.finish(0);
    await settle();
    expect(lost).toHaveLength(1);
    expect(lost[0]?.fact).toBe("finished");
    expect(lost[0]?.why).toContain("exit 0");
    // AND IT DID NOT THROW: an unhandled rejection here would take the daemon
    // down and lose the outcome as well as the record.
    expect(kindsIn(root)).toEqual(["job-occurrence-reserved", "job-occurrence-started"]);
  });

  test("a run that BROKE, whose failure cannot be written down, is not silently a success either", async () => {
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const real = mustOpen(root, clock.now);
    const { store } = failingAfter(real, 3);
    // An array rather than a `let`, because the assignment happens inside a
    // promise executor and TypeScript's flow analysis cannot see it — it would
    // narrow the later read to `null` and refuse the call.
    const rejecters: ((cause: Error) => void)[] = [];
    const spawn: SpawnJob = () => ({
      kind: "spawned",
      pid: 77,
      done: new Promise<never>((_resolve, r) => {
        rejecters.push(r);
      }),
    });
    const lost: LostRecord[] = [];
    schedulerTick({
      definitions: [{ definition: JOB, authorisedHash: definitionHash(JOB) }],
      store,
      spawn,
      now: clock.now,
      onLostRecord: (record) => lost.push(record),
    });
    rejecters[0]?.(new Error("the child exploded"));
    await settle();
    expect(lost).toHaveLength(1);
    expect(lost[0]?.fact).toBe("finished");
    expect(lost[0]?.why).toContain("the child exploded");
  });

  test("a scheduler given no onLostRecord loses it rather than throwing, which is its own choice", () => {
    // Stated as a test rather than left to chance, because the callback is
    // optional and the failure mode of getting this wrong is an unhandled
    // rejection taking the whole daemon down at the worst moment.
    const root = tempRoot();
    const clock = fakeClock("2026-09-08T12:00:00.000Z");
    const real = mustOpen(root, clock.now);
    const { store } = failingAfter(real, 3);
    const runner = spawnRecorder();
    tick(store, runner.spawn, clock.now);
    runner.finish(1);
    return settle();
  });
});

describe("the log a person reads", () => {
  test("every report kind has a line, and the alarming ones shout", () => {
    const key = { jobId: JOB.id, scheduledAt: "2026-09-08T12:00:00.000Z", definitionHash: definitionHash(JOB) };
    const id = occurrenceId(key);
    // A RECORD KEYED BY THE KIND, not an array — so the COMPILER is what says
    // "every kind", rather than this test's name saying it while a list quietly
    // falls behind the union. Three arms were added by the review's C2, C3 and
    // C5 and an array would have gone on passing without them.
    const each: Record<SchedulerReport["kind"], SchedulerReport> = {
      dispatched: { kind: "dispatched", jobId: JOB.id, occurrenceId: id, pid: 1 },
      refused: { kind: "refused", jobId: JOB.id, occurrenceId: id, why: "no" },
      "not-dispatched": { kind: "not-dispatched", jobId: JOB.id, why: "no" },
      held: { kind: "held", jobId: JOB.id, why: "no" },
      waiting: { kind: "waiting", jobId: JOB.id, remainingMs: 1000 },
      unauthorised: { kind: "unauthorised", jobId: JOB.id, why: "the pin says otherwise" },
      "history-lost": { kind: "history-lost", jobId: JOB.id, why: "the log had a hole in it" },
      unrecorded: { kind: "unrecorded", jobId: JOB.id, occurrenceId: id, fact: "finished", why: "no" },
      stuck: { kind: "stuck", jobId: JOB.id, occurrenceId: id, overdueMs: 1000, why: "no" },
      unaccounted: { kind: "unaccounted", jobId: JOB.id, occurrenceId: id, why: "no" },
    };
    const lines = Object.values(each).map(describeReport);
    for (const line of lines) expect(line).toContain(JOB.id);
    // Distinct sentences, for the reason the watchdog's four states are: a
    // reader tailing the log has nothing but the words.
    expect(new Set(lines).size).toBe(lines.length);
    expect(describeReport(each.stuck)).toContain("STUCK");
    expect(describeReport(each.unaccounted)).toContain("UNACCOUNTED");
    // The three the review added, and each says which of them it is rather than
    // sharing a generic "did not run".
    expect(describeReport(each.unauthorised)).toContain("NOT AUTHORISED");
    expect(describeReport(each["history-lost"])).toContain("HELD");
    expect(describeReport(each.unrecorded)).toContain("NOT RECORDED");
    expect(describeReport(each.unrecorded)).toContain("finished");
  });
});

/** A `JobSpawn` value, so the type is exercised rather than only inferred. */
const _typeCheck: JobSpawn = { kind: "refused", why: "unused" };
void _typeCheck;
