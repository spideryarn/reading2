You are reviewing built code in the repo at the current directory (Spideryarn, a TypeScript/React reading app), and you may FIX what you find.

The change is the last commit on this branch: `git show HEAD` (plan: docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md, including its "GPT Sol's plan review" section — you reviewed the plan earlier; check its accepted findings were actually built). A diff is also at docs/plans/261001p-summary-loses-parts-and-sections-code-review.diff.

In short: Summary mode's Parts & Sections gist outline is deleted (SummaryPanel.tsx, ?deep=, the `gists` view); Summary is now only the Brief/Simple/Fuller plain-words slider and its paragraphs (SimplePanel), the slider is always live with an icon button at each end instead of the level's name, ?summary= defaults to `simple`, `deep` is never-remembered in last-view, and Summary gets a "roomy" band (layout.ts bandShapeFor / ROOMY_IDEAL_REM).

Look hardest for:
1. Activation/spend correctness: can any path (bar press, command-bar sub-mode row, slider pointer/click/keyboard, the new end-icon buttons, Back/Forward, pasted link, last-view restore) arm `simple` and leave a token unclaimed, arm twice, or start a model call that the old code did not? Does ModeBoundary's bandTarget agree with what the band mounts? Is a visitor still unable to arm anything?
2. URL/last-view: old links (?summary=gists, ?deep=2, ?summary=simple) and the "incoming link wins over restore" invariant; subModeParams clearing the default.
3. Accessibility of the slider and end icons (keyboard, screen reader, touch target, the tooltip on touch).
4. Anything deleted that something still needed (grep: CSS classes in summary.css/voices.css still used elsewhere, tree.ts helpers, params exports), and stale comments that now say something false in src/.
5. The roomy band in fitView/fitBoth/notesFit and the Reader wiring.
6. Tests that were rewritten into something weaker (a check that can no longer fail).

Fix what you find inside this change's scope, in src/ and tests/ only — do NOT edit anything under docs/ (another agent is rewriting the docs concurrently). Do not commit, stash, reset or checkout. Run `npm run typecheck` and the specific test files you touch (`npx vitest run tests/<file>`); do not run the full suite. Report findings ranked P0/P1/P2 with file:line and the failure scenario, and for each say FIXED (what you changed) or NOT FIXED (why). Report anything wider than this change for me to decide.
