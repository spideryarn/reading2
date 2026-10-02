Code review of commit 7eaf1d294 (run `git show 7eaf1d294`) against its plan,
docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md
(and your own plan review, docs/plans/261002g-plan-review-sol.md — the plan's § What the review changed says how each finding was handled; P1-3 was declined with a reason, challenge it if you think the reason is wrong).

You may FIX what you find, inside this change's scope: edit the files, keep the house style (long explanatory comments where the surrounding code has them), and add or adjust tests. Do not commit. Anything wider than this change, report rather than fix.

Look especially at:
- src/web/Dock.tsx useActivateMode (two callbacks, `toggles`, when arming is skipped) and DockModes (three `.dock-frame`s, `groupStarts(bands)`, MarginToggle lost its groupStart).
- src/web/reader/Reader.tsx the Dock's onMode: the new modePress branch before armSkimOpening; Plain writes setModeAndMargin({mode:"plain", margin:null}, push). Is anything after the early returns (herald, setBandAway, spine rule) needed on those paths? Is writing mode "plain" through useQueryStates with withDefault cleared from the URL as expected?
- Any other caller of Dock's onMode (grep for `onMode=` / `onMode:`) that now receives a third argument or should toggle.
- CSS: src/web/styles/dock-fit.css `.dock-frame`, `.dock-modes`, `.dock-modes-radios`; narrow-window.css coarse pointer; the fit ladder (src/web/dock-fit.ts) still measuring right.
- Tests: tests/a-second-press-closes-the-mode.test.tsx, tests/mode-press.test.ts, and the edits to modes-that-start-themselves, a-broken-mode-leaves-the-article-readable, command-bar tests. Could any of the new assertions pass while the behaviour is broken?

Run the relevant vitest files (`npx vitest run <files>`) and `npm run typecheck` after any fix. Report: findings P0/P1/P2 with file:line, what you fixed, what you left, and a verdict.
