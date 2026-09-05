import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { throttle, useQueryState, useQueryStates } from "nuqs";
import type {
  Article,
  Block,
  BlockId,
  ChatThread,
  Comment,
  GlossaryEntry,
  Idea,
  Quote,
  RememberStance,
  ThreadKind,
  TimelineEvent,
  Visibility,
} from "../types.js";
import { Library } from "./Library.js";
import { AuthCallback } from "./AuthCallback.js";
import { HomeLogo } from "./HomeLogo.js";
import { isAdmin } from "../admin.js";
import { AdminFeedbackPage, AdminHome, AdminUsersPage } from "./AdminPage.js";
import { LandingPage } from "./LandingPage.js";
import { NotFoundPage } from "./NotFoundPage.js";
import { PrivacyPage } from "./PrivacyPage.js";
import { ContactPage } from "./ContactPage.js";
import { FeaturesPage } from "./FeaturesPage.js";
import { PublicLibraryPage } from "./PublicLibraryPage.js";
import { PricingPage } from "./PricingPage.js";
import { SignInPage } from "./SignInPage.js";
import { useSession } from "./useSession.js";
import { useJobSession } from "./useJobs.js";
import { useExperimental } from "./useExperimental.js";
import { DesignPage } from "./DesignPage.js";
import { ProfilePage } from "./ProfilePage.js";
import { AddPage } from "./AddPage.js";
import {
  type ArticleView,
  LIBRARY_HREF,
  navigate,
  type Route,
  addressWithout,
  useAddress,
  useRoute,
} from "./router.js";
import type { User } from "@supabase/supabase-js";
import { FeedbackButton } from "./FeedbackButton.js";
import { Metadata } from "./Metadata.js";
import { IdeasPanel } from "./IdeasPanel.js";
import { useIdeas } from "./useIdeas.js";
import { TimelinePanel } from "./TimelinePanel.js";
import { useTimeline } from "./useTimeline.js";
import { QuizPanel, RememberSubModeToggle } from "./QuizPanel.js";
import { useQuiz } from "./useQuiz.js";
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
import {
  effectiveSort,
  gateToReveal,
  GlossaryPanel,
  PRIORITY_GATE,
  visibleEntries,
} from "./GlossaryPanel.js";
import {
  barStops,
  effectiveRank,
  QUOTE_BAR_DEFAULT,
  QuotesPanel,
  snapToStop,
  visibleQuotes,
} from "./QuotesPanel.js";
import { useQuotes } from "./useQuotes.js";
import { ProseHoverCard } from "./ProseHoverCard.js";
import { buildNoteIndex, type NoteMarker, type NoteReturn } from "./notes-view.js";
import { useArc } from "./useArc.js";
import { useGlossary, useGlossaryRead, type GlossaryRead } from "./useGlossary.js";
import { SummaryPanel } from "./SummaryPanel.js";
import { DiagramPanel, type DiagramAccess } from "./DiagramPanel.js";
import { ClaimsBand } from "./ClaimsPanel.js";
import { CriteriaBand } from "./CriteriaPanel.js";
import { MirrorBand } from "./MirrorPanel.js";
import { CandidatesBand } from "./CandidatesPanel.js";
/* Referee mode's rule 5, and the one thing in the band that is not a sub-mode:
   the deterministic scan of the document's own source, drawn above the chips
   because a hidden instruction bears on all four panels. src/injection-scan.ts
   is the scanner and it calls no model. */
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
import { SourceScanNotice } from "./SourceScanNotice.js";
import { RefereeHowButton, RefereeHowCard, useHowCard } from "./RefereeCard.js";
import { useSourceScan } from "./useSourceScan.js";
import { SearchPanel } from "./SearchPanel.js";
import { useSearch, type SavedSearch } from "./useSearch.js";
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
  refereeParam,
  refScaleParam,
  REFEREE_VIEWS,
  type RefereeView,
  rememberParam,
  barParam,
  eventParam,
  ideaParam,
  termParam,
  findParam,
  matchParam,
  type Matcher,
  resolveMatcher,
  orderParam,
  type HitOrder,
  confParam,
  currentAt,
  runParam,
  runsParam,
  resolveRuns,
  spineParam,
  textParam,
  threadParam,
  type Mode,
  type TermSort,
} from "./params.js";
/* The mode's own name, from the one file that spells it — so the bar's close
   button, the dock's button and the browser tab cannot say three things.
   src/title-text.ts § MODE_LABEL. */
import { MODE_LABEL } from "../title-text.js";
import { ChevronDown, ChevronRight, ClipboardCheck, X } from "lucide-react";
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
import { DEFAULT_ROOT_PX, fitView, proseVisible } from "./layout.js";
import { navPlan, useArrowNav } from "./keynav.js";
import { useLastView } from "./last-view.js";
import { useSwipeNav } from "./swipe.js";
import { useComments } from "./useComments.js";
import { ChatDialog, type ChatTarget } from "./ChatDialog.js";
import { anchored, countByBlock, helpThreadFor, useChatAnchors } from "./useChatAnchors.js";
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
  PublicTimeline,
} from "../public-types.js";
import {
  artefactsIn,
  artefactsOf,
  visitorComments,
  visitorSearches,
} from "./public-artefacts.js";
import { NO_TERMS, NO_THREADS, type ReaderCapability } from "./reader-capability.js";
import { markedModes, visitorGap } from "./visitor.js";
import {
  NotSharedPage,
  ReauthRequiredPage,
  SharedNotice,
  ViewOnlyChip,
  VisitorBand,
} from "./PublicChrome.js";
import { PublicMetadataPage, VisitorTweetsPage } from "./PublicPages.js";
import { useRenderCount } from "./perf.js";
import {
  REFEREE_DECLARE_IT,
  REFEREE_TEXT_ALREADY_SENT,
  REFEREE_TEXT_ALREADY_SENT_SHORT,
} from "../messages.js";
import { FEEDBACK_BLOCK_IDS, setFeedbackArticleContext } from "./feedback-context.js";

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
 * **No gist-column depths**, wanted in two places for the same reason and by two
 * different questions.
 *
 *  - The outline band asks `useColumnContext` to measure none of them, because a
 *    mode has no gist columns and the band wants only `focusRow`.
 *  - Plain mode hands it to `fitView` as `chosen`, which is the whole of how
 *    that mode empties the table — see `plainCols` below.
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
  timeline: true,
  sketch: true,
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
  const { session, user, loading } = useSession();

  /**
   * **The one thing that keeps an import moving while the reader reads.**
   *
   * On Vercel the browser is the worker, and until 2026-09-01 the loop that
   * drove it lived in `useJobs` — mounted from the shelf, the add page and,
   * through `useStepJob`, the reading view. Every branch below is an early
   * `return`, so there is no persistent shell component at all, and driving an
   * import therefore depended on whether the page the reader happened to open
   * mounted one of those. On `/profile`, `/design`, `/admin` and the landing
   * page it mounted none, and the import stopped. It is a tab-level service now
   * (src/web/jobEngine.ts) and this is where its session begins and ends; the
   * effect itself is `useJobSession` in useJobs.ts, so that a test can render
   * the real one rather than a copy of it.
   */
  useJobSession(user?.id ?? null, session?.access_token ?? null);

  /**
   * **Nothing here tells the experimental-features store who is reading.** It
   * used to, from an effect beside this one, and that was a frame too late: a
   * passive effect runs after its children have rendered, so on an account
   * switch every `Dock` on the page drew once from the previous account's
   * snapshot. The store subscribes to `onAuthStateChange` itself now, in the
   * same notification pass as `useSession` — src/web/experimental-store.ts
   * § the store listens for it itself.
   *
   * **And nothing here wakes it, either.** The store starts listening on its
   * first subscriber and asks the server for nobody until then. Since stage 2
   * the subscribers are the four components that mount a `Dock` — `Reader`
   * below, `Metadata`, `Tweets` and `VisitorDock` in PublicPages.tsx — each
   * calling `useExperimental()` and handing the answer down as a prop, because
   * the bar is told rather than going and getting it (Dock.tsx § experimental).
   * A stranger still asks for nothing: the store issues no request for a
   * signed-out reader, who is off because we decided.
   *
   * A keep-awake subscriber sat here briefly — `subscribe(() => {})`, ignoring
   * what it heard — so that the switch was read once up front rather than when
   * a page mounted. It bought a round trip's head start and existed mainly to
   * keep a trace assertion true, which is the wrong way round. What replaced it
   * is the real subscriber in `Reader`.
   */

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
    /* **The third exception, since 2026-09-02.** The privacy policy is for
       somebody deciding whether to sign in, so answering it with the pitch
       would be answering the one question the pitch is trying to get past.
       The landing page's footer links here. See PrivacyPage.tsx.

       **This branch has been written twice.** It first reached trunk inside a
       peer's commit that swept the working tree, and the tidy-up of that
       commit dropped it again as a half-finished hunk — reasonably, since
       nothing in App.tsx said it was one end of a feature whose other end was
       a whole page. Hence this paragraph. */
    if (route.kind === "privacy") return <PrivacyPage />;
    /* The fourth, since 2026-09-03, for the same reason as the third: the
       landing page's "everything it does" link has to land somewhere a
       stranger can read. */
    if (route.kind === "features") return <FeaturesPage signedIn={false} />;
    /* The fifth, and the least arguable of them: a price somebody has to sign
       up to read is the thing people complain about, and this is the page one
       person sends another. */
    /* `readerId={null}` is what stops the page asking `/api/billing/usage` who
       this is — a 401 on the one page a stranger is most likely to be sent, for
       a line that is not about them. PricingPage.tsx § which plan. */
    if (route.kind === "pricing") return <PricingPage readerId={null} />;
    /* Since 2026-09-05, and the least arguable exception of all of them: a page
       whose whole subject is how to reach us is no use to somebody who cannot
       reach it. Bare, like `PrivacyPage` above — signed out there is no shelf
       for a corner logo to link at. ContactPage.tsx.

       Deliberately not numbered: the two comments below say "sixth" and
       "seventh", and they mean the order those branches were *written* rather
       than their order in this list. Renumbering them for an insertion would
       make three comments say something none of them was claiming. */
    if (route.kind === "contact") return <ContactPage />;
    /* **The sixth, since 2026-09-03, and the only one that is not a page
       somebody was sent.** A stranger at an address nobody minted is exactly
       the reader this gate's default fails: the pitch at `/asdf` is a plausible
       page for an address that means nothing, which is the silence the 404 page
       exists to break — and it is worse signed out than signed in, because a
       stranger has no corner logo and no shelf to notice they are not on.
       Bare, like `PrivacyPage` above: `NotFoundPage` draws its own way home.
       docs/plans/260903j-not-found-page.md. */
    if (route.kind === "not-found") return <NotFoundPage signedIn={false} />;
    /* **The seventh, and the only one that is somebody else's articles.**
       `/read/public` lists every article anybody has shared — reachable signed
       out for the same reason `/features` and `/pricing` are, and rather more
       so: it is the page Greg asked for *"to showcase what Spideryarn is capable
       of"*, so a stranger is exactly who it is for. Bare, like the two above it
       and for the same reason: signed out there is no shelf for a corner logo to
       link at, and the page carries `SiteNav` of its own. The edge answers 200
       for this address now, so the status and the page agree.
       PublicLibraryPage.tsx. */
    if (route.kind === "public-library") return <PublicLibraryPage signedIn={false} />;
    if (route.kind !== "read") return <LandingPage />;
    return <ArticlePage slug={route.slug} view={route.view} readerId={null} />;
  }

  /* **Everything below this line is a signed-in reader, and that is the whole
     visibility rule for the Feedback button** — written here, next to the gate
     that decides everything else about being signed in, rather than as a
     condition inside the button.

     A stranger reading a shared article has nowhere for a report to go: the row
     is owner-scoped, and `POST /api/feedback` answers them 401 whatever the
     client draws. **A hidden button is not a gate**, so both halves are tested
     rather than only the visible one — GPT Sol asked for that, and it is the
     difference between a rule and an appearance. See FeedbackButton.tsx and
     docs/project/feedback.md. */
  return (
    <>
      <SignedIn route={route} user={user} />
      <FeedbackButton readerEmail={user.email ?? null} />
    </>
  );
}

/**
 * The pages a signed-in reader can be on.
 *
 * Split out of `App` so that the Feedback button has somewhere to be mounted
 * **once**. Every branch here is an early `return`, so before this split there
 * was no point in the signed-in tree that ran on every page — the same shape
 * that had `useJobs` driving imports only on the pages that happened to mount
 * it (see `useJobSession` above). One wrapper, one button, one rule.
 */
