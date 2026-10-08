/**
 * A deploy's test gate rerunning only what failed, and `--ready` deploying the
 * first commit that carries its notes. docs/plans/261008h.
 *
 * Most cases are a way a run could look like evidence for a short rerun and
 * not be one; each must end in the full suite, with a reason. The reporter
 * itself is exercised against real vitest runs in
 * tests/vitest-outcome-reporter.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  CROSS_COMMIT_MAX_AGE_MS,
  deployFullRun,
  firstCarryingNotes,
  isTestInfrastructure,
  partialEvidenceFor,
  readinessFullRuns,
  TEST_EVIDENCE_MAX_AGE_MS,
  type DeployRunRecord,
  type FullRun,
} from "../scripts/deploy-evidence.js";
import { readinessRunnerPath, PREPARATION_VERSION, type FinishedRecord, type Reading } from "../tools/fleet/readiness.js";
import { agreeingWithExit, asTestOutcome, RERUN_FILES_MAX, rerunVerdict, testOutcomeFrom } from "../tools/fleet/test-outcome.js";

const file = (path: string, state: string, project = "unit") => ({ project, path, state });
const outcome = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: 2,
    final: true,
    reason: "failed",
    unhandledErrors: 0,
    exitCode: 1,
    failuresOutsideFiles: [],
    narrowed: { filters: [], shard: null, project: [], testNamePattern: null },
    notRun: 0,
    files: [file("tests/a.test.ts", "passed"), file("tests/b.test.ts", "failed"), file("tests/c.test.ts", "skipped")],
    ...over,
  });
const GREEN = { reason: "passed", exitCode: 0, files: [file("tests/a.test.ts", "passed")] };

describe("testOutcomeFrom", () => {
  it("a run red only in named files names them", () => {
    expect(testOutcomeFrom(outcome())).toEqual({ kind: "red-in-files", failed: ["tests/b.test.ts"], files: 3 });
  });

  it("a green run is a pass", () => {
    expect(testOutcomeFrom(outcome(GREEN))).toEqual({ kind: "pass", files: 1 });
  });

  it("a file failing in two projects is named once", () => {
    const o = testOutcomeFrom(outcome({ files: [file("tests/b.test.ts", "failed", "unit"), file("tests/b.test.ts", "failed", "private-postgres")] }));
    expect(o).toEqual({ kind: "red-in-files", failed: ["tests/b.test.ts"], files: 2 });
  });

  it.each([
    ["no file at all", null, /no outcome file/],
    ["not JSON", "{", /not JSON/],
    ["the first schema", outcome({ schema: 1 }), /schema/],
    ["a report never finalised (killed, or teardown overran)", outcome({ final: false }), /never finalised/],
    ["a teardown that failed after the tests", outcome({ failuresOutsideFiles: ["the private test database's teardown failed"] }), /outside every test file/],
    ["an unhandled error", outcome({ unhandledErrors: 1 }), /unhandled/],
    ["an unhandled error on a run whose files all passed", outcome({ unhandledErrors: 2, files: [file("tests/a.test.ts", "passed")] }), /unhandled/],
    ["a pass whose process exited 1", outcome({ ...GREEN, exitCode: 1 }), /after its tests/],
    ["a red whose process exited 0", outcome({ exitCode: 0 }), /after its tests/],
    ["a failure outside every file", outcome({ files: [file("tests/a.test.ts", "passed")] }), /outside every file/],
    ["an interrupted run", outcome({ reason: "interrupted" }), /interrupted/],
    ["nothing collected", outcome({ files: [] }), /collected no/],
    ["a file that never finished", outcome({ files: [file("tests/a.test.ts", "queued")] }), /never finished/],
    ["an absolute path", outcome({ files: [file("/etc/passwd", "failed")] }), /not a path inside/],
    ["a path out of the checkout", outcome({ files: [file("tests/../../x.test.ts", "failed")] }), /not a path inside/],
    ["a malformed entry", outcome({ files: [{ path: "tests/a.test.ts", state: "failed" }] }), /malformed/],
    ["a pass with a failed file", outcome({ ...GREEN, files: [file("tests/b.test.ts", "failed")] }), /says it passed/],
    ["a pass where every file skipped", outcome({ ...GREEN, files: [file("tests/a.test.ts", "skipped")] }), /skipped/],
    ["no unhandled count", outcome({ unhandledErrors: undefined }), /unhandled-error count/],
    ["a run narrowed to some files", outcome({ narrowed: { filters: ["tests/b"], shard: null, project: [], testNamePattern: null } }), /narrowed by file filters/],
    ["a shard", outcome({ narrowed: { filters: [], shard: "1/2", project: [], testNamePattern: null } }), /shard/],
    ["one project", outcome({ narrowed: { filters: [], shard: null, project: ["unit"], testNamePattern: null } }), /projects/],
    ["a test-name filter", outcome({ narrowed: { filters: [], shard: null, project: [], testNamePattern: "x" } }), /test names/],
    ["files the suite collects that did not run", outcome({ notRun: 3 }), /did not run/],
    ["no word on coverage", outcome({ notRun: null }), /whether every test file ran/],
  ])("%s is unusable", (_name, text, why) => {
    const o = testOutcomeFrom(text);
    expect(o.kind).toBe("unusable");
    if (o.kind === "unusable") expect(o.why).toMatch(why);
  });

  it("more failed files than a rerun is worth is unusable", () => {
    const many = Array.from({ length: RERUN_FILES_MAX + 1 }, (_, i) => file(`tests/f${i}.test.ts`, "failed"));
    const o = testOutcomeFrom(outcome({ files: many }));
    expect(o.kind).toBe("unusable");
    if (o.kind === "unusable") expect(o.why).toMatch(/in all but name/);
  });

  it("vitest's exit as the caller saw it must agree", () => {
    const red = testOutcomeFrom(outcome());
    const green = testOutcomeFrom(outcome(GREEN));
    expect(agreeingWithExit(red, 1)).toEqual(red);
    expect(agreeingWithExit(red, 0).kind).toBe("unusable");
    expect(agreeingWithExit(green, 0)).toEqual(green);
    expect(agreeingWithExit(green, 1).kind).toBe("unusable");
    expect(agreeingWithExit(green, null).kind).toBe("unusable");
  });
});

describe("asTestOutcome", () => {
  it("reads back each of the three", () => {
    for (const o of [
      { kind: "pass", files: 3 },
      { kind: "red-in-files", failed: ["tests/b.test.ts"], files: 3 },
      { kind: "unusable", why: "because" },
    ]) {
      expect(asTestOutcome(JSON.parse(JSON.stringify(o)))).toEqual(o);
    }
  });

  it.each([
    ["nothing", null],
    ["an unknown kind", { kind: "green", files: 1 }],
    ["a pass of no files", { kind: "pass", files: 0 }],
    ["an empty red list", { kind: "red-in-files", failed: [], files: 3 }],
    ["a duplicated red file", { kind: "red-in-files", failed: ["tests/b.test.ts", "tests/b.test.ts"], files: 3 }],
    ["more failed than ran", { kind: "red-in-files", failed: ["tests/a.test.ts", "tests/b.test.ts"], files: 1 }],
    ["a path outside", { kind: "red-in-files", failed: ["../b.test.ts"], files: 3 }],
    ["an unusable without why", { kind: "unusable" }],
  ])("%s reads as not known", (_name, v) => {
    expect(asTestOutcome(v)).toBeNull();
  });
});

/* A straight line of history, oldest first: A ← B ← C ← Y. */
const [A, B, C, Y] = ["a", "b", "c", "f"].map((c) => c.repeat(40)) as [string, string, string, string];
const LINE = [A, B, C, Y];
const OFF_LINE = "9".repeat(40);
const NOW = Date.parse("2026-10-08T18:00:00.000Z");
const HOUR = 3_600_000;

