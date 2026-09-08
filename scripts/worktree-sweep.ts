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
 * ## It does not decide whether a tree holds work — `worktree:check` does
 *
 * [`scripts/worktree-check.ts`](./worktree-check.ts) answers *is it safe to
 * delete this directory?* for one tree, and it answers it far better than a
 * `git status` here could: it reads **gitignored** state. `data/` and `output/`
 * are gitignored, so a pipeline run that cost money is invisible to any number
 * of `git status` flags. It also catches a half-finished merge, tracked edits
 * hidden by `assume-unchanged`, and an `.env.local` that differs from the
 * primary's.
 *
 * So this file calls `blockers(gather(path))` and **has no dirty or merged
 * check of its own**. The earlier version kept cheap ones as a fast pre-filter;
 * that was deleted rather than kept, because a cheaper duplicate of a safety
 * judgement is one whose disagreements with the real judgement are invisible by
 * construction — the shape in docs/reusable/silent-success.md. Once the fetch is
 * hoisted (below) it saved nothing anyway.
 *
 * What stays here is what that file's one-tree contract has no business
 * holding: enumerating every worktree, ghosts, "you are standing in it", the age
 * floor, and the removal itself. `worktree:check` saying "not safe" inside a
 * three-hour-old landed tree would be false for the person standing in it.
 *
 * ## One fetch, not one per tree
 *
 * `gather()` fetches the trunk for itself, which is right for one tree and
 * quadratic-feeling across thirty: one shared ref, fetched thirty times,
 * serially, over the network. So the sweep calls `fetchTrunkSha` **once** and
 * passes the sha down. A sha and not a ref name — a ref can be moved under us by
 * any peer in any worktree between the fetch and the test, which is the hazard
 * `FETCH_HEAD` was chosen to dodge; a sha cannot move. A failed central fetch
 * becomes `trunk: unknown` for every tree, which `blockers()` already treats as
 * unsafe, so failing closed survives the optimisation.
 *
 * ## Where the independent check is
 *
 * Removal unlocks the worktree and then runs a plain `git worktree remove`, with
 * no `--force`, so **git refuses a dirty tree on its own terms** rather than
 * agreeing with a check that shares our assumptions.
 *
 * Its limit, because an overstated backstop is worse than none: git refuses on
 * modified and untracked files, **not on ignored ones**. For the case that costs
 * the most — a pipeline run in a gitignored `data/` — `blockers()` is the only
 * guard, and this second pair of eyes is blind.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

import { TRUNK_BRANCH } from "./deploy-checks.js";
import { listWorktrees, type WorktreeEntry } from "./worktree-admin.js";
/* `gather` is aliased: this file has one of its own, and two functions of the
   same name at one seam is how the wrong one gets called. */
import { blockers, type CheckFacts, fetchTrunkSha, gather as checkGather, type TrunkSha } from "./worktree-check.js";
/* The age floor, the activity signals and the removal itself all live in
   worktree-remove.ts now. This file classifies; that one removes. Re-exported so
   the sweep's own tests and callers keep their import site. */
import {
  type Activity,
  classifyRegistration,
  describeIdle,
  lastActivityAt,
  MIN_IDLE_HOURS,
  removeWorktree,
  type RemoveOutcome,
} from "./worktree-remove.js";

export { type Activity, MIN_IDLE_HOURS, type RemoveOutcome };

/** Everything the classifier is allowed to look at, gathered by `gatherAll()`. */
export interface SweepFacts {
  entry: WorktreeEntry;
  /** `entry.branch` without its `refs/heads/` prefix, which is how git's
      porcelain spells it and is not what anyone types on a command line. */
  branch: string | undefined;
  /** The latest of the activity signals, and which one it was. `null` = none read. */
  lastActivity: Activity | null;
  /** Are we standing in it? */
  current: boolean;
  /**
   * `worktree:check`'s facts for this tree, or why they could not be got.
   *
   * There is deliberately no `dirty` or `merged` beside this. Keeping cheap
   * copies of those was the first design, and the type is what now makes it
   * impossible to consult one by accident.
   */
  check: CheckFacts | { error: string };
}

