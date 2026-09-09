Implemented Stage 2 only; nothing committed.

Key results:

- Added the self-contained [QuestionsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/tools/fleet/web/src/QuestionsPanel.tsx).
- Added all six Questions-mode registrations and render-time staleness handling.
- Added 13 panel/composition tests.
- GPT Sol review found an inconsistent-dialog action-boundary defect; reproduced red, fixed, and re-reviewed successfully.
- Preserved another session’s unrelated changes to the main plan.

Verification passed:

- 53 Questions and Stage 1 tests
- 14 import-boundary tests
- Existing dock-from-`MODES` test
- Fleet production build
- Biome lint for new panel and tests
- Diff whitespace checks

Full details: [Stage 2 report](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/docs/plans/260909e-questions-mode-stage2-report.md). Review record: [GPT Sol review](/home/greg/code/spideryarn2/.claude/worktrees/questions-mode/docs/plans/260909e-questions-mode-stage2-review-sol.md).