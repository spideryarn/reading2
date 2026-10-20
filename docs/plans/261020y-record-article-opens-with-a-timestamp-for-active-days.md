# Record when each reader opens an article, so Active days counts days spent only reading

Report `spya-shf45w`, question [q-xcc7xq](../user-feedback/questions/q-xcc7xq.md), the half of
[261020c](261020c-admin-users-engagement-active-days-reading-time-failed-imports-fewer-default-columns.md)
that was put to Greg rather than built. Queue item `qi-ajznwhmm`.

> B yes. e.g. store which days (and times?) they've opened an article
>
> — Greg, 2026-10-20 (reply `spya-p5ktx3`)

## The problem

Active days on `/admin/users` counts the distinct UTC days on which an account has a timestamped
row (`activitySources` in `src/store/pg-admin.ts`). Opening an article only bumps `articles.opens`
and overwrites `articles.last_opened_at`, so a day on which somebody only opened and read articles
is counted only while it is some article's *latest* open. Greg's own example — somebody who opens a
couple of articles on several different days and does nothing else — is the case it misses.

## The design

*Revised after GPT Sol's plan review (`…-plan-review-sol.md`); the draft hung one row per open off
the article, and findings 1, 2, 3 and 5 all came from that.*

**1. A table, `article_open_times`**, keyed on the account, not the article:

| Column | Type | Meaning |
|---|---|---|
| `owner_id` | `uuid not null`, FK `auth.users(id)` on delete cascade (by hand, like every owner key) | who opened |
| `slot` | `timestamptz not null` | the UTC half-hour the open fell in |
| `opened_at` | `timestamptz not null default now()` | the first open in that half-hour |

Primary key `(owner_id, slot)`, which is also the only index the admin aggregate needs.

- **The time, not only the date** — Greg's *"(and times?)"*, and CLAUDE.md's *"Store when it
  happened"*. A date can always be derived from a time; the reverse cannot.
- **The account, not the article** (Sol, finding 2). An open is something an account did at a
  moment, which stays true when the article is later deleted or transferred. Keyed through
  `articles`, deleting or transferring an article would shrink the old owner's Active days after
  the fact, and the rows would have to be deleted on transfer so as not to credit the new owner.
- **Not which article** (Sol, finding 3). The metric needs only *when*; Greg asked for days and
  perhaps times. Keeping which article was opened when is a reading history, which is a wider
  privacy promise than he was asked about. Passed over, and named below.
- **Only an article open**, not every authenticated request. Greg named opening an article; every
  other thing an account does is already timestamped and already counted. A request-level ledger
  would also be written by polling and prefetches nobody chose.
- **Not backfilled.** It starts empty, so it never claims a day it did not see. Active days keeps
  counting the four existing sources beside it, so no day already visible is lost.

**2. The throttle is the key: at most one row per account per UTC half-hour.** `slot` is
`date_bin('30 minutes', now(), '2000-01-01 00:00:00+00')`, and the insert is
`on conflict (owner_id, slot) do nothing`. So:

- A reload, back-and-forward, or a run through several articles in one sitting writes one row.
- **A slot never crosses a UTC day**, because 30 minutes divides a day and the origin is a UTC
  midnight. The draft's "30 minutes since the previous open" let a 23:50 open swallow a 00:10 one and
  lose the second day (Sol, finding 1).
- **No read, no lock, no race.** Two tabs at once both try the same key; the primary key lets one
  through. Nothing depends on a `FOR UPDATE` a test cannot see (Sol, finding 6).
- *Why not one row per account per day?* It keeps no time, which Greg asked about.
- *Why not one row per open?* Unbounded rows from reloads, and a row per mount means less.
- *Why half an hour?* A common session boundary in web analytics; a named constant.

**3. Written by `recordOpen`** (`src/store/pg-shelf.ts`), which is already one POST per article page
mount by the owner (`ArticlePage.tsx`, guarded against StrictMode's double effect; never from a
signed-out visitor or a reader of a shared link, because the route is owner-scoped). In one
transaction: the existing `opens + 1, last_opened_at = now()` update, which 404s when the slug is
not the reader's own; then the insert, with the owner `currentOwnerId()` read once (as `destroy`
does). Same `now()`, so the row's `opened_at` equals the `last_opened_at` the first open wrote.

**4. Active days counts it.** `activitySources` gains a fifth branch, `(owner_id, opened_at)`. The
`last_opened_at` branch stays, since it covers days before this shipped. The cell's tip says article
opens are recorded from late October 2026, at most once per half hour, and that before then a day
spent only reading is missed unless it was an article's latest open (Sol, finding 4).

**5. Who sees it.** Only that aggregate reads it: a count of days per account on `/admin/users`
(admin.md's rule: counts and dates, never what anybody read — and the row cannot say what was
read). Not shown to the reader yet. It is not article-scoped, so it is in neither per-article export
nor the transfer's sort (`tests/store-export-covers-tables.test.ts` and
`tests/article-transfer.test.ts` cover tables that reach an article); it goes with the account.

**6. `tests/action-tables-have-created-at.test.ts`** gains `article_open_times: { column:
"opened_at" }` — mandatory, not optional (Sol, finding 6).

**7. The privacy page.** *What we keep* gains a bullet: when you open your articles — the time, at
most once each half hour; the durable record does not say which article, while the ordinary request
log does and is kept about a day — so we can see how often Spideryarn is used; it goes when your
account does. The reading-time bullet's *"We keep the totals, not a history of your reading"* is
narrowed to *which passages you read when*, so the two do not read as contradicting.
`LAST_UPDATED` moves; docs/project/privacy.md gains a § Article open times.

## The migration

Additive: one new table, its primary key, and a foreign key to `auth.users` (hand-written, as for
every owner key — `npm run db:generate -- --name article_open_times`, then the FK in a
`--custom` migration if the generator cannot reference `auth.users`). Nothing existing is altered.

## Passed over

- **The question's B, one row per account per UTC day of any request** — no time, and polling
  counts as use.
- **One row per open, per article** (this plan's draft) — the reasons in § 1 and § 2.
- **Which article, kept until the article is deleted** — a reading history; a product and privacy
  call for Greg if he wants it, not needed for the count.
- **Showing it to the reader** — a separate product call.

## Stages

1. Schema, migration, `recordOpen`; tests in `tests/store-shelf-pg.test.ts` watched red first: one
   row per open; two opens in one slot make one row; concurrent opens make one row and N counter
   increments; another reader's slug writes nothing; a 23:50/00:10 pair is two slots (a unit test
   on the slot SQL, run through Postgres with fixed times).
2. `activitySources`' fifth branch and the tip; `tests/admin-queries.test.ts`: a day only an
   `article_open_times` row knows about is counted.
3. Privacy page and docs (privacy.md, admin.md), the question file and the feedback note; GPT Sol
   code review; push to dev.

## Reviews

GPT Sol on the draft plan, 2026-10-20 (`…-plan-review-sol.md`): no P0. The draft kept one row per
open, hung off the article, throttled by comparing with `last_opened_at`. **All six findings
taken**, and the design above is the result: the throttle could lose a day across UTC midnight (1);
article-keyed rows shrank an owner's days on delete or transfer (2); which article was more than
the count needs (3); the tip and privacy wording overclaimed (4); a transfer preview would have
shown a per-article open count (5, gone with the article key); and the lock was untestable and the
`created_at` allowance mandatory (6, the primary key replaces the lock). The revised plan was not
sent back for a second plan review; the code review below read it with the code.
