# Cross-family review: database schema — Sol on Opus

Read-only, 2026-10-06. Findings reviewed in numeric ID order. No tracked file changed; `git diff HEAD --name-only` remained empty.

**The main corrections:** DBO1 establishes a missing index, not the claimed delete duration. DBO4’s proposed inventory test would miss deleted objects. DBO12’s query counts legitimate reader-added terms as possible dangling entries. Sol’s DB1 supplies a confirmed Tier 0 defect that Opus missed.

## Evidence limits and probes

Live database checks were unavailable:

```text
Docker API: permission denied
Local Postgres probe, default_transaction_read_only=on: EPERM
```

Consequently, production counts below remain **Opus’s recorded measurements**, not independently reproduced evidence.

Independent tree-only probes produced:

```text
Drizzle declarations: 49 tables, 662 columns
DBO4 named index declarations: 0 of 6
DBO4 named CHECK declarations: 0 of 5
Schema comparator given matching columns but no index/CHECK metadata: []
Reader-added glossary entry absent from JSON: displayed
Hide attached to that reader-added entry: true
```

An in-memory `drizzle-kit/api` probe changed a CHECK expression from `id > 0` to `id > 1`:

```sql
ALTER TABLE "spideryarn"."review_check_probe" DROP CONSTRAINT "review_check";
ALTER TABLE "spideryarn"."review_check_probe"
  ADD CONSTRAINT "review_check" CHECK ("spideryarn"."review_check_probe"."id" > 1);
```

The existing tree tests ran without database access:

```text
node node_modules/vitest/vitest.mjs run tests/tree-provisional.test.ts --project unit

Test Files  1 passed (1)
Tests       12 passed (12)
```

## Findings

### DBO1 — Missing index for the block-identity foreign key

**Verdict: overstated · C for the index gap; H for deletion latency · Tier 1 measurement candidate.**

Trace: `pgShelfStore.destroy` locks the billing account and article, rejects active jobs and stranded reservations, deletes terminal jobs, then deletes `articles`. The schema cascades through `article_revisions` and `block_identities`; `revision_blocks_identity_fk` checks `(article_id, block_id)`. The available block indexes lead on revision ID or contain `fts`, so the proposed index duplicates none.

The recorded lookup returns **12 existing rows**. During the article cascade, those revision blocks are also deleted. Multiplying this lookup’s duration by the identity count does not reproduce the cascade’s trigger execution or cost. Neither “73 seconds” nor “under a second” for index creation is established.

**Fix separately:** `(article_id, block_id)` is a suitable direct index, with write/storage overhead and migration locking as its costs. Measure an actual cascade in an isolated database before claiming the performance benefit. Safe to build without the owner; no new refusal or reader-data rewrite.

### DBO2 — Never-published article rows survive

**Verdict: confirmed · C for retention; production quantities not revalidated · Tier 3 retention decision.**

Trace: `beginDraftIn` calls `lockOrCreateArticle`, then creates the draft. `failRevisionIn` does not remove the article. `abandonedDraftCondition` and `sweepAbandonedDrafts` delete eligible draft/failed revisions, while identities and checkpoints reference the article. Current-revision joins exclude these articles from the shelf. `pg-admin.ts` deliberately counts them.

The recorded **13 articles and 9,303 identities** support accumulation. The percentage is **38.21%** of the recorded 24,344 identities. “Every read” is too broad: admin and identity/job paths can read these rows.

**Fix separately:** neither immediate deletion nor an age-based sweep is merely an extraction. Both affect retry identity, checkpoints, uploads and financial/audit links. Reuse the established destruction safeguards rather than adding an unchecked DELETE. Owner decision required; do not build automatic deletion from these counts alone.

### DBO3 — Duplicate chat-message ordering index

**Verdict: confirmed · C; current catalog presence not independently reproduced · Tier 1.**

Trace: `0002_reader_state_and_missing_columns.sql` creates the UNIQUE constraint on `(article_id, thread_id, ordinal)`; `0003_reader_state_owner_fks.sql` creates the non-unique index on the same columns. `schema.ts` still declares the UNIQUE constraint. `pg-chat.ts` reads messages by article/thread and orders by ordinal.

The unique index supplies the same lookup/order structure. The recorded scan counts do not make the non-unique copy necessary.

