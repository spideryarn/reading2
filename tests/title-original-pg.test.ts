/**
 * **`article_revisions.title_original`, through every read that has to name
 * it and the one that must not.**
 *
 * The column is the only copy of a title as it arrived once import has tidied
 * it (src/title-tidy.ts). Each read below builds its result field by field, so
 * a column nobody named is dropped without an error:
 *
 *  - the owner's article, which the Metadata page shows it from;
 *  - a new draft, which must carry it with the title it is the original of;
 *  - the export, which is the reader's own copy of their data;
 *  - and a visitor's article, which is not sent it.
 *
 * The write side is in tests/store-artefacts-pg.test.ts.
 * docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { exportArticle } from "../src/store/export.js";
import { loadArticle } from "../src/store/index.js";
import { beginRevision } from "../src/store/pg-revisions.js";
import { pgPublicReader } from "../src/store/public-reader.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/title-original-pg.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "title_original" }],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-title-original-${RUN}`;
const TITLE = "The Order of Time";
const ORIGINAL = "THE ORDER OF TIME";

let article: ScratchArticle | undefined;

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  await getDb()
    .update(articleRevisions)
    .set({ title: TITLE, titleOriginal: ORIGINAL })
    .where(eq(articleRevisions.id, row.id));
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

describe("a tidied title's original", () => {
  it("reaches the owner's article", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      const { meta } = await loadArticle(SLUG);
      expect(meta.title).toBe(TITLE);
      expect(meta.titleOriginal).toBe(ORIGINAL);
    });
  });

  it("is carried into a new draft with its title", async () => {
    const draftId = await runAsOwner(
      DEV_OWNER_ID,
      async () => (await beginRevision({ slug: SLUG })).revisionId,
    );
    const [draft] = await getDb()
      .select({ title: articleRevisions.title, original: articleRevisions.titleOriginal })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, draftId))
      .limit(1);
    expect(draft).toEqual({ title: TITLE, original: ORIGINAL });
  });

  it("is in the export's meta.json", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-title-"));
    try {
      await runAsOwner(DEV_OWNER_ID, () =>
        exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }),
      );
      const meta = JSON.parse(await readFile(path.join(out, SLUG, "meta.json"), "utf8")) as Record<string, unknown>;
      expect(meta.title).toBe(TITLE);
      expect(meta.titleOriginal).toBe(ORIGINAL);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("is not sent to a visitor", async () => {
    await getDb()
      .update(articles)
      .set({ visibility: "public", publicAt: new Date() })
      .where(eq(articles.slug, SLUG));
    const shared = await pgPublicReader.loadArticle(SLUG);
    expect(shared.meta.title).toBe(TITLE);
    expect(shared.meta).not.toHaveProperty("titleOriginal");
    expect(JSON.stringify(shared)).not.toContain(ORIGINAL);
  });
});
