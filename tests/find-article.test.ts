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
 * **`STORE` was a module-load constant (src/store/live.ts)**, so the store had
 * to be pinned above the imports below. The flag and that file went on
 * 2026-09-06.
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

/**
 * **Articles that carry the address they were asked for** (`articles.asked_url`,
 * plan 261006i). A short link that ends on a paper has the paper's address as
 * its `final_url`, so the link itself finds nothing unless the article remembers
 * it. Each row here is one sentence of the rule.
 *
 * The arXiv ids are ones arXiv never issued (`9912.9887x`), because the lookup
 * is over the whole of this owner's shelf and a real id could already be on it.
 *
 * **The order matters for the last two.** `aliasOfAnother` is inserted before
 * `heldByItsOwnAddress`, so a lookup that took the first row matching either
 * way would answer the wrong one.
 */
const ASKED = {
  /** A short link that ended on a paper: found by the link and by the paper. */
  paper: {
    id: "fac87a8e-73d0-4cfa-80f8-27ae34760728",
    revision: "d474b8a9-7014-490b-acd9-08058e311129",
    slug: "test-find-article-asked-paper",
    asked: "https://bit.ly/s1FindArticlePaper",
    final: "https://arxiv.org/html/9912.98871",
    status: "published",
  },
  /** Imported from a `…v1` link: found by the plain link and by any other version. Report spya-n50aft. */
  versioned: {
    id: "0c6f7d0e-2b5f-4f7e-9a51-3d1e7f0a9c26",
    revision: "6e2a1c84-9b7d-4c3e-8f15-7a0d2b9e4c51",
    slug: "test-find-article-arxiv-v1",
    asked: "https://arxiv.org/abs/9912.98876v1",
    final: "https://arxiv.org/html/9912.98876v1",
    status: "published",
  },
  /** A short link that ended on a blog post: its link may move, so it does not find it. */
  blog: {
    id: "8ad54b71-aee4-4f44-9b31-ea63c0cd42ae",
    revision: "9ed2541a-409c-463d-b56f-e51d69ec1f6a",
    slug: "test-find-article-asked-blog",
    asked: "https://t.co/s1FindArticleBlog",
    final: "https://www.example.test/find-article-asked-blog",
    status: "published",
  },
  /** A paper's draft that never published: nothing is on the shelf to come back to. */
  unpublished: {
    id: "b35a6d4d-7940-4626-8820-bc94225fe0c5",
    revision: "40d90a8e-789e-4dbe-bbe3-d6af08bb2894",
    slug: "test-find-article-asked-unpublished",
    asked: "https://bit.ly/s1FindArticleDraft",
    final: "https://arxiv.org/html/9912.98873",
    status: "draft",
  },
  /** Asked for by paper 98874's own address, but the bytes are another paper's. */
  aliasOfAnother: {
    id: "1848f459-c962-4b28-a36c-f9eba6a0184f",
    revision: "944a6f7b-1f5a-4935-8798-7a554d4e591e",
    slug: "test-find-article-asked-for-98874",
    asked: "https://arxiv.org/abs/9912.98874",
    final: "https://arxiv.org/html/9912.98875",
    status: "published",
  },
  /** Paper 98874 itself, with no asked-for address: the article that IS that paper. */
  heldByItsOwnAddress: {
    id: "1364385b-66e8-4c4b-8e15-1b447e7fd957",
    revision: "f5fde695-a63b-4ae1-a5e0-16b4f2eae26e",
    slug: "test-find-article-is-98874",
    asked: null,
    final: "https://arxiv.org/pdf/9912.98874",
    status: "published",
  },
} as const;

