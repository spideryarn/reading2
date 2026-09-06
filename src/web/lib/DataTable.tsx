/**
 * Sorting controls and a dense table, over any list of rows.
 *
 * Greg, 2026-08-26, on why this is a shared thing rather than part of the shelf:
 *
 * > Switch over to Tanstack … because I think we'll also want this kind of
 * > thing in other places
 *
 * So the shape is: a page defines its **columns** — what each one is called,
 * how to get its value, how to draw its cell — and gets the chips and the table
 * for free. Everything specific to a page lives in its column definitions;
 * nothing specific to any page lives here.
 *
 * ## What TanStack owns, and what we still own
 *
 * TanStack Table v8, headless: it owns the sorting rules and nothing that is
 * drawn. So it decides what a click means (including shift-click for a second
 * key, and which end a column starts at), and every `<th>`, `<td>` and chip
 * below is ours. That split is the reason it was worth adopting — see
 * docs/plans/260826y-library-sorting.md § Why TanStack in the end.
 *
 * Three of its options are load-bearing and are set in `useSortedTable`:
 *
 * - **`sortUndefined: false`** — deliberately *off*, even though `"last"` is
 *   the option for exactly what we want. It is wrong when both values are
 *   missing; `numberOrMissing` in table-sort.ts carries the measurement and the
 *   replacement. Missing values are sorted low, consistently, and the rows
 *   whose *primary* key is missing are moved to the bottom by the caller.
 * - **`enableSortingRemoval: false`** — a third click goes back to the first
 *   direction rather than to no sorting at all. "Unsorted" has no meaning here:
 *   the list would fall back to whatever order the server sent, which is a
 *   state the reader cannot ask for and cannot see the name of.
 * - **`enableMultiSort`** — shift-click adds a second key.
 *
 * ## Three things TanStack does not do, and this file does
 *
 * **Its final tiebreak is `rowA.index - rowB.index`** — the order the data
 * arrived in. So equal rows are only stably ordered if the incoming array is,
 * and if it is not, a reload can quietly reshuffle the list and nothing looks
 * wrong. `useSortedTable` therefore asks for a `rowId`, sorts the data by it
 * before handing it over, and that turns the library's fallback into a real
 * total order. It is done at the door rather than inside a `sortingFn` because
 * a tiebreak inside a `sortingFn` gets multiplied by the descending inversion —
 * it would reverse with the arrow, which is not what a tiebreak is.
 *
 * **A plain click does not always collapse a compound sort.** TanStack's own
 * rule is that clicking the *last* key of a compound sort toggles its direction
 * and keeps the rest; only clicking an earlier one, or an unsorted column,
 * replaces. That leaves the reader able to sit in a two-key order with no
 * obvious way back to one, so `toggleSort` below states the rule we want
 * instead: **plain click means sort by this and only this**, unless it is
 * already the only key, in which case it reverses. Shift-click is TanStack's
 * add-or-toggle, untouched.
 *
 * **Its `aria-sort` has no notion of a primary column**, and applying the
 * attribute to every sorted header is not what WAI-ARIA asks for. Only the
 * first key carries it; the rest say where they are through the chip ordinal.
 */
import { useMemo } from "react";
import {
  type ColumnDef,
  flexRender,
  type Header,
  getCoreRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type Row,
  type RowData,
  type SortingState,
  type Table,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { NaturalDirections } from "./table-sort.js";

/**
 * What a column has to say about itself beyond how to sort it.
 *
 * Module augmentation is TanStack's own mechanism for this, and it is typed
 * rather than a loose bag on purpose: every one of these fields is read
 * somewhere below, so a column that forgets `label` is a compile error rather
 * than a chip with no words on it.
 */
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** What the chip and the header cell say. */
    label: string;
    /** The longer sentence, on both their tooltips and in their accessible names. */
    hint: string;
    /** How this column names its two ends, ascending first: `["oldest", "newest"]`. */
    ends: [string, string];
    /** Right-aligned, with figures that line up. */
    numeric?: boolean;
    /** The one column that absorbs the leftover width. See `DataTable`. */
    fluid?: boolean;
    /** Kept out of the chip row — a column you sort from its header only. */
    noChip?: boolean;
  }
}

