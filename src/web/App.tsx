import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { throttle, useQueryState } from "nuqs";
import type {
  Article,
  Block,
  BlockId,
  GlossaryEntry,
  Idea,
  Quote,
  ReviewStance,
  ThreadKind,
} from "../types.js";
import { Library } from "./Library.js";
import { AuthCallback } from "./AuthCallback.js";
import { HomeLogo } from "./HomeLogo.js";
import { isAdmin } from "../admin.js";
import { AdminHome, AdminUsersPage } from "./AdminPage.js";
import { LandingPage } from "./LandingPage.js";
import { SignInPage } from "./SignInPage.js";
import { useSession } from "./useSession.js";
import { DesignPage } from "./DesignPage.js";
import { ProfilePage } from "./ProfilePage.js";
import { AddPage } from "./AddPage.js";
import { type ArticleView, LIBRARY_HREF, navigate, useRoute } from "./router.js";
import { Metadata } from "./Metadata.js";
import { IdeasPanel } from "./IdeasPanel.js";
import { useIdeas } from "./useIdeas.js";
import { TimelinePanel } from "./TimelinePanel.js";
import { useTimeline } from "./useTimeline.js";
import { Tweets } from "./Tweets.js";
import { sanitizeArticle } from "./sanitize.js";
import { TableView } from "./TableView.js";
import type { TermSelection } from "./annotate.js";
import { formsOf } from "../term-match.js";
import { horizontalInset, safeAreaInsets } from "./safe-area.js";
import { Spine } from "./Spine.js";
import { AnnotateDialog } from "./AnnotateDialog.js";
import { CommentDialog } from "./CommentDialog.js";
import { Masthead } from "./Masthead.js";
import { useSlow } from "./useSlow.js";
import { Dock } from "./Dock.js";
import { ChatPanel } from "./ChatPanel.js";
import { useLiveConversation } from "./live/useLiveConversation.js";
import { GlossaryPanel } from "./GlossaryPanel.js";
import { QuotesPanel } from "./QuotesPanel.js";
import { useQuotes } from "./useQuotes.js";
import { ProseHoverCard } from "./ProseHoverCard.js";
import { buildNoteIndex, type NoteMarker, type NoteReturn } from "./notes-view.js";
import { useArc } from "./useArc.js";
import { useGlossary, useGlossaryRead, type GlossaryRead } from "./useGlossary.js";
import { SummaryPanel } from "./SummaryPanel.js";
import { DiagramPanel } from "./DiagramPanel.js";
import { SearchPanel } from "./SearchPanel.js";
import { useSearch } from "./useSearch.js";
import { assignSlots } from "./hit-colours.js";
import {
  blockHues,
  blockMatches,
  blockStrength,
  findLiteral,
  hitMarks as buildHitMarks,
  orderFound,
  resolveIdea,
  resolveQuote,
  resolveTimelineEvent,
  keepAbove,
  PRIORITY_CONF,
  resolveHits,
  type Found,
} from "./search-hits.js";
import { useChat } from "./useChat.js";
import { OutlinePanel } from "./OutlinePanel.js";
import { useColumnContext } from "./useColumnContext.js";
import { Toggle } from "@/components/ui/toggle";
import {
  buildArcColumn,
  buildGeometry,
  buildOutline,
  buildSummaryTree,
  columnHint,
  columnLabel,
  columnPill,
} from "./tree.js";
import {
  atParam,
  colsParam,
  deepParam,
  diagramAxisParam,
  diagramHueParam,
  diagramParam,
  modeParam,
  noteParam,
  panelParam,
  sortParam,
  gateParam,
  quoteParam,
  rankParam,
  barParam,
  eventParam,
  ideaParam,
  termParam,
  findParam,
  matchParam,
  resolveMatcher,
  orderParam,
  confParam,
  runParam,
  runsParam,
  resolveRuns,
  spineParam,
  textParam,
  threadParam,
  type Mode,
  type TermSort,
} from "./params.js";
import {
  arrivalTarget,
  glideTarget,
  isBlockOnScreen,
  scrollToBlock,
  scrollToTop,
  stickyOffset,
  watchBarVisibility,
} from "./scroll.js";
import { orderComments, positionOf, stepComment } from "./comment-nav.js";
import {
  buildSections,
  positionToWrite,
  sectionDepth,
  type Section,
} from "./position.js";
import { fitView, proseVisible } from "./layout.js";
import { navPlan, useArrowNav } from "./keynav.js";
import { useSwipeNav } from "./swipe.js";
import { useComments } from "./useComments.js";
import { ChatDialog, type ChatTarget } from "./ChatDialog.js";
import { anchored, countByBlock, useChatAnchors } from "./useChatAnchors.js";
import { PILL } from "./pill.js";
import { articleWaitTitle, pageTitle, useDocumentTitle } from "./page-title.js";
import { apiFetch, readJson } from "./lib/api.js";
import { loadPublicArticle } from "./public-api.js";
import type {
  PublicArtefactSet,
  PublicArtefacts,
  PublicArticle,
  PublicGlossary,
  PublicQuotes,
  PublicIdeas,
} from "../public-types.js";
import { artefactsIn, artefactsOf } from "./public-artefacts.js";
import { NO_COMMENTS, NO_TERMS, NO_THREADS, type ReaderCapability } from "./reader-capability.js";
import { markedModes, visitorGap } from "./visitor.js";
import { NotSharedPage, SharedNotice, ViewOnlyChip, VisitorBand } from "./PublicChrome.js";
import { PublicMetadataPage, VisitorTweetsPage } from "./PublicPages.js";
import { useRenderCount } from "./perf.js";

/**
 * The owner's `marked` map: nothing is marked, and it is one object for the
 * life of the module so the bar's props do not change identity every render.
 *
 * A map since 2026-08-28 because each entry now carries the sentence the band
 * will show, so the bar's tooltip and the band cannot say the same fact in two
 * slightly different ways. visitor.ts § markedModes.
 */
const EVERY_MODE_AVAILABLE: ReadonlyMap<Mode, string> = new Map();

/**
 * The gist-column depths the outline band asks `useColumnContext` to measure:
 * none, because a mode has no gist columns and the band wants only `focusRow`.
 *
 * Module-level so its identity is stable. A fresh `[]` each render would be a
 * new dependency each render, which restarts the hook's effect — and that
 * effect adds a scroll listener and a `ResizeObserver`. Same reason `layoutKey`
 * below is a string rather than the array it describes.
 */
const EMPTY_DEPTHS: number[] = [];

/**
 * The artefact flags an owner is handed, and nothing reads them.
 *
 * `visitorGap` and `markedModes` take a non-optional `PublicArtefacts` since
 * slice 1b — there is no second request to have failed, so there is no `null`
 * to mean *we could not check*. The owner's path never asks either function
 * anything: every gate in `Reader` tests `owner` first. This is what the
 * compiler is given so that the absence of a question does not need an absent
 * answer. src/web/visitor.ts.
 */
const OWNER_HAS_EVERYTHING: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
};



/**
 * Which page you are on, and nothing else.
 *
 * The path says which article (`/read/<slug>`) and which of its three views
 * (`/metadata`, `/tweets`, or the reading view itself), or that you want the
 * shelf (`/`); the query string says how you are looking at it. See router.ts
 * for that division, and params.js for the parameters themselves.
 */
export function App() {
  const route = useRoute();
  const { user, loading } = useSession();

  /* **The callback is answered before the gate**, and it has to be: the reader
     arriving here is by definition not signed in yet, and sending them to the
     sign-in screen would throw away the code they came back with. */
  if (route.kind === "callback") return <AuthCallback />;

  /* Nothing, not a spinner. This is one frame between page load and the SDK's
     first `INITIAL_SESSION`, and a spinner that flashes on every reload reads
     as slowness rather than as care. */
  if (loading) return null;

  /* **A whole-app gate rather than a route**, because who you are is not view
     state and docs/project/url-state.md says view state is what lives in the
     URL. The address you were at is still in the address bar when you come
     back — which is the point.

     **What it shows is the landing page, wherever you were heading.** Greg's
     call, 2026-08-27, asked as a question and answered as the simpler of two:
     a deep link to an article gets the same front door as `/` rather than a
     short prompt, so there is one signed-out page rather than two. The address
     bar still holds the article, so signing in lands you on it.

     `/login` is the exception, and the only one. It is a page somebody was
     *sent* — a password-reset email has to land somewhere — so it keeps the
     compact screen rather than being answered with the pitch. See
     SignInPage.tsx.

     **And `/read/<slug>` is the second exception, since 2026-08-28.** An owner
     can mark a document world-readable, and from that moment a stranger at its
     address is somebody who may be entitled to it. So the gate no longer
     answers on the strength of "no session" alone: it asks. `ArticlePage`'s
     two-step does the asking, and `not-shared` still lands here — a stranger
     gets `LandingPage` exactly as they did before, which is why nothing above
     this line had to learn about sharing.
     docs/plans/260827ai-public-read-only-access.md § The seam. */
  if (!user) {
    if (route.kind === "login") return <SignInPage />;
    if (route.kind !== "read") return <LandingPage />;
    return <ArticlePage slug={route.slug} view={route.view} readerId={null} />;
  }

  // The shelf is home, so it gets no way-home logo — a link to the page you are
  // already on is a dead control, and Library.tsx names the app in its own
  // `<h1>` anyway. Everywhere else, the corner. See HomeLogo.tsx.
  if (route.kind === "library") return <Library />;
  // The corner logo, because this is not home and the reader may have arrived
  // straight here from a bookmarklet with no shelf behind them.
  if (route.kind === "add")
    return (
      <>
        <HomeLogo />
        <AddPage source={{ kind: "url", url: route.url }} />
      </>
    );
  /* The same page, given a file that is already in the object store rather than
     an address to fetch. See AddSource in AddPage.tsx for why it is one
     component and not two. */
  if (route.kind === "add-upload")
    return (
      <>
        <HomeLogo />
        <AddPage source={{ kind: "upload", uploadId: route.uploadId }} />
      </>
    );
  if (route.kind === "design")
    return (
      <>
        <HomeLogo />
        <DesignPage />
      </>
    );
  // Not under /read/, and so not inside `ArticlePage`'s shared shell: this page
  // has no article behind it. docs/project/reader-profile.md.
  if (route.kind === "profile")
    return (
      <>
        <HomeLogo />
        <ProfilePage />
      </>
    );
  /* **The admin pages, and the check here is not the gate.**

     A reader who is not the administrator gets the shelf, exactly as they would
     for `/nonsense` — router.ts has no 404 page by design, and an address you
     are not allowed to use is an address that does not mean anything to you.
     Nothing is being hidden by it: these components are in the bundle every
     signed-in reader downloads, so the only refusal that counts is the server's
     on `/api/admin/`, and it would refuse a hand-written `fetch` from this page
     just the same. src/admin.ts § the two halves. */
  if (route.kind === "admin") {
    if (!isAdmin(user.id)) return <Library />;
    return (
      <>
        <HomeLogo />
        {route.page === "users" ? <AdminUsersPage /> : <AdminHome />}
      </>
    );
  }
  /* Signed in, and asking for the sign-in page. There is nothing to show — the
     gate above already returned `SignInPage` for everyone who needs it — so
     this is somebody following a stale link, and the shelf is where they meant
     to end up. `replace`, because a Back button that returns you to a page that
     immediately bounces you again is a trap. */
  if (route.kind === "login") {
    navigate(LIBRARY_HREF, { replace: true });
    return null;
  }

  /* No `HomeLogo` here any more, and that is not a tidy-up. `ArticlePage` can
     now end at `LandingPage` — a stranger following a link to a document that
     is not shared — and the landing page draws the wordmark itself, so a logo
     added by the caller would be a second one on top of it. The corner mark is
     inside `ArticlePage` instead, on every branch that is not the landing
     page. */
  return <ArticlePage slug={route.slug} view={route.view} readerId={user.id} />;
}

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
  | { kind: "owned"; article: Article }
  | {
      kind: "public";
      article: Article;
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
       * to `GET /api/public/metadata/:slug` whose failure was swallowed to
       * `null` — and `null` needed a `VisitorGap` member and a sentence of its
       * own so that a lost request would not be rendered as a claim about
       * somebody's article. There is no second request now, so there is no
       * `null`: either this payload arrived or the reader is looking at
       * *this document isn't shared*. public-artefacts.ts.
       */
      available: PublicArtefacts;
    };

const LOADING: ArticleAccess = { kind: "loading" };

/**
 * The two-step, in one hook.
 *
 * **With a session: ask the owned route, and fall back to the public one on a
 * 404.** Without one: ask the public route directly. A 401 falls back too — a
 * session that expired between page load and this request is a reader with no
 * token, and the public route is the right one to ask.
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
 *
 * ## One `try`, and the metadata request outside it
 *
 * The article is the page. The artefact flags are a detail on top of it, so a
 * metadata request that fails must not take the article down with it — it
 * degrades to `null`, which `visitorGap` reads as *"not on shared links yet"*,
 * which is unconditionally true in this slice whatever the flags would have
 * said.
 */
function useArticleAccess(slug: string, readerId: string | null): ArticleAccess {
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
  if (found.kind === "not-shared") return found;
  const article = sanitizeArticle(found.article);
  return found.kind === "owned"
    ? { kind: "owned", article }
    : {
        kind: "public",
        article,
        artefacts: artefactsOf(found.article),
        available: artefactsIn(found.article),
      };
}

/** The two-step itself: the owned route, then the public one. Raw payloads. */
async function findArticle(
  slug: string,
  signedIn: boolean,
): Promise<
  | { kind: "not-shared" }
  | { kind: "owned"; article: Article }
  | { kind: "public"; article: PublicArticle }
> {
  if (signedIn) {
    const res = await apiFetch(`/api/article/${encodeURIComponent(slug)}`);
    /* 404 is *not mine*; 401 is *no longer signed in*. Everything else,
       `readJson` turns into a message — including a 500, which must not be
       quietly retried against the public route and rendered as somebody else's
       shared document. */
    if (res.status !== 404 && res.status !== 401) {
      return { kind: "owned", article: await readJson<Article>(res) };
    }
  }

  /* **One request, and it used to be two.** A second `GET /api/public/metadata/:slug`
     stood here purely to learn which artefacts existed, with its failure
     swallowed to `null`. The artefacts are in this payload now, so the payload
     answers that — and the endpoint itself stays, tested and in the route
     inventory, for stage 2's link preview. The win was the request, never the
     route. docs/plans/260827ai-public-read-only-access.md § The second request
     disappears. */
  const read = await loadPublicArticle(slug);
  if (read.kind === "not-shared") return { kind: "not-shared" };
  return { kind: "public", article: read.body };
}

/**
 * One article, fetched **once for all three of its views**.
 *
 * The fetch lives here rather than in the reading view because the metadata and
 * tweet pages need the same payload, and because this component does not
 * remount when only the view changes: stepping out to the metadata page and
 * back is then free, rather than 150KB and a spinner each way. The remount that
 * *does* matter is keyed below, on the slug.
 *
 * **What it no longer holds is anything that only an owner may do.** The
 * record-open POST and the rename overlay moved down into `OwnedArticle`, and
 * the private hooks moved into `OwnedReader`, because "never mounted" is the
 * only version of "a visitor does not do this" that survives contact with a
 * network trace. A boolean prop cannot express it: a hook cannot be skipped
 * conditionally inside one component, so the condition has to be a component
 * boundary. GPT Sol, answer 8 on this plan's stage-1 input, 2026-08-28.
 */
function ArticlePage({
  slug,
  view,
  readerId,
}: {
  slug: string;
  view: ArticleView;
  /**
   * **Who is reading, or `null` for nobody** — and it is the identity rather
   * than a boolean for a reason `useArticleAccess` sets out at length: a
   * boolean cannot tell owner A from reader B, so an answer fetched for one was
   * being shown to the other.
   *
   * Below this line the only question anyone asks of it is *is there a
   * session*, and only for the sign-up offer. Everything else keys on *is this
   * mine*: a signed-in reader on somebody else's shared document sees exactly
   * what a stranger sees, which is the rule the whole read-only chrome follows.
   * docs/plans/260827ai-public-read-only-access.md.
   */
  readerId: string | null;
}) {
  useRenderCount("ArticlePage");
  const access = useArticleAccess(slug, readerId);
  const signedIn = readerId !== null;
  const slow = useSlow(access.kind === "loading");

  /**
   * The tab, for the two states this component owns and no others.
   *
   * Once the article is here, each of the views sets its own title — Reader has
   * the mode, Metadata and Tweets have their own names — and this must then get
   * out of the way. Hence the empty string, which `useDocumentTitle` treats as
   * "not mine to set": React runs a child's effects *before* its parent's, so a
   * title computed here would otherwise land on top of the more specific one
   * the child had just written.
   *
   * **`Loading…` waits for `slow`, the same threshold the line below waits
   * for.** A tab that flickers through "Loading…" on every fast navigation is
   * the tab equivalent of a spinner that flashes and vanishes, and it is worse
   * than that here: the title is announced to a screen reader, so a flicker
   * nobody sees is an interruption somebody hears. Until then the previous
   * title stands, which is exactly what a browser does during a real page load.
   *
   * **And on a shared link it does not say `Loading…` at all**, because the
   * server already put the article's real title in the tab and replacing it
   * would be a step backwards. That decision is `articleWaitTitle` in
   * page-title.ts, which is where the two guards it needs are explained; this
   * component's job is to say which of the three states it is in.
   */
  useDocumentTitle(
    articleWaitTitle(
      access.kind === "error" ? "error" : access.kind === "loading" && slow ? "loading" : "ready",
      slug,
      /* Read at call time rather than captured: the question `articleWaitTitle`
         asks is whether the tab *still* shows what the server put there, and a
         value captured earlier could not answer it. */
      typeof document === "undefined" ? "" : document.title,
    ),
  );

  /* **The one branch with no corner wordmark**, and the reason is that
     `LandingPage` draws its own. Everything else on this page gets the corner
     mark, because the reader may have arrived straight here from a pasted link
     with no shelf behind them — and a visitor with no account especially so,
     since the mark is the only thing on screen that says whose page this is. */
  if (access.kind === "not-shared") return signedIn ? <NotSharedPage /> : <LandingPage />;

  if (access.kind === "error")
    return (
      <>
        <HomeLogo />
        <pre className="error">{access.message}</pre>
      </>
    );

  // Silent until the wait is worth mentioning (useSlow.ts owns the threshold),
  // then a line naming what is being waited for rather than "Loading…".
  if (access.kind === "loading")
    return (
      <>
        <HomeLogo />
        <div className="loading">{slow ? "Fetching the article and its summaries…" : ""}</div>
      </>
    );

  /* Keyed on the slug so switching article remounts rather than trying to carry
     one article's reading position — or one owner's rename, or one visitor's
     artefact flags — into another's. NOT keyed on the view: switching view is
     meant to keep the fetch, which is the whole reason it happens up here. */
  return (
    <>
      <HomeLogo />
      {access.kind === "owned" ? (
        <OwnedArticle key={slug} slug={slug} article={access.article} view={view} />
      ) : (
        <VisitorArticle
          key={slug}
          slug={slug}
          article={access.article}
          artefacts={access.artefacts}
          available={access.available}
          signedIn={signedIn}
          view={view}
        />
      )}
    </>
  );
}

