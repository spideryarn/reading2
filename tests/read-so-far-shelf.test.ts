/**
 * **The shelf's how-much-read pie is the masthead's** — plan
 * docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md.
 *
 * Against the local database: the band the shelf sends for an article equals
 * the one the reading view would draw from the same reading, worked out here
 * the reading view's way (`readSoFarWords(blocks, foldedOnArrival(article))`,
 * `readLevel`, `shareRead`, `readBand`) from the owner's own `loadArticle`.
 * Then every input the cache's basis covers is moved, one at a time, and the
 * card must lose its pie until the cache is written again; and the guarded
 * write must write nothing when an input moves during the load.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, readSoFarWords } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import type { BlockId, LibraryEntry } from "../src/types.js";
import { foldedOnArrival } from "../src/web/matter-view.js";
import { readBand, readSoFarWords as countedWords, shareRead } from "../src/web/read-filter.js";
import { type ReadLevel, readLevel } from "../src/web/reading-time.js";
import { runViewingAs } from "../src/view-as-scope.js";
import { asTestOwner, TEST_OWNER } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

const SLUG = "test-read-so-far-shelf";

await pgReady({
  suite: "tests/read-so-far-shelf.test.ts",
  tables: ["spideryarn.read_so_far_words", "spideryarn.reading_time", "spideryarn.revision_blocks"],
});

const { pgArticleReader } = await import("../src/store/pg.js");
const { pgReadingTimeStore } = await import("../src/store/pg-reading-time.js");
const { readSoFarBasis } = await import("../src/store/read-so-far-basis.js");

let article: ScratchArticle;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: TEST_OWNER });
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

beforeEach(async () => {
  await getDb().execute(sql`delete from spideryarn.reading_time where article_id = ${article.articleId}`);
  await getDb().delete(readSoFarWords).where(eq(readSoFarWords.articleId, article.articleId));
});

/** Read the first `share` of the body's blocks, slowly enough that each counts as read. */
async function readTheFirst(share: number): Promise<void> {
  const body = article.blocks.filter((b) => b.treatment !== "supplement");
  const seconds: Record<string, number> = {};
  for (const b of body.slice(0, Math.round(body.length * share))) seconds[b.id] = 10 + b.words;
  await asTestOwner(() => pgReadingTimeStore.add(SLUG, seconds));
}

/** The band the reading view would draw, the reading view's way. */
async function mastheadBand(): Promise<string | undefined> {
  return asTestOwner(async () => {
    const loaded = await pgArticleReader.loadArticle(SLUG);
    const totals = await pgReadingTimeStore.read(SLUG);
    const words = countedWords(loaded.blocks, foldedOnArrival(loaded));
    const levels = new Map<BlockId, ReadLevel>();
    for (const b of loaded.blocks) levels.set(b.id, readLevel(totals[b.id] ?? 0, b.words));
    const band = readBand(shareRead(levels, words));
    return band === "none" ? undefined : band;
  });
}

async function shelfEntry(): Promise<LibraryEntry | undefined> {
  return asTestOwner(async () =>
    (await pgArticleReader.listArticles({ archived: false })).find((e) => e.slug === SLUG),
  );
}

const refresh = () => asTestOwner(() => pgReadingTimeStore.refreshShelfWords(SLUG));

describe("the shelf's band", () => {
  it("is absent until the cache is written, then the masthead's, for each share", async () => {
    for (const share of [0.2, 0.5, 0.7, 1]) {
      await getDb().execute(sql`delete from spideryarn.reading_time where article_id = ${article.articleId}`);
      await readTheFirst(share);
      if (share === 0.2) expect((await shelfEntry())?.readBand).toBeUndefined();
      await refresh();
      const expected = await mastheadBand();
      /* The first fifth can be mostly the folded front matter, so "none" is fair there. */
      if (share >= 0.5) expect(expected).toBeDefined();
      expect({ share, band: (await shelfEntry())?.readBand }).toEqual({ share, band: expected });
    }
  });

  it("is absent when little or nothing has been read", async () => {
    await readTheFirst(0);
    await refresh();
    expect(await mastheadBand()).toBeUndefined();
    expect((await shelfEntry())?.readBand).toBeUndefined();
  });

  it("writes once, then finds the row fresh", async () => {
    await readTheFirst(0.5);
    expect(await refresh()).toBe("written");
    expect(await refresh()).toBe("fresh");
  });

  it("does not show a reader's band to an administrator viewing as them", async () => {
    await readTheFirst(1);
    await refresh();
    expect((await shelfEntry())?.readBand).toBeDefined();
    const viewed = await runViewingAs(
      { actorId: TEST_OWNER, subjectId: TEST_OWNER, sessionId: "test-read-so-far-view-as" },
      () => shelfEntry(),
    );
    expect(viewed?.readBand).toBeUndefined();
  });
});

