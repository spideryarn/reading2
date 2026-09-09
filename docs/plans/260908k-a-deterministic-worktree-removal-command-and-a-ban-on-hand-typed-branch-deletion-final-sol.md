## Seven findings

1. **STILL OPEN** — `prune` preserves working-tree files, but deletes `.git/worktrees/<name>` including `HEAD` and its reflog; the unscoped call can do this to unrelated ghosts, and re-listing only proves the registration vanished. [worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:480)

2. **STILL OPEN** — weakening the claim fixes the expired-reflog overclaim, but not the live race: an external `git -C <tree>` can create and check away from a detached commit after the snapshot, then removal destroys its only reflog. Cheapest useful narrowing: repeat `reachableOids` and `landedProof` after unlocking, immediately before removal, and re-lock on refusal.

3. **STILL OPEN** — a process controls its own `comm` via `PR_SET_NAME`; I reproduced an opaque, dumpable-zero Python process reporting `comm=sshd`, which the allowlist treats as ambient. `comm` being unreadable fails closed, but universal readability is not a portable guarantee. [worktree-inuse.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-inuse.ts:382)

4. **STILL OPEN** — the check is immediately before deletion, but still in a separate process. I reproduced the interleaving: list says free → peer adds worktree → `update-ref -d` succeeds → peer’s symbolic `HEAD` points at a missing branch. [worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:544)

5. **STILL OPEN** — the named cases and continuation parity are fixed, but this is not shell-equivalent parsing: `git branch -\D x` and `git branch --de"lete" x` both become deletion flags yet pass; a literal `\\-D` is refused although the shell does not produce an option. [protect-shared-tree.sh](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/.claude/hooks/protect-shared-tree.sh:121)

6. **CLOSED** — a genuinely absent locked registration is unlocked and becomes prune-eligible; the separate failure to restore that lock when pruning does not happen belongs to finding 1.

7. **CLOSED** — `lookupRef` distinguishes exit 1 from other failures and both target resolution and final branch deletion use it. [worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:396)

## Material failure sequences, ranked

1. **High — LOST:** Worktree B is moved aside with a detached commit named only by its `HEAD` reflog → removing ghost A runs unscoped `prune` → Git deletes B’s administrative directory and reflog. The commit immediately becomes unreachable and is physically recoverable only until GC; B’s directory remains but its `.git` link is broken. I reproduced the metadata deletion.

2. **High — LOST:** Initial HEAD-reflog proof passes → a clean detached commit is created and checked away from through `git -C` → removal deletes the worktree reflog → the commit becomes unreachable. I reproduced this sequence.

3. **High — DISRUPTED, potentially LOST:** An active opaque process names itself `sshd` → liveness reports ambient/idle → owner waiver proceeds and removes its tree. The process is interrupted; ignored or only-copy data written after the earlier safety check can be lost.

4. **Medium — DISRUPTED:** A peer checks out the branch between `checkedOutSomewhere` and `update-ref` → its worktree is stranded with a missing symbolic branch. Existing committed work remains on the proved trunk.

5. **Medium — DISRUPTED:** A locked ghost is restored, or pruning fails, after unlock → the registration remains but its original lock is not restored.

6. **Low — documentation is now contradictory:** the docs say `prune` “cannot delete a file at all,” although it deletes Git administrative files; they say `ghosts()` now requires absence, but that function still includes every `prunable` entry. The hook also retains the old “every commit … ever pointed at” claim. [worktrees.md](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/docs/project/worktrees.md:508), [worktree-admin.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-admin.ts:186), [protect-shared-tree.sh](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/.claude/hooks/protect-shared-tree.sh:151)

The hook suite passes, and all 30 non-git liveness tests pass. The 43 git-backed tests could not enter their bodies because this sandbox again denied `spawnSync git` with `EPERM`; I reviewed them by reading and used direct Git reproductions instead. Typecheck was likewise prevented from starting by a sandbox-denied `tsx` IPC socket.

**Verdict: not landable yet.** The ghost-pruning metadata loss and spoofable ambient-process waiver are decisive.