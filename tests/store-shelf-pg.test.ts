/**
 * The Postgres shelf and the Postgres library search, exercised for real.
 *
 * ## Why this file exists
 *
 * The Postgres halves of both features were written, reviewed and documented
 * before a single one of their queries had ever been run. A cross-family review
 * put it plainly on 2026-08-26: *"Do not enable the Postgres path without
 * integration tests. Nothing currently proves migration 0004 applies or that
 * generated vectors, joins, ranking, and mutations work."* That is exactly the
 * shape this repo keeps writing postmortems about — code that reads correctly,
 * type-checks, and has never executed.
 *
 * Several of the things asserted here cannot be caught any other way:
 *
 * - a `tsvector` **generated** column is filled by Postgres, so nothing in
 *   TypeScript proves it is not empty — and an empty vector matches nothing,
 *   silently;
 * - the `'english'` configuration in `src/db/schema.ts` and the one in
 *   `src/store/pg-shelf.ts` must be the same string, and a mismatch is not a
 *   type error, it is a search box that returns nothing;
 * - the join to `current_revision_id` is what stops one paragraph appearing
 *   once per historical revision, and there is only one revision per article in
 *   a fresh import, so a reviewer reading the code cannot see it working;
 * - `coalesce(archived_at, now())` preserving the first archive date is a rule
 *   the filesystem store keeps a completely different way.
 *
 * ## Shape
 *
 * The article is built by hand rather than imported from `data/`, so the
 * assertions are about words this file put there. It is inserted under its own
 * uuid and removed afterwards, in the manner of tests/store-comments.test.ts.
 *
 * Skips loudly when there is no database, for the reason tests/db-schema.test.ts
 * explains: a skipped test protects nothing, so the run must say "skipped"
 * rather than show a green tick for having checked nothing.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import {
  articleRevisions,
  articles,
  blockIdentities,
  revisionBlocks,
} from "../src/db/schema.js";
import { currentOwnerId } from "../src/owner.js";
import { deriveLibraryScalars } from "../src/library-scalars.js";
import { pgArticleReader } from "../src/store/pg.js";
import { pgLibrarySearch, pgShelfStore } from "../src/store/pg-shelf.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "test-pg-shelf";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000d1";
const REVISION_ID = "00000000-0000-4000-8000-0000000000d2";
/** An older revision, so the `current_revision_id` join has something to exclude. */
const OLD_REVISION_ID = "00000000-0000-4000-8000-0000000000d3";

/**
 * A second article, so `excludeSlug` has something to prove.
 *
 * One article is not enough to tell the two designs apart: excluding a slug
 * *after* the cap and excluding it *inside the query* both return nothing when
 * there is nowhere else for a hit to come from. This one holds a single
 * deliberately low-ranked match, so it only shows up if the exclusion happened
 * before the limit. See LibrarySearchOptions in src/store/contracts.ts.
 */
const OTHER_SLUG = "test-pg-shelf-other";
const OTHER_ARTICLE_ID = "00000000-0000-4000-8000-0000000000d4";
const OTHER_REVISION_ID = "00000000-0000-4000-8000-0000000000d5";
/** Its one block. Kept out of `B` below, which is all one article's ids. */
const FAINT = "spya-pgaaqf";

/** A word no real article contains, so a hit cannot be a coincidence. */
const RARE = "zibbleflux";

/**
 * Fixed ids rather than `mintId()`, so a failure names the same block twice.
 *
 * They must satisfy `ID_PATTERN` — six characters after `spya-`, the first a
 * letter, and **no `1`** anywhere: it is not in the alphabet, because an id has
 * to be a valid CSS selector and legible. The database enforces that as a CHECK
 * constraint, which is how the first draft of this file found out. See
 * docs/project/block-ids.md and src/ids.ts.
 */
const B = {
  dense: "spya-pgaaqa",
  thin: "spya-pgaaqb",
  heading: "spya-pgaaqc",
  stem: "spya-pgaaqd",
  old: "spya-pgaaqe",
} as const;

/* Probes for the **fts column specifically**, not merely for the schema.
   Migration 0004 is the thing under test, and a database that is one migration
   behind would otherwise fail these with a confusing column error rather than
   saying "run npm run db:migrate". */
const { reachable } = await pgReady({
  suite: "tests/store-shelf-pg.test.ts",
  columns: [{ table: "spideryarn.revision_blocks", column: "fts" }],
});

