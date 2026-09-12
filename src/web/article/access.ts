/**
 * **Who is allowed to read this article, and on what footing** — the two-step
 * that asks the owned route and then the public one, and the union it answers
 * with.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape the mode
 * controllers established a day earlier: a unit with its own reason to change
 * moves into a file of its own, keeping its code byte-for-byte, so `App.tsx`
 * stops knowing what is inside it. Its one consumer is `ArticlePage` next
 * door. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md,
 * and reader-capability.ts for what the answer becomes once the page has it.
 */

import { useEffect, useState } from "react";
import type { Article, Comment } from "../../types.js";
import { sanitizeArticle } from "../sanitize.js";
import type { SavedSearch } from "../useSearch.js";
import { apiFetch, readJson } from "../lib/api.js";
import { loadPublicArticle } from "../public-api.js";
import { beginArticleLoad, rehostImages, type ArticleLoad } from "../rehost.js";
import { renderArticleMaths } from "../maths.js";
import type {
  PublicArtefactSet,
  PublicArtefacts,
  PublicArticle,
} from "../../public-types.js";
import {
  artefactsIn,
  artefactsOf,
  visitorComments,
  visitorSearches,
} from "../public-artefacts.js";

/**
 * Which article this is, and **on what footing you are reading it**.
 *
 * Two answers rather than one, since 2026-08-28. Either the article is yours,
 * or it is somebody's and they have shared it — and every difference between
 * those two, from which endpoint is asked to which hooks are allowed to mount,
 * hangs off the value this hook returns.
 *
 * `owned` and `public` both carry an `Article`, and that is deliberate: the
 * reading view is one reading view. `PublicArticle` is structurally an
 * `Article` with fields absent rather than a parallel shape
 * (src/public-types.ts), so the prose, the tree, the spine and the zoom are
 * drawn by exactly the same components from exactly the same props. What
 * differs is what was *fetched*, not how it is drawn.
 */
type ArticleAccess =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** Not yours, and not shared. The two pages this ends at are in App above. */
  | { kind: "not-shared" }
  /**
   * **We could not tell whose this is, and nobody has shared it either.**
   *
   * The owned route answered 401 — after `apiFetch` had already refreshed once
   * and retried once — and the public route answered 404. Both halves matter:
   * a 401 on its own says nothing about the public entitlement, so it is only
   * when the public route *also* refuses that there is nothing left to draw.
   *
   * A state of its own rather than `error`, whose page is a `<pre>` with
   * nothing to press, and rather than `not-shared`, which asserts something
   * about the document that a 401 leaves us unable to know.
   * PublicChrome.tsx § ReauthRequiredPage.
   */
  | { kind: "reauth-required" }
  | { kind: "owned"; article: Article }
  | {
      kind: "public";
      article: Article;
      /**
       * **The owner's comments, read-only**, lifted out of the payload here for
       * the same reason `artefacts` is: the reading view takes an `Article`,
       * which is the shape the owner's path also produces, and these have no
       * owner-side equivalent on it to be confused with.
       * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.
       */
      comments: Comment[];
      /**
       * **The owner's saved searches, read-only**, lifted out here for the
       * reason `comments` above is.
       * docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4.
       */
      searches: SavedSearch[];
      /**
       * **The glossary, the summaries, the ideas and the tweet thread**, as
       * they arrived — inside the same payload as the prose.
       *
       * A separate field rather than left on the article because the reading
       * view takes an `Article`, which is the shape the owner's path also
       * produces; these four have no owner-side equivalent to be confused with.
       * Lifted out in `resolveAccess`, which is also the doorway `sanitizeArticle`
       * runs at — the artefacts do not go through it because nothing renders
       * them as HTML, and `block.html` is the only field on this page that
       * reaches `innerHTML`. src/web/sanitize.ts.
       */
      artefacts: PublicArtefactSet;
      /**
       * Which artefacts this piece has, as five booleans, derived from the
       * payload above rather than fetched.
       *
       * It used to be `PublicArtefacts | null`, filled by a **second** request
       * to a public metadata endpoint, since deleted, whose failure was
       * swallowed to `null` — and `null` needed a `VisitorGap` member and a
       * sentence of its own so that a lost request would not be rendered as a
       * claim about somebody's article. There is no second request now, so no
       * `null`: either this payload arrived or the reader is looking at
       * *this document isn't shared*. public-artefacts.ts.
       */
      available: PublicArtefacts;
      /**
       * **The reader has a session and we could not get it confirmed** — the
       * owned route answered 401 and this payload arrived anyway.
       *
       * On the chrome rather than on the capability seam, because it changes
       * nothing about what may be *done*: this reader is a visitor either way,
       * and the owner-only hooks are unreachable for the same structural
       * reason they are unreachable for a stranger. What it changes is what the
       * page *says* — PublicChrome.tsx § SharedNotice, and the chip beside it.
       */
      sessionUnconfirmed: boolean;
    };