/**
 * **Your own article**, and everything that follows from it being yours.
 *
 * Three things live here rather than a level up, and all three are the same
 * decision: they must not exist at all for a visitor, and the only reliable way
 * to say "must not exist" in React is to put them behind a component boundary.
 *
 *  - the record-open POST, which a visitor has no shelf to be counted on;
 *  - the rename overlay, whose PATCH a visitor would be refused;
 *  - the owner's `Metadata` page, which mounts editing, deletion, the profile
 *    boxes and the pipeline's own provenance.
 */
function OwnedArticle({
  slug,
  article: fetched,
  view,
}: {
  slug: string;
  article: Article;
  view: ArticleView;
}) {
  /**
   * The title the reader has just given this article, if they have.
   *
   * **Layered over the fetched payload rather than written into it**, which is
   * the same shape the server uses: `titleFor` in src/api.ts does not edit the
   * extractor's meta either, it picks the reader's title over it at the moment
   * of answering. Two reasons it matters here.
   *
   * One, the fetched payload has been through `sanitizeArticle`
   * (tests/sanitize-client.test.ts), and that guard is worth more than the
   * convenience of editing state in place. A rename introduces no HTML and
   * would have to be spelled as an exemption, and an exemption is how a guard
   * stops meaning anything.
   *
   * Two, the memo. `Reader` rebuilds the whole geometry from `article` by
   * identity, so a fresh object per render would rebuild the table on every
   * keystroke elsewhere in the page. Hence the `useMemo` below rather than a
   * spread in the render body.
   *
   * The slug travels beside the title, exactly as it did when this state lived
   * one component up: the PATCH behind a rename resolves after the reader may
   * have moved on. This component is keyed on the slug now, so the pair is
   * belt-and-braces rather than the whole guard — and it is three lines to keep
   * a rule that used to be load-bearing and would fail silently if the key ever
   * moved. GPT Sol, 2026-08-27.
   */
  const [renamed, setRenamed] = useState<{ slug: string; title: string } | null>(null);
  const title = renamed?.slug === slug ? renamed.title : null;
  const article = useMemo(
    () =>
      /* `!== null`, not truthiness: clearing an override restores the
         extractor's title, and `Meta.title` may be the empty string. Read as
         truthy that would silently fall through to `fetched`, which is still
         carrying the override that was just cleared. */
      title !== null ? { ...fetched, meta: { ...fetched.meta, title } } : fetched,
    [fetched, title],
  );
  const renameTo = useCallback(
    (forSlug: string, next: string) => setRenamed({ slug: forSlug, title: next }),
    [],
  );

  /**
   * One more open, for the shelf's tooltip to count.
   *
   * **From here, not from inside `GET /api/article/:slug`.** A GET that writes
   * is a GET that a prefetch, a retry or a health check inflates without
   * anybody deciding to — and the shelf itself does not fetch article payloads,
   * so counting on the server would count a different thing anyway.
   *
   * **And not from a visitor at all**, which is why it is in this component
   * rather than in `ArticlePage`. There is no shelf row to count against, the
   * POST would be refused, and the acceptance test for public reading is that a
   * signed-out browser issues no POST whatever.
   *
   * **The ref is not belt-and-braces; without it the number is simply wrong.**
   * `<StrictMode>` is on (main.tsx), and in development React deliberately runs
   * every effect twice — so every article opened counted as two, and the
   * tooltip said "opened 19 times" to somebody who had opened it nine. It would
   * have been right in a production build, which is the worst version of this:
   * a number that is confidently wrong exactly where anybody would look at it.
   * A ref survives StrictMode's simulated remount, so this counts once per slug
   * per mount either way. See docs/reusable/silent-success.md.
   *
   * See src/shelf.ts and docs/project/library.md.
   */
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (counted.current === slug) return;
    counted.current = slug;
    void apiFetch(`/api/library/${encodeURIComponent(slug)}/open`, { method: "POST" }).catch(
      () => {},
    );
  }, [slug]);

  if (view === "metadata")
    return <Metadata slug={slug} article={article} onRenamed={renameTo} />;
  if (view === "tweets") return <Tweets slug={slug} article={article} />;
  return <OwnedReader slug={slug} article={article} onRenamed={renameTo} />;
}

/**
 * **Where the private hooks are mounted, and the only place they are.**
 *
 * `useComments`, `useChatAnchors` and `useGlossaryRead` each fetch on mount
 * against an authenticated endpoint. A `readOnly` prop on `Reader` could not
 * have kept them out — React forbids calling a hook conditionally — so the
 * condition is this component existing, which is the point of the capability
 * seam. Sol's answer 8 predicted this would be the expensive part of the client
 * work and it was right.
 *
 * The three results are handed down as one object rather than nine props so
 * that the visitor case is a *different member of a union* rather than nine
 * absent values, and `Reader` reads them through one `capability.kind === "owner"`
 * test. reader-capability.ts.
 */
function OwnedReader({
  slug,
  article,
  onRenamed,
}: {
  slug: string;
  article: Article;
  onRenamed: (slug: string, title: string) => void;
}) {
  const comments = useComments(slug);
  const chatAnchors = useChatAnchors(slug);
  /**
   * **One read, shared with the band.** `useGlossaryRead` is the opening fetch
   * — the list and the three facts about whether it still describes the article
   * and the reader — and `GlossaryBand` layers the job poller and the verbs on
   * top of it rather than starting from `loading` of its own. Until 2026-08-27
   * it fetched the same URL again, so the panel said "Looking for a glossary…"
   * while the list it wanted was already on screen, underlined, in the prose
   * behind it. docs/plans/260827am-glossary-read-latency.md.
   *
   * The band does still *revalidate* when it opens — see `useGlossaryRead` for
   * why it has to — but behind the list, never in front of it.
   *
   * `GlossaryBand` still exists for the reason it always did, which was never
   * the opening fetch: `useJobs` polls for ever, and a reader who never opens
   * the band should not pay for a poller.
   */
  const glossary = useGlossaryRead(slug);
  /**
   * **The arc, and the request for one if there is none.** Here rather than in
   * `Reader` for the same reason the three above are: it can POST, and the
   * acceptance test for public reading is that a signed-out browser issues no
   * POST at all. A visitor keeps the payload's arc, or none.
   * src/web/useArc.ts § Who must not reach this.
   */
  const arc = useArc(slug, article.arc);

  return (
    <Reader
      slug={slug}
      article={article}
      capability={{ kind: "owner", comments, chatAnchors, glossary, arc }}
      onRenamed={onRenamed}
    />
  );
}

/**
 * **Somebody else's article, shared.** Signed out, or signed in and not the
 * owner — the same page either way, because the question is *is this mine*.
 *
 * Note which components are reachable from here: `Reader`, and two small pages
 * written for this case. `Metadata` and `Tweets` are not among them, and that
 * is the seam rather than an omission — between them they mount the profile
 * boxes, the delete button, the provenance fetch and `useJobs`.
 */
function VisitorArticle({
  slug,
  article,
  artefacts,
  available,
  signedIn,
  view,
}: {
  slug: string;
  article: Article;
  /** The four artefacts the payload carried. reader-capability.ts § artefacts. */
  artefacts: PublicArtefactSet;
  available: PublicArtefacts;
  /** For the call to action, and nothing else — reader-capability.ts § signedIn. */
  signedIn: boolean;
  view: ArticleView;
}) {
  if (view === "metadata")
    return (
      <PublicMetadataPage
        slug={slug}
        article={article}
        available={available}
        signedIn={signedIn}
      />
    );
  if (view === "tweets")
    return (
      <VisitorTweetsPage
        slug={slug}
        article={article}
        thread={artefacts.tweets}
        available={available}
        signedIn={signedIn}
      />
    );
  return (
    <Reader
      slug={slug}
      article={article}
      capability={{ kind: "visitor", artefacts, available, signedIn }}
    />
  );
}

/**
 * The window width, as state, because the whole layout is computed from it.
 *
 * **`innerWidth` minus the notch, not `innerWidth`.** `index.html` carries
 * `viewport-fit=cover`, so on a notched phone in landscape the window is wider
 * than the part of it anything may be drawn in — and `.reader` spends the
 * difference on padding (styles.css § shell). Handing `fitView` the raw width
 * builds a table for a screen that is 47px wider than the one it has to fit in,
 * and the page then scrolls sideways by exactly the notch. Raised by GPT Sol
 * against the plan, 2026-08-28; see safe-area.ts for why this cannot be done in
 * CSS.
 *
 * `orientationchange` as well as `resize`, because the insets swap sides on
 * rotation and iOS has historically fired the two in either order.
 */
