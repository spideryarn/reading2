import { Library } from "./Library.js";
import { AuthCallback } from "./AuthCallback.js";
import { HomeLogo } from "./HomeLogo.js";
import { isAdmin } from "../admin.js";
import { LazyPage } from "./LazyPage.js";
import { LandingPage } from "./LandingPage.js";
import { NotFoundPage } from "./NotFoundPage.js";
import { PrivacyPage } from "./PrivacyPage.js";
import { ContactPage } from "./ContactPage.js";
import { OpenSourcePage } from "./OpenSourcePage.js";
import { FeaturesPage } from "./FeaturesPage.js";
import { PublicLibraryPage } from "./PublicLibraryPage.js";
import { PricingPage } from "./PricingPage.js";
import { PublicReadableSharingPage } from "./PublicReadableSharingPage.js";
import { SignInPage } from "./SignInPage.js";
import { useSession } from "./useSession.js";
import { useJobSession } from "./useJobs.js";
import { ProfilePage } from "./ProfilePage.js";
import { AddPage } from "./AddPage.js";
import { adminOnly, LIBRARY_HREF, navigate, type Route, useRoute } from "./router.js";
import type { User } from "@supabase/supabase-js";
import { FeedbackHost, FeedbackTrigger } from "./FeedbackButton.js";
import { ArticlePage } from "./article/ArticlePage.js";

/**
 * **The three routes whose code is not in the reader's initial download.**
 * `LazyPage.tsx`
 * has the reasoning; these are the five loaders it takes.
 *
 * Named-export adapters rather than `lazy(() => import("./AdminPage.js"))`,
 * because `React.lazy` reads `module.default` and neither page has one — the
 * bare form would send every visit to the failure surface. And **module
 * scope**, because a loader's identity is a `useMemo` dependency: an inline
 * arrow would build a new lazy type, and start a new fetch, on every render.
 */
const loadAdminHome = () => import("./AdminPage.js").then((m) => ({ default: m.AdminHome }));
const loadAdminUsers = () => import("./AdminPage.js").then((m) => ({ default: m.AdminUsersPage }));
const loadAdminFeedback = () =>
  import("./AdminPage.js").then((m) => ({ default: m.AdminFeedbackPage }));
const loadDesign = () => import("./DesignPage.js").then((m) => ({ default: m.DesignPage }));
/* `/changelog`'s own reason, beside `/design`'s: the parsed NDJSON file is
   210 KB and would otherwise land in every reader's first download for a page
   almost nobody opens — docs/project/changelog.md § The page. */
