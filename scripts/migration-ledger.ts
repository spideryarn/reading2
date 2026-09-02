/**
 * Whether the migration journal on disk and the ledger in the database can be
 * reconciled — and, separately, what drizzle will actually do about it.
 *
 * **Why this is a module rather than a check inside `db-migrate.ts`.** Three
 * places ask a version of this question: `scripts/db-migrate.ts` before and
 * after it migrates, `scripts/deploy.ts` before it migrates production, and
 * `tests/migration-journal.test.ts` about the files alone. They used to answer
 * it two different ways, and the weaker answer is the one that was wrong.
 *
 * **The rule everything here turns on.** drizzle-orm's node-postgres migrator
 * reads ONE row — `select … order by created_at desc limit 1` — once, before
 * its loop, and then applies every journal entry whose `when` is *strictly
 * greater* than that number (`node_modules/drizzle-orm/pg-core/dialect.cjs`,
 * `PgDialect.migrate`). It never looks at the hashes it stored, and it never
 * asks whether an *older* entry is missing. It is a **watermark, not a
 * ledger**. So a journal entry whose `when` is below the newest applied row is
 * skipped for ever, in silence, and `✓ migrations applied` is printed over the
 * top of it.
 *
 * That is not hypothetical: `0035_timeline` was given a hand-written round
 * `when` of 1788200000000, later than `0036_drop_summary_column`'s real
 * 1788175229610, so any database that applied `0035` can never apply `0036`.
 * See docs/project/database.md § A watermark is not a ledger.
 *
 * Everything in this file is pure. The database reads live in
 * `scripts/db-migrate.ts`; the point of the split is that the judgements can be
 * seen to fail without a database — docs/reusable/silent-success.md.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** One row of `drizzle/meta/_journal.json`. */
export interface JournalEntry {
  idx: number;
  tag: string;
  /** Milliseconds. Drizzle compares this against the ledger's `created_at`. */
  when: number;
}

/** One row of `spideryarn_migrations.__drizzle_migrations`. */
export interface LedgerRow {
  /** sha256 of the whole `.sql` file, which is how drizzle computes it. */
  hash: string;
  /** The journal entry's `when`, stored as `created_at`. */
  created_at: number;
}

/**
 * The single encoding of drizzle's watermark rule.
 *
 * `watermark` is `null` for a database with no ledger rows at all, where
 * everything is reachable. Strictly greater, because that is what
 * `PgDialect.migrate` writes: `lastDbMigration.created_at < migration.folderMillis`.
 */
export function crossesWatermark(when: number, watermark: number | null): boolean {
  return watermark === null || when > watermark;
}

/** The newest `created_at` in the ledger — the number drizzle will compare against. */
export function watermarkOf(rows: readonly LedgerRow[]): number | null {
  let max: number | null = null;
  for (const r of rows) {
    const n = Number(r.created_at);
    if (max === null || n > max) max = n;
  }
  return max;
}

/* ------------------------------------------------------------------ */
/* What drizzle will do                                                */
/* ------------------------------------------------------------------ */

export interface MigrationState {
  /** Migrations in the journal that the database has not applied, in order. */
  pending: JournalEntry[];
  /**
   * The database has applied more than the journal knows about.
   *
   * Normal on a laptop — an agent generates `0018`, applies it, and has not
   * committed it yet — and **never** normal on the remote. Reported separately
   * from `pending` because the two are opposite problems and the arithmetic
   * that finds one would quietly report the other as zero.
   */
  ahead: number;
}

/**
 * What drizzle will apply, decided the same way drizzle decides it.
 *
 * **This deliberately shares the bug.** It answers "what will the migrator do",
 * not "what is missing", and those differ exactly when a journal entry has
 * sunk below the watermark — that entry is missing and will never be applied,
 * and this function calls it "not pending", because that is the truth about
 * the migrator. `reconcileLedger` is the function that answers the other
 * question. Do not fix this one; read that one.
 */