**Fix separately:** drop only `chat_messages_thread_ordinal_idx`, leaving the UNIQUE constraint. This passes the deletion test: one mechanism disappears, with no replacement abstraction or lost enforcement. Reversible; safe without the owner. Check current definitions before applying the migration.

### DBO4 — Migration-only objects and incomplete drift checking

**Verdict: confirmed · C, with R for the comparator’s blind spot · Tier 1 for a scoped correction.**

The count holds: **six indexes and five CHECKs** have migration definitions but no corresponding Drizzle declarations. I checked their creation sites and the later replacement of `ai_calls_provider_account_known`. `schema-drift.ts` reads column/access/default/nullability information; its comparison has no index or constraint inputs.

**Fix separately:** the proposed actual-name → declaration/allowlist test is insufficient. A deleted allowed object produces no unexpected name, so that test stays green. It also would not detect DBO3 if the duplicate were allowlisted.

Prefer declarations for surviving expressible objects, reconciled snapshots, and required-object checks in the existing database-test area. Check definitions where semantics matter, not only names. `tests/db-schema.test.ts` already checks custom FKs and an index; `tests/store-ai-calls.test.ts` already exercises the BYOK CHECK. Extend those mechanisms rather than introduce a second inventory.

Safe without the owner. No new refusal, but snapshot reconciliation must avoid duplicate CREATE statements and must work on both existing and newly migrated databases.

### DBO5 — Redundant child ownership columns

**Verdict: overstated · C · Tier 3 owner decision.**

The **eight tables** are correctly identified. Their request authorization goes through `articleIdForOwned`/`ownedSlug`; their child-owner fields do not supply an authorization predicate.

Re-run:

```bash
rg -n 'ownerId|owner_id' \
  src/store/pg-{comments,chat,searches,lookups,citation-finds,citation-investigations,referee-criteria,referee-claims}.ts \
  | rg 'ownerId: currentOwnerId'
```

```text
10 assignments across 8 stores:
9 inserts, plus referee_claims’ upsert update.
```

Thus “once per store, only on insert” is false. Whole-row selects also retrieve these columns; “nothing reads” should mean **no operational use of their value**, not no SELECT.

**Fix separately:** dropping the columns removes redundant ownership, but touches writers, types, tests, export dependency discovery and the dynamically discovered `db:reown` tables. The script contains no eight manual stanzas to delete.

Composite FKs would enforce agreement but add mechanisms rather than remove duplication. `ON UPDATE CASCADE` must be checked against ownership-transfer scripts. Existing valid requests should satisfy the proposed FKs; fresh production mismatch counts remain required. Both alternatives need the owner because they settle the future ownership model.

### DBO6 — Superseded revisions dominate storage

**Verdict: overstated · C for retention/copying; H for dispensability · Tier 3.**

Trace: `beginDraftIn` copies current revision columns, blocks and step runs. The abandoned-draft sweep explicitly excludes published revisions. Ordinary article/export reads select the current revision.

However, superseded published revisions have a current operational reader: `rebaseSharingDraftIn` compares the draft’s old base with the new current revision, including columns, blocks and step runs. Retention is more than unused history.

The recorded superseded-published block proportion is **85.91%**: 90,870 / 105,774. That describes stored rows, not their removability.

**Fix separately:** retention must protect bases used by live drafts and concurrent publication, as well as address history and lineage. Deleting old revisions can alter FK lineage and disable a legitimate rebase. No immediate build; owner decision required. No normalization or copy-on-write redesign is justified by the current size alone.

### DBO7 — Retired `citation-find` allowance row

**Verdict: confirmed · C for unreachable cleanup; recorded row count unverified · Tier 1 optional cleanup.**

Trace: `RateBucket` excludes `citation-find`. `pgFetchAllowanceStore.take` deletes expired events only for the current owner and requested bucket; `finish` only clears a lease. No current spender reaches the retired bucket. Existing CHECK vocabulary deliberately admits historical rows.

**Fix separately:** deletion followed by narrowing the CHECK is feasible, but it removes historical data for little runtime benefit. There is no accumulating current producer to stop. The type already prevents ordinary requests from selecting this bucket.

The recorded production row would fail the narrowed CHECK unless deleted first. Owner approval required for that deletion. Leaving the historical value is also a valid outcome.

### DBO8 — Published revisions should have shelf scalars

**Verdict: confirmed · C; production eligibility not independently reproduced · Tier 1.**

