SHIP AFTER FIXES (made)

Findings, ranked:

- P2 — Fixed stale comments in [Dock.tsx](/var/tmp/spideryarn-worktrees/fbhdde62-more-button-after-summary/src/web/Dock.tsx:3398) and corrected the obsolete phone coordinates in [dock-fit.ts](/var/tmp/spideryarn-worktrees/fbhdde62-more-button-after-summary/src/web/dock-fit.ts:193).
- P2 — Fixed a coverage gap in [dock-groups.test.tsx](/var/tmp/spideryarn-worktrees/fbhdde62-more-button-after-summary/tests/dock-groups.test.tsx:90): both Dock arms now assert Summary owns `data-more-home`; a direct test covers the no-Summary fallback, placing More at the end and marking the last row as home.
- No P1/P0 or wider findings. Both arms, Metadata, open gathered modes, separators, and phone-leading behavior are correct.

Verification:

- Focused suite: 17 files passed; 395 passed, 1 skipped.
- Old-order mutation: 16 tests failed across four focused files, confirming genuine red coverage.
- Typecheck: all four projects passed; all 3,712 source files covered. The exact npm launcher hit sandbox-denied `tsx` IPC, so the same script ran successfully through `node --import tsx`.
- Scoped lint passed with one pre-existing Dock complexity advisory.
- Full `npm test` could not start because the sandbox cannot reach the local Postgres/Docker service.
- Help-page images were untouched.