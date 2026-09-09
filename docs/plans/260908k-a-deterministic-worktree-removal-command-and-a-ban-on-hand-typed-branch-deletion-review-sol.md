The plan is not ready to build. The command and shared-primitive direction are good, but the proposed liveness test is being used as proof of completion when it can only provide reasons to refuse.

## Findings

1. **Critical — a present but “prunable” directory can bypass every check and be force-deleted.**

   Sequence: a worktree directory still exists, but its `.git` link is broken, so Git reports it as `prunable`. The current classifier treats `!present || prunable` as a ghost before calling `worktree:check`; removal then uses the double-force helper, which is explicitly capable of discarding files. The repository even tests the `present: true, prunable: true` case. See [worktree-sweep.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-sweep.ts:156) and [worktree-admin.ts](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/scripts/worktree-admin.ts:186).

   **Loss:** potentially real tracked, untracked, and ignored files.

   **Smallest fix:** only call something a removable ghost after proving the path is absent. `present && prunable` must be `UNKNOWN` and suggest `git worktree repair`. Ideally replace `existsSync`’s boolean with `present | absent(ENOENT) | unknown`; an unreadable path is not a ghost.

2. **Critical — the branch proof is stale, and `git branch -D` is not compare-and-delete.**

   Sequence:

   1. Fetch trunk SHA `S`; gather sees branch at `H`, with `H` an ancestor of `S`.
   2. The in-use scan sees nobody.
   3. A peer resumes and commits `C` before removal; the tree is clean again.
   4. Plain `git worktree remove` succeeds.
   5. Step 7 “re-reads” the cached `trunk.kind === "landed"` fact and `git branch -D` deletes the branch containing unlanded `C`.

   The plan calls this “re-asserting” the proof, but rereading a fact gathered earlier is not re-assertion. See [the proposed step 7](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/docs/plans/260908k-a-deterministic-worktree-removal-command-and-a-ban-on-hand-typed-branch-deletion.md:192).

   **Loss:** real committed work; after branch and worktree reflogs disappear, `C` can become unreachable.

   **Smallest fix:** capture the expected branch OID, freshly test that exact OID against the fetched trunk SHA after removing the worktree, then delete atomically with:

   ```text
   git update-ref -d refs/heads/<branch> <expected-oid>
   ```

   The old-value argument makes the deletion fail if the branch moved. Do not use `branch -D` here.

3. **High — “no live process observed” does not mean “finished.” The 24-hour floor covers intent and handoff, not just liveness.**

   A concrete repository-shaped sequence: an agent lands an intermediate commit, schedules a one-shot continuation for an hour later, and exits because the machine is overloaded. The tree is clean and landed; its lock PID is dead; no process has that cwd. Ten minutes later the Overseer removes it. The scheduled continuation now has no worktree.

   **Loss:** normally no durable Git/filesystem work if `worktree:check` was correct, but the workflow is disrupted and session-only reasoning may be lost. This is exactly a genuinely wanted tree that both proposed signals clear and the 24-hour floor protects.

   A worse variant is a detached/background child whose cwd is elsewhere but which holds an open file or directory descriptor into the tree. It passes the cwd scan and can write ignored output after `worktree:check`; Git’s removal does not protect ignored files.

   **Loss:** in that variant, real generated data can be lost.

   **Smallest fix:** treat both process signals only as vetoes, never as authorization. Allow immediate removal when the owning live session itself invokes the command. For third-party removal, retain the age floor unless there is a durable positive “owner finished” signal from the owner/Overseer. If ten-minute external cleanup is a requirement, that completion signal is necessary; `/proc` cannot infer intent.

4. **High — the advertised self-removal path contradicts signal A.**

   The lock names the live Claude process. When that process invokes `npm run worktree:remove`, it is still alive with the same PID and start time, so signal A says “in use” even though signal B excludes its shell ancestry. The in-tree form therefore refuses its advertised primary case. The same issue may remain after `ExitWorktree({action:"keep"})` if the owning Claude process stays alive.

   **Loss:** none; the command simply does not work and agents return to hand-typed Git.

   **Smallest fix:** exempt the lock owner only when its exact `(pid,starttime)` is in the remover’s ancestor chain. That is not merely an exception: it is positive proof that the owner itself requested removal.

   The tmux concern is otherwise okay. A tmux server is an ancestor of pane shells, but excluding one ancestor PID does not exclude its other descendant panes. Other agents’ pane shells remain visible. `npm run`’s extra shells are correctly excluded as part of the same invocation. Record ancestor identities as PID plus start time to avoid a tiny PID-reuse race.

5. **High — the proposed `cannot-tell` aggregation fails open.**

   “Fall back only if neither could be read” is wrong. If the lock is malformed or `/proc/<owner>/stat` is unreadable while the cwd scan returns an empty readable result, one signal is unknown and the other is clear; the plan appears to proceed.

   The same applies to the broad cwd walk. Reporting 575 unreadable processes as a note is acceptable only after proving they are foreign users/kernel processes. A stable same-UID PID whose cwd is unreadable is an unknown, not an empty result.

   **Loss:** disruption, or real data loss if the missed process writes ignored files.

   **Smallest fix:** use strict three-valued composition:

   - either signal active → refuse;
   - otherwise either signal unknown → age fallback/refuse;
   - clear only when both applicable signals are conclusively clear.

   Filter by UID first; ignore confirmed foreign UIDs, but fail closed on a stable same-UID PID that cannot be inspected.

