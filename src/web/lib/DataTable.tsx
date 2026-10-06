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
import { useMemo, useRef, useState } from "react";
import {
  type Column,
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
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Check, Columns3, EyeOff } from "lucide-react";
import { ContextMenu, DropdownMenu } from "radix-ui";
import { ControlTip, Tooltip } from "../Tooltip.js";
import { SCROLL_BOX, SidewaysScrollBox } from "./SidewaysScrollBox.js";
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
    /**
     * Hidden until the reader shows it from the Columns menu. Read by the
     * page's own visibility state (the shelf's is shelf-hidden-columns.ts), not
     * by anything in this file: a page that passes no visibility state shows
     * every column.
     */
    startsHidden?: boolean;
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

/**
 * **Column hiding is controlled state: pass both halves or neither.** With
 * neither, hiding is switched off outright (`enableHiding: false`), so a page
 * that never asked — `/admin` — gets no header menu and no Columns control. A
 * union makes the half-controlled state a compile error rather than a table
 * whose hiding controls silently do nothing.
 *
 * `columnVisibility` must keep its identity between changes, for the same
 * reason as `sorting`: TanStack keys its visible-column memos on it. Hold it in
 * React state, as shelf-hidden-columns.ts does. A column opts out with
 * TanStack's `enableHiding: false`; hidden columns remain available to sorting
 * and to the chip row because the definition array is never filtered.
 */
type VisibilityControl =
  | { columnVisibility?: undefined; onColumnVisibilityChange?: undefined }
  | {
      columnVisibility: VisibilityState;
      onColumnVisibilityChange: OnChangeFn<VisibilityState>;
    };

