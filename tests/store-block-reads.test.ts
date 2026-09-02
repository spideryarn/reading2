/**
 * **What the two block reads ask Postgres for.**
 *
 * There are two, and the difference between them is the point. `blocksFor`
 * returns blocks to be *rendered*, so it takes the HTML and runs the sanitiser
 * over it. `blockHashInputs` returns blocks to be *fingerprinted* — for the
 * four reads (`loadTweets`, `loadGlossary`, `loadSummaries`, `loadIdeas`) whose
 * only use of the article is one call to `hashBlocks` — so it takes two columns
 * and no sanitiser at all.
 *
 * Until 2026-08-27 there was one, and all four fingerprint reads went through
 * it: every block row including `html` and the generated `fts` vector, roughly
 * 370 KB on a 360-block article, put through an 80–180ms jsdom parse, to
 * compute one boolean. docs/plans/260827am-glossary-read-latency.md.
 *
 * ## Why this reads the generated SQL
 *
 * A test that asserts a column constant passes while the real query says
 * `.select()`, and a fixture array that is already in document order passes
 * whether or not the SQL has an `order by`. Both were on GPT Sol's list of
 * checks that can go green over broken behaviour. The only place either fact is
 * actually visible is the statement Drizzle generates, so that is what is
 * asserted — through `QueryBuilder`, which builds SQL with no connection, so
 * this needs no database.
 */
import { describe, expect, it } from "vitest";
import { QueryBuilder } from "drizzle-orm/pg-core";

import { blockHashQuery, blocksQuery, sourceHashQuery } from "../src/store/pg.js";
import { hashBlocks } from "../src/source-hash.js";
import { sanitizeStoredBlocks } from "../src/sanitize.js";
import type { Block } from "../src/types.js";

const sql = blockHashQuery(new QueryBuilder() as never, "rev-1").toSQL().sql;
const renderSql = blocksQuery(new QueryBuilder() as never, "rev-1").toSQL().sql;
const sourceQuery = sourceHashQuery(new QueryBuilder() as never, "art-1").toSQL();
const sourceSql = sourceQuery.sql;
const sourceParams = sourceQuery.params;

describe("the fingerprint read", () => {
  it("asks for the four columns the hash is made of", () => {
    expect(sql).toContain('"block_id"');
    expect(sql).toContain('"text"');
    /* `role` and `treatment` since 2026-08-28. Assigning a role changes no
       text, so `hashBlocks` folds them in (src/source-hash.ts) — and a read
       that still took two columns would compare a full new hash against an old
       narrow one on every single read, for ever. */
    expect(sql).toContain('"role"');
    expect(sql).toContain('"treatment"');
  });

  it("does not ask for the block HTML", () => {
    /* The whole saving. `hashBlocks` reads `id` and `text`; the HTML is roughly
       as large again and is discarded the moment it arrives. */
    expect(sql).not.toContain('"html"');
  });

  it("does not ask for the search vector", () => {
    /* `fts` is a stored, generated tsvector — the schema's own comment says it
       is "queried with `@@` and never selected" — and a bare `.select()` takes
       it anyway. */
    expect(sql).not.toContain('"fts"');
  });

  it("orders by ordinal, because block ids carry no position", () => {
    /* Without this the planner may return the rows in any order, and
       `hashBlocks` joins them in the order it is given — so a reordering
       silently changes the hash and every artefact reports itself stale. */
    expect(sql).toMatch(/order by "spideryarn"\."revision_blocks"\."ordinal" asc/i);
  });
});

/**
 * **The article-keyed fingerprint read** — `sourceHashQuery`, which is the
 * query above plus the join that resolves the article's current revision.
 *
 * Until 2026-09-02 there was no such function and no such test. There were
 * three byte-identical private copies of this query, in `pg-searches.ts`,
 * `pg-referee-criteria.ts` and `pg-referee-claims.ts`. **One of them** —
 * `pg-referee-claims.ts` — called itself "the third copy of this query in
 * src/store/" and named the two things that must not drift, the four columns
 * and the `order by`. Nothing compared them and nothing tested any of them, so
 * that sentence was prose asserting a property nothing held. The copies are now
 * one function beside `blockHashQuery`, and this is the check it was asking for.
 *
 * ("Each one's own comment said so" is what this docstring claimed until GPT Sol
 * checked the parent commit and found only one did. A generalisation from a
 * same-shaped sample, written into three files while citing the doc that names
 * that exact mistake — docs/reusable/written-down-is-not-checked.md.)
 *
 * The assertions read the generated SQL for the reason the header gives: a
 * column constant can be right while the query says `.select()`, and an
 * in-order fixture proves nothing about `order by`.
 */
