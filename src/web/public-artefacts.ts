/**
 * **Which artefacts a shared payload turned out to have** — the one place the
 * client turns *keys that are present* into the five booleans everything else
 * reads.
 *
 * ## Why this exists at all, which is the interesting half
 *
 * Until slice 1b the answer came from a **second request** to a public metadata
 * endpoint, fetched immediately after the article, purely so a marked mode
 * could pick between two true sentences. Its failure was swallowed to `null`,
 * and `null` needed a fifth `VisitorGap` member and a sentence of its own so
 * that a lost request would not be rendered as a claim about somebody's
 * article.
 *
 * The four artefacts ride on the article payload now, so the payload answers
 * the question it used to ask: **a key that is present exists, and a key that
 * is absent was never built.** The request goes, its swallowed `catch` goes,
 * and the state that hedged it goes with them.
 * docs/plans/260827ai-public-read-only-access.md § The second request disappears.
 *
 * **The endpoint went too, on 2026-09-02.** This comment used to say it stayed,
 * for stage 2's link preview among others — which was never true: the preview
 * function calls `loadHead`, and for eight days nothing called the route at all
 * except a deployment checker, which now reads the article's own `meta.title`.
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster B.
 *
 * ## `in`, not truthiness, and not length
 *
 * The test is **presence of the key**, and the reason is smaller than it used
 * to say here. A truthiness test on the document agrees today, because an
 * artefact is an object. A length test on what is inside it agrees too — and
 * that is the correction: all four builders throw rather than write an empty
 * result (src/glossary.ts § buildGlossary and its three siblings), so
 * `{entries: []}` is not a state any article is in or can get into. Every
 * stored artefact was checked on 2026-08-29 and every one is absent or
 * non-empty.
 *
 * Presence stays the test anyway, for one honest reason: it asks the question
 * this function is *for* — did the payload carry one — rather than a question
 * about the contents that happens to have the same answer while a throw four
 * files away holds. If that throw is ever relaxed, presence keeps telling the
 * truth and a length test starts reporting a built artefact as never built.
 * docs/plans/260827ai-public-read-only-access.md § The state that cannot happen.
 */
import type { Comment } from "../types.js";
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
    ...(article.ideas === undefined ? {} : { ideas: article.ideas }),
    ...(article.quotes === undefined ? {} : { quotes: article.quotes }),
    ...(article.tweets === undefined ? {} : { tweets: article.tweets }),
    ...(article.timeline === undefined ? {} : { timeline: article.timeline }),
    ...(article.sketch === undefined ? {} : { sketch: article.sketch }),
  };
}

/**
 * The booleans, from the payload the page is already rendering.
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
    ideas: article.ideas !== undefined,
    quotes: article.quotes !== undefined,
    timeline: article.timeline !== undefined,
    sketch: article.sketch !== undefined,
  };
}

/**
 * **The owner's comments, as the reading view's own components want them.**
 *
 * A `PublicComment` deliberately carries no `status` — src/public-types.ts says
 * why: the public read refuses unfinished and failed rows in SQL, so the field
 * would be a constant on the wire as well as a fact about our machine. But
 * `Comment` requires one, and the drawer's preview line and the dialog both
 * branch on it, so somebody has to say what it is.
 *
 * **Derived, and there are exactly two answers it can be.** `none` is a bare
 * bookmark — the reader marked the words and asked nothing — and `done` is a
 * comment with an answer. Those are the only two states that cross, which is
 * the query's guarantee (`PUBLIC_COMMENTS_WHERE`), so this derivation cannot
 * invent a state the payload did not have. `pending` and `error` are
 * unreachable here, and if they ever became reachable this function would be
 * quietly wrong — which is why the guarantee is named rather than assumed.
 *
 * Done here rather than in the components, so there is one derivation instead
 * of one per reader of the field.
 */
export function visitorComments(article: PublicArticle): Comment[] {
  return article.comments.map(
    (comment): Comment => ({
      ...comment,
      status: comment.answer === undefined ? "none" : "done",
    }),
  );
}
