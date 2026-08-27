/**
 * **What a revision read drags across the wire.**
 *
 * `currentRevision` and `listArticles` both selected `articleRevisions` whole —
 * `select({ article: articles, revision: articleRevisions })` — and one of that
 * table's columns is `raw_bytes`, a `bytea` holding the entire source document,
 * up to 32 MiB at stage 1's own ceiling. `listArticles` runs it **once per
 * article**. Measured on this laptop's database, 8 articles:
 *
 * ```
 *   whole row (what it did)     28 ms    23.89 MB
 *   only what it reads           0 ms     0.01 MB
 * ```
 *
 * ## Why the shape of this test changed
 *
 * The first version took `raw_bytes` out and then asserted the selection was
 * **exactly** "every other column", so that a column added to the schema could
 * not be silently dropped from every read. That is a real property and it is
 * kept below. What it also did was freeze everything else in place: a glossary
 * read went on pulling `extracted_html` and `stamped_html` — the whole article,
 * twice — plus the tree, the labels, the ideas and the summaries, roughly
 * 508 KB of it, to return a 10 KB glossary.
 *
 * So there is a projection per read now, and the guard is a **policy map**:
 * `REVISION_COLUMN_POLICY` names every column and says which reads may take it.
 *
 * GPT Sol's review of docs/plans/glossary-read-latency.md is why it is a map
 * and not a union. A test of the form `selected ∪ omitted === all` looks like
 * the same guarantee and is not: if `selected` is still derived from
 * `getTableColumns` by object-rest, a new column enters it automatically and
 * the union stays green — proving only that somebody wrote down two lists that
 * add up. Two assertions are needed and both are here:
 *
 *  1. the map's keys are exactly the table's columns, so a new column has to be
 *     classified before anything compiles or passes; and
 *  2. **each real projection equals the columns the policy assigns it**, so a
 *     classification nothing obeys fails too.
 *
 * The second is the one that matters. A policy no query reads is a comment.
 *
 * This does not need a database. It is about the shape of a query.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import { articleRevisions } from "../src/db/schema.js";
import {
  currentRevisionQuery,
  REVISION_COLUMN_POLICY_FOR_TEST as POLICY,
  REVISION_PROJECTIONS,
} from "../src/store/pg.js";

/** Which columns the policy grants one read, in sorted order. */
function policyGrants(read: string): string[] {
  return Object.entries(POLICY)
    .filter(([, reads]) => (reads as string[]).includes(read))
    .map(([name]) => name)
    .sort();
}

describe("the revision column policy", () => {
  it("classifies every column of the table, and invents none", () => {
    /* Both directions. A column in the schema and not the map is one that would
       be silently dropped from every read; a column in the map and not the
       schema is a rule about something that no longer exists. */
    expect(Object.keys(POLICY).sort()).toEqual(Object.keys(getTableColumns(articleRevisions)).sort());
  });

  it("gives the source document and the whole-article HTML to nobody", () => {
    /* `raw_bytes` is the original finding. The two HTML columns are the whole
       article again and are pipeline artefacts, reached through
       src/store/artifacts.ts and src/store/export.ts — never through a revision
       read. `labels` likewise. */
    for (const column of ["rawBytes", "extractedHtml", "stampedHtml", "labels"] as const) {
      expect({ column, reads: POLICY[column] }).toEqual({ column, reads: [] });
    }
  });

  it("still carries the hash, which is what actually gets read", () => {
    /* `metaFrom` puts `rawSha256` in the Meta the client sees, and
       src/store/export.ts rebuilds meta.json from it. Dropping the bytes must
       not drop the fact that we know what they were. */
    expect(POLICY.rawSha256).toContain("article");
  });
});

describe("every projection obeys the policy", () => {
  /* Named one at a time rather than looped over `Object.keys(REVISION_PROJECTIONS)`,
     so that deleting a projection fails here instead of quietly reducing the
     test to the ones that are left. */
  for (const read of [
    "article",
    "library",
    "metadata",
    "publish",
    "tweets",
    "glossary",
    "summaries",
    "ideas",
  ] as const) {
    it(`${read} selects exactly what it is allowed`, () => {
      expect(Object.keys(REVISION_PROJECTIONS[read]).sort()).toEqual(policyGrants(read));
    });
  }

  it("does not let the glossary read take another artefact's document", () => {
    /* The point of the whole change, stated as a fact rather than as a diff:
       reading the glossary must not pull the tree, the summaries, the ideas or
       the article's HTML along with it. */
    const taken = Object.keys(REVISION_PROJECTIONS.glossary);
    expect(taken.sort()).toEqual(["glossary", "id"]);
  });
});