await pgReady({
  suite: "tests/find-article.test.ts",
  columns: [
    { table: "spideryarn.articles", column: "short_id" },
    { table: "spideryarn.articles", column: "asked_url" },
  ],
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

    /* One at a time and in the order written, because the last two depend on it. */
    for (const row of Object.values(ASKED)) {
      await db
        .insert(articles)
        .values({ id: row.id, ownerId: currentOwnerId(), slug: row.slug, askedUrl: row.asked });
      await db.insert(articleRevisions).values({
        id: row.revision,
        articleId: row.id,
        status: row.status,
        title: "An article that remembers what it was asked for",
        requestedUrl: row.final,
        finalUrl: row.final,
        fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      if (row.status === "published") {
        await db
          .update(articles)
          .set({ currentRevisionId: row.revision })
          .where(eq(articles.id, row.id));
      }
    }
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

  /**
   * **The address it was asked for, when what came back was a paper.** Pasting
   * the same short link twice must come back to the one article, or the reader
   * pays to read the paper a second time. GPT Sol's G1 on plan 261005m.
   */
  it("finds a paper by the short link it was asked for, and by the paper's own address", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    const { paper } = ASKED;
    expect(await slugForUrlKey(urlKey(paper.asked)), "the short link").toBe(paper.slug);
    expect(await slugForUrlKey(urlKey("http://bit.ly/s1FindArticlePaper/")), "respelled").toBe(paper.slug);
    expect(await slugForUrlKey(urlKey(paper.final)), "the paper").toBe(paper.slug);
    expect(await slugForUrlKey(urlKey("https://arxiv.org/abs/9912.98871")), "its landing page").toBe(paper.slug);
    expect(await slugForUrlKey(urlKey("https://bit.ly/s1FindArticleNobody"))).toBeUndefined();
  });

  /**
   * **Every version of a paper is one article** — the shelf held the article a
   * `…v1` link imported, and the plain abstract link imported it again.
   * Report spya-n50aft, plan 261009d.
   */
  it("finds a paper imported from a versioned link by the plain link, and by another version", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    const { versioned } = ASKED;
    for (const spelling of [
      "https://arxiv.org/abs/9912.98876",
      "https://arxiv.org/pdf/9912.98876",
      "https://arxiv.org/abs/9912.98876v2",
    ]) {
      expect(await slugForUrlKey(urlKey(spelling)), spelling).toBe(versioned.slug);
    }
  });

  /**
   * **Only a paper.** A link to an ordinary page may be one that is meant to
   * move (`/latest`), and an article found by it would be found for ever, with
   * no Refresh that goes back to the link. So it imports again, as it did before
   * the column. GPT Sol's K3 on plan 261006i.
   */
  it("does not find an ordinary page by the link it was asked for", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    const { blog } = ASKED;
    expect(await slugForUrlKey(urlKey(blog.asked))).toBeUndefined();
    /* It is there, and found the old way: the row is not simply missing. */
    expect(await slugForUrlKey(urlKey(blog.final))).toBe(blog.slug);
  });

  /** A failed import left a row and an address behind, and nothing to open. */
  it("does not find an article that never published, by either address", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    const { unpublished } = ASKED;
    expect(await slugForUrlKey(urlKey(unpublished.asked))).toBeUndefined();
    expect(await slugForUrlKey(urlKey(unpublished.final))).toBeUndefined();
  });

  /**
   * **The article that is the paper beats the article that was asked for by its
   * address.** Where the bytes came from is the stronger claim, and it is the
   * answer this lookup gave before the column existed.
   */
  it("prefers the article whose own address matches over one that was only asked for by it", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    const { aliasOfAnother, heldByItsOwnAddress } = ASKED;
    expect(await slugForUrlKey(urlKey("https://arxiv.org/abs/9912.98874"))).toBe(heldByItsOwnAddress.slug);
    /* And the other article is still found, by what it holds. */
    expect(await slugForUrlKey(urlKey(aliasOfAnother.final))).toBe(aliasOfAnother.slug);
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

  it("nor by the address it was asked for", async () => {
    const { slugForUrlKey } = await import("../src/store/find-article.js");
    const theirs = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return slugForUrlKey(urlKey(ASKED.paper.asked));
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
  for (const id of [ARTICLE_ID, ...Object.values(ASKED).map((row) => row.id)]) {
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
    await db.delete(articleRevisions).where(eq(articleRevisions.articleId, id));
    await db.delete(articles).where(eq(articles.id, id));
  }
}
