/**
 * **Does any article, anybody's, already have this short id?** The sibling of
 * [`slugIsTaken`](slug-is-taken.ts), and unfiltered for the same reason: it
 * returns a boolean and nothing else.
 *
 * `articles.short_id` is unique across every owner (src/db/schema.ts
 * § `shortId`), and a new slug ends in a freshly minted one. The chance of
 * minting an id an article already has is tiny for one import and grows with
 * the library, and when it happens the article row cannot be created at all.
 * So the minter asks first and mints again (src/jobs.ts § `mintSlug`). Plan
 * 261007f, E10.
 *
 * **Asking is not reserving.** Two imports that mint the same id at the same
 * moment both hear "free"; the unique constraint is what refuses the second,
 * and `lockOrCreateArticle` (src/store/pg-revisions.ts) says so in words.
 *
 * Its own file so the guard in
 * [owner-isolation.test.ts](../../tests/owner-isolation.test.ts) can name it:
 * one comparison of the column with no owner beside it, inside this function,
 * selecting an id and answering yes or no. If you are reaching for this to
 * *find* an article, you want `slugForShortId` (find-article.ts), which names
 * the reader.
 */

import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles } from "../db/schema.js";

export async function shortIdIsTaken(shortId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.shortId, shortId))
    .limit(1);
  return rows.length > 0;
}
