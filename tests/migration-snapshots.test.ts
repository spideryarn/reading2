/**
 * `drizzle/meta/` as a linked list — the real folder, and the shapes it must
 * refuse.
 *
 * **The real folder passes, so on its own that assertion is worth nothing.**
 * It is exactly what docs/reusable/silent-success.md warns about: a check
 * nobody has watched fail. So most of this file is fixtures, one per way the
 * chain can be broken.
 *
 * Several of those shapes `drizzle-kit check` would also catch, and it is the
 * better tool where it does — it reads the folder the way `generate` will.
 * These exist for the ones it is green on, and the measurement of what those
 * are is at the top of scripts/migration-snapshots.ts: two missing snapshots
 * and a broken link, on this repository, under "Everything's fine 🐶🔥".
 *
 * scripts/migration-snapshots.ts is the check;
 * docs/plans/260902c-concurrent-migrations-across-worktrees.md is why.
 */

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readJournal, type JournalEntry } from "../scripts/migration-ledger.js";
import {
  HISTORICAL,
  NO_EXCEPTIONS,
  readSnapshots,
  snapshotProblems,
  type Snapshot,
} from "../scripts/migration-snapshots.js";

const FOLDER = path.resolve(import.meta.dirname, "../drizzle");

describe("the real drizzle/meta", () => {
  const journal = readJournal(FOLDER);
  const snapshots = readSnapshots(FOLDER);

  it("has a chain to check at all", () => {
    expect(snapshots.length).toBeGreaterThan(40);
    expect(journal.length).toBeGreaterThan(40);
  });

  it("is a well-formed chain, once the historical three are excused", () => {
    expect(snapshotProblems(journal, snapshots, HISTORICAL)).toEqual([]);
  });

  /* The exemptions are a liability, not a feature. Both directions: the list
     must not grow, and it must not outlive what it was written for. */
  it("needs exactly the three exceptions it names, and no others", () => {
    const bare = snapshotProblems(journal, snapshots, NO_EXCEPTIONS);
    expect(bare).toHaveLength(3);
    expect(bare.join("\n")).toContain("0003_reader_state_owner_fks is in the journal");
    expect(bare.join("\n")).toContain("0029_assets is in the journal");
    expect(bare.join("\n")).toContain("0022_snapshot.json claims");
  });

  it("still has the two holes the exceptions excuse, and not a file that would fill them", () => {
    for (const m of HISTORICAL.missing) {
      /* The stamp as well as the tag: the exemption is keyed on both, so a
         pin on the tag alone would let it drift out of date in silence. */
      expect(journal.find((e) => e.tag === m.tag)?.when).toBe(m.when);
      const prefix = m.tag.split("_")[0];
      expect(existsSync(path.join(FOLDER, "meta", `${prefix}_snapshot.json`))).toBe(false);
      expect(m.reason.length).toBeGreaterThan(20);
    }
  });

  /* Keyed on the ids so that regenerating either side lapses the exemption
     rather than inheriting it — the same reasoning as GRANDFATHERED in
     tests/migration-journal.test.ts. This is the assertion that proves it. */
  it("still has the break the exception excuses, with all three ids unchanged", () => {
    for (const b of HISTORICAL.breaks) {
      const after = snapshots.find((s) => s.file === b.after);
      const before = snapshots.find((s) => s.file === b.before);
      expect(after?.id).toBe(b.afterId);
      expect(before?.id).toBe(b.beforeId);
      expect(before?.prevId).toBe(b.beforePrevId);
      expect(b.reason.length).toBeGreaterThan(20);
    }
  });
});

/* ------------------------------------------------------------------ */

/**
 * A throwaway `drizzle/` holding a journal and whatever snapshots are asked
 * for — a fixture rather than the real folder, because the assertions above are
 * that the real one is clean, and a test that has to dirty the thing it guards
 * is a test that can leave it dirty.
 */
function folderWith(
  tags: string[],
  snapshots: { file: string; body: Record<string, unknown> }[],
): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "spya-snapshots-"));
  mkdirSync(path.join(dir, "meta"));
  const entries: JournalEntry[] = tags.map((tag, idx) => ({ idx, tag, when: 100 + idx }));
  writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ entries }));
  for (const s of snapshots) {
    writeFileSync(path.join(dir, "meta", s.file), JSON.stringify(s.body));
  }
  return dir;
}

