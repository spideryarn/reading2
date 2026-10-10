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

import {
  publicBlocksQuery,
  publicCommentsQuery,
  publicCurrentRevisionQuery,
  publicPendingImportQuery,
  publicSearchesQuery,
  publicSourceGuessQuery,
} from "../src/store/public-reader.js";
import { publicLibraryQuery } from "../src/store/public-library.js";
import { lockedArticleQuery } from "../src/store/pg-visibility.js";
import { currentShareLinkQuery } from "../src/store/pg-share-link.js";
import { PUBLIC_ONLY, type PublicAccess } from "../src/store/public-access.js";
import type { ShareKey } from "../src/share-key.js";

/* **Every statement above the private-link section is read with no key**,
   which is what a request without `?key=` gives, and its SQL has to be what it
   was before the link existed: a key that was not sent must add nothing. The
   same statements with a key are read in their own section below. */
const articleQuery = publicCurrentRevisionQuery(new QueryBuilder() as never, "a-slug", PUBLIC_ONLY, "article").toSQL();
const headQuery = publicCurrentRevisionQuery(new QueryBuilder() as never, "a-slug", PUBLIC_ONLY, "head").toSQL();
const assetQuery = publicCurrentRevisionQuery(new QueryBuilder() as never, "a-slug", PUBLIC_ONLY, "asset").toSQL();
const article = articleQuery.sql;
const headSql = headQuery.sql;
const blocks = publicBlocksQuery(new QueryBuilder() as never, "rev-1").toSQL().sql;
const commentsQuery = publicCommentsQuery(new QueryBuilder() as never, "a-slug", PUBLIC_ONLY).toSQL();
const searchesQuery = publicSearchesQuery(new QueryBuilder() as never, "a-slug", PUBLIC_ONLY).toSQL();
const publicListing = publicLibraryQuery(new QueryBuilder() as never, 7).toSQL();

