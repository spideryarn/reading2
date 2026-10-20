# /admin/users: active days, reading time, failed imports, and fewer columns by default

Reports `spya-shf45w` (SPIDERYARN-READING2-KD) and its addendum `spya-g8bw5j`, suggestions from Greg
(admin, trusted), 2026-10-19, on `/admin/users`. Overseer queue item `qi-4mgrdyx7`.

> So I'm trying to get a kind of overall measure of engagement. I suppose the best one would be number
> of unique days on which they have used the app, because otherwise, you know, maybe if I sit down
> with them to show them the first time and they open a couple of articles in that first moment,
> that's very different from opening a couple of articles spread out over multiple days. So can we
> have a column for, I don't know, unique days or something that they've used the app?
>
> — Greg, 2026-10-19

> And maybe we can get rid of some of the columns that are not really that useful, like archived,
> uploads, searches, chats, comments, or make it easy to sort of have them default hidden or
> something. Really what I most care about is number of articles, total time spent reading, number
> of unique days on which they've used it.
>
> And/or anything else that's kind of standard or best practice and that you think will be useful or
> indicative, then let's add that.
>
> And if there's a way to measure a number of errors of any kind, like significant errors, whether
> it's upload errors or something else, that would be useful. Though I don't just want a number, if
> you're going to show me stuff like that, I want a tooltip that will give me some indication of what
> they are and how severe and when. So this may be overcomplicating things.
>
> — Greg, 2026-10-19 (addendum)

## What is stored today, and what that means for "unique days"

**Nothing records the days somebody read.** `articles.last_opened_at` keeps only the latest open,
`articles.opens` is a counter, and `reading_time` is a running total per passage with no timestamp
— deliberately, since `/privacy` promises *"we keep the totals, not a history of your reading"*. So
the exact case Greg describes — opening a couple of articles on several different days, and
nothing else — is invisible to anything built only from what we have.

What *is* timestamped, per account, is everything that **does** something:

| Source | Time | What a row means |
|---|---|---|
| `ai_calls` with `scope_kind = 'request'` | `started_at` | a model call inside the reader's own signed-in request: a mode, chat, search, quiz |
| `ingest_events` | `reserved_at` | an article or paper added |
| `comments` (through the article, on the shelf) | `created_at` | a bookmark or note |
| `articles` (on the shelf) | `last_opened_at` | the most recent day each article was opened |

*Revised after Sol's plan review (finding 1).* The draft also used `job_step` calls and
`reader_arrivals`. A job step runs on the queue's clock, and `scripts/stage.ts` records its runs the
same way, so it would date a reader's day by ours. `reader_arrivals` was backfilled with every shared
Auth account's creation date, including accounts that never used this app. Production on 2026-10-20
had 1,034 `request` rows, so the aggregate needs no index (finding 2).

## The design (v1, built)

**1. Active days** — the number of distinct **UTC** days on which any of the four rows above has a
timestamp. One grouped statement: a `union all` of `(owner, at)` pairs, then `count(distinct day)`,
`count(distinct day) filter (where day between today − 29 and today)` (closed, so a future-dated row
is not recent: finding 3), and `max(at)`, per owner, leaving out the site account. The cell shows the
total; its tip says *"N days with recorded activity, M of them in the last 30 days, last active …
(UTC days). Reading on its own is not recorded per day, so a day spent only reading is missed —
except the most recent one"*. That caveat is on the cell, not in a doc, because the number
undercounts in exactly the direction Greg's example cares about, and saying so is what stops it
reading as a measurement it is not (silent-success.md).

**2. Reading time** — `sum(reading_time.seconds)` per owner, through `articles.owner_id` and
`onTheShelf()`, as the file's other article-shaped counts are. Drawn as `3h 20m` / `12m` / `—`, the
exact seconds in the tip. It is the time a passage of their own was on screen while they were active
(reading-time.md's rules), and it has existed since 2026-09-16 for experimental readers and since
2026-10-05 for everyone, so the tip says *"since mid-September at the earliest"*. An article deleted
takes its time with it.

**3. Failed imports** — from `import_records` where `status = 'error'`: a count, and a card on hover
listing the most recent ten, each with *when*, *which step* (`failed_step`), and *what kind*,
translated from `failure_kind`. The count is of **attempts** (a Retry is a new record; deleting the
article deletes its records), and the card says so (finding 6).

| `failure_kind` | Words | Ours to fix (red count) |
|---|---|---|
| `bug` | defect here, ours to fix | yes |
| `ours` | our account or configuration | yes |
| `blocked` | a service refused the request | no |
| `retry` | transient, a retry may help | no |
| null | unclassified | no |

*Revised after finding 4*: the draft called these high/medium/low severity. `FailureKind` says
whose fault it was and whether a retry can help, not how bad it was, so a severity label would claim
a measurement nobody made. This is the nearest honest answer to Greg's *"how severe"*.

**No URL, slug, filename or error sentence goes on the wire** — admin.md's one rule (*counts, dates,
and what the account may do*), and the error sentence often contains the address. The card ends
*"Details: `npx tsx scripts/import-records.ts`"*, which is where a developer already reads them.
`import_records` exists since 2026-10-08, so the tip says *"since 8 Oct"*.

