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
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, utimesSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readingFromLog,
  scanLogs,
  scriptBodiesFor,
  NO_SHA_IN_LOGS,
  QUIET_BEFORE_VOID_MS,
} from "../tools/fleet/readiness-backfill.js";
import {
  joinEnds,
  parseBanner,
  parseCheckTable,
  parseExitLine,
  parseTypecheck,
  parseVitest,
  scopeOf,
  stripAnsi,
} from "../tools/fleet/readiness-parse.js";
import {
  openReadinessStore,
  recordFileName,
  startedAtFromFileName,
  type ReadinessStore,
} from "../tools/fleet/readiness-store.js";
import { canVote, readinessVerdict } from "../tools/fleet/readiness-verdict.js";
import {
  outcomeFromExit,
  parseRunRecord,
  resolveRecord,
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

  it("does not treat 128 or 160 as signals, because no signal produces them", () => {
    expect(outcomeFromExit(128).outcome).toBe("fail");
    expect(outcomeFromExit(160).outcome).toBe("fail");
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

  it("requires check's verdict sentence, not merely its table", () => {
    expect(parseCheckTable(fixture("check-pass.log")).hasFooter).toBe(true);
    expect(parseCheckTable(fixture("check-fail.log")).hasFooter).toBe(true);
    expect(parseCheckTable("  ✓ typecheck    clean\n").hasFooter).toBe(false);
  });

  it("counts typecheck's projects and errors without letting errors be the verdict", () => {
    expect(parseTypecheck(fixture("typecheck-pass.log")).counts).toEqual({ kind: "typecheck", projects: 3, errors: 0 });
    expect(parseTypecheck(fixture("typecheck-fail.log")).counts).toEqual({ kind: "typecheck", projects: 3, errors: 2 });
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
      scriptBodies: { test: "vitest run", check: "tsx scripts/check.ts" },
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
      scriptBodies: { test: "vitest run" },
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
      scriptBodies: { test: "vitest run" },
      maxLogs: 1,
    });
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]?.state).toBe("pass");
  });

  it("treats a checkout with no logs directory as quiet, not as broken", () => {
    const bare = mkdtempSync(join(tmpdir(), "readiness-bare-"));
    try {
      const result = scanLogs({
        roots: [bare],
        sinceMs: 0,
        nowMs: NOW,
        knownRunIds: new Set(),
        scriptBodies: {},
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
    const whole = verdict([reading(finished({ check: "check", runId: "chk" }))]);
    expect(whole.kind).toBe("ready");
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
