# The Shelf sorts by publication date

Up: [plans.md](../project/plans.md) · area doc: [library.md § Sorting the shelf](../project/library.md#sorting-the-shelf)

Feedback report `spya-t3es7k`, Greg, 2026-10-03 17:24, from the signed-in homepage:

> In the logged in homepage, enable sorting the Shelf by publication date where available. And I
> guess if it's not available, use your judgment about what's best to do. Keep things simple.

## What is already true

- **The Shelf sorts by six keys**: Last opened (the default), Added, Title, Length, Times opened,
  Questions. One sort state drives the cards and the table; it lives in `?by=` and `?dir=`.
  `libraryColumns` in `src/web/library-columns.tsx` is the whole definition, and a new sortable
  column gets its chip, its table column, its header menu and its URL key from `DataTable` for free.
- **A publication date is already stored**: `article_revisions.published_at`, text, the publisher's
  own ISO string (`src/db/schema.ts` § `publishedAt` says why it is not a timestamp:
  the calendar day is the whole content, and a zone conversion can move it by one). Stage 2
  produces it from Readability's `publishedTime` (`src/extract.ts` § `publicationDate`), as
  `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM…` with an optional offset. That is the only *producer* of a new
  date; the store copies whatever `Meta.publishedAt` holds and the database does not enforce the
  shape, so the browser validates what it reads rather than trusting it.
- **The Shelf's query already selects it** (`REVISION_PROJECTIONS` gives `publishedAt` to
  `library`), and `metaFrom` already puts it on the `Meta` that `describeArticle` receives. It stops
  there: `LibraryEntry` has no field for it, so the browser never sees it.
- **Missing values already sort last in both directions** for every key, through `sinkLast` on the
  primary sort key in `Library.tsx`.

So there is no migration, no new query and no new sorting rule. The work is carrying one field to
the browser and adding one column.

## Who has a date and who does not

Only a web page whose publisher states one in its metadata, and only if the article was extracted
on or after 2026-08-31, when stage 2 started keeping it. **A PDF never has one**, and nor does a
paper added with only its metadata: neither metadata writer produces `publishedAt`. A DOI URL
that resolves to HTML follows normal web extraction and can have a date. A shelf of
papers is mostly undated, so the gap is one Greg will see.

## What gets built

1. `LibraryEntry.publishedAt?: string`, the publisher's string, verbatim. `describeArticle` copies
   it from `meta.publishedAt` when present. `cached-shelf.ts` accepts it as an optional string.
2. A `published` column in `libraryColumns`:
   - header and chip **Published**; hint "When the publisher says it was published"; ends
     "oldest first" / "newest first"; newest first on the first click, like Added.
   - **the sort value is the calendar day only**: the first ten characters, parsed as
     `${day}T00:00:00Z` and checked to round-trip (the check `publicationDate` itself makes; not
     `Date.UTC(y, m, d)`, which reads a year under 100 as 19xx). Not `Date.parse` of the whole string, which would order two pieces
     by their time of day and zone, and would read a bare `2026-03-01` as UTC midnight but a
     full timestamp in its own zone. Anything that is not a real day is `undefined`.
   - **the cell is the date itself**, `12 Mar 2024`, formatted in UTC from that same number so the
     day printed is the day stored, whatever zone the reader is in. Not "3 days ago": a piece's
     publication date is a fact about the piece, not about the reader's week. No date draws the
     same em dash plus screen-reader words as Last opened: "no publication date".
   - hideable, like the other data columns. When hidden, the row card carries the value back
     (`rowCardFacts`), only when there is one.
3. `CHIP_ORDER`: `published` goes after `added`. `CARD_NOTES.published`: "published 12 Mar 2024",
   or "no publication date", so a card sorted by it says why it is where it is.
4. Docs: library.md § Sorting the shelf (seven chips, and what a missing date does),
   url-state.md's `by` row, and the help page if it lists the sort keys.

One helper, `calendarDay(iso): { t: number; label: string } | undefined`, in
`src/web/relative-time.ts`, so
the accessor, the cell, the card note and the row card cannot disagree about what counts as a date.

## An article with no date

**It sorts last, in both directions**, with the fixture below it. That is the rule every other key
already follows and it needs no code: `sinkLast` in `Library.tsx` fires on `undefined`. Inside the
undated group the order is by slug, which is the table's existing tiebreak.

Passed over, with reasons:

- **Fall back to the Added date** for an undated article. It mixes two different facts in one
  column, and a paper from 1990 added yesterday would sort as the newest thing on the shelf.
- **A year for PDFs and papers from Crossref or the PDF's front matter.** That is the real fix for
  the gap above, and it is a pipeline change (a new field, a lookup, a re-extraction for existing
  articles), not a Shelf change. Left as a question for Greg in the debrief; not built.
- **A chip with no table column.** The table is already wide. But `DataTable` derives chips from
  columns, the column is hideable, and a sort the table cannot show is the "order the reader cannot
  check" that library.md § The card says what it is sorted by rules out.

## Tests, red first

In `tests/library-sorting.test.ts`, against the real columns:

- `published` sorts both ways by day; an undated article is last in both directions; the fixture
  is last under `published` too (add the id to the existing loop).
- two timestamps on the same calendar day with different offsets tie on day and fall to the next
  key; a date-only string and a timestamp for the same day tie.
