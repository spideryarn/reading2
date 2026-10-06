# Seventh sweep, depth: database schema and database structures (GPT Sol, read-only, 2026-10-06)

## What I read

The main finding is a reachable conflict between automatic Referee retention and the foreign key protecting reader notes. Adding a criterion can roll back because trimming tries to delete an older criterion that has a note attached.

I inspected checkout `bf78e90c7f718fb042d51f9aa394c72c335514a5`. Its local `origin/dev` ref was `2f8edaddc3e25051425cadbd71996a4268516c4a`; I did not fetch. No tracked files changed.

**Read in full:**

- Both brief files.
- `src/db/schema.ts`: all 7,220 lines.
- The last 40 SQL migrations, from `20261001211225_bulk_import_minimal.sql` through `20261006144348_articles_asked_url.sql`. This checkout contains **153 SQL migration files**, rather than the brief’s 154.
- Earlier migrations needed to establish contracts: `0001_auth_fks_and_guards.sql`, `0015_uploads_auth_fk.sql`, `0023_ai_calls_cost_provenance.sql`, and `0042_referee_criteria.sql`.
- Store files: `pg-bibliographic.ts`, `pg-citation-index.ts`, `pg-source-guesses.ts`, `source-guess-row.ts`, `pg-quiz-attempts.ts`, `pg-rate-limit.ts`, `pg-reader.ts`, `pg-reading-time.ts`, `pg-citation-finds.ts`, `pg-citation-investigations.ts`, `pg-lookups.ts`, `checkpoints-pg.ts`, `pg-uploads.ts`, `pg-referee-criteria.ts`, `find-article.ts`, `pg-glossary-hidden.ts`, `pg-tags.ts`, `pg-tiers.ts`, `pg-share-link.ts`, `pg-visibility.ts`, `pg-high-power.ts`, `ai-calls-pg.ts`, and `public-library.ts`.
- `src/db/schema-drift.ts` and `tests/action-tables-have-created-at.test.ts`.
- The fifth sweep’s data-and-pipeline investigation.
- The postmortems on nullable CHECK states, stale boundary inventories, and production-script boundaries.

**Read in part:**

- `docs/project/database.md`, especially migration creation/application, ledger reconciliation, snapshot forks, ownership, publication, timestamps, and checkpoints; `sql.md`; `block-ids.md`; `security-map.md`; and the project vision.
- The sweep method and the required fifth/sixth umbrella sections.
- `pg.ts`, `pg-jobs.ts`, `pg-revisions.ts`, `artifacts-pg.ts`, `pg-comments.ts`, `pg-chat.ts`, `pg-referee-claims.ts`, `pg-shelf-terms.ts`, `pg-billing.ts`, voucher stores, feedback stores, link caches, realtime sessions, and export coverage/readers.
- Migration scripts, current Referee routes, source-guess callers, and relevant database tests.

The selection followed churn and invariant complexity. The prescribed fix-history search showed 24 touches to `pg.ts` and 20 to `schema.ts`; these are file touches in matching commits, not independent bug counts.

An offline import of the schema counted **49 tables, 662 columns, and 38 JSONB columns**. A lexical reference census covered **7,285 text files** under `src/`, `scripts/`, `tools/`, `evals/`, and `tests/`. That census nominated absence candidates; it did not distinguish reads from writes.

An independent read-only root-cause agent corroborated DB1, including its introducing history and the concurrency requirement for a fix.

## What the method could not see

There was no Postgres, Storage, network, production catalog, or production data access. Consequently:

- DB1 is proved from current code and declared/applied migration intent, **not reproduced against Postgres here**.
- I cannot certify that either database has every declared constraint, index, grant, or trigger.
- Index usefulness remains a hypothesis until the supplied query plans and cardinality counts are run.
- I did not read the entire store directory file by file. The schema and recent migrations received that treatment; larger stores received focused reads of the relevant contracts and queries.
- References do not prove use: `select()`, export mapping, defaults, fixtures, and shared property names complicate a column census. An absent explicit application writer does not make a defaulted timestamp unwritten.

Two permitted offline checks passed:

```text
npx vitest run tests/action-tables-have-created-at.test.ts --project unit
12 tests passed

npx vitest run tests/migration-journal.test.ts --project unit
25 tests passed
```

No database tests ran. The timestamp check passing does not establish that its permitted timestamp still means “when it happened”; DB4 demonstrates that limitation.

## Findings

Ranked by ease × value, with Tier 0 first. **C** means proved from code; **H** means a hypothesis requiring measurement. No finding is labelled reproduced.

### DB1 — Automatic criterion trimming tries to delete a parent of reader notes

**Anchors:** `src/store/pg-referee-criteria.ts`, `begin`, “Trim to MAX_CRITERIA”; `src/db/schema.ts`, `comments_criterion_fk`; `drizzle/0042_referee_criteria.sql`, “no action”.

**C · Tier 0 · Ease 4 · Value 5 · Score 20 · Risk: medium, chiefly concurrent placement writes.**

**Failing input:** an article has twenty completed criteria, ordered by creation time. A reader note references the oldest criterion. The reader adds criterion 21.

