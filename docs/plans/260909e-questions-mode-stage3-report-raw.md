Implemented Stage 3 without committing.

- Added the exhaustive queue pointer and guarded `Nothing needs you.` logic in [QuestionsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/QuestionsPanel.tsx).
- Wired `queueApi`, `refreshNonce`, and `go("ideas")` in [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/App.tsx).
- Added all requested coverage in [fleet-questions-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tests/fleet-questions-panel.test.tsx).
- Wrote the RED-first evidence and completion report in [260909e-questions-mode-stage3-report.md](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/docs/plans/260909e-questions-mode-stage3-report.md).

Verification: focused suite passes, 25/25. Targeted lint had no errors; `git diff --check` is clean. Full tests and typecheck were not run, as requested.

The concurrently modified Stage 4 task document was left untouched.