describe("the public revision read", () => {
  it("never asks for the owner's private tags in an article, head, asset, or listing read", () => {
    for (const [name, sql] of [
      ["article", articleQuery.sql],
      ["head", headQuery.sql],
      ["asset", assetQuery.sql],
      ["listing", publicListing.sql],
    ] as const) {
      expect(sql, name).not.toContain("article_tags");
    }
  });

  /* A visitor has no quiz, so nothing public may reach the owner's kept
     answers (plan 261005b). The owner's side — a stranger's slug is a 404 — is
     tests/quiz-attempts-route.test.ts. */
  it("never asks for the owner's quiz answers in any public read", () => {
    for (const [name, sql] of [
      ["article", articleQuery.sql],
      ["head", headQuery.sql],
      ["asset", assetQuery.sql],
      ["blocks", blocks],
      ["comments", commentsQuery.sql],
      ["searches", searchesQuery.sql],
      ["listing", publicListing.sql],
    ] as const) {
      expect(sql, name).not.toContain("quiz_attempts");
    }
  });

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
      /* Stage 2's head read joined this loop the day it was written, rather
         than getting its own copy of the assertion later. A new projection is
         exactly the shape that acquires an unfiltered query — it is not the
         reading view, so nobody pictures a stranger on it. */
      ["head", headQuery],
      /* The asset read joined the loop the day it was written, 2026-09-06, for
         the reason stated one line up — and it matters more here than on either
         of the others: this is the read that hands a stranger *bytes*, and it is
         asked once per picture rather than once per page, so an unfiltered
         version of it would go on serving a private article's figures after the
         page that pointed at them had stopped being served. */
      ["asset", assetQuery],
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
    expect(headSql).not.toContain("owner_id");
    expect(assetQuery.sql).not.toContain("owner_id");
  });

  /**
   * **The asset read takes the manifest and nothing else.**
   *
   * A projection of its own rather than a reuse of `article`, because a shared
   * article with eight figures asks it eight times on one page load — and the
   * article projection carries the whole tree and seven `jsonb` documents. The
   * absences *are* the projection: the day this starts selecting the tree, a
   * visitor is paying for the article again once per picture and nothing else
   * anywhere would say so.
   */
  it("asks for the manifest, and not for the article around it", () => {
    expect(assetQuery.sql).toContain('"assets"');
    for (const column of ['"tree"', '"glossary"', '"ideas"', '"quotes"', '"tweets"', '"sketch"', '"title"']) {
      expect({ column, taken: assetQuery.sql.includes(column) }).toEqual({ column, taken: false });
    }
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

  /**
   * The masthead's forbidden fields, absent from the statement rather than the map.
   *
   * **`final_url` left this list on 2026-08-30** and is asserted *present* in the
   * test below, because Greg decided a public article should show where it came
   * from. The column is selected; what a stranger receives is `publicSourceUrl`'s
   * answer, not the column — and `tests/public-dto.test.ts` § the source URL is
   * where that is held, because it is a fact about the value and this file only
   * ever reads SQL.
   */
  it("never asks for the fetch time or the extraction note", () => {
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
      '"quality"', // the PDF checker's complaints, plan 261009n
      /* `raw_bytes` was on this list until 2026-09-01, when the column was
         dropped (docs/plans/260831b-finish-the-database-move.md § *Stage 4*).
         The reference that replaced it is here in its place — a stranger has no
         business knowing which object in the bucket a paper came from. */
      "raw_source_sha256",
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
   * **The generated artefacts the public reader carries, in the same statement.**
   *
   * The point of Greg's "no new endpoints" decision is that they ride on the
   * row the article read already fetches — so what has to be true is not that
   * their columns are selected somewhere, but that they are selected **by this
   * query**, which is the one carrying `where visibility = 'public'`. A second
   * read that fetched them without the predicate would serve a private
   * article's glossary at a public URL, and every DTO test would stay green
   * because a projection only ever sees what it was handed. That is GPT Sol's
   * finding 3 on slice 1a, one slice later, and it is why this assertion is on
   * the same `articleQuery` object the predicate case above reads.
   */
  it("asks for the artefacts on the row it already filtered", () => {
    for (const column of [
      "glossary",
      "ideas",
      "quotes",
      "tweets",
      "timeline",
      "skim",
      "faq",
      "bibliography",
      "debate",
      "simple_summary",
    ]) {
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
       docs/plans/260829b-hosting-the-articles-images.md#delivery. */
    expect(article, "assets").toContain('"assets"');
    /* The predicate, restated against this same statement rather than trusted
       from the case above — the two facts are only worth anything together. */
    expect(articleQuery.sql).toMatch(/"visibility" = \$2/);
    expect(articleQuery.params).toEqual(["a-slug", "public", 1]);
  });

});

/**
 * **The head read, which is a new surface on the same row.**
 *
 * Stage 2 fills in a `<title>` and the `og:*` tags from the database before the
 * bundle loads, so a shared link previews as something. Everything above about
 * the article read applies to it — it is in the visibility loop and the
 * `owner_id` assertion — and these are the things that are true of it alone.
 * docs/plans/260827ai-public-read-only-access.md § Stage 2.
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
   * **Both reads ask for `final_url` now, and publish it under different
   * policies.** Until 2026-08-30 the article read was forbidden it, and the
   * paragraph here explained why that was not a contradiction. Greg's decision —
   * *"Public-readable articles should show their provenance-url to all
   * reader[s]"* — removed the asymmetry in the SQL and left it in the policy,
   * which is where it was always the more useful half.
   *
   * A head's copy is the *candidate* canonical and `safePublicCanonical` refuses
   * any query string, because a canonical naming the wrong page is believed. An
   * article's copy is a link a person clicks, and `publicSourceUrl` keeps the
   * query, because on many sites the query is the article. Both refuse a
   * credential.
   *
   * So this file can no longer tell the two apart — the statements agree — and
   * the distinction is asserted where the values are, in
   * `tests/public-dto.test.ts` § the source URL.
   */
  it("asks for the final URL in both reads", () => {
    expect(headSql).toContain("final_url");
    expect(article).toContain("final_url");
  });

  /**
   * **The blocks bar, as SQL rather than as a count.**
   *
   * A revision can have a tree and no blocks, which is a page React cannot
   * draw, and a head that answered 200 there would put a title on a link to a
   * blank screen. `loadArticle` clears that bar by counting the block rows it
   * already fetched; the head read fetches none, so it asks in SQL.
   * `exists` rather than `count(*)`, because the question is
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
 * Its `for update` makes the read of `processing` wait for a publication that
 * is flipping a minimal paper to full — the one writer of this row that holds
 * the article lock without the owner's billing lock. Two toggles at once are
 * queued by that billing lock, not by this clause. GPT Sol's finding 6 was
 * that deleting it left the entire suite green.
 *
 * The behavioural test is tests/public-visibility-pg.test.ts, "waits for a
 * Read this that is landing". Its neighbour, "writes one event when two
 * publishes race", passes with the clause deleted, and was credited with
 * catching it until 2026-10-05. This assertion needs no database and fires on
 * the mutation every time.
 */
/**
 * **The two reads of the owner's own work**, added on 2026-09-04 when a shared
 * link began carrying comments and then saved searches.
 *
 * These are the queries `tests/public-imports.test.ts` widened its table
 * allowlist for, and the case it made for each of them was about *this SQL*:
 * named columns, a join back to `articles`, and `publicSlug` repeated in the
 * query's own `where`. That last is the whole argument — a naked `article_id`
 * from an earlier statement is not authority — and it is only visible in the
 * statement, which is why it is asserted here rather than by reading the
 * projection object.
 *
 * **The row filters are read too.** Both queries refuse rows in SQL rather than
 * in a `map`, and a filter that has moved into a projection is a filter one
 * satisfied typechecker away from being widened. Deleting either predicate is
 * red here.
 */
describe("the public reads of the owner's own work", () => {
  it("re-asks the visibility question in each query's own where", () => {
    for (const [name, q] of [
      ["comments", commentsQuery],
      ["searches", searchesQuery],
    ] as const) {
      expect(q.sql, name).toMatch(
        /"articles"\."slug" = \$1 and "spideryarn"\."articles"\."visibility" = \$2/,
      );
      expect(q.params[0], name).toBe("a-slug");
      expect(q.params[1], name).toBe("public");
    }
  });

  /** Ownerless, exactly as the article read is. */
  it("mentions owner_id in neither", () => {
    expect(commentsQuery.sql).not.toContain("owner_id");
    expect(searchesQuery.sql).not.toContain("owner_id");
  });

  /**
   * **A referee's note and an unfinished model call, refused in the statement.**
   *
   * `criterion_id is null` is the one that would be easiest to lose: dropping
   * `criterionId` and `valence` from the DTO does not make the *body* of a peer
   * review anything other than a peer review, so the row has to go rather than
   * be projected thin. GPT Sol found it; the plan carries it as a blocking
   * finding.
   */
  it("takes only finished, non-referee comments", () => {
    expect(commentsQuery.sql).toMatch(/"criterion_id" is null/);
    expect(commentsQuery.sql).toMatch(/"status" in \('none','done'\)/);
  });

  /** And finished runs only, for the reason the comments filter gives. */
  it("takes only finished search runs", () => {
    expect(searchesQuery.sql).toMatch(/"status" = 'done'/);
  });

  /**
   * **The columns each one does not ask for.**
   *
   * Asserted as absences from the statement rather than as keys missing from a
   * projection object, because it is the `select` that decides what leaves
   * Postgres. `source_hash` is the interesting one and it is on the *other*
   * list: the searches read does fetch it, deliberately, and it stops at the
   * mapping — see the positive case below.
   */
  it("leaves the operational columns out of the select", () => {
    for (const column of ['"model"', '"error"', '"attempt_id"', '"attempt_started_at"']) {
      expect(searchesQuery.sql, column).not.toContain(column);
    }
    for (const column of ['"model"', '"error"', '"lease_expires_at"', '"thread_id"', '"valence"']) {
      expect(commentsQuery.sql, column).not.toContain(column);
    }
  });

  /**
   * **`source_hash` is fetched on purpose**, and this is the assertion that
   * says so out loud.
   *
   * It is the one column in the public surface whose presence in a `select` is
   * not a promise about the wire: `isStale` turns it into a boolean in
   * `loadArticle` and the DTO never sees it. Pinned here so that somebody
   * reading the absences above does not "tidy" it away and leave every saved
   * search reporting itself stale — a failure with no symptom except a warning
   * on every row. `tests/public-dto.test.ts` is the other half, and asserts the
   * hash does not cross.
   */
  it("does fetch the fingerprint it derives staleness from", () => {
    expect(searchesQuery.sql).toContain('"source_hash"');
  });

  /** And they really do read the prose, or every absence above proves nothing. */
  it("asks for what a reader is here for", () => {
    expect(commentsQuery.sql).toContain('"quote"');
    expect(commentsQuery.sql).toContain('"answer"');
    /* A highlight's colour, plan 261003e S11 — the select lists columns by hand. */
    expect(commentsQuery.sql).toContain('"colour"');
    expect(searchesQuery.sql).toContain('"criterion"');
    expect(searchesQuery.sql).toContain('"hits"');
  });
});

/**
 * **The guessed source of a shared upload** — plan 261002g, the seventh table
 * tests/public-imports.test.ts admits, and the same three properties the two
 * reads above are held to: `publicSlug` in its own `where`, the row filter in
 * SQL, and the columns it must not ask for absent from the statement.
 */
describe("the public read of an upload's guessed source", () => {
  const q = publicSourceGuessQuery(new QueryBuilder() as never, "a-slug", PUBLIC_ONLY).toSQL();

  it("re-asks the visibility question in its own where", () => {
    expect(q.sql).toMatch(
      /"articles"\."slug" = \$1 and "spideryarn"\."articles"\."visibility" = \$2/,
    );
    expect(q.params[0]).toBe("a-slug");
    expect(q.params[1]).toBe("public");
    expect(q.sql).not.toContain("owner_id");
  });

  it("ties the guess to the same article whose slug was made public", () => {
    expect(q.sql).toMatch(
      /inner join "spideryarn"\."articles" on "spideryarn"\."articles"\."id" = "spideryarn"\."upload_source_guesses"\."article_id"/,
    );
  });

  it("takes only a found guess", () => {
    expect(q.sql).toMatch(/"status" = 'found'/);
  });

  /* `host` above all: nothing ties the stored column to `url`, so the DTO
     derives it from the address it publishes (src/public/dto.ts §
     `publicSourceGuess`). GPT Sol, plan review P2-1. */
  it("leaves the stored host and the operational columns out of the select", () => {
    for (const column of [
      '"host"',
      '"why"',
      '"claim_token"',
      '"attempts"',
      '"searches"',
      '"model"',
      '"claimed_at"',
      '"finished_at"',
    ]) {
      expect(q.sql, column).not.toContain(column);
    }
  });

  /** And it does read the address, or every absence above proves nothing. */
  it("asks for the address and the two words that choose its card", () => {
    expect(q.sql).toContain('"url"');
    expect(q.sql).toContain('"kind"');
    expect(q.sql).toContain('"matched_by"');
  });
});

/**
 * **The same five reads, asked with a private link's key.** Plan 261005e.
 *
 * What has to be true of each, in its own statement:
 *
 *  - the `where` is *public **or** this key*, with the slug in both halves, so
 *    a public article reads with any key and a key opens only its own article;
 *  - the key is **bound**, and compared in SQL: `share_token` is never in a
 *    select list, so the secret is not fetched to be compared in JavaScript;
 *  - the row filters and the projection are what they are without a key. A key
 *    widens *which article*, and nothing about what of it crosses.
 */
describe("the public reads, asked with a private link's key", () => {
  const KEY = "AbCdEfGhIjKlMnOpQrStU_";
  const LINK: PublicAccess = { kind: "link", key: KEY as ShareKey };
  const qb = () => new QueryBuilder() as never;

  const keyed = {
    article: publicCurrentRevisionQuery(qb(), "a-slug", LINK, "article").toSQL(),
    head: publicCurrentRevisionQuery(qb(), "a-slug", LINK, "head").toSQL(),
    asset: publicCurrentRevisionQuery(qb(), "a-slug", LINK, "asset").toSQL(),
    comments: publicCommentsQuery(qb(), "a-slug", LINK).toSQL(),
    searches: publicSearchesQuery(qb(), "a-slug", LINK).toSQL(),
    guess: publicSourceGuessQuery(qb(), "a-slug", LINK).toSQL(),
  };
  const bare = {
    article: articleQuery,
    head: headQuery,
    asset: assetQuery,
    comments: commentsQuery,
    searches: searchesQuery,
    guess: publicSourceGuessQuery(qb(), "a-slug", PUBLIC_ONLY).toSQL(),
  };
  const names = Object.keys(keyed) as (keyof typeof keyed)[];

  const EITHER =
    /\(\("spideryarn"\."articles"\."slug" = \$1 and "spideryarn"\."articles"\."visibility" = \$2\) or \("spideryarn"\."articles"\."slug" = \$3 and "spideryarn"\."articles"\."share_token" = \$4\)\)/;

  it("asks for public or this key, with the slug in both halves, in every query's own where", () => {
    for (const name of names) {
      const q = keyed[name];
      expect(q.sql, name).toMatch(EITHER);
      expect(q.params.slice(0, 4), name).toEqual(["a-slug", "public", "a-slug", KEY]);
      /* In the `where`, and not somewhere a join or a select could hold it. */
      expect(q.sql.indexOf(" where "), name).toBeGreaterThan(-1);
      expect(q.sql.indexOf('"share_token"'), name).toBeGreaterThan(q.sql.indexOf(" where "));
    }
  });

  /* The key appears once, as a bound parameter, and never as text in the SQL. */
  it("binds the key rather than writing it into the statement", () => {
    for (const name of names) {
      expect(keyed[name].sql, name).not.toContain(KEY);
      expect(keyed[name].params.filter((p) => p === KEY), name).toHaveLength(1);
    }
  });

  it("never selects the token, with a key or without", () => {
    for (const name of names) {
      for (const q of [keyed[name], bare[name]]) {
        expect(q.sql.split(" from ")[0], name).not.toContain("share_token");
        expect(q.sql.match(/"share_token"/g) ?? [], name).toHaveLength(q === keyed[name] ? 1 : 0);
        expect(q.sql, name).not.toContain("share_token_at");
        expect(q.sql, name).not.toContain("owner_id");
      }
    }
  });

  /**
   * **A key changes the `where`'s first clause and nothing else.** The select
   * list, the joins, the row filters, the ordering and the limit are compared
   * whole with the keyless statement, by cutting the access clause out of both.
   */
  it("selects, joins, filters and orders exactly as it does without one", () => {
    const NO_KEY = /\("spideryarn"\."articles"\."slug" = \$1 and "spideryarn"\."articles"\."visibility" = \$2\)/;
    /* Later placeholders shift by two when two parameters are added. */
    const renumber = (sql: string) => sql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) - 2}`);
    for (const name of names) {
      const withKey = keyed[name].sql.split(EITHER);
      const without = bare[name].sql.split(NO_KEY);
      expect(withKey, name).toHaveLength(2);
      expect(without, name).toHaveLength(2);
      expect(withKey[0], name).toBe(without[0]);
      expect(renumber(withKey[1] ?? ""), name).toBe(without[1]);
      expect(keyed[name].params.slice(4), name).toEqual(bare[name].params.slice(2));
    }
  });

  it("still refuses a referee's note, an unfinished call, an unfinished run and an unfound guess", () => {
    expect(keyed.comments.sql).toMatch(/"criterion_id" is null/);
    expect(keyed.comments.sql).toMatch(/"status" in \('none','done'\)/);
    expect(keyed.searches.sql).toMatch(/"status" = 'done'/);
    expect(keyed.guess.sql).toMatch(/"status" = 'found'/);
  });

  /**
   * **Which way the visitor got in is asked in SQL**, as a yes-or-no, so the
   * notice can say *private link* without the visibility column or the token
   * crossing. It is on all three revision reads, key or no key.
   */
  it("asks whether the article is public as a boolean, on each revision read", () => {
    for (const q of [keyed.article, keyed.head, keyed.asset, articleQuery, headQuery, assetQuery]) {
      expect(q.sql).toMatch(/"spideryarn"\."articles"\."visibility" = 'public' as "is_public"/);
    }
  });
});

/**
 * **"Is an import under way here?"**, the one read that names `jobs`. Plan
 * 261005l § 2c: `loadArticle` asks it when it finds no published revision, and
 * a row back is a 409 *still being added* where it used to be a 404.
 *
 * What the statement has to say for that to be safe, each read off the SQL:
 * the same access predicate as every other public read, in its own `where`;
 * no published revision; and a pending job tied to the article by slug **and**
 * owner, since `jobs` has no article id. It is the one public statement where
 * `owner_id` appears at all, and it appears only as one column compared with
 * another.
 */
describe("the public read of an import still under way", () => {
  const KEY = "AbCdEfGhIjKlMnOpQrStU_";
  const LINK: PublicAccess = { kind: "link", key: KEY as ShareKey };
  const bare = publicPendingImportQuery(new QueryBuilder() as never, "a-slug", PUBLIC_ONLY).toSQL();
  const keyed = publicPendingImportQuery(new QueryBuilder() as never, "a-slug", LINK).toSQL();
  const A = '"spideryarn"."articles"';
  const J = '"spideryarn"."jobs"';

  it("selects a constant from articles, and nothing of the article or the job", () => {
    for (const q of [bare, keyed]) {
      expect(q.sql.startsWith(`select true as "pending" from ${A} where `), q.sql).toBe(true);
      for (const column of ["title", "url", "error", "steps", "share_token_at", "title_override"]) {
        expect(q.sql, column).not.toContain(`"${column}"`);
      }
    }
  });

  it("carries the access predicate every public read carries, first in its own where", () => {
    expect(bare.sql).toContain(` where ((${A}."slug" = $1 and ${A}."visibility" = $2) and `);
    expect(bare.params.slice(0, 2)).toEqual(["a-slug", "public"]);
    expect(keyed.sql).toContain(
      ` where (((${A}."slug" = $1 and ${A}."visibility" = $2) or (${A}."slug" = $3 and ${A}."share_token" = $4)) and `,
    );
    expect(keyed.params.slice(0, 4)).toEqual(["a-slug", "public", "a-slug", KEY]);
    /* Bound, never written into the statement, and never selected. */
    expect(keyed.sql).not.toContain(KEY);
    expect(keyed.sql.match(/"share_token"/g)).toHaveLength(1);
    expect(bare.sql).not.toContain("share_token");
  });

  it("asks only about an article with no published revision", () => {
    for (const q of [bare, keyed]) expect(q.sql).toContain(` and ${A}."current_revision_id" is null and exists (`);
  });

  it("ties the job to the article by slug and by owner, and compares the owner with nothing else", () => {
    for (const q of [bare, keyed]) {
      const inner = q.sql.slice(q.sql.indexOf("exists (")).replace(/\s+/g, " ");
      expect(inner).toContain(
        `select 1 from ${J} where ${J}."slug" = ${A}."slug" and ${J}."owner_id" = ${A}."owner_id" and (`,
      );
      /* Twice in the whole statement: the two sides of that one comparison.
         No owner is selected and none is bound. */
      expect(q.sql.match(/"owner_id"/g)).toHaveLength(2);
      expect(q.sql.split(" from ")[0]).not.toContain("owner_id");
    }
  });

  it("counts a job as pending only when queued, or running inside its lease on the database's clock", () => {
    for (const q of [bare, keyed]) {
      expect(q.sql.replace(/\s+/g, " ")).toContain(
        `and (${J}."status" = 'queued' or (${J}."status" = 'running' and ${J}."lease_expires_at" > clock_timestamp())))`,
      );
      expect(q.sql).not.toContain("now()");
    }
    /* Nothing beyond the access predicate and the limit is bound. */
    expect(bare.params).toEqual(["a-slug", "public", 1]);
    expect(keyed.params).toEqual(["a-slug", "public", "a-slug", KEY, 1]);
  });
});

/**
 * **The owner's read of their own link**, which is the one statement in the
 * app that selects the token. It names an owner, and it locks when it is about
 * to write.
 */
describe("the owner's read of a private link", () => {
  const plain = currentShareLinkQuery(new QueryBuilder() as never, "a-slug", false).toSQL();
  const locked = currentShareLinkQuery(new QueryBuilder() as never, "a-slug", true).toSQL();

  it("resolves the slug by owner, never by slug alone", () => {
    for (const q of [plain, locked]) {
      expect(q.sql).toMatch(/"slug" = \$1 and "spideryarn"\."articles"\."owner_id" = \$2/);
      expect(q.params[0]).toBe("a-slug");
      expect(q.sql).not.toContain("visibility");
    }
  });

  it("locks the row before a write, and not for a read", () => {
    expect(locked.sql).toMatch(/for update/i);
    expect(plain.sql).not.toMatch(/for update/i);
  });

  it("takes the token, its time and what the refusal needs, and no more of the row", () => {
    expect(plain.sql).toContain('"share_token"');
    expect(plain.sql).toContain('"share_token_at"');
    expect(plain.sql).toContain('"processing"');
    expect(plain.sql).not.toContain("title_override");
    expect(plain.sql).not.toContain('"purpose"');
  });
});

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
