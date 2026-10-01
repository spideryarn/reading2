Code review of the built change for docs/plans/261001d-command-bar-lists-sub-modes.md (read the plan, including its Review record, first). You may fix what you find inside this change; report anything wider for me to decide rather than fixing it.

The change is uncommitted in this worktree: run `git diff HEAD` and `git status` to see it. New files: src/web/sub-modes.ts, tests/command-bar-sub-modes.test.tsx. Touched: src/web/command-match.ts, src/web/CommandBar.tsx, src/web/Dock.tsx, src/web/reader/Reader.tsx, src/web/activation.ts, src/web/DiagramPanel.tsx, src/web/QuizPanel.tsx, src/web/modes/referee/RefereeMode.tsx, src/web/modes/summary/SummaryMode.tsx, src/mode-catalog.ts, docs/project/reading-view-overview.md.

Evidence so far: `npm run typecheck` exit 0; `npx vitest run tests/command-bar-sub-modes.test.tsx tests/command-bar.test.tsx tests/mode-catalog.test.ts tests/command-match.test.ts tests/diagram-kind-gating.test.tsx` all green (101 + 18 tests). The new test file was red (12 of 15 failing) before the implementation existed.

Look hardest at:
1. Spending: can a sub-mode row press arm a token that no mounting band claims (compare `subModeTarget` with `bandTarget` and with what each band's `useAutoRun` actually claims, including Summary's levels and Remember's Quiz), arm twice, or arm on the metadata page? Does the Reader's `onMode(next, sub)` path skip anything `armActivationForMode` would have done that still matters (e.g. trajectory)?
2. The one-push write in Reader.tsx (`setSubNav(subModeParams(sub), { history: "push" })`): is it really one history entry with nuqs here, does writing the default (`remember: "recall"`) behave, and does anything else in the Reader (herald, last-view, ModeBoundary, RememberBand's thread rules) misbehave when mode and sub-mode change in one commit?
3. `withSubMode` and the metadata-page href: correct params, and does `readHref`/`carriedSearch` drop or keep anything it should not?
4. Types: is every `switch` over `Command["kind"]` in the client exhaustive now (grep for `kind ===` and `command.kind` across src/web, not just the files listed)? Any place that assumed three kinds?
5. Did moving the chip labels into sub-modes.ts change any chip's rendered text or experimental gating?
6. Tests: do they exercise the real composition (Dock → CommandBar → Reader-shaped onMode), and would they go red if the Diagram row armed the mode's current picture instead of its own? Mutate it to check if you can.

Run `npm run typecheck` and the vitest files above after any fix. End with a list of findings (P0/P1/P2, file:line), what you fixed, and a one-line verdict.
