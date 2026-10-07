/**
 * **The private link's key is read out of the database in one place.** A
 * static guard, with no database.
 *
 * `articles.share_token` is a credential
 * (docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md):
 * anybody holding it and the slug can read the article. One response in the
 * app is allowed to carry it, the owner's
 * `GET`/`POST`/`DELETE /api/article/:slug/share-link`, and this file is what
 * holds the rest of the tree to that.
 *
 * ## What it can see, and what it cannot
 *
 * It finds every file under `src/` and `scripts/` that **names** the column,
 * in either spelling, and pins the list. A new name is a new reader of a
 * secret, and it fails here with the file in the message.
 *
 * It cannot see a read that does not name the column: `select()` over the
 * whole `articles` row, or `{ article: articles }`, brings the token along
 * unnamed. So the second case pins the files that select the row whole, and
 * for each one says what stops the token leaving. That list was made by
 * reading them on 2026-10-05, and one of them was a real leak: the reader's
 * export wrote the whole row into `article.json`.
 *
 * The behaviour is tested where it happens: tests/share-link-pg.test.ts for
 * the routes, tests/store-export-bundle.test.ts for the zip,
 * tests/public-reads.test.ts for the public statements.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Comments out, so a file may explain the rule without tripping it. */
const codeOf = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const SOURCES = [...filesUnder("src"), ...filesUnder("scripts")].sort();
const code = new Map(SOURCES.map((file) => [file, codeOf(readFileSync(path.join(ROOT, file), "utf8"))]));

describe("the private link's key", () => {
  it("is named by five files, and each has one job with it", () => {
    const naming = SOURCES.filter((file) => /shareToken\b|share_token\b/.test(code.get(file) ?? ""));
    expect(naming).toEqual([
      /* The one-off never-published tidy (261007f): asks only whether a key exists
         (`share_token is not null`, inside its refusal conditions), so an article that
         was ever shared is never deleted. It selects no value. Greg, 2026-10-07: "A". */
      "scripts/never-published-tidy.ts",
      /* Declares the column and its two CHECKs. */
      "src/db/schema.ts",
      /* Drops it from the reader's export. */
      "src/store/export-bundle.ts",
      /* Compares it, in a `where`, with the key a request carried. */
      "src/store/link-shared-slug.ts",
      /* The owner's store: the one place that selects it and writes it. */
      "src/store/pg-share-link.ts",
    ]);
  });

  it("is compared and never selected by the public predicate", () => {
    const leaf = code.get("src/store/link-shared-slug.ts") ?? "";
    expect(leaf.match(/shareToken/g) ?? []).toHaveLength(1);
    expect(leaf).toMatch(/eq\(articles\.shareToken, key\)/);
    expect(leaf).not.toMatch(/select/);
  });

  it("is only ever dropped by the export, by name", () => {
    const bundle = code.get("src/store/export-bundle.ts") ?? "";
    expect(bundle.match(/shareToken\b/g) ?? []).toHaveLength(1);
    expect(bundle).toMatch(/rowJson\(rows\.article, \[[^\]]*"shareToken"[^\]]*\]\)/);
  });

  it("reaches no part of the browser's code, the public DTO or the wire types", () => {
    for (const file of SOURCES) {
      if (!/^src\/(web\/|public\/|public-types\.ts|types\.ts)/.test(file)) continue;
      expect(code.get(file) ?? "", file).not.toMatch(/shareToken\b|share_token\b/);
    }
  });

  /**
   * **The reads that take the whole `articles` row**, and so hold the token
   * without naming it. A fifth is a new place the key is in memory, and has to
   * say here what keeps it there.
   */
  it("rides along unnamed in exactly these whole-row reads, none of which sends the row on", () => {
    const WHOLE_ROW =
      /article: articles\b|\.select\(\)\s*\.from\(articles\)|typeof articles\.\$inferSelect|\.returning\(\)/;
    const holders = SOURCES.filter((file) => {
      const text = code.get(file) ?? "";
      if (!WHOLE_ROW.test(text)) return false;
      /* `.returning()` and `$inferSelect` count only where the table is `articles`. */
      return (
        /article: articles\b/.test(text) ||
        /\.select\(\)\s*\.from\(articles\)/.test(text) ||
        /typeof articles\.\$inferSelect/.test(text) ||
        /(insert|update)\(articles\)[\s\S]{0,400}?\.returning\(\)/.test(text)
      );
    });
    expect(holders).toEqual([
      /* The export's walk. `export-bundle.ts` drops the token by name; the
         rollback (`export.ts`) builds `shelf.json` field by field. */
      "src/store/article-rows.ts",
      /* `lockArticle`: the row under lock, for the publication transaction.
         Its callers read named columns and return none of it. */
      "src/store/pg-revisions.ts",
      /* The shelf's PATCH: `update(articles) … returning()`, of which it reads
         `archivedAt` and answers a shelf entry built from the slug. */
      "src/store/pg-shelf.ts",
      /* The owner's reader. `found.article` is read one named column at a
         time into the owner's own DTOs, and `shareToken` is not one of them
         (the first case here would name pg.ts if it were). */
      "src/store/pg.ts",
    ]);
    /* That last claim, checked rather than stated: nothing spreads the row. */
    for (const file of [
      "src/store/pg.ts",
      "src/store/pg-revisions.ts",
      "src/store/pg-shelf.ts",
      "src/store/export.ts",
    ]) {
      expect(code.get(file) ?? "", file).not.toMatch(/\.\.\.(found|row|rows|locked)\.article\b/);
    }
  });

  it("is never written to a log or put in an error by the store that holds it", () => {
    const store = code.get("src/store/pg-share-link.ts") ?? "";
    expect(store).not.toMatch(/\blog\(/);
    expect(store).not.toMatch(/console\./);
    /* The one error it builds names the slug, which the caller already sent. */
    expect(store.match(/new Error\(/g) ?? []).toHaveLength(1);
    expect(store).toMatch(/new Error\(`No article artefacts for "\$\{slug\}"\.`\)/);
    /* And the audit insert has no column to put a key in. */
    const schema = code.get("src/db/schema.ts") ?? "";
    const events = /export const articleShareLinkEvents[\s\S]*?\n\);/.exec(schema)?.[0] ?? "";
    expect(events).not.toBe("");
    /* `primaryKey` is the one word here with "key" in it, so columns are what is read. */
    expect(events).not.toMatch(/token/i);
    expect(events).not.toMatch(/\bkey\b|"key"|share_key/i);
    expect([...events.matchAll(/^\s{4}(\w+): /gm)].map((m) => m[1])).toEqual([
      "id",
      "articleId",
      "slug",
      "actorOwnerId",
      "event",
      "rightsConfirmed",
      "createdAt",
    ]);
  });
});
