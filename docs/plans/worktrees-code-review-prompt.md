# Code review: step 1 of the worktrees plan

You reviewed `docs/plans/worktrees.md` and said "revise before building". The plan was revised
against your review; this is the first slice of implementation. Weight this review higher than the
plan-stage one — a plan review cannot see an off-by-one in a parser.

**The code is in `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/56f38049-6bb5-4cfa-98f1-2bf8c77a8fcd/scratchpad/code-evidence.txt`** — two new modules, two new test files, and the diff to `scripts/deploy.ts`.
Read it in full. You may also read the repo directly.

## What this slice is

Step 1 of the plan: fix the two live `deploy.ts` bugs, as reusable primitives, because the plan needs
both again later (the DB lease in step 4, `worktree:rm` and `doctor` in step 5).

- `scripts/lockfile.ts` — atomic lock. Replaces `if (!existsSync(f)) claim()` + `openSync(f,"w")`
  with a single `openSync(f,"wx")`. Handles stale takeover when the recorded pid is dead, and now
  reports `tookOver`/`displaced` so the deploy keeps its "taking over a stale lock" message.
- `scripts/worktree-admin.ts` — `removeWorktree` with **both** `--force` flags and the exit code
  returned; plus `parseWorktreeList` / `ghosts` for the later `doctor`.
- `scripts/deploy.ts` — uses both. The teardown now `record()`s a failure instead of swallowing it.

## Evidence

Both fixes were watched failing against the original bugs before being trusted. I reverted
`"wx"` to `"w"` and `--force --force` to `--force`, and exactly the four bug-targeting tests went red:

```
× refuses a second claim while the first is held
× names the holder rather than only refusing
× still refuses when the holder is alive
× removes a LOCKED worktree — the case a single --force refuses
```

Restored: 25/25 pass. `npm run typecheck` passes all three projects (the one remaining complaint,
`rename-preview.tsx` "checked by no project", is a pre-existing untracked scratch file of Greg's).

I also cleared the 16 stale registrations with `--force --force`; all 16 succeeded.

**I could not get a clean full-suite baseline** and want to say so rather than imply the suite is
green. `npm test` in this tree gave 23 failures across 8 files; a re-run gave 4 across 4. None of the
failing tests import anything I changed. The survivors are: a Postgres `23505 duplicate key
(slug)=(constitution)` from another agent's test run hitting the same shared database concurrently; a
5000ms timeout at load average 238; and two `glossary-band-wiring` assertions that match against the
source text of `src/web/App.tsx`, which a peer is editing right now. Twelve other agents are working
in this tree. I built a worktree at HEAD as a baseline and **discarded it** because `tsx` crashed
there and its pg suites skipped for environment reasons, making the comparison meaningless.

## What I want from you

1. **`lockfile.ts` correctness.** Is the stale-takeover path actually safe? It does
   `rmSync` then `createExclusive` again, bounded to one retry. Walk the interleavings for two
   processes finding the same stale lock. Is there a case where both end up believing they hold it,
   or where a *live* holder's lock gets deleted? Consider a holder that releases between our failed
   claim and our `readLockHolder`, and pid reuse.
2. **The exit-hook release.** `process.on("exit", release)` is registered per successful claim and
   never removed. Two locks in one process register two hooks; a released-then-reclaimed lock
   registers two. Is that a leak or a correctness problem — could an exit hook delete a lock file a
   *later* claim now owns?
3. **`parseWorktreeList`.** Check it against real `git worktree list --porcelain` output, including
   `bare`, `prunable`, `detached`, and a `locked` reason containing newlines or spaces. Does `ghosts`
   do the right thing for the primary checkout and for a `bare` entry?
4. **`removeWorktree`.** Is `--force --force` ever the wrong call — could it destroy work? It is used
   here only on the deploy's own throwaway gate worktree, but the plan reuses it for `worktree:rm`,
   where the tree may hold a user's uncommitted work. Should the destructive version be a separate,
   more clearly named export?
5. **The `deploy.ts` diff.** Does `record()` in the `finally` do the right thing — can it mask or be
   masked by an earlier failure? I removed `closeSync`/`openSync`/`writeSync` from the fs import;
   confirm nothing else used them.
6. **Test quality.** Which of these 25 tests would still pass if the code were wrong? I am
   particularly unsure about the ENOENT test and the "garbled lock file" test.
7. Anything that reports success while doing nothing.

Be concrete, and say plainly where I have got it wrong.