describe("the query actually uses its projection", () => {
  /**
   * **The assertion the object comparison above cannot make.**
   *
   * Comparing `REVISION_PROJECTIONS` to the policy proves that somebody wrote
   * two lists that agree. It says nothing about whether any query selects from
   * them — reverting `currentRevision` to `revision: articleRevisions` left
   * every test above green, and typechecked. GPT Sol's second finding on the
   * built code, and its fourth tautology in this change. The generated SQL is
   * the only place the projection and the query meet.
   *
   * No database: `QueryBuilder` builds the statement without a connection.
   */
  const sqlFor = (read: Parameters<typeof currentRevisionQuery>[2]): string =>
    currentRevisionQuery(new QueryBuilder() as never, "some-slug", read).toSQL().sql;

  it("never sends the source document or the whole-article HTML", () => {
    /* **All eight**, not the six the first version listed. `tweets` and
       `summaries` were missing, which is how a projection acquires a column
       nobody notices. GPT Sol, third review. */
    for (const read of [
      "article",
      "library",
      "metadata",
      "publish",
      "tweets",
      "glossary",
      "summaries",
      "ideas",
    ] as const) {
      const sql = sqlFor(read);
      expect({ read, raw: sql.includes('"raw_bytes"') }).toEqual({ read, raw: false });
      expect({ read, x: sql.includes('"extracted_html"') }).toEqual({ read, x: false });
      expect({ read, s: sql.includes('"stamped_html"') }).toEqual({ read, s: false });
      expect({ read, l: sql.includes('"labels"') }).toEqual({ read, l: false });
    }
  });

  it("asks for the glossary and nothing else that is large", () => {
    /* The read this whole change is about. It used to take `extracted_html`,
       `stamped_html`, the tree, the labels, the ideas and the summaries —
       roughly 508 KB on a 360-block article — to return a 10 KB glossary. */
    const sql = sqlFor("glossary");
    expect(sql).toContain('"glossary"');
    expect(sql).not.toContain('"tree"');
    expect(sql).not.toContain('"summary"');
    expect(sql).not.toContain('"ideas"');
    expect(sql).not.toContain('"arc"');
    /* `tweets` is a whole thread document and was missing from this list. */
    expect(sql).not.toContain('"tweets"');
  });

  it("gives ideas the tree, because its staleness compares it", () => {
    /* src/ideas.ts § `inputFingerprint`. Dropping it here would make Postgres
       report current what the filesystem reports stale, for any article that
       was re-sectioned without a word changing. */
    const sql = sqlFor("ideas");
    expect(sql).toContain('"tree"');
    expect(sql).toContain('"ideas"');
  });
});

describe("the two revision queries that are not reachable as builders", () => {
  /**
   * `listArticles` and `publishRevision` name their projections inline — the
   * first inside a long chain, the second inside a transaction that has already
   * taken a lock. Extracting either to take its builder would be a bigger
   * change than this one, so they are guarded by reading the source instead.
   *
   * **A weak test, labelled as one.** It matches text; it cannot tell live code
   * from dead. What it catches is the one regression that matters here, which
   * GPT Sol pointed out the SQL assertions above do not reach: either query
   * quietly going back to selecting the whole revision row.
   */
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  /**
   * Code only.
   *
   * Both files *discuss* the query shapes they must not use — that is what the
   * comments are for — and matching raw text found those sentences and failed.
   * Stripping comments is also what makes this a real check rather than one a
   * future note could satisfy by accident.
   */
  async function code(file: string): Promise<string> {
    const src = await readFile(path.join(root, file), "utf8");
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  it("the library selects its projection, not the whole revision", async () => {
    const src = await code("src/store/pg.ts");
    expect(src).toContain("revision: REVISION_PROJECTIONS.library");
    expect(src).not.toContain("revision: articleRevisions");
  });

  it("publication selects its projection, not everything", async () => {
    const src = await code("src/store/pg-revisions.ts");
    expect(src).toContain(".select(REVISION_PROJECTIONS.publish)");
    /* The bare form is what took `raw_bytes`. */
    expect(src).not.toMatch(/\.select\(\)\s*\n?\s*\.from\(articleRevisions\)/);
  });
});
