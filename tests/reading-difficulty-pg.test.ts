/**
 * **The reading-difficulty rating, through every read that has to show it and
 * the ones that must not show all of it.** Plan 261005j.
 *
 * Five columns on `article_revisions` hold a model's rating of the piece: two
 * levels, one sentence, the model's id and the time. Each read below builds its
 * result field by field, so a column nobody named is dropped without an error
 * and the minutes go back to the flat rate with nothing saying so:
 *
 *  - the owner's article, whose masthead and Metadata tile multiply by it;
 *  - the shelf entry, whose minutes must be the same number;
 *  - a visitor's article: the levels and the sentence, never the model or the time;
 *  - a new draft, which carries all five, the time unchanged;
 *  - both exports, which are the reader's own copy and carry all five.
 *
 * The write side (the artefact, the CHECKs, a `metadata` write leaving it
 * alone) is in tests/store-artefacts-pg.test.ts. The seed here goes through the
 * store's own write path, which is what makes the first case an assertion
 * about `blocks` writing "unrated" rather than about a column default. What
 * needs the `blocks` step to call a model is stage 3's.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEV_OWNER_ID, runAsOwner } from "../src/owner.js";
import { articleBundle } from "../src/store/export-bundle.js";
import { exportArticle } from "../src/store/export.js";
import { listArticles, loadArticle } from "../src/store/index.js";
import { beginRevision } from "../src/store/pg-revisions.js";
import { pgPublicReader } from "../src/store/public-reader.js";
import { PUBLIC_ONLY } from "../src/store/public-access.js";
import { articleStats } from "../src/web/stats.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/reading-difficulty-pg.test.ts",
  columns: [
    { table: "spideryarn.article_revisions", column: "reading_language" },
    { table: "spideryarn.article_revisions", column: "reading_difficulty_rated_at" },
  ],
});

const RUN = randomUUID().slice(0, 8);
const SLUG = `test-reading-difficulty-${RUN}`;

/** Language 5, ideas 5: the table's hardest corner, 1.17 × 1.20 = 1.404. */
const LANGUAGE = 5;
const IDEAS = 5;
const REASON = "Long technical sentences, and every section builds on the last.";
/* Shaped like no real model id, so a search of a payload for it cannot match
   anything else. */
const MODEL = `test/rater-${RUN}`;
const RATED_AT = new Date("2026-10-05T09:30:00.000Z");

const FIVE = {
  language: articleRevisions.readingLanguage,
  ideas: articleRevisions.readingIdeas,
  reason: articleRevisions.readingDifficultyReason,
  model: articleRevisions.readingDifficultyModel,
  ratedAt: articleRevisions.readingDifficultyRatedAt,
};

let article: ScratchArticle | undefined;
let currentId = "";

async function rate(): Promise<void> {
  await getDb()
    .update(articleRevisions)
    .set({
      readingLanguage: LANGUAGE,
      readingIdeas: IDEAS,
      readingDifficultyReason: REASON,
      readingDifficultyModel: MODEL,
      readingDifficultyRatedAt: RATED_AT,
    })
    .where(eq(articleRevisions.id, currentId));
}

/** The minutes for `words` at 238 a minute times 1.404, by arithmetic and not by the function under test. */
const hardMinutes = (words: number) => Math.max(1, Math.round((words / 238) * 1.404));
const flatMinutes = (words: number) => Math.max(1, Math.round(words / 238));

beforeAll(async () => {
  article = await scratchArticleInPg(SLUG, { ownerId: DEV_OWNER_ID });
  expect(article.copied).toContain("blocks");
  const [row] = await getDb()
    .select({ id: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG))
    .limit(1);
  if (!row?.id) throw new Error(`no current revision for ${SLUG}`);
  currentId = row.id;
}, 60_000);

afterAll(async () => {
  await article?.remove();
  await closeDb();
});

describe("an article nobody has rated", () => {
  it("holds none of the five, and reads at the flat rate with no rating on it", async () => {
    const [row] = await getDb().select(FIVE).from(articleRevisions).where(eq(articleRevisions.id, currentId));
    expect(row).toEqual({ language: null, ideas: null, reason: null, model: null, ratedAt: null });
    await runAsOwner(DEV_OWNER_ID, async () => {
      const loaded = await loadArticle(SLUG);
      expect(loaded.meta).not.toHaveProperty("readingDifficulty");
      const stats = articleStats(loaded);
      expect(stats.minutes).toBe(flatMinutes(stats.words));
    });
  });
});

