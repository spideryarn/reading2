/**
 * What the readiness loop does to its checkout before a run, and the stamp that
 * says so — the half of docs/plans/261007k that makes a runner's green run the
 * same as the deploy's own test gate.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CORPUS_ROOT } from "../scripts/corpus-materialise.js";
import { linkRunnerEnvLocal, preparationEnv, refreshRunnerCorpus } from "../scripts/readiness-loop.js";
import { preparationFromEnv } from "../scripts/readiness-run.js";
import {
  PREPARATION_VERSION,
  READINESS_PREPARATION_ENV,
  parseRunRecord,
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
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const stamp: Preparation = { by: "readiness-loop", version: PREPARATION_VERSION, sha: SHA, envLocalSha256: HASH };
const clean = (sha: string, dirty = false): TreeStamp => ({ kind: "known", sha, branch: "readiness-checks", dirty });

describe("linkRunnerEnvLocal — the runner reads the primary's .env.local", () => {
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
    expect(preparationFromEnv(raw, clean(SHA))).toEqual(JSON.parse(raw ?? "null"));
  });
});

describe("preparationFromEnv — the wrapper keeps the stamp only when it is about this run", () => {
  const raw = JSON.stringify(stamp);

  it("keeps a valid stamp about the commit the run started on", () => {
    expect(preparationFromEnv(raw, clean(SHA))).toEqual(stamp);
  });
  it("drops it when there is no variable — a hand run", () => {
    expect(preparationFromEnv(undefined, clean(SHA))).toBeNull();
    expect(preparationFromEnv("", clean(SHA))).toBeNull();
  });
  it("drops it when the run started on another commit", () => {
    expect(preparationFromEnv(raw, clean(OTHER))).toBeNull();
  });
  it("drops it when the tree was dirty or unknown", () => {
    expect(preparationFromEnv(raw, clean(SHA, true))).toBeNull();
    expect(preparationFromEnv(raw, { kind: "unknown", why: "git failed" })).toBeNull();
  });
  it("drops anything malformed", () => {
    expect(preparationFromEnv("{not json", clean(SHA))).toBeNull();
    expect(preparationFromEnv(JSON.stringify({ ...stamp, by: "someone" }), clean(SHA))).toBeNull();
    expect(preparationFromEnv(JSON.stringify({ ...stamp, sha: "abc" }), clean(SHA))).toBeNull();
    expect(preparationFromEnv(JSON.stringify({ ...stamp, envLocalSha256: "x" }), clean(SHA))).toBeNull();
    expect(preparationFromEnv(JSON.stringify({ ...stamp, version: 1.5 }), clean(SHA))).toBeNull();
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
  it("reads back no stamp for null, for a malformed one and for none, and keeps the record", () => {
    for (const preparation of [null, { ...stamp, by: "x" }, undefined]) {
      const parsed = parseRunRecord(JSON.stringify({ ...base, preparation }));
      expect(parsed).not.toBeNull();
      expect(parsed?.preparation ?? null).toBeNull();
    }
  });
});
