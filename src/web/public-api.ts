/**
 * **The only way the client talks to `/api/public/`, and it is a bare `fetch`.**
 *
 * ## Why this is not `apiFetch`
 *
 * `apiFetch` (lib/api.ts) attaches the reader's bearer token and, on a 401,
 * refreshes the session and tries again. Every one of those behaviours is right
 * for a route that has an owner and wrong for one that does not.
 *
 * The failure it prevents is a shape this repo keeps meeting: if the public path
 * went through `apiFetch`, then every developer, every test run and every demo
 * would exercise it **with a session in hand** — and the one case the feature
 * exists for, a stranger with no account, would be exercised for the first time
 * by a stranger. It would look like it worked right up until it mattered.
 * docs/reusable/silent-success.md.
 *
 * So: no `Authorization`, no cookies, no refresh, no retry. The server half is
 * built the same way round — `servePublicApi` is handed `{res, path, method}`
 * and never the request, so it *cannot* read a header even by accident
 * (src/public/routes.ts). Signed-in and signed-out get identical bytes, and
 * this file is the client's half of that promise.
 *
 * ## 404 is an answer, not a failure
 *
 * `readJson` throws on any non-2xx, which is right everywhere else and wrong
 * here: the whole two-step in App.tsx turns on telling *"this document is not
 * shared"* apart from *"the request went wrong"*. So the status is read before
 * the body, and a 404 comes back as a value.
 *
 * See docs/plans/260827ai-public-read-only-access.md § The seam.
 */
import type { PublicLibrary } from "../public-library-types.js";
import type { PublicArticle } from "../public-types.js";
import { readJson } from "./lib/api.js";

/**
 * What a public GET came back with.
 *
 * Three outcomes and not two. `not-shared` is a real answer about the world —
 * either the article does not exist or its owner has not turned it on, and the
 * server deliberately does not say which (src/public/routes.ts). Anything else
 * throws, so a 500 cannot be quietly rendered as *"this document isn't
 * shared"*, which would be a page that looks exactly like one that works.
 */
export type PublicRead<T> = { kind: "ok"; body: T } | { kind: "not-shared" };

/**
 * `fetch`, for our own public namespace only.
 *
 * The prefix check is `apiFetch`'s, kept for the same reason and narrowed: a
 * path that is not under `/api/public/` reaching this function is a request
 * that meant to carry a token and lost it, and answering it anonymously would
 * be a 401 nobody could explain.
 *
 * `credentials: "omit"` is belt to the braces of not setting a header. Nothing
 * in this app authenticates by cookie today — Supabase hands out a bearer token
 * — but a same-origin `fetch` sends cookies by default, so if one ever appeared
 * this call would start carrying it without a line changing here.
 *
 * **`signal` is the only thing a caller may add**, and it is spelled as its own
 * parameter rather than a `RequestInit` on purpose: an init bag would let a
 * caller pass `credentials`, `headers` or a method, and the two lines above are
 * the whole point of this function. Added 2026-09-06 for `rehostImages`, which
 * has to be able to drop a superseded article's figure downloads
 * (src/web/rehost.ts § the object URLs).
 */
