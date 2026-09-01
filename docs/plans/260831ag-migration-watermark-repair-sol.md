## Verdict: SHIP-WITH-CHANGES

The diagnosis is correct, and not re-timestamping published migrations is correct. The proposed repair is close, but two changes are blocking:

1. The manual repair must be one locked transaction with explicit preconditions. Replaying `0033` verbatim after `0035` can fail on existing `timeline` rows.
2. The guard must run both before and after `migrate()`. A post-only guard can detect the gap only after later migrations have already run against the wrong schema.

### 1. Bookkeeping rows are valid only after proving schema equivalence

Insert both:

- `created_at = journal.when`
- `hash = SHA-256 of the migration file’s exact bytes`

That is how Drizzle constructs its rows ([migrator source](/home/greg/code/spideryarn2/node_modules/drizzle-orm/pg-core/dialect.js:44)). Compute the hash at repair time; do not hand-copy it.

Put the DDL and ledger inserts in the same transaction. Otherwise a failed final constraint can leave the column dropped, the old constraint absent, and no bookkeeping row.

However, “the ledger tells the truth” needs qualification. If you apply equivalent repair SQL rather than the exact historical SQL, the row means “this database has been reconciled to this migration’s postcondition,” not “these bytes executed.” Record that distinction in the repair write-up.

Preconditions should include:

| Migration | Check before recording it |
|---|---|
| `0032` | Inspect the named index definition, not just its name. Afterwards it must be absent. |
| `0033` | `quotes` must be absent or exactly nullable `jsonb`; inspect the current step CHECK and existing `step_name` values. |
| `0034` | Check each column independently for type, nullability and default. One present and one absent is a partial state, not permission to replay the whole file. |
| `0036` | Inspect the current CHECK definition and `convalidated`, count data being discarded, check dependencies on `summary`, and query every row against the new allowed set. |

The serious trap is `0033`: its final statement re-adds the pre-Timeline CHECK and omits `timeline` ([SQL](/home/greg/code/spideryarn2/drizzle/0033_quotes.sql:25)). `0035` later adds `timeline` ([SQL](/home/greg/code/spideryarn2/drizzle/0035_timeline.sql:56)). Therefore:

- If any `timeline` run row exists, verbatim `0033` fails.
- If none exists and all four repairs occur in one transaction, the temporary regression is not externally visible and `0036` restores the final constraint.
- The safer general repair is to add the missing `quotes` column without installing `0033`’s obsolete intermediate constraint, then apply the final `0036` constraint and record `0033` as reconciled.

Also audit `0037` and `0038`. The current `0037` combines two old local migrations and therefore has a different hash and timestamp from the rows those old migrations wrote. A guard comparing the current journal to the ledger will probably flag it even though its effects exist. The proposal’s four bookkeeping rows may therefore be incomplete.

### 2. Detect `0036` violations before touching the constraint

After taking an `ACCESS EXCLUSIVE` lock on `revision_step_runs`, but before dropping anything, run the equivalent of:

```sql
SELECT step_name, count(*)
FROM spideryarn.revision_step_runs
WHERE step_name NOT IN (
  'fetch','extract','blocks','toc','assets','arc',
  'tweets','glossary','quotes','ideas','timeline','sketch'
)
GROUP BY step_name;
```

The expected result is either empty or only `summary`, which the migration deletes.

If the current `0035` CHECK is present and validated, other invalid values should be impossible. Finding one means the starting-state assumption is false; stop rather than expanding the DELETE.

If the final `ADD CONSTRAINT` encounters an uncovered value, it raises `23514`. Under Drizzle—or under the required manual transaction—everything rolls back. Under autocommit, the preceding DELETE and column drop remain while the constraint stays absent. That is why “by hand” must explicitly mean a transaction.

There is a second preflight specifically for verbatim `0033`: query for `step_name = 'timeline'`, because `0033` rejects those rows before `0036` is reached.

### 3. Applying `0036` after `0037` does not create snapshot divergence here

`drizzle-kit generate` compares `src/db/schema.ts` with the latest snapshot; it does not inspect the live database. The actual route taken through live schemas is irrelevant to generation.

For these migrations, the final effects commute:

