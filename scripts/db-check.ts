/**
 * Does the database in `DATABASE_URL` have the columns this code expects?
 *
 *     npm run db:check
 *     DATABASE_URL=<remote> npm run db:check
 *
 * Exits non-zero when it does not, so it can gate a deploy. Run it **after**
 * migrations and **before** shipping the code that needs them — that is the gap
 * this fills, and docs/plans/260827w-schema-drift-guard.md has the two incidents that
 * cut through it.
 *
 * Read-only: one `select` against `information_schema`, no DDL, no writes. So
 * unlike db-migrate.ts there is no `DB_MIGRATE_ALLOW_REMOTE` guard — pointing
 * this at production is the *intended* use, not the accident to prevent.
 *
 * **Point it at the app's credential, not the migrator's.** The check asks what
 * the connecting role can see, and `information_schema` hides columns the role
 * has no privilege on. An administrator seeing every column proves nothing
 * about what Vercel's `spideryarn_app` can select. GPT Sol's review, finding 4.
 */

import { Pool } from "pg";

import {
  ACTUAL_SCHEMA_SQL,
  SCHEMA,
  compareSchema,
  declaredTables,
  driftWarnings,
  readActualSchema,
} from "../src/db/schema-drift.js";
import { sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import { loadEnvLocal } from "../src/env.js";

/**
 * **The shell's `DATABASE_URL`, read before `.env.local` can bury it.**
 *
 * The same precedence as scripts/db-migrate.ts, and for the same reason: the
 * target of this command is an **argument**, not configuration. Getting this
 * wrong is how the migrator came to report success against the laptop while the
 * remote stayed four migrations behind — and a checker that silently examines
 * the wrong database is a worse failure than no checker, because it is the one
 * that gets believed. docs/reusable/silent-success.md.
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

/** Say out loud which database is being checked. The same line db-migrate prints. */
console.log(`Target: ${withoutPassword(url) ?? "(a DATABASE_URL that is not a parsable URL)"}`);

const ssl = sslDecisionFor(url);
if (ssl.mode === "encrypted-unverified") console.warn(`⚠ ${ssl.why}`);

const pool = new Pool({ connectionString: url, max: 1, ssl: ssl.ssl });

try {
  const who = await pool.query<{ current_user: string }>("select current_user");
  console.log(`Role:   ${who.rows[0]?.current_user ?? "(unknown)"}`);

  const declared = declaredTables();
  const rows = await pool.query(ACTUAL_SCHEMA_SQL);
  const report = compareSchema(declared, readActualSchema(rows.rows));

  console.log(
    `Checked ${declared.length} declared tables ` +
      `(${declared.reduce((n, t) => n + t.columns.length, 0)} columns) ` +
      `against schema ${SCHEMA}.`,
  );

  const warnings = driftWarnings(report);
  if (warnings.length === 0) {
    console.log("✓ no schema drift");
  } else {
    /* One per line, and the whole list — a check that reports "3 problems" and
       names one is a check somebody has to run again to use. */
    for (const w of warnings) console.error(`✗ ${w}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
