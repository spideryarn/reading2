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
 * generate side is the one that says 0. There are more exit-0-with-no-output
 * paths next to it — a snapshot of an unsupported version, one that is not of
 * the latest version, a missing schema file — so this does not look for the
 * forked chain specifically. **It checks that success produced output.**
 *
 * That is the shape docs/reusable/silent-success.md is about: the operator asked
 * for a migration, got a success code, and got no migration.
 *
 * ## Three checks, and the order is the point
 *
 * 1. **Before drizzle runs**: `drizzle-kit check`, plus `snapshotProblems` for
 *    the holes and breaks that `check` is green on. **A precondition, because a
 *    postcondition is too late for half of this.** If the folder is already
 *    holed or its terminal snapshot is the wrong one, drizzle diffs against the
 *    wrong base and writes a *bad but complete* migration — all three artefacts
 *    present, postcondition satisfied. That is the `0029 → 0030` failure exactly:
 *    catching it afterwards means catching it after the damage. GPT Sol's code
 *    review, 2026-09-02.
 * 2. **drizzle runs**, with its output inherited, so its rename prompts work.
 * 3. **After**: the three artefacts this run should have written, and the whole
 *    folder again.
 *
 * Step 1 is also why `--allow-empty` cannot paper anything over: it runs
 * unconditionally, before the flag is consulted, and `drizzle-kit check` is the
 * tool that exits 1 on the unsupported-version paths this file cannot see.
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
import { HISTORICAL, prefixOf, readSnapshots, snapshotProblems } from "./migration-snapshots.js";

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

/**
 * **Flags that move the folder, refused rather than handled.**
 *
 * Every check here reads `<repo>/drizzle`, so a `--config` or `--out` pointing
 * somewhere else would have this inspecting one folder while drizzle wrote to
 * another: a real migration reported as "wrote no migration", or — with
 * `--allow-empty` — reported as an intentional no-op. Deriving the effective
 * folder would mean re-implementing drizzle's config resolution, which is a
 * second copy of a fact. Refusing is the honest option, and nothing in this
 * repo generates anywhere but `drizzle/`. GPT Sol's code review, 2026-09-02.
 */
const MOVES_THE_FOLDER = ["--config", "--out"];
const moved = passthrough.filter((a) => MOVES_THE_FOLDER.some((f) => a === f || a.startsWith(`${f}=`)));
if (moved.length > 0 && !asking) {
  console.error(
    `\ndb:generate cannot check a run that writes somewhere else (${moved.join(", ")}).\n` +
      `  Its checks read ${path.relative(process.cwd(), FOLDER)} and nothing else.\n` +
      "  Run `npx drizzle-kit generate` directly if you really mean to, and know that\n" +
      "  nothing will tell you if it exits 0 having written nothing.",
  );
  process.exit(1);
}

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
  } catch (err) {
    /* Only a missing file is the legitimate starting state. This catch used to
       swallow every failure, which meant a journal left mid-merge lost the one
       message that says so — `readJournal` names the file, the line and the
       marker, and generating on top of a conflicted journal is the last thing
       anybody wants. */
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
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
 * writes the snapshot, then the journal, then the `.sql`, as three separate
 * `writeFileSync` calls — so a run that dies partway through leaves the folder
 * mid-write, and checking only the journal would call two of the three
 * outcomes a success.
 *
 * The repo has had the missing-snapshot half of that for real, though not from
 * a crash: `0032_jobs_concurrency_cap` shipped its SQL and its journal entry
 * while its snapshot sat untracked, and the snapshot arrived in a later commit
 * ("The snapshot that would have brought the index back"). An earlier version
 * of this comment called that a snapshot naming no journal entry, which is the
 * same accident mirrored and is not what happened. GPT Sol's code review,
 * 2026-09-02, checked the history.
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
    const prefix = prefixOf(entry.tag);
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

/** Print a list of sentences under a heading, the way this file reports. */
function report(heading: string, problems: readonly string[]): void {
  console.error(`\n${"=".repeat(64)}`);
  console.error(heading);
  console.error("=".repeat(64));
  for (const p of problems) console.error(p.startsWith(" ") || p === "" ? p : `  ✗ ${p}`);
  console.error("");
}

const before = readFolder();

/**
 * **Step 1, and the reason this is not just a postcondition.**
 *
 * `drizzle-kit check` reads the folder exactly as `generate` is about to, and
 * exits 1 on the fork, on malformed snapshots and on out-of-date ones — the
 * last of which `generate` merely exits 0 over. `snapshotProblems` adds what
 * `check` is green on. Together they mean the folder drizzle is about to diff
 * against is one we have looked at, rather than one we will inspect after it
 * has already produced SQL from the wrong base.
 */
if (!asking) {
  const chain = snapshotProblems(before.entries, readSnapshots(FOLDER), HISTORICAL);
  const check = spawnSync("npx", ["drizzle-kit", "check"], { cwd: ROOT, encoding: "utf8" });
  const checkOut = `${check.stdout ?? ""}${check.stderr ?? ""}`.trim();
  const problems = [
    ...chain,
    ...(check.status === 0 ? [] : [`drizzle-kit check refuses this folder:\n${checkOut}`]),
  ];
  if (problems.length > 0) {
    report("db:generate: drizzle/meta/ is not sound, so nothing was generated", problems);
    console.error(
      "  Generating against this would diff from the wrong snapshot and write SQL that\n" +
        "  looks complete and is wrong. docs/project/database.md § Two worktrees generated\n" +
        "  at once has the repair, and it depends on what the losing migration is.\n",
    );
    process.exit(1);
  }
}

const run = spawnSync("npx", ["drizzle-kit", "generate", ...passthrough], {
  cwd: ROOT,
  stdio: "inherit",
});
/* A signal leaves status null; treat that as a failure rather than letting a
   falsy null read as success. Same reasoning as scripts/check.ts. */
const code = run.status ?? 1;

if (asking) process.exit(code);

if (code !== 0) {
  console.error(`\ndrizzle-kit generate failed (exit ${code}).`);
  /* It writes snapshot, journal and .sql as three separate calls, so a death
     partway through leaves the folder mid-write. The command has already
     failed — this is about what the NEXT one starts from. */
  const wreckage = snapshotProblems(readFolder().entries, readSnapshots(FOLDER), HISTORICAL);
  if (wreckage.length > 0) {
    report("and it left drizzle/meta/ in a state the next command cannot use", wreckage);
  } else {
    console.error("  drizzle/meta/ is still sound, so nothing needs unpicking.\n");
  }
  process.exit(code);
}

const after = readFolder();
const problems = postcondition(before, after);

if (problems.length > 0) {
  report("db:generate: drizzle-kit reported success and the folder disagrees", problems);
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
