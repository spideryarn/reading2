/**
 * **Does this slug exist for anybody at all?** The one sanctioned *unfiltered*
 * lookup in the repo — and a leaf, so the guard can name it rather than trusting
 * the file it used to live in.
 *
 * It is not a way to reach somebody else's article: it returns a boolean and
 * nothing else. It exists because `articles.slug` is globally unique, so
 * "`ownedSlug` found nothing" has two very different causes — there is no such
 * article, or there is one and it is not yours. `beginRevision` needs to tell
 * those apart, because the second deserves a sentence saying so rather than
 * "could not create or lock the article row".
 *
 * If you are reaching for this to *read* something, you want
 * [`ownedSlug`](owned-slug.ts).
 *
 * ## Why it moved out of `pg.ts`, 2026-08-28
 *
 * Because the guard that is supposed to contain it was exempting the whole file.
 * [owner-isolation.test.ts](../../tests/owner-isolation.test.ts) greps
 * `src/store/` for `eq(articles.slug, …)` and skipped `pg.ts` wholesale — all
 * fourteen hundred lines — so a *fourth* unfiltered lookup added anywhere in it
 * would have passed. GPT Sol's finding 4:
 *
 * > It verifies that `slugIsTaken` is safe, but not that it is the only bare
 * > slug lookup in `pg.ts`.
 *
 * The exemption existed for this one function and nothing else, so moving the
 * function removes the exemption. What is left is three one-function leaves —
 * this, `ownedSlug` and `publicSlug` — and the guard can now insist that each
 * contains **exactly one** bare lookup and that it is inside the function it is
 * named for. That is a rule with no file-sized holes in it.
 *
 * The same move, for the same reason, as `publicSlug` getting its own file
 * rather than sitting beside `ownedSlug`.
 */

import { eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles } from "../db/schema.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function slugIsTaken(slug: string, db: Db | Tx = getDb()): Promise<boolean> {
  const rows = await db
    .select({ id: articles.id })
    .from(articles)
    .where(eq(articles.slug, slug))
    .limit(1);
  return rows.length > 0;
}
