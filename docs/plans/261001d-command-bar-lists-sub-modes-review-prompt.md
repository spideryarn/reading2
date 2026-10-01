Review the plan docs/plans/261001d-command-bar-lists-sub-modes.md, read-only, before anything is built.

Read the plan, then the code it touches: src/web/CommandBar.tsx, src/web/command-match.ts, src/web/activation.ts (MODE_TARGET, activationForDiagram, REFEREE_TARGET, bandTarget, armActivationForRefereeView), src/web/Dock.tsx (useActivateMode, DockCommandBar, Props.onMode), src/web/reader/Reader.tsx (the Dock's onMode callback near line 2830, and the quizNav useQueryStates near line 667), src/web/QuizPanel.tsx (RememberSubModeToggle), src/web/DiagramPanel.tsx (KIND_UI, visibleKinds, the chip onClick), src/web/modes/referee/RefereeMode.tsx (REFEREE_VIEW_LABEL), src/web/modes/summary/SummaryMode.tsx (PLAIN, SummaryControls), src/web/params.ts (rememberParam, diagramParam, refereeParam, summaryParam), src/mode-catalog.ts, tests/command-bar.test.tsx.

Questions, in priority order:
1. Spending: can any path through the plan arm a token nobody claims, arm the wrong target, or spend on something other than an explicit press (Back/Forward, pasted link, last-view restore)? In particular the Diagram case and Summary's levels.
2. Is writing mode + sub params in one nuqs push from the Reader's onMode correct, and does anything in the bands (RememberBand's thread rules, ModeBoundary bandTarget, last-view) break when mode and sub change in the same commit?
3. Does the type design (fourth Command kind, registry with total Records, pure module) hold up, and is there a simpler shape that keeps the guarantees?
4. Visibility: is the experimental filtering right, and is there any sub-mode the plan misses or wrongly includes?
5. Anything else that would make you refuse it.

Give findings as P0/P1/P2 with file:line evidence, and end with a one-line verdict: proceed, proceed with changes, or refuse. Do not edit any files.
