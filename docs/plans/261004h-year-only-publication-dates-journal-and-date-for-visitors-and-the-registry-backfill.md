# Year-only publication dates, the journal and date for a visitor, and the backfill

Up: [plans.md](../project/plans.md)

The follow-up to
[261004a](261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md),
which is deployed. Its debrief asked Greg three questions. Greg, 2026-10-04, relayed by the Overseer:

> Q-backfill yes
>
> Q-year-only-papers yes
>
> Q-visitor-page yes

What each one was, in the Overseer's words to this session:

- **Year-only papers.** Some Crossref records give only a year, or a year and a month. Store the
  year separately and show "Published 2011". A made-up 1 January date was rejected.
- **The visitor's page.** Show the journal and the publication date on the public Metadata page.
  These two facts only.
- **Backfill.** Fill DOI, journal and publication date for the articles already in production
  (44 with a current revision on 2026-10-04: 25 PDFs, 19 web pages, none with a DOI).

## What is already true

- `withRegistryFacts` (`src/article-registry.ts`) fills `doi`, `journal` and `publishedAt` from an
  agreed registry record. `publishedAt` only when the article has none and the record states a
  whole day.
- `WorkRecord.year` already exists, from Crossref and from DataCite, and is in the cache table.
- `PublicMeta` (`src/public-types.ts`) has six fields. `publicMeta` in `src/public/dto.ts` builds
  them from a named projection in `src/store/public-reader.ts`.
- The Shelf's Published sort reads `calendarDay(e.publishedAt)?.t`. No date sorts last.
- A read PDF's transcript is not stored. The raw PDF is, and so is a page's raw HTML.

## Stage 1: the year, and the visitor's two facts

### The year