const LOADING: ArticleAccess = { kind: "loading" };

/**
 * The two-step, in one hook.
 *
 * **With a session: ask the owned route, then the public one unless the first
 * one answered.** Without one: ask the public route directly.
 *
 * ## A 401 is a third answer, not a second 404
 *
 * It used to be treated as one — *"a session that expired is a reader with no
 * token, so ask the public route"* — and the result was that an owner whose
 * token could not be refreshed was silently reclassified as a stranger over
 * their own article, while `useSession` went on saying they were signed in so
 * nothing ever re-asked. Finding C3, 2026-09-02.
 *
 * The public route is still asked, because a 401 says nothing whatever about
 * the **public** entitlement and refusing a world-readable article over an
 * unrelated broken session couples two independent things. What changed is that
 * both answers now decide, and the reader is told:
 *
 * | owned | public | what they get |
 * |---|---|---|
 * | 404 | 200 | the shared article |
 * | 401 | 200 | the shared article, and a notice that the session is unconfirmed |
 * | 401 | 404 | `reauth-required` |
 *
 * Owner capabilities mount in neither 401 case, and that follows on its own
 * from going down the visitor arm: `ArticlePage` mounts `OwnedArticle` only for
 * `kind: "owned"`, and the private hooks live inside it, so they are not
 * skipped for this reader — they do not exist.
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C3.
 *
 * ## Why the public half is a bare `fetch`
 *
 * `apiFetch` attaches a bearer token and refreshes on a 401. If the public path
 * used it, then the one case this whole feature exists for — a stranger with no
 * account — would be exercised for the first time by a stranger, because every
 * developer, test and demo would have a session in hand. It would look like it
 * worked right up until it mattered. public-api.ts holds the plain `fetch`, and
 * the server half is built the same way round: `servePublicApi` is handed
 * `{res, path, method}` and never the request, so it cannot read a header even
 * by accident. docs/reusable/silent-success.md.
 */
