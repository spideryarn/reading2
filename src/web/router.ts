/**
 * The pages, and which one you are on is the path.
 *
 * Greg, 2026-08-25:
 *
 * > have a homepage that enables us to browse past documents, and then if I
 * > click on one of the documents, it takes us to this interface that we've been
 * > building using a slug of the URL … So it might be `/read/[slug]/`
 *
 * So: `/` is the library, `/read/<slug>` is the reading view, and the slug is
 * part of the address rather than a `?slug=` parameter. Everything *else* stays
 * in the query string — see params.ts. The division is: **the path says which
 * article, the query says how you are looking at it.** A pasted link carries
 * both.
 *
 * ## The third segment
 *
 * An article now has three views, and which one is a third path segment:
 * `/read/<slug>` is the reading view, `/read/<slug>/metadata` is everything we
 * know about it (docs/plans/260825e-metadata-page.md), `/read/<slug>/tweets` is the
 * article as a numbered thread (docs/plans/260825g-tweet-thread-page.md). They are the
 * same article seen differently, so they are the same route with a `view`
 * rather than three routes.
 *
 * ## /add/<a whole URL>
 *
 * > Add a url that I can use to add something directly, e.g.
 * > `/add/[my-full-url-here]` or `/?add=[my-full-url-here]` or similar
 * >
 * > — Greg, 2026-08-26
 *
 * The odd one out: every other route names something of ours by a slug, and
 * this one carries somebody else's address. Both of Greg's spellings work, plus
 * an encoded one, and only the encoded one reaches React — see `addHref` below
 * and the fourth rewrite in main.tsx. The page itself is AddPage.tsx.
 *
 * ## Why this is fifty lines and not react-router
 *
 * There are two routes and one parameter. React Router would bring a provider,
 * a route table and its own history abstraction to express that, and would then
 * sit between us and `history` — which matters here, because nuqs wants to see
 * every history write. Two libraries owning navigation is the kind of
 * arrangement that works until the day it doesn't.
 *
 * Calling `history.pushState` ourselves means nuqs sees our navigations exactly
 * as it sees its own — **but only because main.tsx calls
 * `enableHistorySync()`.** That is worth spelling out, because this paragraph
 * used to assert the patching as a property of nuqs and it is not: it is opt-in
 * and nothing had opted in, so `navigate()` was invisible to every
 * `useQueryState` in the app. The argument for hand-rolling the router depends
 * on that one call; if it ever goes, this file's whole justification goes with
 * it. main.tsx has the mechanism and the docstring that talks you out of it.
 *
 * This file used to say *"revisit if a third route arrives with nested
 * layouts"*, and one has: the metadata page is a page of its own that shares
 * the article fetch and the bottom bar with the reading view. It was weighed
 * rather than waved through — the shared shell is one branch in `ArticlePage`
 * (App.tsx) and one extra alternation in the regex below, which is still far
 * less than a router. **The next person to add a route should re-read this
 * paragraph rather than assume the question stays settled.** The thing to watch
 * for is a view that needs its own nested sub-routes, or a fourth segment.
 */
import { useMemo, useSyncExternalStore } from "react";

import { isSlug, PUBLIC_LIBRARY_SLUG } from "../ingest.js";

/** Which of an article's three pages. `article` is the reading view itself. */
/* **Moved to src/read-address.ts on 2026-08-30** and re-exported, so nothing
   that used this name knows. The serverless function that composes a shared
   article's head has to know which view an address settles on, and it may not
   import anything under src/web/. */
import {
  hidesProse,
  isLegacyAboutPair,
  isTextOffPair,
  queryPairs,
  redirectsToMetadata,
  type ArticleView,
} from "../read-address.js";
import { isSpideryarnId } from "../ids.js";
import type { BlockId } from "../types.js";
import {
  canStamp,
  clearArmedJump,
  consumeArmedJump,
  isJumpArmed,
  type JumpOrigin,
  onArmedJumpChange,
  readStamp,
  withStamp,
} from "./jump-history.js";
export type { ArticleView };

/** Which admin page. `home` is `/admin` itself — the index of the others. */
export type AdminPage = "home" | "users" | "feedback";

export type Route =
  | { kind: "library" }
  | { kind: "read"; slug: string; view: ArticleView }
  /**
   * **The shelf of public articles — `/read/public`.**
   *
   * Under `/read/` and not beside it, because it is about articles and because
   * that is the address Greg asked for: *"create a `/read/public/` page that
   * lists Public-readable pages"* (2026-09-04). The cost of living there is that
   * it occupies a name an article could otherwise have had, which is why
   * `isReservedSlug` (src/ingest.ts) refuses it at the one line that brings an
   * article address into existence — a shelf card pointing at a page about
   * something else is a failure nothing would report.
   *
   * **Matched before `/read/:slug`, here and at the edge.** `decidePublicPage`
   * (src/public/page.ts) answers this address without asking the database, and
   * the two have to agree or one of them serves a 404 for a page the other
   * renders. docs/plans/260904b-pricing-page-and-public-showcase.md § 3.
   *
   * **The page is src/web/PublicLibraryPage.tsx**, since 2026-09-04, and it
   * reads `GET /api/public/library` through `loadPublicLibrary`
   * (src/web/public-api.ts). App.tsx mounts it on both arms — a visitor and an
   * owner get the same page, which is the rule the whole public namespace
   * follows — and the edge answers 200 with the default head. Both said 404 for
   * the day between the route landing and the page landing, deliberately: an
   * address with nothing at it should say so. docs/project/public-shelf.md.
   */
  | { kind: "public-library" }
  /**
   * Add this URL, right now — `/add/<a whole URL>`. See AddPage.tsx.
   *
   * The parameter is somebody else's address, not one of ours, which is why it
   * is the only route here that carries an arbitrary string rather than a slug.
   */
  | { kind: "add"; url: string }
  /**
   * Turn an already-uploaded file into an article — `/add/upload/<uploadId>`.
   *
   * A separate route from `add` and not a variant of it, because the parameter
   * is one of *ours* rather than somebody else's address: an upload id we
   * minted, which is the only thing about an upload a URL can carry. `/add/`
   * cannot take a file — a form post is not an address — so the file goes to
   * the object store from the shelf, and then this page picks it up by id.
   *
   * That keeps the property Greg asked for: one place that starts an ingest,
   * and it has an address you can reload.
   */
  | { kind: "add-upload"; uploadId: string }
  /**
   * The design reference — every primitive on one page. See DesignPage.tsx.
   *
   * **On the administrator's list since 2026-09-05** (`ADMIN_ONLY` below), which
   * is a courtesy and not a gate: it reads no data at all, so there is nothing
   * behind it that could refuse anybody, and its code is a public asset that
   * any browser can fetch either way. It is on the list because it is developer
   * furniture, not because it is privileged.
   *
   * Since 2026-09-05 that code is **not** in every reader's first download —
   * App.tsx loads it when somebody asks for the address (LazyPage.tsx). That
   * changed the startup cost and nothing about who may see it: the chunk is
   * served to anyone who requests it, with no auth in front of it.
   */
  | { kind: "design" }
  /**
   * Profile, rather than an article — `/profile`. See ProfilePage.tsx and
   * docs/project/reader-profile.md.
   *
   * Not under `/read/`, and that is the whole reason it is a route of its own
   * rather than a card on the metadata page: the thing it holds is true on
   * every article, and a global value edited inside one article's page is a
   * global value nobody can find. Greg, 2026-08-26: *"the user-level profile
   * should be in its own new `/profile` page (linked to from the Home page)"*.
   */
  | { kind: "profile" }
  /**
   * The sign-in screen at an address of its own — `/login`.
   *
   * **The one address that is not a statement about who you are.** Not being
   * signed in shows you the landing page wherever you are (LandingPage.tsx,
   * and the gate in App.tsx), because who you are is not view state and so
   * does not belong in the URL (url-state.md). This route is the exception,
   * and the reason is that it is a page somebody was *sent*: a password-reset
   * email has to land somewhere, and "send me the login page" is a reasonable
   * thing to be able to do. It gets the compact screen rather than the pitch —
   * SignInPage.tsx. Nothing in the app links to it.
   */
  | { kind: "login" }
  /**
   * The administrator's pages — `/admin` and `/admin/users`. See AdminPage.tsx
   * and docs/project/admin.md.
   *
   * Two pages as one route with a `page`, exactly as an article's three views
   * are one route with a `view`: they share a heading, a back-link and the
   * question of who is allowed to see them, and three routes would mean three
   * places to answer it.
   *
   * **Parsing this says nothing about being allowed to see it.** The route
   * exists for everybody; `ADMIN_ONLY` below is what App.tsx reads to render
   * the shelf instead for anybody who is not the administrator — **and
   * deliberately not the 404 page**, which is
   * where an address this file does not recognise goes since 2026-09-03. The
   * reason is docs/project/admin.md's: these pages' code is served to anybody
   * who asks for it, so 403 is the honest posture and a 404 would be pretending
   * about something anyone can see is there. The refusal that matters is the
   * server's, on `/api/admin/`. Since 2026-09-05 the code arrives on demand
   * rather than in everyone's first download (LazyPage.tsx) — a change to
   * startup cost, not to who may have it.
   */
  | { kind: "admin"; page: AdminPage }
  /**
   * What we do with a reader's data — `/privacy`. See PrivacyPage.tsx and
   * docs/project/website-text.md.
   *
   * **Reachable signed out**, which is the only interesting thing about it and
   * the reason it is a route rather than a section of the landing page: the
   * person most likely to want it is somebody deciding whether to sign in at
   * all, and a policy you have to have an account to read is not a policy. So
   * it joins `login` in App.tsx's signed-out branch.
   */
  | { kind: "privacy" }
  /**
   * What the thing does, mode by mode, with pictures — `/features`. See
   * FeaturesPage.tsx and docs/project/website-text.md. Reachable signed out
   * for the same reason `privacy` is: the person who wants it is deciding
   * whether to sign up, and the landing page links to it.
   */
  | { kind: "features" }
  /**
   * What happens when a reader makes an article public here, and what to do if
   * the article is yours — `/features/public-readable-sharing`. See
   * PublicReadableSharingPage.tsx and docs/project/public-readable-sharing.md.
   *
   * **The app's only nested address**, and the only one whose reader may have
   * no interest in the product at all: a rights-holder who found their own
   * writing on `/read/public`. Signed out for a stronger reason than `privacy`
   * and `features` — that reader will never have an account, and a page they
   * cannot open is a page that does not exist.
   */
  | { kind: "public-sharing" }
  /**
   * What it costs — `/pricing`. See PricingPage.tsx and
   * docs/project/website-text.md. Signed out for the same reason as `privacy`
   * and `features`, and rather more so: a price you have to sign up to see is
   * the thing people complain about, and this is the page somebody sends
   * somebody else.
   */
  | { kind: "pricing" }
  /**
   * How to reach us, and which way is best — `/contact`. See ContactPage.tsx
   * and docs/project/website-text.md.
   *
   * Greg, 2026-09-05: *"Add a /contact page and link to it appropriately. For
   * now it can be really brief."* Signed out for the same reason as `privacy`:
   * the person most likely to want an address is somebody who has not signed up
   * and has a question about whether to.
   */
  | { kind: "contact" }
  /**
   * Every release since launch, newest first — `/changelog`. See
   * ChangelogPage.tsx and docs/project/changelog.md.
   *
   * Signed out for the same reason as `privacy`, `features`, `pricing` and
   * `contact`: it is a page somebody is *sent* — a reader is more likely to
   * arrive from a link somebody shared than from browsing while signed in —
   * and it is about the product rather than about their account, so there is
   * nothing on it an account would change.
   */
  | { kind: "changelog" }
  /**
   * Where the code lives, and what it is licensed under — `/opensource`. See
   * OpenSourcePage.tsx.
   *
   * Greg, 2026-09-07: *"create a brief /opensource page in the footer with
   * links to/from various other pages, using GitHub logo to indicate."* Signed
   * out for the same reason as the four above it, and rather more so: the
   * person who wants to know whether they can read the code has, by definition,
   * not decided to trust us yet.
   */
  | { kind: "opensource" }
  /**
   * Where Google sends the reader back — `/auth/callback`. See AuthCallback.tsx.
   *
   * **The one route that must be exempt from every rewrite in main.tsx**, and
   * that is a security property rather than tidiness. `canonicalAddHref` reads
   * `location.search` as part of an article's address — its whole job — so a
   * return to `/add/…?code=C` would encode our one-time authorisation code
   * inside a stranger's URL, which ingest then fetches. Their access log, our
   * auth code. GPT Sol found it; docs/plans/260826w-auth-supabase.md has the diagram.
   */
  | { kind: "callback" }
  /**
   * **An address nobody minted** — `/asdf`, `/read/a/b`, `/privacy/cookies`.
   * See NotFoundPage.tsx, and docs/plans/260903j-not-found-page.md for the
   * decision it reverses.
   *
   * Every one of these was `library` until 2026-09-03, on the reasoning that a
   * mistyped address lands you somewhere useful. What that could not do is say
   * anything: a link that has rotted and a link that was never right both
   * showed the reader a plausible page at an address that means nothing.
   *
   * **It is not the same as "an address you may not use", and neither of those
   * became this.** `/admin` parses for everybody and App.tsx sends a
   * non-administrator to the shelf — a deliberate 403 posture rather than a
   * 404, because the page's code is there for anybody who asks and pretending
   * otherwise buys nothing ([docs/project/admin.md](../../docs/project/admin.md)).
   * A slug you do not own parses as `read`, and the server's answer lands on
   * `NotSharedPage`, which says what this page must not: something about a
   * document. `/admin/nonsense` *is* this, because that is an address rather
   * than a refusal.
   */
  | { kind: "not-found" };

