/**
 * `npm run worktree:sweep` — **which** worktrees have landed their work.
 *
 * ```
 * npm run worktree:sweep                              # classify. Reads. Deletes nothing.
 * npm run worktree:sweep -- --remove [--dry-run]      # remove every removable tree, each re-checked
 * npm run worktree:remove -- --branch <name>          # and this removes one
 * ```
 *
 * **`--remove` since 2026-10-09**, on Greg's word: *"if you're sure that the
 * worktrees have been successfully finished and merged into dev, then you have
 * my permission now and going forwards to remove them, and we should update the
 * script to do that automatically."* It is a loop over the single-target
 * removal, not a second removal — `removeAll` says why that keeps the rule
 * below's point.
 *
 * **The removal is `scripts/worktree-remove.ts` since 2026-09-09**, and
 * `removeOne` below is a thin forward to it. There were two implementations, and
 * each had guards the other lacked — the shape whose disagreements are invisible
 * by construction, which is the same argument this header already makes for why
 * this file keeps no `dirty` or `merged` check of its own.
 *
 * ## The shape is borrowed, and so is the reason for the awkward bit
 *
 * From the worktree tooling in Greg's MindstoneRebel repo, which runs 5-7 agents
 * the way we run a dozen. Two of its choices are load-bearing and would look
 * like over-engineering without the story:
 *
 * **`remove` takes one branch**, and re-runs the whole classification —
 * including a fresh fetch — before each deletion. So an agent that classified
 * ten minutes ago cannot cascade ten removals off one stale answer; each one
 * re-earns its verdict. `--remove` keeps that by calling it once per tree.
 *
 * **A tree somebody is still in is never removable**, however merged it looks.
 * Their version without such a guard was retired for removing live worktrees: a
 * brand-new one whose tip equals the trunk passes the merged check trivially.
 * **That is the normal state of a fresh worktree here** — `worktree:setup` merges
 * `origin/dev`, so five minutes after creation a worktree is clean, contains the
 * trunk, and has landed nothing. See scripts/worktree-freshen.ts for the merge.
 *
 * Until 2026-09-12 the guard was a 24-hour age floor, a proxy for "somebody is
 * using this". It is now the thing itself: `liveness()` from worktree-remove.ts,
 * which refuses when the session named in the lock is alive or a process has its
 * cwd inside, and when an individual read fails. A private PID namespace can
 * instead return a plausible partial answer; worktree-inuse.ts names that
 * current limit. Greg: *"If they are finished successfully and safe to remove,
 * it's fine to do so immediately."* The plan is
 * docs/plans/260912a-drop-the-worktree-removal-age-floor.md.
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
 * holding: enumerating every worktree, ghosts, "you are standing in it", and
 * whether anybody else is in it. `worktree:check` saying "not safe" inside a
 * landed tree because a shell is in it would be false for the person standing
 * there — the shell is theirs.
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
 * ## `REMOVABLE` means the removal command would accept it
 *
 * So the report asks the same liveness question the removal asks, rather than
 * leaving it to the removal to refuse. Without it, a peer's five-minute-old tree
 * would print as `REMOVABLE` with a paste-ready command beside it, and a report
 * whose headline word the removal disagrees with is one an operator learns to
 * read past.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

import { TRUNK_BRANCH } from "./deploy-checks.js";
import { listWorktrees, type WorktreeEntry } from "./worktree-admin.js";
/* `gather` is aliased: this file has one of its own, and two functions of the
   same name at one seam is how the wrong one gets called. */
import { blockers, type CheckFacts, fetchTrunkSha, gather as checkGather, type TrunkSha } from "./worktree-check.js";
import type { InUse } from "./worktree-inuse.js";
/* The liveness question and the removal itself live in worktree-remove.ts. This
   file classifies; that one removes. `RemoveOutcome` is re-exported so the
   sweep's own tests and callers keep their import site. */
import { classifyRegistration, inBulk, liveness, removeWorktree, type RemoveOutcome } from "./worktree-remove.js";
import { GIT_LOCATION_ENV } from "../tools/fleet/readiness-git.js";

export type { RemoveOutcome };

