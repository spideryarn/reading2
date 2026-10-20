# A total-cost column on `/admin/articles`

Queue item `qi-c32nvwg4`. Report `spya-vjyev3` (Sentry SPIDERYARN-READING2-MG), a suggestion from
Greg, proved an administrator's against its production row (`feedback-reporter.ts`, exit 0). Filed
2026-10-19 21:08 UTC from `https://www.spideryarn.com/admin/articles`.

> Also show Total Cost per article
>
> — Greg, 2026-10-19

The page is [admin.md § `/admin/articles`](../project/admin.md#adminarticles-moving-an-article-to-another-account);
the money is [cost-tracking.md](../project/cost-tracking.md) and
[admin-costs.md](../project/admin-costs.md). Two weeks earlier, on `/admin/costs`, Greg said of the
same figure: *"that's what I care about most! That's what we should sort by"* (2026-10-06,
[261006j](261006j-total-cost-column-on-admin-costs-and-metadata.md)).

## What is there already

- **One article's cost** is `spendForArticle` ([`ai-calls-spend-pg.ts`](../../src/store/ai-calls-spend-pg.ts)),
  read by the Metadata page's admin section. Its rule for which ledger rows are the article's is
  `belongsTo`: rows carrying the article's id, plus rows with no id that carry the owner's slug and
  started after the article was created (a reused slug must not inherit a deleted article's rows).
  Its money is the three pockets added (credits + BYOK + computed), with a call that reported no
  money counted as *unpriced*, which makes the total a floor.
- **`/admin/articles`** is a plain table (Article · Owner · Added · Visibility · Read · Transfer),
  newest first, built from `listArticlesAcrossOwners` in
  [`pg-article-transfer.ts`](../../src/store/pg-article-transfer.ts).
- **`/admin/costs` already shows money per article across owners**, by opaque id
  (`spendCube`'s header comment says what it may return). So a cost on every row of
  `/admin/articles`, including another reader's private article, shows nothing the administrator
  cannot already see; it adds no title, slug or prose. Not a widening of
  [admin.md § What it deliberately does not show](../project/admin.md#what-it-deliberately-does-not-show).

## The change

1. **Store: `spendByArticle()`** in `ai-calls-spend-pg.ts`, next to `spendForArticle`: every
   article's `{ nanos, calls, unpricedCalls }` (the `RunSpend` shape `spendByRun` already returns),
   by article id, over the article's whole life. **One `GROUP BY article_id`**, which is
   `spendCube`'s rule and so `/admin/costs`'s: a row with only a recorded slug is not claimed for any
   article. The same `CREDITS`, `BYOK`, `COMPUTED` and `UNPRICED_CALLS` expressions as every other
   read in the file. No time window, no scope filter.

   *Changed after the plan review.* The first draft used `belongsTo`'s slug fallback too, in a second
   query joined to `articles`. GPT Sol (P1, P2) pointed out that this disagrees with `/admin/costs`,
   which keeps slug-only rows apart, and that across owners it would tie spend that `/admin/costs`
   shows only as a slug hash to a named private article. Measured in production on 2026-10-20 (read
   only): 21,672 ledger rows, 5,220 with an article id ($144.22), 1,502 slug-only ($12.20), and
   **the fallback join matches none of them** (all are for slugs no current article has). So id-only
   gives the same figure as Metadata today, with one query and no new attribution.
2. **`listArticlesAcrossOwners`** reads it alongside the article rows (`Promise.all`) and puts a
   `cost` on every row; an article with no rows gets zeros. No route change.
3. **Wire**: `AdminArticle.cost: { nanos, calls, unpricedCalls }` in
   [`admin-articles.ts`](../../src/admin-articles.ts) — nano-dollars already added, because unlike
   Metadata's breakdown there is nothing here to show by pocket.
4. **Page**: a **Total cost** column after *Read*, right-aligned, tabular figures. The cell is
   `amountWithFloor` from [`admin-costs-view.ts`](../../src/web/admin-costs-view.ts) — `/admin/costs`'s
   own formatting: `$0.42`, `<$0.0001`, a `+` when some call was unpriced, and `—` when no call was
   priced (including none at all). Its hover hint gives the exact figure (`formatSpendNanos`) and
   the call count. The header's hint says what the figure is: every model call the ledger ties to
   the article, whoever made it, over its whole life.
5. **Order**: a small select beside the filter, **Newest first** (the default, as now) or **Highest
   total cost first** (cost descending, ties newest first; not "most expensive", because a total
   with an unpriced call is a floor, as Sol noted). The caption follows it. Local state, not
   in the URL, like the filter.
6. **Docs**: admin.md's `/admin/articles` paragraph names the column and where its figure comes
   from; cost-tracking.md's list of readers of the ledger, if it has one, gains this page.

## Tests

- `tests/ai-calls-spend-pg.test.ts`: `spendByArticle()` on the existing fixture article equals
  `totalRows()` over its id-keyed rows and the hand figure (4 calls, $0.049, 1 unpriced). So the
  slug-fallback row, Bob's rows under the slug, the 2020 predecessor and the other slug are all
  out. Written first and watched red (the function did not exist).
- `tests/admin-articles-page.test.tsx`: the column shows the floor marker, a dash for nothing spent
  and for every call unpriced, and *Highest total cost first* reorders the rows, newest first on a
  tie.
- `tests/article-transfer.test.ts`'s listing test: a listed row carries `cost`.

## Options passed over

- **Call `spendForArticle` once per article.** One query per row; the page lists every article.
  Bulk is two queries and the same rule.
- **Use `spendCube` (grouped by article) and fold it.** Same rule, but it is windowed by period and
  returns hundreds of groups across a dozen keys to answer one per-article sum.
- **`belongsTo`'s slug fallback, in bulk** (the first draft). See step 1: it disagrees with
  `/admin/costs`, adds attribution across owners, and today matches nothing.
- **A full sortable table (`DataTable`, click any heading).** Every column sortable is more than was
  asked for; one extra order is the one that answers "which articles cost most". Simplest first.
- **If the cost read fails, show the rows without it** (the addresses' rule). Both reads are the
  same database, so a failure of one is almost always a failure of both; a separate degraded state
  is a third render path for a case that will not happen alone. Not built.
- **A stored per-article total.** The report says no new field, and a cache of a ledger sum is a
  second home for cost that can go stale.

## Assumptions

- "Total cost" means the recorded amount (credits + BYOK + computed), as the column of the same
  name on `/admin/costs` and in Metadata — not estimated cash.
- The cost after a transfer stays with the article: rows keyed by id follow it to the new owner,
  the old owner's spend on it included.
- Performance: one aggregate over the ledger (21,672 rows on 2026-10-20) on each load, using the
  `ai_calls_article` index. Not measured further at this size.
