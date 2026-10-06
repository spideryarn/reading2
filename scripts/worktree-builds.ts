/**
 * **Build what the test suite reads, so a fresh worktree's first `npm test`
 * is not red for a reason that is nobody's.**
 *
 * Five test files read build output — `api-dist/vercel.js`, and the fleet
 * dashboard's client under `tools/fleet/web/dist/` — and fail loudly rather
 * than skip when it is missing, which is right. A new worktree has neither, so
 * until 2026-10-06 every agent's first run had the same five reds and every
 * session reported them, and noise that size hides a real red.
 * `npm run worktree:setup` now runs this once: about 19 s, 16 MB.
 *
 * The list is `SUITE_BUILDS`, shared with the deploy gate and `npm run check`.
 *
 * **A failed build is reported, not fatal, and does not stop the others.** A
 * trunk whose build is broken must not stop an agent getting a tree to fix it
 * in, and a broken product build should not cost the fleet tests theirs.
 *
 * **What this does not do is keep the build current.** The output is as old as
 * the last build, so a change to what the API bundle imports is not seen by a
 * bare `npm test` until something rebuilds — `npm run check` and the deploy
 * gate both do. And the builds empty their output directories, so one run
 * while a suite is reading them in the same tree can redden that suite.
 * docs/plans/261006g-fresh-worktree-builds-once-so-five-reds-stop.md.
 */

import { spawnSync } from "node:child_process";

import { SUITE_BUILDS } from "./deploy-checks.js";

/** `code` is null when the build was killed by a signal or never started. */
export type BuildRun = (script: string, cwd: string) => { code: number | null; out: string };

export interface SuiteBuildsResult {
  ran: readonly string[];
  failed: { script: string; out: string }[];
}

const npmRun: BuildRun = (script, cwd) => {
  const run = spawnSync("npm", ["run", "--silent", script], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: run.status, out: `${run.stdout ?? ""}${run.stderr ?? ""}${run.error ? `\n${run.error.message}` : ""}` };
};

export function buildForSuite(
  root: string,
  opts: { run?: BuildRun; note?: (msg: string) => void } = {},
): SuiteBuildsResult {
  const run = opts.run ?? npmRun;
  const failed: SuiteBuildsResult["failed"] = [];
  for (const script of SUITE_BUILDS) {
    opts.note?.(`npm run ${script}`);
    const built = run(script, root);
    if (built.code !== 0) failed.push({ script, out: built.out });
  }
  return { ran: SUITE_BUILDS, failed };
}

const named = (scripts: readonly string[]) => scripts.map((s) => `\`npm run ${s}\``).join(", ");

export function describeBuilds(result: SuiteBuildsResult): string {
  return result.failed.length === 0
    ? `built what the suite reads (${named(result.ran)})`
    : `${named(result.failed.map((f) => f.script))} failed — the test files that read its output are red until it passes`;
}
