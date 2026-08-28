/**
 * Take an article back to having no revisions, so the next load starts from
 * nothing — and leave everything else where it is.
 *
 * ## Why a suite that loads a fixture needs this
 *
 * `beginDraftIn` carries the published revision's columns, block rows **and
 * step-run rows** forward into the new draft. That is right for the pipeline: a
 * stage that does not run this time should not lose last time's output. It is
 * fatal for a fixture, because a column the write path never touches reads back
 * perfectly, and a test comparing it is measuring whoever loaded the article
 * last — which for most of this repo's history was `db:import`.
 *
 * The first sweep of the corpus reported `noema-mythology-of-conscious-ai`
 * byte-identical across the two stores. It cannot be: it has no `raw.json`, so
 * nothing writes `final_url` or `fetched_at`, and the matching values were an
 * earlier import showing through.
 *
 * ## Revisions, and deliberately not the article
 *
 * `basedOn` is `articles.current_revision_id`, so clearing the pointer and the
 * revisions behind it is all the claim needs. Deleting the article cascades
 * through comments, chat, searches and block identities — and vitest runs test
 * files concurrently, so an article that vanishes for two seconds fails whoever
 * else was reading it for a reason that has nothing to do with them.
 *
 * `revision_blocks` and `revision_step_runs` cascade off the revision.
 * `jobs.draft_revision_id` is `on delete set null`, which is the state a swept
 * draft already has.
 *
 * Owner-scoped, so a mis-set `DATABASE_URL` pointing at somebody else's
 * articles takes nothing.
 */
import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "../../src/db/client.js";
import { articleRevisions, articles } from "../../src/db/schema.js";
import { currentOwnerId } from "../../src/owner.js";

export async function forgetRevisions(which: readonly string[]): Promise<void> {
  if (!which.length) return;
  const db = getDb();
  const mine = and(eq(articles.ownerId, currentOwnerId()), inArray(articles.slug, [...which]));
  await db.update(articles).set({ currentRevisionId: null }).where(mine);
  const rows = await db.select({ id: articles.id }).from(articles).where(mine);
  if (!rows.length) return;
  await db.delete(articleRevisions).where(
    inArray(
      articleRevisions.articleId,
      rows.map((r) => r.id),
    ),
  );
}