const loadChangelog = () =>
  import("./ChangelogPage.js").then((m) => ({ default: m.ChangelogPage }));



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
    /* **The one page here whose reader may want nothing from us at all** — an
       author who found their own writing on `/read/public`. Every other page in
       this branch is reachable signed out because a stranger is deciding
       whether to sign up; this one is reachable signed out because that reader
       will never sign up, and a page they cannot open is a page that does not
       exist. router.ts § `public-sharing`. */
    if (route.kind === "public-sharing") return <PublicReadableSharingPage signedIn={false} />;
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
    /* Since 2026-09-06, and closer to `contact` than to any of the pages
       above it: a changelog is a page somebody is *sent*, not one they browse
       to, and it is about the product rather than about their account, so
       there is nothing behind it an account would change. Bare, like every
       other page in this branch — no shelf to send a stranger back to.
       Lazy for the reason `design` is below: the parsed file is 210 KB.
       LazyPage.tsx. */
    if (route.kind === "changelog") return <LazyPage load={loadChangelog} routeKey="changelog" />;
    /* Since 2026-09-07, and signed out for a stronger reason than any of them:
       somebody deciding whether to trust us with what they read is exactly the
       person who wants to know the code is public, and they have not signed up
       yet. Not lazy — it is four paragraphs, not 210 KB. OpenSourcePage.tsx. */
    if (route.kind === "opensource") return <OpenSourcePage />;
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
     docs/project/feedback.md.

     **The one line is now the host's mount point rather than the button's**,
     since 2026-09-06. `FeedbackHost` holds the `open` state and the dialog and
     wraps every signed-in page, so no navigation can destroy a half-written
     report; the buttons that open it are placed where each page wants one. The
     rule is unchanged and it now reaches further than a mount site can see: a
     trigger with no host above it renders nothing, so the branches below that
     draw one unconditionally are still drawing nothing for a stranger.

     **And it stops covering `read`**, which is the route whose corners moved
     into the bottom bar. The reading view, the metadata and tweets pages and
     the three visitor stand-ins all mount a `Dock` and draw the trigger there
     (Dock.tsx). `ArticlePage`'s four branches that have no `Dock` — loading,
     error, not-shared and reauth-required — each draw the corner trigger
     themselves, so nothing that has one today loses it. */
  return (
    <FeedbackHost>
      <SignedIn route={route} user={user} />
      {route.kind !== "read" && <FeedbackTrigger variant="corner" />}
    </FeedbackHost>
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
  /* **The administrator's pages, refused before the branch chain rather than
     inside it — and this is a courtesy, not a gate.**

     `adminOnly` (router.ts) is one exhaustive map of route kinds, and it is
     consulted here once, above everything, for the same reason the server's own
     check sits above its route table (src/routes.ts): a check inside a branch
     has to be *remembered* by whoever adds the next page. `/design` is the
     proof — it moved onto the `/admin` index on 2026-09-05 and stayed open to
     everybody, because the `if` was in the `admin` arm.

     **Nothing is hidden by it.** These components are absent from the initial
     reader download since 2026-09-05 (LazyPage.tsx), but their chunks are
     public assets served to anyone who requests them, and the SPA rewrite
     answers 200 at these addresses whoever asks; `/design` reads no data at
     all, so there is nothing behind it to refuse either. **An unloaded chunk is
     not a boundary**: the only refusal that counts is the server's on
     `/api/admin/`, which would turn down a hand-written `fetch` from any of
     these pages just the same. src/admin.ts § the two halves.

     **The shelf, and deliberately not the 404 page** that arrived on 2026-09-03
     for every address nobody minted (NotFoundPage.tsx). Same reason
     docs/project/admin.md gives for the server answering 403 rather than 404:
     these pages exist, visibly, and their code is there for anybody who asks,
     so pretending the address means nothing buys nothing and costs a true
     sentence.

     `key` for the same reason the shelf below carries one — this is the same
     component, reached a different way. */
  if (adminOnly(route) && !isAdmin(user.id))
    return <Library key={user.id} readerId={user.id} />;

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
        <LazyPage load={loadDesign} routeKey="design" />
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
  /* Mounted signed in as well, for the owner half of its two readers: somebody
     weighing up the sharing switch is by definition signed in, and reaches this
     from `/privacy` or from the shelf. `signedIn` for the reason the line above
     it carries. */
  if (route.kind === "public-sharing")
    return (
      <>
        <HomeLogo />
        <PublicReadableSharingPage signedIn />
      </>
    );
  if (route.kind === "contact")
    return (
      <>
        <HomeLogo />
        <ContactPage />
      </>
    );
  // Signed in, the corner logo like every other standalone page — there is a
  // shelf here for it to link at. See the signed-out branch above for why
  // `/changelog` is on this list at all.
  if (route.kind === "changelog")
    return (
      <>
        <HomeLogo />
        <LazyPage load={loadChangelog} routeKey="changelog" />
      </>
    );
  if (route.kind === "opensource")
    return (
      <>
        <HomeLogo />
        <OpenSourcePage />
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
  /* The administrator's pages. Whether this reader may see them was settled at
     the top of this function, by `adminOnly` — there is no second check here,
     deliberately, so that nobody reading this branch comes away thinking it is
     holding a door shut. */
  if (route.kind === "admin") {
    return (
      <>
        <HomeLogo />
        {route.page === "users" ? (
          <LazyPage load={loadAdminUsers} routeKey="admin:users" />
        ) : route.page === "feedback" ? (
          <LazyPage load={loadAdminFeedback} routeKey="admin:feedback" />
        ) : (
          <LazyPage load={loadAdminHome} routeKey="admin:home" />
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