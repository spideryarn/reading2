/**
 * **Which artefacts a shared payload turned out to have** — the one place the
 * client turns *keys that are present* into the five booleans everything else
 * reads.
 *
 * ## Why this exists at all, which is the interesting half
 *
 * Until slice 1b the answer came from a **second request**:
 * `GET /api/public/metadata/:slug`, fetched immediately after the article,
 * purely so a marked mode could pick between two true sentences. Its failure
 * was swallowed to `null`, and `null` needed a fifth `VisitorGap` member and a
 * sentence of its own so that a lost request would not be rendered as a claim
 * about somebody's article.
 *
 * The four artefacts ride on the article payload now, so the payload answers
 * the question it used to ask: **a key that is present exists, and a key that
 * is absent was never built.** The request goes, its swallowed `catch` goes,
 * and the state that hedged it goes with them.
 * docs/plans/public-read-only-access.md § The second request disappears.
 *
 * **`GET /api/public/metadata/:slug` itself stays.** It is tested, it is in the
 * route inventory, and it is the honest small answer to *what does this article
 * have* for a later consumer — stage 2's link-preview function among them. What
 * was won here was never the route; it was the request.
 *
 * ## `in`, not truthiness, and not length
 *
 * A stored `{entries: []}` is a **ready but empty** artefact: somebody ran the
 * step and it found no terms. That is a different sentence from *nobody has
 * built a glossary for this piece yet*, and the reader is entitled to the
 * difference. So the test is presence of the key. A truthiness test on the
 * document agrees today, because an artefact is an object; a length test on
 * what is inside it collapses the two outright, which is the mutation
 * tests/visitor-gaps.test.ts runs as its control.
 */
import type { PublicArtefactSet, PublicArtefacts, PublicArticle } from "../public-types.js";

/**
 * The four artefacts, lifted off the payload into an object that holds nothing
 * else.
 *
 * `PublicArticle` already *extends* `PublicArtefactSet`, so passing the whole
 * payload down would typecheck and would be one line shorter. It is written out
 * instead for the same reason the DTOs on the server construct rather than
 * spread: the type would be the only fence, and the prose, the blocks and the
 * tree would still be sitting there at runtime for the first `as` to reach.
 * The reading view has an `Article` for those, sanitised, by a different route.
 */
export function artefactsOf(article: PublicArticle): PublicArtefactSet {
  return {
    /* Conditional spreads, because absent is the answer that means *never
       built* — see the note above on `in` rather than truthiness. */
    ...(article.glossary === undefined ? {} : { glossary: article.glossary }),
    ...(article.summary === undefined ? {} : { summary: article.summary }),
    ...(article.ideas === undefined ? {} : { ideas: article.ideas }),
    ...(article.tweets === undefined ? {} : { tweets: article.tweets }),
  };
}

/**
 * The five booleans, from the payload the page is already rendering.
 *
 * `arc` is read off the article rather than out of the artefact set, because it
 * has ridden along inside the article payload since slice 1a — it is the L0
 * column of the granularity zoom, not a mode of its own.
 */
export function artefactsIn(article: PublicArticle): PublicArtefacts {
  return {
    arc: article.arc !== undefined,
    tweets: article.tweets !== undefined,
    glossary: article.glossary !== undefined,
    summary: article.summary !== undefined,
    ideas: article.ideas !== undefined,
  };
}
