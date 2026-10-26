/**
 * How long the reader has spent on each block — both halves, read and add.
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md
 * § The table.
 *
 * `add` is **one statement**, and adds rather than replaces: the batch is
 * unpacked in SQL, joined to `block_identities` for this article, and upserted
 * with `seconds = reading_time.seconds + excluded.seconds`. The join is what
 * drops an id the article never had — without it, the composite foreign key
 * would fail the whole batch over one stale id. And two tabs flushing at once
 * cannot lose each other's seconds, because the addition happens in the row,
 * not in a read-modify-write here.
 *
 * ## What may be logged from this file
 *
 * Nothing, and nothing is. Which passages somebody lingered on is theirs.
 */

import { eq, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles, readSoFarWords, readingTime } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import { foldedOnArrival } from "../web/matter-view.js";
import { readSoFarWords as countedWords } from "../web/read-filter.js";
import type { ReadingTimeStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned, ownedSlug, pgArticleReader } from "./pg.js";
import { readSoFarBasis } from "./read-so-far-basis.js";

const rawPgReadingTimeStore: ReadingTimeStore = {
  async read(slug: string): Promise<Record<string, number>> {
    /* Owner-scoped: a slug the caller does not own is a 404 here, as everywhere. */
    const articleId = await articleIdForOwned(slug);
    const rows = await getDb()
      .select({ blockId: readingTime.blockId, seconds: readingTime.seconds })
      .from(readingTime)
      .where(eq(readingTime.articleId, articleId));
    const out: Record<string, number> = {};
    for (const row of rows) out[row.blockId] = row.seconds;
    return out;
  },

  async add(slug: string, seconds: Record<string, number>): Promise<void> {
    /* Ownership first, even for an empty batch: an empty POST to a stranger's
       slug is still a 404, not a quiet 204 that confirms nothing either way. */
    const articleId = await articleIdForOwned(slug);
    if (Object.keys(seconds).length === 0) return;
    await getDb().execute(sql`
      insert into spideryarn.reading_time (article_id, block_id, seconds)
      select bi.article_id, bi.block_id, batch.value::double precision
      from jsonb_each_text(${JSON.stringify(seconds)}::jsonb) as batch
      join spideryarn.block_identities bi
        on bi.article_id = ${articleId} and bi.block_id = batch.key
      on conflict (article_id, block_id)
      do update set seconds = spideryarn.reading_time.seconds + excluded.seconds
    `);
  },

  /**
   * **Keep the shelf's cached denominator true** — plan 261025l. One cheap
   * statement compares the cached basis with the current one; only when they
   * differ is the article loaded, through the owner's own `loadArticle`, so the
   * title, the authors, the cleaned blocks and the validated matter are exactly
   * what the masthead is handed, and the words are the reading view's own
   * `readSoFarWords(blocks, foldedOnArrival(article))`.
   *
   * **The write is guarded in its `select`**, so the insert and the update arm
   * alike: owned by this reader, and the basis still the one read before the
   * load. An input that changed meanwhile, or a transfer, writes nothing, and
   * the card shows no pie until the next flush.
   *
   * **Accepted, not closed:** an input that changes and changes back while one
   * article is being read (A, B, A) would stamp B's words with A's basis.
   * Closing it means threading a transaction through `loadArticle`; the harm is
   * one card's band wrong until any input next changes. GPT Sol's plan review.
   */
  async refreshShelfWords(slug: string): Promise<"fresh" | "written" | "raced"> {
    const db = getDb();
    const basis = readSoFarBasis();
    const found = (
      await db
        .select({ id: articles.id, current: basis, cached: readSoFarWords.basis })
        .from(articles)
        .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
        .leftJoin(readSoFarWords, eq(readSoFarWords.articleId, articles.id))
        .where(ownedSlug(slug))
        .limit(1)
    )[0];
    if (!found || found.current === found.cached) return "fresh";
    const article = await pgArticleReader.loadArticle(slug);
    const words = Object.fromEntries(countedWords(article.blocks, foldedOnArrival(article)));
    const written = await db.execute(sql`
      insert into ${readSoFarWords} (article_id, basis, words, computed_at)
      select ${articles.id}, ${found.current}, ${JSON.stringify(words)}::jsonb, now()
      from ${articles}
      join ${articleRevisions} on ${articleRevisions.id} = ${articles.currentRevisionId}
      where ${articles.id} = ${found.id}
        and ${articles.ownerId} = ${currentOwnerId()}
        and ${basis} = ${found.current}
      on conflict (article_id) do update
        set basis = excluded.basis, words = excluded.words, computed_at = excluded.computed_at
      returning article_id
    `);
    return written.rows.length === 1 ? "written" : "raced";
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgReadingTimeStore: ReadingTimeStore = guardDbStore("reading-time", rawPgReadingTimeStore);
