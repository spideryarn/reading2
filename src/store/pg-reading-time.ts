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
import { readingTime } from "../db/schema.js";
import type { ReadingTimeStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { articleIdForOwned } from "./pg.js";

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
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgReadingTimeStore: ReadingTimeStore = guardDbStore("reading-time", rawPgReadingTimeStore);
