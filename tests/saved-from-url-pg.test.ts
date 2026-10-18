/**
 * **`article_revisions.saved_from_url`, through every read that names it** —
 * where an uploaded page says it was saved from (the bookmarklet's meta), plan
 * docs/plans/261018j-a-refused-paper-read-from-europe-pmc-and-a-saved-page-keeps-its-address.md
 * § Stage 3 and GPT Sol's S3, S4 and S9.
 *
 * The saved-page column of the S9 matrix, against real rows:
 *
 *  - requested and final address null, saved address set;
 *  - the owner's `Meta.savedFrom` (and no `Meta.url`), checked again on read;
 *  - the shelf row has no `url`, so Refresh forces `extract` rather than
 *    `fetch` (src/web/ShelfEntry.tsx § `hasWebUrl`);
 *  - a force-extract's successor draft carries it (`savedFromUrl: "carry"`);
 *  - a visitor gets it only through `publicSourceUrl`, as `savedFrom`.
 *
 * The write side (a new file replaces or clears it) is in
 * tests/store-artefacts-pg.test.ts; the duplicate lookup, with a second owner,
 * in tests/find-article.test.ts; the extract base in
 * tests/extract-resolves-against-the-final-url.test.ts.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { listArticles, loadArticle } from "../src/store/index.js";
import { beginRevision } from "../src/store/pg-revisions.js";
import { PUBLIC_ONLY } from "../src/store/public-access.js";
import { pgPublicReader } from "../src/store/public-reader.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/saved-from-url-pg.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "saved_from_url" }],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-saved-from-${RUN}`;
const SAVED = "https://journals.plos.org/plosone/article/file-123";

let article: ScratchArticle | undefined;
let publishedId = "";

/** Set the published revision's saved-from claim, as an upload would have. */
async function claim(savedFromUrl: string | null): Promise<void> {
  await getDb()
    .update(articleRevisions)
    .set({ savedFromUrl })
    .where(eq(articleRevisions.id, publishedId));
}

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  publishedId = row.id;
  /* An upload: no address fetched, the reader's own filename, and the claim. */
  await getDb()
    .update(articleRevisions)
    .set({ requestedUrl: null, finalUrl: null, rawFilename: "A saved page.html", savedFromUrl: SAVED })
    .where(eq(articleRevisions.id, publishedId));
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

describe("a saved page's address", () => {
  it("reaches the owner's article as savedFrom, and never as url", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      const { meta } = await loadArticle(SLUG);
      expect(meta.savedFrom).toBe(SAVED);
      expect(meta.url).toBeUndefined();
      expect(meta.filename).toBe("A saved page.html");
    });
  });

  it("leaves the shelf row with no url, so Refresh re-extracts rather than fetching", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      const entry = (await listArticles()).find((e) => e.slug === SLUG);
      expect(entry).toBeDefined();
      expect(entry?.url).toBeUndefined();
    });
  });

  it("is checked again on read, so a bad value in the row never reaches the owner", async () => {
    await claim("javascript:alert(1)");
    try {
      await runAsOwner(DEV_OWNER_ID, async () => {
        expect((await loadArticle(SLUG)).meta.savedFrom).toBeUndefined();
      });
    } finally {
      await claim(SAVED);
    }
  });

  it("is carried into a new draft, which is what a force-extract publishes", async () => {
    const draftId = await runAsOwner(DEV_OWNER_ID, async () => (await beginRevision({ slug: SLUG })).revisionId);
    const [draft] = await getDb()
      .select({
        saved: articleRevisions.savedFromUrl,
        final: articleRevisions.finalUrl,
        requested: articleRevisions.requestedUrl,
      })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, draftId))
      .limit(1);
    expect(draft).toEqual({ saved: SAVED, final: null, requested: null });
  });

  describe("for a visitor", () => {
    beforeAll(async () => {
      await getDb()
        .update(articles)
        .set({ visibility: "public", publicAt: new Date() })
        .where(eq(articles.slug, SLUG));
    });

    it("is sent as savedFrom, and never as url", async () => {
      const shared = await pgPublicReader.loadArticle(SLUG, PUBLIC_ONLY);
      expect(shared.meta.savedFrom).toBe(SAVED);
      expect(shared.meta.url).toBeUndefined();
    });

    it.each([
      ["a signed query", "https://www.cell.com/fulltext/S1?sig=SECRETSIGNATURE"],
      ["a credential", "https://someone:SECRETPW@www.cell.com/fulltext/S1"],
      ["localhost", "http://localhost/SECRET"],
      ["a private IP", "http://10.0.0.5/SECRET"],
    ])("is not sent at all for %s", async (_n, value) => {
      await claim(value);
      try {
        const shared = await pgPublicReader.loadArticle(SLUG, PUBLIC_ONLY);
        expect(shared.meta.savedFrom).toBeUndefined();
        expect(JSON.stringify(shared)).not.toContain("SECRET");
      } finally {
        await claim(SAVED);
      }
    });
  });
});