function useWindowWidth(): number {
  const measure = () => window.innerWidth - horizontalInset(safeAreaInsets());
  const [w, setW] = useState(measure);
  useEffect(() => {
    const on = () => setW(measure());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return w;
}

/**
 * Reading position, both ways: the URL scrolls the page, and the page writes the
 * URL once the reader stops moving. Returns the one function anything should use
 * to jump somewhere deliberately.
 *
 * `synced` is the whole trick. Scrolling writes the URL and the URL scrolls the
 * page, so without a record of the value both sides already agree on, every
 * scroll bounces off the restore effect and scrolls again. It is set by whichever
 * side moved first; the other then recognises the value as its own and does
 * nothing.
 *
 * The pure half — which block counts as "the section you are in", and why it is
 * a section rather than an offset — is in position.ts. Written by
 * spideryarn2-cd, 2026-08-25.
 */
function useReadingPosition(sections: Section[], blocks: Block[], layoutKey: string) {
  const [at, setAt] = useQueryState("at", atParam);
  const synced = useRef<BlockId | null>(null);
  /* The article's block → row index. The spy needs it to ask which section the
     address's current value lies in, which is no longer the same question as
     what the value *is*: a jump may have put a paragraph there. One pass over
     an array the caller already holds. */
  const rowOf = useMemo(() => new Map(blocks.map((b, i) => [b.id, i])), [blocks]);

  // URL → page: first load, back/forward, pasted link.
  useEffect(() => {
    if (at === synced.current) return;
    synced.current = at;
    /* `scrollToTop`, not a bare `window.scrollTo` — Back with a glide still in
       flight would otherwise arrive at the top and be dragged forward again by
       the jump it had just undone. scroll.ts § scrollToTop. */
    if (at === null) scrollToTop();
    else scrollToBlock(at, "auto");
  }, [at]);

  // Page → URL, once the reader stops moving.
  useEffect(() => {
    const rows = sections.map((s) =>
      document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(s.blockId)}"]`),
    );
    let frame = 0;
    const measure = () => {
      frame = 0;
      /* Every rule this makes is in position.ts, and it is pure so that the one
         that matters can be watched failing — an untested guard against a race
         is the shape silent-success.md is about.

         `jumpInFlight` is read out here rather than passed inline because
         arguments are evaluated before the call, so an inline version would do
         a rect read per section on every frame of a jump only to have the
         function throw the answer away. The rects are the expensive half of
         this measurement (performance.md). GPT Sol, 2026-08-30. */
      const jumpInFlight = glideTarget() !== null;
      const next = positionToWrite({
        sections,
        rowOf,
        tops: jumpInFlight
          ? []
          : rows.map((el) =>
              el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
            ),
        line: stickyOffset() + 1,
        jumpInFlight,
        atTop: window.scrollY <= stickyOffset(),
        held: synced.current,
      });
      if (next === null) return;
      synced.current = next.at;
      void setAt(next.at);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    measure(); // a column toggle reflows every row without the reader scrolling
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, rowOf, setAt, layoutKey]);

  /* The controls bar gets out of the way while you read forwards, on a viewport
     short enough for 44px to matter — scroll.ts § watchBarVisibility, and
     styles.css § a small device for the half that decides whether it applies.

     A second scroll listener rather than a branch inside the one above, and
     deliberately: that one exists to keep `?at=` in step with the reader and
     owns React state, this one touches nothing but a `data-` attribute and
     causes no renders at all.

     They do schedule their own rAF callbacks rather than sharing one, so on a
     short viewport this is a second frame callback per scroll — said plainly
     because an earlier version of this comment claimed the pair cost one
     between them, which was simply false (GPT Sol, 2026-08-27). It is bounded:
     the watcher attaches only while the short-viewport media query matches, so
     a laptop installs no listener and pays nothing at all.

     Mounted with no dependencies because it depends on nothing — it re-reads
     the world every frame it runs. */
  useEffect(() => watchBarVisibility(), []);

  // A jump is the one scroll that pushes history: Back must not undo scrolling,
  // but flinging yourself across the article is a deliberate act. The debounce is
  // cancelled too, so a click isn't sluggish.
  //
  // `throttle(0)`, not `undefined`: nuqs resolves this option with `??`, so an
  // explicit undefined here falls straight through to atParam's
  // `debounce(POSITION_SETTLE_MS)` and cancels nothing. throttle(0) aborts the
  // pending debounce and writes the URL on the spot. Caught by
  // exactOptionalPropertyTypes — see docs/project/typechecking.md.
  const jumpTo = useCallback(
    (blockId: BlockId) => {
      synced.current = blockId;
      void setAt(blockId, { history: "push", limitUrlUpdates: throttle(0) });
      scrollToBlock(blockId);
    },
    [setAt],
  );

  // `at` goes out as well as `jumpTo` because it is half of the answer to
  // "where should this link land" — the other half being `?note=`, which the
  // caller has and this hook does not. See arrivalTarget in scroll.ts.
  return { at, jumpTo };
}

/**
 * The reading view — **one reading view, for the owner and for a visitor.**
 *
 * That was the goal from the first draft of the plan and it has not changed:
 * the prose, the tree, the spine, the granularity zoom and the keyboard are the
 * product, they cost nothing to serve, and a stranger gets all of them. What
 * differs is the `capability` prop, and the difference is not cosmetic — the
 * hooks a visitor must not mount are not mounted anywhere below this line,
 * because they were never called. They live in `OwnedReader`, one component up.
 * reader-capability.ts says why a boolean could not have done it.
 *
 * ## A known follow-up, measured rather than guessed
 *
 * `noExcessiveCognitiveComplexity` scores this function **54** against a
 * threshold of 25. It was **38** before the capability seam and **49** after
 * it, and over the threshold at every one of those, so this is not a line that
 * was crossed here — but the gates are worth a number and the number keeps
 * going up. Slice 1b added the last five: three `!owner && mode === "…" &&
 * artefacts?.x` branches, and the two narrowings above them.
 *
 * The extraction that would pay it back is the **mode band dispatch**: the nine
 * `mode === "…"` branches near the bottom become one `<ModeBands>`, which takes
 * about sixteen props. Greg's team lead weighed it on 2026-08-28 and said leave
 * it — a sixteen-prop extraction made late and under time pressure is how a
 * lint number becomes a bug. Worth revisiting deliberately rather than at the
 * end of a slice. Recorded here rather than in a plan file because this is
 * where somebody will be standing when they wonder.
 */
function Reader({
  slug,
  article,
  capability,
  onRenamed,
}: {
  slug: string;
  article: Article;
  /** Whether this article is yours, and what comes with it. reader-capability.ts. */
  capability: ReaderCapability;
  /**
   * Passed straight through to the masthead’s pencil — see Masthead.tsx.
   *
   * Absent for a visitor, and the masthead reads that absence as *do not offer
   * the pencil*. A rename is a PATCH against a shelf row a visitor does not
   * have, so the button could only ever fail, and a button that can only fail is
   * worse than no button because pressing it is how you find out.
   */
  onRenamed?: ((slug: string, title: string) => void) | undefined;
}) {
  useRenderCount("Reader");
  /**
   * The owner's half of the capability, or `null`.
   *
   * Narrowed once, here, so that every `owner ? … : …` below is the compiler
   * checking the same fact rather than eight independent comparisons that could
   * drift apart. The visitor's `available` is read the same way.
   */
  const owner = capability.kind === "owner" ? capability : null;
  /**
   * The visitor's half, read the same way and for the same reason.
   *
   * `artefacts` is what slice 1b added: the glossary, the summaries, the ideas
   * and the tweet thread, as **data** rather than as a loader, because they
   * arrived inside the payload this page is already drawing.
   * reader-capability.ts.
   *
   * `available` is the same fact as five booleans and it is no longer nullable:
   * there is no second request to have failed, so there is nothing to be unsure
   * about. For the owner it is `EVERYTHING`, which nothing reads — every gate
   * below is on `owner` first.
   */
  const artefacts = capability.kind === "visitor" ? capability.artefacts : null;
  const available = capability.kind === "visitor" ? capability.available : OWNER_HAS_EVERYTHING;
  /* Only the call to action reads this — see reader-capability.ts § signedIn.
     `true` for the owner is never consulted, since none of the chrome it gates
     is drawn for them. */
  const signedIn = capability.kind === "visitor" ? capability.signedIn : true;
  const geometry = useMemo(
    () => buildGeometry(article.tree, article.blocks),
    [article],
  );
  // Three levels, not two: the rail itself only ever draws L1 and L2, but a
  // band's hover tooltip lists the sub-sections inside it, and it can only do
  // that if they were built. See BandCard in Spine.tsx.
  const outline = useMemo(
    () => buildOutline(article.tree, article.blocks, 3),
    [article],
  );
  const sections = useMemo(
    () => buildSections(geometry, article.blocks),
    [geometry, article.blocks],
  );
  const windowWidth = useWindowWidth();

  // Gist columns are 0 … leafDepth-1. The leaf column is not user-toggled: it
  // only makes sense in outline mode, where it is the deepest rung of the table
  // of contents, and is meaningless beside the prose it labels.
  const gistDepths = useMemo(
    () => geometry.columnDepths.filter((d) => d < geometry.leafDepth),
    [geometry],
  );

  const [cols, setCols] = useQueryState("cols", colsParam);
  const [showText, setShowText] = useQueryState("text", textParam);

  /**
   * Whether the reader has had a view about the spine — see params.ts §
   * spineParam and layout.ts § showSpine.
   *
   * `null` until they press the pill, and `null` is not the same as `true`:
   * absent means the rail follows the window and the mode as it always has, and
   * that is what the `auto` control puts back.
   */
  const [showSpine, setShowSpine] = useQueryState("spine", spineParam);

  /**
   * Which mode owns the middle band — see params.ts § modeParam, and
   * docs/plans/260826a-chat-mode.md.
   *
   * Greg's framing, 2026-08-25: the gist columns are not a fixture with things
   * layered over them, they are *the default mode*, and chat is the second one.
   * So this is a single value the layout reads, not a flag each feature checks.
   */
  const [mode, setMode] = useQueryState("mode", modeParam);

  /* The tab: the article first, then the mode — and nothing for `hierarchy`,
     which is the mode most tabs are in and so the one that distinguishes
     nothing. See src/web/page-title.ts. */
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view: "article", mode }));
  /* Any mode that is not the hierarchy takes the band. Written as
     "not hierarchy" rather than as `chat || glossary` on purpose: the third mode
     cost this line nothing, which is the property the slot was built for, and
     the fourth should cost it nothing either. */
  const inMode = mode !== "hierarchy";

  /**
   * What stands between a visitor and the mode they have opened, if anything.
   *
   * `null` for the owner and `null` for `hierarchy`, which is the mode the whole
   * feature is about: the table of contents, the granularity zoom and the spine
   * are drawn from the tree in the payload the visitor already holds, so they
   * cost nothing and a stranger gets all of them. visitor.ts.
   */
  const gap = owner ? null : visitorGap(mode, available);
  /* The dimmed buttons in the bottom bar. Memoised because it builds a Set and
     `Dock` takes it by identity; empty for the owner, which is the same object
     every render. */
  const marked = useMemo(
    () => (owner ? EVERY_MODE_AVAILABLE : markedModes(available)),
    [owner, available],
  );
  /* The bar's Comments drawer needs it for the same one reason the bands do. */

  /**
   * An absent `cols` means "whatever fits", not "all of them". All of them is
   * 70rem of table, so on any laptop the obvious default buries a column
   * permanently under the pinned prose. The arithmetic lives in layout.ts, where
   * it can be tested without a DOM. An explicit `cols=` still wins outright, so a
   * pasted link shows exactly what it says.
   */
  /**
   * Whether the prose is on screen — see layout.ts § proseVisible. In a mode it
   * always is, whatever `?text=` says, because outline mode is a way of reading
   * the table of contents and a mode has none. Passed to `fitView` AND to
   * TableView from one place: reading them apart is the bug this fixes.
   */
  const proseOn = proseVisible(showText, inMode);

  const fit = useMemo(
    () =>
      fitView({
        windowWidth,
        gistDepths,
        leafDepth: geometry.leafDepth,
        showText: proseOn,
        chosen: cols,
        modeBand: inMode,
        showSpine,
      }),
    [windowWidth, gistDepths, geometry.leafDepth, proseOn, cols, inMode, showSpine],
  );

  /**
   * What the L0 column renders — one sentence per part on where the argument
   * stands there, rather than the root node repeated down the whole page.
   * Null until `npm run arc` has been run for this article, and then the column
   * falls back to the root exactly as it used to. See tree.js § the arc.
   */
  /* **The owner's live arc, falling back to the payload's.** An owner may have
     arrived without one and had it written while they read, so their column
     comes from `useArc` — which also returns `null` for an arc it knows to be
     stale, rather than drawing a column that would silently omit the entries
     whose ranges no longer match. A visitor has only the payload.
     src/web/useArc.ts. */
  const liveArc = capability.kind === "owner" ? (capability.arc.arc ?? undefined) : article.arc;
  const arcCells = useMemo(
    () => buildArcColumn(geometry, liveArc),
    [geometry, liveArc],
  );

  /**
   * Outline mode's tree — the whole thing, down to the leaves.
   *
   * `buildSummaryTree` with `summaries: null`, because this mode reads nothing
   * that stage 6 writes: a title, a gist and a navLabel are all on `tree.json`
   * already, so the mode is free, instant, and works on any article that has
   * been through the ToC stage. Full depth rather than the default 2, since the
   * paragraph rung renders leaves' navLabels. See docs/plans/260828aw-outline-mode.md.
   */
  const outlineRoot = useMemo(
    () =>
      mode === "outline"
        ? buildSummaryTree(article.tree, article.blocks, geometry.leafDepth)
        : null,
    [mode, article.tree, article.blocks, geometry.leafDepth],
  );

  // A string, not the array: a fresh array every render would restart the scroll
  // listener every render. `modeW` is in it because entering a mode moves every
  // row on the page sideways, and the `?at=` tracker holds row elements it
  // measured before the move. `spine` is in it for a stronger reason than
  // sideways: the rail's width is taken out of the prose column's, so hiding it
  // rewraps every paragraph in the article and every row changes height.
  const layoutKey = `${fit.columns.join(",")}|${proseOn}|${windowWidth}|${fit.modeW}|${fit.spine}`;
  const { at, jumpTo } = useReadingPosition(sections, article.blocks, layoutKey);

  /**
   * Where the reader is, for the outline band — the same sampler the gist
   * columns' panels use, so the two can never disagree about which section is
   * under the focus line.
   *
   * `depths: []` because there are no gist columns in a mode and the band wants
   * none of the rects; `enabled` only in this mode, so nothing is measured and
   * no scroll listener runs while every other mode is on. It is
   * **section-granular** — `focusRow` is a section's first row, never the exact
   * block — which is why no paragraph in the panel is ever marked current.
   */
  const outlineLive = useColumnContext({
    sections,
    depths: EMPTY_DEPTHS,
    enabled: mode === "outline",
    layoutKey,
  });

  /**
   * Comments: selecting prose asks a question of the model, and the answer
   * arrives in a floating dialog. See docs/project/comments.md.
   *
   * Note what is *not* here — no column, no change to `fit`, nothing threaded
   * through the layout arithmetic. That was the point of choosing a dialog.
   *
   * **Nothing here is fetched for a visitor.** `useComments` is mounted by
   * `OwnedReader`; what arrives here is its result, or the module-level empty
   * list — which is a constant rather than a fresh `[]` because half a dozen
   * memos below key on it by identity. reader-capability.ts.
   */
  const [note, setNote] = useQueryState("note", noteParam);
  const comments = owner?.comments.comments ?? NO_COMMENTS;
  const commentError = owner?.comments.error ?? null;

  /**
   * The floating chat, and the passage it is about.
   *
   * **One id, not two.** `?thread=` says which conversation is open and `mode`
   * says how it is drawn — full width in chat mode, floating over the article
   * anywhere else. An earlier draft of the plan added a `?chat=` beside it; a
   * GPT-5.6 review pointed out it carries nothing `mode` does not already
   * carry, and two ids that can disagree is a bug waiting to be written.
   *
   * `chatDraft` is the moment before there is a conversation at all: a passage
   * the reader selected, or a paragraph they pressed, with nothing stored and
   * nothing spent. It is component state rather than a parameter because there
   * is nothing to link to — and because the quote is the reader's selection,
   * which docs/project/logging.md and chat-handoff.ts both say does not belong
   * in an address.
   */
  const [thread, setThread] = useQueryState("thread", threadParam);
  const [chatDraft, setChatDraft] = useState<ChatTarget | null>(null);
  /**
   * The passage the reader has just selected, before they have saved anything.
   *
   * Component state rather than a URL parameter for the same two reasons
   * `chatDraft` is: there is nothing to link to yet, and the quote is the
   * reader's selection, which docs/project/logging.md says does not belong in
   * an address.
   */
  const [annotating, setAnnotating] = useState<
    { blockId: BlockId; quote: string; start: number } | null
  >(null);
  /* `useChatAnchors` is mounted by `OwnedReader` too. A visitor gets the empty
     list, so no mark is drawn and `overlay` below can never resolve to a
     conversation — but the dialog is also gated on `owner` explicitly, because
     "the list happens to be empty" is a much weaker guarantee than "the branch
     does not exist". */
  const chatSummaries = owner?.chatAnchors.summaries ?? NO_THREADS;

  /* Memoised, and this is a performance fix rather than tidiness. Both of these
     build a fresh array and a fresh Map, so calling them inline in the JSX
     handed `TableView` two new object identities on **every** Reader render —
     including the ones caused by something with nothing to do with chat. That
     invalidated `marksByBlock` inside TableView, which re-derived the marks and
     could take the article-wide re-annotation with it: an O(article) job
     charged to an unrelated state change.

     Keyed on `summaries`, which is the only input either one reads, so the work
     now happens when a conversation is added, renamed or deleted and at no
     other time. Found by a GPT Sol review, 2026-08-27. */
  const chats = useMemo(() => anchored(chatSummaries), [chatSummaries]);
  const chatCounts = useMemo(() => countByBlock(chatSummaries), [chatSummaries]);

  /**
   * What is in the floating slot, decided in one place.
   *
   * `note` and `thread` are independent parameters and a pasted URL can carry
   * both, so "opening one closes the other" is a statement about clicks and not
   * about state. Chat wins, matching how an overlapping mark resolves.
   *
   * Suppressed in chat mode, where the band already shows that conversation and
   * a floating copy on top of itself is nonsense. The parameter stays, so
   * leaving the mode brings the panel back where the reader left it.
   */
  const overlay: ChatTarget | null =
    /* **`!owner` first, and it is not redundant.** A visitor's `chatDraft` is
       never set and their summary list is empty, so both arms below already
       resolve to `null` — but that is an argument from two other pieces of
       state staying empty, and this is an argument from the branch not
       existing. The floating chat dialog fetches a conversation on mount. */
    !owner || mode === "chat" || mode === "review"
      ? null
      : (chatDraft ??
        /* **Only a chat may be opened here, and that is not a tidy-up.**
           `?thread=` survives leaving the mode, so a pasted
           `?mode=toc&thread=<a review>` used to mount this dialog over a review
           conversation — chat's UI, chat's composer, no stance picker, and the
           next question answered with chat's prompt. Nothing on screen would
           have said so. Gating on the summary's `kind` is what `ThreadSummary.kind`
           exists for; a review with no matching summary simply opens nothing,
           which is the same thing a stale id already did. GPT Sol's review of
           docs/plans/260827ah-review-mode.md, finding 7. */
        /* **A positive test, not a negative one.** `?.kind !== "review"` was
           the first version and had its default backwards: an *unknown* thread
           — summaries not fetched yet, or a stale id — came out as a chat, so a
           review URL opened the floating chat dialog for a moment on every
           load, and a missing thread sat on "Starting…" forever. Asking for
           `=== "chat"` means the overlay opens only for a thread we can see is
           one. GPT Sol's review of the built code, finding 3. */
        (thread && chatSummaries.find((t) => t.id === thread)?.kind === "chat"
          ? { kind: "thread" as const, threadId: thread }
          : null));

  /**
   * **Every** glossary term, so every one of them can be underlined in the
   * prose — in any mode, and whether or not the band has ever been opened.
   *
   * Greg's call, 2026-08-26: *"Glossary entries should always be underlined in
   * the verbatim text column, even outside Glossary mode, and hover should show
   * a rich tooltip."* That reverses a decision this file used to state in the
   * comment on `term` below and styles.css still explains at length — the marks
   * used to appear only while a term was pressed, so that the article acquired
   * annotation on the reader's initiative rather than the model's. What carries
   * that principle now is the *card*: the line is quiet and standing, and the
   * explanation still only arrives when the reader points at something.
   *
   * **One read, shared with the band.** `useGlossaryRead` is the opening fetch
   * — the list and the three facts about whether it still describes the article
   * and the reader — and `GlossaryBand` layers the job poller and the verbs on
   * top of it rather than starting from `loading` of its own. Until 2026-08-27
   * it fetched the same URL again, so the panel said "Looking for a glossary…"
   * while the list it wanted was already on screen, underlined, in the prose
   * behind it. docs/plans/260827am-glossary-read-latency.md.
   *
   * The band does still *revalidate* when it opens — see `useGlossaryRead` for
   * why it has to — but behind the list, never in front of it.
   *
   * `GlossaryBand` still exists for the reason it always did, which was never
   * the opening fetch: `useJobs` polls for ever, and a reader who never opens
   * the band should not pay for a poller.
   */
  const glossaryRead = owner?.glossary ?? null;
  /* **A visitor's terms are underlined too**, and that is the whole of what
     slice 1b bought here: the list is in the payload, so the dotted underlines
     and the hover cards are a standing property of a shared article exactly as
     they are of the owner's. `PublicGlossaryEntry` is a `GlossaryEntry` with
     the owner's lookup absent (src/public-types.ts), so the same scan reads
     both. `NO_TERMS` is a module constant rather than a fresh `[]`, because
     half a dozen memos below key on it by identity — reader-capability.ts. */
  const terms: GlossaryEntry[] =
    glossaryRead?.glossary?.entries ?? artefacts?.glossary?.entries ?? NO_TERMS;

  /**
   * The glossary term the reader has *pressed* in the panel, of the many now
   * drawn.
   *
   * **Held here rather than in the glossary band, and that is not where it
   * wants to live.** `useGlossary` fetches on mount and polls the job list, so
   * it has to stay inside a component that only exists in glossary mode —
   * otherwise every reader of every article pays for a list almost none of them
   * open, which is the same reason `ConversationBand` exists. But the *marks* are drawn
   * in the prose, which is `TableView`'s, and that is here.
   *
   * So the band pushes the selection up as it changes, and clears it on the way
   * out. The state is a plain setter, which is stable, so the effect that does
   * the pushing cannot loop. It is one line more than lifting the whole hook,
   * and it is the line that keeps the fetch where it belongs.
   *
   * Since every term is underlined, being selected can no longer mean *having*
   * a mark. It means a **different** mark — `mark.term[data-term-open]` — which is
   * the same thing the open comment and the pressed search hit already do.
   */
  const [term, setTerm] = useState<TermSelection | null>(null);

  /**
   * The whole list, as the prose needs it: spellings and the blocks to look in.
   *
   * Memoised on the entries and **deliberately not on which one is pressed**,
   * which is the whole point of it being separate from `term` below. This is
   * the input to a scan of the article — `termMarks` in annotate.ts — and
   * folding the pressed id in here meant every press re-compiled every pattern
   * and re-parsed every block that has a term in it, to change one attribute.
   * A GPT Sol review measured that at 44–135ms on a 400-block, 60-term article.
   * `TableView` takes the pressed id as its own prop and applies it at the end.
   */
  const termSelections = useMemo<TermSelection[]>(
    () =>
      terms.map((entry) => ({
        id: entry.id,
        forms: formsOf(entry),
        blocks: entry.blocks,
      })),
    [terms],
  );

  /**
   * Point at a term in the prose and press "in the glossary": open the band on
   * that entry.
   *
   * The `?term=` subscription that `GlossaryBand` deliberately keeps to itself
   * is not duplicated here — this writes the parameter through the same nuqs
   * setter the band reads, and the band picks it up when it mounts. Two setters
   * on one parameter is fine; two *subscriptions* were what that comment was
   * about.
   */
  const [, setTermId] = useQueryState("term", termParam);
  const openTermInGlossary = useCallback(
    (id: string) => {
      void setTermId(id);
      void setMode("glossary");
    },
    [setTermId, setMode],
  );

  /**
   * The search results whose marks are drawn in the prose, and which of them
   * the reader last pressed.
   *
   * Held here for exactly the reason `term` above is, and the comment there is
   * the full version: `useSearch` fetches on mount, so it has to live inside a
   * component that only exists in search mode, but the *marks* are drawn by
   * `TableView`, which is here. So the band pushes its results up as they
   * change and clears them on the way out.
   *
   * Note what is pushed: the **ordered, resolved** results, not the raw hits.
   * The panel and the prose must be showing the same set — see the `hitMarks`
   * prop in TableView.tsx — and the only way to guarantee that is for one of
   * them to compute it and hand it to the other.
   */
  const [found, setFound] = useState<Found[]>([]);
  const [openHit, setOpenHit] = useState<string | null>(null);

  /**
   * The selected idea's passages — **its own state, deliberately not `found`.**
   *
   * Ideas resolves into the same `Found[]` search does and draws through the
   * same marks, so sharing one piece of state looks like the obvious economy.
   * It is a bug, and a silent one. `SearchBand` pushes into `found` from a
   * **layout** effect and clears it from a **passive** unmount cleanup, and both
   * of those are deliberate (see the comments there). Passive cleanups flush
   * *after* paint and layout effects run *before* it, so switching search →
   * ideas would run:
   *
   *   IdeasBand's layout push   → passages written   (before paint)
   *   SearchBand's passive clear → passages wiped    (after paint)
   *
   * The outgoing mode tidies up on top of the incoming one, and nothing errors.
   * It does not happen today between glossary and search only because those two
   * clear different state. Two states and one `mode` test below is the whole
   * fix. Found by GPT Sol reviewing the plan; docs/plans/260826ac-ideas-mode.md.
   */
  const [ideaFound, setIdeaFound] = useState<Found[]>([]);
  const [openOccurrence, setOpenOccurrence] = useState<string | null>(null);
  /* **A third state rather than a third writer of `found`**, for the reason the
     comment above gives about the second: two modes sharing one state clear each
     other on the way out, and the mode arriving second wins by accident of
     effect ordering. Quotes has no `openKey` of its own — a quote is exactly one
     passage, so there is nothing to step between and nothing to leave open. */
  const [quoteFound, setQuoteFound] = useState<Found[]>([]);
  /* **A fourth state, for the reason the second and third have their own**, and
     not because Timeline needs anything ideas do not: two modes sharing one
     `Found[]` clear each other on the way out, and which one wins is an
     accident of whether the outgoing mode's cleanup is passive and the incoming
     mode's push is layout. Unlike quotes, this one keeps an `openKey` — an
     event mentioned in two paragraphs is rare (26 of 26 on the test article
     have one) but it is real, because the article recounts the same three
     months once per civilisation. */
  const [timelineFound, setTimelineFound] = useState<Found[]>([]);
  const [openTimelineKey, setOpenTimelineKey] = useState<string | null>(null);

  /* Two maps, memoised separately from everything else on the page. `found`
     changes on every keystroke in words mode, and recomputing every comment's
     anchor for an article's worth of blocks at that rate is the one thing that
     would make typing feel slow. Same reasoning as the second map in
     TableView.tsx. */
  /* **One list, chosen by mode, feeding every memo below.** The marks, the
     paragraph bar and the rail must all be about the same passages, and the way
     to guarantee that is for one expression to decide and everything else to
     read it — the same "compute once, hand to both" rule the panel and the
     prose already follow. The two modes are mutually exclusive, so this is a
     pick rather than a merge. */
  const passages =
    mode === "ideas"
      ? ideaFound
      : mode === "quotes"
        ? quoteFound
        : mode === "timeline"
          ? timelineFound
          : found;
  const openPassage =
    mode === "ideas"
      ? openOccurrence
      : mode === "quotes"
        ? null
        : mode === "timeline"
          ? openTimelineKey
          : openHit;
  const hitMarks = useMemo(
    () => buildHitMarks(passages, openPassage),
    [passages, openPassage],
  );
  const hitStrength = useMemo(() => blockStrength(passages), [passages]);
  const hitHues = useMemo(() => blockHues(passages), [passages]);
  /* The same facts again, for the rail rather than for the prose — which
     searches matched where, plus how many times. Kept as its own memo beside
     the other two for the reason given on them: `found` changes on every
     keystroke in words mode, and this is the cheap half.

     Note it is `blockMatches` and not `hitHues`. A literal match has no palette
     slot, so `blockHues` drops it — right for the paragraph bar, which falls
     back to the one fixed search hue, and wrong for the rail, which would then
     show nothing at all in words mode. search-hits.ts § Why `null` survives. */
  const hitBlocks = useMemo(() => blockMatches(passages), [passages]);

  /**
   * The bottom drawer — see Dock.tsx, and docs/plans/260825c-bottom-bar.md for why the
   * bottom rather than the left.
   *
   * Note what is *not* here, for the same reason the comment dialog isn't:
   * nothing threaded through `fit`, no term added to the layout arithmetic. The
   * drawer is an overlay and the bar takes height, and height is the axis where
   * this view has nothing to ration.
   */
  const [panel, setPanel] = useQueryState("panel", panelParam);
  const drawerOpen = panel !== null;

  /**
   * ↑ / ↓ step through one level of the tree, and *which* level is whichever
   * column the pointer is sitting in — see keynav.ts. It writes no state of its
   * own: it scrolls, and the listener above notices, exactly as it would for a
   * wheel. Off any tagged column the stride falls back to the section, which is
   * the unit `?at=` already stores.
   *
   * ← / → move that aim across the columns, so the level can be chosen without
   * touching the mouse — Greg, 2026-08-26: "so that I can choose the level of
   * granularity with keyboard when jumping up/down". The rungs they step
   * between are the columns actually on screen, which is why the ladder is
   * built here, beside `fit`, rather than inside the hook.
   *
   * Suspended while the drawer is open. A reader looking at their questions is
   * not reading, and the article scrolling away underneath the dim — silently,
   * because they cannot see it move — is the kind of thing you only notice
   * afterwards, when you have lost your place.
   */
  const nav = useMemo(
    () => navPlan(geometry, fit.columns, proseOn, !!arcCells),
    [geometry, fit.columns, proseOn, arcCells],
  );
  const navDepth = useArrowNav(
    nav,
    article.blocks,
    sectionDepth(geometry),
    !drawerOpen,
  );

  /**
   * The same step, taken with a finger — Greg, 2026-08-26: "jumps step-by-step
   * if I scroll within a column, kinda like the up/down buttons". A swipe over
   * a gist column moves one item at that column's level; the prose column keeps
   * ordinary iPad scrolling, which is the point rather than a limitation. See
   * swipe.ts and docs/project/touch.md.
   *
   * Reading mode only. Outline mode is gist columns all the way across, so
   * there would be nothing left that scrolls continuously.
   */
  useSwipeNav(nav, article.blocks, proseOn && !drawerOpen);

  /**
   * Reading order, not ask order — the panel's arrows walk you *down the
   * article*, not back through your own afternoon. See comment-nav.ts, and note
   * that the order comes from the block index and never from the id string
   * (block-ids.md).
   */
  const ordered = useMemo(
    () => orderComments(comments, article.blocks),
    [comments, article.blocks],
  );
  const openComment = ordered.find((c) => c.id === note) ?? null;

  /**
   * How many *other* questions are still with the model. Several can be in
   * flight at once — that is the point of firing one and reading on — so the
   * panel has to be able to say that work is happening somewhere you can't see.
   */
  const othersPending = ordered.filter(
    (c) => c.status === "pending" && c.id !== note,
  ).length;

  /**
   * Step to another comment, bringing its passage into view *only if it isn't
   * already*. Two comments in one paragraph are the common case, and jolting the
   * page between them would lose the reader their place for no gain.
   *
   * It scrolls and writes no position state of its own — the listener in
   * useReadingPosition notices and updates `?at=`, exactly as it does for a
   * wheel. Same reasoning as keynav.ts.
   */
  const goToComment = useCallback(
    (id: string | null) => {
      if (id === null) return;
      void setNote(id);
      const target = comments.find((c) => c.id === id);
      if (target && !isBlockOnScreen(target.blockId)) scrollToBlock(target.blockId);
    },
    [comments, setNote],
  );

  /**
   * A `?note=` that arrived in the address bar brings its own passage into view.
   *
   * The gap this closes: `goToComment` above scrolls, so stepping between
   * questions inside the reading view was always fine — but that path needs the
   * comment in hand, and a pasted link has only an id. `/read/<slug>?note=<id>`
   * with no `?at=` beside it therefore opened a dialog about a paragraph that
   * was somewhere off screen, and which one was unguessable. That is exactly the
   * shape of a link you *send someone*, because `?at=` is only ever there if the
   * sender had scrolled. Recorded as open in docs/plans/260825e-metadata-page.md.
   *
   * **It waits for the fetch, and it has to.** `useComments` loads over the wire,
   * so at the moment the URL is read we know the note's id and not its block.
   * `arrivalTarget` returns `at` until the comment turns up, which is what the
   * `?at=` restore has already done, so the guard below makes those renders
   * free — and then the comment arrives and this fires once.
   *
   * **Once**, and that is the ref. After the first honoured arrival, moving
   * between comments belongs to `goToComment`, which deliberately holds still
   * when the next passage is already on screen. Re-running this on every change
   * to `note` would be a second thing moving the page, and the two would
   * disagree the moment either changed.
   *
   * `isBlockOnScreen` rather than an unconditional jump, for the same reason
   * `goToComment` uses it: when `?note=` and `?at=` agree — the passage sits in
   * the section the link restored — the reader is already looking at it, and a
   * jolt would cost them their place to move them nowhere.
   *
   * Smooth rather than instant, unlike the `?at=` restore. That one runs before
   * the reader has seen anything, so animating it would be theatre; this one
   * lands after the page is up and being looked at, and the travel is what says
   * the article moved rather than was replaced. It is also the safer of the two
   * here: `glide` gives way to a wheel or a touch (scroll.ts), so a reader who
   * started reading during the fetch is not dragged off their line.
   */
  const arriving = useRef({ at, note });
  useEffect(() => {
    const { at: wasAt, note: wasNote } = arriving.current;
    if (wasNote === null) return;
    const target = arrivalTarget(wasAt, wasNote, comments);
    // `target === wasAt` is the two harmless cases at once: the comments have
    // not landed, and the note is anchored to the very block the link already
    // restored. Both mean the `?at=` restore has this covered.
    if (target === null || target === wasAt) return;
    arriving.current = { at: wasAt, note: null };
    if (!isBlockOnScreen(target)) scrollToBlock(target);
  }, [comments]);

  /**
   * Every block this article has, id to its plain text — for chat's citations.
   *
   * A Map rather than a scan per citation: an answer can carry a dozen ids and
   * every one is checked on every keystroke of the stream. The text rides along
   * because a citation chip shows the paragraph it points at on hover, and
   * building a separate Set of ids beside this would be a second copy of the
   * same fact.
   *
   * Since 2026-08-27 the hover card on the article's *own* links reads it too,
   * for the same reason and with the same words: an in-article `#fragment` is
   * the one link whose destination we can actually show, because it is on this
   * page. ProseHoverCard.tsx.
   */
  const blockText = useMemo(
    () => new Map(article.blocks.map((b) => [b.id, b.text])),
    [article.blocks],
  );

  /**
   * The article's footnotes: which blocks make up each note, and which passages
   * cite it. Built once here because two consumers need the same answer — the
   * hover card, which shows a note's whole range, and the table, which marks the
   * back-link the reader arrived by. src/web/notes-view.ts.
   */
  const notes = useMemo(() => buildNoteIndex(article.blocks), [article.blocks]);

  /**
   * The passage the reader left when they followed a footnote marker.
   *
   * One note can be marked thirteen times, so its thirteen back-links are
   * identical apart from where they go; without this the reader lands in the
   * notes with no way to tell which one is theirs.
   *
   * It survives every other kind of jump and is replaced only when another
   * marker is followed, which is deliberate: the mark answers "where did I come
   * from", and that stays true after the reader has been back and read on. The
   * one stale case — following a marker and never returning — leaves a mark on
   * a passage the reader really did leave.
   */
  const [noteReturn, setNoteReturn] = useState<NoteReturn | null>(null);
  /* **The marker, not its destination block.** The passage and the note are
     stored together and come off one `NoteMarker`, so there is no way to pair
     the passage the reader left with a note they did not follow — which is what
     went wrong when only the block id was kept. src/web/notes-view.ts §
     `markReturnPath`. GPT Sol, F7. */
  const followNote = useCallback(
    (from: BlockId | null, marker: NoteMarker) => {
      setNoteReturn(from ? { from, noteId: marker.note.id } : null);
      jumpTo(marker.blockId);
    },
    [jumpTo],
  );

  /** Whether the paragraph-level nav labels are riding beside the prose. */
  const leafOn = showText && fit.columns.includes(geometry.leafDepth);

  /** The gist columns actually on screen — the leaf column isn't one of them. */
  const shownGists = useMemo(
    () => fit.columns.filter((d) => d !== geometry.leafDepth),
    [fit.columns, geometry.leafDepth],
  );

  // Toggling writes the set into the URL, which also takes the columns off
  // automatic — the window should not quietly overrule a choice the reader made.
  // The `auto` control clears it again.
  const toggle = (d: number) => {
    const next = new Set(fit.columns);
    next.has(d) ? next.delete(d) : next.add(d);
    setCols([...next].sort((a, b) => a - b));
  };

  /**
   * The rail, on or off — Greg, 2026-08-26: "a button in the top bar to
   * show/hide the Spine (just as we can with L0, L1, etc)".
   *
   * **First in the bar, and outside the mode/contents split below**, since
   * 2026-08-27 — Greg: move it "to the furthest-left (to mirror its column
   * position)". The bar reads left to right in the order the things it names
   * stand on screen, and the rail is left of every column, so its pill is left
   * of every pill. Being outside the split is the same fact stated in code:
   * every other control here belongs to one half or the other, and this one
   * belongs to both. The granularity pills go in a mode because the columns
   * they name are not there, and a control that looks live and does nothing is
   * worse than no control; the spine is the opposite case, on screen in every
   * mode, so the pill that hides it is too.
   *
   * `pressed` reads the resolved layout rather than the parameter, so the pill
   * says what is actually on screen — unpressed in outline mode, where nobody
   * chose anything and the rail is gone anyway. Pressing it then writes the
   * explicit `?spine=1` that overrules that.
   */
  const spineToggle = (
    <Toggle
      className={PILL}
      pressed={fit.spine !== "off"}
      onPressedChange={(on) => void setShowSpine(on)}
      title="Spine — show or hide the bird's-eye rail of the whole article down the left edge"
    >
      Spine
    </Toggle>
  );

  return (
    <div
      className={`reader spine-${fit.spine}`}
      /* The wrapper must be as wide as its content for the sticky bars inside it
         to have anywhere to slide — a sticky element is clamped to its containing
         block, so one exactly its own width has a sticky range of zero and never
         moves. See docs/reusable/css-sticky-containing-block.md. Set explicitly
         rather than with `max-content`, which a table of prose answers with a
         number in the thousands. */
      /* `+ horizontalInset(...)`: `fit.minWidth` is the spine plus the table,
         computed from a width that already had the notch taken out of it, and
         `box-sizing: border-box` means this number has to cover `.reader`'s
         padding too — which now includes those same insets (styles.css § shell).
         Without the term the table's last column is squeezed out of the content
         box and the page scrolls sideways by the notch. */
      style={
        {
          minWidth: fit.minWidth + horizontalInset(safeAreaInsets()),
          "--mode-w": `${fit.modeW}px`,
        } as CSSProperties
      }
    >
      {fit.spine !== "off" && (
        <Spine
          outline={outline}
          layoutKey={layoutKey}
          matches={hitBlocks}
          onJump={jumpTo}
        />
      )}
      {/* Everything constant about the article — see Masthead.tsx for why
          constant is the word that decides it belongs here and not in a
          column. */}
      <Masthead article={article} slug={slug} onRenamed={onRenamed} />
      {/* The statement, where a visitor's eye already is on arrival. The
          *persistent* half of it is the chip in the bar below, which is sticky;
          this is the sentence and the ask, which belong with the title. Not
          dismissible: it is what this page is, not a notification.
          PublicChrome.tsx. */}
      {!owner && <SharedNotice signedIn={signedIn} />}
      <div className="controls">
        {/* First of all, before even the spine: what footing you are reading
            on outranks every control that follows, and this bar is the one
            piece of chrome that is on screen at every scroll position. */}
        {!owner && <ViewOnlyChip />}
        {/* Leftmost of the controls, because the rail it names is leftmost —
            and before the mode/contents split, because it is the one control
            that survives both. See `spineToggle` above. */}
        {spineToggle}
        {/* The granularity controls belong to the table-of-contents mode, so
            they go with it. Leaving them on screen in another mode would offer
            columns that are not there — a control that looks live, does
            nothing, and gives the reader no way to tell which. The mode's own
            name takes their place so the bar still says what the middle band
            is. */}
        {inMode ? (
          <>
            <span className="controls-label">Mode</span>
            <span className="mode on">{mode}</span>
            <button
              type="button"
              className="linky"
              onClick={() => void setMode("hierarchy")}
              title="Back to the table of contents columns"
            >
              back to contents
            </button>
          </>
        ) : (
          <>
          <span className="controls-label">Granularity</span>
          {gistDepths.map((d) => (
            <Toggle
              key={d}
              className={PILL}
              pressed={shownGists.includes(d)}
              onPressedChange={() => toggle(d)}
              title={columnHint(d, geometry.leafDepth, d === 0 && !!arcCells)}
            >
              {columnPill(d, geometry.leafDepth)}
            </Toggle>
          ))}
          {/* The paragraph outline, beside the prose rather than instead of it.
              Only offered in reading mode: in outline mode this column is the
              view, and turning it off would leave nothing. */}
          {showText && (
            <Toggle
              className={PILL}
              pressed={leafOn}
              onPressedChange={() => toggle(geometry.leafDepth)}
              title={columnHint(geometry.leafDepth, geometry.leafDepth)}
            >
              {columnPill(geometry.leafDepth, geometry.leafDepth)}
            </Toggle>
          )}
          <Toggle
            className={PILL}
            pressed={showText}
            onPressedChange={() => setShowText((v) => !v)}
            title="Hide the text to collapse the table into a whole-article outline"
          >
            Text
          </Toggle>
          {/* `fit` means nothing has been pinned down by hand, so it has to
              watch both parameters: a reader who has hidden the rail but left
              the columns alone is not on automatic, and would otherwise have no
              way back. `auto` clears the pair for the same reason.

              **The pair, deliberately, and it does cost something** — GPT Sol
              named it, 2026-08-26: you cannot hand the rail back to automatic
              while keeping columns you chose. The bar gets one "nothing is
              pinned" affordance rather than one per parameter, because two
              would be two more words in a bar that is already dense, to undo a
              state almost nobody is in. Say `auto` resets the layout, not the
              columns.

              There is no `auto` in a mode, and it is not needed: `fitMode`
              turns the rail off only for an explicit `?spine=0`, so pressing
              the pill back on there is indistinguishable from automatic. */}
          {cols === null && showSpine === null ? (
            <span
              className="mode"
              title="The columns and the spine are following the window width"
            >
              fit
            </span>
          ) : (
            <button
              type="button"
              className="linky"
              onClick={() => {
                void setCols(null);
                void setShowSpine(null);
              }}
              title="Let the columns and the spine follow the window width again"
            >
              auto
            </button>
          )}
          <span className="mode">{showText ? "reading" : "outline"}</span>
          </>
        )}
        {/* The aim, said out loud. The arrows are useless as an experiment if
            you cannot tell what they are pointing at before you press one. */}
        <span
          className="keynav"
          title="Up and down arrows step through this level — left and right arrows, or the pointer, change which level that is"
        >
          ↑↓ {columnLabel(navDepth, geometry.leafDepth, navDepth === 0 && !!arcCells)}
        </span>
        {/* Failures of the comment transport belong here rather than in the
            dialog: if the fetch never landed there is no dialog to put them in. */}
        {commentError && (
          <span className="cmt-transport-error" title={commentError}>
            comments: {commentError}
          </span>
        )}
        <span className="provenance" title={article.tree.generator}>
          {article.tree.version}
        </span>
      </div>
      <TableView
        article={article}
        sections={sections}
        layoutKey={layoutKey}
        geometry={geometry}
        columns={fit.columns}
        layout={fit}
        showText={proseOn}
        navDepth={navDepth}
        arcCells={arcCells}
        arcPending={capability.kind === "owner" && capability.arc.working}
        onJump={jumpTo}
        notes={notes}
        noteReturn={noteReturn}
        onFollowNote={followNote}
        comments={comments}
        openComment={note}
        chats={chats}
        chatCounts={chatCounts}
        openChat={overlay?.kind === "thread" ? overlay.threadId : null}
        onOpenChat={(id) => {
          setChatDraft(null);
          void setNote(null);
          void setThread(id);
        }}
        onChatAbout={(blockId) => {
          /* A conversation anchored to the whole block — the other half of what
             an anchor can be, and the one that draws no mark in the prose. The
             paragraph's opening words go into the composer so the reader can see
             which one they pressed; a six-character id is not something you can
             check you clicked correctly.

             A visitor's press does nothing: opening a conversation costs a
             model call, and the sentence saying so is one press away in the
             Chat band rather than fired at them as a dialog they did not ask
             for. */
          if (!owner) return;
          void setNote(null);
          void setThread(null);
          setChatDraft({
            kind: "draft",
            anchor: { blockId },
            opening: blockText.get(blockId) ?? "",
          });
        }}
        terms={termSelections}
        openTerm={term?.id ?? null}
        hitMarks={hitMarks}
        hitHues={hitHues}
        hitStrength={hitStrength}
        onSelect={(anchor) => {
          if (!anchor) return;
          /* **The one control a visitor meets by accident**, since selecting
             prose is something people do while reading rather than a button
             they chose to press. So it is silent: they keep their selection and
             the page does not grow a box about an account. The ask lives where
             they went looking for something — the marked modes and the notice
             under the title. */
          if (!owner) return;
          /* **Nothing is bought here.** Until 2026-08-26 this line spent a model
             call the reader had not asked for; then it opened an ask box; since
             2026-08-28 it opens a *comment* box, where saving is free and the
             model is a tick-box. Greg's call — see
             docs/plans/260828a-comments-and-bookmarks.md. */
          void setNote(null);
          void setThread(null);
          setChatDraft(null);
          setAnnotating({ blockId: anchor.blockId, quote: anchor.quote, start: anchor.start });
          /* **The browser's selection is deliberately left alone**, which is a
             reversal. It used to be cleared because it sat on top of the mark
             we had just drawn and hid it. There is now no mark to reveal —
             nothing is stored until the reader asks — so clearing it would
             leave them looking at a quote in a box with no idea which words on
             the page it came from. */
        }}
        onOpenComment={(id) => void setNote(id)}
      />
      {owner && annotating && (
        <AnnotateDialog
          anchor={annotating}
          onCancel={() => setAnnotating(null)}
          onSave={(id, body, ask) => {
            const anchor = annotating;
            setAnnotating(null);
            /* **The free thing is stored first, and the paid thing waits for
               it.** If the chat call fails, or the reader closes the panel
               before sending, their words are already on disk. The reverse
               order — open the chat, save afterwards — loses the comment for
               exactly the reader who typed the most into it. */
            void owner.comments.create({
              id,
              blockId: anchor.blockId,
              quote: anchor.quote,
              start: anchor.start,
              ...(body ? { body } : {}),
            }).then((stored) => {
              if (!ask || !stored) return;
              /* The conversation opens on the same words, pre-filled with what
                 they wrote. `sourceComment` travels with it so the *server*
                 can write the link once it knows the real thread id — the
                 client's is a guess it only learns was wrong if it was. */
              void setThread(null);
              setChatDraft({
                kind: "draft",
                anchor: {
                  blockId: anchor.blockId,
                  quote: anchor.quote,
                  start: anchor.start,
                },
                opening: anchor.quote,
                sourceCommentId: stored.id,
                ...(body ? { question: body } : {}),
              });
            });
          }}
        />
      )}
      {/* `owner &&` as well as `overlay &&`, and the compiler wants it for the
          same reason the comment on `overlay` above gives: the narrowing has to
          be visible at the branch, not inferred from two other pieces of state
          being empty. */}
      {owner && overlay && (
        <ChatDialog
          slug={slug}
          target={overlay}
          at={at}
          blocks={blockText}
          onJump={jumpTo}
          onClose={() => {
            setChatDraft(null);
            void setThread(null);
          }}
          onThread={(id) => {
            /* The draft has become a conversation. Cleared in the same commit
               that names the thread, so the slot never holds both — the panel
               becomes the conversation rather than closing and reopening. */
            /* **And the comment learns which conversation it started.** The
               link itself was written by the server, which is the only place a
               real thread id exists; this is the browser catching up, so the
               mark and the dialog are right *now* rather than after a reload.
               Read `chatDraft` before it is cleared — it is the only thing that
               knows this conversation came from a comment. Fires again with the
               server's correction if the id we guessed was overruled, and the
               last word wins. */
            const from = chatDraft?.kind === "draft" ? chatDraft.sourceCommentId : undefined;
            if (from) owner.comments.noteThread(from, id);
            setChatDraft(null);
            void setThread(id);
          }}
          onOpenFull={() => {
            /* One id, so this is the whole of it: the band reads the same
               `?thread=` the panel was reading. */
            setChatDraft(null);
            void setMode("chat");
          }}
          onCreated={owner.chatAnchors.add}
          onDropped={owner.chatAnchors.drop}
        />
      )}
      {owner && !overlay && openComment && (
        <CommentDialog
          comment={openComment}
          position={positionOf(ordered, note)}
          total={ordered.length}
          pending={othersPending}
          hasPrev={stepComment(ordered, note, -1) !== null}
          hasNext={stepComment(ordered, note, 1) !== null}
          onPrev={() => goToComment(stepComment(ordered, note, -1))}
          onNext={() => goToComment(stepComment(ordered, note, 1))}
          onClose={() => void setNote(null)}
          onRetry={() => owner.comments.retry(openComment.id)}
          onDeepen={() => owner.comments.deepen(openComment.id)}
          onEdit={(body) => void owner.comments.edit(openComment.id, body)}
          /* **Offered only when the conversation is really there.** The link on
             a comment is advisory — a reader can delete the chat and keep the
             note — so the summary list, not the stored id, decides whether
             there is anywhere to go. Passing a button that leads to
             "that conversation no longer exists" would be worse than passing
             none. */
          onOpenThread={
            openComment.threadId && chatSummaries.some((c) => c.id === openComment.threadId)
              ? () => {
                  const id = openComment.threadId;
                  if (!id) return;
                  setChatDraft(null);
                  void setNote(null);
                  void setThread(id);
                }
              : undefined
          }
          onDiscuss={(question) => {
            /* **Into the floating panel, not into chat mode.** The follow-up
               box has always handed the reader to a conversation rather than
               growing a transcript in this dialog — Greg's call, chat-handoff.ts
               — and since 2026-08-26 that conversation floats over the article
               instead of replacing it.

               It carries the comment's own anchor, so the new chat is tied to
               the same words the explanation was about: the passage keeps a mark
               and the model is told what "this" refers to on every turn, not
               just the first. The question itself is not sent yet — it is
               pre-filled, and the reader presses send — because a follow-up
               typed into one box and fired from another is a model call they did
               not quite ask for, which is the whole thing this change is about.

               The dialog closes on the way through: one panel in the slot. */
            setChatDraft({
              kind: "draft",
              anchor: {
                blockId: openComment.blockId,
                quote: openComment.quote,
                start: openComment.start,
              },
              opening: openComment.quote,
              question,
            });
            void setNote(null);
            void setThread(null);
          }}
          onDelete={() => {
            // Step to the neighbour rather than closing outright: deleting one
            // of five is a tidy-up, not a reason to lose the panel.
            const next = stepComment(ordered, note, 1) ?? stepComment(ordered, note, -1);
            owner.comments.remove(openComment.id);
            void setNote(next);
          }}
        />
      )}
      {/* The card that appears when the pointer rests on an underlined term or
          on one of the article's own hyperlinks. One panel for the whole page
          rather than one per target — they are injected HTML and there are
          hundreds of them. ProseHoverCard.tsx.

          Outside the mode band below on purpose: the underlines and the links
          are in the prose in every mode, so the thing that explains them has to
          be there in every mode too. */}
      <ProseHoverCard
        entries={terms}
        sourceUrl={article.meta.url ?? null}
        /* A visitor's card describes a link and asks nobody about it. The
           lookups behind this are `GET /api/library`, which is authenticated,
           and Wikipedia, which leaves our origin — and until GPT Sol found it
           on 2026-08-28 both fired on any hover, in a slice whose acceptance
           test is that a signed-out browser leaves `/api/public/` never.
           ProseHoverCard.tsx § lookUpLinks. */
        lookUpLinks={owner !== null}
        blockText={blockText}
        notes={notes}
        onOpenTerm={openTermInGlossary}
        onJump={jumpTo}
        onFollowNote={followNote}
      />

      {/* The mode band. Rendered only in its mode, which is what keeps the
          fetch inside it from being charged to every reader of every article —
          see ConversationBand. */}
      {/* One component, mounted by two modes, keyed so that switching between
          them starts clean rather than carrying the other's open conversation,
          focus nonce and stance across. See ConversationBand. */}
      {/* **A visitor gets one band and it is a sentence.** Not a dimmed button
          that answers a press with nothing, and not a tooltip — NN/G's rule is
          that a tooltip may never be the only place needed information lives,
          and a hover tooltip is out of reach of touch and keyboard entirely.
          So the marked mode still opens its band, in the same slot at the same
          width, and the band says which of the four boundaries this is.
          PublicChrome.tsx, visitor.ts.

          Placed above the real bands rather than woven into each of their
          conditions, so that a mode added later cannot arrive without one:
          `visitorGap` answers for every member of `Mode` and fails closed. */}
      {/* **Only when there is a gap**, and since slice 1b there usually is not:
          a visitor whose article has a glossary opens the glossary, and
          `visitorGap` answers `null`. What is left here is a mode the pipeline
          never ran for this piece, and the four that cost a model call. */}
      {!owner && gap && <VisitorBand gap={gap} signedIn={signedIn} />}
      {owner && (mode === "chat" || mode === "review") && (
        <ConversationBand
          key={mode}
          slug={slug}
          blocks={blockText}
          onJump={jumpTo}
          kind={mode === "review" ? "review" : "chat"}
          onMode={setMode}
        />
      )}
      {/* `glossaryRead &&` rather than `owner &&`, and it is the same test: the
          read is non-null exactly when the article is yours. Written this way
          because it is also the narrowing the band needs — a band with no read
          to hand it has nothing to draw. */}
      {glossaryRead && mode === "glossary" && (
        <GlossaryBand
          slug={slug}
          read={glossaryRead}
          onJump={jumpTo}
          onSelected={setTerm}
        />
      )}
      {/* **The visitor's three bands, and they are the slice.** Each is the same
          panel as the owner's with its data injected and no hooks behind it —
          the list arrived in this page's own payload, so there is nothing to
          fetch and nothing to poll. A separate component per mode because a
          hook cannot be called conditionally, which is the same reason
          `OwnedReader` exists one level up; a separate *panel* would be two
          designs for one list. reader-capability.ts, and
          GlossaryPanel.tsx § GlossaryOwner.

          Gated on the artefact itself rather than on `available`, so the branch
          that renders the band and the flag that decides the sentence cannot
          disagree: an absent key means `visitorGap` said `not-built` and the
          `VisitorBand` above is showing instead. */}
      {!owner && mode === "glossary" && artefacts?.glossary && (
        <VisitorGlossaryBand
          glossary={artefacts.glossary}
          onJump={jumpTo}
          onSelected={setTerm}
        />
      )}
      {/* No `owner &&` twin, and that is the point rather than an omission: the
          outline is drawn from the tree in the payload every reader already
          holds, reaches no artefact, and costs nothing — so a visitor gets the
          whole of it, exactly as they get the table of contents. `visitorGap`
          has to be told that explicitly, because it fails closed. */}
      {mode === "outline" && (
        <OutlinePanel
          root={outlineRoot}
          supplementOf={geometry.supplementOf}
          arcByRow={arcCells}
          focusRow={outlineLive.focusRow}
          /* `modeW` is 0 exactly when the band covers the prose instead of
             sitting beside it (layout.ts), which is iPad portrait. That is the
             condition paragraph rows are not permissible under, so it is read
             from the layout rather than from a width guessed here. */
          proseBeside={fit.modeW > 0}
          onJump={jumpTo}
        />
      )}
      {mode === "summary" && <SummaryBand article={article} onJump={jumpTo} />}
      {owner && mode === "diagram" && (
        <DiagramBand slug={slug} article={article} at={at} onJump={jumpTo} />
      )}
      {owner && mode === "ideas" && (
        <IdeasBand
          slug={slug}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setIdeaFound}
          openKey={openOccurrence}
          onOpenKey={setOpenOccurrence}
        />
      )}
      {!owner && mode === "ideas" && artefacts?.ideas && (
        <VisitorIdeasBand
          ideas={artefacts.ideas}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setIdeaFound}
          openKey={openOccurrence}
          onOpenKey={setOpenOccurrence}
        />
      )}
      {owner && mode === "quotes" && (
        <QuotesBand slug={slug} blocks={article.blocks} onJump={jumpTo} onFound={setQuoteFound} />
      )}
      {!owner && mode === "quotes" && artefacts?.quotes && (
        <VisitorQuotesBand
          quotes={artefacts.quotes}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setQuoteFound}
        />
      )}
      {/* **One branch, not the owner/visitor pair the ideas have.** Timeline is
          owners-only in v1 (src/web/visitor.ts § COSTS), so a visitor never
          reaches this band at all — the dock marks the button and pressing it
          renders the boundary instead. There is deliberately no
          `VisitorTimelineBand` waiting for a payload field that does not
          exist. */}
      {owner && mode === "timeline" && (
        <TimelineBand
          slug={slug}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setTimelineFound}
          openKey={openTimelineKey}
          onOpenKey={setOpenTimelineKey}
        />
      )}
      {owner && mode === "search" && (
        <SearchBand
          slug={slug}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setFound}
          openHit={openHit}
          onOpenHit={setOpenHit}
        />
      )}

      {/* Last in the DOM as well as topmost in z-index: the bar and its drawer
          are drawn over everything, and matching source order to paint order is
          one less thing to reason about when something appears underneath
          something else. */}
      <Dock
        slug={slug}
        view="article"
        mode={mode}
        onMode={(next) => {
          void setMode(next);
          /* Search draws its results down the rail, so entering search mode
             brings the rail back if the reader had put it away — Greg,
             2026-08-26: *"show the Spine by default when Search mode is
             active"*.

             `null`, not `true`: the rail goes back to following the window and
             the mode, which in a mode means on. Writing `true` would pin it,
             and the reader would find it still there in outline mode later
             with no memory of having asked for that.

             On the transition and **not** as a standing effect, which is the
             part worth getting right. A rule that re-asserted the rail whenever
             search mode was open would make the `Spine` pill dead in exactly
             the mode this is about: press it off, and it comes straight back.
             "By default" is a fact about arriving, not a fact about staying —
             hence `mode !== "search"` as well, since the dock calls this for a
             press on the mode you are already in.

             **The cost, stated because it is real**: the reader's `?spine=0`
             was a choice about the page, and this throws it away rather than
             suspending it — come back to reading mode afterwards and the rail
             is there. Suspending it would mean `?spine=` growing a per-mode
             shape, which is a lot of machinery for one bit; and the alternative
             of leaving it alone means a reader who has hidden the rail opens
             search and finds half the feature drawn somewhere they cannot see.
             The pill is one press away. docs/project/search.md § The rail. */
          /* Ideas paints one lane down the rail for the selected idea, and
             the rail is the only place that can show an idea's *shape* — is
             this threaded through the piece, or concentrated in one section?
             So it earns the same arrival rule search has, for the same reason
             and with the same `null` rather than `true`. */
          if (
            (next === "search" || next === "ideas") &&
            mode !== next &&
            showSpine === false
          ) {
            void setShowSpine(null);
          }
        }}
        /* Which mode buttons are drawn dimmed. Empty for the owner, so the bar
           is exactly what it was; derived from `MODES` for a visitor, so a mode
           added later is marked whether or not whoever adds it remembers.
           visitor.ts § markedModes. */
        marked={marked}
        signedIn={signedIn}
        drawer={
          owner
            ? {
                comments: ordered,
                loaded: owner.comments.loaded,
                loadFailed: owner.comments.loadFailed,
                panel,
                onPanel: (next) => void setPanel(next),
                onOpenComment: (id) => {
                  // Close the drawer on the way through: the dialog it opens
                  // would otherwise be underneath the dim, which looks exactly
                  // like nothing happening.
                  void setPanel(null);
                  goToComment(id);
                },
              }
            : /* The drawer still opens, and what is in it is the sentence about
                 whose comments these would be. The alternative — no drawer, so
                 the Comments button becomes a link back to the page it is
                 already on — is a control that does nothing, which is the thing
                 the marked-not-hidden rule exists to avoid. */
              { visitor: true, panel, onPanel: (next) => void setPanel(next) }
        }
      />
    </div>
  );
}

