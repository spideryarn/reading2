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
import { Pool } from "pg";

import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";

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

/** One connection, used once. `max: 1` because a migrator has no concurrency. */
const pool = new Pool({ connectionString: url, max: 1, ssl: ssl.ssl });

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
