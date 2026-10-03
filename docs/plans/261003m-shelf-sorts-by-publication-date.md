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
paper added by DOI: nothing in the PDF path writes `publishedAt`. Greg filed this from a PDF paper,
so the gap is one he will see.

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

## What landed

*(Filled in at the end.)*
