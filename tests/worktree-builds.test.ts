/**
 * **`worktree:setup` builds what the suite reads, once.**
 *
 * Until 2026-10-06 a fresh worktree had no build output, so every agent's
 * first `npm test` had the same five red files and every session reported
 * them; noise that size hides a real red. The builds take about 19 s.
 * docs/plans/261006g-fresh-worktree-builds-once-so-five-reds-stop.md.
 */
import { describe, expect, it } from "vitest";

import { GATE_TOOLING_BUILDS, SUITE_BUILDS } from "../scripts/deploy-checks.js";
import { buildForSuite, describeBuilds } from "../scripts/worktree-builds.js";

describe("SUITE_BUILDS", () => {
  it("is the product build, then every tooling build the deploy gate runs", () => {
    expect(SUITE_BUILDS).toEqual(["build", ...GATE_TOOLING_BUILDS.map((b) => b.script)]);
    expect(SUITE_BUILDS).toContain("build:fleet");
  });
});

describe("buildForSuite", () => {
  it("runs every suite build, in order, in the tree it was given", () => {
    const calls: string[] = [];
    const result = buildForSuite("/some/tree", {
      run: (script, cwd) => {
        calls.push(`${script} in ${cwd}`);
        return { code: 0, out: "" };
      },
    });
    expect(calls).toEqual(SUITE_BUILDS.map((s) => `${s} in /some/tree`));
    expect(result.failed).toEqual([]);
    expect(describeBuilds(result)).toContain("npm run build");
  });

  it("carries on past a build that fails, and says which one and why", () => {
    const calls: string[] = [];
    const result = buildForSuite("/some/tree", {
      run: (script) => {
        calls.push(script);
        return script === "build" ? { code: 1, out: "line one\nvite: could not resolve ./gone" } : { code: 0, out: "" };
      },
    });
    // A broken product build must not cost the fleet tests their build too.
    expect(calls).toEqual([...SUITE_BUILDS]);
    expect(result.failed).toEqual([{ script: "build", out: "line one\nvite: could not resolve ./gone" }]);
    expect(describeBuilds(result)).toContain("npm run build");
  });

  it("counts a build killed by a signal as failed", () => {
    const result = buildForSuite("/some/tree", { run: () => ({ code: null, out: "" }) });
    expect(result.failed.map((f) => f.script)).toEqual([...SUITE_BUILDS]);
  });
});