export function migrationState(
  journal: readonly JournalEntry[],
  lastAppliedMillis: number | null,
  appliedCount: number,
): MigrationState {
  const pending = journal
    .filter((e) => crossesWatermark(e.when, lastAppliedMillis))
    .slice()
    .sort((a, b) => a.when - b.when);
  return { pending, ahead: Math.max(0, appliedCount - (journal.length - pending.length)) };
}

/* ------------------------------------------------------------------ */
/* Matching the journal to the ledger                                  */
/* ------------------------------------------------------------------ */

/** One journal entry and every ledger row stamped with its `when`. */
export interface JournalMatch {
  entry: JournalEntry;
  rows: LedgerRow[];
}

export interface Matching {
  matches: JournalMatch[];
  /** Ledger rows whose `created_at` matches no journal entry, oldest first. */
  unknown: LedgerRow[];
}

/**
 * Pair each journal entry with the ledger rows carrying its timestamp.
 *
 * Matched on `created_at` alone rather than on `(created_at, hash)` so that a
 * row with the right timestamp and the wrong hash comes back as a *changed*
 * migration rather than as one missing entry plus one mysterious extra. Two
 * reports of the same fact, one of them misleading, is how a real divergence
 * gets read as branch noise.
 */
export function matchJournalToLedger(
  journal: readonly JournalEntry[],
  rows: readonly LedgerRow[],
): Matching {
  const matched = new Set<LedgerRow>();
  const matches = journal.map((entry) => {
    const mine = rows.filter((r) => Number(r.created_at) === entry.when);
    for (const r of mine) matched.add(r);
    return { entry, rows: mine };
  });
  const unknown = rows
    .filter((r) => !matched.has(r))
    .slice()
    .sort((a, b) => Number(a.created_at) - Number(b.created_at));
  return { matches, unknown };
}

/* ------------------------------------------------------------------ */
/* The full reconciliation                                             */
/* ------------------------------------------------------------------ */

export interface ReconcileOptions {
  /**
   * May ledger rows this journal does not contain be tolerated?
   *
   * **Only on a laptop, and only once nothing is pending.** A developer's
   * database carries rows from migrations that were renumbered or deleted
   * before they were pushed, and those rows are below the watermark for ever;
   * blocking on them would block every future migration on that machine. But
   * while current entries are still pending, an unknown row may be the *same
   * DDL* under a different number, so applying the pending ones would fail or,
   * worse, half-succeed. Production gets no tolerance at all: an unknown row
   * there is a history nobody can account for. GPT Sol, 2026-08-31, § 4.
   */
  allowHistoricalExtras: boolean;
}

export interface Reconciliation {
  /** Journal entries with no ledger row, in journal order. */
  pending: JournalEntry[];
  /** Pending entries whose `when` cannot cross the watermark, so drizzle will never apply them. */
  unreachable: JournalEntry[];
  /** Ledger rows matching no journal entry, oldest first. */
  unknown: LedgerRow[];
  /** The number drizzle will compare against, or `null` for an empty ledger. */
  watermark: number | null;
  /**
   * Everything that makes the journal and the ledger irreconcilable. Empty
   * means it is safe to call `migrate()`; anything else means stop.
   */
  problems: string[];
}

/**
 * Can `migrate()` be trusted to do what it is about to claim it did?
 *
 * The five conditions are GPT Sol's, 2026-08-31 § 4, and condition 3 is the
 * one that catches the defect this was written for. A database through
 * `0034` is safe — `0035` and `0036` both clear its watermark even though
 * their timestamps are internally reversed. A database through `0035` is
 * broken, because `0036` never can.
 *
 * `hashes` maps a journal tag to the sha256 of its `.sql` file. A tag missing
 * from the map means the file could not be read, which is condition 5's
 * "missing SQL files" and is a problem here — unlike `ledgerDivergence`, which
 * reads files out of a git commit and stays quiet about what it cannot see.
 */
