/**
 * **An `articles` row and nothing else**, for the suites whose subject is the
 * job rather than the article.
 *
 * ## Why this exists, and it is new on 2026-09-05
 *
 * `enqueue` now refuses a bare-slug request — one carrying neither a URL nor an
 * upload — for an article the reader does not have
 * ([`src/jobs.ts`](../../src/jobs.ts)). It used to let one through, on the
 * reasoning that a slug nobody holds blocks nothing but itself; what that missed
 * is that a bare-slug request *means* "run something on my existing article", so
 * a typo became a purchase: `npm run blocks -- typoo` created an article row,
 * failed the step inside it, and left the wreck on the reader's shelf. Stage E
 * of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 *
 * Five suites were queueing jobs against slugs they had deliberately not built,
 * because their subject is the *row* — whether a second job queues behind the
 * first, what a failing step persists, whether a re-run spends a quota slot. All
 * of them are still asking exactly that question; they just have to say that the
 * article exists first, which is what they always meant.
 *
 * ## Why a bare row is enough
 *
 * `articleExists` is a **left** join onto the published revision
 * ([`src/pipeline.ts`](../../src/pipeline.ts) § `ownedArticle`), deliberately: an
 * article whose ingest crashed after the row was created still counts as
 * existing, because that is precisely the state where handing the slug out again
 * does damage. So no revision, no blocks, no artefacts — one row.
 *
 * **This is not `scratchArticleInPg`** ([./scratch-article.ts](./scratch-article.ts)),
 * and the two are not alternatives. That one clones a corpus article through the
 * real load path so a suite can *read* something; this one exists so a suite can
 * queue something. A suite that needs artefacts wants the other.
 */
import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "../../src/db/client.js";
import { articles } from "../../src/db/schema.js";
import { currentOwnerId, type OwnerId } from "../../src/owner.js";

/**
 * Make sure a bare `articles` row exists under each slug, for this owner.
 *
 * Idempotent, because these suites re-run and because two of them share a slug
 * between cases on purpose. Returns nothing: the row's id is not the point, and
 * a caller that wanted one would be asking for the other helper.
 */
export async function bareArticles(
  slugs: readonly string[],
  ownerId: OwnerId = currentOwnerId(),
): Promise<void> {
  const db = getDb();
  const already = new Set(
    (
      await db
        .select({ slug: articles.slug })
        .from(articles)
        .where(and(eq(articles.ownerId, ownerId), inArray(articles.slug, [...slugs])))
    ).map((r) => r.slug),
  );
  const wanted = slugs.filter((s) => !already.has(s));
  if (wanted.length === 0) return;
  /* No `id`: the column is `defaultRandom()`, and a `spya-…` from `mintId` is not a uuid. */
  await db.insert(articles).values(wanted.map((slug) => ({ ownerId, slug })));
}

/** Remove them again. Jobs first is the caller's business — the foreign key is on the job. */
export async function removeBareArticles(
  slugs: readonly string[],
  ownerId: OwnerId = currentOwnerId(),
): Promise<void> {
  await getDb()
    .delete(articles)
    .where(and(eq(articles.ownerId, ownerId), inArray(articles.slug, [...slugs])));
}
