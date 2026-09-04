/**
 * **`GET /read/:slug`, served as HTML with its head filled in** — the transport
 * half of stage 2 of docs/plans/260827ai-public-read-only-access.md.
 *
 * Until now every `/read/` address was rewritten to a static `index.html` whose
 * `<title>` is the bare word *Spideryarn*, and the real title was set by React
 * after mount. No unfurler runs our JavaScript, so **every link anybody shared
 * previewed as nothing**. This module is what a Vercel function calls instead:
 * it reads six values out of the public reader, hands them to `composeShell`,
 * and writes the same built bundle back out with a real head on it.
 *
 * ## What it deliberately is not
 *
 * **It is not a second renderer.** It cannot become one, structurally: the head
 * projection in src/store/public-reader.ts does not select the blocks, so there
 * is no prose here to render even if somebody wanted to. The moment this
 * function produces body HTML we own two reading views.
 *
 * **It knows no transport.** src/vercel.ts owns the URL, the rewrite and the
 * regex; this module owns the head, the database and the statuses. The seam is
 * `servePublicReadPage`, and it takes a method and a decoded slug rather than
 * an `IncomingMessage` — the same shape and the same reason as `PublicRequest`
 * in routes.ts: there is no header to read, no body to parse and no cookie in
 * scope, so "the public page ignores `Authorization` completely" stops being a
 * thing to remember and becomes a thing there is no way to break.
 *
 * ## The decision is pure, and the I/O is four lines
 *
 * `decidePublicPage` is a function of `(method, slug, load, sha256)` with no
 * database, no clock and no response object in it, which is what makes the
 * table below testable without Postgres. `servePublicReadPage` does the read,
 * calls it, and writes what it says.
 *
 * ## What each case answers
 *
 * | Case | Status | Head |
 * |---|---|---|
 * | Public and readable | 200 | Enhanced |
 * | Private, absent, or an unreadable revision | 404 | Unmodified default |
 * | `/read/public`, the reserved shelf address | 200 | Unmodified default |
 * | Malformed slug | 400 | Unmodified default |
 * | Method other than GET or HEAD | 405 + `Allow: GET, HEAD` | Unmodified default |
 * | **Anything else the reader throws** | **503 + `Retry-After: 30`** | **Unmodified default** |
 *
 * ### That last row was a 200, and the argument for it was false
 *
 * The argument written here said a 5xx would replace our application with
 * Vercel's error page, so a transient database hiccup on this one head query
 * would cost a reader the whole page rather than only the preview. **It is not
 * true, and GPT Sol's review of the built code caught it**: `servePublicReadPage`
 * below composes the shell and writes it itself, and the status it chose has no
 * say in that. A 503 carries our page exactly as the 200 did. The premise was
 * never tested, which is how a paragraph of reasoning stood on it for a day.
 *
 * With that gone, the 200 is not neutral but actively worse:
 *
 * - **An unfurler may cache the generic card.** Slack's card cache is beyond
 *   our reach, which the `Cache-Control` comment below already says. Answering
 *   200 with the default head is precisely how a wrong card gets *into* it, and
 *   there is then nothing we can do about it. A 5xx is not cached as an answer.
 * - **Every status-based monitor reports success** while the preview is broken.
 *   That is the failure shape this repo keeps writing postmortems about, and no
 *   amount of Sentry capture makes a green uptime check honest.
 *
 * 503 rather than 500 because the condition is transient by nature — the head
 * read failed, not the route — and `Retry-After: 30` says so to anything that
 * will listen.
 *
 * The reader still gets the page either way, because we send the shell body
 * ourselves. **And it stays the right answer even if Vercel does one day
 * substitute its own page for a 5xx**, which is not verified on a deployment:
 * the head read fails when the database is unreachable, and in that case the
 * client's own `GET /api/public/article/:slug` fails too. There would have been
 * no working page to protect.
 *
 * A 404 is **not** in that category and stays a 404: "this article is not
 * shared" is an answer, not a failure, and it is the same answer a private
 * slug, an absent slug and a broken revision all get everywhere else in this
 * feature. src/store/public-reader.ts § `notShared`.
 *
 * ## Robots
 *
 * **This module sets no `X-Robots-Tag`.** The site-wide `noindex, nofollow` in
 * vercel.json still owns it in this slice, and a second one would collide —
 * duplicate headers are a real deployed failure mode and the whole point of
 * slice 1 is that crawler exposure does not change at all. Slice 2 splits the
 * static rule and moves the header here; see the plan.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { isSlug, PUBLIC_LIBRARY_SLUG } from "../ingest.js";
import { errorFields, log } from "../log.js";
import { captureFailure } from "../monitoring.js";
import type { PublicHead } from "../store/public-reader.js";
import { pgPublicReader } from "../store/public-reader.js";
import { readMode, viewFor } from "../read-address.js";
import { composeShell } from "./page-head.js";

/**
 * The built client, compiled into this bundle by vite.api.config.ts, with the
 * digest of the untouched original beside it.
 *
 * Not `process.env` and not a file read: a serverless function has no `dist/`
 * next to it, and the whole value of a stamp is that the running environment
 * cannot change it after the fact — the same argument src/vercel-health.ts
 * makes for the build stamp.
 */
