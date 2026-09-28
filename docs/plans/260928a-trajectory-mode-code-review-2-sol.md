## Findings

- **F15 — P2 — fixed.** The server and client separately implemented `sectionPathOf` (`src/trajectory.ts:235`, `src/web/trajectory-route.ts:198` in the candidate), risking drift. Moved the implementation into [src/section-path.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/section-path.ts:1); both server and client now import it. Removed the duplicate comparison test and retained one behavior test at [tests/trajectory.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/trajectory.test.ts:351). Structural red → green: two implementations became one; the retained behavior test passes.

- **F16 — P1 — fixed.** Consecutive rows repeated identical section paths in full at Most. [TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/TrajectoryPanel.tsx:243) now displays a muted `〃` while preserving the complete path in screen-reader-only text; styling is at [trajectory.css](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/styles/trajectory.css:106). Red → green: the new test initially received no continuation marker; it now passes at [trajectory-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/tests/trajectory-panel.test.tsx:279).

- **F17 — P1 — fixed.** `depth` and `stop` were absent from last-view policy, so a link containing only either parameter could be mistaken for a bare address and overwritten by remembered state. Additionally, the one-line `useQueryStates` call caused the scanner to consume later object fields as fake parameters. The call is now scanner-readable at [TrajectoryMode.tsx](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/modes/trajectory/TrajectoryMode.tsx:165), and both real keys are documented as remembered at [last-view.ts](/home/greg/code/spideryarn2/.claude/worktrees/trajectory-mode/src/web/last-view.ts:90). Red → green: `last-view.test.ts` failed with `depth`, `quoteId`, `n`, `place`, `role`, `seen`, `current`, and `missing`; it now passes.

No additional P0/P1 defects found. In particular, the door is owner-and-Trajectory-only; passage/controller cleanup is correct; `bandAway` remains recoverable across resizing and mode changes; keyboard guards and auto-run activation semantics hold.

**Verdict: accept after fixes.**

Verification:

- Focused suite: 5 files, 88 tests passed.
- All four TypeScript projects passed via direct `tsc` invocation.
- Scoped Biome lint passed.
- `git diff --check` passed.
- No database, network, or commit.
- The `npm run typecheck` wrapper could not open its local IPC socket in the sandbox, so its four compiler commands were run directly.

Files changed:

- `src/section-path.ts`
- `src/trajectory.ts`
- `src/web/TrajectoryPanel.tsx`
- `src/web/last-view.ts`
- `src/web/modes/trajectory/TrajectoryMode.tsx`
- `src/web/styles/trajectory.css`
- `src/web/trajectory-route.ts`
- `tests/trajectory-panel.test.tsx`
- `tests/trajectory-route.test.ts`
- `tests/trajectory.test.ts`

Existing unrelated doc edits and `spikes/` were left untouched.