/**
 * `drizzle/meta/` as a linked list, checked as files.
 *
 * **What this is for.** Every `drizzle-kit generate` writes
 * `drizzle/meta/<prefix>_snapshot.json` carrying an `id` and the `prevId` of
 * the snapshot before it. Two worktrees generating from the same trunk produce
 * two snapshots with one `prevId`, and from then on the folder is corrupt in a
 * way the *database* never notices: `migrate()` reads the journal and the
 * `.sql` files and never opens a snapshot at all. It surfaces at the next
 * `generate`, which refuses — and **exits 0 having written nothing**
 * (scripts/db-generate.ts has the verification).
 *
 * ## What this does that `drizzle-kit check` does not
 *
 * `npm run db:chain` is `drizzle-kit check`, and it is the better tool for the
 * fork: it reads the folder exactly as `generate` will. But it groups snapshots
 * by `prevId` and complains only when two share one, so it is **green on holes
 * and green on breaks**. Measured on this tree, 2026-09-02:
 *
 *     journal entries                       52
 *     snapshot files                        50
 *     entries with no snapshot              0003_reader_state_owner_fks, 0029_assets
 *     chain break (prev id != next prevId)  0021 → 0022
 *     npx drizzle-kit check                 "Everything's fine 🐶🔥", exit 0
 *
 * All three of those are real and historical, so they are named below as
 * exceptions rather than fixed. **A validator that would go red on the tree the
 * day it is written is a validator nobody keeps**, and the repo already has the
 * pattern for saying so out loud: `GrandfatheredInversion` in
 * scripts/migration-ledger.ts, whose exemptions carry both timestamps so that
 * regenerating either file takes the exemption away. These carry both ids for
 * the same reason.
 *
 * ## What this still cannot prove
 *
 * That a snapshot's *contents* match its `.sql`, or `src/db/schema.ts`. A stale
 * but structurally perfect snapshot passes everything here. The postcondition in
 * scripts/db-generate.ts is what stops one being written in the first place;
 * `npm run db:check` and src/db/schema-drift.ts are what compare intent against
 * a real database.
 *
 * docs/plans/260902c-concurrent-migrations-across-worktrees.md, stage 2.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { JournalEntry } from "./migration-ledger.js";

/** The numeric-or-timestamp part of `0051_add_widget`, which names its snapshot. */
export function prefixOf(tag: string): string {
  return tag.split("_")[0] ?? tag;
}

/** One snapshot file, read. `id`/`prevId` are `null` when the file did not carry them. */
export interface Snapshot {
  /** The basename, e.g. `0051_snapshot.json`. */
  file: string;
  /** The part before the first `_`, which must match a journal entry's prefix. */
  prefix: string;
  id: string | null;
  prevId: string | null;
  version: string | null;
  dialect: string | null;
}

/**
 * A journal entry whose snapshot is not in the folder, excused by name.
 *
 * The **reason** is not decoration: an exception without one is indistinguishable
 * from debris, and the next person cannot tell whether removing it is a fix or a
 * regression.
 */
export interface MissingSnapshotException {
  tag: string;
  reason: string;
}

/**
 * A break in the chain that is already published, excused by both ids.
 *
 * Keyed on the ids rather than the filenames so that regenerating either side —
 * which mints a fresh `id` — lapses the exemption rather than inheriting it.
 */
export interface ChainBreakException {
  /** The snapshot file that sits before the break. */
  after: string;
  afterId: string;
  /** The one after it, whose `prevId` does not match. */
  before: string;
  beforePrevId: string;
  reason: string;
}

export interface SnapshotExceptions {
  missing: readonly MissingSnapshotException[];
  breaks: readonly ChainBreakException[];
}

export const NO_EXCEPTIONS: SnapshotExceptions = { missing: [], breaks: [] };

/**
 * The three things already wrong with `drizzle/meta/`, named exactly.
 *
 * **Exported rather than living in the test**, which is where
 * `GRANDFATHERED` sits in tests/migration-journal.test.ts. The difference is
 * deliberate and it is about who needs the list: `journalInversions` is only
 * ever called from a test, so its exemptions can be a test constant, while this
 * check also runs in `db:migrate`'s preflight — and a preflight that hardcoded
 * "green means two known holes" without saying which two would be a preflight
 * nobody could audit. tests/migration-snapshots.test.ts pins every entry below,
 * so the list cannot quietly grow, and pins that each one is still *needed*, so
 * it cannot quietly outlive its reason either.
 *
 * All three are historical and none of them is repairable now: `0003` and
 * `0029` are hand-written migrations that were never generated, so there was
 * never a snapshot to keep, and inventing one would be inventing a schema state
 * that never existed. The chain skips them cleanly — `0004`'s parent is `0002`
 * and `0030`'s is `0028` — which is why they cost a *hole* rather than a break.
 */