6. **High — `--is-ancestor` proves current ancestry, not “nothing is lost forever.”**

   If “on the branch” means reachable from its current tip, the test is sound: all such commits are reachable from the fetched trunk SHA at that moment. But the stronger claim in the plan is false.

   Sequence: a branch once pointed at commit `U`, then was moved back to a landed commit. The current tip passes `--is-ancestor`; `U` survives only in the worktree/branch reflogs. Worktree removal deletes the former, and `git branch -D` deletes the latter. `U` then becomes eligible for eventual pruning. The existing check explicitly prints this blind spot in [worktrees.md](/home/greg/code/spideryarn2/.claude/worktrees/260908k-worktree-removal/docs/project/worktrees.md:327).

   **Loss:** recovery metadata immediately; potentially the commit itself after GC.

   Also, `origin/dev` is not reachable “forever” as a Git guarantee. That is true only while the repository’s no-history-rewrite convention holds.

   **Smallest fix:** before removal, inspect both the target worktree’s HEAD reflog and the branch reflog and refuse if either names a commit not reachable from the captured trunk SHA. This can remain a removal-only guard; `worktree:check` need not change. At minimum, narrow the claim to current branch-tip ancestry under the repo’s append-only trunk convention.

7. **Medium — failure after unlocking leaves the tree less protected; failure after removal can be unrecoverable through the sanctioned CLI.**

   Sequence A: unlock succeeds, removal fails because a concurrent edit appeared or Git encountered another error. The tree remains but its Claude lock is gone.

   Sequence B: worktree removal succeeds, branch deletion fails transiently or because another worktree checked it out. The command leaves an orphan branch. A rerun cannot find a worktree on that branch, while the new hook forbids the manual cleanup command.

   **Loss:** none immediately; protection is weakened and cleanup becomes stuck.

   **Smallest fix:** stop on unlock failure. If removal fails, restore the original lock reason. Make the command able to retry cleanup of an orphaned `worktree-*` branch using the same fresh ancestry and atomic-old-OID checks, and return nonzero on partial completion.

8. **Medium — the PreToolUse hook is appropriate, but its rationale and proposed match are overclaimed.**

   The `spawnSync` reasoning is correct: the hook sees the outer Bash tool call `npm run worktree:remove`, not Node’s child `git branch ...`. No environment carve-out is needed.

   But that is not a decisive security advantage; it is the same boundary that lets any script or alias bypass the hook. The hook is correctly described as an absent-mindedness guard, not enforcement. A Git hook would not necessarily require an environment carve-out—it could allow deletion based on the ref and expected old OID—though that would be more machinery than this problem warrants. Also, `reference-transaction` starts per transaction phase, not once per ref; multiple ref updates arrive on stdin.

   The matcher is underspecified. A whole-payload token match can falsely refuse ordinary compounds such as:

   ```bash
   git branch --show-current && npm install -D package
   git branch --show-current && curl -d payload URL
   ```

   It will also refuse review commands or heredocs quoting `git branch -d`, which will happen around this rule.

   Material bypasses include `git branch -df name`, Git aliases, `git update-ref -d refs/heads/name`, and any script whose contents are not present in the Bash call. Do not chase all of those: the hook is a nudge.

   **Smallest fix:** specify and test the exact literal command forms being guarded, including global Git flags and clustered `-df`; include compound-command false-positive controls. Cut `tag`: nothing in this incident or sanctioned path requires tag deletion.

   `git push --delete` and `git push origin :ref` are out of scope. Remote-ref protection is more consequential and deserves separate server-side/protected-branch treatment, not an expansion of this local-cleanup regex.

9. **Low — one primitive with two entry points is fine, but the report’s vocabulary becomes misleading.**

   Keeping `worktree:sweep remove` as a compatibility alias to `worktree:remove` is not duplicate implementation. That part is right.

   However, the sweep can still say “nothing to remove” while the direct removal command would remove a named tree. `REMOVABLE` would then mean “old enough to advertise,” not “the removal primitive would accept it.”

   **Loss:** none; operator confusion.

   **Smallest fix:** name the distinction in output, for example “safe but young—explicit removal only,” while continuing not to print a paste-ready removal command for it.

## Diagnosis

The evidence supports a narrower diagnosis than the plan states.

The nine refusals prove the 24-hour floor makes the sanctioned command unusable for immediate cleanup. They do not prove the incident agent knew about or attempted that command, nor does one snapshot prove it “has never once” removed anything. The stronger proximal evidence is that both AGENTS/Overseer stop at `worktree:check`, while `worktrees.md` explicitly hands the reader a manual `git worktree remove` command.

So:

- the age floor is a real structural contributor;
- missing/contradictory documentation is the directly supported cause of this incident;
- “hand-typed Git is the documented consequence of the floor” is too tidy and should be softened.

My simplest safe version would keep the canonical removal command and shared primitive, use liveness only to veto, permit immediate self-removal by the exact owning ancestor, retain age or require an explicit completion signal for third-party removal, make ghost detection absence-only, and use an expected-OID `update-ref` deletion. Cut tag handling and remote-branch deletion from this plan.