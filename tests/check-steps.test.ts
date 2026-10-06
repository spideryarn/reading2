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
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GATE_TOOLING_BUILDS } from "../scripts/deploy-checks.js";

const REPO = path.resolve(import.meta.dirname, "..");

function listed(...flags: string[]): string[] {
  const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/check.ts", "--list", ...flags], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.split("\n").filter((line) => line !== "");
}

describe("npm run check -- --list", () => {
  for (const flags of [[], ["--fast"], ["--offline"]]) {
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
