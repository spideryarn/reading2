/**
 * **The owner's added Skim briefs** — the Postgres half, and the only one.
 * docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md
 * (report `spya-xyje0z`). The table is `skim_briefs` (src/db/schema.ts).
 *
 * The default brief is not here: its route is `article_revisions.skim`, read by
 * `loadSkim`. A brief's route is written by a `skim` job carrying
 * `Job.skimBrief` (src/jobs.ts § `runStep`), through the transaction shared by
 * `StoreSession.commit` and `writeSkimBriefRouteIn` (pg-skim-brief-route.ts).
 *
 * ## The article lock is the mutex, as in src/store/pg-chat.ts
 *
 * Every write takes `select … from articles … for update` first, so the
 * twelve-per-article limit is a decision rather than a race (two tabs creating
 * the twelfth and thirteenth at once), and a route write cannot interleave with
 * a delete. A job's session commit takes the article before the job row, which is the
 * order a step's commit takes them in (src/store/pg-session.ts), so the two
 * cannot deadlock.
 *
 * ## Owner-only
 *
 * Every reader-facing method resolves the article through `articleIdForOwned`,
 * so a stranger's slug is a 404 here as everywhere; a brief on another article
 * is a 404 too, because the key is `(article_id, id)`. The job's two methods
 * take the job's owner explicitly: a job outlives the request that made it.
 *
 * ## What may be logged from this file
 *
 * Ids, slugs, counts. **Never `brief`** — the reader's own words
 * (docs/project/logging.md) — and never a dismissal key, which carries a hash
 * of the reader's profile. Nothing here logs at all.
 */

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articles, jobs, skimBriefs } from "../db/schema.js";
import { isSpideryarnId } from "../ids.js";
import { currentOwnerId } from "../owner.js";
import { normaliseProfileText } from "../profile.js";
import { MAX_PURPOSE_CHARS, SKIM_BRIEFS_MAX, type Skim, type SkimFound } from "../types.js";
import type { SkimBriefRow, SkimBriefStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { ACTIVE } from "./jobs.js";
import { READ_COMMITTED } from "./isolation.js";
import { writeSkimBriefRouteIn } from "./pg-skim-brief-route.js";
import { ownedSlug } from "./owned-slug.js";
import { articleIdForOwned, currentSkimFreshness, requireSlug } from "./pg.js";

type Row = typeof skimBriefs.$inferSelect;

/** An error the route layer answers with its `status`, as `notFound` in src/store/pg.ts is. */
function refused(status: 400 | 404 | 409, message: string): Error {
  return Object.assign(new Error(message), { status });
}

const NO_SUCH_BRIEF = "No such Skim brief on this article.";

function briefOf(row: Row): SkimBriefRow {
  return {
    id: row.id,
    brief: row.brief,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    plannedAt: row.plannedAt === null ? null : row.plannedAt.toISOString(),
    skim: row.skim ?? null,
    profileNoticeDismissedFor: row.profileNoticeDismissedFor,
  };
}

/**
 * **The sentence, checked and normalised the way the article's purpose is** —
 * `normaliseProfileText`, the same trim the default's sentence gets, and the
 * same ceiling (`MAX_PURPOSE_CHARS`): a brief is the answer to the same
 * question, asked again. Refused, never cut; the message names no text.
 */
export function checkBrief(raw: unknown): string {
  if (typeof raw !== "string") throw refused(400, "brief must be a string");
  const brief = normaliseProfileText(raw);
  if (!brief) throw refused(400, "brief must not be empty");
  if (brief.length > MAX_PURPOSE_CHARS) {
    throw refused(400, `brief must be ${MAX_PURPOSE_CHARS} characters or fewer`);
  }
  return brief;
}

/** A brief id in the house format, or a 400. Client-minted, like a chat thread's. */
export function checkBriefId(raw: unknown): string {
  if (typeof raw !== "string" || !isSpideryarnId(raw)) throw refused(400, "id must be a spya- id");
  return raw;
}

async function rowFor(articleId: string, id: string, db: Pick<ReturnType<typeof getDb>, "select"> = getDb()) {
  const [row] = await db
    .select()
    .from(skimBriefs)
    .where(and(eq(skimBriefs.articleId, articleId), eq(skimBriefs.id, id)))
    .limit(1);
  return row;
}

/** Authorise while taking the mutex: a transfer can finish while this waits. */
async function lockOwnedArticle(slug: string, tx: Pick<ReturnType<typeof getDb>, "select">): Promise<string> {
  requireSlug(slug);
  const [article] = await tx.select({ id: articles.id }).from(articles)
    .where(ownedSlug(slug)).for("update").limit(1);
  if (!article) throw refused(404, "No such article.");
  return article.id;
}

const rawPgSkimBriefStore: SkimBriefStore = {
  async list(slug) {
    const articleId = await articleIdForOwned(slug);
    const rows = await getDb()
      .select({ brief: skimBriefs })
      .from(skimBriefs)
      .innerJoin(articles, eq(articles.id, skimBriefs.articleId))
      .where(and(eq(skimBriefs.articleId, articleId), ownedSlug(slug)))
      .orderBy(asc(skimBriefs.createdAt), asc(skimBriefs.id));
    return rows.map((row) => briefOf(row.brief));
  },

  async get(slug, id) {
    const articleId = await articleIdForOwned(slug);
    const [found] = await getDb().select({ brief: skimBriefs }).from(skimBriefs)
      .innerJoin(articles, eq(articles.id, skimBriefs.articleId))
      .where(and(eq(skimBriefs.articleId, articleId), eq(skimBriefs.id, id), ownedSlug(slug))).limit(1);
    const row = found?.brief;
    if (!row) throw refused(404, NO_SUCH_BRIEF);
    return briefOf(row);
  },

  async loadRoute(slug, id): Promise<SkimFound | null> {
    const brief = await rawPgSkimBriefStore.get(slug, id);
    if (!brief.skim || !Array.isArray(brief.skim.stops)) return null;
    return {
      skim: brief.skim,
      ...(await currentSkimFreshness(slug, brief.skim)),
      profileNoticeDismissedFor: brief.profileNoticeDismissedFor,
    };
  },

  /**
   * **Idempotent on the id**: the same id with the same sentence is the press
   * that already landed (a retried POST), and answers with that row; with a
   * different sentence it is a 409, never an overwrite.
   */
  async create(slug, id, brief) {
    return getDb().transaction(async (tx) => {
      const articleId = await lockOwnedArticle(slug, tx);
      const existing = await rowFor(articleId, id, tx);
      if (existing) {
        if (existing.brief === brief) return briefOf(existing);
        throw refused(409, "That brief id is already taken on this article.");
      }
      /* **An id a live job still targets is not free yet.** The job was queued
         for the deleted row, with that row's sentence in its profile, and its
         route write names the brief by id: a replacement under the same id
         would receive a route planned for words it does not have (GPT Sol's
         C5, plan 261027d). Asked under the article lock, which a job's
         completion also takes first (src/store/pg-session.ts), so a job seen
         ending here has ended. This does not fence a request that read the
         old sentence before deletion but inserts its job after re-creation:
         that route keeps the old profile hash, so differing replacement text
         is reported as `profileChanged`, as for an edit during a run.
         Refusing is one query where carrying the row's incarnation
         on every job would be a column, a wire field and a second fence. */
      const [live] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.ownerId, currentOwnerId()),
            eq(jobs.slug, slug),
            eq(jobs.skimBrief, id),
            inArray(jobs.status, [...ACTIVE]),
          ),
        )
        .limit(1);
      if (live) throw refused(409, "A route is still being planned for a brief that had this id. Try again in a moment.");
      const [held] = await tx
        .select({ n: count() })
        .from(skimBriefs)
        .where(eq(skimBriefs.articleId, articleId));
      if ((held?.n ?? 0) >= SKIM_BRIEFS_MAX) {
        throw refused(409, `An article can have at most ${SKIM_BRIEFS_MAX} Skim briefs besides its own. Delete one first.`);
      }
      const [row] = await tx.insert(skimBriefs).values({ articleId, id, brief }).returning();
      if (!row) throw new Error("the Skim brief insert returned no row");
      return briefOf(row);
    }, READ_COMMITTED);
  },

  /**
   * The sentence, and nothing else. The route stays, now planned for a
   * different sentence: its profile hash no longer matches the brief's
   * rendered profile, so the read says `profileChanged` and the band offers
   * *Plan it again* — the default's sentence works the same way.
   */
  async updateBrief(slug, id, brief) {
    return getDb().transaction(async (tx) => {
      const articleId = await lockOwnedArticle(slug, tx);
      const [row] = await tx
        .update(skimBriefs)
        .set({ brief, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(skimBriefs.articleId, articleId), eq(skimBriefs.id, id)))
        .returning();
      if (!row) throw refused(404, NO_SUCH_BRIEF);
      return briefOf(row);
    }, READ_COMMITTED);
  },

  async remove(slug, id) {
    return getDb().transaction(async (tx) => {
      const articleId = await lockOwnedArticle(slug, tx);
      const gone = await tx
        .delete(skimBriefs)
        .where(and(eq(skimBriefs.articleId, articleId), eq(skimBriefs.id, id)))
        .returning({ id: skimBriefs.id });
      return gone.length > 0;
    }, READ_COMMITTED);
  },

  /**
   * Conditional on the route, in the same statement, exactly as the default's
   * (src/store/pg-skim-notice.ts): a re-plan between the reader's read and
   * their press re-stamps `generatedAt`, and the dismissal must not land on a
   * route they never saw.
   */
  async dismissProfileNotice(slug, id, generatedAt, key) {
    return getDb().transaction(async (tx) => {
      const articleId = await lockOwnedArticle(slug, tx);
      const done = await tx.update(skimBriefs)
        .set({ profileNoticeDismissedFor: key, profileNoticeDismissedAt: sql`now()` })
        .where(
          and(
            eq(skimBriefs.articleId, articleId),
            eq(skimBriefs.id, id),
            sql`${skimBriefs.skim} ->> 'generatedAt' = ${generatedAt}`,
          ),
        )
        .returning({ id: skimBriefs.id });
      return done.length > 0;
    }, READ_COMMITTED);
  },

  async routeForJob(ownerId, slug, id) {
    const [row] = await getDb()
      .select({ skim: skimBriefs.skim })
      .from(skimBriefs)
      .innerJoin(articles, eq(articles.id, skimBriefs.articleId))
      .where(and(ownedSlug(slug, ownerId), eq(skimBriefs.id, id)))
      .limit(1);
    return row === undefined ? { found: false } : { found: true, skim: row.skim ?? null };
  },

  /**
   * **Fenced twice**: on the claim, as a step's commit is (`liveAttempt`,
   * src/store/job-fence.ts) — a claimant whose lease has lapsed writes nothing
   * and hears `StaleAttemptError` — and on the row, which a brief deleted (or
   * an article transferred: a transfer deletes every brief) since the job was
   * queued no longer has. That second case is `false`, not an error: the
   * reader asked for the brief to go, and the job ends having kept nothing.
   */
  async writeRoute(fence, ownerId, slug, id, skim: Skim) {
    return getDb().transaction(
      (tx) => writeSkimBriefRouteIn(tx, fence, ownerId, slug, id, skim),
      READ_COMMITTED,
    );
  },
};

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgSkimBriefStore: SkimBriefStore = guardDbStore("skim-briefs", rawPgSkimBriefStore);