declare const __SPIDERYARN_BUILT_SHELL__: string;
declare const __SPIDERYARN_BUILT_SHELL_SHA256__: string;

/** The shell as built, and the SHA-256 of it before anything was substituted. */
export interface BuiltShell {
  html: string;
  sha256: string;
}

/**
 * The compiled shell, or `null` where there isn't one.
 *
 * `typeof` rather than a bare read, exactly as src/vercel-health.ts guards the
 * build stamp: a `define` that never ran leaves the identifier undeclared, and
 * touching it throws a `ReferenceError` rather than giving `undefined`. Neither
 * constant exists in development or under vitest, because `npm run dev` never
 * loads vite.api.config.ts.
 *
 * Returning `null` rather than a fallback is the point. A source `index.html`
 * substituted in here would reference `/src/web/boot.tsx`, which does not exist
 * on a deployment — a page that looks right to `curl` and is blank in a browser.
 * The caller declines the request instead.
 */
export function builtShell(): BuiltShell | null {
  if (typeof __SPIDERYARN_BUILT_SHELL__ !== "string") return null;
  if (typeof __SPIDERYARN_BUILT_SHELL_SHA256__ !== "string") return null;
  return { html: __SPIDERYARN_BUILT_SHELL__, sha256: __SPIDERYARN_BUILT_SHELL_SHA256__ };
}

/**
 * What the head read came back as — **three outcomes, not two.**
 *
 * `not-shared` and `failed` are different answers with different statuses, and
 * collapsing them is the mistake this type exists to prevent: an empty result
 * means *we know, and the answer is no*, while a thrown driver error means *we
 * do not know*. docs/reusable/silent-success.md, and the memory note that an
 * empty list is not the same as never having asked.
 */
export type HeadLoad =
  | { kind: "found"; head: PublicHead }
  | { kind: "not-shared" }
  | { kind: "failed" };

/** What to write, decided before anything is written. */
export interface PageDecision {
  status: number;
  headers: Record<string, string>;
  /** `null` means the shell goes out exactly as it was built. */
  head: PublicHead | null;
}

/** Read methods, and the `Allow` value that has to agree with them. */
const READ_METHODS = ["GET", "HEAD"];
const ALLOW = READ_METHODS.join(", ");

/**
 * **Every status this route can answer, as a function of three values.**
 *
 * Pure on purpose — the table in this file's header is checked against this
 * function with no database anywhere near it, which is the difference between
 * a table that is documentation and a table that is a test.
 *
 * `load` is `null` when no read was attempted, which is the case for a refused
 * method or a malformed slug; those are decided here before anything is loaded,
 * so the ordering is visible rather than implied by the caller.
 *
 * The digest is a parameter rather than read from the compiled constant, so
 * that this function stays a function. It goes on **every** response, including
 * the refusals: the deployed check compares it against the SHA-256 of
 * `GET /index.html`, and a check that only runs on the happy path would not
 * notice a stale shell being served to the case that matters.
 */