/**
 * **Which pages are the administrator's, and it is a courtesy rather than a
 * gate.**
 *
 * Read once at the top of `SignedIn` (App.tsx): a signed-in reader who is not
 * the administrator gets the shelf at any address answering `true` here. Say
 * plainly what that is and is not:
 *
 * - **It hides nothing.** `AdminPage.tsx` and `DesignPage.tsx` are absent from
 *   the initial reader download since 2026-09-05 (LazyPage.tsx), but their
 *   chunks are public assets served to anyone who requests them, and
 *   vercel.json rewrites every non-`/api/` address to `index.html`, so these
 *   paths answer 200 to anybody. A reader who wants to see the design reference
 *   can still see it.
 * - **The only real refusal is the server's**, on the `/api/admin` namespace,
 *   above the route table in src/routes.ts. It would refuse a hand-written
 *   `fetch` from any of these pages just the same, and it would refuse
 *   identically if this file had never heard of an administrator.
 * - **`/design` has nothing behind it to refuse.** It reads no data at all, so
 *   there is no server half for it and none is wanted: it is on this list
 *   because it is developer furniture that every reader was being shown, not
 *   because it is privileged. docs/project/admin.md § The three refusals.
 *
 * **Why a map of every kind rather than a set of two.** The failure this
 * replaces is `/design` itself: it was moved onto the `/admin` index on
 * 2026-09-05 and the check stayed where it was, one `if` inside the `admin`
 * branch, because a per-branch check has to be *remembered*. That is the same
 * argument src/routes.ts makes for putting the server's check above the route
 * table. A `Record<Route["kind"], boolean>` is exhaustive, so adding a member to
 * the union above without answering the question here does not compile —
 * the next administrator's page joins the gate by editing a list, and
 * forgetting is not one of the available outcomes.
 *
 * What no mechanism can catch is answering it *wrongly* — writing `false` for a
 * page that should be `true`. That is a judgment, and it is why the entries are
 * a list somebody reviews rather than a rule somebody infers.
 */
const ADMIN_ONLY: Record<Route["kind"], boolean> = {
  library: false,
  read: false,
  "public-library": false,
  add: false,
  "add-upload": false,
  design: true,
  profile: false,
  login: false,
  admin: true,
  privacy: false,
  features: false,
  "public-sharing": false,
  pricing: false,
  contact: false,
  changelog: false,
  opensource: false,
  callback: false,
  "not-found": false,
};

/** Is this one of the administrator's pages? See `ADMIN_ONLY` above — cosmetic. */
export function adminOnly(route: Route): boolean {
  return ADMIN_ONLY[route.kind];
}

/**
 * The path segment for each view. `article` has none — the reading view is the
 * article's own address, not a page beside it.
 *
 * One map, read in both directions, so `parseRoute` and `readHref` cannot come
 * to disagree about how a view is spelled.
 */
const VIEW_SEGMENT: Record<ArticleView, string> = {
  article: "",
  metadata: "metadata",
  tweets: "tweets",
};

/**
 * `history.pushState` fires no event — that is the one thing it does not do.
 * `popstate` covers the back button and nothing else, so our own navigations
 * need a signal of their own or the page would not re-render until the reader
 * happened to press Back.
 */
const NAVIGATED = "spideryarn:navigated";

/**
 * Spelled once, because `parseRoute`, `addHref` and `addUrlFrom` all know it.
 *
 * Not exported: everything outside this file should be asking `addHref` where
 * an add goes, not building the path itself. See `addHref`.
 */
const ADD_PREFIX = "/add/";

/**
 * An upload id, in the shape `crypto.randomUUID` writes one.
 *
 * **Not `[0-9a-f-]{36}`**, which is the right length and the right alphabet and
 * matches thirty-six hyphens. That exact mistake was in `isStagingKey` in
 * src/source.ts and was found by a cross-family review; it was in this file two
 * weeks later, found by the next one. Neither was exploitable — the server
 * refuses the id either way — but the client rendered a whole ingest page for
 * an address that could never mean anything, and a guard that has stopped
 * describing what it guards is how the change after next becomes exploitable.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * Anything that isn't a route we minted is `not-found`, since 2026-09-03.
 *
 * **This reverses the rule this comment used to state.** It said: *"No 404
 * page, deliberately: a mistyped path lands you on the shelf, which is both a
 * useful place to be and self-explanatory."* Greg went to `/asdf`, got the
 * homepage, and asked where the 404 was — which is the answer to whether it was
 * self-explanatory. The shelf is a useful place to be and it is silent, so a
 * link that has rotted and a link that was never right both look like nothing
 * happened. docs/plans/260903j-not-found-page.md.
 *
 * That covers an unknown third segment too — `/read/foo/nonsense` is
 * `not-found`, exactly as `/nonsense` is, rather than an article page with a
 * blank middle.
 *
 * **Two things still fall through to the shelf, and both are answers rather
 * than shrugs:** the root, in its three spellings, and `/add` with nothing
 * after it — the shelf is where the add box is. Each is marked below. An
 * `/add/` that carries something unusable is neither: it stays an `add` route,
 * and `AddPage` says what is wrong with the address the reader typed.
 *
 * The trailing slash is optional at both lengths, because Greg wrote the routes
 * as `/read/[slug]/` and `/read/[slug]/metadata/` and a link that gains or
 * loses one should not stop working.
 */
