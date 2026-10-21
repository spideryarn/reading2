# A table library for sortable, hideable columns: keep TanStack Table, stay on v8 for now

Up: [research.md](../project/research.md)

Research done 2026-10-21, following
[third-party-library-selection.md](../reusable/third-party-library-selection.md). It feeds the plan
[261021i](../plans/261021i-admin-tables-share-one-sortable-hideable-table.md). **Conclusion: we
already have the right library. Keep TanStack Table, headless, behind `src/web/lib/DataTable.tsx`,
and put `/admin/articles` and `/admin/vouchers` on it. Do not move to v9 as part of this work.** The
reason `/admin/articles` looks different from `/admin/users` is that it never adopted the shared
table, not that the library is wrong.

> It looks like the way we're displaying the table here is different from the way we're displaying
> the table in /users. And the /users one, I think perhaps it was more functional? Either way, I
> feel like we should find a really good library for displaying tables that allows you to sort
> columns and maybe hide columns, and perhaps be using that throughout. see
> third-party-library-selection.md etc
>
> — Greg, 2026-10-21 (`spya-k8mka5`)

## What we need

Tens to low hundreds of rows. Sort by clicking a header (shift-click for a second key), hide and
show columns, a pinned first column, sort in the URL, hidden columns remembered. Drawn in our
Tailwind v4 (`tw:` prefix) and Radix/shadcn style, so it must not bring its own look. No
pagination, no virtualisation, no editing, no grouping.

## Where we already are

[260826y-library-sorting.md § 1](../plans/260826y-library-sorting.md) chose TanStack Table v8 on
2026-08-26, after building sorting by hand, and rejected AG Grid (about 330 kB), MUI DataGrid and
Mantine React Table (wrong ecosystem). `DataTable.tsx` is the result: sorting, the Columns menu, the
right-click header menu, sticky first column. `/admin/users`, `/admin/costs` rankings and the shelf
use it; `/admin/articles` and `/admin/vouchers` are hand-drawn. That is the whole gap.

## The options, as of 2026-10-21

Numbers from `npm view` and the npm downloads API, today.

| Library | Version, last release | Weekly downloads | Style | Fit |
|---|---|---|---|---|
| **TanStack Table** (`@tanstack/react-table`) | 9.3.1, 2026-10-12 (v8 last: 8.21.3, 2025-04-14) | about 13.9M | Headless: we draw everything | Already adopted; matches Tailwind and Radix |
| AG Grid Community | 36.2.0, 2026-09-16 | about 1.9M | Full grid, own theming (Quartz etc.) | Heavy (about 21 MB unpacked); fighting its theme to match Tailwind; the features we would want beyond sort and hide are Enterprise |
| MUI X DataGrid | 9.16.0, 2026-10-20 | about 1.6M | Material UI components | Needs the MUI and Emotion ecosystem; wrong look and wrong stack |
| Material React Table | 3.2.1, 2025-03-01 | about 169k | TanStack v8 inside MUI | Same ecosystem problem; no release in 7 months |
| Mantine React Table | 1.3.4, 2025-02-17 | about 58k | TanStack v8 inside Mantine | Wrong ecosystem and effectively dormant |
| react-data-grid | 7.0.0-beta.62, 2026-10-19 | about 381k | Spreadsheet-like grid with its own CSS | Still a beta after years; built for editing and virtualised large grids, not a content table |
| Glide Data Grid | 6.0.3, 2026-09-16 | about 219k | Canvas-drawn | Canvas means no real DOM cells, no Tailwind, poor accessibility; built for millions of rows |
| shadcn "Data Table" | not a package | n/a | A recipe on TanStack Table | This is what we have already, written by hand |

No newer headless table library has overtaken TanStack on community (and, plausibly, on how much
of it a coding model has seen — an inference from downloads and age, not a measurement); the
2026 comparison articles I found all still treat it as the default headless choice. The one
"emerged" thing is TanStack itself shipping v9.

On the selection criteria: TanStack has by far the largest community (7 times the next library by
downloads, and the shadcn docs are written on it), so LLMs know it well, and its types are the best
of the group. It is also the only option here that draws none of the UI, which is the property
that keeps `/admin/*` and the shelf looking like Spideryarn.

## v8 now, or v9?

**v9 is real and stable.** Announced 2026-08-04 as "finally here and stable" after about 80 betas.
Since then 9.0.0 through 9.3.1 (about ten releases in ten weeks; a gap in September, then four in
October). The package is `@tanstack/react-table`; `npm install` now gives 9.x by default.

**What changed** (migration guide and announcement, linked below):

- `useReactTable` becomes `useTable`.
- A required `features` option, built with `tableFeatures({...})`. Features are opt-in and
  tree-shakeable (`stockFeatures` restores the v8 set). Row models move into it:
  `getSortedRowModel()` becomes `sortedRowModel: createSortedRowModel()` (`getCoreRowModel` is
  automatic). Registering a sort function without the sorting feature is now a type error.
- State is built on TanStack Store: `table.getState()` is replaced by `table.state` or
  `table.atoms.<slice>`; `onStateChange` is gone; per-slice handlers such as `onSortingChange` and
  controlled `state` still work.
- Renames: `sortingFn` becomes `sortFn`; column pinning `left`/`right` becomes `start`/`end`;
  `createColumnHelper` needs the features type; `RowData` must be an object or array; row, cell,
  column and header methods must be called on the instance, not destructured.
