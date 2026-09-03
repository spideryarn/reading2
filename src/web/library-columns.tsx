/**
 * The shelf's columns: what you can sort it by, and how each one is drawn.
 *
 * This is the whole of what the library page has to say about its own table.
 * The chips, the header row, the sorting rules and the URL round-trip all come
 * from src/web/lib/DataTable.tsx and are not specific to this page.
 *
 * Greg, 2026-08-26:
 *
 * > Make the set of docs on the homepage nicely sortable (e.g. by when added,
 * > when last opened, how many words, how many actions/interactions performed)
 *
 * Two of those six keys are the "actions/interactions", and they are the only
 * two we can honestly count: opens and questions are the only reader
 * interactions stored as numbers. Chat threads and saved searches are
 * deliberately absent, for the reason the details tooltip already gives — they
 * have not moved to Postgres, so a count would read 7 on the filesystem and 0
 * in production. See docs/project/library.md § The tooltip.
 *
 * ## Two things about the accessors
 *
 * **A missing value must be `undefined`, never `null` and never `NaN`.**
 * TanStack's `sortUndefined: "last"` triggers on `=== undefined` and on nothing
 * else, so a date we cannot parse has to come back as `undefined` or it sorts
 * as `NaN` — and `NaN` compares false in both directions, which is a sort that
 * silently does nothing.
 *
 * **`0` is a value.** `opens: 0` and `comments: 0` are answers, not absences,
 * so they are returned as themselves and sort at the low end rather than being
 * banished to the bottom with the unknowns.
 */

import type { LibraryEntry } from "../types.js";
import type { SortableColumn } from "./lib/DataTable.js";
import { at, localeText, numberOrMissing } from "./lib/table-sort.js";
import { Link } from "./Link.js";
import { timeAgo } from "./relative-time.js";
import { readHref } from "./router.js";
import { Actions, Details, SharedBadge } from "./ShelfEntry.js";
import type { Shelf } from "./ShelfEntry.js";
import { TitleEditor } from "./TitleEditor.js";
import { Tooltip } from "./Tooltip.js";

/**
 * What the card should say on its meta line while this column is the sort.
 *
 * The "best of all worlds" half of the design, and the half no table library
 * was ever going to provide: a card sorted by something it does not show is a
 * list in an order the reader cannot check — *why is this one at the top?* has
 * to be answerable from the card. Sorting by Comments turns the date at the
 * bottom right into "3 questions"; by Last opened, into "opened yesterday".
 *
 * Keyed by column id, and every sortable column has one, so the card can never
 * be sorted by something it cannot describe. `Length` is the exception with a
 * reason: the word count is already on the card, so it says when the article
 * was added instead of repeating itself.
 */
export type CardNote = (entry: LibraryEntry, now: number) => string;

/** The one every other column falls back to, and the one an unknown id gets. */
export const ADDED_NOTE: CardNote = (e, now) =>
  `added ${timeAgo(e.addedAt, now) ?? "at some point"}`;

export const CARD_NOTES: Record<string, CardNote> = {
  added: ADDED_NOTE,
  // Both already show their value on the card — the word count is right there,
  // and a title is the card's own heading — so they say when it was added
  // rather than repeating what the reader can already see.
  length: ADDED_NOTE,
  title: ADDED_NOTE,
  opened: (e, now) => {
    const when = timeAgo(e.lastOpenedAt, now);
    return when ? `opened ${when}` : "never opened";
  },
  opens: (e) =>
    e.opens === 0 ? "never opened" : e.opens === 1 ? "opened once" : `opened ${e.opens} times`,
  questions: (e) =>
    e.comments === 0 ? "no comments" : e.comments === 1 ? "1 comment" : `${e.comments} comments`,
};

