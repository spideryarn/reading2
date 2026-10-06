# Plan review: `worktree:check` takes a root, and the readiness runner follows the `/var/tmp` root

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

- The plan: `docs/plans/261005n-worktree-check-takes-a-root-and-the-readiness-runner-follows-the-var-tmp-root.md`
  in this worktree. Nothing else has changed from `origin/dev`.
- It answers a queue item, verbatim: "worktree:check can't run in a /var/tmp tree that was never set
  up; let it take a root so the primary's copy can check it. The dashboard's removal plan step 3
  runs npm run worktree:check inside the tree, which needs the tree's own node_modules; an
  unset-up /var/tmp tree is refused (safely). Workaround: npm run worktree:remove -- --branch
  <name> from the primary. Also low: scripts/readiness-loop.ts still makes its runner tree under
  .claude/worktrees on /home."

## What to read

Start with the plan. Then, as far as you need, and this does not limit scope:

- `scripts/worktree-check.ts` (the header, `gather`, `triageIgnored`, `corpusStrays`, `primaryRoot`,
  `main`), `scripts/worktree-port.ts` (`gitCommonDir`, `inLinkedWorktree`)
- `tools/fleet/actions.ts` § `planRemoveWorktree` and its doc comment; `tools/fleet/routes-actions.ts`
  where a plan's steps are run and judged
- `scripts/worktree-remove.ts` (how it calls `gather`, and its CLI), `scripts/worktree-sweep.ts`
- `scripts/readiness-loop.ts` § `ensureRunnerWorktree`, `runnerWorktreeProblem`;
  `scripts/worktree-roots.ts`; `.claude/hooks/worktree-create.sh`
- `docs/project/worktrees.md` § Where a worktree's bytes live;
  `docs/plans/261005l-worktree-tooling-learns-the-var-tmp-root.md`, which this follows

## What I want from you

An independent attack on the plan first. This is a safety check whose false "SAFE" deletes the only
copy of somebody's work, so in particular:

1. With `--root`, is there any input for which the check prints SAFE (exit 0) about a tree other
   than the one named, or about only part of it? Are the three conditions in the plan the right
   ones and are they enough? Think about symlinks, a bare repository, a submodule, the primary
   itself passed as `--root`, inherited `GIT_DIR`/`GIT_WORK_TREE`, and a path with a trailing slash.
2. The primary's copy of the script now judges a tree whose own copy may be older or newer. Is there
   anything `gather` reads relative to the script rather than relative to `root` that makes that
   wrong? (`worktree:sweep` and `worktree:remove` already do this — check whether they are right.)
3. Is anything else in the tree keyed on step 3's old argv (`npm run worktree:check`) — a receipt
   parser, a UI string, a test helper — that the plan does not name?
4. Stage 2: is "in-repo if it exists, else the external root if that exists, else in-repo" right for
   the readiness loop, including a box where both paths somehow exist, and a `readiness-checks`
   branch that is checked out at the old path while the new one is asked for? Does anything else
   compute the runner's path?
5. Is either stage more than it needs to be? Is the passed-over "delete step 3" in fact the better
   answer?

Then give a verdict: findings numbered F1…, each with severity (P0–P3), the file and line that
shows it, and what you would change in the plan. Say plainly if you found nothing. Do not invent a
quotation from anyone.
