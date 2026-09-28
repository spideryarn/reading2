## Findings

- **F26 — P1 — fixed.** FAQ’s “To the passage” always targeted the current stop’s block, so it was a no-op. The red test found the unwanted button; after removing the jump and its redundant `blockId`, the question is text only and the test is green.

- **F27 — P1 — fixed.** Timeline links were rendered even when that experimental control was hidden. The red test found the active event button; the card now applies the shared experimental-visibility rule, retains the event as text, and guards the navigation action. Trajectory remains structurally owner-only.

No reported-only findings.

F18–F25 are otherwise honoured. The read-hook behavior, stale/outdated policy, term matching, legacy `role` fallback, cue validation/budget, navigation history, accessibility semantics, and prompt rules checked out. A synthetic worst-case card with 24 terms × 30 stops took about 2.3 ms per gathering in jsdom.

Verification:

- 10 test files, 227 tests passed.
- All four TypeScript projects passed.
- Diff check passed.
- Lint reported only the two existing `Reader` complexity advisories.
- No database, network, or commit.

**Verdict: accept. No outstanding P0/P1.**

Changed files:

- [stop-card.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/stop-card.ts)
- [TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/TrajectoryPanel.tsx)
- [TrajectoryMode.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/modes/trajectory/TrajectoryMode.tsx)
- [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/reader/Reader.tsx)
- [stop-card.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/stop-card.test.ts)
- [trajectory-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/trajectory-panel.test.tsx)
- [trajectory.md](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/project/trajectory.md)
- [stage plan](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md)