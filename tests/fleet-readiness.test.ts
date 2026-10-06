/**
 * **The Readiness store, its parsers, and the conjunction that decides "green".**
 *
 * docs/plans/260909b-readiness-tab-latest-tests-and-typecheck-on-dev-with-24h-graphs.md.
 *
 * Most of what is asserted here is a refusal: the ways this feature could
 * report a green tree that is not one. Each has a name in the plan, and the
 * ones GPT Sol found in the plan review are marked, because a test whose reason
 * is forgotten is a test somebody deletes.
 *
 * The log fixtures under `tests/fixtures/readiness/tmux-jobs/` are **cut from
 * real `logs/tmux-jobs/` logs** — head and tail, ANSI stripped, uuids scrubbed.
 * `logs/` is gitignored, so a test pointed at a live one would pass only on this
 * box tonight.
 */
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync, mkdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkoutRoots,
  discoverLogs,
  readingFromLog,
  scanLogs,
  scriptBodiesFor,
  NO_SHA_IN_LOGS,
  QUIET_BEFORE_VOID_MS,
} from "../tools/fleet/readiness-backfill.js";
import {
  joinEnds,
  makeFailedTestFilesCapture,
  parseBanner,
  parseCheckTable,
  parseExitLine,
  parseFailedTestFiles,
  parseTypecheck,
  parseVitest,
  scopeOf,
  stripAnsi,
} from "../tools/fleet/readiness-parse.js";
import {
  MAX_RECORD_BYTES,
  openReadinessStore,
  procStartToken,
  processStillAlive,
  recordFileName,
  startedAtFromFileName,
  type ReadinessStore,
} from "../tools/fleet/readiness-store.js";
import { canVote, readinessVerdict } from "../tools/fleet/readiness-verdict.js";
import {
  describeFailedTestFiles,
  describeReadingOutcome,
  failedTestFilesForOutcome,
  failedTestFilesFrom,
  outcomeFromExit,
  parseRunRecord,
  resolveRecord,
  FAILED_TEST_FILES_CAP,
  FAILED_TEST_FILE_PATH_MAX,
  PENDING_TRUST_MS,
  type FinishedRecord,
  type Reading,
  type StartedRecord,
  type TreeStamp,
} from "../tools/fleet/readiness.js";

const FIXTURES = join(__dirname, "fixtures", "readiness", "tmux-jobs");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const SHA_A = "1111111111111111111111111111111111111111";
const SHA_B = "2222222222222222222222222222222222222222";

const clean = (sha: string): TreeStamp => ({ kind: "known", sha, branch: "dev", dirty: false });

function finished(over: Partial<FinishedRecord> = {}): FinishedRecord {
  return {
    schema: 1,
    runId: "aabbccddeeff",
    startedAt: "2026-09-09T10:00:00.000Z",
    pid: 4242,
    host: "box",
    procStartToken: "12345",
    cwd: "/repo",
    check: "test",
    scope: "full",
    commandLine: "vitest run",
    treeAtStart: clean(SHA_A),
    source: "wrapper",
    state: "finished",
    at: "2026-09-09T10:26:00.000Z",
    durationMs: 1_560_000,
    outcome: "pass",
    exit: 0,
    counts: { kind: "vitest", files: null, tests: null },
    treeAtEnd: clean(SHA_A),
    logPath: null,
    why: null,
    failedTestFiles: null,
    ...over,
  };
}

function started(over: Partial<StartedRecord> = {}): StartedRecord {
  return {
    schema: 1,
    runId: "ffeeddccbbaa",
    startedAt: "2026-09-09T10:00:00.000Z",
    pid: 4242,
    host: "box",
    procStartToken: "12345",
    cwd: "/repo",
    check: "test",
    scope: "full",
    commandLine: "vitest run",
    treeAtStart: clean(SHA_A),
    source: "wrapper",
    state: "started",
    ...over,
  };
}

const reading = (record: FinishedRecord | StartedRecord, alive = false): Reading =>
  resolveRecord(record, Date.parse("2026-09-09T11:00:00.000Z"), () => alive);

/* ------------------------------------------------------------------ *
 * Exit statuses.
 * ------------------------------------------------------------------ */

describe("what an exit status means", () => {
  it("reads 0 as a pass and an ordinary non-zero as a failure", () => {
    expect(outcomeFromExit(0).outcome).toBe("pass");
    expect(outcomeFromExit(1).outcome).toBe("fail");
    expect(outcomeFromExit(2).outcome).toBe("fail");
  });

  it("reads a shell's 128+signal as VOID, never as a failing suite", () => {
    /* The specimen on this box: a suite killed by the OOM killer under a page
       of green ticks. Reporting that as red sends somebody to look for a bug
       that is not there; reporting it as green is worse. */
    for (const [exit, signal] of [
      [129, 1],
      [137, 9],
      [143, 15],
      [159, 31],
    ] as const) {
      const read = outcomeFromExit(exit);
      expect(read.outcome, `exit ${exit}`).toBe("void");
      expect(read.why).toContain(`signal ${signal}`);
    }
  });

  it("covers the real-time signals too, which run past 31 on Linux", () => {
    /* This used to stop at 159 on the grounds that "signals are 1..31". Linux's
       real-time signals go to 64, so a shell status of 162 is signal 34 — a
       kill, drawn as a red suite. GPT Sol, 2026-09-09. */
    expect(outcomeFromExit(162).outcome).toBe("void");
    expect(outcomeFromExit(192).outcome).toBe("void");
  });

  it("does not treat 128 or 193 as signals, because no signal produces them", () => {
    /* 128 is a shell's "invalid argument to exit", not a signal at all. */
    expect(outcomeFromExit(128).outcome).toBe("fail");
    expect(outcomeFromExit(193).outcome).toBe("fail");
  });
});

/* ------------------------------------------------------------------ *
 * The record.
 * ------------------------------------------------------------------ */