export function parseRoute(pathname: string): Route {
  /* **The shelf, and it has to be said out loud now.** It was the fall-through
     until 2026-09-03, so the root had never needed a branch of its own — and
     the moment the fall-through became `not-found`, `/` would have become a 404
     with nothing in the file to notice. The empty string is here for the same
     reason: `parseRoute("")` is what a caller passes when it has no address,
     and it means the same thing as `/`.

     **`/index.html` is the third spelling of the root**, and it is here because
     of what it is rather than because anything links to it: it is the file this
     whole app is, served under its own name by Vite and by every static host,
     so a reader who reaches it is at the front door however they got there.
     Nothing in the app writes it and the manifest starts at `/`, so it had been
     the shelf only by accident of the fall-through — GPT Sol found it about to
     go the other way, 2026-09-03. An app that 404s its own entry point is a bug
     report nobody should have to file. */
  if (pathname === "/" || pathname === "" || pathname === "/index.html") {
    return { kind: "library" };
  }
  // Not under /read/, because it is not about an article. It is the one page in
  // the app with no data behind it at all.
  if (/^\/design\/?$/.test(pathname)) return { kind: "design" };
  /* **The addresses that are just themselves**, matched in order against one
     table rather than as eight near-identical `if`s.

     They were eight lines of `if (new RegExp(\`^${'${X}'}/?$\`)…) return { kind: … }`,
     which is a shape that says nothing eight times. Adding
     `/features/public-readable-sharing` as a ninth took `parseRoute` over
     Biome's cognitive-complexity ceiling (26, max 25) — a file that had been
     clean — and the honest fix is the one that removes branches rather than the
     one that silences the rule.

     **Order is still the whole contract**, and it is now the array's order:
     `callback` first because nothing may reinterpret it, and
     `public-readable-sharing` above `features` because the specific arm goes
     above the general one. That ordering is a habit rather than a necessity —
     every pattern here is anchored `/?$`, so `/features` cannot swallow its
     child today — but it is the habit that keeps `/read/public` working above
     `/read/:slug`, and this is the app's only nested pair.

     `STATIC_ROUTES` is `readonly` and typed by its entries, so a kind that is
     not a no-payload member of `Route` is a compile error rather than a route
     that never matches. */
  for (const [href, kind] of STATIC_ROUTES) {
    if (new RegExp(`^${href}/?$`).test(pathname)) return { kind };
  }
  /* Beside `design` and `profile`, and above `/read/` for the same reason: it
     is not about an article. The alternation is the validation — `/admin/foo`
     matches nothing here and falls through to `not-found`, which is what every
     unrecognised address does. Greg wrote both of these with a trailing slash,
     so both spellings work at both lengths. */
  const adminPath = /^\/admin(?:\/(users|feedback))?\/?$/.exec(pathname);
  if (adminPath) {
    /* The captured segment *is* the page name for every page but the index,
       which has no segment. Written as a lookup rather than a chain of
       ternaries so that adding the next one is an edit to the alternation and
       nothing else — a chain is where the fourth page ends up silently reading
       as `home`. */
    const page = adminPath[1];
    return {
      kind: "admin",
      page: page === "users" || page === "feedback" ? page : "home",
    };
  }
  // Before the /read/ regex, and it cannot use one: what follows /add/ is a
  // whole other URL, slashes and all. A bare /add — nothing to add — falls
  // through to the shelf, which is where the add box is.
  /* **Above the general `/add/` branch**, because that one reads everything
     after the prefix as a whole URL, and `upload/<uuid>` is not one — it would
     fall through `normaliseUrl` to `""` and land the reader on the shelf with
     their file already in the object store and nothing pointing at it. The
     match is exact: a real upload id or nothing. */
  const uploaded = new RegExp(
    `^${ADD_PREFIX}upload/(${UUID.source})/?$`,
    "i",
  ).exec(pathname);
  if (uploaded) return { kind: "add-upload", uploadId: (uploaded[1] as string).toLowerCase() };
  /* **`/add` without the slash is named here**, and it used to be free. It does
     not start with `ADD_PREFIX`, so it reached the fall-through and got the
     shelf along with every other unmatched address — which stopped being the
     same answer on 2026-09-03. Its own test says where it goes and why, so this
     is the branch that keeps that true rather than a new behaviour. */
  if (pathname === "/add" || pathname.startsWith(ADD_PREFIX)) {
    const url = addUrlFrom(pathname);
    if (url) return { kind: "add", url };
    /* **The shelf, not `not-found`**, and the only survivor of that change
       besides the root. A bare `/add` is not a mistyped address, it is an
       address with nothing in it yet — and the shelf is where the add box is,
       so the reader lands on the thing they were reaching for.

       **This is only reached when the segment is empty**, which is `/add` and
       `/add/` and nothing else: `addUrlFrom` hands back whatever follows the
       prefix without judging it, so `/add/not a url` is an `add` route and
       `AddPage` says *that isn't a web address we can fetch* over the thing the
       reader actually typed. That is a better answer than either of ours, and
       it is why this branch is not the general "the add address was no good"
       case. GPT Sol's review, 2026-09-03, where the claim that it was is the
       finding. */
    return { kind: "library" };
  }
  /* **Before the article regex, which would otherwise swallow it.** `public` is
     a legal slug shape, so `/read/public` matches `/read/([^/]+)` and would be
     read as an article — asked for over the wire, refused, and shown as *this
     document is not shared*, which is a claim about a document that does not
     exist. The reservation in `isReservedSlug` (src/ingest.ts) is what stops one
     ever existing; this is the half that gives the address its own meaning.

     `PUBLIC_LIBRARY_HREF` rather than the literal, so the constant that names
     the reserved slug and the constant that spells the route are one value —
     and the edge asks the same `PUBLIC_LIBRARY_SLUG`. */
  if (new RegExp(`^${PUBLIC_LIBRARY_HREF}/?$`).test(pathname)) return { kind: "public-library" };
  const m = /^\/read\/([^/]+)(?:\/(metadata|tweets))?\/?$/.exec(pathname);
  if (!m) return { kind: "not-found" };
  // A malformed escape would throw out of decodeURIComponent and take the whole
  // render with it, over a hand-mangled address bar.
  let slug: string;
  try {
    slug = decodeURIComponent(m[1] ?? "");
  } catch {
    return { kind: "not-found" };
  }
  /* **The same `isSlug` the server uses**, and not merely "is it non-empty".
     `/read/Upper` used to become an article route: the client would ask for it,
     the API would refuse it with the 400 it gives every malformed slug, and the
     reader would get an error page. An address the server can never answer is a
     mistyped address — GPT Sol's stage 2 design § 5 — and that premise is
     unchanged; what changed on 2026-09-03 is where a mistyped address goes.
     `src/ingest.ts` is an approved shared import (tests/client-imports.test.ts),
     so both sides ask one function rather than two regexes drifting apart.

     **The edge refuses it too, independently.** `/read/:slug` is rewritten to
     the serverless function, and `decidePublicPage` (src/public/page.ts)
     answers 400 for a malformed slug. Not the *same* verdict — that one says
     the request was malformed, this one says there is nothing here to read —
     but two refusals rather than the client papering over a server that would
     have served it. */
  if (!isSlug(slug)) return { kind: "not-found" };
  // The alternation in the regex is the validation: anything that reached here
  // is a known segment or nothing at all.
  const view = (m[2] ?? "article") as ArticleView;
  return { kind: "read", slug, view };
}

/**
 * Where an article lives — **the only place the shape of that path is spelled**.
 *
 * `search` carries view state and is optional; `view` picks which of the three
 * pages and defaults to the reading view, so every existing caller means what
 * it always meant. Extended rather than joined by a second `metadataHref` on
 * purpose: two functions that both know the `/read/` prefix is how a rename
 * breaks half the links in the app and none of the tests.
 */
export function readHref(slug: string, search = "", view: ArticleView = "article"): string {
  const query = search && !search.startsWith("?") ? `?${search}` : search;
  const segment = VIEW_SEGMENT[view];
  return `/read/${encodeURIComponent(slug)}${segment ? `/${segment}` : ""}${query}`;
}

/**
 * The query string worth carrying from one view of an article to another.
 *
 * Leaving the article to look at its metadata and coming back must not lose the
 * reader their place, so `?at=`, `?cols=` and `?text=` travel both ways.
 * `?panel=` is the exception: it names a drawer, and a drawer left open across
 * a navigation is not a place you were, it is a thing you had finished with.
 *
 * Edited as text rather than through `URLSearchParams` for the same reason the
 * rewrites in main.tsx are: a round trip re-encodes `?cols=0,1` into
 * `?cols=0%2C1`, which is still correct, still parses the same, and no longer
 * readable by the person you sent the link to (params.ts).
 */
export function carriedSearch(search: string): string {
  return search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "" && !pair.startsWith("panel="))
    .join("&");
}

