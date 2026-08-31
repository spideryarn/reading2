# Code review: the migration watermark repair, as built

Adversarial review of built code. Verdict SHIP / NO-SHIP / SHIP-WITH-CHANGES plus specific findings.
You reviewed the *design* earlier; that answer is in
`docs/plans/260831ag-migration-watermark-repair-sol.md` and this is what was built from it.

**The context that matters most:** this is a class of bug where the obvious check agrees with the
bug. `db:migrate` printed `✓ migrations applied` for days while applying nothing. So the question I
most want attacked is **which of these new checks can actually go red**, and which are green by
construction.

## What was built, in two commits

1. `e07a519` — the guard. `scripts/migration-ledger.ts` (new) holds the judgements;
   `scripts/db-migrate.ts` runs a preflight before `migrate()` and a postflight after, under a
   session advisory lock. `scripts/deploy-checks.ts` re-exports the two functions that moved.
   Tests: `tests/migration-ledger.test.ts`, `tests/migration-journal.test.ts`.
2. `2b8f1e0`-ish (the commit below this prompt in the log) — the repair.
   `scripts/db-repair-migration-ledger.ts` and `scripts/db-corpus-readiness.ts`.

## What I actually ran, and what happened

- Four migrations were unreachable on the laptop. After the repair, none are, and
  `npm run db:migrate` — which **refused** beforehand — now succeeds and reports the true state.
- The suite went from ~37 red files to 8, and I attributed each of the 8 to other sessions'
  uncommitted work or to a pre-existing missing build artefact.
- `0036` destroyed nothing here: 0 summary step runs, 0 non-null summary values.
- The `--seed-a-bad-row` control made check 1 of the corpus script go red inside a rolled-back
  transaction. Check 2 is **not** proved by it and the script says so.

## Specific things to attack

1. **The reconciliation table in `db-repair-migration-ledger.ts`.** Each entry is
   `effects` / `refuseIf` / `repair`. Is `effects`-present ⇒ "record it as applied, run no DDL"
   sound? Where could a postcondition hold while the migration's real effect does not — e.g. a
   column of the right name, type, nullability and default that a `drizzle-kit push` created with
   different collation, storage, identity, or a constraint marked NOT VALID?
2. **Three of the five reconciliations recorded rows for effects created by `drizzle-kit push`,
   not by the migration.** I checked type/nullability/default. What else should have been compared
   before asserting the postcondition — and is there any way this makes a *future* migration fail
   in a way that is harder to diagnose than the state I started from?
3. **Forgetting the two orphan ledger rows.** Guarded on "every journal entry is now applied". Is
   that the right gate? What is the failure mode if a branch is later checked out whose journal
   *does* contain those stamps?
4. **`0038_block_contexts` is another session's uncommitted migration**, whose columns and CHECKs I
   found already live from their `push`. I recorded it as applied so `db:migrate` could work at all
   here. If they edit that file, its hash changes and the preflight will refuse. Is that the right
   trade, or should the laptop have stayed broken until they committed?
5. **The postflight.** Its author says it is metadata-vs-metadata and green by construction after a
   bad insert. Given the repair writes exactly that metadata, is the guard as a whole circular in
   any way that matters, and what single additional assertion would break the circle most cheaply?
6. **`db-corpus-readiness.ts`.** Check 2 asks `blobStore().head(key)` per reference. Is `head`
   enough — the postmortem it descends from is about two processes selecting *different* stores, so
   could this probe pass while the reading path still fails? And is the inverted exit code under
   `--seed-a-bad-row` a footgun in CI?
7. Anything else wrong, missing, or overclaimed — including in the commit messages, which assert
   things a reader will believe.

## The diff

 docs/project/database.md        |  77 ++++++
 scripts/db-migrate.ts           | 127 +++++++++-
 scripts/deploy-checks.ts        | 125 ++--------
 scripts/migration-ledger.ts     | 514 ++++++++++++++++++++++++++++++++++++++++
 tests/migration-journal.test.ts | 132 +++++++++++
 tests/migration-ledger.test.ts  | 308 ++++++++++++++++++++++++
 6 files changed, 1170 insertions(+), 113 deletions(-)

