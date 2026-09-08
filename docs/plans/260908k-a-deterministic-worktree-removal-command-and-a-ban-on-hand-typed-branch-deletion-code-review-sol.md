The code is not safe to land as written. Two paths can lose the only durable reference to a commit, and the “retaken” proof is not actually retaken.

## Findings

1. Critical — the proof runs after destroying the worktree HEAD reflog.

   Failure sequence:

   1. Branch tip `L` is landed.
   2. The worktree detaches, creates unlanded commit `U`, then checks out `L` again.
   3. `worktree:check` sees the clean, landed current HEAD.
   4. [`reachableOids`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:199>) remembers `U` in memory.
   5. [`git worktree remove`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:491>) deletes the HEAD reflog—the only durable name for `U`.
   6. Only afterwards, [`landedProof`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:553>) notices `U` and “refuses” branch deletion.

   Work is lost: `U` becomes unnamed and is eventually garbage-collected. I reproduced this; after removal `git reflog --all` no longer named `U`, while `git fsck --unreachable --no-reflogs` found it.

   A currently detached worktree is worse: line 466 collects no OIDs and lines 506–508 skip the proof entirely.

   Smallest fix: prove every OID in the worktree HEAD reflog before removing the worktree, whether or not it has a branch. Refuse before the destructive call. If any decision remains until afterwards, keep temporary refs for those OIDs until it completes.

2. Critical — the branch snapshot has an ABA race, so the CAS is insufficient.

   [`oids` and `tip`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:466>) are both captured before removal and passed unchanged to `finishBranch`. The comment calling the proof “retaken” is false.

   Failure sequence:

   1. Snapshot sees landed tip `L`.
   2. Another process moves the branch `L → U → L`, adding un unlanded `U` to its reflog.
   3. The old OID set still proves landed.
   4. `update-ref -d … L` succeeds because the tip is back at `L`.
   5. Branch and reflog disappear, taking the only name for `U`.

   Work is lost.

   Smallest safe fix: leave the branch alone. That is the part I would cut as over-built. If automatic deletion is retained, prepare the deletion in an `update-ref --stdin` transaction, thereby locking the ref, then re-read and prove its current reflog while locked before committing the transaction. Re-reading followed by an ordinary CAS still leaves an ABA window.