export const LIBRARY_HREF = "/";
/**
 * The administrator's index, and the one page under it.
 *
 * Constants rather than strings at the call sites for the reason `CALLBACK_HREF`
 * below is one: the regex in `parseRoute` and the `href` on a link are the two
 * halves of the same fact, and a link that does not parse is a link that goes
 * to the 404 page. Louder than it used to be — it landed quietly on the shelf
 * until 2026-09-03 — but a broken link is still a broken link, and the constant
 * is what stops there being one.
 */
export const ADMIN_HREF = "/admin";
export const ADMIN_USERS_HREF = "/admin/users";
export const ADMIN_FEEDBACK_HREF = "/admin/feedback";
export const DESIGN_HREF = "/design";
export const LOGIN_HREF = "/login";
/**
 * The reader's own page — the profile box, the plan, the settings.
 *
 * A constant for the same reason `ADMIN_HREF` is one, and it earned it: the
 * string was written out at three call sites before the quota's refusal copy
 * needed a fourth (`QuotaNotice` in QuotaNotice.tsx), which is the point at
 * which a typo stops being a broken link and starts being a reader who has just
 * been refused an article and cannot reach the page that would let them do
 * anything about it. Since 2026-09-03 they would at least be told — that is the
 * 404 page — which makes the typo visible rather than harmless.
 */
export const PROFILE_HREF = "/profile";
/**
 * The privacy policy. Linked from the landing page's footer and from
 * `/profile`, so both a stranger and a reader can find it.
 */
export const PRIVACY_HREF = "/privacy";
/**
 * **The takedown route, which is a section on that page rather than a page.**
 *
 * Spideryarn republishes the extracted text of somebody else's article, and
 * since `/read/public` those articles are findable rather than merely
 * reachable. The owner's tick-box is a promise they make, not a check we run, so
 * the other half of the protection is a way for the wronged party to complain —
 * docs/project/privacy.md § If something here is yours, and the argument for a
 * section over a route is beside the section in PrivacyPage.tsx.
 *
 * **The id and the address are one constant**, deliberately: two string
 * literals in two files is a link that lands at the top of a long policy and
 * tells nobody it missed. `PrivacyPage` puts this on the section and scrolls it
 * into view when the fragment names it, because `navigate` below scrolls to the
 * top on every navigation and a client-rendered page has nothing for a browser
 * to find on a cold load either. tests/takedown-privacy-section.test.tsx.
 */
export const TAKEDOWN_SECTION_ID = "if-something-here-is-yours";
/** Where the two visitor surfaces send somebody who needs it. */
export const TAKEDOWN_HREF = `${PRIVACY_HREF}#${TAKEDOWN_SECTION_ID}`;
/**
 * The features page. Linked from the landing page, where the short list ends
 * with "everything it does, with pictures".
 */
export const FEATURES_HREF = "/features";
/**
 * **What we do with an article somebody has made public** — the single place
 * those claims are written, and the one address on this site aimed at somebody
 * who did not choose to be here.
 *
 * Greg, 2026-09-06, picked this address over a top-level `/republishing`, which
 * was argued for on the ground that `/features` sells the product and a
 * rights-holder should not be told their article is a feature of it. His call,
 * and the consequence is that the page has to read correctly to **two** people:
 * an owner deciding whether to share, and an author who found their own writing
 * on `/read/public`.
 *
 * Built from `FEATURES_HREF` rather than spelled out, so the pair cannot come
 * apart if `/features` ever moves. docs/project/public-readable-sharing.md.
 */
export const PUBLIC_SHARING_HREF = `${FEATURES_HREF}/public-readable-sharing`;
/**
 * The pricing page. Linked from the landing page's footer and from beside the
 * plans table there, which is the same three rows: `/pricing` exists so there is
 * an address to send somebody, not because the numbers live anywhere new.
 */
export const PRICING_HREF = "/pricing";
/**
 * How to reach us — linked from the footer row, which every page a reader lands
 * on and reads carries (SiteFooter.tsx).
 *
 * The page is four sentences and one of them is the address, which is already a
 * `mailto:` in that same row. It exists anyway because *"contact us"* is a thing
 * people look for by name, and because the address is not the answer we want
 * first: the Feedback button is. ContactPage.tsx.
 */
export const CONTACT_HREF = "/contact";
/**
 * Every release since launch — linked from the footer, where it is labelled
 * "What's new" rather than "Changelog", the internal name for the process
 * that writes it (docs/project/changelog.md).
 */
export const CHANGELOG_HREF = "/changelog";
/**
 * The repository, the licence, and how to work on it — linked from the footer
 * under the GitHub mark, and from `/changelog`, which points at that repository
 * on every release.
 *
 * One word rather than two: Greg named it `/opensource`, and a hyphen is the
 * kind of thing somebody types wrong when they are repeating an address aloud.
 * OpenSourcePage.tsx.
 */
export const OPENSOURCE_HREF = "/opensource";
/**
 * The shelf of public articles.
 *
 * **Built from `PUBLIC_LIBRARY_SLUG`, not typed out**, and that is the point of
 * it: the same constant is what `isReservedSlug` refuses at the allocation seam
 * and what `decidePublicPage` matches at the edge, so the address, the
 * reservation and the edge branch cannot come apart. A second spelling here
 * would be a route the reservation had stopped protecting, and nothing would
 * say so until an article turned up wearing the name.
 */
export const PUBLIC_LIBRARY_HREF = `/read/${PUBLIC_LIBRARY_SLUG}`;
/**
 * Spelled once, and read by both `parseRoute` above and main.tsx's rewrite
 * exemption.
 *
 * Two copies of this string is how the exemption comes to disagree with the
 * route, and the failure mode is not a broken link — it is an OAuth code folded
 * into an article URL. lib/supabase.ts builds the absolute form from it.
 */
export const CALLBACK_HREF = "/auth/callback";

/**
 * **A `Route` kind whose member carries nothing but the kind itself.**
 *
 * Computed rather than listed, and that is the point: `read` needs a slug,
 * `admin` needs a page, `add` needs a URL, so none of them can be built from a
 * bare `{ kind }` — and each is excluded here *because of its own shape*, not
 * because somebody remembered to leave it out. Give `read` a default slug one
 * day and it becomes eligible automatically; add a payload to `pricing` and the
 * table below stops compiling. That is the difference between this and a
 * hand-written union, which would go on compiling while meaning the wrong
 * thing (AGENTS.md § Let the types catch it).
 */
type BareRouteKind = {
  [K in Route["kind"]]: keyof Extract<Route, { kind: K }> extends "kind" ? K : never;
}[Route["kind"]];

/**
 * **Every address that is exactly itself, in the order they are tried.**
 *
 * See the loop in `parseRoute` for why this is a table: the entries were eight
 * identical `if`s, and the ninth took the function over the complexity ceiling.
 *
 * **Not sorted, and not to be sorted.** Order is the contract — see the loop.
 */
const STATIC_ROUTES: readonly (readonly [string, BareRouteKind])[] = [
  /* Above everything else, because the whole point of this address is that
     nothing may reinterpret it. See the `callback` variant above. */
  [CALLBACK_HREF, "callback"],
  [LOGIN_HREF, "login"],
  // Beside `design` and above `/read/` for the same reason: it is not about an
  // article, so the article regex must never get a chance at it.
  [PROFILE_HREF, "profile"],
  // Beside `design` and `profile`, and for the same reason. Above `/read/`
  // because it is not about an article, and above the sign-in gate in App.tsx
  // because it is not about being signed in either.
  [PRIVACY_HREF, "privacy"],
  // The specific arm above the general one — see the loop.
  [PUBLIC_SHARING_HREF, "public-sharing"],
  [FEATURES_HREF, "features"],
  [PRICING_HREF, "pricing"],
  [CONTACT_HREF, "contact"],
  /* Landed as an `if` of its own the same day this table replaced the eight it
     was written beside, so it joins here rather than there. Order is
     indifferent to it: `/changelog` is top level and shares a prefix with
     nothing. */
  [CHANGELOG_HREF, "changelog"],
  /* Same shape as `/changelog` above, and indifferent to order for the same
     reason: top level, sharing a prefix with nothing. */
  [OPENSOURCE_HREF, "opensource"],
] as const;

/**
 * The canonical address for "add this URL": `/add/<the URL, percent-encoded>`.
 *
 * **Encoded, even though a raw paste also works.** Greg asked for an address he
 * could type by hand — `/add/https://example.com/an-essay` — and that is what
 * `addUrlFrom` accepts. But an address the *app* generates has to survive being
 * re-parsed, and a raw URL does not: the browser splits its `?a=1` off into
 * `location.search`, where it is indistinguishable from one of our own view
 * parameters. Encoding puts the whole thing in one path segment, where nothing
 * can take a bite out of it.
 *
 * So the two spellings are not equals. The raw one is an *entrance*, rewritten
 * to this one by main.tsx before React mounts — the same trick the three legacy
 * rewrites there use, and for the same reason: one spelling reaches React.
 */
/** Where an upload's ingest lives. The only place this path is spelled. */
export function addUploadHref(uploadId: string): string {
  return `${ADD_PREFIX}upload/${encodeURIComponent(uploadId)}`;
}

export function addHref(url: string): string {
  return `${ADD_PREFIX}${encodeURIComponent(url.trim())}`;
}