```diff
commit e07a5193ba1285dc67bd88ace96c88ae649d1244
Author: Greg Detre <greg@gregdetre.com>
Date:   Mon Aug 31 21:47:18 2026 +0100

    Refuse to migrate when the ledger says a migration can never run
    
    drizzle's migrator keeps a watermark, not a ledger: it reads the newest
    __drizzle_migrations row once, before its loop, and applies only journal
    entries stamped strictly later. An entry that sinks below that number is
    skipped for ever, in silence, under a printed tick. That is how four
    published migrations went missing from this laptop while db:migrate kept
    reporting success.
    
    scripts/migration-ledger.ts now holds the judgements, and db-migrate runs
    them before migrate() as well as after. The preflight refuses — exit 1, no
    DDL, no tick — unless the applied entries are a contiguous prefix in journal
    order, the pending ones the remaining suffix, every pending entry's `when`
    clears the watermark, every applied row's hash matches its file, and the
    journal has no duplicate tags, duplicate stamps, broken indices or missing
    files. Rows the journal has never heard of fail on the remote, fail on a
    laptop while anything is pending, and are reported as history once nothing
    is. The postflight asserts one matching (when, hash) row per entry; it reads
    metadata, not schema, so it is necessary and not sufficient, and says so.
    The whole run holds a session advisory lock, because drizzle takes none.
    
    migrationState() and ledgerDivergence() moved into the same file rather than
    being copied a third time; deploy-checks.ts re-exports them, so deploy.ts is
    untouched. migrationState deliberately keeps sharing drizzle's blind spot —
    it answers "what will the migrator do", and reconcileLedger answers "what is
    missing".
    
    Every check was seen to fail before it was trusted: each condition was
    neutered in turn and the matching test went red. The preflight was also run
    against this laptop and refused. tests/migration-journal.test.ts fails on
    any new journal entry stamped no later than one above it, with the published
    0035/0036 inversion grandfathered by name and by both timestamps.
    
    Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_015J6sN5zVxSu4npKyZa2Kdx

diff --git a/scripts/db-migrate.ts b/scripts/db-migrate.ts
index b0053ed..441466f 100644
--- a/scripts/db-migrate.ts
+++ b/scripts/db-migrate.ts
@@ -31,10 +31,20 @@
 import path from "node:path";
 import { drizzle } from "drizzle-orm/node-postgres";
 import { migrate } from "drizzle-orm/node-postgres/migrator";
-import { Pool } from "pg";
+import { Pool, type PoolClient } from "pg";
 
 import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
 import { loadEnvLocal } from "../src/env.js";
+import {
+  hashMigrationFiles,
+  MIGRATION_LOCK_KEY,
+  MIGRATIONS_SCHEMA,
+  MIGRATIONS_TABLE,
+  postflightProblems,
+  readJournal,
+  reconcileLedger,
+  type LedgerRow,
+} from "./migration-ledger.js";
 
 /**
  * **The shell's `DATABASE_URL`, read before `.env.local` can bury it.**
@@ -120,23 +130,126 @@ if (ssl.mode === "encrypted-unverified") {
   console.warn(`\u26a0 ${ssl.why}`);
 }
 
-/** One connection, used once. `max: 1` because a migrator has no concurrency. */
-const pool = new Pool({ connectionString: url, max: 1, ssl: ssl.ssl });
+/**
+ * Two connections, on purpose.
+ *
+ * One of them holds a **session advisory lock** for the whole run and is never
+ * given back to the pool; the other is what `migrate()` uses. drizzle takes no
+ * lock of its own, so without this two invocations read the same watermark and
+ * both attempt the same DDL — one of them fails halfway through with something
+ * that reads like a broken migration. GPT Sol, 2026-08-31.
+ */
+const pool = new Pool({ connectionString: url, max: 2, ssl: ssl.ssl });
+
+/** The ledger, or an empty one when the bookkeeping table does not exist yet. */
+async function readLedger(client: PoolClient): Promise<LedgerRow[]> {
+  const there = await client.query<{ oid: string | null }>(
+    "select to_regclass($1)::text as oid",
+    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
+  );
+  /* Asked rather than caught. A first run against an empty database is not an
+     error, and swallowing an error to find that out would also swallow
+     "permission denied for schema spideryarn_migrations" — which is what the
+     WRONG credential says, and which must not be read as "nothing applied
+     yet". docs/project/database.md § The migration role that cannot exist. */
+  if (!there.rows[0]?.oid) return [];
+  const r = await client.query<LedgerRow>(
+    `select hash, created_at from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by created_at asc`,
+  );
+  return r.rows;
+}
 
+/** Say what is wrong, then leave without touching anything. */
+function refuse(headline: string, problems: readonly string[]): never {
+  console.error(`\n✗ ${headline}`);
+  for (const p of problems) console.error(`  • ${p}`);
+  console.error(
+    "\nNo migration has been applied and nothing has changed.\n" +
+      "  docs/project/database.md § A watermark is not a ledger.",
+  );
+  process.exit(1);
+}
+
+let lock: PoolClient | null = null;
 try {
-  const db = drizzle(pool);
   const folder = path.resolve(import.meta.dirname, "../drizzle");
-  console.log(`Applying migrations from ${path.relative(process.cwd(), folder)} …`);
+  const journal = readJournal(folder);
+  const hashes = hashMigrationFiles(folder, journal);
+
+  lock = await pool.connect();
+  const got = await lock.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [
+    MIGRATION_LOCK_KEY,
+  ]);
+  if (!got.rows[0]?.ok) {
+    refuse("another process is migrating this database", [
+      `advisory lock ${MIGRATION_LOCK_KEY} is already held`,
+      "wait for it to finish and run this again",
+    ]);
+  }
+
+  /**
+   * **The preflight, and it runs before any DDL.**
+   *
+   * A check after `migrate()` would be too late: the migrator commits every
+   * pending file in one transaction, so by the time a post-hoc check noticed
+   * the gap, the migrations *after* the gap would already have run against a
+   * schema that never had the missing one applied. GPT Sol, 2026-08-31,
+   * §§ 4-5.
+   *
+   * `isLocalDatabaseUrl` decides the unknown-row policy, and it is the same
+   * test that decides TLS and that guards remote runs above. One test, so
+   * "local" cannot mean one thing to the guard and another to the thing it
+   * guards.
+   */
+  const before = await readLedger(lock);
+  const state = reconcileLedger(journal, hashes, before, { allowHistoricalExtras: isLocal });
+  if (state.problems.length > 0) {
+    refuse("the journal and this database's migration ledger do not reconcile", state.problems);
+  }
+  if (state.unknown.length > 0) {
+    console.warn(
+      `⚠ ${state.unknown.length} ledger row(s) from migrations this journal no longer contains ` +
+        `(stamped ${state.unknown.map((r) => r.created_at).join(", ")}). ` +
+        "Historical extras from renumbered local migrations; nothing is pending, so carrying on.",
+    );
+  }
+
+  const db = drizzle(pool);
+  if (state.pending.length === 0) {
+    console.log("Nothing pending — the database is in step with the journal.");
+  } else {
+    console.log(
+      `Applying ${state.pending.length} migration(s) from ${path.relative(process.cwd(), folder)}: ` +
+        state.pending.map((e) => e.tag).join(", "),
+    );
+  }
   await migrate(db, {
     migrationsFolder: folder,
     // Must match drizzle.config.ts. They are two copies of one fact, and the
     // migrator silently starts a FRESH history if they disagree — every
     // migration re-applies, and the first CREATE TABLE fails with "already
     // exists", which reads like a broken migration rather than a typo here.
-    migrationsTable: "__drizzle_migrations",
-    migrationsSchema: "spideryarn_migrations",
+    migrationsTable: MIGRATIONS_TABLE,
+    migrationsSchema: MIGRATIONS_SCHEMA,
   });
+
+  /* The postflight. Necessary and NOT sufficient — it reads the ledger, not
+     the schema, so it cannot tell a real migration from a hand-inserted row.
+     postflightProblems()'s own comment says so, and `npm run db:check` is the
+     half it does not cover. */
+  const after = await readLedger(lock);
+  const missed = postflightProblems(journal, hashes, after);
+  if (missed.length > 0) {
+    refuse("migrate() returned, but the ledger does not account for every migration", missed);
+  }
+
   console.log("✓ migrations applied");
 } finally {
+  /* Releasing the lock is what `pool.end()` does anyway by closing the
+     session; doing it explicitly keeps the release next to the acquire. */
+  if (lock) {
+    await lock.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
+    lock.release();
+  }
   await pool.end();
 }
diff --git a/scripts/deploy-checks.ts b/scripts/deploy-checks.ts
index 4976b2f..5dc43f0 100644
--- a/scripts/deploy-checks.ts
+++ b/scripts/deploy-checks.ts
@@ -18,114 +18,27 @@ import { sameCommit } from "./build-stamp.js";
 /* Migrations                                                          */
 /* ------------------------------------------------------------------ */
 
-/** One row of `drizzle/meta/_journal.json`. */
-export interface JournalEntry {
-  idx: number;
-  tag: string;
-  /** Milliseconds. Drizzle compares this against the ledger's `created_at`. */
-  when: number;
-}
-
-export interface MigrationState {
-  /** Migrations in the journal that the database has not applied, in order. */
-  pending: JournalEntry[];
-  /**
-   * The database has applied more than the journal knows about.
-   *
-   * Normal on a laptop — an agent generates `0018`, applies it, and has not
-   * committed it yet — and **never** normal on the remote. Reported separately
-   * from `pending` because the two are opposite problems and the arithmetic
-   * that finds one would quietly report the other as zero.
-   */
-  ahead: number;
-}
-
-/**
- * What is pending, decided the same way drizzle decides it.
- *
- * **By timestamp, not by count and not by tag.** `migrate()` finds the most
- * recent row in `__drizzle_migrations` and applies every journal entry whose
- * `when` is greater than that row's `created_at`. Comparing counts instead
- * would agree with it almost always and disagree exactly when two agents
- * generated migrations in parallel — which is this repo's normal Tuesday.
- *
- * `lastAppliedMillis` is `null` for a database with no ledger at all, where
- * everything is pending.
- */
-export function migrationState(
-  journal: readonly JournalEntry[],
-  lastAppliedMillis: number | null,
-  appliedCount: number,
-): MigrationState {
-  const pending = journal
-    .filter((e) => lastAppliedMillis === null || e.when > lastAppliedMillis)
-    .slice()
-    .sort((a, b) => a.when - b.when);
-  return { pending, ahead: Math.max(0, appliedCount - (journal.length - pending.length)) };
-}
-
-/** One row of `spideryarn_migrations.__drizzle_migrations`. */
-export interface LedgerRow {
-  /** sha256 of the whole `.sql` file, which is how drizzle computes it. */
-  hash: string;
-  /** The journal entry's `when`, stored as `created_at`. */
-  created_at: number;
-}
-
 /**
- * Is what the database has applied the beginning of what this commit contains?
- *
- * **The count moving by the right amount is not enough**, and this is the check
- * that says why. `migrate()` looks at the **single most recent** `created_at`
- * and applies every journal entry newer than it — it never compares the hashes
- * it has stored against the files in front of it. So a database that applied a
- * *different* `0016` (a migration that was edited after being applied, or a
- * history from another branch) is indistinguishable from a healthy one by
- * counting, and drizzle will happily carry on appending to it.
- *
- * Since the hash is `sha256` of the file's whole contents, an edited migration
- * changes it. Comparing the applied rows against the committed files is
- * therefore cheap and catches the whole class.
- *
- * `hashes` maps a journal tag to the sha256 of its `.sql` file **at the commit
- * being deployed** — not at whatever is on disk, which several agents are
- * editing.
+ * **These moved to scripts/migration-ledger.ts on 2026-08-31** and are
+ * re-exported here so this file stays the one import `scripts/deploy.ts`
+ * reaches for.
+ *
+ * They moved because `npm run db:migrate` needed the same judgements and was
+ * about to grow a third copy of them. There were already two, and the weaker
+ * one was wrong: `migrationState` answers "what will drizzle apply", which is
+ * not "what is missing", and a migration that has sunk below drizzle's
+ * watermark is missing for ever while that function calls it "not pending".
+ * `reconcileLedger` is the function that answers the other question, and
+ * db-migrate refuses on it before any DDL runs. The whole rule, and why it is
+ * a watermark rather than a ledger, is in the header of that file.
  */
-export function ledgerDivergence(
-  journal: readonly JournalEntry[],
-  hashes: ReadonlyMap<string, string>,
-  rows: readonly LedgerRow[],
-): string[] {
-  const applied = [...rows].sort((a, b) => Number(a.created_at) - Number(b.created_at));
-  const expected = [...journal].sort((a, b) => a.when - b.when);
-  const problems: string[] = [];
-
-  for (const [i, row] of applied.entries()) {
-    const entry = expected[i];
-    if (!entry) {
-      problems.push(
-        `the database has applied ${applied.length - i} migration(s) beyond the ${expected.length} this commit contains`,
-      );
-      break;
-    }
-    if (Number(row.created_at) !== entry.when) {
-      problems.push(
-        `applied migration #${i + 1} is stamped ${row.created_at}, but this commit's ${entry.tag} is stamped ${entry.when}`,
-      );
-      break;
-    }
-    const want = hashes.get(entry.tag);
-    if (want && row.hash !== want) {
-      problems.push(
-        `${entry.tag} was applied from different SQL than this commit contains — ` +
-          "a migration file was edited after it ran, and drizzle will never notice",
-      );
-      break;
-    }
-  }
-
-  return problems;
-}
+export {
+  ledgerDivergence,
+  migrationState,
+  type JournalEntry,
+  type LedgerRow,
+  type MigrationState,
+} from "./migration-ledger.js";
 
 /**
  * Statements worth naming before they run.
```

### scripts/migration-ledger.ts (new, in full)
```ts
/**
 * Whether the migration journal on disk and the ledger in the database can be
 * reconciled — and, separately, what drizzle will actually do about it.
 *
 * **Why this is a module rather than a check inside `db-migrate.ts`.** Three
 * places ask a version of this question: `scripts/db-migrate.ts` before and
 * after it migrates, `scripts/deploy.ts` before it migrates production, and
 * `tests/migration-journal.test.ts` about the files alone. They used to answer
 * it two different ways, and the weaker answer is the one that was wrong.
 *
 * **The rule everything here turns on.** drizzle-orm's node-postgres migrator
 * reads ONE row — `select … order by created_at desc limit 1` — once, before
 * its loop, and then applies every journal entry whose `when` is *strictly
 * greater* than that number (`node_modules/drizzle-orm/pg-core/dialect.cjs`,
 * `PgDialect.migrate`). It never looks at the hashes it stored, and it never
 * asks whether an *older* entry is missing. It is a **watermark, not a
 * ledger**. So a journal entry whose `when` is below the newest applied row is
 * skipped for ever, in silence, and `✓ migrations applied` is printed over the
 * top of it.
 *
 * That is not hypothetical: `0035_timeline` was given a hand-written round
 * `when` of 1788200000000, later than `0036_drop_summary_column`'s real
 * 1788175229610, so any database that applied `0035` can never apply `0036`.
 * See docs/project/database.md § A watermark is not a ledger.
 *
 * Everything in this file is pure. The database reads live in
 * `scripts/db-migrate.ts`; the point of the split is that the judgements can be
 * seen to fail without a database — docs/reusable/silent-success.md.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/** One row of `drizzle/meta/_journal.json`. */