export function reconcileLedger(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
  rows: readonly LedgerRow[],
  opts: ReconcileOptions,
): Reconciliation {
  const problems: string[] = [...journalProblems(journal, hashes)];
  const watermark = watermarkOf(rows);
  const { matches, unknown } = matchJournalToLedger(journal, rows);

  const pending: JournalEntry[] = [];
  const known: JournalEntry[] = [];
  for (const m of matches) {
    if (m.rows.length === 0) {
      pending.push(m.entry);
      continue;
    }
    known.push(m.entry);
    if (m.rows.length > 1) {
      problems.push(
        `${m.entry.tag} has ${m.rows.length} ledger rows stamped ${m.entry.when} — it was recorded more than once`,
      );
      continue;
    }
    problems.push(...hashProblem(m.entry, m.rows[0]!, hashes));
  }

  /* 1 and 2: the applied entries must be a contiguous prefix in JOURNAL order,
     and the pending ones the remaining suffix. Journal order, not timestamp
     order, because the journal is the order the files are meant to run in and
     it is not sorted — 0035 sits before 0036 and is stamped later. */
  const firstPending = journal.findIndex((e) => pending.includes(e));
  if (firstPending >= 0) {
    const stragglers = known.filter((e) => journal.indexOf(e) > firstPending);
    if (stragglers.length > 0) {
      const gap = journal[firstPending]!;
      problems.push(
        `the applied migrations are not a prefix of the journal: ${gap.tag} has never run, ` +
          `yet ${stragglers.map((e) => e.tag).join(", ")} — which come after it — did`,
      );
    }
  }

  /* 3: the condition that catches the real bug. */
  const unreachable = pending.filter((e) => !crossesWatermark(e.when, watermark));
  if (unreachable.length > 0) {
    problems.push(
      `${unreachable.length} migration(s) can never be applied: the newest ledger row is stamped ` +
        `${watermark}, and drizzle only applies entries stamped after it — ` +
        unreachable.map((e) => `${e.tag} (${e.when})`).join(", "),
    );
  }

  if (unknown.length > 0 && (!opts.allowHistoricalExtras || pending.length > 0)) {
    problems.push(
      `${unknown.length} ledger row(s) belong to no migration in this journal: ` +
        unknown.map((r) => `${r.created_at}`).join(", ") +
        (opts.allowHistoricalExtras
          ? ` — and ${pending.length} migration(s) are still pending, one of which may be the same DDL under a ` +
            "new number. Work out what those rows did, and delete them once their effects are accounted for"
          : ""),
    );
  }

  return { pending, unreachable, unknown, watermark, problems };
}

/**
 * The journal and the folder against each other: no duplicates, no holes, a
 * file for every entry — **and an entry for every file**.
 *
 * Condition 5. Each of these makes every other judgement here meaningless
 * rather than merely wrong — two entries stamped the same millisecond cannot
 * both be matched to a ledger row, and a `when` is the only handle drizzle has.
 *
 * **The last one is the direction that was missing, and it is the one that
 * happened.** On 2026-08-31 two sessions in this tree generated a migration
 * minutes apart without pulling: `0032_experimental_features.sql` and
 * `0032_jobs_concurrency_cap.sql` both sat in `drizzle/`, the journal named one
 * of them, and the other never ran and nothing said so. Two files claiming one
 * index is the loud version of it; a single `.sql` the journal has never heard
 * of is the quiet one, and there is no harmless reading of either — a file in
 * that folder is a migration that will never run, or it is debris, and only a
 * person can tell which. So it is fatal rather than a warning, and it lives
 * here rather than in the preflight because it needs no database: it is a fact
 * about the repository, so `tests/migration-journal.test.ts` catches it in CI
 * on every branch rather than on whoever migrates next.
 * docs/plans/260828r-worktrees.md, failure row 8.
 *
 * `hashes` is every `.sql` file in the folder, keyed by tag — see
 * {@link hashMigrationFiles}. Both directions are read off that one map, which
 * is why it must be the folder's contents and not the journal's.
 */
