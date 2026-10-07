/**
 * `npm run deploy -- --ready`: which commit, and whether its test gate may be
 * taken from the readiness store. docs/plans/261007k.
 *
 * Every case but one is a way the store could look like evidence and not be.
 */
import { describe, expect, it } from "vitest";

import {
  newestReadyCommit,
  readyTrunkGap,
  TEST_EVIDENCE_MAX_AGE_MS,
  testEvidenceFor,
  type TestEvidence,
} from "../scripts/deploy-evidence.js";
import { parseDeployArgs } from "../scripts/deploy-checks.js";
import {
  PREPARATION_VERSION,
  readinessRunnerPath,
  resolveRecord,
  type CheckStep,
  type FinishedRecord,
  type Preparation,
  type Reading,
  type StartedRecord,
  type TreeStamp,
} from "../tools/fleet/readiness.js";

const SHA = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";
const RUNNER = readinessRunnerPath("/home/greg/code/spideryarn2");
const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const HOUR = 3_600_000;

const clean = (sha: string): TreeStamp => ({ kind: "known", sha, branch: "readiness-checks", dirty: false });
const dirty = (sha: string): TreeStamp => ({ kind: "known", sha, branch: "readiness-checks", dirty: true });

const row = (name: string, verdict: CheckStep["verdict"]): CheckStep => ({ name, gate: "unknown", verdict, findings: null });
const CLEAN_ROWS = [
  row("typecheck", "clean"),
  row("build", "clean"),
  row("build:fleet", "clean"),
  row("test", "clean"),
  row("cycles", "clean"),
];
const ENV_HASH = "e".repeat(64);
const prepared = (sha: string, over: Partial<Preparation> = {}): Preparation => ({
  by: "readiness-loop",
  version: PREPARATION_VERSION,
  sha,
  envLocalSha256: ENV_HASH,
  envLocalVerified: true,
  ...over,
});

let n = 0;
/** A full `npm run check` in the runner that passed on SHA, finished `hoursBefore` hours before NOW. */
function check(over: Partial<FinishedRecord> = {}, hoursBefore = 2): FinishedRecord {
  const at = NOW - hoursBefore * HOUR;
  return {
    schema: 1,
    runId: `run${String(n++).padStart(9, "0")}`,
    startedAt: new Date(at - HOUR).toISOString(),
    pid: 4242,
    host: "box",
    procStartToken: "12345",
    cwd: RUNNER,
    check: "check",
    scope: "full",
    commandLine: "tsx scripts/check.ts",
    treeAtStart: clean(SHA),
    source: "wrapper",
    preparation: prepared(SHA),
    state: "finished",
    at: new Date(at).toISOString(),
    durationMs: HOUR,
    outcome: "pass",
    exit: 0,
    counts: { kind: "check", steps: CLEAN_ROWS },
    treeAtEnd: clean(SHA),
    logPath: null,
    why: null,
    failedTestFiles: null,
    ...over,
  };
}

const read = (...records: (FinishedRecord | StartedRecord)[]): Reading[] =>
  records.map((r) => resolveRecord(r, NOW, () => true));

const evidence = (readings: Reading[], unreadable = 0, sha = SHA, envLocalSha256: string | null = ENV_HASH): TestEvidence =>
  testEvidenceFor({ sha, readings, unreadable, nowMs: NOW, runnerCwd: RUNNER, envLocalSha256 });

const expectRun = (e: TestEvidence, why: RegExp): void => {
  expect(e.kind).toBe("run");
  if (e.kind === "run") expect(e.why).toMatch(why);
};