export type Verdict =
  /** The primary checkout, or a bare entry. Not a candidate, ever. */
  | { kind: "skip"; why: string }
  /** A registration with no working tree. Removable, and it owns no work. */
  | { kind: "ghost" }
  /** Every guard passed. */
  | { kind: "removable" }
  /**
   * Nothing is wrong with it, and it is under the age floor. Its own session may
   * remove it now with `npm run worktree:remove`; nobody else may.
   */
  | { kind: "young"; why: string }
  /** Keep it, and here is each reason. */
  | { kind: "keep"; reasons: string[] }
  /**
   * Could not be judged at all. Never removable, and never dropped from the
   * report — a tree that silently vanishes from the list is the failure mode
   * where success is the absence of something.
   */
  | { kind: "unjudgeable"; why: string };

export interface ClassifyOptions {
  /** Unix seconds. Injected so the age guard is testable. */
  now: number;
  minIdleHours?: number;
}

/**
 * One worktree's verdict, from facts alone.
 *
 * Order matters. `skip` and `ghost` come first because neither depends on
 * anything having been read successfully: the primary is never a candidate, and
 * a registration whose directory is gone holds nothing that could be lost.
 *
 * Everything after that is a reason to keep, and they accumulate rather than
 * short-circuit — an agent reading the output wants all of them, not the first.
 */
export function classifyOne(f: SweepFacts, opts: ClassifyOptions): Verdict {
  const minIdle = opts.minIdleHours ?? MIN_IDLE_HOURS;
  let young: string | null = null;

  /* `classifyRegistration` rather than a test here, so this file and the removal
     agree on what a ghost is. It is an ABSENT directory: a *present* one that is
     prunable has a broken admin link over what may be a full tree, and a ghost is
     unregistered with `--force --force`. */
  const reg = classifyRegistration(f.entry);
  if (reg.kind === "skip") return { kind: "skip", why: reg.why };
  if (reg.kind === "ghost") return { kind: "ghost" };
  if (reg.kind === "unknown") return { kind: "unjudgeable", why: `${reg.why}\n              ${reg.fix}` };
  if ("error" in f.check) return { kind: "unjudgeable", why: f.check.error };

  /* The whole "does this hold work" judgement, in one call, made by the file
     that reads gitignored state. See the header. */
  const reasons = blockers(f.check).map((b) => b.why);

  if (f.current) reasons.push("you are standing in it");

  if (f.lastActivity === null) reasons.push("could not tell when it was last active");
  else {
    const idleHours = (opts.now - f.lastActivity.at) / 3600;
    if (idleHours < minIdle) {
      /* Naming the signal, not just the verdict. "active 1 min ago" was read on
         eighteen worktrees without suspicion while it meant "we just ran git in
         here"; "git was last run here 1 min ago" beside a five-day-old HEAD is
         read as wrong by the first person to see it. */
      young = `${f.lastActivity.signal} ${describeIdle(idleHours)} ago — under the ${minIdle}h floor`;
    }
  }

  if (reasons.length > 0) {
    /* The floor joins the other reasons only when something else already keeps
       it, so a plain `keep` never means "young" on its own. */
    if (young !== null) reasons.push(young);
    return { kind: "keep", reasons };
  }
  /* Clean, landed, nobody standing in it — and too young for this report to
     advertise. `REMOVABLE` would then mean "old enough to advertise" rather than
     "the removal primitive would accept it", and printing both as one word is how
     an operator comes to read past the difference. Its own session may remove it
     now; nobody else may, and no paste-ready command is offered for it. */
  if (young !== null) return { kind: "young", why: young };
  return { kind: "removable" };
}

/* ------------------------------------------------------------------ */
/* Gathering                                                           */
/* ------------------------------------------------------------------ */

function tryGit(args: string[], cwd?: string): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? `${r.stdout ?? ""}`.trim() : null;
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
 * Facts for every registered worktree, against one trunk sha fetched once.
 *
 * `checkFor` is injected so the awkward cases — a tree whose gather throws —
 * can be arranged in a test without corrupting a real repository.
 */