/**
 * The default sort: **what you read most recently, first.**
 *
 * Greg, 2026-08-27:
 *
 * > Default to sorting by Last Opened.
 *
 * It was `added` — the order the shelf had before any of this existed, which is
 * the order a *list of things that arrived* wants. But a shelf is not an inbox.
 * The thing you are most likely to want is the piece you were part-way through
 * an hour ago, and under `added` that sat wherever it happened to have been
 * fetched, which for anything imported in a batch is nowhere near the top.
 *
 * **What this does to an article you have never opened**: it goes to the
 * bottom, in either direction, and that is `sinkLast` in Library.tsx rather
 * than an accident of the comparator — a missing date is not a small one. Which
 * sounds like it buries every new arrival, and does not, because adding one
 * takes you straight into it (AddPage.tsx navigates to the reading view when
 * the job finishes), so it has been opened by the time you next see the shelf.
 * The two ways back to the ones you have not read are the Added chip and the
 * Unread filter, which is exactly what that filter is for.
 *
 * Single-key on purpose. A compound default — `opened` then `added`, so the
 * never-opened block at the foot came out newest-first — orders the tail better
 * and lights **two** chips on a shelf nobody has clicked, which reads as a
 * sort somebody else left behind.
 */
export const DEFAULT_BY = ["opened"];

/**
 * The order the chips appear in, which is **not** the order of the columns.
 *
 * The table wants the article first, because that is what a row is; the chip
 * row wants **whatever `DEFAULT_BY` names** first, because that is the shelf's
 * resting state and it should be the leftmost thing you see. Two different
 * orders for two different controls, said once here. It led with Added until
 * 2026-08-27 for that reason and leads with Last opened now for the same one —
 * the rule did not change, the default did.
 *
 * Anything sortable and missing from this list is appended rather than dropped
 * — a new column must not be able to vanish from the chip row by being
 * forgotten here. A cross-family review noticed Added had quietly stopped being
 * first when the chips started following column order, 2026-08-26.
 */
export const CHIP_ORDER = ["opened", "added", "title", "length", "opens", "questions"];

/**
 * `now` is passed in rather than read here so that every relative date on one
 * render agrees with every other, and so nothing in this file reads the clock.
 */
export function libraryColumns(shelf: Shelf, now: number): SortableColumn<LibraryEntry>[] {
  return [
    {
      id: "title",
      header: "Article",
      accessorFn: (e) => e.title,
      sortDescFirst: false,
      sortingFn: localeText<LibraryEntry>(),
      meta: {
        label: "Title",
        hint: "Alphabetically, ignoring case and accents",
        ends: ["A to Z", "Z to A"],
        fluid: true,
      },
      cell: ({ row }) => <TitleCell entry={row.original} shelf={shelf} />,
    },
    {
      id: "added",
      header: "Added",
      accessorFn: (e) => at(e.addedAt),
      sortDescFirst: true,
      sortingFn: numberOrMissing<LibraryEntry>(),
      meta: {
        label: "Added",
        hint: "When the article was fetched and built",
        ends: ["oldest first", "newest first"],
      },
      /* The details tooltip hangs off this cell, which is where the card puts
         it too — one trigger, one place to look. The accessible name starts
         with the visible text, or `aria-label` would replace the date the
         reader can see with words they cannot say back. */
      cell: ({ row }) => {
        const when = timeAgo(row.original.addedAt, now) ?? "unknown";
        return (
          <Tooltip content={<Details entry={row.original} />} placement="top">
            <button
              type="button"
              aria-label={`${when} — details of ${row.original.title}`}
              className="tw:cursor-help tw:border-b tw:border-dotted tw:border-border tw:bg-transparent tw:p-0 tw:text-xs tw:text-muted-foreground tw:outline-none tw:focus-visible:text-highlight"
            >
              {when}
            </button>
          </Tooltip>
        );
      },
    },
    {
      id: "opened",
      header: "Last opened",
      accessorFn: (e) => at(e.lastOpenedAt),
      sortDescFirst: true,
      sortingFn: numberOrMissing<LibraryEntry>(),
      meta: {
        label: "Last opened",
        hint: "When you last opened the reading view",
        ends: ["longest ago first", "most recent first"],
      },
      /* An em dash rather than a blank: an empty cell reads as data we failed
         to load, and "never opened" is a fact. */
      cell: ({ row }) =>
        timeAgo(row.original.lastOpenedAt, now) ?? <span title="Never opened">—</span>,
    },
    {
      id: "opens",
      header: "Opens",
      accessorFn: (e) => e.opens,
      sortDescFirst: true,
      sortingFn: numberOrMissing<LibraryEntry>(),
      meta: {
        label: "Times opened",
        hint: "How many times you have opened it",
        ends: ["least opened first", "most opened first"],
        numeric: true,
      },
      cell: ({ row }) => <Count value={row.original.opens} />,
    },
    {
      id: "questions",
      header: "Comments",
      accessorFn: (e) => e.comments,
      sortDescFirst: true,
      sortingFn: numberOrMissing<LibraryEntry>(),
      meta: {
        label: "Comments",
        hint: "How many passages you have marked on it",
        ends: ["fewest first", "most first"],
        numeric: true,
      },
      cell: ({ row }) => <Count value={row.original.comments} highlight />,
    },
    {
      id: "length",
      header: "Words",
      accessorFn: (e) => e.words,
      sortDescFirst: true,
      sortingFn: numberOrMissing<LibraryEntry>(),
      meta: {
        label: "Length",
        hint: "How many words the article is",
        ends: ["shortest first", "longest first"],
        numeric: true,
      },
      cell: ({ row }) => <Count value={row.original.words} />,
    },
    {
      id: "actions",
      header: () => <span className="tw:sr-only">Actions</span>,
      enableSorting: false as const,
      meta: { label: "Actions", hint: "", ends: ["", ""], noChip: true },
      cell: ({ row }) => <RowActions entry={row.original} shelf={shelf} />,
    },
  ];
}