describe("testEvidenceFor — when the deploy may skip running the suite", () => {
  it("reuses a fresh, clean, full check in the runner, and names the run", () => {
    const record = check();
    const e = evidence(read(record));
    expect(e.kind).toBe("reuse");
    if (e.kind === "reuse") {
      expect(e.record.runId).toBe(record.runId);
      expect(e.sentence).toContain(record.runId);
      expect(e.sentence).toContain(SHA.slice(0, 8));
    }
  });

  it("runs the suite when there is no record at all", () => {
    expectRun(evidence([]), /no readiness run in the store is about 11111111/);
  });

  it("runs the suite when the only record is about a different commit", () => {
    expectRun(evidence(read(check({ treeAtStart: clean(OTHER), treeAtEnd: clean(OTHER) }))), /no readiness run in the store is about/);
  });

  it("runs the suite when the tree was dirty at the start", () => {
    expectRun(evidence(read(check({ treeAtStart: dirty(SHA) }))), /uncommitted/);
  });

  it("runs the suite when the tree was dirty at the end", () => {
    expectRun(evidence(read(check({ treeAtEnd: dirty(SHA) }))), /uncommitted/);
  });

  it("runs the suite when the checkout moved during the run", () => {
    expectRun(evidence(read(check({ treeAtEnd: clean(OTHER) }))), /moved/);
  });

  it("runs the suite when the record is red on test", () => {
    const red = check({ outcome: "fail", exit: 1, counts: { kind: "check", steps: [row("typecheck", "clean"), row("test", "failed")] } });
    expectRun(evidence(read(red)), /^test: failed/);
  });

  it("runs the suite when a pass is followed by a red on the same commit", () => {
    const red = check({ outcome: "fail", exit: 1, counts: { kind: "check", steps: [row("typecheck", "clean"), row("test", "failed")] } }, 1);
    expectRun(evidence(read(check({}, 3), red)), /^test: failed/);
  });

  it("reuses a pass that came after a red on the same commit, as the Readiness tab does", () => {
    /* The newest settled run decides (readiness-verdict.ts § reduceTimeline):
       a flake that failed and then passed reads green there, and the deploy's
       own gate would have been one run of the same suite. */
    const red = check({ outcome: "fail", exit: 1, counts: { kind: "check", steps: [row("typecheck", "clean"), row("test", "failed")] } }, 5);
    expect(evidence(read(red, check({}, 1))).kind).toBe("reuse");
  });

  it("refuses tied test passes whose preparation differs, in either input order", () => {
    const good = check();
    const unstamped = check({ preparation: null });
    for (const records of [[good, unstamped], [unstamped, good]]) {
      expect(evidence(read(...records)).kind).toBe("run");
    }
  });

  it("refuses tied check passes when one test pass sits on a failed build", () => {
    const good = check();
    const badBuild = check({
      outcome: "fail", exit: 1,
      counts: { kind: "check", steps: CLEAN_ROWS.map((r) => r.name === "build" ? row("build", "failed") : r) },
    });
    for (const records of [[good, badBuild], [badBuild, good]]) {
      expect(evidence(read(...records)).kind).toBe("run");
    }
  });

  it("refuses a tied standalone test pass even if the verdict picks the prepared check", () => {
    const good = check();
    const standalone = check({ check: "test", counts: { kind: "vitest", files: null, tests: null } });
    for (const records of [[good, standalone], [standalone, good]]) {
      expect(evidence(read(...records)).kind).toBe("run");
    }
  });

  it("refuses an unfinished check that started before the chosen pass finished", () => {
    const { state: _state, ...common } = check({}, 1);
    const running: StartedRecord = { ...common, state: "started" };
    // Its start is two hours ago; the other check finished one hour ago.
    expectRun(evidence(read(check({}, 1), running)), /unfinished|still going/);
  });

  it("runs the suite when the passing run is older than the window", () => {
    const hours = TEST_EVIDENCE_MAX_AGE_MS / HOUR + 1;
    expectRun(evidence(read(check({}, hours))), /older than/);
  });

  it("runs the suite when the run claims to have finished in the future", () => {
    expectRun(evidence(read(check({}, -1))), /future/);
  });

  it("runs the suite when the pass ran in some other checkout", () => {
    expectRun(evidence(read(check({ cwd: "/var/tmp/spideryarn-worktrees/someone" }))), /not in the readiness runner/);
  });

  it("runs the suite when the pass was a bare test run, not a full check", () => {
    const testOnly = check({ check: "test", counts: { kind: "vitest", files: null, tests: null } });
    const typecheck = check({ check: "typecheck", counts: { kind: "typecheck", projects: 4, errors: 0 } });
    expectRun(evidence(read(testOnly, typecheck)), /not a full `npm run check`/);
  });

  it("runs the suite when any record in the store is unreadable", () => {
    expectRun(evidence(read(check()), 1), /could not be read/);
  });

  it("runs the suite when a later attempt on the same commit has not finished", () => {
    const rerun: StartedRecord = {
      ...check({}, 0.5),
      state: "started",
    } as unknown as StartedRecord;
    expectRun(evidence(read(check({}, 2), rerun)), /still going|unsettled|test, typecheck/);
  });

  it("runs the suite when a narrowed run is the only one", () => {
    expectRun(evidence(read(check({ scope: "narrowed" }))), /nobody has run them|does not count|not the whole/);
  });

  it("runs the suite when the run carries no preparation stamp (a hand run, or an old record)", () => {
    expectRun(evidence(read(check({ preparation: null }))), /no preparation stamp/);
    /* A record from before 2026-10-07 has no key at all. */
    const { preparation: _absent, ...legacy } = check();
    expectRun(evidence(read(legacy)), /no preparation stamp/);
  });

  it("runs the suite when the stamp is from an older preparation version", () => {
    expectRun(evidence(read(check({ preparation: prepared(SHA, { version: PREPARATION_VERSION - 1 }) }))), /version/);
  });

  it("runs the suite when an older wrapper only copied the loop's current-version statement", () => {
    const { envLocalVerified: _absent, ...loopStatement } = prepared(SHA);
    expectRun(evidence(read(check({ preparation: loopStatement }))), /wrapper.*verif/);
  });

  it("runs the suite when the stamp is about another commit", () => {
    expectRun(evidence(read(check({ preparation: prepared(OTHER) }))), /preparation is about 22222222/);
  });

  it("runs the suite when .env.local has changed since the run read it", () => {
    expectRun(evidence(read(check()), 0, SHA, "f".repeat(64)), /\.env\.local has changed/);
  });

  it("runs the suite when there is no .env.local to compare", () => {
    expectRun(evidence(read(check()), 0, SHA, null), /no \.env\.local/);
  });

  it("runs the suite when a build failed in the passing run, whatever the test row says", () => {
    /* check.ts carries on past a failed build, so the suite can pass against the
       previous commit's api-dist. The outer run is a fail; test and typecheck
       are clean, so the verdict alone would call it ready. */
    const staleBundle = check({
      outcome: "fail",
      exit: 1,
      counts: { kind: "check", steps: [row("typecheck", "clean"), row("build", "failed"), row("build:fleet", "clean"), row("test", "clean")] },
    });
    expectRun(evidence(read(staleBundle)), /`build` was failed/);
  });

  it("runs the suite when a tooling build's row is missing", () => {
    const noFleet = check({ counts: { kind: "check", steps: CLEAN_ROWS.filter((r) => r.name !== "build:fleet") } });
    expectRun(evidence(read(noFleet)), /no `build:fleet` row/);
  });

  it("reuses a check that failed only on a gate the deploy does not run", () => {
    const cyclesRed = check({
      outcome: "fail",
      exit: 1,
      counts: { kind: "check", steps: [...CLEAN_ROWS.filter((r) => r.name !== "cycles"), row("cycles", "failed")] },
    });
    expect(evidence(read(cyclesRed)).kind).toBe("reuse");
  });
});