- `ColumnMeta` augmentation still works but takes the features type as its first generic.
- `useLegacyTable` (from `@tanstack/react-table/legacy`) accepts the v8 API on v9 internals, but is
  marked deprecated and includes every feature.
- Claimed gains: faster client-side row models (1.5x to 3.9x), up to 86% less retained heap in a
  big paginated test, and smaller bundles for small tables (about 6 to 7 kB against 15 to 20 kB in
  v8). The full package, though, grew from about 14 kB to about 25 kB.

**Does `DataTable.tsx` carry over?** Almost certainly, with real edits. Our use: `useReactTable`,
`getCoreRowModel`, `getSortedRowModel`, a `ColumnMeta` augmentation with seven fields, controlled
`sorting` and `columnVisibility`, `sortDescFirst`, `enableMultiSort`. Each has a v9 equivalent
including `sortUndefined` and `enableSortingRemoval`, both in the
[v9 sorting guide](https://tanstack.com/table/latest/docs/framework/react/guide/sorting) (a first
draft of this doc said they could not be confirmed; GPT Sol's plan review found them). The third
load-bearing option, `autoResetPageIndex: false`, guards a render loop
([260827e-shelf-render-loop.md](../postmortems/260827e-shelf-render-loop.md)); in v9 pagination is
an opt-in feature ([migration guide](https://tanstack.com/table/latest/docs/framework/react/guide/migrating)),
so not registering it should remove the hazard, but that is untested.

**Estimated cost:** a focused half-day to a day for the one file (about 980 lines, but the library
touch points are a few dozen), plus its callers `Library.tsx`, `library-columns.tsx`,
`shelf-hidden-columns.ts`, `ShelfControls.tsx`, `AdminPage.tsx`, `AdminCostsPage.tsx`, and
`table-sort.ts`. Then a re-check of every sort rule `table-sort.ts` was built to pin: the
stable-tiebreak, missing-values-low and aria-sort behaviour came from measuring v8 and would have to
be measured again on v9. A guess, not a measurement.

**What v8 costs us to stay.** v8's last release was 8.21.3 on 2025-04-14, about eighteen months ago. Neither the
announcement nor the migration guide says anything about a support window, and I found no statement
anywhere. Treat it as frozen but stable: no more fixes, nothing known broken for what we use, and
React 19 works with it today (our `package.json` runs it). The `^8.21.3` range does not pick up 9.

**Verdict: stay on v8 now; make the v9 move its own small piece of work, later.** Reasons:

1. Nothing Greg asked for needs v9. Sort and hide already exist in v8 and in our wrapper; the
   request is to use it in two more tables.
2. The wrapper hides most of the library. `DataTable.tsx` is the main touch point, but
   `Library.tsx`, `AdminPage.tsx`, `AdminCostsPage.tsx`, `ShelfControls.tsx`, `table-sort.ts` and
   `shelf-hidden-columns.ts` import TanStack types or helpers too, so the later move is contained
   but not one file, and it is cheaper to make once than
   twice, after the two new tables are on the wrapper (one set of callers to port, not two extra).
3. Mixing a migration into a "make the tables consistent" change makes a regression impossible to
   attribute, and the three unconfirmed options above are exactly the ones that caused a
   production render loop once.
4. v9 is ten weeks old. v8 had years of fixes behind it. There is no urgency, and
   the main pull (bundle size, speed) is irrelevant at a hundred rows.
5. The counterweight: v8 is frozen and v9 is where fixes, and in time the examples a coding model has seen, will
   accumulate. So do not let it sit indefinitely. A reasonable trigger is "when we next need a
   feature v8 lacks, or in a quiet week, whichever is first". Greg's call.

`useLegacyTable` as a stepping stone is not recommended either: it is deprecated and pulls every
feature in, so it only postpones the real edit.

## Surprising things

- The "better table library" Greg asks for is the one in the repo; the difference he saw is two
  pages that never adopted it.
- v9 shipped in August and is already the default install, so a fresh `npm i @tanstack/react-table`
  by a future agent (or a doc copied from the web) will give v9 code against our v8 wrapper. Anyone
  who adds a table should read `DataTable.tsx` rather than the library's current docs, and the
  plan should say so in the wrapper's header comment.
- Mantine and Material React Table have not been released since early 2025; the TanStack wrappers
  lag the core.

## Sources

- [Announcing TanStack Table V9](https://tanstack.com/blog/announcing-tanstack-table-v9) (2026-08-04)
- [Migrating to TanStack Table V9 (React)](https://tanstack.com/table/latest/docs/framework/react/guide/migrating.md)
- [InfoQ on the v9 beta](https://infoq.com/news/2026/07/tanstack-table-v9-beta)
- npm registry, `npm view <pkg> version time.modified` and
  `api.npmjs.org/downloads/point/last-week/<pkg>`, run 2026-10-21
- [AG Grid alternatives, compared (2026)](https://coreui.io/compare/ag-grid-alternative/) and
  [10 feature-rich React data grids in 2026](https://dev.to/hadil/10-most-feature-rich-react-data-grid-libraries-in-2026-3lei)
  (secondary; used only for the general picture)
- [260826y-library-sorting.md § 1](../plans/260826y-library-sorting.md), the 2026-08-26 decision
- [261021i-admin-tables-share-one-sortable-hideable-table.md](../plans/261021i-admin-tables-share-one-sortable-hideable-table.md),
  the plan this feeds
- `src/web/lib/DataTable.tsx`, the shared wrapper
