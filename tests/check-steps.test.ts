/**
 * **`npm run check` builds everything the suite reads before it runs the suite.**
 *
 * Five test files read build output and fail, rather than skip, when it is
 * missing. `check` ran `npm run build` above its test gate and never
 * `build:fleet`, so three of them were red in any checkout where nobody had run
 * that by hand (queue entry qi-nwqfadjz, found by the readiness runner on
 * 2026-09-09). The deploy gate already had the list, `GATE_TOOLING_BUILDS`;
 * this holds `check` to the same one, and to the order, which is the half that
 * went wrong the first time (`build` below `test`, 2026-09-03).
 *
 * It asks the script itself, with `--list`, rather than reading its source:
 * what is printed is what the loop would run.
 * docs/plans/261006g-fresh-worktree-builds-once-so-five-reds-stop.md.
 */
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GATE_TOOLING_BUILDS } from "../scripts/deploy-checks.js";

const REPO = path.resolve(import.meta.dirname, "..");

// If --list regresses, fail before the execution loop can launch the real
// checks (including this suite again). A timeout alone leaves grandchildren.
const NO_CHECK_COMMANDS = `data:text/javascript,${encodeURIComponent(`
  import childProcess from "node:child_process";
  import { syncBuiltinESMExports } from "node:module";
  childProcess.spawnSync = () => { throw new Error("check --list must not start child processes"); };
  syncBuiltinESMExports();
`)}`;

function listed(...flags: string[]): string[] {
  // File-backed capture works where sandboxed synchronous pipes return EPERM
  // even though the child exits 0 (see helpers/wrapper-env.ts).
  const dir = mkdtempSync(path.join(tmpdir(), "check-list-"));
  const stdout = path.join(dir, "stdout");
  const stderr = path.join(dir, "stderr");
  const out = openSync(stdout, "w");
  const err = openSync(stderr, "w");
  try {
    const run = spawnSync(process.execPath, ["--import", "tsx", "--import", NO_CHECK_COMMANDS, "scripts/check.ts", "--list", ...flags], {
      cwd: REPO,
      stdio: ["ignore", out, err],
      timeout: 60_000,
    });
    if (run.error) throw run.error;
    expect(run.status, readFileSync(stderr, "utf8")).toBe(0);
    return readFileSync(stdout, "utf8").split("\n").filter((line) => line !== "");
  } finally {
    closeSync(out);
    closeSync(err);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("npm run check -- --list", () => {
  for (const flags of [[], ["--fast"], ["--offline"], ["--fast", "--offline"]]) {
    it(`runs every build the suite needs above the test gate ${flags.join(" ")}`.trim(), () => {
      const steps = listed(...flags);
      /* A control: a `--list` that printed nothing, or ran the checks instead,
         must not pass by every index being -1. */
      expect(steps[0]).toBe("typecheck");
      const test = steps.indexOf("test");
      expect(test).toBeGreaterThan(0);

      const builds = ["build", ...GATE_TOOLING_BUILDS.map((b) => b.script)];
      const at = builds.map((name) => steps.indexOf(name));
      expect(at.every((i) => i > 0 && i < test), `${builds.join(", ")} in ${steps.join(", ")}`).toBe(true);
      // And in the order the deploy gate runs them: `build`, then the tooling.
      expect(at).toEqual([...at].sort((a, b) => a - b));
    });
  }
});