const when = reachable ? describe : describe.skip;

when("the Postgres shelf and library search", () => {
  beforeAll(async () => {
    const db = getDb();
    await cleanUp();

    await db.insert(articles).values({
      id: ARTICLE_ID,
      ownerId: currentOwnerId(),
      slug: SLUG,
    });

    for (const [id, title] of [
      [REVISION_ID, "The Current Title"],
      [OLD_REVISION_ID, "The Old Title"],
    ] as const) {
      await db.insert(articleRevisions).values({
        id,
        articleId: ARTICLE_ID,
        status: "published",
        title,
        fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
        // A tree, because listArticles skips a revision without one.
        tree: {
          version: "1",
          generator: "test",
          slug: SLUG,
          rootId: "n0",
          nodes: {
            n0: {
              id: "n0",
              depth: 0,
              parent: null,
              children: [],
              range: [B.dense, B.stem],
              title: "Root",
              gist: "A test article about nothing.",
            },
          },
        },
      });
    }

    await db.update(articles).set({ currentRevisionId: REVISION_ID }).where(eq(articles.id, ARTICLE_ID));

    await db
      .insert(blockIdentities)
      .values(Object.values(B).map((blockId) => ({ articleId: ARTICLE_ID, blockId })));

    const block = (
      blockId: string,
      revisionId: string,
      ordinal: number,
      text: string,
      opts: { gistable?: boolean; kind?: string } = {},
    ) => ({
      articleId: ARTICLE_ID,
      revisionId,
      blockId,
      ordinal,
      tag: "p",
      kind: opts.kind ?? "text",
      text,
      words: text.split(/\s+/).length,
      html: `<p>${text}</p>`,
      gistable: opts.gistable ?? true,
    });

    await db.insert(revisionBlocks).values([
      block(B.dense, REVISION_ID, 0, `${RARE} ${RARE} ${RARE} indeed.`),
      block(
        B.thin,
        REVISION_ID,
        1,
        `${RARE} ${"and a good many other words besides ".repeat(20)}`,
      ),
      block(B.heading, REVISION_ID, 2, `${RARE} as a heading`, { gistable: false, kind: "heading" }),
      block(B.stem, REVISION_ID, 3, "She was writing about writers who write."),
      // Attached to the OLD revision, so it must never be found.
      block(B.old, OLD_REVISION_ID, 0, `${RARE} in an older draft.`),
    ]);

    /* The second article. One mention in a very long paragraph, so length
       normalisation puts it below both of the first article's matches — which
       is what makes `excludeSlug` testable: at a limit of two it is invisible
       unless the exclusion happened inside the query. */
    await db.insert(articles).values({
      id: OTHER_ARTICLE_ID,
      ownerId: currentOwnerId(),
      slug: OTHER_SLUG,
    });
    await db.insert(articleRevisions).values({
      id: OTHER_REVISION_ID,
      articleId: OTHER_ARTICLE_ID,
      status: "published",
      title: "Something Else Entirely",
      fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
      tree: {
        version: "1",
        generator: "test",
        slug: OTHER_SLUG,
        rootId: "n0",
        nodes: {
          n0: {
            id: "n0",
            depth: 0,
            parent: null,
            children: [],
            range: [FAINT, FAINT],
            title: "Root",
            gist: "Another test article about nothing.",
          },
        },
      },
    });
    await db
      .update(articles)
      .set({ currentRevisionId: OTHER_REVISION_ID })
      .where(eq(articles.id, OTHER_ARTICLE_ID));
    await db.insert(blockIdentities).values({ articleId: OTHER_ARTICLE_ID, blockId: FAINT });

    const faintText = `A single ${RARE} ${"buried among a good many other words besides ".repeat(40)}`;
    await db.insert(revisionBlocks).values({
      articleId: OTHER_ARTICLE_ID,
      revisionId: OTHER_REVISION_ID,
      blockId: FAINT,
      ordinal: 0,
      tag: "p",
      kind: "text",
      text: faintText,
      words: faintText.split(/\s+/).length,
      html: `<p>${faintText}</p>`,
      gistable: true,
    });

    /**
     * **The library's scalars, derived rather than typed in.**
     *
     * A published revision always has them: `publishRevision` and the importer
     * both write them, from the blocks and tree they are publishing, in the
     * same transaction. A fixture without them describes a row no writer
     * produces — and since 2026-08-28 the shelf *reads* them, so this suite was
     * silently sending `listArticles` down its recompute-and-warn fallback on
     * every run.
     *
     * The first attempt at fixing that wrote five plausible numbers by hand,
     * and they were wrong: the article is 157 words, not 12.
     * tests/store-shelf-reads.test.ts's invariant audit went red and named this
     * fixture, which is exactly the job that audit exists for. So they come
     * from `deriveLibraryScalars` over the rows that were just written.
     */
    for (const revisionId of [REVISION_ID, OLD_REVISION_ID, OTHER_REVISION_ID]) {
      const blocks = await db
        .select({ words: revisionBlocks.words })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, revisionId));
      const [revision] = await db
        .select({ tree: articleRevisions.tree, excerpt: articleRevisions.excerpt })
        .from(articleRevisions)
        .where(eq(articleRevisions.id, revisionId));
      await db
        .update(articleRevisions)
        .set(
          deriveLibraryScalars({
            blocks,
            tree: (revision?.tree ?? null) as Parameters<typeof deriveLibraryScalars>[0]["tree"],
            excerpt: revision?.excerpt,
          }),
        )
        .where(eq(articleRevisions.id, revisionId));
    }
  });

  afterAll(async () => {
    await cleanUp();
    await closeDb();
  });

  async function cleanUp() {
    const db = getDb();
    for (const id of [ARTICLE_ID, OTHER_ARTICLE_ID]) {
      await db.delete(revisionBlocks).where(eq(revisionBlocks.articleId, id));
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articleRevisions).where(eq(articleRevisions.articleId, id));
      await db.delete(blockIdentities).where(eq(blockIdentities.articleId, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
  }

  const mine = async (query: string, limit = 20) =>
    (await pgLibrarySearch.searchLibrary(query, limit)).hits.filter((h) => h.slug === SLUG);

  describe("the generated tsvector", () => {
    it("is filled by Postgres, not left empty", async () => {
      /* The assertion nothing in TypeScript can make. A generated column that
         silently produced an empty vector would fail every search below with
         no error anywhere — so this checks the column itself, once, directly. */
      const db = getDb();
      const [row] = await db
        .select({ fts: sql<string>`${revisionBlocks.fts}::text` })
        .from(revisionBlocks)
        .where(and(eq(revisionBlocks.revisionId, REVISION_ID), eq(revisionBlocks.blockId, B.dense)));
      expect(row?.fts).toContain("zibbleflux");
    });

    it("updates itself when the text changes", async () => {
      const db = getDb();
      await db
        .update(revisionBlocks)
        .set({ text: "completely different words now" })
        .where(and(eq(revisionBlocks.revisionId, REVISION_ID), eq(revisionBlocks.blockId, B.stem)));
      expect(await mine("different")).toHaveLength(1);
      await db
        .update(revisionBlocks)
        .set({ text: "She was writing about writers who write." })
        .where(and(eq(revisionBlocks.revisionId, REVISION_ID), eq(revisionBlocks.blockId, B.stem)));
    });
  });

  describe("searching", () => {
    it("finds a passage, and carries the whole paragraph", async () => {
      const hits = await mine(RARE);
      expect(hits.map((h) => h.blockId)).toContain(B.dense);
      expect(hits.find((h) => h.blockId === B.dense)?.text).toContain(RARE);
    });

    it("stems, which is the whole reason for the 'english' configuration", async () => {
      // If schema.ts and pg-shelf.ts ever disagree about the configuration,
      // this is the test that notices — a mismatch is not a type error.
      expect((await mine("write")).map((h) => h.blockId)).toContain(B.stem);
      expect((await mine("writers")).map((h) => h.blockId)).toContain(B.stem);
    });

    it("understands websearch syntax rather than throwing on it", async () => {
      // `to_tsquery` would raise a syntax error on all three of these, which in
      // a search box means a 500 while somebody is still typing.
      expect(await mine(`${RARE} OR nothingatall`)).not.toHaveLength(0);
      expect(await mine(`"${RARE} indeed"`)).not.toHaveLength(0);
      await expect(mine('((( unbalanced "')).resolves.toEqual([]);
    });

    it("ranks a dense short paragraph above a long thin one", async () => {
      // Normalisation flag 1. Without it the long paragraph wins on length,
      // and the filesystem adapter — which damps for length — would disagree.
      const ids = (await mine(RARE)).map((h) => h.blockId);
      expect(ids.indexOf(B.dense)).toBeLessThan(ids.indexOf(B.thin));
    });

    it("ignores non-gistable blocks", async () => {
      expect((await mine(RARE)).map((h) => h.blockId)).not.toContain(B.heading);
    });

    it("never returns a block from a superseded revision", async () => {
      /* The `current_revision_id` join. Without it the pipeline publishing a
         new revision on every re-run would make an article outrank everything
         else by holding several copies of itself. */
      expect((await mine(RARE)).map((h) => h.blockId)).not.toContain(B.old);
    });

    it("says when it capped the list", async () => {
      const capped = await pgLibrarySearch.searchLibrary(RARE, 1);
      expect(capped.hits).toHaveLength(1);
      expect(capped.capped).toBe(true);
    });

    it("returns the same order twice for equally-ranked hits", async () => {
      const once = (await mine(RARE)).map((h) => h.blockId);
      const twice = (await mine(RARE)).map((h) => h.blockId);
      expect(once).toEqual(twice);
    });

    it("answers an empty query with nothing, rather than everything", async () => {
      expect((await pgLibrarySearch.searchLibrary("   ", 10)).hits).toEqual([]);
    });

    it("leaves an excluded article out before the cap, not after it", async () => {
      /* The order is the whole assertion, and it takes two articles to make it.
         At a limit of two, this article supplies both hits — so an exclusion
         applied to the RESULTS would hand back an empty list. Because it is a
         `ne` in the WHERE clause, the second article's faint match gets a place
         instead. tests/library-search.test.ts holds the filesystem adapter to
         the same rule; src/store/contracts.ts § LibrarySearchOptions says why. */
      const both = await pgLibrarySearch.searchLibrary(RARE, 2);
      expect(both.hits.map((h) => h.slug)).toEqual([SLUG, SLUG]);

      const without = await pgLibrarySearch.searchLibrary(RARE, 2, { excludeSlug: SLUG });
      expect(without.hits.map((h) => h.blockId)).toEqual([FAINT]);
      // And `capped` describes the list the caller got, not a longer one it was
      // never shown.
      expect(without.capped).toBe(false);
    });

    it("excludes nothing when asked for a slug that is not there", async () => {
      const { hits } = await pgLibrarySearch.searchLibrary(RARE, 20, {
        excludeSlug: "no-such-article",
      });
      expect(hits.some((h) => h.slug === SLUG)).toBe(true);
    });
  });

  describe("what the shelf knows about sharing", () => {
    /**
     * **The owner's own shelf has to be able to say which of these are out in
     * the world**, and the card can only say it if the row reaches the card.
     *
     * Asserted through `listArticles` rather than by reading the column back,
     * because the column was never in doubt: what this is about is the
     * projection between `listArticlesQuery` — which selects `articles` whole —
     * and the `LibraryEntry` the browser gets. A projection that drops the
     * field typechecks, serialises, and leaves every card looking private.
     * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster E.
     */
    it("carries `public` on a shared article and says nothing at all on a private one", async () => {
      const db = getDb();
      /* On the fixture the suite owns, and put back in the `finally` — the two
         articles here are shared by every test below, and a shelf fixture left
         world-readable would be a lie sitting in the local database. */
      await db
        .update(articles)
        .set({ visibility: "public", publicAt: new Date("2026-09-01T00:00:00.000Z") })
        .where(eq(articles.id, OTHER_ARTICLE_ID));
      try {
        const entries = await pgArticleReader.listArticles();
        const shared = entries.find((e) => e.slug === OTHER_SLUG);
        const mine_ = entries.find((e) => e.slug === SLUG);

        expect(shared?.visibility).toBe("public");

        /* **Absent, not `"private"`.** `exactOptionalPropertyTypes` makes those
           two different values and the wire makes them the same length of
           nothing, so `toBeUndefined` alone cannot tell them apart — and the
           filesystem store has no visibility column to answer with, so absence
           is the one answer both stores can give. tests/store-parity.test.ts
           compares whole entries. */
        expect(mine_).toBeDefined();
        expect(mine_ && "visibility" in mine_).toBe(false);
      } finally {
        await db
          .update(articles)
          .set({ visibility: "private", publicAt: null })
          .where(eq(articles.id, OTHER_ARTICLE_ID));
      }
    });
  });

  describe("the shelf's writes", () => {
    it("renames, and the reading view agrees with the card", async () => {
      const entry = await pgShelfStore.patch(SLUG, { title: "What I call it" });
      expect(entry.title).toBe("What I call it");
      expect(entry.titleOverridden).toBe(true);

      // The half a review found missing: the masthead reads `meta.title`.
      const article = await pgArticleReader.loadArticle(SLUG);
      expect(article.meta.title).toBe("What I call it");

      // And the search results, so one article is not listed under two names.
      expect((await mine(RARE))[0]?.title).toBe("What I call it");

      const cleared = await pgShelfStore.patch(SLUG, { title: null });
      expect(cleared.title).toBe("The Current Title");
      expect(cleared.titleOverridden).toBeUndefined();
    });

    it("applies both fields in one write", async () => {
      const entry = await pgShelfStore.patch(SLUG, { title: "Both", archived: true });
      expect(entry.title).toBe("Both");
      expect(entry.archivedAt).toBeTruthy();
      await pgShelfStore.patch(SLUG, { title: null, archived: false });
    });

    it("keeps the first archive date when archived twice", async () => {
      const first = await pgShelfStore.patch(SLUG, { archived: true });
      const second = await pgShelfStore.patch(SLUG, { archived: true });
      expect(second.archivedAt).toBe(first.archivedAt);
      await pgShelfStore.patch(SLUG, { archived: false });
    });

    it("tells the metadata page whether this one is deleted", async () => {
      /* The filesystem half of this is in tests/shelf.test.ts, and the pair is
         the point: `ArticleMetadata.archivedAt` is what the metadata page's
         Delete button reads, and a store that forgot to answer it would show
         Delete over an already-deleted article — a claim about the reader's
         library that nothing established. One store answering and the other
         not is exactly the divergence a parity test cannot see, because both
         answers typecheck. */
      expect((await pgArticleReader.articleMetadata(SLUG)).archivedAt).toBe(null);

      const archived = await pgShelfStore.patch(SLUG, { archived: true });
      expect((await pgArticleReader.articleMetadata(SLUG)).archivedAt).toBe(archived.archivedAt);

      await pgShelfStore.patch(SLUG, { archived: false });
      expect((await pgArticleReader.articleMetadata(SLUG)).archivedAt).toBe(null);
    });

    it("moves the article between the two halves of the shelf", async () => {
      const on = await pgArticleReader.listArticles();
      expect(on.some((a) => a.slug === SLUG)).toBe(true);

      await pgShelfStore.patch(SLUG, { archived: true });
      expect((await pgArticleReader.listArticles()).some((a) => a.slug === SLUG)).toBe(false);
      expect(
        (await pgArticleReader.listArticles({ archived: true })).some((a) => a.slug === SLUG),
      ).toBe(true);
      // Out of the index entirely, not merely filtered from the results.
      expect(await mine(RARE)).toEqual([]);

      await pgShelfStore.patch(SLUG, { archived: false });
      expect((await pgArticleReader.listArticles()).some((a) => a.slug === SLUG)).toBe(true);
    });

    it("counts concurrent opens without losing any", async () => {
      /* `opens + 1` is computed by Postgres. A read-then-write from TypeScript
         would have ten tabs all read 0 and all write 1, with every write
         reporting success — the exact failure src/store/pg-shelf.ts describes. */
      const before = (await pgShelfStore.read(SLUG)).opens;
      await Promise.all(Array.from({ length: 10 }, () => pgShelfStore.recordOpen(SLUG)));
      expect((await pgShelfStore.read(SLUG)).opens).toBe(before + 10);
    });

    it("404s for an article that is not there, rather than a 500", async () => {
      // routes.ts turns a tagged 404 into a 404 and an untagged throw into a
      // 500, so "no such article" reporting as a server fault is a real risk.
      await expect(pgShelfStore.recordOpen("test-pg-no-such-article")).rejects.toMatchObject({
        status: 404,
      });
      await expect(pgShelfStore.patch("test-pg-no-such-article", { archived: true })).rejects.toMatchObject({
        status: 404,
      });
    });

    it("refuses a slug that is not a slug with a 400", async () => {
      await expect(pgShelfStore.recordOpen("../../etc")).rejects.toMatchObject({ status: 400 });
    });
  });
});
