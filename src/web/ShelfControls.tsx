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
 * Everything here is a chip rather than a dropdown, deliberately: six keys fit
 * on a line at this width, one click beats two, and the current order is
 * readable without opening anything. Linear's "Display options" popover is the
 * right answer at three times this many dimensions, and is what to reach for
 * if grouping or column visibility ever arrive — see
 * docs/project/library.md § Sorting the shelf.
 */
import { ArrowDown, ArrowUp, EyeOff, Rows3, Table } from "lucide-react";
import {
  directionLabel,
  nextSort,
  type ShelfFilter,
  type ShelfView,
  SORTS,
  type SortDir,
  type SortKey,
} from "./library-sort.js";

export function ShelfControls({
  sort,
  dir,
  onSort,
  view,
  onView,
  filter,
  onFilter,
}: {
  sort: SortKey;
  dir: SortDir;
  onSort: (next: { by: SortKey; dir: SortDir }) => void;
  view: ShelfView;
  onView: (v: ShelfView) => void;
  filter: ShelfFilter;
  onFilter: (f: ShelfFilter) => void;
}) {
  return (
    <div className="tw:mb-4 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2">
      {/* `fieldset`/`legend` rather than `div role="group"`: it is the element
          the role exists to imitate, and it groups the six chips so a screen
          reader announces them as one control rather than as six unrelated
          buttons. The legend is visible here and carries the word "Sort". */}
      <fieldset className="tw:m-0 tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-1 tw:border-0 tw:p-0">
        <legend className="tw:float-left tw:mr-2 tw:p-0 tw:text-xs tw:text-muted-foreground">
          Sort
        </legend>
        {SORTS.map((spec) => (
          <SortChip
            key={spec.key}
            spec={spec}
            active={spec.key === sort}
            dir={dir}
            onClick={() => onSort(nextSort(sort, dir, spec.key))}
          />
        ))}
      </fieldset>

      <div className="tw:ml-auto tw:flex tw:items-center tw:gap-2">
        <Chip
          pressed={filter === "unread"}
          label="Unread"
          /* Every accessible name here **begins with the visible text**, so
             that somebody driving the page by voice can say what they can see —
             `aria-label` replaces the button's own words outright, and WCAG
             2.5.3 Label in Name is what that fails. The first version of this
             one said "Showing only articles you have never opened" and never
             contained the word "Unread". Caught by a cross-family review,
             2026-08-26; the sort chips already had it right, because their
             names are built from `spec.label`. */
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
            <Table size={14} />
          </ViewButton>
        </fieldset>
      </div>
    </div>
  );
}

/**
 * One sort key.
 *
 * The arrow is on the active chip only, and it is the direction rather than a
 * decoration — so the shelf's order is legible from the control without hover.
 * The accessible name carries the same thing in words, because an arrow glyph
 * announces as nothing useful.
 */
function SortChip({
  spec,
  active,
  dir,
  onClick,
}: {
  spec: (typeof SORTS)[number];
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  const ends = active ? directionLabel(spec.key, dir) : "";
  return (
    <Chip
      pressed={active}
      label={spec.label}
      describe={
        active
          ? `Sorted by ${spec.label.toLowerCase()}, ${ends}. Activate to reverse.`
          : `Sort by ${spec.label.toLowerCase()} — ${spec.hint}`
      }
      onClick={onClick}
    >
      {spec.label}
      {active && (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </Chip>
  );
}

function Chip({
  pressed,
  label,
  describe,
  onClick,
  children,
}: {
  pressed: boolean;
  /** Kept out of `describe` so the two can't drift; only used in the fallback title. */
  label: string;
  describe: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Both: `title` is the hover hint, `aria-pressed` + `aria-label` are what
      // a screen reader gets. `aria-pressed` is what makes these read as state
      // rather than as six buttons that each do something unrelated.
      aria-pressed={pressed}
      aria-label={describe}
      title={describe || label}
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
