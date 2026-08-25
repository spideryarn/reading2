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
 * See docs/plans/postgres-migration.md and docs/project/supabase-local.md.
 *
 * A migration connection is a **direct/session** connection, never the
 * transaction pooler: DDL, advisory locks and the migrator's own bookkeeping all
 * want a session. Locally that distinction does not exist — there is one
 * Postgres on 54362 — but the connection string in production must be the
 * direct one, and this is where that gets got wrong if it gets got wrong.
 */

import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { loadEnvLocal } from "../src/env.js";

loadEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "  Local: npm run db:start, then it comes from .env.local.\n" +
      "  See docs/project/supabase-local.md.",
  );
  process.exit(1);
}

/**
 * Refuse to run against anything that is not obviously local unless told twice.
 * There is no remote project yet, so today this only ever fires by accident —
 * which is exactly when you want it to.
 */
const isLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
if (!isLocal && process.env.DB_MIGRATE_ALLOW_REMOTE !== "yes") {
  const shown = url.replace(/:\/\/[^@]*@/, "://***@");
  console.error(
    `DATABASE_URL does not look local: ${shown}\n` +
      "  Set DB_MIGRATE_ALLOW_REMOTE=yes if you really mean it.",
  );
  process.exit(1);
}

/** One connection, used once. `max: 1` because a migrator has no concurrency. */
const pool = new Pool({ connectionString: url, max: 1 });

try {
  const db = drizzle(pool);
  const folder = path.resolve(import.meta.dirname, "../drizzle");
  console.log(`Applying migrations from ${path.relative(process.cwd(), folder)} …`);
  await migrate(db, {
    migrationsFolder: folder,
    // Must match drizzle.config.ts. They are two copies of one fact, and the
    // migrator silently starts a FRESH history if they disagree — every
    // migration re-applies, and the first CREATE TABLE fails with "already
    // exists", which reads like a broken migration rather than a typo here.
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "spideryarn_migrations",
  });
  console.log("✓ migrations applied");
} finally {
  await pool.end();
}