Trace: `publishRevisionIn` derives the four numbers through `deriveLibraryScalars`, writes them with `status: "published"`, then moves the current-revision pointer in the same transaction. `scalarsForShelf` recomputes missing values. The proposed CHECK duplicates no existing constraint.

There is **no current importer** to inspect: `src/store/import.ts` and `db:import` were deleted. The fixture copier writes through artifact interfaces and leaves publication to its caller.

**Fix separately:** the CHECK is the smallest enforcement change. Normal publication, including thin articles and legitimate zero counts, supplies all four numbers. Direct test fixtures that insert published revisions without scalars will fail; some shelf tests deliberately create missing-scalar rows.

Safe without the owner after fresh counts and fixture/test adjustments. Keep fallback removal separate: enforcing future writes and deleting defensive read behavior are different claims.

### DBO9 — Referee claims constraint withheld for the removed store

**Verdict: confirmed · C · Tier 1.**

Trace: `pgRefereeClaimsStore.begin` clears claims on insert and update. The route writes claims on success and `[]` on failure. The orphan sweep changes a pending row to error; current begin/finish fencing leaves that pending row empty. The schema currently constrains only status.

**Fix separately:** the proposed CHECK enforces current route behavior and duplicates no existing database guard. Ordinary requests do not reach its refusal. The broad `ClaimsFinish` type nevertheless permits an error patch carrying nonempty claims; audit callers and characterize that refusal explicitly.

The recorded zero violations are not fresh proof. Safe without the owner after current validation. Do not bundle a `comments.thread_id` FK: its advisory lifetime remains a separate design, and no harmful dangling-thread case was established.

### DBO10 — Dead running-job pointer

**Verdict: confirmed · C · Tier 1 optional deletion.**

Re-run:

```bash
rg -n 'running_job_id|runningJobId' src scripts tools evals tests --glob '!schema.ts'
```

```text
0 hits
```

Trace: `pgJobStore.claim` locks singleton row 1, explicitly rejects its absence, counts running `jobs`, and applies `maxRunning`. It neither reads nor updates the pointer or `updated_at`.

**Fix separately:** correct descriptions now. Dropping the pointer/FK passes the deletion test but buys little. It also changes export dependency discovery: `queue_state` currently enters that walk through its FK to `jobs`. Preserve the singleton, seed, deletion trigger and missing-row refusal.

Column drop requires the owner. Description corrections do not.

### DBO11 — Stale comments

**Verdict: overstated as a count of false comments · C/R · Tier 1.**

The four numbered groups span six locations:

- `ai_calls.wire`: stale. `Wire` has **seven members**, with producers and ledger mappings for the added transports.
- Step-CHECK generation rationale: stale. The in-memory probe above reproduces CHECK-expression diffing.
- Queue export coverage: **two** false descriptions; claim uses the singleton as a mutex.
- Referee-claims missing-CHECK rationale: stale, as DBO9 establishes.
- `comments.thread_id`: already says the filesystem store is gone and describes the former parity constraint historically. That history is not a false current claim.

**Fix separately:** correct the five stale locations; preserve or shorten the explicit history as appropriate. Link transport vocabulary to `Wire` rather than copy another exhaustive list. Safe without the owner; no runtime change or new refusal.

### DBO12 — Persistent entry IDs inside revision JSON

**Verdict: overstated · C for the boundary; H for dangling rows or harm · Tier 3 only if revisited.**

Trace: `pgGlossaryHiddenStore.hide` accepts either a current JSON entry **or a lookup with `added_name`**. `loadGlossary` calls `withAddedEntries`, attaches lookup explanations, then applies hidden IDs. Citation reads likewise attach side rows by entry ID.

The appendix query checks JSON membership only. Its **two missing memberships are not two proven dangling references**: reader-added terms deliberately never enter the JSON. The tree-only probe reproduces display and hide attachment for precisely that case. The corrected production orphan count is unknown.

**Fix separately:** the proposed relational identity layer adds lifecycle, migration and regeneration rules. It does not automatically decide which IDs survive replacement. First correct the diagnostic to include added terms, then demonstrate reader harm. No build now; owner required for any normalization/retention redesign.

### DBO13 — Structure’s provisional flag remains in JSON

**Verdict: confirmed fact, overstated improvement case · C · no buildable Tier 2 finding.**

Trace: `revisionAwaitsStructure` reads the flag by revision primary key; `awaitingStructure` checks the same tree field in memory. Tree construction and invariant validation use provisional markers too. `nav_label_status` is a separate generation lifecycle, not proof that the tree marker should share its storage shape.

