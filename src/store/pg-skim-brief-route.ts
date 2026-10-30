/** Transaction-bound brief completion, shared by the store and the job session. */
import { and, eq, sql } from "drizzle-orm";

import type { getDb } from "../db/client.js";
import { articles, jobs, skimBriefs } from "../db/schema.js";
import type { OwnerId, Skim } from "../types.js";
import { liveAttempt } from "./job-fence.js";
import { StaleAttemptError } from "./jobs.js";
import { ownedSlug } from "./owned-slug.js";

/** The session uses its own transaction so the route, publication and job ending are one act. */
export async function writeSkimBriefRouteIn(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  fence: { jobId: string; attempt: string },
  ownerId: OwnerId,
  slug: string,
  id: string,
  skim: Skim,
): Promise<boolean> {
  const [article] = await tx
    .select({ id: articles.id })
    .from(articles)
    .where(ownedSlug(slug, ownerId))
    .for("update")
    .limit(1);
  const [live] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(liveAttempt(fence.jobId, fence.attempt))
    .for("update")
    .limit(1);
  if (!live) throw new StaleAttemptError(fence.jobId);
  if (!article) return false;
  const written = await tx
    .update(skimBriefs)
    .set({ skim, plannedAt: sql`clock_timestamp()` })
    .where(and(eq(skimBriefs.articleId, article.id), eq(skimBriefs.id, id)))
    .returning({ id: skimBriefs.id });
  return written.length > 0;
}
