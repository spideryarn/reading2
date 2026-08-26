/**
 * The shelf as one dense table — the other way of painting the same list.
 *
 * The card is a decision aid and gives you one thing well: what the piece says.
 * The table gives you the other thing: **how this article compares to the rest
 * of the shelf.** Six numbers you can run your eye down beats six numbers
 * scattered one per card, and that is the whole argument for it — it is not a
 * smaller card, and it is not the "real" view with the cards as decoration.
 * What it gives up, and gives up on purpose, is the blurb.
 *
 * It shares everything but the markup with the cards: the same
 * `SORTS`/`sortEntries` (library-sort.ts), the same five buttons, the same
 * rename-in-place, the same details tooltip (ShelfEntry.tsx). Clicking a header
 * runs the same `nextSort` rule the chips above it do, so the two controls
 * cannot disagree about what a second click means.
 *
 * ## The one thing to be careful with
 *
 * `aria-sort` goes on the `<th>` and belongs to **exactly one column at a
 * time** — a table with two sorted columns declared is a table a screen reader
 * describes wrongly, and nothing on screen would show it. See
 * docs/project/library.md § Sorting the shelf.
 */
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { LibraryEntry } from "../types.js";
import { Link } from "./Link.js";
import {
  directionLabel,
  nextSort,
  type SortDir,
  type SortKey,
  sortSpec,
} from "./library-sort.js";
import { readHref } from "./router.js";
import { Actions, Details, type Shelf, TitleEditor, whenAdded } from "./ShelfEntry.js";
import { Tooltip } from "./Tooltip.js";

/**
 * Which columns there are, and which sort key each one is a view of.
 *
 * `fluid` marks the one column that absorbs the slack — and it is the reason
 * the table fits at all. A table sizes each column to its content, and a long
 * title has a wide *minimum*: `truncate` alone does not shrink it, because the
 * text still counts towards min-content. So the total came out at 895px inside
 * an 848px shelf, and what fell off the right-hand end was the action column —
 * Delete and Copy reachable only by scrolling the table sideways first, at a
 * 1400px window with room to spare. Found in a browser pass, 2026-08-26.
 *
 * The fix is `w-full max-w-0` on that one cell: `max-w-0` takes its minimum
 * down to nothing so it stops forcing the table wide, `w-full` makes it claim
 * whatever is left over, and the `truncate` inside it then has a width to
 * truncate against. Every other column keeps sizing to its own content, which
 * is what a table should do — no magic numbers to go stale when a column is
 * added, and no header clipped to make room.
 */
const COLUMNS: { key: SortKey; head: string; numeric: boolean; fluid?: boolean }[] = [
  { key: "title", head: "Article", numeric: false, fluid: true },
  { key: "added", head: "Added", numeric: false },
  { key: "opened", head: "Last opened", numeric: false },
  { key: "opens", head: "Opens", numeric: true },
  { key: "questions", head: "Questions", numeric: true },
  { key: "length", head: "Words", numeric: true },
];

