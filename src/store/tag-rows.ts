/**
 * **The tags on a set of articles** — a leaf, so that the read store (pg.ts,
 * the shelf listing and the Metadata page) and the tag store (pg-tags.ts, which
 * needs pg.ts's ownership helpers) can both use it without importing each
 * other. Plan 261003d.
 *
 * No owner check here: the caller hands in ids it already read through
 * `ownedSlug` or `ownedByReader`.
 */

import { inArray } from "drizzle-orm";

import type { getDb } from "../db/client.js";
import { articleTags } from "../db/schema.js";
import { compareTags } from "../tags.js";

type Db = Pick<ReturnType<typeof getDb>, "select">;

/** The tags on each of these articles, sorted. One query for a whole shelf. */
export async function tagsForArticles(
  db: Db,
  articleIds: readonly string[],
): Promise<Map<string, string[]>> {
  const by = new Map<string, string[]>();
  if (articleIds.length === 0) return by;
  const rows = await db
    .select({ articleId: articleTags.articleId, tag: articleTags.tag })
    .from(articleTags)
    .where(inArray(articleTags.articleId, [...articleIds]));
  for (const { articleId, tag } of rows) {
    const list = by.get(articleId);
    if (list) list.push(tag);
    else by.set(articleId, [tag]);
  }
  for (const list of by.values()) list.sort(compareTags);
  return by;
}
