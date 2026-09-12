# Review prompt: the second liveness read in `worktree:remove` (c87ceec8), and whether a live tree is now safe

You are GPT Sol, reviewing **with write access to this worktree** (the house workflow since
2026-09-09): fix what you find inside this stage, and report anything wider for the session to
decide. This is the last link of this review chain — nothing goes back to you after it.

**Before you edit anything, write your findings to
`docs/plans/260912a-drop-the-worktree-removal-age-floor-lease-review-findings.md`** — one bullet per
finding, severity (P0–P3), file:line, a concrete scenario, and whether you reproduced it. Then fix.
Your final answer must repeat the findings, list every file you changed and why, and give a verdict.

## What this is for

`npm run worktree:remove` (`scripts/worktree-remove.ts`) removes a git worktree that other AI agents
on this shared Linux box may be working in. Until 2026-09-12 a third party could only remove a tree
idle for 24 hours; Greg removed that floor, so a finished tree may be removed at once, by anybody, on
evidence alone. The evidence for "nobody is using it" is `liveness()`: the owner named in the lock
(`scripts/worktree-inuse.ts`, `ownerStanding`) and any process with its cwd inside the tree
(`cwdUsersUnder`), gated on the host PID namespace. Plan:
`docs/plans/260912a-drop-the-worktree-removal-age-floor.md` — read its last two sections.

Your previous review (`docs/plans/260912a-drop-the-worktree-removal-age-floor-namespace-review-sol.md`)
confirmed the namespace fix and raised **P1: one liveness read is not a lease** — a peer resuming a
clean, landed tree with a stale lock after the read had it unlocked and removed with the peer inside.

Commit `c87ceec8` is the fix, and **only it is under review**:

1. Before the unlock, the registration is re-listed; if `locked` or `lockReason` changed since the
   first listing (or the entry vanished), refuse without touching anything.
2. After the unlock and after the second landed proof, `liveness()` is read again, just before
   `git worktree remove`; anything other than `idle` refuses and restores the original lock.
3. A peer that *locks* between that late read and the removal is refused by git itself
   (`git worktree remove` refuses a locked tree without `--force`, and nothing here passes it).
4. Tests: `RemoveOptions.liveness` injects a per-call liveness answer, so a peer can "arrive" between
   the two reads; two refusals and a control, in `tests/worktree-remove.test.ts`,
   `describe("liveness is read again after the unlock, not only once")`.

The residual it names: a peer that enters **without locking** between the late read and the removal.
Closing that needs an exclusion shared with Claude Code's `EnterWorktree`, which is not ours to change.

## Evidence

- Scoped diff of `c87ceec8`: `c87ceec8-code.diff` at the root of this worktree (untracked; do not
  commit it). Nothing in the reviewed files has changed on `dev` since that commit.
- Current code: `scripts/worktree-remove.ts` (the new blocks are ~lines 721–781),
  `scripts/worktree-inuse.ts`, `scripts/worktree-sweep.ts`.
- The three worktree test files: `tests/worktree-remove.test.ts`, `tests/worktree-inuse.test.ts`,
  `tests/worktree-sweep.test.ts`. Run them with
  `npx vitest run tests/worktree-remove.test.ts tests/worktree-inuse.test.ts tests/worktree-sweep.test.ts`.
  Last time your sandbox denied git subprocesses (`spawnSync git EPERM`), so the git-backed tests may
  fail in setup; that is expected, not a finding. Say which ran.
- `npm run typecheck` (read its exit code, not its last line — ✓ lines go to stdout, ✗ to stderr).
- Do **not** run the full suite (`npm test`); two are already running on the box.

## Questions, in order

1. **The conclusion — the finding I would least like to be wrong about.** With the floor gone, is a
   live peer's tree now safe from a third-party `worktree:remove`, **bar the one named gap**? Try to
   break that. In particular:
   - A peer resuming via `EnterWorktree`: does it re-lock (so check 1 or git's lock refusal catches
     it), or leave the stale lock as it is (so only the cwd scan catches it)? Does the Claude process
     actually have its cwd inside the tree between tool calls? Say what you checked.
   - Is the lock comparison sound — could a peer's re-lock produce the *same* `lockReason` string?
     Is comparing `lockReason` enough, or does a lock re-written with the same text slip through?
   - The late read passes `originalLock` (the lock we judged, now removed) as `lockReason`. Is that
     right, given the tree is unlocked at that moment?
   - Self-removal (a session removing its own tree from inside) must still work: the late read has
     to see the same ancestry as the first. Does it?
   - Is there any other path to `git worktree remove` or a destructive call that skips the second
     read — the ghost path, dry run, the orphan-branch path, `relock` failures?
   - Is the named gap really the only one left? If there is a second, name it.
2. **The tests.** Do the three new tests go red if each fix is removed? Mutate each (drop the
   re-list check; drop the late read) and report which test catches it. Is anything in the new code
   untested that a single-threaded test *could* reach?
3. **The failure paths.** Late refusal and failed removal both call `relock` with the original lock.
   If a peer locked the tree in between, `relock` fails — is the resulting output honest, and is the
   tree left no less protected than it was found?
4. Anything else in `c87ceec8` that is wrong.

## What to fix, and what not

Fix inside `scripts/worktree-remove.ts` and its tests. Anything you fix gets a test that goes red
without the fix — say that you watched it go red. Do not touch `EnterWorktree`, `.env.local`,
systemd, `infra/`, fleet config, or anything outside the worktree scripts and their tests; report
those instead. Do not commit. Keep the house style: comments carry the *why*, and name who found what.

End with one of: **ACCEPT** (the conclusion holds bar the named gap), **ACCEPT WITH FIXES** (it holds
after your changes — list them), or **REFUSE** (it does not hold — say why).
