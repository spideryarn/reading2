/**
 * Bring a worktree level with the trunk on the **remote**, not with whatever the
 * primary checkout happened to have committed.
 *
 * ## Why this exists
 *
 * `.claude/settings.json` sets `worktree.baseRef: "head"`, so a new worktree
 * branches from the primary's local `HEAD`. That was the right call when the
 * trunk was `main` — `origin/main` only moves when somebody deploys, so it was
 * sixty commits stale on this box and branching from it would have been worse.
 * Since the flip to `dev` on 2026-09-02 the staleness runs the other way: every
 * agent pushes to `origin/dev` when it finishes, and the primary is only as
 * current as the last time somebody pulled into it. Measured on 2026-09-02, the
 * primary was **seven commits behind `origin/dev`** — so a worktree created that
 * minute started seven commits stale, and nothing said so.
 *
 * The fix is not to change `baseRef`. Branching from the remote would drop any
 * commit the primary has and has not pushed. Branching from `HEAD` and then
 * **merging** the remote trunk keeps both, and merging is what this repo does —
 * docs/project/version-control.md § Always merge, never rebase.
 *
 * ## Why it runs before `npm ci`
 *
 * The merge can move `package-lock.json`, and installing the old one and then
 * merging a new one leaves `node_modules` describing a lockfile that is no
 * longer there. So `worktree:setup` freshens first and installs second.
 *
 * ## What it will not do
 *
 * It never merges over uncommitted tracked changes, and it never resolves a
 * conflict. Both stop the setup with the reason said out loud, because a
 * conflict here is a proposal for a human to read —
 * docs/reusable/git-resolve-merge-conflicts.md.
 */

import { spawnSync } from "node:child_process";

import { TRUNK_BRANCH } from "./deploy-checks.js";

export type FreshenResult =
  /** Tracked files are modified, so nothing was fetched or merged. */
  | { kind: "dirty"; files: string[] }
  /** `git fetch` failed — offline, or no `origin`. Nothing was merged. */
  | { kind: "fetch-failed"; out: string }
  /** The remote trunk could not be read after a successful fetch. */
  | { kind: "trunk-unreadable"; out: string }
  /** Already contains the remote trunk; no merge was attempted. */
  | { kind: "already-level"; trunkSha: string }
  /** Merged cleanly. `count` is how many trunk commits were missing. */
  | { kind: "merged"; trunkSha: string; count: number }
  /** The merge stopped. The tree is left mid-merge for a human to resolve. */
  | { kind: "conflict"; trunkSha: string; out: string };

interface Run {
  ok: boolean;
  out: string;
}

function run(cwd: string, args: string[]): Run {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/**
 * Fetch `origin/<trunk>` and merge it into whatever branch this worktree is on.
 *
 * Never throws and never discards anything: every refusal is a returned result
 * the caller can print. Tracked-file dirtiness is checked here rather than left
 * to git, because git's own refusal names one file at a time and arrives as a
 * failed merge, which reads like a conflict.
 */
export function freshenFromTrunk(cwd: string, trunk: string = TRUNK_BRANCH): FreshenResult {
  const status = run(cwd, ["status", "--porcelain", "--untracked-files=no"]);
  if (status.ok && status.out !== "") {
    return { kind: "dirty", files: status.out.split("\n").map((l) => l.trim()) };
  }

  const fetched = run(cwd, ["fetch", "origin", trunk, "--quiet"]);
  if (!fetched.ok) return { kind: "fetch-failed", out: fetched.out };

  const trunkRef = `origin/${trunk}`;
  const rev = run(cwd, ["rev-parse", trunkRef]);
  if (!rev.ok) return { kind: "trunk-unreadable", out: rev.out };
  const trunkSha = rev.out;

  /* `--is-ancestor` rather than a count of zero: it answers "do I already
     contain it", which stays true for a worktree that merged the trunk five
     minutes ago and has committed since. */
  if (run(cwd, ["merge-base", "--is-ancestor", trunkSha, "HEAD"]).ok) {
    return { kind: "already-level", trunkSha };
  }

  const counted = run(cwd, ["rev-list", "--count", `HEAD..${trunkSha}`]);
  const count = counted.ok ? Number.parseInt(counted.out, 10) : Number.NaN;

  const merged = run(cwd, ["merge", "--no-edit", trunkRef]);
  if (!merged.ok) return { kind: "conflict", trunkSha, out: merged.out };
  return { kind: "merged", trunkSha, count: Number.isFinite(count) ? count : 0 };
}

/** One line saying what happened, for the setup script's report. */
export function describeFreshen(r: FreshenResult, trunk: string = TRUNK_BRANCH): string {
  switch (r.kind) {
    case "dirty":
      return `${r.files.length} tracked file(s) modified — not merging origin/${trunk} over them`;
    case "fetch-failed":
      return `could not fetch origin/${trunk} — this worktree may be behind the trunk`;
    case "trunk-unreadable":
      return `fetched, but could not read origin/${trunk}`;
    case "already-level":
      return `already contains origin/${trunk} (${r.trunkSha.slice(0, 8)})`;
    case "merged":
      return `merged origin/${trunk} (${r.trunkSha.slice(0, 8)}) — ${r.count} commit${r.count === 1 ? "" : "s"} this worktree did not have`;
    case "conflict":
      return `merging origin/${trunk} (${r.trunkSha.slice(0, 8)}) hit a conflict`;
  }
}

/** Is this bad enough to stop `worktree:setup`? */
export function freshenIsFatal(r: FreshenResult): boolean {
  return r.kind === "conflict";
}
