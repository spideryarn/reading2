/**
 * One fingerprint of "which migrations does this database hold", computed the
 * same way by the two sides that have to agree about it.
 *
 * The deployed function reports what it finds in
 * `spideryarn_migrations.__drizzle_migrations`; the build stamps in what the
 * commit's `drizzle/` folder says it needs
 * ([`vite.api.config.ts`](../vite.api.config.ts)); `/api/health` prints both.
 * Anything that can make an HTTPS request can then tell whether a deployment's
 * code and its schema are in step, **with no database credential at all** —
 * which is the whole point, and the reason this lives in `src/` rather than
 * beside the migrator in `scripts/`.
 *
 * ## Why a digest over the WHOLE ordered list
 *
 * The obvious cheaper summary — a row count plus the newest hash — is not one.
 * Two different histories can agree on both, so a database missing a migration
 * in the middle and holding an unexpected one at the end reports itself
 * healthy. GPT Sol, 2026-09-02, reviewing the plan this came from; and it is
 * the same species as
 * [database.md § A watermark is not a ledger](../docs/project/database.md#a-watermark-is-not-a-ledger),
 * which is the last time a single number stood in for a list here and lost four
 * migrations doing it.
 *
 * ## What this digest deliberately does NOT answer
 *
 * **Two questions, and only one of them is this file's.**
 *
 *  - *Which migrations are recorded as applied?* — this file.
 *  - *Were they applied in a sane order, does each file still hash to what the
 *    ledger says, is the journal a contiguous prefix?* —
 *    [`scripts/migration-ledger.ts`](../scripts/migration-ledger.ts), and its
 *    `reconcileLedger` is considerably more thorough than anything here.
 *
 * So the entries are sorted into a canonical order before hashing rather than
 * taken in the order each side happens to produce them. That makes the two
 * sides comparable without either having to promise an ordering — and it means
 * a digest match says *the same set of migrations*, never *applied in the same
 * sequence*. Do not reach for this to answer the second question.
 *
 * ## And a matching digest is still not a matching schema
 *
 * The ledger is bookkeeping. A hand-inserted row makes this agree while the
 * column it claims to have added does not exist — `db:check` and the schema
 * drift check in [`vercel-health.ts`](vercel-health.ts) are the half that looks
 * at the actual columns. Necessary, not sufficient.
 */

import { createHash } from "node:crypto";

/**
 * One applied migration, as both sides can see it.
 *
 * Structurally the same as `LedgerRow` in `scripts/migration-ledger.ts` — that
 * one is what comes back from the bookkeeping table, this one is the input to a
 * hash. Kept as a separate name because this module must not import from
 * `scripts/`: it is compiled into the serverless function, and `scripts/` reads
 * the filesystem.
 */
export interface AppliedMigration {
  /** sha256 of the whole `.sql` file, which is how drizzle computes it. */
  hash: string;
  /** The journal entry's `when`, stored in the ledger as `created_at`. */
  created_at: number;
}

/** A migration the built commit expects, with the tag a human can act on. */
export interface ExpectedMigration extends AppliedMigration {
  /** e.g. `0048_wandering_wolfsbane`. Absent from the database; the build has it. */
  tag: string;
}

export interface MigrationDigest {
  count: number;
  /** sha256, hex. `EMPTY_DIGEST` when there are no entries at all. */
  digest: string;
}

/**
 * The canonical line for one entry: `<created_at> <hash>`.
 *
 * A separator that cannot occur inside either field, so two entries cannot be
 * concatenated into a third that hashes the same as some other pair. `hash` is
 * hex and `created_at` is a number, so a space and a newline are both safe —
 * but the reason is worth stating, because the day one of these becomes a tag
 * this stops being true.
 */
function line(entry: AppliedMigration): string {
  return `${entry.created_at} ${entry.hash}`;
}

/** What an empty ledger digests to. Named so a caller can recognise it. */
export const EMPTY_DIGEST = createHash("sha256").update("").digest("hex");

/**
 * The fingerprint of a set of migrations.
 *
 * Sorted by `(created_at, hash)` — the hash breaks the tie, because two
 * migrations generated in the same millisecond are not impossible and an
 * unstable sort there would make the digest depend on input order, which is
 * exactly what this is meant to be free of.
 */
export function migrationDigest(entries: readonly AppliedMigration[]): MigrationDigest {
  const sorted = [...entries].sort(
    (a, b) => a.created_at - b.created_at || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
  );
  return {
    count: sorted.length,
    digest: createHash("sha256").update(sorted.map(line).join("\n")).digest("hex"),
  };
}

/**
 * How a deployment's code and its database differ — **and which direction**.
 *
 * The direction is the whole reason this returns two lists rather than a
 * boolean. A single "in step?" flag would have taken production down on every
 * deploy: `npm run deploy` applies migrations *before* it pushes, so for the
 * minute between the migration landing and the new build going live, the
 * **currently serving** deployment is one whose code does not know about the
 * newest row. That is the normal, safe, additive state — old code against a
 * newer schema — and a check that called it unhealthy would 503 a working site
 * every single time, which is how a check gets turned off.
 *
 * `missing` is the one that means something is wrong: this build selects
 * columns that a migration was supposed to create, and the database has no
 * record of that migration. That is the state where requests fail.
 */
export interface MigrationComparison {
  /** Expected by the build, absent from the database. Serious. */
  missing: ExpectedMigration[];
  /** In the database, unknown to this build. Normal during a deploy. */
  ahead: number;
}

export function compareMigrations(
  expected: readonly ExpectedMigration[],
  applied: readonly AppliedMigration[],
): MigrationComparison {
  /* Keyed on the hash alone rather than `when + hash`. The hash IS the file's
     content, so two entries sharing one is the same migration however it is
     stamped — and a `when` that disagrees is a journal problem, which
     scripts/migration-ledger.ts diagnoses far better than a set difference
     could. Matching on the pair here would report a renumbered-but-identical
     migration as both missing AND ahead, which reads like two faults. */
  const appliedHashes = new Set(applied.map((a) => a.hash));
  const expectedHashes = new Set(expected.map((e) => e.hash));
  return {
    missing: expected.filter((e) => !appliedHashes.has(e.hash)),
    ahead: applied.filter((a) => !expectedHashes.has(a.hash)).length,
  };
}

/* ------------------------------------------------------------------ */
/* Where the bookkeeping lives                                         */
/* ------------------------------------------------------------------ */

/**
 * Must match `drizzle.config.ts` and the `migrate()` call in
 * `scripts/db-migrate.ts`. They are copies of one fact, and the migrator
 * **silently starts a FRESH history** if they disagree — every migration
 * re-applies and the first `create table` fails with "already exists", which
 * reads like a broken migration rather than a typo.
 *
 * Here rather than in `scripts/migration-ledger.ts`, which re-exports them, so
 * that `src/vercel-health.ts` can name the table without pulling a
 * filesystem-reading module into the serverless bundle.
 */
export const MIGRATIONS_SCHEMA = "spideryarn_migrations";
export const MIGRATIONS_TABLE = "__drizzle_migrations";
