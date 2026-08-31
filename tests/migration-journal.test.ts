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
 * 1788175229610 and cost four migrations on this laptop and a repair on
 * production. That one pair is grandfathered below, because both are pushed and
 * re-stamping a published migration makes it re-run where it already ran.
 *
 * scripts/migration-ledger.ts is the runtime half of this;
 * docs/project/database.md § A watermark is not a ledger is the story.
 */

import { existsSync } from "node:fs";
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
    expect(journalProblems(journal, hashMigrationFiles(FOLDER, journal))).toEqual([]);
  });

  it("has a .sql file for every entry", () => {
    const missing = journal.filter((e) => !existsSync(path.join(FOLDER, `${e.tag}.sql`)));
    expect(missing.map((e) => e.tag)).toEqual([]);
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
