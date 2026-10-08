/**
 * What the readiness loop does to its checkout before a run, and the stamp that
 * says so — the half of docs/plans/261007k that makes a runner's green run the
 * same as the deploy's own test gate.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CORPUS_ROOT } from "../scripts/corpus-materialise.js";
import { ensureRunnerWorktree, linkRunnerEnvLocal, preparationEnv, readinessCheckEnv, refreshRunnerCorpus } from "../scripts/readiness-loop.js";
import { checkChildEnv, preparationFromEnv } from "../scripts/readiness-run.js";
import {
  PREPARATION_VERSION,
  READINESS_PREPARATION_ENV,
  parseRunRecord,
  readinessRunnerPath,
  type Preparation,
  type StartedRecord,
  type TreeStamp,
} from "../tools/fleet/readiness.js";

const SHA = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";
const HASH = "e".repeat(64);

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "readiness-prep-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const stamp: Preparation = { by: "readiness-loop", version: PREPARATION_VERSION, sha: SHA, envLocalSha256: HASH };
const clean = (sha: string, dirty = false): TreeStamp => ({ kind: "known", sha, branch: "readiness-checks", dirty });

describe("linkRunnerEnvLocal — the runner reads the primary's .env.local", () => {
  it("refuses an existing unregistered runner before replacing its .env.local", () => {
    const primary = scratch();
    const runner = readinessRunnerPath(primary);
    mkdirSync(runner, { recursive: true });
    writeFileSync(path.join(primary, ".env.local"), "NEW=1\n");
    writeFileSync(path.join(runner, ".env.local"), "KEEP=1\n");
    expect(() => ensureRunnerWorktree(primary, "2026-10-07T12:00:00.000Z")).toThrow(/unexpected|checkout/);
    expect(lstatSync(path.join(runner, ".env.local")).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(runner, ".env.local"), "utf8")).toBe("KEEP=1\n");
  });
  it("replaces a copy with a symlink to the primary's", () => {
    const primary = scratch();
    const runner = scratch();
    writeFileSync(path.join(primary, ".env.local"), "A=1\nB=2\n");
    writeFileSync(path.join(runner, ".env.local"), "A=1\n");
    linkRunnerEnvLocal(runner, primary);
    expect(lstatSync(path.join(runner, ".env.local")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(path.join(runner, ".env.local"))).toBe(path.join(primary, ".env.local"));
    expect(readFileSync(path.join(runner, ".env.local"), "utf8")).toBe("A=1\nB=2\n");
  });

  it("creates the link when there is nothing there", () => {
    const primary = scratch();
    const runner = scratch();
    writeFileSync(path.join(primary, ".env.local"), "A=1\n");
    linkRunnerEnvLocal(runner, primary);
    expect(readlinkSync(path.join(runner, ".env.local"))).toBe(path.join(primary, ".env.local"));
  });

  it("replaces a link that points somewhere else", () => {
    const primary = scratch();
    const runner = scratch();
    const elsewhere = scratch();
    writeFileSync(path.join(primary, ".env.local"), "A=1\n");
    writeFileSync(path.join(elsewhere, ".env.local"), "OLD=1\n");
    linkRunnerEnvLocal(runner, elsewhere);
    linkRunnerEnvLocal(runner, primary);
    expect(readlinkSync(path.join(runner, ".env.local"))).toBe(path.join(primary, ".env.local"));
  });

  it("refuses when the primary has none, and leaves the runner's alone", () => {
    const primary = scratch();
    const runner = scratch();
    writeFileSync(path.join(runner, ".env.local"), "A=1\n");
    expect(() => linkRunnerEnvLocal(runner, primary)).toThrow(/missing/);
    expect(readFileSync(path.join(runner, ".env.local"), "utf8")).toBe("A=1\n");
  });
});

describe("refreshRunnerCorpus — data/ and output/ as the commit has them", () => {
  const withCorpus = (): string => {
    const runner = scratch();
    for (const half of ["data", "output"]) {
      mkdirSync(path.join(runner, CORPUS_ROOT, half, "article"), { recursive: true });
      writeFileSync(path.join(runner, CORPUS_ROOT, half, "article", "fixture.json"), `{"${half}":true}`);
    }
    return runner;
  };

  it("removes what an earlier run left and copies both halves fresh", () => {
    const runner = withCorpus();
    mkdirSync(path.join(runner, "data", "deleted-from-the-commit"), { recursive: true });
    writeFileSync(path.join(runner, "data", "deleted-from-the-commit", "stale.json"), "{}");
    mkdirSync(path.join(runner, "output"), { recursive: true });
    writeFileSync(path.join(runner, "output", "written-by-a-test.json"), "{}");
    refreshRunnerCorpus(runner);
    expect(existsSync(path.join(runner, "data", "deleted-from-the-commit"))).toBe(false);
    expect(existsSync(path.join(runner, "output", "written-by-a-test.json"))).toBe(false);
    expect(readFileSync(path.join(runner, "data", "article", "fixture.json"), "utf8")).toBe('{"data":true}');
    expect(readFileSync(path.join(runner, "output", "article", "fixture.json"), "utf8")).toBe('{"output":true}');
  });

  it("refuses when the commit's corpus is missing a half", () => {
    const runner = withCorpus();
    rmSync(path.join(runner, CORPUS_ROOT, "output"), { recursive: true });
    expect(() => refreshRunnerCorpus(runner)).toThrow(/output/);
  });
});

describe("preparationEnv — the loop's statement, as the wrapper will read it", () => {
  it("carries the version, the sha and the hash of the .env.local the run will read", () => {
    const primary = scratch();
    const runner = scratch();
    writeFileSync(path.join(primary, ".env.local"), "A=1\n");
    linkRunnerEnvLocal(runner, primary);
    const raw = preparationEnv(runner, SHA)[READINESS_PREPARATION_ENV];
    const expected = createHash("sha256").update("A=1\n").digest("hex");
    expect(JSON.parse(raw ?? "null")).toEqual({ by: "readiness-loop", version: PREPARATION_VERSION, sha: SHA, envLocalSha256: expected });
    expect(preparationFromEnv(raw, clean(SHA), expected)).toEqual(JSON.parse(raw ?? "null"));
  });
});

describe("preparationFromEnv — the wrapper keeps the stamp only when it is about this run", () => {
  const raw = JSON.stringify(stamp);

  it("keeps a valid stamp about the commit the run started on", () => {
    expect(preparationFromEnv(raw, clean(SHA), HASH)).toEqual(stamp);
  });
  it("drops the stamp if .env.local differs at either end of the run or is unreadable", () => {
    expect(preparationFromEnv(raw, clean(SHA), "f".repeat(64))).toBeNull();
    expect(preparationFromEnv(raw, clean(SHA), null)).toBeNull();
  });
  it("does not forward a preparation stamp into another run or npm's children", () => {
    const runner = scratch();
    writeFileSync(path.join(runner, ".env.local"), "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54362/postgres\n");
    vi.stubEnv(READINESS_PREPARATION_ENV, raw);
    expect(readinessCheckEnv(runner)).not.toHaveProperty(READINESS_PREPARATION_ENV);
    expect(checkChildEnv("token")).not.toHaveProperty(READINESS_PREPARATION_ENV);
  });
  it("drops it when there is no variable — a hand run", () => {
    expect(preparationFromEnv(undefined, clean(SHA), HASH)).toBeNull();
    expect(preparationFromEnv("", clean(SHA), HASH)).toBeNull();
  });
  it("drops it when the run started on another commit", () => {
    expect(preparationFromEnv(raw, clean(OTHER), HASH)).toBeNull();
  });
  it("drops it when the tree was dirty or unknown", () => {
    expect(preparationFromEnv(raw, clean(SHA, true), HASH)).toBeNull();
    expect(preparationFromEnv(raw, { kind: "unknown", why: "git failed" }, HASH)).toBeNull();
  });
  it("drops anything malformed", () => {
    expect(preparationFromEnv("{not json", clean(SHA), HASH)).toBeNull();
    expect(preparationFromEnv(JSON.stringify({ ...stamp, by: "someone" }), clean(SHA), HASH)).toBeNull();
    expect(preparationFromEnv(JSON.stringify({ ...stamp, sha: "abc" }), clean(SHA), HASH)).toBeNull();
    expect(preparationFromEnv(JSON.stringify({ ...stamp, envLocalSha256: "x" }), clean(SHA), HASH)).toBeNull();
    expect(preparationFromEnv(JSON.stringify({ ...stamp, version: 1.5 }), clean(SHA), HASH)).toBeNull();
  });
});

describe("the stamp survives the store", () => {
  const base: StartedRecord = {
    schema: 1,
    runId: "aabbccddeeff",
    startedAt: "2026-10-07T10:00:00.000Z",
    pid: 1,
    host: "box",
    procStartToken: null,
    cwd: "/repo",
    check: "check",
    scope: "full",
    commandLine: null,
    treeAtStart: clean(SHA),
    source: "wrapper",
    state: "started",
  };
  it("reads back a valid stamp", () => {
    expect(parseRunRecord(JSON.stringify({ ...base, preparation: stamp }))?.preparation).toEqual(stamp);
  });
  it("preserves only an exact true wrapper verification", () => {
    for (const value of [true, false, "true", 1, null]) {
      const parsed = parseRunRecord(JSON.stringify({ ...base, preparation: { ...stamp, envLocalVerified: value } }));
      expect(parsed?.preparation?.envLocalVerified).toBe(value === true ? true : undefined);
    }
  });
  it("reads back no stamp for null, for a malformed one and for none, and keeps the record", () => {
    for (const preparation of [null, { ...stamp, by: "x" }, undefined]) {
      const parsed = parseRunRecord(JSON.stringify({ ...base, preparation }));
      expect(parsed).not.toBeNull();
      expect(parsed?.preparation ?? null).toBeNull();
    }
  });
});

describe("the wrapper writes preparation into the actual started and finished records", () => {
  it.each([
    { changed: false, mismatched: false, startStamped: true, endStamped: true },
    { changed: true, mismatched: false, startStamped: true, endStamped: false },
    { changed: false, mismatched: true, startStamped: false, endStamped: false },
  ])("validates the file at both ends: $changed / $mismatched", ({ changed, mismatched, startStamped, endStamped }) => {
    const root = path.resolve(__dirname, "..");
    const runner = scratch();
    mkdirSync(path.join(runner, "scripts"));
    mkdirSync(path.join(runner, "bin"));
    mkdirSync(path.join(runner, "tools", "fleet"), { recursive: true });
    writeFileSync(path.join(runner, "scripts", "readiness-run.ts"), readFileSync(path.join(root, "scripts", "readiness-run.ts")));
    for (const name of ["node_modules", "vitest-admission.ts"]) {
      symlinkSync(path.join(root, name), path.join(runner, name));
    }
    for (const name of ["readiness.ts", "readiness-parse.ts", "readiness-store.ts", "test-outcome.ts"]) {
      symlinkSync(path.join(root, "tools", "fleet", name), path.join(runner, "tools", "fleet", name));
    }
    symlinkSync(path.join(root, "scripts", "vitest-outcome-reporter.ts"), path.join(runner, "scripts", "vitest-outcome-reporter.ts"));
    // The wrapper runs for real; only the Git leaf is fixed to a clean SHA.
    // Git's synchronous child probe is blocked by this review's sandbox.
    writeFileSync(path.join(runner, "tools", "fleet", "readiness-git.ts"), [
      `export const stampTree = () => (${JSON.stringify(clean(SHA))});`,
      "export const runnerChildEnv = (env) => ({ ...env });",
    ].join("\n"));
    writeFileSync(path.join(runner, "package.json"), JSON.stringify({ type: "module", scripts: { check: "tsx scripts/check.ts" } }));
    writeFileSync(path.join(runner, ".env.local"), "A=1\n");
    writeFileSync(path.join(runner, "bin", "npm"), [
      "#!/bin/sh",
      'cp "$FLEET_READINESS_DIR"/runs/*.json "$FLEET_READINESS_DIR/started.json"',
      changed ? "echo A=2 > .env.local" : ":",
      "exit 1",
    ].join("\n"));
    chmodSync(path.join(runner, "bin", "npm"), 0o755);
    const hash = createHash("sha256").update("A=1\n").digest("hex");
    const preparation = { ...stamp, envLocalSha256: mismatched ? HASH : hash };
    const store = path.join(runner, "store");
    const result = spawnSync(process.execPath, ["--import", "tsx", path.join(runner, "scripts", "readiness-run.ts"), "check"], {
      cwd: runner,
      env: { ...process.env, PATH: `${path.join(runner, "bin")}:${process.env.PATH ?? ""}`, FLEET_READINESS_DIR: store, [READINESS_PREPARATION_ENV]: JSON.stringify({ ...preparation, envLocalVerified: true }) },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(1);
    const started = parseRunRecord(readFileSync(path.join(store, "started.json"), "utf8"));
    const files = readdirSync(path.join(store, "runs"));
    expect(files).toHaveLength(1);
    const finished = parseRunRecord(readFileSync(path.join(store, "runs", files[0] ?? ""), "utf8"));
    expect(started?.state).toBe("started");
    expect(finished?.state).toBe("finished");
    expect(started?.preparation ?? null).toEqual(startStamped ? preparation : null);
    expect(finished?.preparation ?? null).toEqual(endStamped ? { ...preparation, envLocalVerified: true } : null);
    /* The fake npm writes no outcome, and the wrapper says so on the record
       rather than leaving it off (docs/plans/261008h). */
    expect(finished?.state === "finished" ? finished.testOutcome : null).toMatchObject({ kind: "unusable", why: expect.stringMatching(/no outcome file/) });
  });
});
