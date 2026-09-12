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
import { and, eq, getTableName, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import * as schema from "../src/db/schema.js";
import {
  aiCalls,
  articleRevisions,
  articleVisibilityChanges,
  articles,
  blockIdentities,
  chatThreads,
  checkpoints,
  citationFinds,
  comments,
  glossaryLookups,
  ingestEvents,
  linkSummaries,
  realtimeSessions,
  refereeClaims,
  refereeCriteria,
  revisionBlocks,
  searchRuns,
} from "../src/db/schema.js";
import { mintId } from "../src/ids.js";
import { currentOwnerId } from "../src/owner.js";
import { MAX_PURPOSE_CHARS } from "../src/profile.js";
import { MAX_TITLE_CHARS } from "../src/shelf.js";
import { deriveLibraryScalars } from "../src/library-scalars.js";
import { pgArticleReader } from "../src/store/pg.js";
import { PgTable, QueryBuilder, getTableConfig } from "drizzle-orm/pg-core";

import { lockedArticleForDestroyQuery, pgLibrarySearch, pgShelfStore } from "../src/store/pg-shelf.js";
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
await pgReady({
  suite: "tests/store-shelf-pg.test.ts",
  columns: [{ table: "spideryarn.revision_blocks", column: "fts" }],
});

describe("the Postgres shelf and library search", () => {
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

  describe("what the reading view knows about sharing", () => {
    /**
     * **The other projection of the same column, and the one the masthead's
     * sharing mark reads.**
     *
     * A test of its own rather than a line in the shelf's, because it is a
     * different projection with a different rule: the shelf omits the field on
     * a private article (there is no private badge to draw), and
     * `loadArticle` states it, because the mark has three states and drawing a
     * lock is the whole point of the second one. A `loadArticle` that dropped
     * the field would leave every article looking like the filesystem
     * store's — *we could not say* — and the mark would simply never appear.
     *
     * This is also the positive half of the exemption in
     * tests/store-parity.test.ts, which cannot compare a field only one of the
     * two stores can answer.
     * docs/plans/260904b-sharing-mark-on-the-article-masthead.md.
     */
    it("states `public` and `private` on the article payload, never omits either", async () => {
      const db = getDb();
      /* Put back in the `finally`, for the reason the shelf's test above gives:
         a fixture left world-readable is a lie sitting in the local database. */
      await db
        .update(articles)
        .set({ visibility: "public", publicAt: new Date("2026-09-01T00:00:00.000Z") })
        .where(eq(articles.id, OTHER_ARTICLE_ID));
      try {
        expect((await pgArticleReader.loadArticle(OTHER_SLUG)).visibility).toBe("public");
      } finally {
        await db
          .update(articles)
          .set({ visibility: "private", publicAt: null })
          .where(eq(articles.id, OTHER_ARTICLE_ID));
      }

      /* **Stated, not absent** — `"visibility" in article` rather than a
         `toBe("private")` alone, because those are the two ways this can be
         wrong and only one of them is a wrong *value*. The other is the key
         going missing, which reads on the wire as the filesystem store's
         honest silence and would draw nothing at all. */
      const back = await pgArticleReader.loadArticle(OTHER_SLUG);
      expect("visibility" in back).toBe(true);
      expect(back.visibility).toBe("private");
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

    /* ---- ported from tests/shelf.test.ts, 2026-09-05 ----------------------
       `patchShelf` on the filesystem side held the title cap, the three
       blank-clears-it rules and every claim about `purpose`, and every one of
       them was reaching Postgres through nothing at all: `pg-shelf.ts` re-states
       the cap and re-runs `normaliseProfileText`, and no case here drove either.
       They are the reader-facing refusals — a purpose silently truncated is one
       the reader believes they gave — so they move rather than going.
       docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
       the stage-G section. */

    it("refuses a title longer than the cap, and changes nothing", async () => {
      // Refused, never truncated. And the refusal must leave the stored one
      // alone, which is the half a `rejects.toThrow` on its own does not say.
      await pgShelfStore.patch(SLUG, { title: "Keep me" });
      await expect(
        pgShelfStore.patch(SLUG, { title: "x".repeat(MAX_TITLE_CHARS + 1) }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await pgShelfStore.read(SLUG)).title).toBe("Keep me");
      await pgShelfStore.patch(SLUG, { title: null });
    });

    it("clears the title on a blank string, not only on null", async () => {
      // A reader empties a box by selecting all and typing nothing, so "   "
      // has to mean the same as `null`. `pg-shelf.ts` spells that `title || null`
      // after a trim; without the trim it would store three spaces as a title.
      await pgShelfStore.patch(SLUG, { title: "  My own name  " });
      expect((await pgShelfStore.read(SLUG)).title).toBe("My own name");
      await pgShelfStore.patch(SLUG, { title: "   " });
      expect((await pgShelfStore.read(SLUG)).title).toBeUndefined();
    });

    it("stores a purpose, and clears it on blank", async () => {
      // Same three rules as the title: absent leaves it, blank clears it,
      // `null` clears it.
      await pgShelfStore.patch(SLUG, { purpose: "  the evidence  " });
      expect((await pgShelfStore.read(SLUG)).purpose).toBe("the evidence");
      await pgShelfStore.patch(SLUG, { purpose: "   " });
      expect((await pgShelfStore.read(SLUG)).purpose).toBeUndefined();
      await pgShelfStore.patch(SLUG, { purpose: "again" });
      expect((await pgShelfStore.read(SLUG)).purpose).toBe("again");
      await pgShelfStore.patch(SLUG, { purpose: null });
      expect((await pgShelfStore.read(SLUG)).purpose).toBeUndefined();
    });

    it("settles a pasted purpose's line endings before storing it", async () => {
      /* Not cosmetic. This string is hashed onto every artefact generated from
         it, and a `\r\n` from a paste would make the same purpose compare as a
         different one — marking every glossary on the shelf "you changed your
         profile" for a change nobody made. `normaliseProfileText`, not `trim()`
         — src/profile.ts. */
      await pgShelfStore.patch(SLUG, { purpose: "one\r\ntwo" });
      expect((await pgShelfStore.read(SLUG)).purpose).toBe("one\ntwo");
      await pgShelfStore.patch(SLUG, { purpose: null });
    });

    it("refuses a purpose longer than the cap, rather than shortening it", async () => {
      await expect(
        pgShelfStore.patch(SLUG, { purpose: "x".repeat(MAX_PURPOSE_CHARS + 1) }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await pgShelfStore.read(SLUG)).purpose).toBeUndefined();
    });

    it("leaves the purpose alone when the patch does not mention it", async () => {
      // `patch` builds its `SET` from the keys it was given, so an absent key
      // must not become a `null`. Archiving is what a reader does next.
      await pgShelfStore.patch(SLUG, { purpose: "the evidence" });
      await pgShelfStore.patch(SLUG, { archived: true });
      expect((await pgShelfStore.read(SLUG)).purpose).toBe("the evidence");
      await pgShelfStore.patch(SLUG, { archived: false, purpose: null });
    });

    it("remembers when the last open was, not only how many there were", async () => {
      // The tooltip says "opened 6 times, last on Tuesday". The count below is
      // computed by Postgres; this is the other half of the same write.
      const before = new Date();
      await pgShelfStore.recordOpen(SLUG);
      const after = (await pgShelfStore.read(SLUG)).lastOpenedAt;
      expect(after).toBeTruthy();
      expect(new Date(after as string).getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);
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

/* --------------------------------------------- destroying one, for good -- */

/**
 * **The owner-can-delete positive control**, and it is here rather than in
 * tests/owner-isolation.test.ts on purpose.
 *
 * That file's whole fixture is one article, shared by every case in its
 * describe. A positive control for `destroy` there would consume it, and the
 * eight tests after it would fail for a reason that has nothing to do with
 * ownership. So the refusal lives there — a stranger gets 404 and the row is
 * still there — and the other half, that the owner really can, lives here with
 * a fixture of its own that nothing else reads.
 *
 * Its own `describe` and its own article for the same reason: the suite above
 * builds one article and asserts against it thirty times.
 *
 * **What it is actually pinning is the cascade.** `articles_current_revision_fk`
 * is `NO ACTION` and not deferrable, so an article with a *published* revision
 * and a non-null `current_revision_id` is the shape that could refuse the
 * delete — and it is the shape every real article is in. The Stage A spike
 * measured this against a fully populated row
 * (docs/plans/260906h-delete-an-article-permanently.md § What the spike found);
 * this keeps it true.
 */
/**
 * **Every table that points straight at `articles`, read off the schema.**
 *
 * The cascade test used to name three of them and call them "every child table"
 * — GPT Sol's F22. There are fourteen, and the count is not the point: a
 * hand-written list is a list the fifteenth foreign key never joins, so the test
 * goes on passing while covering less and less of what it claims. The same
 * argument, and the same shape, as `articleScopedTables` in
 * tests/store-export-covers-tables.test.ts. docs/reusable/silent-success.md.
 *
 * **Direct keys only.** A transitive child (`revision_blocks`, which reaches
 * `articles` through `block_identities`) is covered by its parent going, and
 * walking the closure here would need a way to ask each table which article a
 * row belongs to — which is exactly what a direct `article_id` is.
 */
interface ArticleForeignKey {
  readonly name: string;
  readonly column: AnyPgColumn;
  /** `on delete set null`: the row survives, pointing at nothing. */
  readonly survives: boolean;
}

function articleForeignKeys(): ArticleForeignKey[] {
  const found: ArticleForeignKey[] = [];
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    for (const fk of getTableConfig(value).foreignKeys) {
      const reference = fk.reference();
      if (getTableName(reference.foreignTable) !== "articles") continue;
      const [column] = reference.columns;
      if (!column) continue;
      found.push({
        name: getTableName(value),
        column,
        survives: fk.onDelete === "set null",
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

describe("destroying an article", () => {
  const GONE_SLUG = "test-pg-shelf-destroyed";
  const GONE_ARTICLE = "00000000-0000-4000-8000-0000000000d6";
  const GONE_REVISION = "00000000-0000-4000-8000-0000000000d7";
  const GONE_BLOCK = "spya-pgaaqg";
  const GONE_AI_CALL = "00000000-0000-4000-8000-0000000000d8";
  const GONE_SESSION = "00000000-0000-4000-8000-0000000000d9";

  async function seed(): Promise<void> {
    const db = getDb();
    await db.insert(articles).values({
      id: GONE_ARTICLE,
      ownerId: currentOwnerId(),
      slug: GONE_SLUG,
    });
    await db.insert(articleRevisions).values({
      id: GONE_REVISION,
      articleId: GONE_ARTICLE,
      status: "published",
      title: "About to go",
      fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
      tree: {
        version: "1",
        generator: "test",
        slug: GONE_SLUG,
        rootId: "n0",
        nodes: {
          n0: {
            id: "n0",
            depth: 0,
            parent: null,
            children: [],
            range: [GONE_BLOCK, GONE_BLOCK],
            title: "Root",
            gist: "An article that is about to stop existing.",
          },
        },
      },
    });
    /* **The pointer is the point.** Without it the delete is a much easier
       statement than the one a reader will actually run, and the constraint
       this test exists for is never exercised. */
    await db
      .update(articles)
      .set({ currentRevisionId: GONE_REVISION })
      .where(eq(articles.id, GONE_ARTICLE));
    await db
      .insert(blockIdentities)
      .values({ articleId: GONE_ARTICLE, blockId: GONE_BLOCK });
    await db.insert(revisionBlocks).values({
      articleId: GONE_ARTICLE,
      revisionId: GONE_REVISION,
      blockId: GONE_BLOCK,
      ordinal: 0,
      tag: "p",
      kind: "text",
      text: "A paragraph nobody will read again.",
      words: 6,
      html: "<p>A paragraph nobody will read again.</p>",
      gistable: true,
    });
    await seedEveryChild();
  }

  /**
   * **One row in every table that carries an `article_id`**, so that the
   * cascade assertion below is about rows rather than about empty tables.
   *
   * A key in this record for each name `articleForeignKeys()` finds, and the
   * test asserts that correspondence before it asserts anything else — which is
   * the whole of F22's fix. Generic insertion is not possible (every table has
   * its own not-null columns and its own CHECKs), so the *seeding* is by hand;
   * what must never be by hand is the **list**, and the equality check is what
   * turns a new foreign key into a red test rather than into silence.
   */
  function childSeeds(): Record<string, () => Promise<unknown>> {
    const db = getDb();
    const owner = currentOwnerId();
    const now = new Date();
    return {
      ai_calls: () =>
        db.insert(aiCalls).values({
          id: GONE_AI_CALL,
          runId: "00000000-0000-4000-8000-0000000000da",
          scopeKind: "job",
          ownerId: owner,
          articleId: GONE_ARTICLE,
          /* The slug is kept when the pointer is nulled — that pair is the whole
             of why this table is `set null` rather than `cascade`. */
          articleSlug: GONE_SLUG,
          wire: "chat",
          purpose: "test",
          requestedModel: "test/model",
          startedAt: now,
          finishedAt: now,
          durationMs: 1,
          outcome: "ok",
          providerAccount: "openrouter",
          /* `ai_calls_one_cost_source`: exactly one of the two numbers, and
             `none` is the one that carries neither. */
          costSource: "none",
        }),
      article_revisions: () => Promise.resolve(),
      article_visibility_changes: () =>
        db.insert(articleVisibilityChanges).values({
          slug: GONE_SLUG,
          articleId: GONE_ARTICLE,
          actorOwnerId: owner,
          fromVisibility: "private",
          toVisibility: "public",
          rightsConfirmed: true,
        }),
      block_identities: () => Promise.resolve(),
      chat_threads: () =>
        db
          .insert(chatThreads)
          .values({ articleId: GONE_ARTICLE, id: mintId(), ownerId: owner, title: "A thread" }),
      checkpoints: () =>
        db.insert(checkpoints).values({
          articleId: GONE_ARTICLE,
          namespace: "pdf-chunk",
          key: "one",
          value: {},
        }),
      comments: () =>
        db.insert(comments).values({
          articleId: GONE_ARTICLE,
          id: mintId(),
          ownerId: owner,
          blockId: GONE_BLOCK,
          quote: "nobody will read again",
          start: 0,
          status: "none",
        }),
      glossary_lookups: () =>
        db.insert(glossaryLookups).values({
          articleId: GONE_ARTICLE,
          entryId: mintId(),
          ownerId: owner,
          answer: "a word",
          searches: 0,
          model: "test/model",
          at: now,
        }),
      citation_finds: () =>
        db.insert(citationFinds).values({
          articleId: GONE_ARTICLE,
          entryId: mintId(),
          ownerId: owner,
          url: "https://example.org/a-cited-paper",
          title: "A cited paper",
          host: "example.org",
          searches: 1,
          model: "test/model",
          foundAt: now,
        }),
      ingest_events: () =>
        db.insert(ingestEvents).values({ ownerId: owner, articleId: GONE_ARTICLE, slug: GONE_SLUG }),
      link_summaries: () =>
        db.insert(linkSummaries).values({
          ownerId: owner,
          articleId: GONE_ARTICLE,
          target: "https://example.test/linked",
          blockId: GONE_BLOCK,
          status: "ready",
          summary: "what is at the other end",
          destHash: "d",
          contextHash: "c",
          profileHash: "p",
          promptVersion: 1,
          model: "test/model",
          expiresAt: new Date(now.getTime() + 86_400_000),
        }),
      realtime_sessions: () =>
        db.insert(realtimeSessions).values({
          id: GONE_SESSION,
          ownerId: owner,
          articleId: GONE_ARTICLE,
          model: "test/model",
          issuedAt: now,
          acceptsUntil: new Date(now.getTime() + 60_000),
        }),
      referee_claims: () =>
        db
          .insert(refereeClaims)
          .values({ articleId: GONE_ARTICLE, ownerId: owner, status: "pending" }),
      referee_criteria: () =>
        db.insert(refereeCriteria).values({
          articleId: GONE_ARTICLE,
          id: mintId(),
          ownerId: owner,
          kind: "single",
          criterion: "is it any good",
          status: "pending",
        }),
      search_runs: () =>
        db.insert(searchRuns).values({
          articleId: GONE_ARTICLE,
          id: mintId(),
          ownerId: owner,
          criterion: "a phrase",
          status: "pending",
        }),
    };
  }

  async function seedEveryChild(): Promise<void> {
    /* Sequential rather than `Promise.all`: `ai_calls` references the realtime
       session, and a failure here should name one table rather than a bundle. */
    const seeds = childSeeds();
    for (const name of Object.keys(seeds).sort()) {
      if (name === "ai_calls") continue;
      await seeds[name]!();
    }
    await seeds.ai_calls!();
  }

  async function sweep(): Promise<void> {
    const db = getDb();
    /* The four `set null` rows outlive the article, so they are named rather
       than cascaded — and `ai_calls` first, because it points at the session. */
    await db.delete(aiCalls).where(eq(aiCalls.id, GONE_AI_CALL));
    await db.delete(realtimeSessions).where(eq(realtimeSessions.id, GONE_SESSION));
    await db
      .delete(articleVisibilityChanges)
      .where(eq(articleVisibilityChanges.slug, GONE_SLUG));
    await db.delete(ingestEvents).where(eq(ingestEvents.slug, GONE_SLUG));
    /* And then the one statement, which is the whole of what the Stage A spike
       measured: tidying the cascade's children by hand first is what fails. */
    await db.delete(articles).where(eq(articles.id, GONE_ARTICLE));
  }

  beforeAll(async () => {
    await sweep();
    await seed();
  });

  afterAll(async () => {
    await sweep();
    await closeDb();
  });

  /**
   * **The lock, read off the statement rather than raced for.**
   *
   * Dropping `.for("update")` leaves every other case in this file green, and
   * the barrier in tests/article-delete-pg.test.ts green too — a lock's absence
   * is only visible while a race is actually happening, and neither of those
   * arranges the one it would lose. What it would lose is the ordering between
   * this delete and `tryEnqueue`'s insert, which is the whole of GPT Sol's F4:
   * without it an enqueue can insert between the live-job check and the DELETE,
   * and the worker recreates the article the reader destroyed.
   *
   * The same assertion, for the same reason and after the same finding, as
   * tests/store-glossary-delete-pg.test.ts § *locks the article row it is about
   * to decide on*.
   */
  it("locks the article row it is about to destroy, by owner", () => {
    const q = lockedArticleForDestroyQuery(
      new QueryBuilder() as never,
      "a-slug",
      currentOwnerId(),
    ).toSQL();
    expect(q.sql).toMatch(/for update/i);
    expect(q.sql, "and by owner, never by slug alone").toMatch(
      /"slug" = \$1 and "spideryarn"\."articles"\."owner_id" = \$2/,
    );
  });

  /**
   * **The seeder and the schema agree**, and this runs first because every
   * assertion below is about rows this record put there. A foreign key with no
   * seed would make its own case vacuously green; a seed with no foreign key is
   * a table that stopped pointing at articles and nobody noticed.
   *
   * The collector's own alarm is the length check: a `getTableConfig` that
   * stopped recognising drizzle tables would return `[]`, and an empty
   * inventory passes every assertion made about its contents.
   */
  it("seeds a row for every foreign key the schema has, and no others", () => {
    const found = articleForeignKeys();
    expect(found.length, "the collector found nothing, so it is proving nothing").toBeGreaterThan(
      10,
    );
    expect(found.map((fk) => fk.name)).toEqual(Object.keys(childSeeds()).sort());
    expect(
      found.filter((fk) => fk.survives).map((fk) => fk.name),
      "the four deliberate survivors, docs/plans/260906h § What survives a delete",
    ).toEqual(["ai_calls", "article_visibility_changes", "ingest_events", "realtime_sessions"]);
  });

  it("takes the article and everything the cascade owns", async () => {
    const db = getDb();
    const keys = articleForeignKeys();

    /** How many rows this table has in total, and how many point at the article. */
    const census = async (fk: ArticleForeignKey) => {
      const count = async (where?: ReturnType<typeof eq>) => {
        const rows = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(fk.column.table)
          .where(where);
        return rows[0]!.n;
      };
      return { total: await count(), ours: await count(eq(fk.column, GONE_ARTICLE)) };
    };

    const before = new Map(await Promise.all(keys.map(async (fk) => [fk.name, await census(fk)] as const)));
    for (const fk of keys) {
      /* **The anti-vacuity half.** A table with no row of ours in it would pass
         "nothing of ours is left" without the delete doing anything at all. */
      expect(before.get(fk.name)!.ours, `${fk.name} was never seeded`).toBeGreaterThan(0);
    }

    expect(await pgShelfStore.destroy(GONE_SLUG)).toEqual({ destroyed: GONE_SLUG });

    expect(
      await db.select({ id: articles.id }).from(articles).where(eq(articles.id, GONE_ARTICLE)),
    ).toHaveLength(0);

    /* Each table asked separately, and asked *two* questions. One `count(*)`
       over a join would go green on a cascade that emptied three tables of
       fourteen — and counting only the rows that point at the article cannot
       tell a cascade from a `set null`, which is the difference this feature
       turns on. */
    for (const fk of keys) {
      const was = before.get(fk.name)!;
      const now = await census(fk);
      expect(now.ours, `${fk.name} still points at the deleted article`).toBe(0);
      if (fk.survives) {
        expect(now.total, `${fk.name} is a deliberate survivor and lost a row`).toBe(was.total);
      } else {
        expect(now.total, `${fk.name} should have lost exactly its ${was.ours} row(s)`).toBe(
          was.total - was.ours,
        );
      }
    }

    /* One transitive child by name, because the loop above only reaches the
       direct keys: `revision_blocks` hangs off `block_identities`. */
    expect(
      await db
        .select({ blockId: revisionBlocks.blockId })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.articleId, GONE_ARTICLE)),
    ).toHaveLength(0);

    /* And it is off the shelf, which is the thing the reader asked for. */
    expect((await pgArticleReader.listArticles()).map((a) => a.slug)).not.toContain(GONE_SLUG);
  });

  it("404s for an article that is not there, rather than reporting a delete", async () => {
    await expect(pgShelfStore.destroy("test-pg-no-such-article")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("404s a second time, so a repeat cannot report success", async () => {
    /* The first case already destroyed it. A `destroy` that returned
       `{ destroyed }` for a row it did not delete would make a double-press
       look like two successes — and the client is about to navigate away on
       the strength of that answer. */
    await expect(pgShelfStore.destroy(GONE_SLUG)).rejects.toMatchObject({ status: 404 });
  });
});
