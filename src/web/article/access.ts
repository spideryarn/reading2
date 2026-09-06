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
    let live = true;
    setAnswer(null);
    void resolveAccess(slug, readerId !== null)
      .then((access) => live && setAnswer({ slug, readerId, access }))
      .catch(
        (e: Error) =>
          live && setAnswer({ slug, readerId, access: { kind: "error", message: e.message } }),
      );
    return () => {
      live = false;
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
async function resolveAccess(slug: string, signedIn: boolean): Promise<ArticleAccess> {
  const found = await findArticle(slug, signedIn);
  if (found.kind === "not-shared" || found.kind === "reauth-required") return found;
  const article = sanitizeArticle(found.article);
  return found.kind === "owned"
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
}

/** The two-step itself: the owned route, then the public one. Raw payloads. */
async function findArticle(
  slug: string,
  signedIn: boolean,
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
    const res = await apiFetch(`/api/article/${encodeURIComponent(slug)}`);
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
  const read = await loadPublicArticle(slug);
  /* **Both answers, and this is the line where they meet.** *Nobody shared it*
     is a complete answer to a reader we could identify; to one we could not it
     is only half of one, and the reader needs a way back in rather than a
     sentence about a document we cannot say is theirs. */
  if (read.kind === "not-shared")
    return sessionUnconfirmed ? { kind: "reauth-required" } : { kind: "not-shared" };
  return { kind: "public", article: read.body, sessionUnconfirmed };
}
