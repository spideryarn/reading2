/**
 * **A PDF's quality complaints, through every read that has to keep them and
 * the one that must not show them.** Plan 261009m.
 *
 * `Meta.quality` is the transcription checker's complaints, in its own words
 * (src/pdf-read.ts § `runPdfExtract`). Until this plan no column held them,
 * so every PDF's were computed and dropped at the store's door — the class in
 * docs/postmortems/261009h-a-flag-the-store-did-not-keep.md. Each read below
 * builds its result field by field, so each is a place to drop them again:
 *
 *  - the owner's article, which the Feedback report copies them out of
 *    (src/feedback-article.ts);
 *  - a new draft, which carries them with the transcription they are about;
 *  - the export's `meta.json`, which is the reader's own copy;
 *  - a visitor's article, which must not have them: they are a fact about our
 *    pipeline and somebody's uploaded file, like `recall` (src/public-types.ts).
 *
 * The write side (the round trip, the CHECK, clearing on re-extraction) is in
 * tests/store-artefacts-pg.test.ts.
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
import { PUBLIC_ONLY } from "../src/store/public-access.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/pdf-quality-pg.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "quality" }],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-pdf-quality-${RUN}`;
/* Shaped like nothing else in a payload, so a search for it cannot match by accident. */
const QUALITY = [`page 3: a paragraph in the text layer is missing (${RUN})`, `page 7: low recall (${RUN})`];

let article: ScratchArticle | undefined;
let currentId = "";

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  currentId = row.id;
  await getDb().update(articleRevisions).set({ quality: QUALITY }).where(eq(articleRevisions.id, currentId));
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

describe("a PDF the checker complained about", () => {
  it("gives the owner the complaints, in order", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      expect((await loadArticle(SLUG)).meta.quality).toEqual(QUALITY);
    });
  });

  it("carries them into a new draft", async () => {
    const draftId = await runAsOwner(
      DEV_OWNER_ID,
      async () => (await beginRevision({ slug: SLUG })).revisionId,
    );
    expect(draftId).not.toBe(currentId);
    const [draft] = await getDb()
      .select({ quality: articleRevisions.quality })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, draftId));
    expect(draft).toEqual({ quality: QUALITY });
  });

  it("puts them in the export's meta.json", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-quality-"));
    try {
      await runAsOwner(DEV_OWNER_ID, () =>
        exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }),
      );
      const meta = JSON.parse(await readFile(path.join(out, SLUG, "meta.json"), "utf8")) as Record<string, unknown>;
      expect(meta.quality).toEqual(QUALITY);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("gives a visitor none of them", async () => {
    await getDb()
      .update(articles)
      .set({ visibility: "public", publicAt: new Date() })
      .where(eq(articles.slug, SLUG));
    const shared = await pgPublicReader.loadArticle(SLUG, PUBLIC_ONLY);
    expect(shared.meta).not.toHaveProperty("quality");
    const wire = JSON.stringify(shared);
    for (const complaint of QUALITY) expect(wire).not.toContain(complaint);
  });
});