export function journalProblems(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];

  const byTag = new Map<string, number>();
  const byWhen = new Map<number, string[]>();
  for (const [i, e] of journal.entries()) {
    if (e.idx !== i) problems.push(`journal entry ${i} carries idx ${e.idx} — the indices are broken`);
    if (byTag.has(e.tag)) problems.push(`the journal names ${e.tag} twice`);
    byTag.set(e.tag, i);
    byWhen.set(e.when, [...(byWhen.get(e.when) ?? []), e.tag]);
    if (!hashes.has(e.tag)) problems.push(`${e.tag} is in the journal but its .sql file could not be read`);
  }
  for (const [when, tags] of byWhen) {
    if (tags.length > 1) problems.push(`${tags.join(" and ")} are both stamped ${when}`);
  }
  for (const tag of [...hashes.keys()].sort()) {
    if (!byTag.has(tag)) {
      problems.push(
        `${tag}.sql is in the migrations folder and the journal does not name it — ` +
          "drizzle will never run it, and until now nothing would have said so. Either " +
          "the journal entry was lost (two sessions generating the same index number is " +
          "how), or the file is debris; work out which and either restore the entry or " +
          "delete the file",
      );
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* The journal as a file                                               */
/* ------------------------------------------------------------------ */

/** One inversion that is already published and must not be re-stamped. */
export interface GrandfatheredInversion {
  /** The entry that sits earlier in the journal and carries the LATER stamp. */
  after: string;
  afterWhen: number;
  /** The entry after it, carrying the earlier stamp. */
  before: string;
  beforeWhen: number;
}

/**
 * Entries stamped no later than something above them in the journal.
 *
 * **This is the file-level shape of the whole defect.** drizzle reads the
 * newest `created_at` once and applies only what is strictly greater, so an
 * entry stamped behind one above it cannot be applied on any database that has
 * already reached the higher stamp. drizzle-kit never generates one; they
 * arrive when a `when` is written by hand.
 *
 * The exemptions carry both names and both timestamps, so regenerating either
 * file takes the exemption away rather than silently inheriting it.
 */
export function journalInversions(
  journal: readonly JournalEntry[],
  grandfathered: readonly GrandfatheredInversion[] = [],
): string[] {
  const inversions: string[] = [];
  let highest = Number.NEGATIVE_INFINITY;
  let highestTag = "(nothing)";
  for (const e of journal) {
    if (e.when <= highest) {
      const excused = grandfathered.some(
        (g) => g.after === highestTag && g.afterWhen === highest && g.before === e.tag && g.beforeWhen === e.when,
      );
      if (!excused) {
        inversions.push(
          `${e.tag} is stamped ${e.when}, which is not after ${highestTag}'s ${highest} — ` +
            "drizzle will never apply it on a database that has already reached that stamp",
        );
      }
    }
    if (e.when > highest) {
      highest = e.when;
      highestTag = e.tag;
    }
  }
  return inversions;
}

/** The stored hash against the file's hash — the only thing that catches an edited migration. */
function hashProblem(
  entry: JournalEntry,
  row: LedgerRow,
  hashes: ReadonlyMap<string, string>,
): string[] {
  const want = hashes.get(entry.tag);
  if (!want || row.hash === want) return [];
  return [
    `${entry.tag} was applied from different SQL than the file now contains — ` +
      "a migration file was edited after it ran, and drizzle will never notice",
  ];
}

/**
 * After `migrate()`: every journal entry has exactly one row with its `when`
 * and its hash.
 *
 * **This is a metadata check and it is not sufficient.** It reads the ledger,
 * not the schema, so it is green by construction for anyone who inserts
 * bookkeeping rows by hand — which is precisely what the repair of this
 * defect had to do. It catches "the migrator said yes and applied nothing",
 * which is the failure it exists for; it cannot catch "the row is there and
 * the column is not". The independent effect checks are `npm run db:check`
 * and `src/db/schema-drift.ts`, and that file says in its own header which
 * things it does not cover. GPT Sol, 2026-08-31, § 6.
 */
export function postflightProblems(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
  rows: readonly LedgerRow[],
): string[] {
  const problems: string[] = [];
  const { matches } = matchJournalToLedger(journal, rows);
  for (const m of matches) {
    if (m.rows.length === 0) {
      problems.push(`${m.entry.tag} still has no ledger row after migrating — nothing applied it`);
      continue;
    }
    if (m.rows.length > 1) {
      problems.push(`${m.entry.tag} now has ${m.rows.length} ledger rows`);
      continue;
    }
    problems.push(...hashProblem(m.entry, m.rows[0]!, hashes));
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* The deploy-time history check                                       */
/* ------------------------------------------------------------------ */

/**
 * Is what the database has applied the beginning of what this commit contains?
 *
 * **The count moving by the right amount is not enough**, and this is the check
 * that says why. `migrate()` looks at the **single most recent** `created_at`
 * and applies every journal entry newer than it — it never compares the hashes
 * it has stored against the files in front of it. So a database that applied a
 * *different* `0016` (a migration that was edited after being applied, or a
 * history from another branch) is indistinguishable from a healthy one by
 * counting, and drizzle will happily carry on appending to it.
 *
 * Since the hash is `sha256` of the file's whole contents, an edited migration
 * changes it. Comparing the applied rows against the committed files is
 * therefore cheap and catches the whole class.
 *
 * `hashes` maps a journal tag to the sha256 of its `.sql` file **at the commit
 * being deployed** — not at whatever is on disk, which several agents are
 * editing. A tag missing from the map is a file this commit does not contain,
 * and this function stays quiet about it; `reconcileLedger` does not.
 */
export function ledgerDivergence(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
  rows: readonly LedgerRow[],
): string[] {
  const applied = [...rows].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  const expected = [...journal].sort((a, b) => a.when - b.when);
  const problems: string[] = [];

  for (const [i, row] of applied.entries()) {
    const entry = expected[i];
    if (!entry) {
      problems.push(
        `the database has applied ${applied.length - i} migration(s) beyond the ${expected.length} this commit contains`,
      );
      break;
    }
    if (Number(row.created_at) !== entry.when) {
      problems.push(
        `applied migration #${i + 1} is stamped ${row.created_at}, but this commit's ${entry.tag} is stamped ${entry.when}`,
      );
      break;
    }
    const want = hashes.get(entry.tag);
    if (want && row.hash !== want) {
      problems.push(
        `${entry.tag} was applied from different SQL than this commit contains — ` +
          "a migration file was edited after it ran, and drizzle will never notice",
      );
      break;
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* Ledger rows belonging to no migration in this journal               */
/* ------------------------------------------------------------------ */

/**
 * A ledger row whose `.sql` file no longer exists, that we can nevertheless
 * name — and whose effects a migration still in the journal has taken over.
 */
export interface KnownOrphan {
  /** Its `created_at`, which is the journal `when` it was applied under. */
  when: number;
  /** sha256 of the deleted `.sql`. A stamp is a clock reading; this says which SQL wrote the row. */
  hash: string;
  tag: string;
  /** How to read the file again. It is deleted from the tree, not from history. */
  wasIn: string;
  /** The journal entry whose postcondition covers this one's. */
  subsumedBy: string;
  /** What it did, in one clause, for the line that gets printed before it is deleted. */
  effect: string;
}

/**
 * **The only ledger rows `--forget-orphans` may ever delete**, named exactly,
 * with the hash that says which SQL wrote them.
 *
 * The first version deleted *every* row the journal did not account for, gated
 * only on "every journal timestamp now exists". GPT Sol's review of the built
 * code is blunt about why that is the wrong gate: another branch's migration can
 * carry a stamp this journal has never seen, and deleting its row destroys the
 * one piece of evidence that would explain the refusal it then causes. A row is
 * history because you can say what it was, not because nothing is pending.
 *
 * These two are the pre-renumbering local migrations of 2026-08-31. Their files
 * were deleted when they were regenerated as `0037`, and they are recoverable —
 * the hashes below were computed from them with `sha256sum`, which is byte for
 * byte what drizzle stores (verified against three rows already in this
 * laptop's ledger), not transcribed from anywhere.
 *
 * `0037` is the union of those two files and nothing besides: its own header
 * says so, and its three statements are their two, one for one. So its
 * postcondition subsumes theirs — which is what `subsumedBy` claims and what
 * {@link planToForget} insists on having *proved* before it deletes anything.
 */
export const KNOWN_ORPHANS: readonly KnownOrphan[] = [
  {
    when: 1788191337811,
    hash: "f2882eb655db0258e12d2273c5aeba74a8e22bd6c1b4345d05e05acd334a3561",
    tag: "0032_experimental_features",
    wasIn: "git show 9a5ef58:drizzle/0032_experimental_features.sql",
    subsumedBy: "0037_experimental_features_and_callout_blocks",
    effect: "reader_profiles.experimental_since",
  },
  {
    when: 1788194935325,
    hash: "ef55623b79f2411c952fbbe6928a95cafb8093bcbc6689d713b2c254ca95cb3f",
    tag: "0033_callout_blocks",
    wasIn: "git show 9a5ef58:drizzle/0033_callout_blocks.sql",
    subsumedBy: "0037_experimental_features_and_callout_blocks",
    effect: "revision_blocks_kind, widened to include 'callout'",
  },
];

/**
 * Which orphan ledger rows may be deleted, and what to print either way.
 *
 * Three conditions, all required:
 *
 * 1. **Every orphan is on the allowlist, by stamp AND hash.** If anything else
 *    is in there, nothing is deleted — including the rows that *are* known,
 *    because a ledger with a row nobody can account for is one to read, not to
 *    tidy.
 * 2. **The migration that subsumes them is being recorded in this same run**,
 *    with every one of its catalogue effects proved. That is what makes the old
 *    rows redundant rather than merely old.
 * 3. **Nothing is left pending afterwards.** An unaccounted-for row is only
 *    safely historical once every current entry is applied — Sol's § 4 policy,
 *    and the reason `db-migrate.ts`'s preflight refuses while both are true.
 *
 * The provenance is printed either way: a row that is *not* deleted still has to
 * be explainable by whoever reads the refusal.
 */
export function planToForget(
  extras: readonly { hash: string; created_at: number | string }[],
  stillPending: readonly { tag: string }[],
  recordingNow: readonly string[],
): { forget: KnownOrphan[]; say: string } {
  if (extras.length === 0) return { forget: [], say: "   None." };

  const matched = extras.map((r) => ({
    row: r,
    known:
      KNOWN_ORPHANS.find((k) => k.when === Number(r.created_at) && k.hash === r.hash) ?? null,
  }));
  const strangers = matched.filter((m) => !m.known);
  if (strangers.length) {
    return {
      forget: [],
      say:
        `   Not forgetting anything. ${strangers.length} of ${extras.length} orphan row(s) are not on\n` +
        "   the allowlist in scripts/migration-ledger.ts:\n" +
        strangers
          .map((m) => `     created_at ${m.row.created_at} hash ${String(m.row.hash).slice(0, 12)}…`)
          .join("\n") +
        "\n   A row nobody can account for may be another branch's migration overlapping what\n" +
        "   is about to run. Work out what it did before deleting the only record of it.",
    };
  }

  const known = matched.map((m) => m.known!);
  const subsumers = [...new Set(known.map((k) => k.subsumedBy))];
  const unproved = subsumers.filter((tag) => !recordingNow.includes(tag));
  if (unproved.length) {
    return {
      forget: [],
      say:
        `   Not forgetting the ${extras.length} orphan row(s): their effects are claimed by\n` +
        `   ${unproved.join(", ")}, which this run is not recording and so has not proved.\n` +
        "   Run the repair that records it first; then these are redundant rather than merely old.",
    };
  }

  if (stillPending.length) {
    return {
      forget: [],
      say:
        `   Not forgetting the ${extras.length} orphan row(s): ${stillPending.length} journal ` +
        "entr(ies) would still be\n" +
        `   unapplied afterwards (${stillPending.map((e) => e.tag).join(", ")}).\n` +
        "   An unaccounted-for row is only safely historical once nothing is pending.",
    };
  }

  return {
    forget: known,
    say:
      `   ${known.length} row(s), each matched by stamp AND hash to a migration renumbered into\n` +
      `   ${subsumers.join(", ")}, whose effects this run proves, nothing left pending:\n` +
      known
        .map((k) => `     ${k.when} ${k.hash.slice(0, 12)}… ${k.tag} — ${k.effect}\n       ${k.wasIn}`)
        .join("\n"),
  };
}

/* ------------------------------------------------------------------ */
/* Reading the folder                                                  */
/* ------------------------------------------------------------------ */

/** The journal at `<folder>/meta/_journal.json`, in the order drizzle reads it. */
export function readJournal(folder: string): JournalEntry[] {
  const text = readFileSync(path.join(folder, "meta", "_journal.json"), "utf8");
  return (JSON.parse(text) as { entries: JournalEntry[] }).entries;
}

/**
 * tag → sha256 of the whole `.sql` file, computed exactly as drizzle computes
 * it: `createHash("sha256").update(<the file as a string>)`, no normalisation
 * (`node_modules/drizzle-orm/migrator.cjs`).
 *
 * **Every `.sql` in the folder, not every entry in the journal**, and the
 * difference is the point. Hashing the journal's list can only ever answer *is
 * a file missing*; hashing the folder's answers *is a file unaccounted for* as
 * well, which is the failure that actually happened here — `journalProblems`
 * says what it was. A tag in the journal with no file is simply absent from the
 * map rather than throwing, so the caller can report every problem at once
 * instead of the first.
 */
export function hashMigrationFiles(folder: string): Map<string, string> {
  const hashes = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    /* No folder is "no migrations on disk". Every journal entry then reports
       its own missing file, which says the same thing more usefully. */
    return hashes;
  }
  for (const name of names) {
    if (!name.endsWith(".sql")) continue;
    const sql = readFileSync(path.join(folder, name)).toString();
    hashes.set(name.slice(0, -".sql".length), createHash("sha256").update(sql).digest("hex"));
  }
  return hashes;
}

/* ------------------------------------------------------------------ */
/* The bookkeeping table                                               */
/* ------------------------------------------------------------------ */

/**
 * Must match `drizzle.config.ts` and the `migrate()` call in
 * `scripts/db-migrate.ts`. They are copies of one fact, and the migrator
 * silently starts a FRESH history if they disagree.
 */
export { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from "../src/migration-digest.js";

/**
 * The advisory-lock key `db:migrate` holds for the whole run.
 *
 * Arbitrary, but fixed: any process that migrates this database must use this
 * same number or the lock protects nothing. drizzle takes no lock of its own,
 * so without this two invocations read the same watermark and both try the
 * same DDL — GPT Sol, 2026-08-31, closing paragraph.
 */
export const MIGRATION_LOCK_KEY = 260_831;

/* ------------------------------------------------------------------ */
/* What a commit says it needs                                         */
/* ------------------------------------------------------------------ */

/**
 * The migrations a checkout of `folder` expects a database to hold, in journal
 * order, ready to be stamped into a build.
 *
 * Read by [`vite.api.config.ts`](../vite.api.config.ts) so the deployed
 * function can say what it needs, and by `scripts/deploy.ts` so a push can be
 * compared against a live `/api/health` **with no database credential**. The
 * comparison itself is `compareMigrations` in
 * [`src/migration-digest.ts`](../src/migration-digest.ts) — one function, both
 * callers, so the two sides cannot drift into disagreeing about what "the same
 * migrations" means.
 *
 * **It throws on a journal entry with no `.sql` file, and that is the whole
 * design of it.** Skipping the entry instead would produce a digest that
 * happily matches a database which never applied that migration — a checkout
 * missing a file would report itself in step with production. The failure this
 * function exists to make visible is exactly the one a lenient version would
 * manufacture, so a broken folder must be loud rather than shorter.
 * `journalProblems` above is what turns the same condition into a readable
 * report when the caller wants every fault at once instead of the first.
 */
export function expectedMigrations(folder: string): { tag: string; hash: string; created_at: number }[] {
  const journal = readJournal(folder);
  const hashes = hashMigrationFiles(folder);
  return journal.map((entry) => {
    const hash = hashes.get(entry.tag);
    if (!hash) {
      throw new Error(
        `${folder}/meta/_journal.json lists '${entry.tag}' but ${entry.tag}.sql is not in the folder. ` +
          "Refusing to compute a migration digest from an incomplete checkout — it would match a " +
          "database that never applied it. See src/migration-digest.ts.",
      );
    }
    return { tag: entry.tag, hash, created_at: entry.when };
  });
}