/**
 * The URL an `/add/…` address is carrying, in either spelling.
 *
 * Called two ways, which is why `search` and `hash` are arguments rather than
 * reads of `location`:
 *
 *  - `parseRoute(pathname)` — after main.tsx has canonicalised, so the segment
 *    is percent-encoded and there is nothing in the query string to collect.
 *  - main.tsx, with the whole of `location` — a raw paste, whose query string
 *    and fragment belong to the *pasted* URL and have to be put back on.
 *
 * Telling the two apart is one test and it is exact rather than heuristic:
 * `encodeURIComponent` escapes both `:` and `/`, so a canonical segment can
 * contain neither, and every URL worth adding contains both.
 *
 * Returns `""` for `/add/` with nothing after it, which `parseRoute` reads as
 * "go to the shelf". **Anything non-empty is handed back unjudged** — this
 * function does not ask whether it is a URL, and `AddPage` is what tells the
 * reader it is not.
 */
export function addUrlFrom(pathname: string, search = "", hash = ""): string {
  if (!pathname.startsWith(ADD_PREFIX)) return "";
  const segment = pathname.slice(ADD_PREFIX.length);
  if (segment === "") return "";
  /* **The query string and fragment are always put back, whichever spelling
     the segment is in.** They can only have come from the pasted URL —
     `encodeURIComponent` escapes `?` and `#`, so a canonical address has
     neither — and the two mistakes here were both about that. Dropping them
     lost `?edition=2` from `/add/example.com?edition=2`, which is a different
     article added silently. Then reading their mere presence as proof the
     segment was raw double-encoded `/add/https%3A%2F%2Fx.test%2Fa?edition=2`
     into something that is not a URL at all. Both from GPT Sol, 2026-08-26. */
  return (looksRaw(segment) ? segment : safeDecode(segment)) + search + hash;
}

/**
 * A URL somebody typed, rather than one `addHref` wrote.
 *
 * Exact rather than heuristic: `encodeURIComponent` escapes both `:` and `/`,
 * so a canonical segment can contain neither, and every URL with a scheme or a
 * path contains at least one. The case it cannot decide alone is a bare host —
 * `example.com` — where both readings give the same answer anyway.
 */
function looksRaw(value: string): boolean {
  return value.includes(":") || value.includes("/");
}

/** A hand-mangled escape throws, and this runs during a render. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The URL in a `?add=` query, which is Greg's second spelling.
 *
 * **Read out of the raw query text, not through `URLSearchParams`**, and both
 * of the reasons are bugs the obvious version had (GPT Sol, 2026-08-26):
 * `URLSearchParams` decodes `+` as a space, so `?add=https://x.test/a+b` asked
 * for a URL with a space in it; and it stops a value at the next `&`, so
 * `?add=https://x.test/a?x=1&y=2` quietly dropped `y=2` and added a different
 * page.
 *
 * So **`add=` takes the rest of the query string**, however many `&`s and `?`s
 * are in it. That is the only rule under which an unencoded URL can survive
 * being a query parameter, and it costs nothing: there is no other parameter
 * that means anything on this route.
 */
export function addUrlFromQuery(search: string): string {
  /* Anchored to a real parameter boundary — the start, or an `&`. `[?&]` also
     matched the `?` *inside* a value, so `?next=/somewhere?add=x` was read as
     an add request. Only the first `?` in a URL begins its query. */
  const m = /(?:^[?]?|&)add=(.*)$/.exec(search);
  const value = m?.[1] ?? "";
  if (value === "") return "";
  return looksRaw(value) ? value : safeDecode(value);
}

/**
 * Where an `/add/…` or `?add=…` address should really be, or `null` if it is
 * already there (or is not one at all).
 *
 * Pulled out of main.tsx so the rewrite can be tested as a pure function rather
 * than as a side effect of loading a module — which is what let three of its
 * failure modes go unnoticed until GPT Sol read it. See
 * [`tests/router.test.ts`](../../tests/router.test.ts).
 */
export function canonicalAddHref(pathname: string, search: string, hash: string): string | null {
  /* **An upload address is already canonical, and rewriting it destroys it.**
     `/add/upload/<uuid>` is not an address to fetch, but it lives under the
     same prefix — so `addUrlFrom` read it as the URL `upload/<uuid>`, `addHref`
     percent-encoded the slash, and the reader's reload landed on
     `/add/upload%2F<uuid>`, which matches nothing and rendered "That isn't a
     web address we can fetch". So the page the whole feature navigates to could
     not be reloaded, which is most of the reason it has an address at all.

     Found in a browser, 2026-08-27, and only findable there: every unit test
     passes, because this rewrite is something main.tsx does on load rather than
     anything `parseRoute` decides. The guard is `parseRoute` itself rather than
     a second copy of the pattern — two places knowing what an upload address
     looks like is how they come to disagree. */
  if (parseRoute(pathname).kind === "add-upload") return null;
  /* **The path is asked first, and the order is the whole of this line's
     content.** With `?add=` consulted first, `/add/https://x.test/article?add=2`
     canonicalised to `/add/2`: the target URL's *own* `add` parameter was read
     as ours and replaced it. And since this now runs before every other rewrite
     in main.tsx, nothing downstream could have repaired it. GPT Sol, 2026-08-26. */
  const fromPath = addUrlFrom(pathname, search, hash);
  /* **`?add=` is read on the root and nowhere else**, which is what
     docs/project/url-state.md has always described it as: `/?add=<url>`, from
     the days when everything was a parameter on one page. Unconstrained it also
     fired on `/read/a?add=…`, and that is a divergence rather than a
     convenience: `/read/a` with a query is one path segment, so the server
     composes *article a's* title for it (src/read-address.ts), and the client
     then navigates to an add page instead. Sixth of these, GPT Sol 2026-08-30.
     The path form is untouched — `/add/<url>` is canonical wherever it appears. */
  const url = fromPath !== "" ? fromPath : pathname === "/" ? addUrlFromQuery(search) : "";
  if (url === "") return null;
  const href = addHref(url);
  return href === pathname + search + hash ? null : href;
}

/**
 * **Every rewrite the app does before React mounts, as one pure function.**
 *
 * `main.tsx` used to do these as four separate `history.replaceState` calls at
 * module scope — side effects nothing can call, which is why *interactions*
 * between them were invisible. Each one had tests; the sequence had none. GPT
 * Sol found the consequence on 2026-08-30, at the fourth time of asking:
 *
 *     /read/a?%61bout=1#spya-k3m9qt
 *
 * The hash rewrite went through `new URL()` and `searchParams.set()`, which
 * **reserialises the whole query** — so `%61bout=1` became `about=1`, and the
 * metadata rewrite two steps later then fired on a parameter that had not been
 * there when the server read the same address. Server said article, client went
 * to the metadata page. Neither rewrite is wrong on its own, and no per-rewrite
 * test could have seen it.
 *
 * Two things follow, and both are the point of this function existing:
 *
 *  - **The query is edited as text throughout.** That was already this file's
 *    rule for `?slug=` and `about=` — round-tripping re-encodes as it
 *    serialises, and `?cols=0,1` comes back as `?cols=0%2C1`, still correct and
 *    no longer readable. The hash rewrite was the one that broke the rule, and
 *    it was mangling those commas too.
 *  - **One guard instead of four.** `/auth/callback` is exempt from all of this
 *    (see main.tsx), and it used to be exempt four times over, which meant the
 *    person adding a fifth rewrite had to remember. Now there is one call site
 *    to guard, and a rewrite added inside here is guarded by construction.
 *
 * The order is the order main.tsx had, and it is load-bearing: canonicalising
 * an `/add/` address first leaves something none of the other three can match.
 *
 * @returns the address to `replaceState` to, or `null` if it is already right.
 */
export function settleAddress(pathname: string, search: string, hash: string): string | null {
  const was = `${pathname}${search}${hash}`;
  let at = { pathname, search, hash };

  const canonical = canonicalAddHref(at.pathname, at.search, at.hash);
  if (canonical !== null) at = splitHref(canonical);

  at = liftLegacyAnchor(at);
  at = liftLegacySlug(at);
  at = liftLegacyAbout(at);
  /* **Last, and both halves of that are deliberate.**
     *After* `canonicalAddHref`, because an `/add/` address's query belongs to
     the URL being added — `addUrlFrom` puts it straight back onto it — so
     dropping a pair before canonicalisation adds a different article. Once that
     has run, the query has been folded into the encoded segment and there is
     nothing here to touch. *Last of all* rather than merely after it, because
     the three lifts above each rebuild `search` (the anchor lift appends `at=`;
     the other two move the query onto a different path), and this way there is
     one shape of query to reason about instead of four. Nothing below it can be
     affected either, because unlike the other four this rewrite never changes
     which page you land on. */
  at = liftStrandedText(at);

  const href = `${at.pathname}${at.search}${at.hash}`;
  return href === was ? null : href;
}

/** An address in the three pieces `location` gives them in, prefixes included. */
interface Address {
  pathname: string;
  search: string;
  hash: string;
}

/** `/a/b?c=d#e` back into its three parts, with their prefixes kept. */
function splitHref(href: string): Address {
  const hashAt = href.indexOf("#");
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const rest = hashAt === -1 ? href : href.slice(0, hashAt);
  const queryAt = rest.indexOf("?");
  return {
    pathname: queryAt === -1 ? rest : rest.slice(0, queryAt),
    search: queryAt === -1 ? "" : rest.slice(queryAt),
    hash,
  };
}