/**
 * A column this seam can drive.
 *
 * **`id` and `sortDescFirst` are required**, and TanStack would infer both. The
 * inference is the problem: it derives an id from `accessorKey` or a string
 * header, and it picks a first direction by *looking at the data* — descending
 * for a column whose first value is a number. `naturalDirections` below cannot
 * see the data, so a column that let TanStack infer would have the URL parser
 * and the first click disagreeing about which end it starts at, on a link that
 * looked fine. Saying both explicitly makes them agree by construction, because
 * an explicit `sortDescFirst` always wins over the inference.
 *
 * Raised by a cross-family review as a reuse hazard, 2026-08-26 — the shelf's
 * own columns happened to say both already.
 */
export type SortableColumn<T> = ColumnDef<T, unknown> &
  ({ id: string; enableSorting: false } | { id: string; sortDescFirst: boolean });

/** `newest first` — this column's own name for the end it is at. */
export function directionLabel<T>(table: Table<T>, id: string, desc: boolean): string {
  const meta = table.getColumn(id)?.columnDef.meta;
  return meta ? meta.ends[desc ? 1 : 0] : desc ? "descending" : "ascending";
}

/**
 * The natural direction of every sortable column, for the URL parser.
 *
 * Derived from the same `sortDescFirst` TanStack itself reads, so a link that
 * omits `dir` and a first click on a chip cannot disagree about which end a
 * column starts at.
 */
export function naturalDirections<T>(columns: SortableColumn<T>[]): NaturalDirections {
  const out: Record<string, "asc" | "desc"> = {};
  for (const c of columns) {
    if (c.enableSorting !== false) out[c.id] = c.sortDescFirst ? "desc" : "asc";
  }
  return out;
}

/**
 * What a click on a sort control means.
 *
 * Shared by the chips and the headers so the two cannot drift, and written out
 * rather than using `column.getToggleSortingHandler()` for the reason in the
 * file's doc comment: TanStack's plain click keeps a compound sort alive when
 * you happen to click its last key.
 */
export function toggleSort<T>(table: Table<T>, columnId: string, shift: boolean): void {
  const column = table.getColumn(columnId);
  if (!column?.getCanSort()) return;

  if (shift && column.getCanMultiSort()) {
    column.toggleSorting(undefined, true);
    return;
  }

  const sorting = table.getState().sorting;
  const sole = sorting.length === 1 && sorting[0]?.id === columnId;
  // Already the only key: reverse it. Anything else: become the only key, at
  // this column's own natural end rather than at whatever the last one used.
  if (sole) column.toggleSorting(undefined, false);
  else table.setSorting([{ id: columnId, desc: column.getFirstSortDir() === "desc" }]);
}

/** See `defaultColumn` below. One object, so its identity is not render-scoped. */
const DEFAULT_COLUMN = { sortUndefined: false } as const;

/**
 * The horizontal inset on every cell, header and body alike.
 *
 * Written once because a header and its column have to agree: 12px inside, and
 * 16px against the two outer edges so the text is not sitting on the border.
 * It was a flat `px-2` (8px) until 2026-09-06 — which read as cramped only
 * *after* the vertical column rules stopped being drawn over the top of it
 * (styles.css § the head with no row). Research band for a dense table is
 * 12–16px horizontal against 8px vertical.
 */
const CELL_X = "tw:px-3 tw:first:pl-4 tw:last:pr-4";

/**
 * The one fluid column: absorbs leftover width, truncates rather than widening,
 * and **will not collapse to nothing in a narrow window.**
 *
 * `w-full max-w-0` is the absorbing half, and its trap is in `DataTable`'s doc
 * comment. `min-w-56` is the other half. Without it, a window narrower than the
 * fixed columns need squeezes the *fluid* column instead of scrolling: the dates
 * and counts keep their `whitespace-nowrap` widths and the title gets whatever
 * is left. Measured at 390px before this line: a **53px** article column reading
 * "Antl…", beside date columns at full width. The table was already scrolling —
 * it was just scrolling with nothing worth reading in it.
 *
 * A minimum beats a maximum in CSS, so this wins against `max-w-0` exactly where
 * it should and is inert everywhere else: a wide window never reaches it.
 */
