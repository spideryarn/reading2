/**
 * `npm run worktree:sweep` — which worktrees have landed their work, and the
 * removal of one that has.
 *
 * Two halves, deliberately separate:
 *
 * ```
 * npm run worktree:sweep                              # classify. Reads. Deletes nothing.
 * npm run worktree:sweep -- remove --branch <name>    # one worktree, every guard re-run
 * npm run worktree:sweep -- remove --branch <name> --dry-run
 * ```
 *
 * ## The shape is borrowed, and so is the reason for the awkward bit
 *
 * From the worktree tooling in Greg's MindstoneRebel repo, which runs 5-7 agents
 * the way we run a dozen. Two of its choices are load-bearing and would look
 * like over-engineering without the story:
 *
 * **`remove` takes one branch and has no bulk flag**, and re-runs the whole
 * classification — including a fresh fetch — before each deletion. So an agent
 * that classified ten minutes ago cannot cascade ten removals off one stale
 * answer; each one re-earns its verdict.
 *
 * **A worktree active in the last 24 hours is never removable**, however merged
 * it looks. Their version without this guard was retired for removing live
 * worktrees: a brand-new one whose tip equals the trunk passes the merged check
 * trivially. **That is now the normal state of a fresh worktree here** —
 * `worktree:setup` merges `origin/dev`, so five minutes after creation a
 * worktree is clean, contains the trunk, and has landed nothing. Without the age
 * guard the sweep would delete an agent's tree while it was reading its first
 * file. See scripts/worktree-freshen.ts for the merge that causes it.
 *
 * And activity is **not** the last commit's date. A fast-forward merge writes no
 * commit, so a worktree created this minute can have a HEAD dated last week.
 * `lastActivity` takes the branch's reflog top entry too — that moves when the
 * branch is created and on every merge — and uses whichever is later.
 *
 * ## What makes "merged" answerable at all
 *
 * `git merge-base --is-ancestor <branch> origin/dev`. That is only a valid test
 * because a worktree pushes with `git push origin HEAD:dev`, so its tip really
 * does become an ancestor of the trunk. Under a squash or PR merge it would be
 * false for work that had definitely landed, and this whole tool would be
 * wrong — docs/project/worktrees.md § The workflow.
 *
 * ## Its overlap with `worktree:check`, which is real and deliberate
 *
 * `scripts/worktree-check.ts` answers *is it safe to delete this directory?* for
 * **one** tree, from inside it, and it answers it better than this file does on
 * the axis that matters most: it reads **gitignored** state. `data/` and
 * `output/` are gitignored, so a pipeline run that cost money is invisible to
 * the `git status` below, however many flags it is given.
 *
 * **So this file is not the authority on whether a tree holds work, and must not
 * become it.** The per-tree judgement belongs in `blockers()` over there; what
 * belongs here is the part that file deliberately refuses — enumerating every
 * tree, the age floor, ghosts, and the removal itself. The two should meet:
 * `classifyOne` should take that verdict rather than re-deriving a weaker one.
 * It does not yet only because `worktree-check.ts` was still uncommitted in the
 * shared tree when this landed, and importing an untracked file would have
 * broken every other checkout. Wire it up when it lands; until then, treat a
 * `removable` here as "git can see nothing", not as "nothing is here", and run
 * `npm run worktree:check` inside the tree before believing it.
 *
 * ## Where the independent check is
 *
 * Our own guards decide *merged* and *recent*. We do not let them decide
 * *unsaved work*: removal unlocks the worktree and then runs a plain
 * `git worktree remove`, with no `--force`, so **git refuses a dirty tree on its
 * own terms** rather than agreeing with a check that shares our assumptions —
 * docs/reusable/silent-success.md.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

import { TRUNK_BRANCH } from "./deploy-checks.js";
import { forceRemoveThrowawayWorktree, listWorktrees, type WorktreeEntry } from "./worktree-admin.js";

/** A worktree is never removable while it has been touched this recently. */
export const MIN_IDLE_HOURS = 24;