export const HISTORICAL: SnapshotExceptions = {
  missing: [
    {
      tag: "0003_reader_state_owner_fks",
      reason:
        "hand-written, never generated, so drizzle never wrote a snapshot. 0004's parent is 0002.",
    },
    {
      tag: "0029_assets",
      reason:
        "hand-written, never generated. The hole is what made the NEXT generate diff against " +
        "0028 and re-emit DDL that had already run — the incident is written up at the top of " +
        "drizzle/0030_drop_summary_steer.sql, and it is the reason this whole check exists.",
    },
  ],
  breaks: [
    {
      after: "0021_snapshot.json",
      afterId: "dcf76eca-3389-45e4-ad7b-34187e243ad4",
      before: "0022_snapshot.json",
      beforePrevId: "a65344d1-a82e-4405-8182-0d52ad801cdb",
      reason:
        "0022 names a parent that is in no file in this folder. Predates every check here and " +
        "both migrations are long published, so re-minting either id would only make the " +
        "history disagree with what ran.",
    },
  ],
};

/**
 * Every non-underscore entry under `<folder>/meta`, in the order drizzle sorts
 * them.
 *
 * **Non-underscore, not `*_snapshot.json`**, because that is what drizzle does:
 * `prepareOutFolder` in `bin.cjs` is
 * `readdirSync(meta).filter((it) => !it.startsWith("_"))` followed by `.sort()`,
 * and it then `JSON.parse`s every one of them without checking the name. So a
 * stray `notes.txt` in that folder crashes `generate`, and reading only the
 * files we expect would leave this blind to the thing that actually breaks.
 *
 * The sort is lexical and it is load-bearing twice over: it is the order the
 * chain is walked in, and `preparePrevSnapshot` takes the **last** element of it
 * as the base for the next diff.
 */
export function readSnapshots(folder: string): Snapshot[] {
  const meta = path.join(folder, "meta");
  let names: string[];
  try {
    names = readdirSync(meta);
  } catch {
    return [];
  }
  const snapshots: Snapshot[] = [];
  for (const file of names.filter((n) => !n.startsWith("_")).sort()) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(path.join(meta, file), "utf8")) as Record<string, unknown>;
    } catch {
      /* Unparseable is reported by snapshotProblems, which needs the entry to
         exist in order to report it. Everything else stays null. */
      snapshots.push({ file, prefix: prefixOf(file), id: null, prevId: null, version: null, dialect: null });
      continue;
    }
    const str = (k: string): string | null => (typeof raw[k] === "string" ? (raw[k] as string) : null);
    snapshots.push({
      file,
      prefix: prefixOf(file),
      id: str("id"),
      prevId: str("prevId"),
      version: str("version"),
      dialect: str("dialect"),
    });
  }
  return snapshots;
}

/**
 * Everything wrong with `drizzle/meta/`, as sentences.
 *
 * Empty means the folder is a well-formed chain whose shape matches the
 * journal. The checks, and the case each one exists for:
 *
 *  1. **every file parses, and is named `<prefix>_snapshot.json`** — drizzle
 *     parses whatever is in there.
 *  2. **`id`s are unique** — a duplicated `id` makes a self-loop look like a
 *     link, so a naive `prevId` walk passes a folder that is not a chain.
 *  3. **no two snapshots share a `prevId`** — the fork. `drizzle-kit check`
 *     catches this one too; it is here so that one run of `npm test` gives the
 *     whole verdict.
 *  4. **the journal's prefixes do not collide** — two tags numbered `0052` want
 *     one `0052_snapshot.json` and the folder cannot hold both. Not a database
 *     invariant (the migrator reads tags, and would run both) but a filename
 *     one, which is why duplicate numbers are worth naming even though refusing
 *     them would fix nothing on its own.
 *  5. **snapshot ↔ journal, both directions** — a snapshot for a prefix the
 *     journal has never heard of is debris or a rename; a journal entry with no
 *     snapshot is the `0029_assets` hole, which made the next generate diff
 *     against `0028` and re-emit DDL that had already run.
 *  6. **lexical order agrees with journal order** — they are two orderings of
 *     one sequence and drizzle uses both.
 *  7. **each snapshot links to the physically preceding one.**
 *  8. **the lexically last snapshot belongs to the last journal entry** — the
 *     rename trap. `preparePrevSnapshot` takes the lexically last file as the
 *     base for the next diff, so renaming an old snapshot to sort last silently
 *     rewinds every future migration to an ancient schema, with every other
 *     check above still green.
 *  9. **one `version` and one `dialect` throughout** — a mixed folder is a
 *     half-finished `drizzle-kit up`. The absolute version belongs to
 *     `drizzle-kit check`, which knows what it supports; this only asks that
 *     the folder agrees with itself.
 */
