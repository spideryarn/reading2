[Full review and proposed rule wording](/home/greg/code/spideryarn2/.claude/worktrees/fb-thpsnd-fewer-modes/docs/plans/261003l-fewer-modes-code-review-sol.md).

- **F8 — P0, established; wider, unfixed.** Diagram’s stale URL context leaves an unclaimed Sketch token after Force → immediate Diagram command. Back then posts a Sketch job. The real Reader diagnostic failed its expected-null token assertion; continuing established the unwanted POST. This predates the candidate and requires several edits, so I respected the report-only scope.
- **F5 — P1, established; fixed.** The alias migration dropped `social`, breaking “rerun social.” The new matcher test failed before restoring the alias and passes afterwards.
- **F3 — P2, established; rule unchanged.** The retirement checklist still prescribes putting aliases on Summary. Following it experimentally made the existing “tweets” + Enter tests fail by selecting Summary instead of Thread. Proposed before/after wording is in the review; the repository’s rule-edit policy requires an approved set.
- **F9 — P3, established; fixed.** The URL table omitted Summary’s button and command row as generation gestures. Its wording assertion failed before correction and passes afterwards.

Added real App/Reader coverage for F1 and “tweets” + Enter from Fuller. Removing Reader’s Summary prop makes the F1 test fail, confirming its sensitivity.

**455 tests passed across 14 focused files.** No full suite, typecheck or commits.

**Verdict: pass this stage with the uncommitted fixes; F8 remains a separate P0 follow-up.**