export interface JournalEntry {
  idx: number;
  tag: string;
  /** Milliseconds. Drizzle compares this against the ledger's `created_at`. */
  when: number;
}

/** One row of `spideryarn_migrations.__drizzle_migrations`. */
export interface LedgerRow {
  /** sha256 of the whole `.sql` file, which is how drizzle computes it. */
  hash: string;
  /** The journal entry's `when`, stored as `created_at`. */
  created_at: number;
}

/**
 * The single encoding of drizzle's watermark rule.
 *
 * `watermark` is `null` for a database with no ledger rows at all, where
 * everything is reachable. Strictly greater, because that is what
 * `PgDialect.migrate` writes: `lastDbMigration.created_at < migration.folderMillis`.
 */
export function crossesWatermark(when: number, watermark: number | null): boolean {
  return watermark === null || when > watermark;
}

/** The newest `created_at` in the ledger — the number drizzle will compare against. */
export function watermarkOf(rows: readonly LedgerRow[]): number | null {
  let max: number | null = null;
  for (const r of rows) {
    const n = Number(r.created_at);
    if (max === null || n > max) max = n;
  }
  return max;
}

/* ------------------------------------------------------------------ */
/* What drizzle will do                                                */
/* ------------------------------------------------------------------ */

export interface MigrationState {
  /** Migrations in the journal that the database has not applied, in order. */
  pending: JournalEntry[];
  /**
   * The database has applied more than the journal knows about.
   *
   * Normal on a laptop — an agent generates `0018`, applies it, and has not
   * committed it yet — and **never** normal on the remote. Reported separately
   * from `pending` because the two are opposite problems and the arithmetic
   * that finds one would quietly report the other as zero.
   */
  ahead: number;
}

/**
 * What drizzle will apply, decided the same way drizzle decides it.
 *
 * **This deliberately shares the bug.** It answers "what will the migrator do",
 * not "what is missing", and those differ exactly when a journal entry has
 * sunk below the watermark — that entry is missing and will never be applied,
 * and this function calls it "not pending", because that is the truth about
 * the migrator. `reconcileLedger` is the function that answers the other
 * question. Do not fix this one; read that one.
 */
export function migrationState(
  journal: readonly JournalEntry[],
  lastAppliedMillis: number | null,
  appliedCount: number,
): MigrationState {
  const pending = journal
    .filter((e) => crossesWatermark(e.when, lastAppliedMillis))
    .slice()
    .sort((a, b) => a.when - b.when);
  return { pending, ahead: Math.max(0, appliedCount - (journal.length - pending.length)) };
}

/* ------------------------------------------------------------------ */
/* Matching the journal to the ledger                                  */
/* ------------------------------------------------------------------ */

/** One journal entry and every ledger row stamped with its `when`. */
export interface JournalMatch {
  entry: JournalEntry;
  rows: LedgerRow[];
}

export interface Matching {
  matches: JournalMatch[];
  /** Ledger rows whose `created_at` matches no journal entry, oldest first. */
  unknown: LedgerRow[];
}

/**
 * Pair each journal entry with the ledger rows carrying its timestamp.
 *
 * Matched on `created_at` alone rather than on `(created_at, hash)` so that a
 * row with the right timestamp and the wrong hash comes back as a *changed*
 * migration rather than as one missing entry plus one mysterious extra. Two
 * reports of the same fact, one of them misleading, is how a real divergence
 * gets read as branch noise.
 */
export function matchJournalToLedger(
  journal: readonly JournalEntry[],
  rows: readonly LedgerRow[],
): Matching {
  const matched = new Set<LedgerRow>();
  const matches = journal.map((entry) => {
    const mine = rows.filter((r) => Number(r.created_at) === entry.when);
    for (const r of mine) matched.add(r);
    return { entry, rows: mine };
  });
  const unknown = rows
    .filter((r) => !matched.has(r))
    .slice()
    .sort((a, b) => Number(a.created_at) - Number(b.created_at));
  return { matches, unknown };
}

/* ------------------------------------------------------------------ */
/* The full reconciliation                                             */
/* ------------------------------------------------------------------ */

export interface ReconcileOptions {
  /**
   * May ledger rows this journal does not contain be tolerated?
   *
   * **Only on a laptop, and only once nothing is pending.** A developer's
   * database carries rows from migrations that were renumbered or deleted
   * before they were pushed, and those rows are below the watermark for ever;
   * blocking on them would block every future migration on that machine. But
   * while current entries are still pending, an unknown row may be the *same
   * DDL* under a different number, so applying the pending ones would fail or,
   * worse, half-succeed. Production gets no tolerance at all: an unknown row
   * there is a history nobody can account for. GPT Sol, 2026-08-31, § 4.
   */
  allowHistoricalExtras: boolean;
}

export interface Reconciliation {
  /** Journal entries with no ledger row, in journal order. */
  pending: JournalEntry[];
  /** Pending entries whose `when` cannot cross the watermark, so drizzle will never apply them. */
  unreachable: JournalEntry[];
  /** Ledger rows matching no journal entry, oldest first. */
  unknown: LedgerRow[];
  /** The number drizzle will compare against, or `null` for an empty ledger. */
  watermark: number | null;
  /**
   * Everything that makes the journal and the ledger irreconcilable. Empty
   * means it is safe to call `migrate()`; anything else means stop.
   */
  problems: string[];
}

/**
 * Can `migrate()` be trusted to do what it is about to claim it did?
 *
 * The five conditions are GPT Sol's, 2026-08-31 § 4, and condition 3 is the
 * one that catches the defect this was written for. A database through
 * `0034` is safe — `0035` and `0036` both clear its watermark even though
 * their timestamps are internally reversed. A database through `0035` is
 * broken, because `0036` never can.
 *
 * `hashes` maps a journal tag to the sha256 of its `.sql` file. A tag missing
 * from the map means the file could not be read, which is condition 5's
 * "missing SQL files" and is a problem here — unlike `ledgerDivergence`, which
 * reads files out of a git commit and stays quiet about what it cannot see.
 */
