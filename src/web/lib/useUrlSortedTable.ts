/**
 * **A `DataTable` whose sort is in the address bar and whose hidden columns are
 * remembered in this browser** — the wiring every admin table had to write out.
 *
 * Extracted from `/admin/users` (AdminPage.tsx) on 2026-10-21, when
 * `/admin/articles` became the second page to need it: one copy rather than
 * two, so the render-loop rules below are kept in one place (plan 261021i §
 * Stage 1). The shelf (Library.tsx) still does this by hand, because its sort
 * also feeds the cards view and a search box; it is the older copy, not the
 * one to imitate.
 *
 * It does four things, in order: reads `?by=&dir=` into TanStack's
 * `SortingState` (`sortingFromUrl`, each column's natural end filling a
 * missing `dir`); writes a click back the same way, leaving `dir` out when it
 * says nothing (`isAllNatural`); holds the hidden columns (`useHiddenColumns`,
 * under the page's own keys); and moves the rows whose *primary* key is
 * missing to the bottom (`sinkLast` — table-sort.ts § `numberOrMissing` says
 * why that is not TanStack's job).
 *
 * ## The identity contract
 *
 * TanStack keys its row-model memos on the identity of what it is handed, and
 * a fresh array every render is the ring that froze the shelf at 470 renders a
 * second (docs/postmortems/260827e-shelf-render-loop.md). This hook keeps its
 * own values stable, and **cannot repair a caller's**:
 *
 * - **`data`** may be `null` (still loading), which becomes one module-level
 *   empty array. Anything else must keep its identity between changes — a
 *   filtered list is a `useMemo`, never a `.filter()` in the render.
 * - **`columns`** must be memoised by the caller (`useMemo`, keyed on what the
 *   cells really read).
 * - **`rowId`** must be at module scope, not an inline arrow — it is the
 *   key of `useSortedTable`'s `ordered` memo.
 * - **`byParam`** is a module-level parser from params.ts § `byParam`; the
 *   hidden-column keys are compared as strings, so an inline object is fine.
 *
 * Must stay off the reader's startup path, like DataTable.tsx itself:
 * tests/eager-client-graph.test.ts.
 */
import { useCallback, useMemo } from "react";
import { functionalUpdate, type OnChangeFn, type Row, type SortingState, type Table } from "@tanstack/react-table";
import { throttle, useQueryState } from "nuqs";

import type { ByParam } from "../params.js";
import { sortDirParam } from "../params.js";
import { type HiddenColumnKeys, useHiddenColumns } from "../shelf-hidden-columns.js";
import { naturalDirections, type SortableColumn, useSortedTable } from "./DataTable.js";
import { isAllNatural, sinkLast, sortingFromUrl, sortingToUrl } from "./table-sort.js";

/** What `null` data becomes: one array for the life of the module, never a fresh `[]`. */
const NOTHING: readonly never[] = [];

export function useUrlSortedTable<T>({
  data,
  columns,
  rowId,
  byParam,
  hiddenColumnKeys,
}: {
  /** `null` while loading. Otherwise memoised — see the identity contract. */
  data: readonly T[] | null;
  /** Memoised by the caller. */
  columns: SortableColumn<T>[];
  /** Module scope. A unique, stable id per row, and the tiebreak (DataTable.tsx). */
  rowId: (row: T) => string;
  /** This page's `?by=` parser; its default is also where a mangled link lands. */
  byParam: ByParam;
  /** Where this table's hidden columns are remembered. */
  hiddenColumnKeys: HiddenColumnKeys;
}): { table: Table<T>; rows: Row<T>[] } {
  const [by, setBy] = useQueryState("by", byParam);
  const [rawDir, setDir] = useQueryState("dir", sortDirParam);

  const natural = useMemo(() => naturalDirections(columns), [columns]);
  const fallback = byParam.defaultValue;
  /* `rawDir` straight in, `null` and all — absent means "each key goes whichever
     way it naturally goes", which `sortingFromUrl` fills in per column. Do not
     write `rawDir ?? []` here: a fresh array per render is what froze the shelf
     (docs/postmortems/260827e-shelf-render-loop.md). */
  const sorting = useMemo(
    () => sortingFromUrl(by, rawDir, natural, fallback),
    [by, rawDir, natural, fallback],
  );

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      /* Applied to the very array TanStack was handed as its state, so what it
         computed the update against and what we apply it to cannot be two
         different things. */
      const next = functionalUpdate(updater, sorting);
      /* `enableSortingRemoval: false` should make this impossible; an empty
         sort would fall back to whatever order the server sent, which is a
         state the reader cannot name or ask for. */
      if (next.length === 0) return;
      const url = sortingToUrl(next);
      void setBy(url.by, { limitUrlUpdates: throttle(0) });
      /* Left out when it says nothing the columns would not have said
         themselves — and an absent `dir` is what makes the per-column fallback
         run at all. */
      void setDir(isAllNatural(next, natural) ? null : url.dir);
    },
    [sorting, natural, setBy, setDir],
  );

  const [columnVisibility, onColumnVisibilityChange] = useHiddenColumns(columns, hiddenColumnKeys);

  const table = useSortedTable({
    data: data ?? NOTHING,
    columns,
    sorting,
    onSortingChange,
    rowId,
    columnVisibility,
    onColumnVisibilityChange,
  });

  const sortedRows = table.getRowModel().rows;
  const primary = sorting[0]?.id;
  /* Missing values last, whichever way the arrow points: sorting by "last
     sign-in" ascending must not fill the top of the page with everyone who has
     never signed in. `sortUndefined` is deliberately off; lib/table-sort.ts has
     the measurement. */
  const rows = useMemo(
    () => (primary ? sinkLast(sortedRows, (r) => r.getValue(primary) === undefined) : sortedRows),
    [sortedRows, primary],
  );

  return { table, rows };
}
