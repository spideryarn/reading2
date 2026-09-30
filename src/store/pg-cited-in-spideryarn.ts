/**
 * **The articles a cited work could be matched to: the reader's own, and public
 * ones — never anybody else's private article, not even its existence.**
 *
 * The read half of Citations' *In your library* / *On the public shelf* link,
 * SPIDERYARN-READING2-5R,
 * docs/plans/260930b-citations-say-when-a-cited-work-is-already-in-spideryarn.md.
 * The matching is src/cited-in-spideryarn.ts; this file only decides which
 * articles are candidates and what of each may be matched against, and the
 * first of those is **the `where` below and nothing else**. There is no filter
 * afterwards that a private row could slip past, and nothing about a row that
 * fails the `where` — its title, its URL, whether it exists — leaves Postgres.
 *
 * - **Whose**: `owner_id` is the signed-in reader, **or** `visibility =
 *   'public'`. The owner is `currentOwnerId()`, taken here and never a
 *   parameter of the exported read, so no caller can ask on somebody else's
 *   behalf (GPT Sol, plan review). The query builder takes it only so a test can
 *   read the SQL.
 * - **Openable**: a current revision with a tree and at least one block — the
 *   bar `loadArticle` and the shelf both apply, so a link we draw never opens a
 *   404 — and not archived, because archived is off every shelf.
 *
 * **What of a stranger's article may be matched against** is the second rule,
 * and it is what the public page itself already publishes:
 *
 * - its **extracted** title and byline, as the public shelf shows them — never
 *   `title_override`, the owner's relationship with the document
 *   (public-library.ts § `PUBLIC_LIBRARY_CARD`). The `case` is in SQL, so a
 *   stranger's rename is never read into this process.
 * - its `final_url` **only as `publicSourceUrl` passes it**, and never its
 *   `requested_url`. A signed or query-carrying address can be the owner's own
 *   paywall bypass; matching on it would confirm which public article it
 *   belongs to without ever printing it (GPT Sol, plan review). The raw value is
 *   read into this process and filtered here, below, before the matcher sees
 *   it; `requested_url` is nulled in SQL.
 *
 * `owner_id` itself is never selected — only whether it is this reader's.
 *
 * **Unbounded, deliberately, and named**: a `limit` here would silently drop
 * matches. At beta scale it is hundreds of short rows per Citations load; the
 * plan names the next step (a stored match key) for when it is thousands.
 */

import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { CitedCandidate } from "../cited-in-spideryarn.js";
import { getDb } from "../db/client.js";
import { articleRevisions, articles, revisionBlocks } from "../db/schema.js";
import { currentOwnerId } from "../owner.js";
import { publicSourceUrl } from "../urls.js";
import { guardDbStore } from "./db-errors.js";

/** Longer than any title, byline or URL worth matching; the cap is in the statement. */
const TEXT_CHARS = 300;
const URL_CHARS = 2048;

const cap = (chars: number) => sql.raw(String(chars));

/** The builder, so a test can read the SQL this server sends. */
export function citedCandidatesQuery(db: Pick<ReturnType<typeof getDb>, "select">, ownerId: string) {
  const mine = sql`${articles.ownerId} = ${ownerId}`;
  return db
    .select({
      slug: articles.slug,
      mine: sql<boolean>`(${mine})`.as("mine"),
      requestedUrl: sql<string | null>`case when ${mine}
          then left(${articleRevisions.requestedUrl}, ${cap(URL_CHARS)}) end`.as("requested_url"),
      finalUrl: sql<string | null>`left(${articleRevisions.finalUrl}, ${cap(URL_CHARS)})`.as("final_url"),
      matchTitle: sql<string | null>`left(${articleRevisions.title}, ${cap(TEXT_CHARS)})`.as("match_title"),
      displayTitle: sql<string | null>`left(case when ${mine}
          then coalesce(${articles.titleOverride}, ${articleRevisions.title})
          else ${articleRevisions.title} end, ${cap(TEXT_CHARS)})`.as("display_title"),
      byline: sql<string | null>`left(${articleRevisions.byline}, ${cap(TEXT_CHARS)})`.as("byline"),
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(
      and(
        or(eq(articles.ownerId, ownerId), eq(articles.visibility, "public")),
        isNull(articles.archivedAt),
        isNotNull(articleRevisions.tree),
        sql`exists (
          select 1 from ${revisionBlocks}
          where ${revisionBlocks.revisionId} = ${articleRevisions.id})`,
      ),
    );
}

/** Every candidate for the signed-in reader, except the article being read. */
async function citedCandidates(exceptSlug: string): Promise<CitedCandidate[]> {
  const rows = await citedCandidatesQuery(getDb(), currentOwnerId());
  return rows
    .filter((row) => row.slug !== exceptSlug)
    .map((row) => {
      const finalUrl = row.finalUrl === null ? null : row.mine ? row.finalUrl : publicSourceUrl(row.finalUrl);
      return {
        slug: row.slug,
        mine: row.mine,
        urls: [row.mine ? row.requestedUrl : null, finalUrl].filter(
          (u): u is string => typeof u === "string" && u !== "",
        ),
        matchTitle: row.matchTitle,
        displayTitle: row.displayTitle,
        byline: row.byline,
      };
    });
}

const rawPgCitedInSpideryarnStore = { citedCandidates };

/** Guarded where it is built, not where it is selected — src/store/db-errors.ts. */
export const pgCitedInSpideryarnStore = guardDbStore("cited-in-spideryarn", rawPgCitedInSpideryarnStore);