export function reconcileLedger(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
  rows: readonly LedgerRow[],
  opts: ReconcileOptions,
): Reconciliation {
  const problems: string[] = [...journalProblems(journal, hashes)];
  const watermark = watermarkOf(rows);
  const { matches, unknown } = matchJournalToLedger(journal, rows);

  const pending: JournalEntry[] = [];
  const known: JournalEntry[] = [];
  for (const m of matches) {
    if (m.rows.length === 0) {
      pending.push(m.entry);
      continue;
    }
    known.push(m.entry);
    if (m.rows.length > 1) {
      problems.push(
        `${m.entry.tag} has ${m.rows.length} ledger rows stamped ${m.entry.when} — it was recorded more than once`,
      );
      continue;
    }
    problems.push(...hashProblem(m.entry, m.rows[0]!, hashes));
  }

  /* 1 and 2: the applied entries must be a contiguous prefix in JOURNAL order,
     and the pending ones the remaining suffix. Journal order, not timestamp
     order, because the journal is the order the files are meant to run in and
     it is not sorted — 0035 sits before 0036 and is stamped later. */
  const firstPending = journal.findIndex((e) => pending.includes(e));
  if (firstPending >= 0) {
    const stragglers = known.filter((e) => journal.indexOf(e) > firstPending);
    if (stragglers.length > 0) {
      const gap = journal[firstPending]!;
      problems.push(
        `the applied migrations are not a prefix of the journal: ${gap.tag} has never run, ` +
          `yet ${stragglers.map((e) => e.tag).join(", ")} — which come after it — did`,
      );
    }
  }

  /* 3: the condition that catches the real bug. */
  const unreachable = pending.filter((e) => !crossesWatermark(e.when, watermark));
  if (unreachable.length > 0) {
    problems.push(
      `${unreachable.length} migration(s) can never be applied: the newest ledger row is stamped ` +
        `${watermark}, and drizzle only applies entries stamped after it — ` +
        unreachable.map((e) => `${e.tag} (${e.when})`).join(", "),
    );
  }

  if (unknown.length > 0 && (!opts.allowHistoricalExtras || pending.length > 0)) {
    problems.push(
      `${unknown.length} ledger row(s) belong to no migration in this journal: ` +
        unknown.map((r) => `${r.created_at}`).join(", ") +
        (opts.allowHistoricalExtras
          ? ` — and ${pending.length} migration(s) are still pending, one of which may be the same DDL under a ` +
            "new number. Work out what those rows did, and delete them once their effects are accounted for"
          : ""),
    );
  }

  return { pending, unreachable, unknown, watermark, problems };
}

/**
 * The journal on its own: no duplicates, no holes, and a file for every entry.
 *
 * Condition 5. Each of these makes every other judgement here meaningless
 * rather than merely wrong — two entries stamped the same millisecond cannot
 * both be matched to a ledger row, and a `when` is the only handle drizzle has.
 */
