/**
 * **The shelf of public articles — the second ownerless query, and the first one
 * that enumerates.**
 *
 *     visibility = 'public' AND <readable>   order by public_at desc, slug   limit N
 *
 * The sibling of [`publicSlug`](public-slug.ts), and it keeps that file's
 * discipline for the same reason: nothing in this module's import graph can
 * reach `currentOwnerId`, so there is no owner here to reach for. What it adds
 * is a different and sharper danger, which is worth naming at the top because it
 * is not the one the existing guard was built for.
 *
 * ## Why a list is more dangerous than a lookup
 *
 * `publicSlug` answers *may this stranger read the thing they already named*. A
 * caller has to know the slug — and every slug minted since 2026-08-31 ends in
 * an unguessable short id (src/ingest.ts § `slugWithShortId`). This query answers
 * *what is there*, for somebody who names nothing at all. Get the predicate
 * wrong here and you do not leak one article to somebody who was already looking
 * for it; you publish the shelf.
 *
 * And the guard that exists would not have noticed:
 * [owner-isolation.test.ts](../../tests/owner-isolation.test.ts) greps
 * `src/store/` for `eq(articles.slug, …)`, and there is no slug in this file at
 * all. That is why that test grew a second section — *ownerless enumeration* —
 * which permits exactly the builder below, reads its generated SQL, and pins the
 * columns it selects. GPT Sol raised the shape of it reviewing
 * docs/plans/260904b-pricing-page-and-public-showcase.md § 5, and then found the
 * hole one level above it reviewing the built code: a request runs the
 * *transport* before either public door, so that section now cuts the anonymous
 * region out of `src/routes.ts` and `src/vercel.ts` as well and asserts it names
 * no table and imports nothing outside a short list.
 *
 * ## Three ceilings, and none of them is the other
 *
 * `PUBLIC_LIBRARY_LIMIT` bounds the **rows**. `PUBLIC_CARD_CHARS` bounds the
 * **bytes**, because nothing in this repo bounds a title or an `<h1>` and a
 * fetched document may be 32 MB. And `articles_public_listing` — a partial index
 * on `(public_at desc nulls last, slug) where visibility = 'public'`,
 * drizzle/20260904175802 — bounds the **work**, because without it Postgres can
 * sort the whole public corpus before applying the limit. All three arrived
 * together on 2026-09-04 out of the same review; each is useless without the
 * other two, on an endpoint with no session and no rate limit.
 *
 * ## A closed query, not a reusable predicate
 *
 * There is no exported `publicVisibility()` here, and that is deliberate rather
 * than an omission. `publicSlug` gets to be a predicate because it is welded to
 * a slug and cannot be pointed anywhere else; a bare *"visibility is public"*
 * predicate is a clause somebody can bolt onto any query in the repo, which is
 * the widening this whole feature is built to make impossible. The clause is
 * written inline, in one `where`, in one function, and the test reads the SQL
 * that function generates.
 *
 * ## The readability bar, which is not decoration
 *
 * A card is a promise that there is something to read at the other end of it.
 * `loadArticle` and `loadHead` both refuse a revision with no tree or no blocks
 * (public-reader.ts), so a listing without the same bar would put a card on the
 * shelf whose destination 404s the moment anybody presses it — a damaged or
 * half-published revision, advertised. The bar is in the `where` rather than in
 * a filter afterwards, so `limit` counts rows a reader could actually open.
 *
 * ## What this file may import
 *
 * The schema, the connection, the log and the failure sentence. **Not**
 * `public-reader.ts`, though it is right beside this and holds a `scrubbed` and
 * a heading-title expression that look identical: importing it would pull
 * `sanitize.ts` and jsdom into the graph of a query that has no HTML in it, and
 * the two copies are twelve lines against the cost route-names.ts was split out
 * to avoid. The duplication is the same trade the public reader's own header
 * defends — two readers that must not be one.
 *
 * See docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3a.
 */

