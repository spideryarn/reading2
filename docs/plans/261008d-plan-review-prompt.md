You are reviewing a PLAN (read-only) for a small UI change in this repo (Spideryarn, a reading app).

Plan: docs/plans/261008d-bottom-bar-groups-skim-and-more-join-structure-and-summary-comments-joins-marginalia.md
Prior plan it follows: docs/plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md (see D6 and PR-1 there).
Code: src/web/Dock.tsx (MODES_UI, ModeGroup, splitForMore, drawnCount, groupStarts, fitSignature, DockModes, DockModeLinks, DockMore, the Comments DockTab/DockLink inside Dock's return), src/web/styles/dock-fit.css, src/web/styles/narrow-window.css, src/web/dock-fit.ts.
Tests: tests/dock-more.test.tsx, tests/dock-mode-order.test.ts, tests/dock-fit.test.ts, tests/the-dock-hides-in-a-mode-beside-the-article.test.ts, tests/a-failed-comment-write-is-said-on-the-dock.test.tsx.

Please:
1. Judge D2's accessibility trade-off (More menu button placed inside role="radiogroup"). Is there a better shape that keeps the visual order Greg asked for (More right after Skim, inside the same frame, before Search) without lying to a screen reader and without breaking focus order? Be concrete. If option 1 is acceptable, say what mitigations (if any) to add.
2. Find anything the plan misses: places that assume More is after the radiogroup or Comments is a direct child of .dock (CSS selectors like `.dock > .dock-btn`, the fit ladder rungs, the phone hide-on-scroll guard, the drawer Escape handler, tests, measure scripts, docs/help pages).
3. Anything wrong with D1 (Skim's group change) e.g. tests or comments keyed on the guides run.
Write findings numbered PR-1.. with severity (P0/P1/P2) and a one-line verdict at the top: build / build with fixes / rethink.
