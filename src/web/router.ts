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
 * know about it (docs/plans/metadata-page.md), `/read/<slug>/tweets` is the
 * article as a numbered thread (docs/plans/tweet-thread-page.md). They are the
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

/** Which of an article's three pages. `article` is the reading view itself. */
export type ArticleView = "article" | "metadata" | "tweets";

export type Route =
  | { kind: "library" }
  | { kind: "read"; slug: string; view: ArticleView }
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
  /** The design reference — every primitive on one page. See DesignPage.tsx. */
  | { kind: "design" }
  /**
   * You, rather than an article — `/profile`. See ProfilePage.tsx and
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
   * Mostly redundant: not being signed in already shows you that screen
   * wherever you are, because who you are is not view state and so does not
   * belong in the URL (url-state.md). It exists because a password-reset email
   * has to land *somewhere*, and because "send me the login page" is a
   * reasonable thing to be able to do. Nothing in the app links to it yet.
   */
  | { kind: "login" }
  /**
   * Where Google sends the reader back — `/auth/callback`. See AuthCallback.tsx.
   *
   * **The one route that must be exempt from every rewrite in main.tsx**, and
   * that is a security property rather than tidiness. `canonicalAddHref` reads
   * `location.search` as part of an article's address — its whole job — so a
   * return to `/add/…?code=C` would encode our one-time authorisation code
   * inside a stranger's URL, which ingest then fetches. Their access log, our
   * auth code. GPT Sol found it; docs/plans/auth-supabase.md has the diagram.
   */
  | { kind: "callback" };

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
 * Anything that isn't an article is the library, including nonsense.
 *
 * No 404 page, deliberately: a mistyped path lands you on the shelf, which is
 * both a useful place to be and self-explanatory. That covers an unknown third
 * segment too — `/read/foo/nonsense` is the shelf, exactly as `/nonsense` is,
 * rather than an article page with a blank middle.
 *
 * The trailing slash is optional at both lengths, because Greg wrote the routes
 * as `/read/[slug]/` and `/read/[slug]/metadata/` and a link that gains or
 * loses one should not stop working.
 */
export function parseRoute(pathname: string): Route {
  // Not under /read/, because it is not about an article. It is the one page in
  // the app with no data behind it at all.
  if (/^\/design\/?$/.test(pathname)) return { kind: "design" };
  /* Above everything else, because the whole point of this address is that
     nothing may reinterpret it. See the `callback` variant above. */
  if (new RegExp(`^${CALLBACK_HREF}/?$`).test(pathname)) return { kind: "callback" };
  if (new RegExp(`^${LOGIN_HREF}/?$`).test(pathname)) return { kind: "login" };
  // Beside `design` and above `/read/` for the same reason: it is not about an
  // article, so the article regex must never get a chance at it.
  if (/^\/profile\/?$/.test(pathname)) return { kind: "profile" };
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
  if (pathname.startsWith(ADD_PREFIX)) {
    const url = addUrlFrom(pathname);
    if (url) return { kind: "add", url };
    return { kind: "library" };
  }
  const m = /^\/read\/([^/]+)(?:\/(metadata|tweets))?\/?$/.exec(pathname);
  if (!m) return { kind: "library" };
  // A malformed escape would throw out of decodeURIComponent and take the whole
  // render with it, over a hand-mangled address bar.
  let slug: string;
  try {
    slug = decodeURIComponent(m[1] ?? "");
  } catch {
    return { kind: "library" };
  }
  if (!slug) return { kind: "library" };
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
export const DESIGN_HREF = "/design";
export const LOGIN_HREF = "/login";
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
 * "go to the shelf".
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
  const url = fromPath !== "" ? fromPath : addUrlFromQuery(search);
  if (url === "") return null;
  const href = addHref(url);
  return href === pathname + search + hash ? null : href;
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
  if (options.replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  window.dispatchEvent(new Event(NAVIGATED));
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
