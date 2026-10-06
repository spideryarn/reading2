/**
 * **Finding one of this reader's articles by something that is not its slug.**
 *
 * Two questions, one file, because both exist for the same reason: since
 * 2026-08-31 a slug ends in a random short id (src/ingest.ts §
 * `slugWithShortId`), so a slug can no longer be *derived* from anything. What
 * used to be "guess the name and look under it" has to be "look it up".
 *
 * - `slugForUrlKey` — *do we already have this article?* This is the adoption
 *   half of `freeSlug` (src/jobs.ts), and the thing that stops one address in
 *   two spellings becoming two shelf cards and two invoices. A paper is also
 *   found by the address it was asked for, which need not be the paper's own.
 * - `slugForShortId` — *which article is this the id of?* The stable handle
 *   Greg asked for on 2026-08-31, so that a renamed slug can still be found:
 *
 *   > Yes, let's add a short id — and actually then we could in future allow
 *   > users to rename the slug, and redirect/find it from the short id. So make
 *   > sure it's globally unique.
 *
 *   The rename itself is not built. This is the lookup it would redirect
 *   through, and it is here now because a column nothing can read is a column
 *   nobody can trust.
 *
 * ## Owner-scoped, like everything else in here
 *
 * `articles.slug` and `articles.short_id` are both globally unique, so an
 * unfiltered lookup would find another reader's article and hand back its name.
 * `ownedByReader()` (src/store/pg.ts) is the same predicate `listArticles`
 * uses. `slugIsTaken` (slug-is-taken.ts) is the one sanctioned global lookup
 * and it deliberately returns a boolean and nothing else; neither of these
 * could, so neither of them is global.
 *
 * ## Why the URL match is not a `where` clause
 *
 * Two addresses are one article when their `urlKey`s match, and `urlKey` is a
 * JavaScript function over a normalised URL (src/ingest.ts) — not something
 * Postgres can be asked. So the reader's articles come back and the match
 * happens here.
 *
 * That is one query returning one row per article on a shelf, on each add. It
 * is affordable at alpha scale and it is not free for ever; the fix when it
 * stops being affordable is a stored `url_key` column with an index on it, and
 * that is a migration rather than a redesign. Naming it here so the next person
 * does not have to rediscover the shape.
 */

import { and, eq } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles } from "../db/schema.js";
import { urlKey } from "../ingest.js";
import { resolvePaperSource } from "../paper-sources.js";
import { guardDbStore } from "./db-errors.js";
import { ownedByReader } from "./pg.js";

/**
 * **The Postgres reads, wrapped rather than called bare.**
 *
 * A failed Drizzle query carries the whole statement and its bound parameters —
 * column list, `where`, and the owner's uuid — and on 2026-08-27 one of those
 * rendered in red under the Add box on the homepage. `guardDbStore`
 * (db-errors.ts) is what stops it, and it wraps an object because a guard you
 * have to remember to apply to each new method is a guard that is missing from
 * the next one. tests/store-guarded.test.ts.
 *
 * These two run on `POST /api/jobs`, which is exactly the path that broke.
 */
const db = guardDbStore("find-article", {
  /**
   * Every article row this reader owns, with its published revision's URL and
   * the address the reader asked for when the article was made.
   */
  articleUrls(): Promise<{ slug: string; url: string | null; requestedUrl: string | null; askedUrl: string | null }[]> {
    return getDb()
      .select({
        slug: articles.slug,
        url: articleRevisions.finalUrl,
        requestedUrl: articleRevisions.requestedUrl,
        askedUrl: articles.askedUrl,
      })
      .from(articles)
      .leftJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(ownedByReader());
  },

  /** The one row carrying this short id, if this reader owns it. */
  slugForId(shortId: string): Promise<{ slug: string }[]> {
    return getDb()
      .select({ slug: articles.slug })
      .from(articles)
      .where(and(ownedByReader(), eq(articles.shortId, shortId)))
      .limit(1);
  },
});

/**
 * The slug of this reader's article for this `urlKey`, if they have one.
 *
 * **A left join, not an inner one**, for the reason `articleExists`
 * (src/pipeline.ts) gives: the article row exists before its first revision is
 * published, and a slug with a row under it is spoken for. A row with no
 * published revision has no URL either, so it simply never matches — the join
 * is left so that the *breadth* is the same as every other claim question, not
 * because a draft could be adopted.
 *
 * ## Two addresses, and the second one only for a paper
 *
 * An article matches by **where its bytes came from** (`final_url`), as it
 * always has. Since 2026-10-06 a paper also matches by **the address the reader
 * asked for** (`articles.asked_url`): a `doi.org` link or a short link that
 * ends on a paper has the paper's address as its `final_url`, so the link
 * itself would otherwise find nothing, and pasting it twice would import and
 * charge for the paper twice. Plan 261006i.
 *
 * **Only when the article came through a paper source**: either `final_url`
 * or the published revision's `requested_url` resolves. A candidate may
 * redirect to an address the registry does not recognise, while its requested
 * address still identifies the source. Do not classify by `asked_url`: a
 * paper-looking pasted address could have led to an ordinary page.
 * A link to an ordinary page may be
 * one that is meant to move, like `example.com/latest`, and an article found
 * by it would be found for ever: Refresh reads `final_url` and never goes back
 * to the link. A paper's link does not move. GPT Sol's K3 on that plan;
 * widening it is a product decision, not a tidy-up.
 *
 * **`final_url` wins**, across the whole shelf and not row by row: the article
 * that is the paper beats one that was only asked for by the paper's address.
 * That is two passes on purpose, since one `find` with an `or` would answer
 * whichever row happened to come back first.
 *
 * An article that has never published still never matches. The asked-for
 * address is read only beside a `final_url`, and that is null without a
 * published revision.
 */
export async function slugForUrlKey(key: string): Promise<string | undefined> {
  if (key === "") return undefined;
  const rows = await db.articleUrls();
  const byFinalUrl = rows.find((row) => row.url !== null && urlKey(row.url) === key);
  if (byFinalUrl) return byFinalUrl.slug;
  return rows.find(
    (row) =>
      row.url !== null &&
      row.askedUrl !== null &&
      (resolvePaperSource(row.url) !== null ||
        (row.requestedUrl !== null && resolvePaperSource(row.requestedUrl) !== null)) &&
      urlKey(row.askedUrl) === key,
  )?.slug;
}

/**
 * The slug of this reader's article carrying this short id, if any.
 *
 * **The column, not the slug**, and that is the whole point of the column. The
 * first version of this function read `shortIdInSlug(row.slug)` and passed
 * every test in tests/find-article.test.ts, because every fixture slug still
 * ended in its own id — which is precisely the agreement a rename breaks. The
 * fixture there now carries a slug with no id in it, so a parse cannot answer
 * it. docs/reusable/silent-success.md.
 *
 * The filesystem store had no `articles` table and so nowhere to keep a handle
 * that outlives a name; it answered from the slug, and could not survive a
 * rename. That branch went with the store on 2026-09-05.
 */
export async function slugForShortId(shortId: string): Promise<string | undefined> {
  if (shortId === "") return undefined;
  return (await db.slugForId(shortId))[0]?.slug;
}

/* `articleUrlsOnDisk` and `fsSlugs` stood here until 2026-09-05 — the same two
   questions asked of one `meta.json` per directory under `data/`. They were the
   only callers of `fsLocations` and `dataRoot()` in this file, and they went
   with the flag that chose them. */