`begin` inserts the new criterion inside a transaction, selects older criteria beyond `.offset(MAX_CRITERIA - 1)`, skips only `pending` rows, and deletes the other selected IDs. The oldest completed criterion qualifies. Its note makes `comments_criterion_fk` reject that DELETE. The transaction rolls back the new criterion too.

The current POST route reaches `begin` before opening SSE or starting the paid call. This is a failed reader request, rather than a lost paid answer.

The constraint’s protection is intentional: the migration explicitly rejects cascading away a referee’s own sentences. `tests/db-referee-criteria.test.ts`, “refuses to delete a criterion the referee has written against”, tests that protection. The retention test in `tests/store-parity-referee.test.ts` protects pending criteria but does not combine trimming with a linked note.

**Root-cause class:** copying retention rules between siblings without carrying the second sibling’s dependent-record lifetime. Search runs can be discarded independently; criteria are durable parents of reader notes.

`b9f1d2a53` introduced the store trim. The criterion FK already existed under `265356b6c`. `80ace2976` subsequently protected pending criteria, but left this separate failure.

**Fix, as a separate claim:** retain criteria referenced by comments alongside the existing pending-row exception. Keep the FK and the notes. Reuse the existing article transaction and candidate selection; no generic retention abstraction or schema migration is needed.

For concurrency, lock candidate criterion rows `FOR UPDATE`, then check references in a **subsequent statement under READ COMMITTED** before deleting still-terminal, unreferenced candidates. Comment placement can run without the article mutex; the candidate lock must coordinate with its FK key-share lock. A read followed by an unprotected delete is insufficient.

This is a code correction with no historical row rewrite. Its visible consequence—older marked criteria can keep the list above twenty—is recorded under “For the owner”.

**Orchestrator regression:** extend `tests/store-parity-referee.test.ts` beside “never trims a criterion that is still being answered”. Seed twenty terminal criteria, attach a note to the oldest, begin another, and assert that the new criterion, old criterion, note, and placement survive. Also overlap `patchMark` with trimming.

```bash
npx vitest run tests/store-parity-referee.test.ts --project private-postgres
```

**Local plan:**

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.id, r.status
FROM spideryarn.referee_criteria r
WHERE r.article_id = (
  SELECT article_id
  FROM spideryarn.referee_criteria
  GROUP BY article_id
  ORDER BY count(*) DESC, article_id
  LIMIT 1
)
ORDER BY r.created_at DESC, r.id DESC
OFFSET 19;
```

**Production, counts only:**

```sql
WITH ranked AS (
  SELECT article_id, id, status,
         row_number() OVER (
           PARTITION BY article_id
           ORDER BY created_at DESC, id DESC
         ) AS position
  FROM spideryarn.referee_criteria
)
SELECT count(*) AS marked_terminal_rows_at_trim_boundary,
       count(DISTINCT r.article_id) AS affected_articles
FROM ranked r
WHERE r.position >= 20
  AND r.status <> 'pending'
  AND EXISTS (
    SELECT 1
    FROM spideryarn.comments c
    WHERE c.article_id = r.article_id
      AND c.criterion_id = r.id
  );
```

Zero means no current stored witness; it does not refute the reachable failure.

### DB2 — Schema comments describe contracts that current code has replaced

**Anchor:** `src/db/schema.ts`, the identifiers below.

**C · Tier 1 · Ease 5 · Value 3 · Score 15 · Risk: low.**

| Anchor | Stale claim | Current evidence |
|---|---|---|
| `articleRevisions.rawSourceSha256` | “Nothing writes them yet” | `artifacts-pg.ts`, `writeRaw`, writes both source-reference columns. |
| `articleRevisions.labels` | Labels is a Structure output and “deliberately NOT a step name” | `pipeline.ts` has a separate `labels` step; the step CHECK includes it. |
| `articleRevisions.quiz` | “No attempts table beside it” | `quiz_attempts`, its migration, and `pg-quiz-attempts.ts` now persist answers and replies. |
| `queueState` | The singleton guarantees concurrency one | `pgJobStore.claim` counts running jobs under the singleton and applies `maxRunning`; compatible jobs may overlap. |
| `revisionStepRuns` | `stepIsDone` is an `access()` existence check | It checks interruption, artefact presence, and stamps or the step-specific currency check. |
| `aiCalls` header | “No `attempt` column” | The schema, migration, and insert mapping contain `attempt`. |
| `refereeClaims.claimsOmitted` | The route writes only claims and model | `runRefereeClaims` includes `claimsOmitted` in its completed patch. |
| `feedback.screenshot` | The cap is 400,000 bytes | `MAX_FEEDBACK_SCREENSHOT_BYTES` and the CHECK are 2,000,000. |

**Fix, separately:** correct these comments beside their owning declarations. Preserve the useful reasons and explicit historical descriptions; remove present-tense assertions that contradict the implementation. Reuse links to the existing owners rather than copying their mechanics again.

This is mechanically safe and needs no migration. In particular, correcting the raw-source writer claim should **not** claim that the publication gate enforces the fetch/source-reference implication: the gate still does not check that implication.

### DB3 — The criterion shape CHECK is weaker than its documented all-or-none rule

**Anchors:** `src/db/schema.ts`, `referee_criteria_diverging_shape`; `pg-referee-criteria.ts`, `toCriterion`; `src/referee-criteria.ts`, `configToRow` / `configFromRow`.

**C · Tier 1 · Ease 5 · Value 3 · Score 15 · Risk: low if the invalid-row count is zero.**

The CHECK is:

```sql
(kind = 'diverging') =
(pole_against IS NOT NULL AND pole_favour IS NOT NULL AND scale IS NOT NULL)
```

It requires all three fields for a diverging criterion. For a non-diverging criterion, however, it permits **one or two** fields to be populated: both sides then evaluate false.

The store comment says this constraint makes the columns all-or-none. `configToRow` writes all three null for the other kinds, and `configFromRow` ignores any extraneous fields on those kinds. Thus the database can accept a shape the writer excludes and the reader silently discards.

This is a protection gap, **not a demonstrated live writer defect**.

**Fix, separately:** strengthen the existing CHECK to express the discriminator directly:

```sql
num_nonnulls(pole_against, pole_favour, scale) =
CASE WHEN kind = 'diverging' THEN 3 ELSE 0 END
```

Reuse the existing named constraint and direct forbidden-row tests. Do not change the type or normalize the criterion into another table.

**Classification:** additive-safe enforcement if today’s rows satisfy it. If they do not, the constraint change must stop; rewriting their fields needs the owner.

**Production count:**

```sql
SELECT count(*) AS invalid_criterion_shapes
FROM spideryarn.referee_criteria
WHERE num_nonnulls(pole_against, pole_favour, scale) <>
      CASE WHEN kind = 'diverging' THEN 3 ELSE 0 END;
