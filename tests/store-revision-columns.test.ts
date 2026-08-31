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
 * `REVISION_READ_POLICY` names every column and says which reads may take it.
 *
 * ## And a second axis, since 2026-08-28
 *
 * The shelf asks four artefact columns one question — "is there one?" — and it
 * answered it by pulling the whole JSONB document across the wire to compare it
 * with null: 154 KB of tree, glossary, summary, arc and tweets across eight
 * short articles, per homepage load, to produce twenty booleans. So a read may
 * now take a column by its `"value"` or by its `"presence"`, and `is not null`
 * is evaluated in Postgres.
 *
 * One axis could not express that, and the difference matters to this file
 * specifically: without it, "the library may look at `glossary`" and "the
 * library may read `glossary`" are the same sentence, and the projection check
 * below would have to accept either query. docs/plans/260828c-library-read-latency.md.
 *
 * GPT Sol's review of docs/plans/260827am-glossary-read-latency.md is why it is a map
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
import { STEP_ORDER, STEPS } from "../src/pipeline.js";
import {
  citedMetaFingerprintOf,
  currentRevisionQuery,
  listArticlesQuery,
  metaFingerprintOf,
  PRESENCE_OF_FOR_TEST as PRESENCE_OF,
  REVISION_READ_POLICY_FOR_TEST as POLICY,
  REVISION_PROJECTIONS,
} from "../src/store/pg.js";
import {
  articleFingerprint,
  articleWithIdsFingerprint,
  type BlockFingerprint,
} from "../src/source-hash.js";
import type { Tree } from "../src/types.js";

type Uses = Record<string, "value" | "presence" | undefined>;

/**
 * The keys a read's projection must have, from the policy alone.
 *
 * A `"value"` grant is the column's own name; a `"presence"` grant is the
 * `has…` alias `PRESENCE_OF` declares for it. Built from the two declarations
 * rather than from a naming convention this file would otherwise have to guess
 * — so renaming a flag without renaming its declaration fails here.
 */
function policyGrants(read: string): string[] {
  const aliasOf = new Map<string, string>(
    Object.entries(PRESENCE_OF).map(([alias, column]) => [column as string, alias]),
  );
  const keys: string[] = [];
  for (const [column, uses] of Object.entries(POLICY as Record<string, Uses>)) {
    const use = uses[read];
    if (use === "value") keys.push(column);
    else if (use === "presence") {
      const alias = aliasOf.get(column);
      if (!alias) throw new Error(`${column} is granted by presence to ${read} but has no has… alias`);
      keys.push(alias);
    }
  }
  return keys.sort();
}

describe("the revision column policy", () => {
  it("classifies every column of the table, and invents none", () => {
    /* Both directions. A column in the schema and not the map is one that would
       be silently dropped from every read; a column in the map and not the
       schema is a rule about something that no longer exists. */
    expect(Object.keys(POLICY).sort()).toEqual(Object.keys(getTableColumns(articleRevisions)).sort());
  });

  it("gives the whole-article HTML to nobody", () => {
    /* The two HTML columns are the whole article again and are pipeline
       artefacts, reached through src/store/artifacts.ts and
       src/store/export.ts — never through a revision read. `labels` likewise. */
    for (const column of ["extractedHtml", "stampedHtml", "labels"] as const) {
      expect({ column, reads: POLICY[column] }).toEqual({ column, reads: {} });
    }
  });

  /**
   * **And the source document to exactly one read, which is the one that is
   * *for* it.**
   *
   * `rawBytes` was in the list above until 2026-08-31 — it was the finding that
   * started this map, because up to 32 MiB of PDF was arriving on every article
   * load. It is granted now to `rawSource` and to nothing else: that read runs
   * when somebody presses *view the original*, and it is the request the bytes
   * are the answer to. Written as an equality rather than a `toBeDefined`, so
   * granting it to a second read fails here.
   *
   * Note what `rawSource` may still not have: the tree, the blocks, the
   * artefacts, or anything from `META_COLUMNS`. It is five columns.
   * docs/plans/plain-mode-and-the-way-out.md § 5.
   */
  it("gives the source document to the one read that serves it, and no other", () => {
    expect(POLICY.rawBytes).toEqual({ rawSource: "value" });
    expect(policyGrants("rawSource")).toEqual(
      ["id", "rawBytes", "rawContentType", "rawFilename", "rawSourceKind", "rawSourceSha256"].sort(),
    );
  });

  it("still carries the hash, which is what actually gets read", () => {
    /* `metaFrom` puts `rawSha256` in the Meta the client sees, and
       src/store/export.ts rebuilds meta.json from it. Dropping the bytes must
       not drop the fact that we know what they were. */
    expect(POLICY.rawSha256.article).toBe("value");
  });
});

