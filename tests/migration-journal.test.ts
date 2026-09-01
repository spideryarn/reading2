/**
 * `drizzle/meta/_journal.json`, checked as a file rather than against a
 * database.
 *
 * **The rule: each entry's `when` must be greater than every entry before it.**
 * drizzle applies a migration only when its `when` is strictly greater than the
 * newest `created_at` already recorded, and it reads that number once, before
 * its loop. So an entry stamped earlier than one above it in the journal is
 * unapplicable on every database that has already reached the higher stamp —
 * for ever, silently, under a `✓ migrations applied`.
 *
 * drizzle-kit generates real timestamps and so never breaks this. It gets
 * broken by hand: `0035_timeline`'s entry was written with a round
 * `when` of 1788200000000, which put it after `0036_drop_summary_column`'s real
 * 1788175229610 and stranded four migrations on this laptop. Whether it did the
 * same to production is an inference from the timestamps and nothing more —
 * that database has never been looked at, there are no credentials in the tree,
 * and the postmortem says so. This comment used to claim it "cost a repair on
 * production", which was a claim nobody had checked, in a file whose whole
 * subject is claims nobody had checked. That one pair is grandfathered below,
 * because both are pushed and re-stamping a published migration makes it re-run
 * where it already ran.
 *
 * scripts/migration-ledger.ts is the runtime half of this;
 * docs/project/database.md § A watermark is not a ledger is the story.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  hashMigrationFiles,
  journalInversions,
  journalProblems,
  readJournal,
  type GrandfatheredInversion,
  type JournalEntry,
} from "../scripts/migration-ledger.js";

const FOLDER = path.resolve(import.meta.dirname, "../drizzle");

/**
 * The one inversion that already exists, named exactly.
 *
 * A pair rather than a tag, and the timestamps as well as the names, so that
 * regenerating either file — which changes its `when` — takes the exemption
 * away rather than inheriting it.
 */
const GRANDFATHERED: GrandfatheredInversion[] = [
  {
    after: "0035_timeline",
    afterWhen: 1788200000000,
    before: "0036_drop_summary_column",
    beforeWhen: 1788175229610,
  },
];

describe("drizzle/meta/_journal.json", () => {
  const journal = readJournal(FOLDER);

  it("has an entry to check at all", () => {
    expect(journal.length).toBeGreaterThan(30);
  });

  it("stamps every migration later than every one before it", () => {
    expect(journalInversions(journal, GRANDFATHERED)).toEqual([]);
  });

  /* The grandfather clause is a liability, not a feature: it must not quietly
     outlive the pair it was written for. */
  it("still contains exactly the inversion that is grandfathered, and no other", () => {
    for (const g of GRANDFATHERED) {
      expect(journal.find((e) => e.tag === g.after)?.when).toBe(g.afterWhen);
      expect(journal.find((e) => e.tag === g.before)?.when).toBe(g.beforeWhen);
    }
  });

  it("has no duplicate tags, no duplicate stamps and no broken indices", () => {
    expect(journalProblems(journal, hashMigrationFiles(FOLDER))).toEqual([]);
  });

  it("has a .sql file for every entry", () => {
    const missing = journal.filter((e) => !existsSync(path.join(FOLDER, `${e.tag}.sql`)));
    expect(missing.map((e) => e.tag)).toEqual([]);
  });

  /* The other direction, and the one that actually happened. See below. */
  it("has a journal entry for every .sql file", () => {
    const named = new Set(journal.map((e) => e.tag));
    const stray = [...hashMigrationFiles(FOLDER).keys()].filter((tag) => !named.has(tag));
    expect(stray).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

/**
 * **A `.sql` in the folder that the journal does not name.**
 *
 * On 2026-08-31 two sessions in this one tree ran `drizzle-kit generate`
 * minutes apart without pulling. Both produced an `0032`:
 * `0032_experimental_features.sql` and `0032_jobs_concurrency_cap.sql` were
 * both on disk, the journal named one of them, and the other never ran and
 * nothing said so — the file was simply invisible to every check there was.
 * `journalProblems` had four rules and all four looked journal-side.
 *
 * Predicted as failure row 8 of docs/plans/260828r-worktrees.md for two
 * worktrees; it happened between two sessions in a single tree, which makes it
 * likelier than the prediction, not less.
 *
 * A fixture folder rather than the real `drizzle/`, because the assertion above
 * is that the real one is clean — and a test that has to dirty the thing it
 * guards is a test that can leave it dirty.
 */
describe("a .sql file the journal has never heard of", () => {
  /** A throwaway drizzle folder: a journal, and whatever files are asked for. */
  const folderWith = (entries: JournalEntry[], files: string[]): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "spya-journal-"));
    mkdirSync(path.join(dir, "meta"));
    writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ entries }));
    for (const f of files) writeFileSync(path.join(dir, `${f}.sql`), `-- ${f}\n`);
    return dir;
  };

  const entries: JournalEntry[] = [
    { idx: 0, tag: "0000_first", when: 100 },
    { idx: 1, tag: "0001_second", when: 200 },
  ];

  it("passes when the folder and the journal agree", () => {
    const dir = folderWith(entries, ["0000_first", "0001_second"]);
    expect(journalProblems(readJournal(dir), hashMigrationFiles(dir))).toEqual([]);
  });

  it("names the orphan, and says it will never run", () => {
    const dir = folderWith(entries, ["0000_first", "0001_second", "0001_the_other_session"]);
    const problems = journalProblems(readJournal(dir), hashMigrationFiles(dir));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("0001_the_other_session.sql is in the migrations folder");
    expect(problems[0]).toContain("drizzle will never run it");
  });

  /* The shape of the real accident: two files claiming one index, one of them
     named. The named one is fine and the other is the whole problem. */
  it("catches the two-sessions-one-index collision", () => {
    const dir = folderWith(
      [{ idx: 0, tag: "0032_jobs_concurrency_cap", when: 100 }],
      ["0032_jobs_concurrency_cap", "0032_experimental_features"],
    );
    const problems = journalProblems(readJournal(dir), hashMigrationFiles(dir));
    expect(problems.join("\n")).toContain("0032_experimental_features.sql");
    expect(problems.join("\n")).not.toContain("0032_jobs_concurrency_cap.sql is in");
  });

  /* Both directions at once, so that fixing one cannot mask the other. */
  it("reports a missing file and a stray file in the same breath", () => {
    const dir = folderWith(entries, ["0000_first", "0009_stray"]);
    const problems = journalProblems(readJournal(dir), hashMigrationFiles(dir)).join("\n");
    expect(problems).toContain("0001_second is in the journal but its .sql file could not be read");
    expect(problems).toContain("0009_stray.sql is in the migrations folder");
  });
});