export function useArticleAccess(slug: string, readerId: string | null): ArticleAccess {
  /**
   * The answer, **and both facts it is an answer about**: which article, and
   * **which reader**.
   *
   * The slug half is old, and the reason is that clearing state happens in the
   * effect below while an effect runs *after* the render that scheduled it — so
   * the first render after the slug changed still held the previous article,
   * and the children are keyed on the new slug, so a freshly mounted `Reader`
   * was handed the old article and drew it. Mostly invisible, because the fetch
   * usually lands before anybody reads a paragraph; not invisible in the tab,
   * where it produced titles like `<the article you just left> · Metadata`.
   * GPT Sol found that one, 2026-08-27.
   *
   * ## The reader half is a cross-reader exposure, and it is worse
   *
   * This keyed on the **boolean** `signedIn` until 2026-08-28. Owner A signs
   * out and reader B signs in: `slug` has not changed and `signedIn` is `true`
   * both times, so the effect never re-ran and **A's private article stayed on
   * B's screen, with `OwnedReader` and its three authenticated hooks mounted**.
   * Not for a frame — indefinitely. The owner-to-signed-out direction leaked it
   * for the render before the effect cleared, which is the same bug with a
   * shorter fuse.
   *
   * So the identity is in the key, and the comparison below is what makes it
   * mean something: an answer is only shown to the reader it was fetched for.
   * GPT Sol, reviewing this half, 2026-08-28.
   */
  const [answer, setAnswer] = useState<{
    slug: string;
    readerId: string | null;
    access: ArticleAccess;
  } | null>(null);

  useEffect(() => {
    /* Both can change under us — the slug via back/forward or a pasted link,
       the reader by signing in or out in another tab. Guard the response so a
       slow first fetch cannot overwrite a fast second one. */
    /* **Ownership is claimed here, synchronously, before any await** — and
       handed back by this effect's own cleanup. It used to be claimed inside
       `rehostImages`, which runs only after the article payload has come back,
       so *whose turn it was* was decided by which request finished last: a slow
       article A returning after the reader had moved to B would revoke **B's**
       object URLs and abort B's fetches, blanking the article on screen. That
       is not rare — `<StrictMode>` double-invokes every effect in development.
       rehost.ts § `ArticleLoad`, GPT Sol 2026-09-06. */
    const load = beginArticleLoad();
    let live = true;
    setAnswer(null);
    void resolveAccess(slug, readerId !== null, load)
      .then(({ access, withImages }) => {
        if (!live) return;
        setAnswer({ slug, readerId, access });
        /* **The second draw**, and the same `live` guard for the same reason:
           this one lands a second or so after the first, which is comfortably
           long enough for the reader to have clicked something else. Without the
           guard it would put the article they just left back on the screen.

           An ordinary state transition rather than an `img.src = …` written into
           the live DOM — `TableView` re-renders a block's html whenever its
           annotations change, and would erase an imperative write while leaving
           the object URL behind it unrevoked. GPT Sol, 2026-09-06. */
        void withImages.then(
          (drawn) => live && drawn && setAnswer({ slug, readerId, access: drawn }),
        );
      })
      .catch(
        (e: Error) =>
          live && setAnswer({ slug, readerId, access: { kind: "error", message: e.message } }),
      );
    return () => {
      live = false;
      /* **And the resources, which `live` does not touch.** Leaving the reader
         for the shelf, an article that turns out not to be shared, a payload
         that hangs, an unmount while the second draw is still coming: none of
         those reaches another `rehostImages`, so before this line each one left
         a load fetching and its blobs allocated for the rest of the session. */
      load.release();
    };
  }, [slug, readerId]);

  /**
   * **Both, and synchronously.**
   *
   * `setAnswer(null)` in the effect is a render too late: React runs effects
   * after the render that scheduled them, so on the first render after an
   * identity change the state still holds the previous reader's answer. Testing
   * it here rather than trusting the effect to have cleared it is the whole
   * difference between "the wrong article is shown for one frame" and "the
   * wrong article is never shown".
   */
  return answer?.slug === slug && answer.readerId === readerId ? answer.access : LOADING;
}
/**
 * Which article this reader is entitled to, and on what footing.
 *
 * **Split in two so that `sanitizeArticle` is called exactly once.** The
 * function below finds the payload and this one is the doorway every article
 * comes through on its way into component state — one line, on both paths, with
 * no branch that can grow a third. `tests/sanitize-client.test.ts` reads this
 * file to check it, and the reason a source-level check is worth having is that
 * the failure it guards against is silent: an unsanitised `block.html` renders
 * perfectly.
 *
 * Stage 3 cleaned this HTML under *jsdom's* parser and we are about to hand it
 * to *Chrome's*. It has to happen before anything reads `block.html` — both
 * `renderedText` and `annotateHtml` parse it with `innerHTML` ahead of React.
 * See src/web/sanitize.ts.
 *
 * **And it is not optional on the public path.** A public payload is the same
 * extracted HTML through a different projection, so it reaches `innerHTML` by
 * exactly the same route. The one thing worse than an unsanitised article is an
 * unsanitised article on the one page we invite strangers to.
 */
/**
 * The article as it is now, and the article as it will be when its own images
 * arrive.
 *
 * See `rehostImages` (rehost.ts § The article twice) for why there are two of
 * them at all. What this type adds is that the second one is a whole
 * `ArticleAccess` rather than an `Article`: the public arm carries four things
 * derived beside the article, and handing the caller a bare article would make
 * the hook responsible for rebuilding a union it has no business knowing the
 * shape of.
 */