/** Everything the classifier is allowed to look at, gathered by `gatherAll()`. */
export interface SweepFacts {
  entry: WorktreeEntry;
  /** `entry.branch` without its `refs/heads/` prefix, which is how git's
      porcelain spells it and is not what anyone types on a command line. */
  branch: string | undefined;
  /**
   * Is anybody else in it — the session named in its lock, or a process with its
   * cwd inside? The same question `worktree:remove` asks, so the report and the
   * removal cannot disagree about a live tree. `null` for a tree that was not
   * judged at all (the primary, a ghost, a failed fetch).
   */
  inUse: InUse | null;
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
  /** Keep it, and here is each reason. */
  | { kind: "keep"; reasons: string[] }
  /**
   * Could not be judged at all. Never removable, and never dropped from the
   * report — a tree that silently vanishes from the list is the failure mode
   * where success is the absence of something.
   */
  | { kind: "unjudgeable"; why: string };

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
export function classifyOne(f: SweepFacts): Verdict {
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

  /* The removal's own liveness question, so `REMOVABLE` cannot advertise a tree
     the removal would refuse. An unknown keeps it, as it refuses there. */
  if (f.inUse === null) reasons.push("could not tell whether anybody is in it");
  else if (f.inUse.kind === "in-use") reasons.push(...f.inUse.reasons);
  else if (f.inUse.kind === "unknown") {
    for (const w of f.inUse.why) reasons.push(`could not tell whether anybody is in it — ${w}`);
  }

  if (reasons.length > 0) return { kind: "keep", reasons };
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
 * `checkFor` and `inUseFor` are injected so the awkward cases — a tree whose
 * gather throws, a process that hides its cwd — can be arranged in a test
 * without corrupting a real repository or racing real processes.
 */
export function gatherAll(
  cwd: string,
  entries: readonly WorktreeEntry[],
  trunk: TrunkSha,
  checkFor: (root: string, trunkSha: string) => CheckFacts = checkGather,
  /* `inBulk`: a tree whose lock names the session running the sweep is kept —
     it may be a subagent of that session still at work. */
  inUseFor: (entry: WorktreeEntry) => InUse = (e) => inBulk(liveness(e.path, e.lockReason)).inUse,
): SweepFacts[] {
  const here = currentToplevel(cwd);

  return entries.map((entry) => {
    const branch = shortBranch(entry.branch);
    const current = here !== null && path.resolve(entry.path) === here;
    const base = { entry, branch, current };

    if (entry.main || entry.bare || !entry.present) {
      return { ...base, inUse: null, check: { error: "not a live worktree" } };
    }
    if (trunk.kind === "failed") {
      return { ...base, inUse: null, check: { error: trunk.why } };
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
    return { ...base, inUse: inUseFor(entry), check };
  });
}

export interface Classified {
  facts: SweepFacts;
  verdict: Verdict;
}

export function classifyAll(cwd: string): Classified[] {
  /* Once, for the whole sweep. See the header: `gather()` fetches for itself,
     which across thirty worktrees is one shared ref fetched thirty times. */
  const trunk = fetchTrunkSha(cwd);
  return gatherAll(cwd, listWorktrees(cwd), trunk).map((f) => ({ facts: f, verdict: classifyOne(f) }));
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
 */
export function removeOne(cwd: string, branch: string, opts?: { dryRun?: boolean; bulk?: boolean }): RemoveOutcome {
  return removeWorktree(cwd, branch, {
    ...(opts?.dryRun === undefined ? {} : { dryRun: opts.dryRun }),
    ...(opts?.bulk === undefined ? {} : { bulk: opts.bulk }),
  });
}

/* ------------------------------------------------------------------ */
/* Removing every removable tree                                       */
/* ------------------------------------------------------------------ */

/**
 * What `--remove` did with one tree. Four groups, because they ask four
 * different things of whoever reads the report:
 *
 * - `removed` — nothing to do.
 * - `refused` — the classification said removable and the removal, re-checking
 *   for itself, disagreed. Something changed in between; its steps say what.
 * - `in-use` — a live session or process. **Never killed by this script.** Greg's
 *   permission to kill a finished session's processes (2026-10-09) is for an
 *   agent's judgement, read from the reasons printed here.
 * - `needs-a-look` — every other keep: unlanded work, untracked or gitignored
 *   files, `.env.local — DIFFERS`, a tree it could not judge, one with no branch
 *   to name.
 */
export type SweepOutcome =
  | { kind: "removed"; name: string; steps: string[] }
  | { kind: "refused"; name: string; steps: string[] }
  | { kind: "in-use"; name: string; reasons: string[] }
  | { kind: "needs-a-look"; name: string; reasons: string[] };

function nameOf(facts: SweepFacts): string {
  return facts.branch ?? `${facts.entry.path} (detached)`;
}

/**
 * `npm run worktree:sweep -- --remove`: remove every tree the classification
 * calls removable, and every ghost, **one at a time through `removeOne`** —
 * Greg, 2026-10-09: *"we should update the script to do that automatically"*.
 *
 * **The classification only picks the candidates; it decides nothing.** Each
 * removal re-fetches the trunk, re-runs `worktree:check`, re-proves the landed
 * commits and re-reads liveness, twice, exactly as a removal by name does. That
 * is the property the old "no bulk form" rule (until 2026-10-09) protected — a verdict carried from
 * an earlier decision into a later deletion — and a loop over the single-target
 * removal keeps it. What the loop adds is `bulk: true` (`inBulk`), so the session
 * running it never removes a tree its own lock names.
 *
 * **A tree with no branch is never removed here.** `removeWorktree` takes a
 * branch, and with none it means "the tree I am standing in" — so `undefined`
 * from a detached tree would aim the removal at the caller's own tree (GPT Sol,
 * 261009t F4). Such a tree is reported under `needs-a-look`.
 */
export function removeAll(
  cwd: string,
  rows: readonly Classified[],
  opts: { dryRun?: boolean } = {},
  remove: (cwd: string, branch: string, opts: { dryRun?: boolean; bulk?: boolean }) => RemoveOutcome = removeOne,
): SweepOutcome[] {
  const out: SweepOutcome[] = [];
  for (const { facts, verdict } of rows) {
    const name = nameOf(facts);
    switch (verdict.kind) {
      case "skip":
        break;
      case "keep": {
        const live = facts.inUse?.kind === "in-use";
        out.push({ kind: live ? "in-use" : "needs-a-look", name, reasons: verdict.reasons });
        break;
      }
      case "unjudgeable":
        out.push({ kind: "needs-a-look", name, reasons: [`could not be judged: ${verdict.why}`] });
        break;
      case "removable":
      case "ghost": {
        if (facts.branch === undefined) {
          out.push({
            kind: "needs-a-look",
            name,
            reasons: ["no branch to name, so the bulk run will not remove it — from inside it, `npm run worktree:remove`"],
          });
          break;
        }
        const r = remove(cwd, facts.branch, { ...(opts.dryRun === undefined ? {} : { dryRun: opts.dryRun }), bulk: true });
        out.push({ kind: r.ok ? "removed" : "refused", name, steps: r.steps });
        break;
      }
      default: {
        const unreachable: never = verdict;
        throw new Error(`unhandled verdict ${JSON.stringify(unreachable)}`);
      }
    }
  }
  return out;
}

export function renderRemoval(outcomes: readonly SweepOutcome[], dryRun: boolean): string {
  const lines: string[] = [];
  const group = (kind: SweepOutcome["kind"], title: string): void => {
    const these = outcomes.filter((o) => o.kind === kind);
    if (these.length === 0) return;
    lines.push(`  ${title} (${these.length})`);
    for (const o of these) {
      lines.push(`    ${o.name}`);
      const detail = "steps" in o ? (o.kind === "removed" ? [] : o.steps) : o.reasons;
      for (const d of detail) lines.push(`        ${d}`);
    }
    lines.push("");
  };
  group("removed", dryRun ? "would remove (dry run — each re-checked, nothing touched)" : "removed");
  group("refused", "refused by the removal itself, re-checking — something changed since the classification");
  group("in-use", "in use — left alone; nothing here kills a process");
  group("needs-a-look", "needs a look — kept");
  if (lines.length === 0) lines.push("  nothing to do.", "");
  return lines.join("\n");
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
  /* As in worktree-remove.ts: an inherited GIT_DIR/GIT_WORK_TREE makes git answer
     about a different tree from the one asked about. */
  for (const name of GIT_LOCATION_ENV) delete process.env[name];
  const argv = process.argv.slice(2);
  const cwd = process.cwd();

  if (argv.includes("--remove")) {
    const dryRun = argv.includes("--dry-run");
    const rows = classifyAll(cwd);
    console.log(`\nworktree:sweep --remove${dryRun ? " --dry-run" : ""} — every removable tree, one at a time, each re-checked\n`);
    const outcomes = removeAll(cwd, rows, { dryRun });
    console.log(renderRemoval(outcomes, dryRun));
    process.exit(outcomes.some((o) => o.kind === "refused") ? 1 : 0);
  }

  if (argv[0] === "remove") {
    const at = argv.indexOf("--branch");
    const branch = at === -1 ? undefined : argv[at + 1];
    if (branch === undefined || branch.startsWith("--")) {
      console.log("\nusage: npm run worktree:sweep -- remove --branch <name> [--dry-run]");
      console.log("for every removable tree at once: npm run worktree:sweep -- --remove [--dry-run]\n");
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
      console.log(`  remove them all, each re-checked as it goes:`);
      console.log(`    npm run worktree:sweep -- --remove        (add --dry-run to see first)`);
      console.log(`  or one:`);
      for (const r of removable) {
        console.log(`    npm run worktree:remove -- --branch ${r.facts.branch ?? "<no branch>"}`);
      }
      console.log("");
    }
  }
}