export function ShelfTable({
  entries,
  shelf,
  sort,
  dir,
  onSort,
}: {
  entries: LibraryEntry[];
  shelf: Shelf;
  sort: SortKey;
  dir: SortDir;
  onSort: (next: { by: SortKey; dir: SortDir }) => void;
}) {
  return (
    /* The table scrolls inside its own box rather than pushing the page
       sideways: six columns do not fit a phone, and a horizontally scrolling
       *page* makes the article list itself hard to read. */
    <div className="tw:overflow-x-auto tw:rounded-lg tw:border tw:border-border">
      <table className="tw:w-full tw:border-collapse tw:text-sm">
        <thead>
          <tr className="tw:border-b tw:border-border">
            {COLUMNS.map((col) => (
              <HeaderCell
                key={col.key}
                col={col}
                active={col.key === sort}
                dir={dir}
                onClick={() => onSort(nextSort(sort, dir, col.key))}
              />
            ))}
            {/* `w-0` is "as narrow as the content allows", not "zero": the
                buttons are `opacity-0` rather than absent (ShelfEntry §
                Actions), so they take their full width whether or not the row
                is hovered, and this column ends up exactly as wide as they are. */}
            <th scope="col" className="tw:w-0 tw:px-2 tw:py-2">
              <span className="tw:sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Row key={entry.slug} entry={entry} shelf={shelf} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeaderCell({
  col,
  active,
  dir,
  onClick,
}: {
  col: (typeof COLUMNS)[number];
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  const spec = sortSpec(col.key);
  return (
    <th
      scope="col"
      /* **Only the sorted column carries `aria-sort` at all.** An earlier
         version put `aria-sort="none"` on the other five, reasoning that "none"
         means "sortable, currently unsorted" — WAI-ARIA says to apply the
         property to one header at a time, and the buttons already say the rest
         can be sorted. Caught by a cross-family review, 2026-08-26. */
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className={`tw:whitespace-nowrap tw:px-2 tw:py-2 tw:text-xs tw:font-medium ${
        col.fluid ? "tw:w-full" : ""
      } ${col.numeric ? "tw:text-right" : "tw:text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={
          active
            ? `${col.head}, ${directionLabel(col.key, dir)}. Activate to reverse.`
            : `Sort by ${col.head.toLowerCase()} — ${spec.hint}`
        }
        title={spec.hint}
        className={`tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:bg-transparent tw:p-0 tw:text-xs tw:font-medium ${
          active ? "tw:text-highlight" : "tw:text-muted-foreground tw:hover:text-foreground"
        }`}
      >
        {col.head}
        {active && (dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

function Row({ entry, shelf }: { entry: LibraryEntry; shelf: Shelf }) {
  const [editing, setEditing] = useState(false);

  const sub = [entry.byline, entry.siteName, `~${entry.minutes} min`].filter(Boolean).join(" · ");

  return (
    <tr className="tw:group tw:border-b tw:border-border/60 tw:last:border-0 tw:hover:bg-card">
      {/* See COLUMNS: `w-full max-w-0` is what stops a long title forcing
          the whole table wider than the page. */}
      <td className="tw:w-full tw:max-w-0 tw:px-2 tw:py-2">
        {editing ? (
          <TitleEditor
            entry={entry}
            className="tw:text-sm"
            onDone={(title) => {
              setEditing(false);
              if (title !== undefined) void shelf.rename(entry.slug, title);
            }}
          />
        ) : (
          <>
            {/* No stretched link here: a whole row as one click target would
                swallow the buttons at the end of it, and the card already
                learned that lesson (library.md § The card is no longer one big
                link). The title is the link, and only the title. */}
            <Link
              href={readHref(entry.slug)}
              className="tw:block tw:truncate tw:text-foreground tw:no-underline tw:hover:text-highlight"
            >
              {entry.title}
            </Link>
            {(sub || entry.fixture) && (
              <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground">
                {sub}
                {entry.fixture && (
                  <span className="tw:ml-1.5 tw:rounded tw:border tw:border-border tw:px-1 tw:py-0.5">
                    fixture
                  </span>
                )}
              </span>
            )}
          </>
        )}
      </td>

      {/* The details tooltip hangs off the Added cell, which is where the card
          puts it too — one trigger, one place to look. */}
      <td className="tw:whitespace-nowrap tw:px-2 tw:py-2 tw:text-xs tw:text-muted-foreground">
        <Tooltip content={<Details entry={entry} />} placement="top">
          <button
            type="button"
            aria-label={`${whenAdded(entry.addedAt)} — details of ${entry.title}`}
            className="tw:cursor-help tw:border-b tw:border-dotted tw:border-border tw:bg-transparent tw:p-0 tw:text-xs tw:text-muted-foreground tw:outline-none tw:focus-visible:text-highlight"
          >
            {whenAdded(entry.addedAt)}
          </button>
        </Tooltip>
      </td>

      <td className="tw:whitespace-nowrap tw:px-2 tw:py-2 tw:text-xs tw:text-muted-foreground">
        {/* An em dash rather than a blank: an empty cell reads as data we failed
            to load, and "never opened" is a fact. */}
        {whenAdded(entry.lastOpenedAt) || <span title="Never opened">—</span>}
      </td>

      <Count value={entry.opens} />
      <Count value={entry.comments} highlight />
      <Count value={entry.words} />

      <td className="tw:px-2 tw:py-2">
        <Actions entry={entry} shelf={shelf} onEdit={() => setEditing(true)} />
      </td>
    </tr>
  );
}

/**
 * `tabular-nums` is the point of this component: without it the digits are
 * proportionally spaced and a column of numbers does not line up, which is the
 * one thing a table is for.
 */
function Count({ value, highlight }: { value: number; highlight?: boolean }) {
  return (
    <td
      className={`tw:whitespace-nowrap tw:px-2 tw:py-2 tw:text-right tw:text-xs tw:tabular-nums ${
        highlight && value > 0 ? "tw:text-highlight" : "tw:text-muted-foreground"
      }`}
    >
      {/* Zero is drawn faintly rather than hidden: an empty cell in a column of
          numbers is ambiguous between "none" and "we don't know". */}
      <span className={value === 0 ? "tw:opacity-40" : undefined}>{value.toLocaleString()}</span>
    </td>
  );
}