export function journalProblems(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];

  const byTag = new Map<string, number>();
  const byWhen = new Map<number, string[]>();
  for (const [i, e] of journal.entries()) {
    if (e.idx !== i) problems.push(`journal entry ${i} carries idx ${e.idx} — the indices are broken`);
    if (byTag.has(e.tag)) problems.push(`the journal names ${e.tag} twice`);
    byTag.set(e.tag, i);
    byWhen.set(e.when, [...(byWhen.get(e.when) ?? []), e.tag]);
    if (!hashes.has(e.tag)) problems.push(`${e.tag} is in the journal but its .sql file could not be read`);
  }
  for (const [when, tags] of byWhen) {
    if (tags.length > 1) problems.push(`${tags.join(" and ")} are both stamped ${when}`);
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* The journal as a file                                               */
/* ------------------------------------------------------------------ */

/** One inversion that is already published and must not be re-stamped. */
export interface GrandfatheredInversion {
  /** The entry that sits earlier in the journal and carries the LATER stamp. */
  after: string;
  afterWhen: number;
  /** The entry after it, carrying the earlier stamp. */
  before: string;
  beforeWhen: number;
}

/**
 * Entries stamped no later than something above them in the journal.
 *
 * **This is the file-level shape of the whole defect.** drizzle reads the
 * newest `created_at` once and applies only what is strictly greater, so an
 * entry stamped behind one above it cannot be applied on any database that has
 * already reached the higher stamp. drizzle-kit never generates one; they
 * arrive when a `when` is written by hand.
 *
 * The exemptions carry both names and both timestamps, so regenerating either
 * file takes the exemption away rather than silently inheriting it.
 */
export function journalInversions(
  journal: readonly JournalEntry[],
  grandfathered: readonly GrandfatheredInversion[] = [],
): string[] {
  const inversions: string[] = [];
  let highest = Number.NEGATIVE_INFINITY;
  let highestTag = "(nothing)";
  for (const e of journal) {
    if (e.when <= highest) {
      const excused = grandfathered.some(
        (g) => g.after === highestTag && g.afterWhen === highest && g.before === e.tag && g.beforeWhen === e.when,
      );
      if (!excused) {
        inversions.push(
          `${e.tag} is stamped ${e.when}, which is not after ${highestTag}'s ${highest} — ` +
            "drizzle will never apply it on a database that has already reached that stamp",
        );
      }
    }
    if (e.when > highest) {
      highest = e.when;
      highestTag = e.tag;
    }
  }
  return inversions;
}

/** The stored hash against the file's hash — the only thing that catches an edited migration. */
function hashProblem(
  entry: JournalEntry,
  row: LedgerRow,
  hashes: ReadonlyMap<string, string>,
): string[] {
  const want = hashes.get(entry.tag);
  if (!want || row.hash === want) return [];
  return [
    `${entry.tag} was applied from different SQL than the file now contains — ` +
      "a migration file was edited after it ran, and drizzle will never notice",
  ];
}

/**
 * After `migrate()`: every journal entry has exactly one row with its `when`
 * and its hash.
 *
 * **This is a metadata check and it is not sufficient.** It reads the ledger,
 * not the schema, so it is green by construction for anyone who inserts
 * bookkeeping rows by hand — which is precisely what the repair of this
 * defect had to do. It catches "the migrator said yes and applied nothing",
 * which is the failure it exists for; it cannot catch "the row is there and
 * the column is not". The independent effect checks are `npm run db:check`
 * and `src/db/schema-drift.ts`, and that file says in its own header which
 * things it does not cover. GPT Sol, 2026-08-31, § 6.
 */
export function postflightProblems(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
  rows: readonly LedgerRow[],
): string[] {
  const problems: string[] = [];
  const { matches } = matchJournalToLedger(journal, rows);
  for (const m of matches) {
    if (m.rows.length === 0) {
      problems.push(`${m.entry.tag} still has no ledger row after migrating — nothing applied it`);
      continue;
    }
    if (m.rows.length > 1) {
      problems.push(`${m.entry.tag} now has ${m.rows.length} ledger rows`);
      continue;
    }
    problems.push(...hashProblem(m.entry, m.rows[0]!, hashes));
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* The deploy-time history check                                       */
/* ------------------------------------------------------------------ */

/**
 * Is what the database has applied the beginning of what this commit contains?
 *
 * **The count moving by the right amount is not enough**, and this is the check
 * that says why. `migrate()` looks at the **single most recent** `created_at`
 * and applies every journal entry newer than it — it never compares the hashes
 * it has stored against the files in front of it. So a database that applied a
 * *different* `0016` (a migration that was edited after being applied, or a
 * history from another branch) is indistinguishable from a healthy one by
 * counting, and drizzle will happily carry on appending to it.
 *
 * Since the hash is `sha256` of the file's whole contents, an edited migration
 * changes it. Comparing the applied rows against the committed files is
 * therefore cheap and catches the whole class.
 *
 * `hashes` maps a journal tag to the sha256 of its `.sql` file **at the commit
 * being deployed** — not at whatever is on disk, which several agents are
 * editing. A tag missing from the map is a file this commit does not contain,
 * and this function stays quiet about it; `reconcileLedger` does not.
 */
export function ledgerDivergence(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
  rows: readonly LedgerRow[],
): string[] {
  const applied = [...rows].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  const expected = [...journal].sort((a, b) => a.when - b.when);
  const problems: string[] = [];

  for (const [i, row] of applied.entries()) {
    const entry = expected[i];
    if (!entry) {
      problems.push(
        `the database has applied ${applied.length - i} migration(s) beyond the ${expected.length} this commit contains`,
      );
      break;
    }
    if (Number(row.created_at) !== entry.when) {
      problems.push(
        `applied migration #${i + 1} is stamped ${row.created_at}, but this commit's ${entry.tag} is stamped ${entry.when}`,
      );
      break;
    }
    const want = hashes.get(entry.tag);
    if (want && row.hash !== want) {
      problems.push(
        `${entry.tag} was applied from different SQL than this commit contains — ` +
          "a migration file was edited after it ran, and drizzle will never notice",
      );
      break;
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* Reading the folder                                                  */
/* ------------------------------------------------------------------ */

/** The journal at `<folder>/meta/_journal.json`, in the order drizzle reads it. */
export function readJournal(folder: string): JournalEntry[] {
  const text = readFileSync(path.join(folder, "meta", "_journal.json"), "utf8");
  return (JSON.parse(text) as { entries: JournalEntry[] }).entries;
}

/**
 * tag → sha256 of the whole `.sql` file, computed exactly as drizzle computes
 * it: `createHash("sha256").update(<the file as a string>)`, no normalisation
 * (`node_modules/drizzle-orm/migrator.cjs`). A tag whose file is unreadable is
 * left out of the map rather than throwing, so the caller can report every
 * missing file at once instead of the first.
 */
export function hashMigrationFiles(
  folder: string,
  journal: readonly JournalEntry[],
): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const e of journal) {
    try {
      const sql = readFileSync(path.join(folder, `${e.tag}.sql`)).toString();
      hashes.set(e.tag, createHash("sha256").update(sql).digest("hex"));
    } catch {
      /* Left out on purpose — journalProblems() names it. */
    }
  }
  return hashes;
}

/* ------------------------------------------------------------------ */
/* The bookkeeping table                                               */
/* ------------------------------------------------------------------ */

/**
 * Must match `drizzle.config.ts` and the `migrate()` call in
 * `scripts/db-migrate.ts`. They are copies of one fact, and the migrator
 * silently starts a FRESH history if they disagree.
 */
export const MIGRATIONS_SCHEMA = "spideryarn_migrations";
export const MIGRATIONS_TABLE = "__drizzle_migrations";

/**
 * The advisory-lock key `db:migrate` holds for the whole run.
 *
 * Arbitrary, but fixed: any process that migrates this database must use this
 * same number or the lock protects nothing. drizzle takes no lock of its own,
 * so without this two invocations read the same watermark and both try the
 * same DDL — GPT Sol, 2026-08-31, closing paragraph.
 */
export const MIGRATION_LOCK_KEY = 260_831;
```

### scripts/db-repair-migration-ledger.ts (new, in full)
```ts
/**
 * Reconcile a database whose migration ledger drizzle can no longer reach.
 *
 *     npx tsx scripts/db-repair-migration-ledger.ts            # report only
 *     npx tsx scripts/db-repair-migration-ledger.ts --apply    # act
 *
 * **The fault this exists for.** drizzle's node-postgres migrator keeps a
 * *watermark*, not a ledger. It reads the single newest `__drizzle_migrations`
 * row once, before its loop, and then applies only journal entries whose `when`
 * is strictly greater — node_modules/drizzle-orm/pg-core/dialect.cjs, and the
 * comparison is `Number(lastDbMigration.created_at) < migration.folderMillis`.
 * A migration whose `when` is *below* that watermark is skipped for ever, in
 * silence, and `db:migrate` prints `✓ migrations applied` on its way past.
 *
 * Two ways in, both of which happened here on 2026-08-31:
 * a journal entry hand-written with a fabricated `when` later than its
 * neighbours (`0035_timeline`, `1788200000000`), and a branch whose own
 * generated migrations carried real timestamps newer than the published ones it
 * had not pulled yet. Either lifts the watermark over work that then cannot run.
 * docs/postmortems/260831h-db-migrate-applies-nothing-when-a-journal-timestamp-jumps-the-queue.md.
 *
 * **Why a replay is not a loop over the missing files.** `0033_quotes` ends by
 * re-adding `revision_step_runs_step` with a step list that predates `timeline`.
 * Running it verbatim on a database that already has `0035_timeline` fails on
 * the first `timeline` row, and would leave a constraint forbidding a step the
 * pipeline still runs. So each migration this script knows about carries its own
 * *reconciliation* — what has to be true before, what to do, and what must be
 * true after — and anything not in that table is refused rather than guessed at.
 * GPT Sol, 2026-08-31: docs/plans/260831ag-migration-watermark-repair-sol.md § 1.
 *
 * **What a repaired row means.** Where the reconciliation differs from the
 * historical SQL, the ledger row asserts *"this database has been brought to
 * this migration's postcondition"*, not *"these exact bytes ran here"*. That is
 * a weaker claim than an ordinary drizzle row and it is worth knowing when you
 * are reading the table later.
 *
 * **This is metadata surgery, so it does not trust itself.** Every effect is
 * probed in the catalogue before and after, in the same transaction as the
 * ledger inserts, and the whole thing rolls back together. A ledger check alone
 * would be green by construction — the script would be marking its own homework.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { MIGRATION_LOCK_KEY } from "./migration-ledger.js";
import { loadEnvLocal } from "../src/env.js";

/* Same precedence rule as db-migrate.ts, and for the same reason: the target of
   a repair is an argument, not configuration, so a `DATABASE_URL=…` on the
   command line must beat `.env.local` rather than being buried by it. That
   inversion is what once applied a remote migration to a laptop and said
   `✓`. src/env.ts § loadEnvLocal, and docs/reusable/silent-success.md. */
const fromShell = process.env.DATABASE_URL;
loadEnvLocal();
const url = fromShell ?? process.env.DATABASE_URL;

const APPLY = process.argv.includes("--apply");
const FORGET_ORPHANS = process.argv.includes("--forget-orphans");
const FOLDER = path.resolve(import.meta.dirname, "../drizzle");
const LEDGER = `"spideryarn_migrations"."__drizzle_migrations"`;

/* **The same advisory lock `db:migrate` takes**, imported rather than repeated,
   because a lock two processes spell differently serialises nothing — and a
   repair racing a migrate is exactly what it is for. drizzle takes no lock of
   its own. scripts/migration-ledger.ts owns the number. */
const ADVISORY_LOCK_KEY = MIGRATION_LOCK_KEY;

if (!url) {
  console.error("No DATABASE_URL. Set it in .env.local or pass it on the command line.");
  process.exit(1);
}
if (!isLocalDatabaseUrl(url) && process.env.DB_REPAIR_ALLOW_REMOTE !== "yes") {
  console.error(
    `DATABASE_URL does not look local: ${withoutPassword(url) ?? "(unparsable)"}\n` +
      "  Set DB_REPAIR_ALLOW_REMOTE=yes if you really mean it, and read\n" +
      "  docs/plans/260831ag-migration-watermark-repair-sol.md § 5 first — the\n" +
      "  production runbook has steps before this one.",
  );
  process.exit(1);
}

/** A probe that answers a single yes/no about the live catalogue. */
type Probe = { what: string; sql: string; want: boolean };

/**
 * What this script knows how to reconcile.
 *
 * `effects` are the postconditions — probed before, to decide whether any DDL is
 * needed at all, and again after, to prove it happened. `repair` runs only when
 * an effect is missing. `refuseIf` is the starting-state assumption: if one of
 * these answers rows, the database is not in the state this reconciliation was
 * written for and we stop rather than improvise.
 */
type Reconciliation = {
  tag: string;
  why: string;
  effects: Probe[];
  refuseIf: { what: string; sql: string }[];
  repair: string[];
};

const columnExists = (table: string, column: string) =>
  `select 1 from information_schema.columns where table_schema='spideryarn'` +
  ` and table_name='${table}' and column_name='${column}'`;

const RECONCILIATIONS: Reconciliation[] = [
  {
    tag: "0032_jobs_concurrency_cap",
    why: "Verbatim. One DROP INDEX, nothing to back-fill.",
    effects: [
      {
        what: "jobs_only_one_running index is gone",
        sql: `select 1 from pg_indexes where schemaname='spideryarn' and indexname='jobs_only_one_running'`,
        want: false,
      },
    ],
    refuseIf: [],
    repair: [`DROP INDEX "spideryarn"."jobs_only_one_running"`],
  },
  {
    tag: "0033_quotes",
    why:
      "RECONCILED, not verbatim. The file's third statement re-adds " +
      "revision_step_runs_step with a step list written before `timeline` existed. " +
      "Replaying it after 0035_timeline rejects every timeline row (23514), and if " +
      "it did succeed it would forbid a step the pipeline still runs until 0036 " +
      "put it back. Only the column is taken; 0036 installs the correct final CHECK.",
    effects: [
      {
        what: "article_revisions.quotes exists",
        sql: columnExists("article_revisions", "quotes"),
        want: true,
      },
    ],
    refuseIf: [
      {
        what: "article_revisions.quotes exists but is not nullable jsonb",
        sql:
          `select data_type, is_nullable from information_schema.columns` +
          ` where table_schema='spideryarn' and table_name='article_revisions'` +
          ` and column_name='quotes' and not (data_type='jsonb' and is_nullable='YES')`,
      },
    ],
    repair: [`ALTER TABLE "spideryarn"."article_revisions" ADD COLUMN "quotes" jsonb`],
  },
  {
    tag: "0034_flowery_wolfsbane",
    why: "Verbatim. Two ADD COLUMNs on chat_messages.",
    effects: [
      {
        what: "chat_messages.passages exists",
        sql: columnExists("chat_messages", "passages"),
        want: true,
      },
      {
        what: "chat_messages.interrupted exists",
        sql: columnExists("chat_messages", "interrupted"),
        want: true,
      },
    ],
    /* One present and one absent is a partial state somebody made by hand, not
       permission to replay the pair — the second statement would fail and take
       the transaction with it, which is the good outcome, but saying why up
       front is better than a 42701 nobody expected. Sol § 1. */
    refuseIf: [
      {
        what: "exactly one of chat_messages.passages / .interrupted exists",
        sql:
          `select 1 from (select count(*) n from information_schema.columns` +
          ` where table_schema='spideryarn' and table_name='chat_messages'` +
          ` and column_name in ('passages','interrupted')) c where c.n = 1`,
      },
      /* Type, nullability and default each checked, because on this laptop the
         columns arrived from `drizzle-kit push` rather than from this migration,
         and "a column of that name exists" is not the same claim as "this
         migration's postcondition holds". Sol § 1. */
      {
        what: "chat_messages.passages exists but is not nullable jsonb",
        sql:
          `select data_type, is_nullable from information_schema.columns` +
          ` where table_schema='spideryarn' and table_name='chat_messages'` +
          ` and column_name='passages' and not (data_type='jsonb' and is_nullable='YES')`,
      },
      {
        what: "chat_messages.interrupted exists but is not boolean not-null default false",
        sql:
          `select data_type, is_nullable, column_default from information_schema.columns` +
          ` where table_schema='spideryarn' and table_name='chat_messages'` +
          ` and column_name='interrupted' and not (data_type='boolean'` +
          ` and is_nullable='NO' and column_default='false')`,
      },
    ],
    repair: [
      `ALTER TABLE "spideryarn"."chat_messages" ADD COLUMN "passages" jsonb`,
      `ALTER TABLE "spideryarn"."chat_messages" ADD COLUMN "interrupted" boolean DEFAULT false NOT NULL`,
    ],
  },
  {
    tag: "0036_drop_summary_column",
    why:
      "Verbatim, and it is the destructive one: it DELETEs the summary step runs " +
      "and DROPs article_revisions.summary. Its final CHECK is the correct end " +
      "state — it is the one that has both `quotes` and `timeline` in it.",
    effects: [
      {
        what: "article_revisions.summary is gone",
        sql: columnExists("article_revisions", "summary"),
        want: false,
      },
      {
        what: "revision_step_runs_step CHECK no longer allows 'summary'",
        sql:
          `select 1 from pg_constraint where conname='revision_step_runs_step'` +
          ` and pg_get_constraintdef(oid) like '%''summary''%'`,
        want: false,
      },
    ],
    /* The DELETE covers `summary` and nothing else, so any OTHER value outside
       the final list would fail the ADD CONSTRAINT. Finding one means the
       starting state is not what this reconciliation assumes; Sol § 2 is
       explicit that the answer then is to stop, not to widen the DELETE. */
    refuseIf: [
      {
        what: "revision_step_runs holds a step_name the new CHECK would reject and 0036 does not delete",
        sql:
          `select distinct step_name from "spideryarn"."revision_step_runs"` +
          ` where step_name not in ('fetch','extract','blocks','toc','assets','arc',` +
          `'tweets','glossary','quotes','ideas','timeline','sketch','summary')`,
      },
      {
        what: "something in the catalogue still depends on article_revisions.summary",
        sql:
          `select viewname from pg_views where schemaname='spideryarn'` +
          ` and definition like '%summary%'`,
      },
    ],
    repair: [
      `ALTER TABLE "spideryarn"."revision_step_runs" DROP CONSTRAINT "revision_step_runs_step"`,
      `DELETE FROM "spideryarn"."revision_step_runs" WHERE "step_name" = 'summary'`,
      `ALTER TABLE "spideryarn"."article_revisions" DROP COLUMN "summary"`,
      `ALTER TABLE "spideryarn"."revision_step_runs" ADD CONSTRAINT "revision_step_runs_step" ` +
        `CHECK ("spideryarn"."revision_step_runs"."step_name" in ('fetch','extract','blocks',` +
        `'toc','assets','arc','tweets','glossary','quotes','ideas','timeline','sketch'))`,
    ],
  },
  {
    tag: "0037_experimental_features_and_callout_blocks",
    why:
      "Usually reconcile-only on a laptop that had the two pre-renumbering local " +
      "migrations: their effects are already here under ledger rows whose files no " +
      "longer exist. Elsewhere — production — nothing has run and the DDL is needed.",
    effects: [
      {
        what: "reader_profiles.experimental_since exists",
        sql: columnExists("reader_profiles", "experimental_since"),
        want: true,
      },
      {
        what: "revision_blocks_kind CHECK allows 'callout'",
        sql:
          `select 1 from pg_constraint where conname='revision_blocks_kind'` +
          ` and pg_get_constraintdef(oid) like '%''callout''%'`,
        want: true,
      },
    ],
    refuseIf: [],
    repair: [
      `ALTER TABLE "spideryarn"."revision_blocks" DROP CONSTRAINT "revision_blocks_kind"`,
      `ALTER TABLE "spideryarn"."reader_profiles" ADD COLUMN "experimental_since" timestamp with time zone`,
      `ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_kind" ` +
        `CHECK ("spideryarn"."revision_blocks"."kind" in ('heading','text','quote','callout',` +
        `'code','media','caption','other'))`,
    ],
  },
  {
    tag: "0038_block_contexts",
    why:
      "Another session's migration, whose columns and both CHECKs arrived here from " +
      "`drizzle-kit push` rather than from the file — so the postcondition holds and the " +
      "ledger row does not exist. Reconcile-only where that is true; the DDL is the " +
      "file's, verbatim, for anywhere it is not. If that file is edited later its hash " +
      "changes and the guard will say so, which is the right noise to make.",
    effects: [
      {
        what: "revision_blocks.context_id exists",
        sql: columnExists("revision_blocks", "context_id"),
        want: true,
      },
      {
        what: "revision_blocks.context_type exists",
        sql: columnExists("revision_blocks", "context_type"),
        want: true,
      },
      {
        what: "revision_blocks_context CHECK exists",
        sql: `select 1 from pg_constraint where conname='revision_blocks_context'`,
        want: true,
      },
      {
        what: "revision_blocks_context_type CHECK exists",
        sql: `select 1 from pg_constraint where conname='revision_blocks_context_type'`,
        want: true,
      },
    ],
    refuseIf: [],
    repair: [
      `ALTER TABLE "spideryarn"."revision_blocks" ADD COLUMN "context_id" text`,
      `ALTER TABLE "spideryarn"."revision_blocks" ADD COLUMN "context_type" text`,
      `ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_context" ` +
        `CHECK (("spideryarn"."revision_blocks"."context_id" is null) = ` +
        `("spideryarn"."revision_blocks"."context_type" is null))`,
      `ALTER TABLE "spideryarn"."revision_blocks" ADD CONSTRAINT "revision_blocks_context_type" ` +
        `CHECK ("spideryarn"."revision_blocks"."context_type" is null or ` +
        `"spideryarn"."revision_blocks"."context_type" in ('callout'))`,
    ],
  },
];

type JournalEntry = { idx: number; tag: string; when: number };

/** The journal, with each entry's hash computed the way drizzle computes it. */
function readJournal(): (JournalEntry & { hash: string })[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(FOLDER, "meta", "_journal.json"), "utf8"),
  ) as { entries: JournalEntry[] };
  return journal.entries.map((e) => {
    /* sha256 of the whole file text, exactly as drizzle-orm/migrator.cjs does
       it. Computed, never hand-copied: a transcription error here writes a row
       that looks applied to the ledger check and re-runs under drizzle. */
    const sql = fs.readFileSync(path.join(FOLDER, `${e.tag}.sql`), "utf8");
    return { ...e, hash: crypto.createHash("sha256").update(sql).digest("hex") };
  });
}

async function main() {
  const ssl = sslDecisionFor(url!);
  const client = new Client({ connectionString: url!, ssl: ssl.ssl });
  await client.connect();

  /* Say which database, every time, before saying anything else. Which one a
     command actually reaches is not always the one on its command line, and both
     mistakes print the same success — docs/project/database.md. */
  const target = (await client.query<{ db: string; host: string }>(
    "select current_database() db, inet_server_addr()::text host",
  )).rows[0];
  console.log(`Target: ${withoutPassword(url!)}`);
  console.log(`        database=${target?.db} server=${target?.host ?? "local socket"}`);
  console.log(APPLY ? "Mode:   APPLY (will write)\n" : "Mode:   report only (no writes)\n");

  const rows = await client.query<{ hash: string; created_at: string }>(
    `select hash, created_at from ${LEDGER}`,
  );
  const applied = new Map(rows.rows.map((r) => [String(r.created_at), r.hash]));
  const journal = readJournal();
  const watermark = rows.rows.length
    ? Math.max(...rows.rows.map((r) => Number(r.created_at)))
    : -1;

  /* The whole fault in one list: entries drizzle can never reach, because their
     `when` is at or below the newest row it will compare them against. */
  const unreachable = journal.filter((e) => !applied.has(String(e.when)) && e.when <= watermark);
  const pending = journal.filter((e) => !applied.has(String(e.when)) && e.when > watermark);
  const extras = [...applied.keys()].filter((w) => !journal.some((e) => String(e.when) === w));

  console.log(`Ledger has ${rows.rows.length} rows; watermark ${watermark}.`);
  console.log(`Journal has ${journal.length} entries.`);
  console.log(`\nUNREACHABLE (drizzle will skip these for ever) — ${unreachable.length}:`);
  for (const e of unreachable) console.log(`   ${e.idx} ${e.tag} (when ${e.when})`);
  console.log(`\nPending, and reachable by an ordinary db:migrate — ${pending.length}:`);
  for (const e of pending) console.log(`   ${e.idx} ${e.tag} (when ${e.when})`);
  console.log(`\nLedger rows matching no current journal entry — ${extras.length}:`);
  for (const w of extras) console.log(`   created_at ${w} (a migration file that no longer exists)`);

  /* Deliberately not "nothing unreachable, so nothing to do". Two other states
     also need this script: a pending migration whose work is already done (which
     an ordinary `db:migrate` would die on), and orphan rows that keep the
     preflight refusing. The early exit belongs after those have been worked out,
     not before. */

  const unknown = unreachable.filter((e) => !RECONCILIATIONS.some((r) => r.tag === e.tag));
  if (unknown.length) {
    console.error(
      `\nRefusing: no reconciliation is written for ${unknown.map((e) => e.tag).join(", ")}.\n` +
        "  A migration cannot be replayed blindly — 0033_quotes is the proof, and the\n" +
        "  reasoning is in this file's header. Write a Reconciliation for it first.",
    );
    await client.end();
    process.exit(1);
  }

  /**
   * **A pending migration whose work is already done is the other half of this
   * fault, and it bites the moment the first half is fixed.**
   *
   * `0037` here is the two pre-renumbering local migrations rolled into one. Its
   * `when` is above the watermark, so drizzle *will* reach it — and its first
   * statement adds a column that is already there, so `db:migrate` dies with a
   * 42701 that reads like a broken migration. The database is right and the
   * ledger is wrong, so the ledger is what gets fixed: a row, no DDL.
   *
   * Only when **every** effect is already present. One of two columns existing is
   * a partial state, and that belongs to `refuseIf`, not here. Anything pending
   * that this script has no reconciliation for is left alone — an ordinary
   * `db:migrate` is exactly what should run it.
   */
  const alreadyDone: Reconciliation[] = [];
  for (const e of pending) {
    const r = RECONCILIATIONS.find((x) => x.tag === e.tag);
    if (!r) continue;
    /* Sequential, not `Promise.all`: one `pg.Client` is a single connection and
       overlapping queries on it are deprecated and serialised behind the
       scenes anyway. */
    let allPresent = true;
    for (const eff of r.effects) {
      if (((await client.query(eff.sql)).rowCount! > 0) !== eff.want) allPresent = false;
    }
    if (allPresent) alreadyDone.push(r);
  }
  if (alreadyDone.length) {
    console.log(`\nPending, but already done — ledger row only, no DDL:`);
    for (const r of alreadyDone) console.log(`   ${r.tag}`);
  }

  const plan = RECONCILIATIONS.filter(
    (r) => unreachable.some((e) => e.tag === r.tag) || alreadyDone.includes(r),
  );

  if (!plan.length && !(FORGET_ORPHANS && extras.length)) {
    console.log("\nNothing to reconcile. No repair needed.");
    await client.end();
    return;
  }

  console.log("\n── Preconditions ───────────────────────────────────────────");
  let refused = false;
  for (const r of plan) {
    for (const g of r.refuseIf) {
      const res = await client.query(g.sql);
      if (res.rowCount) {
        console.error(`   REFUSE ${r.tag}: ${g.what}`);
        console.error(`          ${JSON.stringify(res.rows)}`);
        refused = true;
      }
    }
  }
  if (refused) {
    console.error("\nStarting state is not what these reconciliations were written for. Stopping.");
    await client.end();
    process.exit(1);
  }
  console.log("   all clear");

  console.log("\n── What each one needs ─────────────────────────────────────");
  const work: { r: Reconciliation; needsDdl: boolean }[] = [];
  for (const r of plan) {
    const missing: string[] = [];
    for (const e of r.effects) {
      const got = (await client.query(e.sql)).rowCount! > 0;
      if (got !== e.want) missing.push(e.what);
    }
    work.push({ r, needsDdl: missing.length > 0 });
    console.log(`   ${r.tag}: ${missing.length ? `DDL needed — ${missing.join("; ")}` : "effects already present, ledger row only"}`);
  }

  /* What 0036 is about to destroy, counted and shown before it happens rather
     than reported afterwards. Greg authorised dropping this column when he wrote
     the migration ("we don't care about the data we have right now"), but a
     number on the screen is what makes that an informed authorisation. */
  if (plan.some((r) => r.tag === "0036_drop_summary_column")) {
    const runs = await client.query(
      `select count(*)::int n from "spideryarn"."revision_step_runs" where step_name='summary'`,
    );
    const cols = await client.query(
      `select count(*)::int n from "spideryarn"."article_revisions" where summary is not null`,
    );
    console.log(
      `\n   0036 will DELETE ${runs.rows[0].n} summary step run(s) and DROP a summary ` +
        `column holding ${cols.rows[0].n} non-null value(s).`,
    );
  }

  if (!APPLY) {
    console.log("\nReport only. Re-run with --apply to do it.");
    await client.end();
    return;
  }

  console.log("\n── Applying, in one transaction ────────────────────────────");
  await client.query(`select pg_advisory_lock(${ADVISORY_LOCK_KEY})`);
  try {
    await client.query("begin");
    for (const { r, needsDdl } of work) {
      if (needsDdl) {
        for (const sql of r.repair) {
          console.log(`   ${r.tag}: ${sql.slice(0, 88)}${sql.length > 88 ? "…" : ""}`);
          await client.query(sql);
        }
      }
      const e = journal.find((j) => j.tag === r.tag)!;
      await client.query(`insert into ${LEDGER} ("hash", "created_at") values ($1, $2)`, [
        e.hash,
        e.when,
      ]);
      console.log(`   ${r.tag}: ledger row inserted (created_at ${e.when})`);
    }

    /* Prove it inside the transaction, so a failed postcondition rolls the whole
       repair back rather than leaving a half-reconciled database behind a
       ledger that claims otherwise. */
    for (const { r } of work) {
      for (const eff of r.effects) {
        const got = (await client.query(eff.sql)).rowCount! > 0;
        if (got !== eff.want) throw new Error(`postcondition failed for ${r.tag}: ${eff.what}`);
      }
    }
    await client.query("commit");
    console.log("\n✓ committed");
  } catch (err) {
    await client.query("rollback");
    console.error(`\n✗ rolled back: ${(err as Error).message}`);
    await client.query(`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
    await client.end();
    process.exit(1);
  }
  await client.query(`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);

  /**
   * **Ledger rows belonging to no migration in this journal.**
   *
   * Here they are the two pre-renumbering local migrations, whose `.sql` files
   * were deleted when they became `0037`. Their *effects* are still in the
   * database and are now claimed by `0037`'s row, so the old rows assert nothing
   * that is not already asserted — but the preflight in `scripts/db-migrate.ts`
   * refuses while they exist alongside anything pending, which is Sol's § 4
   * policy and correct: a row nobody can account for might be a branch's
   * migration that overlaps what is about to run.
   *
   * So they are forgotten only when **every** journal entry is reconciled — at
   * which point "unaccounted for" has become "historical" — and only when asked
   * for by name, because deleting ledger rows is not something to do as a side
   * effect of a repair.
   */
  if (FORGET_ORPHANS && extras.length) {
    const after = await client.query<{ created_at: string }>(
      `select created_at from ${LEDGER}`,
    );
    const nowApplied = new Set(after.rows.map((r) => String(r.created_at)));
    const stillMissing = journal.filter((e) => !nowApplied.has(String(e.when)));
    if (stillMissing.length) {
      console.log(
        `\nNot forgetting the ${extras.length} orphan row(s): ${stillMissing.length} journal ` +
          `entr(ies) are still unapplied (${stillMissing.map((e) => e.tag).join(", ")}).\n` +
          "  An unaccounted-for row is only safely historical once nothing is pending.",
      );
    } else {
      const res = await client.query(
        `delete from ${LEDGER} where created_at = any($1::bigint[])`,
        [extras],
      );
      console.log(`\nForgot ${res.rowCount} orphan ledger row(s): ${extras.join(", ")}`);
      console.log("  Their effects are claimed by 0037's row; nothing about the schema changed.");
    }
  }

  /* Again, after the commit, on a fresh read. The check above ran inside the
     transaction that made the change; this one is the state anybody else would
     now see. */
  console.log("\n── Re-probed after commit ──────────────────────────────────");
  for (const { r } of work) {
    for (const eff of r.effects) {
      const got = (await client.query(eff.sql)).rowCount! > 0;
      console.log(`   ${got === eff.want ? "ok  " : "FAIL"} ${r.tag}: ${eff.what}`);
    }
  }
  await client.end();
}

await main();
```

### scripts/db-corpus-readiness.ts (new, in full)
```ts
/**
 * Is this database's corpus in a state the store flip can survive?
 *
 *     npx tsx scripts/db-corpus-readiness.ts
 *     npx tsx scripts/db-corpus-readiness.ts --seed-a-bad-row   # prove it can fail
 *
 * Stage 2.5 of docs/plans/260831b-finish-the-database-move.md says what "ready"
 * means and why, and its own words are the reason this is a script rather than
 * two queries somebody remembers to paste: *"proved by running them, not by a
 * command having reported success. A refetch that silently skipped an article
 * looks exactly like one that worked."* It is also the check production needs
 * before its own flip, and there is nobody to paste anything there.
 *
 * **It reads and reports. It changes nothing** — except under
 * `--seed-a-bad-row`, which exists so the checks can be watched failing; see
 * the bottom of this file.
 *
 * ## The two things it establishes
 *
 * **1. No revision has stamped HTML and no extracted HTML.** That pair is the
 * importer's signature: src/store/import.ts writes `extractedHtml: null` while
 * setting `stampedHtml`, and draft creation carries both columns forward. After
 * the flip a `blocks`-only job over such a revision copies `extractedHtml =
 * null` and has **no `BLOCKS_INPUT_HTML` to run from at all** — not a degraded
 * result, no input. It also contradicts src/blocks.ts, which claims no such
 * state exists. It does; the importer makes it.
 *
 * **2. Every stored source reference resolves to an object we can actually
 * read.** A revision names its source by `raw_source_sha256` + `raw_source_kind`
 * and the bytes live in the `sources` bucket. `blobStore()` follows the
 * credentials, and this corpus was written across two stores, so half of it once
 * named objects the reading process could not see —
 * docs/postmortems/260831e-a-write-path-with-no-reader.md. Stage 2c made that
 * loud, so a reference with nothing behind it now refuses `extract` rather than
 * quietly serving a 404.
 *
 * Both are reported per-article, because a count cannot be acted on: the whole
 * point is knowing *which* article to re-add.
 */

import { Client } from "pg";

import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { canonicalKey } from "../src/source.js";
import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";

/* Shell beats file, same as db-migrate.ts and db-repair-migration-ledger.ts: the
   target of a check is an argument, not configuration. */
const fromShell = process.env.DATABASE_URL;
loadEnvLocal();
const url = fromShell ?? process.env.DATABASE_URL;
const SEED_BAD = process.argv.includes("--seed-a-bad-row");

if (!url) {
  console.error("No DATABASE_URL.");
  process.exit(1);
}

async function main() {
  const ssl = sslDecisionFor(url!);
  const client = new Client({ connectionString: url!, ssl: ssl.ssl });
  await client.connect();

  const where = (await client.query<{ db: string }>("select current_database() db")).rows[0];
  console.log(`Target: ${withoutPassword(url!)}  (database=${where?.db})`);
  console.log(`        ${isLocalDatabaseUrl(url!) ? "local" : "REMOTE"}\n`);

  let seeded: string | null = null;
  if (SEED_BAD) {
    if (!isLocalDatabaseUrl(url!)) {
      console.error("--seed-a-bad-row writes. Refusing against a database that is not local.");
      process.exit(1);
    }
    /* **The negative control, inside a transaction that is always rolled back.**
       A check nobody has watched fail is not evidence
       (docs/reusable/silent-success.md), and both checks below are of the kind
       that pass trivially on an empty corpus — which is exactly what a botched
       refetch leaves behind. So this makes one real row bad, runs the checks
       against it, and undoes it: the proof costs nothing and the corpus is not
       damaged to obtain it. An earlier version of this left the row broken,
       which would have made the next green run meaningless. */
    await client.query("begin");
    const row = await client.query<{ id: string }>(
      `update spideryarn.article_revisions
          set stamped_html = coalesce(stamped_html, '<p>seeded</p>'), extracted_html = null
        where id = (select id from spideryarn.article_revisions limit 1)
      returning id`,
    );
    seeded = row.rows[0]?.id ?? null;
    console.log(
      seeded
        ? `Seeded a bad row inside a transaction: revision ${seeded}.\n` +
            "**Check 1 only.** This seed makes a revision look importer-written; it does\n" +
            "not corrupt a source reference, so check 2 stays green and is NOT proved by\n" +
            "this flag. Check 2's control would mean deleting an object out of the bucket,\n" +
            "which a rollback cannot undo — so it is honestly unproven rather than\n" +
            "quietly assumed. The transaction is rolled back before exit.\n"
        : "Nothing to seed — the corpus is empty, so this proves nothing.\n",
    );
  }

  let bad = 0;

  /* ── 1. the importer's signature ─────────────────────────────────────── */
  const orphaned = await client.query<{ slug: string; id: string }>(
    `select a.slug, r.id from spideryarn.article_revisions r
       join spideryarn.articles a on a.id = r.article_id
      where r.stamped_html is not null and r.extracted_html is null
      order by a.slug`,
  );
  console.log(`1. Revisions with stamped HTML and no extracted HTML — ${orphaned.rowCount}`);
  for (const r of orphaned.rows) console.log(`     ${r.slug}  (revision ${r.id})`);
  if (orphaned.rowCount) {
    bad++;
    console.log("     ^ these have no input for stage 3 after the flip. Re-add them.");
  }

  /* ── 2. every reference resolves ─────────────────────────────────────── */
  const refs = await client.query<{ slug: string; sha: string; kind: string }>(
    `select a.slug, r.raw_source_sha256 sha, r.raw_source_kind kind
       from spideryarn.article_revisions r
       join spideryarn.articles a on a.id = r.article_id
      where r.raw_source_sha256 is not null
      order by a.slug`,
  );
  /* The same `blobStore()` the reading path uses, rather than a hand-built URL —
     the fault this check exists for was two processes selecting *different*
     stores, so a probe that picked its own would be able to miss it entirely. */
  const blobs = blobStore();
  const missing: string[] = [];
  for (const r of refs.rows) {
    const key = canonicalKey(r.sha, r.kind as keyof typeof CONTENT_TYPE);
    const head = await blobs.head(key).catch(() => null);
    if (!head) missing.push(`${r.slug}  -> ${key}`);
  }
  console.log(`\n2. Source references — ${refs.rowCount} checked, ${missing.length} unreadable`);
  for (const m of missing) console.log(`     ${m}`);
  if (missing.length) {
    bad++;
    console.log("     ^ the row asserts an object that is not there. Re-add these.");
  }

  const total = await client.query<{ n: number }>(
    `select count(*)::int n from spideryarn.articles`,
  );
  console.log(`\nCorpus: ${total.rows[0]?.n ?? 0} article(s).`);

  if (seeded) {
    await client.query("rollback");
    console.log(`\nRolled back. Revision ${seeded} is as it was.`);
    console.log(
      bad
        ? "The checks saw the seeded fault, so they can fail. That is what this flag is for."
        : "⚠ THE CHECKS DID NOT SEE THE SEEDED FAULT. They cannot fail, so a green run\n" +
            "  from them means nothing. Fix the check before trusting it.",
    );
    await client.end();
    /* Deliberately inverted: under --seed-a-bad-row, finding the fault is the
       success and a clean report is the failure. */
    process.exit(bad ? 0 : 1);
  }

  console.log(bad ? `\n✗ NOT READY — ${bad} of 2 checks failed.` : "\n✓ ready");
  await client.end();
  process.exit(bad ? 1 : 0);
}

await main();
```