/** Everything the classifier is allowed to look at, gathered by `gather()`. */
export interface SweepFacts {
  entry: WorktreeEntry;
  /** `entry.branch` without its `refs/heads/` prefix, which is how git's
      porcelain spells it and is not what anyone types on a command line. */
  branch: string | undefined;
  /** Uncommitted paths, untracked included. `null` when git could not be asked. */
  dirty: string[] | null;
  /** Is the branch an ancestor of the trunk? `null` when it could not be decided. */
  merged: boolean | null;
  /** Unix seconds of the later of: HEAD's commit, the branch's reflog top. */
  lastActivity: number | null;
  /** Are we standing in it? */
  current: boolean;
}

export type Verdict =
  /** The primary checkout, or a bare entry. Not a candidate, ever. */
  | { kind: "skip"; why: string }
  /** A registration with no working tree. Removable, and it owns no work. */
  | { kind: "ghost" }
  /** Every guard passed. */
  | { kind: "removable" }
  /** Keep it, and here is each reason. */
  | { kind: "keep"; reasons: string[] };

export interface ClassifyOptions {
  /** Unix seconds. Injected so the age guard is testable. */
  now: number;
  /** Did the fetch of the trunk succeed? When false, nothing with work is removable. */
  trunkFetched: boolean;
  minIdleHours?: number;
}

/**
 * One worktree's verdict, from facts alone.
 *
 * Order matters. `skip` and `ghost` come before the trunk guard because neither
 * depends on the trunk: the primary is never a candidate, and a registration
 * whose directory is gone holds nothing that could be lost. Everything after
 * that is a reason to keep, and they accumulate rather than short-circuit — an
 * agent reading the output wants all of them, not the first one.
 */
export function classifyOne(f: SweepFacts, opts: ClassifyOptions): Verdict {
  const minIdle = opts.minIdleHours ?? MIN_IDLE_HOURS;

  if (f.entry.main) return { kind: "skip", why: "the primary checkout" };
  if (f.entry.bare) return { kind: "skip", why: "a bare entry, which has no working tree" };
  if (!f.entry.present || f.entry.prunable) return { kind: "ghost" };

  const reasons: string[] = [];

  if (!opts.trunkFetched) {
    reasons.push(`could not read origin/${TRUNK_BRANCH} — refusing rather than assuming it agrees`);
  }
  if (f.current) reasons.push("you are standing in it");
  if (f.branch === undefined) {
    reasons.push("detached HEAD — there is no branch to compare with the trunk");
  }
  if (f.dirty === null) reasons.push("could not read its working tree");
  else if (f.dirty.length > 0) {
    reasons.push(`${f.dirty.length} uncommitted change${f.dirty.length === 1 ? "" : "s"}, untracked included`);
  }
  if (f.merged === null) reasons.push(`could not tell whether it is merged into origin/${TRUNK_BRANCH}`);
  else if (!f.merged) reasons.push(`not merged into origin/${TRUNK_BRANCH} — its work has not landed`);

  if (f.lastActivity === null) reasons.push("could not tell when it was last active");
  else {
    const idleHours = (opts.now - f.lastActivity) / 3600;
    if (idleHours < minIdle) {
      reasons.push(`active ${describeIdle(idleHours)} ago — under the ${minIdle}h floor`);
    }
  }

  return reasons.length === 0 ? { kind: "removable" } : { kind: "keep", reasons };
}

function describeIdle(hours: number): string {
  if (hours < 0) return "in the future";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  return `${hours.toFixed(1)} h`;
}

/* ------------------------------------------------------------------ */
/* Gathering                                                           */
/* ------------------------------------------------------------------ */

function tryGit(args: string[], cwd?: string): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? `${r.stdout ?? ""}`.trim() : null;
}

/** Fetch the trunk. Returns false rather than throwing, so the caller fails closed. */
export function fetchTrunk(cwd: string): boolean {
  return spawnSync("git", ["fetch", "origin", TRUNK_BRANCH, "--quiet"], { cwd, encoding: "utf8" }).status === 0;
}

/** The worktree the process is standing in, resolved the way git reports paths. */
function currentToplevel(cwd: string): string | null {
  const top = tryGit(["rev-parse", "--show-toplevel"], cwd);
  return top === null ? null : path.resolve(top);
}