describe("newestReadyCommit — which green commit --ready deploys", () => {
  const reuse = (sha: string): TestEvidence => {
    const e = evidence(read(check({ treeAtStart: clean(sha), treeAtEnd: clean(sha), preparation: prepared(sha) })), 0, sha);
    if (e.kind !== "reuse") throw new Error("fixture should be reusable");
    return e;
  };
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const C = "c".repeat(40);
  /** A is inside B; C is on a side branch of its own. */
  const chain = (a: string, b: string): boolean | null => a === b || (a === A && b === B);

  it("says none, with reasons, when nothing is usable", () => {
    const got = newestReadyCommit(chain, [{ sha: A, evidence: { kind: "run", why: "test: failed" }, onTrunk: true, ancestors: 10 }]);
    expect(got.kind).toBe("none");
    if (got.kind === "none") expect(got.why.join("\n")).toContain("test: failed");
  });

  it("says none when the store is empty", () => {
    expect(newestReadyCommit(chain, []).kind).toBe("none");
  });

  it("picks the one with the most ancestors, not the one listed last", () => {
    const got = newestReadyCommit(chain, [
      { sha: B, evidence: reuse(B), onTrunk: true, ancestors: 20 },
      { sha: A, evidence: reuse(A), onTrunk: true, ancestors: 10 },
    ]);
    expect(got.kind === "chosen" && got.sha).toBe(B);
  });

  it("ignores a green commit that is not on origin/dev, however new", () => {
    const got = newestReadyCommit(chain, [
      { sha: C, evidence: reuse(C), onTrunk: false, ancestors: 30 },
      { sha: A, evidence: reuse(A), onTrunk: true, ancestors: 10 },
    ]);
    expect(got.kind === "chosen" && got.sha).toBe(A);
  });

  it("refuses to choose between green commits on different branches", () => {
    const got = newestReadyCommit(chain, [
      { sha: B, evidence: reuse(B), onTrunk: true, ancestors: 20 },
      { sha: C, evidence: reuse(C), onTrunk: true, ancestors: 15 },
    ]);
    expect(got.kind).toBe("none");
    if (got.kind === "none") expect(got.why.join(" ")).toMatch(/cannot be decided/);
  });

  it("does not pick a newer red over an older green", () => {
    const got = newestReadyCommit(chain, [
      { sha: B, evidence: { kind: "run", why: "test: failed" }, onTrunk: true, ancestors: 20 },
      { sha: A, evidence: reuse(A), onTrunk: true, ancestors: 10 },
    ]);
    expect(got.kind === "chosen" && got.sha).toBe(A);
  });
});