import { and, asc, eq, isNotNull, sql, type AnyColumn } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { articleRevisions, articles, revisionBlocks } from "../db/schema.js";
import { log } from "../log.js";
import { STORAGE_FAILED } from "../messages.js";
import type { PublicLibrary, PublicLibraryEntry } from "../public-library-types.js";

/**
 * **How many cards an anonymous request may cost us**, and the reason there is
 * a number at all.
 *
 * Nobody is signed in, nothing is rate-limited beyond what the namespace has
 * (docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster C
 * is still open), and `select … from articles` with no bound is the one shape
 * that turns "somebody shared a lot of articles" into a response nobody
 * planned. 200 is far above anything this install will hold for a long while,
 * which is the point: it is a ceiling rather than a page size, so there is no
 * cursor to build, no `next` to keep right, and nothing for the client to
 * paginate through. When it starts biting, the honest next step is a cursor on
 * `(public_at, slug)` — which is exactly why the ordering below is a total one.
 */
const PUBLIC_LIBRARY_LIMIT = 200;

/**
 * **The other half of the ceiling, because 200 rows is not 200 of anything.**
 *
 * `PUBLIC_LIBRARY_LIMIT` bounds how many cards come back and says nothing at all
 * about how large one is. Every text column below is unbounded in the database:
 * extraction does not constrain a document's title (src/extract.ts), a fetched
 * document may be 32 MB (src/fetch.ts), and the `<h1>` fallback returns a
 * block's whole text — so **one deliberately enormous public heading, or a few
 * hundred merely large ones, turns an anonymous request into a very large
 * allocation and a very large response**. GPT Sol's finding 1 on stage 3a,
 * 2026-09-04.
 *
 * **Capped in the SQL, not in the mapping below**, and that is the whole point
 * rather than tidiness: truncating in JavaScript happens after Postgres has
 * built the rows, the driver has decoded them and the process is holding them.
 * By then every byte this is about has already crossed. `left()` does it in the
 * planner, so the bytes are never sent.
 *
 * The numbers are listing numbers, deliberately generous against what a card can
 * show and mean nothing anywhere else — the article page reads its title from
 * the article, not from here. `left()` counts characters rather than bytes, so
 * the honest worst case is roughly four times these, times 200 rows: about
 * 1.4 MB of text, which is a response rather than an incident.
 *
 * **`slug` is not capped**, and must not be: it is the link. `isSlug` bounds it
 * at 60 characters (src/ingest.ts § `MAX`), which is where that bound belongs.
 * `words` and `public_at` are a number and a timestamp.
 *
 * Exported because `tests/owner-isolation.test.ts` asserts an oversized fixture
 * comes back at exactly these lengths — a cap nothing measures is a cap that can
 * be quietly raised.
 */
export const PUBLIC_CARD_CHARS = {
  title: 300,
  gist: 1_200,
  siteName: 120,
} as const;

/** `left(col, n)`, with `n` written into the statement rather than bound. */
function capped(column: AnyColumn, chars: number) {
  /* `sql.raw` on a number this module owns: the cap belongs in the statement's
     text so the guard can read it there, and a bound parameter would put it in
     an array beside four others where nothing says which is which. */
  return sql<string | null>`left(${column}, ${sql.raw(String(chars))})`;
}

/**
 * The article's own first `<h1>`, in SQL — the middle step of the title
 * fallback.
 *
 * The same expression `PUBLIC_HEADING_TITLE` computes in public-reader.ts, and
 * the same `case` guard, so it runs only for the few articles that stored no
 * title of their own. Written again rather than imported for the reason in the
 * header: this file does not import the article reader.
 *
 * The two must agree, and something checks that they do — a card and the tab of
 * the page it opens are the same three-step fallback (`title ?? <h1> ?? slug`),
 * so a divergence here is a shelf whose headings change when you click them.
 *
 * **What checks it**, named rather than implied, because until 2026-09-04 the
 * sentence above was stronger than anything under it: `tests/owner-isolation.test.ts`
 * § the shelf of public articles has a fixture with no title, an `<h2>` before
 * its `<h1>` and a second `<h1>` after it, and asserts the card's title equals
 * `loadHead`'s. Changing `level = 1` to `2` here was watched failing it. GPT
 * Sol's finding 4, and it was right that the comment was a claim.
 *
 * The `left()` is `PUBLIC_CARD_CHARS.title`'s, applied **inside** the subselect
 * so a 30 MB heading is trimmed by the planner rather than carried out of it.
 */