/** `refs/heads/worktree-x` → `worktree-x`; anything else is passed through. */
export function shortBranch(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

/**
 * Is `branch` contained in the trunk?
 *
 * Exit 0 is ancestor and 1 is not; **anything else is a failure to answer** and
 * becomes `null`. Collapsing that into `false` would be safe here but dishonest
 * elsewhere, and collapsing it into `true` would delete work.
 */
function mergedIntoTrunk(wt: string, branch: string | undefined, trunkSha: string | null): boolean | null {
  if (trunkSha === null || branch === undefined) return null;
  const r = spawnSync("git", ["merge-base", "--is-ancestor", branch, trunkSha], { cwd: wt });
  return r.status === 0 ? true : r.status === 1 ? false : null;
}

/**
 * When this tree was last touched: the later of HEAD's commit date and the last
 * move of its branch ref.
 *
 * The reflog entry is the load-bearing half. A fast-forward merge writes no
 * commit, so HEAD's date is the date of whatever trunk commit it landed on —
 * which can be a week old in a worktree created a minute ago. The branch ref
 * moves on creation and on every merge, fast-forward included.
 */
function lastActivityAt(wt: string, branch: string | undefined): number | null {
  const times: number[] = [];
  for (const args of [
    ["log", "-1", "--format=%ct"],
    ...(branch === undefined ? [] : [["log", "-g", "-1", "--format=%ct", branch]]),
  ]) {
    const out = tryGit(args, wt);
    const n = out === null ? Number.NaN : Number.parseInt(out, 10);
    if (Number.isFinite(n)) times.push(n);
  }
  return times.length === 0 ? null : Math.max(...times);
}

export function gather(cwd: string, entries: readonly WorktreeEntry[]): SweepFacts[] {
  const here = currentToplevel(cwd);
  const trunkSha = tryGit(["rev-parse", `origin/${TRUNK_BRANCH}`], cwd);

  return entries.map((entry) => {
    const branch = shortBranch(entry.branch);
    const current = here !== null && path.resolve(entry.path) === here;
    if (entry.main || entry.bare || !entry.present) {
      return { entry, branch, dirty: null, merged: null, lastActivity: null, current };
    }

    const status = tryGit(["status", "--porcelain", "--untracked-files=all"], entry.path);
    return {
      entry,
      branch,
      dirty: status === null ? null : status === "" ? [] : status.split("\n"),
      merged: mergedIntoTrunk(entry.path, branch, trunkSha),
      lastActivity: lastActivityAt(entry.path, branch),
      current,
    };
  });
}

export interface Classified {
  facts: SweepFacts;
  verdict: Verdict;
}

export function classifyAll(cwd: string, opts?: { now?: number; minIdleHours?: number }): Classified[] {
  const trunkFetched = fetchTrunk(cwd);
  const facts = gather(cwd, listWorktrees(cwd));
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  return facts.map((f) => ({
    facts: f,
    verdict: classifyOne(f, { now, trunkFetched, ...(opts?.minIdleHours === undefined ? {} : { minIdleHours: opts.minIdleHours }) }),
  }));
}

/* ------------------------------------------------------------------ */
/* Removal                                                             */
/* ------------------------------------------------------------------ */

export interface RemoveOutcome {
  ok: boolean;
  steps: string[];
}

/**
 * Remove **one** worktree whose branch has landed, re-earning every guard first.
 *
 * No bulk form and no path form: a branch name, one at a time. The
 * classification is re-run here rather than passed in, so a verdict cannot be
 * carried from an earlier decision into a later deletion.
 *
 * A ghost's branch is left alone. The directory is gone, so the registration is
 * litter — but the branch may still hold unlanded commits, and this is not the
 * command that gets to decide that.
 */
export function removeOne(cwd: string, branch: string, opts?: { dryRun?: boolean; now?: number }): RemoveOutcome {
  const steps: string[] = [];
  const rows = classifyAll(cwd, opts?.now === undefined ? {} : { now: opts.now });
  const row = rows.find((r) => r.facts.branch === branch);

  if (row === undefined) {
    steps.push(`no worktree is on branch ${branch}`);
    return { ok: false, steps };
  }
  if (row.verdict.kind === "skip") {
    steps.push(`refused: ${row.verdict.why}`);
    return { ok: false, steps };
  }
  if (row.verdict.kind === "keep") {
    steps.push("refused, re-checked just now:");
    for (const r of row.verdict.reasons) steps.push(`  ${r}`);
    return { ok: false, steps };
  }

  const wt = row.facts.entry.path;
  const ghost = row.verdict.kind === "ghost";

  if (opts?.dryRun === true) {
    steps.push(ghost ? `would unregister the ghost at ${wt}` : `would remove ${wt} and delete ${branch}`);
    return { ok: true, steps };
  }

  if (ghost) {
    const r = forceRemoveThrowawayWorktree(wt, cwd);
    steps.push(r.ok ? `unregistered the ghost at ${wt}` : `FAILED to unregister ${wt}: ${r.out}`);
    steps.push(`left branch ${branch} alone — the tree is gone, but its commits are not this command's to judge`);
    return { ok: r.ok, steps };
  }

  /* `claude --worktree` locks what it creates, and a locked worktree refuses a
     plain remove. Unlock rather than reaching for the second --force, so the
     removal below is still git's own judgement of whether the tree is clean. */
  if (row.facts.entry.locked) {
    const un = spawnSync("git", ["worktree", "unlock", wt], { cwd, encoding: "utf8" });
    steps.push(un.status === 0 ? `unlocked ${wt}` : `could not unlock ${wt} — continuing, remove will say if it matters`);
  }

  /* No --force. If git disagrees with our clean check, git wins. */
  const rm = spawnSync("git", ["worktree", "remove", wt], { cwd, encoding: "utf8" });
  if (rm.status !== 0) {
    steps.push(`refused by git: ${`${rm.stdout ?? ""}${rm.stderr ?? ""}`.trim()}`);
    return { ok: false, steps };
  }
  steps.push(`removed ${wt}`);

  /* -D not -d: the branch has no upstream here, so -d asks the wrong question
     and refuses work that has plainly landed. The right question was asked
     above, against a freshly fetched trunk. */
  const del = spawnSync("git", ["branch", "-D", branch], { cwd, encoding: "utf8" });
  steps.push(del.status === 0 ? `deleted branch ${branch}` : `left branch ${branch}: ${`${del.stderr ?? ""}`.trim()}`);
  return { ok: true, steps };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

export function renderClassification(rows: readonly Classified[]): string {
  const lines: string[] = [];
  for (const { facts, verdict } of rows) {
    const name = facts.branch ?? `${facts.entry.head?.slice(0, 8) ?? "?"} (detached)`;
    switch (verdict.kind) {
      case "skip":
        lines.push(`  ·         ${name} — ${verdict.why}`);
        break;
      case "ghost":
        lines.push(`  ghost     ${name} — registered at ${facts.entry.path}, which is not there`);
        break;
      case "removable":
        lines.push(`  REMOVABLE ${name}`);
        break;
      case "keep":
        lines.push(`  keep      ${name}`);
        for (const r of verdict.reasons) lines.push(`              ${r}`);
        break;
    }
  }
  return lines.join("\n");
}

function isMain(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry).endsWith(path.join("scripts", "worktree-sweep.ts"));
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const cwd = process.cwd();

  if (argv[0] === "remove") {
    const at = argv.indexOf("--branch");
    const branch = at === -1 ? undefined : argv[at + 1];
    if (branch === undefined || branch.startsWith("--")) {
      console.log("\nusage: npm run worktree:sweep -- remove --branch <name> [--dry-run]");
      console.log("one branch at a time, on purpose — there is no bulk form.\n");
      process.exit(1);
    }
    const out = removeOne(cwd, branch, { dryRun: argv.includes("--dry-run") });
    console.log("");
    for (const s of out.steps) console.log(`  ${s}`);
    console.log("");
    process.exit(out.ok ? 0 : 1);
  }

  const rows = classifyAll(cwd);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    console.log(`\nworktree:sweep — measured against a freshly fetched origin/${TRUNK_BRANCH}\n`);
    console.log(renderClassification(rows));
    const removable = rows.filter((r) => r.verdict.kind === "removable" || r.verdict.kind === "ghost");
    console.log("");
    if (removable.length === 0) console.log("  nothing to remove.\n");
    else {
      console.log(`  remove one at a time, each re-checked as it goes:`);
      for (const r of removable) {
        console.log(`    npm run worktree:sweep -- remove --branch ${r.facts.branch ?? "<no branch>"}`);
      }
      console.log("");
    }
  }
}
