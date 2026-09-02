/**
 * Apply the migrations in `drizzle/` to the database in `DATABASE_URL`.
 *
 *     npm run db:migrate
 *
 * **Why this exists rather than `drizzle-kit migrate`.** drizzle-kit reads its
 * connection from `drizzle.config.ts`, and putting credentials there would also
 * hand them to `drizzle-kit push` — the one command that must never reach a
 * database that matters, because it introspects a live schema and computes a
 * diff against the TypeScript. Keeping the config credential-free makes `push`
 * fail with "no connection" instead of relying on everyone remembering not to
 * run it. That is the difference between a rule and a guard rail.
 *
 * See docs/plans/260825f-postgres-migration.md and docs/project/supabase-local.md.
 *
 * A migration connection is a **direct or session** connection, never the
 * transaction pooler on 6543: DDL and the migrator's own bookkeeping want a
 * session. Locally that distinction does not exist — there is one Postgres on
 * 54362 — so this is a rule that only ever bites against the remote.
 *
 * And against the remote there is a second trap in front of it. Supabase's
 * direct host, `db.<ref>.supabase.co:5432`, is **IPv6-only** unless the paid
 * IPv4 add-on is on. From an IPv4-only network — Vercel is one — it does not
 * resolve. The IPv4 path is the shared pooler at
 * `aws-0-<region>.pooler.supabase.com`, whose username carries the project ref
 * (`postgres.<ref>`) rather than being plain `postgres`, and whose SESSION port
 * is the one to use here. So "use the direct connection" and "use IPv4" can be
 * in conflict, and the session pooler is what satisfies both.
 */

import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";

import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";
import {
  hashMigrationFiles,
  MIGRATION_LOCK_KEY,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  postflightProblems,
  readJournal,
  reconcileLedger,
  type LedgerRow,
} from "./migration-ledger.js";
import { HISTORICAL, readSnapshots, snapshotProblems } from "./migration-snapshots.js";

/**
 * **The shell's `DATABASE_URL`, read before `.env.local` can bury it.**
 *
 * `loadEnvLocal()` deliberately lets the *file* beat the shell — src/env.ts
 * explains why, and for the app it is right: a stale export in somebody's
 * profile should not quietly reconfigure the server. But this script is not the
 * app. Its target is an **argument**, not configuration, and the documented
 * recipe in .env.prod is
 *
 *     DATABASE_URL=<remote> DB_MIGRATE_ALLOW_REMOTE=yes npm run db:migrate
 *
 * which, until 2026-08-27, did not do that. `.env.local` overrode it, the
 * remote check below saw `127.0.0.1`, the guard was satisfied, and the migrator
 * applied the migrations **to the laptop** and printed `\u2713 migrations applied`.
 * The remote stayed four migrations behind while the command that was supposed
 * to move it reported success — docs/reusable/silent-success.md, and the whole
 * failure it describes: the check shared an assumption with the code.
 *
 * Read here rather than fixed in src/env.ts because the precedence rule there
 * is right for every other caller. This is the one place the shell means it.
 */
const fromShell = process.env.DATABASE_URL;

loadEnvLocal();

const url = fromShell ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "  Local: npm run db:start, then it comes from .env.local.\n" +
      "  See docs/project/supabase-local.md.",
  );
  process.exit(1);
}

/**
 * **Say out loud which database is about to change.**
 *
 * One line, and it is the line that would have made the accident above visible
 * the moment it happened rather than a day later on somebody's homepage. The
 * host, the port and the user are what distinguish "the laptop" from
 * "production", and none of them is a secret.
 */
const target = withoutPassword(url);
console.log(`Target: ${target ?? "(a DATABASE_URL that is not a parsable URL)"}`);

/**
 * Refuse to run against anything that is not obviously local unless told twice.
 * There is no remote project yet, so today this only ever fires by accident —
 * which is exactly when you want it to.
 */
const isLocal = isLocalDatabaseUrl(url);
if (!isLocal && process.env.DB_MIGRATE_ALLOW_REMOTE !== "yes") {
  /* Was `url.replace(/:\/\/[^@]*@/, "://***@")`, which had the same first-`@`
     weakness as the `Target:` line above and printed the tail of a password
     containing one. One redactor, used by both. */
  const shown = withoutPassword(url) ?? "(unparsable)";
  console.error(
    `DATABASE_URL does not look local: ${shown}\n` +
      "  Set DB_MIGRATE_ALLOW_REMOTE=yes if you really mean it.",
  );
  process.exit(1);
}

