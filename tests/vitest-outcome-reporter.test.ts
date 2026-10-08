/**
 * The outcome reporter against **real vitest runs**, because what it must get
 * right — which reporters run, what workers inherit, what happens after the
 * tests — is vitest's behaviour, and a report built by hand proves none of it
 * (GPT Sol on docs/plans/261008h, P2-11). Each case is a small project in a
 * temp directory, run by this checkout's vitest with the reporter in its
 * config, and judged by the same functions the deploy uses.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { rerunVerdict, testOutcomeFrom } from "../tools/fleet/test-outcome.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = path.join(REPO, "node_modules", ".bin", "vitest");
const REPORTER = path.join(REPO, "scripts", "vitest-outcome-reporter.ts");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** Run vitest over `files` in a fresh directory; the reporter's file, and vitest's exit. */
function runProject(files: Record<string, string>, opts: { args?: string[]; globalSetup?: string } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "outcome-reporter-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  if (opts.globalSetup) writeFileSync(path.join(dir, "global.mjs"), opts.globalSetup);
  writeFileSync(
    path.join(dir, "vitest.config.mjs"),
    `export default { test: { include: ["*.test.mjs"], reporters: ["default", ${JSON.stringify(REPORTER)}]` +
      `${opts.globalSetup ? ', globalSetup: ["./global.mjs"]' : ""} } };\n`,
  );
  const outcomeFile = path.join(dir, "outcome.json");
  const env: NodeJS.ProcessEnv = { ...process.env, SPIDERYARN_TEST_OUTCOME_FILE: outcomeFile };
  delete env.VITEST;
  delete env.VITEST_WORKER_ID;
  delete env.VITEST_POOL_ID;
  const r = spawnSync(VITEST, ["run", "--root", dir, "--config", path.join(dir, "vitest.config.mjs"), ...(opts.args ?? [])], {
    cwd: dir,
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { text: existsSync(outcomeFile) ? readFileSync(outcomeFile, "utf8") : null, exit: r.status, out: `${r.stdout}${r.stderr}` };
}

const PASS = `import { test } from "vitest";\ntest("ok", () => {});\n`;
const FAIL = `import { test, expect } from "vitest";\ntest("no", () => { expect(1).toBe(2); });\n`;

describe("the outcome reporter, in a real vitest run", { timeout: 60_000 }, () => {
  it("a run red in one file names that file, and only it", () => {
    const r = runProject({ "a.test.mjs": PASS, "b.test.mjs": FAIL });
    expect(r.exit).toBe(1);
    expect(testOutcomeFrom(r.text)).toEqual({ kind: "red-in-files", failed: ["b.test.mjs"], files: 2 });
  });

  it("a green run is a pass", () => {
    const r = runProject({ "a.test.mjs": PASS });
    expect(r.exit).toBe(0);
    expect(testOutcomeFrom(r.text)).toEqual({ kind: "pass", files: 1 });
  });

  it("a failing beforeAll is its file's failure", () => {
    const hook = `import { test, beforeAll } from "vitest";\nbeforeAll(() => { throw new Error("hook"); });\ntest("x", () => {});\n`;
    const r = runProject({ "a.test.mjs": PASS, "b.test.mjs": hook });
    expect(testOutcomeFrom(r.text)).toEqual({ kind: "red-in-files", failed: ["b.test.mjs"], files: 2 });
  });

  it("an unhandled error beside a red file makes the run unusable", () => {
    const stray = `import { test } from "vitest";\ntest("stray", () => { setTimeout(() => { throw new Error("stray"); }, 0); });\n`;
    const r = runProject({ "a.test.mjs": stray, "b.test.mjs": FAIL });
    const o = testOutcomeFrom(r.text);
    expect(o.kind).toBe("unusable");
    if (o.kind === "unusable") expect(o.why).toMatch(/unhandled/);
  });

  it("workers do not inherit the report's path, so a vitest inside a test cannot write it", () => {
    const sees = `import { test, expect } from "vitest";\ntest("env", () => { expect(process.env.SPIDERYARN_TEST_OUTCOME_FILE).toBeUndefined(); });\n`;
    const r = runProject({ "a.test.mjs": sees });
    expect(testOutcomeFrom(r.text)).toEqual({ kind: "pass", files: 1 });
  });

  it("a teardown that marks its failure after a red file makes the run unusable", () => {
    const setup =
      `import { markFailureOutsideFiles } from ${JSON.stringify(REPORTER)};\n` +
      `export default () => () => { process.exitCode = 1; markFailureOutsideFiles("teardown failed"); };\n`;
    const r = runProject({ "a.test.mjs": PASS, "b.test.mjs": FAIL }, { globalSetup: setup });
    const o = testOutcomeFrom(r.text);
    expect(o.kind).toBe("unusable");
    if (o.kind === "unusable") expect(o.why).toMatch(/teardown failed/);
  });

  it("a teardown that only sets the exit code after a green run makes it unusable", () => {
    const setup = `export default () => () => { process.exitCode = 1; };\n`;
    const r = runProject({ "a.test.mjs": PASS }, { globalSetup: setup });
    expect(r.exit).toBe(1);
    const o = testOutcomeFrom(r.text);
    expect(o.kind).toBe("unusable");
    if (o.kind === "unusable") expect(o.why).toMatch(/after its tests/);
  });

  it("a filtered run is not a whole-suite baseline", () => {
    const r = runProject({ "a.test.mjs": PASS, "b.test.mjs": FAIL }, { args: ["a.test.mjs"] });
    const o = testOutcomeFrom(r.text);
    expect(o.kind).toBe("unusable");
    if (o.kind === "unusable") expect(o.why).toMatch(/narrowed|did not run/);
  });

  it("a rerun naming a file that does not exist is not a pass", () => {
    const r = runProject({ "a.test.mjs": PASS }, { args: ["a.test.mjs", "gone.test.mjs"] });
    expect(r.exit).toBe(0);
    expect(rerunVerdict(["a.test.mjs", "gone.test.mjs"], r.text, r.exit)).toMatch(/never ran gone\.test\.mjs/);
    expect(rerunVerdict(["a.test.mjs"], r.text, r.exit)).toBeNull();
  });

  it("named on the command line, it still runs beside the others", () => {
    const r = runProject({ "a.test.mjs": PASS }, { args: ["--reporter=default", `--reporter=${REPORTER}`] });
    expect(testOutcomeFrom(r.text)).toEqual({ kind: "pass", files: 1 });
  });
});