const isAncestor = (a: string, b: string): boolean | null => {
  if (a === OFF_LINE || b === OFF_LINE) return a === b;
  const ia = LINE.indexOf(a);
  const ib = LINE.indexOf(b);
  return ia < 0 || ib < 0 ? null : ia <= ib;
};
const ancestors = (sha: string): number | null => (LINE.includes(sha) ? LINE.indexOf(sha) + 1 : null);

let id = 0;
const run = (sha: string, outcome: FullRun["outcome"], over: Partial<FullRun> = {}, hoursBefore = 1): FullRun => ({
  source: "deploy-gate",
  id: `run-${id++}`,
  sha,
  atMs: NOW - hoursBefore * HOUR,
  outcome,
  refusal: null,
  ...over,
});
const red = (...failed: string[]): FullRun["outcome"] => ({ kind: "red-in-files", failed: failed as [string, ...string[]], files: 1800 });
const green: FullRun["outcome"] = { kind: "pass", files: 1800 };

function evidence(runs: FullRun[], changed: Record<string, string[] | null> = {}, gone: string[] = []) {
  return partialEvidenceFor({
    sha: Y,
    runs,
    nowMs: NOW,
    isAncestor,
    ancestors,
    changedSince: (x) => (x in changed ? (changed[x] ?? null) : []),
    existsAtCandidate: (p) => !gone.includes(p),
  });
}