const FLUID_CELL = "tw:w-full tw:max-w-0 tw:min-w-56";

/** Everything a non-fluid cell gets: its own width, on one line, quieter than the title. */
const FIXED_CELL = "tw:whitespace-nowrap tw:text-xs tw:text-muted-foreground";

export function useSortedTable<T>({
  data,
  columns,
  sorting,
  onSortingChange,
  rowId,
}: {
  data: T[];
  columns: SortableColumn<T>[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** A unique, stable id per row — and the tiebreak. See the header comment. */
  rowId: (row: T) => string;
}): Table<T> {
  /* Sorted by id before TanStack sees it, so its `rowA.index` fallback is a
     real total order rather than whatever the server happened to send. */
  const ordered = useMemo(
    () => [...data].sort((a, b) => (rowId(a) < rowId(b) ? -1 : rowId(a) > rowId(b) ? 1 : 0)),
    [data, rowId],
  );

  return useReactTable({
    data: ordered,
    columns,
    state: { sorting },
    onSortingChange,
    getRowId: rowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
    /**
     * **Off, because nothing here paginates and this is the hinge of a render
     * loop.**
     *
     * TanStack keys its sorted-row-model memo on `table.getState().sorting`,
     * and that memo's `onChange` queues `resetPageIndex()`. The reset sets
     * React state, which renders again — so a caller who hands `sorting` a new
     * array on each render gets: render → memo recomputes → reset queued →
     * setState → render, for ever, synchronously, with the tab unable to paint
     * or accept a keystroke.
     *
     * That is not hypothetical. On 2026-08-27 the homepage was doing about 470
     * renders a second while sitting still, and one character typed into the
     * add box locked the tab up outright —
     * docs/postmortems/260827e-shelf-render-loop.md has the measurement.
     * `Library.tsx`'s `dir` was the unstable array, and it is fixed; this line
     * is the reason the *next* one cannot do the same thing.
     *
     * It costs nothing to switch off: no page here supplies
     * `getPaginationRowModel`, so pagination is a passthrough and there is no
     * page index for a reset to be about. It is on by default only because
     * `manualPagination` is unset, which is TanStack asking a question about a
     * feature this app does not use.
     */
    autoResetPageIndex: false,
    // See the header comment — all three of these are decisions, not defaults.
    enableSortingRemoval: false,
    // Off, and `table-sort.ts` § numberOrMissing has the measurement that says why.
    // Module scope so it is not a fresh object handed to TanStack every render —
    // GPT Sol, 2026-08-27, while reviewing docs/postmortems/260827e-shelf-render-loop.md.
    defaultColumn: DEFAULT_COLUMN,
  });
}

/* ------------------------------------------------------------ the chips --- */

/**
 * The one pill every toggle-shaped control on a list page wears.
 *
 * Exported because the shelf has two of its own beside these — Unread, and the
 * cards/table pair (ShelfControls.tsx) — and until 2026-08-27 the class string
 * was copied out character for character. Three copies of a border colour is
 * three chances for one of them to drift, and nothing would have said so: they
 * sit on the same row, so the drift shows up as a row that looks slightly
 * wrong rather than as anything you could grep for.
 *
 * `h-7` is the number that matters. It was `py-1`, which made a chip 26px while
 * the toggle beside it measured 33 — see ShelfControls.tsx. Stating the height
 * rather than the padding is what lets an icon-only control in the same row
 * agree with a text one without anybody doing the arithmetic.
 */
export function chipClass(pressed: boolean): string {
  return [
    "tw:inline-flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-full tw:border tw:px-3 tw:text-xs tw:transition-colors",
    pressed
      ? "tw:border-highlight/70 tw:bg-highlight/10 tw:text-highlight"
      : "tw:border-border tw:bg-transparent tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:bg-highlight/5 tw:hover:text-foreground",
  ].join(" ");
}

/**
 * One chip per sortable column.
 *
 * The arrow is on the sorted ones only, and it is the direction rather than
 * decoration, so the order is legible from the control without hovering. When
 * more than one column is sorted, each chip also carries its position — which
 * is the only way a compound order can be read off a row of chips at all.
 *
 * **Every accessible name begins with the chip's visible word.** `aria-label`
 * replaces a button's text outright, so a name that does not contain what the
 * button says leaves somebody driving the page by voice unable to ask for what
 * they can see (WCAG 2.5.3 Label in Name).
 */
export function SortChips<T>({
  table,
  label = "Sort",
  order,
}: {
  table: Table<T>;
  label?: string;
  /**
   * Which chips come first, by column id.
   *
   * The chip row and the table often want different orders — a table leads with
   * what a row *is*, a chip row leads with the default sort. Anything sortable
   * and not named here is **appended rather than dropped**, so a new column
   * cannot vanish from the control by being forgotten in one list.
   */
  order?: string[];
}) {
  const sorting = table.getState().sorting;
  const multiple = sorting.length > 1;

  const sortable = table.getAllLeafColumns().filter((c) => c.getCanSort() && !c.columnDef.meta?.noChip);
  const ranked = order
    ? [...sortable].sort((a, b) => rank(order, a.id) - rank(order, b.id))
    : sortable;

  return (
    /* `fieldset`/`legend` rather than `div role="group"`: it is the element the
       role exists to imitate, and it groups the chips so a screen reader
       announces one control rather than six unrelated buttons. */
    <fieldset className="tw:m-0 tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-1 tw:border-0 tw:p-0">
      <legend className="tw:float-left tw:mr-2 tw:p-0 tw:text-xs tw:text-muted-foreground">
        {label}
      </legend>
      {ranked.map((column) => {
        const meta = column.columnDef.meta;
        if (!meta) return null;
        const at = sorting.findIndex((s) => s.id === column.id);
        const sorted = column.getIsSorted();
          const describe = sorted
            ? `${meta.label}, ${directionLabel(table, column.id, sorted === "desc")}${
                multiple ? `, sort key ${at + 1} of ${sorting.length}` : ""
              }. Activate to reverse, shift-activate to add another key.`
            : `${meta.label} — ${meta.hint}. Activate to sort by it, shift-activate to add it as another key.`;

          return (
            <button
              key={column.id}
              type="button"
              /* `toggleSort` rather than `column.getToggleSortingHandler()` —
                 see the file's doc comment for the plain-click rule TanStack's
                 own handler does not keep. `shiftKey` is read off the event, so
                 a keyboard user gets multi-sort from shift-Enter with no code
                 here: the browser puts the modifier on the synthesised click. */
              onClick={(e) => toggleSort(table, column.id, e.shiftKey)}
              aria-pressed={sorted !== false}
              aria-label={describe}
              title={describe}
              className={chipClass(sorted !== false)}
            >
              {meta.label}
              {multiple && sorted && (
                <span className="tw:tabular-nums tw:opacity-70">{at + 1}</span>
              )}
              {sorted === "asc" && <ArrowUp size={12} />}
              {sorted === "desc" && <ArrowDown size={12} />}
            </button>
        );
      })}
    </fieldset>
  );
}

/* ------------------------------------------------------------ the table --- */

/**
 * The rows, dense, one column each.
 *
 * `rows` is passed rather than read off the table, because the caller may have
 * something to say about the order that is not a sort — the shelf sinks its
 * fixture to the bottom of every order — and because the same rows are often
 * drawn some other way beside this one.
 *
 * Two layout rules, both of which fail silently if you get them wrong:
 *
 * - **`aria-sort` goes on the sorted `<th>` and nowhere else.** WAI-ARIA wants
 *   one at a time; five headers reading "none" is a table a screen reader
 *   describes wrongly, and nothing on screen would show it.
 * - **`w-full max-w-0` on the `fluid` column.** A table sizes each column to
 *   its content, and a long cell has a wide *minimum* — `truncate` does not
 *   shrink it, because the text still counts. Without this the table grows
 *   past its container and the last column falls off the right-hand edge.
 */
export function DataTable<T>({
  table,
  rows,
  caption,
}: {
  table: Table<T>;
  rows: Row<T>[];
  /** Named for screen readers, which otherwise meet a table with no title. */
  caption: string;
}) {
  return (
    /* The table scrolls inside its own box rather than pushing the page
       sideways: a horizontally scrolling *page* makes everything hard to read,
       not just the table. */
    <div className="tw:overflow-x-auto tw:rounded-lg tw:border tw:border-border">
      <table className="tw:w-full tw:border-collapse tw:text-sm">
        <caption className="tw:sr-only">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="tw:border-b tw:border-border">
              {group.headers.map((header) => (
                <HeaderCell key={header.id} table={table} header={header} />
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="tw:group tw:border-b tw:border-border/60 tw:last:border-0 tw:hover:bg-card"
            >
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <td
                    key={cell.id}
                    className={`${CELL_X} tw:py-2 ${
                      meta?.fluid ? FLUID_CELL : FIXED_CELL
                    } ${meta?.numeric ? "tw:text-right tw:tabular-nums" : ""}`}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One header cell.
 *
 * Its own component so the sorting affordance — the button, the arrow, the
 * accessible name and `aria-sort` — is written once and read in one place. It
 * carries the two rules from `DataTable`'s doc comment: `aria-sort` on the
 * sorted column and no other, and `w-full` on the one fluid column.
 */
function HeaderCell<T>({ table, header }: { table: Table<T>; header: Header<T, unknown> }) {
  const meta = header.column.columnDef.meta;
  const sorted = header.column.getIsSorted();
  const head = flexRender(header.column.columnDef.header, header.getContext());
  const sortable = header.column.getCanSort() && meta;

  /* **The accessible name starts with the header's own visible words**, which
     are not always `meta.label`: a table column is often shortened to fit
     ("Words" for Length, "Opens" for Times opened) while the chip keeps the
     long name. `aria-label` replaces a button's text outright, so naming this
     one after the chip would leave somebody driving the page by voice unable to
     ask for the word they can see — WCAG 2.5.3 Label in Name. Caught by a
     cross-family review, 2026-08-26. */
  const shown = typeof header.column.columnDef.header === "string"
    ? header.column.columnDef.header
    : (meta?.label ?? "");

  /* Only the **first** sort key carries `aria-sort`. WAI-ARIA wants one at a
     time, and once shift-click could add a second key this stopped being
     automatic — every sorted header was claiming to be the sorted one. The
     secondary keys say where they are through the chip ordinal instead. */
  const primary = table.getState().sorting[0]?.id === header.column.id;

  return (
    <th
      scope="col"
      aria-sort={primary && sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}
      /* `CELL_X` rather than its own padding, so a header and the column under
         it cannot drift apart by one of the two being edited. The minimum on
         the fluid column is repeated here for the same reason: a table sizes a
         column from every cell in it, header included, so a `min-w` on the body
         cells alone is half a constraint. */
      className={`tw:whitespace-nowrap ${CELL_X} tw:py-2 tw:text-xs tw:font-medium ${
        meta?.fluid ? "tw:w-full tw:min-w-56" : "tw:w-0"
      } ${meta?.numeric ? "tw:text-right" : "tw:text-left"}`}
    >
      {sortable ? (
        <button
          type="button"
          onClick={(e) => toggleSort(table, header.column.id, e.shiftKey)}
          aria-label={
            sorted
              ? `${shown}, ${directionLabel(table, header.column.id, sorted === "desc")}. Activate to reverse, shift-activate to add another key.`
              : `${shown} — ${meta.hint}. Activate to sort by it.`
          }
          title={meta.hint}
          className={`tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:bg-transparent tw:p-0 tw:text-xs tw:font-medium ${
            sorted ? "tw:text-highlight" : "tw:text-muted-foreground tw:hover:text-foreground"
          }`}
        >
          {head}
          {sorted === "asc" && <ArrowUp size={11} />}
          {sorted === "desc" && <ArrowDown size={11} />}
        </button>
      ) : (
        head
      )}
    </th>
  );
}

/** Where an id sits in the preferred order, with unknown ids after the known ones. */
function rank(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i === -1 ? order.length : i;
}