/**
 * **Does this pair name that parameter, however it is spelled?**
 *
 * `?%61t=…` is `?at=…`: `URLSearchParams` percent-decodes keys, so it reads them
 * as the same parameter — and a textual filter for `at=` does not. Removing only
 * the literal spelling left both in the query, and the reader got the **stale**
 * one, because `get("at")` returns the first match. So the fragment lost to a
 * position it was supposed to override. GPT Sol, 2026-08-30; the ninth address
 * bug and the second of this exact shape.
 *
 * The key is decoded to decide, and the pair is then dropped or kept **whole**,
 * so everything that stays is byte-for-byte what was written. A malformed escape
 * cannot be a match for a plain name, and it must not throw here either.
 */
function hasKey(pair: string, name: string): boolean {
  const key = pair.split("=")[0] ?? "";
  if (key === name) return true;
  try {
    return decodeURIComponent(key) === name;
  } catch {
    return false;
  }
}

/**
 * One parameter dropped, every other pair kept **exactly as it was written**.
 *
 * "Every other pair" rather than "everything": `withoutPairs` also drops empty
 * ones, so a trailing or doubled `&` does not survive. That is what makes
 * `blockHref` able to append `&at=…` without checking, and it is a difference
 * from the input, so it is said here rather than implied.
 *
 * The public form of the pair below, for callers who are rebuilding an address
 * around a parameter of their own — `blockHref` in BlockRef.ts, which drops
 * `at` because it is about to write its own. They get `hasKey`'s scar for free,
 * which is the point of exporting this rather than letting the next caller
 * write `filter(p => !p.startsWith("at="))` and rediscover `?%61t=`.
 *
 * No leading `?` on the way in or out.
 */
export function searchWithout(search: string, name: string): string {
  return withoutPairs(search, (pair) => hasKey(pair, name));
}

/**
 * Drop the pairs a rewrite is consuming, and keep every other one **exactly as
 * it was written**. Text, never `URLSearchParams` — see `settleAddress`.
 */
function withoutPairs(search: string, drop: (pair: string) => boolean): string {
  return search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "" && !drop(pair))
    .join("&");
}

/**
 * `/#spya-k6fpme` → `?at=spya-k6fpme`. Deep links used to be fragments;
 * position now lives in `?at=`.
 *
 * **The hash beats an `?at=` that came with it.** The article's own internal
 * links are `#spya-…`, so ⌘-clicking one opens `?at=<where you were>#<where you
 * asked to go>` — two positions in one address. `?at=` is where the reader
 * happened to be; a fragment is where they asked to go.
 *
 * `decodeURIComponent` throws on a malformed escape like `#%zz`, and a throw at
 * module scope takes the whole bundle down over a deep link. There is simply no
 * legacy anchor in that case.
 */
function liftLegacyAnchor(at: Address): Address {
  let anchor: string;
  try {
    anchor = decodeURIComponent(at.hash.slice(1));
  } catch {
    return at;
  }
  if (!isSpideryarnId(anchor)) return at;
  const rest = withoutPairs(at.search, (pair) => hasKey(pair, "at"));
  return { pathname: at.pathname, search: `?${rest ? `${rest}&` : ""}at=${anchor}`, hash: "" };
}

/**
 * `/?slug=x` → `/read/x`, **on the root and nowhere else**.
 *
 * The old address was `/?slug=…`, from when the slug was a parameter on the one
 * page there was — never `/read/a?slug=b`, which is a contradiction nobody ever
 * produced. Unconstrained it fired there anyway, and the server had already
 * composed article *a*'s title for it. GPT Sol, 2026-08-30.
 *
 * **The fragment is carried across, which the old inline version did not do.**
 * It dropped it; the `about=` rewrite beside it kept it. That reads as two
 * rewrites written at different times rather than as a decision, and keeping it
 * is the better of the two — a fragment the reader wrote should not vanish
 * because their link used an old spelling. Only a fragment that is *not* a block
 * id is affected, because `liftLegacyAnchor` runs first and consumes those.
 */
function liftLegacySlug(at: Address): Address {
  if (at.pathname !== "/") return at;
  const slug = new URLSearchParams(at.search).get("slug");
  if (!slug) return at;
  /* `URLSearchParams.get` above decoded the key to find it, so the removal has
     to decode too, or `?%73lug=x` is read and then left behind. */
  const rest = withoutPairs(at.search, (pair) => hasKey(pair, "slug"));
  return { ...splitHref(readHref(slug, rest)), hash: at.hash };
}

/**
 * `?about=1` and `?panel=about` → `/read/<slug>/metadata`. The article's details
 * were in the masthead, then a drawer, and are now a page.
 *
 * `about=0` is stripped but does **not** redirect: it meant the panel was shut,
 * and a shut panel is not a reason to send anybody to a different page.
 * `redirectsToMetadata` in src/read-address.ts is the predicate, shared with the
 * server, which has to predict this to compose the right `<title>`.
 */
function liftLegacyAbout(at: Address): Address {
  /* **Deciding and removing are the same function**, `isLegacyAboutPair`, which
     the server also reaches through `redirectsToMetadata`. That is the whole
     lesson of the ninth bug: a decoding decision paired with a literal removal
     leaves a parameter in the query that one side acts on and the other has
     never seen. There is now no second spelling of the question. */
  if (!queryPairs(at.search).some(isLegacyAboutPair)) return at;
  const rest = withoutPairs(at.search, isLegacyAboutPair);
  const route = parseRoute(at.pathname);
  if (redirectsToMetadata(at.search) && route.kind === "read") {
    return { ...splitHref(readHref(route.slug, rest, "metadata")), hash: at.hash };
  }
  return { pathname: at.pathname, search: rest ? `?${rest}` : "", hash: at.hash };
}

/**
 * **`?mode=hierarchy&text=0` → `?mode=outline`, and the `text` pair goes
 * whatever the mode was.**
 *
 * The `Text` pill was the only way back to the prose, and it went with the rest
 * of the controls bar on 2026-09-05 — so an old `?mode=hierarchy&text=0` link is
 * a table with the article hidden and nothing on screen that puts it back. This
 * is the fifth of these rewrites and the first that is about a state the app
 * used to be able to leave.
 *
 * **Outline, and the argument is not the obvious one.** Neither destination
 * restores the no-prose state — `proseVisible` is `modeBand || showText`, so a
 * mode band always shows the article — which means "honour what they asked for"
 * cannot decide it. What decides it is that **the reader who saved that link was
 * looking at a bar that said OUTLINE**: the old `reading`/`outline` chip flipped
 * to `outline` whenever `text=0` was on, granularity-zoom.md calls the compact
 * table "outline mode" throughout, and TableView still classes it `zoom outline`.
 * So Outline is the name that reader already associates with what they
 * bookmarked, and a nested list that expands around them beats a table whose
 * rows are separated by thousands of pixels of the prose it just put back.
 * Arbitrated by Fable, 2026-09-05.
 *
 * **The unconditional half looks like tidying an inert parameter and is not.**
 * `text=0` bites only in Hierarchy (`inMode` is `mode !== "hierarchy"`), so a
 * bare `?text=0` lands harmlessly in Plain — and then strands the reader the
 * moment they press Hierarchy on the Dock, because the parameter is still in the
 * URL. Dropping it is defusing something with a delay on it.
 *
 * Everything else is carried through byte for byte, `?cols=0,1` included: a
 * stale column set is dead weight in Outline and harmless, where reserialising
 * it would turn those commas into `%2C`. The mode is rewritten **in place**, so
 * the order the reader's link was written in survives too — and only the
 * **first** `mode` pair, because that is the one every reader of this query
 * gets back (`URLSearchParams.get` returns the first match, and so does nuqs).
 * A duplicate further along is somebody else's already-ignored pair, and
 * rewriting it would both be a lie and produce `?mode=outline&mode=outline`.
 *
 * The server predicts all of this — `readMode` in src/read-address.ts — or the
 * tab would say Hierarchy and then say Outline a second later, which is the
 * whole subject of docs/project/page-titles.md.
 */
function liftStrandedText(at: Address): Address {
  /* **Two questions, and they are not the same one.** *Is there anything to
     remove* is `.some()`: every `text=0` in the query goes, first or fortieth,
     because an inert one left behind is the landmine this rewrite exists to
     defuse. *Is the reader stranded* is `hidesProse`, which asks only the
     first `text` pair — the one nuqs actually reads. `?text=1&text=0` is
     therefore tidied without anybody being moved out of Hierarchy. Conflating
     the two was GPT Sol's F2 on this stage, 2026-09-05. */
  if (!queryPairs(at.search).some(isTextOffPair)) return at;
  /* `hasKey` below rather than `pair.startsWith("mode=")`, and this read decodes
     the key too — so `?%6dode=hierarchy` is answered the same way by the
     decision and by the edit. A decoding decision paired with a literal removal
     is the ninth address bug's whole shape. */
  let stranded =
    new URLSearchParams(at.search).get("mode") === "hierarchy" && hidesProse(at.search);
  const kept = withoutPairs(at.search, isTextOffPair)
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      if (!stranded || !hasKey(pair, "mode")) return pair;
      stranded = false;
      return "mode=outline";
    })
    .join("&");
  return { pathname: at.pathname, search: kept ? `?${kept}` : "", hash: at.hash };
}