describe("partialEvidenceFor", () => {
  it("reruns the files that failed at an ancestor, and the test files changed since", () => {
    const e = evidence([run(C, red("tests/b.test.ts"))], { [C]: ["src/x.ts", "tests/new.test.tsx", "docs/z.md"] });
    expect(e.kind).toBe("rerun");
    if (e.kind === "rerun") {
      expect(e.files).toEqual(["tests/b.test.ts", "tests/new.test.tsx"]);
      expect(e.from.sha).toBe(C);
      expect(e.sentence).toMatch(/cccccccc/);
    }
  });

  it("a green run on the commit itself leaves nothing to rerun", () => {
    const e = evidence([run(Y, green)]);
    expect(e).toMatchObject({ kind: "rerun", files: [] });
  });

  it("the nearest ancestor is the one asked", () => {
    const e = evidence([run(B, green, {}, 0.5), run(C, red("tests/b.test.ts"), {}, 2)]);
    expect(e).toMatchObject({ kind: "rerun", files: ["tests/b.test.ts"] });
  });

  it("the newest run on the nearest commit decides", () => {
    const e = evidence([run(C, red("tests/b.test.ts"), {}, 3), run(C, { kind: "unusable", why: "unhandled" }, {}, 1)]);
    expect(e.kind).toBe("run");
    if (e.kind === "run") expect(e.why).toMatch(/unhandled/);
  });

  it("an unusable nearest run does not fall back to an older green one", () => {
    const e = evidence([run(B, green), run(C, { kind: "unusable", why: "interrupted" })]);
    expect(e.kind).toBe("run");
  });

  it("a refused nearest run does not fall back either", () => {
    const e = evidence([run(B, green), run(C, green, { refusal: ".env.local has changed" })]);
    expect(e.kind).toBe("run");
    if (e.kind === "run") expect(e.why).toMatch(/\.env\.local/);
  });

  it.each([
    ["no runs at all", []],
    ["only a run older than the window", [run(C, green, {}, TEST_EVIDENCE_MAX_AGE_MS / HOUR + 1)]],
    ["only a run on another line of history", [run(OFF_LINE, green)]],
  ])("%s runs the suite", (_name, runs) => {
    const e = evidence(runs as FullRun[]);
    expect(e.kind).toBe("run");
    if (e.kind === "run") expect(e.why).toMatch(/no full run/);
  });

  it("a run that says it finished in the future is refused", () => {
    const e = evidence([run(C, green, {}, -1)]);
    expect(e.kind).toBe("run");
    if (e.kind === "run") expect(e.why).toMatch(/future/);
  });

  it("two runs on the nearest commit at the same instant are ambiguous", () => {
    const e = evidence([run(C, green, { atMs: NOW - HOUR }), run(C, red("tests/b.test.ts"), { atMs: NOW - HOUR })]);
    expect(e.kind).toBe("run");
  });

  it("test infrastructure changed since the run means the whole suite", () => {
    for (const p of ["vitest.config.ts", "package-lock.json", "tests/setup/private-db.ts", "tests/helpers/x.ts"]) {
      const e = evidence([run(C, green)], { [C]: [p] });
      expect(e.kind, p).toBe("run");
      if (e.kind === "run") expect(e.why).toContain(p);
    }
  });

  it("a diff git could not produce means the whole suite", () => {
    const e = evidence([run(C, green)], { [C]: null });
    expect(e.kind).toBe("run");
  });

  it("a failed file the candidate no longer has is not rerun", () => {
    const e = evidence([run(C, red("tests/gone.test.ts", "tests/b.test.ts"))], {}, ["tests/gone.test.ts"]);
    expect(e).toMatchObject({ kind: "rerun", files: ["tests/b.test.ts"] });
  });

  it("more files to rerun than a rerun is worth means the whole suite", () => {
    const changed = Array.from({ length: RERUN_FILES_MAX + 1 }, (_, i) => `tests/c${i}.test.ts`);
    const e = evidence([run(C, green)], { [C]: changed });
    expect(e.kind).toBe("run");
  });
});

