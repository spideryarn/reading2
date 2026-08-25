/**
 * drizzle-kit configuration. See docs/plans/postgres-migration.md.
 *
 * Three settings here are load-bearing, and all three are the kind that look
 * like boilerplate right up until they delete something.
 *
 * 1. `schemaFilter` is pinned to `spideryarn`. drizzle-kit's default is every
 *    schema, and that default CHANGED between major versions — which is
 *    precisely how a command that was scoped yesterday starts inspecting
 *    `auth`, `storage` and `public` tomorrow. Supabase owns those.
 *
 * 2. `migrations.schema` is named rather than left as the generic default, so
 *    nothing else can end up sharing this ledger. It sits OUTSIDE
 *    `schemaFilter` on purpose: if it were inside, a `push` would see its own
 *    bookkeeping table as an undeclared object and offer to drop it.
 *
 * 3. There is no `dbCredentials` block, so there is nothing here for
 *    `drizzle-kit push` or `pull` to connect to. That is deliberate. Only
 *    `generate` (compare TS against the last snapshot) and `migrate` (apply
 *    committed files) are safe against a shared or production database;
 *    `push` introspects a live database and computes a diff. **Never run
 *    `push` against anything that matters.**
 *
 * `drizzle-kit generate` needs no database at all, which is why the schema can
 * be reviewed before a project exists.
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["spideryarn"],
  migrations: {
    table: "__drizzle_migrations",
    schema: "spideryarn_migrations",
  },
  strict: true,
  verbose: true,
});