describe("a rated article", () => {
  beforeAll(rate);

  it("gives the owner the two levels and the sentence, and multiplies the minutes", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      const loaded = await loadArticle(SLUG);
      // Exactly these three: the model and the time are not a screen's business.
      expect(loaded.meta.readingDifficulty).toEqual({ language: LANGUAGE, ideas: IDEAS, reason: REASON });
      expect(JSON.stringify(loaded)).not.toContain(MODEL);
      const stats = articleStats(loaded);
      /* The control that this fixture can tell rated from flat at all: a
         piece short enough to round to the same minute would pass whatever
         the read did. */
      expect(hardMinutes(stats.words)).not.toBe(flatMinutes(stats.words));
      expect(stats.minutes).toBe(hardMinutes(stats.words));
    });
  });

  it("puts the same minutes on the shelf entry", async () => {
    await runAsOwner(DEV_OWNER_ID, async () => {
      const entry = (await listArticles()).find((e) => e.slug === SLUG);
      if (!entry) throw new Error(`${SLUG} is not on the shelf`);
      const masthead = articleStats(await loadArticle(SLUG));
      expect(entry.words).toBe(masthead.words);
      expect(entry.minutes).toBe(hardMinutes(entry.words));
      expect(entry.minutes).toBe(masthead.minutes);
      // The shelf shows a number, not the model's sentence about it.
      expect(JSON.stringify(entry)).not.toContain(REASON);
      expect(JSON.stringify(entry)).not.toContain(MODEL);
    });
  });

  it("is carried into a new draft whole, with the time it was rated at", async () => {
    const draftId = await runAsOwner(
      DEV_OWNER_ID,
      async () => (await beginRevision({ slug: SLUG })).revisionId,
    );
    expect(draftId).not.toBe(currentId);
    const [draft] = await getDb().select(FIVE).from(articleRevisions).where(eq(articleRevisions.id, draftId));
    expect(draft).toEqual({
      language: LANGUAGE,
      ideas: IDEAS,
      reason: REASON,
      model: MODEL,
      ratedAt: RATED_AT,
    });
  });

  it("is in the export's meta.json with all five facts", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-difficulty-"));
    try {
      await runAsOwner(DEV_OWNER_ID, () =>
        exportArticle(SLUG, { dataRoot: out, outputRoot: path.join(out, "output") }),
      );
      const meta = JSON.parse(await readFile(path.join(out, SLUG, "meta.json"), "utf8")) as Record<string, unknown>;
      expect(meta.readingDifficulty).toEqual({
        language: LANGUAGE,
        ideas: IDEAS,
        reason: REASON,
        model: MODEL,
        ratedAt: RATED_AT.toISOString(),
      });
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });

  it("is in the reader's bundle with all five columns", async () => {
    const bundle = await runAsOwner(DEV_OWNER_ID, () => articleBundle(SLUG));
    const file = unzipSync(bundle.bytes)["content/revision.json"];
    if (!file) throw new Error("the bundle has no content/revision.json");
    const revision = JSON.parse(new TextDecoder().decode(file)) as Record<string, unknown>;
    expect(revision).toMatchObject({
      readingLanguage: LANGUAGE,
      readingIdeas: IDEAS,
      readingDifficultyReason: REASON,
      readingDifficultyModel: MODEL,
      readingDifficultyRatedAt: RATED_AT.toISOString(),
    });
  });

  it("gives a visitor the levels and the sentence, and neither the model nor the time", async () => {
    await getDb()
      .update(articles)
      .set({ visibility: "public", publicAt: new Date() })
      .where(eq(articles.slug, SLUG));
    const shared = await pgPublicReader.loadArticle(SLUG, PUBLIC_ONLY);
    expect(shared.meta.readingDifficulty).toEqual({ language: LANGUAGE, ideas: IDEAS, reason: REASON });
    const wire = JSON.stringify(shared);
    expect(wire).not.toContain(MODEL);
    expect(wire).not.toContain(RATED_AT.toISOString());
  });
});

describe("an unrated article, for a visitor", () => {
  it("sends no rating at all", async () => {
    await getDb()
      .update(articleRevisions)
      .set({
        readingLanguage: null,
        readingIdeas: null,
        readingDifficultyReason: null,
        readingDifficultyModel: null,
        readingDifficultyRatedAt: null,
      })
      .where(eq(articleRevisions.id, currentId));
    const shared = await pgPublicReader.loadArticle(SLUG, PUBLIC_ONLY);
    expect(shared.meta).not.toHaveProperty("readingDifficulty");
  });
});
