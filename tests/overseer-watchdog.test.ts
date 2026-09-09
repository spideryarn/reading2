/**
 * scripts/overseer-watchdog.ts — the local check `overseer-watchdog.timer`
 * runs, and the four ways it can find the daemon NOT healthy, kept distinct
 * on purpose (docs/reusable/silent-success.md, docs/project/overseer-direction.md
 * § "The seam is a file, not a function" — the two clocks, and what only
 * having both can tell you: "deaf" and "stale" mean OPPOSITE things about the
 * daemon process and the SAME thing about whether the register can be trusted).
 *
 * Everything here reads and writes a temp directory, never a real
 * `~/.overseer` — the point of the watchdog is to be trustworthy about a
 * store that may be broken, so the test doubles for it have to be able to
 * produce genuinely broken files, not just well-typed `CheckpointRead` values.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_MAX_SNAPSHOT_AGE_MS, DEFAULT_MAX_TICK_AGE_MS, assessWatchdog, formatVerdict, main } from "../scripts/overseer-watchdog.js";
import { MEASURED_CADENCE_MS, TICK_MS, runOverseer, staleAfterMs } from "../tools/overseer/daemon.js";
import {
  CHECKPOINT_FILE,
  STORE_SCHEMA,
  attentionNotYetRun,
  readCheckpoint,
  schedulerNotYetSaid,
  usageNotYetRun,
  workNotYetRun,
  type Checkpoint,
} from "../tools/overseer/store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-watchdog-test-"));
  roots.push(root);
  return root;
}

const NOW = Date.parse("2026-09-08T08:00:00.000Z");

/**
 * A checkpoint whose heartbeat ticked `tickAgoMs` before NOW and whose last
 * good snapshot arrived `snapshotAgoMs` before NOW (or never, if `null`) —
 * the real shape, not a stub, and the two clocks set independently, because
 * that independence is the whole thing under test.
 */
function checkpointAt(tickAgoMs: number, snapshotAgoMs: number | null): Checkpoint {
  const writtenAt = new Date(NOW - tickAgoMs).toISOString();
  const lastGoodSnapshotAt = snapshotAgoMs === null ? null : new Date(NOW - snapshotAgoMs).toISOString();
  return {
    schema: STORE_SCHEMA,
    writtenAt,
    lastGoodSnapshotAt,
    cursor: { events: 3, bytes: 210 },
    heartbeat: { pid: 4242, instanceId: "i1", startedAt: "2026-09-08T07:00:00.000Z", lastTickAt: writtenAt, ticks: 100 },
    register: [],
    attention: attentionNotYetRun(writtenAt),
    work: workNotYetRun(writtenAt),
    usage: usageNotYetRun(writtenAt),
    scheduler: schedulerNotYetSaid(writtenAt),
    snapshotStaleAfterMs: null,
    occurrenceHistory: null,
    // No jobs pass wired in here -- an empty register is the honest starting
    // shape for `Checkpoint.jobs`, the same way `attentionNotYetRun` /
    // `usageNotYetRun` are for those two fields. Added by a peer agent's
    // concurrent work on tools/overseer/jobs.ts while this file was in
    // progress; not otherwise exercised by these tests.
    jobs: { occurrences: [] },
  };
}

function writeCheckpointFile(root: string, body: string): void {
  writeFileSync(join(root, CHECKPOINT_FILE), body);
}

