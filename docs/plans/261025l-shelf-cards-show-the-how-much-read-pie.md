# 261025l — Shelf cards show the how-much-read pie

Up: [plans.md](../project/plans.md) · feedback `spya-e5477u` (#706) · question
[q-y78eth](../user-feedback/questions/q-y78eth.md) · session `fbe5477u-shelf-pie`

Greg answered q-y78eth on 2026-10-25, in the Feedback dialog (reply `spya-a5unyd`) and in the
Overseer's chat:

> 1A

> q-y78eth yes

Option A: **every shelf card shows the same pie as the top of the article**
([261025j](261025j-how-much-of-the-article-you-have-read-at-the-top.md)). His brief: the same rules
with no second copy of the bands or thresholds; the figure comes from the server in one query per
shelf load, not one per card; the owner's own data, never shown to a visitor or on the public shelf.

## The difficulty

The masthead's band is

```
readBand( shareRead( levels, readSoFarWords(blocks, foldedOnArrival(article)) ) )
```

`levels` is `readLevel(seconds, words)` per block, and is cheap: the `reading_time` rows joined to
each block's word count. **The denominator is not.** `foldedOnArrival` (matter-view.ts) reads the
masthead's echo of the title (the first two blocks' text and html, the title, the rename flag) and
the stored `matter`. The stored matter is trusted only after `matterForReader` recomputes a sha256
over **every** block's text. Otherwise it falls back to a heuristic over the leading blocks' text
and the authors. So working it out exactly needs every block's text of every article.

Measured on production, read-only, 2026-10-25: Greg's shelf is 33 articles, 15 with reading time,
4,621 blocks and 1.5 MB of block text (the html roughly doubles it), with 931 `reading_time` rows.
Plan [260828c](260828c-library-read-latency.md) took about 1.1 MB of block reading out of every
shelf load. Putting that back for a 14px pie is the wrong trade.

## What changes

1. **A cache of the denominator, per article: `read_so_far_words`.** One row per article:
   `article_id` (primary key, cascades with the article), `words` (jsonb, block id to words: exactly
   what `readSoFarWords` returns, so the shelf's denominator is the reading view's `bodyWords`),
   `basis` (text, the fingerprint below) and `computed_at`. It is derived data, not the reader's
   work: left out of both exports, and deleted on a transfer as reader state, because it carries
   which blocks counted for that reader's view.

2. **The basis, one SQL expression, `readSoFarBasis`**, over every input `foldedOnArrival` reads, as
   stored: the current revision id (blocks are fixed per revision, and so is the first-`<h1>` title
   fallback), `md5(matter::text)` (matter is rewritten in place and carried between revisions), the
   revision's `title`, `byline` and `authors`, the article's `title_override` and its slug. The
   shelf and the writer both use this one expression, so they cannot disagree about whether a row
   is fresh. **A stale or missing row means no pie, never a wrong one.**

3. **The shelf's one extra statement.** For the owner's articles on this page that have reading
   time: the article id, the cached `words` and `basis`, the current `readSoFarBasis`, and the
   seconds as one `jsonb_object_agg` of that article's `reading_time` rows. About 931 small pairs
   plus 15 cached maps; no block text, no html. In TypeScript:
   `readBand(shareRead(levels, words))`, where the levels come from `readLevel` through the same
   helper the chats' `readingShare` uses (reading-so-far.ts). No cut point is restated.

4. **The shelf refreshes stale rows itself, a few per load.** For a row whose basis is missing or
   differs, it calls `loadArticle` (the owner's read, so title, authors and validated matter are
   exactly what the masthead gets), computes `readSoFarWords(blocks, foldedOnArrival(article))` and
   upserts it, **guarded** by `readSoFarBasis = <the basis read before the load>`. If an input
   changed meanwhile, the write does nothing and the card has no pie until the next load. At most
   **5** refreshes per shelf load, run together, so the first load after this deploys does at most
   five article reads, and Greg's 15 read articles fill in over three loads. After that an article
   is reloaded only when one of its inputs changes. A failure (minimal paper, not found, a database
   error) leaves that card without a pie and is logged once for the request, as
   `{ count, first five slugs }`.

5. **On the wire, owner only.** `LibraryEntry.readBand?: "started" | "half" | "most" | "finished"`,
   absent for none, no reading time, or a stale cache. Only the owner's `listArticles` sets it. The
   public shelf (`src/store/public-library.ts`) has its own DTO and query, which this does not
   touch, and a visitor never reaches `listArticles`.

6. **Drawn by `ReadSoFarMark`, unchanged**: the card puts it right after the "~N min" fact, as the
   masthead does; the table puts it after the title cell's sub-line, which ends with the minutes.
   The pie's button sits above the card's stretched link (`relative`). The card's words and the
   button's name are the masthead's own.

## Passed over

