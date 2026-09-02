/**
 * drizzle-kit configuration. See docs/plans/260825f-postgres-migration.md.
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
 *
 * A fourth is `migrations.prefix` below, added 2026-09-02 — see the comment on
 * it, and docs/plans/260902c-concurrent-migrations-across-worktrees.md.
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
    /**
     * **`YYYYMMDDhhmmss` rather than `0052`, because the number is a guess and
     * the guess collides.**
     *
     * drizzle derives the index from the journal's last entry and nothing else,
     * so two agents who both have `0051` both mint an `0052` — and the two of
     * them want one `drizzle/meta/0052_snapshot.json`, which the repository
     * cannot hold. It happened here on 2026-08-31 with a pair of `0032`s, from
     * two sessions in a single tree, minutes apart.
     *
     * **This reduces collisions; it does not prevent them.** drizzle's stamp is
     * `slice(0, 14)` of the ISO string, so it is one-second resolution, and two
     * agents generating in the same second still collide — and differing
     * migration *names* do not help, because the snapshot is named from the
     * prefix alone. What actually catches a collision is
     * scripts/migration-snapshots.ts; this only makes it rare.
     *
     * Mixing the two shapes is fine and is the reason nothing was renamed:
     * `0051_` sorts before `2026…_`, lexical order stays chronological through
     * year 9999, and `migrate()` reads journal order rather than the directory.
     * The one thing that reads a prefix is the message in
     * tests/db-step-constraint.test.ts, and it no longer does.
     */
    prefix: "timestamp",
  },
  strict: true,
  verbose: true,
});
