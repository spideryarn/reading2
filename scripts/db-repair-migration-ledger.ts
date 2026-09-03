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
 * The table is `scripts/migration-reconciliations.ts`, which is where the
 * reasoning about each probe lives. GPT Sol, 2026-08-31:
 * docs/plans/260831ag-migration-watermark-repair-sol.md § 1.
 *
 * **What a repaired row means.** Where the reconciliation differs from the
 * historical SQL, the ledger row asserts *"this database has been brought to
 * this migration's postcondition"*, not *"these exact bytes ran here"*. That is
 * a weaker claim than an ordinary drizzle row and it is worth knowing when you
 * are reading the table later.
 *
 * **This is metadata surgery, so it does not trust itself.** Every effect is
 * probed in the catalogue three times: once up front to decide whether any DDL
 * is needed, once **inside the transaction** that does the work, so a failed
 * postcondition rolls the whole repair back, and once after the commit on a
 * fresh read, which is the state anybody else would now see. The first of those
 * is a decision and the second is the proof — an earlier version of this comment
 * claimed all of them were "in the same transaction", which was not true of the
 * first and was the sort of overclaim the rest of this file exists to avoid.
 * GPT Sol's review of the built code found it, along with the far worse problem
 * that the probes themselves only checked object *names*; both are answered in
 * docs/plans/260831ag-migration-watermark-repair-code-review-sol.md.
 *
 * **The advisory lock is taken first and held throughout** — before the ledger
 * is read, before preconditions are evaluated, before any destructive count is
 * printed, and until after the orphan rows are dealt with. A decision made on a
 * ledger read outside the lock is a decision about a database that may have
 * moved since.
 */

import path from "node:path";
import { Client } from "pg";

import { isLocalDatabaseUrl, sslDecisionFor, withoutPassword } from "../src/db/ssl.js";
import {
  hashMigrationFiles,
  journalProblems,
  KNOWN_ORPHANS,
  MIGRATION_LOCK_KEY,
  planToForget,
  postflightProblems,
  readJournal,
  type LedgerRow,
} from "./migration-ledger.js";
import {
  probeFailure,
  RECONCILIATIONS,
  shapeGuards,
  type Probe,
  type ProbeRow,
  type Reconciliation,
} from "./migration-reconciliations.js";
import { loadEnvLocal, resolveTargetUrl } from "../src/env.js";

/* Same precedence rule as db-migrate.ts, and for the same reason: the target of
   a repair is an argument, not configuration, so a `DATABASE_URL=…` on the
   command line must beat `.env.local` rather than being buried by it. That
   inversion is what once applied a remote migration to a laptop and said
   `✓`. src/env.ts § resolveTargetUrl, and docs/reusable/silent-success.md. */
/* Kept explicit even though `resolveTargetUrl` calls it too: this script reads
   other variables out of `.env.local` as well, and the load being visible here
   is what says so. It memoises, so the second call costs nothing. */
loadEnvLocal();
const url = resolveTargetUrl({ shellWins: true });

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

/**
 * The journal, with each entry's hash as drizzle computes it — **and a refusal
 * if the folder and the journal do not agree with each other.**
 *
 * A repair reads the journal to decide what a ledger row should say. A journal
 * with a duplicate stamp, a missing file or — the one that happened — a `.sql`
 * nobody named cannot support that decision, and the moment to find out is
 * before writing rows, not after. `journalProblems` is the same check
 * `db:migrate`'s preflight runs.
 */