describe("parsing a record back off disk", () => {
  it("round-trips a finished record", () => {
    const record = finished();
    expect(parseRunRecord(JSON.stringify(record))).toEqual(record);
  });

  it("round-trips a pending record", () => {
    const record = started();
    expect(parseRunRecord(JSON.stringify(record))).toEqual(record);
  });

  it("refuses a record that claims a verdict with no exit status", () => {
    /* No status means nobody watched it end, so `pass` there is a guess rather
       than a reading, and a guess is not something to draw green. */
    const bad = { ...finished(), exit: null, outcome: "pass" };
    expect(parseRunRecord(JSON.stringify(bad))).toBeNull();
  });

  it("refuses a record that claims a verdict on a signalled status", () => {
    const bad = { ...finished(), exit: 143, outcome: "pass" };
    expect(parseRunRecord(JSON.stringify(bad))).toBeNull();
  });

  it("allows void WITH a status, because that status says what killed it", () => {
    const killed = { ...finished(), exit: 137, outcome: "void" as const, why: "killed" };
    const parsed = parseRunRecord(JSON.stringify(killed));
    expect(parsed?.state === "finished" && parsed.exit).toBe(137);
  });

  it("reads an unknown counts arm as `none` rather than throwing it all away", () => {
    const later = { ...finished(), counts: { kind: "coverage", pct: 91 } };
    const parsed = parseRunRecord(JSON.stringify(later));
    expect(parsed?.state === "finished" && parsed.counts.kind).toBe("none");
    expect(parsed?.state === "finished" && parsed.outcome).toBe("pass");
  });

  it("does not coerce an unrecognised `gate` into advisory, which would demote a gate", () => {
    const old = {
      ...finished(),
      check: "check",
      counts: { kind: "check", steps: [{ name: "test", gate: false, verdict: "clean", findings: null }] },
    };
    const parsed = parseRunRecord(JSON.stringify(old));
    const counts = parsed?.state === "finished" ? parsed.counts : null;
    expect(counts?.kind === "check" && counts.steps[0]?.gate).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ *
 * Resolving a pending record. GPT Sol's P0.2.
 * ------------------------------------------------------------------ */

describe("a run that started and never finished", () => {
  it("is RUNNING while its process is alive", () => {
    expect(reading(started(), true).state).toBe("running");
  });

  it("is VOID once its process is gone — not absent, which would show the previous pass", () => {
    /* The finding that mattered most in the plan review: a wrapper killed
       before it could record leaves no evidence at all, and the dashboard goes
       on displaying the last pass as current. */
    const r = reading(started(), false);
    expect(r.state).toBe("void");
    expect(r.why).toContain("killed before it could");
  });

  it("is VOID when the pid exists but is a DIFFERENT process", () => {
    /* GPT Sol's P1.2: a pid is not an identity. Recycled within the trust
       window, an unrelated process makes a dead run read as running for ever,
       and the tab reports a suite in progress that nobody is running. */
    const record = started({ procStartToken: "12345" });
    const recycled = resolveRecord(record, Date.parse("2026-09-09T11:00:00.000Z"), (r) => {
      /* What `processStillAlive` does: the pid is there, the start token is not
         the one we recorded. */
      return r.procStartToken === "99999";
    });
    expect(recycled.state).toBe("void");
  });

  it("reads this process as alive, and a pid that cannot exist as not", () => {
    /* Drives the real `processStillAlive` rather than a stub, because the whole
       value of the start token is that it talks to /proc. */
    const mine = started({ pid: process.pid, host: hostname(), procStartToken: procStartToken(process.pid) });
    expect(processStillAlive(mine)).toBe(true);

    /* Same process, a token from a different boot: not us. */
    expect(processStillAlive({ ...mine, procStartToken: "1" })).toBe(false);

    /* A pid nothing can own. */
    expect(processStillAlive({ ...mine, pid: 0x7ffffff0, procStartToken: null })).toBe(false);
  });

  it("does not call a live run void merely because no token was recorded", () => {
    /* An ABSENT token is not a MISMATCH. Treating it as one would call every
       run from an older build, or from a box with no readable /proc, dead. */
    const noToken = started({ pid: process.pid, host: hostname(), procStartToken: null });
    expect(processStillAlive(noToken)).toBe(true);
  });

  it("refuses a record from another box, where a pid means nothing", () => {
    const elsewhere = started({ pid: process.pid, host: "some-other-box", procStartToken: null });
    expect(processStillAlive(elsewhere)).toBe(false);
  });

  it("stops believing a pid at all after the trust window, whatever the kernel says", () => {
    const old = started({ startedAt: new Date(Date.parse("2026-09-09T11:00:00.000Z") - PENDING_TRUST_MS - 1000).toISOString() });
    const r = resolveRecord(old, Date.parse("2026-09-09T11:00:00.000Z"), () => true);
    expect(r.state).toBe("void");
    expect(r.why).toContain("too long ago to trust a pid");
  });
});

/* ------------------------------------------------------------------ *
 * The store.
 * ------------------------------------------------------------------ */

describe("the per-run file store", () => {
  let dir: string;
  let store: ReadinessStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "readiness-"));
    const opened = openReadinessStore(dir);
    if (opened.kind !== "open") throw new Error(opened.why);
    store = opened.store;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const readAll = (): ReturnType<ReadinessStore["read"]> =>
    store.read({ sinceMs: 0, nowMs: Date.parse("2026-09-09T11:00:00.000Z"), isAlive: () => false });

  it("refuses a relative directory, because it would mean two histories", () => {
    const refused = openReadinessStore("relative/path");
    expect(refused.kind).toBe("refused");
  });

  it("writes and reads one record", () => {
    store.put(finished());
    const read = readAll();
    expect(read.readings).toHaveLength(1);
    expect(read.readings[0]?.state).toBe("pass");
    expect(read.unreadable).toEqual([]);
  });

  it("replaces the pending record with the terminal one at the same path", () => {
    const pending = started({ runId: "abc123abc123" });
    store.put(pending);
    expect(readdirSync(join(dir, "runs"))).toHaveLength(1);

    store.put(finished({ runId: "abc123abc123", startedAt: pending.startedAt }));
    /* One file, not two: there is no pair to join and no window in which both
       exist, which is the whole reason the path is derived from the run rather
       than from the moment. */
    expect(readdirSync(join(dir, "runs"))).toHaveLength(1);
    const read = readAll();
    expect(read.readings).toHaveLength(1);
    expect(read.readings[0]?.state).toBe("pass");
  });

  it("sorts by semantic time, not by directory order", () => {
    /* GPT Sol's P1.7: once anything can produce records out of order, "the last
       one listed" is not "the most recent". */
    store.put(finished({ runId: "bbbb", startedAt: "2026-09-09T09:00:00.000Z", at: "2026-09-09T09:10:00.000Z" }));
    store.put(finished({ runId: "aaaa", startedAt: "2026-09-09T10:00:00.000Z", at: "2026-09-09T10:10:00.000Z" }));
    const times = readAll().readings.map((r) => r.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times).toHaveLength(2);
  });

  it("counts a record it cannot read instead of silently dropping it", () => {
    /* A corrupt LATEST record that is merely skipped exposes the previous pass
       as the current state. GPT Sol's P1.6. */
    store.put(finished());
    writeFileSync(join(dir, "runs", recordFileName(Date.parse("2026-09-09T10:30:00.000Z"), "corrupt00")), "{not json");
    const read = readAll();
    expect(read.readings).toHaveLength(1);
    expect(read.unreadable).toHaveLength(1);
  });

  it("ignores a file that is not one of ours without calling it a hole", () => {
    store.put(finished());
    writeFileSync(join(dir, "runs", "something-else.txt"), "hello");
    const read = readAll();
    expect(read.unreadable).toEqual([]);
    expect(read.readings).toHaveLength(1);
  });

  it("finds a run that started before the window and finished inside it", () => {
    /* The filename carries the START and the page plots the FINISH. A 26-minute
       suite that began before the window still has to be found. */
    store.put(finished({ startedAt: "2026-09-09T09:40:00.000Z", at: "2026-09-09T10:06:00.000Z" }));
    const read = store.read({
      sinceMs: Date.parse("2026-09-09T10:00:00.000Z"),
      nowMs: Date.parse("2026-09-09T11:00:00.000Z"),
      isAlive: () => false,
    });
    expect(read.readings).toHaveLength(1);
  });

  it("sweeps records past the retention age and leaves the rest", () => {
    store.put(finished({ runId: "older", startedAt: "2026-08-01T00:00:00.000Z", at: "2026-08-01T00:10:00.000Z" }));
    store.put(finished({ runId: "newer" }));
    expect(store.sweep(Date.parse("2026-09-09T11:00:00.000Z"))).toBe(1);
    expect(readdirSync(join(dir, "runs"))).toHaveLength(1);
  });

  it("encodes and decodes its own filenames", () => {
    const ms = Date.parse("2026-09-09T10:00:00.000Z");
    expect(startedAtFromFileName(recordFileName(ms, "abc123"))).toBe(ms);
    /* A name the reader would skip is a record that vanishes, so the writer
       refuses it rather than producing one. */
    expect(() => store.put(finished({ runId: "ab" }))).toThrow(/does not make a filename/);
    expect(startedAtFromFileName("nonsense.json")).toBeNull();
    expect(startedAtFromFileName("000000000000001-abc123.json.tmp-1-2")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The parsers, on real output.
 * ------------------------------------------------------------------ */

describe("reading a check's own output", () => {
  it("joins two overlapping windows without counting the middle twice", () => {
    /* Measured on the wrapper's first real run: a typecheck of four projects
       reported eight, because output shorter than head+tail sits in BOTH
       windows. The numbers looked plausible, which is why it needs a test
       rather than an eye. */
    const whole = fixture("typecheck-pass.log");
    expect(parseTypecheck(joinEnds(whole, whole, whole.length)).counts.projects).toBe(3);
    expect(parseTypecheck(whole + whole).counts.projects).toBe(6);

    const head = "head\n";
    const tail = "tail\n";
    expect(joinEnds(head, tail, 10_000)).toBe("head\n\n…\ntail\n");
  });

  it("does not duplicate check's steps when the log fits in both windows", () => {
    const whole = fixture("check-fail.log");
    const steps = parseCheckTable(joinEnds(whole, whole, whole.length)).counts.steps;
    expect(steps.filter((s) => s.name === "test")).toHaveLength(1);
  });

  it("strips ANSI without eating ordinary square brackets", () => {
    /* The escape is load-bearing: a pattern with no ESC in front would eat
       vitest's own `[1/1]` separators. */
    expect(stripAnsi("[32m✓[39m ok [1/1] done")).toBe("✓ ok [1/1] done");
  });

  it("takes the check kind and the arguments from npm's two banner lines", () => {
    const banner = parseBanner(fixture("check-pass.log"));
    expect(banner?.kind).toBe("check");
    expect(banner?.commandLine).toBe("tsx scripts/check.ts");
  });

  it("reads a bare vitest log as a test run whose SCOPE is unknown, never as the suite", () => {
    /* Most test runs on this box are `npx vitest run <paths>`, not `npm test`,
       so refusing these outright made the backfill nearly blind — its own
       fixtures caught that. But a `RUN v4.x` banner could be one file or all
       786 and the log does not say, so the scope is unknown, and unknown scope
       can never satisfy the verdict. */
    const bare = parseBanner("\n RUN  v4.1.11 /home/greg/code/spideryarn2\n");
    expect(bare?.kind).toBe("test");
    expect(bare?.commandLine).toBeNull();
    expect(scopeOf(bare!, { test: "vitest run" })).toBe("unknown");
  });

  it("still refuses logs that are not checks at all", () => {
    expect(parseBanner(fixture("overseer-daemon.log"))).toBeNull();
    expect(parseBanner(fixture("codex-run.log"))).toBeNull();
  });

  it("prefers npm's banner to vitest's, because only npm's carries the arguments", () => {
    const both = parseBanner("\n> spideryarn@1.0.0 test\n> vitest run tests/one.test.ts\n\n RUN  v4.1.11 /repo\n");
    expect(both?.script).toBe("test");
    expect(both?.commandLine).toBe("vitest run tests/one.test.ts");
  });

  it("tells a full run from a narrowed one by the second banner line", () => {
    const bodies = { test: "vitest run" };
    expect(scopeOf({ kind: "test", script: "test", commandLine: "vitest run" }, bodies)).toBe("full");
    expect(scopeOf({ kind: "test", script: "test", commandLine: "vitest run tests/one.test.ts" }, bodies)).toBe("narrowed");
    expect(scopeOf({ kind: "test", script: "test", commandLine: null }, bodies)).toBe("unknown");
  });

  it("reads the real package.json, so a copy of the script bodies cannot drift", () => {
    const bodies = scriptBodiesFor(join(__dirname, ".."));
    expect(bodies["test"]).toBeTypeOf("string");
    const banner = { kind: "test" as const, script: "test", commandLine: bodies["test"] ?? "" };
    expect(scopeOf(banner, bodies)).toBe("full");
  });

  it("reads vitest's tallies, passing and failing", () => {
    expect(parseVitest(fixture("vitest-pass.log")).counts.tests).toEqual({
      passed: 371,
      failed: 0,
      skipped: 0,
      total: 371,
    });
    const failed = parseVitest(fixture("vitest-fail.log"));
    expect(failed.counts.tests).toEqual({ passed: 4, failed: 1, skipped: 0, total: 5 });
    expect(failed.counts.files).toEqual({ passed: 0, failed: 1, skipped: 0, total: 1 });
  });

  it("says a vitest log has no footer when it was cut off", () => {
    expect(parseVitest(fixture("vitest-in-progress.log")).hasFooter).toBe(false);
    expect(parseVitest(fixture("vitest-pass.log")).hasFooter).toBe(true);
  });

  it("reads npm run check's summary table, keeping the gate/advisory split", () => {
    const table = parseCheckTable(fixture("check-fail.log")).counts;
    const byName = new Map(table.steps.map((s) => [s.name, s]));
    expect(byName.get("test")).toEqual({ name: "test", gate: "gate", verdict: "failed", findings: null });
    expect(byName.get("dupes")).toEqual({ name: "dupes", gate: "advisory", verdict: "findings", findings: 308 });
    /* A clean step's mark does not say which it is, and defaulting either way
       is wrong in one direction. */
    expect(byName.get("typecheck")?.gate).toBe("unknown");
    expect(byName.get("typecheck")?.verdict).toBe("clean");
  });

  it("needs BOTH of vitest's tally lines, not either", () => {
    /* A process cut between them has not printed its whole footer. */
    expect(parseVitest(" Test Files  2 passed (2)\n").hasFooter).toBe(false);
    expect(parseVitest("      Tests  371 passed (371)\n").hasFooter).toBe(false);
    expect(parseVitest(" Test Files  2 passed (2)\n      Tests  371 passed (371)\n").hasFooter).toBe(true);
  });

  it("needs typecheck's coverage line, not merely one project line", () => {
    /* `|| projects > 0` let a typecheck killed after its first project satisfy
       the completion guard — the guard letting through what it exists to catch. */
    expect(parseTypecheck("✓ src/web/tsconfig.json  (309 files)\n").hasFooter).toBe(false);
    expect(parseTypecheck(fixture("typecheck-pass.log")).hasFooter).toBe(true);
    /* Its errors go to stderr and the tick still prints, so a FAILING run has a
       footer too — the footer proves it finished, the exit status decides. */
    expect(parseTypecheck(fixture("typecheck-fail.log")).hasFooter).toBe(true);
  });

  it("recognises --offline's differently-worded conclusion", () => {
    expect(parseCheckTable("All gates green, minus the database suites.\n").hasFooter).toBe(true);
  });

  it("requires check's verdict sentence, not merely its table", () => {
    expect(parseCheckTable(fixture("check-pass.log")).hasFooter).toBe(true);
    expect(parseCheckTable(fixture("check-fail.log")).hasFooter).toBe(true);
    expect(parseCheckTable("  ✓ typecheck    clean\n").hasFooter).toBe(false);
  });

  it("counts typecheck's projects and errors without letting errors be the verdict", () => {
    expect(parseTypecheck(fixture("typecheck-pass.log")).counts).toEqual({ kind: "typecheck", projects: 3, errors: 0 });
    expect(parseTypecheck(fixture("typecheck-fail.log")).counts).toEqual({ kind: "typecheck", projects: 3, errors: 2 });
  });

  it("requires EXIT= to be the FINAL line, not merely present somewhere", () => {
    /* GPT Sol's P1.4: a check that prints an EXIT=-shaped line of its own and
       then carries on — or hangs — would otherwise read as a completed pass.
       tmux-job.ts writes this line and nothing after it. */
    expect(parseExitLine("EXIT=0\nstill going\n")).toBeNull();
    expect(parseExitLine("some output\nEXIT=0\n")).toBe(0);
    expect(parseExitLine("some output\nEXIT=0\n\n  \n")).toBe(0);
  });

  it("does not double-count a small log whose bytes exceed its characters", () => {
    /* The doubling bug, second time: joinEnds compares against string lengths,
       and the backfill first handed it stat.size in BYTES. A log of vitest ticks
       is three bytes per character, so neither whole-window branch fired.
       GPT Sol's P1.5. */
    const whole = fixture("typecheck-pass.log");
    const bytes = Buffer.byteLength(whole, "utf8");
    expect(bytes).toBeGreaterThan(whole.length);
    /* Told in characters, as the contract now says: one copy. */
    expect(parseTypecheck(joinEnds(whole, whole, whole.length)).counts.projects).toBe(3);
  });

  it("takes the LAST EXIT= line, and none when there is none", () => {
    expect(parseExitLine(fixture("vitest-pass.log"))).toBe(0);
    expect(parseExitLine(fixture("vitest-fail.log"))).toBe(1);
    expect(parseExitLine(fixture("vitest-killed-143.log"))).toBe(143);
    expect(parseExitLine(fixture("vitest-killed-no-exit.log"))).toBeNull();
    expect(parseExitLine("EXIT=0\nmore output\nEXIT=1\n")).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * The backfill.
 * ------------------------------------------------------------------ */

describe("reconstructing a run from a tmux-job log", () => {
  const NOW = Date.parse("2026-09-09T12:00:00.000Z");
  const long_ago = NOW - QUIET_BEFORE_VOID_MS - 60_000;

  const fromFixture = (name: string, over: { mtimeMs?: number; stillMoving?: boolean } = {}) =>
    readingFromLog(
      `/repo/logs/tmux-jobs/${name}`,
      {
        head: fixture(name),
        /* One copy, not head-plus-tail: these fixtures are small enough that the
           two windows would be the same bytes, and feeding both counts every
           line twice. That is a real bug this suite used to reproduce. */
        text: fixture(name),
        mtimeMs: over.mtimeMs ?? long_ago,
        stillMoving: over.stillMoving ?? false,
      },
      { cwd: "/repo", nowMs: NOW, scriptBodies: { test: "vitest run", check: "tsx scripts/check.ts" } },
    );

  it("reads a passing suite as a pass", () => {
    const out = fromFixture("vitest-pass.log");
    expect("reading" in out && out.reading.state).toBe("pass");
  });

  it("reads a failing suite as a failure", () => {
    const out = fromFixture("vitest-fail.log");
    expect("reading" in out && out.reading.state).toBe("fail");
  });

  it("reads EXIT=143 as VOID, not as a failing suite", () => {
    const out = fromFixture("vitest-killed-143.log");
    expect("reading" in out && out.reading.state).toBe("void");
  });

  it("reads a quiet log with no EXIT= line as VOID, never as a pass", () => {
    /* Green ticks all the way down and nothing that says how it ended. */
    const out = fromFixture("vitest-killed-no-exit.log");
    expect("reading" in out && out.reading.state).toBe("void");
    expect("reading" in out && out.reading.why).toContain("no EXIT= line");
  });

  it("reads a log that is still moving as RUNNING, not void", () => {
    /* GPT Sol's P1.3: a log read a second before its EXIT= line lands is not
       complete, and calling that void would freeze a wrong answer. */
    const moving = fromFixture("vitest-in-progress.log", { mtimeMs: NOW - 1000, stillMoving: true });
    expect("reading" in moving && moving.reading.state).toBe("running");

    const recent = fromFixture("vitest-in-progress.log", { mtimeMs: NOW - 30_000 });
    expect("reading" in recent && recent.reading.state).toBe("running");
  });

  it("refuses to call EXIT=0 a pass when the run printed no summary", () => {
    const truncated = readingFromLog(
      "/repo/logs/tmux-jobs/odd.log",
      {
        head: "\n> spideryarn@1.0.0 test\n> vitest run\n",
        text: "\n> spideryarn@1.0.0 test\n> vitest run\nsome output that is not a summary\nEXIT=0\n",
        mtimeMs: long_ago,
        stillMoving: false,
      },
      { cwd: "/repo", nowMs: NOW, scriptBodies: { test: "vitest run" } },
    );
    expect("reading" in truncated && truncated.reading.state).toBe("void");
  });

  it("calls a run void when told its session is gone, without waiting out the timer", () => {
    /* Sol's P1.3: the plan claimed "with no live session" and the code checked
       only mtime. The told answer now decides, in both directions. */
    const told = readingFromLog(
      "/repo/logs/tmux-jobs/dead.log",
      { head: fixture("vitest-in-progress.log"), text: fixture("vitest-in-progress.log"), mtimeMs: NOW - 5_000, stillMoving: false },
      { cwd: "/repo", nowMs: NOW, scriptBodies: { test: "vitest run" }, sessionLive: false },
    );
    expect("reading" in told && told.reading.state).toBe("void");
    expect("reading" in told && told.reading.why).toContain("session that was writing it is gone");
  });

  it("keeps a run alive when told its session is alive, however long it has been quiet", () => {
    /* A suite waiting on a database prints nothing for a long time, and calling
       that killed manufactures an outage. */
    const told = readingFromLog(
      "/repo/logs/tmux-jobs/slow.log",
      { head: fixture("vitest-in-progress.log"), text: fixture("vitest-in-progress.log"), mtimeMs: long_ago, stillMoving: false },
      { cwd: "/repo", nowMs: NOW, scriptBodies: { test: "vitest run" }, sessionLive: true },
    );
    expect("reading" in told && told.reading.state).toBe("running");
  });

  it("is still going if the file grew under the read, whatever it appears to end with", () => {
    const moving = readingFromLog(
      "/repo/logs/tmux-jobs/growing.log",
      { head: fixture("vitest-pass.log"), text: fixture("vitest-pass.log"), mtimeMs: long_ago, stillMoving: true },
      { cwd: "/repo", nowMs: NOW, scriptBodies: { test: "vitest run" } },
    );
    expect("reading" in moving && moving.reading.state).toBe("running");
  });

  it("skips logs that are not checks at all", () => {
    expect(fromFixture("overseer-daemon.log")).toEqual({ skip: "not-a-check" });
    expect(fromFixture("codex-run.log")).toEqual({ skip: "not-a-check" });
    expect(fromFixture("npm-missing-script.log")).toEqual({ skip: "not-a-check" });
  });

  it("stamps every reconstructed run as having no commit, permanently", () => {
    const out = fromFixture("vitest-pass.log");
    expect("reading" in out && out.reading.record.treeAtStart).toEqual({ kind: "unknown", why: NO_SHA_IN_LOGS });
  });

  it("gives a bare vitest run an unknown scope, so it can never vote", () => {
    const out = fromFixture("vitest-pass.log");
    expect("reading" in out && out.reading.record.scope).toBe("unknown");
    if ("reading" in out) expect(canVote(out.reading, SHA_A).ok).toBe(false);
  });

  it("gives the same log the same run id every time, so a rescan is not a second run", () => {
    const a = fromFixture("vitest-pass.log");
    const b = fromFixture("vitest-pass.log");
    expect("reading" in a && "reading" in b && a.reading.record.runId).toBe(
      "reading" in b ? b.reading.record.runId : "",
    );
  });
});

describe("scanning a directory of logs", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "readiness-logs-"));
    mkdirSync(join(root, "logs", "tmux-jobs"), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const put = (name: string, text: string, mtimeMs: number): void => {
    const path = join(root, "logs", "tmux-jobs", name);
    writeFileSync(path, text);
    utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
  };

  const NOW = Date.parse("2026-09-09T12:00:00.000Z");
  const scan = (knownRunIds: Set<string> = new Set()) =>
    scanLogs({
      roots: [root],
      sinceMs: NOW - 24 * 3600 * 1000,
      nowMs: NOW,
      knownRunIds,
      scriptBodiesFor: () => ({ test: "vitest run", check: "tsx scripts/check.ts" }),
    });

  it("finds the checks and leaves everything else alone", () => {
    put("a.log", fixture("vitest-pass.log"), NOW - 3_600_000);
    put("b.log", fixture("check-fail.log"), NOW - 7_200_000);
    put("c.log", fixture("overseer-daemon.log"), NOW - 1_800_000);
    const result = scan();
    expect(result.readings.map((r) => r.record.check).sort()).toEqual(["check", "test"]);
    expect(result.unreadable).toEqual([]);
  });

  it("skips a log whose run the store already holds, so the wrapper is not doubled", () => {
    /* GPT Sol's P0.4, and it is the NORMAL path: the wrapper runs inside
       tmux-job, so every wrapper run also leaves a log — and tmux appends
       EXIT= after the wrapper exits, so the weaker duplicate would win on
       recency. */
    put("w.log", `readiness-run abc123def456 test\n${fixture("vitest-pass.log")}`, NOW - 600_000);
    expect(scan().readings).toHaveLength(1);

    const deduped = scan(new Set(["abc123def456"]));
    expect(deduped.readings).toHaveLength(0);
    expect(deduped.dedupedAgainstWrapper).toBe(1);
  });

  it("says how many logs it did not open rather than quietly showing fewer", () => {
    for (let i = 0; i < 5; i += 1) put(`x${i}.log`, fixture("vitest-pass.log"), NOW - i * 60_000);
    const result = scanLogs({
      roots: [root],
      sinceMs: NOW - 24 * 3600 * 1000,
      nowMs: NOW,
      knownRunIds: new Set(),
      scriptBodiesFor: () => ({ test: "vitest run" }),
      maxLogs: 2,
    });
    expect(result.readings).toHaveLength(2);
    expect(result.skippedForBudget).toBe(3);
  });

  it("spends its budget on the newest logs across every root", () => {
    put("old.log", fixture("vitest-fail.log"), NOW - 10_800_000);
    put("new.log", fixture("vitest-pass.log"), NOW - 60_000);
    const result = scanLogs({
      roots: [root],
      sinceMs: NOW - 24 * 3600 * 1000,
      nowMs: NOW,
      knownRunIds: new Set(),
      scriptBodiesFor: () => ({ test: "vitest run" }),
      maxLogs: 1,
    });
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]?.state).toBe("pass");
  });

  it("stops LISTING at the discovery cap, and says the answer is incomplete", () => {
    /* The cap used to sit after `readdirSync`, which materialises every entry —
       so a directory of 100,000 logs was fully read and fully walked whatever
       the cap said, and the bound existed only on paper. GPT Sol, round 2. */
    for (let i = 0; i < 12; i += 1) put(`d${i}.log`, fixture("vitest-pass.log"), NOW - i * 60_000);
    const found = discoverLogs({ roots: [root], sinceMs: 0, maxDiscovered: 4 });
    expect(found.candidates.length).toBeLessThanOrEqual(4);
    expect(found.truncated).toBe(true);

    const all = discoverLogs({ roots: [root], sinceMs: 0, maxDiscovered: 100 });
    expect(all.candidates).toHaveLength(12);
    expect(all.truncated).toBe(false);
  });

  it("never opens a FIFO, which would block the whole dashboard", () => {
    /* A single-threaded server that opens a FIFO nobody writes to stops
       answering anything. `isFile()` excludes it before any open happens, and
       `statSync` does not block on one either. */
    const fifo = join(root, "logs", "tmux-jobs", "trap.log");
    execFileSync("mkfifo", [fifo]);
    put("real.log", fixture("vitest-pass.log"), NOW - 60_000);

    const found = discoverLogs({ roots: [root], sinceMs: 0 });
    expect(found.candidates.map((c) => c.path)).not.toContain(fifo);
    expect(found.candidates).toHaveLength(1);
  });

  it("reports a directory it could not list, rather than calling it empty", () => {
    /* "There are no worktrees" and "we could not see the worktrees" are
       different facts, and this used to swallow both identically. */
    const locked = mkdtempSync(join(tmpdir(), "readiness-locked-"));
    mkdirSync(join(locked, "logs", "tmux-jobs"), { recursive: true });
    chmodSync(join(locked, "logs", "tmux-jobs"), 0o000);
    try {
      const found = discoverLogs({ roots: [locked], sinceMs: 0 });
      expect(found.candidates).toEqual([]);
      expect(found.unreadableRoots).toHaveLength(1);
    } finally {
      chmodSync(join(locked, "logs", "tmux-jobs"), 0o755);
      rmSync(locked, { recursive: true, force: true });
    }
  });

  it("stops LISTING worktrees at the cap, like the log discovery does", () => {
    /* The cap was applied after `readdirSync`, which materialises every entry —
       the exact bug that had just been fixed one function down, left in place
       here. GPT Sol, round 3. */
    const many = mkdtempSync(join(tmpdir(), "readiness-many-"));
    try {
      for (let i = 0; i < 150; i += 1) mkdirSync(join(many, ".claude", "worktrees", `w${i}`), { recursive: true });
      const found = checkoutRoots(many, null);
      expect(found.roots.length).toBeLessThanOrEqual(101);
      expect(found.truncated).toBe(true);
    } finally {
      rmSync(many, { recursive: true, force: true });
    }
  });

  it("counts entries INSPECTED, not roots accepted", () => {
    /* 150 non-directory entries used to be walked in full with `truncated`
       staying false — the bound measuring the wrong thing. GPT Sol, round 4. */
    const many = mkdtempSync(join(tmpdir(), "readiness-files-"));
    try {
      mkdirSync(join(many, ".claude", "worktrees"), { recursive: true });
      for (let i = 0; i < 150; i += 1) writeFileSync(join(many, ".claude", "worktrees", `f${i}`), "");
      const found = checkoutRoots(many, null);
      /* No worktrees found — they are all files — but the listing was still
         abandoned, and that has to be said. */
      expect(found.roots).toEqual([many]);
      expect(found.truncated).toBe(true);
    } finally {
      rmSync(many, { recursive: true, force: true });
    }
  });

  it("reports a worktrees directory it cannot list, rather than calling it absent", () => {
    const locked = mkdtempSync(join(tmpdir(), "readiness-lockedroots-"));
    try {
      mkdirSync(join(locked, ".claude", "worktrees"), { recursive: true });
      chmodSync(join(locked, ".claude", "worktrees"), 0o000);
      const found = checkoutRoots(locked, null);
      expect(found.why).not.toBeNull();
      expect(found.roots).toEqual([locked]);
    } finally {
      chmodSync(join(locked, ".claude", "worktrees"), 0o755);
      rmSync(locked, { recursive: true, force: true });
    }
  });

  it("bounds the checkout roots and distinguishes absent from unreadable", () => {
    const bare = mkdtempSync(join(tmpdir(), "readiness-roots-"));
    try {
      /* No `.claude/worktrees` at all: normal, not a fault. */
      const none = checkoutRoots(bare, null);
      expect(none.roots).toEqual([bare]);
      expect(none.why).toBeNull();
      expect(none.truncated).toBe(false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  /**
   * Since 2026-10-05 every new worktree on the box is under
   * `/var/tmp/spideryarn-worktrees/`, and this listed only
   * `<primary>/.claude/worktrees/` — so the scan covered the primary and a
   * shrinking set of old trees, and reported nothing missing.
   */
  it("lists the worktrees under the external root as well as the ones in the repo", () => {
    const primary = mkdtempSync(join(tmpdir(), "readiness-two-roots-"));
    const external = mkdtempSync(join(tmpdir(), "readiness-external-"));
    try {
      mkdirSync(join(primary, ".claude", "worktrees", "old-tree"), { recursive: true });
      mkdirSync(join(external, "new-tree"));
      writeFileSync(join(external, "a-file"), "");
      const found = checkoutRoots(primary, external);
      expect(found.roots).toEqual([primary, join(primary, ".claude", "worktrees", "old-tree"), join(external, "new-tree")]);
      expect(found.why).toBeNull();
      expect(found.truncated).toBe(false);
      // And with no in-repo directory at all, which is a checkout made after the move.
      rmSync(join(primary, ".claude"), { recursive: true });
      expect(checkoutRoots(primary, external).roots).toEqual([primary, join(external, "new-tree")]);
    } finally {
      rmSync(primary, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it("caps each directory on its own, and a fault in one still lists the other", () => {
    const primary = mkdtempSync(join(tmpdir(), "readiness-two-caps-"));
    const external = mkdtempSync(join(tmpdir(), "readiness-external-cap-"));
    try {
      for (let i = 0; i < 150; i += 1) mkdirSync(join(primary, ".claude", "worktrees", `w${i}`), { recursive: true });
      mkdirSync(join(external, "new-tree"));
      const full = checkoutRoots(primary, external);
      expect(full.truncated).toBe(true);
      // A full in-repo directory used up a shared budget; the new tree must still be seen.
      expect(full.roots).toContain(join(external, "new-tree"));

      chmodSync(join(primary, ".claude", "worktrees"), 0o000);
      const locked = checkoutRoots(primary, external);
      expect(locked.why).not.toBeNull();
      expect(locked.roots).toEqual([primary, join(external, "new-tree")]);
      // An external root that is not there is the Mac, and a box before provision.sh: not a fault.
      chmodSync(join(primary, ".claude", "worktrees"), 0o755);
      expect(checkoutRoots(primary, join(external, "absent")).why).toBeNull();
    } finally {
      chmodSync(join(primary, ".claude", "worktrees"), 0o755);
      rmSync(primary, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it("treats a checkout with no logs directory as quiet, not as broken", () => {
    const bare = mkdtempSync(join(tmpdir(), "readiness-bare-"));
    try {
      const result = scanLogs({
        roots: [bare],
        sinceMs: 0,
        nowMs: NOW,
        knownRunIds: new Set(),
        scriptBodiesFor: () => ({}),
      });
      expect(result.unreadableRoots).toEqual([]);
      expect(result.readings).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ *
 * The verdict. GPT Sol's P0.5, and the reason this file exists.
 * ------------------------------------------------------------------ */

describe("what counts as evidence about dev", () => {
  it("refuses a reconstructed run, which has no commit to be about", () => {
    const scanned = finished({ source: "tmux-log", treeAtStart: { kind: "unknown", why: NO_SHA_IN_LOGS }, treeAtEnd: { kind: "unknown", why: NO_SHA_IN_LOGS } });
    const vote = canVote(reading(scanned), SHA_A);
    expect(vote.ok).toBe(false);
  });

  it("refuses a narrowed run, however green it looks", () => {
    const one = finished({ scope: "narrowed", commandLine: "vitest run tests/one.test.ts" });
    const vote = canVote(reading(one), SHA_A);
    expect(vote.ok).toBe(false);
    expect(!vote.ok && vote.why).toContain("not the whole check");
  });

  it("refuses a run whose checkout moved while it was going", () => {
    /* A 26-minute suite on a tree edited at minute three tested neither commit. */
    const moved = finished({ treeAtStart: clean(SHA_A), treeAtEnd: clean(SHA_B) });
    const vote = canVote(reading(moved), SHA_A);
    expect(vote.ok).toBe(false);
    expect(!vote.ok && vote.why).toContain("moved to another commit");
  });

  it("refuses a run on a dirty tree, because what passed was not a commit", () => {
    const dirty = finished({ treeAtEnd: { kind: "known", sha: SHA_A, branch: "dev", dirty: true } });
    expect(canVote(reading(dirty), SHA_A).ok).toBe(false);
  });

  it("refuses a run on another commit", () => {
    expect(canVote(reading(finished()), SHA_B).ok).toBe(false);
  });

  it("accepts a full wrapper run that began and ended clean on this commit", () => {
    expect(canVote(reading(finished()), SHA_A).ok).toBe(true);
  });
});

describe("the readiness verdict", () => {
  const verdict = (readings: Reading[], over: Partial<Parameters<typeof readinessVerdict>[0]> = {}) =>
    readinessVerdict({ readings, devSha: SHA_A, caveat: "…", unreadable: 0, ...over });

  it("is green only when every required check passed on the SAME commit", () => {
    const ready = verdict([
      reading(finished({ check: "test" })),
      reading(finished({ check: "typecheck", runId: "tc" })),
    ]);
    expect(ready.kind).toBe("ready");
  });

  it("REFUSES tests on one commit and typecheck on another", () => {
    /* The hole GPT Sol found in the first draft: two green tiles on two
       different commits, and nothing anywhere saying no commit had passed both. */
    const split = verdict([
      reading(finished({ check: "test", treeAtStart: clean(SHA_A), treeAtEnd: clean(SHA_A) })),
      reading(finished({ check: "typecheck", runId: "tc", treeAtStart: clean(SHA_B), treeAtEnd: clean(SHA_B) })),
    ]);
    expect(split.kind).toBe("unknown");
    expect(split.kind === "unknown" && split.why).toContain("typecheck");
  });

  it("says UNKNOWN rather than not-ready when a check has simply not been run", () => {
    const partial = verdict([reading(finished({ check: "test" }))]);
    expect(partial.kind).toBe("unknown");
    expect(partial.kind === "unknown" && partial.why).toContain("nobody has run them");
  });

  it("says NOT READY when a required check actually failed", () => {
    const red = verdict([
      reading(finished({ check: "test", outcome: "fail", exit: 1 })),
      reading(finished({ check: "typecheck", runId: "tc" })),
    ]);
    expect(red.kind).toBe("not-ready");
    expect(red.kind === "not-ready" && red.failing.map((f) => f.check)).toEqual(["test"]);
  });

  it("accepts one full `npm run check` in place of the separate checks", () => {
    const whole = verdict([reading(finished({ check: "check", runId: "chk", counts: { kind: "check", steps: [] } }))]);
    expect(whole.kind).toBe("ready");
  });

  it("does NOT let an old whole-check pass outrank a newer failing test", () => {
    /* GPT Sol's P0.1, first form. The whole-check shortcut used to return
       `ready` before the newer evidence was looked at. A run of `npm run check`
       IS a run of the test gate, so it belongs on the test timeline rather than
       in a row of its own that can disagree with it by age. */
    const out = verdict([
      reading(finished({ check: "check", runId: "chk", at: "2026-09-09T10:00:00.000Z", counts: { kind: "check", steps: [] } })),
      reading(finished({ check: "test", runId: "later", at: "2026-09-09T10:30:00.000Z", outcome: "fail", exit: 1 })),
    ]);
    expect(out.kind).toBe("not-ready");
  });

  it("does NOT let an old whole-check pass outrank a newer VOID test", () => {
    const out = verdict([
      reading(finished({ check: "check", runId: "chk", at: "2026-09-09T10:00:00.000Z", counts: { kind: "check", steps: [] } })),
      resolveRecord(
        started({ runId: "running", check: "test", startedAt: "2026-09-09T10:30:00.000Z" }),
        Date.parse("2026-09-09T11:00:00.000Z"),
        () => false,
      ),
    ]);
    expect(out.kind).toBe("unknown");
  });

  it("does NOT let old standalone passes outrank a newer failing whole-check", () => {
    /* Sol's P0.1, second form: the shortcut is skipped because the newest
       whole-check is not a pass, and the stale standalone passes are then the
       newest test/typecheck readings. The failing table has to reach the
       per-check timelines. */
    const out = verdict([
      reading(finished({ check: "test", runId: "t", at: "2026-09-09T10:00:00.000Z" })),
      reading(finished({ check: "typecheck", runId: "tc", at: "2026-09-09T10:00:00.000Z" })),
      reading(
        finished({
          check: "check",
          runId: "chk",
          at: "2026-09-09T10:30:00.000Z",
          outcome: "fail",
          exit: 1,
          counts: {
            kind: "check",
            steps: [
              { name: "typecheck", gate: "unknown", verdict: "clean", findings: null },
              { name: "test", gate: "gate", verdict: "failed", findings: null },
            ],
          },
        }),
      ),
    ]);
    expect(out.kind).toBe("not-ready");
    expect(out.kind === "not-ready" && out.failing.map((f) => f.check)).toEqual(["test"]);
  });

  it("does NOT let a PARTLY readable failing check expose a stale pass", () => {
    /* GPT Sol drove this one end to end. The failing check's table names
       typecheck but not test, so `rows.size > 0` skipped the unreadable branch,
       no event was emitted for test, and its old pass survived into `ready`.
       A table we could only partly read is not evidence the rest was fine. */
    const out = verdict([
      reading(finished({ check: "test", runId: "t", at: "2026-09-09T10:00:00.000Z" })),
      reading(finished({ check: "typecheck", runId: "tc", at: "2026-09-09T10:00:00.000Z" })),
      reading(
        finished({
          check: "check",
          runId: "chk",
          at: "2026-09-09T10:30:00.000Z",
          outcome: "fail",
          exit: 1,
          counts: {
            kind: "check",
            steps: [{ name: "typecheck", gate: "unknown", verdict: "clean", findings: null }],
          },
        }),
      ),
    ]);
    expect(out.kind).toBe("unknown");
    expect(out.kind === "unknown" && out.why).toContain("does not say how this check fared");
  });

  it("does NOT let a `findings` row on a required check stand in for a pass", () => {
    /* A gate cannot print `findings` under today's check.ts — the label is
       advisory-only — so if one ever appears it is drift, and drift must read as
       unsettled rather than quietly leaving the previous pass in place. */
    const out = verdict([
      reading(finished({ check: "test", runId: "t", at: "2026-09-09T10:00:00.000Z" })),
      reading(finished({ check: "typecheck", runId: "tc", at: "2026-09-09T10:00:00.000Z" })),
      reading(
        finished({
          check: "check",
          runId: "chk",
          at: "2026-09-09T10:30:00.000Z",
          outcome: "fail",
          exit: 1,
          counts: {
            kind: "check",
            steps: [
              { name: "typecheck", gate: "unknown", verdict: "clean", findings: null },
              { name: "test", gate: "unknown", verdict: "findings", findings: 3 },
            ],
          },
        }),
      ),
    ]);
    expect(out.kind).toBe("unknown");
  });

  it("refuses a passing check record whose own table says a gate FAILED", () => {
    /* GPT Sol drove this to `ready`. The outer outcome said pass, so the table
       was never consulted, and passes were emitted for every required check.
       A record whose verdict and detail disagree is not a reading — the same
       rule as {"outcome":"pass","exit":1}, one field along. */
    const contradictory = {
      ...finished(),
      check: "check",
      counts: {
        kind: "check",
        steps: [
          { name: "typecheck", gate: "unknown", verdict: "clean", findings: null },
          { name: "test", gate: "gate", verdict: "failed", findings: null },
        ],
      },
    };
    expect(parseRunRecord(JSON.stringify(contradictory))).toBeNull();
  });

  it("refuses a passing test record whose own tally contains failures", () => {
    const contradictory = {
      ...finished(),
      counts: { kind: "vitest", files: null, tests: { passed: 4, failed: 1, skipped: 0, total: 5 } },
    };
    expect(parseRunRecord(JSON.stringify(contradictory))).toBeNull();
  });

  it("allows a FAILING run whose numbers look clean, which is ordinary", () => {
    /* A suite can fail in its setup with every test green. Refusing those would
       throw away real failures to tidy up a shape. */
    const setupFailure = {
      ...finished(),
      outcome: "fail",
      exit: 1,
      counts: { kind: "vitest", files: null, tests: { passed: 371, failed: 0, skipped: 0, total: 371 } },
    };
    expect(parseRunRecord(JSON.stringify(setupFailure))).not.toBeNull();
  });

  it("does NOT let a PASSING check promote a `DID NOT RUN` required row to a pass", () => {
    /* GPT Sol drove this to `ready`. The passing branch emitted a pass for every
       required check without consulting the table at all, so a record whose two
       halves disagree produced green. */
    const out = verdict([
      reading(
        finished({
          check: "check",
          runId: "chk",
          counts: {
            kind: "check",
            steps: [
              { name: "typecheck", gate: "unknown", verdict: "clean", findings: null },
              { name: "test", gate: "gate", verdict: "did-not-run", findings: null },
            ],
          },
        }),
      ),
    ]);
    expect(out.kind).toBe("unknown");
    expect(out.kind === "unknown" && out.why).toContain("disagree");
  });

  it("does NOT let a PASSING check promote a `findings` required row to a pass", () => {
    const out = verdict([
      reading(
        finished({
          check: "check",
          runId: "chk",
          counts: {
            kind: "check",
            steps: [
              { name: "typecheck", gate: "unknown", verdict: "clean", findings: null },
              { name: "test", gate: "unknown", verdict: "findings", findings: 2 },
            ],
          },
        }),
      ),
    ]);
    expect(out.kind).toBe("unknown");
  });

  it("still accepts a passing check whose table is merely truncated", () => {
    /* An ABSENT row is not a contradiction: `check.ts` prints one per step, so a
       missing one means we read part of the table, and the outer status already
       proves the gates ran. Rejecting these would make the strongest single
       piece of evidence useless. */
    const out = verdict([
      reading(
        finished({
          check: "check",
          runId: "chk",
          counts: { kind: "check", steps: [{ name: "typecheck", gate: "unknown", verdict: "clean", findings: null }] },
        }),
      ),
    ]);
    expect(out.kind).toBe("ready");
  });

  it("still accepts a passing check whose ADVISORY steps are noisy", () => {
    /* lint and knip have a known backlog by design — that is the whole point of
       the gate/advisory split — so findings there must not unsettle anything. */
    const out = verdict([
      reading(
        finished({
          check: "check",
          runId: "chk",
          counts: {
            kind: "check",
            steps: [
              { name: "typecheck", gate: "unknown", verdict: "clean", findings: null },
              { name: "test", gate: "unknown", verdict: "clean", findings: null },
              { name: "lint", gate: "advisory", verdict: "findings", findings: 48 },
              { name: "dupes", gate: "advisory", verdict: "findings", findings: 308 },
            ],
          },
        }),
      ),
    ]);
    expect(out.kind).toBe("ready");
  });

  it("takes the WORST of duplicate rows for one check, not the last", () => {
    /* `test FAILED` then `test clean` in one table used to resolve to clean by
       arriving later, and produced a green verdict. A table that contradicts
       itself is not evidence that the good half is true. */
    const out = verdict([
      reading(finished({ check: "typecheck", runId: "tc" })),
      reading(
        finished({
          check: "check",
          runId: "chk",
          at: "2026-09-09T10:30:00.000Z",
          outcome: "fail",
          exit: 1,
          counts: {
            kind: "check",
            steps: [
              { name: "typecheck", gate: "unknown", verdict: "clean", findings: null },
              { name: "test", gate: "gate", verdict: "failed", findings: null },
              { name: "test", gate: "gate", verdict: "clean", findings: null },
            ],
          },
        }),
      ),
    ]);
    expect(out.kind).toBe("not-ready");
  });

  it("treats `DID NOT RUN` on a required check as unknown, not as a failure", () => {
    /* A false RED rather than a false green, and still wrong: the tool did not
       run, so no verdict about the check exists. Reporting it as a failing suite
       sends somebody to look for a bug when what broke was the tool. */
    const out = verdict([
      reading(finished({ check: "typecheck", runId: "tc" })),
      reading(
        finished({
          check: "check",
          runId: "chk",
          at: "2026-09-09T10:30:00.000Z",
          outcome: "fail",
          exit: 1,
          counts: {
            kind: "check",
            steps: [
              { name: "typecheck", gate: "unknown", verdict: "clean", findings: null },
              { name: "test", gate: "gate", verdict: "did-not-run", findings: null },
            ],
          },
        }),
      ),
    ]);
    expect(out.kind).toBe("unknown");
  });

  it("resolves a same-millisecond pass and fail conservatively, not by input order", () => {
    /* Two runs can finish in the same millisecond. With the pass listed first
       the reducer used to keep it, so filesystem order decided whether the tree
       was broken. */
    const sameMs = "2026-09-09T10:30:00.000Z";
    const pass = reading(finished({ check: "test", runId: "pass", at: sameMs }));
    const fail = reading(finished({ check: "test", runId: "fail", at: sameMs, outcome: "fail", exit: 1 }));
    const tc = reading(finished({ check: "typecheck", runId: "tc" }));

    expect(verdict([pass, fail, tc]).kind).toBe("not-ready");
    /* And the other way round, because order must not be the tiebreaker. */
    expect(verdict([fail, pass, tc]).kind).toBe("not-ready");
  });

  it("keeps a known failure while it is being re-run, rather than going unknown", () => {
    /* The regression the timeline rewrite introduced: the newest event of ANY
       kind decided, so starting a rerun turned `not-ready` into `unknown` — and
       contradicted this file's own stated policy. A check that failed has not
       stopped having failed because somebody pressed go again. */
    const out = verdict([
      reading(finished({ check: "test", runId: "red", at: "2026-09-09T10:00:00.000Z", outcome: "fail", exit: 1 })),
      resolveRecord(
        started({ runId: "rerun", check: "test", startedAt: "2026-09-09T10:30:00.000Z" }),
        Date.parse("2026-09-09T11:00:00.000Z"),
        () => true,
      ),
      reading(finished({ check: "typecheck", runId: "tc" })),
    ]);
    expect(out.kind).toBe("not-ready");
  });

  it("lets a later PASS clear a known failure", () => {
    const out = verdict([
      reading(finished({ check: "test", runId: "red", at: "2026-09-09T10:00:00.000Z", outcome: "fail", exit: 1 })),
      reading(finished({ check: "test", runId: "green", at: "2026-09-09T10:30:00.000Z" })),
      reading(finished({ check: "typecheck", runId: "tc" })),
    ]);
    expect(out.kind).toBe("ready");
  });

  it("treats a failing whole-check whose table is unreadable as unsettling, not convicting", () => {
    const out = verdict([
      reading(finished({ check: "test", runId: "t", at: "2026-09-09T10:00:00.000Z" })),
      reading(finished({ check: "typecheck", runId: "tc", at: "2026-09-09T10:00:00.000Z" })),
      reading(
        finished({
          check: "check",
          runId: "chk",
          at: "2026-09-09T10:30:00.000Z",
          outcome: "fail",
          exit: 1,
          counts: { kind: "none" },
        }),
      ),
    ]);
    expect(out.kind).toBe("unknown");
    /* A wholly unreadable table and a partly readable one are now the same
       path: neither says how this check fared, and neither is evidence that it
       was fine. */
    expect(out.kind === "unknown" && out.why).toContain("does not say how this check fared");
  });

  it("lets a NEWER pass settle an older void, rather than staying unsettled for ever", () => {
    /* The inverse defect Sol found at the same place: `unsettled` used to mean
       "any unsettled attempt in the window", not "the latest word on this
       check". An old kill followed by a good run is a good run. */
    const out = verdict([
      resolveRecord(
        started({ runId: "dead", check: "test", startedAt: "2026-09-09T09:00:00.000Z" }),
        Date.parse("2026-09-09T11:00:00.000Z"),
        () => false,
      ),
      reading(finished({ check: "test", runId: "good", at: "2026-09-09T10:00:00.000Z" })),
      reading(finished({ check: "typecheck", runId: "tc", at: "2026-09-09T10:00:00.000Z" })),
    ]);
    expect(out.kind).toBe("ready");
  });

  it("refuses a persisted record whose outcome and exit status disagree", () => {
    /* Sol's P0.3: `{"outcome":"pass","exit":1}` used to parse, and two of them
       produce a green verdict. It has to be UNREADABLE, which routes into the
       unknown arm rather than past it. */
    expect(parseRunRecord(JSON.stringify({ ...finished(), outcome: "pass", exit: 1 }))).toBeNull();
    expect(parseRunRecord(JSON.stringify({ ...finished(), outcome: "fail", exit: 0 }))).toBeNull();
    expect(parseRunRecord(JSON.stringify({ ...finished(), outcome: "fail", exit: 137 }))).toBeNull();
  });

  it("refuses a tree stamp with no explicit `dirty`, which would parse as clean and vote", () => {
    const noDirty = { ...finished(), treeAtStart: { kind: "known", sha: SHA_A, branch: "dev" } };
    expect(parseRunRecord(JSON.stringify(noDirty))).toBeNull();
  });

  it("refuses a tree stamp whose sha is not a sha", () => {
    const short = { ...finished(), treeAtEnd: { kind: "known", sha: "abc123", branch: "dev", dirty: false } };
    expect(parseRunRecord(JSON.stringify(short))).toBeNull();
  });

  it("goes UNKNOWN when any record could not be read", () => {
    /* Skipping a corrupt newest record shows the PREVIOUS pass as the current
       state, which is this feature's signature failure in a different hat. */
    const shadowed = verdict(
      [reading(finished({ check: "test" })), reading(finished({ check: "typecheck", runId: "tc" }))],
      { unreadable: 1 },
    );
    expect(shadowed.kind).toBe("unknown");
    expect(shadowed.kind === "unknown" && shadowed.why).toContain("could not be read");
  });

  it("goes UNKNOWN when git cannot say what dev is", () => {
    expect(verdict([], { devSha: null }).kind).toBe("unknown");
  });

  it("unsettles a green when a later run on the same commit is still going", () => {
    const later = verdict([
      reading(finished({ check: "test" })),
      reading(finished({ check: "typecheck", runId: "tc" })),
      resolveRecord(started({ runId: "again", check: "test", startedAt: "2026-09-09T10:50:00.000Z" }), Date.parse("2026-09-09T11:00:00.000Z"), () => true),
    ]);
    expect(later.kind).toBe("unknown");
    expect(later.kind === "unknown" && later.why).toContain("still going");
  });

  it("takes the newest reading per check by time, not by position", () => {
    const stale = reading(finished({ check: "test", outcome: "fail", exit: 1, at: "2026-09-09T10:00:00.000Z" }));
    const fresh = reading(finished({ check: "test", runId: "later", at: "2026-09-09T10:30:00.000Z" }));
    /* Deliberately handed to the verdict newest-first, the way a scan can
       produce them. */
    const out = verdict([fresh, stale, reading(finished({ check: "typecheck", runId: "tc" }))]);
    expect(out.kind).toBe("ready");
  });
});

/* ------------------------------------------------------------------ *
 * Which test files failed.
 * docs/plans/261006m-seventh-sweep-readiness-records-name-the-failing-test-files.md
 * ------------------------------------------------------------------ */

describe("which test files failed", () => {
  /* **Three fixtures, all real, and unlike their neighbours NOT ANSI-stripped**
     — reading through the colour codes is half of what is being tested.
       - `check-test-step-names-three-files.log`: the loop's own failing
         `npm run check` of 2026-10-06 05:06, head, vitest's failure summary
         and tail, cut from a 14 MB log whose summary sat 92,000 lines in.
       - `vitest-failed-suites-and-tests.log`: a suite with BOTH headings, a
         file that would not load (`[ path ]`), and one file failing twice.
       - `vitest-fail-no-colour.log`: a one-test probe run on this box with no
         colour, where the project badge is `|unit|` instead of a painted one. */
  const THREE = [
    "tests/dock-corner-controls.test.tsx",
    "tests/fleet-child.test.ts",
    "tests/store-roundtrip.test.ts",
  ];

  it("names the files in a real failing check run, sorted, through the colour codes", () => {
    const text = fixture("check-test-step-names-three-files.log");
    expect(text).toContain("\u001b[41m");
    expect(parseFailedTestFiles(text)).toEqual({ files: THREE, total: 3 });
  });

  it("agrees with vitest's own count of failed files, across both headings", () => {
    const text = fixture("vitest-failed-suites-and-tests.log");
    const named = parseFailedTestFiles(text);
    expect(named?.files).toEqual([
      "tests/chat-web-links.test.ts",
      "tests/doc-links.test.ts",
      "tests/every-ai-code-is-registered.test.ts",
      "tests/messages.test.ts",
      "tests/store-parity.test.ts",
      "tests/store-roundtrip.test.ts",
    ]);
    /* Seven FAIL lines, six files: doc-links failed twice. The footer is
       vitest's own count, and it is the check on ours. */
    expect(named?.total).toBe(parseVitest(text).counts.files?.failed);
    expect(named?.total).toBe(6);
  });

  it("reads the uncoloured badge too", () => {
    expect(parseFailedTestFiles(fixture("vitest-fail-no-colour.log"))).toEqual({
      files: ["tests/zzz-stream-probe.test.ts"],
      total: 1,
    });
  });

  it("says NOT KNOWN, never an empty list, when there is no failure summary", () => {
    /* `vitest-fail.log` is a real failing run with its summary cut out, which
       is exactly what the wrapper's bounded windows hold of a long one. */
    expect(parseFailedTestFiles(fixture("vitest-fail.log"))).toBeNull();
    expect(parseFailedTestFiles(fixture("vitest-pass.log"))).toBeNull();
    expect(parseFailedTestFiles("")).toBeNull();
  });

  it("finds the same names however the stream is chunked", () => {
    const text = fixture("check-test-step-names-three-files.log");
    for (const size of [1, 7, 4096]) {
      const capture = makeFailedTestFilesCapture();
      const stream = capture.stream();
      for (let at = 0; at < text.length; at += size) stream.push(text.slice(at, at + size));
      expect(capture.result(), `chunks of ${size}`).toEqual({ files: THREE, total: 3 });
    }
  });

  it("does not read a FAIL line printed before vitest's own summary", () => {
    /* Megabytes of test output come first, and any test may print anything —
       one in this suite is called "prints FAIL for each and exits 1". */
    const text = fixture("check-test-step-names-three-files.log");
    const forged = ` FAIL  unit  tests/printed-by-a-test.test.ts > not a failure\n${text}`;
    expect(parseFailedTestFiles(forged)).toEqual({ files: THREE, total: 3 });
    expect(parseFailedTestFiles(" FAIL  unit  tests/printed-by-a-test.test.ts > not a failure\n")).toBeNull();
  });

  it("keeps the two streams apart: a heading on one does not open the other", () => {
    /* Vitest writes the heading and the FAIL lines to stderr and the footer to
       stdout (probed, 2026-10-06), so stdout never legitimately names a file. */
    const capture = makeFailedTestFilesCapture();
    const stderr = capture.stream();
    const stdout = capture.stream();
    stderr.push("⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n\n");
    stdout.push(" FAIL  unit  tests/on-the-wrong-stream.test.ts > x\n");
    stderr.push(" FAIL  |unit| tests/real.test.ts > x\nError: x\n⎯⎯⎯[1/1]⎯\n");
    stdout.push(" Test Files  1 failed (1)\n");
    expect(capture.result()).toEqual({ files: ["tests/real.test.ts"], total: 1 });
  });

  /* The rest of this block is SYNTHETIC: none of the real logs these fixtures
     were cut from fails in more than twenty files, or prints a FAIL line in a
     shape vitest does not use. */
  const summaryOf = (paths: string[]): string =>
    `⎯⎯⎯⎯⎯⎯⎯ Failed Tests ${paths.length} ⎯⎯⎯⎯⎯⎯⎯\n\n${paths.map((p, i) => ` FAIL  |unit| ${p} > a test\nError: x\n⎯⎯⎯[${i + 1}/${paths.length}]⎯\n`).join("")} Test Files  ${paths.length} failed (${paths.length})\n`;

  it("lists the first twenty in sorted order and still says how many there were", () => {
    const paths = Array.from({ length: 25 }, (_, i) => `tests/f${String(i).padStart(2, "0")}.test.ts`);
    const named = parseFailedTestFiles(summaryOf([...paths].reverse()));
    expect(FAILED_TEST_FILES_CAP).toBe(20);
    expect(named?.files).toEqual(paths.slice(0, 20));
    expect(named?.total).toBe(25);

    const exactly = parseFailedTestFiles(summaryOf(paths.slice(0, 20)));
    expect(exactly?.files).toHaveLength(20);
    expect(exactly?.total).toBe(20);
  });

  it("gives up on the whole list when one FAIL line cannot be read with certainty", () => {
    /* A partial list with a confident total is the one answer worse than none. */
    const good = " FAIL  |unit| tests/a.test.ts > a test\n";
    const heading = "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯\n\n";
    expect(parseFailedTestFiles(`${heading}${good}`)).toBeNull();
    expect(parseFailedTestFiles(`${heading}${good} FAIL  a project with spaces  tests/b.test.ts > x\n`)).toBeNull();
    expect(parseFailedTestFiles(`${heading}${good} FAIL  unit  /abs/olute.test.ts > x\n`)).toBeNull();
    expect(parseFailedTestFiles(`${heading}${good} FAIL  unit  tests/${"x".repeat(200)}.test.ts > x\n`)).toBeNull();
  });

  it("cannot throw into the wrapper, and reports not-known if its reader does", () => {
    const capture = makeFailedTestFilesCapture(() => {
      throw new Error("a bug in the line reader");
    });
    const stream = capture.stream();
    expect(() => stream.push(summaryOf(["tests/a.test.ts"]))).not.toThrow();
    expect(() => stream.push("more\n")).not.toThrow();
    expect(capture.result()).toBeNull();
  });

  it("reads a FAIL line however long the test's name is, and holds no more than a line's start", () => {
    const capture = makeFailedTestFilesCapture();
    const stream = capture.stream();
    stream.push("⎯⎯⎯ Failed Tests 2 ⎯⎯⎯\n FAIL  |unit| tests/a.test.ts > a test\nError: x\n");
    for (let i = 0; i < 200; i += 1) stream.push("x".repeat(10_000));
    stream.push(`\n⎯⎯⎯[1/2]⎯\n FAIL  |unit| tests/b.test.ts > ${"long name ".repeat(2000)}\nError: x\n⎯⎯⎯[2/2]⎯\n Test Files  2 failed (2)\n`);
    expect(capture.result()).toEqual({ files: ["tests/a.test.ts", "tests/b.test.ts"], total: 2 });
  });

  describe("on the record", () => {
    const failing = (over: Partial<FinishedRecord> = {}): FinishedRecord =>
      finished({ outcome: "fail", exit: 1, failedTestFiles: { files: ["tests/a.test.ts"], total: 1 }, ...over });

    it("round-trips", () => {
      const record = failing();
      expect(parseRunRecord(JSON.stringify(record))).toEqual(record);
    });

    it("reads a record written before the field existed, as not-known", () => {
      const { failedTestFiles: _dropped, ...old } = failing();
      const parsed = parseRunRecord(JSON.stringify(old));
      expect(parsed?.state === "finished" && parsed.outcome).toBe("fail");
      expect(parsed?.state === "finished" && parsed.failedTestFiles).toBeNull();
    });

    it("drops a malformed list and KEEPS the record, so names can never cost a reading", () => {
      for (const bad of [
        { files: [], total: 0 },
        { files: ["tests/a.test.ts"], total: 0 },
        { files: ["tests/a.test.ts"], total: 3 },
        { files: ["tests/a.test.ts"], total: 1.5 },
        { files: ["tests/a.test.ts", "tests/a.test.ts"], total: 2 },
        { files: ["tests/a.test.ts", 7], total: 2 },
        { files: ["has a space.test.ts"], total: 1 },
        { files: ["/abs/a.test.ts"], total: 1 },
        { files: Array.from({ length: 21 }, (_, i) => `tests/f${i}.test.ts`), total: 21 },
        { files: "tests/a.test.ts", total: 1 },
        "tests/a.test.ts",
        [],
      ]) {
        const parsed = parseRunRecord(JSON.stringify({ ...failing(), failedTestFiles: bad }));
        expect(parsed?.state === "finished" && parsed.outcome, JSON.stringify(bad)).toBe("fail");
        expect(parsed?.state === "finished" && parsed.failedTestFiles, JSON.stringify(bad)).toBeNull();
      }
    });

    it("accepts a total larger than the list only when the list is at the cap", () => {
      const twenty = Array.from({ length: 20 }, (_, i) => `tests/f${String(i).padStart(2, "0")}.test.ts`);
      const capped = parseRunRecord(
        JSON.stringify({ ...failing(), failedTestFiles: { files: twenty, total: 31 } }),
      );
      expect(capped?.state === "finished" && capped.failedTestFiles?.total).toBe(31);
      expect(capped?.state === "finished" && capped.failedTestFiles?.files).toEqual(twenty);
    });

    it("never shows failing files beside a pass or a void", () => {
      const names = { files: ["tests/a.test.ts"], total: 1 };
      const pass = parseRunRecord(JSON.stringify({ ...finished(), failedTestFiles: names }));
      expect(pass?.state === "finished" && pass.outcome).toBe("pass");
      expect(pass?.state === "finished" && pass.failedTestFiles).toBeNull();
      const gone = parseRunRecord(JSON.stringify({ ...finished(), outcome: "void", exit: 137, failedTestFiles: names }));
      expect(gone?.state === "finished" && gone.outcome).toBe("void");
      expect(gone?.state === "finished" && gone.failedTestFiles).toBeNull();
    });

    it("does not change the verdict by being there", () => {
      const shape = (readings: Reading[]) => {
        const v = readinessVerdict({ readings, devSha: SHA_A, caveat: "…", unreadable: 0 });
        return { kind: v.kind, sha: v.sha, evidence: v.evidence.map((e) => [e.check, e.state, e.why]) };
      };
      const typecheck = reading(finished({ check: "typecheck", runId: "tc" }));
      const bare = shape([reading(failing({ failedTestFiles: null })), typecheck]);
      expect(bare.kind).toBe("not-ready");
      expect(shape([reading(failing()), typecheck])).toEqual(bare);
    });

    it("capped paths requiring JSON escaping still fit what the store will read", () => {
      const dir = mkdtempSync(join(tmpdir(), "readiness-names-"));
      try {
        const opened = openReadinessStore(dir);
        if (opened.kind !== "open") throw new Error(opened.why);
        const worst = failedTestFilesFrom(
          Array.from({ length: 300 }, (_, i) => `tests/${String(i).padStart(3, "0")}${"\\".repeat(FAILED_TEST_FILE_PATH_MAX - 9)}`),
        );
        expect(worst?.files).toHaveLength(FAILED_TEST_FILES_CAP);
        expect(worst?.files[0]).toHaveLength(FAILED_TEST_FILE_PATH_MAX);
        expect(worst?.total).toBe(300);
        const record = failing({ failedTestFiles: worst });
        opened.store.put(record);
        const bytes = readFileSync(join(opened.dir, readdirSync(opened.dir)[0] ?? "")).length;
        expect(bytes).toBeGreaterThan(8000);
        expect(bytes).toBeLessThan(MAX_RECORD_BYTES / 4);
        const back = opened.store.read({ sinceMs: 0, nowMs: Date.parse("2026-09-09T11:00:00.000Z"), isAlive: () => false });
        expect(back.unreadable).toEqual([]);
        expect(back.readings[0]?.record).toEqual(record);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("the wrapper itself, run for real against a fake npm", () => {
    /* Everything above tests the scanner. This tests that the wrapper is
       WIRED to it — the half a unit test agrees with by construction.

       The real `scripts/readiness-run.ts`, as a child process, with an `npm`
       on its PATH that prints what a failing `npm run check` prints: vitest's
       real failure summary on STDERR, buried under more output on both sides
       than the wrapper's retained head (8 KB) and tail (64 KB) put together,
       so the names can only have come from the streaming capture. The record
       goes to a temp directory through `FLEET_READINESS_DIR`, never the box's
       own. */
    let scratch: string;

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), "readiness-wrapper-"));
      mkdirSync(join(scratch, "bin"));
      writeFileSync(
        join(scratch, "bin", "npm"),
        [
          "#!/bin/sh",
          "printf '\\n> spideryarn@1.0.0 check\\n> tsx scripts/check.ts\\n\\n'",
          'if [ "$FAKE_NPM_SUMMARY" != "" ]; then',
          "  yes 'a line of some test printing something' | head -c 200000 >&2",
          '  cat "$FAKE_NPM_SUMMARY" >&2',
          "  yes 'a line of a later advisory printing something' | head -c 200000 >&2",
          "  echo >&2",
          "fi",
          'exit "$FAKE_NPM_EXIT"',
          "",
        ].join("\n"),
      );
      chmodSync(join(scratch, "bin", "npm"), 0o755);
    });
    afterEach(() => rmSync(scratch, { recursive: true, force: true }));

    const runWrapper = (
      env: Record<string, string>,
    ): { status: number | null; stderr: string; record: FinishedRecord; written: Record<string, unknown> } => {
      const root = join(__dirname, "..");
      const ran = spawnSync(join(root, "node_modules", ".bin", "tsx"), [join(root, "scripts", "readiness-run.ts"), "check"], {
        cwd: scratch,
        env: {
          ...process.env,
          PATH: `${join(scratch, "bin")}:${process.env["PATH"] ?? ""}`,
          FLEET_READINESS_DIR: join(scratch, "store"),
          ...env,
        },
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      const files = readdirSync(join(scratch, "store", "runs"));
      expect(files).toHaveLength(1);
      const bytes = readFileSync(join(scratch, "store", "runs", files[0] ?? ""), "utf8");
      const record = parseRunRecord(bytes);
      if (record?.state !== "finished") throw new Error(`no finished record: ${ran.stderr.slice(-2000)}`);
      /* `written` is the file as the wrapper wrote it, before the record parser
         has had the chance to tidy it: the parser drops names beside anything
         but a failure, so reading only through it cannot tell whether the
         wrapper wrote them. */
      return { status: ran.status, stderr: ran.stderr, record, written: JSON.parse(bytes) as Record<string, unknown> };
    };

    it("records the names from the middle of the output, and says them last", () => {
      const ran = runWrapper({
        FAKE_NPM_SUMMARY: join(FIXTURES, "check-test-step-names-three-files.log"),
        FAKE_NPM_EXIT: "1",
      });
      expect(ran.record.outcome).toBe("fail");
      expect(ran.status).toBe(1);
      expect(ran.record.failedTestFiles).toEqual({ files: THREE, total: 3 });
      expect(ran.stderr.trimEnd().split("\n").at(-1)).toBe(`readiness-run: 3 test files failed: ${THREE.join(", ")}`);
    }, 60_000);

    it("records a failure with no summary as a failure whose files are not known", () => {
      const ran = runWrapper({ FAKE_NPM_SUMMARY: "", FAKE_NPM_EXIT: "1" });
      expect(ran.record.outcome).toBe("fail");
      expect(ran.status).toBe(1);
      expect(ran.record.failedTestFiles).toBeNull();
      expect(ran.stderr).not.toContain("failed:");
    }, 60_000);

    it("does not let a failure summary change what an exit of 0 is read as", () => {
      /* Exit 0 with no `check` footer is VOID by the footer rule, summary or
         no summary — and a void carries no names. */
      const ran = runWrapper({
        FAKE_NPM_SUMMARY: join(FIXTURES, "check-test-step-names-three-files.log"),
        FAKE_NPM_EXIT: "0",
      });
      expect(ran.record.outcome).toBe("void");
      expect(ran.record.failedTestFiles).toBeNull();
      expect(ran.written["outcome"]).toBe("void");
      expect(ran.written["failedTestFiles"]).toBeNull();
      expect(ran.stderr).not.toContain("failed:");
    }, 60_000);
  });

  describe("for the wrapper and the loop to print", () => {
    it("names them all when the cap did not cut", () => {
      expect(describeFailedTestFiles({ files: ["tests/a.test.ts", "tests/b.test.ts"], total: 2 })).toBe(
        "2 test files failed: tests/a.test.ts, tests/b.test.ts",
      );
      expect(describeFailedTestFiles({ files: ["tests/a.test.ts"], total: 1 })).toBe("1 test file failed: tests/a.test.ts");
    });

    it("says how many it left out", () => {
      const twenty = Array.from({ length: 20 }, (_, i) => `t/${i}.test.ts`) as [string, ...string[]];
      expect(describeFailedTestFiles({ files: twenty, total: 23 })).toMatch(
        /^23 test files failed: t\/0\.test\.ts, .*t\/19\.test\.ts and 3 more$/,
      );
    });

    it("puts them on the loop's outcome line, and leaves a run without names as it was", () => {
      const names = { files: ["tests/a.test.ts"] as [string, ...string[]], total: 1 };
      expect(describeReadingOutcome(reading(finished({ outcome: "fail", exit: 1, failedTestFiles: names })))).toBe(
        "fail (1 test file failed: tests/a.test.ts)",
      );
      expect(describeReadingOutcome(reading(finished({ outcome: "fail", exit: 1 })))).toBe("fail");
      expect(describeReadingOutcome(reading(finished()))).toBe("pass");
      expect(describeReadingOutcome(reading(started(), true))).toBe("running");
    });

    it("gives names only to a run that failed", () => {
      const names = { files: ["tests/a.test.ts"] as [string, ...string[]], total: 1 };
      expect(failedTestFilesForOutcome("fail", names)).toEqual(names);
      expect(failedTestFilesForOutcome("pass", names)).toBeNull();
      expect(failedTestFilesForOutcome("void", names)).toBeNull();
      expect(failedTestFilesForOutcome("fail", null)).toBeNull();
    });
  });
});