Why only imports: they are the one failure that is (a) stored per account, (b) a reader-visible
failure rather than a retried blip, and (c) already classified by kind. Greg named *"upload
errors"* first; a failed upload that never became an import has no row anywhere and is not counted —
said in the tip.

**4. Fewer columns by default** — Archived, Uploads, Comments, Chats and Searches start hidden,
behind the same **Columns** menu the shelf's table has (`ColumnsMenu` in lib/DataTable.tsx,
`meta.startsHidden`). The shelf's hook, `useShelfHiddenColumns`, hard-codes its two storage keys; it
becomes `useHiddenColumns(columns, keys)` with the shelf passing its existing keys unchanged (so no
reader's saved choice moves) and the admin page passing `spya.admin.users.*`. Removed outright was
the simpler option, passed over because Greg said *"or make it easy to … have them default hidden"*
and the numbers are one click from coming back when a support email needs them.

**5. The order** — the three Greg cares most about lead the chips after the default sort: Active
days, Reading time, Articles; then Errors. The new columns sit after *Last read* in the table. The
default sort stays newest sign-up.

**"Anything else standard"**: the standard engagement trio is recency, frequency and depth. Recency
is *Last read* plus *last active* in the Active days tip; frequency is active days and the
last-30-days figure in the same tip; depth is reading time. Nothing further is added: a DAU/MAU-style
ratio or cohort retention is a chart about the whole user base, not a column about one account, and
with this many readers each row is read on its own.

## The wire

`AdminUser` gains `activeDays`, `activeDays30`, `lastActiveAt?`, `readingSeconds`, `importFailures`
and `recentImportFailures: { at, step?, kind? }[]` (≤ 10, newest first). All counts are `?? 0` in
`mergeUsers` like every other. The MCP admin tools pick their fields explicitly (`trimUser`), so
nothing new reaches an assistant's provider; extending them is not part of this.

## No new field stored about a reader

v1 reads only existing rows. **The one thing that would make Active days exact needs one**, and is
put to Greg as a question rather than built:

- a table `reader_days (owner_id, day date, primary key (owner_id, day))`, one row per account per
  UTC day it made any authenticated request, written in the same after-response hook as
  `noteArrival`, with an in-process "already noted today" set so it costs one conflicting insert per
  account per instance per day;
- **not** backfilled from the four sources above (Sol, finding 1): a ledger seeded with their gaps
  would carry the undercount into its history and present it as exact. It starts empty and is
  counted alongside the four sources, so no day already visible is lost;
- a new bullet on `/privacy` (*"which days you used Spideryarn — the date, not the time or what you
  did"*), since today's page says we keep totals and not a history.

That is a history of attendance, which `/privacy` currently does not admit to, so it is Greg's call.

## Deferred, named

- Model calls that failed while a reader waited (`ai_calls.outcome = 'error'`, `scope_kind = 'request'`) —
  a real error signal, but transport retries and aborts make "significant" a definition worth its own
  look (261006b counts them).
- Sentry issues per account — Sentry is not queried by the server, and joining it is another service
  on the request path.
- `reader_days` above, if Greg says yes.

## Reviews

GPT Sol on the plan, 2026-10-20 (`…-plan-review-sol.md`): no P0, and no privacy, admin-boundary or
MCP leak found. Taken: 1 (sources), 2 (site account left out in SQL; cost measured instead of an
index), 3 (closed window), 4 (kind, not severity), 6 (attempts), 7 (`onTheShelf()` on both
article-shaped sources), 8 (the shelf's literal storage keys pinned by a test). **Half-taken: 5**,
which asked for a focusable button with a controlled tooltip on each count, because a `data-tip`
card is pointer-only. The cells now carry the same words as screen-reader text, as `When` does with
its exact time. A button per cell was passed over: every other cell on this page is a `data-tip`
span, and the page has one reader at a desk. The phone case is the open gap.

## Stages

1. Server: three queries in `adminQueries` (active days, reading time, failed imports), merge,
   `AdminUser` fields; `tests/admin-users-merge.test.ts`, `tests/admin-queries.test.ts`,
   `tests/admin-store.test.ts`.
2. Client: three columns, the failures card, `useHiddenColumns`, the Columns menu on `/admin/users`;
   `tests/admin-page.test.tsx`, the shelf's hidden-column tests still green.
3. Docs: admin.md § the page, the counts; GPT Sol code review; push to dev.

## Checks

Each new query watched failing before it is kept (a wrong `status` literal, the scope predicate
dropped, the day truncation removed). The page test reads a hidden column absent by default and
present after the menu toggles it.
