# Code review, Stage 2: /admin/vouchers' Given table on DataTable, via `renderRow` (261021i)

You are a reviewer **who also fixes**, in this git worktree (the current directory). Fix what is
inside this stage, narrowly, and red-first (a test that fails before your fix). **Report, do not
fix,** anything wider you notice. Do not commit; do not run git commands that discard work.

## The candidate (committed)

- Commit `3a60c45b3` (parent `f4b5b71d6`, a merge of origin/dev). Diff: `git diff f4b5b71d6 3a60c45b3`.
- Changed paths: `src/web/lib/DataTable.tsx` (`renderRow`, `RowDress`, `dressFor`),
  `src/web/admin-vouchers-columns.tsx` (new), `src/web/AdminVouchersPage.tsx` (`VoucherRow`, the
  Given tab), `src/web/params.ts`, `tests/admin-vouchers-page.test.tsx`, `docs/project/admin.md`,
  `docs/project/web-client.md`, and the plan.
- The plan: `docs/plans/261021i-admin-tables-share-one-sortable-hideable-table.md` — § Stage 2 and
  the Progress entries. The plan review (`…-plan-review-sol.md`) F2, F3, F5 and F7 are this stage's;
  Stage 1's code review is `…-stage1-code-review-sol.md` (the shared hook it relies on).

## What to do

Independent attack first:

1. **Identity (F2).** Can a voucher's in-progress edit, refusal or saved message ever end up on, or
   PATCH, a different voucher — after a re-sort, a refresh that adds/removes a voucher, a hide/show,
   or a tab switch and back? Can focus management (`firstField`, `editButton`) break?
2. **The default row is unchanged**: `dressFor` and the default `<tr>`/`<td>` produce exactly the
   classes and attributes they did before (shelf, /admin/users, /admin/articles, /admin/costs
   rankings). Compare against the parent commit.
3. **`form=` across cells**: every input still belongs to its row's form whatever is hidden; nothing
   hideable carries the form.
4. **Exhaustiveness (F3)**: is a new id in `VOUCHER_COLUMN_IDS` really a compile error until drawn
   and defined? Is there any path where a visible cell draws nothing?
5. Sorting semantics: Status rank matches what `Status` draws (revoked wins), notes' blank-as-missing,
   Created default = the old order, the usage column unsortable; URL coexistence with `?tab=` and
   `?gift=`.
6. Look and layout: the inner `<div>` approach to the cells' own style; widths now that every
   non-fluid header is `w-0` and the table has no fluid column; the sr-only caption/header clipping
   that the old comment warned about (page-level sideways scroll at 390px).
7. Tests fail when the behaviour breaks? Run:
   `npx vitest run tests/admin-vouchers-page.test.tsx tests/admin-articles-page.test.tsx tests/admin-page.test.tsx tests/data-table-pin-first.test.tsx tests/shelf-table-hide-columns.test.tsx tests/shelf-table-row-card.test.tsx tests/admin-costs-page.test.tsx`
   and `npm run typecheck` (if the npm wrapper fails in the sandbox, `node --import tsx scripts/typecheck.ts`).
8. Docs: are admin.md and web-client.md true of the code?

## Severity and verdict

P0 data loss, exploitable security, incorrect charging or service broadly unusable · P1 user-visible
wrong behaviour or an authoritative contract violated · P2 design/maintainability risk with no wrong
behaviour today · P3 prose. Refuse only on an *established* P0/P1. Each finding: ID (D1, D2…),
severity, evidence (file:line), and either "fixed: <what, which test>" or "reported: <proposed fix>".

End with one line: `VERDICT: APPROVE`, `VERDICT: APPROVE WITH CHANGES`, or `VERDICT: REJECT`.

## My own suspicions (already mine, worth less)

- `RowDress.rowProps` is a fixed object shape; does `VoucherRow` spread it in a way that can lose
  its own props or class?
- Status's first click is descending (claimed first). Is that the natural end an admin expects?
