/**
 * **The third way to name an article, and the second ownerless one.**
 *
 *     slug = ? AND share_token = ?
 *
 * The sibling of [`publicSlug`](public-slug.ts): an article whose owner made a
 * private link for it, named by somebody who holds that link's key.
 * docs/plans/261005e-share-an-article-with-some-people-a-private-link-first.md.
 *
 * ## Never OR-ed into `publicSlug`
 *
 * `publicSlug` is what "public" means everywhere it is read, and the listing
 * and the showcase are built beside it. A key clause added there would be one
 * edit away from a link-shared article on the public shelf. So the two are
 * separate leaves, and the one place they meet is
 * [`publicAccessWhere`](public-access.ts), which is used only by reads that
 * already name a slug.
 *
 * ## A key that is not a key matches nothing
 *
 * The parameter is a `ShareKey`, which only `parseShareKey` (src/share-key.ts)
 * makes, and it refuses the empty string. That is the first guard. The second
 * is in the function, for a caller that cast its way past the type. The third
 * is the database's: `share_token` is null when there is no link, and a null
 * equals nothing; and the CHECK `articles_share_token_shape` means no stored
 * value is empty or short.
 *
 * ## Compared in the `where`, never fetched and compared
 *
 * For the reason `publicSlug` gives: a preliminary check leaves a window and an
 * unfiltered read. There is a second reason here. Selecting the token to
 * compare it in JavaScript would bring the secret into this process for every
 * guess, where a log line or an error message could carry it out.
 *
 * ## What this file may import
 *
 * The schema, `drizzle-orm`, and the key's type. No owner, exactly as its
 * sibling: tests/owner-isolation.test.ts reads this file for that.
 */

import { and, eq, sql } from "drizzle-orm";

import { articles } from "../db/schema.js";
import type { ShareKey } from "../share-key.js";

export function linkSharedSlug(slug: string, key: ShareKey) {
  /* Not reachable through the type. Kept because the cost of being wrong here
     is somebody's private article, and a constant `false` costs nothing. */
  if (typeof key !== "string" || key === "") return sql`false`;
  return and(eq(articles.slug, slug), eq(articles.shareToken, key));
}
