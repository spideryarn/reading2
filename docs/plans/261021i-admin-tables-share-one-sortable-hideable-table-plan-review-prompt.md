# Plan review: the admin tables share one sortable, hideable table (261021i)

You are reviewing a **plan**, read-only. Repository: the current working directory (a git worktree of
Spideryarn, a TypeScript + React + Tailwind v4 reading app). Base: `origin/dev` as of this worktree.

## The candidate (live, uncommitted; untracked files)

- `docs/plans/261021i-admin-tables-share-one-sortable-hideable-table.md` — the plan. **Read it first.**
- `docs/research/261021a-table-library-for-sortable-hideable-columns.md` — the library re-selection it
  rests on. Read it as a reviewer of its *conclusions*, not only its prose.

## The code it is about (start here; it does not limit scope)

- `src/web/lib/DataTable.tsx` — the shared TanStack Table v8 seam (sorting, hiding, held first column).
- `src/web/lib/table-sort.ts`, `src/web/shelf-hidden-columns.ts`, `src/web/params.ts` (search
  `adminByParam`, `libraryByParam`).
- `src/web/AdminPage.tsx` § `AdminUsersPage` and `src/web/admin-columns.tsx` — the table Greg called
  "more functional".
- `src/web/AdminArticlesPage.tsx` — the hand-drawn table he filed the report from.
- `src/web/AdminVouchersPage.tsx` § `VoucherRow` and the *Given* table (~line 1580).
- `src/web/AdminCostsPage.tsx` § `PivotTable`, `FailureCountsTable`.
- Tests: `tests/admin-page.test.tsx`, `tests/admin-articles-page.test.tsx`,
  `tests/admin-vouchers-page.test.tsx`, `tests/data-table-pin-first.test.tsx`,
  `tests/shelf-table-hide-columns.test.tsx`, `tests/eager-client-graph.test.ts`.
- `docs/postmortems/260827e-shelf-render-loop.md` — the identity trap this seam has fallen into once.

## What to do

An independent attack on the plan first:

1. Is the library conclusion right — keep TanStack Table, headless, and the stated v8/v9 verdict?
   Anything in the research doc that is wrong, stale or unsupported?
2. Is the scope right — which admin tables move, which do not, and the reasons given? Is anything
   Greg asked for missing, or anything built that he did not ask for?
3. Will each stage work as described against the actual code? In particular: the shared hook
   extracted from `AdminUsersPage` (identity/memoisation, the URL state, `sinkLast`, the
   eager-graph rule); the `byParam(defaults)` factory; the articles columns (sorting missing titles,
   costs with no calls, the default sort reproducing today's order); Stage 2's `renderRow` escape hatch
   and `VoucherRow`'s cross-cell `form=` attribute, the `?tab=` param coexisting with `?by=&dir=`.
4. Is there a simpler design that gets the same result?
5. What tests would catch a regression the plan does not name?

## Severity and verdict

P0 data loss, exploitable security, incorrect charging or service broadly unusable · P1 user-visible
wrong behaviour or an authoritative contract violated · P2 design/maintainability risk with no wrong
behaviour today · P3 prose. Refuse only on an *established* P0/P1 (direct evidence, no unresolved
inference). Give each finding an ID (F1, F2…), a severity, the evidence (file:line), and a concrete fix.

End with one line: `VERDICT: APPROVE`, `VERDICT: APPROVE WITH CHANGES`, or `VERDICT: REJECT`.

## My own suspicions (already mine, worth less — spend most of the run elsewhere)

- Whether `renderRow` is the least-bad way to keep `VoucherRow`'s state, versus lifting edit state
  into a context keyed by voucher id.
- Whether sorting the vouchers' *Status* column has a sensible rank.
- Whether leaving the costs failure tables alone contradicts "using that throughout".
