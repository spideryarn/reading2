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
  isLegacyAboutPair,
  queryPairs,
  redirectsToMetadata,
  type ArticleView,
} from "../read-address.js";
import { isSpideryarnId } from "../ids.js";
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
   * behind it that could refuse anybody, and the page is in every signed-in
   * reader's bundle either way. It is on the list because it is developer
   * furniture, not because it is privileged.
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
   * reason is docs/project/admin.md's: these pages are in every signed-in
   * reader's bundle, so 403 is the honest posture and a 404 would be pretending
   * about something anyone can see is there. The refusal that matters is the
   * server's, on `/api/admin/`.
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
   * 404, because the page is in everybody's bundle already and pretending
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
 * - **It hides nothing.** `AdminPage.tsx` and `DesignPage.tsx` are in the
 *   JavaScript bundle every signed-in reader downloads, and vercel.json rewrites
 *   every non-`/api/` address to `index.html`, so these paths answer 200 to
 *   anybody. A reader who wants to see the design reference can still see it.
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
  pricing: false,
  contact: false,
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
  /* Above everything else, because the whole point of this address is that
     nothing may reinterpret it. See the `callback` variant above. */
  if (new RegExp(`^${CALLBACK_HREF}/?$`).test(pathname)) return { kind: "callback" };
  if (new RegExp(`^${LOGIN_HREF}/?$`).test(pathname)) return { kind: "login" };
  // Beside `design` and above `/read/` for the same reason: it is not about an
  // article, so the article regex must never get a chance at it.
  if (new RegExp(`^${PROFILE_HREF}/?$`).test(pathname)) return { kind: "profile" };
  // Beside `design` and `profile`, and for the same reason. Above `/read/`
  // because it is not about an article, and above the sign-in gate in App.tsx
  // because it is not about being signed in either.
  if (new RegExp(`^${PRIVACY_HREF}/?$`).test(pathname)) return { kind: "privacy" };
  if (new RegExp(`^${FEATURES_HREF}/?$`).test(pathname)) return { kind: "features" };
  if (new RegExp(`^${PRICING_HREF}/?$`).test(pathname)) return { kind: "pricing" };
  if (new RegExp(`^${CONTACT_HREF}/?$`).test(pathname)) return { kind: "contact" };
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
 */
let historyWatched = false;
export function watchHistoryWrites(): void {
  if (historyWatched) return;
  historyWatched = true;
  for (const name of ["pushState", "replaceState"] as const) {
    const real = history[name].bind(history);
    history[name] = (...args: Parameters<History["pushState"]>) => {
      real(...args);
      window.dispatchEvent(new Event(NAVIGATED));
    };
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
