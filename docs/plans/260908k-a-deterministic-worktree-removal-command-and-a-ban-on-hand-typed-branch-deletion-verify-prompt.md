# Verify the fixes to your "not safe to land" review

You reviewed `scripts/worktree-remove.ts` / `worktree-inuse.ts` and returned eight findings, verdict
"not safe to land as written". They are now fixed and pushed. **Your job is to check that each fix
actually holds, and to find what the fixes broke** — a fix round is where new bugs come from, and
your own finding 1 was itself created by my fixing your earlier finding 2.

Read the diff of the last three commits on this branch (`git log --oneline -3`, then
`git diff HEAD~3...HEAD`), plus the current `scripts/worktree-remove.ts`, `scripts/worktree-inuse.ts`,
`tests/worktree-remove.test.ts`, `tests/worktree-inuse.test.ts`,
`.claude/hooks/protect-shared-tree.sh` and its `.test.sh`.

## What changed, finding by finding

1. **Proof ran after the destructive call.** The entire proof (`reachableOids` + `landedProof`,
   including the worktree's own HEAD reflog, and now also when there is NO branch) completes before
   `unlock`/`worktree remove`. Check: is there any remaining path where something destructive happens
   before the proof, including the `--dry-run` and orphan-branch paths?
2. **ABA / snapshot passed through.** `proveAndDeleteBranch` re-reads the branch reflog after the
   worktree is gone. The residual window between that read and `update-ref -d` is documented in the
   docstring and deliberately not closed with a transaction. Check the reasoning and tell me if the
   residual is bigger than I claim.
3. **`--ignore-missing` and swallowed reads.** Flag dropped; `reachableOids` returns
   `{kind:"cannot-tell"}` on any failed read. Check every read path returns it.
4. **Ghost force race.** **No `--force` anywhere in the file now** — `forceRemoveThrowawayWorktree` is
   no longer imported. Measured: a plain `git worktree remove` clears an absent registration on its
   own (exit 0). Does that fully close the race you reproduced? Is there a case where the plain
   removal now *fails* where the force succeeded, leaving a ghost nobody can clear?
5. **`authorised` waived the floor regardless of unknown.** Now `shouldWaiveFloor(live)` =
   `authorised && inUse.kind === "idle"`.
   **BUT I pushed back on part of this, and I want you to check the pushback.** I split
   `ProcTable.cwd` into `path` / `gone` / `opaque`, because conflating them made the scan report an
   unknown on essentially every run. Measured on this box: of 208 same-uid processes, 202 readable, 1
   gone mid-walk, and **6 permanently opaque — `systemd --user`, `(sd-pam)`, two `sshd`, two
   `postgrest`**. Those 6 are now COUNTED AND PRINTED, not treated as unknown. My argument: they are
   daemons the kernel hides, they are there on every run, and blocking on them is an alarm that can
   never be cleared — which takes the owner waiver, the point of the feature, with it. **Is that
   wrong? Can you construct a same-uid process that would be opaque AND plausibly working inside a
   worktree?** If you can, I will block on them.
6. **dry-run skipped the proof.** It now runs the full proof first.
7. **reasonless lock not restored.** `relock` handles `reason === undefined`. (The `-z` newline
   parsing bug you found in `worktree-admin.ts` is NOT fixed — that file is out of scope for this
   task; it is reported to the human instead. Confirm that leaving it is survivable here.)
8. **Hook.** `git`, `branch` and the delete flag must now all be in ONE segment. The flag pattern is
   `(^|[[:space:]])(--delete|-[[:alpha:]]*[dD][[:alpha:]]*)([^[:alnum:]_-]|$)` — unbounded cluster,
   but the `-` must START a word, which is what excludes `--sort=-committerdate` (preceded by `=`)
   while catching `-vvvvD`. I also found and fixed a bypass you did not list: `git branch \` +
   newline + `-D x` split across segments and passed; there is now a continuation carry.
   Check the regex and the carry for both false refusals and misses.

## Also check

- **The tests.** I mutation-tested seven guards; six went red immediately, and one (dropping the
  worktree HEAD reflog read) left all 36 tests green, so I added a test for it. Are there other
  guards with no test that could fail? Name them specifically.
- `removeWorktree` was split (`resolveTarget`, `proveAndDeleteBranch`, `gitRemoveWorktree`, `relock`,
  `ageFloor`, `shouldWaiveFloor`) partly for the Biome complexity advisory. Did the split introduce
  an inconsistency between paths — particularly, does the orphan-branch path get a weaker check than
  the ordinary one?
- Anything in `docs/project/worktrees.md` § Removing one and § Sweeping them up that is now false.

## What I want back

Only what is still wrong, ranked, with the concrete failure sequence and whether work is LOST or
disrupted. If a finding of yours is now genuinely fixed, say so in one line — I need to know which
are closed. If my pushback on finding 5 is wrong, say so plainly and I will change it.