describe("isTestInfrastructure", () => {
  it.each([
    ["vitest.config.ts", true],
    ["vitest-admission.ts", true],
    ["package.json", true],
    ["tests/setup/unit-no-database.ts", true],
    ["tests/helpers/seed.ts", true],
    ["tests/store-migration-registry.ts", true],
    ["scripts/vitest-outcome-reporter.ts", true],
    ["scripts/db-test-create.ts", true],
    ["tsconfig.json", true],
    ["tests/fixtures/corpus/x.json", true],
    ["tests/__snapshots__/a.test.ts.snap", true],
    ["tests/overseer-fixtures.ts", true],
    ["tests/a.test.ts", false],
    ["tests/b.test.tsx", false],
    ["src/types.ts", false],
  ])("%s → %s", (p, want) => {
    expect(isTestInfrastructure(p)).toBe(want);
  });
});

describe("partialEvidenceFor's limits", () => {
  it("a run on an earlier commit may stand in for two hours, not a day", () => {
    const hours = CROSS_COMMIT_MAX_AGE_MS / HOUR;
    expect(evidence([run(C, green, {}, hours - 0.1)]).kind).toBe("rerun");
    const e = evidence([run(C, green, {}, hours + 0.1)]);
    expect(e.kind).toBe("run");
    if (e.kind === "run") expect(e.why).toMatch(/2h at most/);
  });

  it("a run on the commit itself keeps the day", () => {
    expect(evidence([run(Y, red("tests/b.test.ts"), {}, 20)])).toMatchObject({ kind: "rerun", files: ["tests/b.test.ts"] });
  });

  it("an older run that cannot be used is not rescued by a newer age check", () => {
    /* The nearest run decides even when it is too old to stand in: an older
       but younger-finishing run further back must not be used instead. */
    const e = evidence([run(C, green, {}, 3), run(B, green, {}, 0.5)]);
    expect(e.kind).toBe("run");
  });

  it("a run still going on the nearest commit blocks the finished one", () => {
    const going = run(C, { kind: "unusable", why: "still running" }, { refusal: "it is still running", running: true }, 1.5);
    const e = evidence([run(C, green, {}, 1), going]);
    expect(e.kind).toBe("run");
    if (e.kind === "run") expect(e.why).toMatch(/still going/);
  });
});

/* ---- readiness records → FullRun ---- */

const RUNNER = readinessRunnerPath("/home/greg/code/spideryarn2");
const ENV = "e".repeat(64);
const steps = (test: "clean" | "failed") =>
  ["typecheck", "build", "build:fleet", "build:tooling", "test"].map((name) => ({
    name,
    gate: "unknown" as const,
    verdict: name === "test" ? test : ("clean" as const),
    findings: null,
  }));
function reading(over: Partial<FinishedRecord> = {}, state: Reading["state"] = "pass"): Reading {
  const at = NOW - HOUR;
  const record: FinishedRecord = {
    schema: 1,
    runId: `r${id++}`,
    startedAt: new Date(at - HOUR).toISOString(),
    pid: 1,
    host: "box",
    procStartToken: "1",
    cwd: RUNNER,
    check: "check",
    scope: "full",
    commandLine: "tsx scripts/check.ts",
    treeAtStart: { kind: "known", sha: C, branch: null, dirty: false },
    source: "wrapper",
    preparation: { by: "readiness-loop", version: PREPARATION_VERSION, sha: C, envLocalSha256: ENV, envLocalVerified: true },
    state: "finished",
    at: new Date(at).toISOString(),
    durationMs: HOUR,
    outcome: "pass",
    exit: 0,
    counts: { kind: "check", steps: steps("clean") },
    treeAtEnd: { kind: "known", sha: C, branch: null, dirty: false },
    logPath: null,
    why: null,
    failedTestFiles: null,
    ...over,
  };
  return { record, state, atMs: Date.parse(record.at), why: null };
}
const fullRuns = (readings: Reading[]) => readinessFullRuns({ readings, runnerCwd: RUNNER, envLocalSha256: ENV, nowMs: NOW });

