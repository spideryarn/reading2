/**
 * The reader's own tags, against a real Postgres — plan
 * docs/plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md.
 *
 * What only a database can show: that the cap holds when two edits race (the
 * row lock is the whole argument, and its absence is invisible to a serial
 * test), that a stranger's article answers 404 rather than taking the tag, and
 * that the CHECK refuses what `normaliseTag` refuses for a writer that skipped
 * it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { articleTags, articles } from "../src/db/schema.js";
import { currentOwnerId, EVAL_OWNER_ID } from "../src/owner.js";
import { pgTagStore } from "../src/store/pg-tags.js";
import { TAGS_PER_ARTICLE, TAGS_PER_EDIT } from "../src/tags.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const SLUG = "test-pg-tags";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000071a0";
/** Somebody else's article: the reader must neither tag it nor see its tags. */
const STRANGER_SLUG = "test-pg-tags-stranger";
const STRANGER_ID = "00000000-0000-4000-8000-0000000071a1";

await pgReady({ suite: "tests/store-tags-pg.test.ts", tables: ["spideryarn.article_tags"] });

const status = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (err: { status?: number }) => err.status ?? "no status",
  );

describe("the reader's own tags", () => {
  beforeAll(async () => {
    const db = getDb();
    await cleanUp();
    /* A stranger distinct from whoever this run is, whichever that is. */
    expect(currentOwnerId()).not.toBe(EVAL_OWNER_ID);
    await db.insert(articles).values([
      { id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG },
      { id: STRANGER_ID, ownerId: EVAL_OWNER_ID, slug: STRANGER_SLUG },
    ]);
    await db.insert(articleTags).values({ articleId: STRANGER_ID, tag: "their secret" });
  });

  afterAll(async () => {
    await cleanUp();
    await closeDb();
  });

  async function cleanUp() {
    const db = getDb();
    /* `article_tags` cascades with the article. */
    for (const id of [ARTICLE_ID, STRANGER_ID]) await db.delete(articles).where(eq(articles.id, id));
  }

  async function clearMine() {
    await getDb().delete(articleTags).where(eq(articleTags.articleId, ARTICLE_ID));
  }

  it("adds, lowercases, sorts, and adding again changes nothing", async () => {
    await clearMine();
    expect(await pgTagStore.edit(SLUG, { add: ["Neuro", "  AI  "] })).toEqual(["ai", "neuro"]);
    expect(await pgTagStore.edit(SLUG, { add: ["ai", "AI"] })).toEqual(["ai", "neuro"]);
    expect(await pgTagStore.tagsFor(SLUG)).toEqual(["ai", "neuro"]);
  });

  it("removes, and removing a tag it does not have is not an error", async () => {
    await clearMine();
    await pgTagStore.edit(SLUG, { add: ["one", "two"] });
    expect(await pgTagStore.edit(SLUG, { remove: ["ONE", "never had it"] })).toEqual(["two"]);
  });

  it("refuses a bad body before touching anything", async () => {
    await clearMine();
    expect(await status(pgTagStore.edit(SLUG, {}))).toBe(400);
    expect(await status(pgTagStore.edit(SLUG, { add: ["a,b"] }))).toBe(400);
    expect(await status(pgTagStore.edit(SLUG, { add: ["x".repeat(41)] }))).toBe(400);
    expect(await status(pgTagStore.edit(SLUG, { add: ["x"], remove: ["X"] }))).toBe(400);
    const tooMany = Array.from({ length: TAGS_PER_EDIT + 1 }, (_, i) => `t${i}`);
    expect(await status(pgTagStore.edit(SLUG, { add: tooMany }))).toBe(400);
    expect(await pgTagStore.tagsFor(SLUG)).toEqual([]);
  });

  it("answers 404 for a stranger's article and leaves its tags alone", async () => {
    expect(await status(pgTagStore.edit(STRANGER_SLUG, { add: ["mine now"] }))).toBe(404);
    expect(await status(pgTagStore.edit(STRANGER_SLUG, { remove: ["their secret"] }))).toBe(404);
    expect(await status(pgTagStore.tagsFor(STRANGER_SLUG))).toBe(404);
    const theirs = await getDb()
      .select({ tag: articleTags.tag })
      .from(articleTags)
      .where(eq(articleTags.articleId, STRANGER_ID));
    expect(theirs.map((r) => r.tag)).toEqual(["their secret"]);
  });

  it("lists only the reader's own vocabulary, with counts", async () => {
    await clearMine();
    await pgTagStore.edit(SLUG, { add: ["shared word"] });
    const tags = await pgTagStore.readerTags();
    expect(tags).toContainEqual({ tag: "shared word", count: 1 });
    expect(tags.map((t) => t.tag)).not.toContain("their secret");
  });

  /* The race, forced rather than hoped for: two edits fired together on a
     pool may simply run one after the other, and that version of this test
     stayed green with the lock deleted. Here a competing writer has added the
     thirtieth tag and not yet committed, which is where a second edit stands
     mid-flight. Its insert holds only the foreign key's key-share lock on the
     article, which an edit WITHOUT `for update` passes straight through: it
     counts twenty-nine plus its own, answers, and the competitor's commit then
     makes thirty-one. WITH the lock, the edit waits for the competitor, counts
     thirty-one and refuses. (A competitor holding `for update` itself cannot
     tell the two apart, because the edit's own foreign-key check waits on it
     either way: the second version of this test, also green without the lock.) */
  it("holds the cap against a writer that got there first", async () => {
    await clearMine();
    const start = Array.from({ length: TAGS_PER_ARTICLE - 1 }, (_, i) => `cap${String(i).padStart(2, "0")}`);
    await pgTagStore.edit(SLUG, { add: start });

    let edit: Promise<unknown> | undefined;
    let settled = false;
    let settledWhileCompetitorOpen = true;
    await getDb().transaction(async (tx) => {
      await tx.insert(articleTags).values({ articleId: ARTICLE_ID, tag: "racer b" });
      edit = status(pgTagStore.edit(SLUG, { add: ["racer a"] }));
      void edit.then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 400));
      settledWhileCompetitorOpen = settled;
    });
    expect(settledWhileCompetitorOpen).toBe(false);
    expect(await edit).toBe(400);
    expect(await pgTagStore.tagsFor(SLUG)).toHaveLength(TAGS_PER_ARTICLE);
  });

  it("is refused by the database for a writer that skips normaliseTag", async () => {
    const db = getDb();
    for (const tag of ["", "Upper", " lead", "trail ", "two  spaces", "a,b", "tab\there", "x".repeat(41)]) {
      await expect(db.insert(articleTags).values({ articleId: ARTICLE_ID, tag }), JSON.stringify(tag))
        .rejects.toThrow();
    }
    /* And accepts what it would store: forty characters, inner spaces, accents. */
    await clearMine();
    await db.insert(articleTags).values([
      { articleId: ARTICLE_ID, tag: "x".repeat(40) },
      { articleId: ARTICLE_ID, tag: "café au lait" },
    ]);
  });
});
