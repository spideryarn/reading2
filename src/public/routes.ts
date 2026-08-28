/**
 * **The closed room.** Everything under `/api/public/` is answered here, and
 * nothing here falls back into the authenticated table.
 *
 * That last clause is the whole point of the file. From
 * docs/plans/public-read-only-access.md:
 *
 * > Once a request is inside `/api/public/`, an unknown path or a wrong method
 * > **terminates there**. It never falls through into the authenticated table.
 * > That fallthrough is the single most likely way this feature grows a hole.
 *
 * The predecessor repo learned it the expensive way. The thing its June 2025
 * work existed to *delete* was a second route to the same content:
 *
 * > **Current Issue**: `/share` route bypasses all security and RLS policies,
 * > allowing access to any document by slug regardless of `is_public` status.
 *
 * The fix there was deleting the second path, not patching it. This namespace
 * is a second path. What keeps it from being that bug is that it has its own
 * predicate, its own projections and its own closed table — and that it is the
 * only one. If a third way to read an article ever appears, that paragraph is
 * the one to re-read.
 *
 * ## What this file cannot do, structurally
 *
 * It is not handed the `IncomingMessage`. Sol's answer 2 sketched one shared
 * envelope carrying `req` for both dispatchers; the authenticated half needs it
 * for bodies and this half needs nothing from it, so it does not get it. The
 * rule *"the public routes ignore `Authorization` completely"* then stops being
 * a thing to remember and becomes a thing there is no way to break: there is no
 * header to read, no body to parse, and no cookie in scope.
 *
 * ## No owner, ever
 *
 * `setRequestOwner` is not called on this path, so the box `handleApi` opened
 * stays empty and `currentOwnerId()` **throws** — which is the runtime tripwire,
 * not an inconvenience. Any handler that reaches for an owner blows up loudly
 * instead of quietly succeeding as the wrong person. src/owner.ts § The box is
 * mutable, and empty until the gate fills it.
 */

import type { ServerResponse } from "node:http";

import { isSlug } from "../ingest.js";
import { STORE } from "../store/live.js";
import { pgPublicReader } from "../store/public-reader.js";

/**
 * Everything a public handler is allowed to know about the request.
 *
 * `path` is already stripped of its query string by `serveApi`. Nothing here
 * matches on `url`: several existing authenticated routes do, and so see the
 * query string — a check a `?` can hide behind is not a check.
 */
export interface PublicRequest {
  res: ServerResponse;
  path: string;
  method: string;
}

/** An error carrying the HTTP status it should be reported as. Mirrors src/routes.ts. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * The same JSON reply `send` in src/routes.ts writes.
 *
 * Written again rather than imported, because importing it would make this
 * module depend on the four-thousand-line file that dispatches to it — a cycle
 * `npm run cycles` gates on, and a much larger import graph than
 * tests/public-imports.test.ts is willing to allow.
 */
function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Is this request in the public namespace?
 *
 * **Two comparisons rather than one**, which is the admin check's own lesson
 * (src/routes.ts): `startsWith("/api/public/")` alone would leave a future
 * endpoint at exactly `/api/public` — no trailing slash — outside the closed
 * room, and it would fall through into the authenticated table and be answered
 * with a 401 instead of a 404. The bare path is in the namespace too.
 *
 * `/api/publications` is deliberately **not** in here — the prefix ends at a
 * slash — and neither is `/api/publicx`. The namespace is a path segment.
 *
 * Asked of `path`, which `serveApi` has already stripped of its query string
 * and already refused if it does not begin `/api/`.
 */
export function isPublicNamespace(path: string): boolean {
  return path === "/api/public" || path.startsWith("/api/public/");
}

/* The two routes, matched on `path`. The character class is the one every
   authenticated slug route uses, so a slug that is legal there is legal here
   and the two cannot disagree about what a slug looks like. */
const ARTICLE = /^\/api\/public\/article\/([\w.%-]+)$/;
const METADATA = /^\/api\/public\/metadata\/([\w.%-]+)$/;

/**
 * The captured slug, decoded **once**, then validated.
 *
 * `slugPart` in src/routes.ts, restated here for the same reason `send` is. The
 * two rules it encodes are both load-bearing and both were learned from a real
 * traversal on 2026-08-25:
 *
 * - **Only the capture is decoded, never the whole path.** `/api/article/..%2F..%2F…`
 *   reached the reader as `../../…` and `path.join` normalised the segments
 *   straight out of the repo.
 * - **Decoded exactly once**, then run through `isSlug`. A second decode would
 *   turn `%252e%252e` into `..` after the check had passed.
 *
 * 400 rather than 404, matching the authenticated routes: the request is
 * malformed, and "not found" would send whoever sent it looking for a missing
 * article.
 */