interface ResolvedAccess {
  access: ArticleAccess;
  /** `null` when there was never a second draw coming, which is most articles. */
  withImages: Promise<ArticleAccess | null>;
}

/** Nothing of ours to draw on this one, so there is no second draw. */
const NO_SECOND_ANSWER: Promise<ArticleAccess | null> = Promise.resolve(null);

/* Exported for tests/maths-access.test.ts, which drives the fallback below; the
   hook above is its only caller in the app. */
export async function resolveAccess(
  slug: string,
  signedIn: boolean,
  load: ArticleLoad,
): Promise<ResolvedAccess> {
  const found = await findArticle(slug, signedIn, load.signal);
  if (found.kind === "not-shared" || found.kind === "reauth-required") {
    return { access: found, withImages: NO_SECOND_ANSWER };
  }
  /* **`rehostImages` runs AFTER `sanitizeArticle`, and the order is the whole
     of why it is here at all.** `stripOwnApiUrls` (src/sanitize-policy.ts)
     removes any `src` resolving to our own API, deliberately — an article may
     not point a reader's browser at our endpoints — so a URL of ours written
     before this line would be deleted by the line itself. rehost.ts § Why it
     cannot be done in the pipeline has the rest, including the tempting way
     round it and why not to take it.

     **On both branches**, for `sanitizeArticle`'s own reason: a shared article
     is the same extracted HTML through a different projection, and a visitor
     looking at eight blank figures is the reported bug with the audience we
     invited. What differs is only how the bytes are reached — `apiFetch` with a
     token on `/api/asset/…` for an owner, a bare `publicFetch` on
     `/api/public/asset/…` for a visitor — which is the `footing` argument and
     nothing else. Both end in a `blob:`, and rehost.ts § Why every picture
     arrives as a `blob:` says what changed on 2026-09-06 and why.

     **Two answers back, not one**, since stage E switched the article's own
     images on: the first has the PDF figures in it and every image we hold a
     copy of blanked, and the second — a moment later — has the copies. The
     prose must not wait for a hundred pictures, and the publisher's URL must
     not be in the markup while we fetch ours, because by the time we swapped it
     the reader would already have been counted. rehost.ts § The images are
     blanked before the prose draws.

     **And maths is drawn between the two** (maths.ts): after the sanitiser, so
     temml's markup is written onto html the policy has already passed — and
     then maths.ts puts each changed block back through that same policy, and
     puts the new-tab links back on, because the markup arrived after the pass
     the reading view relies on. Here rather than in the prose so that
     `renderedText`, `annotateHtml` and the live DOM all read the same html.

     **One object, `presentable`, reaches both draws and the fallback** — the
     plan's F10. Were the fallback a separate, unrendered local, an image that
     failed to arrive would put raw TeX back on the page. */
  const presentable = await renderArticleMaths(sanitizeArticle(found.article), {
    signal: load.signal,
  });
  const rehosted = await rehostImages(
    presentable,
    slug,
    found.kind === "owned" ? "owned" : "public",
    load,
  );

  /**
   * The whole answer for one article, given which of the two draws we are on.
   *
   * **A closure over `found` rather than a second literal**, because everything
   * in the public arm below is derived from the *raw* payload and is identical
   * on both draws — copying it would be four derivations that have to agree, one
   * of which (`visitorComments`) is the kind of thing that gets edited on one
   * copy only.
   */
  const accessWith = (article: Article): ArticleAccess =>
    found.kind === "owned"
      ? { kind: "owned", article }
      : {
          kind: "public",
          article,
          artefacts: artefactsOf(found.article),
          available: artefactsIn(found.article),
          /* Derived here, once, on the raw payload — `visitorComments` supplies
             the `status` a `PublicComment` deliberately does not carry, and says
             why. src/web/public-artefacts.ts. */
          comments: visitorComments(found.article),
          /* Derived here too, once, and for the same reason — `visitorSearches`
             supplies the `status` a `PublicSearchRun` deliberately does not
             carry. src/web/public-artefacts.ts. */
          searches: visitorSearches(found.article),
          sessionUnconfirmed: found.sessionUnconfirmed,
        };

  return {
    access: accessWith(rehosted.article),
    /* **`catch`, and it falls back to `presentable` rather than to `null`.**
       The second draw is decoration on an article the reader already has, so a
       rejection must not turn a successful load into an error page. But `null`
       would leave the *first* draw standing — and that draw deliberately has
       every stored image's `src` removed, so an unexpected throw would leave
       blank boxes for ever rather than losing only the pictures. `presentable`
       is the sanitised article, maths drawn, with the publishers' own URLs
       still in it, which is exactly what a reader saw before the pictures were
       ours. GPT Sol, 2026-09-06. */
    withImages: rehosted.images
      /* `null` is *no second draw was ever coming*, which `rehostImages` only
         says when it blanked nothing — so there is nothing to put right and the
         first draw stands. Mapping it to `presentable` here would drop a PDF's
         figures back out of an article that had just been given them. */
      .then((article) => (article ? accessWith(article) : null))
      .catch(() => accessWith(presentable)),
  };
}
/**
 * The two-step itself: the owned route, then the public one. Raw payloads.
 *
 * **`signal` is the article load's**, and it is here for the reason `ArticleLoad`
 * exists at all (rehost.ts): a load owns its own requests, so that a reader who
 * moves on stops paying for the one they left. Until 2026-09-07 the load's
 * controller reached the *asset* fetches and not the payload fetch above them,
 * which is the larger of the two — so releasing a load abandoned a 150KB
 * download rather than cancelling it. Nothing visible was wrong: the `live`
 * guard already refuses the stale render, and this is the resource half of the
 * same rule. GPT Sol, reviewing the built code.
 */