/**
 * SSL, decided in src/db/ssl.ts so that the migrator and the running app cannot
 * disagree about whether the server gets verified.
 *
 * **Verified against the real host, 2026-08-25.** A run at
 * `db.alschkahzfagtppxspfq.supabase.co:5432` with a deliberately wrong password
 * reached "password authentication failed" — which can only happen after the
 * TLS handshake completes, so the certificate really does verify Supabase's
 * server. That is the useful shape for this kind of check: an error from the
 * layer *above* the one you are testing is proof the layer under it worked.
 *
 * A CLI warns and carries on; a server should be louder. That choice is the
 * caller's, which is why `sslDecisionFor` returns a decision rather than
 * applying one.
 */
const ssl = sslDecisionFor(url);
if (ssl.mode === "encrypted-unverified") {
  console.warn(`\u26a0 ${ssl.why}`);
}

/**
 * Two connections, on purpose.
 *
 * One of them holds a **session advisory lock** for the whole run and is never
 * given back to the pool; the other is what `migrate()` uses. drizzle takes no
 * lock of its own, so without this two invocations read the same watermark and
 * both attempt the same DDL — one of them fails halfway through with something
 * that reads like a broken migration. GPT Sol, 2026-08-31.
 */
const pool = new Pool({ connectionString: url, max: 2, ssl: ssl.ssl });

/** The ledger, or an empty one when the bookkeeping table does not exist yet. */
async function readLedger(client: PoolClient): Promise<LedgerRow[]> {
  const there = await client.query<{ oid: string | null }>(
    "select to_regclass($1)::text as oid",
    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
  );
  /* Asked rather than caught. A first run against an empty database is not an
     error, and swallowing an error to find that out would also swallow
     "permission denied for schema spideryarn_migrations" — which is what the
     WRONG credential says, and which must not be read as "nothing applied
     yet". docs/project/database.md § The migration role that cannot exist. */
  if (!there.rows[0]?.oid) return [];
  const r = await client.query<LedgerRow>(
    `select hash, created_at from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by created_at asc`,
  );
  return r.rows;
}

/**
 * Say what is wrong, then leave.
 *
 * **Two situations, and they must not share a sentence.** The preflight runs
 * before any DDL and nothing has happened yet; the postflight runs after
 * `migrate()` has *committed*, so telling the reader "nothing has changed"
 * there would be a lie about the one thing they need to know. One message did
 * both jobs until GPT Sol pointed at it, 2026-08-31 — and the wrong half of it
 * is the reassuring half, which is the direction that costs.
 */
function refuse(
  headline: string,
  problems: readonly string[],
  aftermath: "nothing-ran" | "migrate-already-committed",
): never {
  console.error(`\n✗ ${headline}`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    aftermath === "nothing-ran"
      ? "\nNo migration has been applied and nothing has changed.\n" +
          "  docs/project/database.md § A watermark is not a ledger."
      : "\n⚠ This is AFTER the event. migrate() has already committed whatever it ran,\n" +
          "  so the database has changed and this exit does not undo it. Read the ledger\n" +
          "  before running anything else: npx tsx scripts/db-repair-migration-ledger.ts\n" +
          "  docs/project/database.md § A watermark is not a ledger.",
  );
  process.exit(1);
}

