# Tidy the never-published production articles

Up: [plans.md](../project/plans.md). Asked in
[261006m § For Greg, question 8](261006m-seventh-codebase-sweep-depth-umbrella.md#for-greg); the
finding is [261006d § DBO2](../investigations/261006d-seventh-sweep-depth-database-schema-opus.md#dbo2-article-rows-that-never-published),
and the precedent this copies is [261005j](261005j-draft-sweep-deletes-and-the-count-mode-goes.md)
with [`scripts/draft-sweep-backlog.ts`](../../scripts/draft-sweep-backlog.ts).

> yes, tidy them
>
> — Greg, 2026-10-07, relayed verbatim by the Overseer

The Overseer's relay adds the conditions: its own small plan with the safeguards named (checkpoints,
uploads, billing rows, and a retry of the same URL reusing them); read-only counts first; the delete
reviewed by GPT Sol; and say exactly what was deleted.

**Status, 2026-10-07: planned, script written and tested, reviewed by GPT Sol ("safe after these
changes"), its seven findings dealt with ([§ Review status](#review-status)), and the production dry
run repeated with the hardened script. Nothing has been deleted.** A second, narrow GPT review of R1
and R7 is pending. The one run is described in [§ How to run it](#how-to-run-it).

## In plain words

When somebody pastes a link or uploads a PDF, Spideryarn makes an empty "article" record first and
fills it in as the import runs. If the import fails the first time, that empty record stays behind
for ever. Nobody can see it — the library only shows articles that finished — but it keeps the
paragraph ids and the half-finished PDF transcriptions the failed attempt made.

- **What goes:** 12 such records today (13 by tomorrow evening, see below), all belonging to one
  account, Greg's own. With them go 7,205 paragraph ids and 164 cached PDF-transcription chunks
  (about 1.6 MB). Nothing in them was typed by a reader: no titles, notes, comments, chats or
  sharing.
- **What a reader could notice:** almost nothing. The records are not on any shelf, have no import
  running, and the four PDFs among them were all imported successfully later as other articles,
  which stay. The one exception is an old upload address (`/add/upload/<id>`) for five of them,
  which today leads to an article nobody can open and afterwards to one that is not there — see
  [§ 3](#3-is-any-of-them-alive-and-would-a-retry-reuse-them).
- **What stays:** the cost ledger (273 model-call rows keep their numbers and lose only the link to
  the deleted record — the same as any deleted article), the 5 upload records (kept with a stale
  name, which is how a reader's own Delete leaves them), the stored PDF files themselves (two other,
  published articles use the same files), and every published article.
- **What cannot be undone:** the delete. The script writes a copy of every row it removes to a
  private file first ([§ Backup](#6-reversibility-and-backup)); that copy is the undo.
- **Left alone today:** one record (`spya-xytyjz`) whose import was five days ago. The rule waits
  seven quiet days; it qualifies at about 18:31 UTC on 2026-10-08.

## 1. The exact set, re-derived from the code

**How an article gets its first published revision.** `lockOrCreateArticle`
([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)) inserts the `articles` row, with
`current_revision_id` null, the moment a job opens its first draft. The only line that sets
`current_revision_id` is `publishRevisionIn`, which marks the draft `published` in the same
transaction. Nothing ever sets the pointer back to null (no `unpublish`; `articles_current_revision_fk`
is `no action`, so a current revision cannot be deleted from under it). So "never published" is:

```
articles.current_revision_id is null
and no article_revisions row of that article has status not in ('draft','failed')
    or a non-null published_at
```

The second clause is belt and braces: production has only `published` and `failed` revisions, and no
article without a pointer has ever had a published revision (S1 below: `no_current_but_once_published
= 0`). `onTheShelf()` in [`src/store/pg.ts`](../../src/store/pg.ts), which
[`pg-admin.ts`](../../src/store/pg-admin.ts) also uses, is the same first clause plus "slug does
not start with `_`"; no candidate's slug does.

**How the store destroys an article** — `pgShelfStore.destroy` in
[`src/store/pg-shelf.ts`](../../src/store/pg-shelf.ts), one READ COMMITTED transaction:

1. an unlocked owner-scoped read of the row (404 if not this owner's);
2. `lockBillingAccount(owner)` — the billing row first, always (the lock order);
3. the article row `for update`, through `ownedSlug(slug, owner)`;
4. **refuses (409)** if any `queued`/`running` job of that owner and slug exists, locking them;
5. **refuses (500, logged by id)** if a terminal job of that slug still holds an unsettled
   `ingest_events` reservation — a "stranded reservation": deleting the job would erase the only
   link from a charged slot to the job that spent it;
6. deletes that owner's terminal jobs for the slug (so a Retry cannot recreate the article);
7. `delete from articles` — one statement; the cascade does the rest; `rowCount` must be 1.

It needs no current revision (`ownedSlug` does not join one) and runs for any owner the caller names
through `runAsOwner` ([`src/owner.ts`](../../src/owner.ts)). There is no admin delete; the script is
the only cross-owner caller, and it names each article's own owner.

**Today: 13 never-published rows of 62, all one owner** (`001bb7a0-…`, the administrator account in
`SPIDERYARN_OWNER_ID`). The same 13 the investigation counted on 2026-10-06. Per article (S2, S3, S9):

| article id | short id | created (UTC) | newest attached | revisions | block ids | checkpoints | ai_calls | jobs | uploads |
|---|---|---|---|---|---|---|---|---|---|
| 992df6bf-77c6-4dab-9879-8360f3e28bae | spya-np5eep | 09-03 13:18 | 09-03 13:19 | 0 | 195 | 0 | 1 | 0 | 0 |
| d64ade3c-abbc-4622-a2cf-f66f4d5cd6a4 | spya-ve4avb | 09-03 13:18 | 09-03 13:30 | 0 | 695 | 0 | 1 | 0 | 0 |
| f55a3fd4-9ed5-46e3-b975-3ed1de5fe1b8 | spya-tx8r32 | 09-03 15:55 | 09-03 15:55 | 0 | 0 | 0 | 0 | 0 | 1 verified |
| bf6cb59f-af56-4b57-9983-87117098f55d | spya-fwp82p | 09-04 09:20 | 09-04 09:25 | 0 | 2,024 | 56 pdf-chunk | 88 | 0 | 1 verified |
| dddf7746-b943-4671-aeab-312f28c1dfbc | spya-ssves7 | 09-04 10:37 | 09-04 10:42 | 0 | 2,010 | 54 pdf-chunk | 90 | 0 | 1 verified |
| 02e7bc66-67c4-49b5-983e-b240757cd806 | spya-g4d2n9 | 09-04 12:56 | 09-04 13:01 | 0 | 2,036 | 54 pdf-chunk | 91 | 0 | 1 verified |
| 91f949a8-41dd-4fb9-a0f9-af8253e86873 | spya-y3wj6a | 09-07 19:54 | 09-07 19:54 | 0 | 0 | 0 | 0 | 0 | 1 rejected |
| 4d91981f-9bb3-4e3a-8ccb-ae443ceeef30 | spya-hwsqfk | 09-12 07:54 | 09-12 07:54 | 0 | 0 | 0 | 0 | 0 | 0 |
| 3e954894-9b9d-4ff6-b349-94e5b988a101 | spya-yn6pr0 | 09-28 04:01 | 09-28 04:02 | 0 | 245 | 0 | 1 | 0 | 0 |
| 60cbe2a2-ac22-444f-89b6-e2320f1d843c | spya-vj2z4v | 09-28 04:03 | 09-28 04:03 | 0 | 0 | 0 | 0 | 0 | 0 |
| f2b52cf2-0268-4703-bc3e-356b16f307f9 | spya-x5ff2s | 09-28 04:03 | 09-28 04:03 | 0 | 0 | 0 | 1 | 0 | 0 |
| ce425589-a285-4675-9327-ff8794117c2c | spya-fdcs3c | 09-28 04:04 | 09-28 04:04 | 0 | 0 | 0 | 0 | 0 | 0 |
| 82b5bb6c-e603-404c-94da-036719cda430 | spya-xytyjz | 10-01 17:53 | 10-01 18:30 | 0 | 2,098 | 32 pdf-chunk | 59 | 0 | 1 verified |

Every one has `processing = full`, `visibility = private`, `opens = 0`, never opened, no purpose,
title, share token, tag, archive date or high-power flag; `updated_at` null on all (the column is
newer than them).

## 2. Everything attached, table by table

From production's own `pg_constraint` (Q1), not from `schema.ts`: 23 foreign keys reach `articles`
directly, three more reach it through `article_revisions`, five through `block_identities`, and
several tables name an article without a key. Counts are over all 13 (S6), and over the eligible 12
from the dry run where they differ.

| table | how it reaches the article | on delete | rows (13) | rows (eligible 12) | right? |
|---|---|---|---|---|---|
| `article_revisions` (+ `revision_blocks`, `revision_phrase_runs`, `revision_step_runs`) | FK `article_id` | cascade | 0 | 0 | yes — none left; the draft sweep took them |
| `block_identities` | FK `article_id` | cascade | 9,303 | 7,205 | yes — ids of an article that never existed for a reader. No `revision_blocks` row points at any of them (T6: 0), so nothing else breaks |
| `checkpoints` | FK `article_id` | cascade | 196 (pdf-chunk, 1.78 MB) | 164 | yes — see § 3: nothing can ever read them again |
| reader tables: `comments`, `chat_threads`/`chat_messages`, `search_runs`, `referee_*`, `glossary_lookups`, `glossary_hidden_entries`, `citation_*`, `reading_time`, `quiz_attempts`, `link_summaries`, `article_tags`, `upload_source_guesses` | FK `article_id` | cascade | 0 each | 0 | the rule refuses any non-zero |
| `ai_calls` (cost ledger) | FK `article_id`; also `article_slug` text | **set null** | 332 | 273 | yes — the ledger survives every article delete by design (`destroy` § What survives). The rows keep `owner_id`, `article_slug`, `job_id`, cost and tokens; only `article_id` goes null. Spend by owner is unchanged |
| `ingest_events` (billing reservations) | FK `article_id` set null; `slug` text; `jobs.ingest_event_id` | set null | **0 by any of the three routes** (S5) | 0 | nothing to refund, strand or double-count; the freeze-price trigger (`ingest_events_freeze_article_price`, BEFORE DELETE on `articles`) updates no row |
| `jobs` | `slug` + `owner_id` text, no FK | `destroy` deletes terminal ones | **0** (S4) | 0 | nothing to delete; and no Retry button exists for any of them |
| `uploads` | `slug` text, no FK; `jobs.upload_id` | none — kept | 6 (5 verified, 1 rejected) | 5 | kept with a stale slug, as `destroy` keeps them on purpose (Stage E of [260906h](260906h-delete-an-article-permanently.md) owns the bytes) |
| `realtime_sessions` | FK set null; `article_slug` | set null | 0 | 0 | — |
| `article_visibility_changes`, `article_share_link_events` | FK set null; `slug` | set null | 0 | 0 | — |
| `feedback` | `slug` text; ids inside JSON | none | 0 (T7: no slug, short id or article id in `slug`, `url` or `diagnostics`) | 0 | — |
| `queue_state.running_job_id` | via `jobs` | set null | 0 | 0 | — |
| `raw_sources` / Storage objects | `uploads.sha256`, `article_revisions.raw_source_sha256` | never deleted | 2 distinct objects behind the 5 verified uploads (S7) | — | **not touched, and must not be**: each is the source of a surviving published article (12 and 11 revisions reference them) |

**Storage.** `destroy` removes no Storage object — Stage E (the blob catalogue) is not built, and
[`/privacy`](../project/privacy.md) already says the raw file survives a delete. Here that is not a
leak: the candidates have no revisions, so no article images (`assets`), and the two canonical
`sources/sha256/…pdf` objects their uploads point at are the source documents of two published
articles that stay (`spya-hs82mz` for the four from 2026-09-03/04, `spya-r26sug` for
`spya-xytyjz`; T2). Each verified upload may also have left a `staging/<upload id>` object, which
nothing has ever deleted for any upload; that is the existing "orphaned blobs" row in
[cron-scheduler.md](../project/cron-scheduler.md), unchanged by this, and was not inspected here (no
Storage read was made). Keeping the `uploads` rows keeps the only map back to those staging keys.

**Billing.** Zero reservations reach any candidate — by `article_id`, by `(owner, slug)`, or through
a job — and zero stranded reservations as `destroy` asks it (S5b). Two reasons, both checked: the
owner is the administrator account, which holds **no** `ingest_events` rows at all; and the first
reservation anywhere in production is 2026-10-04 12:14 UTC (T3), after every candidate was made. So
the delete cannot refund, strand or double-count a slot, and the freeze trigger has nothing to stamp.

## 3. Is any of them alive, and would a retry reuse them?

**Nothing is running or recent.** No job row of any status exists for any candidate's slug, for its
owner or anyone else's (S4); no lease; no reservation. The newest thing attached to any candidate
is 2026-10-01 18:30 UTC (`spya-xytyjz`, 5 days ago); the next is 2026-09-28, 9 days ago (S9). Nothing
is on the Add page either: that page shows jobs, and there are none.

**The jobs are gone because the queue trims them**: `trimFinished` keeps 50 finished jobs per owner
(`KEEP_FINISHED`, [`src/jobs.ts`](../../src/jobs.ts)), and this owner's 50 run from 2026-09-28 10:46
onwards (T3). None of the nine job ids the candidates' model calls name still exists (T4).

**Would a retry reuse a candidate? No.** (This said *no route reaches one*; that was wrong — see
the upload fallbacks below. GPT Sol's R5.) Two ways to "try again":

- **The Retry button** on a failed job (`retryJob` → `slugForRetry`) keeps the failed attempt's own
  slug, so `lockOrCreateArticle` would *find* the never-published row and reuse its block ids and
  checkpoints — this is the design that makes a PDF retry cheap. But it needs the failed job row,
  and none exists for any candidate. That door is already shut.
- **Pasting the same URL again** (`freeSlug` → `slugAlreadyHolding` → `slugForUrlKey` in
  [`src/store/find-article.ts`](../../src/store/find-article.ts)) matches only an article with a
  published revision — a never-published row "simply never matches" — so it mints a fresh slug and a
  fresh article. **Uploading the same PDF again** always mints (`two uploads of one file are two
  documents`). Neither can find a candidate.

**But one route does point at five of them: an old upload address.** `resolveExistingUpload` and
`answerALostClaim` in [`src/routes.ts`](../../src/routes.ts) answer a repeat of `POST /api/jobs
{ uploadId }` from the upload record once retention has trimmed the job: if `uploads.slug` is set
they return `{ kind: "article", slug }` **without checking that the article exists or was ever
published**, and the upload page treats that as done and navigates there. So reloading
`/add/upload/<id>` for any of the five verified uploads leads, **today**, to an article that was
never published (which nothing can show), and **after the delete** to one that is not there. That
is an existing defect, made no worse in substance by the delete — a page that cannot show the
article either way, and no published content lost. It is recorded here, not fixed: **follow-up** —
both fallbacks should answer a clear "that upload is not available as an article" when the slug
names an absent or unpublished article, keeping the upload row and its Storage mapping; checking the
upload's `sha256` against the article's source would also stop a reused slug pointing at a
different paper. `routes.ts` is deliberately not changed by this plan.

So the checkpoints represent paid work nobody can collect. Quantified (S8, S8b, T1): 196
`pdf-chunk` checkpoints on four candidates, from 326 transcription calls billed to Greg's own key
(BYOK, $2.27 upstream) and four structure calls ($0.93); the eligible three hold 164 of them. And
**every one of those PDFs was imported successfully afterwards**, as `spya-hs82mz` (2026-09-04
22:15, the same bytes as the three from that morning and `spya-tx8r32`) and `spya-r26sug`
(2026-10-04, the same bytes as `spya-xytyjz`). A reader deleting these loses nothing they could get
back by retrying, because the retry already happened and succeeded.

Repeated attempts are visible — three uploads of one file on 2026-09-04 within four hours, four
link imports within four minutes on 2026-09-28 — and each run of attempts ends in a later success
or in nothing for a week or more.

## 4. The rule

An article is deleted only if **all** of these hold, re-checked by a second, independent query and
again for each article **inside `destroy`'s own transaction, after its locks** (§ 5):

1. **Never published** (§ 1's predicate).
2. **No revision rows at all** — a leftover draft or failed revision belongs to the draft sweep, and
   one present means something touched it recently.
3. **No job rows for its slug**, of any status, any owner. A job is the only thing that can publish,
   and the only thing that offers Retry.
4. **No billing reservation**, by `article_id` or by slug, any owner.
5. **No reader state**: zero rows in every reader table in § 2, and no title, purpose, archive,
   share token (now or ever), non-private visibility, publication time, open (count or time), or
   high-powered-AI switch (`high_power_since`, added on Sol's R4).
6. **Quiet for seven days**: every clock is more than seven days old — the article's `created_at`,
   `updated_at` and `last_opened_at`; its jobs' created, started and finished; its checkpoints'
   `created_at` and `last_used_at`; its model calls' `created_at`, `started_at` and `finished_at`;
   its uploads' `minted_at`; its revisions' `created_at`; and its block identities' `first_seen_at`.
   (The first version's second query asked only four of these; Sol's R4.) Seven because the failed
   jobs that offered Retry are themselves gone well before then for this owner, and an import nobody
   has touched for a week is not one somebody is in the middle of. **`--delete` will not run with
   fewer** (Sol's R3); a dry run may look with a shorter window.

Both queries protect exactly this list, each in its own SQL;
[`tests/never-published-tidy.test.ts`](../../tests/never-published-tidy.test.ts) § "the two queries
protect the same things" sets each item alone and fails if either query lets it through.

**It admits 12 of the 13 today.** Recommendation: **delete all that are eligible on the day it is
run**, rather than a further age threshold — nothing distinguishes the 9-day-old ones from the
33-day-old ones except age, and § 3 shows age is not what protects them.

**Left alone, and why:** `spya-xytyjz` (82b5bb6c-…) — newest activity 2026-10-01 18:30 UTC, so under
seven days. It becomes eligible at about 18:31 UTC on 2026-10-08, and its paper is already on the
shelf as `spya-r26sug`, so the recommendation is to run once after that and take all 13.

## 5. The mechanism: [`scripts/never-published-tidy.ts`](../../scripts/never-published-tidy.ts)

Modelled on `draft-sweep-backlog.ts`, and smaller than that one because it writes no delete of its
own:

```
npx tsx scripts/never-published-tidy.ts                  # local, dry run
npx tsx scripts/never-published-tidy.ts --prod           # production, dry run (read-only)
npx tsx scripts/never-published-tidy.ts --prod --delete \
  --ids <file of reviewed article ids> --backup-dir <dir outside the repo>
npx tsx scripts/never-published-tidy.ts --restore <backup file>   # the undo; --prod only to undo the real run
```

- **Target.** `--prod` reads `DATABASE_URL` from `.env.prod` directly (`draftBacklogTarget`, shared
  with the draft script); without it, `.env.local`'s. A shell export aims nothing. It prints `Target:`,
  `Env:` and `Mode:` before anything else. Read the `Target:` line. **Without `--prod`, a target that
  is not local (`isLocalDatabaseUrl`) is refused before connecting** — so a production URL pasted
  into `.env.local` cannot be reached by accident (Sol's R2).
- **Dry run** (the default): one `begin read only`, checked with `transaction_read_only` before any
  read; never a `SET`. It prints every never-published article — id, short id, created date, days
  quiet, block ids, checkpoints, model calls, uploads, and why it is held back — then what the
  eligible set would delete and unlink, then the second query's counts over those ids, which must all
  be zero with every id found.
- **`--delete`** refuses, before any write, unless: `--quiet-days` is at least 7; the two queries
  agree; the eligible set is no larger than `MAX_PER_RUN` (20); it equals the ids in `--ids` exactly,
  in both directions (the reviewed list, pinned); and the backup has been written **and verified**
  (§ 6). Then, **per article**: re-prove it alone (read-only, a cheap early refusal); then
  `runAsOwner(owner, () => pgShelfStore.destroy(slug, { beforeDelete }))` — the store's own
  transaction, locks and refusals, plus **the decision taken again under those locks**:
  `beforeDelete` runs after `destroy` holds the owner's billing row and the article row and has
  passed its live-job and stranded-reservation checks, and before anything is deleted, and it
  refuses unless the locked row is the pinned article id, the whole rule above still holds
  (`proveEligible`, at READ COMMITTED, so it sees everything committed before the locks were
  granted), and every row about to go (`articles`, `block_identities`, `checkpoints`, the `ai_calls`
  it will unlink, the `uploads` it will leave) is exactly the row in the backup file. One deletion
  path: `DestroyOptions.beforeDelete` in [`src/store/contracts.ts`](../../src/store/contracts.ts),
  which the reader's Delete button does not pass. It stops at the first refusal and says how many
  went before.
- **After:** a fresh survey says how many of the pinned ids are gone and how many never-published
  rows remain; the model-call rows named in the backup are counted again, and must all still exist
  with `article_id` null. Any mismatch exits 1.
- **Idempotent.** A second run finds the deleted ids gone, so they are no longer eligible; with the
  same `--ids` it refuses (pinned ids not eligible) and deletes nothing.
- **Logs** ids, short ids, counts and dates only — never a slug (made from a title), a URL or any
  content. Driver errors are replaced by their class name, as the draft script does.
- **How `destroy` is aimed at production.** It reaches the database through `getDb()`, which reads
  `process.env.DATABASE_URL` after `loadEnvLocal()`. The script calls `loadEnvLocal()` first and
  then assigns the target, before anything has built the pool; so `.env.local` cannot win.

**Why nothing can slip in between the check and the delete.** The first version argued this from
timing ("a job cannot be created *and* publish in the milliseconds between the two"), and Sol's R1
showed the gap was not milliseconds: `destroy` can wait for the billing lock, and a title or purpose
saved by `PATCH /api/library/:slug` (which works on unpublished articles) in that wait would have
been deleted unseen. Now the deciding check runs **after** the locks, in the deleting transaction.
Anything committed before the locks were granted is seen by it; anything that writes the article
row afterwards (a PATCH, an open, `lockOrCreateArticle`, `tryEnqueue`) waits for the article lock,
and any row inserted with a foreign key to the article takes a key-share lock that conflicts with it,
so it waits too and then finds the article gone. Tested: a title PATCHed while `destroy` waits on a
billing lock the test holds is refused under the lock, and the article survives with the title.

**Cost today, without the index.** `revision_blocks_article_block` (plan
[261007c](261007c-seventh-sweep-schema-declare-and-enforce-what-the-data-already-satisfies.md) /
`drizzle/20261007005448_revision_blocks_article_block_index.sql`) is on `dev` and **not** in
production (Q1 lists the three indexes it has). So each deleted block identity makes Postgres check
`revision_blocks_identity_fk` with a scan of the whole 10 MB primary-key index. Measured on
production, read-only (U1, U2): **about 10 ms per identity warm** (889 ms for the first, cold), and
**19.9 s for all 2,098 of the largest candidate**. For the eligible 12 that is about **75 s in all,
at most ~20 s for one article** — well inside a statement timeout, but each article's transaction
holds the owner's `billing_accounts` row lock for that long, so Greg's own imports and billing writes
would wait up to ~20 s. With the index the investigation measured ~50 ms per article. **Recommend
running after the next deploy applies the index** — it is already queued — which costs nothing but
waiting. If it must run before, it works; expect the minute and a half.

## 6. Reversibility and backup

A delete cannot be undone by the app.

- **Supabase point-in-time recovery / daily backups: I do not know whether they are enabled.**
  Nothing in `docs/` records the project's Supabase plan or backup setting, and I did not open the
  dashboard. Check Dashboard → Database → Backups before relying on it. Even if present, restoring
  the whole project to recover 12 empty records would be absurd; it is a last resort, not the plan.
- **The article export bundle** ([export.md](../project/export.md)) is per article and built for a
  published one; it is not the cheapest real copy here, and it would not include the model-call links.
- **Recommended: the script's own backup**, which `--delete` will not run without. One JSON file of
  every `articles`, `block_identities` and `checkpoints` row it is about to remove (via
  `row_to_json`, so exact column values), plus the `ai_calls` ids whose `article_id` it will null and
  the `uploads` ids left with a stale slug — read in one read-only transaction. **Verified before any
  delete**: written `0600`, its mode checked, read back from disk, parsed, and every table's count
  and the article ids compared with what the database gave; the parsed file is what the check under
  the lock compares against. The file holds content (checkpoints are transcriptions of Greg's PDFs),
  so the script refuses a directory inside the repository — by name before creating anything, and
  again **by real path** once it exists, so a symlink from outside that points in is caught (Sol's
  R7) — and it must never be committed. Suggested place:
  `/var/tmp/spideryarn-backups/261007f-never-published/` on the box, kept until a week after the
  delete.
- **The restore exists and has been exercised** (Sol's R7): `--restore <backup file>`
  (`restoreBackup`), in one transaction, refuses if any backed-up article is already there, inserts
  the articles, then the identities and checkpoints, through `json_populate_recordset` over each
  table's own row type (every column back exactly as `row_to_json` wrote it), then points each
  unlinked `ai_calls` row at its article again where its `article_id` is still null; every count
  must match the file or it all rolls back. The `uploads` rows are never changed, so nothing is put
  back for them. Exercised only on throwaway local rows: two never-published articles made by
  `lockOrCreateArticle`, the checkpoint store and the cost ledger's own `record`, deleted through
  the command, restored through the command, and every column of `articles`, `block_identities`,
  `checkpoints` and the owner's `ai_calls` compared with a snapshot taken before — equal; a second
  restore refuses and changes nothing. **It has not been run against production**, and is to be
  only to undo this plan's delete, by whoever ran it.

## 7. Going forwards

Should failed first imports be swept automatically, as drafts are? Probably yes, and it is a separate
decision for Greg, not designed here. The natural rule is this plan's: an article never published,
with no job row left (the trim has removed even its failure), no reservation and no reader state,
and quiet for a week — swept on demand, the way the draft sweep runs at a job's start, since there is
no scheduler ([cron-scheduler.md](../project/cron-scheduler.md)). The alternative the investigation
named — deleting the row the moment a first import ends in `error` — is simpler but has to lose the
race against a Retry, which is exactly the case the checkpoints exist for. Whichever is chosen wants
the `revision_blocks (article_id, block_id)` index in production first.

## What turned out not as the brief or the investigation put it

- **"A retry of the same URL reusing them" is not possible for any of these.** Only the Retry button
  reuses a never-published row, and every candidate's failed jobs have already been trimmed away. A
  fresh paste or upload never finds a never-published row.
- **There are no billing rows to safeguard.** The owner is the administrator account, which has no
  reservations, and reservations began in production on 2026-10-04, after all 13 were made.
- **"Production's largest never-published article may have thousands of blocks":** it has 2,098
  block *identities* and **zero** block rows (no revision survives). The delete's cost is per
  identity, so the estimate stands; measured, it is ~10 ms each rather than the 24 ms measured
  locally.
- **The investigation's numbers all reproduce** (13 rows, 9,303 identities, 196 checkpoints, 332
  model calls, 6 uploads by slug, one owner, nothing a reader typed).
- **New:** every PDF behind these rows was later imported successfully, so the checkpoints are not
  even a saving deferred.

## Review status

GPT Sol reviewed the plan and the script at `f81253134`, read-only
([prompt](261007f-tidy-the-never-published-production-articles-review-prompt.md),
[answer](261007f-tidy-the-never-published-production-articles-review-sol.md)). Verdict: **"Safe
after these changes. I would allow none with the current script."** It confirmed the predicate, the
attachment counts (13 articles, 9,303 identities, 196 checkpoints; 332 `ai_calls` kept and
unlinked; 6 uploads kept), that `destroy` needs no revision and writes no visibility audit, that the
freeze trigger and the billing-row insert touch nothing here, that `/admin/costs` keeps the money,
and that waiting for the index is right. Subject to fresh proofs it would allow exactly the 13 in
§ 1's table, `spya-xytyjz` only after 2026-10-08 18:31 UTC.

| finding | what it said | what was done |
|---|---|---|
| **R1** (P0) | The proof committed before `destroy` waited for its locks; a title or purpose saved in that window would be deleted unseen. Check eligibility under the locks, and that the rows match the backup. | `destroy` gained an optional `beforeDelete` hook, run in its transaction after its locks and checks; the script re-checks the pinned id, the whole rule and the rows against the backup there (§ 5). Test: a title PATCHed while `destroy` waits on a held billing lock is refused, the article survives — red before the hook. Also: a block identity minted after the backup is refused. |
| **R2** (P1) | Without `--prod`, a production URL in `.env.local` was trusted. | Refused before connecting unless `--prod`, by `isLocalDatabaseUrl`. Tested through `main`; zero connects. |
| **R3** (P1) | `--quiet-days 1` was accepted for deletion. | `--delete` refuses fewer than 7, in `main` and again in `checkDeletion`. Test red first (it deleted). |
| **R4** (P1) | The second query missed `updated_at`, `last_opened_at`, `ai_calls.finished_at`; neither protected `high_power_since`. | Both queries now protect the list in § 4, each in its own SQL; 23 single-item cases require both to refuse. The old proof fails 5 of them, the old survey 6. |
| **R5** (P2) | The upload fallbacks in `routes.ts` reach these rows; "no route" was false. | Corrected in § 3 as an existing defect with a follow-up; `routes.ts` not changed. |
| **R6** (P2) | Tests did not cover `main`'s orchestration. | `main` takes its world as `MainDeps`; missing or wrong ids, a missing ids file, a remote target without `--prod`, a weak quiet window, a failing backup and a late title each stop it before `destroy`. Each guard removed in turn turns its test red. |
| **R7** (P2) | No restore; the outside-repo check was lexical; the backup was not verified. | `--restore`, exercised on throwaway local rows, every column equal; real-path check; read-back verification before any delete (§ 6). |

A second, narrow GPT review of R1 and R7 runs before the delete.

## How to run it

**Once**, by the Overseer, with Greg's knowledge, and only when **all** of these are true:

1. **The production deploy that applies `revision_blocks_article_block` has happened, and the index
   is verified in production** — not inferred from the deploy. Read-only, as `spideryarn_app`:

   ```sql
   begin read only;
   select indexname, indexdef from pg_indexes
    where schemaname = 'spideryarn' and tablename = 'revision_blocks' order by 1;
   rollback;
   ```

   It must list `revision_blocks_article_block` on `(article_id, block_id)`. On 2026-10-07 06:49
   UTC it did **not** (three rows: `revision_blocks_fts`, `revision_blocks_revision_id_block_id_pk`,
   `revision_blocks_revision_ordinal`).
2. **It is after 2026-10-08 18:31 UTC**, so `spya-xytyjz` has had its seven quiet days.
3. **A fresh `--prod` dry run** says 13 eligible, `found 13; published 0; revisions 0; jobs 0;
   reservations 0; reader state 0; recent 0`, and the 13 are exactly these.
4. **The ids file holds exactly the 13 Sol allowed**, one per line:

   ```
   992df6bf-77c6-4dab-9879-8360f3e28bae  # spya-np5eep
   d64ade3c-abbc-4622-a2cf-f66f4d5cd6a4  # spya-ve4avb
   f55a3fd4-9ed5-46e3-b975-3ed1de5fe1b8  # spya-tx8r32
   bf6cb59f-af56-4b57-9983-87117098f55d  # spya-fwp82p
   dddf7746-b943-4671-aeab-312f28c1dfbc  # spya-ssves7
   02e7bc66-67c4-49b5-983e-b240757cd806  # spya-g4d2n9
   91f949a8-41dd-4fb9-a0f9-af8253e86873  # spya-y3wj6a
   4d91981f-9bb3-4e3a-8ccb-ae443ceeef30  # spya-hwsqfk
   3e954894-9b9d-4ff6-b349-94e5b988a101  # spya-yn6pr0
   60cbe2a2-ac22-444f-89b6-e2320f1d843c  # spya-vj2z4v
   f2b52cf2-0268-4703-bc3e-356b16f307f9  # spya-x5ff2s
   ce425589-a285-4675-9327-ff8794117c2c  # spya-fdcs3c
   82b5bb6c-e603-404c-94da-036719cda430  # spya-xytyjz (only after 2026-10-08 18:31 UTC)
   ```

   No additions. If the dry run disagrees in any way, stop and ask; do not edit the list to fit.
5. **The second GPT review of R1 and R7 has come back clean**, and the script run is the reviewed one.

Then:

```
npx tsx scripts/never-published-tidy.ts --prod --delete \
  --ids <that file> --backup-dir /var/tmp/spideryarn-backups/261007f-never-published/
```

The backup is written and verified before the first delete, by the command itself. Paste its
whole output under Results, with exactly what was deleted. To undo:
`npx tsx scripts/never-published-tidy.ts --prod --restore <the backup file it printed>`.

## Done means

- GPT Sol's review — done, findings dealt with above; the narrow second review of R1 and R7 —
  pending.
- The run in [§ How to run it](#how-to-run-it), its output pasted under Results.

## Results

### Production dry run, 2026-10-07, about 06:00 UTC

`npx tsx scripts/never-published-tidy.ts --prod`, from the worktree, read-only:

```
Target: postgresql://spideryarn_app.alschkahzfagtppxspfq@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
Env:    /home/greg/code/spideryarn2/.env.prod
Mode:   dry run (read-only transaction; see the header for --delete)
Role:   spideryarn_app
Rule:   never published; no revision, job or reservation; no reader state; nothing moved for 7 days

Never-published articles: 13, eligible: 12
  article id                            short id     created     quiet  ids    ckpt  calls  uploads  held because
  992df6bf-77c6-4dab-9879-8360f3e28bae  spya-np5eep  2026-09-03    33d    195     0      1        0  (eligible)
  d64ade3c-abbc-4622-a2cf-f66f4d5cd6a4  spya-ve4avb  2026-09-03    33d    695     0      1        0  (eligible)
  f55a3fd4-9ed5-46e3-b975-3ed1de5fe1b8  spya-tx8r32  2026-09-03    33d      0     0      0        1  (eligible)
  bf6cb59f-af56-4b57-9983-87117098f55d  spya-fwp82p  2026-09-04    32d   2024    56     88        1  (eligible)
  dddf7746-b943-4671-aeab-312f28c1dfbc  spya-ssves7  2026-09-04    32d   2010    54     90        1  (eligible)
  02e7bc66-67c4-49b5-983e-b240757cd806  spya-g4d2n9  2026-09-04    32d   2036    54     91        1  (eligible)
  91f949a8-41dd-4fb9-a0f9-af8253e86873  spya-y3wj6a  2026-09-07    29d      0     0      0        1  (eligible)
  4d91981f-9bb3-4e3a-8ccb-ae443ceeef30  spya-hwsqfk  2026-09-12    24d      0     0      0        0  (eligible)
  3e954894-9b9d-4ff6-b349-94e5b988a101  spya-yn6pr0  2026-09-28     9d    245     0      1        0  (eligible)
  60cbe2a2-ac22-444f-89b6-e2320f1d843c  spya-vj2z4v  2026-09-28     9d      0     0      0        0  (eligible)
  f2b52cf2-0268-4703-bc3e-356b16f307f9  spya-x5ff2s  2026-09-28     9d      0     0      1        0  (eligible)
  ce425589-a285-4675-9327-ff8794117c2c  spya-fdcs3c  2026-09-28     9d      0     0      0        0  (eligible)
  82b5bb6c-e603-404c-94da-036719cda430  spya-xytyjz  2026-10-01     5d   2098    32     59        1  recent

The eligible 12 would delete: 7205 block identities, 164 checkpoints, 0 revisions, 0 jobs (cascade / destroy); and unlink 273 ai_calls (kept, article_id set null) and 5 uploads (kept, stale slug).

The second query, over those 12 ids:
  found 12; published 0; revisions 0; jobs 0; reservations 0; reader state 0; recent 0
✓ all 12 found, none protected

Nothing deleted.
```

### Production dry run with the hardened script, 2026-10-07, 06:48 UTC

After R1–R7, the same command, read-only. The rule now protects more (§ 4), and nothing changed:

```
Target: postgresql://spideryarn_app.alschkahzfagtppxspfq@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
Env:    /home/greg/code/spideryarn2/.env.prod
Mode:   dry run (read-only transaction; see the header for --delete)
Role:   spideryarn_app
Rule:   never published; no revision, job or reservation; no reader state; nothing moved for 7 days

Never-published articles: 13, eligible: 12
  article id                            short id     created     quiet  ids    ckpt  calls  uploads  held because
  992df6bf-77c6-4dab-9879-8360f3e28bae  spya-np5eep  2026-09-03    33d    195     0      1        0  (eligible)
  d64ade3c-abbc-4622-a2cf-f66f4d5cd6a4  spya-ve4avb  2026-09-03    33d    695     0      1        0  (eligible)
  f55a3fd4-9ed5-46e3-b975-3ed1de5fe1b8  spya-tx8r32  2026-09-03    33d      0     0      0        1  (eligible)
  bf6cb59f-af56-4b57-9983-87117098f55d  spya-fwp82p  2026-09-04    32d   2024    56     88        1  (eligible)
  dddf7746-b943-4671-aeab-312f28c1dfbc  spya-ssves7  2026-09-04    32d   2010    54     90        1  (eligible)
  02e7bc66-67c4-49b5-983e-b240757cd806  spya-g4d2n9  2026-09-04    32d   2036    54     91        1  (eligible)
  91f949a8-41dd-4fb9-a0f9-af8253e86873  spya-y3wj6a  2026-09-07    29d      0     0      0        1  (eligible)
  4d91981f-9bb3-4e3a-8ccb-ae443ceeef30  spya-hwsqfk  2026-09-12    24d      0     0      0        0  (eligible)
  3e954894-9b9d-4ff6-b349-94e5b988a101  spya-yn6pr0  2026-09-28     9d    245     0      1        0  (eligible)
  60cbe2a2-ac22-444f-89b6-e2320f1d843c  spya-vj2z4v  2026-09-28     9d      0     0      0        0  (eligible)
  f2b52cf2-0268-4703-bc3e-356b16f307f9  spya-x5ff2s  2026-09-28     9d      0     0      1        0  (eligible)
  ce425589-a285-4675-9327-ff8794117c2c  spya-fdcs3c  2026-09-28     9d      0     0      0        0  (eligible)
  82b5bb6c-e603-404c-94da-036719cda430  spya-xytyjz  2026-10-01     5d   2098    32     59        1  recent

The eligible 12 would delete: 7205 block identities, 164 checkpoints, 0 revisions, 0 jobs (cascade / destroy); and unlink 273 ai_calls (kept, article_id set null) and 5 uploads (kept, stale slug).

The second query, over those 12 ids:
  found 12; published 0; revisions 0; jobs 0; reservations 0; reader state 0; recent 0
✓ all 12 found, none protected

Nothing deleted.
```

And the same read-only run at `--quiet-days 5` (a dry run may look with a shorter window; `--delete`
would refuse it), to see the 13th's protections now rather than tomorrow — only its quietness holds
it back:

```
  82b5bb6c-e603-404c-94da-036719cda430  spya-xytyjz  2026-10-01     5d   2098    32     59        1  (eligible)

The eligible 13 would delete: 9303 block identities, 196 checkpoints, 0 revisions, 0 jobs (cascade / destroy); and unlink 332 ai_calls (kept, article_id set null) and 6 uploads (kept, stale slug).

The second query, over those 13 ids:
  found 13; published 0; revisions 0; jobs 0; reservations 0; reader state 0; recent 0
✓ all 13 found, none protected
```

And the index, read-only (`begin read only` / `pg_indexes` / `rollback`, as `spideryarn_app`,
`transaction_read_only = on`, 06:49 UTC): **not yet in production** —
`revision_blocks_fts`, `revision_blocks_revision_id_block_id_pk`, `revision_blocks_revision_ordinal`.

### Tests

[`tests/never-published-tidy.test.ts`](../../tests/never-published-tidy.test.ts), private Postgres
lane, its own owner and throwaway articles made by `lockOrCreateArticle`, 46 tests: the rule admits a
quiet untouched failed import and holds back one each with a job, a reader's title, a failed revision
and recent activity, each for its own reason; a published one is never a candidate; the two queries
refuse each of 23 protected things set alone (R4); `--delete` refuses a list that differs from the
pinned ids (either way), an unproven survey, one over the cap, a weak quiet window, a bad ids file,
a backup directory inside the repo by name or by symlink, an article that gained a job after the
survey, a title saved while `destroy` waited for the billing lock (R1), and rows the backup does not
hold; `main` itself refuses a remote target without `--prod`, `--quiet-days 1`, a missing `--ids`,
a missing or wrong ids file, a failing backup and a late title, each without reaching `destroy`
(R6); the real delete, directly and through `main`, backs up (0600, verified), destroys exactly the
pinned article, cascades its ids and checkpoints, leaves the other, and finds nothing on a second
run; and delete-then-`--restore` gives back every column (R7). Seen red: each guard in `main`, the
read-only re-proof, the hook call in `destroy`, the backup comparison, the real-path check and the
restore's ledger relink, each removed in turn, fails its test; and the R1, R3 and R4 tests were red
against the code before their fix.

## Appendix: every statement run against production, with its output

All through `psql` inside the local Supabase container, `DATABASE_URL` from the primary checkout's
`.env.prod` (never printed), each file in one invocation wrapped in `BEGIN READ ONLY; SET LOCAL
search_path = spideryarn, public; SET LOCAL statement_timeout = '30s'; … ROLLBACK;`, with
`select current_user, current_setting('transaction_read_only'), now()` first — every run reported
`spideryarn_app | on`. Ids, codes, counts and timestamps only. The `unterminated quoted string`
lines are psql choking on an apostrophe in an `\echo` heading; the statements after them ran.
`S2`/`S3` use an inline subquery (`:ghost`) because a read-only transaction refused the temporary
view the first draft used.

### Q1 — foreign keys, triggers, article-naming columns, indexes, privileges

```sql
\echo == every foreign key that references articles, article_revisions, block_identities, jobs, uploads, ingest_events, raw_sources, chat_threads, referee_criteria, comments
select c.conrelid::regclass::text as child, c.conname,
       c.confrelid::regclass::text as parent,
       case c.confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' end as on_delete,
       (select string_agg(a.attname, ',' order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols
from pg_constraint c
where c.contype = 'f' and c.connamespace = 'spideryarn'::regnamespace
order by parent, child, conname;
\echo == triggers on spideryarn tables
select tgrelid::regclass::text as tbl, tgname, tgtype, tgenabled, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid where not tgisinternal and tgrelid::regclass::text like 'spideryarn.%' or (not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='spideryarn'::regnamespace)) order by 1,2;
\echo == columns named slug / article_id / *_slug / storage paths anywhere in spideryarn
select table_name, column_name, data_type from information_schema.columns where table_schema='spideryarn' and (column_name ~ '(slug|article_id|path|object|sha256|key)$' or column_name ~ '^(slug|article)') order by 1,2;
\echo == columns of the tables we will query
select table_name, string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns where table_schema='spideryarn' and table_name in ('articles','jobs','uploads','ingest_events','checkpoints','raw_sources','feedback','ai_calls','article_revisions','upload_source_guesses','realtime_sessions','rate_limit_events','article_visibility_changes','article_share_link_events','reader_arrivals','link_previews') group by 1 order by 1;
\echo == is the DBO1 index present in production
select indexname from pg_indexes where schemaname='spideryarn' and tablename='revision_blocks' order by 1;
\echo == privileges of the app role
select has_table_privilege(current_user,'spideryarn.articles','DELETE') as del_articles, has_table_privilege(current_user,'spideryarn.jobs','DELETE') as del_jobs, has_table_privilege(current_user,'spideryarn.billing_accounts','INSERT') as ins_billing;
```

```
  current_user  | ro |              at               
----------------+----+-------------------------------
 spideryarn_app | on | 2026-10-07 05:51:50.613416+00
(1 row)

== every foreign key that references articles, article_revisions, block_identities, jobs, uploads, ingest_events, raw_sources, chat_threads, referee_criteria, comments
            child            |                             conname                             |         parent         | on_delete |               cols                
-----------------------------+-----------------------------------------------------------------+------------------------+-----------+-----------------------------------
 article_revisions           | article_revisions_based_on_revision_id_article_revisions_id_fk  | article_revisions      | set null  | based_on_revision_id
 articles                    | articles_current_revision_fk                                    | article_revisions      | no action | id,current_revision_id
 jobs                        | jobs_draft_revision_id_article_revisions_id_fk                  | article_revisions      | set null  | draft_revision_id
 revision_blocks             | revision_blocks_revision_fk                                     | article_revisions      | cascade   | article_id,revision_id
 revision_phrase_runs        | revision_phrase_runs_revision_fk                                | article_revisions      | cascade   | article_id,revision_id
 revision_step_runs          | revision_step_runs_revision_id_article_revisions_id_fk          | article_revisions      | cascade   | revision_id
 ai_calls                    | ai_calls_article_id_articles_id_fk                              | articles               | set null  | article_id
 article_revisions           | article_revisions_article_id_articles_id_fk                     | articles               | cascade   | article_id
 article_share_link_events   | article_share_link_events_article_id_articles_id_fk             | articles               | set null  | article_id
 article_tags                | article_tags_article_id_articles_id_fk                          | articles               | cascade   | article_id
 article_visibility_changes  | article_visibility_changes_article_id_articles_id_fk            | articles               | set null  | article_id
 block_identities            | block_identities_article_id_articles_id_fk                      | articles               | cascade   | article_id
 chat_threads                | chat_threads_article_id_articles_id_fk                          | articles               | cascade   | article_id
 checkpoints                 | checkpoints_article_id_articles_id_fk                           | articles               | cascade   | article_id
 citation_finds              | citation_finds_article_id_articles_id_fk                        | articles               | cascade   | article_id
 citation_investigations     | citation_investigations_article_id_articles_id_fk               | articles               | cascade   | article_id
 comments                    | comments_article_id_articles_id_fk                              | articles               | cascade   | article_id
 glossary_hidden_entries     | glossary_hidden_entries_article_id_articles_id_fk               | articles               | cascade   | article_id
 glossary_lookups            | glossary_lookups_article_id_articles_id_fk                      | articles               | cascade   | article_id
 ingest_events               | ingest_events_article_id_articles_id_fk                         | articles               | set null  | article_id
 link_summaries              | link_summaries_article_id_articles_id_fk                        | articles               | cascade   | article_id
 quiz_attempts               | quiz_attempts_article_id_articles_id_fk                         | articles               | cascade   | article_id
 realtime_sessions           | realtime_sessions_article_id_articles_id_fk                     | articles               | set null  | article_id
 referee_claims              | referee_claims_article_id_articles_id_fk                        | articles               | cascade   | article_id
 referee_criteria            | referee_criteria_article_id_articles_id_fk                      | articles               | cascade   | article_id
 search_runs                 | search_runs_article_id_articles_id_fk                           | articles               | cascade   | article_id
 upload_source_guesses       | upload_source_guesses_article_id_articles_id_fk                 | articles               | cascade   | article_id
 ai_calls                    | ai_calls_owner_id_users_id_fk                                   | auth.users             | restrict  | owner_id
 articles                    | articles_owner_fk                                               | auth.users             | restrict  | owner_id
 billing_accounts            | billing_accounts_owner_fk                                       | auth.users             | restrict  | owner_id
 chat_threads                | chat_threads_owner_fk                                           | auth.users             | restrict  | owner_id
 citation_finds              | citation_finds_owner_fk                                         | auth.users             | restrict  | owner_id
 citation_investigations     | citation_investigations_owner_fk                                | auth.users             | restrict  | owner_id
 comments                    | comments_owner_fk                                               | auth.users             | restrict  | owner_id
 feedback                    | feedback_owner_fk                                               | auth.users             | restrict  | owner_id
 glossary_lookups            | glossary_lookups_owner_fk                                       | auth.users             | restrict  | owner_id
 ingest_events               | ingest_events_owner_fk                                          | auth.users             | restrict  | owner_id
 jobs                        | jobs_owner_fk                                                   | auth.users             | restrict  | owner_id
 link_summaries              | link_summaries_owner_fk                                         | auth.users             | cascade   | owner_id
 rate_limit_events           | rate_limit_events_owner_fk                                      | auth.users             | cascade   | owner_id
 reader_arrivals             | reader_arrivals_owner_fk                                        | auth.users             | cascade   | owner_id
 reader_profiles             | reader_profiles_owner_fk                                        | auth.users             | restrict  | owner_id
 realtime_sessions           | realtime_sessions_owner_fk                                      | auth.users             | restrict  | owner_id
 referee_claims              | referee_claims_owner_fk                                         | auth.users             | restrict  | owner_id
 referee_criteria            | referee_criteria_owner_fk                                       | auth.users             | restrict  | owner_id
 search_runs                 | search_runs_owner_fk                                            | auth.users             | restrict  | owner_id
 shelf_topic_scores          | shelf_topic_scores_owner_fk                                     | auth.users             | cascade   | owner_id
 shelf_topic_sets            | shelf_topic_sets_owner_fk                                       | auth.users             | cascade   | owner_id
 uploads                     | uploads_owner_fk                                                | auth.users             | restrict  | owner_id
 bibliographic_service_slots | bibliographic_service_slots_service_bibliographic_services_serv | bibliographic_services | cascade   | service
 billing_vouchers            | billing_vouchers_claimed_by_billing_accounts_owner_id_fk        | billing_accounts       | restrict  | claimed_by
 billing_tier_prices         | billing_tier_prices_tier_id_billing_tiers_id_fk                 | billing_tiers          | cascade   | tier_id
 billing_voucher_emails      | billing_voucher_emails_voucher_id_billing_vouchers_id_fk        | billing_vouchers       | cascade   | voucher_id
 chat_threads                | chat_threads_anchor_identity_fk                                 | block_identities       | no action | article_id,anchor_block_id
 chat_threads                | chat_threads_origin_identity_fk                                 | block_identities       | no action | article_id,origin_block_id
 comments                    | comments_identity_fk                                            | block_identities       | no action | article_id,block_id
 reading_time                | reading_time_block_fk                                           | block_identities       | cascade   | article_id,block_id
 revision_blocks             | revision_blocks_identity_fk                                     | block_identities       | no action | article_id,block_id
 chat_messages               | chat_messages_thread_fk                                         | chat_threads           | cascade   | article_id,thread_id
 citation_index_citers       | citation_index_citers_work_id_citation_index_lookups_work_id_fk | citation_index_lookups | cascade   | work_id
 feedback_shipped_emails     | feedback_shipped_emails_feedback_fk                             | feedback               | cascade   | owner_id,report_id
 ingest_events               | ingest_events_superseded_by_ingest_events_id_fk                 | ingest_events          | no action | superseded_by
 jobs                        | jobs_ingest_event_fk                                            | ingest_events          | no action | ingest_event_id,owner_id
 queue_state                 | queue_state_running_job_id_jobs_id_fk                           | jobs                   | set null  | running_job_id
 article_revisions           | article_revisions_raw_source_fk                                 | raw_sources            | no action | raw_source_sha256,raw_source_kind
 ai_calls                    | ai_calls_realtime_session_id_realtime_sessions_id_fk            | realtime_sessions      | restrict  | realtime_session_id
 comments                    | comments_criterion_fk                                           | referee_criteria       | no action | article_id,criterion_id
 jobs                        | jobs_upload_id_uploads_id_fk                                    | uploads                | set null  | upload_id
(68 rows)

== triggers on spideryarn tables
      tbl      |                tgname                 | tgtype | tgenabled |                proname                
---------------+---------------------------------------+--------+-----------+---------------------------------------
 articles      | ingest_events_freeze_article_price    |     11 | O         | ingest_events_freeze_article_price
 ingest_events | ingest_events_require_price_on_unlink |     19 | O         | ingest_events_require_price_on_unlink
 ingest_events | ingest_events_superseded_by_ingest    |     23 | O         | ingest_events_superseded_by_ingest
 queue_state   | queue_state_no_delete                 |     11 | O         | queue_state_is_permanent
(4 rows)

== columns named slug / article_id / *_slug / storage paths anywhere in spideryarn
         table_name         |         column_name          | data_type 
----------------------------+------------------------------+-----------
 ai_calls                   | article_id                   | uuid
 ai_calls                   | article_slug                 | text
 article_revisions          | article_id                   | uuid
 article_revisions          | raw_sha256                   | text
 article_revisions          | raw_source_sha256            | text
 article_share_link_events  | article_id                   | uuid
 article_share_link_events  | slug                         | text
 article_tags               | article_id                   | uuid
 article_visibility_changes | article_id                   | uuid
 article_visibility_changes | slug                         | text
 articles                   | slug                         | text
 billing_tiers              | lookup_key                   | text
 billing_vouchers           | articles                     | integer
 block_identities           | article_id                   | uuid
 chat_messages              | article_id                   | uuid
 chat_threads               | article_id                   | uuid
 checkpoints                | article_id                   | uuid
 checkpoints                | key                          | text
 citation_finds             | article_id                   | uuid
 citation_investigations    | article_id                   | uuid
 comments                   | article_id                   | uuid
 feedback                   | slug                         | text
 glossary_hidden_entries    | article_id                   | uuid
 glossary_lookups           | article_id                   | uuid
 ingest_events              | article_id                   | uuid
 ingest_events              | article_visibility_at_delete | text
 ingest_events              | slug                         | text
 jobs                       | slug                         | text
 jobs                       | url_key                      | text
 jobs                       | work_key                     | text
 link_summaries             | article_id                   | uuid
 quiz_attempts              | article_id                   | uuid
 raw_sources                | sha256                       | text
 reading_time               | article_id                   | uuid
 realtime_sessions          | article_id                   | uuid
 realtime_sessions          | article_slug                 | text
 referee_claims             | article_id                   | uuid
 referee_criteria           | article_id                   | uuid
 revision_blocks            | article_id                   | uuid
 revision_phrase_runs       | article_id                   | uuid
 search_runs                | article_id                   | uuid
 upload_source_guesses      | article_id                   | uuid
 uploads                    | claimed_sha256               | text
 uploads                    | sha256                       | text
 uploads                    | slug                         | text
(45 rows)

== columns of the tables we will query
         table_name         |                                                                                                                                                                                                                                                                                                                                                                                                                              string_agg                                                                                                                                                                                                                                                                                                                                                                                                                               
----------------------------+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 ai_calls                   | id, article_id, purpose, created_at, run_id, generation_id, scope_kind, owner_id, article_slug, job_id, step_name, wire, requested_model, answered_model, upstream, credential_fingerprint, started_at, finished_at, duration_ms, outcome, credits_used_nanos, byok_upstream_nanos, is_byok, reported_input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cache_write_5m_tokens, cache_write_1h_tokens, reasoning_tokens, web_searches, service_tier, inference_geo, provider_account, cost_source, computed_cost_nanos, price_version, realtime_session_id, provider_event_id, event_kind, provider_status, input_text_tokens, input_audio_tokens, input_image_tokens, cached_text_tokens, cached_audio_tokens, output_text_tokens, output_audio_tokens, transcription_seconds, voice_seconds, attempt, failure_phase, failure_class, failure_status
 article_revisions          | id, article_id, status, title, byline, site_name, lang, excerpt, note, requested_url, final_url, fetched_at, raw_content_type, raw_encoding, extracted_html, stamped_html, tree, arc, tweets, word_count, block_count, part_count, section_count, root_gist, created_at, glossary, labels, raw_sha256, source, extract_method, pages, unverified, recall, pages_checked, ideas, raw_source_sha256, raw_source_kind, raw_byte_count, raw_filename, assets, sketch, quotes, published_at, timeline, quiz, based_on_revision_id, illustrated, debate, nav_label_status, citations, faq, skim, authors, crossrefs, simple_summary, abstract, doi, relations, journal, published_year, title_original, reading_language, reading_ideas, reading_difficulty_reason, reading_difficulty_model, reading_difficulty_rated_at
 article_share_link_events  | id, article_id, slug, actor_owner_id, event, rights_confirmed, created_at
 article_visibility_changes | id, article_id, slug, actor_owner_id, from_visibility, to_visibility, rights_confirmed, at
 articles                   | id, owner_id, slug, current_revision_id, created_at, archived_at, title_override, opens, last_opened_at, fixture, purpose, visibility, public_at, short_id, high_power_since, processing, updated_at, share_token, share_token_at, asked_url
 checkpoints                | article_id, namespace, key, value, created_at, last_used_at
 feedback                   | id, owner_id, reporter_email, consented, slug, build_commit, environment, request_vercel_id, diagnostics, diagnostics_version, screenshot, mirrored_at, sentry_event_id, created_at, mirror_attempted_at, body, kind, url, ignored_at
 ingest_events              | id, owner_id, reserved_at, succeeded_at, released_at, slug, article_id, article_visibility_at_delete, kind, superseded_by
 jobs                       | id, owner_id, slug, url, title, steps, status, error, cancelling, attempt_id, lease_expires_at, created_at, started_at, finished_at, draft_revision_id, profile, failure_kind, upload_id, upload_filename, work_key, reserves_name, url_key, ingest_event_id, requeues, reset, dismissed_at, illustration_note, cancel_requested_at
 link_previews              | target, final_target, outcome, failure, title, site_name, description, first_paragraph, words, fetched_at, claim_id, expires_at, excerpt
 rate_limit_events          | id, owner_id, bucket, started_at, lease_until
 raw_sources                | sha256, kind, bytes, content_type, verified_at, created_at
 reader_arrivals            | owner_id, first_seen_at
 realtime_sessions          | id, owner_id, article_id, article_slug, thread_id, model, transcription_model, issued_at, accepts_until, connected_at, closed_at, close_reason, created_at, backend_model, provider_session_id, voice_seconds_reported
 upload_source_guesses      | article_id, status, url, host, kind, matched_by, why, claim_token, attempts, searches, model, claimed_at, finished_at
 uploads                    | id, owner_id, filename, claimed_bytes, claimed_sha256, status, minted_at, grant_expires_at, sha256, bytes, reason, slug
(16 rows)

== is the DBO1 index present in production
                indexname                
-----------------------------------------
 revision_blocks_fts
 revision_blocks_revision_id_block_id_pk
 revision_blocks_revision_ordinal
(3 rows)

== privileges of the app role
 del_articles | del_jobs | ins_billing 
--------------+----------+-------------
 t            | t        | t
(1 row)
```

### S — the candidates and everything attached

```sql
\echo == S1 revision statuses in use (codes), and whether any article has a published-or-superseded revision without a current pointer
select status, count(*) from article_revisions group by 1 order by 1;
select count(*) as articles,
       count(*) filter (where a.current_revision_id is null) as no_current,
       count(*) filter (where a.current_revision_id is null and exists (select 1 from article_revisions r where r.article_id = a.id and (r.status not in ('draft','failed') or r.published_at is not null))) as no_current_but_once_published,
       count(*) filter (where a.current_revision_id is not null and not exists (select 1 from article_revisions r where r.id = a.current_revision_id and r.status = 'published')) as current_not_published
from articles a;

\echo == S2 the candidates, one row each (ids, codes, timestamps, booleans; no prose)
\set ghost '(select a.* from articles a where a.current_revision_id is null and not exists (select 1 from article_revisions r where r.article_id = a.id and (r.status not in (''draft'',''failed'') or r.published_at is not null)))'
select g.id, g.short_id, g.owner_id, g.created_at::timestamptz(0) as created, g.updated_at::timestamptz(0) as updated,
       g.processing, g.visibility, g.fixture,
       g.archived_at is not null as archived, g.opens, g.last_opened_at is not null as opened,
       g.purpose is not null as has_purpose, g.title_override is not null as has_title, g.share_token is not null as has_share, g.public_at is not null as was_public,
       g.high_power_since is not null as high_power,
       g.asked_url is not null as has_asked_url,
       left(g.slug,1) = '_' as underscore_slug
from :ghost g order by g.created_at;
select count(*) as candidates, count(distinct owner_id) as owners from :ghost g;

\echo == S3 per candidate: what is attached (counts)
select g.short_id,
  (select count(*) from article_revisions r where r.article_id = g.id) as revs,
  (select count(*) from revision_blocks r where r.article_id = g.id) as rev_blocks,
  (select count(*) from block_identities b where b.article_id = g.id) as identities,
  (select count(*) from checkpoints c where c.article_id = g.id) as ckpt,
  (select count(*) from checkpoints c where c.article_id = g.id and c.namespace = 'pdf-chunk') as ckpt_pdf,
  (select coalesce(sum(pg_column_size(c.value)),0) from checkpoints c where c.article_id = g.id) as ckpt_bytes,
  (select max(c.last_used_at)::timestamptz(0) from checkpoints c where c.article_id = g.id) as ckpt_last_used,
  (select count(*) from ai_calls c where c.article_id = g.id) as ai_calls,
  (select round(coalesce(sum(coalesce(c.credits_used_nanos, c.computed_cost_nanos)),0) / 1e9, 2) from ai_calls c where c.article_id = g.id) as ai_usd,
  (select max(c.started_at)::timestamptz(0) from ai_calls c where c.article_id = g.id) as ai_last
from :ghost g order by g.created_at;

\echo == S4 jobs for the candidates' slugs (same owner), by status
select g.short_id, j.status, j.failure_kind, count(*) as jobs,
       count(*) filter (where j.dismissed_at is not null) as dismissed,
       count(*) filter (where j.upload_id is not null) as with_upload,
       count(*) filter (where j.url is not null) as with_url,
       count(*) filter (where j.ingest_event_id is not null) as with_reservation,
       count(*) filter (where j.lease_expires_at is not null) as with_lease,
       sum(j.requeues) as requeues,
       min(j.created_at)::timestamptz(0) as first_created, max(coalesce(j.finished_at, j.started_at, j.created_at))::timestamptz(0) as last_touched
from :ghost g join jobs j on j.slug = g.slug and j.owner_id = g.owner_id
group by 1,2,3 order by 1,2;
select count(*) as jobs_same_slug_other_owner from :ghost g join jobs j on j.slug = g.slug and j.owner_id <> g.owner_id;
select count(*) as candidates_with_no_job_row from :ghost g where not exists (select 1 from jobs j where j.slug = g.slug and j.owner_id = g.owner_id);

\echo == S5 billing: reservations reached from the candidates, three ways
select 'by article_id' as via, count(*) as rows, count(*) filter (where e.succeeded_at is not null) as succeeded, count(*) filter (where e.released_at is not null) as released, count(*) filter (where e.succeeded_at is null and e.released_at is null) as unsettled
  from ingest_events e join :ghost g on g.id = e.article_id
union all
select 'by slug', count(*), count(*) filter (where e.succeeded_at is not null), count(*) filter (where e.released_at is not null), count(*) filter (where e.succeeded_at is null and e.released_at is null)
  from ingest_events e join :ghost g on g.slug = e.slug and g.owner_id = e.owner_id
union all
select 'by job.ingest_event_id', count(*), count(*) filter (where e.succeeded_at is not null), count(*) filter (where e.released_at is not null), count(*) filter (where e.succeeded_at is null and e.released_at is null)
  from :ghost g join jobs j on j.slug = g.slug and j.owner_id = g.owner_id join ingest_events e on e.id = j.ingest_event_id;
\echo == S5b the stranded-reservation question exactly as destroy asks it
select count(*) as stranded from :ghost g join jobs j on j.slug = g.slug and j.owner_id = g.owner_id join ingest_events e on e.id = j.ingest_event_id
 where j.status in ('done','error','cancelled') and e.succeeded_at is null and e.released_at is null;
select count(*) as live_jobs from :ghost g join jobs j on j.slug = g.slug and j.owner_id = g.owner_id where j.status in ('queued','running');
select kind, count(*) as reservations_by_job, count(*) filter (where e.article_id is not null) as linked_to_an_article from :ghost g join jobs j on j.slug = g.slug and j.owner_id = g.owner_id join ingest_events e on e.id = j.ingest_event_id group by 1;

\echo == S6 every table that reaches an article: rows attached to the candidate set
select t, n from (
  select 'article_revisions' t, (select count(*) from article_revisions x join :ghost g on g.id = x.article_id) n
  union all select 'revision_blocks', (select count(*) from revision_blocks x join :ghost g on g.id = x.article_id)
  union all select 'revision_phrase_runs', (select count(*) from revision_phrase_runs x join :ghost g on g.id = x.article_id)
  union all select 'revision_step_runs', (select count(*) from revision_step_runs x join article_revisions r on r.id = x.revision_id join :ghost g on g.id = r.article_id)
  union all select 'block_identities', (select count(*) from block_identities x join :ghost g on g.id = x.article_id)
  union all select 'checkpoints', (select count(*) from checkpoints x join :ghost g on g.id = x.article_id)
  union all select 'article_tags', (select count(*) from article_tags x join :ghost g on g.id = x.article_id)
  union all select 'comments', (select count(*) from comments x join :ghost g on g.id = x.article_id)
  union all select 'chat_threads', (select count(*) from chat_threads x join :ghost g on g.id = x.article_id)
  union all select 'chat_messages', (select count(*) from chat_messages x join :ghost g on g.id = x.article_id)
  union all select 'search_runs', (select count(*) from search_runs x join :ghost g on g.id = x.article_id)
  union all select 'referee_criteria', (select count(*) from referee_criteria x join :ghost g on g.id = x.article_id)
  union all select 'referee_claims', (select count(*) from referee_claims x join :ghost g on g.id = x.article_id)
  union all select 'glossary_lookups', (select count(*) from glossary_lookups x join :ghost g on g.id = x.article_id)
  union all select 'glossary_hidden_entries', (select count(*) from glossary_hidden_entries x join :ghost g on g.id = x.article_id)
  union all select 'citation_finds', (select count(*) from citation_finds x join :ghost g on g.id = x.article_id)
  union all select 'citation_investigations', (select count(*) from citation_investigations x join :ghost g on g.id = x.article_id)
  union all select 'reading_time', (select count(*) from reading_time x join :ghost g on g.id = x.article_id)
  union all select 'quiz_attempts', (select count(*) from quiz_attempts x join :ghost g on g.id = x.article_id)
  union all select 'link_summaries', (select count(*) from link_summaries x join :ghost g on g.id = x.article_id)
  union all select 'upload_source_guesses', (select count(*) from upload_source_guesses x join :ghost g on g.id = x.article_id)
  union all select 'ai_calls (article_id)', (select count(*) from ai_calls x join :ghost g on g.id = x.article_id)
  union all select 'ai_calls (article_slug, article_id null)', (select count(*) from ai_calls x join :ghost g on g.slug = x.article_slug where x.article_id is null)
  union all select 'ingest_events (article_id)', (select count(*) from ingest_events x join :ghost g on g.id = x.article_id)
  union all select 'ingest_events (slug)', (select count(*) from ingest_events x join :ghost g on g.slug = x.slug)
  union all select 'realtime_sessions (article_id)', (select count(*) from realtime_sessions x join :ghost g on g.id = x.article_id)
  union all select 'realtime_sessions (article_slug)', (select count(*) from realtime_sessions x join :ghost g on g.slug = x.article_slug)
  union all select 'article_visibility_changes (id or slug)', (select count(*) from article_visibility_changes x join :ghost g on g.id = x.article_id or g.slug = x.slug)
  union all select 'article_share_link_events (id or slug)', (select count(*) from article_share_link_events x join :ghost g on g.id = x.article_id or g.slug = x.slug)
  union all select 'jobs (slug, same owner)', (select count(*) from jobs x join :ghost g on g.slug = x.slug and g.owner_id = x.owner_id)
  union all select 'uploads (slug)', (select count(*) from uploads x join :ghost g on g.slug = x.slug)
  union all select 'uploads (via jobs.upload_id)', (select count(distinct x.id) from uploads x join jobs j on j.upload_id = x.id join :ghost g on g.slug = j.slug and g.owner_id = j.owner_id)
  union all select 'feedback (slug)', (select count(*) from feedback x join :ghost g on g.slug = x.slug)
  union all select 'queue_state.running_job_id', (select count(*) from queue_state q join jobs j on j.id = q.running_job_id join :ghost g on g.slug = j.slug)
) s;

\echo == S7 uploads reached from the candidates: status, and whether the stored object is shared with anything that survives
select g.short_id, u.status, u.sha256 is not null as has_object, u.bytes,
       u.minted_at::timestamptz(0) as minted,
       (select count(*) from raw_sources s where s.sha256 = u.sha256) as raw_source_rows,
       (select count(*) from article_revisions r where r.raw_source_sha256 = u.sha256) as revisions_referencing,
       (select count(*) from uploads u2 where u2.sha256 = u.sha256 and u2.id <> u.id) as other_uploads_same_bytes,
       (select count(*) from uploads u2 join articles a2 on a2.slug = u2.slug where u2.sha256 = u.sha256 and u2.id <> u.id and a2.current_revision_id is not null) as other_published_articles_same_bytes
from :ghost g join uploads u on u.slug = g.slug order by u.minted_at;
select count(*) as raw_sources_total, count(*) filter (where not exists (select 1 from article_revisions r where r.raw_source_sha256 = s.sha256)) as referenced_by_no_revision from raw_sources s;

\echo == S8 checkpoints of the candidates by namespace
select c.namespace, count(*) as rows, count(distinct c.article_id) as articles, pg_size_pretty(sum(pg_column_size(c.value))::bigint) as size, min(c.created_at)::timestamptz(0) as first, max(c.last_used_at)::timestamptz(0) as last_used
from checkpoints c join :ghost g on g.id = c.article_id group by 1 order by 1;
\echo == S8b ai_calls of the candidates by step (codes)
select c.step_name, count(*) as calls, round(coalesce(sum(coalesce(c.credits_used_nanos, c.computed_cost_nanos)),0)/1e9, 2) as usd, max(c.started_at)::timestamptz(0) as last
from ai_calls c join :ghost g on g.id = c.article_id group by 1 order by 3 desc;

\echo == S9 alive? newest thing attached per candidate, and its age
select g.short_id, greatest(g.created_at, coalesce(g.updated_at, g.created_at),
         coalesce((select max(coalesce(j.finished_at, j.started_at, j.created_at)) from jobs j where j.slug = g.slug and j.owner_id = g.owner_id), g.created_at),
         coalesce((select max(c.last_used_at) from checkpoints c where c.article_id = g.id), g.created_at),
         coalesce((select max(coalesce(c.finished_at, c.started_at)) from ai_calls c where c.article_id = g.id), g.created_at),
         coalesce((select max(u.minted_at) from uploads u where u.slug = g.slug), g.created_at),
         coalesce((select max(r.created_at) from article_revisions r where r.article_id = g.id), g.created_at))::timestamptz(0) as newest,
       date_trunc('hour', now() - greatest(g.created_at, coalesce(g.updated_at, g.created_at),
         coalesce((select max(coalesce(j.finished_at, j.started_at, j.created_at)) from jobs j where j.slug = g.slug and j.owner_id = g.owner_id), g.created_at),
         coalesce((select max(c.last_used_at) from checkpoints c where c.article_id = g.id), g.created_at),
         coalesce((select max(coalesce(c.finished_at, c.started_at)) from ai_calls c where c.article_id = g.id), g.created_at),
         coalesce((select max(u.minted_at) from uploads u where u.slug = g.slug), g.created_at),
         coalesce((select max(r.created_at) from article_revisions r where r.article_id = g.id), g.created_at))) as age
from :ghost g order by 2;

\echo == S10 sizes: the largest candidate, and the whole table the unindexed lookup walks
select max(n) as largest_candidate_identities, sum(n) as all_candidate_identities from (select count(*) n from block_identities b join :ghost g on g.id = b.article_id group by b.article_id) s;
select (select count(*) from block_identities) as identities_total, (select count(*) from revision_blocks) as revision_blocks_total, (select count(*) from checkpoints) as checkpoints_total, pg_size_pretty(pg_relation_size('spideryarn.revision_blocks_revision_id_block_id_pk')) as rb_pk_size;

\echo == S11 the owner: is it the administrator's own account, and what else do they hold (ids and counts)
select g.owner_id, count(*) as candidates,
  (select count(*) from articles a where a.owner_id = g.owner_id and a.current_revision_id is not null) as published_articles_of_owner,
  (select count(*) from billing_accounts b where b.owner_id = g.owner_id) as billing_account_rows
from :ghost g group by 1;
```

```
  current_user  | ro |              at               
----------------+----+-------------------------------
 spideryarn_app | on | 2026-10-07 05:53:05.086122+00
(1 row)

== S1 revision statuses in use (codes), and whether any article has a published-or-superseded revision without a current pointer
  status   | count 
-----------+-------
 failed    |    10
 published |   460
(2 rows)

 articles | no_current | no_current_but_once_published | current_not_published 
----------+------------+-------------------------------+-----------------------
       62 |         13 |                             0 |                     0
(1 row)

== S2 the candidates, one row each (ids, codes, timestamps, booleans; no prose)
                  id                  |  short_id   |               owner_id               |        created         | updated | processing | visibility | fixture | archived | opens | opened | has_purpose | has_title | has_share | was_public | high_power | has_asked_url | underscore_slug 
--------------------------------------+-------------+--------------------------------------+------------------------+---------+------------+------------+---------+----------+-------+--------+-------------+-----------+-----------+------------+------------+---------------+-----------------
 992df6bf-77c6-4dab-9879-8360f3e28bae | spya-np5eep | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-03 13:18:08+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 d64ade3c-abbc-4622-a2cf-f66f4d5cd6a4 | spya-ve4avb | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-03 13:18:17+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 f55a3fd4-9ed5-46e3-b975-3ed1de5fe1b8 | spya-tx8r32 | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-03 15:55:55+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 bf6cb59f-af56-4b57-9983-87117098f55d | spya-fwp82p | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-04 09:20:20+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 dddf7746-b943-4671-aeab-312f28c1dfbc | spya-ssves7 | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-04 10:37:45+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 02e7bc66-67c4-49b5-983e-b240757cd806 | spya-g4d2n9 | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-04 12:56:05+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 91f949a8-41dd-4fb9-a0f9-af8253e86873 | spya-y3wj6a | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-07 19:54:33+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 4d91981f-9bb3-4e3a-8ccb-ae443ceeef30 | spya-hwsqfk | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-12 07:54:07+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 3e954894-9b9d-4ff6-b349-94e5b988a101 | spya-yn6pr0 | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-28 04:01:03+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 60cbe2a2-ac22-444f-89b6-e2320f1d843c | spya-vj2z4v | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-28 04:03:15+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 f2b52cf2-0268-4703-bc3e-356b16f307f9 | spya-x5ff2s | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-28 04:03:19+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 ce425589-a285-4675-9327-ff8794117c2c | spya-fdcs3c | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-09-28 04:04:43+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
 82b5bb6c-e603-404c-94da-036719cda430 | spya-xytyjz | 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a | 2026-10-01 17:53:08+00 |         | full       | private    | f       | f        |     0 | f      | f           | f         | f         | f          | f          | f             | f
(13 rows)

 candidates | owners 
------------+--------
         13 |      1
(1 row)

== S3 per candidate: what is attached (counts)
unterminated quoted string
  short_id   | revs | rev_blocks | identities | ckpt | ckpt_pdf | ckpt_bytes |     ckpt_last_used     | ai_calls | ai_usd |        ai_last         
-------------+------+------------+------------+------+----------+------------+------------------------+----------+--------+------------------------
 spya-np5eep |    0 |          0 |        195 |    0 |        0 |          0 |                        |        1 |   0.15 | 2026-09-03 13:18:11+00
 spya-ve4avb |    0 |          0 |        695 |    0 |        0 |          0 |                        |        1 |   0.00 | 2026-09-03 13:18:21+00
 spya-tx8r32 |    0 |          0 |          0 |    0 |        0 |          0 |                        |        0 |   0.00 | 
 spya-fwp82p |    0 |          0 |       2024 |   56 |       56 |     572916 | 2026-09-04 09:25:43+00 |       88 |   0.00 | 2026-09-04 09:24:38+00
 spya-ssves7 |    0 |          0 |       2010 |   54 |       54 |     548112 | 2026-09-04 10:42:28+00 |       90 |   0.00 | 2026-09-04 10:41:30+00
 spya-g4d2n9 |    0 |          0 |       2036 |   54 |       54 |     549835 | 2026-09-04 13:01:55+00 |       91 |   0.00 | 2026-09-04 13:00:32+00
 spya-y3wj6a |    0 |          0 |          0 |    0 |        0 |          0 |                        |        0 |   0.00 | 
 spya-hwsqfk |    0 |          0 |          0 |    0 |        0 |          0 |                        |        0 |   0.00 | 
 spya-yn6pr0 |    0 |          0 |        245 |    0 |        0 |          0 |                        |        1 |   0.19 | 2026-09-28 04:01:09+00
 spya-vj2z4v |    0 |          0 |          0 |    0 |        0 |          0 |                        |        0 |   0.00 | 
 spya-x5ff2s |    0 |          0 |          0 |    0 |        0 |          0 |                        |        1 |   0.00 | 2026-09-28 04:03:28+00
 spya-fdcs3c |    0 |          0 |          0 |    0 |        0 |          0 |                        |        0 |   0.00 | 
 spya-xytyjz |    0 |          0 |       2098 |   32 |       32 |     149915 | 2026-10-01 18:28:46+00 |       59 |   0.58 | 2026-10-01 18:29:24+00
(13 rows)

== S4 jobs for the
 short_id | status | failure_kind | jobs | dismissed | with_upload | with_url | with_reservation | with_lease | requeues | first_created | last_touched 
----------+--------+--------------+------+-----------+-------------+----------+------------------+------------+----------+---------------+--------------
(0 rows)

 jobs_same_slug_other_owner 
----------------------------
                          0
(1 row)

 candidates_with_no_job_row 
----------------------------
                         13
(1 row)

== S5 billing: reservations reached from the candidates, three ways
          via           | rows | succeeded | released | unsettled 
------------------------+------+-----------+----------+-----------
 by article_id          |    0 |         0 |        0 |         0
 by slug                |    0 |         0 |        0 |         0
 by job.ingest_event_id |    0 |         0 |        0 |         0
(3 rows)

== S5b the stranded-reservation question exactly as destroy asks it
 stranded 
----------
        0
(1 row)

 live_jobs 
-----------
         0
(1 row)

 kind | reservations_by_job | linked_to_an_article 
------+---------------------+----------------------
(0 rows)

== S6 every table that reaches an article: rows attached to the candidate set
                    t                     |  n   
------------------------------------------+------
 article_revisions                        |    0
 revision_blocks                          |    0
 revision_phrase_runs                     |    0
 revision_step_runs                       |    0
 block_identities                         | 9303
 checkpoints                              |  196
 article_tags                             |    0
 comments                                 |    0
 chat_threads                             |    0
 chat_messages                            |    0
 search_runs                              |    0
 referee_criteria                         |    0
 referee_claims                           |    0
 glossary_lookups                         |    0
 glossary_hidden_entries                  |    0
 citation_finds                           |    0
 citation_investigations                  |    0
 reading_time                             |    0
 quiz_attempts                            |    0
 link_summaries                           |    0
 upload_source_guesses                    |    0
 ai_calls (article_id)                    |  332
 ai_calls (article_slug, article_id null) |    0
 ingest_events (article_id)               |    0
 ingest_events (slug)                     |    0
 realtime_sessions (article_id)           |    0
 realtime_sessions (article_slug)         |    0
 article_visibility_changes (id or slug)  |    0
 article_share_link_events (id or slug)   |    0
 jobs (slug, same owner)                  |    0
 uploads (slug)                           |    6
 uploads (via jobs.upload_id)             |    0
 feedback (slug)                          |    0
 queue_state.running_job_id               |    0
(34 rows)

== S7 uploads reached from the candidates: status, and whether the stored object is shared with anything that survives
  short_id   |  status  | has_object |  bytes  |         minted         | raw_source_rows | revisions_referencing | other_uploads_same_bytes | other_published_articles_same_bytes 
-------------+----------+------------+---------+------------------------+-----------------+-----------------------+--------------------------+-------------------------------------
 spya-tx8r32 | verified | t          | 8748470 | 2026-09-03 15:54:41+00 |               1 |                    12 |                        4 |                                   1
 spya-fwp82p | verified | t          | 8748470 | 2026-09-04 09:16:36+00 |               1 |                    12 |                        4 |                                   1
 spya-ssves7 | verified | t          | 8748470 | 2026-09-04 10:37:07+00 |               1 |                    12 |                        4 |                                   1
 spya-g4d2n9 | verified | t          | 8748470 | 2026-09-04 12:56:03+00 |               1 |                    12 |                        4 |                                   1
 spya-y3wj6a | rejected | f          |         | 2026-09-07 19:54:29+00 |               0 |                     0 |                        0 |                                   0
 spya-xytyjz | verified | t          | 4345368 | 2026-10-01 17:53:04+00 |               1 |                    11 |                        1 |                                   1
(6 rows)

 raw_sources_total | referenced_by_no_revision 
-------------------+---------------------------
                46 |                         2
(1 row)

== S8 checkpoints of the candidates by namespace
 namespace | rows | articles |  size   |         first          |       last_used        
-----------+------+----------+---------+------------------------+------------------------
 pdf-chunk |  196 |        4 | 1778 kB | 2026-09-04 09:21:13+00 | 2026-10-01 18:28:46+00
(1 row)

== S8b ai_calls of the candidates by step (codes)
 step_name | calls | usd  |          last          
-----------+-------+------+------------------------
 hierarchy |     5 | 0.93 | 2026-10-01 18:29:24+00
 extract   |   327 | 0.00 | 2026-10-01 18:28:44+00
(2 rows)

== S9 alive? newest thing attached per candidate, and its age
  short_id   |         newest         |       age        
-------------+------------------------+------------------
 spya-np5eep | 2026-09-03 13:19:50+00 | 33 days 16:00:00
 spya-ve4avb | 2026-09-03 13:30:37+00 | 33 days 16:00:00
 spya-tx8r32 | 2026-09-03 15:55:55+00 | 33 days 13:00:00
 spya-fwp82p | 2026-09-04 09:25:43+00 | 32 days 20:00:00
 spya-ssves7 | 2026-09-04 10:42:28+00 | 32 days 19:00:00
 spya-g4d2n9 | 2026-09-04 13:01:55+00 | 32 days 16:00:00
 spya-y3wj6a | 2026-09-07 19:54:33+00 | 29 days 09:00:00
 spya-hwsqfk | 2026-09-12 07:54:07+00 | 24 days 21:00:00
 spya-yn6pr0 | 2026-09-28 04:02:46+00 | 9 days 01:00:00
 spya-vj2z4v | 2026-09-28 04:03:15+00 | 9 days 01:00:00
 spya-x5ff2s | 2026-09-28 04:03:28+00 | 9 days 01:00:00
 spya-fdcs3c | 2026-09-28 04:04:43+00 | 9 days 01:00:00
 spya-xytyjz | 2026-10-01 18:30:59+00 | 5 days 11:00:00
(13 rows)

== S10 sizes: the largest candidate, and the whole table the unindexed lookup walks
 largest_candidate_identities | all_candidate_identities 
------------------------------+--------------------------
                         2098 |                     9303
(1 row)

unterminated quoted string
 identities_total | revision_blocks_total | checkpoints_total | rb_pk_size 
------------------+-----------------------+-------------------+------------
            24344 |                105774 |               594 | 10008 kB
(1 row)

== S11 the owner: is it the
               owner_id               | candidates | published_articles_of_owner | billing_account_rows 
--------------------------------------+------------+-----------------------------+----------------------
 001bb7a0-7720-4f1b-8b9d-1ee6e63d132a |         13 |                          47 |                    1
(1 row)
```

### T — cost columns, the later successful imports, reservations, jobs, JSON mentions

```sql
\set ghost '(select a.* from articles a where a.current_revision_id is null and not exists (select 1 from article_revisions r where r.article_id = a.id and (r.status not in (''draft'',''failed'') or r.published_at is not null)))'
\echo == T1 the cost columns of the candidates' ai_calls (codes and counts)
select c.step_name, c.outcome, c.cost_source, c.is_byok, count(*) as calls,
       count(*) filter (where c.credits_used_nanos is null) as no_credits,
       count(*) filter (where c.computed_cost_nanos is null) as no_computed,
       round(coalesce(sum(c.credits_used_nanos),0)/1e9, 4) as credits_usd,
       round(coalesce(sum(c.computed_cost_nanos),0)/1e9, 4) as computed_usd,
       round(coalesce(sum(c.byok_upstream_nanos),0)/1e9, 4) as byok_usd,
       count(distinct c.job_id) as jobs
from ai_calls c join :ghost g on g.id = c.article_id group by 1,2,3,4 order by 1,2,3,4;
\echo == T2 the PDF candidates: which surviving published article holds the same bytes, and when was it made
select g.short_id as ghost, u.sha256 is not null as has_bytes, a2.short_id as published_holder, a2.created_at::timestamptz(0) as holder_created, r2.published_at::timestamptz(0) as holder_published,
       a2.created_at > g.created_at as holder_is_later
from :ghost g join uploads u on u.slug = g.slug and u.sha256 is not null
join article_revisions r2 on r2.raw_source_sha256 = u.sha256 and r2.id = (select a3.current_revision_id from articles a3 where a3.id = r2.article_id)
join articles a2 on a2.id = r2.article_id
order by g.created_at;
\echo == T3 the owner's ingest reservations at all (is this account reserved for?)
select (select count(*) from ingest_events e where e.owner_id = '001bb7a0-7720-4f1b-8b9d-1ee6e63d132a') as owner_reservations,
       (select min(reserved_at)::timestamptz(0) from ingest_events) as first_reservation_anywhere,
       (select count(*) from jobs j where j.owner_id = '001bb7a0-7720-4f1b-8b9d-1ee6e63d132a') as owner_jobs_now,
       (select min(created_at)::timestamptz(0) from jobs j where j.owner_id = '001bb7a0-7720-4f1b-8b9d-1ee6e63d132a') as owner_oldest_job;
\echo == T4 ai_calls run ids / job ids for the candidates: is any job id still a job row?
select count(distinct c.job_id) as distinct_jobs, count(distinct c.job_id) filter (where exists (select 1 from jobs j where j.id = c.job_id)) as still_rows from ai_calls c join :ghost g on g.id = c.article_id;
\echo == T5 the candidates that have no blocks, no checkpoints and no calls: is anything at all attached?
select g.short_id,
  (select count(*) from uploads u where u.slug = g.slug) as uploads,
  (select string_agg(u.status, ',') from uploads u where u.slug = g.slug) as upload_status
from :ghost g
where not exists (select 1 from block_identities b where b.article_id = g.id)
order by g.created_at;
\echo == T6 the revision_blocks rows that point at the candidates' identities (the FK the DBO1 index is for)
select count(*) as rb_rows_on_candidate_identities from revision_blocks rb join :ghost g on g.id = rb.article_id;
\echo == T7 every article id referenced inside a JSON column, for completeness (jobs.steps, feedback.diagnostics) by candidate id text
select (select count(*) from feedback f, :ghost g where f.diagnostics::text like '%' || g.id::text || '%' or f.diagnostics::text like '%' || g.short_id || '%') as feedback_diag_mentions,
       (select count(*) from feedback f, :ghost g where f.url like '%' || g.short_id || '%') as feedback_url_mentions;
```

```
  current_user  | ro |              at               
----------------+----+-------------------------------
 spideryarn_app | on | 2026-10-07 05:54:24.609948+00
(1 row)

== T1 the cost columns of the
unterminated quoted string
 step_name | outcome | cost_source | is_byok | calls | no_credits | no_computed | credits_usd | computed_usd | byok_usd | jobs 
-----------+---------+-------------+---------+-------+------------+-------------+-------------+--------------+----------+------
 extract   | aborted | none        |         |     1 |          1 |           1 |      0.0000 |       0.0000 |   0.0000 |    1
 extract   | ok      | provider    | t       |   326 |          0 |         326 |      0.0000 |       0.0000 |   2.2708 |    5
 hierarchy | aborted | none        |         |     1 |          1 |           1 |      0.0000 |       0.0000 |   0.0000 |    1
 hierarchy | ok      | provider    | f       |     4 |          0 |           4 |      0.9299 |       0.0000 |   0.0000 |    4
(4 rows)

== T2 the PDF candidates: which surviving published article holds the same bytes, and when was it made
unterminated quoted string
    ghost    | has_bytes | published_holder |     holder_created     | holder_published | holder_is_later 
-------------+-----------+------------------+------------------------+------------------+-----------------
 spya-tx8r32 | t         | spya-hs82mz      | 2026-09-04 22:15:00+00 |                  | t
 spya-fwp82p | t         | spya-hs82mz      | 2026-09-04 22:15:00+00 |                  | t
 spya-ssves7 | t         | spya-hs82mz      | 2026-09-04 22:15:00+00 |                  | t
 spya-g4d2n9 | t         | spya-hs82mz      | 2026-09-04 22:15:00+00 |                  | t
 spya-xytyjz | t         | spya-r26sug      | 2026-10-04 20:19:06+00 |                  | t
(5 rows)

== T3 the
 owner_reservations | first_reservation_anywhere | owner_jobs_now |    owner_oldest_job    
--------------------+----------------------------+----------------+------------------------
                  0 | 2026-10-04 12:14:54+00     |             50 | 2026-09-28 10:46:54+00
(1 row)

== T4 ai_calls run ids / job ids for the candidates: is any job id still a job row?
 distinct_jobs | still_rows 
---------------+------------
             9 |          0
(1 row)

== T5 the candidates that have no blocks, no checkpoints and no calls: is anything at all attached?
unterminated quoted string
  short_id   | uploads | upload_status 
-------------+---------+---------------
 spya-tx8r32 |       1 | verified
 spya-y3wj6a |       1 | rejected
 spya-hwsqfk |       0 | 
 spya-vj2z4v |       0 | 
 spya-x5ff2s |       0 | 
 spya-fdcs3c |       0 | 
(6 rows)

== T6 the revision_blocks rows that point at the
 rb_rows_on_candidate_identities 
---------------------------------
                               0
(1 row)

== T7 every article id referenced inside a JSON column, for completeness (jobs.steps, feedback.diagnostics) by candidate id text
 feedback_diag_mentions | feedback_url_mentions 
------------------------+-----------------------
                      0 |                     0
(1 row)
```

### U — the cost of the foreign-key check, measured

```sql
\echo == U1 the lookup Postgres runs per deleted block identity (revision_blocks_identity_fk), for one identity of the largest candidate, three times
explain (analyze, buffers, costs off, timing on) select 1 from only revision_blocks x where x.article_id = '82b5bb6c-e603-404c-94da-036719cda430' and x.block_id = (select b.block_id from block_identities b where b.article_id = '82b5bb6c-e603-404c-94da-036719cda430' order by b.block_id limit 1 offset 100);
explain (analyze, buffers, costs off, timing on) select 1 from only revision_blocks x where x.article_id = '82b5bb6c-e603-404c-94da-036719cda430' and x.block_id = (select b.block_id from block_identities b where b.article_id = '82b5bb6c-e603-404c-94da-036719cda430' order by b.block_id limit 1 offset 1000);
explain (analyze, buffers, costs off, timing on) select 1 from only revision_blocks x where x.article_id = '82b5bb6c-e603-404c-94da-036719cda430' and x.block_id = (select b.block_id from block_identities b where b.article_id = '82b5bb6c-e603-404c-94da-036719cda430' order by b.block_id limit 1 offset 2000);
\echo == U2 all 2,098 lookups of the largest candidate, as one timed statement (the same per-row probe, run as a correlated subquery)
\timing on
select count(*) filter (where exists (select 1 from only revision_blocks x where x.article_id = b.article_id and x.block_id = b.block_id)) as referenced, count(*) as identities
from block_identities b where b.article_id = '82b5bb6c-e603-404c-94da-036719cda430';
\timing off
\echo == U3 the role's statement timeout, outside our SET LOCAL
select setting from pg_settings where name = 'statement_timeout';
select rolname, rolconfig from pg_roles where rolname in ('spideryarn_app','postgres');
```

```
  current_user  | ro |              at               
----------------+----+-------------------------------
 spideryarn_app | on | 2026-10-07 05:55:30.991801+00
(1 row)

== U1 the lookup Postgres runs per deleted block identity (revision_blocks_identity_fk), for one identity of the largest candidate, three times
                                                                  QUERY PLAN                                                                   
-----------------------------------------------------------------------------------------------------------------------------------------------
 Index Scan using revision_blocks_revision_id_block_id_pk on revision_blocks x (actual time=889.076..889.078 rows=0 loops=1)
   Index Cond: (block_id = (InitPlan 1).col1)
   Filter: (article_id = '82b5bb6c-e603-404c-94da-036719cda430'::uuid)
   Buffers: shared hit=415 read=556
   InitPlan 1
     ->  Limit (actual time=0.099..0.101 rows=1 loops=1)
           Buffers: shared hit=5
           ->  Index Only Scan using block_identities_article_id_block_id_pk on block_identities b (actual time=0.062..0.090 rows=101 loops=1)
                 Index Cond: (article_id = '82b5bb6c-e603-404c-94da-036719cda430'::uuid)
                 Heap Fetches: 0
                 Buffers: shared hit=5
 Planning:
   Buffers: shared hit=6
 Planning Time: 0.227 ms
 Execution Time: 889.124 ms
(15 rows)

                                                                   QUERY PLAN                                                                   
------------------------------------------------------------------------------------------------------------------------------------------------
 Index Scan using revision_blocks_revision_id_block_id_pk on revision_blocks x (actual time=9.645..9.647 rows=0 loops=1)
   Index Cond: (block_id = (InitPlan 1).col1)
   Filter: (article_id = '82b5bb6c-e603-404c-94da-036719cda430'::uuid)
   Buffers: shared hit=979
   InitPlan 1
     ->  Limit (actual time=0.326..0.327 rows=1 loops=1)
           Buffers: shared hit=13
           ->  Index Only Scan using block_identities_article_id_block_id_pk on block_identities b (actual time=0.018..0.266 rows=1001 loops=1)
                 Index Cond: (article_id = '82b5bb6c-e603-404c-94da-036719cda430'::uuid)
                 Heap Fetches: 0
                 Buffers: shared hit=13
 Planning Time: 0.143 ms
 Execution Time: 9.685 ms
(13 rows)

                                                                   QUERY PLAN                                                                   
------------------------------------------------------------------------------------------------------------------------------------------------
 Index Scan using revision_blocks_revision_id_block_id_pk on revision_blocks x (actual time=10.191..10.193 rows=0 loops=1)
   Index Cond: (block_id = (InitPlan 1).col1)
   Filter: (article_id = '82b5bb6c-e603-404c-94da-036719cda430'::uuid)
   Buffers: shared hit=988
   InitPlan 1
     ->  Limit (actual time=0.562..0.563 rows=1 loops=1)
           Buffers: shared hit=22
           ->  Index Only Scan using block_identities_article_id_block_id_pk on block_identities b (actual time=0.017..0.457 rows=2001 loops=1)
                 Index Cond: (article_id = '82b5bb6c-e603-404c-94da-036719cda430'::uuid)
                 Heap Fetches: 0
                 Buffers: shared hit=22
 Planning Time: 0.135 ms
 Execution Time: 10.230 ms
(13 rows)

== U2 all 2,098 lookups of the largest candidate, as one timed statement (the same per-row probe, run as a correlated subquery)
 referenced | identities 
------------+------------
          0 |       2098
(1 row)

Time: 19871.738 ms (00:19.872)
== U3 the
unterminated quoted string
 setting 
---------
 30000
(1 row)

    rolname     |                    rolconfig                    
----------------+-------------------------------------------------
 postgres       | {"search_path=\"\\$user\", public, extensions"}
 spideryarn_app | {"search_path=\"$user\", public, extensions"}
(2 rows)
```
