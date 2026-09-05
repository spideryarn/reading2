/**
 * **Finding an article by something that is not its slug** — src/store/find-article.ts.
 *
 * Both lookups exist because of one change: since 2026-08-31 a slug ends in a
 * random short id (src/ingest.ts § `slugWithShortId`), so a slug can no longer
 * be derived from the address or from the filename. What used to be "guess the
 * name" has to be "look it up".
 *
 * 1. **`slugForUrlKey`** is the adoption half of `freeSlug` (src/jobs.ts), and
 *    it is the one this change could silently break. Adding one article twice,
 *    in two spellings of its URL, must come back to the article already there —
 *    or the reader gets two shelf cards under one headline and pays twice.
 *    That happened once, over `http://` versus `https://`, and the story is in
 *    `freeSlug`'s header.
 *
 *    The ladder above it is tested without a database in
 *    tests/jobs.test.ts § freeSlug. What is tested here is the default lookup
 *    those tests inject around, which is the one line they do not cover.
 *
 * 2. **`slugForShortId`** is the handle Greg asked for on 2026-08-31, so that a
 *    slug the reader renames can still be found. The rename is not built; the
 *    column and the lookup are, because a column nothing can read is a column
 *    nobody can trust.
 *
 * Both are owner-scoped, and the last tests here pin that: `articles.slug` and
 * `articles.short_id` are globally unique, so an unfiltered lookup would hand a
 * stranger another reader's article name.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * **Postgres, and set before anything imports the code under test.**
 *
 * `STORE` is a module-load constant (src/store/live.ts), so a `beforeAll` here
 * would be read after the branch it is meant to choose. Every import below is
 * therefore dynamic.
 */

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { urlKey } from "../src/ingest.js";
import { currentOwnerId, type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * Owns nothing at all, which is the strongest form of "not yours".
 *
 * This id and the two below are **random**, not the next free number in the
 * `00000000-0000-4000-8000-…` block half the suite mints from. The first draft
 * of this file took `…c4`, `…f1` and `…f2` by counting, and all three were
 * already taken — by `source-store`, `chat-anchor` and
 * `publish-session-cleanup-log`. Only the `…f1` clash could actually destroy a
 * row, but a counted id has no way of knowing which kind it is.
 * docs/project/testing.md § Mint a fixture id randomly, not by counting.
 */
const OUTSIDER = "75dcc8e4-56a0-4f74-88e4-f92d1431abb8" as OwnerId;

const SHORT_ID = "spya-k3m9qt";
/**
 * **Deliberately not `…-spya-k3m9qt`.** The slug here does NOT contain the
 * short id, which is the state a rename produces and the whole reason the id is
 * a column rather than a substring. A lookup that parsed the slug would pass
 * every other test in this file and fail this one — which is exactly what the
 * first version of `slugForShortId` did.
 */
const SLUG = "test-find-article-renamed-by-its-reader";
const ARTICLE_ID = "1b6dbaf2-4023-4a45-b999-af55d2052d72";
const REVISION_ID = "5a5505bb-a401-4e48-8819-8ec32f46911f";
/** Stored with `www.` and `https://`, so every spelling below is a real test. */
const URL = "https://www.example.test/find-article";

await pgReady({
  suite: "tests/find-article.test.ts",
  columns: [{ table: "spideryarn.articles", column: "short_id" }],
});

describe("finding an article that is not named after what you have", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    await clean();
    const db = getDb();
    await db
      .insert(articles)
      .values({ id: ARTICLE_ID, ownerId: currentOwnerId(), slug: SLUG, shortId: SHORT_ID });
    await db.insert(articleRevisions).values({
      id: REVISION_ID,
      articleId: ARTICLE_ID,
      status: "published",
      title: "An article whose name you cannot guess",
      requestedUrl: URL,
      finalUrl: URL,
      fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await db
      .update(articles)
      .set({ currentRevisionId: REVISION_ID })
      .where(eq(articles.id, ARTICLE_ID));
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  /**
   * **The one that must never go red.** Every spelling is the same article, so
   * each must come back to the slug already on the shelf — which is what lets
   * every step skip instead of fetching, extracting and paying again.
   */
  it("comes back to the article we already have, however the URL was spelled", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    for (const spelling of [
      "https://www.example.test/find-article",
      "http://www.example.test/find-article",
      "https://example.test/find-article",
      "https://example.test/find-article/",
      "https://EXAMPLE.test/find-article",
      "example.test/find-article",
      "https://example.test/find-article#notes",
      "https://example.test/find-article?utm_source=twitter",
    ]) {
      expect(await slugForUrlKey(urlKey(spelling)), spelling).toBe(SLUG);
    }
  });

  /** A URL nobody has, so "the slug" cannot be the answer to everything. */
  it("but finds nothing for an address we have never seen", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    expect(await slugForUrlKey(urlKey("https://example.test/never-added"))).toBeUndefined();
  });

  /** The short id resolves the article on its own — the handle a rename needs. */
  it("resolves an article from its short id alone", async () => {
    const { slugForShortId } = await import("../src/store/find-article.js");
    expect(await slugForShortId(SHORT_ID)).toBe(SLUG);
  });

  it("and finds nothing for a short id nothing was minted with", async () => {
    const { slugForShortId } = await import("../src/store/find-article.js");
    expect(await slugForShortId("spya-zzzzzz")).toBeUndefined();
  });

  /**
   * **Owner-scoped, and these are the tests that pin it.**
   *
   * A stranger must not learn the article exists, and above all must not be
   * handed its name. Anyone widening either read to a global lookup has to come
   * through here — `slugIsTaken` (src/store/slug-is-taken.ts) is the one
   * sanctioned global question and it answers with a boolean.
   */
  it("is not another owner's article, by URL", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    const theirs = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return slugForUrlKey(urlKey(URL));
    });
    expect(theirs).toBeUndefined();
  });

  it("nor by short id", async () => {
    const { slugForShortId } = await import("../src/store/find-article.js");
    const theirs = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return slugForShortId(SHORT_ID);
    });
    expect(theirs).toBeUndefined();
  });
});

async function clean() {
  const db = getDb();
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, ARTICLE_ID));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, ARTICLE_ID));
  await db.delete(articles).where(eq(articles.id, ARTICLE_ID));
}
