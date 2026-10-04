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
 * Two of the keys are the "actions/interactions", and they are the only
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

import type { Table } from "@tanstack/react-table";
import { SHARING_ON } from "../messages.js";
import type { LibraryEntry } from "../types.js";
import type { SortableColumn } from "./lib/DataTable.js";
import { at, localeText, numberOrMissing } from "./lib/table-sort.js";
import { Link } from "./Link.js";
import { exactly, publishedOf, timeAgo } from "./relative-time.js";
import { readHref } from "./router.js";
import { Actions, ArchivedMark, NotProcessedBadge, SharedBadge } from "./ShelfEntry.js";
import type { Shelf } from "./ShelfEntry.js";
import { ShelfTags } from "./ShelfTags.js";
import { TitleEditor } from "./TitleEditor.js";
import { Tooltip } from "./Tooltip.js";
import { articleTitleVoice, gistVoice, type Voice, voiceClass, withVoice } from "./voice.js";

/* `archivedAt` read directly rather than through shelf-narrow.ts's `isArchived`:
   this file is shared with the lazy /admin and /design routes, and importing
   shelf-narrow would put it (and library-hits.ts behind it) into the reader's
   startup bytes — tests/eager-client-graph.test.ts § SHARED_WITH_READER. */
const isArchived = (entry: { archivedAt?: string | null }) => !!entry.archivedAt;

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
  published: (e) => {
    const published = publishedOf(e);
    return published ? `published ${published.label}` : "no publication date";
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
export const CHIP_ORDER = ["opened", "added", "published", "title", "length", "opens", "questions"];

/**
 * `now` is passed in rather than read here so that every relative date on one
 * render agrees with every other, and so nothing in this file reads the clock.
 *
 * `archivedShown` is `?archived=1`: archived articles are rows too, and
 * Archive's card must not promise the row leaves (plan 260929a).
 */
export function libraryColumns(
  shelf: Shelf,
  now: number,
  archivedShown = false,
): SortableColumn<LibraryEntry>[] {
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
      /* **Never hideable** (plan 260928a, Sol P-5): a row with no title is not
         a row — it is the link, and it is where the row card hangs. */
      enableHiding: false,
      /* `table` from the cell's context, so the row card can carry back the
         value of every column the reader has hidden. */
      cell: ({ row, table }) => (
        <TitleCell entry={row.original} shelf={shelf} hidden={hiddenColumns(table)} />
      ),
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
      /* **Plain text since 2026-09-28.** This cell carried the cards view's
         `Details` card until then, and in a table that card was the row a
         second time — opens and comments are columns beside it — while the
         title's card below now holds the one thing it had that the row did
         not, the exact date. Two cards per row, one repeating the other and
         both repeating the row, is the failure docs/project/tooltips.md
         § Structure's card describes. `Details` stays on the cards view, which
         has no columns to repeat. Plan 260928a, Decision 2. */
      cell: ({ row }) => timeAgo(row.original.addedAt, now) ?? "unknown",
    },
    {
      /* Greg, 2026-10-03 (report spya-t3es7k): "enable sorting the Shelf by
         publication date where available". The publisher's own day, compared
         and printed as a day — relative-time.ts § `calendarDay` says why not
         as an instant. **An article with no date sorts last in both
         directions**, by the rule every key follows (`sinkLast` in
         Library.tsx): a PDF never has one, so that group is large, and
         borrowing its Added date would put a 1990 paper fetched yesterday at
         the top of "newest first". Plan 261003m.

         **A paper dated only to a year sorts among the dated ones**, at the
         start of its year, and prints as the year alone — `publishedOf`, plan
         261004h. Left with the undated, most older print papers would be
         outside the sort that was built for them. */
      id: "published",
      header: "Published",
      accessorFn: (e) => publishedOf(e)?.t,
      sortDescFirst: true,
      sortingFn: numberOrMissing<LibraryEntry>(),
      meta: {
        label: "Published",
        hint: "When the publisher says it was published",
        ends: ["oldest first", "newest first"],
        /* **A chip always, a column only if asked for.** The table was already
           as wide as the page at 1440px; this column made it 78px wider and
           pushed Actions out of sight (browser check, plan 261003m). The row
           card carries the date while it is hidden — `rowCardFacts`. */
        startsHidden: true,
      },
      /* The date itself, not "3 days ago": it is a fact about the piece, not
         about the reader's week. The dash and its words as on Last opened. */
      cell: ({ row }) =>
        publishedOf(row.original)?.label ?? (
          <span className="tw:opacity-40">
            <span aria-hidden="true">—</span>
            <span className="tw:sr-only">no publication date</span>
          </span>
        ),
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
         to load, and "never opened" is a fact. **The words are an `sr-only`
         span, not a `title`**, since 2026-09-28: a `title` is unreachable by
         touch and by keyboard, and a screen reader meeting a bare "—" hears
         "dash" or nothing. The dash itself is `aria-hidden` so it is not read
         as well. Plan 260928a. */
      cell: ({ row }) =>
        timeAgo(row.original.lastOpenedAt, now) ?? (
          <>
            <span aria-hidden="true">—</span>
            <span className="tw:sr-only">never opened</span>
          </>
        ),
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
      /* None to count on a paper not read through yet: missing, so it sorts
         last whichever way the arrow points, rather than as the shortest. */
      accessorFn: (e) => (e.processing === "minimal" ? undefined : e.words),
      sortDescFirst: true,
      sortingFn: numberOrMissing<LibraryEntry>(),
      meta: {
        label: "Length",
        hint: "How many words the article is",
        ends: ["shortest first", "longest first"],
        numeric: true,
      },
      cell: ({ row }) =>
        row.original.processing === "minimal" ? (
          <span className="tw:opacity-40">
            <span aria-hidden="true">—</span>
            <span className="tw:sr-only">not read through yet</span>
          </span>
        ) : (
          <Count value={row.original.words} />
        ),
    },
    {
      id: "actions",
      header: () => <span className="tw:sr-only">Actions</span>,
      enableSorting: false as const,
      /* **Never hideable** (Sol P-5): five controls, not a value the row card
         could carry back, so hiding them would make them unreachable. */
      enableHiding: false,
      meta: { label: "Actions", hint: "", ends: ["", ""], noChip: true },
      cell: ({ row }) => <RowActions entry={row.original} shelf={shelf} archivedShown={archivedShown} />,
    },
  ];
}

