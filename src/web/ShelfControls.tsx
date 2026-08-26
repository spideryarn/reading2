/**
 * The one row of controls above the shelf: how it is ordered, what is on it,
 * and how it is painted.
 *
 * Greg, 2026-08-26:
 *
 * > Maybe it's misleading to call this tabular, because I kind of like the rich
 * > cards that we have right now, so look for a best of all worlds.
 *
 * So: **one sort state, two renderers.** The chips here drive the cards and the
 * dense table identically, and switching between the two keeps your place in
 * the order — the pattern Raindrop and Notion both settled on, where a view is
 * a way of painting one list rather than a list of its own. The cards keep the
 * blurb and say what they are sorted by (ShelfEntry.tsx § the note); the table
 * gives up the blurb and shows every column at once. Neither is a fallback for
 * the other.
 *
 * The chips themselves are `SortChips` from lib/DataTable.tsx and know nothing
 * about the library — they are built from the table's own columns. What is left
 * here is the two controls that are the shelf's own: which half of it to show,
 * and which way to draw it.
 *
 * Chips rather than a dropdown, deliberately: six keys fit on a line at this
 * width, one click beats two, and the current order is readable without opening
 * anything. Linear's "Display options" popover is the right answer at three
 * times this many dimensions, and is what to reach for if grouping or column
 * visibility ever arrive — see docs/project/library.md § Sorting the shelf.
 */
import { EyeOff, Rows3, Table as TableIcon } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import type { LibraryEntry } from "../types.js";
import { SortChips } from "./lib/DataTable.js";

export type ShelfView = "cards" | "table";
export type ShelfFilter = "all" | "unread";

export function ShelfControls({
  table,
  chipOrder,
  view,
  onView,
  filter,
  onFilter,
}: {
  table: Table<LibraryEntry>;
  /** Added first, because it is the default sort — see library-columns.tsx § CHIP_ORDER. */
  chipOrder: string[];
  view: ShelfView;
  onView: (v: ShelfView) => void;
  filter: ShelfFilter;
  onFilter: (f: ShelfFilter) => void;
}) {
  return (
    <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2">
      <SortChips table={table} order={chipOrder} />

      <div className="tw:ml-auto tw:flex tw:items-center tw:gap-2">
        <Chip
          pressed={filter === "unread"}
          /* Every accessible name here **begins with the visible text**, so
             that somebody driving the page by voice can say what they can see —
             `aria-label` replaces the button's own words outright, and WCAG
             2.5.3 Label in Name is what that fails. The first version of this
             one said "Showing only articles you have never opened" and never
             contained the word "Unread". Caught by a cross-family review,
             2026-08-26. */
          describe={
            filter === "unread"
              ? "Unread — showing only articles you have never opened. Activate to show all."
              : "Unread — show only articles you have never opened"
          }
          onClick={() => onFilter(filter === "unread" ? "all" : "unread")}
        >
          <EyeOff size={12} />
          Unread
        </Chip>

        <fieldset className="tw:m-0 tw:flex tw:items-center tw:gap-0.5 tw:rounded-md tw:border tw:border-border tw:p-0.5">
          <legend className="tw:sr-only">How the shelf is shown</legend>
          {/* `onView` only fires on a change. These are the one control here
              whose buttons can be pressed while already on — a sort chip
              reverses and the Unread chip toggles, so both always do something
              — and `view` is a `push` parameter, so clicking Cards while in
              Cards would put an identical entry on the history stack and cost
              the reader an extra press of Back. */}
          <ViewButton
            pressed={view === "cards"}
            label="Cards — with the one-sentence blurb"
            onClick={() => view !== "cards" && onView("cards")}
          >
            <Rows3 size={14} />
          </ViewButton>
          <ViewButton
            pressed={view === "table"}
            label="Table — every column at once, no blurb"
            onClick={() => view !== "table" && onView("table")}
          >
            <TableIcon size={14} />
          </ViewButton>
        </fieldset>
      </div>
    </div>
  );
}

function Chip({
  pressed,
  describe,
  onClick,
  children,
}: {
  pressed: boolean;
  describe: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Both: `title` is the hover hint, `aria-pressed` + `aria-label` are what
      // a screen reader gets. `aria-pressed` is what makes this read as state
      // rather than as a button that does something unrelated.
      aria-pressed={pressed}
      aria-label={describe}
      title={describe}
      className={`tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:border tw:px-2.5 tw:py-1 tw:text-xs tw:transition-colors ${
        pressed
          ? "tw:border-highlight tw:bg-highlight/10 tw:text-highlight"
          : "tw:border-border tw:bg-transparent tw:text-muted-foreground tw:hover:border-highlight/50 tw:hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ViewButton({
  pressed,
  label,
  onClick,
  children,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={`tw:rounded tw:p-1.5 tw:transition-colors ${
        pressed
          ? "tw:bg-highlight/10 tw:text-highlight"
          : "tw:bg-transparent tw:text-muted-foreground tw:hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
