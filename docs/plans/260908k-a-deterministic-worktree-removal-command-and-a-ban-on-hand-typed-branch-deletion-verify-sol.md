Verdict: still not safe to land.

## Remaining findings

1. **Critical — a “ghost” that comes back as its original valid worktree is deleted without any proof. Work LOST.**

   [worktree-remove.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:541) classifies once, then calls plain removal. Plain Git refuses an unrelated replacement directory because it lacks the registered `.git` link, which is all the test covers. But if the original valid worktree is moved back before removal, Git accepts it.

   I reproduced plain removal returning 0 while deleting:

   - an ignored only-copy file; and
   - an unlanded detached commit named only by that worktree’s HEAD reflog.

   The commit was no longer in `git reflog --all` afterward. Thus the no-force change narrows the ghost race but does not fully close it.

2. **High — the HEAD-reflog proof remains a snapshot with an unacknowledged loss window. Work LOST.**

   After [the proof](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:605), another process can use `git -C <tree>` from outside the tree to create a detached commit and return HEAD to the landed branch. Its cwd scan never sees that process. Plain removal sees a clean worktree, succeeds, and deletes the only reflog naming the commit.

   Finding 1’s ordering bug is fixed, but the claim that the completed proof makes subsequent removal safe is stronger than what the snapshot establishes.

3. **High — your pushback on opaque same-UID processes is wrong. Work can be disrupted, and late output can be lost.**

   [composeInUse](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-inuse.ts:395) turns `found=[] + opaque>0` into `idle`, so `shouldWaiveFloor` still waives despite an unanswered read.

   I constructed it directly on this box: a same-UID Python process changed cwd to this worktree, called `prctl(PR_SET_DUMPABLE, 0)`, and remained running. `/proc/<pid>/cwd` returned failure although its cwd really was the worktree. A security-sensitive helper, test, or server can plausibly do exactly this.

   The six ambient daemons prove that blocking every opaque PID is operationally unusable; they do not prove every opaque PID is a daemon. The implementation needs a way to distinguish those ambient processes. Counting alone does not settle the safety question.

4. **High — the documented ABA residual is larger than claimed: an unchanged branch can become checked out. Work disrupted.**

   [proveAndDeleteBranch](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:434) protects only the ref value. Sequence:

   1. `resolveTarget` sees an orphan branch.
   2. A peer creates a new worktree on that unchanged branch.
   3. Its tip and reflog prove landed.
   4. `update-ref -d ... <expected>` succeeds because the tip remains unchanged.

   I reproduced `update-ref` deleting a branch checked out in another worktree. That worktree was left with symbolic HEAD pointing at a missing ref and reported `No commits yet`.

   No A→B→A is required. On the orphan path the window begins before the network fetch; on the ordinary path it begins after removal. The stated ABA window also includes the potentially nontrivial `rev-list`, not merely negligible process-start overhead.

5. **Medium — the hook still misses valid hand-typed deletion syntax, and the carry introduces false refusals. Work can be LOST through the miss.**

   The [flag regex](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/.claude/hooks/protect-shared-tree.sh:120) requires the literal hyphen to follow whitespace. These all passed the hook:

   ```bash
   git branch "-D" worktree-x
   git branch '-d' worktree-x
   git branch \-D worktree-x
   ```

   I confirmed the first command really deletes the branch. With `-D`, branch-only unlanded history becomes unreachable.

   The [continuation carry](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/.claude/hooks/protect-shared-tree.sh:159) also treats any trailing backslash as continuation; shell continuation requires an odd number immediately before a newline. For example, this innocent compound command is falsely refused because the even backslashes are carried across the real `&&`:

   ```bash
   echo git branch \\&& npm install -D pkg
   ```

6. **Medium — locked ghosts are no longer removable through the sanctioned command. No work lost; cleanup is blocked.**

   A plain removal of an absent but locked registration fails with:

   ```text
   fatal: cannot remove a locked working tree
   use 'remove -f -f' to override or unlock first
   ```

   I reproduced that, then confirmed `git worktree unlock <path>` followed by plain removal succeeds. So this does not create a ghost “nobody can clear,” but `worktree:remove` itself cannot clear it, and real Claude worktrees are normally locked. The ghost test at [worktree-remove.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/tests/worktree-remove.test.ts:494) covers only an unlocked ghost.

7. **Low — one failed branch read still becomes successful “nothing to delete.” No work lost; silent incomplete cleanup.**

   In `proveAndDeleteBranch`, `refExists()` uses `tryGit`, which conflates an absent ref with any failed spawn/read. A transient failure therefore produces “branch does not exist,” returns true, and makes the overall command exit successfully after removing the worktree while leaving the branch.

   `reachableOids` itself now correctly returns `cannot-tell` for each of its three reads; this duplicated preliminary read remains swallowed.

## Missing tests

Specific uncovered guards are:

- a ghost restored as the original valid worktree, not merely an empty unrelated directory;
- an absent registration that remains locked;
- HEAD-reflog mutation after the first proof but before removal;
- a branch becoming checked out after target resolution;
- failure reading an existing branch’s reflog—the current “branch reflog failure” test fails earlier at the tip read;
- `refExists` failing for reasons other than absence;
- failed removal invoking reasonless-lock restoration end to end—the test calls `relock` directly;
- quoted/escaped deletion flags;
- even-backslash carry across a real separator.

## Documentation now false

In [worktrees.md](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/docs/project/worktrees.md:294):

- “every commit it has ever pointed at” exceeds the real promise: only the tip and surviving reflogs are checked;
- “every reflog entry, retaken after the worktree is gone” is false—the worktree HEAD reflog must be read before removal; only the branch reflog is reread afterward.

In [the ghost section](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/docs/project/worktrees.md:499):

- ghosts are not always unregistered because locked ghosts fail;
- removing force does not protect a valid original worktree that returns to the registered path.

## Original eight findings

1. Fixed for stable live, dry-run, detached, and orphan paths; not globally closed because of the ghost and post-proof races above.
2. Branch reflog rereading is fixed; the residual is larger than documented.
3. `reachableOids` is fixed; the separate `refExists` read is still swallowed.
4. No force remains, and unrelated replacement directories are protected; valid-tree restoration and locked ghosts remain.
5. The formula is fixed, but opaque processes are deliberately mislabeled conclusive. Pushback rejected.
6. Fixed.
7. Fixed. The newline parser defect is survivable for deletion safety here, though failed removal can restore a truncated reason.
8. Ordinary continuation and long-cluster cases are fixed; quoted/escaped flags remain misses, and carry parity causes false refusals.

The hook suite itself passes. The in-use tests passed; this environment prevented the removal suite from setting up its temporary Git repository (`spawnSync git EPERM`), so I did not count that suite as independent green evidence.