describe("the presence flags", () => {
  it("are named for columns, and named nothing a column is called", () => {
    const columns = new Set(Object.keys(getTableColumns(articleRevisions)));
    for (const [alias, column] of Object.entries(PRESENCE_OF)) {
      /* The column it is the presence of has to exist. */
      expect({ alias, real: columns.has(column) }).toEqual({ alias, real: true });
      /* And the alias must NOT be a column name. `RevisionRowFor` tests the
         schema keys first, so an alias that collided with one would silently
         take that column's type instead of `boolean` — a `has…` flag typed
         `Tree | null`, and `if (row.hasTree)` true for every article that has
         one and also for none that don't. GPT Sol's seventh finding. */
      expect({ alias, shadows: columns.has(alias) }).toEqual({ alias, shadows: false });
    }
  });
});

/**
 * Every projection, named rather than looped over `Object.keys` — so that
 * deleting one fails here instead of quietly reducing the tests below to the
 * ones that are left.
 *
 * **And the coverage test right underneath, because naming them buys only half
 * of it.** Deleting a projection failed; *adding* one failed nothing, so
 * `sketch` and `arc` were both checked against the policy by nobody. That is
 * not a coincidence — the bug this file caught (a `metadata` projection missing
 * the sketch column, which is what told an owner their personalised picture was
 * not personalised, docs/postmortems/260830c-the-dialog-said-nothing-was-personalised.md)
 * was a hand-written list that had fallen behind, and this file had the same
 * defect one level up while catching it. GPT Sol found the list was six once
 * already, and the answer then was to write down eight.
 */
const READS = [
  "article",
  "library",
  "metadata",
  "publish",
  "tweets",
  "glossary",
  "ideas",
  "sketch",
  "arc",
  /* Added 2026-08-31 with the `quotes` stage from another session — the
     projection landed and this list did not, which is exactly what the
     assertion below exists to catch. */
  "quotes",
  /* Added 2026-08-31 with the `timeline` stage. Its projection is the only one
     on `DATED_FINGERPRINT_COLUMNS` — the cited set plus `published_at` — because
     it is the only stage judged on the publication date. */
  "timeline",
  /* Added 2026-08-31 with `pgArticleReader.loadSource`. The only read that
     takes bytes, which is why it is a projection of its own rather than columns
     bolted onto `article` — src/store/pg.ts § `rawSource`. */
  "rawSource",
] as const;

describe("the list of projections this file checks", () => {
  it("is every projection there is", () => {
    expect([...READS].sort()).toEqual(Object.keys(REVISION_PROJECTIONS).sort());
  });
});

