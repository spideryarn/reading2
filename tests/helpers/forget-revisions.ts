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
import { articleRevisions, articles, jobs } from "../../src/db/schema.js";
import { currentOwnerId } from "../../src/owner.js";
import { ACTIVE } from "../../src/store/pg-jobs.js";

/**
 * **Refuse a slug some job is still inside**, loudly, before anything is deleted.
 *
 * We share one local Postgres between a dozen agents and one dev server. On
 * 2026-09-02 a peer ran this against a slug a browser pass was mid-ingest on,
 * and the foreign key did the rest: `jobs.draft_revision_id` is `on delete set
 * null` (src/db/schema.ts), so deleting the revision took the pointer out of a
 * live claimant's job row without a line in anybody's log. That claimant's next
 * fenced write was refused, its job sat `running` behind a live lease for 12m40s
 * with the article's whole queue behind it, and Stop answered 200 and did
 * nothing.
 * docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md
 * is the diagnosis, and src/jobs.ts now ends that job instead of wedging — but
 * the reset still destroys a stranger's run, so it fails at its own call site
 * rather than quietly somewhere else.
 *
 * **Owner-scoped like the deletes below.** A revision belongs to an owner's
 * article, so only that owner's jobs can be pointed at one; widening this would
 * refuse a reset because of a job that could not possibly be reading it.
 *
 * The message names the job and says what to do, because whoever reads it is
 * halfway through a fixture and did not expect a job to exist at all.
 */
async function refuseIfAJobIsInside(which: readonly string[]): Promise<void> {
  const db = getDb();
  const busy = await db
    .select({ id: jobs.id, slug: jobs.slug, status: jobs.status })
    .from(jobs)
    .where(
      and(
        eq(jobs.ownerId, currentOwnerId()),
        inArray(jobs.slug, [...which]),
        inArray(jobs.status, [...ACTIVE]),
      ),
    )
    .limit(5);
  if (!busy.length) return;
  const named = busy.map((j) => `${j.id} (${j.status}) on "${j.slug}"`).join(", ");
  throw new Error(
    `forgetRevisions refuses to delete revisions while a job is working on them: ${named}. ` +
      `Deleting a draft out from under a live claim breaks that claimant's run — see ` +
      `docs/postmortems/260902f-a-lost-claim-that-was-never-lost-and-a-publication-that-was-never-buried.md. ` +
      `Wait for the job to finish, stop it, or use a slug nothing else knows the name of.`,
  );
}

export async function forgetRevisions(which: readonly string[]): Promise<void> {
  if (!which.length) return;
  await refuseIfAJobIsInside(which);
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