export function useSortedTable<T>({
  data,
  columns,
  sorting,
  onSortingChange,
  rowId,
  columnVisibility,
  onColumnVisibilityChange,
}: {
  data: T[];
  columns: SortableColumn<T>[];
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  /** A unique, stable id per row — and the tiebreak. See the header comment. */
  rowId: (row: T) => string;
} & VisibilityControl): Table<T> {
  /* Sorted by id before TanStack sees it, so its `rowA.index` fallback is a
     real total order rather than whatever the server happened to send. */
  const ordered = useMemo(
    () => [...data].sort((a, b) => (rowId(a) < rowId(b) ? -1 : rowId(a) > rowId(b) ? 1 : 0)),
    [data, rowId],
  );

  const hiding = columnVisibility !== undefined && onColumnVisibilityChange !== undefined;

  return useReactTable({
    data: ordered,
    columns,
    /* The spread keeps `columnVisibility` out of `state` altogether when hiding
       is off, so TanStack's own internal (empty) visibility state stands. */
    state: hiding ? { sorting, columnVisibility } : { sorting },
    onSortingChange,
    ...(hiding ? { onColumnVisibilityChange } : {}),
    enableHiding: hiding,
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
      ? "tw:border-highlight/70 tw:bg-highlight/10 tw:text-highlight-text"
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
  labelHidden = false,
  order,
}: {
  table: Table<T>;
  label?: string;
  /**
   * **Read, not drawn.** The legend still names the group to a screen reader,
   * but takes no room on screen. The shelf asks for it: Greg, 2026-09-29
   * (`spya-tw6zxw`), *"get rid of the "Sort" text at the beginning of the
   * row … it'll be obvious enough to the user already"*. The arrows on the
   * chips say what the row is.
   */
  labelHidden?: boolean;
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
      <legend
        className={
          labelHidden ? "tw:sr-only" : "tw:float-left tw:mr-2 tw:p-0 tw:text-xs tw:text-muted-foreground"
        }
      >
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

/* ------------------------------------------------------ hiding columns --- */

/**
 * The surface both menus in this file draw on: the tooltip card's tokens —
 * raised, opaque, the strong rule, the same shadow — and `z-[100]` to sit
 * frontmost. The same classes as `ShelfActionsMenu` in ShelfEntry.tsx, whose
 * comment has the reasoning; repeated rather than imported because this file
 * is the lower layer and must not reach up into a page's components.
 */
const MENU_SURFACE =
  "tw:z-[100] tw:min-w-[12rem] tw:max-w-[min(22rem,calc(100vw-1.75rem))] tw:rounded-[5px] tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-1 tw:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_-6px_rgb(0_0_0/0.65)]";

/** One row of either menu — `ShelfActionsMenu`'s `ITEM`, for the same reason. */
const MENU_ITEM =
  "tw:flex tw:min-h-10 tw:cursor-default tw:select-none tw:items-center tw:gap-2.5 tw:rounded-[3px] tw:px-2.5 tw:py-1.5 tw:text-sm tw:leading-snug tw:text-foreground tw:outline-none tw:data-highlighted:bg-highlight/10 tw:data-disabled:text-muted-foreground";

/**
 * **Which columns the table shows: one checkbox per column that can be
 * hidden.** Plan 260928a, Decision 3.
 *
 * This is the way back from a right-click hide, and the route that works on a
 * finger, on a keyboard, and for anybody who never thinks to right-click. It
 * draws nothing for a table that did not opt in to hiding (`useSortedTable`),
 * so a page can place it unconditionally.
 *
 * **It says how many are hidden**, which is the answer to "where did my column
 * go?": a count badge rather than a longer label, so the shelf's controls row
 * still fits a phone (Sol P-8), and the count in the accessible name, which
 * begins with the visible word (WCAG 2.5.3 Label in Name, as the chips).
 *
 * Each box is labelled with the chip's name (`meta.label`), not the header's
 * shorter one, because the chip row sits right beside this control and reads
 * the same list of columns.
 *
 * **Ticking a box keeps the menu open** (`onSelect` prevented) — hiding three
 * columns should not take three trips to the button.
 */
export function ColumnsMenu<T>({ table }: { table: Table<T> }) {
  const [open, setOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  /* Opening the menu dismisses its card. Keep it suppressed while Radix
     returns focus to the trigger; otherwise closing the menu immediately opens
     a tooltip over the control. A later pointer entry, or leaving by keyboard,
     starts a fresh visit. */
  const suppressTip = useRef(false);
  /* Radix toggles a dropdown on `pointerdown`, before a finger has shown
     whether it means to tap or scroll. Keep the pointer's real type here — an
     iOS finger's later click may call itself a mouse — and let the completed
     click make the decision instead. This is the same one-gesture rule as
     `ShelfActionsMenu`; the controls row can be the place a reader starts a
     scroll just as readily as an article card can. */
  const fingerPress = useRef<{ wasOpen: boolean } | null>(null);

  const hideable = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && c.columnDef.meta !== undefined);
  if (hideable.length === 0) return null;

  const hidden = hideable.filter((c) => !c.getIsVisible()).length;
  const describe =
    hidden === 0
      ? "Columns — choose which the table shows"
      : `Columns, ${hidden} hidden — choose which the table shows`;
  const changeMenuOpen = (next: boolean) => {
    if (next) {
      suppressTip.current = true;
      setTipOpen(false);
    }
    setOpen(next);
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={changeMenuOpen}>
      <Tooltip
        content={
          <ControlTip
            head="Columns"
            what="Choose which data columns the table shows. The number on this button is how many are hidden."
            how="Hiding changes only what the table draws: it does not change the current sort, and this menu is always the way to bring a column back."
          />
        }
        placement="bottom"
        open={tipOpen}
        onOpenChange={(next) => {
          if (!next) setTipOpen(false);
          else if (!open && !suppressTip.current) setTipOpen(true);
        }}
      >
        <DropdownMenu.Trigger
          aria-label={describe}
          onPointerEnter={() => {
            if (!open) suppressTip.current = false;
          }}
          onPointerDown={(e) => {
            setTipOpen(false);
            const finger = e.pointerType === "touch" || e.pointerType === "pen";
            fingerPress.current = finger ? { wasOpen: open } : null;
            if (finger) e.preventDefault();
          }}
          onPointerCancel={() => {
            fingerPress.current = null;
          }}
          onBlur={() => {
            if (!open) suppressTip.current = false;
          }}
          onClick={(e) => {
            const press = fingerPress.current;
            fingerPress.current = null;
            /* Keyboard activation (`detail === 0`) has already gone through
               Radix's key handler and must not be toggled a second time. */
            if (press && e.detail !== 0) changeMenuOpen(!press.wasOpen);
          }}
          className={chipClass(hidden > 0)}
        >
          <Columns3 size={12} aria-hidden="true" />
          Columns
          {hidden > 0 && (
            <span className="tw:rounded-full tw:bg-highlight/20 tw:px-1.5 tw:text-[10px] tw:leading-4 tw:tabular-nums">
              {hidden}
            </span>
          )}
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={10}
          className={MENU_SURFACE}
        >
          {hideable.map((column) => (
            <DropdownMenu.CheckboxItem
              key={column.id}
              checked={column.getIsVisible()}
              onCheckedChange={(on) => column.toggleVisibility(on === true)}
              onSelect={(e) => e.preventDefault()}
              className={MENU_ITEM}
            >
              {/* A fixed box, so the words line up whether or not a tick is
                  drawn beside them. */}
              <span className="tw:inline-flex tw:size-4 tw:shrink-0 tw:items-center tw:justify-center">
                <DropdownMenu.ItemIndicator>
                  <Check size={14} aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </span>
              <span>{column.columnDef.meta?.label}</span>
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  sidewaysCue = false,
}: {
  table: Table<T>;
  rows: Row<T>[];
  /** Named for screen readers, which otherwise meet a table with no title. */
  caption: string;
  /**
   * Shade the edge of the box while columns are hidden past it —
   * `SidewaysScrollBox`, which then *is* the scroll box, so what it measures
   * is the element that scrolls. Off unless asked for: `/admin/costs` asks,
   * and the shelf and `/admin/users` draw as they did (plan 261006g § Stage 2).
   */
  sidewaysCue?: boolean;
}) {
  const drawn = (
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
  );
  if (sidewaysCue) return <SidewaysScrollBox>{drawn}</SidewaysScrollBox>;
  return (
    /* The table scrolls inside its own box rather than pushing the page
       sideways: a horizontally scrolling *page* makes everything hard to read,
       not just the table.

       Tailwind's `sr-only` labels are absolutely positioned. `relative` makes
       this wrapper their containing block, so its `overflow` clip contains
       them too. Without it, the Actions label's static position at the table's
       intrinsic right edge contributed to page overflow outside this box; the
       page measured ~300px too wide at 390px. Browser measurement, 2026-09-28
       (plan 260928a). `relative` with no z-index creates no stacking context.

       `SidewaysScrollBox` above is this same box with a cue; `SCROLL_BOX` is
       the one copy of its classes. */
    <div className={SCROLL_BOX}>{drawn}</div>
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

  /* Set by the Hide item and read once by `onCloseAutoFocus` — see there. A
     ref rather than state because it has to outlive this component: by the
     time Radix asks where focus should go, this header has been unmounted. */
  const thRef = useRef<HTMLTableCellElement>(null);
  const afterHide = useRef<{ table: HTMLTableElement | null; next: string | null } | null>(null);
  const touchPress = useRef(false);
  const suppressTouchClick = useRef(false);
  const canHide = header.column.getCanHide();

  const cell = (
    <th
      ref={thRef}
      onPointerDown={
        canHide
          ? (e) => {
              touchPress.current = e.pointerType === "touch" || e.pointerType === "pen";
              suppressTouchClick.current = false;
            }
          : undefined
      }
      onPointerMove={
        canHide
          ? () => {
              touchPress.current = false;
            }
          : undefined
      }
      onPointerCancel={
        canHide
          ? () => {
              touchPress.current = false;
              suppressTouchClick.current = false;
            }
          : undefined
      }
      onClickCapture={
        canHide
          ? (e) => {
              if (!suppressTouchClick.current) return;
              /* Radix opens after holding for 700ms but does not prevent the
                 click browsers synthesize when that same finger lifts. The
                 click belongs to the context-menu gesture, not to sorting. */
              suppressTouchClick.current = false;
              touchPress.current = false;
              e.preventDefault();
              e.stopPropagation();
            }
          : undefined
      }
      scope="col"
      /* What `focusSortButton` finds the neighbouring header by. */
      data-column-id={header.column.id}
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
            sorted ? "tw:text-highlight-text" : "tw:text-muted-foreground tw:hover:text-foreground"
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

  /* **No menu at all unless this column can be hidden** — which is false for
     every column of a table that did not opt in (`useSortedTable`), and for
     Article and Actions on the shelf. A right-click there gets the browser's
     own menu, as it always did. */
  if (!canHide) return cell;

  return (
    /* **Right-click a header: a one-item menu, not an instant hide**, so a
       stray right-click costs nothing (plan 260928a, assumption A3). Radix's
       `ContextMenu` also opens on a long press for a finger or a pen, which
       is the touch route for free — the Columns control is the other one.
       The trigger is the `<th>` itself (`asChild`), so a plain click on the
       sort button inside it still sorts: the menu listens only for
       `contextmenu` and for a held touch. */
    <ContextMenu.Root
      onOpenChange={(open) => {
        if (open && touchPress.current) suppressTouchClick.current = true;
        if (!open) {
          touchPress.current = false;
          suppressTouchClick.current = false;
        }
      }}
    >
      <ContextMenu.Trigger asChild>{cell}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          collisionPadding={10}
          className={MENU_SURFACE}
          /* **Focus after a hide goes to the neighbouring header's sort
             button** — Sol P-4, and the same problem `ShelfActionsMenu` hit
             with Edit title. The header that opened this menu no longer
             exists, and Radix's default would return focus to whatever held it
             before the menu opened: a removed node, or something elsewhere on
             the page. Radix fires this after the header has unmounted (it keeps
             the latest handler in a ref), which is why `afterHide` is a ref.
             A menu closed without hiding — Escape, a click outside — keeps
             Radix's own behaviour. */
          onCloseAutoFocus={(e) => {
            const done = afterHide.current;
            if (!done) return;
            afterHide.current = null;
            e.preventDefault();
            focusSortButton(done.table, done.next);
          }}
        >
          <ContextMenu.Item
            className={MENU_ITEM}
            onSelect={() => {
              afterHide.current = {
                table: thRef.current?.closest("table") ?? null,
                next: neighbourToFocus(table, header.column.id),
              };
              header.column.toggleVisibility(false);
            }}
          >
            <EyeOff size={16} aria-hidden="true" className="tw:shrink-0" />
            <span>Hide "{shown}"</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * The column whose header should take focus once `id` is hidden: **the next
 * one along that has a sort button, else the previous one.** "Has a sort
 * button" rather than just "next", because the shelf's last column is Actions,
 * whose header is a hidden word with nothing to focus — so hiding Words, the
 * column before it, lands on Comments.
 */
function neighbourToFocus<T>(table: Table<T>, id: string): string | null {
  const visible = table.getVisibleLeafColumns();
  const at = visible.findIndex((c) => c.id === id);
  const focusable = (c: Column<T, unknown> | undefined): c is Column<T, unknown> =>
    c !== undefined && c.id !== id && c.getCanSort() && c.columnDef.meta !== undefined;
  for (let i = at + 1; i < visible.length; i++) {
    const c = visible[i];
    if (focusable(c)) return c.id;
  }
  for (let i = at - 1; i >= 0; i--) {
    const c = visible[i];
    if (focusable(c)) return c.id;
  }
  return null;
}

/** Focus the sort button in the header of column `id`, if it is drawn. */
function focusSortButton(tableEl: HTMLTableElement | null, id: string | null): void {
  if (!tableEl || id === null) return;
  /* Compared attribute by attribute rather than built into a selector, so an
     id with a quote in it cannot break the query. */
  for (const th of tableEl.querySelectorAll<HTMLElement>("th[data-column-id]")) {
    if (th.dataset.columnId === id) {
      th.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
  }
}

/** Where an id sits in the preferred order, with unknown ids after the known ones. */
function rank(order: string[], id: string): number {
  const i = order.indexOf(id);
  return i === -1 ? order.length : i;
}