/**
 * Go somewhere, without a page load.
 *
 * Scrolls to the top, because `history.scrollRestoration` is `manual` (see
 * main.tsx) so nobody else will — and arriving at a new page halfway down it is
 * the sort of thing that reads as a rendering bug. The reading view immediately
 * overrides this if the link carried an `?at=`, which is the one case where
 * landing partway down is right.
 */
export function navigate(href: string, options: { replace?: boolean } = {}): void {
  if (href === location.pathname + location.search) return;
  // nuqs's patched pushState/replaceState notices the new query string and
  // updates every useQueryState from it, so navigation and view state stay in
  // step without us telling it anything.
  /* `watchHistoryWrites` fires NAVIGATED for us when it is installed, so the
     explicit dispatch below is skipped then — otherwise every `navigate()`
     notified every subscriber twice. A string snapshot means the second one
     commits nothing, but they still all run. It stays for the case where the
     patch is not installed: a test, or any entry point that is not main.tsx.
     GPT Sol, 2026-09-04. */
  if (options.replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  if (!historyWatched) window.dispatchEvent(new Event(NAVIGATED));
  window.scrollTo({ top: 0 });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATED, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATED, onChange);
  };
}

/**
 * The same subscription `useAddress` uses, for a caller that wants to **hear**
 * the address change without **re-rendering** when it does.
 *
 * There is exactly one such caller — `useLastView` in last-view.ts, which
 * copies the query string into `localStorage` — and the distinction is the
 * whole reason this is exported. `?at=` is rewritten about once a second while
 * anybody scrolls, so a `useAddress()` high in the reading view would re-render
 * the entire article on every one of those; the staleness work of 2026-09-04
 * (§ `watchHistoryWrites` above) exists precisely to keep that subscription
 * narrow. A listener that writes to storage and touches no state costs nothing.
 *
 * Returns its own unsubscriber, so it drops straight out of a `useEffect`.
 */
export function onAddressChange(listener: () => void): () => void {
  return subscribe(listener);
}

/**
 * Hear **every** write to the address bar, including the ones nuqs makes.
 *
 * `subscribe` above listens for `popstate` and our own `NAVIGATED`, and misses
 * the third source entirely: a `useQueryState` setter, which writes through
 * `history.replaceState` and tells nuqs's own module-level emitter. That gap
 * does not matter to `useRoute` — a parameter change never changes the pathname
 * — but it matters a great deal to anything that wants the *query string*,
 * because **nuqs subscriptions are key-isolated**: its adapter filters
 * `location.search` down to the keys each hook watches and hands back the
 * cached snapshot when those are unchanged (`nuqs/dist/adapters/react.js`). So
 * a component subscribed to `?note=` is not woken by `?dhue=`, and a component
 * subscribed to nothing is not woken at all.
 *
 * That was invisible until `TableView` was memoised. Ten reading parameters are
 * owned by child components — `rank`, `bar`, `run`, `conf`, `deep`, `diagram`,
 * `dx`, `dhue`, `referee`, `remember` — and a change to any of them re-renders
 * only that child. `blockHref` reads the query to build 551 permalinks, and it
 * used to get away with it because `?at=` re-rendered the whole reading view
 * once a second while anybody scrolled. Take that away and the staleness stops
 * healing itself. GPT Sol's audit, 2026-09-04.
 *
 * **A patch rather than a list of parameters**, which was the alternative and is
 * the reason this exists: an inventory of the thirty-five parsers in params.ts
 * would be correct until somebody adds the thirty-sixth, and the failure would
 * be a quietly wrong link rather than anything that breaks. This cannot go out
 * of date.
 *
 * Patching `history` is not a new kind of thing here — nuqs's own
 * `enableHistorySync()` does exactly this, and main.tsx has the long note on
 * why we opted into it. Two wrappers on one function is fine: both run, in
 * whichever order they were installed. Called explicitly from main.tsx rather
 * than at import time, so the order is a decision rather than an accident of
 * which module was reached first.
 *
 * Idempotent, because a second patch would double every event.
 *
 * ## It also decides which entries remember a jump
 *
 * Since 2026-09-06 this is not only a listener. Every entry may carry a stamp
 * saying where the reader jumped from (jump-history.ts), and this is the one
 * place that can put it there or take it away, because it is the one place both
 * kinds of write pass through. Three rules, each from a review finding:
 *
 *  - **A push strips whatever stamp the caller handed over**, and adds one only
 *    when it is the push a jump armed. nuqs passes the **current** entry's state
 *    into `pushState` verbatim (nuqs/dist/adapters/react.js), so without the
 *    strip a `cols`, `mode` or `sort` toggle after a jump would *inherit* that
 *    jump's origin, and the chip would sit on an entry whose Back merely undoes
 *    the toggle. GPT Sol F3.
 *  - **A replace preserves the stamp of the entry it is rewriting**, taken from
 *    `history.state` rather than from the caller — `navigate({replace:true})`
 *    passes `null`, and the scroll spy rewrites `?at=` about once a second, so
 *    trusting the argument would erase the chip the moment the reader moved.
 *  - **A change of pathname clears it.** An excursion belongs to one article.
 *
 * An armed jump is held to the same standard: it is spent only by a push made
 * from the address it was armed at, and every `popstate` throws it away. GPT
 * Sol F14.
 *
 * ## The jump transaction happens here, not at the call site
 *
 * A jump has to write two entries: the one being left gains a `?at=` naming
 * where the reader actually was, and the new one carries the destination and
 * the stamp. **Those cannot be two nuqs setters.** nuqs keeps pending updates
 * in a `Map` keyed by parameter name, so a second `setAt` in the same tick
 * overwrites the first — one destination push would land and the predecessor
 * rewrite would silently never happen — and even `throttle(0)` defers the flush
 * to a later task (nuqs/dist/debounce-*.js). GPT Sol F11, 2026-09-06.
 *
 * So `beginJump` arms the origin and makes **one** ordinary nuqs push, and this
 * wrapper — which is what nuqs's flush eventually calls — performs the pair
 * against the functions it captured when it patched. Calling
 * `history.replaceState` here instead would recurse straight back through this
 * wrapper. The two calls are back to back with nothing between them and one
 * `NAVIGATED` after, so nothing observes the half-done state; strictly it is
 * *one wrapper-owned operation performed synchronously* rather than a
 * transaction, because the History API cannot roll the first call back if the
 * second throws.
 */
let historyWatched = false;

/**
 * **nuqs's own marker for a write it made.** Its history patch runs its
 * `sync()` — and, before that, resets its update queue — for every write that
 * does not carry this, which is why anything of ours writing *through* that
 * patch has to wear it (nuqs/dist/patch-history-*.js; `dismissJumpOrigin`, and
 * GPT Sol F20).
 */
const NUQS_MARKER = "__nuqs__";

/**
 * `replaceState` as it was before the wrapper below was installed, or `null`
 * until it is. See `dismissJumpOrigin`, the only thing that reads it.
 */
let capturedReplace: History["replaceState"] | null = null;
export function watchHistoryWrites(): void {
  if (historyWatched) return;
  historyWatched = true;
  /* The functions as they were when we patched — nuqs's own wrappers, since
     main.tsx installs `enableHistorySync()` first and ours is the outer of the
     two. Everything below calls these, never `history.pushState`. */
  const innerPush = history.pushState.bind(history);
  const innerReplace = history.replaceState.bind(history);
  /* Kept for `dismissJumpOrigin` below, which is the one caller that has to get
     *underneath* the wrapper installed on the next two lines. */
  capturedReplace = innerReplace;

  /* An arm belongs to the moment the reader asked, and going Back ends that
     moment as surely as a push does. nuqs abandons a queued write when the page
     navigates, so without this an arm could outlive the jump it was set for and
     be worn by some later push. GPT Sol F14, 2026-09-06. */
  window.addEventListener("popstate", clearArmedJump);

  history.pushState = (state: unknown, marker: string, url?: string | URL | null) => {
    /* **Whether the destination can carry a stamp is settled before anything is
       written.** The predecessor rewrite is the irreversible half: doing it and
       *then* finding the state unmergeable would leave a truthful predecessor
       and no chip to reach it with — half a pair, which is worse than neither
       half. GPT Sol F16, 2026-09-06.

       Consumed up front rather than in a `finally`: taking it before either
       native call means a throw from one of them cannot leave the arm behind to
       be claimed by whatever the app does next. A push that is not this jump's
       leaves it armed — see jump-history.ts § the handshake. */
    const origin = canStamp(state)
      ? consumeArmedJump(location.pathname + location.search, pathnameOfWrite(url), atOfWrite(url))
      : null;
    if (origin !== null) innerReplace(history.state, marker, originHref(origin));
    innerPush(withStamp(state, origin), marker, url ?? null);
    window.dispatchEvent(new Event(NAVIGATED));
  };

  history.replaceState = (state: unknown, marker: string, url?: string | URL | null) => {
    const kept = pathnameOfWrite(url) === location.pathname ? readStamp(history.state) : null;
    innerReplace(withStamp(state, kept), marker, url ?? null);
    window.dispatchEvent(new Event(NAVIGATED));
  };
}