```

**Local plan:**

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM spideryarn.referee_criteria
WHERE num_nonnulls(pole_against, pole_favour, scale) <>
      CASE WHEN kind = 'diverging' THEN 3 ELSE 0 END;
```

For this small, bounded per-article table, a transactionally replaced CHECK is sufficient. If measurements justify staged validation, add the stronger CHECK under a temporary name with `NOT VALID`, validate it, then replace the old named constraint. Add direct cases for non-diverging rows with one and two populated fields; existing happy-path writer tests cannot expose this gap.

### DB4 — Source-guess release erases its only genuine start time

**Anchors:** `src/store/pg-source-guesses.ts`, `release`, `claimedAt: sql\`to_timestamp(0)\``; `src/source-guess-run.ts`, failure and allowance-refusal branches; `tests/action-tables-have-created-at.test.ts`, the `upload_source_guesses` allowance.

**C · Tier 1 · Ease 4 · Value 3 · Score 12 · Risk: low for the minimal additive fix.**

The timestamp guard accepts `claimed_at` as this table’s creation-time substitute. Release overwrites it with the Unix epoch to make the row immediately reclaimable.

This is reachable both after a provider failure and when the allowance refuses work and refunds the attempt. Until another claim occurs, the row no longer contains the real start time. The structural guard passes because it checks the column’s existence and SQL type.

**Fix, separately:** add a nullable, defaulted `created_at`, using the existing migration pattern that preserves unknown historical times:

```sql
ALTER TABLE spideryarn.upload_source_guesses
  ADD COLUMN created_at timestamptz;

ALTER TABLE spideryarn.upload_source_guesses
  ALTER COLUMN created_at SET DEFAULT now();
```

Then remove this table’s stand-in exemption from the existing timestamp test. That preserves the start of a newly created lookup without changing retry behavior. Do not backfill from `claimed_at`: it is mutable and may be synthetic.

**Classification:** additive-safe. Separating retry eligibility from `claimed_at` would be a wider lifecycle change; the minimal fix does not require it.

**Production count:**

```sql
SELECT count(*) AS released_rows_with_synthetic_start
FROM spideryarn.upload_source_guesses
WHERE claimed_at = to_timestamp(0);
```

**Local plan:**

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM spideryarn.upload_source_guesses
WHERE claimed_at = to_timestamp(0);
```

### DB5 — Owner-wide article reads have no owner-leading index

**Anchors:** `src/store/pg.ts`, `listArticlesQuery`; `find-article.ts`, `articleUrls`; `pg-tags.ts`, `readerTags`; `pg-shelf-terms.ts`, shelf queries.

**C for the declarations/query mismatch; H for material performance cost · Tier 1 · Ease 4 · Value 3 · Score 12 · Risk: low data risk; measure DDL locking cost.**

The article indexes lead on the primary key, slug, short ID, share token, or public-listing order. None leads on `owner_id`. These request paths enumerate one owner’s articles.

The original custom migration deliberately declined `(owner_id, created_at)`, correctly observing that shelf order uses revision fetch time. That does not settle the usefulness of **`owner_id` alone** for filtering and URL adoption.

**Fix, separately:** consider only an owner index, after measurement:

```sql
CREATE INDEX articles_owner_idx
ON spideryarn.articles (owner_id);
```

It would narrow candidates; it would not eliminate the shelf’s joined-date sort or JavaScript URL matching. A stored article URL key is a separate, already documented scaling option.

**Classification:** additive-safe if justified. I am not proposing an unconditional index addition.

Choose an actual owner locally, then inspect both request shapes:

```sql
-- Local psql only: retains the UUID as a variable.
SELECT owner_id AS sweep_owner
FROM spideryarn.articles
GROUP BY owner_id
ORDER BY count(*) DESC, owner_id
LIMIT 1
\gset

