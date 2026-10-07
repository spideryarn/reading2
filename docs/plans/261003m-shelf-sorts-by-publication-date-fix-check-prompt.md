A narrow check of one follow-up commit. Read-only: change nothing.

Commit: `git show 59545ce12` (HEAD). Your own three fixes from the earlier review ride in it (C1 to
C3); do not re-review those. Review only what is new and mine:

- src/web/shelf-hidden-columns.ts — a column with `meta.startsHidden` is hidden until the reader
  shows it; the readers who showed one are remembered under a second localStorage key,
  `spya.shelf.shownColumns`. The first key keeps listing only columns that start shown.
- src/web/lib/DataTable.tsx — `startsHidden?: boolean` on `ColumnMeta`.
- src/web/library-columns.tsx — `startsHidden: true` on the `published` column.
- tests/shelf-table-hide-columns.test.tsx — the tests for it.

Why: a browser check measured the shelf table at 924px in an 846px container at 1440 once Published
was a sixth data column, with Actions past the right edge. Plan:
docs/plans/261003m-shelf-sorts-by-publication-date.md § Code review and browser check.

Run: npx vitest run tests/shelf-table-hide-columns.test.tsx

Check:
1. Any stored state (either key present, absent, malformed, or naming the other key's columns) for
   which a column that cannot be hidden is hidden, Published shows for a reader who never asked, or
   a reader's earlier choice is lost.
2. The `visibility` state identity: does the hook still return the same object across renders that
   change nothing (the render-loop history in lib/DataTable.tsx)? `canHide` is rebuilt every render;
   is anything memoised on it?
3. Does any other consumer of `libraryColumns` or `useSortedTable` (the /design page, /admin, tests)
   now behave differently?
4. Any new test that passes with `startsHidden` ignored.
5. Is the second key more machinery than needed? Name a simpler design that keeps both properties:
   hidden for a reader whose saved list predates the column, and remembered once shown.

Findings as P0/P1/P2 with an ID each (D1, D2, …) and file:line. One-line verdict: land, land after
fixes, or do not land.
