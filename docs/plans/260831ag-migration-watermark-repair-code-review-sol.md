# Verdict: NO-SHIP

The ledger guard is worth keeping and appears sound for its stated metadata question. The repair and corpus-readiness checks are not yet strong enough to support the claims made from them. Several can still stay green while the protected effect is false.

## Blocking findings

1. **The repair’s catalogue probes do not prove migration equivalence.**

   The largest hole is that several “effects” check only an object’s name:

   - `0037` checks that `experimental_since` exists, without type, nullability or default, and recognizes the CHECK merely because its text contains `callout` ([repair script](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:251)).
   - `0038` checks only that two columns and two constraint names exist—no types, defaults, nullability, definitions, owning table, or `convalidated` ([repair script](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:280)).
   - `0036` asks whether any same-named constraint contains `summary`; absence of the constraint also satisfies “no longer allows summary” ([repair script](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:215)).
   - `0033` and `0034.passages` do not verify that the historical no-default columns still have no default.

   These checks can record the exact migration hash against a materially different schema. That makes later failures harder to diagnose: a future `DROP CONSTRAINT` can find the wrong/missing object, a later validation can expose rows admitted by `NOT VALID`, or application code can encounter the wrong type/default while the ledger insists the exact SQL ran.

   Before inserting a repaired row, compare:

   - Columns: exact type/typmod, nullability, exact default expression or none, generated/identity state; collation for the `text` columns. Storage/compression are less likely to break later DDL, but should also be compared if “same postcondition” is meant literally.
   - CHECKs: owning schema/table, `contype`, normalized complete expression, `convalidated`, and inheritance state.
   - `0032`: also rule out an equivalent differently-named unique index that still enforces the global one-running-job cap.

   The actual laptop now needs one exact catalogue audit because the shallow checks cannot prove that the push-created objects matched.

2. **Corpus check 2 uses the wrong adapter and does not perform a read.**

   The checker uses `blobStore()` ([corpus checker](/home/greg/code/spideryarn2/scripts/db-corpus-readiness.ts:127)). Postgres readers deliberately use `postgresBlobStore()` because `blobStore()` can fall back to `data/_blobs/` or select a bucket that does not match `DATABASE_URL` ([store guard](/home/greg/code/spideryarn2/src/store/blobs.ts:302)).

   Therefore it can pass against local files while the Postgres reading path refuses, or pass against the wrong bucket when the same content-addressed key happens to exist there.

   `head()` is also insufficient. The actual reader calls `get()` with a size bound and hashes the returned bytes ([actual read](/home/greg/code/spideryarn2/src/store/raw-document.ts:124)). `head()` cannot detect unreadable downloads, oversized objects, or wrong bytes under the right key.

   Fix this by reusing `postgresBlobStore()` and the same bounded-get-and-hash logic as `readRawDocument`, preferably by calling that shared implementation.

3. **The corpus can be empty and still print `✓ ready`.**

   The script explicitly identifies an empty corpus as the shape a botched refetch leaves behind, but the article count is only printed, never gated ([corpus count](/home/greg/code/spideryarn2/scripts/db-corpus-readiness.ts:144)). Zero rows makes both checks vacuously green.

   At minimum, zero articles/revisions/references must fail. If “a refetch silently skipped one article” must be detected, a nonzero assertion is still insufficient: accept an expected count or expected slug inventory and compare against it.

4. **`--seed-a-bad-row` can report a successful control without detecting the seeded row.**

   Exit success is based on the shared `bad` counter ([control exit](/home/greg/code/spideryarn2/scripts/db-corpus-readiness.ts:149)). If check 1 misses the seed but check 2 has an unrelated real failure, the control exits 0 and says it saw the seeded fault. With an empty corpus, `seeded` remains null and the command falls into normal mode, exiting 0 as “ready.”

   Track `orphaned.rows.some(r => r.id === seeded)` separately and make that exact assertion determine self-test success. A dedicated `db:corpus-readiness:self-test` command would make the inverted semantics less surprising in CI.