export function decidePublicPage(
  method: string,
  slug: string,
  load: HeadLoad | null,
  sha256: string,
): PageDecision {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    /* No caching, at all. The visibility switch is a single `update`, and an
       article unshared a minute ago must stop being served now — an edge cache
       would keep answering with the enhanced head for however long it was told
       to. Slack's own card cache is beyond our reach and the sharing copy says
       so; ours is not, so we do not have one. */
    "Cache-Control": "no-store",
    "X-Spideryarn-Shell-SHA256": sha256,
  };

  /* Method first, because a POST to a private slug must not cause a database
     read — the check that costs nothing goes before the one that does. */
  if (!READ_METHODS.includes(method)) {
    return { status: 405, headers: { ...headers, Allow: ALLOW }, head: null };
  }

  /**
   * **`/read/public` is the shelf, not an article — matched before the slug.**
   *
   * `public` is a legal slug shape, so without this the address goes to the
   * reader, misses (no article may be called that — src/ingest.ts §
   * `isReservedSlug`), and is answered as *this document is not shared*. Same
   * status, different meaning, and a database round trip for a question with a
   * constant answer.
   *
   * `parseRoute` (src/web/router.ts) matches it before `/read/:slug` too, and
   * the two have to agree: whatever this returns is the status on a page the
   * client is simultaneously deciding what to draw.
   *
   * **200 with the default head**, since 2026-09-04 — `PublicLibraryPage`
   * (src/web/PublicLibraryPage.tsx) is what the client draws here, and the two
   * have to agree or one of them serves a 404 for a page the other renders.
   *
   * **`head: null` is not a placeholder.** A `PublicHead` is composed from *an
   * article* and becomes `og:` tags naming one (page-head.ts), so there is
   * nothing here for it to be built from — and there is nothing we would want
   * it to say either, because a preview card is a promise about a specific
   * document. A pasted `/read/public` unfurls as whatever the shell's own
   * `<title>` says, which is the app's name, and that is the honest answer.
   * The page's real title is set by React on mount, like every other page that
   * is not a shared article (src/web/page-title.ts).
   * docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3b.
   */
  if (slug === PUBLIC_LIBRARY_SLUG) return { status: 200, headers, head: null };

  /* And the slug before the store, so a malformed address is a 400 whatever
     this deployment is configured with — the same ordering, and the same
     reason, as `servePublicApi` in routes.ts. */
  if (!isSlug(slug)) return { status: 400, headers, head: null };

  if (load?.kind === "found") return { status: 200, headers, head: load.head };
  if (load?.kind === "not-shared") return { status: 404, headers, head: null };
  /* `failed`, or a `null` that should not have got here. Both mean the head is
     unknown. The body is still the whole application — we write it ourselves,
     below — but the status has to say the truth, because a 200 puts a generic
     card into caches we cannot reach and tells every monitor we are fine. See
     the header for why this stopped being a 200. */
  return { status: 503, headers: { ...headers, "Retry-After": "30" }, head: null };
}

/**
 * The head, or which kind of no.
 *
 * The reader marks its own refusals with a `status`, which is this codebase's
 * mark for *I chose this failure and I chose its wording*. 404 is the only one
 * reachable here — `requireSlug`'s 400 cannot fire, because `decidePublicPage`
 * has already run the same `isSlug` — so everything else is by definition
 * unexpected, including the 500 `scrubbed` raises for a database error.
 */
async function loadHead(slug: string, read: (slug: string) => Promise<PublicHead>): Promise<HeadLoad> {
  try {
    return { kind: "found", head: await read(slug) };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return { kind: "not-shared" };
    /* **Visible rather than swallowed.** Serving the default shell is the right
       answer for the reader and the wrong one for us to find out about from a
       bug report, so the whole error goes to the log and to Sentry — as well as
       into the 503 the status table gives it, which is what a monitor sees. The
       slug is in the line because it is in the URL of the request that raised
       it and nothing else identifies which article lost its preview; no message
       from the reader is — `scrubbed` has already replaced it with a fixed
       sentence, and this catch does not undo that. */
    log("http").error(
      { ...errorFields(err), slug, path: "/read/:slug", status: 503 },
      "the public head read failed; serving the page with the default head",
    );
    captureFailure(err, { slug, path: "/read/:slug", status: 503 });
    return { kind: "failed" };
  }
}