EXPLAIN (ANALYZE, BUFFERS)
SELECT a.slug, r.final_url, r.requested_url, a.asked_url
FROM spideryarn.articles a
LEFT JOIN spideryarn.article_revisions r
  ON r.id = a.current_revision_id
WHERE a.owner_id = :'sweep_owner'::uuid;

EXPLAIN (ANALYZE, BUFFERS)
SELECT a.id, a.slug, r.fetched_at
FROM spideryarn.articles a
JOIN spideryarn.article_revisions r
  ON r.id = a.current_revision_id
WHERE a.owner_id = :'sweep_owner'::uuid
  AND a.archived_at IS NULL
  AND a.current_revision_id IS NOT NULL
  AND left(a.slug, 1) <> '_'
ORDER BY coalesce(r.fetched_at, a.created_at) DESC;
```

These are the filter/join/order cores, not a claim to reproduce the shelf’s full projection. Compare before and after the candidate index on the local database.

**Production, counts only:**

```sql
SELECT count(*) AS articles
FROM spideryarn.articles;

SELECT count(*) AS largest_owner_shelf
FROM spideryarn.articles
WHERE owner_id = (
  SELECT owner_id
  FROM spideryarn.articles
  GROUP BY owner_id
  ORDER BY count(*) DESC, owner_id
  LIMIT 1
);
```

### DB6 — The queue’s stored running-job pointer has no reader or writer

**Anchors:** `src/db/schema.ts`, `queueState.runningJobId`; `pg-jobs.ts`, `claim`; `article-rows.ts`, `queue_state` coverage explanations.

**C · Tier 1 · Ease 3 · Value 1 · Score 3 · Risk: low runtime risk, but destructive schema change.**

The required absence search was:

```bash
rg -n '\b(runningJobId|running_job_id)\b' \
  src scripts tools evals tests
```

It returned **one match**, the schema declaration. There were **zero matches outside that declaration**, including raw SQL strings in the searched directories.

The queue uses the row as a mutex and counts `jobs.status = 'running'`. It does not maintain a selected running job. The export-coverage explanation still describes the singleton as saying which job is running.

`updated_at` also has no current queue-update path; its default dates singleton creation. That is not evidence that claims update it.

**Fix, separately:** correct the misleading descriptions now. Removing `running_job_id` and its FK is optional owner work, not necessary for queue correctness. Keep the singleton, seed, CHECK, deletion guard, and explicit missing-row refusal.

**Classification:** dropping the pointer **needs the owner**. It removes a historical nullable job reference and an otherwise unused relationship in export dependency discovery.

**Production count:**

```sql
SELECT count(*) AS historical_running_job_pointers
FROM spideryarn.queue_state
WHERE running_job_id IS NOT NULL;
```

**Local plan:**

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM spideryarn.queue_state
WHERE running_job_id IS NOT NULL;
```

**Table audit**

`A` means ownership inherited through `article_id`; `R` through a revision; `O` means an explicit `owner_id`; `G` means global state/cache. “—” in R/W means **no unused column proved**, not that every caller was audited. Defaults count as writers. JSON entries listed as whole outputs satisfy the usual exception unless a caveat is stated.