/**
 * Ideas, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ConversationBand` and `GlossaryBand` are:
 * `useIdeas` fetches on mount, and calling it up in `Reader` would charge every
 * reader of every article a request for a list almost none of them will open.
 *
 * What it pushes up is the **resolved** passages, not the stored occurrences.
 * The panel and the prose have to be showing the same set, and the only way to
 * guarantee that is for one of them to compute it and hand it to the other —
 * the same rule `SearchBand` follows. Resolution can drop occurrences (a block
 * the article no longer has), so a panel counting the stored list would say
 * "2 of 5" and step through three.
 */
function IdeasBand({
  slug,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  slug: string;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("IdeasBand");
  const ideas = useIdeas(slug);
  const band = useIdeasMode({
    ideas: ideas.ideas,
    /* The artefact's own clock, which src/ideas.ts fixes at write time so the
       palette cannot reshuffle. See `useIdeasMode`. */
    generatedAt: ideas.ideas?.generatedAt ?? "",
    blocks,
    onFound,
    openKey,
    onOpenKey,
    onJump,
  });
  return (
    <IdeasPanel
      access={{ kind: "owner", owner: ideas, ideas: ideas.ideas }}
      {...band}
      openKey={openKey}
      onOpenKey={onOpenKey}
      onJump={onJump}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useIdeas` and therefore no `useJobs`: the list came in the page's own
 * payload. See `VisitorGlossaryBand` for why this is a second band and not a
 * second panel.
 */
function VisitorIdeasBand({
  ideas,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  ideas: PublicIdeas;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("VisitorIdeasBand");
  const band = useIdeasMode({
    ideas,
    /* **No clock, and it does not need one.** `generatedAt` seeds the tie-break
       `assignSlots` uses to colour the ideas in a stable order, and the index
       already breaks the tie — the artefact's timestamp is provenance the
       public projection drops on purpose (src/public/dto.ts). What matters is
       that every idea gets the same seed, which the empty string gives. */
    generatedAt: "",
    blocks,
    onFound,
    openKey,
    onOpenKey,
    onJump,
  });
  return (
    <IdeasPanel
      access={{ kind: "visitor", ideas }}
      {...band}
      openKey={openKey}
      onOpenKey={onOpenKey}
      onJump={onJump}
    />
  );
}

/**
 * Everything the ideas band does that is not a fetch: `?idea=`, the colour
 * slots, and the resolved passages it pushes up.
 *
 * What it pushes up is the **resolved** passages, not the stored occurrences.
 * The panel and the prose have to be showing the same set, and the only way to
 * guarantee that is for one of them to compute it and hand it to the other —
 * the same rule `SearchBand` follows. Resolution can drop occurrences (a block
 * the article no longer has), so a panel counting the stored list would say
 * "2 of 5" and step through three.
 */
function useIdeasMode({
  ideas,
  generatedAt,
  blocks,
  onFound,
  openKey,
  onOpenKey,
  onJump,
}: {
  ideas: { ideas: Idea[] } | null;
  generatedAt: string;
  blocks: Block[];
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onJump(id: BlockId): void;
}) {
  const [ideaId, setIdeaId] = useQueryState("idea", ideaParam);

  /* The palette slot, assigned over **every** idea rather than only the
     selected one, so an idea's colour does not depend on which one is open —
     the same guarantee `assignSlots` gives saved searches, and the same reason
     App.tsx calls it over all runs rather than the active ones.

     A clock for every idea, so `inCreationOrder` walks them in the order the
     artefact stores — which src/ideas.ts fixes at write time precisely so this
     cannot reshuffle. Ideas have no clock of their own; the artefact's is the
     honest stand-in, and the index breaks the tie. */
  const slots = useMemo(() => {
    const list = ideas?.ideas ?? [];
    return assignSlots(list.map((idea, i) => ({ id: idea.id, createdAt: `${generatedAt}#${i}` })));
  }, [ideas, generatedAt]);

  const selected = useMemo(
    () => ideas?.ideas.find((i) => i.id === ideaId) ?? null,
    [ideas, ideaId],
  );

  /* Document order, so the stepper's "2 of 4" counts the way the reader moves
     through the article rather than the order the model happened to list them. */
  const found = useMemo(() => {
    if (!selected) return [];
    return orderFound(
      resolveIdea(blocks, {
        id: selected.id,
        slot: slots.get(selected.id) ?? 0,
        occurrences: selected.occurrences,
      }),
      "document",
    );
  }, [selected, blocks, slots]);

  /* **`useLayoutEffect`, not `useEffect`** — a passive effect leaves one
     paintable frame in which the panel shows the new idea and the prose still
     marks the old one. Same reasoning, and the same pairing with an
     unmount-only clear below, as `SearchBand`. */
  useLayoutEffect(() => {
    onFound(found);
  }, [found, onFound]);

  /* An open occurrence that is no longer in the list cannot stay open.
     Regenerating mints new keys for every passage, and a re-extraction can drop
     one — either way the row and its mark both go, while `openKey` survives and
     the stepper reads "– / 3" over a list the reader has not left. `SearchBand`
     has the same effect for the same reason, and it was missing here.
     Keyed on absence from `found`, so ordinary selection changes are left
     alone. GPT Sol, 2026-08-27. */
  useEffect(() => {
    if (openKey && !found.some((f) => f.key === openKey)) onOpenKey(null);
  }, [found, openKey, onOpenKey]);

  /* Standing on the first passage is the state a selected idea is *in* — and it
     is the state whether the reader got there by pressing the row or by opening
     a URL that already had `?idea=` in it. The jump below only fires on a press,
     so a deep link drew three washed passages, emphasised none of them, and put
     "– / 3" in the stepper; the reader's first press of › then took them to
     passage two. Same bug the glossary had, fixed there by deriving rather than
     seeding, and it reaches this panel from the other end. Browser, 2026-08-27.

     **It opens without moving anybody.** A shared URL carries `?at=` too, and
     the reader's own position in the article beats our idea of where they
     should be looking. Only the press earns the scroll. */
  useEffect(() => {
    if (openKey === null && found.length > 0) onOpenKey(found[0]!.key);
  }, [found, openKey, onOpenKey]);

  /* Selecting an idea arrives at its first passage — and it has to be the first
     one that RESOLVED, which cannot be decided in the panel: until the
     selection changes, nothing has resolved that idea's occurrences at all.
     So the press records an intention and this effect spends it once the list
     exists.

     A ref rather than state, so spending it does not cause a render; and
     cleared before the jump rather than after, so a `found` that changes again
     while the reader is reading cannot fling them back to the top. */
  const wantsJump = useRef(false);
  useEffect(() => {
    if (!wantsJump.current || found.length === 0) return;
    wantsJump.current = false;
    const first = found[0]!;
    /* **Open it as well as go to it.** Without this the reader is standing on
       occurrence one — the page has scrolled there and the words are washed —
       while the stepper reads "– / 3", and their first press of › appears to do
       nothing because it moves them to the passage they are already looking at.
       Found in the browser, 2026-08-27; it is exactly the kind of thing that is
       invisible from the code, where "nothing selected yet" and "on the first"
       are two perfectly reasonable states that happen to look identical here. */
    onOpenKey(first.key);
    onJump(first.blockId);
  }, [found, onJump, onOpenKey]);

  /* Unmount only, with no data dependencies: leaving the mode must take the
     marks out of the prose with it, and folding this into the effect above
     would clear them on every change before setting them again — one frame of
     flicker on every keypress-equivalent. */
  useEffect(
    () => () => {
      onFound([]);
      onOpenKey(null);
    },
    [onFound, onOpenKey],
  );

  return {
    ideaId,
    onIdea: (next: string | null) => {
      void setIdeaId(next);
      /* A new idea means the old occurrence is meaningless — its key names an
         idea nobody is looking at, so the stepper would read "0 / 3". */
      onOpenKey(null);
      /* Only on selecting, never on clearing: pressing the open idea again
         takes the marks away, and throwing the reader down the article as it
         does would be the opposite of what that gesture means. */
      wantsJump.current = next !== null;
    },
    found,
  };
}

