# Code review, Stage 1: /admin/articles on the shared DataTable (261021i)

You are a reviewer **who also fixes**, in this git worktree (the current directory). Fix what is
inside this stage, narrowly, and red-first (a test that fails before your fix). **Report, do not
fix,** anything wider you notice. Do not commit; do not run git commands that discard work.

## The candidate (committed)

- Commit `542a37c40` on top of `e5b0b90f7` (plan + research). Diff: `git diff e5b0b90f7 542a37c40`.
- Changed paths: `src/web/lib/useUrlSortedTable.ts` (new), `src/web/admin-articles-columns.tsx` (new),
  `src/web/AdminArticlesPage.tsx`, `src/web/AdminPage.tsx`, `src/web/lib/DataTable.tsx`,
  `src/web/params.ts`, `tests/admin-articles-page.test.tsx`, `tests/view-as-admin-buttons.test.tsx`,
  `docs/project/admin.md`, `docs/project/web-client.md`, and the plan.
- The plan: `docs/plans/261021i-admin-tables-share-one-sortable-hideable-table.md` — § Stage 1 and the
  Progress entries; the plan review that shaped it is `…-plan-review-sol.md` beside it (its F1 and F4
  are this stage's).

## What to do

Independent attack first:

1. Does `/admin/users` behave exactly as before the hook extraction (URL sort, `?user=` marking and
   scrolling, hidden columns, chips, the count)? `tests/admin-page.test.tsx` passing unedited is the
   claim; find what it does not cover.
2. Render-loop and identity hazards (docs/postmortems/260827e-shelf-render-loop.md): every input to
   `useSortedTable`/`useReactTable` that must keep identity — in both pages.
3. The `byParam` factory: is `libraryByParam` byte-for-byte the same behaviour as before (defaults,
   `eq`, history), and is anything heavy now imported eagerly (tests/eager-client-graph.test.ts)?
4. The articles columns: the cost rule (missing when no priced call; a priced `$0.00` is zero), the
   date tiebreak in both directions, untitled rows sinking, the filter, the count, Transfer and View
   as still reaching the right row after a re-sort, a11y of headers (`aria-sort`, label-in-name).
5. Do the tests fail when the behaviour breaks? Run them:
   `npx vitest run tests/admin-articles-page.test.tsx tests/admin-page.test.tsx tests/view-as-admin-buttons.test.tsx tests/table-sort.test.ts tests/eager-client-graph.test.ts tests/data-table-pin-first.test.tsx tests/shelf-table-hide-columns.test.tsx`
   (they need nothing outside the tree). Also `npm run typecheck`.
6. Docs: is what admin.md and web-client.md now say true of the code?

## Severity and verdict

P0 data loss, exploitable security, incorrect charging or service broadly unusable · P1 user-visible
wrong behaviour or an authoritative contract violated · P2 design/maintainability risk with no wrong
behaviour today · P3 prose. Refuse only on an *established* P0/P1. Each finding: ID (C1, C2…),
severity, evidence (file:line), and either "fixed: <what, which test>" or "reported: <proposed fix>".

End with one line: `VERDICT: APPROVE`, `VERDICT: APPROVE WITH CHANGES`, or `VERDICT: REJECT`.

## My own suspicions (already mine, worth less)

- The cost tiebreak lives inside the `sortingFn`, so a shift-clicked second key never breaks a cost
  tie. Acceptable, or a real surprise to an admin?
- `useSortedTable`'s `data` became `readonly T[]` — any caller affected?