describe("the article-keyed fingerprint read", () => {
  it("asks for each of the four columns the hash is made of", () => {
    /* Presence, not "exactly four" — an extra selected column would still
       pass. That is deliberate: dropping any of these fails, and the two
       negative cases below catch the bare `.select()` that would sweep in
       `html` and `fts`. GPT Sol's third finding, and it is a fair limit to
       state rather than to over-claim in the test name. */
    expect(sourceSql).toContain('"block_id"');
    expect(sourceSql).toContain('"text"');
    expect(sourceSql).toContain('"role"');
    expect(sourceSql).toContain('"treatment"');
  });

  it("does not ask for the HTML or the search vector", () => {
    /* The two columns whose cost is the whole reason the narrow read exists.
       `fts` in particular arrives on a bare `.select()` without being asked
       for, which is how this query would regress. */
    expect(sourceSql).not.toContain('"html"');
    expect(sourceSql).not.toContain('"fts"');
  });

  it("orders by ordinal, because block ids carry no position", () => {
    /* Without it the planner may return rows in any order and `hashBlocks`
       joins them as given — so every saved search, criterion and claim would
       report itself stale against prose that had not changed, and nothing
       would say why. In development the rows usually come back in insertion
       order, so this is precisely the drift a fixture-based test cannot see. */
    expect(sourceSql).toMatch(/order by "spideryarn"\."revision_blocks"\."ordinal" asc/i);
  });

  it("reaches the article's CURRENT revision, not any revision it ever had", () => {
    /* **The whole predicate, not the words in it.** This assertion first read
       `toContain('"current_revision_id"')` and `toMatch(/inner join/i)`, and
       GPT Sol broke it in one go: a query with no `where` at all and
       `on articles.current_revision_id = articles.id` passed every case, while
       hashing blocks from unrelated articles. Both tokens were present and
       neither meant anything. That is silent-success in a test — the check
       shared an assumption with the code — so it now pins the relationship. */
    expect(sourceSql).toContain(
      'inner join "spideryarn"."articles" on "spideryarn"."articles"."current_revision_id" = "spideryarn"."revision_blocks"."revision_id"',
    );
  });

  it("is scoped to the article it was asked about", () => {
    // The missing half of the case above: without a `where`, the join alone
    // still returns every article's current blocks.
    expect(sourceSql).toContain('where "spideryarn"."articles"."id" = $1');
    expect(sourceParams).toEqual(["art-1"]);
  });
});

describe("the rendering read", () => {
  it("still asks for the HTML, which is the whole reason it exists", () => {
    expect(renderSql).toContain('"html"');
  });

  it("does not ask for the search vector either", () => {
    /* Asserted here and not only on the fingerprint read, because these are two
       queries and guarding one of them is how the other quietly goes back to a
       bare `.select()`. That is exactly what happened to the sanitiser once
       already — see the header of src/sanitize.ts. */
    expect(renderSql).not.toContain('"fts"');
  });

  it("orders by ordinal", () => {
    expect(renderSql).toMatch(/order by "spideryarn"\."revision_blocks"\."ordinal" asc/i);
  });
});