describe("readinessFullRuns", () => {
  it("a green check with no reporter outcome (an older record) is a pass", () => {
    const [r] = fullRuns([reading()]);
    expect(r).toMatchObject({ sha: C, outcome: { kind: "pass" }, refusal: null });
  });

  it("a red check is red in the files its reporter named", () => {
    const [r] = fullRuns([
      reading({ outcome: "fail", exit: 1, counts: { kind: "check", steps: steps("failed") }, testOutcome: { kind: "red-in-files", failed: ["tests/b.test.ts"], files: 1800 } }, "fail"),
    ]);
    expect(r).toMatchObject({ outcome: { kind: "red-in-files", failed: ["tests/b.test.ts"] }, refusal: null });
  });

  it("a red check with no reporter outcome cannot be rerun in part", () => {
    const [r] = fullRuns([reading({ outcome: "fail", exit: 1, counts: { kind: "check", steps: steps("failed") } }, "fail")]);
    expect(r?.outcome.kind).toBe("unusable");
  });

  it("a check that failed only in another gate still counts as a green suite", () => {
    const rows = [...steps("clean"), { name: "cycles", gate: "gate" as const, verdict: "failed" as const, findings: null }];
    const [r] = fullRuns([reading({ outcome: "fail", exit: 1, counts: { kind: "check", steps: rows }, testOutcome: { kind: "pass", files: 1800 } }, "fail")]);
    expect(r).toMatchObject({ outcome: { kind: "pass" }, refusal: null });
  });

  it("the reporter and the test row must agree", () => {
    const [r] = fullRuns([reading({ testOutcome: { kind: "red-in-files", failed: ["tests/b.test.ts"], files: 9 } })]);
    expect(r?.outcome.kind).toBe("unusable");
  });

  it("the exact-commit clauses refuse it: no preparation stamp", () => {
    const [r] = fullRuns([reading({ preparation: null })]);
    expect(r?.refusal).toMatch(/preparation stamp/);
  });

  it("the exact-commit clauses refuse it: another .env.local", () => {
    const [r] = readinessFullRuns({ readings: [reading()], runnerCwd: RUNNER, envLocalSha256: "f".repeat(64), nowMs: NOW });
    expect(r?.refusal).toMatch(/\.env\.local/);
  });

  it("a test run, not a check, arrives refused, so it can block an older check", () => {
    const [r] = fullRuns([reading({ check: "test" })]);
    expect(r?.refusal).toMatch(/not a full/);
  });

  it("a dirty or void run is about no commit, and is left out", () => {
    expect(fullRuns([reading({ treeAtEnd: { kind: "known", sha: C, branch: null, dirty: true } })])).toEqual([]);
    expect(fullRuns([reading({ outcome: "void", exit: null }, "void")])).toEqual([]);
  });
});

/* ---- the deploy's own records ---- */

const deployRecord = (over: Partial<DeployRunRecord> = {}): string =>
  JSON.stringify({
    schema: 2,
    by: "deploy-gate",
    runId: "spideryarn-deploy-abc-cccccccc",
    sha: C,
    root: "/tmp/spideryarn-deploy-abc/tree",
    startedAt: new Date(NOW - 2 * HOUR).toISOString(),
    at: new Date(NOW - HOUR).toISOString(),
    exit: 1,
    atStart: { sha: C, clean: true, envLocalSha256: ENV },
    atEnd: { sha: C, clean: true, envLocalSha256: ENV },
    outcome: { kind: "red-in-files", failed: ["tests/b.test.ts"], files: 1800 },
    ...over,
  } satisfies DeployRunRecord);