describe("every projection obeys the policy", () => {
  for (const read of READS) {
    it(`${read} selects exactly what it is allowed`, () => {
      expect(Object.keys(REVISION_PROJECTIONS[read]).sort()).toEqual(policyGrants(read));
    });
  }

  it("lets the shelf ask whether an artefact exists without reading it", () => {
    /* The second half of docs/plans/260828c-library-read-latency.md, as a fact about
       the policy rather than as a diff: the library is granted all four of
       these, and granted none of them by value. */
    for (const column of ["tree", "arc", "tweets", "glossary"] as const) {
      expect({ column, use: POLICY[column].library }).toEqual({ column, use: "presence" });
    }
    /* And the read that returns each artefact still takes it by value, so
       "presence" cannot spread quietly into the reads that need the document. */
    expect(POLICY.glossary.glossary).toBe("value");
    expect(POLICY.tweets.tweets).toBe("value");
    expect(POLICY.tree.article).toBe("value");
  });

  it("gives the shelf the cached scalars, which nothing read until 2026-08-28", () => {
    /* They were written at publish and read by nobody, so the shelf recomputed
       all five from every block row of every article on every load. */
    for (const column of ["wordCount", "blockCount", "partCount", "sectionCount", "rootGist"] as const) {
      expect({ column, use: POLICY[column].library }).toEqual({ column, use: "value" });
    }
  });

  it("does not let the glossary read take another artefact's document", () => {
    /* The point of the whole change, stated as a fact rather than as a diff:
       reading the glossary must not pull the summaries, the ideas, the thread
       or the article's HTML along with it.

       **The tree and the three metadata scalars are here since 2026-08-31**,
       and they are the exception the rest of this rule is measured against:
       this read answers `stale`, and `stale` compares the fingerprint the
       pipeline would stamp — blocks, tree and metadata head (src/source-hash.ts
       § `articleFingerprint`). A read that could not see the outline or the
       title would answer a narrower question than the writer asked, and the two
       stores would disagree about the same article. The blocks it also needs
       come from `blockHashInputs`, which is already the whole article's text —
       so the tree beside it is the small half of a cost this read was always
       paying. */
    const taken = Object.keys(REVISION_PROJECTIONS.glossary);
    expect(taken.sort()).toEqual(["byline", "glossary", "id", "siteName", "title", "tree"]);
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
    /* **All of them**, from the one list above. It said six, then eight, and
       was missing `sketch` and `arc` both times — which is how a projection
       acquires a column nobody notices. It is a shared const now, and the test
       above holds it against the real thing.

       **Except `rawSource`, which is the one read that is for those bytes**, and
       it is excluded by name rather than by a `try`: naming it is what makes
       adding a *second* exception a decision somebody has to write down here.
       Its own assertion is below, and it is the stronger one — that read may
       take `raw_bytes` and still may not take the article. */
    for (const read of READS.filter((r) => r !== "rawSource")) {
      const sql = sqlFor(read);
      expect({ read, raw: sql.includes('"raw_bytes"') }).toEqual({ read, raw: false });
      expect({ read, x: sql.includes('"extracted_html"') }).toEqual({ read, x: false });
      expect({ read, s: sql.includes('"stamped_html"') }).toEqual({ read, s: false });
      expect({ read, l: sql.includes('"labels"') }).toEqual({ read, l: false });
    }
  });

  it("sends the source document only on the read that serves it, and nothing else with it", () => {
    const sql = sqlFor("rawSource");
    expect(sql).toContain('"raw_bytes"');
    expect(sql).toContain('"raw_source_sha256"');
    expect(sql).toContain('"raw_filename"');
    /* The whole point of a projection of its own: pressing *view the original*
       must not also drag the article, its tree or its artefacts across the
       wire. */
    for (const column of ['"tree"', '"extracted_html"', '"stamped_html"', '"labels"', '"glossary"', '"title"']) {
      expect({ column, taken: sql.includes(column) }).toEqual({ column, taken: false });
    }
  });

  it("asks for the glossary and nothing else that is large", () => {
    /* The read this whole change is about. It used to take `extracted_html`,
       `stamped_html`, the labels, the ideas and the summaries — roughly 508 KB
       on a 360-block article — to return a 10 KB glossary.

       The tree is no longer on the forbidden list: this read compares it to
       answer `stale` (see the projection test above). Everything else that is
       another artefact's document still is. */
    const sql = sqlFor("glossary");
    expect(sql).toContain('"glossary"');
    expect(sql).not.toContain('"summary"');
    expect(sql).not.toContain('"ideas"');
    expect(sql).not.toContain('"arc"');
    /* `tweets` is a whole thread document and was missing from this list. */
    expect(sql).not.toContain('"tweets"');
  });

  /**
   * The tree goes to every read that compares it, and to no read that does not.
   *
   * Stated as one list rather than as a case per read, because the failure this
   * catches is asymmetric and quiet in both directions: a read that lost the
   * tree would report its artefact stale for ever in Postgres while the
   * filesystem store called the same article current, and a read that gained
   * one nobody compares is the latency this whole map exists to stop.
   * src/source-hash.ts § `articleFingerprint`.
   */
  it("gives the tree to every read whose staleness compares it, and no other", () => {
    const compares = new Set(["tweets", "glossary", "ideas", "sketch", "arc", "timeline"]);
    for (const read of READS) {
      /* `article`, `metadata` and `publish` render or validate the tree rather
         than fingerprinting it, and the library asks about it in SQL. Those
         four are outside this rule and keep their own reasons. */
      if (!compares.has(read)) continue;
      expect({ read, tree: sqlFor(read).includes('"tree"') }).toEqual({ read, tree: true });
      expect({ read, title: sqlFor(read).includes('"title"') }).toEqual({ read, title: true });
    }
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

describe("the shelf's own query", () => {
  /**
   * **Built through the real query, not from the projection object.**
   *
   * `listArticlesQuery` exists as a seam for exactly this. Assembling SQL from
   * `REVISION_PROJECTIONS.library` here would repeat the hole GPT Sol found in
   * the last change: the projection can be perfect while the query says
   * `.select()`. Its fourth finding on docs/plans/260828c-library-read-latency.md said
   * so before this was built.
   */
  const shelfSql = (archived: boolean): string =>
    listArticlesQuery(new QueryBuilder() as never, { archived }).toSQL().sql;

  it("looks at the four artefact columns and reads none of them", () => {
    const sql = shelfSql(false);
    for (const column of ["tree", "arc", "tweets", "glossary"] as const) {
      /* Present, and present ONLY as a null test. A bare `"tree"` in the select
         list is the 37 KB document crossing the wire to answer a boolean. */
      expect({ column, asked: sql.includes(`"${column}" is not null`) }).toEqual({
        column,
        asked: true,
      });
      const bare = new RegExp(`"${column}"(?! is not null)`, "g");
      expect({ column, bare: bare.test(sql) }).toEqual({ column, bare: false });
    }
  });

  it("takes the cached scalars instead of the blocks", () => {
    const sql = shelfSql(false);
    for (const column of ["word_count", "block_count", "part_count", "section_count", "root_gist"]) {
      expect({ column, taken: sql.includes(`"${column}"`) }).toEqual({ column, taken: true });
    }
    /* **`revision_blocks` appears exactly once**, and only as the correlated
       subquery that finds the title fallback's heading.

       Counting, not merely "no `html` and no `fts`". GPT Sol's fourth finding
       on the built code: a join, a lateral, or a second correlated aggregate
       over the block table would stay at two statements, be invisible to the
       statement-shape check in tests/store-shelf-reads.test.ts (which ignores
       anything selecting `from articles`), touch neither of the two forbidden
       columns, and leave every test green. */
    /* Counting where it is *read from*, not where its name appears: a column
       reference inside the subquery is qualified too, so the table's name
       occurs six times in one perfectly good query. `from` and `join` are the
       two ways a second read of it could arrive — including the inner `from` of
       a lateral. */
    const reads = sql.match(/\b(?:from|join)\s+"spideryarn"\."revision_blocks"/g) ?? [];
    expect({ readsOfTheBlockTable: reads.length }).toEqual({ readsOfTheBlockTable: 1 });

    /* And the shape of that one, since it is now the only thing standing
       between the shelf and the blocks: guarded, ordered, and limited to a
       row. Unordered it returns whichever `<h1>` the planner reaches first;
       unguarded it filters every block of an article that has none. */
    expect(sql).toMatch(/case\s+when .*"title" is null and .*"title_override" is null then \(/s);
    expect(sql).toContain("limit 1");
    expect(sql).toContain('"ordinal"');
    expect(sql).not.toContain('"html"');
    expect(sql).not.toContain('"fts"');
  });

  it("never sends the source document or the whole-article HTML", () => {
    for (const archived of [false, true]) {
      const sql = shelfSql(archived);
      expect({ archived, raw: sql.includes('"raw_bytes"') }).toEqual({ archived, raw: false });
      expect({ archived, x: sql.includes('"extracted_html"') }).toEqual({ archived, x: false });
      expect({ archived, s: sql.includes('"stamped_html"') }).toEqual({ archived, s: false });
      expect({ archived, l: sql.includes('"labels"') }).toEqual({ archived, l: false });
      expect({ archived, i: sql.includes('"ideas"') }).toEqual({ archived, i: false });
    }
  });
});

describe("the revision query that is not reachable as a builder", () => {
  /**
   * `publishRevision` names its projection inline, inside a transaction that
   * has already taken a lock, so it is guarded by reading the source instead.
   * (`listArticles` was in this boat too until 2026-08-28; it now has the
   * builder seam above, which is strictly better.)
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

  it("publication selects its projection, not everything", async () => {
    const src = await code("src/store/pg-revisions.ts");
    expect(src).toContain(".select(REVISION_PROJECTIONS.publish)");
    /* The bare form is what took `raw_bytes`. */
    expect(src).not.toMatch(/\.select\(\)\s*\n?\s*\.from\(articleRevisions\)/);
  });
});

/**
 * **The two stores have to reconstruct "no metadata" the same way**, or an
 * article that legitimately has none is current to one of them and stale to the
 * other, for ever.
 *
 * `readMeta` in src/store/artifacts-pg.ts returns `null` when `title` is null —
 * *"a null title has nothing that would make a usable `meta`"* — and that is
 * what the pipeline's stamp is handed, on both stores. The reader path here
 * rebuilds a fingerprint from the same columns, and it used to answer
 * `{ title: "" }`, which the fingerprint deliberately distinguishes from `null`
 * (they are different states: extraction ran and produced nothing usable, versus
 * nothing was recorded). So the pipeline called such an article current and
 * `loadTweets`, `loadGlossary`, `loadSummaries`, `loadIdeas`, `loadSketch`,
 * `loadArc` and the metadata page all called it stale. GPT Sol, 2026-08-31.
 *
 * Asserted as the two paths **agreeing**, rather than as "the helper returns
 * null" — the second is a restatement of the implementation and would survive
 * the fingerprint changing its mind about `null` versus `{}`.
 */
describe("what a revision with no metadata hashes to", () => {
  const BLOCKS: BlockFingerprint[] = [{ id: "spya-aaaaaa", text: "One paragraph." }];
  const TREE = {
    version: "toc/2",
    generator: "fixture",
    slug: "a-slug",
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        parent: null,
        range: ["spya-aaaaaa", "spya-aaaaaa"],
        title: "All",
        gist: "One sentence.",
        children: [],
      },
    },
  } as unknown as Tree;

  const NOTHING = { title: null, byline: null, siteName: null, finalUrl: null };

  it("agrees with what the pipeline stamps for the articleText stages", () => {
    expect(articleFingerprint(BLOCKS, TREE, metaFingerprintOf(NOTHING))).toBe(
      articleFingerprint(BLOCKS, TREE, null),
    );
  });

  it("agrees with what the pipeline stamps for the articleWithIds stages", () => {
    expect(articleWithIdsFingerprint(BLOCKS, TREE, citedMetaFingerprintOf(NOTHING))).toBe(
      articleWithIdsFingerprint(BLOCKS, TREE, null),
    );
  });

  /* Not vacuous: a row that *has* a title must hash differently from one that
     has none, or the two cases above would pass by collapsing everything. */
  it("still tells a titled revision from an untitled one", () => {
    const titled = { ...NOTHING, title: "A real title" };
    expect(articleFingerprint(BLOCKS, TREE, metaFingerprintOf(titled))).not.toBe(
      articleFingerprint(BLOCKS, TREE, null),
    );
    expect(articleWithIdsFingerprint(BLOCKS, TREE, citedMetaFingerprintOf(titled))).not.toBe(
      articleWithIdsFingerprint(BLOCKS, TREE, null),
    );
  });

  /* And the URL reaches the two stages whose head prints it. A row carrying a
     `final_url` that the fingerprint could not see is the Postgres half of
     GPT Sol's third finding. */
  it("carries the final URL into the articleWithIds fingerprint", () => {
    const one = { ...NOTHING, title: "A real title", finalUrl: "https://one.example/" };
    const two = { ...NOTHING, title: "A real title", finalUrl: "https://two.example/" };
    expect(articleWithIdsFingerprint(BLOCKS, TREE, citedMetaFingerprintOf(one))).not.toBe(
      articleWithIdsFingerprint(BLOCKS, TREE, citedMetaFingerprintOf(two)),
    );
    /* And not into the other four, whose head never prints it. */
    expect(articleFingerprint(BLOCKS, TREE, metaFingerprintOf(one))).toBe(
      articleFingerprint(BLOCKS, TREE, metaFingerprintOf(two)),
    );
  });
});

/**
 * **Every step that can tell whether it is current must have a case on the
 * metadata page**, or the two stores answer differently about the same article.
 *
 * `isCurrent` in src/store/pg.ts is a switch with a `default: true` arm, and
 * `default: true` is the wrong answer for any step that has a `stamp`: the
 * filesystem store asks that stamp and says "stale", while Postgres says
 * "done". `sketch` sat in the default arm from the day it gained a stamp —
 * carry a finished sketch, change the tree or the title, and `loadSketch`
 * reports it stale on the panel while the page listing the stages reports it
 * finished. GPT Sol, 2026-08-31.
 *
 * **Read out of the source rather than asserted on one name.** A test naming
 * `sketch` would have been green the day before `sketch` existed and green
 * again the day after the next stage arrives without a case — and one did
 * arrive while this was being written. A rule stated in one function is not a
 * rule the codebase follows; the precedent is tests/blocks-baseline.test.ts and
 * tests/sanitize-stale-artefact.test.ts.
 *
 * `hierarchy` is deliberately not required here: it has no `stamp`, on purpose
 * (src/pipeline.ts § `hierarchy` says why at length), and its case exists for a
 * different reason.
 */
describe("the metadata page and the pipeline agree about which steps can be current", () => {
  it("has a case for every stamped step", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const source = await readFile(path.join(root, "src", "store", "pg.ts"), "utf-8");

    /* The switch only, not the whole file: a `case "sketch"` in some unrelated
       function would otherwise satisfy this. */
    const from = source.indexOf("const isCurrent = (step: StepName): boolean =>");
    const to = source.indexOf("const stages: StageState[]", from);
    expect({ from: from > 0, to: to > from }, "the anchors still exist").toEqual({
      from: true,
      to: true,
    });
    const body = source.slice(from, to);

    const missing = STEP_ORDER.filter((name) => STEPS[name].stamp && !body.includes(`case "${name}"`));
    expect(missing).toEqual([]);
  });
});