3. High — missing or unreadable proof inputs are treated as landed.

   [`reachableOids`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:199>) converts failed `git reflog show` calls into empty output. [`landedProof`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:237>) then passes `--ignore-missing`, whose documented meaning is to pretend invalid object inputs were not supplied. I confirmed that a landed OID plus a nonexistent OID returns exit 0 and count 0. [Git documents exactly that behavior](https://git-scm.com/docs/git-rev-list.html#Documentation/git-rev-list.txt---ignore-missing).

   Thus a missing reflog object, failed reflog read, or corrupt input can produce “landed.” Depending on why the object is unavailable, this loses either work or its last recovery lead.

   With `core.logAllRefUpdates=false` or empty reflogs, the proof does not return `cannot-tell`: the tip keeps `oids` nonempty, so it silently becomes a tip-only proof. “Everything it ever pointed at” is impossible to establish without recorded history.

   Smallest fix: remove `--ignore-missing`; make OID collection return `cannot-tell` on either reflog-command failure; distinguish successful-empty from failed. Narrow the promise to “every commit currently named by the tip and readable reflogs.”

4. High — the directory checks and removal are unsynchronised.

   For a live tree, `blockers()` runs well before removal. A process can create a valuable ignored file after that check; plain `git worktree remove` deletes ignored files without objecting. Work is lost.

   The ghost path has the same race with double force:

   1. The directory is moved away; `git worktree list` records it as prunable/absent.
   2. The original directory is moved back before removal.
   3. `git worktree remove --force --force` now validates it and deletes its untracked contents.

   I reproduced this exact sequence on Git 2.43: the initial listing said `prunable`, the restored tree contained `precious-dir`, double-force exited 0, and the directory was gone.

   Smallest fix: stop auto-removing ghosts with the force primitive; report them only. For live trees, rerunning blockers and liveness immediately before removal narrows the race but does not eliminate it. A complete guarantee requires serialization or an atomic quarantine-and-recheck design.

5. High — `cannot-tell` still fails open for the owner.

   [`composeInUse`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-inuse.ts:303>) can correctly return `unknown`, but [`removeWorktree`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:442>) waives the floor whenever `authorised` is true, regardless of that unknown.

   An owner plus a same-UID process whose cwd is unreadable therefore proceeds immediately. If that opaque process belongs to a peer using the tree, it is disrupted and concurrent writes can be lost.

   Smallest fix: waive the floor only when `live.authorised && live.inUse.kind === "idle"`. An authorised-but-unknown result must use the fallback floor as the design says.

6. Medium — `--dry-run` does not run the most important proof.

   The live-tree dry run returns at [line 469](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:469>) before calling `landedProof`. A moved-back unlanded reflog therefore prints that it “would prove and delete” even though a real run would reject the branch—after already removing the worktree.

   No work is lost during dry run, but its answer is false.

   Smallest fix: perform every read-only proof before the dry-run return.

7. Medium — failed removal does not restore the original lock reliably.

   A lock with no reason has `entry.locked === true` and `originalLock === undefined`. The restoration condition at [line 494](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-remove.ts:494>) skips it, leaving the surviving tree unlocked.

   Shell-sensitive characters are safe because `spawnSync` uses an argument array. Newlines are not: [`parseWorktreeList`](</home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-admin.ts:138>) splits on both NUL and newline even when parsing `-z` output, so an internal newline truncates the reason. Git’s `-z` format deliberately leaves such characters unescaped. [Git’s format documentation confirms this](https://github.com/git/git/blob/master/Documentation/git-worktree.adoc).

   Impact is disruption/lost protection, not immediate work loss.

   Smallest fix: relock without `--reason` when the original lock had none; parse `-z` output only on NUL. If byte-identical restoration matters, read the admin `locked` file before unlocking.

8. Low — the hook is neither truly per-command nor complete for valid clusters.

   The global `if word_in git "$text"` means this innocent command is refused:

   ```bash
   git status && grep -n "branch -D" notes.txt
   ```

   I reproduced the exit-2 refusal. The second segment contains no `git`, contrary to the hook’s stated per-command rule.

   Conversely, `git branch -vvvvD victim` is valid and deletes the branch, but the arbitrary three-letter bound misses it; I reproduced the deletion in a scratch repository. Committed `HEAD` also misses a backslash-continued `git branch \` / `-D …`; the current uncommitted edit has already fixed that case.

   These are bypasses/disruptions, not direct work loss—the hook explicitly calls itself a nudge.

   Smallest fix: require `git`, `branch`, and the deletion flag in the same segment; match a single-dash option token containing `d/D` without the three-letter cap. Do not attempt a full shell parser for a nudge.

## Your finding 1

Your conclusion is correct for the exact static state you measured: a replacement directory without the registered `.git` backlink fails Git’s worktree validation even under double force. Git’s validator explicitly requires that `.git` point back to the administrative entry. [Git source](https://github.com/git/git/blob/master/worktree.c).

I did not find a static present-and-prunable state on Git 2.43 that also passes that validation. But “there was no data-loss case” is still too strong because the classification is a snapshot. An absent/prunable tree restored between classification and double-force is deleted, including untracked files; I reproduced that. The revised present-only classification closes your measured case, but not this ghost TOCTOU.

## `/proc` and ownership conclusions

`parseStat` is correct. After the final `") "`, `f[0]` is kernel field 3, so `f[1]` is field 4 `ppid` and `f[19]` is field 22 `starttime`. A comm containing `") "` does not defeat `lastIndexOf`, because the actual delimiter necessarily occurs later. The kernel’s field numbering agrees. [Linux proc documentation](https://www.kernel.org/pub/linux/docs/man-pages/book/man-pages-6.15.pdf).

For normal execution, `npm run` and its shells preserve the Claude process as an ancestor; `ExitWorktree({action:"keep"})` should also preserve it because the same Claude process continues from another cwd.

It is cooperative evidence, not unforgeable ownership: another same-UID session can inspect a common ancestor’s PID/start and write a syntactically valid lock reason naming it. PID namespaces or detached supervisors can also cause a legitimate owner to miss authorization. The docs should not say another session “cannot manufacture” it.

## Test gaps

The most consequential missing tests are:

- an unlanded commit reachable only from the worktree HEAD reflog;
- a currently detached worktree with reflog-only work;
- branch `L → U → L` between snapshot and deletion;
- a missing OID and a failed reflog command;
- owner-authorised plus `inUse: unknown`;
- the complete owner-authorised removal path—`opts.pid` is never used by a test;
- removal failure followed by restoration of a reasonless lock;
- ghost absent at classification but restored before force removal;
- dry run refusing an unlanded reflog;
- the hook’s cross-segment false refusal.

The existing “branch has not landed” removal test passes at `worktree:check`; it never exercises the new final proof. The moved-back reflog test exercises helpers only, so it cannot catch the destructive ordering. The lock test exercises successful removal, not restoration.

The pure `/proc` suite passed 25/25 and the hook suite passed. The 44 Git-backed tests could not start in this review sandbox because Node’s `spawnSync git` was denied with `EPERM`; that is an environment limitation, not 44 product failures. Biome reported one advisory: `removeWorktree` has cognitive complexity 76 against the configured maximum 25.