| Table | Purpose; owner/key | Unread/unwritten columns | JSONB decision | Keys, duplication, timestamps, or other caveat |
|---|---|---|---|---|
| `articles` | Article and shelf state; O, UUID PK | — | None | Unique slug/short ID/share token; composite current-revision FK is custom SQL. Published status and visibility/date agreement rely on writers. Created/action times present. DB5. |
| `article_revisions` | Revision contents; A, UUID PK | — | `authors`; `tree`, `arc`, `tweets`, `glossary`, `ideas`, `quotes`, `timeline`, `quiz`, `faq`, `relations`, `crossrefs`, `simple_summary`, `skim`, `sketch`, `illustrated`, `debate`, `citations`, `assets`, `labels`: versioned whole outputs | Unique `(article_id,id)` supports composite references. Base FK checks existence, not same-article lineage. Scalars/stamps intentionally repeat derived output facts. Glossary IDs now have SQL consumers. Created/rated times present. |
| `article_tags` | Reader tags; A, PK article/tag | — | None | Normalized spelling CHECK; article lock enforces count cap. Created time present. No second owner. |
| `article_visibility_changes` | Visibility audit; actor snapshot, nullable A | — | None | Article SET NULL preserves history; slug snapshot intentionally duplicates identity. Actor UUID has no Auth FK. `at` dates transition. Rights implication is writer policy. |
| `article_share_link_events` | Private-link audit; actor snapshot, nullable A | — | None | Article SET NULL; event/rights CHECK; no token stored. Slug snapshot retained; created time present. Actor has no Auth FK. |
| `block_identities` | Stable block identities; A, PK article/block | — | None | Format CHECK; identity outlives revision membership. `first_seen_at` records minting. |
| `revision_blocks` | Text and structure per revision; R/A, PK revision/block | — | None | Composite revision and identity FKs; unique revision/ordinal; generated FTS intentionally derives text. Parent revision dates rows. Four roles are reserved, currently unproduced. |
| `revision_phrase_runs` | Deterministic phrase extraction; R/A, PK revision/version | — | `candidates`: whole extraction | Composite revision FK; words/version/array CHECKs. Repeated article key enforced. `computed_at`. |
| `revision_step_runs` | Step completion/currency; R, PK revision/step | — | None | Closed current step vocabulary; stamps can repeat artefact stamps intentionally. Started/finished times; stale header in DB2. |
| `raw_sources` | Verified immutable source manifest; G, PK hash/kind | — | None | Hash/kind CHECKs; composite reference target. Manifest repeats facts about Storage bytes, verified rather than inferred. Verified/created times. |
| `comments` | Reader notes and optional answers; A plus O, PK article/id | — | `citations`: whole answer output | Identity and criterion FKs protect anchors/placements; thread ID is deliberately advisory. O repeats article ownership, agreement enforced by scoped writers. Created/edit/colour/finish times. DB1. |
| `referee_criteria` | Saved criteria/results; A plus O, PK article/id | — | `results`: whole call output | Config columns are appropriate. Shape gap DB3; note dependency DB1. Created/attempt/colour/finish times. |
| `referee_claims` | Latest claims run; A plus O, article PK | — | `claims`: whole output | Replacing a run is deliberate; start time restamped, attempt fenced, finish time recorded. O repeats article ownership. |
| `search_runs` | Saved search answers; A plus O, PK article/id | — | `hits`: whole output | Attempt pair and vocabulary CHECKs; pending rows protected from trim. Created/attempt/colour/finish times. |
| `chat_threads` | Conversations and origins; A plus O, PK article/id | — | None | Partial uniqueness for Learn/Tutorial/Explore; block identity FKs. `summary` origin reserved. Created/updated/renamed times. |
| `chat_messages` | Ordered turns; ownership through thread, PK article/thread/id | —; stance is historical | `citations`, `tools`, `passages`: whole turn outputs | Composite thread FK and unique ordinal enforce reads/upserts. Legacy stance retained/read; normal product flow no longer produces it. Created/attempt/edit/finish/hint times. |
| `quiz_attempts` | Reader answers and marks; A, UUID PK | — | None | Batch/question are artefact identities, not relational parents; question snapshot survives regeneration. Created time; latest-answer index. |
| `glossary_lookups` | Explanations and reader-added terms; A plus O, PK article/entry | — | `citations`: whole output | Entry IDs live outside the artefact too; no relational entry FK. Added name is correctly a column. Answer and nullable historical creation times. |
| `glossary_hidden_entries` | Hidden terms; A, PK article/entry | — | None | ID format CHECK; existence checked against current glossary or added term by writer. Nullable historical creation time. |
| `citation_finds` | Found paper URLs and older lookup results; A plus O, PK article/entry | —; legacy results remain readable | None | Closed lookup-state/support CHECKs; paired hashes and assessment fields. Current save mapping can write/clear lookup columns; retired route does not imply an unused table. Found/created times. |
| `citation_investigations` | Stored investigation; A plus O, PK article/entry | — | `sources`, `paper_passages`: whole outputs | Filterable state/counts/hashes/influence are columns. Shape CHECKs distinguish incomplete evidence. Assessment/creation times. |
| `reading_time` | Cumulative passage totals; A, PK article/block | — | None | Identity FK and nonnegative seconds; no timestamp deliberately, because privacy promises totals rather than history. |
| `jobs` | Durable work and quota provenance; O, text PK | — | `steps`, `reset`: ordered control payloads | SQL inspects these JSON fields: not purely opaque. Current code requires valid step shapes; no complete element-shape CHECK. Active-work/name/source indexes differ intentionally. Created/start/finish/cancel/dismiss times. |
| `queue_state` | Global claim mutex; singleton PK | `running_job_id`: no read/write | None | Seed/delete trigger plus CHECK; absence explicitly rejected. `updated_at` is not maintained by claims. DB6. |
| `uploads` | Upload grant/verification lifecycle; O, UUID PK | — | None | Claimed versus verified hash/bytes are different facts. Evidence CHECKs; minted/grant-expiry times. Deleting a job-referenced upload conflicts with the filename pair, but current product paths do not call that cleanup. |
| `upload_source_guesses` | Latest upload-source search; A, article PK | — | None | Claim/result shapes and bounded attempts enforced. Claimed time doubles as eligibility clock and is overwritten with epoch. DB4. |
| `checkpoints` | Retry-preserved paid work; A, PK article/namespace/key | — | `value`: opaque stage cache | Namespace/key CHECKs; independent writes survive failed artefact transactions. Created/last-used times. Labels namespace intentionally retains Structure ancestry. |
| `reader_profiles` | Reader preferences; O PK | — | None | Nullable activation times distinguish choices from defaults. Created/updated times; independent upserts preserve other settings. |
| `reader_arrivals` | First arrival/notice deduplication; O PK | — | None | `first_seen_at`; unique owner makes insert-returning deduplication real. |
| `shelf_topic_scores` | Latest scores and claim; O/scope PK | —; `claim_hash` both read/written in one store | `scores`: whole model output | Result and claim all-or-none CHECKs. Input versus claim hash describe different generations. Computed time; claim/retry deadlines. |
| `shelf_topic_sets` | Topic filing and claim; O PK | — | `topics`, `members`: whole filing result/map | SQL merges member maps but does not filter individual members. Slugs are cache membership, not durable article ownership. Result/count/claim CHECKs; created/rethought/filed times. |
| `realtime_sessions` | Issued voice sessions; O, UUID PK | — | None | Article SET NULL preserves session history. Voice high-water mark paired transactionally with ledger insert. Issue/connect/close/create times. |
| `ai_calls` | Financial call ledger; O, UUID PK | — | None | Article SET NULL; event uniqueness and session FK. Cost-source CHECKs also live in custom SQL. Historical slug/step/model distinctions intentional; start/finish times. |
| `feedback` | Reader reports; O/id PK | — | `diagnostics`: opaque versioned payload | Email/URL/build are snapshots. Consent/version, mirror, text, and screenshot CHECKs. Created/mirror/ignored times. |
| `feedback_shipped_emails` | Report-delivery state; O/report PK | — | None | Composite report FK; status/attempt CHECKs. Created/updated times. |
| `billing_tiers` | Product catalog; global tier PK | — | None | Unique lookup/Stripe price; catalog CHECKs. Created/updated times. |
| `billing_tier_prices` | Currency prices; tier/currency PK | — | None | Tier FK, positive amount/currency CHECK. Catalog row exempt from action timestamps. |
| `billing_accounts` | Entitlement and billing mutex; O PK | — | None | Unique Stripe identifiers; subscription/period/quota shape CHECKs. External price identifiers deliberately not ordinary tier FKs. Created/updated/sync times. |
| `billing_vouchers` | Gifts; UUID PK, creator and claimant | — | None | Normalized email; claimant FK and paired claim/time. Claim/revoke/create/update times. |
| `billing_voucher_emails` | Frozen deliveries and retries; voucher parent, UUID PK | — | None | Unique claimed notice; recipient/body snapshots intentionally duplicate send-time facts. Sending lease and created/updated times. |
| `ingest_events` | Quota reservations/charges; O, UUID PK | — | None | Owner/id uniqueness supports job provenance FK; supersession trigger enforces cross-row policy. Visibility snapshot exists only after article unlink. Reserved/settled times. |
| `link_previews` | Shared fetch cache; G, exact-target PK | — | None | Outcome-shape CHECKs. Alias target is not an FK because cache expiration is independent. Fetch/expiry times; no reader-profile data. |
| `link_summaries` | Personalized summary cache; O/A/target/block PK | — | None | Pending/ready shape; legacy empty block sentinel is deliberate. Fingerprints repeat prompt inputs for invalidation. Created/finished/expiry times. |
| `rate_limit_events` | Allowance fills and leases; O, UUID PK | — | None | `citation-find` retained for historical rows; no current bucket spender. Started time; lease deadline. |
| `bibliographic_records` | Registry cache/claim; G, normalized work PK | — | None; authors use paired SQL arrays | Found/not-found/claim shape; nullable-state CHECK corrected already. Citation count and count-read time are distinct facts. Fetch/lease times. |
| `bibliographic_services` | Shared pacing/cooldown; G, service PK | — | None | Service vocabulary CHECK; control deadlines, not reader actions. |
| `bibliographic_service_slots` | Shared service concurrency; G, service/slot PK | — | None | Service FK; positive slot CHECK. Expected upper slot counts are code/seed policy, not DB constraints. Lease deadline. |
| `citation_index_lookups` | Citation-index cache head; G, work PK | — | None | State/result shape CHECKs; fetched time. |
| `citation_index_citers` | Ordered fetched citers; parent lookup, work/position PK | — | None; authors are SQL array | Parent FK and field CHECKs; parent fetch dates rows. Producer deduplicates work IDs; DB does not enforce that additional uniqueness. |

