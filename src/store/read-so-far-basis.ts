/**
 * **The shelf's how-much-read pie: whether a cached denominator is still true,
 * and the bands for a page of cards in one statement** — Greg's answer to
 * docs/user-feedback/questions/q-y78eth.md, 2026-10-25: *"1A"*, every shelf
 * card shows the same pie as the top of the article.
 * docs/plans/261025l-shelf-cards-show-the-how-much-read-pie.md.
 *
 * The masthead's band is `readBand(shareRead(levels, readSoFarWords(blocks,
 * foldedOnArrival(article))))`. The levels are cheap; the words are not,
 * because which blocks fold depends on every block's text (matter-current.ts §
 * `matterForReader`). So `read_so_far_words` caches the words, written by the
 * reading-time flush from the owner's own `loadArticle`
 * (pg-reading-time.ts § `refreshShelfWords`), and this file reads them.
 *
 * A leaf beside pg.ts rather than inside it: the shelf's read (pg.ts §
 * `listArticles`) imports it, and the writer imports pg.ts.
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles, readSoFarWords, readingTime } from "../db/schema.js";
import { MATTER_READABLE_VERSIONS } from "../matter-current.js";
import { currentOwnerId } from "../owner.js";
import { shareOfWords } from "../reading-so-far.js";
import { SANITIZER_VERSION } from "../sanitize-policy.js";
import type { BlockId, LibraryEntry } from "../types.js";
import { type ReadBand, readBand } from "../web/read-filter.js";

/**
 * **Bump this when the rule that picks the counted words changes** without any
 * stored input changing: `foldedOnArrival` and `matterStretches`
 * (web/matter-view.ts), `frontMatter` (web/front-matter.ts), `mastheadEcho`
 * (web/masthead-echo.ts), `countsTowardReadingTime` (block-policy.ts) or
 * `readSoFarWords` (web/read-filter.ts). Every cached row then reads as stale
 * and its card shows no pie until the next flush writes it again, rather than
 * a band the masthead would no longer agree with.
 * tests/read-so-far-basis.test.ts pins the two fold files beside this value.
 */
export const READ_SO_FAR_RECIPE = "rsf/1";

/**
 * **Every input `foldedOnArrival` reads, as stored, plus the code that reads
 * them**, hashed — over `articles` joined to its current `article_revisions`:
 *
 * - the current revision id: its blocks never change, nor does the title's
 *   first-`<h1>` fallback, which is read from them;
 * - `md5(matter)`, because the step rewrites matter in place and a new
 *   revision carries it;
 * - the revision's `title`, `byline` and `authors`, the article's
 *   `title_override` and its slug: the title, the rename flag and the names
 *   (pg.ts § `loadArticle`, `metaFrom`, `withAuthors`);
 * - the recipe, the sanitiser's version (`loadArticle` cleans the blocks under
 *   today's) and the matter versions a read still accepts.
 *
 * A `jsonb_build_array`, never a joined string, so a null, an empty string
 * and a value holding the separator cannot collide. One expression for the
 * writer and the shelf, so the two cannot disagree about whether a row is fresh.
 */
export function readSoFarBasis(): SQL<string> {
  const accepted = [...MATTER_READABLE_VERSIONS].sort().join(" ");
  return sql<string>`md5(jsonb_build_array(
    ${READ_SO_FAR_RECIPE}::text, ${SANITIZER_VERSION}::int, ${accepted}::text,
    ${articles.currentRevisionId}, md5(${articleRevisions.matter}::text),
    ${articleRevisions.title}, ${articleRevisions.byline}, ${articleRevisions.authors},
    ${articles.titleOverride}, ${articles.slug}
  )::text)`;
}

/** The pie's bands; "none" draws nothing, so it is never sent. */
export type ShelfReadBand = NonNullable<LibraryEntry["readBand"]>;

/* The wire's four are the shared five less "none", or this fails to compile. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameBands: Same<ShelfReadBand, Exclude<ReadBand, "none">> = true;
void sameBands;

/**
 * **The band for each of these articles that has a fresh cached denominator**,
 * in one statement. Absent for an article with no row, a stale row, or a band
 * of "none": the card then draws no pie, as the masthead draws none before the
 * reading time has loaded. The seconds come back as one object per article,
 * so no block text crosses the wire.
 *
 * Owner-scoped in the statement as well as by its caller, whose ids are
 * already this reader's (pg.ts § `listArticlesQuery`).
 */
export async function shelfReadBands(
  articleIds: readonly string[],
  db: Pick<ReturnType<typeof getDb>, "select"> = getDb(),
): Promise<Map<string, ShelfReadBand>> {
  if (!articleIds.length) return new Map();
  const rows = await db
    .select({
      articleId: readSoFarWords.articleId,
      words: readSoFarWords.words,
      seconds: sql<Record<string, number>>`(
        select coalesce(jsonb_object_agg(${readingTime.blockId}, ${readingTime.seconds}), '{}'::jsonb)
        from ${readingTime} where ${readingTime.articleId} = ${articles.id})`.as("seconds"),
    })
    .from(readSoFarWords)
    .innerJoin(articles, eq(articles.id, readSoFarWords.articleId))
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(
      and(
        inArray(readSoFarWords.articleId, [...articleIds]),
        eq(articles.ownerId, currentOwnerId()),
        eq(readSoFarWords.basis, readSoFarBasis()),
      ),
    );
  const out = new Map<string, ShelfReadBand>();
  for (const row of rows) {
    const band = readBand(shareOfWords(row.seconds, new Map(Object.entries(row.words)) as Map<BlockId, number>));
    if (band !== "none") out.set(row.articleId, band);
  }
  return out;
}
