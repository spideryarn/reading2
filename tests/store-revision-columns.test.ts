/**
 * **What the library page drags across the wire.**
 *
 * `currentRevision` and `listArticles` both selected `articleRevisions` whole —
 * `select({ article: articles, revision: articleRevisions })` — and one of that
 * table's columns is `raw_bytes`, a `bytea` holding the entire source document,
 * up to 32 MiB at stage 1's own ceiling. `listArticles` runs it **once per
 * article**. Nothing downstream reads the bytes: `LibraryEntry` is titles,
 * counts and a blurb, and `metaFrom` reads `rawSha256`, never `rawBytes`.
 *
 * Measured on this laptop's database, 8 articles, join of `articles` to their
 * current revision:
 *
 * ```
 *   whole row (what it did)     28 ms    23.89 MB
 *   only what it reads           0 ms     0.01 MB
 * ```
 *
 * 7.2 MB of those bytes are `raw_bytes`; the rest of the inflation is the
 * driver rendering a Buffer as JSON. On a laptop that is 28 ms. From a Vercel
 * function to Supabase it is the whole corpus, on every library load.
 *
 * ## Why this test is shaped the way it is
 *
 * The interesting half is not "rawBytes is absent" — it is **"and nothing else
 * is"**. An omission list decays the moment somebody adds a column: the new one
 * is silently dropped from every read, and the failure is a field that reads
 * `undefined` in one place, which looks like missing data rather than like a
 * query. So the assertion is against `getTableColumns` rather than against a
 * list written here, and adding a column to the schema keeps it passing while
 * *forgetting* one fails it.
 *
 * This does not need a database. It is about the shape of a query.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";

import { articleRevisions } from "../src/db/schema.js";
import { REVISION_COLUMNS } from "../src/store/pg.js";

describe("the revision columns a read selects", () => {
  it("leaves out the raw document", () => {
    expect(Object.keys(REVISION_COLUMNS)).not.toContain("rawBytes");
  });

  it("keeps every other column, so a new one is not silently dropped", () => {
    const all = Object.keys(getTableColumns(articleRevisions));
    expect(all).toContain("rawBytes"); // the table still has it; we just don't read it
    expect(Object.keys(REVISION_COLUMNS).sort()).toEqual(
      all.filter((c) => c !== "rawBytes").sort(),
    );
  });

  it("still carries the hash, which is what actually gets read", () => {
    /* `metaFrom` puts `rawSha256` in the Meta the client sees, and
       src/store/export.ts rebuilds meta.json from it. Dropping the bytes must
       not drop the fact that we know what they were. */
    expect(Object.keys(REVISION_COLUMNS)).toContain("rawSha256");
  });
});

describe("the queries that read a revision", () => {
  /**
   * **The constant being right does not make the queries use it.**
   *
   * The three tests above all pass against a `listArticles` reverted to
   * `revision: articleRevisions` — the constant would still omit `rawBytes` and
   * the query would still fetch it. TypeScript cannot catch that either: a full
   * row is assignable where `RevisionRead` is wanted, because excess-property
   * checking only fires on object literals.
   *
   * So this reads the source. It is a blunt instrument, and — this is the part
   * worth being honest about — **it is a regression check, not a proof**. It
   * scans two files and matches two spellings, so
   *
   * ```ts
   * const revisions = articleRevisions;
   * .select({ revision: revisions })
   * ```
   *
   * walks straight past it. GPT Sol pointed that out, and also checked for a
   * fourth whole-row read and found none: `exportArticle` takes the whole row
   * and is *right* to, because it genuinely writes `rawBytes` out.
   *
   * It is kept because the failure it guards is a revert of these two lines by
   * somebody satisfying a typechecker, which is the likely way this comes back —
   * not because it is airtight. When `raw_bytes` leaves Postgres the whole file
   * goes with it.
   */
  const FILES = ["src/store/pg.ts", "src/store/pg-revisions.ts"];

  it.each(FILES)("%s never selects a revision row whole", async (file) => {
    const raw = await readFile(path.join(import.meta.dirname, "..", file), "utf8");
    /* Comments stripped first. The property is about code, and the first
       version of this test failed on the doc comment *explaining* the rule —
       which is a check that cannot be satisfied by fixing the thing it is
       about, and would have been "fixed" by deleting the explanation. */
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    /* Both spellings: the nested-object form used by the joins, and the bare
       `.select()` that Drizzle reads as "every column". */
    const whole = [
      /revision:\s*articleRevisions\s*[,}]/,
      /\.select\(\)\s*\n?\s*\.from\(articleRevisions\)/,
    ];
    for (const pattern of whole) {
      expect(source, `${file} matched ${pattern}`).not.toMatch(pattern);
    }
  });
});