5. **`--forget-orphans` deletes arbitrary unknown history on an insufficient gate.**

   The script deletes every initially unknown timestamp once every current journal timestamp merely exists ([orphan deletion](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:547)). It does not verify hashes, duplicates, full reconciliation, or that each deleted row is one of the two known predecessors subsumed by `0037`.

   If another branch later contains one of those stamps, its migration appears missing below the current watermark. The guard correctly refuses, but the original ledger evidence needed to understand and repair it has been destroyed.

   Use an exact allowlist of expected orphan row IDs/stamps/hashes, preserve their provenance, prove their effects are specifically subsumed by `0037`, and delete them in the same locked transaction. “Every journal timestamp exists” is not the right gate.

## Which checks can really go red?

| Check | Assessment |
|---|---|
| `reconcileLedger` preflight | Strong for metadata. It independently detects gaps, unreachable timestamps, hashes, duplicates and unknown rows. |
| Static journal inversion test | Strong for future timestamp inversions. |
| Postflight | Can detect missing/wrong/duplicate ledger rows, but is green for a correctly forged row by design. |
| Repair effects | Can go red, but several predicates are too shallow; green does not establish the claimed postcondition. |
| Corpus check 1 | Can go red and the seed demonstrated it, but passes vacuously when rows are missing or the corpus is empty. |
| Corpus check 2 | Can go red on a missing HEAD, but does not test the adapter or read operation used by the protected path. |
| Seed control | Not reliable until success is tied to detection of the exact seeded ID. |

The postflight is not circular during an ordinary Drizzle migration: DDL and its ledger insert are transactional, and it catches the original “returned without inserting anything” failure. It is circular for the manual repair, which writes exactly the metadata it then checks.

The cheapest meaningful independent assertion is an exact live-schema fingerprint covering columns, defaults, constraints and indexes. The current `db:check` is not enough; it explicitly omits constraints and indexes and does not compare exact types/default expressions ([schema-drift scope](/home/greg/code/spideryarn2/src/db/schema-drift.ts:14)).

## Other changes required

- Acquire the advisory lock before reading the ledger, evaluating preconditions, choosing DDL and displaying destructive counts. Currently all of those happen before the lock at [line 493](/home/greg/code/spideryarn2/scripts/db-repair-migration-ledger.ts:493). Orphan deletion then happens after the lock is released.
- Split preflight refusal from postflight failure. The shared message says “No migration has been applied and nothing has changed” ([db-migrate](/home/greg/code/spideryarn2/scripts/db-migrate.ts:162)), but it is also called after `migrate()` has committed ([postflight call](/home/greg/code/spideryarn2/scripts/db-migrate.ts:242)).
- Add tests around the repair and corpus scripts. The current tests cover the pure ledger functions, not catalogue equivalence, CLI ordering, orphan deletion, empty-corpus behavior, adapter selection, or the negative-control exit logic.
- Recording uncommitted `0038` was defensible only if its owner explicitly froze those bytes. The later hash refusal is correct, but without that coordination the safer choice was to remain refused until the migration was committed and its exact effects could be certified.

## Overclaims to correct

Commit `86a3341` says the push-created effects had “type, nullability and default … each checked.” That is false for `0037` and `0038`, and defaults were not checked for `quotes` or `passages`.

The repair header says effects are probed before and after “in the same transaction”; the pre-probes are outside both the transaction and advisory lock.

Finally, [the journal test](/home/greg/code/spideryarn2/tests/migration-journal.test.ts:15) says the inversion “cost … a repair on production,” while the plan and postmortem correctly say production has not been inspected.

Verification note: direct TypeScript compilation passed. The managed read-only sandbox prevented Vitest from creating its cache and prohibited connecting to the local Postgres socket, so I could not independently rerun those two parts here.