# Worktree tooling learns the `/var/tmp` root

Two bugs left by `ffec82ea4` (2026-10-05), which moved new worktrees on the box from
`<primary>/.claude/worktrees/<name>` to `/var/tmp/spideryarn-worktrees/<name>` —
[worktrees.md § Where a worktree's bytes live](../project/worktrees.md#where-a-worktrees-bytes-live).
Both are from the Overseer's queue: `qi-zq4z69gs` and `qi-nnke48bm`.

The class, for both: **code that learned where a worktree is from the one place worktrees used to
be.** The old location gave two things for free that nobody had written down — a `node_modules` in
an ancestor directory, and a path with `.claude/worktrees/` in it.

## Stage 1 — `npm run worktree:setup` works in a tree with no `node_modules` (qi-zq4z69gs)

**The defect, reproduced** in a tree made by `EnterWorktree` on 2026-10-05:

```
> spideryarn@1.0.0 worktree:setup
> tsx scripts/worktree-setup.ts
sh: 1: tsx: not found
```

Under `.claude/worktrees/` this worked by accident: `npm run` puts every ancestor's
`node_modules/.bin` on `PATH`, so `tsx` was the primary's, and the script's one package import
(`smol-toml`, through `deploy-checks.ts`) resolved by walking up to the primary's `node_modules`.
Under `/var/tmp` there is no ancestor to borrow from.

**The fix.** `worktree:setup` becomes `node scripts/worktree-setup-bootstrap.mjs` — plain Node,
built-in modules only, so it runs with nothing installed. It does one of three things:

1. `node_modules/.bin/tsx` is here → run `tsx scripts/worktree-setup.ts`, exactly as today.
2. It is not, and git says this is a linked worktree → `npm ci --prefer-offline`, then run the
   same script, handing it the sha256 of the `package-lock.json` it installed from in
   `SPIDERYARN_SETUP_INSTALLED_LOCK`.
3. It is not, and this is the primary (or git cannot say) → refuse. The bootstrap never installs
   in the primary, for the reason `worktree-setup.ts` gives: `npm ci` deletes `node_modules`.

`worktree-setup.ts` then skips its own `npm ci` when that hash still equals the lockfile's hash
*after* the merge of `origin/dev` — so a fresh tree installs once, not twice, and a merge that
moved the lockfile still reinstalls.

**Passed over:**

- *The hook runs `npm ci`.* The `WorktreeCreate` hook's stdout must be the path and nothing else,
  it runs before the session can see anything, and it would add 15–20 s and 680 MB to every tree
  including the ones made only to read. Setup is where installing already lives.
- *Borrow the primary's `tsx`.* No second install and no hash, but the script imports a package,
  which resolves from the worktree and not from wherever `tsx` came from.
- *No hash: just install twice.* Simpler by ten lines, and 7–17 s slower on every new tree for
  ever. The hash is small and has a test.

**Tests, red first** (`tests/worktree-setup-bootstrap.test.ts`), run against the real script in a
temporary git repository with a linked worktree and a fake `npm` and `tsx` on disk:

- `package.json`'s `worktree:setup` does not begin with a binary from `node_modules`.
- linked worktree, no `node_modules` → `npm ci` ran, then `tsx scripts/worktree-setup.ts` with the hash.
- the primary, no `node_modules` → refused, non-zero, `npm` never ran.
- `tsx` already present → `npm` never ran, no hash passed.
- the skip in `worktree-setup.ts`: same hash skips, a different or absent hash installs.

**And on a real fresh tree**: delete this worktree's `node_modules` and run `npm run worktree:setup`.

## Stage 2 — the dashboard and the recovery view know both roots (qi-nnke48bm)

**The defect.** Four functions each carry their own idea of where a worktree is, and all four mean
`.claude/worktrees/`:

| Where | What it does with a `/var/tmp` tree |
| --- | --- |
| `tools/fleet/actions.ts` § `isUnderWorktreesDir`, used by `planRemoveWorktree` | refuses: `not-a-worktree` |
| `tools/fleet/routes-actions.ts` § `planFor` | refuses: not under `<primary>/.claude/worktrees/` |
| `tools/overseer/recovery-view.ts` § `worktreeEvidence` | `not-recorded`, though the directory is the worktree |
| `tools/fleet/collect.ts` § `worktreeOf` | `null`, so the row shows no worktree name at all |

The fourth was not in the queue item; it is the same fact and the reason a new tree's row reads
as the bare repo.

**The fix.** One module, `scripts/worktree-roots.ts`, owns the list:

- the in-repo root, `<primary>/.claude/worktrees/`;
- the external root, `$SPIDERYARN_WORKTREE_ROOT` or `/var/tmp/spideryarn-worktrees` — the same
  variable and default as `.claude/hooks/worktree-create.sh`, and a test reads the hook's text to
  keep the two defaults level.

and two questions the four callers ask of it: *which worktree is this directory in?* (name and
root, or null) and *is it a worktree of this checkout?* (in-repo under this primary, or external).
Each caller keeps its own refusal wording and names both roots in it.

One hardening rides along, because it is in the function being changed: a directory with a `..`
or `.` segment is refused. Today `<primary>/.claude/worktrees/x/../../..` passes the prefix test
and is the primary.

What stays as it is: the three steps of the removal plan. A tree of some other repository that
happens to sit under the external root is already stopped by step 1 (its branch) and by step 3,
which sweeps this checkout's worktrees by branch.

**Tests, red first**, one per caller, plus the module's own.

**Not doing:** the statusline in `infra/hetzner/provision.sh` (it takes Claude's own worktree name
first and asks git second, so it is already right), and `devWatchIgnored` in
`scripts/worktree-admin.ts` (the primary's dev server cannot see `/var/tmp` to begin with).

## What GPT Sol's plan review changed

Five findings, all checked against the code and all taken.

- **The removal plan could act on the wrong tree** (F1). The paragraph above headed "What stays as
  it is" was wrong. Step 1 compared branch *names* only, so another repository's worktree under the
  external root, on a branch of the same name as one of ours, would have had its data checked and
  ours removed. The in-repo bound in the route had been hiding this. The plan now has four steps,
  and the first is `git worktree list --porcelain` from the primary, which must name the tree's
  root exactly. Every step acts on that root rather than on whatever directory the row was in.
- **The lockfile was hashed after the install** (F2). Now before and after; a lockfile that moved
  while npm ran claims nothing.
- **`tsx` alone does not mean setup can start** (F3). An interrupted `npm ci` can leave it without
  the package setup imports. The bootstrap now asks for `node_modules/.package-lock.json` as well,
  which npm writes last.
- **Two more callers** (F4): `checkoutRoots` in `tools/fleet/readiness-backfill.ts` never listed the
  external root, so the readiness scan read no new tree's logs; and `primaryRepoRoot` in
  `scripts/claude-accounts.ts` took an external tree for the primary and would seed its path into
  a pool home's Codex trust list. The first lists both directories, each under its own cap; the
  second asks git.
- `worktreeOf` matched any segment called `worktrees`, not `.claude/worktrees` (F5) — it asks the
  shared module now, which is stricter.

It also noted `scripts/readiness-loop.ts`, which makes its own runner worktree under
`.claude/worktrees/`. That is a tree on the small disk, not a tree something fails to recognise;
left alone and written into `worktrees.md`.

## What GPT Sol's code review changed

It fixed in place, and each fix was read and kept except where noted.

- **The last step selected by branch.** It made the removal run in the checked directory with no
  branch selector, since a branch can move after step 2. Kept — but it ran the tree's own
  `npm run worktree:remove`, which is the code being deleted, as old as the branch, and absent from
  a tree that was never set up. Changed to the primary's `tsx` and the primary's
  `scripts/worktree-remove.ts`, standing in the tree, which is what the `WorktreeRemove` hook does.
- **A registration line was trimmed before comparing**, so `/tree` and `/tree ` were one. The
  first step is now `--porcelain -z` and a new `stdout-has-record` gate compares exact records.
- **Inherited `GIT_DIR` and its relatives** could make the primary look like a linked worktree to
  the bootstrap. Cleared for its probes, its install and the hand-over.
- `primaryDir` is held to the same plain-path rule as the directory; the bootstrap rechecks for a
  *finished* install after `npm ci`; one test asserted less than its name.
- It reported `gitCommonDir` failing with `EPERM`. That was its sandbox: the same test passes here.

**Then run for real.** A throwaway tree under `/var/tmp/spideryarn-worktrees/`, the plan built by
`planRemoveWorktree` and each step judged by `judgeStep`: all four passed and the tree and its
branch were gone. Run once before the tree had dependencies, it stopped at step 3 — the limit
written into `worktrees.md`.

## Done

Each stage: its tests seen red then green, `npm test` and `npm run typecheck`, a GPT Sol code
review, one commit. Then `worktrees.md` gets the two facts, and the tree is pushed to `dev`.