/**
 * The timeline, and the fetch that belongs to it.
 *
 * A component of its own for the reason `IdeasBand` and `GlossaryBand` are:
 * `useTimeline` fetches on mount, so calling it up in `Reader` would charge
 * every reader of every article a request for a chronology almost none of them
 * will open.
 *
 * **Owner-only, so there is one of these and not two.** Timeline is in
 * `COSTS` in src/web/visitor.ts, so a visitor meets a boundary instead of a
 * band and there is no `VisitorTimelineBand` waiting on a payload field that
 * does not exist.
 *
 * ## The five effects below are a second copy of `useIdeasMode`'s, deliberately
 *
 * They are the same five rules — push the resolved passages up before paint,
 * drop an `openKey` that is no longer in the list, stand on the first passage,
 * spend the press's intention to jump once the list exists, and clear
 * everything on the way out — and every one of them was got wrong once in the
 * ideas panel before it was got right. Two copies of a rule is exactly what
 * this repo does not want.
 *
 * They were not merged today because the merge is an edit through the middle of
 * `useIdeasMode`, and App.tsx is being rewritten by another session while this
 * lands; a shared hook over `{ found, openKey, onFound, onOpenKey, onJump }` is
 * the right shape and is a follow-up worth doing on a quiet file. Until then
 * **a fix to one of these belongs in both**, which is written here rather than
 * left to be discovered.
 *
 * The one real difference is that there are no colour slots. Timeline paints no
 * lane down the rail — deferred with the marks — so `resolveTimelineEvent`
 * hands every occurrence slot 0 and the prose gets the ordinary wash.
 */
