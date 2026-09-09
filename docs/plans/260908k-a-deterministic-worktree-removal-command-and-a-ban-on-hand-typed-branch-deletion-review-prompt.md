# Review this plan before it is built

You are the cross-family reviewer for a TypeScript/Node repo (Spideryarn) where ~12 Claude agents
share one machine and one git checkout, each working in a `git worktree`. Read the plan at
`docs/plans/260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion.md`
in this repo and review it hard.

## Context you need

- Tonight an "Overseer" agent removed a finished worktree by hand-typing `git worktree unlock`,
  `git worktree remove`, `git branch -d <name>`. Its runbook forbids branch deletion outright.
- The sanctioned command, `npm run worktree:sweep -- remove --branch <name>`
  (`scripts/worktree-sweep.ts`), refuses EVERY worktree on the box because of a 24-hour "age floor".
  I measured this: nine trees, nine refusals, "nothing to remove."
- `scripts/worktree-check.ts` decides "is it safe to delete this directory" for one tree. The plan
  does NOT change what it decides — that is out of scope and must stay out.
- `.claude/hooks/protect-shared-tree.sh` is an existing, versioned, tested Claude Code `PreToolUse`
  Bash hook that bans one git verb by flat word match.

Read those four files plus `docs/project/worktrees.md` (§ Before you remove one, § ExitWorktree,
§ Sweeping them up) before judging.

## The claims I most want attacked

1. **Replacing the 24h age floor with a two-signal "is this tree in use" test** (a: the worktree lock
   reason carries `claude session <name> (pid N start T)`, and `/proc/N/stat` field 22 == T, so
   liveness is exact and pid-reuse-proof; b: a `/proc/*/cwd` walk, excluding the script's own process
   and its ancestors). Is this actually safe? What does it miss that 24 hours of idleness catches?
   Name a concrete sequence where a tree that is genuinely still wanted passes both signals and gets
   deleted, and say whether anything is LOST in that sequence or merely disrupted.
2. **Excluding "self and ancestors" from the cwd walk.** Is that the right way to let an agent remove
   the tree it is standing in? Can it be gamed or get the wrong answer (e.g. a process re-parented to
   init, a tmux server that is an ancestor of half the box, `npm run` inserting a shell)? The tmux
   question worries me: if the agent's shell is a tmux pane, is the *tmux server* an ancestor, and is
   it also the ancestor of every other agent's pane — which would silently exclude everyone?
3. **The branch deletion rule** — delete `worktree-<name>` only when `merge-base --is-ancestor` proves
   it landed against a freshly fetched trunk, using `-D`. I claim recovery/reflog windows are
   irrelevant because a merged commit is reachable from `origin/dev` for ever. Is that right? Is there
   a case where `--is-ancestor` is true but something on the branch is still lost?
4. **The hook.** Extending the existing Claude Code PreToolUse hook rather than a git
   `reference-transaction` hook. I claim the removal script's `spawnSync("git", ["branch","-D",...])`
   is out of the hook's reach BY CONSTRUCTION (it is not a Bash tool call), so no env-var carve-out is
   needed, and that this is the decisive advantage over the git hook. Check that reasoning. Also
   critique the proposed match — the word `branch`/`tag` followed across intervening flags by
   `-d`/`-D`/`--delete`, in either order. Give me the false-refusal cases that would actually bite an
   agent daily, and the bypasses that matter. Should `git push --delete` / `git push origin :ref`
   (remote branch deletion) be in scope or is that scope creep?
5. **Order of operations** in the removal path (fetch sha → worktree:check blockers → in-use → unlock
   → `git worktree remove` with no --force → conditional branch delete). Anything mis-ordered, any
   TOCTOU window that matters, anything missing?
6. **One primitive, two entry points** (`worktree:remove` and the sweep's `remove` verb delegating to
   it), with the 24h floor left only in `classifyOne` for the sweep's *report*. Is that split right,
   or is it two ways to do the same thing?

## What I want back

Findings ranked by severity, each with: the concrete failure sequence, whether work is LOST or merely
disrupted, and the smallest fix. Say plainly if a design choice is wrong rather than suggesting an
addition. If the plan is over-built for the problem, say which part to cut — this repo prefers the
simplest thing that is safe, and prefers reusing existing machinery to adding a second way to do
something. Also tell me whether the plan's DIAGNOSIS (the 24h floor is the reason agents hand-type
git) is actually supported by the evidence given, or whether I have talked myself into a tidy story.