/**
 * **Take the stamp off the entry the reader is standing on**, so the return
 * chip goes away without anything else about the page changing.
 *
 * The chip is truthful for as long as the stamp is there, which after a jump is
 * the rest of the reading session: ordinary scrolling replaces the entry and
 * the replace preserves the stamp deliberately. On a phone that is a permanent
 * tenant of reading space, and an *inferred* hide rule is exactly what GPT
 * Sol's F2 refused — so the escape is one the reader asks for. F12, 2026-09-06.
 *
 * **It must get underneath our own wrapper, and that is the whole reason this
 * is a function here rather than four lines in the component.** The wrapper's
 * `replaceState` re-applies the stamp it finds on `history.state`, on purpose —
 * the scroll spy rewrites `?at=` about once a second and passes `null` state,
 * so trusting the caller's argument would erase the chip the moment the reader
 * moved. A dismissal that went through it would therefore be a no-op that
 * looked exactly like a working button. So it calls the `replaceState` we
 * captured when we patched, and falls back to whatever is on `history` when the
 * wrapper was never installed — a test, or an entry point that is not main.tsx
 * — where there is nothing to get underneath.
 *
 * **A replace, so the stack does not grow.** A push would mean that leaving the
 * chip cost a press of Back, which is the thing the chip exists to spare.
 *
 * **And it goes in wearing nuqs's marker**, which is not cosmetic. The captured
 * function *is* nuqs's wrapper, and that wrapper runs its `sync()` for any
 * write not marked `__nuqs__` (nuqs/dist/patch-history-*.js). `sync()` calls
 * `spinQueueResetMutex()` **before** it notices the search string has not
 * changed — so dismissing the chip while the scroll spy's 300ms `?at=` replace
 * was still queued *cancelled that write*. The position tracker does not retry:
 * `synced.current` has already moved on. The address was left naming the
 * section the reader had left, so a reload or a shared link went back to it.
 * A dismissal must cost nothing but the stamp. GPT Sol F20, 2026-09-06.
 *
 * With the marker, nuqs skips `sync()` altogether: no queue reset and no
 * parameter hook disturbed. `NAVIGATED` is ours to fire, and it is what redraws
 * `useJumpOrigin`.
 */
export function dismissJumpOrigin(): void {
  const replace = capturedReplace ?? history.replaceState.bind(history);
  replace(withStamp(history.state, null), NUQS_MARKER, location.href);
  window.dispatchEvent(new Event(NAVIGATED));
}

/**
 * The address the reader is leaving, with `?at=` pointed at where they actually
 * were — or with it **removed**, which is how the top of the article is said.
 *
 * Removed rather than set to the first block: `useReadingPosition`'s restore
 * effect branches on exactly this, `scrollToTop()` for no `?at=` and
 * `scrollToBlock()` otherwise, so a value here would land the reader with the
 * first paragraph under the sticky chrome and the masthead gone. Same rule
 * `positionToWrite` uses for the same question. GPT Sol F8, 2026-09-06.
 */
function originHref(origin: JumpOrigin): string {
  const base = addressWithout(location.pathname + location.search, "at");
  return origin.kind === "top" ? base : addressAt(base, origin.blockId);
}

/** Where a history write is aimed. No URL at all means "this page". */
function pathnameOfWrite(url: string | URL | null | undefined): string {
  if (url === null || url === undefined) return location.pathname;
  try {
    return new URL(url, location.href).pathname;
  } catch {
    return location.pathname;
  }
}

/**
 * The `?at=` a history write is carrying, which is how an armed jump recognises
 * its own push. Parsed rather than pattern-matched, because the value is one
 * this app minted and the question is only "which block".
 */
function atOfWrite(url: string | URL | null | undefined): BlockId | null {
  const search =
    url === null || url === undefined
      ? location.search
      : safeUrl(url)?.search ?? location.search;
  const at = new URLSearchParams(search).get("at");
  return at !== null && isSpideryarnId(at) ? (at as BlockId) : null;
}

function safeUrl(url: string | URL): URL | null {
  try {
    return new URL(url, location.href);
  } catch {
    return null;
  }
}

/**
 * The query string, as state — `"?a=1&b=2"`, or `""`.
 *
 * A **string** snapshot, so `useSyncExternalStore`'s `Object.is` compares it by
 * value and a write that changes nothing re-renders nothing. `URLSearchParams`
 * here would be a fresh object every call and would loop forever, which is the
 * same trap `useRoute` below records.
 *
 * Only useful once `watchHistoryWrites` has been called; without it this hook
 * would miss every nuqs write, which is most of them.
 *
 * **Pathname and search, not just the search**, and that was a bug for the
 * first few hours: `blockHref` reads `location.pathname` too, so a write that
 * changed only the path — `/read/x?cols=1` → `/read/x/`, which router.ts
 * accepts as the same route — left the snapshot equal, the memo holding, and
 * 551 permalinks pointing at the old spelling. GPT Sol reproduced it,
 * 2026-09-04. Anything a memoised subtree derives from `location` has to be
 * inside this string.
 */
export function useAddress(): string {
  return useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search,
    () => "",
  );
}

/**
 * **Where the reader jumped from to reach the entry they are on**, as state —
 * `null` on an entry no jump stamped.
 *
 * A store of its own rather than anything derived from `useAddress`, and the
 * reason is the whole of GPT Sol's F6: `useAddress` snapshots
 * `pathname + search`, and **two entries can carry the same URL and differ only
 * in their state**. The wrapper above strips the stamp from every push it did
 * not arm, and a `mode` or `sort` toggle can land on the address the reader is
 * already at — so the snapshot compares equal, React commits nothing, and the
 * chip stays up over an entry whose Back does something else entirely. router.ts
 * has one of these already: the 2026-09-04 staleness bug § `watchHistoryWrites`
 * records is the same class, one layer down.
 *
 * `subscribe` is the right one unchanged: `popstate` covers Back and Forward,
 * and `NAVIGATED` covers every write the wrapper makes, which is all of them.
 *
 * **The cached object is not an optimisation.** `useSyncExternalStore` compares
 * snapshots with `Object.is` and re-renders whenever they differ, so returning
 * a freshly parsed `{ kind, blockId }` each call would loop for ever — the same
 * trap `useAddress` and `useRoute` avoid by snapshotting a string. Here the
 * value the caller wants is an object, so the identity is held instead, keyed
 * on a serialisation of it. `history.state` is one global, so one cache serves
 * every caller.
 */
let originCache: { key: string; origin: JumpOrigin | null } = { key: "", origin: null };
function jumpOriginSnapshot(): JumpOrigin | null {
  /* **Nothing to offer while a jump is in flight.** The reader has asked to be
     somewhere else and the page is already moving, but the push that records it
     is 50ms away — 320ms on an older Safari — so the entry underneath still
     describes the jump *before* this one. Drawing it would name the wrong
     origin, and pressing it would go back one place further than the reader
     meant while cancelling the jump they just asked for. GPT Sol F19,
     2026-09-06; jump-history.ts § isJumpArmed has the fix that was passed over
     and why. */
  const next = isJumpArmed() ? null : readStamp(history.state);
  const key = next === null ? "" : JSON.stringify(next);
  if (key !== originCache.key) originCache = { key, origin: next };
  return originCache.origin;
}

/**
 * `subscribe` plus arming, which is the one thing that changes what this store
 * says without writing to history at all.
 */
function subscribeToJumpOrigin(onChange: () => void): () => void {
  const stopWatchingHistory = subscribe(onChange);
  const stopWatchingArm = onArmedJumpChange(onChange);
  return () => {
    stopWatchingHistory();
    stopWatchingArm();
  };
}

export function useJumpOrigin(): JumpOrigin | null {
  return useSyncExternalStore(subscribeToJumpOrigin, jumpOriginSnapshot, () => null);
}

/**
 * That address with one parameter taken out, ready for a link to write its own.
 *
 * `"/read/x?cols=0,2&at=spya-old"` → `"/read/x?cols=0,2"`, and
 * `"/read/x?at=spya-old"` → `"/read/x"`. Text throughout, for the reason
 * `withoutPairs` gives.
 */
export function addressWithout(address: string, name: string): string {
  const q = address.indexOf("?");
  if (q === -1) return address;
  const kept = searchWithout(address.slice(q), name);
  return kept ? `${address.slice(0, q)}?${kept}` : address.slice(0, q);
}

/**
 * That address with an `?at=` written on the end — an address the reader could
 * be *at*, whether it goes in a link or straight into the history entry they
 * are leaving.
 *
 * `blockHref` (BlockRef.tsx) is the link-shaped caller and delegates here, so
 * the two cannot drift: `originHref` above writes the same thing into the
 * predecessor entry that a permalink to that block would say, which is what
 * makes "press Back" and "open the link" the same journey.
 *
 * `base` must already have had `at` dropped — `addressWithout` above — and is
 * edited as **text**, never round-tripped through `URLSearchParams`, which
 * would re-encode `?cols=0,1` into `?cols=0%2C1`: still correct, still parses,
 * and no longer readable by the person you send it to. The id is encoded even
 * though every id this repo mints is already URL-safe, because `BlockId` is a
 * string alias rather than a checked type.
 */
export function addressAt(base: string, id: BlockId): string {
  return `${base}${base.includes("?") ? "&" : "?"}at=${encodeURIComponent(id)}`;
}

/**
 * The current route, as state.
 *
 * The snapshot is the pathname *string* rather than a parsed object on purpose:
 * `useSyncExternalStore` compares snapshots by identity, and a fresh object
 * every call would loop forever. Parsing happens in the memo below it.
 */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    subscribe,
    () => location.pathname,
    () => "/",
  );
  return useMemo(() => parseRoute(pathname), [pathname]);
}