function TimelineBand({
  slug,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  slug: string;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("TimelineBand");
  const timeline = useTimeline(slug);
  const [eventId, setEventId] = useQueryState("event", eventParam);

  const selected = useMemo(
    () => timeline.timeline?.events.find((e) => e.id === eventId) ?? null,
    [timeline.timeline, eventId],
  );

  /* Document order, so the stepper's "2 of 3" counts the way the reader moves
     through the article rather than the order the model happened to list the
     occurrences in. */
  const found = useMemo(() => {
    if (!selected) return [];
    return orderFound(
      resolveTimelineEvent(blocks, { id: selected.id, occurrences: selected.occurrences }),
      "document",
    );
  }, [selected, blocks]);

  /* `useLayoutEffect`, not `useEffect` — a passive effect leaves one paintable
     frame in which the panel shows the new event and the prose still marks the
     old one. */
  useLayoutEffect(() => {
    onFound(found);
  }, [found, onFound]);

  /* An open occurrence that is no longer in the list cannot stay open: reading
     the timeline again mints new keys, and a re-extraction can drop one. */
  useEffect(() => {
    if (openKey && !found.some((f) => f.key === openKey)) onOpenKey(null);
  }, [found, openKey, onOpenKey]);

  /* Standing on the first passage is the state a selected event is *in*, and it
     is that state whether the reader pressed the row or opened a URL that
     already had `?event=` in it — without this, a shared link washes the
     passages, emphasises none of them and puts "– / 2" in the stepper. It opens
     without moving anybody: a shared URL carries `?at=` too, and the reader's
     own position beats ours. */
  useEffect(() => {
    if (openKey === null && found.length > 0) onOpenKey(found[0]!.key);
  }, [found, openKey, onOpenKey]);

  /* Pressing a row arrives at its first passage, and it has to be the first one
     that RESOLVED — which the panel cannot decide, because until the selection
     changes nothing has resolved that event's occurrences at all. So the press
     records an intention and this spends it once the list exists. A ref rather
     than state, so spending it causes no render, and cleared before the jump so
     a later change to `found` cannot fling the reader back to the top. */
  const wantsJump = useRef(false);
  useEffect(() => {
    if (!wantsJump.current || found.length === 0) return;
    wantsJump.current = false;
    const first = found[0]!;
    onOpenKey(first.key);
    onJump(first.blockId);
  }, [found, onJump, onOpenKey]);

  /* Unmount only, with no data dependencies: leaving the mode takes the marks
     out of the prose with it, and folding this into the push above would clear
     them on every change before setting them again. */
  useEffect(
    () => () => {
      onFound([]);
      onOpenKey(null);
    },
    [onFound, onOpenKey],
  );

  return (
    <TimelinePanel
      owner={timeline}
      eventId={eventId}
      onEvent={(next) => {
        void setEventId(next);
        /* A new event means the old occurrence is meaningless — its key names
           an event nobody is looking at, so the stepper would read "0 / 2". */
        onOpenKey(null);
        /* Only on selecting, never on clearing: pressing the open event again
           takes the marks away, and throwing the reader down the article as it
           does would be the opposite of what that gesture means. */
        wantsJump.current = next !== null;
      }}
      found={found}
      openKey={openKey}
      onOpenKey={onOpenKey}
      onJump={onJump}
    />
  );
}

/**
 * Chat, and the fetch that belongs to it.
 *
 * A component of its own for one reason: **`useChat` fetches on mount**, and
 * calling it up in `Reader` would charge every reader of every article a
 * request for a conversation almost none of them will open. Hooks cannot be
 * called conditionally, so the condition has to be a component boundary. Same
 * reasoning as the `drawer` prop in Dock.tsx, which exists so the metadata page
 * does not pay for comments it has no use for.
 *
 * `?thread=` lives here too, for the same reason — it is meaningless outside
 * chat mode, and reading it in `Reader` would put a parameter subscription on
 * every render of the reading view for a value only this component uses.
 */
export function ConversationBand({
  slug,
  blocks,
  onJump,
  kind,
  onMode,
}: {
  slug: string;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  /**
   * Which mode mounted this — chat, or review.
   *
   * **One component for both, and not two.** Everything in here is the same for
   * either: one `useChat(slug)`, one `?thread=`, one focus nonce, one
   * once-per-visit latch. A near-copy would have been a second chat state
   * machine beside the first, which is what GPT Sol's review of
   * docs/plans/260827ah-review-mode.md (finding 7) said not to build — and the
   * unmount/remount path around this one already has a race worth not having
   * twice.
   */
  kind: ThreadKind;
  /**
   * Switch mode, for when the reader opens a thread of the *other* kind.
   *
   * The list is shared (Greg's call, 2026-08-27), so a review is reachable from
   * chat mode and vice versa. Opening one has to move `?mode=` as well as
   * `?thread=` or the conversation would be answered with the wrong prompt.
   */
  onMode(next: Mode): void;
}) {
  useRenderCount("ConversationBand");
  const {
    threads,
    loaded,
    loadFailed,
    recovering,
    send,
    retry,
    edit,
    stop,
    begin,
    discard,
    rename,
    remove,
    speak,
    error,
  } = useChat(slug);
  const [thread, setThread] = useQueryState("thread", threadParam);

  /**
   * The conversations as they are **now**, for a callback that outlives a render.
   *
   * `tailNow` below is read once, minutes after the session started, from
   * inside the hook. Captured directly it would be the list as it was at
   * connect time — which is the one value it must not be, since the whole
   * question it answers is "has this conversation moved since then?".
   */
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  /**
   * **The live conversation, owned here** — above the panel, above the keyed
   * transcript, for the life of the article.
   *
   * `ChatPanel` is remounted every time the reader switches conversation, and a
   * peer connection that a remount destroys is a connection nothing owns: the
   * microphone stays open, the events go nowhere, and the exchange in flight is
   * never written down. docs/plans/260831l-live-conversation-in-chat.md § 5.
   *
   * The three things it is given are the three things a live session cannot
   * work out for itself:
   *
   * - `speak`, which is `useChat`'s — so a spoken exchange goes through the
   *   same controller as every typed turn, as an operation with an identity and
   *   a projection, rather than a second writer beside it;
   * - `tailNow`, so the seeding barrier can tell whether the conversation moved
   *   while the session was connecting;
   * - `onThreadId`, so `?thread=` follows if the server names the conversation
   *   something other than what this tab invented.
   */
  const live = useLiveConversation(slug, {
    speak,
    tailNow: (id) => threadsRef.current.find((t) => t.id === id)?.messages.at(-1)?.id ?? null,
    onThreadId: (id) => void setThread(id),
  });

  /**
   * **A session belongs to one conversation, so leaving that conversation ends
   * it.**
   *
   * Not cosmetic. A session is *seeded* from its thread and *appends* to it, so
   * one left running while the reader reads a different conversation is
   * listening to them and writing what they say into a transcript they are not
   * looking at. The panel is remounted on a thread switch and the session is
   * not — that is the whole reason it is owned up here — so nothing else would
   * notice.
   *
   * Deliberately not awaited: this is a reaction to a navigation that has
   * already happened, and the flush it starts finishes on its own through the
   * chat controller, which outlives this component for exactly that reason.
   * The Send handoff is the path that has to wait, and it does.
   */
  const hangUp = useRef(live.stop);
  hangUp.current = live.stop;
  useEffect(() => {
    if (live.phase === "idle" || live.phase === "failed") return;
    if (live.threadId && live.threadId !== thread) void hangUp.current();
  }, [thread, live.phase, live.threadId]);

  /**
   * A counter that goes up whenever a *new* conversation is started, so the
   * composer knows to take focus.
   *
   * A counter and not a boolean, because "start another new chat" has to be
   * distinguishable from the last one — a boolean that is already `true` fires
   * no effect. And a counter rather than focusing from here directly, because
   * the element belongs to the composer: reaching down for it would mean a ref
   * threaded through two components that otherwise share nothing.
   *
   * Deliberately NOT raised when an existing conversation is opened. Focus in
   * the textarea means ↑/↓ stop stepping the article (keynav.ts ignores keys
   * typed into one), so taking it is only right when the reader has just asked
   * for somewhere to type.
   */
  const [focusNonce, setFocusNonce] = useState(0);
  const startNew = useCallback(() => {
    void setThread(begin(kind));
    setFocusNonce((n) => n + 1);
  }, [begin, setThread, kind]);

  /**
   * How many conversations **of this kind** the reader has.
   *
   * The list is shared, so `threads.length` is the wrong count for the latch
   * below: a reader with three chats and no reviews would press Review and be
   * shown three chats, which is not what "start a new one if there are none"
   * ever meant. GPT Sol's review of docs/plans/260827ah-review-mode.md, finding 7.
   */
  const ownKind = threads.filter((t) => t.kind === kind).length;

  /**
   * **An empty chat opens a conversation rather than an empty list.**
   *
   * Greg, 2026-08-26: *"By default, if no existing Chats, start a new one."*
   * The list is worth showing when there is something in it; when there is not,
   * it is a page whose only content is a button, and pressing that button is
   * the only thing anyone was ever going to do.
   *
   * `loaded` is what makes this safe. Without it, "no threads" and "the fetch
   * has not come back" are the same state, so every visit would create a thread
   * before the reader's real ones arrived — and having created one, would not
   * create one on the visit where they genuinely had none. See useChat.ts.
   *
   * It cannot loop: `begin` inserts its conversation into `threads` on the spot,
   * so the condition is false by the next render.
   *
   * **Once per visit to chat mode, and the latch is what makes closing a
   * conversation work at all.** An empty conversation the reader closes is
   * discarded (see `onDiscard` below), which puts the panel back into exactly
   * the state this effect fires on — nothing stored, nothing open — so without
   * the latch the close button would hand them a brand-new empty conversation
   * and read as broken. "By default" means on arrival; a reader who has just
   * closed the only conversation asked for the list.
   *
   * Be exact about "once", because the obvious reading is wrong: the latch is a
   * ref in a component that is unmounted whenever the reader switches to
   * another mode, so coming back to chat starts a conversation again. That is
   * the behaviour we want — arriving in chat mode is the arrival this rule is
   * about — but it does mean the latch does not survive a mode switch, and any
   * future reasoning that assumes it does will be wrong. It is reset on `slug`
   * as well, for the case the panel stays mounted across a change of article.
   *
   * `thread` is deliberately *not* in the condition. `?thread=` can name a
   * conversation that no longer exists — leave chat mode with an empty new one
   * open and the URL keeps its id while the panel takes the conversation with
   * it — and a reader coming back to that URL should get a conversation, not a
   * list they did not ask for. Starting one overwrites the stale id, which is
   * why there is no separate effect clearing it: an effect that cleared the URL
   * whenever the id was missing would also fire in the window between a first
   * question being sent and the server having written it down.
   */
  const started = useRef(false);
  /* `kind` as well as `slug`. This component is now mounted by two modes, and
     React will reuse the instance if it ever renders in the same position for
     both — at which point the latch would still be spent from the mode the
     reader just left, and arriving in the other one would show a list rather
     than a fresh conversation. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate re-run trigger — the effect reads nothing, and changing article or mode is exactly when the latch stops meaning anything
  useEffect(() => {
    started.current = false;
  }, [slug, kind]);


  useEffect(() => {
    if (!loaded || started.current) return;
    if (ownKind === 0) {
      started.current = true;
      startNew();
    }
  }, [loaded, ownKind, startNew]);
  /* Read, never written, and not a subscription: `?at=` is already tracked by
     useReadingPosition in the parent, so this component re-renders whenever it
     changes and `location.search` is current. It is passed to the model so that
     "this bit" and "what he just said" resolve to where the reader actually is.
     Same read-at-render trick Dock.tsx uses for its carried query string. */
  const at = new URLSearchParams(location.search).get("at");

  /**
   * The stance the next review answer will be asked for.
   *
   * **Not in the URL**, for the rule url-state.md keeps: it changes nothing on
   * screen, only what the next answer is asked for. The closest existing thing
   * is chat's profile checkbox, which is component state for the same reason.
   *
   * **Seeded from the last answer in the open conversation**, so a reader who
   * chose Socratic and comes back tomorrow finds it still on Socratic — the
   * stance is stored on every answer anyway, for the transcript's sake, so this
   * memory is free. `picked` is what makes it a seed rather than a leash: once
   * the reader has touched the control it is theirs, and reopening a thread
   * does not overrule them mid-session.
   */
  const [picked, setPicked] = useState<ReviewStance | null>(null);
  const open = threads.find((t) => t.id === thread);
  const lastStance = [...(open?.messages ?? [])]
    .reverse()
    .find((m) => m.role === "assistant" && m.stance)?.stance;
  const stance: ReviewStance = picked ?? lastStance ?? "balanced";

  return (
    <ChatPanel
      slug={slug}
      /* Not for display — the panel offers its "start a new one" box only once
         this is true. It went in because a conversation minted before the first
         fetch landed was wiped by it; that is fixed at source now
         (`mergedArrival` in useChat.ts), so what this does is keep the box off
         a list the reader cannot see yet. See the composer under `ThreadList`. */
      loaded={loaded}
      loadFailed={loadFailed}
      threads={threads}
      threadId={thread}
      /**
       * Open a conversation — and follow it into its own mode if it is not the
       * one we are in.
       *
       * The list is shared, so a `review` row is pressable from chat mode.
       * Moving `?thread=` without `?mode=` would leave a review open in a panel
       * that asks with chat's prompt and shows no stance picker, and the
       * transcript would give no sign why. Both setters fire in the same event,
       * so they land in one navigation rather than putting a chat-mode-plus-
       * review-thread entry on the Back stack in between.
       */
      onThread={(id) => {
        const target = id ? threads.find((t) => t.id === id) : null;
        if (target && target.kind !== kind) onMode(target.kind === "review" ? "review" : "chat");
        void setThread(id);
      }}
      onNew={startNew}
      /* **Owned above this panel**, which is remounted on every conversation
         switch — see the note where the hook is called. */
      live={live}
      onStartLive={(id) => live.start({ threadId: id })}
      /* Local only — an empty conversation was never written down. See
         `withoutEmpty` in useChat.ts. */
      onDiscard={discard}
      onSend={(question, useProfile) => {
        // `send` returns the thread it went to, minted here when this is a new
        // conversation — so the URL can name it before the request lands.
        /* The OPEN conversation's kind where there is one, and this mode's
           where there is not — a first message is what decides a new thread's
           kind, and after that the thread decides. The server refuses a kind
           that contradicts an existing thread rather than taking our word for
           it, so this being wrong is a 409 rather than a corrupted transcript. */
        const sendKind = open?.kind ?? kind;
        const id = send(
          thread,
          question,
          at,
          useProfile,
          (corrected) => void setThread(corrected),
          undefined,
          sendKind,
          sendKind === "review" ? stance : undefined,
        );
        if (id !== thread) void setThread(id);
      }}
      /* The box under the list. `null` rather than `thread` is the whole
         difference: it mints whatever `?thread=` still says, which on the list
         is either nothing, a conversation the fetch has not brought yet, or one
         that was closed and discarded. The nonce goes up for the same reason
         `startNew` raises it — this *is* a new conversation being started, and
         the reader who typed to start it should still have a caret when it
         opens, in the composer that has just replaced the one they typed into. */
      onSendNew={(question, useProfile) => {
        /* `null` for the thread, so this mints a new one — and therefore this
           mode's kind, not any open conversation's. */
        const id = send(
          null,
          question,
          at,
          useProfile,
          (corrected) => void setThread(corrected),
          undefined,
          kind,
          kind === "review" ? stance : undefined,
        );
        void setThread(id);
        setFocusNonce((n) => n + 1);
      }}
      onRename={rename}
      onDelete={(id) => {
        remove(id);
        // Back to the list rather than to a conversation that is not there.
        if (id === thread) void setThread(null);
      }}
      /* All three carry the *open* thread rather than a thread id from the
         panel, because the panel only ever shows one and the id it would send
         back is the one it was given. `thread` is non-null wherever these can
         be pressed — the conversation view is what renders them. */
      onRetry={(messageId) => thread && retry(thread, messageId)}
      onEdit={(messageId, question) => thread && edit(thread, messageId, question, at)}
      onStop={(messageId) => thread && stop(thread, messageId)}
      onJump={onJump}
      recovering={recovering}
      blocks={blocks}
      focusNonce={focusNonce}
      error={error}
      kind={kind}
      stance={stance}
      onStance={setPicked}
    />
  );
}

/**
 * The glossary's jobs and verbs. The read itself belongs to `Reader`.
 *
 * A component of its own for the reason `ConversationBand` above is — but **no longer
 * the same reason it used to be**, and the old one is worth deleting rather
 * than leaving to mislead. It used to say: `useGlossary` fetches on mount, so
 * calling it up in `Reader` would charge every reader of every article for a
 * list almost none of them will open. That stopped being true on 2026-08-26,
 * when the dotted underlines became a standing property of the article and the
 * list had to be fetched for everyone anyway.
 *
 * What survives is the other half: **`useJobs` polls the job list for ever**,
 * and that is a request every eight seconds for the life of the panel. A reader
 * who never opens the band should not pay for a poller. Hooks cannot be called
 * conditionally, so the condition has to be a component boundary — this one.
 * The band's own mount revalidation rides on the same boundary.
 *
 * `?term=` and `?sort=` live here too, for the same reason: both are
 * meaningless outside glossary mode, and reading them in `Reader` would put two
 * parameter subscriptions on every render of the reading view for values only
 * this component uses.
 *
 * `onSelected` is the one thing that goes back out, and it is the seam
 * described on `term` in `Reader`: the panel knows which entry is selected, the
 * prose is where its underlines are drawn, and those are two different
 * components.
 */
function GlossaryBand({
  slug,
  read,
  onJump,
  onSelected,
}: {
  slug: string;
  /**
   * The read, owned by `Reader`.
   *
   * There is no `onEntries` any more, and its absence is the change: the list
   * used to be fetched twice and pushed back up from here, which needed a
   * `pushed` ref to stop the slower copy overwriting the fresher one. One
   * owner, one list, nothing to push.
   */
  read: GlossaryRead;
  onJump(id: BlockId): void;
  onSelected(selection: TermSelection | null): void;
}) {
  useRenderCount("GlossaryBand");
  const glossary = useGlossary(slug, read);
  const band = useGlossaryMode(glossary.glossary?.entries ?? NO_TERMS, onSelected);

  return (
    <GlossaryPanel
      access={{ kind: "owner", owner: glossary, glossary: glossary.glossary }}
      {...band}
      onJump={onJump}
    />
  );
}

/**
 * Quotes, and the fetch that belongs to it.
 *
 * A component of its own for the reason `GlossaryBand` and `IdeasBand` are:
 * `useQuotes` fetches on mount, and calling it up in `Reader` would charge every
 * reader of every article a request for a list almost none of them will open.
 *
 * What it pushes up is the **resolved** passage, not the stored quote. The panel
 * and the prose have to be showing the same thing, and the only way to
 * guarantee that is for one of them to compute it and hand it to the other —
 * the rule `SearchBand` and `IdeasBand` both follow. Resolution can drop a
 * quote whose block the article no longer has, which is exactly the case a
 * stale artefact produces here.
 */
function QuotesBand({
  slug,
  blocks,
  onJump,
  onFound,
}: {
  slug: string;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
}) {
  useRenderCount("QuotesBand");
  const quotes = useQuotes(slug);
  const band = useQuotesMode({ quotes: quotes.quotes, blocks, onFound });
  return (
    <QuotesPanel
      access={{ kind: "owner", owner: quotes, quotes: quotes.quotes }}
      {...band}
      onJump={onJump}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useQuotes` and therefore no `useJobs`: the list came in the page's own
 * payload. See `VisitorGlossaryBand` for why this is a second band and not a
 * second panel.
 */
function VisitorQuotesBand({
  quotes,
  blocks,
  onJump,
  onFound,
}: {
  quotes: PublicQuotes;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
}) {
  useRenderCount("VisitorQuotesBand");
  const band = useQuotesMode({ quotes, blocks, onFound });
  return <QuotesPanel access={{ kind: "visitor", quotes }} {...band} onJump={onJump} />;
}

/**
 * Everything the quotes band does that is not a fetch: `?quote=`, `?rank=`,
 * `?bar=`, and the resolved passage it pushes up.
 *
 * **No colour slot to assign**, which is the one thing this hook does not share
 * with `useIdeasMode`. Ideas paint every idea a lane so a colour does not depend
 * on which one is open; only one quote can be selected at a time and there is
 * never a second one on screen, so slot `0` is the whole palette question. It is
 * still a *real* slot rather than `null`, because `blockHues` drops `null` slots
 * and a quote without one would paint the rail and leave the paragraph bar
 * blank — which looks like a rendering bug and is not one.
 */
function useQuotesMode({
  quotes,
  blocks,
  onFound,
}: {
  quotes: { quotes: Quote[] } | null;
  blocks: Block[];
  onFound(found: Found[]): void;
}) {
  const [quoteId, setQuoteId] = useQueryState("quote", quoteParam);
  const [rank, setRank] = useQueryState("rank", rankParam);
  /* Null is "nobody has touched the bar", which the panel resolves to
     `PROMOTE_BAR`. Kept as null rather than defaulted here so the default stays
     one number in one file — see `barParam` in params.ts. */
  const [bar, setBar] = useQueryState("bar", barParam);

  const selected = useMemo(
    () => quotes?.quotes.find((q) => q.id === quoteId) ?? null,
    [quotes, quoteId],
  );

  const found = useMemo(() => {
    if (!selected) return [];
    return resolveQuote(blocks, {
      id: selected.id,
      slot: 0,
      blockId: selected.blockId,
      text: selected.text,
      /* **`start` is not passed on**, and `resolveQuote` no longer takes it —
         the stored offset is measured in `block.text` and this resolution
         happens in the rendered text. It is still on the artefact, because it
         is what `inDocumentOrder` sorts two quotes from one paragraph by. */
      ...(selected.reason !== undefined && { reason: selected.reason }),
    });
  }, [selected, blocks]);

  /* **`useLayoutEffect`, not `useEffect`** — a passive effect leaves one
     paintable frame in which the panel shows the new quote and the prose still
     marks the old one. Same reasoning, and the same pairing with an
     unmount-only clear below, as `SearchBand` and `IdeasBand`. */
  useLayoutEffect(() => {
    onFound(found);
  }, [found, onFound]);

  /* Leaving quotes mode must take the mark out of the prose. On unmount only:
     clearing on every change would race the layout effect above. */
  useEffect(() => () => onFound([]), [onFound]);

  return { quoteId, onQuote: setQuoteId, rank, onRank: setRank, bar, onBar: setBar };
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useGlossary`, no `useJobs`, no fetch of any kind: the list came in the
 * page's own payload (src/public-types.ts § PublicArtefactSet), so this
 * component is the query parameters and nothing else.
 *
 * A second *band* rather than a second *panel*, and the difference is the whole
 * design. `GlossaryBand` above exists because hooks cannot be called
 * conditionally, so "a visitor does not poll the job list" has to be a component
 * boundary — but everything a reader looks at is drawn by one `GlossaryPanel`
 * with its data injected. Two panels for one list is how the owner's glossary
 * and the visitor's glossary drift into two designs for one thing, which a
 * browser pass caught once already in a drawer heading.
 */
function VisitorGlossaryBand({
  glossary,
  onJump,
  onSelected,
}: {
  glossary: PublicGlossary;
  onJump(id: BlockId): void;
  onSelected(selection: TermSelection | null): void;
}) {
  useRenderCount("VisitorGlossaryBand");
  const band = useGlossaryMode(glossary.entries, onSelected);
  return <GlossaryPanel access={{ kind: "visitor", glossary }} {...band} onJump={onJump} />;
}

/**
 * Everything the glossary band does that is not a fetch — the three parameters
 * and the selection it pushes back up.
 *
 * A hook rather than a base component, because two bands need all of it and
 * only one of them may call `useGlossary`. `?term=`, `?sort=` and `?gate=` live
 * here for the reason they used to live in the band: all three are meaningless
 * outside glossary mode, and reading them in `Reader` would put three parameter
 * subscriptions on every render of the reading view for values only this mode
 * uses.
 */
function useGlossaryMode(
  entries: readonly GlossaryEntry[],
  onSelected: (selection: TermSelection | null) => void,
) {
  const [termId, setTermId] = useQueryState("term", termParam);
  const [sort, setSort] = useQueryState("sort", sortParam);
  /* Null is "nobody has touched the threshold", which the panel resolves to
     `PRIORITY_GATE`. Kept as null rather than defaulted here so the default
     stays one number in one file — see `gateParam` in params.ts. */
  const [gate, setGate] = useQueryState("gate", gateParam);

  /* `find` returns the entry object out of the list, so its identity is stable
     across renders until the list itself is replaced — which is what keeps the
     effect below from firing on every render. */
  const selected = entries.find((e) => e.id === termId) ?? null;

  useEffect(() => {
    onSelected(
      selected ? { id: selected.id, forms: formsOf(selected), blocks: selected.blocks } : null,
    );
  }, [selected, onSelected]);

  /* Leaving glossary mode must take the *highlight* off the pressed term. Not
     the underlines, which since 2026-08-26 are a standing property of the
     article and outlive the band — this comment said otherwise until a GPT Sol
     review noticed it was describing the old behaviour.

     Its own effect, with no dependency on `selected`, so it runs on unmount and
     only on unmount — folding it into the cleanup of the effect above would
     clear the selection on every change and set it again immediately, which is
     a visible flicker. */
  useEffect(() => () => onSelected(null), [onSelected]);

  return {
    termId,
    onTerm: (id: string | null) => void setTermId(id),
    sort,
    onSort: (next: TermSort) => void setSort(next),
    gate,
    onGate: (next: number | null) => void setGate(next),
  };
}

/**
 * Search, and the fetch that belongs to it.
 *
 * A component of its own for the reason `ConversationBand` and `GlossaryBand` above
 * are: **`useSearch` fetches on mount**, so calling it up in `Reader` would
 * charge every reader of every article a request for a list of saved searches
 * almost none of them will open. Hooks cannot be called conditionally, so the
 * condition has to be a component boundary.
 *
 * All four of its URL parameters live here too, for the same reason `?term=`
 * and `?sort=` live in `GlossaryBand`: every one of them is meaningless outside
 * search mode, and reading them in `Reader` would put four parameter
 * subscriptions on every render of the reading view for values only this
 * component uses.
 *
 * ## The two matchers meet here and nowhere else
 *
 * `results` below is the whole of that design: whichever matcher is selected
 * produces a `Found[]`, and from that line onwards the panel, the marks, the
 * bar down each paragraph and the sort control are identical. Adding a third
 * way of matching would be a third arm of this one ternary.
 *
 * The literal matcher runs **in this memo**, on every keystroke, over every
 * block — which sounds alarming and is not: it is one `indexOf` loop over a few
 * hundred short strings, and it is what makes typing feel instant rather than
 * like a search you have to submit. The expensive matcher is the one that
 * already has a button.
 */
function SearchBand({
  slug,
  blocks,
  onJump,
  onFound,
  openHit,
  onOpenHit,
}: {
  slug: string;
  blocks: Article["blocks"];
  onJump(id: BlockId): void;
  /* Out only. The results are computed here and pushed up to `Reader`, which
     owns the prose — the seam described on `found` there. Passing them back
     down would be a second copy of a value this component is the source of. */
  onFound(next: Found[]): void;
  openHit: string | null;
  onOpenHit(next: string | null): void;
}) {
  useRenderCount("SearchBand");
  const { runs, loaded, loadFailed, ask, retry, remove, recolour, error } = useSearch(slug);
  const [match, setMatcher] = useQueryState("match", matchParam);
  const [find, setFind] = useQueryState("find", findParam);
  /* `?match=` has no default of its own, so that a URL carrying `?find=` and
     nothing else still opens on the words matcher it was written for. The rule
     lives in params.ts § resolveMatcher; here it is one line. */
  const matcher = resolveMatcher(match, find);
  /* `?run=` is read and never written — the one-search URLs that existed before
     2026-08-26 seed the set, and from then on it is `?runs=`. params.ts §
     resolveRuns has the why. */
  const [run1] = useQueryState("run", runParam);
  const [runIds, setRunIds] = useQueryState("runs", runsParam);
  const active = useMemo(() => resolveRuns(runIds, run1), [runIds, run1]);
  const [order, setOrder] = useQueryState("order", orderParam);
  /* Null until the reader drags it — see confParam, and `gateParam` beside it,
     for why "nobody has touched this" has to stay distinguishable from "the
     reader chose the default". */
  const [chosenConf, setConf] = useQueryState("conf", confParam);
  const gate = chosenConf ?? PRIORITY_CONF;

  /**
   * Which colour each saved search wears.
   *
   * Over **every** saved run, not just the switched-on ones, and that is the
   * point rather than an oversight: a search's colour must not change when the
   * reader unticks the search above it. Assigning over the active set would do
   * exactly that, and it would be the kind of wrong that looks like a rendering
   * glitch — the same three passages, a different colour, every time you touch
   * a box. hit-colours.ts § What the assignment has to be.
   */
  const slots = useMemo(() => assignSlots(runs), [runs]);

  /* One list, two producers, and on the meaning side several searches merged.

     **A `pending` run contributes its hits now**, which is the whole of what
     streaming search buys the reader: since 2026-08-26 the hook appends each
     passage to `run.hits` as it arrives and leaves the status `pending` until
     the authoritative result lands, so filtering on `done` here meant the marks
     appeared in the prose all at once at the end anyway. Everything upstream
     streamed and this line quietly undid it.

     The comment this replaces said a pending run "has no hits", which was true
     when it was written and is the reason to reread a filter rather than trust
     the sentence above it.

     A failed run still contributes nothing, and that half of the original
     reasoning stands: it has no hits worth trusting, and showing an older run's
     marks under a newer run's colour would be the panel and the prose saying
     different things. Stale hits cannot leak in on a retry either — the hook
     writes a fresh `hits: []` before it reopens the stream. */
  const answered = useMemo(
    () =>
      runs
        .filter((r) => active.includes(r.id) && r.status !== "error")
        .map((r) => ({ id: r.id, slot: slots.get(r.id) ?? 0, hits: r.hits })),
    [runs, active, slots],
  );

  /* The ordered results, before the prioritised bar. Kept as its own value
     because the slider needs a denominator: the reader has to be told `3 of 11`
     rather than `3`, or a filter that hides eight things looks like a search
     that found three. */
  const ordered = useMemo(
    () =>
      orderFound(
        matcher === "words" ? findLiteral(blocks, find) : resolveHits(blocks, answered),
        order,
      ),
    [matcher, blocks, find, answered, order],
  );

  /* And after it. **This is the one place the threshold may be applied**, for
     the same reason `ordered` is computed here rather than in the panel: what
     goes to the panel goes to the prose, so the marks in the article are the
     rows in the list and can never be a different set. A filter applied in the
     panel would hide a row and leave its wash on the paragraph. See the
     `hitMarks` prop in TableView.tsx and `found` in Reader above.

     Note it is the whole list back again for every order but this one, so
     `?conf=` sitting in a URL cannot filter a list the reader is not looking
     at a threshold for. */
  const results = useMemo(
    () => (order === "prioritised" ? keepAbove(ordered, gate) : ordered),
    [ordered, order, gate],
  );

  /* A result the bar has hidden cannot stay the open one. Its row and its mark
     both go, so nothing on screen says it is open — but the key survived, and
     dragging the bar back later silently reopened a selection the reader had
     made minutes ago and watched disappear. Cleared rather than remembered:
     "open" is a thing the reader can see, and a hidden one is a claim about the
     page that the page is not making. GPT Sol's review, 2026-08-26.

     Keyed on absence from `results`, so ordinary streaming — where the open row
     is still in the list — leaves it alone. */
  useEffect(() => {
    if (openHit && !results.some((f) => f.key === openHit)) onOpenHit(null);
  }, [results, openHit, onOpenHit]);

  /* Push the results up to `Reader`, which owns the prose. `onFound` is a plain
     setter and therefore stable, so this cannot loop.

     **`useLayoutEffect`, not `useEffect`, and the difference is a frame the
     reader can see.** This component renders the new results list immediately;
     the prose is `Reader`'s, so it only changes once this setter has run and a
     second commit has happened. `useEffect` runs *after* the browser may have
     painted, so there is a window — a tick, a stream frame landing, a matcher
     switch — where the panel shows the new passages and the article still shows
     the old marks. That is the one invariant this feature is built around
     (search-hits.ts § the panel and the prose agree), so a frame of it is worth
     a synchronous commit. `useLayoutEffect` runs before paint, which closes it.

     It is cheap because the expensive half already happened: the memo above has
     computed `results` either way, and this only adds one render before paint.
     Raised by a GPT Sol review, 2026-08-26, which is also right that the real
     fix is one owner for the derived state rather than two — that is a change
     to how all four bands talk to `Reader`, and it is not this change. */
  useLayoutEffect(() => onFound(results), [results, onFound]);

  /* Leaving search mode must take the marks out of the prose with it. Its own
     effect, with no dependency on the results, so it runs on unmount and only
     on unmount — folding it into the cleanup above would clear the marks on
     every keystroke and set them again immediately, which is a visible flicker
     of every highlight on the page. Exactly the trap `GlossaryBand` documents. */
  useEffect(
    () => () => {
      onFound([]);
      onOpenHit(null);
    },
    [onFound, onOpenHit],
  );

  return (
    <SearchPanel
      matcher={matcher}
      onMatcher={(next) => {
        void setMatcher(next);
        /* The selection goes with the matcher, because the row it names belongs
           to the list that is about to be replaced. The ticks do **not**: they
           are the reader's own answer to "what should be marked", and switching
           to words to look something up and back again should return them to
           the article they left rather than to a blank one. That is a change
           from the single-`?run=` version, which cleared it — because there
           "which search is open" was a view state that words mode plainly did
           not have, and a set of ticks is a preference that survives a look
           elsewhere. */
        onOpenHit(null);
      }}
      find={find}
      onFind={(next) => {
        void setFind(next);
        onOpenHit(null);
      }}
      runs={runs}
      loaded={loaded}
      loadFailed={loadFailed}
      active={active}
      slots={slots}
      onToggle={(id, on) => {
        void setRunIds(on ? [...active, id] : active.filter((x) => x !== id));
        /* Whatever row was open may have belonged to the search just switched
           off, and a highlighted row pointing at a mark that is no longer drawn
           is the panel and the prose disagreeing. Cheap to clear, and the
           reader loses only a highlight. */
        onOpenHit(null);
      }}
      /* Pressing the row rather than its box: the set becomes this one search.
         Greg, 2026-08-27 — *"if I click on a row, select that and deselect all
         the others (since usually we care about just one at a time). If I want
         multiple-selection, I'll use a checkbox."* Not a toggle, so pressing
         the row that is already alone leaves it alone; the box is what unticks.
         The open row goes for the same reason it goes on a toggle — it may have
         belonged to a search that is no longer drawing anything. */
      onSolo={(id) => {
        void setRunIds([id]);
        onOpenHit(null);
      }}
      onToggleAll={(on) => {
        void setRunIds(on ? runs.map((r) => r.id) : []);
        onOpenHit(null);
      }}
      onAsk={(criterion) => {
        /* `ask` mints the id, so `?runs=` can name the search before the model
           has said anything — the same trick `?note=` and `?thread=` use.

           And it switches itself on, which is the one exception to
           default-false: a search the reader just paid for and cannot see is
           not a result. */
        void setRunIds([...active, ask(criterion)]);
        onOpenHit(null);
      }}
      onRetry={retry}
      /* Straight through. Unlike every other write on this panel it does not
         touch `?runs=` or the open row: a colour changes what a mark looks
         like, never which marks are drawn or which one the reader is on. */
      onRecolour={recolour}
      onDelete={(id) => {
        remove(id);
        void setRunIds(active.filter((x) => x !== id));
        onOpenHit(null);
      }}
      found={results}
      all={ordered}
      order={order}
      onOrder={(next) => void setOrder(next)}
      gate={gate}
      gateMoved={chosenConf !== null}
      onGate={(next) => void setConf(next)}
      openKey={openHit}
      onOpen={(key, blockId) => {
        onOpenHit(key);
        // Always jump, even when the block is already on screen — unlike
        // stepping between comments, which deliberately does not. A search
        // result is a place you have not been yet, and "I pressed it and
        // nothing moved" is the complaint that makes a results list feel
        // broken; two comments in one paragraph are the opposite case.
        onJump(blockId);
      }}
      error={error}
    />
  );
}

/**
 * The summary outline, and the two bits of view state that belong to it.
 *
 * A component of its own even though it fetches nothing, for the reason the
 * `?deep=` parameter gives: it is meaningless outside summary mode, and reading
 * it in `Reader` would put a parameter subscription on every render of the
 * reading view for a value only this component uses.
 *
 * **Owner and visitor get the same component, because there is nothing to
 * own.** Until 2026-08-31 there were two bands, an owner's `useSummaries` fetch
 * and a visitor's `PublicSummaries` from the page payload, both feeding a panel
 * that took an `access` prop. All of that was carrying the generated length
 * ladder; the gists come down inside the article itself, and the two arms
 * collapse into this. docs/plans/260831s-gist-only-summaries.md.
 *
 * See docs/project/summaries.md.
 */
function SummaryBand({
  article,
  onJump,
}: {
  article: Article;
  onJump(id: BlockId): void;
}) {
  useRenderCount("SummaryBand");
  return <SummaryPanel {...useSummaryMode(article)} onJump={onJump} />;
}

/**
 * Everything the summary band does that is not rendering.
 *
 * `?deep=` lives here for the reason it used to live in the band: it is
 * meaningless outside summary mode, and reading it in `Reader` would put a
 * parameter subscription on every render of the reading view for a value only
 * this mode uses.
 */
function useSummaryMode(article: Article) {
  const [deep, setDeep] = useQueryState("deep", deepParam);

  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks),
    [article.tree, article.blocks],
  );

  /* Read, never written, and not a subscription: `?at=` is already tracked by
     useReadingPosition in the parent, so this component re-renders whenever it
     changes and `location.search` is current. Same read-at-render trick
     ConversationBand uses, and Dock.tsx for its carried query string.

     Turned into a row index here rather than passed down as an id, because the
     panel's question is "is the reader inside this range", and a range is a
     pair of row indices — comparing ids would be comparing random strings for
     order, which is the one thing block-ids.md forbids. */
  const at = new URLSearchParams(location.search).get("at");
  const atRow = useMemo(() => {
    if (at === null) return null;
    const i = article.blocks.findIndex((b) => b.id === at);
    return i === -1 ? null : i;
  }, [at, article.blocks]);

  return { root, deep, onDeep: (next: number) => void setDeep(next), atRow };
}

/**
 * Diagram mode's band — the article, drawn.
 *
 * Same shape as `SummaryBand` above and for the same reasons: `?diagram=` is
 * read here rather than in `Reader`, because it is meaningless outside this mode
 * and a subscription in the parent would cost every render of the reading view.
 *
 * **This component fetches nothing**, and that is a statement about this
 * component rather than about the mode. The shape of the picture comes from
 * `article.tree` and `article.blocks`, which the page already holds — so unlike
 * chat, glossary, search and summary there is no artefact to wait for and no
 * job to run here. The two hooks that do spend money live inside the panel,
 * each gated on its own picture being the one on screen: `useSimilar` for
 * Force's dotted lines, `useProjection` for the two scatters' dots. `slug` is
 * passed for exactly that.
 *
 * All three pictures spend a model call since the free one — `tree`, the
 * outline — was cut on 2026-08-30. Force is the default because it is the only
 * one that draws something real before its answer lands. See
 * docs/project/diagram.md.
 */
function DiagramBand({
  slug,
  article,
  at,
  onJump,
}: {
  slug: string;
  article: Article;
  /**
   * Where the reader is, **from `useReadingPosition`'s own state rather than
   * from `location.search`.**
   *
   * The other bands read the address at render time, and that is fine for them.
   * It is not fine here, because this panel has buttons that *move* the reader
   * and then compute their next move from where they think the reader is.
   * `jumpTo` writes the URL with `throttle(0)`, which lands on the next task —
   * so a render triggered by the state change can still see the old
   * `location.search`, and a second press inside that window steps from the
   * stale row and lands on the rung it has just used. GPT Sol, 2026-08-30.
   */
  at: BlockId | null;
  onJump(id: BlockId): void;
}) {
  useRenderCount("DiagramBand");
  const [kind, setKind] = useQueryState("diagram", diagramParam);
  /* The two scatter controls, in the URL beside the picture they belong to —
     `?dx=` and `?dhue=`. They live here rather than in the panel for the same
     reason `?diagram=` does: every bit of view state is in the address
     (docs/project/url-state.md), and unlike the collapse set these are stable
     words rather than positional ids, so a pasted link cannot become quietly
     wrong after a re-ingest. */
  const [axis, setAxis] = useQueryState("dx", diagramAxisParam);
  const [hue, setHue] = useQueryState("dhue", diagramHueParam);

  /* Titles, gists and sizes, all of which are on the tree — which is what keeps
     a diagram from ever being blank on an article nobody has paid for. */
  const root = useMemo(
    () => buildSummaryTree(article.tree, article.blocks),
    [article.tree, article.blocks],
  );

  /* Turned into a row index because the question is "which node contains the
     reader", and containment is a comparison of row indices. Block ids carry no
     order. */
  const atRow = useMemo(() => {
    if (at === null) return null;
    const i = article.blocks.findIndex((b) => b.id === at);
    return i === -1 ? null : i;
  }, [at, article.blocks]);

  return (
    <DiagramPanel
      slug={slug}
      root={root}
      kind={kind}
      onKind={(next) => void setKind(next)}
      atRow={atRow}
      onJump={onJump}
      blocks={article.blocks}
      axis={axis}
      onAxis={(next) => void setAxis(next)}
      hue={hue}
      onHue={(next) => void setHue(next)}
    />
  );
}