/**
 * Answer one `/read/:slug`.
 *
 * `read` is injectable so the whole table above can be exercised against a fake
 * — including the failure row, which is the one that cannot be produced by any
 * real database you would want to have. It defaults to the hardwired public
 * reader, which is the only reader this module knows about: there is no
 * argument here that could make it return a private article.
 *
 * ## HEAD
 *
 * Same status, same headers, **including a truthful `Content-Length` in UTF-8
 * bytes**, and no body. `Buffer.byteLength` rather than `.length`, because the
 * enhanced head carries an article title and titles have non-ASCII characters
 * in them — a `.length` on `"Café · Spideryarn"` is one byte short, and one
 * byte short is a truncated response to any client that believes it.
 *
 * Set explicitly on the GET too, rather than left to Node. The reason is the
 * one routes.ts gives about its own `send`: a `res` that is not Node's — the
 * hand-built one every route test in this repo uses — has no automatic length
 * and no body suppression at all, so a version that leaned on either would look
 * correct in every unit test while the truth lived somewhere no test reached.
 */
export async function servePublicReadPage(args: {
  /**
   * **The request itself, rather than an address copied out of it.**
   *
   * This went through three shapes in one day, and the third is the point.
   * First the caller derived the mode and the view and passed those; a test
   * could reassemble the same two calls and stay green while `src/vercel.ts`
   * quietly stopped passing one. Then the caller passed the whole `url`; that
   * fixed the deriving but not the wiring, because `url: restored` and
   * `url: path` both compile and only one of them carries the query. GPT Sol
   * named both, 2026-08-30, the second with the exact mutation: *"Required means
   * 'some string,' not 'the restored string.'"*
   *
   * So there is no address argument left to get wrong. `src/vercel.ts` has
   * already put the restored URL on `req.url` — the same field `handleApi`
   * routes on, so the two cannot be given different ideas of the address — and
   * this reads it from there. The wiring is not a choice any more.
   *
   * Mode and view reach the `<title>` and nothing else. `og:title`,
   * `twitter:title` and the canonical are about the article whichever of its
   * pages was asked for, and whichever panel the person who shared it had open.
   */
  req: Pick<IncomingMessage, "method" | "url">;
  res: ServerResponse;
  /** Already decoded exactly once, by `originalUrl`. Do not decode it again. */
  slug: string;
  shell: BuiltShell;
  read?: (slug: string) => Promise<PublicHead>;
}): Promise<void> {
  const { res, slug, shell } = args;
  const method = args.req.method ?? "GET";
  const url = args.req.url ?? "";
  const mode = readMode(url);
  /* The address may be a legacy spelling of the metadata page, which the client
     rewrites before it draws anything — src/read-address.ts. */
  const view = viewFor(url);
  const read = args.read ?? ((s: string) => pgPublicReader.loadHead(s));

  /* **No head read for the reserved address.** `decidePublicPage` answers it
     from a constant, so loading one would be a database round trip whose answer
     is thrown away — and it would put a public read of a slug no article may
     have into the log on every visit. */
  const wanted = READ_METHODS.includes(method) && slug !== PUBLIC_LIBRARY_SLUG && isSlug(slug);
  const load = wanted ? await loadHead(slug, read) : null;
  const decision = decidePublicPage(method, slug, load, shell.sha256);

  const body = composeShell(shell.html, decision.head, mode, view);
  res.statusCode = decision.status;
  for (const [key, value] of Object.entries(decision.headers)) res.setHeader(key, value);
  res.setHeader("Content-Length", String(Buffer.byteLength(body, "utf8")));
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}