**Index/query audit**

These are the request and queue queries whose predicates I traced. “Serves” describes an available index structure, not an observed planner choice.

| Store function/query | Index serving the predicate/order | Limit or gap |
|---|---|---|
| `articleIdForOwned`, `ownedArticleIdentity`, current-revision reads, sharing/visibility reads | Unique article slug; revision PK | Owner condition is a residual check on a unique lookup. |
| `slugForShortId` | Unique short ID | Appropriate; no owner composite needed for this lookup. |
| `listArticlesQuery`, `articleUrls`, `readerTags`, shelf revision/topic queries | Revision/tag keys after join | Article owner filtering has no owner-leading index: DB5. Joined-date sort remains. |
| `publicLibraryQuery` | `articles_public_listing` | Predicate and `public_at DESC NULLS LAST, slug` order match. |
| `blocksQuery`, block hashes, first heading | Unique revision/ordinal | Filters heading kind/level after narrowing the revision. |
| `commentCounts`, `listFor` | Comments PK’s article prefix | Creation-order list still sorts; no measured reason to add another index. |
| `criteriaFor`, criterion trim | Criteria PK’s article prefix | Sorts a small history; FK/reference lifetime is DB1, not an index fix. |
| Search lists and sweeps | Search PK’s article prefix | Creation-order sort; bounded retained history plus pending exceptions. |
| `threadsFor` messages | Unique article/thread/ordinal | Thread creation-order list needs a separate small sort. |
| Glossary/citation lookup and investigation reads | Article/entry PKs | Direct upsert targets have matching unique keys. |
| `latestQuizAttempts` | `quiz_attempts_latest` | Supports article/batch/question/date; final ID tie-break may require a small sort. |
| `pgJobStore.list`, `trim` | Custom `jobs_owner_created_idx` | Final ID ties can sort. |
| `blockedByAnother` | Job PK for mine; partial `jobs_slug_order` for others | Compatibility is decided after reading active candidates. |
| `claim` global running count; expired-job sweep | Partial `jobs_lease_idx` covers running subset | Count does not require lease order. Singleton serialization remains necessary. |
| Enqueue conflicts | `jobs_active_work`, `jobs_reserved_slug`, `jobs_active_source` | Different predicates/uniqueness policies; not duplicates. Conflict-classification OR may use multiple paths. |
| Job/draft/quota lookups | Job PK; unique draft and ingest-event indexes | Uniqueness is correctness work, not removable duplication. |
| `pgUploadStore.read/claim/settle`; duplicate-byte lookup | Upload PK; owner/claimed-hash index | Global `list()` sorts by mint time; not established as a hot request. |
| Source-guess read/claim/finish/release | Article PK | No index gap. |
| Checkpoint read/write; sweep | Composite PK; last-used index | Separate purposes. |
| Rate allowance owner/global counts | Owner/bucket/start and bucket/start indexes | Neither is prefix-redundant with the other. |
| Link preview/summary reads and sweeps | Exact/composite PK; expiry indexes | Expiry indexes serve cleanup, not point lookup. |
| Profile/arrival/topic-state reads | Owner or owner/scope PK | Whole-result reads appropriate at this cardinality. |
| `usageSql`, reservation lookups | Owner/reserved ingest index; ingest PK | Owner prefix serves filtering; not all FILTER aggregates become index ranges. |
| `claimVouchersFor`, `giftsFor` | Unclaimed-email partial index; claimed-by index | Revoked filtering/order may be residual. |
| `latestVoucherEmails` | Voucher/kind/created index | Created descending and ID tie-break can require sorting. |
| Feedback submit/list | Owner/created index; owner/id PK | Fits cap and owner history reads. |
| Realtime session lookup | Session PK | Owner condition is a residual identity check. |
| `pgCostStore.forJob`; owner/scope spending queries | Job, article, owner/start, scope/start indexes | Global date-only CLI ledger read lacks a date-leading index; not established as hot. |
| Bibliographic cache and service slots | Work PK; service/slot PK | Slot selection uses service prefix and slot order. |
| Citation-index read | Lookup PK and citer work/position PK | Parent lock prevents mixed generations. |

