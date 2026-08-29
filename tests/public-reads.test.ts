/**
 * **What the public reads ask Postgres for**, read off the generated SQL.
 *
 * A projection can be perfectly correct while the query that uses it says
 * `.select()`, and a DTO can drop a field the query dragged across the wire
 * anyway. Both were on GPT Sol's list of checks that go green over broken
 * behaviour, and the one place either fact is visible is the statement Drizzle
 * generates — so that is what is asserted, through `QueryBuilder`, which builds
 * SQL with no connection and so needs no database.
 *
 * The clause this whole feature rests on is one line, and Drizzle binds both
 * halves of it rather than inlining either:
 *
 *     where "slug" = $1 and "visibility" = $2      params: ["a-slug", "public"]
 *
 * `tests/public-dto.test.ts` proves the shape of what comes out.
 * `tests/public-visibility-pg.test.ts` proves the behaviour against real rows.
 * This is the middle: what was asked for.
 */

import { QueryBuilder } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { publicBlocksQuery, publicCurrentRevisionQuery } from "../src/store/public-reader.js";
import { lockedArticleQuery } from "../src/store/pg-visibility.js";

const articleQuery = publicCurrentRevisionQuery(new QueryBuilder() as never, "a-slug", "article").toSQL();
const metadataQuery = publicCurrentRevisionQuery(new QueryBuilder() as never, "a-slug", "metadata").toSQL();
const headQuery = publicCurrentRevisionQuery(new QueryBuilder() as never, "a-slug", "head").toSQL();
const article = articleQuery.sql;
const metadata = metadataQuery.sql;
const headSql = headQuery.sql;
const blocks = publicBlocksQuery(new QueryBuilder() as never, "rev-1").toSQL().sql;

describe("the public revision read", () => {
  /**
   * **The predicate, in the statement.** `publicSlug` being right is one thing;
   * the query using it is another, and this is the only place they meet.
   */
  it("filters on visibility, in SQL, in the where", () => {
    /* **The parameters as well as the statement.** Drizzle binds the value
       rather than inlining it, so `visibility = 'public'` never appears in the
       SQL and a test asserting that string would be asserting a spelling
       Drizzle does not use — green only because the whole clause was gone. The
       clause and the value it is compared with are two halves of one fact, so
       both are read. */
    for (const [name, q] of [
      ["article", articleQuery],
      ["metadata", metadataQuery],
      /* Stage 2's head read joined this loop the day it was written, rather
         than getting its own copy of the assertion later. A new projection is
         exactly the shape that acquires an unfiltered query — it is not the
         reading view, so nobody pictures a stranger on it. */
      ["head", headQuery],
    ] as const) {
      expect(q.sql, name).toMatch(/"articles"\."slug" = \$1 and "spideryarn"\."articles"\."visibility" = \$2/);
      expect(q.params, name).toEqual(["a-slug", "public", 1]);
    }
  });

  /**
   * **And it does not filter on owner**, which is what makes it ownerless rather
   * than merely differently owned. A public query with an owner clause would be
   * a public query that only the owner can use, and it would look like it worked
   * for as long as the owner was the one testing it.
   */
  it("does not mention owner_id at all", () => {
    expect(article).not.toContain("owner_id");
    expect(metadata).not.toContain("owner_id");
    expect(headSql).not.toContain("owner_id");
  });

  /**
   * **`articles` is joined but never selected wholesale.** The danger Sol named
   * is a public query that one day does `select({ article: articles })` and picks
   * up `owner_id`, `title_override` and `purpose` in one careless line.
   */
  it("takes one column off the articles table, and it is the slug", () => {
    expect(article).not.toContain("title_override");
    expect(article).not.toContain('"purpose"');
    expect(article).toContain('"articles"."slug"');
  });

  /** The masthead's forbidden fields, absent from the statement rather than the map. */
  it("never asks for the final URL, the fetch time or the extraction note", () => {
    expect(article).not.toContain("final_url");
    expect(article).not.toContain("fetched_at");
    expect(article).not.toContain('"note"');
  });

  /** The PDF and upload provenance — somebody's file, not a public web page. */
  it("never asks for the PDF provenance", () => {
    for (const column of [
      "raw_sha256",
      "extract_method",
      '"pages"',
      '"unverified"',
      '"recall"',
      "pages_checked",
      "raw_bytes",
      "raw_filename",
    ]) {
      expect(article, column).not.toContain(column);
    }
  });

  /** And it does ask for the article, or every line above passes on nothing. */
  it("still asks for the tree and the title, which is what a reader is here for", () => {
    expect(article).toContain('"tree"');
    expect(article).toContain('"title"');
    expect(article).toContain('"arc"');
  });

  /**
   * **The four artefacts slice 1b carries, in the same statement.**
   *
   * The point of Greg's "no new endpoints" decision is that they ride on the
   * row the article read already fetches — so what has to be true is not that
   * four columns are selected somewhere, but that they are selected **by this
   * query**, which is the one carrying `where visibility = 'public'`. A second
   * read that fetched them without the predicate would serve a private
   * article's glossary at a public URL, and every DTO test would stay green
   * because a projection only ever sees what it was handed. That is GPT Sol's
   * finding 3 on slice 1a, one slice later, and it is why this assertion is on
   * the same `articleQuery` object the predicate case above reads.
   */
  it("asks for the four artefacts on the row it already filtered", () => {
    for (const column of ["glossary", "summary", "ideas", "tweets"]) {
      expect(article, column).toContain(`"${column}"`);
    }
    /* **And the image manifest, on this same statement.** It is the half of
       hosting an article's images that is easiest to leave out and hardest to
       notice missing: a signed-out reader can never reach an authenticated
       route, so an owner-only projection would leave every shared article
       hot-linking to the publisher — the privacy leak the whole feature exists
       to close — while looking finished from the owner's chair. Nothing
       downstream throws; the pictures just carry on coming from Noema's CDN.
       Dropping `assets` from `PUBLIC_PROJECTIONS` is a typecheck error, and
       this is the assertion that says the *query* carries it.
       docs/plans/hosting-the-articles-images.md#delivery. */
    expect(article, "assets").toContain('"assets"');
    /* The predicate, restated against this same statement rather than trusted
       from the case above — the two facts are only worth anything together. */
    expect(articleQuery.sql).toMatch(/"visibility" = \$2/);
    expect(articleQuery.params).toEqual(["a-slug", "public", 1]);
  });

  /**
   * The metadata read asks whether an artefact exists, in SQL — not by dragging
   * the JSONB document across the wire to compare it with null. That mistake
   * was two days of docs/plans/library-read-latency.md on the owner's shelf.
   */
  it("asks the metadata question as five is-not-nulls rather than five documents", () => {
    for (const column of ["tree", "arc", "tweets", "glossary", "summary", "ideas"]) {
      expect(metadata, column).toMatch(new RegExp(`"${column}" is not null`));
    }
    /* And the documents themselves are not selected — the `is not null` above is
       the only place these column names appear. */
    expect(metadata.match(/"glossary"/g)).toHaveLength(1);
  });
});