/* ----------------------------------------------------------------- cells -- */

function TitleCell({
  entry,
  shelf,
  hidden,
}: {
  entry: LibraryEntry;
  shelf: Shelf;
  /** The ids of the columns the reader has hidden — `rowCardFacts`. */
  hidden: readonly string[];
}) {
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
        /* `any-pointer-coarse:text-base` — iOS zooms the page in on a field under
           16px and does not zoom back out. The reading view's fields get that floor
           from narrow-window.css § a field iOS zooms into; the utilities layer
           outranks it, so a `tw:`-styled field says so itself. */
        className="tw:text-sm tw:any-pointer-coarse:text-base"
        onDone={(title) => {
          if (title === undefined) shelf.cancelRename();
          else void shelf.rename(entry.slug, title);
        }}
      />
    );
  }

  const facts = rowCardFacts(entry, hidden);
  const archived = isArchived(entry);

  /* No stretched link here: a whole row as one click target would swallow
     the buttons at the end of it, and the card already learned that lesson
     (library.md § The card is no longer one big link). The title is the
     link, and only the title.

     **It wraps, whole**, since 2026-09-28 — Greg: *"Perhaps always show the
     full article title on each row? … the titles are too truncated"*. It was
     `truncate`, one line and an ellipsis. Wrapping rather than widening the
     column, because a wider column only moves the cut: at 1100px the fixed
     columns and the five action buttons already take most of the width, and
     at 390px this column is at its `min-w-56` floor whatever we do. Wrapping
     costs height only on the rows whose title is long. `wrap-anywhere` for the
     title that is one unbroken word — a URL pasted as a title — which would
     otherwise hold the column open past its floor. A two-line clamp was the
     simpler option passed over: it still cuts exactly the titles that were the
     complaint. Plan 260928a, Decision 1. */
  const link = (
    <Link
      href={readHref(entry.slug)}
      className={withVoice(
        "tw:block tw:wrap-anywhere tw:text-foreground tw:no-underline tw:hover:text-highlight-text",
        articleTitleVoice(Boolean(entry.titleOverridden)),
      )}
    >
      {entry.title}
    </Link>
  );

  return (
    <>
      {/* **The row card hangs off the title**, not off the `<tr>`: the row also
          holds five action buttons with cards of their own, and a row-wide
          trigger would open two cards at once over them. The link is
          focusable, so the keyboard gets the card the mouse does. Below, and
          `keepSide`, so a card that cannot fit underneath flips to above
          rather than out sideways over the date columns — Tooltip.tsx
          § `keepSide`. `bottom-start` so it hangs from the start of the title,
          which is where the eye already is. No touch route, the call
          Structure's rows made: a tap on a title opens the article, and
          making that tap reveal-then-commit would slow the thing a tap on a
          shelf is for (plan 260928a, assumption A1). In practice the card is
          never empty — every entry has an added date — but a card with
          nothing in it would be a hover that opens a blank box, so the guard
          is here rather than assumed. */}
      {facts.gist || facts.facts.length > 0 ? (
        <Tooltip content={<RowCard facts={facts} />} placement="bottom-start" keepSide>
          {link}
        </Tooltip>
      ) : (
        link
      )}
      {(sub || archived || entry.visibility === "public" || entry.fixture) && (
        <span className="tw:block tw:wrap-anywhere tw:text-xs tw:text-muted-foreground">
          {/* **First on the line, unlike on the card.** It went first because
              this line used to truncate, and the byline and the site name could
              afford to run out of room where "anyone can read this" could not.
              The line wraps now — for the title's reason, and because the Added
              cell's card used to be the only place a site name pushed past the
              ellipsis could be read in full (plan 260928a, Sol P-1) — but first
              is still the right place for the one fact on it about who can see
              the article.

              **No `title` on the badge here.** Its hover sentence is in the row
              card instead, which a keyboard can reach and a `title` cannot; the
              table body carries no `title` attributes at all. */}
          {/* Ahead even of Shared: it says why the row is here at all
              (plan 260929a) — the card's order, for the card's reason. */}
          {archived && (
            <>
              <ArchivedMark />{" "}
            </>
          )}
          {/* A paper with only its title and abstract read (plan 261001m). */}
          {entry.processing === "minimal" && (
            <>
              <NotProcessedBadge />{" "}
            </>
          )}
          {entry.visibility === "public" && (
            <>
              <SharedBadge titled={false} />{" "}
            </>
          )}
          {sub}
          {entry.fixture && (
            <span className="tw:ml-1.5 tw:rounded tw:border tw:border-border tw:px-1 tw:py-0.5">
              fixture
            </span>
          )}{" "}
          {/* The reader's own tags, and the way to add one — the card's
              control (ShelfTags.tsx), at the end of this line, which is always
              drawn: `sub` always carries the minutes. Plan 261003d. */}
          <ShelfTags entry={entry} shelf={shelf} />
        </span>
      )}
    </>
  );
}