describe("assessWatchdog", () => {
  it("(a) reports no-checkpoint when there is no current.json at all", () => {
    const root = tempRoot();
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS);
    expect(verdict).toEqual({ healthy: false, state: "no-checkpoint", detail: expect.stringContaining("never written") });
  });

  it("(b) reports stale when the checkpoint parses but lastTickAt is too old", () => {
    const root = tempRoot();
    writeCheckpointFile(root, JSON.stringify(checkpointAt(DEFAULT_MAX_TICK_AGE_MS + 60_000, 0)));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS);
    expect(verdict.healthy).toBe(false);
    if (!verdict.healthy) {
      expect(verdict.state).toBe("stale");
      expect(verdict.detail).toContain("ago");
    }
  });

  it("(b) reports stale, not unreadable, when lastTickAt is still null", () => {
    // The daemon writes a checkpoint on open before its first tick. A reader
    // that treated a startup checkpoint as parse failure would be WRONG in
    // the direction that hides a genuinely dead daemon behind "cannot tell".
    const root = tempRoot();
    const cp = checkpointAt(0, 0);
    writeCheckpointFile(root, JSON.stringify({ ...cp, heartbeat: { ...cp.heartbeat, lastTickAt: null } }));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS);
    expect(verdict.healthy).toBe(false);
    if (!verdict.healthy) expect(verdict.state).toBe("stale");
  });

  it("(b) reports stale, never deaf, when BOTH clocks are old -- stale is checked first", () => {
    // A dead process's snapshot clock is trivially old too. `stale` is the
    // more useful thing to say about a process that is not running, and
    // `deaf` would be a false claim that the process IS up.
    const root = tempRoot();
    const old = DEFAULT_MAX_TICK_AGE_MS + DEFAULT_MAX_SNAPSHOT_AGE_MS;
    writeCheckpointFile(root, JSON.stringify(checkpointAt(old, old)));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS);
    expect(verdict.healthy).toBe(false);
    if (!verdict.healthy) expect(verdict.state).toBe("stale");
  });

  it("(c) reports unreadable, not no-checkpoint, when the file is corrupt JSON", () => {
    const root = tempRoot();
    writeCheckpointFile(root, "{ not json at all");
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS);
    expect(verdict).toEqual({ healthy: false, state: "unreadable", detail: expect.any(String) });
  });

  it("(c) reports unreadable, never absent/stale/deaf, for a schema this build does not know", () => {
    // The brief this test is guarding: "an unknown schema must report 'I
    // cannot read this', never a silently-missing field" — and never as any
    // of the other three, which would tell an operator something specific
    // this state does not actually know.
    const root = tempRoot();
    const cp = checkpointAt(0, 0);
    writeCheckpointFile(root, JSON.stringify({ ...cp, schema: 999 }));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS);
    expect(verdict.healthy).toBe(false);
    if (!verdict.healthy) {
      expect(verdict.state).toBe("unreadable");
      expect(verdict.detail).toMatch(/schema/i);
    }
  });

  it("(d) reports deaf when the heartbeat is fresh but lastGoodSnapshotAt is too old", () => {
    const root = tempRoot();
    writeCheckpointFile(root, JSON.stringify(checkpointAt(0, DEFAULT_MAX_SNAPSHOT_AGE_MS + 60_000)));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);
    expect(verdict.healthy).toBe(false);
    if (!verdict.healthy) {
      expect(verdict.state).toBe("deaf");
      expect(verdict.detail).toMatch(/fleet.dashboard/i);
    }
  });

  it("(d) reports deaf when the heartbeat is fresh but lastGoodSnapshotAt has never been set", () => {
    // GPT Sol's S10: provision.sh enables overseer.service but nothing
    // enables fleet-dashboard.service, so a freshly provisioned box's
    // Overseer ticks forever having never once heard from the dashboard.
    // `lastGoodSnapshotAt: null` must not fall through a bare truthiness
    // check into "healthy".
    const root = tempRoot();
    writeCheckpointFile(root, JSON.stringify(checkpointAt(0, null)));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);
    expect(verdict.healthy).toBe(false);
    if (!verdict.healthy) {
      expect(verdict.state).toBe("deaf");
      expect(verdict.detail).toContain("never once");
    }
  });

  it("healthy: both the heartbeat and the snapshot clock are fresh", () => {
    const root = tempRoot();
    writeCheckpointFile(root, JSON.stringify(checkpointAt(TICK_MS, 30_000)));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);
    expect(verdict).toEqual({ healthy: true, detail: expect.any(String) });
  });

  it("the four unhealthy states are textually distinct — IN WHAT THEY PRINT", () => {
    // THIS TEST USED TO COMPARE THE INTERNAL `state` TAGS and never call
    // `formatVerdict`, which GPT Sol's C8 pointed out means all four rendered
    // messages could become identical and it would stay green. The tags are a
    // discriminated union and the compiler already keeps those apart; what
    // nothing keeps apart is the SENTENCE, which is the only part a person
    // tailing the journal ever sees.
    const root = tempRoot();
    const absent = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);
    writeCheckpointFile(root, "not json");
    const unreadable = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);
    writeCheckpointFile(root, JSON.stringify(checkpointAt(DEFAULT_MAX_TICK_AGE_MS + 60_000, 0)));
    const stale = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);
    writeCheckpointFile(root, JSON.stringify(checkpointAt(0, DEFAULT_MAX_SNAPSHOT_AGE_MS + 60_000)));
    const deaf = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);
    writeCheckpointFile(root, JSON.stringify(checkpointAt(0, 0)));
    const healthy = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);

    const verdicts = [absent, unreadable, stale, deaf, healthy];
    const states = verdicts.map((v) => (v.healthy ? "healthy" : v.state));
    expect(new Set(states).size).toBe(5);

    // THE RENDERED LINES, which is what the name has always claimed.
    const lines = verdicts.map(formatVerdict);
    expect(new Set(lines).size).toBe(5);
    // And distinct is not enough on its own: a line has to name its own state,
    // or four different sentences saying nothing useful would pass the set test.
    expect(formatVerdict(absent)).toContain("no-checkpoint");
    expect(formatVerdict(unreadable)).toContain("unreadable");
    expect(formatVerdict(stale)).toContain("stale");
    expect(formatVerdict(deaf)).toContain("deaf");
    expect(formatVerdict(healthy)).toContain("healthy");
    // The unhealthy ones are marked as such at a glance; the healthy one is not.
    for (const line of lines.slice(0, 4)) expect(line.startsWith("✗")).toBe(true);
    expect(formatVerdict(healthy).startsWith("✓")).toBe(true);
  });

  it("the deaf threshold comes from THE DAEMON'S OWN checkpoint, not from a constant here", () => {
    // GPT Sol's C6. Both sides already called `staleAfterMs`, and that prevents
    // formula drift and not INPUT drift: the daemon passes the snapshot's
    // advertised refreshMs (60s → 300,000ms) and this file passed the historical
    // measured constant (65s → 325,000ms), so they disagreed under the
    // documented normal values.
    //
    // A snapshot 310s old is the gap between those two numbers — deaf by the
    // daemon's own deadline, healthy by the constant. That is the disagreement,
    // made into an assertion.
    const root = tempRoot();
    const daemonDeadlineMs = 300_000;
    expect(DEFAULT_MAX_SNAPSHOT_AGE_MS).toBe(325_000);
    writeCheckpointFile(root, JSON.stringify({ ...checkpointAt(0, 310_000), snapshotStaleAfterMs: daemonDeadlineMs }));

    // `null` is what main() passes: use the daemon's number.
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, null);
    expect(verdict.healthy).toBe(false);
    if (verdict.healthy) return;
    expect(verdict.state).toBe("deaf");
    expect(verdict.detail).toContain("300s threshold");
    expect(verdict.detail).toContain("the daemon's own deadline");

    // And the old behaviour, kept only as an override somebody typed on purpose.
    expect(assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS).healthy).toBe(true);
  });

  it("a checkpoint carrying no deadline falls back to this file's constant, and says which it used", () => {
    // The old checkpoints on the box have no such field. Falling back is right;
    // pretending the fallback is the daemon's number is not.
    const root = tempRoot();
    writeCheckpointFile(root, JSON.stringify(checkpointAt(0, DEFAULT_MAX_SNAPSHOT_AGE_MS + 60_000)));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, null);
    expect(verdict.healthy).toBe(false);
    if (verdict.healthy) return;
    expect(verdict.state).toBe("deaf");
    expect(verdict.detail).toContain("fallback");
  });

  it("a daemon's real checkpoint carries the deadline it is actually using", async () => {
    // THE OTHER HALF OF C6, and the half a fixture cannot prove: the field is
    // only worth reading if the daemon really writes it. This asserts against a
    // checkpoint the daemon wrote, not one this test built.
    const root = tempRoot();
    const controller = new AbortController();
    const outcome = await runOverseer({
      root,
      baseUrl: "http://127.0.0.1:0",
      signal: controller.signal,
      tickMs: 5,
      log: () => undefined,
      source: async function* () {
        await new Promise((resolve) => setTimeout(resolve, 30));
      },
    });
    expect(outcome.kind).toBe("stopped");
    const read = readCheckpoint(root);
    expect(read.kind).toBe("checkpoint");
    if (read.kind !== "checkpoint") return;
    // Before any snapshot has arrived the daemon uses the measured cadence, so
    // this is `staleAfterMs(MEASURED_CADENCE_MS)` — computed from the daemon's
    // own exports rather than written out, because a literal here would be the
    // third independently-maintained copy of the number.
    expect(read.checkpoint.snapshotStaleAfterMs).toBe(staleAfterMs(MEASURED_CADENCE_MS));
  });

  it("MUTATION CHECK: collapsing deaf into healthy is caught by this suite", () => {
    // Not a real mutation of the source — a hand-simulated one, run the same
    // way the coordinator's mutation pass was described: take the exact
    // "fresh heartbeat, dead snapshot" input the (d) tests above use, and
    // assert what a `deaf`-blind version (one that stopped after the tick
    // check, the bug this whole widening exists to fix) would have returned.
    // If a future edit deletes the snapshot check, THIS assertion — built
    // from the real function under test, not a copy of it — is one of the
    // ones that goes red, because assessWatchdog would then report `healthy`
    // where this expects `deaf`.
    const root = tempRoot();
    writeCheckpointFile(root, JSON.stringify(checkpointAt(0, DEFAULT_MAX_SNAPSHOT_AGE_MS + 60_000)));
    const verdict = assessWatchdog(readCheckpoint(root), NOW, DEFAULT_MAX_TICK_AGE_MS, DEFAULT_MAX_SNAPSHOT_AGE_MS);
    expect(verdict.healthy).toBe(false); // a deaf-blind build would say `true` here
  });
});

