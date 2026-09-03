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

/* ------------------------------------------------------------------ */

/**
 * **A half-finished merge inside the journal.**
 *
 * On 2026-09-02 `drizzle/meta/_journal.json` sat in the shared primary checkout
 * with `<<<<<<< HEAD` still in it, and every migration tool in the repo went
 * blind at once: `readJournal` threw `SyntaxError: Expected ',' or '}' after
 * property value in JSON at position 8151`, `npm run db:migrate` died on it, and
 * `spideryarn.ai_calls` was left short the columns the code already wrote, so
 * **every paid model call on the box was recorded nowhere** for hours.
 *
 * The cost was not the outage, it was the diagnosis. A JSON parse error at a
 * byte offset says nothing about merges, so the hunt went to the ledger instead
 * — three rows were read as belonging to no migration, and an hour went into
 * hashing every `.sql` across every worktree to prove all three were real
 * migrations and the ledger had been fine the whole time. One sentence naming
 * the marker would have ended it at the first command.
 *
 * The class: **a machine-read file that a human merge can corrupt, whose reader
 * reports the corruption in its own vocabulary rather than the one the reader
 * needs.** `_journal.json` is the worst case in this repo — nearly every change
 * appends to the same last line, so it conflicts constantly, and nothing but the
 * tools ever reads it, so nobody sees the markers.
 */
describe("conflict markers in the journal", () => {
  const journalSaying = (text: string): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "spya-journal-"));
    mkdirSync(path.join(dir, "meta"));
    writeFileSync(path.join(dir, "meta", "_journal.json"), text);
    return dir;
  };

  /* Built rather than typed, so this file does not itself trip `git diff
     --check` and every reviewer's editor. `n` is git's conflict-marker-size,
     which is configurable — the default is 7. */
  const marker = (ch: string, n = 7): string => ch.repeat(n);

  const conflicted = (open: string, sep: string, close: string, eol = "\n"): string =>
    [
      "{",
      '  "entries": [',
      '    { "idx": 0, "version": "7", "when": 100, "tag": "0000_first" }',
      open,
      sep,
      '    ,{ "idx": 1, "version": "7", "when": 200, "tag": "0001_theirs" }',
      close,
      "  ]",
      "}",
    ].join(eol);

  const DEFAULT = conflicted(`${marker("<")} HEAD`, marker("="), `${marker(">")} origin/dev`);

  const messageFrom = (dir: string): string => {
    try {
      readJournal(dir);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    throw new Error("readJournal did not throw");
  };

  it("says the word 'merge', and names the file", () => {
    const dir = journalSaying(DEFAULT);
    expect(() => readJournal(dir)).toThrow(/unresolved merge conflict/i);
    expect(() => readJournal(dir)).toThrow(/_journal\.json/);
  });

  /* The marker and its line are what a reader can act on; a byte offset into
     the JSON is not, and leading with one is how the real hour was lost. The
     assertion is on the FIRST line, so a message that buries the marker under
     the parser error fails — the earlier version of this test only checked the
     marker appeared somewhere, which a much worse message also satisfies. */
  it("puts the file, the line and the marker in its first line", () => {
    const first = messageFrom(journalSaying(DEFAULT)).split("\n")[0] ?? "";
    expect(first).toContain("_journal.json");
    expect(first).toContain("line 4");
    expect(first).toContain(`${marker("<")} HEAD`);
  });

  /* Sends the reader to the runbook rather than restating it — the fork, not
     the markers, is the part that bites, and it lives in one place. */
  it("points at the fork runbook and the check that catches it", () => {
    const message = messageFrom(journalSaying(DEFAULT));
    expect(message).toContain("Repairing a fork");
    expect(message).toContain("db:chain");
  });

  /* `conflict-marker-size` is configurable, so exactly-seven is an assumption
     about somebody else's git config. Eight `<` used to slip straight past. */
  it("catches a marker longer than the default seven", () => {
    const dir = journalSaying(conflicted(`${marker("<", 9)} HEAD`, marker("=", 9), marker(">", 9)));
    expect(() => readJournal(dir)).toThrow(/unresolved merge conflict/i);
  });

  /* diff3/zdiff3 add a base section. A half-finished resolution can leave only
     that marker behind, with the ones either side already deleted. */
  it("catches a lone diff3 base marker", () => {
    const dir = journalSaying(
      ["{", '  "entries": [', `${marker("|")} base`, "  ]", "}"].join("\n"),
    );
    expect(() => readJournal(dir)).toThrow(/unresolved merge conflict/i);
  });

  it("catches a CRLF conflict, and quotes the marker without the carriage return", () => {
    const first =
      messageFrom(
        journalSaying(conflicted(`${marker("<")} HEAD`, marker("="), marker(">"), "\r\n")),
      ).split("\n")[0] ?? "";
    expect(first).toContain(`${marker("<")} HEAD`);
    expect(first).not.toContain("\r");
  });

  /* Malformed-but-unmerged JSON is a different fault and must not be dressed up
     as a merge — a wrong diagnosis is what this whole block exists to stop. */
  it("does not blame a merge for ordinary broken JSON", () => {
    const dir = journalSaying(`{ "entries": [ }`);
    expect(() => readJournal(dir)).toThrow();
    expect(() => readJournal(dir)).not.toThrow(/merge conflict/i);
  });

  /* A `tag` is a filename a person chose, and JSON allows a raw U+2028 inside a
     string while JavaScript counts it as a line break. Scanning the text with a
     multiline regex called this valid journal a conflict. */
  it("does not blame a merge for a tag containing a line separator", () => {
    const dir = journalSaying(
      JSON.stringify({
        entries: [{ idx: 0, tag: `0000_odd ${marker("<")} HEAD`, when: 100 }],
      }),
    );
    expect(readJournal(dir)).toHaveLength(1);
  });

  it("still reads a journal with no markers in it", () => {
    const dir = journalSaying(
      JSON.stringify({ entries: [{ idx: 0, tag: "0000_first", when: 100 }] }),
    );
    expect(readJournal(dir)).toHaveLength(1);
  });

  /* `scripts/db-generate.ts` distinguishes "no journal yet", which is a
     legitimate starting state, from every other failure, which it must not
     swallow — it used to catch all of them and lose this diagnostic entirely.
     That narrowing is only sound while a missing file arrives as ENOENT. */
  it("reports a missing journal as ENOENT, which is what db:generate keys on", () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "spya-journal-"));
    let code: string | undefined;
    try {
      readJournal(empty);
    } catch (err) {
      code = (err as NodeJS.ErrnoException).code;
    }
    expect(code).toBe("ENOENT");
  });
});