export function snapshotProblems(
  journal: readonly JournalEntry[],
  snapshots: readonly Snapshot[],
  exceptions: SnapshotExceptions = NO_EXCEPTIONS,
): string[] {
  const problems: string[] = [];

  /* 1 */
  for (const s of snapshots) {
    if (s.id === null || s.prevId === null) {
      problems.push(
        `drizzle/meta/${s.file} could not be read as a snapshot with an id and a prevId — ` +
          "drizzle parses every non-underscore file in that folder, so it will fail on this too",
      );
      continue;
    }
    if (!s.file.endsWith("_snapshot.json")) {
      problems.push(
        `drizzle/meta/${s.file} is not named <prefix>_snapshot.json, and drizzle derives the ` +
          "snapshot path from the tag's prefix — it will never find this one",
      );
    }
  }

  /* 2 */
  const byId = new Map<string, string[]>();
  for (const s of snapshots) {
    if (s.id === null) continue;
    byId.set(s.id, [...(byId.get(s.id) ?? []), s.file]);
  }
  for (const [id, files] of byId) {
    if (files.length > 1) problems.push(`${files.join(" and ")} both carry the id ${id}`);
  }

  /* 3 */
  const byPrev = new Map<string, string[]>();
  for (const s of snapshots) {
    if (s.prevId === null) continue;
    byPrev.set(s.prevId, [...(byPrev.get(s.prevId) ?? []), s.file]);
  }
  for (const [prev, files] of byPrev) {
    if (files.length > 1) {
      problems.push(
        `${files.join(" and ")} both claim ${prev} as their parent — the chain has forked, ` +
          "which is what two worktrees generating from one trunk produces. The next " +
          "`drizzle-kit generate` will refuse and exit 0 without writing anything",
      );
    }
  }

  /* 4 */
  const journalByPrefix = new Map<string, string[]>();
  for (const e of journal) {
    const p = prefixOf(e.tag);
    journalByPrefix.set(p, [...(journalByPrefix.get(p) ?? []), e.tag]);
  }
  for (const [prefix, tags] of journalByPrefix) {
    if (tags.length > 1) {
      problems.push(
        `${tags.join(" and ")} share the prefix ${prefix}, so they want one ` +
          `drizzle/meta/${prefix}_snapshot.json and the repository can only hold one of them`,
      );
    }
  }

  /* 5, snapshot → journal */
  for (const s of snapshots) {
    if (!journalByPrefix.has(s.prefix)) {
      problems.push(
        `drizzle/meta/${s.file} belongs to no migration in the journal — either it is debris ` +
          "from a migration that was removed, or it was renamed, and a renamed snapshot can " +
          "become the base every future migration is diffed against",
      );
    }
  }

  /* 5, journal → snapshot */
  const havePrefix = new Set(snapshots.map((s) => s.prefix));
  const excusedMissing = new Set(exceptions.missing.map((m) => m.tag));
  for (const e of journal) {
    if (havePrefix.has(prefixOf(e.tag)) || excusedMissing.has(e.tag)) continue;
    problems.push(
      `${e.tag} is in the journal and drizzle/meta/${prefixOf(e.tag)}_snapshot.json is not ` +
        "there — the next generate will diff against an older snapshot and re-emit DDL that " +
        "has already run (drizzle/0030_drop_summary_steer.sql is the last time this happened)",
    );
  }

  /* 6 */
  const journalOrder = journal.map((e) => prefixOf(e.tag)).filter((p) => havePrefix.has(p));
  const fileOrder = snapshots.map((s) => s.prefix).filter((p) => journalByPrefix.has(p));
  if (journalOrder.join(",") !== fileOrder.join(",")) {
    problems.push(
      `drizzle/meta/ sorts as [${fileOrder.join(", ")}] and the journal runs in the order ` +
        `[${journalOrder.join(", ")}] — drizzle uses both orderings and they must agree`,
    );
  }

  /* 7 */
  let last: Snapshot | null = null;
  for (const s of snapshots) {
    /* Bound rather than used through `last!`: the narrowing on a `let` does not
       survive into the closure below, and an assertion that is merely true
       today is how a refactor gets to be wrong quietly. */
    const previous = last;
    last = s;
    if (!previous || s.prevId === null || previous.id === null || s.prevId === previous.id) continue;
    const excused = exceptions.breaks.some(
      (b) =>
        b.after === previous.file &&
        b.afterId === previous.id &&
        b.before === s.file &&
        b.beforePrevId === s.prevId,
    );
    if (excused) continue;
    problems.push(
      `drizzle/meta/${s.file} claims ${s.prevId} as its parent, and the snapshot before it ` +
        `(${previous.file}) is ${previous.id} — the chain is broken here`,
    );
  }

  /* 8 */
  const lastEntry = journal[journal.length - 1];
  const lastSnapshot = snapshots[snapshots.length - 1];
  if (lastEntry && lastSnapshot && lastSnapshot.prefix !== prefixOf(lastEntry.tag)) {
    problems.push(
      `drizzle/meta/${lastSnapshot.file} sorts last, and the journal's last migration is ` +
        `${lastEntry.tag} — drizzle diffs the next migration against whichever snapshot sorts ` +
        "last, so this one would rewind the schema it compares against",
    );
  }

  /* 9 */
  const versions = new Set(snapshots.map((s) => s.version).filter((v): v is string => v !== null));
  if (versions.size > 1) {
    problems.push(`drizzle/meta/ holds snapshots of versions ${[...versions].sort().join(" and ")}`);
  }
  const dialects = new Set(snapshots.map((s) => s.dialect).filter((d): d is string => d !== null));
  if (dialects.size > 1) {
    problems.push(`drizzle/meta/ holds snapshots for dialects ${[...dialects].sort().join(" and ")}`);
  }

  return problems;
}
