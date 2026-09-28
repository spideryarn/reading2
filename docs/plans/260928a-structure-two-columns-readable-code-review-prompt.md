You are reviewing a built change in the Spideryarn repo (this working directory, a git worktree). Since 2026-09-09 the house workflow is: you FIX what you find inside this change's scope (edit the files directly), and REPORT anything wider for me to decide. Do not commit. Do not run git commands that discard work (no checkout/restore/stash/reset/clean).

The change is commit f9fdc1b7 (`git show f9fdc1b7`), built from docs/plans/260928a-structure-two-columns-readable.md, which your own plan review (docs/plans/260928a-structure-two-columns-readable-plan-review-sol.md) approved with four P1 changes, all taken. Browser measurements are in the plan's § Measurements (read them; they are evidence, and say if they contradict the code).

Greg's request: Structure mode's two-column face was hard to read (small text, narrow columns); switch to two columns only on a wider window, give the columns more room, and make the two faces (two columns / nested list) look consistent — colours, highlighting of the current row, text sizes.

The conclusions I would least like to be wrong about:
1. The band `fitMode` hands Structure and the face `structureFace` draws in it can never disagree, at any window width, root font size, or ?spine=0 — including the covering band below 700px, where the face is now always the list.
2. The new CSS selector that washes only the *deepest* current row (`:is(.struct-grid, .struct-measure):not(:has(> .struct-inner .struct-row[aria-current])) > .struct-side:not(.struct-inner) .struct-row[aria-current]`, plus `.struct-inner .struct-row[aria-current]`) matches exactly one row in every state the projection produces (a part with sections and a current section; a part with no sections; the reader in the apparatus / supplement; before the first part), and the measuring copies are styled the same as the real rows so the measured rung ladders stay true. Check structure.ts for when column B has an aria-current row.
3. Moving `.struct-gist` inside `.struct-line` (the title's grid) does not break the measuring, the hover card (docs/project/tooltips.md § Structure's card, defined by subtraction), or tests.
4. Nothing else in the codebase assumes a mode band is at most MODE_IDEAL (400px) wide — herald, dock, return chips, fisheye, design page, prose centring, the small-screen hint.
5. The docs updated (granularity-zoom.md, narrow-windows.md, reading-view-overview.md, browser-testing.md) state the numbers the code produces.

After fixing, run `npx vitest run tests/structure-band-width.test.ts tests/structure-mode-faces.test.tsx tests/layout.test.ts tests/structure-panel-draws-both-columns.test.tsx tests/outline-panel.test.tsx tests/structure-card-opens.test.tsx tests/doc-links.test.ts` and `npm run typecheck` and report the results.

Report: numbered findings with severity (P0/P1/P2), file:line evidence, what you changed for each (or why not), and anything wider you did not change. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES (made), or REJECT.