/**
 * **The head read, which is a new surface on the same row.**
 *
 * Stage 2 fills in a `<title>` and the `og:*` tags from the database before the
 * bundle loads, so a shared link previews as something. Everything above about
 * the article read applies to it — it is in the visibility loop and the
 * `owner_id` assertion — and these are the things that are true of it alone.
 * docs/plans/public-read-only-access.md § Stage 2.
 */
describe("the public head read", () => {
  /**
   * **It asks for the six values and nothing that renders.**
   *
   * The line the design draws is that the function fills in a head and serves
   * the same bundle; the moment it produces body HTML we own two reading views.
   * The cheapest place to hold that is the `select`: it cannot render a body
   * from a projection the blocks are not in.
   */
  it("takes what a head needs, and nothing a renderer would want", () => {
    expect(headSql).toContain("root_gist");
    expect(headSql).toContain("final_url");
    expect(headSql).toContain("heading_title");
    /**
     * **A selected column, not a mentioned one**, and the difference is why the
     * first version of this assertion could not fail.
     *
     * It looked for `"tree" as`, on the assumption that a selected column is
     * aliased. Drizzle does not alias a plain column, so the needle appeared
     * nowhere and the test passed with `tree: articleRevisions.tree` added to
     * the projection — the exact mutation it existed to catch.
     *
     * `"tree"` is also genuinely *present* in this statement, inside
     * `"…"."tree" is not null as "has_tree"`, so a bare `not.toContain('"tree"')`
     * would fail on correct code. What separates the two is the punctuation
     * after the column: a select-list item is followed by `,` or by ` from`,
     * and a column inside an expression is followed by ` is not null`.
     */
    for (const doc of ["tree", "arc", "glossary", "summary", "ideas", "tweets"]) {
      const selected = `"spideryarn"."article_revisions"."${doc}"`;
      expect(headSql, doc).not.toContain(`${selected},`);
      expect(headSql, doc).not.toContain(`${selected} from`);
    }
    /* And the control on the control: the article read *does* select them, so
       the needle above is one that can be found. Without this the loop passes
       on a typo in the table name. */
    expect(article).toContain(`"spideryarn"."article_revisions"."tree",`);
  });

  /**
   * **`final_url` is here and is forbidden in the article read**, three tests
   * above. That is not a contradiction and the difference is worth stating
   * where somebody will hit it.
   *
   * There it is the masthead's provenance and a visitor has no business with
   * it. Here it never reaches a browser as data: it is the *candidate*
   * canonical, and `safePublicCanonical` decides whether any tag is published —
   * refusing outright on a query string, a credential, or a non-web scheme.
   * The column crossing into a server-side head is a different act from the
   * column crossing into a payload.
   */
  it("asks for the final URL, which the article read must not", () => {
    expect(headSql).toContain("final_url");
    expect(article).not.toContain("final_url");
  });

  /**
   * **The blocks bar, as SQL rather than as a count.**
   *
   * `loadArticle` refuses a tree with no blocks and `loadMetadata` only checks
   * the tree, so a revision can pass the metadata bar and be a page React
   * cannot draw. A head that answered 200 there would put a title on a link to
   * a blank screen. `exists` rather than `count(*)`, because the question is
   * whether there is at least one and counting a long article to learn that is
   * work nobody asked for.
   */
  it("asks whether any block exists, without counting them", () => {
    expect(headSql).toMatch(/exists \(\s*select 1 from "spideryarn"\."revision_blocks"/);
    expect(headSql).toContain("has_blocks");
    expect(headSql).not.toMatch(/count\(/i);
  });

  /** And the two bars are separate questions, so both are in the statement. */
  it("asks about the tree as well", () => {
    expect(headSql).toContain("has_tree");
  });
});

describe("the public blocks read", () => {
  /**
   * **`note` is never fetched**, rather than fetched and projected away. Sol's
   * wording: *"projecting it away after selecting it is weaker than never
   * fetching it."* A projection is one careless spread from being widened; a
   * column that was never in the `select` has to be put back on purpose.
   */
  it("does not ask for a block's note", () => {
    expect(blocks).not.toContain('"note"');
  });

  /** `fts` is a stored tsvector, roughly half the size of the text it indexes. */
  it("does not ask for the search vector", () => {
    expect(blocks).not.toContain('"fts"');
  });

  /** Block ids are random and carry no position, so document order is the `order by`. */
  it("orders by ordinal", () => {
    expect(blocks).toMatch(/order by "spideryarn"\."revision_blocks"\."ordinal" asc/i);
  });

  /**
   * **And it asks for ONE revision's blocks**, which nothing else here checked.
   *
   * GPT Sol's finding 3, second half: the block cases assert selected columns
   * and ordering, and both stay green with the `where` deleted — at which point
   * every public article is served the concatenated blocks of every revision of
   * every article in the database, in ordinal order, which would look like a
   * rendering bug rather than the disclosure it is.
   *
   * The parameter as well as the clause, for the reason the revision read gives:
   * Drizzle binds rather than inlines, so a test asserting the value as a
   * literal would be asserting a spelling Drizzle does not use.
   */
  it("asks for one revision's blocks, and says which", () => {
    const q = publicBlocksQuery(new QueryBuilder() as never, "rev-1").toSQL();
    expect(q.sql).toMatch(/where "spideryarn"\."revision_blocks"\."revision_id" = \$1/);
    expect(q.params).toEqual(["rev-1"]);
  });

  /** And it does fetch the prose, or the three lines above prove nothing. */
  it("asks for the html and the text", () => {
    expect(blocks).toContain('"html"');
    expect(blocks).toContain('"text"');
    expect(blocks).toContain('"block_id"');
  });
});

/**
 * **The switch's own read, which is the one query in this feature that writes.**
 *
 * Its `for update` is the whole of the concurrency argument: without it two
 * toggles both read the old value, both write, and both append an event. GPT
 * Sol's finding 6 was that deleting it left the entire suite green.
 *
 * There is a behavioural test for it too (tests/public-visibility-pg.test.ts,
 * "writes one event when two publishes race"), and this one exists because that
 * one can only catch the bug while the window is open — measured on this laptop,
 * two `PUT`s fired together usually do not overlap at all, and the race test
 * passed against the unlocked code until it was rewritten to hold the row from
 * outside. A timing test that has to be lucky is not the only evidence this
 * should rest on.
 */
describe("the visibility switch's locked read", () => {
  const q = lockedArticleQuery(new QueryBuilder() as never, "a-slug").toSQL();

  it("locks the row it is about to change", () => {
    expect(q.sql).toMatch(/for update/i);
  });

  it("and still resolves the slug by owner, never by slug alone", () => {
    expect(q.sql).toMatch(/"slug" = \$1 and "spideryarn"\."articles"\."owner_id" = \$2/);
    expect(q.params[0]).toBe("a-slug");
  });

  /** It reads four columns to make one decision, and no more of the row than that. */
  it("takes only what the decision needs", () => {
    expect(q.sql).not.toContain("title_override");
    expect(q.sql).not.toContain('"purpose"');
  });
});