/* ----------------------------------------------------------------- cells -- */

function TitleCell({ entry, shelf }: { entry: LibraryEntry; shelf: Shelf }) {
  const sub = [entry.byline, entry.siteName, `~${entry.minutes} min`].filter(Boolean).join(" · ");

  /* The same in-place rename the card offers, and deliberately the same
     component: the three-outcome contract (`undefined` cancelled, `null` reset
     to the extractor's title, a string is that title) is subtle enough that a
     second copy would get one of them wrong. Which article is being renamed
     lives on the shelf hook, because in this view the input and the pencil that
     opened it are two different cells. */
  if (shelf.renaming === entry.slug) {
    return (
      <TitleEditor
        title={entry.title}
        overridden={Boolean(entry.titleOverridden)}
        className="tw:text-sm"
        onDone={(title) => {
          if (title === undefined) shelf.cancelRename();
          else void shelf.rename(entry.slug, title);
        }}
      />
    );
  }

  return (
    <>
      {/* No stretched link here: a whole row as one click target would swallow
          the buttons at the end of it, and the card already learned that lesson
          (library.md § The card is no longer one big link). The title is the
          link, and only the title. */}
      <Link
        href={readHref(entry.slug)}
        className="tw:block tw:truncate tw:text-foreground tw:no-underline tw:hover:text-highlight"
      >
        {entry.title}
      </Link>
      {(sub || entry.visibility === "public" || entry.fixture) && (
        <span className="tw:block tw:truncate tw:text-xs tw:text-muted-foreground">
          {/* **First on the line, unlike on the card**, because this line
              truncates: the byline and the site name can afford to run out of
              room and "anyone can read this" cannot. */}
          {entry.visibility === "public" && (
            <>
              <SharedBadge />{" "}
            </>
          )}
          {sub}
          {entry.fixture && (
            <span className="tw:ml-1.5 tw:rounded tw:border tw:border-border tw:px-1 tw:py-0.5">
              fixture
            </span>
          )}
        </span>
      )}
    </>
  );
}

/**
 * Zero is drawn faintly rather than hidden: an empty cell in a column of
 * numbers is ambiguous between "none" and "we don't know". The figures line up
 * because `DataTable` puts `tabular-nums` on every `numeric` column — without
 * it, proportionally-spaced digits do not, which is the one thing a table is
 * for.
 */
function Count({ value, highlight }: { value: number; highlight?: boolean }) {
  return (
    <span
      className={`${value === 0 ? "tw:opacity-40" : ""} ${
        highlight && value > 0 ? "tw:text-highlight" : ""
      }`}
    >
      {value.toLocaleString()}
    </span>
  );
}

/** The five buttons, in a cell. Rename opens in place, exactly as on the card. */
function RowActions({ entry, shelf }: { entry: LibraryEntry; shelf: Shelf }) {
  return <Actions entry={entry} shelf={shelf} onEdit={() => shelf.beginRename(entry.slug)} />;
}