I found no index removal justified by these reads. In particular, the composite uniqueness on revisions and ingest events is needed as an FK target; the rate-limit indexes have different leading keys; and the active job indexes enforce different policies. Lack of a textual index-name reference is not evidence that an index is unused.

## Siblings compared

| Thing | Siblings | Difference and judgment |
|---|---|---|
| Automatic retention | Search / Criteria | Both protect pending rows after sweep five. Criteria additionally parents reader notes; its copied trim misses that dependency. DB1. |
| Discriminator-shaped columns | Reading difficulty / topic results / criterion config | The first two use explicit all-or-none counts; Criteria’s Boolean equivalence allows partial fields on other kinds. DB3. |
| Action timestamps | Recent nullable `created_at` additions / source guesses | The former preserve unknown history; source guesses treat a mutable eligibility clock as creation time. DB4. |
| Sharing audit | Visibility / private link | Both append transactionally and retain slug/actor snapshots. Link rights are constrained; visibility rights are writer policy. No current violation established. |
| Cache claims | Bibliographic / topic / link / source-guess stores | Different protocols have documented stakes and keys. Epoch release is a timestamp exception, not evidence for a generic cache abstraction. |
| Stable references | Blocks / glossary and citation entries | Blocks have durable identities and relational FKs. Entry IDs live in versioned artefacts and persisted side tables; current SQL now queries glossary IDs. Wider normalization needs a separate case. |

## For the owner