- **Exact on every shelf load** (read every block of every read article). Correct and uncached, and
  costs 1–3 MB a load. Above.
- **Recomputed at each reading-time flush.** One article read per minute of reading, and still
  stale after a rename with no reading.
- **The reading view sends its share.** Cheapest, and the server would store a figure it did not
  work out.
- **Kept current at each writer** (publish, the matter step, rename). Three writers of a derived
  column with nothing catching the one that forgets, the invariant library.md warns about. The
  basis turns a forgotten writer into a missing pie.
- **Refreshed only when the article is opened.** Every article read before this ships would have
  no pie until opened again.
- **Columns on `articles`** instead of a table. Every article read selects that row whole and would
  carry the map.

## Checks

Each seen red first.

- **Equivalence**, against the local database: articles with the title echoed, valid stored matter,
  stale stored matter, heuristic front matter, a rename. The shelf's band equals
  `readBand(shareRead(levels, readSoFarWords(blocks, foldedOnArrival(loadArticle(slug)))))`.
- **The basis moves with each input**: rename, matter rewritten, a new revision, title, byline,
  authors. After each, the cached row is stale and the card has no pie until refreshed. Dropping
  one input from the expression fails the test.
- **The guard**: a basis that no longer matches at write time writes nothing.
- **Statements**: tests/store-shelf-reads.test.ts goes from two to three when nothing is stale.
- **Owner only**: the public shelf carries no `readBand`, at the type level.
- **Components**: the card and the table draw the mark for each band and nothing when absent.
- `npm test`, `npm run typecheck`, lint on touched files, and a Sonnet browser look at the shelf.

## After GPT Sol's plan review

[The review](261025l-plan-review-sol.md) found no P0 and four P1s. All four were right. **The
design above changes as follows, and this section wins where the two disagree.**

- **P1, the shelf must not write.** `listArticles` is also called by the unauthenticated health
  check (`src/vercel-health.ts`) and by shelf mutations rebuilding one card, so a refresh inside it
  would let a stranger's poll write rows and log failures. **The shelf only reads.** Its third
  statement takes fresh rows and ignores the rest; § What changes, point 4 is withdrawn.
  **The writer is the reading-time flush instead** (`POST …/reading-time`): after adding the
  seconds, one statement compares the cached basis with the current one, and only when they differ
  does it call `loadArticle`, compute, and write. That happens once per article per change, not
  once a minute, and never for an admin viewing as a reader, because that view cannot write. A
  failure there is logged and does not fail the flush. **Articles read before this ships get theirs
  from a backfill**, `scripts/read-so-far-backfill.ts`, which calls the same function as each
  article's owner (`runAsOwner`). It is a dry run unless given `--write`, prints its `Target:`, and
  is left for the Overseer to run on production after the deploy, because this session writes
  nothing there.
- **P1, the basis must cover the code as well as the data.** It now also carries
  `READ_SO_FAR_RECIPE` (bumped by hand when the fold or counting rules change),
  `SANITIZER_VERSION` (the blocks `loadArticle` returns are cleaned under today's sanitiser), and
  the matter versions a read still accepts. It is hashed from a `jsonb_build_array`, never a
  delimiter-joined string. A test pins a hash of front-matter.ts and masthead-echo.ts, which are
  wholly about what folds, beside the recipe, so editing either fails until the recipe is bumped or
  the pin is consciously updated.
- **P1, the guard.** The insert is `INSERT … SELECT … FROM articles … WHERE owner_id = <owner> AND
  readSoFarBasis = <basis>`, so the predicate guards the insert and the update arm alike, and an
  ownership transfer between the load and the write writes nothing. **Accepted, and written beside
  the code:** an input changing and changing back while one article is being read (A, B, A) would
  stamp B's result with A. Closing it would mean threading a transaction through `loadArticle`. The
  harm is one card's band wrong until any input next changes.
- **P1, the browser's copy.** The shelf is painted from IndexedDB before the server answers
  (`src/web/lib/cached-shelf.ts`), and offline it is only that copy. **`readBand` is stripped
  before a shelf is cached and from any cached shelf read back**, so a cached shelf never draws a
  pie and the live answer does.
- **P2, classification.** The table holds the article-derived denominator, not the reader's
  activity, so it is `moves` in a transfer, like `revision_blocks`; the basis carries
  `title_override`, which a transfer clears, so the row goes stale by itself. Left out of both
  exports. **`computed_at` stays**: Greg's rule is that anything a model or a reader makes gets a
  timestamp (*"I just have a hunch that occasionally it will be useful"*, 2026-10-03).
- **P2, docs and a runtime public check.** library.md § What a card says gets the mark and the
  cached-shelf rule; privacy.md § Reading time records that only the denominator is cached, never
  seconds or the band. A runtime test seeds reading time and a cache row and asserts the public
  shelf's wire has no `readBand`.
