/**
 * `npm run db:generate` — drizzle-kit generate, with a postcondition.
 *
 *   npm run db:generate
 *   npm run db:generate -- --name add_widget_table
 *   npm run db:generate -- --custom --name backfill_widgets
 *   npm run db:generate -- --allow-empty      # "no schema changes" is the answer I wanted
 *
 * **Why this file exists: `drizzle-kit generate` can exit 0 having written
 * nothing.** Verified 2026-09-02 against a copy of `drizzle/` carrying a second
 * snapshot that claimed `0051`'s parent — the shape two worktrees produce when
 * both generate from the same trunk:
 *
 *   drizzle-kit check      names both files, exit 1
 *   drizzle-kit generate   prints the same red "Error:", exit 0, nothing written
 *
 * `bin.cjs` has the two `process.exit` calls a few lines apart, and the
 * generate side is the one that says 0. There are two more exit-0-with-no-output
 * paths next to it — a snapshot of an unsupported version, and a snapshot that
 * is not of the latest version — so this wrapper does not check for the forked
 * chain specifically. **It checks that success produced output**, which closes
 * the whole family including whatever drizzle adds to it next.
 *
 * That is the shape docs/reusable/silent-success.md is about: the operator asked
 * for a migration, got a success code, and got no migration.
 *
 * This would also have caught `0029_assets`, whose snapshot never reached the
 * folder — the next `generate` then diffed against `0028`, re-emitted DDL that
 * was already applied, and failed on `column "assets" … already exists`. The
 * repair is written up at the top of drizzle/0030_drop_summary_steer.sql.
 *
 * The plan is docs/plans/260902c-concurrent-migrations-across-worktrees.md,
 * stage 3.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJournal, type JournalEntry } from "./migration-ledger.js";
import { HISTORICAL, readSnapshots, snapshotProblems } from "./migration-snapshots.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOLDER = path.join(ROOT, "drizzle");

/**
 * `--allow-empty` is ours, not drizzle's, so it must not be passed through.
 * Everything else is, because drizzle owns its own flags and this wrapper has
 * no business knowing what they are.
 */
const ALLOW_EMPTY = "--allow-empty";
const passthrough = process.argv.slice(2).filter((a) => a !== ALLOW_EMPTY);
const allowEmpty = process.argv.slice(2).includes(ALLOW_EMPTY);
/* `--help` writes nothing on purpose, and so does asking drizzle for its
   version. Enforcing the postcondition on those would just be wrong. */
const asking = passthrough.some((a) => a === "--help" || a === "-h" || a === "--version");

/** Everything the folder holds, read the way drizzle writes it. */
interface FolderState {
  /** Journal entries, in journal order. */
  entries: JournalEntry[];
  /** Every `.sql` basename in `drizzle/`. */
  sql: Set<string>;
  /** Every entry in `drizzle/meta/`, including `_journal.json`. */
  meta: Set<string>;
}

function readFolder(): FolderState {
  const listing = (dir: string): string[] => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  };
  let entries: JournalEntry[] = [];
  try {
    entries = readJournal(FOLDER);
  } catch {
    /* No journal yet is a legitimate starting state — drizzle writes one. */
  }
  return {
    entries,
    sql: new Set(listing(FOLDER).filter((f) => f.endsWith(".sql"))),
    meta: new Set(listing(path.join(FOLDER, "meta"))),
  };
}

/**
 * What drizzle wrote, judged against what it should have written.
 *
 * **All three artefacts, not just the journal.** `writeResult` in `bin.cjs`
 * writes the snapshot, then the journal, then the `.sql`, in that order — so a
 * run that dies partway through leaves a snapshot nothing names, which is
 * exactly the `0032` collision this repo has already had (see
 * `journalProblems` in scripts/migration-ledger.ts). Checking only the journal
 * would call that a success.
 */