function SignedIn({
  route,
  user,
}: {
  /* **Not `Route`, and the compiler is the reason.** `App` answers `callback`
     before the gate above — it has to, because the reader coming back from an
     auth redirect is by definition not signed in yet — so it cannot reach here.
     Saying that in the type rather than in a comment means the last branch below
     narrows to `read` on its own, instead of needing a `kind === "callback"`
     arm that nothing can ever run. */
  route: Exclude<Route, { kind: "callback" }>;
  user: User;
}) {
  // The shelf is home, so it gets no way-home logo — a link to the page you are
  // already on is a dead control, and Library.tsx names the app in its own
  // `<h1>` anyway. Everywhere else, the corner. See HomeLogo.tsx.
  /* **`key`, and it is the account switch rather than a hint to React.** A
     direct A→B sign-in keeps this element in the same place in the tree, so
     without a key React reuses the instance and `useShelf`'s state — the shelf,
     the Undo strip's title, an open rename — survives into the new reader's
     first commit. The hook clears all of it, but a passive effect runs *after*
     that commit, so there is a frame with A's articles under B's session. The
     key removes the frame by removing the instance. GPT Sol's review of
     docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md
     § Stage 5, 2026-09-03. */
  if (route.kind === "library") return <Library key={user.id} readerId={user.id} />;
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
  // Signed in, the policy gets the corner logo like every other standalone
  // page. Signed out it is rendered bare, above — there is no shelf to go back
  // to and the logo would link at one.
  if (route.kind === "privacy")
    return (
      <>
        <HomeLogo />
        <PrivacyPage />
      </>
    );
  if (route.kind === "features")
    return (
      <>
        <HomeLogo />
        {/* **`signedIn` is what keeps the top bar honest here.** Without it the
            nav drew *Sign in* → `/#sign-in`, and `/` is the shelf for this
            reader, which has no such panel: a link that visibly does nothing.
            GPT Sol, stage 2 code review of
            docs/plans/260904b-pricing-page-and-public-showcase.md, finding 1 —
            this half of it predates that stage. SiteBits.tsx § `signedIn`. */}
        <FeaturesPage signedIn />
      </>
    );
  if (route.kind === "contact")
    return (
      <>
        <HomeLogo />
        <ContactPage />
      </>
    );
  if (route.kind === "pricing")
    return (
      <>
        <HomeLogo />
        {/* **`key`, for the same reason the shelf above has one.** A direct A→B
            sign-in leaves the route alone, so without this React keeps the
            instance and `useBilling`'s one effect never re-runs — B would read
            A's tier and A's usage count. Keyed and identified, like `Library`.
            GPT Sol's review of this change, 2026-09-03. */}
        <PricingPage key={user.id} readerId={user.id} />
      </>
    );
  /* An address nobody minted, with the corner logo every other standalone page
     gets — signed in there *is* a shelf for it to link at, which is the same
     reason the privacy page is bare above and dressed here. NotFoundPage.tsx. */
  if (route.kind === "not-found")
    return (
      <>
        <HomeLogo />
        <NotFoundPage signedIn />
      </>
    );
  /* **The public shelf, signed in, and it is the same page a stranger gets.**
     That is the rule the whole public namespace follows and it is worth saying
     here rather than only in the component: identical bytes either way, and the
     only thing `signedIn` decides is whether the top bar offers a *Sign in*
     link that would go nowhere (SiteBits.tsx § `signedIn`). Dressed with the
     corner logo like every other standalone page here, because signed in there
     is a shelf for it to link at. */
  if (route.kind === "public-library")
    return (
      <>
        <HomeLogo />
        <PublicLibraryPage signedIn />
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

     A reader who is not the administrator gets the shelf — **and since
     2026-09-03 that is no longer the same thing as `/nonsense`**, which now has
     a page of its own (NotFoundPage.tsx). This one deliberately did not follow
     it. The reason is the one docs/project/admin.md already gives for the
     server answering 403 rather than 404: these pages exist, visibly, in the
     bundle every signed-in reader downloads, so pretending the address means
     nothing buys nothing and costs a true sentence.

     Nothing is being hidden by it: these components are in the bundle every
     signed-in reader downloads, so the only refusal that counts is the server's
     on `/api/admin/`, and it would refuse a hand-written `fetch` from this page
     just the same. src/admin.ts § the two halves. */
  if (route.kind === "admin") {
    if (!isAdmin(user.id)) return <Library key={user.id} readerId={user.id} />;
    return (
      <>
        <HomeLogo />
        {route.page === "users" ? (
          <AdminUsersPage />
        ) : route.page === "feedback" ? (
          <AdminFeedbackPage />
        ) : (
          <AdminHome />
        )}
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
  /* **Reopen this article where the reader left it.** Above the fetch, and
     first, because its restore is a layout effect that settles the address
     before anything paints — `useReadingPosition` then reads the `?at=` it put
     back exactly as it reads a pasted one, and needs to know nothing about it.

     Here rather than in main.tsx, which is where every other address rewrite
     lives, because those run once per page load and the commonest way to reopen
     an article is a click on the shelf — a client-side navigation that never
     re-runs that file. src/web/last-view.ts has the whole of it, including why
     a shared link always beats the memory. */
  useLastView(slug);
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

  /* **Its own branch, beside `error` and never through it.** The reader can fix
     this one, and the error page is a `<pre>` with nothing to press. It draws
     its own corner logo, as `NotSharedPage` above does. PublicChrome.tsx. */
  if (access.kind === "reauth-required") return <ReauthRequiredPage />;

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
          comments={access.comments}
          searches={access.searches}
          signedIn={signedIn}
          sessionUnconfirmed={access.sessionUnconfirmed}
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

  /**
   * **Who can read this, if the reader has just changed it** — the second thing
   * layered over the payload, and it is here for the same reason the rename is.
   *
   * This component does not remount when only the view changes, which is the
   * whole point of the fetch living a level up: stepping out to the metadata
   * page and back is free rather than 150KB and a spinner. The cost is that a
   * fact the metadata page *changes* stays as it was fetched — and one of the
   * facts on that page is now also drawn in the masthead
   * (src/web/Masthead.tsx § `SharingMark`). Without this, publishing an article
   * and pressing Back left a lock over a document anyone with the link could
   * read: not a stale number, the one sentence about sharing that must never be
   * wrong. Nothing would have caught it — the payload is correct, the card is
   * correct, and they disagree.
   *
   * **`"unknown"` is a third value rather than a missing one.** A write that
   * failed after the server committed leaves `AccessSharing` unable to say what
   * is true (`WRITE_UNCERTAIN` there), and the honest thing for the masthead is
   * to stop claiming a state rather than keep the one from before the write. It
   * *removes* the key, because an absent `Article.visibility` already means
   * *nobody could tell us* — the same thing the filesystem store's silence
   * means (src/types.ts).
   *
   * The slug travels beside it for the reason it travels beside the title: the
   * `PUT` behind it resolves after the reader may have moved on.
   */
  const [shared, setShared] = useState<{ slug: string; visibility: Visibility | "unknown" } | null>(
    null,
  );
  const visibility = shared?.slug === slug ? shared.visibility : null;

  const article = useMemo(() => {
    /* `!== null`, not truthiness: clearing an override restores the
       extractor's title, and `Meta.title` may be the empty string. Read as
       truthy that would silently fall through to `fetched`, which is still
       carrying the override that was just cleared. */
    const named = title !== null ? { ...fetched, meta: { ...fetched.meta, title } } : fetched;
    if (visibility === null) return named;
    if (visibility === "unknown") {
      /* Deleted rather than set to `undefined`: `exactOptionalPropertyTypes`
         makes those different values, and the one that means *we cannot say*
         is the absent key. */
      const { visibility: _cleared, ...rest } = named;
      return rest;
    }
    return { ...named, visibility };
  }, [fetched, title, visibility]);

  const renameTo = useCallback(
    (forSlug: string, next: string) => setRenamed({ slug: forSlug, title: next }),
    [],
  );
  /**
   * **The same answer twice is not a change.**
   *
   * The card reports what the metadata page's own fetch said as well as what a
   * write said (AccessSharing.tsx), so the ordinary visit — open the page, read
   * the value the payload already carried, go back — reports a value identical
   * to the one in hand. Returning the same state object for that keeps
   * `article` referentially stable, and `Reader` rebuilds its whole geometry
   * from `article` by identity.
   */
  const sharedTo = useCallback((forSlug: string, next: Visibility | null) => {
    const now: Visibility | "unknown" = next ?? "unknown";
    setShared((was) =>
      was?.slug === forSlug && was.visibility === now ? was : { slug: forSlug, visibility: now },
    );
  }, []);

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
    return (
      <Metadata
        slug={slug}
        article={article}
        onRenamed={renameTo}
        onVisibility={sharedTo}
      />
    );
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
   * the opening fetch: subscribing to the job engine puts it on its idle
   * cadence, and a reader who never opens the band should not pay for that.
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
  comments,
  searches,
  signedIn,
  sessionUnconfirmed,
  view,
}: {
  slug: string;
  article: Article;
  /** The artefacts the payload carried. reader-capability.ts § artefacts. */
  artefacts: PublicArtefactSet;
  available: PublicArtefacts;
  /** The owner's comments, read-only. reader-capability.ts § comments. */
  comments: Comment[];
  /** The owner's saved searches, read-only. reader-capability.ts § searches. */
  searches: SavedSearch[];
  /** For the call to action, and nothing else — reader-capability.ts § signedIn. */
  signedIn: boolean;
  /**
   * **Only for what the chrome says**, and it goes to all three views rather
   * than to the reading view alone: the other two are one click away and carry
   * the same `SharedNotice`, so a reader who stepped out to the metadata page
   * would otherwise watch the explanation vanish. App.tsx § ArticleAccess.
   */
  sessionUnconfirmed: boolean;
  view: ArticleView;
}) {
  if (view === "metadata")
    return (
      <PublicMetadataPage
        slug={slug}
        article={article}
        available={available}
        signedIn={signedIn}
        sessionUnconfirmed={sessionUnconfirmed}
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
        sessionUnconfirmed={sessionUnconfirmed}
      />
    );
  return (
    <Reader
      slug={slug}
      article={article}
      capability={{
        kind: "visitor",
        artefacts,
        available,
        comments,
        searches,
        signedIn,
        sessionUnconfirmed,
      }}
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
 * The root font size, in px, because one number in the layout is a measure of
 * type rather than of screen.
 *
 * `PROSE_ALONE_MAX_REM` is the width of 65 characters plus two rem paddings, and
 * a reader whose browser default is 20px has all three of those 25% wider than
 * this file would otherwise assume. Everything else `fitView` works in is a real
 * screen width and stays px — layout.ts § `FitInput.rootFontPx`.
 *
 * **Not read once at module scope.** Text-only zoom and a settings change both
 * move it while the page is open, and the same `resize` that already re-measures
 * the window is the cheapest thing that notices — browsers fire one for text
 * zoom. Nothing notices a change made in another tab's settings until the next
 * resize or reload, which is a smaller failure than pinning it at import time,
 * when a stylesheet may not even have loaded.
 */
function useRootFontPx(): number {
  const measure = () => {
    const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    /* A browser that answers `""` or `0` gets the default rather than a table
       nought pixels wide — this is a multiplier, so a falsy answer is not a
       small error, it is the whole column. */
    return Number.isFinite(px) && px > 0 ? px : DEFAULT_ROOT_PX;
  };
  const [px, setPx] = useState(measure);
  useEffect(() => {
    const on = () => setPx(measure());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return px;
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
  /* And only the read-only chrome reads this: the notice under the masthead and
     the chip in the bar below it, neither of which is drawn for an owner.
     PublicChrome.tsx § SharedNotice for why it is two things and not one. */
  const sessionUnconfirmed = capability.kind === "visitor" && capability.sessionUnconfirmed;
  /**
   * **Whether this reader sees the modes that are still being built**, handed
   * down to the bar rather than fetched by it.
   *
   * The page owns the fetches and the bar is told — Dock.tsx's own header says
   * so, and `drawer`, `marked` and `signedIn` all already work that way. The
   * store behind this hook is shared and session-bound, so the reading view,
   * the metadata page and the tweets page cannot disagree for the length of a
   * toggle (experimental-store.ts).
   *
   * **This is what makes a signed-in reader ask `GET /api/reader` on a reading
   * view at all** — the store is lazy, and through stage 1 nothing on this page
   * subscribed. tests/public-network-trace.test.tsx pins that at one, and pins a
   * stranger's at zero.
   */
  const experimental = useExperimental();
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
  const rootFontPx = useRootFontPx();

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

  /* The tab: the article first, then the mode — and nothing for whichever mode
     is the default, which is the one most tabs are in and so the one that
     distinguishes nothing. `plain` since 2026-08-31; the rule is about the
     default rather than about any particular mode. See src/web/page-title.ts. */
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view: "article", mode }));
  /* **Any mode that is not the hierarchy has no gist columns, and forces the
     prose on.** Written as "not hierarchy" rather than as `chat || glossary` on
     purpose: the third mode cost this line nothing, which is the property the
     slot was built for, and the tenth cost it nothing either.

     It is not the same question as "is a panel open" — `bandOpen` below is, and
     Plain is where they differ. */
  const inMode = mode !== "hierarchy";
  /**
   * **Is there a panel in the middle band?** — which is a narrower question than
   * `inMode`, and since Plain arrived on 2026-08-31 they have different answers.
   *
   * Plain is a mode with no band and no gist columns: the spine, the article,
   * and nothing else. So it answers `inMode` the same way every other mode does
   * — *the granularity controls do not apply here, and the prose is on whatever
   * `?text=` says* — and answers this one the way `hierarchy` does.
   *
   * Two names rather than one `mode === …` test at each site, because the last
   * time this file had one rule doing two jobs the two drifted: `proseVisible`
   * exists in layout.ts precisely because "in a mode the prose is on" was
   * asserted in the arithmetic and not in the component, which rendered a chat
   * panel beside an entirely empty table. Naming both questions is what stops
   * the third caller having to guess which one it wanted.
   */
  const bandOpen = inMode && mode !== "plain";

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

  /**
   * **The columns `fitView` is asked for, which in Plain is none of them.**
   *
   * Plain is `?cols=none` with a name, and it is expressed here rather than in
   * layout.ts on purpose: `fitView`'s non-mode arm already handles an empty
   * `chosen` exactly right — no gist columns, no leaf column, and `detailW`
   * relaxing to the whole available width — so the mode costs that file nothing
   * and cannot introduce a fourth width negotiation for somebody to get wrong.
   *
   * **The reader's own `?cols=` is not overwritten, only overridden.** It stays
   * in the URL untouched, so leaving Plain for the hierarchy puts back the
   * columns they had rather than the ones the window would have picked — the
   * same property `?cols=` already has on a trip through chat (layout.ts
   * § fitView).
   */
  const plainCols = mode === "plain" ? EMPTY_DEPTHS : cols;

  const fit = useMemo(
    () =>
      fitView({
        windowWidth,
        gistDepths,
        leafDepth: geometry.leafDepth,
        showText: proseOn,
        chosen: plainCols,
        modeBand: bandOpen,
        rootFontPx,
        showSpine,
      }),
    [windowWidth, rootFontPx, gistDepths, geometry.leafDepth, proseOn, plainCols, bandOpen, showSpine],
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
   * **Tell the Feedback dialog where the reader is.** feedback-context.ts.
   *
   * Module state rather than props: the button is at the top level of the
   * window and every fact here is eight components down, so the alternative is
   * drilling six values up through the whole tree for one dialog. Ids only —
   * the slug, the tree's first block and the run of blocks around the reading
   * position — never a word of the article; the reasoning is
   * docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md
   * § Article identifiers, not article prose.
   *
   * The view is `"article"` by construction: `OwnedArticle` and its visitor
   * twin answer `metadata` and `tweets` with their own pages, so this component
   * is only ever mounted for the reading view.
   *
   * The cleanup clears it, so a report filed from the shelf a moment later does
   * not name an article the reader has already left.
   */
  useEffect(() => {
    const row = at === null ? -1 : article.blocks.findIndex((b) => b.id === at);
    const from = row < 0 ? 0 : row;
    setFeedbackArticleContext({
      slug,
      revisionId: null,
      view: "article",
      mode,
      level: fit.columns.length,
      blockCount: article.blocks.length,
      rootBlockId: article.tree.nodes[article.tree.rootId]?.range[0] ?? null,
      blockIds: article.blocks.slice(from, from + FEEDBACK_BLOCK_IDS).map((b) => b.id),
    });
    return () => setFeedbackArticleContext(null);
  }, [slug, article, mode, fit.columns.length, at]);

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
  /* **Either arm's comments, and the fallback is no longer `NO_COMMENTS`.**
     A visitor's come in the page's payload rather than from `useComments`, so
     this is the one line where the two sources meet — everything downstream
     (`ordered`, the gutter marks, the dialog's arrows) works on the result and
     does not know which it got. `NO_COMMENTS` is still what an owner gets
     before their fetch lands. src/web/reader-capability.ts.
     docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */
  const comments =
    capability.kind === "owner" ? capability.comments.comments : capability.comments;
  const commentError = owner?.comments.error ?? null;
  /* **A visitor's saved searches, and there is no owner arm to meet.** Unlike
     the comments above, the owner's searches are fetched inside `SearchBand`
     itself rather than held here — so this is not a seam between two sources,
     it is the one source there is, and `NO_SEARCHES` stands in where the
     question does not arise. A module constant rather than a fresh `[]`,
     because the band memoises on it by identity. reader-capability.ts § searches. */
  const searches = capability.kind === "visitor" ? capability.searches : NO_SEARCHES;
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
    !owner || mode === "chat" || mode === "remember"
      ? null
      : (chatDraft ??
        /* **Only a chat may be opened here, and that is not a tidy-up.**
           `?thread=` survives leaving the mode, so a pasted
           `?mode=toc&thread=<a Remember thread>` used to mount this dialog over
           a Remember conversation — chat's UI, chat's composer, no stance picker, and the
           next question answered with chat's prompt. Nothing on screen would
           have said so. Gating on the summary's `kind` is what `ThreadSummary.kind`
           exists for; a Remember thread with no matching summary simply opens
           nothing,
           which is the same thing a stale id already did. GPT Sol's review of
           docs/plans/260827ah-review-mode.md, finding 7. */
        /* **A positive test, not a negative one.** `?.kind !== "remember"`
           (spelled `review` at the time) was
           the first version and had its default backwards: an *unknown* thread
           — summaries not fetched yet, or a stale id — came out as a chat, so a
           Remember URL opened the floating chat dialog for a moment on every
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
   * the opening fetch: subscribing to the job engine puts it on its idle
   * cadence, and a reader who never opens the band should not pay for that.
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
  /**
   * And the threshold, for one reason only: **a term the bar is hiding cannot
   * be opened.**
   *
   * Since 2026-09-03 the prioritised glossary hides what is below the gate
   * rather than grouping it, so pressing "in the glossary" on a low-scoring
   * term would take the reader to a band with no such row in it — the panel
   * asked to select something it is not drawing. `gateToReveal` answers the
   * gate that puts it back, and null when the current one already shows it.
   *
   * **Lowered, not cleared**, and not swapped for `document` order: the reader
   * stays in the order they chose, and the slider visibly moves, so nothing
   * happens behind their back. Written through the same nuqs setter the band
   * reads, exactly as `?term=` above is — two setters on one parameter is fine.
   */
  const [gate, setGate] = useQueryState("gate", gateParam);
  /**
   * And the order, read here for one reason: **a gate nothing is hiding with
   * must not be lowered.**
   *
   * `?sort=document&gate=0.80` is a perfectly ordinary URL — the gate is
   * dormant, no slider is on screen, and no term is hidden. Lowering it there
   * would set a threshold the reader never chose and never saw, waiting for
   * them the next time they picked the prioritised order. So the decision is
   * `gateToReveal`'s, and it takes the sort. GPT Sol's third finding on the
   * built code, 2026-09-03.
   */
  const [sort] = useQueryState("sort", sortParam);
  const openTermInGlossary = useCallback(
    (id: string) => {
      void setTermId(id);
      const lowered = gateToReveal(terms, id, sort, gate ?? PRIORITY_GATE);
      if (lowered !== null) void setGate(lowered);
      void setMode("glossary");
    },
    [setTermId, setMode, setGate, gate, sort, terms],
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
  /* **A fifth state, for the reason the second, third and fourth have their
     own**: two modes sharing one `Found[]` clear each other on the way out, and
     which one wins is an accident of whether the outgoing mode's cleanup is
     passive and the incoming mode's push is layout.

     **And an `openKey` of its own since 2026-09-02**, which it did not have and
     should have: pressing a criterion result jumped to the *block*, and the
     phrase the row was about was never distinguished, while Search's identical
     rows have always got the `mark.hit[data-hit-open]` ring. That is the
     panel→prose direction a referee actually travels, and it matters more now
     the stripe carries a direction rather than an identity — the ring is what
     says *this red phrase is the row you pressed*. GPT Sol's finding 2;
     docs/plans/260902f-make-referee-mode-understandable.md. */
  const [refereeFound, setRefereeFound] = useState<Found[]>([]);
  const [openRefereeKey, setOpenRefereeKey] = useState<string | null>(null);

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
          : mode === "referee"
            ? refereeFound
            : found;
  const openPassage =
    mode === "ideas"
      ? openOccurrence
      : mode === "quotes"
        ? null
        : mode === "timeline"
          ? openTimelineKey
          : mode === "referee"
            ? openRefereeKey
            : openHit;
  /* **One ramp for the whole of Referee mode**, read here because this is where
     the marks are built. `?refscale=` and not `referee_criteria.scale`: the two
     ramps put red at opposite ends of the truth, so a per-criterion choice
     would have meant one red underline meaning opposite verdicts in one
     document. `refScaleParam` in params.ts has the whole argument.

     Read unconditionally rather than inside the referee branch — a hook cannot
     be conditional — and it costs nothing in every other mode, where no passage
     carries a valence and the scale is never consulted. */
  const [refScale] = useQueryState("refscale", refScaleParam);
  const hitMarks = useMemo(
    () => buildHitMarks(passages, openPassage, refScale),
    [passages, openPassage, refScale],
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

  /* ------------------------------------------- TableView's four callbacks --
     Lifted out of the JSX, and the only reason is identity.

     `TableView` is wrapped in `memo`, so a render of `Reader` that changes none
     of its 29 props must not produce new ones — and an arrow written inline in
     the JSX is a new function on every render, which alone would defeat the
     whole thing. The other 24 props were already stable (memos, `useState`
     setters, primitives); these four were not.

     That matters here more than it usually would, because `useReadingPosition`
     writes `?at=` as the reader scrolls, which re-renders `Reader` 77-79 times
     during one scroll of a long article. Each of those used to reconcile 551
     rows. See docs/plans/260904a-more-scroll-cpu-wins.md.

     Everything each of them closes over is itself stable: `useState` setters,
     nuqs setters (`useQueryState` returns a `useCallback` whose own dependencies
     are memoised — nuqs 2.10.0, dist/index.js:724), `blockText` (a memo) and
     `owner`, which is a prop of `Reader`. */

  const openChatThread = useCallback(
    (id: BlockId) => {
      setChatDraft(null);
      void setNote(null);
      void setThread(id);
    },
    [setNote, setThread],
  );

  /* A conversation anchored to the whole block — the other half of what an
     anchor can be, and the one that draws no mark in the prose. The paragraph's
     opening words go into the composer so the reader can see which one they
     pressed; a six-character id is not something you can check you clicked
     correctly.

     **Handed over only to an owner, and that is the whole gate.** It used to go
     to everybody with an `if (!owner) return;` inside it, so a visitor got a
     chat button on every paragraph whose press did nothing. The absent callback
     is what makes the button absent (BlockGutter.tsx), and the sentence about
     what chat costs is still one press away in the Chat band. The place a
     visitor meets the boundary is `onSelect` below, which they reach by accident
     and which stays silent for that reason.

     The `owner ?` ternary stays at the call site rather than moving in here, so
     that the prop is `undefined` — not a function that does nothing — and the
     button is genuinely absent. It is identity-stable either way, because
     `owner` is. */
  const chatAboutBlock = useCallback(
    (blockId: BlockId) => {
      void setNote(null);
      void setThread(null);
      setChatDraft({
        kind: "draft",
        anchor: { blockId },
        opening: blockText.get(blockId) ?? "",
      });
    },
    [blockText, setNote, setThread],
  );

  /**
   * **One press, one model call, and the reader keeps reading.**
   *
   * The "?" beside a paragraph. Everything about it is the same conversation
   * the chat button starts — same anchor, same thread, no fourth `ThreadKind`
   * (the plan says why at length) — except that nobody stops to type: the
   * question is `HELP_QUESTION` and `ChatDialog` sends it on mount.
   *
   * ## Pressing it twice must not cost twice, and there are two ways it can
   *
   * **A conversation that already exists is opened, not repeated.** Pressing
   * "?" on a paragraph you asked about ten minutes ago should show you the
   * answer you already bought. Only whole-block anchors count: a conversation
   * about a phrase you *selected* is about that phrase, and reopening it for
   * somebody asking about the paragraph would answer a question they did not
   * ask. The newest wins, on the same reasoning — it is the one whose context
   * is closest to where they are now.
   *
   * **And two taps are one press without a latch here, because the send does
   * not happen here.** This function only sets a draft; `ChatDialog` mounts on
   * it and its effect is what spends. So two taps that both land before that
   * mount collapse into one draft and one send, and two taps that straddle it
   * are caught by the dialog's own ref — the structure does the work, not a
   * guard.
   *
   * There *was* a `helpArming` ref here, added against the iPad double-tap on
   * the reasoning that two taps in one tick both read the same `chats` array.
   * It came out on 2026-09-05, when GPT Sol pointed out it was untested, and
   * testing it showed why: with the real App mounted and the "?" clicked twice
   * inside one `act`, the POST count stays at one with the ref deleted, and
   * with the reopen above deleted, and with the dialog's latch deleted — any
   * two of the three cover it. A guard whose absence cannot be observed is a
   * guard nobody can maintain, so the honest version is the two that a test can
   * redden. `tests/public-network-trace.test.tsx` § spends once when the "?" is
   * double-tapped.
   *
   * ## What this deliberately does not do
   *
   * **A press before the summaries have arrived mints a new conversation even
   * if one exists.** `chatSummaries` is a separate fetch from the article, and
   * `chatAnchors.loaded` exists precisely because *"no conversation with this
   * id" and "the list has not arrived" are the same state without it* — so
   * during that window `helpThreadFor` cannot tell them apart either.
   *
   * Left alone on purpose, and it is smaller than it was: the arriving list no
   * longer *deletes* what the reader did while it was in the air
   * (`foldInLocalWrites` in useChatAnchors.ts), which was the version of this
   * that actually cost money. What remains is that a press in the first few
   * hundred milliseconds cannot see a conversation stored on a previous visit.
   * Refusing the press would give a dead button on a page that looks ready;
   * queueing it adds state whose only job is a race nobody has hit. The cost
   * when it happens is a second conversation about a paragraph — which is what
   * pressing "?" and forgetting you had asked already does anyway.
   */
  const helpAboutBlock = useCallback(
    (blockId: BlockId) => {
      const existing = helpThreadFor(chatSummaries, blockId);
      if (existing) {
        setChatDraft(null);
        void setNote(null);
        void setThread(existing.id);
        return;
      }
      void setNote(null);
      void setThread(null);
      setChatDraft({
        kind: "draft",
        anchor: { blockId },
        opening: blockText.get(blockId) ?? "",
        help: true,
      });
    },
    [blockText, chatSummaries, setNote, setThread],
  );

  const selectProse = useCallback(
    (anchor: { blockId: BlockId; quote: string; start: number } | null) => {
      if (!anchor) return;
      /* **The one control a visitor meets by accident**, since selecting prose
         is something people do while reading rather than a button they chose to
         press. So it is silent: they keep their selection and the page does not
         grow a box about an account. The ask lives where they went looking for
         something — the marked modes and the notice under the title. */
      if (!owner) return;
      /* **Nothing is bought here.** Until 2026-08-26 this line spent a model
         call the reader had not asked for; then it opened an ask box; since
         2026-08-28 it opens a *comment* box, where saving is free and the model
         is a tick-box. Greg's call — see
         docs/plans/260828a-comments-and-bookmarks.md. */
      void setNote(null);
      void setThread(null);
      setChatDraft(null);
      setAnnotating({ blockId: anchor.blockId, quote: anchor.quote, start: anchor.start });
      /* **The browser's selection is deliberately left alone**, which is a
         reversal. It used to be cleared because it sat on top of the mark we had
         just drawn and hid it. There is now no mark to reveal — nothing is
         stored until the reader asks — so clearing it would leave them looking
         at a quote in a box with no idea which words on the page it came from. */
    },
    [owner, setNote, setThread],
  );

  const openCommentDialog = useCallback((id: BlockId) => void setNote(id), [setNote]);

  /**
   * The whole address, subscribed to — the input to the block permalinks.
   *
   * The only subscription in this file that is not a `useQueryState`, and it is
   * here because those are key-isolated and this needs *all* of them. Pathname
   * as well as query, because `blockHref` uses both. See the `linkBase` prop on
   * `TableView` below.
   */
  const address = useAddress();

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
      /* `text-alone` says the article is the only thing on the page, so the
         stylesheet can centre the reading column and put the masthead over it
         rather than leaving both against the left edge of a window neither
         fills. It is `fit.alone` and nothing computed here on purpose — the
         same fact under two definitions is how `proseVisible` came to exist.
         layout.ts § `Fit.alone`, styles.css § plain, centred. */
      /* `band-covers` is the same idea and exists for a sharper reason: it is
         the *stylesheet's* only way to know that the mode band has no room
         beside the prose and is lying over it instead. That crossover is
         `MODE_MIN + PROSE_MIN` against the window **minus the rail**, so it
         moves with `?spine=0` — and a media query cannot see a query
         parameter. It was one for six days (`@media (max-width: 843px)`), and
         from 832 to 843 with the rail off the two disagreed: layout.ts
         squeezed the table to make room for a band the stylesheet had already
         thrown over the article.

         So the fact is written here, from the one number that computes it,
         beside the `--mode-w` it is derived from. `fit.modeW === 0` is also
         true when no band is open at all, which is why every rule keyed off
         this class also names `.mode-band` — styles.css § a band with no room,
         tests/spine-width.test.ts. */
      className={`reader spine-${fit.spine}${fit.alone ? " text-alone" : ""}${
        fit.modeW === 0 ? " band-covers" : ""
      }`}
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
          /* The table's own width, so the masthead can be as wide as the
             reading column when it is centred over it (styles.css § plain,
             centred) without a second copy of `PROSE_ALONE_MAX_REM` in CSS. */
          "--table-w": `${fit.tableW}px`,
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
      {!owner && <SharedNotice signedIn={signedIn} sessionUnconfirmed={sessionUnconfirmed} />}
      <div className="controls">
        {/* First of all, before even the spine: what footing you are reading
            on outranks every control that follows, and this bar is the one
            piece of chrome that is on screen at every scroll position. */}
        {!owner && <ViewOnlyChip sessionUnconfirmed={sessionUnconfirmed} />}
        {/* Leftmost of the *view* controls, because the rail it names is
            leftmost — and before the mode/contents split, because it is the one
            control that survives both. See `spineToggle` above. */}
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
            {/* **The label, not the mode id.** `.mode { text-transform:
                uppercase }` means these look identical for all thirteen today —
                which is exactly the problem: the id is a URL token and the label
                is a product noun, and the two are one rename apart. Renaming
                Referee to Reviewer in `MODE_LABEL` and the Dock would have left
                this bar saying REFEREE, in the one place on screen that names
                the open mode. src/title-text.ts § MODE_LABEL is the one word. */}
            <span className="mode on">{MODE_LABEL[mode]}</span>
            {/* **The way out, and it is an icon now.** It said `back to contents`
                until 2026-08-31 — a 12px grey text link in a bar of pills, and
                measured against the rest of the bar it was the quietest thing in
                it. Greg asked for an icon and for the word `contents` to go, the
                mode having been called Hierarchy since 2026-08-29.

                **It names no destination on screen**, which is the other half
                of the change. `back to Hierarchy` was the obvious rename and it
                commits the bar to a claim that stops being true the moment the
                default moves — which it did, the same day. `×` says *close
                this*.

                **It goes to `plain` by name, not to `DEFAULT_MODE`**, and the
                two happen to be the same mode today. GPT Sol asked for the
                literal, 2026-08-31, and the reason is that they are different
                contracts: *where the reader lands with no instructions* and
                *what closing a panel means* have no reason to agree, and if the
                default moves again this button would silently start opening
                whatever it moved to. Closing a band means the article, and
                `plain` is the mode that is the article.

                **Rejected: remembering which band-less mode the reader came
                from.** One `useRef` and the same button starts doing two
                different things depending on history the reader cannot see —
                and a ref resets on remount, so it would be *mostly* consistent,
                which is worse than either answer taken plainly.

                Not rendered in Plain, where `bandOpen` is false: there is
                nothing to close, and it would land where it already is.
                docs/plans/plain-mode-and-the-way-out.md § 3. */}
            {bandOpen && (
              <button
                type="button"
                className="mode-close"
                onClick={() => void setMode("plain")}
                title={`Close ${MODE_LABEL[mode]} and go back to the article`}
                aria-label={`Close ${MODE_LABEL[mode]}`}
              >
                <X size={14} aria-hidden />
              </button>
            )}
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
        /* The permalink base — this page's whole address, including every
           parameter added after this line was written, minus the one the link
           is about to set.

           **`useAddress` rather than a bare read of `location`**, and the
           difference is the whole correctness of this: reading the global here
           would be right only if `Reader` re-rendered on every URL change, and
           it does not. nuqs subscriptions are key-isolated, so ten reading
           parameters owned by child components — `deep`, `diagram`, `dhue`,
           `referee`, `remember` and five more — change the address without
           waking this component at all. Until `TableView` was memoised, `?at=`
           re-rendered it once a second and hid that; it does not any more.
           router.ts § `watchHistoryWrites`. Found by GPT Sol, 2026-09-04.

           No `useMemo`: it is a string, and strings compare by value. A render
           caused only by `?at=` produces an equal one, so `memo(TableView)`
           holds; any other parameter produces a different one and it correctly
           does not. TableView.tsx § `Props.linkBase`. */
        linkBase={addressWithout(address, "at")}
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
        onOpenChat={openChatThread}
        /* The gate, and only the gate — the body is `chatAboutBlock` above,
           which explains why it is `undefined` rather than a no-op here. */
        onChatAbout={owner ? chatAboutBlock : undefined}
        /* **One press, and it spends.** `helpAboutBlock` above either reopens
           the conversation this block already has or mints a draft carrying
           `help: true`, and `ChatDialog` sends that on mount — no composer, no
           confirmation. The button's own copy names the AI for exactly this
           reason (BlockGutter.tsx), and the accidental tap is a cost Greg
           accepted on 2026-09-04 because one press was the point.

           **This comment said the opposite until 2026-09-05**, describing the
           stage-2 behaviour — "opens the same pre-filled draft and spends
           nothing" — for a day after stage 3 landed and made it send. A comment
           saying a button is free when it is not is the one direction this
           particular mistake must never run. Found by GPT Sol.

           The seam is a `ChatTarget` variant rather than a handler hoisted up
           here, because a token arriving in this component re-renders the whole
           article. Gated on `owner` for the reason above; the two doors are one
           capability. */
        onHelp={owner ? helpAboutBlock : undefined}
        terms={termSelections}
        openTerm={term?.id ?? null}
        hitMarks={hitMarks}
        hitHues={hitHues}
        hitStrength={hitStrength}
        onSelect={selectProse}
        onOpenComment={openCommentDialog}
      />
      {owner && annotating && (
        <AnnotateDialog
          anchor={annotating}
          /* **Referee mode only**, and all four of its sub-modes: the criteria
             are fetched inside the section rather than lifted out of the
             Criteria panel, which only mounts on one of them. */
          placing={mode === "referee"}
          onCancel={() => setAnnotating(null)}
          onSave={(id, body, ask, mark) => {
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
              /* The referee's placement rides along with the free save, so a
                 placement is never a second request that can fail on its own. */
              mark,
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
      {/* **Mounted for a visitor too, since 2026-09-04**, with an `access` of
          `{ kind: "visitor" }` — which carries none of the eight verbs below,
          so there is nothing on that arm for a later edit to reach.
          docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */}
      {!owner && !overlay && openComment && (
        <CommentDialog
          comment={openComment}
          access={{ kind: "visitor" }}
          position={positionOf(ordered, note)}
          total={ordered.length}
          hasPrev={stepComment(ordered, note, -1) !== null}
          hasNext={stepComment(ordered, note, 1) !== null}
          onPrev={() => goToComment(stepComment(ordered, note, -1))}
          onNext={() => goToComment(stepComment(ordered, note, 1))}
          onClose={() => void setNote(null)}
        />
      )}
      {owner && !overlay && openComment && (
        <CommentDialog
          comment={openComment}
          position={positionOf(ordered, note)}
          total={ordered.length}
          hasPrev={stepComment(ordered, note, -1) !== null}
          hasNext={stepComment(ordered, note, 1) !== null}
          onPrev={() => goToComment(stepComment(ordered, note, -1))}
          onNext={() => goToComment(stepComment(ordered, note, 1))}
          onClose={() => void setNote(null)}
          access={{
            kind: "owner",
            pending: othersPending,
            onRetry: () => owner.comments.retry(openComment.id),
            onDeepen: () => owner.comments.deepen(openComment.id),
            onEdit: (body) => void owner.comments.edit(openComment.id, body),
            placing: mode === "referee",
            onPlace: (mark) => void owner.comments.place(openComment.id, mark),
            error: owner.comments.error,
          /* **Offered only when the conversation is really there.** The link on
             a comment is advisory — a reader can delete the chat and keep the
             note — so the summary list, not the stored id, decides whether
             there is anywhere to go. Passing a button that leads to
             "that conversation no longer exists" would be worse than passing
             none. */
            onOpenThread:
              openComment.threadId && chatSummaries.some((c) => c.id === openComment.threadId)
                ? () => {
                    const id = openComment.threadId;
                    if (!id) return;
                    setChatDraft(null);
                    void setNote(null);
                    void setThread(id);
                  }
                : undefined,
            onDiscuss: (question) => {
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
            },
            onDelete: () => {
              // Step to the neighbour rather than closing outright: deleting one
              // of five is a tidy-up, not a reason to lose the panel.
              const next = stepComment(ordered, note, 1) ?? stepComment(ordered, note, -1);
              owner.comments.remove(openComment.id);
              void setNote(next);
            },
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
          width, and the band says which boundary this is — `VisitorGap` in
          visitor.ts is the set of them.
          PublicChrome.tsx, visitor.ts.

          Placed above the real bands rather than woven into each of their
          conditions, so that a mode added later cannot arrive without one:
          `visitorGap` reads a `Record<Mode, VisitorPolicy>`, so a mode with no
          row is a compile error rather than a mode that quietly opens. */}
      {/* **Only when there is a gap**, and since slice 1b there usually is not:
          a visitor whose article has a glossary opens the glossary, and
          `visitorGap` answers `null`. What is left here is a mode the pipeline
          never ran for this piece, and the ones that cost a model call —
          `POLICY` in visitor.ts says which, so no count lives here. */}
      {!owner && gap && <VisitorBand gap={gap} signedIn={signedIn} />}
      {owner && mode === "chat" && (
        <ConversationBand
          key={mode}
          slug={slug}
          blocks={blockText}
          onJump={jumpTo}
          kind="chat"
          onMode={setMode}
        />
      )}
      {/* **Remember is two bands behind one mode**, and the choice between them
          is `?remember=`. The wrapper exists so that the parameter and its
          collision with `?thread=` are decided in one place rather than in each
          half — see `RememberBand`. */}
      {owner && mode === "remember" && (
        <RememberBand slug={slug} blocks={blockText} onJump={jumpTo} onMode={setMode} />
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
          onMode={setMode}
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
      {/* **Mounted for a visitor too, since 2026-09-04** — one branch rather
          than the owner/visitor pair the artefact modes have, because there is
          no artefact to carry and no second component to build: the default
          picture is drawn from the tree the page already holds. What differs is
          the `access` prop, which pins the picture to Force and turns off all
          three of the panel's fetching hooks.
          docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 2. */}
      {mode === "diagram" && (
        <DiagramBand
          /* The visitor arm carries the drawing itself, out of the payload —
             `artefacts.sketch` is absent when nobody has drawn one, which is the
             ordinary case and is a sentence rather than a missing picture.
             docs/plans/260904c-more-modes-on-a-shared-link.md § Sketch. */
          access={owner ? { kind: "owner" } : { kind: "visitor", sketch: artefacts?.sketch }}
          /* Which of the five picture chips the row draws — the same answer the
             bar below is given, from the same hook, so the two cannot disagree
             about what this reader is being shown.
             DiagramPanel.tsx § `visibleKinds`. */
          experimental={experimental.on}
          slug={slug}
          article={article}
          at={at}
          onJump={jumpTo}
        />
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
      {/* **The owner/visitor pair the ideas and the quotes have, since
          2026-09-04.** It was one branch until then, and the comment here said
          there was deliberately no `VisitorTimelineBand` waiting for a payload
          field that did not exist. The field exists now.
          docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 1.

          Gated on the artefact itself rather than on `available`, like the
          glossary above: an absent key means `visitorGap` said `not-built` and
          the `VisitorBand` is showing instead, so the branch that renders and
          the flag that decides the sentence cannot disagree. */}
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
      {!owner && mode === "timeline" && artefacts?.timeline && (
        <VisitorTimelineBand
          timeline={artefacts.timeline}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setTimelineFound}
          openKey={openTimelineKey}
          onOpenKey={setOpenTimelineKey}
        />
      )}
      {/* **The owner/visitor pair, since 2026-09-04.** It was `owner &&` alone
          until then, because search is the one mode where the reader's own
          question is the artefact. Greg drew the line at *making* one: a
          visitor gets the list, the ticks and the marks, and no way to ask.
          docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 4.

          Not gated on there being any, unlike the artefact modes above: an
          article nobody has searched is an article nobody has searched, which
          is a sentence the panel draws rather than a missing artefact
          `visitorGap` should be standing in front of.
          src/public-types.ts § PublicArticle.searches. */}
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
      {!owner && mode === "search" && (
        <VisitorSearchBand
          searches={searches}
          blocks={article.blocks}
          onJump={jumpTo}
          onFound={setFound}
          openHit={openHit}
          onOpenHit={setOpenHit}
        />
      )}
      {/* **`owner &&`, like every other mode that spends money**, and it is
          the gate rather than a decoration: Criteria, Claims and Mirror all
          call a model, so a band a visitor could open would be
          spend on somebody else's paper with nobody's press behind it. `visitorGap`
          fails closed and already answers `owners-only` for this mode, so a
          visitor pressing the button gets the boundary sentence and not a blank
          band. src/web/visitor.ts. */}
      {owner && mode === "referee" && (
        <RefereeBand
          slug={slug}
          blocks={article.blocks}
          /* **The byline, for Candidates and for nothing else** — the one call
             in Referee mode that legitimately sees who wrote the paper, and only
             so that they can be left out of its own suggestions.
             docs/project/referee-mode.md, rule 4. */
          byline={article.meta.byline}
          /* **The referee's own placements, for Criteria and for nothing
             else** — the ones carrying a `criterionId`. Passed rather than
             fetched again so the panel and the gutter cannot disagree about a
             judgement; `useComments` is already mounted for the page.
             docs/project/referee-mode.md § the referee's own mark. */
          comments={comments}
          onJump={jumpTo}
          onFound={setRefereeFound}
          /* Which marked passage the referee last pressed, so the prose rings
             the exact phrase rather than washing the whole block. Search's
             `openHit` exactly, and threaded rather than held in the band for the
             same reason that one is: `TableView` draws the ring and it lives up
             here. */
          openKey={openRefereeKey}
          onOpenKey={setOpenRefereeKey}
        />
      )}

      {/* Last in the DOM as well as topmost in z-index: the bar and its drawer
          are drawn over everything, and matching source order to paint order is
          one less thing to reason about when something appears underneath
          something else. */}
      <Dock
        slug={slug}
        view="article"
        /* Which modes the bar draws at all — Dock.tsx § experimental, and the
           hook call at the top of this component. */
        experimental={experimental}
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
            : /* **The same drawer, with the owner's comments in it**, since
                 2026-09-04. It used to open onto a sentence about whose
                 comments these would be; a shared link carries them now.
                 docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.

                 `onOpenComment` is the same closure as the owner's, and that is
                 the point rather than a shortcut: opening a comment closes the
                 drawer and brings its passage into view, which is reading, and
                 reading is the whole of what a visitor may do here. */
              {
                visitor: true,
                comments: ordered,
                panel,
                onPanel: (next) => void setPanel(next),
                onOpenComment: (id) => {
                  void setPanel(null);
                  goToComment(id);
                },
              }
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
 *
 * **Exported for tests/passage-mode-cleanup.test.tsx**, which mounts this band,
 * `TimelineBand` and `CriteriaBand` side by side to pin the one contract all
 * three share — see the note on `TimelineBand`'s five effects. `RememberBand`
 * and `ConversationBand` are exported for the same reason.
 */
export function IdeasBand({
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
 * `owners-only` in src/web/visitor.ts § POLICY, so a visitor meets a boundary instead of a
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
 * **a fix to one of these belongs in all three** — `CriteriaPanel`'s cleanup
 * became a third partial copy on 2026-08-31 and was half of this one until
 * 2026-09-02 — which is written here rather than left to be discovered.
 *
 * The one real difference is that there are no colour slots. Timeline paints no
 * lane down the rail — deferred with the marks — so `resolveTimelineEvent`
 * hands every occurrence slot 0 and the prose gets the ordinary wash.
 *
 * **Exported for tests/passage-mode-cleanup.test.tsx**, which is the executable
 * form of the "a fix to one of these belongs in all three" sentence above.
 */
export function TimelineBand({
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
  const band = useTimelineMode({
    events: timeline.timeline?.events ?? NO_EVENTS,
    blocks,
    onJump,
    onFound,
    openKey,
    onOpenKey,
  });
  return <TimelinePanel access={{ kind: "owner", owner: timeline }} {...band} />;
}

/**
 * A module constant rather than a fresh `[]`, for the reason `NO_QUOTES` and
 * `NO_TERMS` are: the memo below keys on it by identity, and a new empty array
 * each render would re-resolve every occurrence while the read is still in
 * flight.
 */
const NO_EVENTS: TimelineEvent[] = [];

/**
 * The same module constant for the same reason, and it is never rendered: only
 * `VisitorSearchBand` reads `searches`, and it is mounted only for a visitor.
 * It exists so that the line resolving the capability has an honest value for
 * *the question does not arise* rather than an `as` or a `null` every reader
 * downstream would have to test.
 */
const NO_SEARCHES: SavedSearch[] = [];

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useTimeline` and therefore no job, no `ensure`, no `regenerate`: the
 * events came in the page's own payload. See `VisitorGlossaryBand` for why this
 * is a second band rather than a second panel — a hook cannot be called
 * conditionally, so the owner/visitor seam has to be a component boundary.
 * src/web/reader-capability.ts.
 */
function VisitorTimelineBand({
  timeline,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  timeline: PublicTimeline;
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("VisitorTimelineBand");
  const band = useTimelineMode({
    events: timeline.events,
    blocks,
    onJump,
    onFound,
    openKey,
    onOpenKey,
  });
  return <TimelinePanel access={{ kind: "visitor", timeline }} {...band} />;
}

/**
 * **Everything the timeline band does that is not a fetch** — `?event=`, the
 * resolved occurrences it pushes up, and the four passage-mode rules the
 * comment above lists.
 *
 * Extracted on 2026-09-04 so that the owner's band and the visitor's are one
 * behaviour rather than two, which is the same split `useQuotesMode` and
 * `useIdeasMode` already have. The comment above still applies to it: a fix to
 * one of the three passage modes belongs in all three.
 */
function useTimelineMode({
  events,
  blocks,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  events: TimelineEvent[];
  blocks: Block[];
  onJump(id: BlockId): void;
  onFound(found: Found[]): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  const [eventId, setEventId] = useQueryState("event", eventParam);

  const selected = useMemo(
    () => events.find((e) => e.id === eventId) ?? null,
    [events, eventId],
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

  return {
    eventId,
    onEvent(next: string | null) {
      void setEventId(next);
      /* A new event means the old occurrence is meaningless — its key names
         an event nobody is looking at, so the stepper would read "0 / 2". */
      onOpenKey(null);
      /* Only on selecting, never on clearing: pressing the open event again
         takes the marks away, and throwing the reader down the article as it
         does would be the opposite of what that gesture means. */
      wantsJump.current = next !== null;
    },
    found,
    openKey,
    onOpenKey,
    onJump,
  };
}

/**
 * **Remember's two sub-modes, and the one place their URL rules live.**
 *
 * Remember is `recall` — the reader says what they took from the article and the
 * model shows them where that comes apart — or `quiz`, where the questions come
 * from the article instead. One mode, two bands, and `?remember=` says which.
 * docs/plans/260831al-review-quiz-sub-mode.md.
 *
 * ## Why this is a component rather than two conditions up in `Reader`
 *
 * Two reasons, and the second is the one that matters.
 *
 * The cheap one: `?remember=` is meaningless outside Remember mode, and reading it
 * in `Reader` would put a parameter subscription on every render of the reading
 * view for a value only this subtree uses — the same argument `ConversationBand`
 * makes about `?thread=`.
 *
 * The real one: **`?remember=` and `?thread=` collide, and the rules are
 * navigations rather than parsing.** `?mode=remember&remember=quiz&thread=<id>`
 * would otherwise leave a Remember conversation selected and invisible. Both
 * parameters are set through one `useQueryStates`, so switching sub-mode is one
 * history entry rather than two — two would put a half-state on the Back stack,
 * which is the bug remember-mode.md already records for opening a thread of the
 * other kind.
 *
 * Three rules, and all three are here:
 *
 * 1. **switching to Quiz sets `remember=quiz` and clears `thread`, in one
 *    navigation** — pushed, because switching sub-mode is a deliberate act on
 *    the view and Back should undo it;
 * 2. **a pasted URL carrying both: Quiz wins**, and `thread` is dropped with a
 *    *replace* — a push would put the broken combination one Back press away
 *    from the reader we have just rescued from it;
 * 3. **opening a Remember conversation sets `remember=recall` and `thread=<id>`,
 *    also in one** — that one is in `ConversationBand`'s `onThread`, because it
 *    is the same navigation that already moves `?mode=`, and splitting it would
 *    be the two-entry bug again.
 *
 * ## And the live conversation is hung up before the panel goes
 *
 * Switching to Quiz **unmounts** `ConversationBand`, which is what ends any
 * live session: `useLiveConversation`'s unmount cleanup is the only thing that
 * closes the peer connection, and a session left running is listening to the
 * reader and writing into a transcript they are no longer looking at. That is
 * why the two halves are rendered as alternatives rather than one being hidden
 * with CSS — a hidden band is a mounted band.
 */
export function RememberBand({
  slug,
  blocks,
  onJump,
  onMode,
}: {
  slug: string;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  onMode(next: Mode): void;
}) {
  const [{ remember, thread }, setBoth] = useQueryStates({
    remember: rememberParam,
    thread: threadParam,
  });

  /* Rule 2. A *replace*, and an effect rather than a render-time fix-up,
     because writing to the URL during render is what React refuses. It settles
     on the first commit and then never fires again, since `thread` is null. */
  useEffect(() => {
    if (remember === "quiz" && thread !== null) {
      void setBoth({ thread: null }, { history: "replace" });
    }
  }, [remember, thread, setBoth]);

  const toggle = (
    <RememberSubModeToggle
      value={remember}
      onChange={(next) =>
        /* Rule 1. Both keys in one call, so this is one history entry — and
           `thread: null` on the way to Quiz rather than only on arrival, so
           there is no frame in which the URL says both. Going the other way
           leaves `thread` alone: the reader is going back to a list, and the
           conversation they last had open is the right thing to find. */
        void setBoth(
          next === "quiz" ? { remember: next, thread: null } : { remember: next },
          { history: "push" },
        )
      }
    />
  );

  if (remember === "quiz")
    return <QuizSubBand slug={slug} subMode={toggle} blocks={blocks} onJump={onJump} />;
  return (
    <ConversationBand
      /* Keyed so that leaving Quiz and coming back starts clean rather than
         carrying the previous visit's focus nonce and stance — the same reason
         `Reader` keys this component on `mode`. */
      key="remember-recall"
      slug={slug}
      blocks={blocks}
      onJump={onJump}
      /* The **persisted thread kind** — src/types.ts § ThreadKind. */
      kind="remember"
      onMode={onMode}
      subMode={toggle}
    />
  );
}

/**
 * The quiz, and the fetch and the poller that belong to it.
 *
 * A component of its own for `GlossaryBand`'s surviving reason rather than
 * `ConversationBand`'s: **`useStepJob` subscribes to the job engine**, which
 * holds it on its idle cadence — one small request every eight seconds for the
 * life of the band. A reader who never opens Quiz should not pay for that, and
 * hooks cannot be called conditionally, so the condition has to be a component
 * boundary.
 */
function QuizSubBand({
  slug,
  subMode,
  blocks,
  onJump,
}: {
  slug: string;
  subMode: React.ReactNode;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
}) {
  const owner = useQuiz(slug);
  return <QuizPanel owner={owner} subMode={subMode} blocks={blocks} onJump={onJump} />;
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
/**
 * **The two kinds this band is for**, which is not every `ThreadKind`.
 *
 * `candidates` is a thread of Referee mode's making and belongs to
 * `CandidatesPanel`; it has no mode of its own to be followed into from here.
 * Written as an `Exclude` rather than as `"chat" | "remember"` so that a fifth
 * kind arrives here as a compile error and somebody has to decide which side of
 * the line it is on.
 */
type ConversationKind = Exclude<ThreadKind, "candidates">;

/** Is this a thread the reader's own conversation panel may show and open? */
function isConversationThread(t: ChatThread): t is ChatThread & { kind: ConversationKind } {
  return t.kind !== "candidates";
}

export function ConversationBand({
  slug,
  blocks,
  onJump,
  kind,
  subMode,
  onMode,
}: {
  slug: string;
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  /**
   * Which mode mounted this — chat, or Remember.
   *
   * **One component for both, and not two.** Everything in here is the same for
   * either: one `useChat(slug)`, one `?thread=`, one focus nonce, one
   * once-per-visit latch. A near-copy would have been a second chat state
   * machine beside the first, which is what GPT Sol's review of
   * docs/plans/260827ah-review-mode.md (finding 7) said not to build — and the
   * unmount/remount path around this one already has a race worth not having
   * twice.
   *
   * **Not `ThreadKind`.** The union grew a third member on 2026-09-01 and this
   * band is for two of them — see `ConversationKind` above.
   */
  kind: ConversationKind;
  /**
   * **The Recall | Quiz control**, when this band is the Recall half of
   * Remember. Absent in chat mode. Built by `RememberBand` above and passed straight
   * through to `ChatPanel`, which is where it is drawn.
   */
  subMode?: React.ReactNode;
  /**
   * Switch mode, for when the reader opens a thread of the *other* kind.
   *
   * The list is shared (Greg's call, 2026-08-27), so a Remember thread is
   * reachable from
   * chat mode and vice versa. Opening one has to move `?mode=` as well as
   * `?thread=` or the conversation would be answered with the wrong prompt.
   */
  onMode(next: Mode): void;
}) {
  useRenderCount("ConversationBand");
  const {
    threads: everyThread,
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
  /**
   * **The reader's conversations — which is not every thread in the article.**
   *
   * The list is shared between chat and Remember on purpose (Greg's call,
   * 2026-08-27), so a Remember row is pressable from chat mode and the band
   * follows it into its own mode. Candidates is **not** in that arrangement and
   * must not be: it is Referee mode's machinery rather than a reader's
   * conversation, it lives at `?mode=referee&referee=candidates` where this band
   * cannot navigate, and a Candidates row opened here would be answered with
   * chat's prompt with nothing on screen saying so — the exact bug the shared
   * list already produced once for Remember (GPT Sol's review of
   * docs/plans/260827ah-review-mode.md, finding 7).
   *
   * The filter is a **type guard**, so `onThread` below can hand `target.kind`
   * straight to `onMode`. `ThreadKind` and `Mode` used to agree on every member
   * and stopped agreeing the day `candidates` arrived; narrowing here is what
   * keeps that assignment honest instead of casting it.
   */
  const threads = useMemo(() => everyThread.filter(isConversationThread), [everyThread]);
  const [thread, setThread] = useQueryState("thread", threadParam);
  /* Write-only, for rule 3 in `onThread` below — the value itself is
     `RememberBand`'s to read. A setter with no reader still subscribes, which is
     the cost, and it is paid only by a band the reader has opened. */
  const [, setRemember] = useQueryState("remember", rememberParam);

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
   * below: a reader with three chats and no Remember threads would press
   * Remember and be
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
  /* Read, never written, and not a subscription — see `currentAt` in
     params.ts. It is passed to the model so that "this bit" and "what he just
     said" resolve to where the reader actually is. */
  const at = currentAt();

  /**
   * The stance the next Remember answer will be asked for.
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
  const [picked, setPicked] = useState<RememberStance | null>(null);
  const open = threads.find((t) => t.id === thread);
  const lastStance = [...(open?.messages ?? [])]
    .reverse()
    .find((m) => m.role === "assistant" && m.stance)?.stance;
  const stance: RememberStance = picked ?? lastStance ?? "balanced";

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
       * The list is shared, so a Remember row is pressable from chat mode.
       * Moving `?thread=` without `?mode=` would leave one open in a panel
       * that asks with chat's prompt and shows no stance picker, and the
       * transcript would give no sign why. Both setters fire in the same event,
       * so they land in one navigation rather than putting a chat-mode-plus-
       * Remember-thread entry on the Back stack in between.
       */
      onThread={(id) => {
        const target = id ? threads.find((t) => t.id === id) : null;
        /* `ThreadKind` and `Mode` are separate vocabularies (src/types.ts,
           src/modes.ts) that agree on the two *conversation* kinds — since
           2026-09-01, when `review` became `remember` in the column as well as
           the URL. So this assigns rather than maps, and the compiler is what
           keeps that true: `threads` above is narrowed to those two, and the day
           `candidates` was added to `ThreadKind` this line went red until it
           was. A third vocabulary sharing two of three names is exactly the
           overlap that reads as identity until it isn't. */
        if (target && target.kind !== kind) onMode(target.kind);
        /* **Rule 3**: opening a Remember conversation lands on the Recall half,
           because a conversation is what Recall is and Quiz has nowhere to put
           one. Set unconditionally rather than only when crossing from chat,
           so a stale `?remember=quiz` on the URL cannot survive a thread being
           opened from anywhere. nuqs batches every setter fired in one event
           into a single navigation, which is what the two lines above already
           rely on — so this is still one entry on the Back stack, not three.
           `rememberParam` defaults to `recall`, so this writes nothing to the URL
           in the ordinary case. */
        if (!target || target.kind === "remember") void setRemember("recall");
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
          sendKind === "remember" ? stance : undefined,
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
          kind === "remember" ? stance : undefined,
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
      subMode={subMode}
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
 * What survives is the other half: **a mounted `useJobs` holds the job engine
 * on its idle cadence**, and that is a request every eight seconds for the life
 * of the panel. A reader who never opens the band should not pay for it. Hooks
 * cannot be called conditionally, so the condition has to be a component
 * boundary — this one.
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
  onMode,
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
  /**
   * Switch mode, for the one thing the glossary cannot answer.
   *
   * The *Look up a term* box explains what the piece says and nothing else, so
   * a word the piece never uses has no answer in this band at any price. Chat
   * is the surface that may go outside the article, and the panel offers it
   * rather than leaving the reader at a dead end. Same prop and same reason as
   * `ConversationBand`'s, one band along. See `AskATerm` in GlossaryPanel.tsx.
   */
  onMode(next: Mode): void;
}) {
  useRenderCount("GlossaryBand");
  const glossary = useGlossary(slug, read);
  const band = useGlossaryMode(glossary.glossary?.entries ?? NO_TERMS, onSelected);

  /* Memoised so the panel's `onAskChat` keeps its identity between renders,
     which is the same reason every other callback crossing this boundary is. */
  const askChat = useCallback(() => onMode("chat"), [onMode]);

  return (
    <GlossaryPanel
      access={{ kind: "owner", owner: glossary, glossary: glossary.glossary }}
      {...band}
      onJump={onJump}
      onAskChat={askChat}
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
 * A module constant rather than a fresh `[]`, for the reason `NO_TERMS` is one:
 * the memos in `useQuotesMode` key on it by identity.
 */
const NO_QUOTES: Quote[] = [];

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
     `QUOTE_BAR_DEFAULT`. Kept as null rather than defaulted here so the default stays
     one number in one file — see `barParam` in params.ts. */
  const [bar, setBar] = useQueryState("bar", barParam);

  /**
   * **A quote the bar has hidden cannot stay selected**, which since 2026-09-03
   * is a state the reader can reach: the prioritised rank hides what is below
   * the bar rather than grouping it, and `?quote=` resolves against the whole
   * artefact independently of what the panel is drawing. Without this a raised
   * bar took the row away and left the line marked in the prose and in the
   * rail, and lowering the bar later silently reopened a selection the reader
   * had watched disappear. The same rule search holds at `SearchBand`.
   *
   * Scoped to `prioritised`, because that is the only rank with a bar: a
   * `?bar=` sitting in a URL must not clear a selection in a list nobody is
   * looking at a threshold for. `snapToStop` first, exactly as the panel does,
   * or this and the panel would be asking about two different bars.
   */
  const all = quotes?.quotes ?? NO_QUOTES;
  const hiddenSelection = useMemo(() => {
    if (quoteId === null) return false;
    if (effectiveRank([...all], rank) !== "prioritised") return false;
    const at = snapToStop(barStops([...all]), bar ?? QUOTE_BAR_DEFAULT);
    return !visibleQuotes(all, at).visible.some((q) => q.id === quoteId);
  }, [all, rank, bar, quoteId]);
  useEffect(() => {
    if (hiddenSelection) void setQuoteId(null);
  }, [hiddenSelection, setQuoteId]);

  const selected = useMemo(
    () => (hiddenSelection ? null : (all.find((q) => q.id === quoteId) ?? null)),
    [all, quoteId, hiddenSelection],
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
export function VisitorGlossaryBand({
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

  /**
   * **A term the bar has hidden cannot stay selected.**
   *
   * The rule search already held at `SearchBand` below, and it arrived here
   * with the 2026-09-03 change: the panel resolves `?term=` against the whole
   * glossary, independently of what it is drawing, so a raised gate used to
   * take the row away while the term stayed emphasised in the prose — and
   * lowering the gate later silently reopened a selection the reader had
   * watched disappear. "Open" is a thing the reader can see, and a hidden one
   * is a claim about the page that the page is not making.
   *
   * **Only the selected emphasis goes.** The dotted underline under every
   * glossary term is drawn from the full list in every mode (`termSelections`
   * in `Reader`) and is not the selection. It stays.
   *
   * Scoped to prioritised order, because that is the only order with a gate:
   * `?gate=` sitting in a URL must not clear a selection in a list nobody is
   * looking at a threshold for.
   */
  const order = effectiveSort(entries, sort);
  const hiddenSelection =
    termId !== null &&
    order === "prioritised" &&
    !visibleEntries(entries, gate ?? PRIORITY_GATE).visible.some((e) => e.id === termId);
  useEffect(() => {
    if (hiddenSelection) void setTermId(null);
  }, [hiddenSelection, setTermId]);

  /* `find` returns the entry object out of the list, so its identity is stable
     across renders until the list itself is replaced — which is what keeps the
     effect below from firing on every render. Null in the render itself the
     moment the bar hides it, rather than a tick later when `?term=` clears:
     waiting for the parameter would leave a frame with the prose emphasising a
     term the panel is not showing. */
  const selected = hiddenSelection ? null : (entries.find((e) => e.id === termId) ?? null);

  /* **`useLayoutEffect`, not `useEffect`**, and nulling `selected` above is not
     enough on its own — which is what the comment there used to claim. The
     value the prose actually draws from is `Reader`'s own state, and it only
     gets there through this call: a passive effect runs *after* the browser has
     had the chance to paint, so the panel could commit without the row while
     `TableView` still emphasised the term. One frame, and it is the frame in
     which the page says two different things about what is open.

     The same pairing, for the same reason, as `QuotesBand` above and
     `SearchBand` below: a layout effect on every change, and an unmount-only
     clear underneath. GPT Sol's second finding on the built code, 2026-09-03. */
  useLayoutEffect(() => {
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
  const { panel, setActive } = useSearchMode({
    runs,
    blocks,
    words: true,
    onJump,
    onFound,
    openHit,
    onOpenHit,
  });

  return (
    <SearchPanel
      {...panel}
      access={{
        kind: "owner",
        loaded,
        loadFailed,
        error,
        onAsk: (criterion) => {
          /* `ask` mints the id, so `?runs=` can name the search before the
             model has said anything — the same trick `?note=` and `?thread=`
             use.

             And it switches itself on, which is the one exception to
             default-false: a search the reader just paid for and cannot see is
             not a result. */
          setActive([...panel.active, ask(criterion)]);
          onOpenHit(null);
        },
        onRetry: retry,
        /* Straight through. Unlike every other write on this panel it does not
           touch `?runs=` or the open row: a colour changes what a mark looks
           like, never which marks are drawn or which one the reader is on. */
        onRecolour: recolour,
        onDelete: (id) => {
          remove(id);
          setActive(panel.active.filter((x) => x !== id));
          onOpenHit(null);
        },
      }}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useSearch`, and therefore no fetch, no `ask`, no retry and no delete: the
 * saved runs came in the page's own payload. Greg, 2026-09-04 — *"Only owner
 * can create new searches. Everyone else can see the ones they have already
 * created."*
 *
 * A second band rather than a second panel, for the reason
 * `VisitorTimelineBand` and `VisitorGlossaryBand` give: a hook cannot be called
 * conditionally, so the owner/visitor seam has to be a component boundary
 * (src/web/reader-capability.ts). And `words: false`, which pins the matcher —
 * a pasted `?match=words` would otherwise put this reader in front of a box
 * that is not rendered.
 */
function VisitorSearchBand({
  searches,
  blocks,
  onJump,
  onFound,
  openHit,
  onOpenHit,
}: {
  searches: SavedSearch[];
  blocks: Article["blocks"];
  onJump(id: BlockId): void;
  onFound(next: Found[]): void;
  openHit: string | null;
  onOpenHit(next: string | null): void;
}) {
  useRenderCount("VisitorSearchBand");
  const { panel } = useSearchMode({
    runs: searches,
    blocks,
    words: false,
    onJump,
    onFound,
    openHit,
    onOpenHit,
  });
  return <SearchPanel {...panel} access={{ kind: "visitor" }} />;
}

/**
 * **Everything the search band does that is not a fetch** — the six URL
 * parameters, the colour slots, the two matchers meeting, and the three effects
 * that keep the panel and the prose showing one set of passages.
 *
 * Extracted on 2026-09-04 so that the owner's band and the visitor's are one
 * behaviour rather than two, which is the same split `useTimelineMode` and
 * `useQuotesMode` already have.
 *
 * **It returns two things rather than one**, unlike its siblings, and the
 * second is the reason: `onAsk` and `onDelete` are the owner's alone, and both
 * of them have to write `?runs=` — a search the reader just paid for switches
 * itself on, and a deleted one switches itself off. `setActive` is that write,
 * handed back so those two verbs can stay on the arm they belong to instead of
 * being passed *in* here as optionals.
 */
function useSearchMode({
  runs,
  blocks,
  words,
  onJump,
  onFound,
  openHit,
  onOpenHit,
}: {
  runs: SavedSearch[];
  blocks: Article["blocks"];
  /**
   * **Is the literal matcher on offer to this reader?**
   *
   * True for an owner, false for a visitor, and it decides the value of
   * `matcher` rather than only hiding a control — `?match=words` is ordinary
   * query state, and a pasted link walks straight past a chip that was merely
   * not drawn. The same pin `DiagramPanel` puts on `?diagram=`, for the same
   * reason. See `PublicArticle.searches` for why v1 leaves it out.
   */
  words: boolean;
  onJump(id: BlockId): void;
  onFound(next: Found[]): void;
  openHit: string | null;
  onOpenHit(next: string | null): void;
}) {
  const [match, setMatcher] = useQueryState("match", matchParam);
  const [find, setFind] = useQueryState("find", findParam);
  /* `?match=` has no default of its own, so that a URL carrying `?find=` and
     nothing else still opens on the words matcher it was written for. The rule
     lives in params.ts § resolveMatcher; here it is one line.

     **And `words` overrides it**, in this component, whatever the URL says —
     see the prop. */
  const matcher: Matcher = words ? resolveMatcher(match, find) : "meaning";
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

  return {
    /* Spread straight into `SearchPanel` by both bands, so the two cannot drift
       into passing different things — the shape `useTimelineMode` already has. */
    panel: {
      runs,
      matcher,
      onMatcher: (next: Matcher) => {
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
      },
      find,
      onFind: (next: string | null) => {
        void setFind(next);
        onOpenHit(null);
      },
      active,
      slots,
      onToggle: (id: string, on: boolean) => {
        void setRunIds(on ? [...active, id] : active.filter((x) => x !== id));
        /* Whatever row was open may have belonged to the search just switched
           off, and a highlighted row pointing at a mark that is no longer drawn
           is the panel and the prose disagreeing. Cheap to clear, and the
           reader loses only a highlight. */
        onOpenHit(null);
      },
      /* Pressing the row rather than its box: the set becomes this one search.
         Greg, 2026-08-27 — *"if I click on a row, select that and deselect all
         the others (since usually we care about just one at a time). If I want
         multiple-selection, I'll use a checkbox."* Not a toggle, so pressing
         the row that is already alone leaves it alone; the box is what unticks.
         The open row goes for the same reason it goes on a toggle — it may have
         belonged to a search that is no longer drawing anything. */
      onSolo: (id: string) => {
        void setRunIds([id]);
        onOpenHit(null);
      },
      onToggleAll: (on: boolean) => {
        void setRunIds(on ? runs.map((r) => r.id) : []);
        onOpenHit(null);
      },
      found: results,
      all: ordered,
      order,
      onOrder: (next: HitOrder) => void setOrder(next),
      gate,
      gateMoved: chosenConf !== null,
      onGate: (next: number | null) => void setConf(next),
      openKey: openHit,
      onOpen: (key: string, blockId: BlockId) => {
        onOpenHit(key);
        // Always jump, even when the block is already on screen — unlike
        // stepping between comments, which deliberately does not. A search
        // result is a place you have not been yet, and "I pressed it and
        // nothing moved" is the complaint that makes a results list feel
        // broken; two comments in one paragraph are the opposite case.
        onJump(blockId);
      },
    },
    /* `?runs=`, for the owner's two verbs that write it. See the docblock. */
    setActive: (ids: string[]) => void setRunIds(ids),
  };
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

  /* Read, never written, and not a subscription — see `currentAt` in
     params.ts.

     Turned into a row index here rather than passed down as an id, because the
     panel's question is "is the reader inside this range", and a range is a
     pair of row indices — comparing ids would be comparing random strings for
     order, which is the one thing block-ids.md forbids. */
  const at = currentAt();
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
 * Every picture here spends a model call, since the free one — `tree`, the
 * outline — was cut on 2026-08-30. **Sketch is the default since
 * 2026-09-04**, and it is the one picture here that draws nothing at all until
 * the reader asks: what an owner arriving here meets is an invitation with the
 * price and the wait on it (SketchView.tsx § the empty state), and opening the
 * mode still buys nothing (activation.ts § `MODE_TARGET`). Force held the
 * default before that, for the opposite reason — it was the only one that drew
 * something real before its answer landed — and it is now behind the
 * experimental-features switch with Drift, Trail and Illustrated. See
 * docs/project/diagram.md.
 */
function DiagramBand({
  access,
  experimental,
  slug,
  article,
  at,
  onJump,
}: {
  /** Owner or visitor — DiagramPanel.tsx § DiagramAccess is the whole argument. */
  access: DiagramAccess;
  /**
   * The experimental-features switch, as the chip row sees it — passed straight
   * through. `Reader` reads the hook once and hands the answer to both the bar
   * and this band, which is what stops them disagreeing.
   * DiagramPanel.tsx § `experimental`.
   */
  experimental: boolean;
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
      access={access}
      experimental={experimental}
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

/**
 * **Referee mode — for somebody who has been asked to peer-review this piece.**
 *
 * docs/plans/260831an-referee-mode-for-peer-reviewers.md. The band itself is
 * stage 1 — the confidentiality notice, the four buttons, and a line per panel
 * saying what that panel will do — and it still calls no model. **Three of the
 * four panels underneath it now do**: Criteria (stage 3), Claims (stage 4) and
 * Mirror (stage 5b). Candidates is still its stage 1 placeholder.
 *
 * There are **four** of them and the plan on disk says three: `candidates` was
 * added on Greg's say-so the same night, overruling the cut the plan's appendix
 * argues for. It is the only one that is not the referee's own question —
 * see `CandidatesPanel`.
 *
 * The design problem the whole mode is built around is Greg's, 2026-08-31:
 *
 * > it felt like a useful service to help them scan a document efficiently, and
 * > flag useful/relevant stuff. At the same time, I'm wary about handing off too
 * > much of the intellectual labour to AI and leading to cognitive surrender.
 *
 * Which is why **no verdict, ever** is the rule every one of these panels will
 * be built under — no accept/reject, no score, no per-criterion grade. Ranking
 * within the paper is the only ordering the mode offers.
 *
 * ## The notice is in the past tense, is shut until asked for, and is never dismissed
 *
 * All three are deliberate. **Past tense** because by the time anybody is
 * looking at this band the article's text has already gone to the model
 * provider — ingest ran extraction, hierarchy and gists on it, and a PDF was
 * read by a model before it was anything else. A notice here saying *this will
 * send your manuscript to a third party* would be warning about something the
 * app has already done. The present-tense half of the same fact belongs at the
 * point of adding an article, and is there: `ADDING_SENDS_TEXT_AWAY` in
 * src/web/AddArticle.tsx.
 *
 * **No acknowledgement**, which the plan's first draft asked for. A box that
 * says "I understand" in front of something already done would imply that
 * ticking it makes prohibited use permissible. It would also have to be
 * remembered somewhere, and both places available are wrong: the URL is for
 * view state — *how you are looking at an article*, which has to survive a
 * reload and travel when the address is pasted (docs/project/url-state.md) —
 * and a column is a migration for a checkbox.
 *
 * **This comment used to say `localStorage` was "banned outright", and that was
 * the flat version of the rule rather than the rule.** It is banned for view
 * state, which is what the paragraph above is about; a per-device "I have read
 * this" bit is neither view state nor anything worth pasting to somebody else.
 * `InstallHint` was already the exception and the explainer card below is the
 * second — src/web/referee-card.ts draws the distinction in full. None of that
 * reaches this notice, which remembers nothing on purpose; see the collapse
 * paragraph at the end.
 *
 * **Not dismissible**, for the reason `SharedNotice` in src/web/PublicChrome.tsx
 * gives about itself: *it is what this page is, and a control to make it go away
 * would say otherwise.*
 *
 * **Shut by default, though**, since 2026-09-02, when Greg asked for it:
 * *"also default-collapse the message starting with 'This article's text has
 * already been sent to a third-party model...'"* The three sentences above are
 * unchanged and so is the reasoning; what changed is that the paragraph a
 * referee reads once no longer costs the band 214px on every visit.
 *
 * **A collapse is not a dismissal, and the two differences are what keep the
 * paragraph above true.** First, the *fact* is the label on the control —
 * `REFEREE_TEXT_ALREADY_SENT_SHORT` — so shutting the box hides which venues
 * call this a breach and which manuscripts the mode is for, never that the text
 * has gone. Second, nothing is remembered: `noticeOpen` is a `useState` that
 * dies with the mount, so every visit starts shut and one press opens it. That
 * is also why the storage objection this comment used to make against a
 * collapse — the URL is the wrong place for it, and a column is a migration for
 * a checkbox — does not apply: there is nothing to store.
 *
 * **The explainer card *is* remembered, and the difference between them is the
 * point.** "How Referee mode works" is something you read once; a notice about
 * where the manuscript has already gone is something the mode *is*, and a
 * referee arriving on their second paper meets it again. So the card keeps a bit
 * in `localStorage` (src/web/referee-card.ts) and this keeps none — and the two
 * live in different boxes, `.ref-brief` and `.ref-panel`, so that no press can
 * be mistaken for the other.
 *
 * It is styled as a notice and not as an error — src/web/styles.css § referee
 * mode. Nothing has gone wrong.
 */
function RefereeBand({
  slug,
  blocks,
  byline,
  comments,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  slug: string;
  blocks: Block[];
  /**
   * Who wrote the paper — **passed through to Candidates and read nowhere
   * else**.
   *
   * Rule 4 is that referee calls are identity-stripped, and Candidates is its
   * one stated exception: it sees the byline in order to exclude the paper's own
   * authors from the names it puts forward, and for nothing else. The exception
   * is written here, in the prop, rather than left to be discovered in a diff.
   */
  byline?: string | undefined;
  /**
   * This reader's comments — **passed through to Criteria and read nowhere
   * else**, and read-only there.
   *
   * A comment with a `criterionId` is the referee's own placement of a passage
   * on one of their criteria, and the panel puts it beside the model's on the
   * same block. One without is an ordinary reading note and is none of Referee
   * mode's business. docs/project/comments.md § the referee's own placement.
   */
  comments: readonly Comment[];
  onJump(blockId: BlockId): void;
  /** `Reader` owns the prose — the seam described on `found` above. */
  onFound(next: Found[]): void;
  /**
   * The marked passage the referee last pressed — **Criteria's, and read
   * nowhere else**, like `comments` above.
   *
   * Claims paints marks too and does not have one yet; it is the same wiring
   * when somebody wants it. Mirror and Candidates paint nothing at all.
   */
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  useRenderCount("RefereeBand");
  const [view, setView] = useQueryState("referee", refereeParam);
  /* Held by the band rather than by a panel: the answer is about the document,
     not about a sub-mode, and a hook inside `RefereeSubMode` would re-run the
     scan every time the referee pressed a different chip. */
  const scan = useSourceScan(slug);
  /* **Shut, and not remembered** — see the header. Local state rather than a
     `?` parameter, for the reason `Section` in src/web/Metadata.tsx gives about
     itself: a shut box is not view state, nothing about it is worth linking to,
     and docs/project/url-state.md keeps the address bar for places you were. */
  const [noticeOpen, setNoticeOpen] = useState(false);

  /* **One bit, and it is on the device rather than in the URL** — the card is
     open until the referee shuts it, and the header button brings it back by
     clearing the same bit. Every read and write of it is inside `useHowCard`,
     so this component cannot change the screen and forget to write;
     src/web/referee-card.ts is why it is not a `?` parameter, and why it is not
     the flat ban this component's docstring used to assert. */
  const how = useHowCard();

  return (
    <aside className="mode-band gloss referee" aria-label="Referee">
      <div className="band-head">
        <ClipboardCheck size={14} className="band-head-icon" />
        <h2>Referee</h2>
        <RefereeHowButton open={how.open} onToggle={() => how.show(!how.open)} />
      </div>

      {/* **The two things that belong to the mode rather than to a sub-mode**,
          in one box so that together they can be given a share of the band and
          made to scroll inside it. They are not merely two siblings that happen
          to be adjacent: the wrapper is what stops them from pushing the chips
          and the panel off the bottom of a `position: fixed` band that clips
          nothing and scrolls nowhere. src/web/styles.css § referee mode,
          `.ref-brief`, has the measurements. */}
      <div className="ref-brief">
        {/* Always, above everything, and before any sub-mode has been pressed.
            src/messages.ts owns both sentences. */}
        <div className="ref-notice">
          {/* **The fact is the label on the control**, so shutting the box does
              not take it away — only the venues and the audience, which is the
              part a referee reads once. src/messages.ts owns all three
              sentences. */}
          <button
            type="button"
            className="ref-notice-toggle"
            aria-expanded={noticeOpen}
            onClick={() => setNoticeOpen((was) => !was)}
          >
            <span>{REFEREE_TEXT_ALREADY_SENT_SHORT}</span>
            {noticeOpen ? (
              <ChevronDown size={12} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} aria-hidden="true" />
            )}
          </button>
          {noticeOpen && (
            <>
              <p>{REFEREE_TEXT_ALREADY_SENT}</p>
              <p className="ref-notice-also">{REFEREE_DECLARE_IT}</p>
            </>
          )}
        </div>

        {/* **Above the chips, and outside `.ref-panel`**, so it is on screen
            whichever sub-mode is open — rule 5 says the scan runs before anything
            else, and a fifth chip would have made it one more thing a referee can
            fail to press. It is fetched beside the band rather than in front of
            it: the scan takes hundreds of milliseconds on a short paper and about
            nine seconds on a large one, and nothing here waits for it. */}
        <SourceScanNotice state={scan} />
      </div>

      <RefereeViews view={view} onView={(next) => void setView(next)} />

      <div className="ref-panel">
        {/* **Inside the scroller, under the chips, and above the sub-mode** —
            not in `.ref-brief` with the two notices that may never be
            dismissed. src/web/RefereeCard.tsx § where it sits. */}
        {how.open && <RefereeHowCard onClose={() => how.show(false)} />}
        <RefereeSubMode
          view={view}
          slug={slug}
          blocks={blocks}
          byline={byline}
          comments={comments}
          onJump={onJump}
          onFound={onFound}
          openKey={openKey}
          onOpenKey={onOpenKey}
        />
      </div>
    </aside>
  );
}

/**
 * **The sub-mode chips**, and they are `DiagramPanel`'s exactly —
 * `role="radiogroup"` with `role="radio"` children, each its own tab stop, and
 * no arrow-key handling of any kind.
 *
 * That combination looks like a mistake and is not. The ARIA roles are the
 * honest description of the control: one of these is on, and choosing another
 * turns this one off. What Greg had removed on 2026-08-31 was arrow-key
 * *selection* — the roving tabindex and its handler — because on this page the
 * arrows belong to the article: up and down step it, left and right choose the
 * stride, and a group that swallowed them left the reader's keyboard dead while
 * a chip had focus. He met it as a bug. So the roles stay and the keys go, every
 * chip is tabbable, and Enter, Space or a click selects.
 * docs/project/keyboard.md, and tests/arrows-belong-to-the-article.test.tsx,
 * which sweeps every `role="radio"` in the client for exactly this and renders
 * these to check the arrows still reach the window.
 *
 * **Exported for that test**, and it is a seam worth having anyway: this
 * component is a pure function of its two props, where `RefereeBand` above owns
 * the `?referee=` parameter — the same band-owns-the-URL, panel-is-pure split
 * every other mode in this file makes.
 */
export function RefereeViews({
  view,
  onView,
}: {
  view: RefereeView;
  onView(next: RefereeView): void;
}) {
  return (
    <div className="ref-views" role="radiogroup" aria-label="What Referee is showing">
      {/* **A card on every chip**, which until 2026-09-02 was the one radiogroup
          in this app with nothing on it at all — four one-word labels naming four
          sub-modes that do four unrelated things, one of which spends money and
          one of which is never given the paper. Greg met the whole mode as
          *"very confusing"*.

          `TooltipGroup` so that reading along the row is one gesture rather than
          four waits, and `keepSide` for DiagramPanel's measured reason: the band
          sits at the right of the window, a card wider than a chip is otherwise
          thrown onto the cross axis, and it lands on top of the chips the reader
          is reading towards (Tooltip.tsx § keepSide). */}
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {REFEREE_VIEWS.map((v) => (
          <Tooltip
            key={v}
            placement="bottom"
            keepSide
            className="tip-soon"
            content={
              <ControlTip
                head={REFEREE_VIEW_LABEL[v]}
                what={REFEREE_VIEW_TIP[v].what}
                how={REFEREE_VIEW_TIP[v].how}
              />
            }
          >
            {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern and the call DiagramPanel.tsx, Dock.tsx and SearchPanel.tsx already make — a real <input type="radio"> cannot be styled as a chip without hiding the input and faking every state it already had */}
            <button
              type="button"
              role="radio"
              aria-checked={v === view}
              /* **Its own tab stop, and no key handler.** A roving `tabIndex` is
                 inseparable from arrow navigation — it is one tab stop for the whole
                 group and only navigable because the arrows move within it — so
                 leaving it here while removing the handler would make all but one
                 of them unreachable by keyboard altogether. */
              tabIndex={0}
              className={`ref-view-btn${v === view ? " on" : ""}`}
              onClick={() => onView(v)}
            >
              {REFEREE_VIEW_LABEL[v]}
            </button>
          </Tooltip>
        ))}
      </TooltipGroup>
    </div>
  );
}

/**
 * **What each sub-mode is, and the thing about it a press would not tell you.**
 *
 * `ControlTip`'s rule, which is the whole reason the second sentence is worth a
 * hover: `what` is what the reader could have worked out by pressing the chip
 * and looking; `how` is what they could not — where the answer comes from, what
 * it costs, or what the sub-mode does *not* promise. Each of these four `how`s
 * is a refusal:
 *
 * - **Criteria** never scores the paper, and the run is a model call over the
 *   whole of it, so pressing Run is not free.
 * - **Claims** asserts linkage and never adequacy — `LINKAGE_NOT_ADEQUACY` in
 *   src/referee-claims.ts says the same thing in the panel, above the button.
 * - **Mirror** is never given the paper (src/referee-mirror.ts § the three
 *   constraints) and keeps nothing (`useMirror.ts`: *one button, one run,
 *   nothing stored*).
 * - **Candidates** searches the web, which is a third party at a moment none of
 *   the other three reaches one, and checks no conflicts of interest
 *   (`COI_NOT_CHECKED`).
 *
 * A total `Record`, beside `REFEREE_VIEW_LABEL` and for its reason: a fifth
 * sub-mode is a red compile here rather than a chip that silently explains
 * nothing.
 */
const REFEREE_VIEW_TIP: Record<RefereeView, { what: string; how: string }> = {
  criteria: {
    what: "Write what you have been asked to judge this paper against. Each criterion becomes a re-runnable pass that marks the passages bearing on it.",
    how: "Each run is a model call over the whole paper. It never scores the paper: which way a passage cuts is marked, and what that adds up to is yours.",
  },
  claims: {
    what: "What the paper claims up front, and where it takes each claim up — in the paper's own order, never a ranking.",
    how: "It asserts only that a passage takes a claim up, never whether the passage carries it. That judgement is the review.",
  },
  mirror: {
    what: "The model reads your own comments back to you and points at ones an author could not act on.",
    how: "It is never given the paper, so it can hold no opinion about it. The answer is not stored — leaving this sub-mode loses it.",
  },
  candidates: {
    what: "For an editor: who could review this paper, and what expertise it would take.",
    how: "It searches the web as you talk to it, and every name carries a link a search returned. Conflicts of interest are not checked by anything here.",
  },
};

/**
 * What each button says.
 *
 * A total `Record` rather than a `map` over capitalised keys, so a fifth
 * sub-mode is a red compile here as well as in the switch below —
 * docs/project/typechecking.md. Not in src/web/referee-views.ts: that file is the
 * vocabulary a URL is parsed against and nothing server-side needs these words,
 * where `MODE_LABEL` had a second reader on the far side of the client/server
 * line and had to move.
 */
const REFEREE_VIEW_LABEL: Record<RefereeView, string> = {
  criteria: "Criteria",
  claims: "Claims",
  mirror: "Mirror",
  candidates: "Candidates",
};

/**
 * The selected sub-mode's panel.
 *
 * An exhaustive `switch` with a `never` in the default, so a fifth member of
 * `RefereeView` cannot be added without a panel to draw for it — which is not
 * hypothetical: `candidates` was added the same night, and this is what said
 * where. The alternative
 * — a lookup keyed by the view — would compile with a hole in it under
 * `noUncheckedIndexedAccess` and render nothing at runtime, which is the shape
 * docs/reusable/silent-success.md is about.
 */
function RefereeSubMode({
  view,
  slug,
  blocks,
  byline,
  comments,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  view: RefereeView;
  slug: string;
  blocks: Block[];
  byline?: string | undefined;
  /** The referee's own placements. See `RefereeBand`, which says why. */
  comments: readonly Comment[];
  onJump(blockId: BlockId): void;
  onFound(next: Found[]): void;
  /** Criteria's pressed passage. See `RefereeBand`, which says why. */
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  switch (view) {
    case "criteria":
      /* **Stage 3.** Its band owns `?crits=` and pushes the marked passages up;
         src/web/CriteriaPanel.tsx is the whole of it, including the three
         visual rules it is under. */
      return (
        <CriteriaBand
          slug={slug}
          blocks={blocks}
          comments={comments}
          onJump={onJump}
          onFound={onFound}
          openKey={openKey}
          onOpenKey={onOpenKey}
        />
      );
    case "claims":
      /* **Stage 4.** What the paper claims about itself and where it takes each
         claim up, in the paper's own order and never ranked by how much was
         found. src/web/ClaimsPanel.tsx is the whole of it, including the three
         rules and where each one is enforced rather than asked for. */
      return <ClaimsBand slug={slug} blocks={blocks} onJump={onJump} onFound={onFound} />;
    case "mirror":
      /* **Stage 5b**, and the second sub-mode to become reachable. It takes no
         `blocks` and pushes nothing up: a Mirror remark is about a sentence the
         referee wrote, so it belongs beside that sentence in the panel with a
         jump into the piece, and nothing is painted on the prose.
         src/web/MirrorPanel.tsx. */
      return <MirrorBand slug={slug} onJump={onJump} />;
    case "candidates":
      /* **Stage 6 and 7, and somebody else's stage.** The one sub-mode that is
         not the referee's question: it answers an *editor's* — who could review
         this paper, and what expertise it would take. Greg overruled the plan's
         own cut of it and then said it should be a reuse of Chat, so underneath
         it is a chat thread of a third `ThreadKind` and a shortlist parsed out of
         the transcript under four rules that are code rather than prompt.
         src/web/CandidatesPanel.tsx and src/referee-candidates.ts.

         It pushes nothing up: a candidate's anchor is a *fit requirement's*
         block, drawn as a citation chip in the panel, and washing the paper with
         it would say the paragraph is about a person. */
      return <CandidatesBand slug={slug} blocks={blocks} byline={byline} onJump={onJump} />;
    default: {
      const unknown: never = view;
      throw new Error(`unknown referee view: ${String(unknown)}`);
    }
  }
}