describe("formatVerdict", () => {
  it("marks a healthy verdict distinctly from every unhealthy one", () => {
    expect(formatVerdict({ healthy: true, detail: "x" })).toMatch(/^✓/);
    expect(formatVerdict({ healthy: false, state: "deaf", detail: "x" })).toMatch(/^✗/);
  });
});

describe("main()", () => {
  const OLD_STORE_DIR = process.env["OVERSEER_STORE_DIR"];
  afterEach(() => {
    if (OLD_STORE_DIR === undefined) delete process.env["OVERSEER_STORE_DIR"];
    else process.env["OVERSEER_STORE_DIR"] = OLD_STORE_DIR;
  });

  // `main()` reads the real clock (`Date.now()`), unlike `assessWatchdog`
  // above which is handed a fixed `NOW` — so these checkpoints are built
  // against the real clock too, not the fixed `NOW` constant.
  function checkpointAgoReal(tickAgoMs: number, snapshotAgoMs: number | null): Checkpoint {
    const writtenAt = new Date(Date.now() - tickAgoMs).toISOString();
    const lastGoodSnapshotAt = snapshotAgoMs === null ? null : new Date(Date.now() - snapshotAgoMs).toISOString();
    return {
      schema: STORE_SCHEMA,
      writtenAt,
      lastGoodSnapshotAt,
      cursor: { events: 3, bytes: 210 },
      heartbeat: { pid: 4242, instanceId: "i1", startedAt: writtenAt, lastTickAt: writtenAt, ticks: 100 },
      register: [],
      attention: attentionNotYetRun(writtenAt),
      work: workNotYetRun(writtenAt),
      usage: usageNotYetRun(writtenAt),
      scheduler: schedulerNotYetSaid(writtenAt),
      snapshotStaleAfterMs: null,
      occurrenceHistory: null,
      jobs: { occurrences: [] },
    };
  }

  it("exits 0 for a healthy store and 1 for every unhealthy state", () => {
    const root = tempRoot();
    process.env["OVERSEER_STORE_DIR"] = root;
    expect(main([])).toBe(1); // (a) no checkpoint yet

    writeCheckpointFile(root, "not json");
    expect(main([])).toBe(1); // (c) unreadable

    writeCheckpointFile(root, JSON.stringify(checkpointAgoReal(DEFAULT_MAX_TICK_AGE_MS + 60_000, 0)));
    expect(main([])).toBe(1); // (b) stale

    writeCheckpointFile(root, JSON.stringify(checkpointAgoReal(0, DEFAULT_MAX_SNAPSHOT_AGE_MS + 60_000)));
    expect(main([])).toBe(1); // (d) deaf

    writeCheckpointFile(root, JSON.stringify(checkpointAgoReal(0, 0)));
    expect(main([])).toBe(0); // healthy
  });

  it("rejects a non-numeric --max-tick-age-ms rather than silently using the default", () => {
    const root = tempRoot();
    process.env["OVERSEER_STORE_DIR"] = root;
    expect(main(["--max-tick-age-ms", "not-a-number"])).toBe(2);
  });

  it("rejects a non-numeric --max-snapshot-age-ms rather than silently using the default", () => {
    const root = tempRoot();
    process.env["OVERSEER_STORE_DIR"] = root;
    expect(main(["--max-snapshot-age-ms", "not-a-number"])).toBe(2);
  });

  it("--max-tick-age-ms lets a caller tighten or loosen the heartbeat threshold", () => {
    const root = tempRoot();
    process.env["OVERSEER_STORE_DIR"] = root;
    writeCheckpointFile(root, JSON.stringify(checkpointAgoReal(2 * TICK_MS, 0)));
    // Healthy against the generous default...
    expect(main([])).toBe(0);
    // ...and stale against a threshold tighter than the age itself.
    expect(main(["--max-tick-age-ms", String(TICK_MS)])).toBe(1);
  });

  it("--max-snapshot-age-ms lets a caller tighten or loosen the deaf threshold", () => {
    const root = tempRoot();
    process.env["OVERSEER_STORE_DIR"] = root;
    writeCheckpointFile(root, JSON.stringify(checkpointAgoReal(0, 90_000)));
    // Healthy against the generous default...
    expect(main([])).toBe(0);
    // ...and deaf against a threshold tighter than the snapshot's age.
    expect(main(["--max-snapshot-age-ms", "60000"])).toBe(1);
  });
});