export function gatherAll(
  cwd: string,
  entries: readonly WorktreeEntry[],
  trunk: TrunkSha,
  checkFor: (root: string, trunkSha: string) => CheckFacts = checkGather,
): SweepFacts[] {
  const here = currentToplevel(cwd);

  return entries.map((entry) => {
    const branch = shortBranch(entry.branch);
    const current = here !== null && path.resolve(entry.path) === here;
    const base = { entry, branch, current };

    if (entry.main || entry.bare || !entry.present) {
      return { ...base, lastActivity: null, check: { error: "not a live worktree" } };
    }
    if (trunk.kind === "failed") {
      return { ...base, lastActivity: lastActivityAt(entry.path, branch), check: { error: trunk.why } };
    }

    /* One tree's failure must not cost the operator the other twenty-nine
       answers, and `gather` can throw for real: its directory walk meets
       EACCES, or a peer deletes a directory underneath it mid-walk. */
    let check: CheckFacts | { error: string };
    try {
      check = checkFor(entry.path, trunk.sha);
    } catch (err) {
      check = { error: `worktree:check could not judge this tree: ${(err as Error).message}` };
    }
    return { ...base, lastActivity: lastActivityAt(entry.path, branch), check };
  });
}

export interface Classified {
  facts: SweepFacts;
  verdict: Verdict;
}

export function classifyAll(cwd: string, opts?: { now?: number; minIdleHours?: number }): Classified[] {
  /* Once, for the whole sweep. See the header: `gather()` fetches for itself,
     which across thirty worktrees is one shared ref fetched thirty times. */
  const trunk = fetchTrunkSha(cwd);
  const facts = gatherAll(cwd, listWorktrees(cwd), trunk);
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  return facts.map((f) => ({
    facts: f,
    verdict: classifyOne(f, { now, ...(opts?.minIdleHours === undefined ? {} : { minIdleHours: opts.minIdleHours }) }),
  }));
}

/* ------------------------------------------------------------------ */
/* Removal                                                             */
/* ------------------------------------------------------------------ */

/**
 * Removal is `scripts/worktree-remove.ts`, and this is a thin forward to it.
 *
 * There was a second implementation here until 2026-09-09, and it had guards the
 * other one did not — and lacked guards the other one has. Two copies of a
 * safety judgement is the shape whose disagreements are invisible by
 * construction, which is the same argument the header already makes for why this
 * file has no `dirty` or `merged` check of its own.
 *
 * **The 24h age floor stays here, in `classifyOne`**, because its job is deciding
 * what this file's *report* advertises — it must never hand an agent a
 * paste-ready command that would delete a peer's five-minute-old tree. It was
 * never the right guard on a deliberate, singular, explicitly-named removal, and
 * `worktree:remove` applies it there only to a third party.
 */
export function removeOne(cwd: string, branch: string, opts?: { dryRun?: boolean; now?: number }): RemoveOutcome {
  return removeWorktree(cwd, branch, {
    ...(opts?.dryRun === undefined ? {} : { dryRun: opts.dryRun }),
    ...(opts?.now === undefined ? {} : { now: opts.now }),
  });
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
      /* Deliberately not `keep` and deliberately not `REMOVABLE`: nothing is
         wrong with it, and it is not this report's to hand to a third party. */
      case "young":
        lines.push(`  young     ${name} — safe, but its own session may remove it; nobody else yet`);
        lines.push(`              ${verdict.why}`);
        break;
      case "keep":
        lines.push(`  keep      ${name}`);
        for (const r of verdict.reasons) lines.push(`              ${r}`);
        break;
      /* Louder than a keep on purpose: an ordinary keep is the tool working,
         and this is the tool admitting it does not know. */
      case "unjudgeable":
        lines.push(`  UNKNOWN   ${name} — kept, because this could not be judged`);
        lines.push(`              ${verdict.why}`);
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
