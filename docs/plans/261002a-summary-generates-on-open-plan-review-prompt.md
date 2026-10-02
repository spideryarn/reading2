You are reviewing a plan before it is built, in the repo at the current directory (TypeScript, React client under src/web). Read-only.

The plan: docs/plans/261002a-summary-generates-on-open.md. Read it, then verify its claims against the code:
- src/web/activation.ts (MODE_TARGET, modeStep, bandTarget, subModeTarget, modeGenerates)
- src/web/modes/summary/SummaryMode.tsx, src/web/useSimple.ts, src/web/useAutoRun.ts
- src/web/auto-modes.ts and src/web/AddPage.tsx (the "Generate the main modes" box)
- src/web/Dock.tsx and src/web/CommandBar.tsx (what a press arms; visitors)
- src/web/last-view.ts (restores), tests/every-mode-draws-its-surface.test.tsx, tests/command-bar.test.tsx, tests/auto-modes.test.tsx, tests/modes-that-start-themselves.test.tsx
- docs/project/mode.md, docs/project/summaries.md

Questions:
1. Does changing MODE_TARGET.summary to {kind:"fixed", target:"simple"} really make a bar press on Summary start the simple job when none is stored, and do nothing when one is? Any path where it spends twice, spends for a visitor, or spends on arrival/restore?
2. Is anything else keyed on MODE_TARGET.summary being "none" (or Summary arming nothing) that would break or become wrong?
3. Is including Summary in the add-page box (via modeStep) correct mechanically — does the job queue accept "simple" there, and are there server-side gates (FORCE_ONLY_WHEN_NAMED, billing, STEP_SHARING) that would refuse or double-charge?
4. Is the 7V reasoning (Parts & Sections are Hierarchy's gists, deferring them = deferring Hierarchy) right?
5. Anything the plan misses, including tests that will go red that it does not list.

Answer with numbered findings, P0/P1/P2 severity, file:line evidence. Also say whether the plan's conclusion holds.