const PUBLIC_LIBRARY_HEADING_TITLE = sql<string | null>`case
  when ${articleRevisions.title} is null then (
    select left(${revisionBlocks.text}, ${sql.raw(String(PUBLIC_CARD_CHARS.title))})
    from ${revisionBlocks}
    where ${revisionBlocks.revisionId} = ${articleRevisions.id}
      and ${revisionBlocks.kind} = 'heading'
      and ${revisionBlocks.level} = 1
    order by ${revisionBlocks.ordinal}
    limit 1)
end`;

/**
 * **The columns a public card may have**, written out rather than derived.
 *
 * Same reason `PUBLIC_PROJECTIONS` in public-reader.ts gives: a projection
 * assembled at runtime is opaque to Drizzle, which then types the row as the
 * whole table and stops being able to tell a selected column from an unselected
 * one — which is most of what a projection is for.
 *
 * Read the absences, because on this query they are the whole security posture.
 * No `owner_id`. No `title_override`, `purpose`, `archived_at`, `opens` or
 * `last_opened_at` — the owner's relationship with the document, which is not a
 * fact about the document. No `final_url`: a card is a link to *our* page, and
 * the source URL is published on the article page by `publicSourceUrl`, under a
 * policy this projection has no way to apply. No `excerpt` and no prose: the
 * blocks are not joined at all, so this cannot become a second renderer even by
 * accident, which is the line src/public/page.ts draws for the head.
 *
 * `tests/owner-isolation.test.ts` § ownerless enumeration pins this exact key
 * set, so adding a column is an edit somebody has to make twice, on purpose.
 */
const PUBLIC_LIBRARY_CARD = {
  slug: articles.slug,
  publicAt: articles.publicAt,
  /* Every `text` column goes out through `capped` — see `PUBLIC_CARD_CHARS` for
     why the cap is in the statement rather than in the `map` below. */
  title: capped(articleRevisions.title, PUBLIC_CARD_CHARS.title).as("title"),
  headingTitle: PUBLIC_LIBRARY_HEADING_TITLE.as("heading_title"),
  gist: capped(articleRevisions.rootGist, PUBLIC_CARD_CHARS.gist).as("root_gist"),
  siteName: capped(articleRevisions.siteName, PUBLIC_CARD_CHARS.siteName).as("site_name"),
  words: articleRevisions.wordCount,
} as const;

/**
 * **The listing, as a builder**, so a test can read the SQL this server will
 * send rather than a constant beside it.
 *
 * The same reason `publicCurrentRevisionQuery` takes its builder, and it matters
 * more here: the clause this whole route rests on is
 * `visibility = 'public'`, and the one place that is visible is the generated
 * statement. public-reader.ts § `publicCurrentRevisionQuery` records what
 * happened the last time a test asserted about a *nearby* query — a second,
 * inline `select` said the same thing, the test went on reading the helper, and
 * deleting the real predicate left the suite green with a private article at a
 * public URL.
 *
 * So: **every public listing read goes through this function.** A second
 * `select` from `articles` anywhere in the public import graph is a finding, and
 * the guard enumerates them rather than trusting this sentence.
 *
 * `articles` is joined but never selected wholesale — only `slug` and
 * `public_at` come off it, and both are things the visitor is about to be shown.
 */
