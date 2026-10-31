/**
 * **The shared local database never ran a different version of one of this
 * tree's migration files.**
 *
 * On the box every worktree migrates one Postgres, so a migration has *run*
 * the moment any tree calls `db:migrate` — long before it is pushed or
 * reviewed. On 2026-10-31 a review edited a migration the shared database had
 * already run; the author's suite stayed green (it runs on private databases
 * migrated fresh from the current files), and the readiness loop, the next
 * tree to migrate, refused for five hours.
 * docs/postmortems/261031a-a-migration-edited-after-the-shared-database-ran-it.md
 *
 * This file reads the shared database's ledger and fails, in the author's own
 * tree and on their next `npm test`, when a row stamped with one of this
 * tree's journal entries carries a different hash from the file. Only that
 * rule: other trees' unpushed rows and this tree's not-yet-applied entries are
 * the business of `db:migrate`'s preflight, not of a test that every tree runs
 * — see `appliedFromDifferentSql` in scripts/migration-ledger.ts.
 *
 * **It cannot say green without having read the ledger.** It is in the
 * `shared-services` lane, whose setup asserts the database really is this
 * stack's `postgres` and scrubs a hosted URL's password; `pgReady` throws if
 * the database is unreachable or has no ledger table; it asserts at least one
 * of this tree's entries was matched; and it runs a positive control on the
 * live rows before trusting the empty answer. docs/reusable/silent-success.md.
 *
 * It only reads. Nothing here writes to any database.
 */

import path from "node:path";

import type { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  appliedFromDifferentSql,
  hashMigrationFiles,
  matchJournalToLedger,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  readJournal,
  type LedgerRow,
} from "../scripts/migration-ledger.js";
import { projectMismatch } from "../src/store/blobs.js";
import { pgReady } from "./helpers/pg-ready.js";

const LEDGER = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;

/* `tests/setup/shared-db.ts` proves DATABASE_URL and SUPABASE_URL name this
   stack together when both exist. This read-only suite can run with only a
   database URL, so complete that proof against this repo's local API port from
   supabase/config.toml. The literal is checked by nothing, but it fails in the
   safe direction: if the ports ever move, this goes red rather than green.
   Otherwise another local stack's database, also named `postgres`, could pass. */
const identityProblem = projectMismatch(
  process.env.DATABASE_URL,
  process.env.SUPABASE_URL ?? "http://127.0.0.1:54361",
);
if (identityProblem) {
  throw new Error(
    `the shared migration-ledger test must read this repo's own local Supabase database. ${identityProblem}`,
  );
}

const { pool } = (await pgReady({
  suite: "the shared database's migration ledger",
  tables: [LEDGER],
  keepPool: true,
})) as { pool: Pool };

afterAll(async () => {
  await pool.end();
});

const folder = path.resolve(import.meta.dirname, "../drizzle");
const journal = readJournal(folder);
const hashes = hashMigrationFiles(folder);

async function readLedger(): Promise<LedgerRow[]> {
  const r = await pool.query<{ hash: string; created_at: string }>(
    `select hash, created_at::text as created_at from ${LEDGER}`,
  );
  return r.rows.map((row) => ({ hash: row.hash, created_at: Number(row.created_at) }));
}

describe("the shared database's migration ledger against this tree's files", () => {
  it("has run no migration file of this tree in a different form", async () => {
    const rows = await readLedger();

    /* Not vacuous: an empty ledger, or one belonging to some other history,
       matches nothing and would otherwise pass. */
    const matched = matchJournalToLedger(journal, rows).matches.filter((m) => m.rows.length > 0);
    expect(
      matched.length,
      `none of this tree's ${journal.length} migrations is in ${LEDGER} (${rows.length} rows) — ` +
        "this cannot be the shared database this tree migrates, so the check proves nothing",
    ).toBeGreaterThan(0);

    /* `hashProblem` stays quiet about a tag with no file hash (the journal
       test owns a missing file), so a hash map that failed to read would pass
       everything below. Every matched entry must have a real one. GPT Sol, plan
       review, 2026-10-31. */
    const unhashed = matched.filter((m) => !/^[0-9a-f]{64}$/.test(hashes.get(m.entry.tag) ?? ""));
    expect(unhashed.map((m) => m.entry.tag), "matched migrations with no sha256 of their file").toEqual([]);

    /* The positive control, on the live rows: the same comparison must notice
       an edit to a migration this database has run. If the read or the
       comparison were broken, this is what goes red. One nibble of the real
       hash changes, so the control cannot pass on a hash that was never there. */
    const probe = matched[matched.length - 1]!.entry;
    const real = hashes.get(probe.tag)!;
    const edited = new Map(hashes);
    edited.set(probe.tag, (real[0] === "0" ? "1" : "0") + real.slice(1));
    expect(appliedFromDifferentSql(journal, edited, rows).join("\n")).toContain(probe.tag);

    const problems = appliedFromDifferentSql(journal, hashes, rows);
    expect(
      problems,
      "\nThe shared local database has already run these migration files in a different form:\n" +
        problems.map((p) => `  • ${p}`).join("\n") +
        "\n\nOn this box a migration has run once any tree has migrated, so a change to one is a new " +
        "migration. Put the file back as it was and write the change as a new migration " +
        "(npm run db:generate). If you did not edit it, either this tree is behind (merge origin/dev; " +
        "the readiness loop testing an older commit sees the same) or another tree ran a different " +
        "copy of it — read the row's hash against `git log -p` of the file to tell which.\n" +
        "On a laptop, where only you migrate, this is usually a working draft that ran and was " +
        "tidied before commit; that one has a remedy — probe the postconditions, then restamp — and " +
        "never a blind restamp:\n" +
        "  docs/project/database.md § Rule 4 on a laptop: the draft that ran, and the file that was committed\n",
    ).toEqual([]);
  });
});
