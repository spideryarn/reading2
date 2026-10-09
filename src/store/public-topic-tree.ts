/**
 * **The public shelf's stored topic tree, read for a stranger.** One row of
 * `shelf_topic_sets`: the site account's (src/site-account.ts), written by
 * src/public-shelf-topics.ts. Read-only, and only ever that row.
 *
 * A file of its own rather than a function in public-library.ts, because that
 * file is held to naming no owner at all (tests/owner-isolation.test.ts), and
 * this read is by owner: a fixed one, the site, which is not a person and is
 * not the visitor. It imports no owner context, so it cannot be pointed at
 * anybody else's row. tests/public-imports.test.ts § `ALLOWED_IN` lets this
 * file, and only this file, name the table.
 *
 * Plan docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md;
 * approved by Greg as "q-p5h2a7 A", 2026-10-09.
 */
import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { shelfTopicSets } from "../db/schema.js";
import type { PublicTopicTree } from "../public-library-topics.js";
import { SITE_OWNER_ID } from "../site-account.js";

/** The site's tree, or `null` before its first re-think. Throws the driver's error; the caller scrubs it. */
export async function readPublicTopicTree(): Promise<PublicTopicTree | null> {
  const [row] = await getDb()
    .select({ topics: shelfTopicSets.topics, members: shelfTopicSets.members, rethoughtAt: shelfTopicSets.rethoughtAt })
    .from(shelfTopicSets)
    .where(eq(shelfTopicSets.ownerId, SITE_OWNER_ID));
  if (!row || row.topics === null || row.members === null || row.rethoughtAt === null) return null;
  return { topics: row.topics, members: row.members };
}
