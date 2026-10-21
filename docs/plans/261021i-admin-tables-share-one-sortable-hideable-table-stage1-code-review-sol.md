No P0/P1 defects found. Implementation behavior and docs match Stage 1.

- C1 — P2 — Action identity after re-sort was untested. Fixed: added red-proven regression coverage for Transfer and View-as targeting the correct article/owner after rows move: [admin-articles-page.test.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/admin-articles-page.test.tsx:334), [view-as-admin-buttons.test.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/view-as-admin-buttons.test.tsx:164).
- C2 — P2 — `/admin/users` tests did not combine `?user=` with re-sorting. Fixed: the new test verifies the parameter, marked row, and one-time scrolling survive sorting: [admin-page.test.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/admin-page.test.tsx:723).
- C3 — P2 — Article filtering tested only `matchesFilter`, not the rendered rows or `N of M` count. Fixed: added the live UI assertion: [admin-articles-page.test.tsx](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/admin-articles-page.test.tsx:417).
- C4 — P2 — reported, wider: the eager-client guard describes all administrator pages but its route closure still contains only `AdminPage.tsx` and `DesignPage.tsx`, and its private-module list omits newer admin routes: [eager-client-graph.test.ts](/var/tmp/spideryarn-worktrees/fbk8mka5-admin-tables-library/tests/eager-client-graph.test.ts:75). Proposed fix: derive or enumerate every lazy admin route root so future route-private imports cannot enter the eager graph unnoticed. Current Stage 1 imports were inspected and remain lazy.

The cost tiebreak/multi-sort behavior is deliberate and documented; `readonly T[]` is a safe widening because `useSortedTable` copies before sorting. The `byParam` factory preserves parsing, serialization, equality, defaults, and push-history behavior.

Checks:

- Focused suite: 115/115 passed.
- Typecheck: all projects passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper itself hit sandbox-denied `tsx` IPC.
- Lint: no errors; one pre-existing style advisory.
- Full `npm test`: could not start its private lane because no local database was available.
- No commit made.

VERDICT: APPROVE WITH CHANGES