/** A snapshot body with everything `snapshotProblems` reads. */
const body = (id: string, prevId: string) => ({ id, prevId, version: "7", dialect: "postgresql" });

/** The healthy three, which every fixture below is one mutation away from. */
const HEALTHY = {
  tags: ["0000_first", "0001_second", "0002_third"],
  snapshots: [
    { file: "0000_snapshot.json", body: body("aaa", "00000000-0000-0000-0000-000000000000") },
    { file: "0001_snapshot.json", body: body("bbb", "aaa") },
    { file: "0002_snapshot.json", body: body("ccc", "bbb") },
  ],
};

const problemsIn = (dir: string): string =>
  snapshotProblems(readJournal(dir), readSnapshots(dir)).join("\n");

describe("the shapes it must refuse", () => {
  it("passes the healthy chain, so the failures below mean something", () => {
    const dir = folderWith(HEALTHY.tags, HEALTHY.snapshots);
    expect(snapshotProblems(readJournal(dir), readSnapshots(dir))).toEqual([]);
  });

  /* The one `drizzle-kit check` also catches: two worktrees, one parent. */
  it("names a forked chain and both sides of the fork", () => {
    const dir = folderWith(
      [...HEALTHY.tags, "0003_the_other_worktree"],
      [
        ...HEALTHY.snapshots,
        { file: "0003_snapshot.json", body: body("ddd", "bbb") },
      ],
    );
    const out = problemsIn(dir);
    expect(out).toContain("0002_snapshot.json and 0003_snapshot.json both claim bbb");
    expect(out).toContain("the chain has forked");
  });

  /* The `0029_assets` shape, and the one that cost a broken migration. */
  it("names a journal entry whose snapshot is missing", () => {
    const dir = folderWith(HEALTHY.tags, HEALTHY.snapshots.slice(0, 2));
    expect(problemsIn(dir)).toContain("0002_third is in the journal and drizzle/meta/0002_snapshot.json is not");
  });

  /* Two snapshots with one id. A naive prevId walk reads this as a valid
     chain, because every link resolves — to the wrong file. */
  it("names two snapshots carrying one id", () => {
    const dir = folderWith(HEALTHY.tags, [
      HEALTHY.snapshots[0]!,
      { file: "0001_snapshot.json", body: body("bbb", "aaa") },
      { file: "0002_snapshot.json", body: body("bbb", "bbb") },
    ]);
    expect(problemsIn(dir)).toContain("both carry the id bbb");
  });

  /**
   * Every `prevId` here resolves to *some* snapshot's `id`, so the obvious
   * check — "walk the links and make sure each one lands" — is green on a
   * folder that is not a chain. Only "each snapshot links to the one
   * physically before it" catches it.
   */
  it("catches a chain whose every link resolves to the wrong file", () => {
    const dir = folderWith(HEALTHY.tags, [
      HEALTHY.snapshots[0]!,
      { file: "0001_snapshot.json", body: body("bbb", "aaa") },
      { file: "0002_snapshot.json", body: body("ccc", "aaa") },
    ]);
    /* Reported twice over — the fork, and the break — and both are true. */
    expect(problemsIn(dir)).toContain("the chain is broken here");
  });

  /**
   * The rename trap, and the reason check 8 exists. `preparePrevSnapshot` in
   * drizzle-kit takes the lexically LAST file in `meta/` as the base for the
   * next diff, so an old snapshot renamed to sort last silently rewinds every
   * future migration to an ancient schema.
   */
  it("catches an old snapshot renamed so it sorts last", () => {
    const dir = folderWith(HEALTHY.tags, [
      ...HEALTHY.snapshots,
      { file: "9999_snapshot.json", body: body("aaa", "00000000-0000-0000-0000-000000000000") },
    ]);
    const out = problemsIn(dir);
    expect(out).toContain("9999_snapshot.json sorts last");
    expect(out).toContain("rewind the schema it compares against");
  });

  /* Two migrations numbered the same. Not a database problem — the migrator
     reads tags and would run both — but they want one snapshot FILE. */
  it("names two journal tags that share a prefix", () => {
    const dir = folderWith(
      ["0000_first", "0001_second", "0001_the_other_session"],
      HEALTHY.snapshots.slice(0, 2),
    );
    const out = problemsIn(dir);
    expect(out).toContain("0001_second and 0001_the_other_session share the prefix 0001");
    expect(out).toContain("can only hold one of them");
  });

  /* drizzle JSON.parses every non-underscore file in meta/, so anything else
     left there is a crash waiting for the next generate. */
  it("names a file in meta/ that is not a snapshot at all", () => {
    const dir = folderWith(HEALTHY.tags, HEALTHY.snapshots);
    writeFileSync(path.join(dir, "meta", "notes.txt"), "a note somebody left");
    const out = problemsIn(dir);
    expect(out).toContain("notes.txt could not be read as a snapshot");
  });

  it("names a snapshot the journal has never heard of", () => {
    const dir = folderWith(HEALTHY.tags.slice(0, 2), HEALTHY.snapshots);
    expect(problemsIn(dir)).toContain("0002_snapshot.json belongs to no migration in the journal");
  });

  /* Journal order and lexical order are two orderings of one sequence, and
     drizzle uses both. A journal whose entries were re-sorted by a merge
     resolver looks fine entry by entry and is not fine. */
  it("catches journal order disagreeing with the folder's", () => {
    const dir = folderWith(["0000_first", "0002_third", "0001_second"], HEALTHY.snapshots);
    expect(problemsIn(dir)).toContain("drizzle/meta/ sorts as");
  });

  /**
   * The folder this repo will have from now on: index-prefixed migrations up to
   * `0051`, timestamp-prefixed ones after it (`drizzle.config.ts`). Nothing was
   * renamed, so both shapes sit in `meta/` together for good — and every check
   * here reads a prefix, so it is worth one fixture rather than an argument
   * about lexical ordering. Confirmed against a real generate on 2026-09-02:
   * `20260902084631_snapshot.json` sorts after `0051_snapshot.json`.
   */
  it("is happy with index and timestamp prefixes side by side", () => {
    const dir = folderWith(
      [...HEALTHY.tags, "20260902084631_after_the_switch"],
      [
        ...HEALTHY.snapshots,
        { file: "20260902084631_snapshot.json", body: body("ddd", "ccc") },
      ],
    );
    expect(snapshotProblems(readJournal(dir), readSnapshots(dir))).toEqual([]);
  });

  /**
   * The three shapes GPT Sol built by hand on 2026-09-02 and got `[]` back for.
   * Each one is a folder that is not a chain, and each passed every check the
   * first version had.
   */
  it("catches a file that ends in _snapshot.json but is not the derived name", () => {
    const dir = folderWith(HEALTHY.tags, [
      ...HEALTHY.snapshots,
      { file: "0000_extra_snapshot.json", body: body("eee", "aaa") },
    ]);
    expect(problemsIn(dir)).toContain("is not the name drizzle derives for it");
  });

  /**
   * A whole-folder cycle: the first snapshot's parent is the LAST one's id.
   * Every link resolves, every id is unique, no two share a parent, and the
   * order agrees — so only "the first snapshot's parent is the zero UUID"
   * catches it.
   */
  it("catches a chain that loops back into itself at the root", () => {
    const dir = folderWith(HEALTHY.tags, [
      { file: "0000_snapshot.json", body: body("aaa", "ccc") },
      HEALTHY.snapshots[1]!,
      HEALTHY.snapshots[2]!,
    ]);
    expect(problemsIn(dir)).toContain("sorts first and claims ccc as its parent");
  });

  /* A snapshot with no version and no dialect agrees with every other snapshot
     vacuously, so the "one version throughout" check alone passes it. */
  it("catches a snapshot carrying no version or dialect", () => {
    const dir = folderWith(HEALTHY.tags, [
      HEALTHY.snapshots[0]!,
      HEALTHY.snapshots[1]!,
      { file: "0002_snapshot.json", body: { id: "ccc", prevId: "bbb" } },
    ]);
    expect(problemsIn(dir)).toContain("0002_snapshot.json is missing its version");
  });

  /* `null` is valid JSON. Reading fields off it used to throw, which turned
     db:migrate's intended warning into a crash. */
  it("reports rather than crashes on a file holding valid JSON that is not an object", () => {
    const dir = folderWith(HEALTHY.tags, HEALTHY.snapshots.slice(0, 2));
    writeFileSync(path.join(dir, "meta", "0002_snapshot.json"), "null");
    expect(problemsIn(dir)).toContain("0002_snapshot.json could not be read as a snapshot");
  });

  /* A folder with nothing in it is a legitimate starting state, not a fault. */
  it("says nothing about an empty folder and an empty journal", () => {
    const dir = folderWith([], []);
    expect(snapshotProblems(readJournal(dir), readSnapshots(dir))).toEqual([]);
  });

  it("catches a folder half-migrated to a new snapshot version", () => {
    const dir = folderWith(HEALTHY.tags, [
      HEALTHY.snapshots[0]!,
      HEALTHY.snapshots[1]!,
      { file: "0002_snapshot.json", body: { id: "ccc", prevId: "bbb", version: "8", dialect: "postgresql" } },
    ]);
    expect(problemsIn(dir)).toContain("versions 7 and 8");
  });
});

