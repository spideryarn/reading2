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