export function publicLibraryQuery(
  db: Pick<ReturnType<typeof getDb>, "select">,
  limit: number,
) {
  return (
    db
      .select(PUBLIC_LIBRARY_CARD)
      .from(articles)
      /* The same join the article read uses, and it carries the same guarantee
         for free: `current_revision_id` only ever points at a published
         revision, so there is no `status` clause to remember here. It is an
         **inner** join, so an article with no current revision at all — a fresh
         row mid-ingest — simply is not on the shelf. */
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(
        and(
          /* The clause. Inline, once, and not behind a helper anybody could
             point at another table — see the header. */
          eq(articles.visibility, "public"),
          /* The readability bar, the same two questions `loadArticle` and
             `loadHead` ask, asked here in SQL because this query fetches
             neither a tree it could inspect nor blocks it could count.
             `exists`, not a count: the question is whether there is at least
             one, and counting every block of a long article to learn that it is
             more than zero is work the planner can skip only if we do not ask
             for it. */
          isNotNull(articleRevisions.tree),
          sql`exists (
            select 1 from ${revisionBlocks}
            where ${revisionBlocks.revisionId} = ${articleRevisions.id})`,
        ),
      )
      /* **A total order, not merely a sensible one.** `public_at` can tie —
         two articles shared in the same transaction, or by the same script —
         and a tie left to the planner comes back in one order locally and
         another in production, which is a shelf that reshuffles between
         reloads. `slug` is globally unique, so adding it makes the order total
         and makes a `(public_at, slug)` cursor possible later without changing
         what anybody sees.

         `nulls last` written out because Postgres puts nulls *first* under
         `desc`, and a row with `visibility = 'public'` and no `public_at`
         should not be able to head the list. `pg-visibility.ts` always stamps
         the column, so this is about a row nothing in today's code can produce
         — which is exactly the kind that turns up. */
      .orderBy(sql`${articles.publicAt} desc nulls last`, asc(articles.slug))
      .limit(limit)
  );
}

/** What the public route may ask for. One method, and it takes no arguments. */
export interface PublicLibraryReader {
  listPublic(): Promise<PublicLibrary>;
}

/**
 * **Nothing a database said leaves this file.**
 *
 * The local version of the rule [db-errors.ts](db-errors.ts) states at length,
 * and the same twelve lines public-reader.ts keeps for its own reads — see this
 * file's header for why they are not shared. The class name, never the message:
 * a failed Drizzle query puts every bound parameter into `Error.message`, and
 * pino's redaction matches key paths rather than text.
 *
 * There is no `status`-carrying refusal to let through here, because this route
 * has none: an empty shelf is a 200 with an empty list, not a 404. That is the
 * one place a listing differs from a lookup, and it is worth being explicit —
 * *"nobody has shared anything"* is an answer about the world, and a 404 would
 * make it look like the route was missing.
 */
async function scrubbed<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    log("store").error({ what, err: (err as Error)?.name }, "a public read failed");
    throw Object.assign(new Error(STORAGE_FAILED.message), { status: 500 });
  }
}

export const pgPublicLibraryReader: PublicLibraryReader = {
  async listPublic(): Promise<PublicLibrary> {
    return scrubbed("library", async () => {
      /* **One more than the cap**, which is how the answer knows it was capped.
         Asking for exactly `PUBLIC_LIBRARY_LIMIT` gives a full page that is
         indistinguishable from a shelf that happens to be exactly that size,
         and a list that quietly stops being the list is the failure shape
         docs/reusable/silent-success.md is about. */
      const rows = await publicLibraryQuery(getDb(), PUBLIC_LIBRARY_LIMIT + 1);
      const truncated = rows.length > PUBLIC_LIBRARY_LIMIT;

      const entries = rows.slice(0, PUBLIC_LIBRARY_LIMIT).map(
        (row): PublicLibraryEntry => ({
          slug: row.slug,
          /* The same three-step fallback `metaFrom` and `loadHead` use, so the
             card, the tab and the masthead say one thing. `??` and not `||`:
             an empty-string title is not a title, but neither is it the
             *absence* of one, and `||` would collapse the two.
             public-reader.ts § `loadHead` has the tab that changed in front of
             a reader when the third step was missing. */
          title: row.title ?? row.headingTitle ?? row.slug,
          gist: row.gist,
          siteName: row.siteName,
          words: row.words,
          publicAt: row.publicAt?.toISOString() ?? null,
        }),
      );

      return { entries, truncated };
    });
  },
};
