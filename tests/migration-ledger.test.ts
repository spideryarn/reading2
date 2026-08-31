/**
 * The migration preflight, shown refusing before it is trusted.
 *
 * Every `it` here leads with the broken input. That ordering is the point: this
 * guard exists because `✓ migrations applied` was printed over four migrations
 * that never ran, and a guard whose only observed behaviour is "passed" is the
 * same kind of evidence as that tick.
 * docs/reusable/silent-success.md, scripts/migration-ledger.ts.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  crossesWatermark,
  hashMigrationFiles,
  matchJournalToLedger,
  migrationState,
  postflightProblems,
  readJournal,
  reconcileLedger,
  type JournalEntry,
  type LedgerRow,
} from "../scripts/migration-ledger.js";

const journal = (...whens: number[]): JournalEntry[] =>
  whens.map((when, idx) => ({ idx, tag: `${String(idx).padStart(4, "0")}_thing`, when }));

/** A hash map that agrees with every row below, so hashes never confuse a case. */
const hashesFor = (j: readonly JournalEntry[]) => new Map(j.map((e) => [e.tag, `h-${e.tag}`]));

const rowFor = (e: JournalEntry): LedgerRow => ({ hash: `h-${e.tag}`, created_at: e.when });

const LAPTOP = { allowHistoricalExtras: true };
const PRODUCTION = { allowHistoricalExtras: false };

/* ------------------------------------------------------------------ */