let lock: PoolClient | null = null;
try {
  const folder = path.resolve(import.meta.dirname, "../drizzle");
  const journal = readJournal(folder);
  const hashes = hashMigrationFiles(folder);

  /**
   * **A warning, not a refusal, and the exception to this file's habit.**
   *
   * A forked or holed snapshot chain does not make this run wrong: `migrate()`
   * reads the journal and the `.sql` files and never opens a snapshot. The
   * damage is to the *next* `drizzle-kit generate`, which refuses on it and
   * exits 0 having written nothing. So refusing here would block a migration
   * that is perfectly safe, over a defect it has nothing to do with — and
   * `npm run db:generate` (scripts/db-generate.ts) already refuses at the point
   * where it matters.
   *
   * It says it here anyway because this is the command somebody runs straight
   * after a merge, which is when a fork arrives. Better to hear it now than at
   * the deploy gate. It stays out of `journalProblems`, which is a fatal list
   * and would have to be given a folder it currently does not read.
   */
  const chain = snapshotProblems(journal, readSnapshots(folder), HISTORICAL);
  if (chain.length > 0) {
    console.warn("\n⚠ drizzle/meta/ is not a well-formed chain — this migration is unaffected,");
    console.warn("  but the next `npm run db:generate` will be working from it:");
    for (const p of chain) console.warn(`    · ${p}`);
    /* Two different outcomes, and saying "it will refuse" covers only one of
       them. drizzle refuses on a fork; on a hole or an ordinary broken link it
       is perfectly happy and diffs against the wrong base, which is worse
       because the SQL it writes looks complete. GPT Sol, 2026-09-02. */
    console.warn("  On a fork it refuses, exits 0 and writes nothing. On a hole or a broken");
    console.warn("  link it does not refuse at all — it diffs against the wrong snapshot and");
    console.warn("  writes SQL that looks complete and re-emits DDL that has already run.");
    console.warn("  docs/project/database.md § Two worktrees generated at once.\n");
  }

  lock = await pool.connect();
  const got = await lock.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [
    MIGRATION_LOCK_KEY,
  ]);
  if (!got.rows[0]?.ok) {
    refuse(
      "another process is migrating this database",
      [`advisory lock ${MIGRATION_LOCK_KEY} is already held`, "wait for it to finish and run this again"],
      "nothing-ran",
    );
  }

  /**
   * **The preflight, and it runs before any DDL.**
   *
   * A check after `migrate()` would be too late: the migrator commits every
   * pending file in one transaction, so by the time a post-hoc check noticed
   * the gap, the migrations *after* the gap would already have run against a
   * schema that never had the missing one applied. GPT Sol, 2026-08-31,
   * §§ 4-5.
   *
   * `isLocalDatabaseUrl` decides the unknown-row policy, and it is the same
   * test that decides TLS and that guards remote runs above. One test, so
   * "local" cannot mean one thing to the guard and another to the thing it
   * guards.
   */
  const before = await readLedger(lock);
  const state = reconcileLedger(journal, hashes, before, { allowHistoricalExtras: isLocal });
  if (state.problems.length > 0) {
    refuse(
      "the journal and this database's migration ledger do not reconcile",
      state.problems,
      "nothing-ran",
    );
  }
  if (state.unknown.length > 0) {
    console.warn(
      `⚠ ${state.unknown.length} ledger row(s) from migrations this journal no longer contains ` +
        `(stamped ${state.unknown.map((r) => r.created_at).join(", ")}). ` +
        "Historical extras from renumbered local migrations; nothing is pending, so carrying on.",
    );
  }

  const db = drizzle(pool);
  if (state.pending.length === 0) {
    console.log("Nothing pending — the database is in step with the journal.");
  } else {
    console.log(
      `Applying ${state.pending.length} migration(s) from ${path.relative(process.cwd(), folder)}: ` +
        state.pending.map((e) => e.tag).join(", "),
    );
  }
  await migrate(db, {
    migrationsFolder: folder,
    // Must match drizzle.config.ts. They are two copies of one fact, and the
    // migrator silently starts a FRESH history if they disagree — every
    // migration re-applies, and the first CREATE TABLE fails with "already
    // exists", which reads like a broken migration rather than a typo here.
    migrationsTable: MIGRATIONS_TABLE,
    migrationsSchema: MIGRATIONS_SCHEMA,
  });

  /* The postflight. Necessary and NOT sufficient — it reads the ledger, not
     the schema, so it cannot tell a real migration from a hand-inserted row.
     postflightProblems()'s own comment says so, and `npm run db:check` is the
     half it does not cover. */
  const after = await readLedger(lock);
  const missed = postflightProblems(journal, hashes, after);
  if (missed.length > 0) {
    refuse(
      "migrate() returned, but the ledger does not account for every migration",
      missed,
      "migrate-already-committed",
    );
  }

  console.log("✓ migrations applied");
} finally {
  /* Releasing the lock is what `pool.end()` does anyway by closing the
     session; doing it explicitly keeps the release next to the acquire. */
  if (lock) {
    await lock.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    lock.release();
  }
  await pool.end();
}