**DB1:** retaining marked criteria can leave more than twenty visible criteria. That is the consequence of the existing promise that notes protect their criterion. The alternative would require an explicit reader operation to detach marks or remove notes; automatic trimming must not choose it.

**DB6:** dropping `queue_state.running_job_id` removes a stored historical pointer and its FK. It buys little runtime value. Correct the descriptions first; leave the column unless the schema deletion is wanted.

**Historical vocabulary:** I found these deliberate exceptions to current production:

- `rate_limit_events.bucket = 'citation-find'`: retired spender, historical rows retained; its old per-bucket cleanup no longer reaches them.
- `chat_messages.stance`: current product turns no longer produce the old stance choices; readers, exports, and fixtures retain them.
- `revision_blocks.role`: `reference`, `acknowledgment`, `credit`, and `appendix` are reserved; `src/blocks.ts` explicitly says only `footnote` is assigned.
- `chat_threads.origin_mode = 'summary'`: reserved rather than a current producer.

These are not blanket deletion proposals. Removing stored values or narrowing a CHECK over them needs counts and, if rows exist, an owner-approved rewrite or deletion:

```sql
SELECT count(*) FROM spideryarn.rate_limit_events
WHERE bucket = 'citation-find';

SELECT count(*) FROM spideryarn.chat_messages
WHERE stance IS NOT NULL;

SELECT count(*) FROM spideryarn.revision_blocks
WHERE role IN ('reference','acknowledgment','credit','appendix');

SELECT count(*) FROM spideryarn.chat_threads
WHERE origin_mode = 'summary';
```

There is a possible future structural change around glossary/citation entry identities. Glossary hiding now queries IDs inside JSONB, and persistent lookups/hidden entries address those IDs outside the artefact. That weakens the original “implementation detail” description. A relational identity layer would affect regeneration, retention, exports, and existing side rows. I did not establish a current defect requiring that work, so I am not designing or proposing it here.

**Migration procedure:** edit the owning schema declaration; use `npm run db:generate`, or `npm run db:generate -- --custom --name <name>` for hand-written SQL. Inspect the SQL, snapshot, and journal together. Apply with `npm run db:migrate`, read its `Target:` line, and run `npm run db:check` plus the relevant database tests. Remote application uses an explicitly chosen direct/session connection and `DB_MIGRATE_ALLOW_REMOTE=yes`.

The error-prone parts remain:

- Generated timestamp additions can invent dates for old rows; split column addition from default installation.
- Custom Auth FKs, triggers, and some ledger CHECKs are not fully represented in Drizzle snapshots.
- A structurally valid snapshot chain can still contain stale schema contents.
- A successful ledger reconciliation does not prove the actual catalog matches.
- `schema-drift.ts` checks table/column accessibility, nullability, and default presence; it does not compare SQL types, CHECK expressions, FKs, or indexes.
- Direct DDL outside the migration ledger can wedge every worktree sharing that database.
- `drizzle-kit push` and Supabase’s migration history are not substitutes for this migration path.

For DB3, zero invalid rows permits stronger enforcement. Nonzero means stop before any rewrite. DB4’s nullable addition needs no invented backfill. DB5 needs measurement before creation. None of these statements authorizes destructive production work.

## Considered and not proposed

- **Splitting `schema.ts` or the large stores by size:** no demonstrated second reason to change; the earlier rejection still applies.
- **A generic retention helper:** DB1 comes from a meaningful sibling difference. Sharing mechanics without making dependency lifetime explicit would preserve the mistake.
- **Cascading criterion deletion into comments:** contradicts the deliberate reader-data protection.
- **Blanket JSON normalization:** most blobs are versioned outputs read/replaced together. Operational job JSON and externally addressed glossary IDs deserve explicit caveats, not a whole-schema rewrite.
- **Removing rename aliases or historical names:** current step CHECK values are Structure/Skim; historical migrations, plans, ledger labels, and compatibility readers properly retain older spellings. `structure-labels` deliberately preserves cache ancestry.
- **Removing citation-find storage because its endpoint retired:** current readers/exporters and save mappings still use the table and its historical values.
- **Changing ownership deletion policies:** mixed restrict/cascade policies deserve an account-deletion workflow, but this is already documented and no fresh failure was established here.
- **Adding indexes for every FK, sort, or timestamp:** bounded histories and point caches do not justify them without plans. DB5 is the strongest measurement candidate.
- **Claiming the raw-source publication implication is fixed:** it is not enforced by the gate. Current writers do populate references, but I found no reachable counterexample warranting a Tier 0 finding.
- **Repeating sweep-five findings:** pending criteria retention and Claims attempt fencing have landed. DB1 supplies new evidence about a different protected lifetime.

## One level up

The overall structure still fits the product: immutable revision contents, stable block identities, explicit reader-action rows, transactionally fenced work, and whole versioned model outputs. The defect found here is at the join between two individually sensible rules—discard old derived work, preserve reader notes. The most useful next checks are direct forbidden-row tests for discriminator shapes and combined lifecycle tests for a parent with reader-owned dependants. Declaration inventories and happy-path writer round trips cannot establish either contract.