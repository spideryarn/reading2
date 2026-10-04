Fixed in the worktree; no commit.

- **F18 — P1, fixed:** two clicks before React rendered sent two forced POSTs. Added a synchronous shared guard. Six cases red first.
- **F19 — P1, fixed:** an older online answer or a different offline identity could bypass the hold. Fenced replacement evidence to the press and kept offline replacements held. Eight cases red first.
- **F20 — P1, fixed:** another job’s failure released this hold; this job’s own failure/cancellation stayed held after an offline remount. Release now uses the exact job’s terminal status. Eighteen cases red first.
- **F21 — P2, fixed:** a rejected `start` callback left an unposted hold. Added cleanup; one case red first.
- **F22 — P2, fixed:** Quiz’s partial reply on stall/body failure lacked coverage. Added two tests; discarding the partial makes both fail.
- **F23 — P3, fixed:** Thread’s postmortem still described its implemented fix and retained test as future work.

[Regression tests](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/tests/rewrite-hold.test.tsx:502) and [root-cause write-up](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c5-failed-read/docs/postmortems/261004g-a-hold-outliving-its-panel-needs-evidence-owned-by-the-same-action.md).

F9/F10 checked, including stale offline copies with and without profiles. Sketch’s badge claim is correct. No reproducible discarded-render defect or wider finding.

Verification: **153 relevant jsdom tests and 303 surrounding checks passed**. Typecheck passed through the same script’s Node entrypoint; touched-file lint and diff checks passed. Full Postgres suite left to you as requested.

LAND WITH THE FIXES ABOVE