async function findArticle(
  slug: string,
  signedIn: boolean,
  signal: AbortSignal,
): Promise<
  | { kind: "not-shared" }
  | { kind: "reauth-required" }
  | { kind: "owned"; article: Article }
  | { kind: "public"; article: PublicArticle; sessionUnconfirmed: boolean }
> {
  /**
   * **What the owned route could not tell us**, carried down to the public one.
   *
   * `false` unless the owned route answered 401, which is the only status that
   * leaves the question of ownership open. A 404 closes it — *not mine* — and
   * needs nothing carried.
   */
  let sessionUnconfirmed = false;
  if (signedIn) {
    const res = await apiFetch(`/api/article/${encodeURIComponent(slug)}`, { signal });
    /* 404 is *not mine*; 401 is *we cannot tell*, after `apiFetch` has already
       spent its one refresh and one retry on it (lib/api.ts). Everything else,
       `readJson` turns into a message — including a 500, which must not be
       quietly retried against the public route and rendered as somebody else's
       shared document. */
    if (res.status === 401) sessionUnconfirmed = true;
    else if (res.status !== 404) {
      return { kind: "owned", article: await readJson<Article>(res) };
    }
  }

  /* **One request, and it used to be two.** A second GET, for a public metadata
     endpoint, stood here purely to learn which artefacts existed, with its
     failure swallowed to `null`. The artefacts are in this payload now, so the
     payload answers that.

     A comment here said the endpoint itself stayed *"for stage 2's link
     preview"*, and it was false when it was written: the preview function calls
     `loadHead`. The route was deleted on 2026-09-02 with nothing but a
     deployment checker on it.
     docs/plans/260827ai-public-read-only-access.md § The second request
     disappears, and
     docs/plans/260902j-public-read-only-access-audit-and-improvements.md
     § Cluster B. */
  const read = await loadPublicArticle(slug, signal);
  /* **Both answers, and this is the line where they meet.** *Nobody shared it*
     is a complete answer to a reader we could identify; to one we could not it
     is only half of one, and the reader needs a way back in rather than a
     sentence about a document we cannot say is theirs. */
  if (read.kind === "not-shared")
    return sessionUnconfirmed ? { kind: "reauth-required" } : { kind: "not-shared" };
  return { kind: "public", article: read.body, sessionUnconfirmed };
}