- `0036` touches `article_revisions.summary` and `revision_step_runs_step`.
- `0037` touches `reader_profiles` and `revision_blocks`.
- `0038` adds block-context columns and constraints.

If the repaired database ends in the shape represented by `0038_snapshot.json`, there is no snapshot-versus-database divergence. In fact, the repair reduces the existing divergence.

This conclusion is specific to these migrations. Data transformations or overlapping constraints could make out-of-order execution materially different even when snapshots look right.

### 4. The right invariant is stronger than “every entry applied”

After `migrate()` returns, every current journal entry should have exactly one matching `(when, hash)` row. There is no legitimate deliberate gap after a successful run from the current checkout.

Before migration, pending entries are legitimate—but only when Drizzle can actually apply them. The preflight should assert:

1. Known applied journal entries form a contiguous prefix in journal order.
2. Pending entries form the remaining suffix.
3. Every pending entry’s `when` is strictly greater than the maximum `created_at` of every ledger row, unless the ledger is empty.
4. Every known row has the expected hash.
5. Duplicate timestamps, duplicate matching rows, missing SQL files, duplicate tags and broken indices fail.

Condition 3 captures Drizzle’s real watermark behaviour. A database through `0034` is safe: both `0035` and `0036` exceed its watermark, even though their timestamps are internally reversed. A database through `0035` is unsafe because `0036` cannot cross the watermark.

The existing deploy code already contains related machinery, but it should be refactored rather than duplicated. Its `migrationState()` deliberately repeats the watermark test and therefore calls inaccessible gaps “not pending” ([code](/home/greg/code/spideryarn2/scripts/deploy-checks.ts:43)). Its stronger history comparator is already used before production migration ([deploy preflight](/home/greg/code/spideryarn2/scripts/deploy.ts:748)).

Unknown ledger rows need explicit policy:

- Production: fail.
- Laptop: if current entries are pending, fail until the branch migrations are reconciled; they may overlap those pending migrations.
- Laptop after every current journal entry is reconciled: old branch rows below the current watermark may be reported as historical extras rather than blocking forever.

Add a static journal test too: future entries must have a `when` greater than every preceding entry. Grandfather the exact published `0035`/`0036` inversion; do not weaken the rule generally.

### 5. Production should refuse before migrating

The first production encounter with this gap must:

- Print the exact missing/inaccessible migration.
- Exit non-zero.
- Apply no DDL.
- Never print `✓ migrations applied`.

“Report and continue” is unsafe because a later migration may depend on the skipped one. A post-only refusal is too late: `migrate()` could already have committed `0037` and `0038`.

The safest human runbook is:

1. Do not run ordinary migration automation yet.
2. Obtain Greg’s explicit approval because `0036` deletes production rows and drops real data.
3. Deploy code that no longer reads `summary` using the migration-skipping path. Dropping the column while old code still selects it causes a production outage.
4. Using the migration/session credential, verify the target, full ledger, exact schema effects, constraint validation, violating step names, and counts of data to be deleted.
5. Take an appropriate backup or confirm recoverability.
6. In one locked transaction, apply only the missing repair and insert its exact ledger row.
7. Re-probe the four observable effects.
8. Run migration automation again for any genuinely pending suffix.
9. Run `db:check` as the application role and smoke-test the live queries.

The current production deploy preflight may already refuse this history through `ledgerDivergence`; that is useful protection, not a reason to force the gate.

### 6. The proposed guard is not itself an end-state check

A ledger comparison checks metadata, not schema. This matters especially because the repair itself manually inserts metadata. A mistaken insert makes the proposed guard green by construction.

Keep both:

- Ledger reconciliation: detects watermark gaps, changed migration files and branch histories.
- Independent effect checks: detect missing/wrong columns, indexes and constraints.

The existing schema drift checker explicitly says it does not cover indexes, constraints or backfills ([schema-drift.ts](/home/greg/code/spideryarn2/src/db/schema-drift.ts:14)). For this repair, retain the four targeted catalog probes even if `db:check` passes.

Finally, serialize migration processes. Drizzle takes no advisory lock; two invocations can read the same watermark and both attempt the same DDL. A session advisory lock around preflight, `migrate()`, and postflight would close that race.