/* ------------------------------------------------------------------ */

/**
 * The rule itself, shown refusing. The journal on disk passes, so on its own it
 * is exactly the evidence docs/reusable/silent-success.md warns about — these
 * feed it the shapes it exists to reject.
 */
describe("journalInversions", () => {
  const entry = (tag: string, when: number, idx: number): JournalEntry => ({ idx, tag, when });

  it("catches a new migration stamped behind the one before it", () => {
    const j = [entry("0000_a", 100, 0), entry("0001_b", 300, 1), entry("0002_c", 200, 2)];
    expect(journalInversions(j).join("\n")).toContain("0002_c is stamped 200");
  });

  it("catches two migrations stamped the same millisecond", () => {
    const j = [entry("0000_a", 100, 0), entry("0001_b", 100, 1)];
    expect(journalInversions(j)).toHaveLength(1);
  });

  it("excuses the published pair, and only that pair", () => {
    const j = [
      entry("0034_x", 100, 0),
      entry("0035_timeline", 1788200000000, 1),
      entry("0036_drop_summary_column", 1788175229610, 2),
    ];
    expect(journalInversions(j, GRANDFATHERED)).toEqual([]);
  });

  /* The exemption must not become general cover. A NEW inversion after the
     grandfathered one is still an inversion — and it is measured against the
     highest stamp seen, which is 0035's, not 0036's. */
  it("still catches a new inversion that follows the grandfathered one", () => {
    const j = [
      entry("0035_timeline", 1788200000000, 0),
      entry("0036_drop_summary_column", 1788175229610, 1),
      entry("0037_new", 1788190000000, 2),
    ];
    expect(journalInversions(j, GRANDFATHERED).join("\n")).toContain("0037_new is stamped");
  });

  /* Regenerating either half changes its `when`, and the exemption is keyed on
     both timestamps precisely so that it lapses when that happens. */
  it("stops excusing the pair once either file is re-stamped", () => {
    const j = [entry("0035_timeline", 1788200000000, 0), entry("0036_drop_summary_column", 1788175229611, 1)];
    expect(journalInversions(j, GRANDFATHERED)).toHaveLength(1);
  });
});
