VERDICT: land with the fixes I made

- **CR-1 — P1 — Fixed.** `byTouch` survived beyond the touch interaction, causing controlled cards to ignore later real-mouse hover closes. Red-first tests reproduced mouse transition, already-positioned cursor, cancelled touch, keyboard reopening, and direct entry into an interactive card. The exemption now clears on close, cancellation, or real mouse activity. Existing child and Floating UI handlers remain composed exactly once.
- **CR-2 — P3 — Report only, pre-existing.** [tooltips.md](/home/greg/code/spideryarn2/.claude/worktrees/fbeqcbay-search-results-room-on-ipad/docs/project/tooltips.md:554) says Structure cards are hover/focus-only and unavailable to fingers, but [StructurePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbeqcbay-search-results-room-on-ipad/src/web/StructurePanel.tsx:390) now uses `useTapReveal`.

No CSS, visitor-panel, empty-list, legend-removal, handler-composition, or remaining controlled-tooltip regression found. Safari remains unmeasured, as the plan accurately states.

Checks:

- Requested four files: 81 tests passed.
- Controlled-tooltip unit sweep: 56 files, 985 tests passed.
- Typecheck passed for all 2,920 files via `node --import tsx`; the npm wrapper itself hit sandbox IPC `EPERM`.
- Doc links: 16 passed.
- Lint passed on touched code.
- Full/Postgres suites skipped because no database or local service is available.

Files changed:

- [Tooltip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbeqcbay-search-results-room-on-ipad/src/web/Tooltip.tsx:213)
- [search-hit-card-on-the-score.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbeqcbay-search-results-room-on-ipad/tests/search-hit-card-on-the-score.test.tsx:295)
- [band-about.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbeqcbay-search-results-room-on-ipad/tests/band-about.test.tsx:156)
- [tooltips.md](/home/greg/code/spideryarn2/.claude/worktrees/fbeqcbay-search-results-room-on-ipad/docs/project/tooltips.md:600)
- [261003p plan](/home/greg/code/spideryarn2/.claude/worktrees/fbeqcbay-search-results-room-on-ipad/docs/plans/261003p-search-results-get-the-room-on-a-landscape-ipad.md:156)
- [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/fbeqcbay-search-results-room-on-ipad/docs/postmortems/261004a-input-modality-must-expire-with-the-interaction-it-qualifies.md:1)

The pre-existing review prompt and screenshot were not touched.