describe("crossesWatermark — drizzle's actual rule", () => {
  it("refuses an entry stamped exactly at the watermark, because drizzle uses <", () => {
    expect(crossesWatermark(500, 500)).toBe(false);
  });

  it("lets everything through when the ledger is empty", () => {
    expect(crossesWatermark(1, null)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("reconcileLedger, condition 3 — the watermark gap", () => {
  /**
   * **The defect, in miniature.** `0002` is stamped BEFORE `0003` in wall-clock
   * terms but comes after it in the journal, which is the exact shape of
   * `0035_timeline` (hand-written `when` 1788200000000) and
   * `0036_drop_summary_column` (real `when` 1788175229610).
   *
   * A database that applied `0003` can never apply `0002`: drizzle reads the
   * newest `created_at` once and applies only what is strictly greater.
   * `migrationState` — which answers "what will drizzle do" — calls it not
   * pending, and is right about the migrator and wrong about the world.
   */
  const inverted: JournalEntry[] = [
    { idx: 0, tag: "0000_a", when: 100 },
    { idx: 1, tag: "0001_b", when: 200 },
    { idx: 2, tag: "0002_late", when: 400 },
    { idx: 3, tag: "0003_early", when: 300 },
  ];
  const hashes = hashesFor(inverted);

  it("refuses a database that applied the later-stamped entry first", () => {
    const rows = [inverted[0]!, inverted[1]!, inverted[2]!].map(rowFor);
    const state = reconcileLedger(inverted, hashes, rows, LAPTOP);
    expect(state.unreachable.map((e) => e.tag)).toEqual(["0003_early"]);
    expect(state.problems.join("\n")).toContain("can never be applied");
  });

  it("is the only thing that notices — drizzle's own arithmetic calls it clean", () => {
    const rows = [inverted[0]!, inverted[1]!, inverted[2]!].map(rowFor);
    expect(migrationState(inverted, 400, rows.length).pending).toEqual([]);
  });

  /* A database one step further back is FINE, and saying so is half the value:
     a guard that refuses the healthy state too gets switched off. Both 400 and
     300 clear a watermark of 200. */
  it("is happy with a database that stopped before the inversion", () => {
    const rows = [inverted[0]!, inverted[1]!].map(rowFor);
    const state = reconcileLedger(inverted, hashes, rows, LAPTOP);
    expect(state.problems).toEqual([]);
    expect(state.pending.map((e) => e.tag)).toEqual(["0002_late", "0003_early"]);
  });
});

/* ------------------------------------------------------------------ */

describe("reconcileLedger, conditions 1 and 2 — a contiguous prefix", () => {
  it("refuses a hole in the middle even when the timestamps allow it", () => {
    const j = journal(100, 200, 300);
    /* 0001 never ran, 0002 did. Its `when` still clears the watermark, so
       condition 3 has nothing to say; the prefix rule is what catches it. */
    const rows = [rowFor(j[0]!), rowFor(j[2]!)];
    const state = reconcileLedger(j, hashesFor(j), rows, LAPTOP);
    expect(state.problems.join("\n")).toContain("not a prefix of the journal");
    expect(state.unreachable.map((e) => e.tag)).toEqual(["0001_thing"]);
  });

  it("accepts a plain prefix", () => {
    const j = journal(100, 200, 300);
    expect(reconcileLedger(j, hashesFor(j), [rowFor(j[0]!)], LAPTOP).problems).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe("reconcileLedger, condition 4 — the hash", () => {
  it("refuses a migration whose file changed after it ran", () => {
    const j = journal(100, 200);
    const rows = [{ hash: "edited-since", created_at: 100 }];
    const state = reconcileLedger(j, hashesFor(j), rows, LAPTOP);
    expect(state.problems.join("\n")).toContain("different SQL");
  });
});

/* ------------------------------------------------------------------ */

describe("reconcileLedger, condition 5 — the journal on its own", () => {
  it("refuses two entries stamped the same millisecond", () => {
    const j = journal(100, 100);
    expect(reconcileLedger(j, hashesFor(j), [], LAPTOP).problems.join("\n")).toContain(
      "are both stamped 100",
    );
  });

  it("refuses a repeated tag", () => {
    const j: JournalEntry[] = [
      { idx: 0, tag: "0000_a", when: 100 },
      { idx: 1, tag: "0000_a", when: 200 },
    ];
    expect(reconcileLedger(j, hashesFor(j), [], LAPTOP).problems.join("\n")).toContain(
      "names 0000_a twice",
    );
  });

  it("refuses broken indices", () => {
    const j: JournalEntry[] = [
      { idx: 0, tag: "0000_a", when: 100 },
      { idx: 7, tag: "0001_b", when: 200 },
    ];
    expect(reconcileLedger(j, hashesFor(j), [], LAPTOP).problems.join("\n")).toContain(
      "the indices are broken",
    );
  });

  it("refuses an entry whose .sql file is not there", () => {
    const j = journal(100, 200);
    expect(reconcileLedger(j, new Map([["0000_thing", "h"]]), [], LAPTOP).problems.join("\n")).toContain(
      "its .sql file could not be read",
    );
  });

  it("refuses a migration recorded twice", () => {
    const j = journal(100);
    const rows = [rowFor(j[0]!), rowFor(j[0]!)];
    expect(reconcileLedger(j, hashesFor(j), rows, LAPTOP).problems.join("\n")).toContain(
      "recorded more than once",
    );
  });
});

/* ------------------------------------------------------------------ */

describe("reconcileLedger — rows this journal has never heard of", () => {
  const j = journal(100, 200);
  const stray: LedgerRow = { hash: "from-a-deleted-migration", created_at: 150 };

  it("refuses them outright against production", () => {
    const rows = [rowFor(j[0]!), rowFor(j[1]!), stray];
    expect(reconcileLedger(j, hashesFor(j), rows, PRODUCTION).problems.join("\n")).toContain(
      "belong to no migration in this journal",
    );
  });

  it("refuses them on a laptop while anything is still pending", () => {
    const rows = [rowFor(j[0]!), stray];
    expect(reconcileLedger(j, hashesFor(j), rows, LAPTOP).problems.join("\n")).toContain(
      "may be the same DDL under a new number",
    );
  });

  /* Not blocking for ever is the other half of the policy. Once every current
     entry is accounted for, a row from a renumbered local migration is history,
     and refusing on it would wedge the machine. GPT Sol, 2026-08-31 § 4. */
  it("reports them as history, without blocking, once nothing is pending", () => {
    const rows = [rowFor(j[0]!), rowFor(j[1]!), stray];
    const state = reconcileLedger(j, hashesFor(j), rows, LAPTOP);
    expect(state.problems).toEqual([]);
    expect(state.unknown).toEqual([stray]);
  });
});

/* ------------------------------------------------------------------ */

describe("postflightProblems", () => {
  it("catches migrate() returning with a journal entry still unrecorded", () => {
    const j = journal(100, 200);
    expect(postflightProblems(j, hashesFor(j), [rowFor(j[0]!)]).join("\n")).toContain(
      "still has no ledger row after migrating",
    );
  });

  it("is quiet when every entry has its row", () => {
    const j = journal(100, 200);
    expect(postflightProblems(j, hashesFor(j), j.map(rowFor))).toEqual([]);
  });

  /**
   * **The postflight is metadata, and this is the proof.** These rows were
   * never produced by a migration — they are two literals — and the check is
   * green. That is why it is necessary and not sufficient, and why the repair
   * of this defect had to re-probe the schema rather than re-read the ledger.
   * GPT Sol, 2026-08-31 § 6.
   */
  it("is green for rows that were simply inserted by hand", () => {
    const j = journal(100, 200);
    const forged: LedgerRow[] = [
      { hash: "h-0000_thing", created_at: 100 },
      { hash: "h-0001_thing", created_at: 200 },
    ];
    expect(postflightProblems(j, hashesFor(j), forged)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe("matchJournalToLedger", () => {
  it("calls a wrong-hash row a changed migration, not a missing one plus a stray one", () => {
    const j = journal(100);
    const { matches, unknown } = matchJournalToLedger(j, [{ hash: "other", created_at: 100 }]);
    expect(matches[0]!.rows).toHaveLength(1);
    expect(unknown).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The real thing                                                      */
/* ------------------------------------------------------------------ */

/**
 * **This laptop's ledger, read at 2026-08-31, before the repair.**
 *
 * 35 rows: `0000`–`0031`, then two rows from local migrations that were later
 * renumbered into `0037_experimental_features_and_callout_blocks`, then
 * `0035_timeline`. `0032`, `0033`, `0034` and `0036` had never run and — with
 * the watermark at `0035`'s hand-written 1788200000000 — never could.
 *
 * Rebuilt from the journal and the files rather than pasted, because the hashes
 * are what make it a faithful fixture and the recorded prefixes matched the
 * files exactly (`cd49f3e45b9b` for `0000`, `8eb7c399c205` for `0031`,
 * `46a89778a88f` for `0035`). Two of the four missing migrations were still
 * observable in the schema at the time: `article_revisions.quotes` was absent
 * and `article_revisions.summary` was still there.
 */
const BROKEN_LAPTOP_UNKNOWN_STAMPS = [1788191337811, 1788194935325];
const BROKEN_LAPTOP_APPLIED = new Set([
  ...Array.from({ length: 32 }, (_, i) => i),
  35,
]);

describe("the state this laptop was actually in, 2026-08-31", () => {
  const folder = path.resolve(import.meta.dirname, "../drizzle");
  const realJournal = readJournal(folder);
  const realHashes = hashMigrationFiles(folder, realJournal);

  const brokenLedger: LedgerRow[] = [
    ...realJournal
      .filter((e) => BROKEN_LAPTOP_APPLIED.has(e.idx))
      .map((e) => ({
        hash: createHash("sha256")
          .update(readFileSync(path.join(folder, `${e.tag}.sql`)).toString())
          .digest("hex"),
        created_at: e.when,
      })),
    ...BROKEN_LAPTOP_UNKNOWN_STAMPS.map((created_at) => ({ hash: `deleted-${created_at}`, created_at })),
  ];

  it("refuses to migrate, and names all four migrations that could never run", () => {
    const state = reconcileLedger(realJournal, realHashes, brokenLedger, LAPTOP);
    expect(state.unreachable.map((e) => e.tag)).toEqual([
      "0032_jobs_concurrency_cap",
      "0033_quotes",
      "0034_flowery_wolfsbane",
      "0036_drop_summary_column",
    ]);
    expect(state.watermark).toBe(1788200000000);
    expect(state.problems.length).toBeGreaterThan(0);
  });

  /* The same ledger through drizzle's own arithmetic, which is what
     `npm run db:migrate` used to be. It sees three pending, applies them, and
     prints a tick — and the four above stay gone. */
  it("is exactly what drizzle's watermark calls healthy", () => {
    const pending = migrationState(realJournal, 1788200000000, brokenLedger.length).pending;
    expect(pending.map((e) => e.tag)).not.toContain("0036_drop_summary_column");
  });
});
