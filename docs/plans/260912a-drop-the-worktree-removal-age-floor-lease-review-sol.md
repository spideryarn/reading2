**REFUSE.** The second liveness read closes the reported stale-lock race, but a live worktree is not safe except for the one stated residual.

## Findings

- **P1 — Git’s lock check is not a lease.** [scripts/worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-floor-lease-review/scripts/worktree-remove.ts:768)  
  A peer can successfully lock after `git worktree remove` has checked the lock, yet Git can still delete the tree. Reproduced with 30,000 tracked files: both lock and removal exited 0, and the directory vanished. This contradicts premise 3 and requires exclusion shared with `EnterWorktree`; another local read only moves the race.

- **P2 — the ghost path can unregister a renamed live tree.** [scripts/worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-floor-lease-review/scripts/worktree-remove.ts:657)  
  It skips liveness when the registered path is absent. Reproduced with a live process inside the renamed directory: removal returned 0 and deleted the registration while the directory and process remained. This predates `c87ceec8`, but it is a second live-tree gap.

- **P3 — two reachable failure cases lacked tests.** [tests/worktree-remove.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-floor-lease-review/tests/worktree-remove.test.ts:644)  
  Added coverage for a late `unknown`, and for a peer lock that Git observes before its lock check, including the failed restoration of the original lock. Both now pass and go red when the late read is removed.

The full record is in [lease-review-findings.md](/home/greg/code/spideryarn2/.claude/worktrees/worktree-floor-lease-review/docs/plans/260912a-drop-the-worktree-removal-age-floor-lease-review-findings.md:1).

## Liveness and locking conclusions

- Claude Code 2.1.269’s named-worktree resume attempts to replace a stale lock with `claude session <name> (pid … start …)`. A different session therefore produces different text.
- `EnterWorktree({path})` does not acquire a lock. It rejects a live owner lock but leaves a stale lock unchanged, so that route relies on the cwd scan.
- The same reason can be reproduced by the same Claude process re-entering, but that process would already make the initial owner check live. A different ordinary session cannot reproduce the same PID/start pair. A manual same-text ABA remains possible because the comparison is state equality, not a generation.
- Current transcripts show the session cwd changing to the worktree across tool calls; the earlier direct `/proc` measurement also found the Claude process there. This review’s private PID namespace could not inspect the current host Claude PID directly.
- Passing `originalLock` to the late read is correct: it preserves the owner identity being judged after the physical lock is lifted. A newly arrived peer is then found by cwd or, only if Git observes it in time, by Git’s lock check.
- Self-removal remains sound: both reads rebuild ancestry from the same asking PID, and unlocking does not change that ancestry.
- Dry-run performs no destructive action. The orphan path deletes only a proved branch. The ordinary path has one removal call after the late read. The ghost path is the destructive bypass described above.
- If a peer lock causes Git to refuse, restoring the old lock fails honestly with `could NOT restore the lock`; Git leaves the peer’s newer lock intact, so the tree is no less protected.

## Mutation and verification

- Removed the re-list check: `REFUSES without unlocking when the lock changed…` went red with `out.ok === true`.
- Removed the late read: the late-entry refusal and two-call control went red, as did both added tests. The changed-lock test remained protected by the re-list.
- Final focused block: **5/5 passed**.
- Requested three-file command without adaptation: all 34 in-use tests passed; the 76 Git-backed tests failed in setup with `spawnSync git EPERM`.
- With a temporary shim that discarded that false error only when Git had actually returned a status, **95/112 passed**; the remaining 17 require the host PID namespace. The focused review tests all passed.
- Exact `npm run typecheck` was blocked by `tsx` IPC `listen EPERM`; the equivalent `node --import tsx scripts/typecheck.ts` passed all four projects and coverage of all 2,134 source files.
- Biome checked both changed TypeScript files successfully, reporting only the existing informational complexity warning for `removeWorktree`.
- `git diff --check` passed.
- Full `npm test` was not run, as requested.

Files changed:

- [scripts/worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-floor-lease-review/scripts/worktree-remove.ts:768) — corrected the false claim that every later peer lock is necessarily caught by Git.
- [tests/worktree-remove.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/worktree-floor-lease-review/tests/worktree-remove.test.ts:696) — added the two missing failure-path tests.
- [lease-review-findings.md](/home/greg/code/spideryarn2/.claude/worktrees/worktree-floor-lease-review/docs/plans/260912a-drop-the-worktree-removal-age-floor-lease-review-findings.md:1) — required findings record.

No commit was made.

**REFUSE**