/* -------------------------------------------------------------- row card -- */

/**
 * The ids of the columns the reader has hidden, read off the table rather than
 * passed down, so the row card cannot disagree with the header row about which
 * columns are showing. Asked per column (`getIsVisible`) rather than read from
 * the raw visibility state, which only records the columns somebody toggled.
 * Plan 260928a, stage 2.
 */
function hiddenColumns(table: Table<LibraryEntry>): string[] {
  return table
    .getAllLeafColumns()
    .filter((c) => !c.getIsVisible())
    .map((c) => c.id);
}

/** One line of the row card: a label, and what it says. */
export interface RowCardFact {
  label: string;
  value: string;
}

/**
 * What the row card says — **as data, so it can be checked as data.**
 *
 * `gist` is the one sentence the cards view shows as its blurb and the table
 * gave up; `facts` is the rest, in reading order.
 */
export interface RowCardFacts {
  gist: string | undefined;
  /** Whose words `gist` is — voice.ts § `gistVoice`. */
  gistVoice: Voice;
  facts: RowCardFact[];
}

/** `4 parts`, `1 part`. */
function count(n: number, one: string): string {
  return `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
}

/**
 * **What a row of the table is not already showing, and nothing else.**
 *
 * Greg, 2026-09-28: *"Include a rich tooltip for each row that shows a bunch of
 * extra stuff about the article."* The *extra* is the whole design. A row
 * prints the title, the byline, the site, the minutes, the shared badge, both
 * dates as "3 days ago", and three counts; a card that repeats any of that makes
 * a hover cost the reader a second to discover they knew it already, which
 * docs/project/tooltips.md calls worse than no card. So this is **defined by
 * subtraction**, the rule Structure's card set (tooltips.md § Structure's card,
 * which is defined by subtraction), and each line is here because the row
 * cannot say it:
 *
 * - **The gist** — the tree root's one sentence (`LibraryEntry.gist`). The
 *   cards view's blurb, the thing the table gave up for its columns, and the
 *   main reason the card is worth a hover.
 * - **Added** and **Last opened, exactly** — the row says "3 days ago", or a
 *   bare date past a month (relative-time.ts § `timeAgo`); `exactly` gives the
 *   day and the minute. **An article never opened gets no Last opened line**
 *   while that column is showing: the row's em dash already says never, and
 *   saying it again is the row twice.
 * - **Size beyond words** — parts, sections and blocks. Words is a column.
 * - **Built** — which of the arc, the tweet thread and the glossary exist,
 *   named as `Details` names them ("thread" for tweets). Presence, not
 *   freshness: the flags are `is not null` on the revision's columns
 *   (store/pg.ts § `PRESENCE_OF`), so one built before a re-fetch still counts,
 *   and "built" is the word that claims no more than that. **Omitted when none
 *   is**, rather than `Details`' "nothing beyond the tree", because the entry
 *   carries no flag for the tree and that sentence would be a claim this
 *   function cannot check.
 * - **Renamed by you**, when the title is the reader's own
 *   (`titleOverridden`) — the row shows the title, not whose it is.
 * - **Shared** — the badge's own sentence (`SHARING_ON`). The row shows the
 *   word "Shared"; what it means was the badge's `title`, which the table no
 *   longer draws.
 *
 * **`hidden` is the ids of the columns the reader has hidden** (stage 2 of the
 * plan; `hiddenColumns` reads them off the table). A hidden column is not on the row, so its value
 * comes back here — subtraction applied to the reader's own choice, and what
 * makes hiding safe: nothing becomes unreachable. Added is already exact above,
 * so hiding it adds nothing; hiding Last opened adds only "never", for an
 * article never opened; the three counts come back as themselves.
 */
export function rowCardFacts(entry: LibraryEntry, hidden: readonly string[]): RowCardFacts {
  const facts: RowCardFact[] = [];
  const isHidden = (id: string) => hidden.includes(id);

  const added = exactly(entry.addedAt);
  if (added) facts.push({ label: "Added", value: added });

  const opened = exactly(entry.lastOpenedAt);
  if (opened) facts.push({ label: "Last opened", value: opened });
  else if (isHidden("opened")) facts.push({ label: "Last opened", value: "never" });

  /* The cell prints the whole date, so the card repeats it only when the
     column is hidden — and says nothing where there is none to carry back. */
  const published = publishedOf(entry);
  if (published && isHidden("published")) facts.push({ label: "Published", value: published.label });

  if (isHidden("opens")) {
    facts.push({
      label: "Opened",
      value: entry.opens === 0 ? "never" : entry.opens === 1 ? "once" : `${entry.opens} times`,
    });
  }
  if (isHidden("questions")) {
    facts.push({ label: "Comments", value: entry.comments.toLocaleString() });
  }

  const size = [
    ...(isHidden("length") ? [count(entry.words, "word")] : []),
    count(entry.parts, "part"),
    count(entry.sections, "section"),
    count(entry.blocks, "block"),
  ];
  facts.push({ label: "Size", value: size.join(" · ") });

  const built = [
    entry.has.arc && "arc",
    entry.has.tweets && "thread",
    entry.has.glossary && "glossary",
  ].filter((b): b is string => Boolean(b));
  if (built.length > 0) facts.push({ label: "Built", value: built.join(" · ") });

  if (entry.titleOverridden) facts.push({ label: "Title", value: "renamed by you" });
  if (entry.visibility === "public") facts.push({ label: "Shared", value: SHARING_ON });

  return { gist: entry.gist, gistVoice: gistVoice(entry), facts };
}

/**
 * The row card, drawn with the `.tip-*` classes the spine's and Structure's
 * cards use, so it reads as the same kind of thing. **No title line**, unlike
 * those two: the title is the link the reader is pointing at, printed in full
 * on the row. tooltip.css § the shelf table's row card.
 */
function RowCard({ facts }: { facts: RowCardFacts }) {
  return (
    <>
      {/* The model's gist or the article's excerpt. The voice goes on a span:
          `.tip-gist` is in voices.css's AI list, which would out-rank a voice
          class on the same element (voice.ts § `voiceClass`). */}
      {facts.gist && (
        <p className="tip-gist">
          <span className={voiceClass(facts.gistVoice)}>{facts.gist}</span>
        </p>
      )}
      {facts.facts.length > 0 && (
        <dl className="tip-facts">
          {facts.facts.map(({ label, value }) => (
            <div key={label} className="tw:contents">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
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
        highlight && value > 0 ? "tw:text-highlight-text" : ""
      }`}
    >
      {value.toLocaleString()}
    </span>
  );
}

/**
 * The five buttons, in a cell. Rename opens in place, exactly as on the card.
 *
 * `inTooltipGroup`: the table body is one `TooltipGroup` (Library.tsx), and the
 * buttons join it rather than nesting a group of their own, so a title's row
 * card and an action's card can never be open together. Plan 260928a, Sol P-3.
 */
function RowActions({
  entry,
  shelf,
  archivedShown,
}: {
  entry: LibraryEntry;
  shelf: Shelf;
  archivedShown: boolean;
}) {
  return (
    <Actions
      entry={entry}
      shelf={shelf}
      onEdit={() => shelf.beginRename(entry.slug)}
      inTooltipGroup
      archivedShown={archivedShown}
    />
  );
}