describe("readyTrunkGap — the trunk gate under --ready", () => {
  it("passes an ancestor of origin/dev", () => {
    expect(readyTrunkGap({ sha: SHA, trunkSha: OTHER, isAncestor: true })).toBeNull();
  });
  it("refuses a commit origin/dev does not contain", () => {
    expect(readyTrunkGap({ sha: SHA, trunkSha: OTHER, isAncestor: false })).toMatch(/never pushed/);
  });
  it("refuses when origin/dev cannot be read", () => {
    expect(readyTrunkGap({ sha: SHA, trunkSha: null, isAncestor: null })).toMatch(/could not read/);
  });
  it("refuses when ancestry cannot be decided", () => {
    expect(readyTrunkGap({ sha: SHA, trunkSha: OTHER, isAncestor: null })).toMatch(/could not tell/);
  });
});

describe("parseDeployArgs — --ready", () => {
  it("accepts --ready, alone and with --dry-run", () => {
    const alone = parseDeployArgs(["--ready"], {});
    expect(alone.ok && alone.mode.op === "deploy" && alone.mode.ready).toBe(true);
    const dry = parseDeployArgs(["--dry-run", "--ready"], {});
    expect(dry.ok && dry.mode.op === "dry-run" && dry.mode.ready).toBe(true);
  });
  it("is off unless asked for", () => {
    const plain = parseDeployArgs([], {});
    expect(plain.ok && plain.mode.op === "deploy" && plain.mode.ready).toBe(false);
  });
  it("refuses --ready beside --verify-only, which deploys nothing", () => {
    expect(parseDeployArgs(["--verify-only", "--ready"], {}).ok).toBe(false);
  });
});
