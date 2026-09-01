# A `SELECT … FOR UPDATE` that locked nothing

**2026-09-01.** Two ingests of the same document at the same time — the same URL added by two
readers, the same PDF uploaded twice, a refresh racing an add — and one of them lost its **entire
revision write** to `duplicate key value violates unique constraint "raw_sources_sha256_kind_pk"`.

It was found while measuring whether the test fixture loader still needed the run lock, not by
anybody hitting it, and that is the interesting part: on a developer's laptop this is invisible, and
it is invisible for a reason that guarantees it.

## The code

[`writeRawSource`](../../src/store/artifacts-pg.ts), as of `85e76b0` (2026-08-28, *"Stop the adapter
certifying an object nobody looked at, and four more"*):

```ts
const [existing] = await tx
  .select({ bytes: rawSources.bytes, contentType: rawSources.contentType })
  .from(rawSources)
  .where(and(eq(rawSources.sha256, storedSha256), eq(rawSources.kind, kind)))
  .for("update")
  .limit(1);

if (existing) { /* compare, and throw RawSourceDisagrees if they differ */ }
else          { await tx.insert(rawSources).values({ … }); }
```

## The cause, in one sentence

**A row lock is taken on rows the statement returns, so a `SELECT … FOR UPDATE` that matches nothing
locks nothing** — and this one is asked precisely in the case where the row does not exist yet.

Two concurrent transactions both select nothing, both take the `else` branch, both insert. The
unique index makes the second one wait and then raises `23505`, which aborts the whole transaction —
so the loser does not merely fail to write this row, it loses the revision it was in the middle of
writing.

## Why it hid

`raw_sources` is keyed `(sha256, kind)`: **one row per document**, shared by every article ever made
from those bytes. So the collision can only happen on the **first** write of a given document. After
that the row is there, every caller takes the `existing` branch, and the code is correct.

A developer's database has every fixture's row in it from the first run. A production database has
every document anybody has ever added. The window is the first ingest of new bytes — which is also
the moment two readers adding the same link are most likely to be doing it at once.

The tests could not see it either. Every test in
[`tests/store-artefacts-pg.test.ts`](../../tests/store-artefacts-pg.test.ts) writes one manifest at a
time in one transaction; there was nothing anywhere that put two writers on one document. This is
[silent-success.md](../reusable/silent-success.md) in its ordinary shape: the check and the code
shared the assumption that there is only ever one writer.

## The class, which is the reason this is written down

**`FOR UPDATE` is not a mutex on a key. It is a lock on rows, and absence has no row to lock.**
Any `select … for update` followed by `if (!found) insert` is this bug, wherever it appears. The
symptom is always the same and always misleading: a unique-constraint violation naming a table that
the failing feature does not obviously touch, on a code path that has a lock in it and therefore
looks protected.

Three signs you are looking at it:

1. The lock is taken on a row the code is about to *create*, not on one it is about to *change*.
2. The table is keyed by something that is not the caller's own id — a content hash, a slug, a
   natural key — so two unrelated callers can land on one row.
3. It only ever fails "the first time", and nobody can reproduce it twice.

The repo already had the right pattern written down twice, in
[`lockOrCreateArticle`](../../src/store/pg-revisions.ts):

> Another transaction may have inserted this slug between our lock attempt and here — **the lock
> cannot protect a row that does not exist yet.** `do nothing` plus a re-read is the honest handling.

That comment is from 2026-08-27, the day before `writeRawSource` was written with the opposite shape.

## Reproducing it

Sixteen concurrent unserialised loads of one document, with the raw bytes freshened so the
`raw_sources` row was **absent**:

| | failures out of 16 |
|---|---|
| row absent, unserialised | **15, 7, 15** across three runs |
| row absent, serialised | 0 |
| row present (a laptop's ordinary state) | 0, either way |

**The spawns have to be barrier-synchronised.** The first run of that rig staggered its processes by
their own `tsx` startup and reported **zero** collisions — load that arrives spread out is not the
load a race needs. That mistake cost a measurement and nearly closed the question.

The deterministic version, which needs no barrier and no luck, is
[`tests/store-raw-source-race.test.ts`](../../tests/store-raw-source-race.test.ts): writer A holds an
uncommitted row for an unseen digest, writer B writes the same digest and is *asserted* to be
blocked, and only then is A let go. Under the old code B always lost. That is the shape to reach for
when reproducing this class — a held transaction beats a race every time.

## The fix

**Insert conflict-tolerantly, then read the row back and compare it.**

```ts
await tx.insert(rawSources).values({ … })
  .onConflictDoNothing({ target: [rawSources.sha256, rawSources.kind] });

const [stored] = await tx.select({ bytes, contentType }).from(rawSources).where(…).limit(1);
/* compare `stored` — never the values we tried to insert — and throw RawSourceDisagrees */
```

The unique index is what does the excluding, and it needs no row to exist in order to work. A racing
writer turns the insert into a no-op instead of an error.

Two details are load-bearing:

- **The comparison is against what is in the table**, not against the manifest. If it compared the
  manifest to itself, a racing writer's row would enter the table with nothing ever checking it —
  which is exactly the corruption `RawSourceDisagrees` exists to stop: two different documents
  sharing one hash row, and one of them silently getting the other's byte count.
- **`do nothing`, not `do update`.** `verified_at` means *"when the bytes at this key were last shown
  to hash to it"*, and this function verifies nothing — it is handed a file. Leaving an existing
  row's timestamp alone is a decision from `85e76b0` and this change deliberately preserves it.

The target is named rather than a bare `on conflict do nothing`, so it absorbs the one conflict it is
about and would still raise on a constraint added later.

**And it rests on `read committed`** — which, when this was written, was said in a comment and
nowhere else. The production caller opened its transaction with no isolation option and inherited
`default_transaction_isolation` from the role or the database. GPT Sol's final review the same day
refused to accept that, and was right: a stated dependency nobody enforces is not a defence.

The transaction is now pinned where it opens —
[`src/store/pg-session.ts`](../../src/store/pg-session.ts) § `READ_COMMITTED`, on all three of
`commit`, `settleJob` and `beginStep` — matching what
[`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts) already did after Sol's review of
2026-08-31.

**And the failure above `read committed` is worse than either of us thought.** Sol predicted the read
back would find nothing. Measured on 2026-09-01, it never gets there: at `repeatable read` an
`insert … on conflict do nothing` that meets a conflicting row from outside its own snapshot raises
`40001 could not serialize access due to concurrent update` **at the insert** — both when it waits
for an uncommitted writer and when the winner had already committed. `do nothing` is only an escape
from a concurrent writer at `read committed`. Nothing in `src/` retries `40001`, so the abort takes
the whole revision commit exactly as the duplicate key did, and reaches the reader through
`guardDbStore` as *"a moment's trouble … trying again generally works"* about something that would
happen every time.

## What would have caught the class

Not a code review of the diff — the `for update` reads as a lock, and the reviewer who wrote
`lockOrCreateArticle`'s comment reviewed this file and did not spot it.

What catches it is **a test that opens two transactions**. There was none, anywhere in the store
suites, until this one. The cheap general rule: any table whose primary key is not the caller's own
id needs one test that writes it from two overlapping transactions with the row absent. That is a
short list — `raw_sources`, `articles` by slug, `block_identities` — and the test is twenty lines
once one exists to copy.

## Other `FOR UPDATE` sites, audited 2026-09-01

All twelve in `src/store/` were checked — eleven Drizzle `.for("update")` calls and one raw-SQL
`for update nowait`. Only this one was wrong; the rest lock a row that has already been shown to
exist, and answer "no rows" by refusing rather than by creating:

| site | verdict |
|---|---|
| [`artifacts-pg.ts` § `writeRawSource`](../../src/store/artifacts-pg.ts) | **the bug — fixed** |
| `artifacts-pg.ts` § `lockStepRun` | safe: zero rows is the fence working, and throws `StepRunNotHeld` |
| [`pg-revisions.ts` § `lockArticle`](../../src/store/pg-revisions.ts) | safe: every caller handles absence — `lockOrCreateArticle` inserts `on conflict do nothing` and re-reads; `publishRevisionIn` and `failRevisionIn` refuse |
| `pg-revisions.ts` § the job fence in `openOrBeginJobDraft` | safe: zero rows means the attempt is not live, and throws `NotTheLiveAttempt` |
| `pg-revisions.ts` § `requireLiveJobOwnsDraft` | safe: same, throws |
| `pg-visibility.ts` § `lockedArticleQuery` | safe: the row is read in order to be changed, and zero rows is a 404 |
| `pg-chat.ts`, `pg-searches.ts`, `pg-referee-claims.ts`, `pg-referee-criteria.ts` § `lockArticle` | safe: the id came from `articleIdFor(slug)`, so the row exists; these lock to serialise writes within one article and create nothing |
| [`pg-jobs.ts` § `claim`](../../src/store/pg-jobs.ts), `select 1 from queue_state … for update nowait` | safe, and **deliberately** so — see below |

The last one is the interesting entry, because it is the same class spotted in advance.
[`src/db/schema.ts`](../../src/db/schema.ts) § `queueState`:

> The CHECK above says "no more than one row", NOT "exactly one row", and **the dangerous case is the
> missing one: every claimant then locks nothing and believes it holds the queue.** Postgres cannot
> express "this table always has a row" as a constraint, so the guard is a delete trigger in
> `drizzle/0001_auth_fks_and_guards.sql`, alongside the row being seeded there.

So the trap was understood here, in this repo, in writing, by whoever wrote that table — and
`writeRawSource` walked into it anyway a day or two later. Knowing a class is not the same as
recognising an instance, which is why the audit above is a table rather than a sentence.

## Files

- [`src/store/artifacts-pg.ts`](../../src/store/artifacts-pg.ts) — the fix
- [`src/store/pg-session.ts`](../../src/store/pg-session.ts) — `READ_COMMITTED`, where the
  dependency stopped being a comment
- [`tests/store-session-isolation.test.ts`](../../tests/store-session-isolation.test.ts) — the real
  `commit`, driven down a connection that defaults to `repeatable read`, asked what level it got
- [`tests/store-raw-source-race.test.ts`](../../tests/store-raw-source-race.test.ts) — the
  deterministic case, the barrier case, and the `RawSourceDisagrees` case that must survive it
- [`tests/load-article-serialisation.test.ts`](../../tests/load-article-serialisation.test.ts) — was
  a characterisation test asserting the collision; now asserts four concurrent loads all succeed
- [`tests/helpers/load-article.ts`](../../tests/helpers/load-article.ts),
  [`tests/helpers/scratch-article.ts`](../../tests/helpers/scratch-article.ts) — comments that told
  the reader to pass `serialise: true` because of this