describe("the basis", () => {
  /** Each input `foldedOnArrival` reads, moved and moved back. */
  const moves: [string, () => Promise<void>, () => Promise<void>][] = [
    [
      "a rename",
      () => set(sql`update spideryarn.articles set title_override = 'A New Name For It' where id = ${article.articleId}`),
      () => set(sql`update spideryarn.articles set title_override = null where id = ${article.articleId}`),
    ],
    [
      "the revision's title",
      () => setRevision(sql`title = coalesce(title, '') || ' (changed)'`),
      () => setRevision(sql`title = nullif(left(title, length(title) - length(' (changed)')), '')`),
    ],
    [
      "the byline",
      () => setRevision(sql`byline = coalesce(byline, '') || ' and Someone Else'`),
      () => setRevision(sql`byline = nullif(left(byline, length(byline) - length(' and Someone Else')), '')`),
    ],
    [
      "the authors",
      () => setRevision(sql`authors = coalesce(authors, '[]'::jsonb) || '[{"name":"Ada Lovelace"}]'::jsonb`),
      () => setRevision(sql`authors = nullif(authors - (jsonb_array_length(authors) - 1), '[]'::jsonb)`),
    ],
    [
      "the matter",
      () => setRevision(sql`matter = coalesce(matter, '{}'::jsonb) || '{"__test":1}'::jsonb`),
      () => setRevision(sql`matter = nullif(matter - '__test', '{}'::jsonb)`),
    ],
  ];

  async function set(statement: ReturnType<typeof sql>): Promise<void> {
    await getDb().execute(statement);
  }
  async function setRevision(assignment: ReturnType<typeof sql>): Promise<void> {
    const [row] = await getDb()
      .select({ revisionId: articles.currentRevisionId })
      .from(articles)
      .where(eq(articles.id, article.articleId));
    await getDb().execute(sql`update spideryarn.article_revisions set ${assignment} where id = ${row?.revisionId}`);
  }

  it.each(moves)("moves with %s, and the card loses its pie until the next write", async (_name, move, back) => {
    await readTheFirst(1);
    await refresh();
    expect((await shelfEntry())?.readBand).toBeDefined();
    await move();
    try {
      expect((await shelfEntry())?.readBand).toBeUndefined();
      expect(await refresh()).toBe("written");
      expect((await shelfEntry())?.readBand).toBe(await mastheadBand());
    } finally {
      await back();
    }
  });

  it("is one value for one set of inputs", async () => {
    const basis = async () =>
      (
        await getDb()
          .select({ b: readSoFarBasis() })
          .from(articles)
          .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
          .where(eq(articles.id, article.articleId))
      )[0]?.b;
    const first = await basis();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(await basis()).toBe(first);
  });
});

describe("the guarded write", () => {
  it("writes nothing when an input moves during the load, with no row and with one", async () => {
    await readTheFirst(0.5);
    for (const existing of [false, true]) {
      if (existing) expect(await refresh()).toBe("written");
      const before = await getDb().select().from(readSoFarWords).where(eq(readSoFarWords.articleId, article.articleId));
      const load = pgArticleReader.loadArticle.bind(pgArticleReader);
      const spy = vi.spyOn(pgArticleReader, "loadArticle").mockImplementationOnce(async (slug) => {
        const loaded = await load(slug);
        await getDb().execute(
          sql`update spideryarn.articles set title_override = ${`Renamed mid-load ${existing}`} where id = ${article.articleId}`,
        );
        return loaded;
      });
      /* Stale on purpose for the second round, so the refresh loads at all. */
      if (existing) await getDb().update(readSoFarWords).set({ basis: "stale" }).where(eq(readSoFarWords.articleId, article.articleId));
      try {
        expect(await refresh()).toBe("raced");
      } finally {
        spy.mockRestore();
        await getDb().execute(sql`update spideryarn.articles set title_override = null where id = ${article.articleId}`);
      }
      const after = await getDb().select().from(readSoFarWords).where(eq(readSoFarWords.articleId, article.articleId));
      expect(after.map((r) => r.words)).toEqual(before.map((r) => r.words));
      if (!existing) expect(after).toEqual([]);
    }
  });

  it("writes nothing for an article that is not this reader's", async () => {
    await readTheFirst(0.5);
    await getDb().execute(sql`delete from spideryarn.read_so_far_words where article_id = ${article.articleId}`);
    /* Another owner: the slug is not theirs, so there is nothing to refresh. */
    const { runAsOwner } = await import("../src/owner.js");
    const stranger = "00000000-0000-4000-8000-00000000a5f1" as Parameters<typeof runAsOwner>[0];
    expect(await runAsOwner(stranger, () => pgReadingTimeStore.refreshShelfWords(SLUG))).toBe("fresh");
    expect(await getDb().select().from(readSoFarWords).where(eq(readSoFarWords.articleId, article.articleId))).toEqual([]);
  });
});