/* ------------------------------------------------------------------ */

describe("the exceptions themselves", () => {
  const ROOT = "00000000-0000-0000-0000-000000000000";
  const chain: Snapshot[] = [
    { file: "0000_snapshot.json", prefix: "0000", id: "aaa", prevId: ROOT, version: "7", dialect: "postgresql" },
    { file: "0001_snapshot.json", prefix: "0001", id: "bbb", prevId: "gone", version: "7", dialect: "postgresql" },
  ];
  const journal: JournalEntry[] = [
    { idx: 0, tag: "0000_first", when: 1 },
    { idx: 1, tag: "0001_second", when: 2 },
  ];
  /** The exemption that matches `chain` exactly. Each test spoils one field. */
  const theBreak = {
    after: "0000_snapshot.json",
    afterId: "aaa",
    before: "0001_snapshot.json",
    beforeId: "bbb",
    beforePrevId: "gone",
    reason: "x",
  };

  it("excuses the break it names", () => {
    expect(snapshotProblems(journal, chain, { missing: [], breaks: [theBreak] })).toEqual([]);
    expect(snapshotProblems(journal, chain, NO_EXCEPTIONS)).toHaveLength(1);
  });

  /**
   * **Every id is in the key**, so that regenerating either side takes the
   * exemption away instead of inheriting it.
   *
   * Both directions are tested because for a while only one of them worked:
   * `beforeId` was not in the type at all, so a freshly minted *later* snapshot
   * carrying the same stale parent still matched. The test that was supposed to
   * prove this spoiled `afterId` only, and passed. GPT Sol's code review,
   * 2026-09-02 — and the reason a test named "either side" must actually try
   * both sides.
   */
  it.each([
    ["the earlier snapshot", { ...theBreak, afterId: "aaa-REGENERATED" }],
    ["the later snapshot", { ...theBreak, beforeId: "bbb-REGENERATED" }],
    ["the stale parent between them", { ...theBreak, beforePrevId: "gone-REGENERATED" }],
  ])("stops excusing the break once %s is re-minted", (_which, excused) => {
    expect(snapshotProblems(journal, chain, { missing: [], breaks: [excused] })).toHaveLength(1);
  });

  /* An exemption for a hole must not become cover for the next hole. */
  it("excuses only the missing snapshot it names", () => {
    const j: JournalEntry[] = [...journal, { idx: 2, tag: "0002_third", when: 3 }];
    const excused = { missing: [{ tag: "0001_second", when: 2, reason: "x" }], breaks: [] };
    const problems = snapshotProblems(j, [chain[0]!], excused);
    expect(problems.join("\n")).toContain("0002_third is in the journal");
    expect(problems.join("\n")).not.toContain("0001_second is in the journal");
  });

  /* Keyed on the stamp as well as the tag, so the entry becoming a different
     migration under the same name takes the exemption away. */
  it("stops excusing a missing snapshot once its entry is re-stamped", () => {
    const restamped: JournalEntry[] = [journal[0]!, { idx: 1, tag: "0001_second", when: 999 }];
    const excused = { missing: [{ tag: "0001_second", when: 2, reason: "x" }], breaks: [] };
    expect(snapshotProblems(restamped, [chain[0]!], excused).join("\n")).toContain(
      "0001_second is in the journal",
    );
  });
});
