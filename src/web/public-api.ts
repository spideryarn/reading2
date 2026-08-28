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
 * See docs/plans/public-read-only-access.md § The seam.
 */
import type { PublicArticle, PublicMetadata } from "../public-types.js";
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
 */
export async function publicFetch(path: string): Promise<Response> {
  if (!path.startsWith("/api/public/")) {
    throw new Error(`publicFetch is for the public namespace only, and this is not: ${path}`);
  }
  return fetch(path, { credentials: "omit" });
}

/** `GET /api/public/article/:slug`. */
export async function loadPublicArticle(slug: string): Promise<PublicRead<PublicArticle>> {
  return read<PublicArticle>(`/api/public/article/${encodeURIComponent(slug)}`);
}

/** `GET /api/public/metadata/:slug` — which artefacts this piece has, and nothing more. */
export async function loadPublicMetadata(slug: string): Promise<PublicRead<PublicMetadata>> {
  return read<PublicMetadata>(`/api/public/metadata/${encodeURIComponent(slug)}`);
}

async function read<T>(path: string): Promise<PublicRead<T>> {
  const res = await publicFetch(path);
  /* Read before the body, because `readJson` throws on a 404 and this is the
     one place a 404 is the answer rather than the problem. */
  if (res.status === 404) return { kind: "not-shared" };
  return { kind: "ok", body: await readJson<T>(res) };
}