describe("deployFullRun", () => {
  it("reads a sound record", () => {
    expect(deployFullRun(deployRecord(), "x.json", ENV)).toMatchObject({ source: "deploy-gate", sha: C, refusal: null });
  });

  it.each([
    ["not on the commit at the end", { atEnd: { sha: B, clean: true, envLocalSha256: ENV } }, /both ends/],
    ["dirty at the start", { atStart: { sha: C, clean: false, envLocalSha256: ENV } }, /not clean/],
    [".env.local changed during the run", { atEnd: { sha: C, clean: true, envLocalSha256: "d".repeat(64) } }, /during that run/],
  ])("%s is refused", (_name, over, why) => {
    const r = deployFullRun(deployRecord(over as Partial<DeployRunRecord>), "x.json", ENV);
    expect("refusal" in r && r.refusal).toMatch(why);
  });

  it(".env.local changed since is refused", () => {
    const r = deployFullRun(deployRecord(), "x.json", "f".repeat(64));
    expect("refusal" in r && r.refusal).toMatch(/since/);
  });

  it.each([
    ["not JSON", "{"],
    ["the first schema", JSON.stringify({ ...JSON.parse(deployRecord()), schema: 1 })],
    ["no outcome", JSON.stringify({ ...JSON.parse(deployRecord()), outcome: null })],
    ["a short sha", JSON.stringify({ ...JSON.parse(deployRecord()), sha: "ccc" })],
  ])("%s is unreadable", (_name, text) => {
    expect(deployFullRun(text, "x.json", ENV)).toHaveProperty("unreadable");
  });
});

describe("rerunVerdict", () => {
  const files = ["tests/a.test.ts", "tests/b.test.ts"];
  const ran = (states: [string, string][], reason = "passed", exitCode = 0) =>
    outcome({
      reason,
      exitCode,
      narrowed: { filters: files, shard: null, project: [], testNamePattern: null },
      notRun: 1800,
      files: states.map(([path, state]) => file(path, state)),
    });

  it("every requested file ran and passed", () => {
    expect(rerunVerdict(files, ran([["tests/a.test.ts", "passed"], ["tests/b.test.ts", "passed"]]), 0)).toBeNull();
  });

  it("a requested file the run never collected is a failure, not a pass", () => {
    expect(rerunVerdict(files, ran([["tests/a.test.ts", "passed"]]), 0)).toMatch(/never ran tests\/b\.test\.ts/);
  });

  it("a requested file that only skipped is not a pass", () => {
    expect(rerunVerdict(files, ran([["tests/a.test.ts", "passed"], ["tests/b.test.ts", "skipped"]]), 0)).toMatch(/skipped/);
  });

  it("a red rerun names its failures", () => {
    const text = ran([["tests/a.test.ts", "passed"], ["tests/b.test.ts", "failed"]], "failed", 1);
    expect(rerunVerdict(files, text, 1)).toMatch(/still failing: tests\/b\.test\.ts/);
  });

  it("an extra file that failed fails the rerun too", () => {
    const text = ran([["tests/a.test.ts", "passed"], ["tests/b.test.ts", "passed"], ["tests/b.test.tsx", "failed"]], "failed", 1);
    expect(rerunVerdict(files, text, 1)).toMatch(/b\.test\.tsx/);
  });

  it("an exit that disagrees is a failure", () => {
    expect(rerunVerdict(files, ran([["tests/a.test.ts", "passed"], ["tests/b.test.ts", "passed"]]), 1)).toMatch(/exited 1/);
  });

  it("a teardown failure after a green rerun is a failure", () => {
    const text = outcome({ ...JSON.parse(ran([["tests/a.test.ts", "passed"], ["tests/b.test.ts", "passed"]])), failuresOutsideFiles: ["teardown"] });
    expect(rerunVerdict(files, text, 0)).toMatch(/outside every test file/);
  });

  it("no outcome is a failure", () => {
    expect(rerunVerdict(files, null, 0)).toMatch(/no outcome file/);
  });
});

describe("firstCarryingNotes", () => {
  const gaps: Record<string, string | null> = { [A]: "no notes", [B]: "no notes", [C]: null, [Y]: null };
  const gapOf = (s: string): string | null => (s in gaps ? (gaps[s] as string | null) : "unknown");
  it("the first commit after the green one whose notes pass", () => {
    expect(firstCarryingNotes([A, B, C, Y], gapOf)).toEqual({ kind: "found", sha: C, after: 2 });
  });

  it("the green commit itself, when it carries its notes", () => {
    expect(firstCarryingNotes([C, Y], gapOf)).toEqual({ kind: "found", sha: C, after: 0 });
  });

  it("none, with the green commit's own reason", () => {
    const r = firstCarryingNotes([A, B], gapOf);
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.why).toMatch(/no notes/);
  });
});
