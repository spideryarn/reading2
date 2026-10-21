# The admin tables share one sortable, hideable table

**Report:** `spya-k8mka5` (#670), an administrator's suggestion filed from `/admin/articles` on build
`804e055b`, 2026-10-21 15:53 UTC. `feedback-reporter.ts` exit 0, no addenda.

> It looks like the way we're displaying the table here is different from the way we're displaying
> the table in /users. And the /users one, I think perhaps it was more functional?
>
> Either way, I feel like we should find a really good library for displaying tables that allows you
> to sort columns and maybe hide columns, and perhaps be using that throughout.
>
> see third-party-library-selection.md etc
>
> — Greg, 2026-10-21 (`spya-k8mka5`)

## What is already true, and so what this job really is

**The library was chosen on 2026-08-26, and it is still the right one.** The shelf adopted
TanStack Table v8 (headless) after a hand-built version, and
[`src/web/lib/DataTable.tsx`](../../src/web/lib/DataTable.tsx) wraps it: every `<th>` and `<td>` is
ours, sorting (click, shift-click for a second key, the sort in the URL), hiding (a Columns menu and
a right-click on a header, remembered per browser), a frozen first column, a marked row, and the
sideways-scroll box. `/admin/users` uses it; that is why Greg found it "more functional".

The re-run of the selection, with today's alternatives and the v8-or-v9 question, is
[docs/research/261021a-table-library-for-sortable-hideable-columns.md](../research/261021a-table-library-for-sortable-hideable-columns.md).
**No new dependency.** (The brief allowed one; the research found no reason to take it.)

So the work is **adoption, not selection**: the admin tables drawn by hand move onto the seam that
already exists. Today:

| Page | Table | Today | After |
|---|---|---|---|
| `/admin/users` | accounts | `DataTable` | unchanged, but its sort wiring moves into a shared hook |
| `/admin/costs` | rankings | `DataTable` | unchanged |
| `/admin/articles` | articles | hand-drawn, one `<select>` with two orders | **`DataTable`** — Stage 1 |
| `/admin/vouchers` | *Given* | hand-drawn, a row turns into a form | **`DataTable`** with a page-drawn row — Stage 2 |
| `/admin/costs` | pivot, failures | hand-drawn | **left alone** — see § Not doing |
| `/admin/feedback` | — | cards, deliberately | not a table (AdminFeedbackList.tsx § Why cards) |

## Stage 1 — `/admin/articles` on `DataTable`, and the sort wiring shared

1. **A shared hook for "a `DataTable` whose sort is in the URL and whose hidden columns are
   remembered"**, extracted from `AdminUsersPage` (`AdminPage.tsx` ~lines 320–375): the
   `sortingFromUrl` / `functionalUpdate` / `sortingToUrl` / `isAllNatural` dance, `useHiddenColumns`,
   `useSortedTable`, and the `sinkLast` on the primary key. It takes the columns, data, `rowId`, the
   page's `by` parser and the hidden-columns keys, and returns `{ table, rows }`. **Its identity
   contract is written on it** (Sol F4): `data` may be `null` and is normalised through a stable
   module-level empty array; `columns` must be memoised by the caller; `rowId` must be module-scope.
   The hook cannot repair a fresh array handed to it, so it says so. `/admin/users`
   moves onto it in the same stage, so there is one copy, not two (house rule: reuse, not a second
   way). Lives in `src/web/lib/` beside `DataTable.tsx`, and must not be imported by anything eager
   (tests/eager-client-graph.test.ts).
2. **A `by` parser per page from one factory.** `libraryByParam` and `adminByParam` in `params.ts`
   are already the same parser with different defaults; a third copy would be the wrong move. A
   `byParam(defaults)` factory makes all three; `ADMIN_ARTICLES_DEFAULT_BY = ["added"]` sits beside
   `ADMIN_DEFAULT_BY` (params.ts is eager — keep it to the constant).
3. **`admin-articles-columns.tsx`**, the way `admin-columns.tsx` is for users:
   - *Article* — fluid, held (`pinFirst`), `enableHiding: false`, sorted A–Z by title; a row with no
     title (another reader's private article) sorts as missing, so it sinks.
   - *Owner* — the address (or id), "(you)" on yours; A–Z.
   - *Added* — date, newest first; **the default sort**, which is today's order.
   - *Visibility* — Public / Private; sortable.
   - *Read* — In full / Abstract only; sortable.
   - *Total cost* — numeric, highest first, the `+` floor and the `—` as today, with the cost tip on
     the cell and its sr-only words. Sorted by `cost.nanos`, **missing (sinks) whenever no call was
     priced** — `calls − unpricedCalls === 0`, which covers both no calls and all-unpriced, the two
     cases drawn as `—` — and zero only when a priced call really recorded `$0.00` (Sol F1). **Equal
     costs fall back to newest first**, today's tiebreak and a test's: the cost `sortingFn` compares
     `createdAt` on a tie. Inside a `sortingFn` that tiebreak reverses with the arrow (DataTable.tsx
     header), so ascending ties read oldest first; accepted and commented, since the alternative
     (a hidden second sort key) shows a chip nobody asked for. Tests: no calls, all unpriced, a
     priced zero, a floor, and equal costs in both directions.
   - *Actions* — Transfer…, View as owner; not sortable, not hideable.
   Nothing starts hidden: seven columns fit today and none is noise.
4. **The page**: the order `<select>` goes (the chips and the headers replace it — "highest total
   cost first" is one click on Total cost); the filter, the count (`N of M`, counted off the drawn
   rows), Refresh, the transfer confirmation and *View as* stay exactly as they are. Hidden columns
   remembered under `spya.admin.articles.hiddenColumns` / `…shownColumns`. Sort in `?by=&dir=`.
5. **Tests** in `tests/admin-articles-page.test.tsx`: the existing ones that read `inOrder` or the
   `<select>` are rewritten against header clicks; new: a header click sorts and writes `?by=`; a
   column can be hidden from the Columns menu and stays hidden on remount; private rows sink when
   sorted by title either way; the Article column is still held. `tests/admin-page.test.tsx` must
   stay green untouched — it is the proof the hook extraction changed nothing for users.
6. **A line at the top of `DataTable.tsx`: we are on v8, and v9's docs will not match.** `npm i
   @tanstack/react-table` now installs v9, and the current docs show v9's API (research doc §
   Surprising), so the next agent should read this file rather than the library's site.

**Done:** typecheck, the touched suites and doc-links green; a browser pass at 1280 and 390.

## Stage 2 — `/admin/vouchers` *Given* on `DataTable`

The table's own comment says why it was left hand-drawn: *"a row that turns into a form, which a
TanStack cell renderer would make harder to read"*. True of TanStack's cell renderers — each cell
renders on its own, and the edit state (ten `useState`s, the focus refs, the form id) belongs to the
row. So the seam gets one small escape hatch rather than the row being torn apart:

- **`DataTable` takes an optional `renderRow`**: given it, the body draws `renderRow(row, cellClass)`
  instead of its own `<tr>`, **wrapped by `DataTable` in `<Fragment key={row.id}>`** so identity is
  the seam's guarantee rather than each caller's (Sol F2): a re-sort must move a half-edited row's
  state with its voucher, never leave it at the old position to PATCH a different id. Test: start
  an edit, change a field, re-sort so the row moves, save, and assert the PATCH URL and body are
  the original voucher's; again with another column hidden. `cellClass(columnId)` returns the same padding / fixed-or-fluid /
  numeric / held / marked classes the default row uses, so the two cannot drift. Headers, sorting,
  hiding, the held column and the scroll box are unchanged.
- **`VoucherRow` keeps its state and draws `row.getVisibleCells()`.** TanStack types
  `column.id` as plain `string`, so a `switch` with `never` would not be exhaustive (Sol F3).
  Instead one ordered tuple `VOUCHER_COLUMN_IDS` gives a `VoucherColumnId` union; the row's cell
  drawers are a `Record<VoucherColumnId, …>` built inside the row (so they close over its state),
  and the column definitions are checked against the same union — a new id is a compile error in
  both places. An id outside the union at runtime draws nothing and is a test failure.
- **Columns** (Sol F5 settled each one): Email (held, not hideable, A–Z), Articles (numeric, most
  first), Note to them, Private note (A–Z, empty as missing), Created (**the default**, newest first
  — today's order), Status (rank as `Status` draws it: *Revoked* wins over everything, then
  *Waiting for sign-up*, then *Claimed*), Claimant's free usage (**not sortable**: it is a composite
  with no one honest scalar), Actions (not sortable, not hideable). The caption becomes
  order-neutral ("Every voucher given") — "newest first" is false once sorted.
- Sort in the URL (`?by=&dir=`, through the same hook) — on the *Given* tab only; `?tab=` is
  already in the URL, so the two must coexist. Tests: a sort keeps `tab=given`; a tab change keeps
  the sort; a reload with all three restores all three. Hidden columns under `spya.admin.vouchers.*`.
- Tests: editing a row still works after sorting and after hiding a column (the `form=` attribute
  ties inputs to the form in the Actions cell — **if Actions is hidden the form is gone**, which is
  why Actions is not hideable); an exhaustive switch.

**Docs (Sol F7):** `admin.md` § vouchers stops saying "a plain table rather than `DataTable`", and
says what `renderRow` is for; `web-client.md` § Shared code (client) names the shared hook and the
escape hatch. Stage 1 does the same for `/admin/articles` in `admin.md`.

**Done:** as Stage 1, plus a browser pass that edits a voucher.

## Not doing, and why

- **The `/admin/costs` pivot**: its columns are data (one per value of the column dimension), it has
  a totals row and column, and the total sits beside the label on purpose. Sorting it by header and
  hiding its columns are a different feature from this one; already argued in AdminCostsPage.tsx §
  `PivotTable`.
- **The `/admin/costs` failure tables — all three** (Sol F6 counted them): *by day* is a calendar,
  and a re-sort stops it reading as one; *by task* is ranked by total trouble and *causes* by
  commonest first (`src/cost-cube.ts`), both orders that are the point of the table. Worth doing
  only if Greg asks.
- **`/admin/feedback`** is cards, for the reason in AdminFeedbackList.tsx.
- **Moving to TanStack Table v9**: see the research doc's verdict. Not inside this job either way: it
  would touch the shelf too, and it is a dependency upgrade, not an admin change.

## The simpler option passed over

Restyle the articles table to *look* like users (headers, density) without sortable columns. Less
code, but it is exactly the "different from /users" Greg reported, kept, with a coat of paint.

## Risks

- **The hook extraction is the shared-code risk**: `/admin/users` is the one table that works today.
  Its test file staying green unedited is the gate.
- **Render loops**: `sorting` and `columns` must keep identity (docs/postmortems/260827e). The hook
  memoises exactly as `AdminUsersPage` does now; `rowId` at module scope.
- **Vouchers' `form=` attribute** spans cells; a hidden Actions column would orphan every input. Hence
  `enableHiding: false` on Actions, and a test.

## Progress

- 2026-10-21: plan written; research doc commissioned and written (Sonnet).
- 2026-10-21: GPT Sol plan review round 1 —
  [261021i-…-plan-review-sol.md](261021i-admin-tables-share-one-sortable-hideable-table-plan-review-sol.md),
  `VERDICT: REJECT` on two P1s, both gaps in the plan's specification rather than in its
  direction (it endorsed TanStack, v8, the scope and `renderRow` over a context). All eight findings
  taken: F1 and F5 into the column rules above, F2 the keyed fragment, F3 the id tuple, F4 the
  hook's identity contract, F6 all three costs tables named, F7 the docs, F8 the research doc's
  slips corrected. The two P1 fixes are not in round 1's snapshot; their check is the code
  review's, which sees them as code with the tests named above, rather than a second plan round.
- 2026-10-21: **Stage 1 built** (Opus). `src/web/lib/useUrlSortedTable.ts` (the default sort is read
  off `byParam.defaultValue`, so it lives in one place), `byParam(defaults)` in params.ts making all
  three parsers, `src/web/admin-articles-columns.tsx` (ids `title`, `owner`, `added`, `visibility`,
  `read`, `cost`, `actions`), the page on `DataTable`, `/admin/users` on the hook with its test file
  unedited and green (30/30). Differences from the plan: rows with no priced call also tie-break on
  the date, so the dashes read newest first too; the cost tiebreak inside the `sortingFn` means a
  shift-clicked second key never decides between equal costs (accepted, commented); chips on their
  own row; every column but Article now single-line `text-xs`, as on `/admin/users`;
  `tests/view-as-admin-buttons.test.tsx` mounts this page and needed a `NuqsAdapter`. New tests were
  shown red by mutation (no sink, no tiebreak, the F1 rule wrong). Full suite green.
- 2026-10-21: Stage 1 browser pass (Sonnet, own dev server from this worktree, 1280 and 390): all
  eight checks pass — sort by header writes `?by=`, hide survives reload, Article held at 390, no
  page-level sideways scroll, Transfer after a re-sort names the right article, `/admin/users`
  unchanged, no console errors. Only the header's label is the sort button, not the whole cell —
  the same as `/admin/users`, since both are the one `HeaderCell`.
- 2026-10-21: Stage 1 GPT Sol code review —
  [stage1-code-review-sol.md](261021i-admin-tables-share-one-sortable-hideable-table-stage1-code-review-sol.md),
  `APPROVE WITH CHANGES`, no P0/P1. It added three tests (C1 Transfer and View as reach the right
  row after a re-sort; C2 `?user=` marking survives a re-sort; C3 the filter and the count on the
  drawn page). C4, reported not fixed and wider than this job: tests/eager-client-graph.test.ts
  names only `AdminPage.tsx` and `DesignPage.tsx` as lazy admin roots, so a newer admin page's
  private import could reach the eager graph unnoticed. Not taken here; queued in the debrief.
- 2026-10-21: **Stage 2 built** (Opus). `renderRow?: (row, dress: RowDress)` on `DataTable`, where
  `RowDress` carries the `<tr>` props as well as `cellClass` (a held cell's hover tint needs the
  row's `tw:group`); one `dressFor` builds both, and the default row is drawn from it with its class
  strings unchanged. `src/web/admin-vouchers-columns.tsx` holds `VOUCHER_COLUMN_IDS` and the typed
  columns; `VoucherRow` keeps its state and draws its visible cells through a
  `Record<VoucherColumnId, …>`. Differences: the voucher cells' own look (normal size, wrapping,
  greyed when revoked) sits on an inner `<div>`, because putting it on the `<td>` beside the shared
  `text-xs` would leave the winner to stylesheet order; Status ranks revoked 0, waiting 1, claimed 2
  and first click is descending (claimed first, revoked at the foot), ties newest first under that
  arrow. Mutation-proven: index keys fail both identity tests, revoked losing fails Status, a blank
  note not missing fails the sink test, a hideable Actions fails the menu test. Full suite green.
