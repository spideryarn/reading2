# Raise the database's size-cap CHECKs very high

Greg, 2026-10-07, after raising Feedback's limit took a migration:

> I don't see the point of including a character/size limit on fields. or if we're going to, make
> it very high

That is now the rule in [sql.md § Get the database to do the work](../project/sql.md) ("Except a
size limit"). This plan brings the existing schema into line with it: every CHECK that caps how long
a text column (or how big a `bytea`) may be is raised to a ceiling far above anything the app
allows, in one additive migration. The product limits stay in the code and do not move.

## The simpler option passed over

**Drop the length clauses.** Fewer parts, and Greg's first preference; no reader data is at stake
either way, so this is not about what the Overseer may apply. Passed over because a very high
ceiling still catches a runaway bug (a loop appending to itself, a whole article pasted into a name
field by a script) at no cost, Greg allowed "very high" as the alternative, and the brief from the
Overseer asked for it.

## The ceilings, and why each

| Kind | Ceiling | Why this number |
| --- | --- | --- |
| Prose a person or model writes | **1,000,000** characters | Fifty times the largest product limit (20,000); a novel's chapter, not a paragraph. |
| Names, labels, URLs, titles, short status text | **10,000** characters | At least five times every product limit on these columns (the URL's 2,048 is the closest; titles are clipped at 1,000), and a hundred times most of them. Nothing named or labelled here is ever ten thousand characters on purpose. |
| Text that is (part of) a btree key | **600** characters | A btree entry over ~2,704 bytes errors on insert anyway; 600 code points is at most 2,400 bytes of UTF-8, so the CHECK still names the problem rather than an index error doing it. |
| `feedback.screenshot` (`bytea`) | **52,428,800** bytes | 50 MiB, the largest object we accept anywhere (`uploads_claimed_bytes`). |

## Every size cap in the schema

What the app enforces is the guard after this change; the database ceiling only catches what got
past it.

| Constraint | Column | Old cap | App enforces | New ceiling |
| --- | --- | --- | --- | --- |
| `feedback_body_shape` | `feedback.body` | 20,000 | `MAX_FEEDBACK_BODY_CHARS` / `MAX_FEEDBACK_ANSWER_CHARS` 20,000 (dialog, route) | 1,000,000 |
| `feedback_question_answers_body_shape` | `feedback_question_answers.body` | 20,000 | `MAX_FEEDBACK_ANSWER_CHARS` 20,000 (reply box, route) | 1,000,000 |
| `quiz_attempts_answer_length` | `quiz_attempts.answer` | 1–4,000 | `MAX_QUIZ_ANSWER_CHARS` 4,000 (route) | 1–1,000,000 |
| `billing_vouchers_note_length` | `billing_vouchers.note` | 500 | admin route | 1,000,000 |
| `billing_vouchers_recipient_note_length` | `billing_vouchers.recipient_note` | 500 | admin route | 1,000,000 |
| `citation_finds_lookup_lengths` | `lookup_paper_does`, `lookup_support_quote`, `lookup_paper_does_quote` | 240 / 400 / 400 | src/citation-lookup.ts's parser (R-7), called from src/citation-find.ts | 1,000,000 each; `lookup_excerpt_words >= 0` kept |
| `feedback_url_shape` | `feedback.url` | 2,048 | `MAX_FEEDBACK_URL_CHARS` 2,048 (route) | 10,000; non-empty kept |
| `glossary_lookups_added_name_length` | `glossary_lookups.added_name` | 1–80 | `MAX_ASKED_TERM` 80 (src/asked-term.ts) | 1–10,000 |
| `billing_vouchers_recipient_name_length` | `billing_vouchers.recipient_name` | 80 | admin route | 10,000 |
| `realtime_sessions_close_reason_len` | `realtime_sessions.close_reason` | 64 | `realtimeCloseReason` 64 (src/live.ts) | 10,000 |
| `feedback_shipped_emails_detail_length` | `feedback_shipped_emails.detail` | 200 | scripts/feedback-shipped-emails.ts clips to 200 | 10,000 |
| `billing_voucher_emails_detail_length` | `billing_voucher_emails.detail` | 200 | `DETAIL_MAX` 200 (src/store/pg-voucher-emails.ts) | 10,000 |
| `bibliographic_records_shape` (title clause) | `bibliographic_records.title` | 1–1,000 | `plainRegistryText` clips to 1,000 | 1–10,000; the rest of the shape kept |
| `citation_index_lookups_shape` (title clause) | `citation_index_lookups.target_title` | 1–1,000 | src/citation-index.ts clips | 1–10,000; the rest kept |
| `citation_index_citers_title` | `citation_index_citers.title` | 1–1,000 | src/citation-index.ts clips | 1–10,000 |
| `article_tags_spelling` (length clause) | `article_tags.tag` (primary key) | 1–40 | `TAG_MAX_LENGTH` 40 (src/tags.ts) | 1–600; spelling rules kept |
| `bibliographic_records_id` (length clause) | `bibliographic_records.id` (primary key) | 300 | `MAX_ID_LENGTH` 300 (src/bibliographic.ts) | 600; format kept |
| `citation_index_lookups_work_id` (length clause) | `citation_index_lookups.work_id` (primary key) | 300 | the same parser | 600; format kept |
| `feedback_screenshot_size` | `feedback.screenshot` | 2,000,000 bytes | `MAX_FEEDBACK_SCREENSHOT_BYTES` 2,000,000 (route) | 52,428,800 bytes |

Every clause that checks shape — non-empty, trimmed, lowercase, a format regex, an allowed value,
the `case` shapes — is copied unchanged.

### Not touched, and why

- **Array counts** — `bibliographic_records_authors` (≤ 100 authors), `citation_index_lookups_shape`
  and `citation_index_citers_authors` (≤ 20), `citation_investigations_paper_read_values` (≤ 3
  passages). These count elements rather than measure a text or `jsonb` value's size, which is the
  brief; they are flagged for Greg in the debrief rather than changed here.
- **Format regexes with a repetition bound** — `checkpoints_key_format` (`{0,127}`),
  `billing_tiers_id_format`, the OpenAlex `W[0-9]{1,15}`, the DOI prefix `{4,9}`. Those are the
  spelling of an identifier, not a size limit.
- **Numeric ranges** — `billing_vouchers_articles_range`, years, `uploads_claimed_bytes`. Not text.

## How

1. Edit the CHECKs in src/db/schema.ts; `npm run db:generate` writes one migration of
   `drop constraint` / `add constraint` pairs. Read it: every change must be a loosening.
2. `npm run db:check`, `npm run db:chain`; migrate the local database if the shared ledger allows,
   otherwise prove it on a fresh one via `scripts/db-test-create.ts`.
3. Comments that call the database cap "what stops X" are corrected: the route is now the guard,
   and the database catches runaways.
4. Tests that pin the old cap (tests/feedback-store.test.ts) change to: the database takes one past
   the product limit, and refuses one past the ceiling — so a check that once went red still can.

**A loosened CHECK is safe for every existing row**, so `add constraint` cannot fail on old data.
It is not free: each `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock, the migrator runs every pending
migration in one transaction, so the locks taken by the first `drop` are held through every table's
validating scan until commit. Every table here is small (the largest is `feedback`, with its
screenshots), so that is a moment, not an outage. `NOT VALID` would only help if the `VALIDATE`
were committed separately, which this migrator does not do, and is not worth a second migration at
this size. (GPT Sol, plan review.)

## Code review, 2026-10-07

Compared all 19 migration drop/add pairs with `20261007175606_snapshot.json`:
only the upper bounds in the table above changed. Every remaining byte of each
CHECK expression is identical. The new snapshot contains no other schema changes,
and all 232 CHECK expressions rendered from `src/db/schema.ts` match it exactly.

The writer audit found no current reader, admin, MCP or script input path relying
on an old database size cap alone. Internal stores generally trust their callers;
direct calls can exceed product limits after this migration. Current callers
validate or clip the affected fields. No app limits were added.

Two test findings were fixed:

- `tests/billing-voucher-emails.test.ts` rejected 10,001 characters but did not
  prove the database accepted more than 80. It now inserts and reads back 81.
- `tests/store-tags-pg.test.ts` still expected a direct 41-character tag to fail.
  It now accepts one above `TAG_MAX_LENGTH` and checks that 601 fails with
  SQLSTATE `23514` and the named CHECK. The store's own 40-character limit stays.

The missed tag fixture was a test coupled to the old equality between product
and database limits, buried among malformed-spelling cases. Reviewing direct-write
boundary cases catches it; searching constraint names alone does not. A second
Sol review checked both test fixes and their cleanup and error wrappers.

Stale wording was corrected in the feedback and library reference docs, schema
and voucher comments, realtime test comments, and the feedback-body constant's
existing-row explanation. Historical plans and reusable docs were left alone.

Validation: `db:chain`, typechecking through `node --import tsx
scripts/typecheck.ts`, 93 focused unit/doc tests, and `git diff --check` passed.
Scoped lint reported only existing complexity advice. Full and targeted database
test runs, and `db:check`, were blocked by sandbox `EPERM` on local Postgres/Docker
access. The refusal assertions require the named constraint and fail if a write
is accepted; a live run with the ceilings removed could not be demonstrated here.

**Run outside the sandbox afterwards (the main session).** The shared local database's ledger
refused `npm run db:migrate` (a stale row, `1791385037291`, from another session, and four pending
migrations), so the migration was proven on fresh private databases instead: the private-lane
suites create one per run and apply every migration, this one included. On those,
tests/feedback-store.test.ts, tests/store-tags-pg.test.ts, tests/billing-voucher-emails.test.ts,
tests/realtime-usage.test.ts and tests/bibliographic-pg.test.ts all pass (the reply test that still
expected the old 20,000 refusal went red first, and was rewritten). `db:chain` passes.