1. A new nullable column, `article_revisions.published_year` (integer, checked 1000 to 2999), and
   `Meta.publishedYear`. It goes through every mapping `journal` does (F1 of 261004a's review).
2. `withRegistryFacts` writes it when a record agrees, the record has a `year`, and the article
   ends up with no `publishedAt` (its own or the registry's day). An article has a day or a year,
   never both, so nothing has two sources to disagree.
3. An ordinary re-extraction asks afresh, as for `journal`. `keptPaperMetadata` carries it on the
   minimal-to-full transition only.
4. **One reader of both**: `publishedOf({ publishedAt, publishedYear })` in
   `src/web/relative-time.ts`, returning `{ t, label, precision: "day" | "year" }`. A day gives
   what `calendarDay` gives. A year gives the label `2011` and a sort key.
5. The owner's Metadata page prints `Published 2011`.
6. `LibraryEntry.publishedYear`, and the Shelf's column, sort chip, row card and sort note read
   `publishedOf`.

**The sort decision.** A year-only paper sorts **among the dated ones**, at the start of its year:
a paper marked 2011 sits beside the articles dated in 2011, before any of them in "oldest first".
The other choice was to leave year-only papers with the undated ones at the bottom. That would put
most older print papers, which is most of what a year-only record is, outside the sort that was
built for them. The start of the year is used only as a sort key. It is never stored and never
printed.

**Timeline is not changed.** `datedArticleFingerprint` does not read the year, and Timeline's
reference frame stays a whole day. A year is too coarse to resolve "last March" against.

A year and a month (Crossref `[2011, 3]`) is kept as the year. A month would be a third precision
for a case nobody asked for.

### The visitor

7. `PublicMeta` gains `journal`, `published` (the calendar day, `YYYY-MM-DD`) and
   `publishedYear`. The public reader selects `journal`, `published_at` and `published_year`.
8. **The day, not the stored string.** `publishedAt` may carry a time and an offset. The DTO sends
   its first ten characters when they are a real day (`dayFrame`), and nothing otherwise. The field
   has a different name from the owner's so nobody mistakes one for the other.
9. `publishedYear` is the publication date at the precision the registry stated. I am treating it
   as inside Greg's yes to "publication date", and saying so in the debrief. `doi` stays out.
10. `PublicMetadataPage` prints the journal (dropped when it repeats the site name, as on the
    owner's page) and `Published …`.
11. `tests/public-dto.test.ts` and `tests/shared-inventory.test.ts` decide the new keys. The
    sharing dialog's inventory says a shared link carries where and when the piece was published.
12. Docs: `security-map.md` and `public-types.ts` say "six fields"; `privacy.md` if it lists them;
    `library.md` for the sort; `/help` if it describes the Metadata page or the Published sort.

The public shelf (`/read/public`) is not changed. Its eight columns are a separate allowlist.

### Tests, each seen red first

- `withRegistryFacts`: a year-only record fills `publishedYear` and no `publishedAt`; a whole day
  fills `publishedAt` and no year; an article with its own `publishedAt` gets neither.
- Store round-trip carries `published_year`.
- `publishedOf`: day, year, neither, and a year-only entry sorts between two dated ones.
- Metadata page draws `Published 2011`.
- Public DTO: journal, day and year cross; a `publishedAt` with a time crosses as the day only;
  `doi` does not cross; an article with none of them has none of the keys.
- `PublicMetadataPage` draws them.

## Stage 2: the backfill script

`scripts/backfill-registry-facts.ts`. Three modes, and the dry run is what you get with no flag.

```
(no flag)            read, ask the registries, print and save a plan file. Writes nothing.
--apply <plan.json>  write exactly the rows in that plan file. Asks no registry.
```

**Why apply takes the plan file.** What Greg or the Overseer read in the dry run is then exactly
what is written. A second live run could get a different answer from Crossref.

For each article with a current revision:

1. **Candidates, without a model.** A PDF: the text layer of the first two pages of the stored raw
   PDF, through `ownIdsOfPdf`. A scan with no text layer has no candidates. A web page: the stored
   raw HTML through `ownIdsOfDocument`.
2. **The registries, asked directly.** Not through `lookupWork`'s database cache: the dry run is
   inside a read-only transaction, and a cached record from before 2026-10-04 has no day. The
   script fetches Crossref then DataCite with the same parsers, 300 ms apart, at most three
   candidates an article.
3. **`withRegistryFacts`**, unchanged, decides. Title and author must agree.
4. **The plan file** has one row per article: slug, revision id, source kind, outcome, and for each
   of `doi`, `journal`, `published_at`, `published_year` the value it would write. It also has
   whether the article has a Timeline today, so the stale count can be stated.

`--apply` runs one transaction. Each row is one `update article_revisions set … where id = $1 and
<each column it sets> is null`, so it never overwrites and a second run changes nothing. It prints
a `Target:` line (host and database, never the password) before anything else, and the count of
rows changed after. It refuses a plan file whose target differs from the database it is pointed at.

The dry run opens its connection, runs `BEGIN READ ONLY`, and never commits.

**The shelf's cached scalars.** If `publishedAt` on the shelf comes from a stored copy rather than
the revision row, apply has to refresh it. Stage 2 finds out and writes down which.

**Timeline.** An article that gains `published_at` and has a Timeline shows it as out of date. The
owner pays only if they regenerate. The dry run counts these. A year causes none.

### Tests

- The plan builder, with a fake lookup and fixture sources: PDF agrees, page agrees, nothing agrees,
  no candidates.
- Apply against the local test database: fills nulls, leaves a non-null alone, second run changes
  nothing, refuses a plan from another target.

## Order, and the deploy

Stage 1, then stage 2, then the dry run against production, read-only. The real write runs only if
this session is allowed to. Otherwise the one command is left for Greg.

`published_year` does not exist in production until a deploy applies the migration. So the apply
needs the deploy first if any row carries a year. The script checks the column exists and says so
plainly if it does not. DOI, journal and whole days could be written before the deploy; one run
after it is simpler, and is what I will recommend.

## The simpler options passed over

- **No new column: a year in `publishedAt`.** Every reader of that field wants a whole day.
- **Backfill by re-running `extract`.** A PDF re-read is a paid model call for each of 25 papers,
  and it would change their text.
- **Send the visitor the owner's `publishedAt` verbatim.** It can carry a time of day and an
  offset, which a visitor has no use for.

## GPT Sol's plan review, and what changed

[The review](261004h-year-visitor-backfill-plan-review-sol.md): verdict *not yet*, two P1s, both in
apply. The text above is the plan as reviewed; where a finding changed it, this section wins.

- **F1, taken.** Apply locks each article row (`for update`) and writes only when the plan's
  revision is still that article's current revision. It refuses an article that has an unfinished
  draft, because a draft copied before the write would publish later without the facts. A refused
  article is listed by slug with its reason, and the others are still written. Both races are
  tested.
- **F2, taken.** Filling either date column requires both to be null. The migration adds a check
  that `published_at` and `published_year` are never both set. Apply reports three outcomes for a
  row: written, already as the plan says (a second run), and refused because something else is
  there now.
- **F3, taken.** No second transport. The script calls `lookupWork` with its dependencies swapped
  for an in-memory cache and limiter, so routing, bounded waits, the Crossref-then-DataCite
  fallback, the 250 ms and 500 ms spacings and the cooldown are the shipped ones. Nothing is read
  from or written to the registry cache table. If `LookupDeps` cannot be swapped that way, the
  smallest shared helper is exported from `src/bibliographic.ts` and both use it.
- **F4, taken.** `firstPagesText` returns one string and drops sideways text, so an arXiv margin
  stamp is lost. Stage 2 adds a per-page reader beside it in `src/pdf.ts` that returns
  `{ page, text }[]` for the first two pages and keeps rotated text, and tests it on a real
  text-layer fixture.
- **F5, taken.** `cached-shelf.ts` validates the year. `store/export.ts` and `feedback-article.ts`
  copy `publishedAt` and not `journal`; the year follows the date there, since it is the same fact.
- **F6, taken.** `PublicMeta` has seven fields today.
- **The tie.** A paper marked 2011 has the same sort key as an article dated 1 January 2011. It
  does not necessarily come before it. Accepted.
- **A missing source is its own outcome.** No stored raw reference, and a referenced object that is
  missing or unreadable, are each reported separately from "no candidates".
- The sharing inventory's words live in `src/messages.ts`. The Metadata network trace gets a
  fixture with a day and one with a year.

## Log

- 2026-10-04: plan written.