function journalWithHashes() {
  const hashes = hashMigrationFiles(FOLDER);
  const journal = readJournal(FOLDER);
  const problems = journalProblems(journal, hashes);
  if (problems.length) {
    console.error("\nRefusing: the migrations folder and its journal do not agree.");
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  return journal.map((e) => ({ ...e, hash: hashes.get(e.tag) }));
}

async function main() {
  const ssl = sslDecisionFor(url!);
  const client = new Client({ connectionString: url!, ssl: ssl.ssl });
  await client.connect();

  /** Run one probe and say why it is unsatisfied, or `null` if it is fine. */
  const ask = async (p: Probe): Promise<string | null> =>
    probeFailure(p, (await client.query<ProbeRow>(p.sql)).rows);

  /* Say which database, every time, before saying anything else. Which one a
     command actually reaches is not always the one on its command line, and both
     mistakes print the same success — docs/project/database.md. */
  const target = (await client.query<{ db: string; host: string }>(
    "select current_database() db, inet_server_addr()::text host",
  )).rows[0];
  console.log(`Target: ${withoutPassword(url!)}`);
  console.log(`        database=${target?.db} server=${target?.host ?? "local socket"}`);
  console.log(APPLY ? "Mode:   APPLY (will write)\n" : "Mode:   report only (no writes)\n");

  /**
   * **The lock, before the first read that anything is decided from.**
   *
   * It used to be taken at the point of writing, which left the ledger read,
   * the preconditions, the choice of DDL and the count of what was about to be
   * destroyed all outside it — every one of them a judgement about a database
   * another process could be changing. `try` rather than the blocking form, so
   * a repair that arrives during a migrate says so instead of hanging.
   */
  const got = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [
    ADVISORY_LOCK_KEY,
  ]);
  if (!got.rows[0]?.ok) {
    console.error(
      `Refusing: advisory lock ${ADVISORY_LOCK_KEY} is already held — something else is\n` +
        "  migrating or repairing this database. Wait for it and run this again.",
    );
    await client.end();
    process.exit(1);
  }

  try {
    await repair(client, ask);
  } finally {
    await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

async function repair(client: Client, ask: (p: Probe) => Promise<string | null>) {
  const rows = await client.query<{ hash: string; created_at: string }>(
    `select hash, created_at from ${LEDGER}`,
  );
  const applied = new Map(rows.rows.map((r) => [String(r.created_at), r.hash]));
  const journal = journalWithHashes();
  const watermark = rows.rows.length
    ? Math.max(...rows.rows.map((r) => Number(r.created_at)))
    : -1;

  /* The whole fault in one list: entries drizzle can never reach, because their
     `when` is at or below the newest row it will compare them against. */
  const unreachable = journal.filter((e) => !applied.has(String(e.when)) && e.when <= watermark);
  const pending = journal.filter((e) => !applied.has(String(e.when)) && e.when > watermark);
  const extras = rows.rows.filter((r) => !journal.some((e) => String(e.when) === String(r.created_at)));

  console.log(`Ledger has ${rows.rows.length} rows; watermark ${watermark}.`);
  console.log(`Journal has ${journal.length} entries.`);
  console.log(`\nUNREACHABLE (drizzle will skip these for ever) — ${unreachable.length}:`);
  for (const e of unreachable) console.log(`   ${e.idx} ${e.tag} (when ${e.when})`);
  console.log(`\nPending, and reachable by an ordinary db:migrate — ${pending.length}:`);
  for (const e of pending) console.log(`   ${e.idx} ${e.tag} (when ${e.when})`);
  console.log(`\nLedger rows matching no current journal entry — ${extras.length}:`);
  for (const r of extras) {
    const known = KNOWN_ORPHANS.find((k) => k.when === Number(r.created_at) && k.hash === r.hash);
    console.log(
      `   created_at ${r.created_at} hash ${r.hash.slice(0, 12)}… ` +
        (known
          ? `— ${known.tag}, renumbered into ${known.subsumedBy} (${known.wasIn})`
          : "— a migration file that no longer exists, and NOT one this script knows"),
    );
  }

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
   * Only when **every** effect is already present, at the full shape rather
   * than by name. One of two columns existing is a partial state, and so is a
   * column of the right name and the wrong type.
   */
  const alreadyDone: Reconciliation[] = [];
  for (const e of pending) {
    const r = RECONCILIATIONS.find((x) => x.tag === e.tag);
    if (!r) continue;
    /* Sequential, not `Promise.all`: one `pg.Client` is a single connection and
       overlapping queries on it are deprecated and serialised behind the
       scenes anyway. */
    let allPresent = true;
    for (const eff of r.effects) if (await ask(eff)) allPresent = false;
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
    return;
  }

  console.log("\n── Preconditions ───────────────────────────────────────────");
  let refused = false;
  for (const r of plan) {
    /* The derived "it is there and it is the wrong shape" guards first, because
       that is the diagnosis somebody actually wants; the hand-written
       starting-state assumptions after. */
    for (const g of [...shapeGuards(r), ...r.refuseIf]) {
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
    process.exit(1);
  }
  console.log("   all clear");

  console.log("\n── What each one needs ─────────────────────────────────────");
  const work: { r: Reconciliation; needsDdl: boolean }[] = [];
  for (const r of plan) {
    const missing: string[] = [];
    for (const e of r.effects) {
      const why = await ask(e);
      if (why) missing.push(why);
    }
    work.push({ r, needsDdl: missing.length > 0 });
    console.log(
      `   ${r.tag}: ${missing.length ? `DDL needed — ${missing.join("; ")}` : "effects already present, ledger row only"}`,
    );
  }

  /* What 0036 is about to destroy, counted and shown before it happens rather
     than reported afterwards. Greg authorised dropping this column when he wrote
     the migration ("we don't care about the data we have right now"), but a
     number on the screen is what makes that an informed authorisation. */
  if (plan.some((r) => r.tag === "0036_drop_summary_column")) {
    const runs = await client.query<{ n: number }>(
      `select count(*)::int n from "spideryarn"."revision_step_runs" where step_name='summary'`,
    );
    const cols = await client.query<{ n: number }>(
      `select count(*)::int n from "spideryarn"."article_revisions" where summary is not null`,
    );
    console.log(
      `\n   0036 will DELETE ${runs.rows[0]!.n} summary step run(s) and DROP a summary ` +
        `column holding ${cols.rows[0]!.n} non-null value(s).`,
    );
  }

  /* What will still have no ledger row once this run's inserts have happened —
     `work` is exactly the set of rows about to be written. */
  const willHaveRow = new Set([...applied.keys()]);
  for (const w of work) willHaveRow.add(String(journal.find((j) => j.tag === w.r.tag)!.when));
  const stillPending = journal.filter((e) => !willHaveRow.has(String(e.when)));

  const orphanPlan = FORGET_ORPHANS
    ? planToForget(extras, stillPending, work.map((w) => w.r.tag))
    : null;
  if (orphanPlan) {
    console.log("\n── Orphan ledger rows ──────────────────────────────────────");
    console.log(orphanPlan.say);
  }

  if (!APPLY) {
    console.log("\nReport only. Re-run with --apply to do it.");
    return;
  }

  console.log("\n── Applying, in one transaction ────────────────────────────");
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
      if (!e.hash) throw new Error(`${r.tag} has no .sql file, so there is no hash to record`);
      await client.query(`insert into ${LEDGER} ("hash", "created_at") values ($1, $2)`, [
        e.hash,
        e.when,
      ]);
      console.log(`   ${r.tag}: ledger row inserted (created_at ${e.when})`);
    }

    /* **Inside the same transaction as the inserts**, so that a delete which
       turns out to be wrong is rolled back with everything else rather than
       having already happened by the time the postconditions are checked. It
       was after the commit, and after the lock was released. */
    if (orphanPlan?.forget.length) {
      for (const k of orphanPlan.forget) {
        const res = await client.query(
          `delete from ${LEDGER} where created_at = $1 and hash = $2`,
          [k.when, k.hash],
        );
        if (res.rowCount !== 1) {
          throw new Error(
            `expected to forget exactly one row for ${k.tag} (${k.when}), deleted ${res.rowCount}`,
          );
        }
        console.log(`   forgot ${k.when} ${k.hash.slice(0, 12)}… — ${k.tag}, ${k.wasIn}`);
      }
    }

    /* Prove it inside the transaction, so a failed postcondition rolls the whole
       repair back rather than leaving a half-reconciled database behind a
       ledger that claims otherwise. */
    for (const { r } of work) {
      for (const eff of r.effects) {
        const why = await ask(eff);
        if (why) throw new Error(`postcondition failed for ${r.tag}: ${why}`);
      }
    }

    /* **And the ledger itself**, by the same function `db:migrate` uses after
       migrating: every journal entry with exactly one row carrying its stamp
       and its hash. It is metadata checking metadata and it proves nothing
       about the schema — the probes above are that half — but a repair that
       leaves the ledger unable to satisfy the next `db:migrate` preflight has
       not finished, and finding that out here rather than tomorrow costs
       nothing. */
    const after = await client.query<LedgerRow>(`select hash, created_at from ${LEDGER}`);
    const missed = postflightProblems(journal, hashMigrationFiles(FOLDER), after.rows);
    if (missed.length) {
      throw new Error(`the ledger still does not reconcile: ${missed.join("; ")}`);
    }

    await client.query("commit");
    console.log("\n✓ committed");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error(`\n✗ rolled back: ${(err as Error).message}`);
    process.exit(1);
  }

  /* Again, after the commit, on a fresh read. The check above ran inside the
     transaction that made the change; this one is the state anybody else would
     now see. */
  console.log("\n── Re-probed after commit ──────────────────────────────────");
  for (const { r } of work) {
    for (const eff of r.effects) {
      const why = await ask(eff);
      console.log(`   ${why ? `FAIL ${why}` : `ok   ${r.tag}: ${eff.what}`}`);
    }
  }
}

await main();
