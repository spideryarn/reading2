/**
 * **The one write the public namespace makes**: a signed-out visitor opened a
 * private link, so its count goes up. Greg, 2026-10-20 (reply `spya-xug3kf` to
 * q-agbc89, option C): the signed-in accounts that open a private link, *plus
 * a count of signed-out opens*. The signed-in half is
 * [pg-private-link-openers.ts](pg-private-link-openers.ts), which is outside
 * the public graph; this file can write nothing but the count.
 * docs/plans/261021d-admin-sees-a-private-link-s-owner-and-who-opened-it.md.
 *
 * ## What it may touch
 *
 * `articles`, only through `privateLinkWhere` in its `where`, and
 * `private_link_signed_out_opens`. No owner, no reader id, nothing selected
 * back: the route answers 204 whatever happened
 * (tests/public-imports.test.ts § `ALLOWED_IN` records the permission).
 *
 * ## Why the count is approximate, and bounded
 *
 * Anybody holding the link can call the route in a loop. So one statement,
 * no read first, and two bounds in the upsert itself (GPT Sol's F2 on the
 * plan): **at most one increment per article per two seconds**, and the
 * counter **saturates** rather than overflowing. Two genuine signed-out opens
 * in the same two seconds count once; nobody can push it past ~43,000 a day.
 * docs/project/security-risks.md § R31.
 */

import { sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, privateLinkSignedOutOpens } from "../db/schema.js";
import type { ShareKey } from "../share-key.js";
import { privateLinkWhere } from "./public-access.js";

/** The throttle, in seconds: at most one increment per article in this long. */
export const SIGNED_OUT_OPEN_THROTTLE_SECONDS = 2;

/** `integer`'s ceiling; the count stops there rather than failing the write. */
const COUNT_CEILING = 2147483647;

/**
 * Count one signed-out open of `slug`'s private link, if `key` opens it and
 * the article is private. Anything else — a wrong key, a link turned off, a
 * public article, an unknown slug — writes nothing, and the caller is not told
 * which.
 */
export async function countSignedOutOpen(slug: string, key: ShareKey): Promise<void> {
  const t = privateLinkSignedOutOpens;
  await getDb()
    .insert(t)
    .select(
      getDb()
        .select({
          articleId: articles.id,
          opens: sql<number>`1`.as("opens"),
          firstOpenedAt: sql<Date>`now()`.as("first_opened_at"),
          lastOpenedAt: sql<Date>`now()`.as("last_opened_at"),
        })
        .from(articles)
        .where(privateLinkWhere(slug, key)),
    )
    .onConflictDoUpdate({
      target: t.articleId,
      set: {
        opens: sql`least(${t.opens}::bigint + 1, ${COUNT_CEILING})::integer`,
        lastOpenedAt: sql`now()`,
      },
      where: sql`${t.lastOpenedAt} < now() - make_interval(secs => ${SIGNED_OUT_OPEN_THROTTLE_SECONDS})`,
    });
}
