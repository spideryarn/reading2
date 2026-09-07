# Fable's input on the two guards, 2026-09-07

Asked before the code was written, on the plan's first draft. Fable ran everything it
claims, in scratch repos, on git 2.43.0. Kept because three of its findings changed
the design, and one of them stopped me shipping a fix that was worse than the bug.

## What it found that I had not

1. **The `%ct` defect, independently.** I had found it minutes earlier by the same
   route (a scratch repo, not reasoning), which is the useful part: two runs, same
   conclusion, from different setups. `git log -g -1 --format=%ct <ref>` gives the
   committer date of the commit an entry points at, not the entry's time.

2. **What my first fix would have cost.** With the mtime dropped and `%ct` in its
   place, a five-minute-old worktree classifies as removable whenever `origin/dev`'s
   tip is more than 24 hours old — a quiet weekend. That is the exact accident the
   sweep's header says retired the previous version of the tool. My proposed fix
   reintroduced the bug it was fixing, and **every existing test stays green through
   it**, because the fixtures commit at real-now.

3. **The hole in my `MERGE_HEAD` rule.** A path changed only on HEAD's side has
   `MERGE_HEAD:P == base:P`, so staging the base content — a real revert of this
   branch's own work — matches `MERGE_HEAD:P` and gets excused.
   `git merge-tree --write-tree HEAD MERGE_HEAD` costs the same one call and catches
   it. Verified here independently before adopting.

4. **Why "cannot judge mid-merge, bail out" is wrong**, which was the option I was
   most tempted by. `git commit -F msg -- <paths>` is *refused* during a merge
   (`fatal: cannot do a partial commit during a merge`), so the only way to conclude
   one is the whole-index `git commit` this check exists to guard. Mid-merge is when
   it matters most. Verified here independently.

5. **Three signals should be one.** Commit date and branch reflog are both dominated
   by the HEAD reflog entry time, so `Math.max` over three numbers is parts without
   purpose.

6. **`GIT_OPTIONAL_LOCKS=0` in the env, not `--no-optional-locks` per call** — so a
   command added to the inspector later cannot reintroduce the write.

7. **Age the fixture, do not move the clock.** Nine `now() + N * HOUR` calls in
   `tests/worktree-sweep.test.ts` are all blind on the axis the bug lives on.

8. **Print the deciding signal in the verdict.** `active 1 min ago` was read eighteen
   times without suspicion.

9. Smaller: conflicted (`U`) paths are silently skipped by `check-staged-revert`;
   stderr from `objectId()` leaks `fatal:` lines into the output; `git revert
   --no-commit` fires the same false alarm as a merge.

## Where I did not follow it

- It offered `statSync(<index file>)` as a belt-and-braces "someone used git here"
  signal, noting the index file's mtime was *not* disturbed by the sweep (the lock was
  taken, nothing was written, and it was unlinked — the create-and-unlink is the whole
  directory stamp). Genuinely interesting, and declined: one correct signal beats two,
  and the case it covers is held by the `dirty` blocker anyway.
- It thought the cherry-pick/revert/rebase guards were optional. They are five lines
  and one of them (`git revert --no-commit`) misfires today, so they are in.

## What it endorsed unchanged

The diagnosis of both bugs, `GIT_OPTIONAL_LOCKS` being independently right regardless
of the sweep, keeping the 24-hour floor rather than looking for a cleverer liveness
signal, and fixing rather than deleting `check-staged-revert` — with the condition for
deleting it later written into its header: when the primary is no longer shared.