export async function publicFetch(path: string, signal?: AbortSignal): Promise<Response> {
  /**
   * **Normalised before it is checked**, because `startsWith` tests a string
   * and the browser sends a *resolved* path.
   *
   * `/api/public/../article/x` passes a prefix test and leaves as
   * `/api/article/x` — the authenticated namespace, asked anonymously, which
   * answers 401 to a caller that believed it was in the closed room. Today's
   * two loaders encode their slugs and cannot produce one, so this was a guard
   * weaker than it claimed rather than a live hole. GPT Sol, finding 9,
   * 2026-08-28.
   *
   * The origin is compared as well as the pathname: `//elsewhere.example/…` and
   * an absolute URL both resolve to another host while passing any test on the
   * path alone.
   *
   * **A fixed base rather than `location.origin`**, and that is not laziness.
   * The question is *does this path leave our namespace*, which is about the
   * path rather than about where the page is served from — and reading
   * `location` makes the guard untestable outside a browser, which is how it
   * would come to be exercised only by the callers that already work. `fetch`
   * still receives the original relative `path`, so the real origin is
   * whatever the page's is.
   *
   * An encoded slash is deliberately **not** caught: `%2F` is not a path
   * separator, `URL` leaves it in the pathname, and the server agrees — the raw
   * path stays inside the closed room and fails its route patterns there.
   * Rejecting it would refuse a slug that legitimately carries one.
   */
  const url = new URL(path, SAME_ORIGIN);
  if (url.origin !== SAME_ORIGIN || !url.pathname.startsWith("/api/public/")) {
    throw new Error(`publicFetch is for the public namespace only, and this is not: ${path}`);
  }
  /* Spread rather than `signal` straight in: `exactOptionalPropertyTypes` is on
     (docs/project/typechecking.md), so an explicit `signal: undefined` is not
     the same thing as no signal at all. */
  return fetch(path, { credentials: "omit", ...(signal ? { signal } : {}) });
}

/**
 * A stand-in origin for resolving a relative path, and nothing else.
 *
 * `.invalid` is reserved by RFC 2606 and resolves nowhere, so a bug that let
 * this reach the network would fail loudly rather than reaching a real host.
 */
const SAME_ORIGIN = "https://spideryarn.invalid";

/**
 * `GET /api/public/article/:slug`.
 *
 * **The `signal` is the article load's**, so a reader who moves on before the
 * payload arrives stops paying for it. Added 2026-09-07: `rehostImages` had
 * carried an `AbortController` since stage E and the *payload* fetch above it
 * had none, so releasing a load abandoned the request rather than cancelling
 * it — on a 150KB payload over a slow connection that is a real download for an
 * article nobody is looking at. Nothing visible was wrong, because the `live`
 * guard already refused the stale render; this is the resource half. GPT Sol,
 * reviewing the built code.
 */
export async function loadPublicArticle(
  slug: string,
  signal?: AbortSignal,
): Promise<PublicRead<PublicArticle>> {
  return read<PublicArticle>(`/api/public/article/${encodeURIComponent(slug)}`, signal);
}

/**
 * `GET /api/public/library` — the shelf of every article somebody has shared.
 *
 * **No slug, and so nothing to encode**, which is the whole difference between
 * this loader and the one above. The path is a constant, and
 * tests/public-client-fetch.test.ts checks it against the server's own inventory
 * (src/public/route-names.ts) so a rename on either side is a red test rather
 * than a 404 in a stranger's browser.
 *
 * `not-shared` is in the return type because `read` is shared and the namespace's
 * rule is the namespace's; in practice this route does not answer 404 — an empty
 * shelf is a 200 with an empty list, because *"nobody has shared anything"* is
 * an answer about the world rather than a missing route.
 * src/store/public-library.ts § `scrubbed`.
 */
export async function loadPublicLibrary(): Promise<PublicRead<PublicLibrary>> {
  return read<PublicLibrary>("/api/public/library");
}

/**
 * The two loaders above, and the shape of any that follow.
 *
 * Generic because what it holds is the 404-is-an-answer rule, and that belongs
 * to the namespace rather than to the article. It was down to one caller between
 * 2026-09-02, when `loadPublicMetadata` was deleted with its route, and
 * 2026-09-04, when the library listing arrived — kept as a shared helper through
 * that, which is why the second loader is two lines.
 */
async function read<T>(path: string, signal?: AbortSignal): Promise<PublicRead<T>> {
  const res = await publicFetch(path, signal);
  /* Read before the body, because `readJson` throws on a 404 and this is the
     one place a 404 is the answer rather than the problem. */
  if (res.status === 404) return { kind: "not-shared" };
  return { kind: "ok", body: await readJson<T>(res) };
}
