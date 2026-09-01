/**
 * **A new table must not be able to arrive without the rollback noticing.**
 *
 * `src/store/export.ts` is the rollback — `npm run db:export` writes Postgres
 * back out as `data/<slug>/`, and it is the only thing standing between a
 * migration to Postgres and a decision nobody can undo. It reads a hand-written
 * list of tables, which means a table added to `src/db/schema.ts` is invisible
 * to it, and an exporter that has never heard of a table behaves *exactly* like
 * one that has nothing to say about it: it writes its files, logs a count, and
 * reports success.
 *
 * That is what happened to `referee_criteria` on 2026-08-31. The table landed,
 * the store landed, the routes landed, and `db:export` silently dropped every
 * criterion a referee had written. Nothing failed, nothing warned, and no test
 * in the suite could have gone red — the round-trip test compares the artefacts
 * it knows about, so a file that is never written is a file it never misses.
 * docs/reusable/silent-success.md § "A round-trip test over a corpus missing the
 * field".
 *
 * ## So this test does not check `referee_criteria`
 *
 * It checks the *class*. The list of article-scoped tables is derived from the
 * schema at runtime — `getTableColumns`, not a second copy of the names — and
 * every one of them must appear in `ARTICLE_TABLE_COVERAGE` saying either which
 * file it exports into or, in words, why it does not. A table that is in the
 * schema and not in that record fails here, by name, with the sentence saying
 * what to do about it. That is the fix worth having; the line for
 * `referee_criteria` is only the instance that revealed it.
 *
 * **No database.** It reads the schema module and the export's own source, so
 * it runs everywhere and cannot be skipped into uselessness.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import * as schema from "../src/db/schema.js";
import { ARTICLE_TABLE_COVERAGE } from "../src/store/export.js";

/**
 * Every table in the schema that hangs off an article, by SQL name.
 *
 * **Derived, never listed.** A second hand-written list beside the schema is
 * the thing this file exists to make impossible — see
 * docs/reusable/silent-success.md § "Never write a 'should I emit this?'
 * condition as a second list beside the data".
 *
 * `article_id` is the test for "in scope": an export writes one article's
 * `data/<slug>/` directory, and a table not scoped to an article has nowhere in
 * it to go. `articles` itself is excluded because it *is* the article — its
 * columns become `shelf.json` and the join `exportArticle` opens with.
 */
function articleScopedTables(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value as never, PgTable)) continue;
    const table = value as unknown as PgTable;
    if (!("articleId" in getTableColumns(table))) continue;
    names.push(getTableName(table));
  }
  return names.sort();
}

const SOURCE = path.resolve(import.meta.dirname, "..", "src", "store", "export.ts");

describe("the rollback knows about every article-scoped table", () => {
  it("finds the tables by looking at the schema, not at a list", () => {
    /* The collector's own alarm. A `getTableColumns` that stopped recognising
       drizzle tables, or an import that resolved to an empty module, would
       return `[]` — and every assertion below would then pass forever while
       checking nothing. A collector that matches nothing passes every assertion
       about its contents. */
    const found = articleScopedTables();
    expect(found.length).toBeGreaterThan(8);
    expect(found).toContain("comments");
    expect(found).toContain("referee_criteria");
  });

  it("names every one of them, so a new table cannot arrive quietly", () => {
    const missing = articleScopedTables().filter((name) => !(name in ARTICLE_TABLE_COVERAGE));
    expect(
      missing,
      `src/store/export.ts has never heard of ${missing.join(", ")}. ` +
        "db:export is the rollback, and a table it does not know about is dropped " +
        "silently — it reports success and lists the files it did write. Add an " +
        "entry to ARTICLE_TABLE_COVERAGE: either { exported: true, into: '<file>.json' } " +
        "with the code to write it, or { exported: false, why: '<why a rollback " +
        "of data/ does not need it>' }.",
    ).toEqual([]);
  });

  it("names nothing that is not a table any more", () => {
    /* The other direction. A renamed or dropped table leaves an entry here that
       reads as coverage and covers nothing, which is how a list beside the data
       goes wrong in the quiet direction. */
    const scoped = new Set(articleScopedTables());
    const stale = Object.keys(ARTICLE_TABLE_COVERAGE).filter((name) => !scoped.has(name));
    expect(
      stale,
      `ARTICLE_TABLE_COVERAGE names ${stale.join(", ")}, which is not an ` +
        "article-scoped table in src/db/schema.ts any more. Delete the entry, or " +
        "fix the name.",
    ).toEqual([]);
  });

  it("gives every omission a reason written in words", () => {
    for (const [name, coverage] of Object.entries(ARTICLE_TABLE_COVERAGE)) {
      if (coverage.exported) continue;
      // A reason, not a shrug. "not needed" is what somebody writes when they
      // have not thought about it, and it is what the next reader has to
      // re-derive from scratch.
      expect(coverage.why.length, `${name} is not exported and says why in too few words`).
        toBeGreaterThan(40);
    }
  });

  it("actually writes the file each exported table claims", async () => {
    /* The half that stops the record becoming a wish. Adding a name to the list
       is one edit and wiring the export is another, and a declaration that says
       "exported" while nothing writes the file is worse than no declaration —
       it reads as the check having been done.

       The anchor is `put("<file>")`, which is the one call in `exportArticle`
       that both writes an artefact and records it in `files`. */
    const source = await readFile(SOURCE, "utf8");
    for (const [name, coverage] of Object.entries(ARTICLE_TABLE_COVERAGE)) {
      if (!coverage.exported) continue;
      expect(
        source.includes(`put("${coverage.into}"`),
        `ARTICLE_TABLE_COVERAGE says ${name} is exported into ${coverage.into}, ` +
          `but nothing in src/store/export.ts calls put("${coverage.into}", …).`,
      ).toBe(true);
    }
  });
});