function postcondition(before: FolderState, after: FolderState): string[] {
  /**
   * **The whole folder first, and before the `--allow-empty` shortcut.**
   *
   * This asks whether `drizzle/meta/` is still a chain — the ordering, the
   * terminal snapshot, duplicate ids, a snapshot nothing names. It runs even
   * when nothing was written, and that is the point: a forked chain makes
   * `generate` refuse and exit 0 *without* printing "No schema changes", which
   * is indistinguishable at this level from an honest no-op. Returning early on
   * `--allow-empty` would have let the flag hide the exact failure this file
   * exists to catch — which is what the first version of it did. Verified by
   * forking `drizzle/meta/` for a minute on 2026-09-02: with the early return,
   * `db:generate -- --allow-empty` printed a green ✓ over a red `Error:`;
   * without it, exit 1 naming the fork four ways.
   */
  const problems: string[] = [
    ...snapshotProblems(after.entries, readSnapshots(FOLDER), HISTORICAL),
  ];

  const known = new Set(before.entries.map((e) => e.tag));
  const fresh = after.entries.filter((e) => !known.has(e.tag));

  if (fresh.length === 0) {
    if (allowEmpty) return problems;
    return [
      ...problems,
      "drizzle-kit generate exited 0 and wrote no migration.",
      "",
      "  If you expected one, the usual cause is a forked snapshot chain — two",
      "  worktrees generating from the same parent. drizzle prints a red Error:",
      "  above and then exits 0 anyway. Run `npm run db:chain` to see it named,",
      "  and docs/project/database.md § Two worktrees generated at once for the",
      "  repair, which depends on what the losing migration is.",
      "",
      `  If you did expect nothing to change, say so: npm run db:generate -- ${ALLOW_EMPTY}`,
    ];
  }

  if (fresh.length > 1) {
    problems.push(
      `drizzle-kit wrote ${fresh.length} journal entries in one run (${fresh
        .map((e) => e.tag)
        .join(", ")}) — it writes one, so something else edited the journal underneath this`,
    );
  }

  for (const entry of fresh) {
    const prefix = entry.tag.split("_")[0] ?? entry.tag;
    const sql = `${entry.tag}.sql`;
    const snapshot = `${prefix}_snapshot.json`;

    if (!after.sql.has(sql)) {
      problems.push(`the journal now names ${entry.tag} and ${sql} is not in drizzle/`);
    }
    if (!after.meta.has(snapshot)) {
      problems.push(
        `the journal now names ${entry.tag} and drizzle/meta/${snapshot} is not there — ` +
          "the next generate will diff against an older snapshot and re-emit DDL that has " +
          "already run (drizzle/0030_drop_summary_steer.sql is the last time)",
      );
    } else if (before.meta.has(snapshot)) {
      problems.push(
        `${entry.tag} was written over an existing drizzle/meta/${snapshot} — another ` +
          "migration already owned that prefix, and its snapshot is now gone. " +
          "drizzle derives the number from the journal alone, so a journal that is " +
          "behind the folder silently overwrites (drizzle-orm#5774)",
      );
    }
  }

  const last = after.entries[after.entries.length - 1];
  if (last && fresh.length === 1 && last.tag !== fresh[0]!.tag) {
    problems.push(
      `the new migration ${fresh[0]!.tag} is not the last entry in the journal — ${last.tag} is`,
    );
  }

  return problems;
}

const before = readFolder();

const run = spawnSync("npx", ["drizzle-kit", "generate", ...passthrough], {
  cwd: ROOT,
  stdio: "inherit",
});
/* A signal leaves status null; treat that as a failure rather than letting a
   falsy null read as success. Same reasoning as scripts/check.ts. */
const code = run.status ?? 1;

if (asking) process.exit(code);

if (code !== 0) {
  console.error(`\ndrizzle-kit generate failed (exit ${code}). Nothing was checked.`);
  process.exit(code);
}

const after = readFolder();
const problems = postcondition(before, after);

if (problems.length > 0) {
  console.error(`\n${"=".repeat(64)}`);
  console.error("db:generate: drizzle-kit reported success and the folder disagrees");
  console.error("=".repeat(64));
  for (const p of problems) console.error(p.startsWith(" ") || p === "" ? p : `  ✗ ${p}`);
  console.error("");
  process.exit(1);
}

const known = new Set(before.entries.map((e) => e.tag));
const fresh = after.entries.filter((e) => !known.has(e.tag));
if (fresh.length === 0) {
  console.log(`\n✓ no schema changes, and ${ALLOW_EMPTY} says that is the answer you wanted`);
} else {
  for (const e of fresh) {
    console.log(`\n✓ ${e.tag} — .sql, snapshot and journal entry all written`);
  }
  console.log("  Read the SQL before you migrate. `npm run db:migrate` applies it.");
}