describe("the hash does not depend on the columns that were dropped", () => {
  /* This is the claim the whole change rests on: the fingerprint computed from
     two unsanitised columns must equal the one the filesystem store computes
     from whole, sanitised blocks. If it ever does not, the two stores disagree
     about `stale` — which is what tests/store-parity.test.ts exists to catch,
     and the kind of thing that looks fine until it doesn't. */
  const full = [
    { id: "spya-aaaaaa", tag: "p", kind: "text" as const, text: "One.", words: 1,
      html: '<p onclick="alert(1)">One.</p>', gistable: true },
    { id: "spya-bbbbbb", tag: "p", kind: "text" as const, text: "Two.", words: 1,
      html: "<p>Two.</p>", gistable: true },
  ];

  it("is the same before and after sanitising", () => {
    const cleaned = sanitizeStoredBlocks(full, undefined).blocks;
    /* The fixture has to actually exercise the sanitiser, or this passes for
       the wrong reason — an input it leaves alone proves nothing. */
    expect(cleaned[0]?.html).not.toEqual(full[0]?.html);
    expect(hashBlocks(cleaned)).toEqual(hashBlocks(full));
  });

  it("is the same over the selected columns as over the whole block", () => {
    const narrow = full.map((b) => ({ id: b.id, text: b.text }));
    expect(hashBlocks(narrow)).toEqual(hashBlocks(full));
  });

  /**
   * **And over an article that actually has roles**, which is the case that can
   * fail. The fixture above carries none, so the parity above holds whatever
   * the query selects and whatever `hashBlocks` reads — it is a true statement
   * about today's corpus and says nothing about the change that introduced the
   * two new columns. tests/source-hash-roles.test.ts holds the rest.
   */
  const roled: Block[] = [
    // The key absent rather than undefined: `exactOptionalPropertyTypes` makes
    // those different types, and absent is what the filesystem store writes.
    { ...full[0]! },
    { ...full[1]!, role: "footnote", treatment: "supplement" },
  ];

  it("is the same over the four columns as over a role-bearing block", () => {
    /* `?? null` on purpose: this is the shape the query returns, and Postgres
       spells an absent role `null` where the filesystem leaves the key out. */
    const narrow = roled.map((b) => ({
      id: b.id,
      text: b.text,
      role: b.role ?? null,
      treatment: b.treatment ?? null,
    }));
    expect(hashBlocks(narrow)).toEqual(hashBlocks(roled));
  });

  it("is NOT the same if the read drops those columns", () => {
    // The control for the line above: without it that assertion passes on a
    // `hashBlocks` that ignores roles altogether.
    const dropped = roled.map((b) => ({ id: b.id, text: b.text }));
    expect(hashBlocks(dropped)).not.toEqual(hashBlocks(roled));
  });
});

describe("what the two columns cannot see", () => {
  /**
   * **`ideas` is the one artefact whose staleness is not only about the blocks.**
   *
   * `inputFingerprint` hashes the blocks *and* the tree, because that artefact
   * is written from the skeleton as much as from the paragraphs (src/ideas.ts).
   * So `blockHashInputs` alone is not enough for it, and `loadIdeas` reads the
   * tree off the revision row — which is why `ideas` has its own projection
   * rather than sharing the other three artefacts'.
   *
   * This is the case that would break silently: re-section an article without
   * changing a word of it, and a blocks-only comparison reports the ideas
   * current while the filesystem store reports them stale. The two stores then
   * disagree about `stale`, which is what tests/store-parity.test.ts exists to
   * catch — and it cannot catch this one, because it compares the stores over
   * fixtures nobody re-sections. GPT Sol asked for a tree-only case; this is it,
   * as a property rather than as a database fixture.
   */
  it("notices a tree that moved when every block stayed put", async () => {
    const { inputFingerprint } = await import("../src/ideas.js");
    const blocks = [
      { id: "spya-aaaaaa", text: "One." },
      { id: "spya-bbbbbb", text: "Two." },
    ];
    /* A tree is `{ rootId, nodes }` — a flat map, not nesting; `structureHash`
       walks `nodes` (src/source-hash.ts). Same two blocks, cut one way and then
       two ways. */
    const tree = (nodes: Record<string, unknown>) =>
      ({ version: "1", generator: "t", slug: "s", rootId: "n0", nodes }) as never;
    const whole = tree({
      n0: { id: "n0", range: ["spya-aaaaaa", "spya-bbbbbb"], title: "All" },
    });
    const split = tree({
      n0: { id: "n0", range: ["spya-aaaaaa", "spya-bbbbbb"], title: "All" },
      n1: { id: "n1", parent: "n0", range: ["spya-aaaaaa", "spya-aaaaaa"], title: "First" },
      n2: { id: "n2", parent: "n0", range: ["spya-bbbbbb", "spya-bbbbbb"], title: "Second" },
    });

    /* One set of blocks, two cuts. The fingerprints must differ even though
       `hashBlocks` is given the identical array both times — which is exactly
       what a blocks-only comparison cannot see, and why `ideas` reads the tree.

       (An earlier line here asserted `hashBlocks(blocks) === hashBlocks(blocks)`
       to make that point, which proves nothing at all — GPT Sol's fifth
       tautology, and the last of one per review round.) */
    const meta = { title: "All", byline: "Somebody", siteName: "Somewhere" };
    expect(inputFingerprint(blocks, whole, meta)).not.toEqual(
      inputFingerprint(blocks, split, meta),
    );
  });
});