**Fix separately:** a new column would duplicate the flag unless all tree writers and readers migrate together. A primary-key lookup reading one JSON field establishes neither a performance defect nor useful extraction. The tree tests confirm that provisional semantics are already exercised.

Keep as a policy/design observation. No build now; a broader change needs its own justification and owner review.

## Agreements

| Opus | Sol | Independently shared conclusion |
|---|---|---|
| DBO10; queue part of DBO11 | DB6; queue part of DB2 | Running-job pointer is unused; queue descriptions need correction. |
| DBO12 | Stable-reference discussion | Side rows address glossary/citation identities outside versioned artifacts. Neither establishes a normalization need. |
| DBO7 | Historical-vocabulary discussion | No current spender; historical events remain and cleanup cannot reach the retired bucket. |
| DBO4 | Migration-procedure limitations | Column drift checking does not establish constraint/index equivalence. |

The last three are shared observations, not independently matching numbered fix proposals.

## Disagreements

- **“No live correctness defect.”** Sol DB1 survives. `runRefereeCriterion` calls `begin` before SSE; its trim selects completed criteria beyond the cap without checking comments. `comments_criterion_fk` refuses deleting a marked oldest criterion, rolling back criterion 21. **C · P1 · Tier 0.** Preserve marked criteria and coordinate candidate locks with concurrent comment placement. Safe without the owner: this preserves the existing reader-note protection.
- **Index removal.** Sol’s blanket “none justified” misses DBO3’s migration-only duplicate. Remove that exact duplicate; this does not justify broader pruning.
- **Owner index.** Sol DB5 proposes measurement; Opus declines an index at current size. Both establish missing owner-leading coverage, neither establishes material latency. Hold creation pending measurement.
- **Glossary orphan interpretation.** Sol’s caveat about legitimate external identities is supported by `added_name` and the read seam. Opus’s JSON-only count cannot settle dangling references.
- **Retired-bucket cleanup.** This is a choice about historical data, not competing correctness evidence. Leave it for the owner.

## Missed by both

**NEW1 — `db:reown` violates the existing reservation/job owner FK. C · P2 · Tier 0.**

`ownedTables()` orders tables alphabetically. Its transaction updates `ingest_events.owner_id` before `jobs.owner_id`. `20260902172838_billing_owner_and_event_fks.sql` defines immediate `jobs_ingest_event_fk` on `(ingest_event_id, owner_id)`, with no update cascade or deferral.

With a job referencing the source owner’s reservation, the first update invalidates that FK and aborts both dry-run and apply. This is proved from the actual statement order and constraint; database reproduction was blocked.

Small scoped repair: make this FK deferrable while retaining immediate enforcement by default, then defer it explicitly during the local transfer transaction. Test transfer with a referenced reservation and verify commit-time rejection of mismatched owners. Safe without the owner; no production data rewrite. This also exposes a lifecycle concern for DBO5’s proposed ownership FKs.

## Build order and overlaps

| Order | Work surviving review | File overlap / authorization |
|---|---|---|
| 1 | Sol DB1: preserve marked criteria during trimming | `pg-referee-criteria.ts`, referee database tests. Tier 0; safe. Can use a separate worktree from schema work. |
| 2 | NEW1: repair local ownership transfer | `scripts/db-reown.ts`, FK migration, migration metadata, tests. Tier 0; safe. Shares migration ownership with later schema work. |
| 3 | DBO3; confirmed DBO11 comments; minimal DBO4 required-object coverage | `schema.ts`, `article-rows.ts`, `db-schema.test.ts`, migration metadata. Cheap removal/correction; safe. Cluster these. |
| 4 | DBO8 and DBO9 constraints | `schema.ts`, migrations/metadata, publication/shelf/claims tests. Safe after fresh counts. Same schema worktree as order 3, staged separately. |
| 5 | DBO1 cascade measurement, then index if supported | Isolated database probe; subsequently `schema.ts`, migration/metadata, deletion tests. Shares schema worktree. |
| Held | DBO2, DBO5, DBO6, DBO7, DBO10 | Owner decisions; no destructive work scheduled. |
| Not scheduled | DBO12 normalization; DBO13 column extraction | No demonstrated defect or sufficient simplification case. |

Keep all migration/schema stages sequential: separate migration filenames do not prevent conflicts in snapshots and the journal.