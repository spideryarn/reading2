# Code review: drop the worktree-removal age floor

You are reviewing, and fixing, one change in this repo. Read `CLAUDE.md` first, then the plan
`docs/plans/260912a-drop-the-worktree-removal-age-floor.md`, then the diff:

```
git diff origin/dev -- scripts/worktree-remove.ts scripts/worktree-sweep.ts scripts/worktree-inuse.ts \
  scripts/worktree-check.ts tools/fleet/actions.ts tests/worktree-remove.test.ts \
  tests/worktree-sweep.test.ts docs/project/worktrees.md docs/project/overseer.md
```

(Diff against `origin/dev`, never a merge-base two-dot range: this branch has merged dev.)

## What changed and why

Greg, 2026-09-12: *"Get rid of the 24h worktree-removal floor. If they are finished successfully and
safe to remove, it's fine to do so immediately."*

Before: `npm run worktree:remove` refused a third party for 24 hours after a tree's last activity;
the tree's own session was let past by an ownership proof (the `(pid, start)` in the worktree lock
found in the asker's ancestor chain). `npm run worktree:sweep` printed clean, landed, too-young trees
as `young` and offered no command.

After: everybody needs the same evidence, with no clock — `worktree:check` safe, the landed proof
(tip + branch reflog + worktree HEAD reflog on a freshly fetched `origin/dev`), and liveness `idle`
(no live lock owner other than the asker; no same-uid process with its cwd inside, bar the asker's
ancestors and process group). Liveness `unknown` now refuses outright (it used to fall back to the
floor). The sweep runs the same liveness per tree so `REMOVABLE` means the removal would accept it;
`young`, `lastActivity`, `MIN_IDLE_HOURS`, `shouldWaiveFloor`, `Liveness.authorised` are deleted.

## The conclusion I most want you to try to break

**"With the floor gone, a peer's live tree is still never removable by a third party."** The claim
rests on a measurement: a session that entered its tree with `EnterWorktree` has its `claude`
process's cwd inside the tree, and its lock names that pid (checked on this box, 2026-09-12). Look
for a live-tree state neither signal sees, beyond the two the plan already names (a session that
works in a tree without `EnterWorktree`; the Mac). In particular:

- the sweep's liveness is read with the sweep's own pid — is anything excluded that should not be
  (ancestors, process group) when the Overseer runs it from the primary?
- `ownerStanding` → `asking` now exempts the owner from signal A and grants nothing else. Is there a
  path where `asking` still skips a check it should not?
- `classifyOne` with `inUse: null` — can a live tree reach `removable` with null liveness?
- the removal and the report: can they still disagree about a live tree?

Also check: the new tests (`liveProcess`, `hiddenProcess` in `tests/worktree-remove.test.ts`) —
do they test what their names say, or can they pass for another reason (process-group exclusion, a
race before `prctl` takes effect)? I mutation-tested two things: making `unknown` fall through in
`removeWorktree` reds both unknown tests; dropping the `in-use` line in `classifyOne` reds three
sweep tests.

And the docs: `docs/project/worktrees.md` § Removing one, § `ExitWorktree` refuses…, § Sweeping them
up, and the Traps bullet — anything still describing the floor as live, or any claim that is now
false (the order "remove from inside, then ExitWorktree" is now described as optional — is that
true?).

## How to work

`--sandbox workspace-write`: **fix what you find inside this change** — code, tests, docs — and
leave anything wider as a finding for me. Run `npx vitest run tests/worktree-remove.test.ts
tests/worktree-sweep.test.ts tests/worktree-inuse.test.ts` and `npm run typecheck` after any fix
(read the exit code). Do not commit, do not push, do not touch any other worktree, `.env.local`,
or anything outside this checkout. Do not run `npm run worktree:remove` or `worktree:sweep` against
the real repository.

End with: each finding (severity, file:line, what, whether you fixed it), and a one-line verdict.