function slugFrom(match: RegExpExecArray): string {
  const value = decodeURIComponent(match[1] ?? "");
  if (!isSlug(value)) throw httpError(400, `Not a slug: ${JSON.stringify(value)}`);
  return value;
}

/**
 * **Public reading needs Postgres**, and says so rather than pretending.
 *
 * The filesystem store has no `visibility` column and nowhere to put one — it
 * is one directory per slug under `data/`, which is why src/store/index.ts
 * refuses to boot on it in production at all. So under `files` there is no
 * honest answer to "is this shared": every article would be either all public
 * or all private, and both of those are wrong.
 *
 * Refused loudly, with its own sentence, for the reason `adminOnFiles` in
 * src/store/index.ts gives: the alternative — a 404 — is a page that says *this
 * document is not shared* and looks exactly like a page that works.
 * docs/reusable/silent-success.md.
 */
function requirePostgres(): void {
  if (STORE === "postgres") return;
  throw httpError(
    501,
    "Public reading needs Postgres — the filesystem store has no visibility column. " +
      "Run with SPIDERYARN_STORE=postgres. See docs/plans/public-read-only-access.md.",
  );
}

/**
 * Answer one request in the public namespace, whatever it turns out to be.
 *
 * Every path out of here writes a response. It returns `void` rather than a
 * boolean precisely so there is no "I did not handle it" value for a caller to
 * act on — a `false` returned from here is one `if` away from being a
 * fallthrough into the authenticated table, and that is the failure this file
 * exists to prevent.
 *
 * Thrown errors are deliberately not caught: `serveApi`'s single `catch` maps
 * them to a status and its single `finally` writes the log line. One catch and
 * one log for both halves of the API is Sol's answer 2, and it is why the
 * gate's own refusals have been inside that `try` since 2026-08-27.
 */
export async function servePublicApi(request: PublicRequest): Promise<void> {
  const { res, path, method } = request;

  /* **Method, then slug, then store, then the read**, and the order is the
     content of these four lines. The slug is validated before the store is
     consulted so that a malformed request is a 400 whatever this server is
     configured with — otherwise the same request would be a 400 on one machine
     and a 501 on another, which is the sort of difference that gets discovered
     from a bug report rather than from a test. */
  const article = ARTICLE.exec(path);
  if (article) {
    requireGet(res, method);
    const slug = slugFrom(article);
    requirePostgres();
    send(res, 200, await pgPublicReader.loadArticle(slug));
    return;
  }

  const metadata = METADATA.exec(path);
  if (metadata) {
    requireGet(res, method);
    const slug = slugFrom(metadata);
    requirePostgres();
    send(res, 200, await pgPublicReader.loadMetadata(slug));
    return;
  }

  /**
   * **Anything else under `/api/public/` ends here.**
   *
   * Not `return false`, not a fall-through, not a 401. A stranger asking for a
   * route that does not exist gets the same answer as a stranger asking for an
   * article that is not shared, which is the only answer this namespace has.
   */
  throw httpError(404, `No public API route for ${method} ${path}`);
}

/**
 * **GET, and nothing else, for every public route there will ever be.**
 *
 * Checked per route rather than once at the top, because a route added later
 * with its own method check is the version of this that stays true — but note
 * that both call sites use this one function, so "every public route rejects
 * every non-GET method" is a property of one line and
 * tests/public-routes.test.ts sweeps every route to say so.
 *
 * The rule underneath is older than this feature: every GET in this app is a
 * pure read and everything that spends money is a POST. `POST /api/similar/:slug`
 * in src/routes.ts says why at length, and the reason given is exactly ours —
 * a link prefetcher, a proxy retry, a crawler or a double-tap on Back can all
 * pay for a GET again, none of them having asked anybody.
 *
 * 405 with `Allow`, not 404: the path exists and the method is wrong, and there
 * is nothing to hide about which methods a public route takes.
 *
 * **The header is set on the response here, not attached to the error.** An
 * `Object.assign(err, { headers })` reads well and does nothing at all:
 * `serveApi`'s catch reads `status` and `message` off a thrown error and has
 * never looked at anything else, so the `Allow` would be a header this file
 * believed it had sent. docs/reusable/silent-success.md.
 */
function requireGet(res: ServerResponse, method: string): void {
  if (method === "GET") return;
  res.setHeader("Allow", "GET");
  throw httpError(405, `Public routes are GET only, not ${method}`);
}
