Review complete. No functional defects found; three low-severity stale comments were fixed.

| Severity | Finding | Status |
|---|---|---|
| Low | [Dock.tsx:770](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/web/Dock.tsx:770) described `guides` as a contents-like run. | Fixed |
| Low | [Dock.tsx:794](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/web/Dock.tsx:794) said Search was one button from Referee. | Fixed |
| Low | [Dock.tsx:828](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/web/Dock.tsx:828) said Debate was beside Chat, despite Search now intervening. | Fixed |

Confirmed:

- All four plan-review findings are addressed.
- Every `MODES_UI` row comment now agrees with its current position and run.
- No current assertion of the former order or group keys remains in `tests/` or `docs/project/`. Historical references remain explicitly historical.
- The hand-written test detects both regressions:
  - Splitting a run caused 3/5 tests to fail, including the explicit split assertion.
  - Moving Glossary and Ideas caused 2/5 tests to fail, including the full-order assertion.
- Restored [dock-mode-order.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/tests/dock-mode-order.test.ts:29): 5/5 passed.
- Typecheck passed through `node --import tsx scripts/typecheck.ts`; the normal npm wrapper was blocked by sandbox IPC permissions.
- Lint reported only the existing Dock complexity advisory.
- `npm test` could not run because the sandbox could not query Docker/connect to Postgres—not because of the memory guard. The broader unit lane also encountered unrelated sandbox-permission failures and was stopped.
- `git diff --check` passes.

Only [Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/web/Dock.tsx:770) is modified. Nothing was committed.