- a string that is not a date (`"soon"`, `"2026-02-31"`) is undated, not zero.
- `?by=published` parses, and its natural direction is descending.

Elsewhere: `describeArticle` carries the field and omits it when absent
(`tests/library.test.ts` or wherever `describeArticle` is tested); `rowCardFacts` gives
Published only when the column is hidden and a date exists; `shelfFromCachedBody` rejects a
non-string `publishedAt` and accepts an absent one. A store test that the Postgres listing returns
it, if one exists for the listing's fields.

At the end, mutate: make the accessor return `Date.parse(iso)` and check a test notices.

## Done

Gates green (`npm test` on the touched files, `npm run typecheck`, lint on touched files), a Sonnet
browser check at desktop, iPad and phone widths, GPT Sol on the code, pushed to `dev`, feedback note
written.

## Review

GPT Sol, plan review, 2026-10-03:
[261003m-shelf-sorts-by-publication-date-plan-review-sol.md](261003m-shelf-sorts-by-publication-date-plan-review-sol.md).
No P0 or P1. Three P2s, all taken:

- **F1** — `tests/shelf-table-hide-columns.test.tsx` lists every header and every Columns-menu
  item, and library.md counts the columns. Updated; and the full suite is the gate, not only the
  touched files.
- **F2** — `Date.UTC` maps years 0–99 to 19xx. The helper parses `${day}T00:00:00Z` instead.
- **F3** — the fixture loop passes for an id no column has, because TanStack ignores it and the
  fixture sink still fires. The loop now asserts each id is a real sortable column, and the fixture
  carries a date so it is the fixture rule holding it down.

It also confirmed what the plan leaned on: the owner's listing already receives the column; no
public or visitor response is built from `describeArticle` or a `LibraryEntry`; chips, the Columns
menu, stored hidden-column preferences and `?by=` parsing all derive from the column list, so there
is no other registry to tell. It corrected one claim, folded in above: `publicationDate` is the only
producer of a new date, not the only writer of the column.

## Code review and browser check

GPT Sol, code review of `dcf7d1755`, 2026-10-03:
[261003m-shelf-sorts-by-publication-date-code-review-sol.md](261003m-shelf-sorts-by-publication-date-code-review-sol.md).
Verdict **land after fixes**; it made all three itself and I read and kept them.

- **C1 (P1)** — the printed date now names the Gregorian calendar, so a locale whose default
  calendar is Buddhist or Persian prints the publisher's year; and ISO year zero prints its era.
  The second half is more care than a shelf needs, and it is three lines, so it stays.
- **C2 (P2)** — "a paper added by DOI has none" was false: a DOI address can resolve to a dated
  web page. library.md and this plan corrected.
- **C3 (P2)** — the three test files passed with the Published cell printing nonsense. A
  rendered-cell test added, seen red.

Browser check (Sonnet, Playwright, 1440 / 820 / 390), on `dcf7d1755`: sorting, undated-last in both
directions, the card notes, the Columns menu, the row card and `?by=published` all pass at all
three widths; seven chips sit on one line at 1440 and 820 and wrap to two rows at 390; no console
errors. `2024-03-11T23:30:00-05:00` printed as the 11th. Screenshots: `261003m-shot-*.png`; the desktop table one shows the overflow
below, before its fix.

**One finding, and it changed the design.** The table was 924px wide in an 846px container at
1440: the new column added 99px, so Actions sat past the right edge. Before, it was 825px and fit.

**So Published starts hidden in the table** (`meta.startsHidden`), and the passed-over option "a
chip with no table column" above turns out half right. The chip always sorts; the column is one
click away in the Columns menu, whose count reads 1 at rest; the row card carries the date while it
is hidden. Passed over: widening the page in table view (a layout decision for the whole shelf, not
this report's), and trimming other columns to make room (78px is most of a column).

The cost is a second localStorage key, `spya.shelf.shownColumns`. The existing key lists *hidden*
ids, which cannot say "shown"; and a list saved before Published existed does not name it, which
must not read as "show it". A column that starts hidden is hidden unless the second key names it.

**The fix, checked** (on `59545ce12`). GPT Sol, read-only, on the new code alone:
[fix-check](261003m-shelf-sorts-by-publication-date-fix-check-sol.md), verdict **land**, no
findings; it judged the second key reasonable against one versioned object with a migration.
Browser, fresh profile: at 1440 the table is 846px in an 846px container; Columns reads 1 at rest;
`?by=published` orders the rows with the column hidden and the row card says the date; showing the
column survives a reload, hiding it again survives a reload; a saved `["length"]` list still leaves
Published hidden. No console errors. At 820 and 390 the table scrolls inside its own box (816px),
as it did before this work. Screenshots `261003m-shot-desktop-table-after.png` and
`261003m-shot-ipad-table-after.png`; the row's buttons are drawn on hover, so neither shows them.

## What landed

- `LibraryEntry.publishedAt`, filled by `describeArticle`; no migration, no new query.
- `calendarDay` in `src/web/relative-time.ts`: the day as a sort number and a printed date.
- The `published` column, chip, card note and row-card fact in `src/web/library-columns.tsx`;
  `startsHidden` in `src/web/shelf-hidden-columns.ts`.
- Docs: library.md § Sorting the shelf and § The table's row card; url-state.md; one sentence on
  the help page.
- Not built: a publication year for PDFs and metadata-only papers. A question for Greg.
