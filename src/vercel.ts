/**
 * The API in production: one function, every route.
 *
 * On this laptop the API is Vite dev middleware — `configureServer` in
 * vite.config.ts, a hook that does not exist in a production build. `vite build`
 * emits static assets and nothing else, so without this file the deployed site
 * is a client with no server behind it. This is the other end of the seam
 * src/routes.ts describes in its own header: `handleApi` is deliberately
 * transport-free, and this file is the transport.
 *
 * **It must stay small.** Every route comes along for free because `handleApi`
 * already takes `(IncomingMessage, ServerResponse)` and Vercel's Node runtime
 * already gives you exactly those. If this file starts growing route knowledge,
 * the seam has sprung a leak — put the logic in src/routes.ts instead.
 *
 * ## Where this file is, and where it runs from
 *
 * The source lives in `src/`; `api/index.js` is a short forward to the compiled
 * copy. Both halves are deliberate, and api/index.js says why.
 *
 * One consequence worth knowing, because it fails silently: this file is
 * **bundled**, so `import.meta.dirname` inside anything it imports is the
 * bundle's directory, not that module's own. src/db/ssl.ts finds the CA
 * certificate by walking up from `src/db/`, which does not survive the move — so
 * production sets `PGSSLROOTCERT` explicitly. That is why `/api/health` reports
 * the TLS mode: without the certificate the connection still works and is still
 * encrypted, it just stops checking who it is talking to.
 *
 * ## The one thing not to touch
 *
 * **Never read `req.body`.** Vercel's helpers define it as a lazy getter that
 * consumes the request stream; `readBody` in src/routes.ts consumes that same
 * stream itself. Touching `req.body` here — even in a log line — would leave
 * every POST reading an empty body and being told its JSON was fine but empty.
 *
 * docs/plans/deploy-and-repo-move.md § The steps
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { errorFields, log } from "./log.js";
import {
  captureFailure,
  flushMonitoring,
  initMonitoring,
  withMonitoringScope,
} from "./monitoring.js";
import { UNEXPECTED_FAILURE } from "./messages.js";
import { handleApi } from "./routes.js";
import { health } from "./vercel-health.js";

export const config = { runtime: "nodejs" };

/**
 * Start error reporting once per instance, not once per request.
 *
 * At module scope because that is the one piece of code a Vercel function runs
 * exactly once, on a cold start, before any request exists. `initMonitoring` is
 * idempotent and is a no-op without `SENTRY_DSN`, so this line does nothing at
 * all on a laptop, in a test, or on a deployment nobody has configured.
 *
 * Note what it deliberately is *not*: an `--import ./instrument.mjs` flag, which
 * is what Sentry's ESM guide asks for. That flag exists so the SDK can hook
 * module loading and auto-instrument libraries for **tracing**, and tracing is
 * off here (src/monitoring.ts says why). Error capture needs a client and a
 * transport, both of which `Sentry.init` builds on the spot. Adding the flag
 * would also mean editing `NODE_OPTIONS` on the Vercel project, which already
 * carries `--experimental-require-module` and is one string — see
 * docs/project/deployment.md.
 */
initMonitoring();

/**
 * The path the browser actually asked for, recovered from the rewrite.
 *
 * `vercel.json` sends every `/api/*` request to this one function via
 * `/api/index?__spy_path=$1`, because Vercel's bracketed filenames capture a
 * single segment and would 404 nearly every route here (api/index.js has the
 * measurements). A rewrite replaces the path the function sees, so without this
 * every request would arrive claiming to be `/api/index` and `handleApi` — which
 * routes on `req.url`, and in several places on its query string too — would
 * 404 the lot.
 *
 * The captured value **must** be decoded exactly once, because Vercel encodes it
 * exactly once when it substitutes `$1` into a query value. `/api/jobs/abc/retry`
 * arrives as `__spy_path=jobs%2Fabc%2Fretry`, and an earlier version of this
 * function kept it raw on the theory that decoding would corrupt slugs
 * containing `%`. That was backwards: decoding is the inverse of the platform's
 * own encoding, so a literal `%` reaches us as `%25` and comes back as `%`.
 * Keeping it raw is what corrupted things — every multi-segment route answered
 * "No API route for /api/jobs%2Fabc%2Fretry", which reads like a routing bug in
 * our code and is not.
 *
 * A value that will not decode cannot have come from that encoder, so it is
 * refused rather than guessed at.
 *
 * Two `__spy_path` parameters means one of them came from the client, who is
 * then choosing which route runs. That is refused rather than resolved: picking
 * either one is a guess, and the guess is a routing bypass.
 */
export function originalUrl(raw: string): string | null {
  const cut = raw.indexOf("?");
  if (cut === -1) return raw;

  const PREFIX = "__spy_path=";
  const rest: string[] = [];
  let captured: string | null = null;
  let seen = 0;

  for (const part of raw.slice(cut + 1).split("&")) {
    if (part.startsWith(PREFIX)) {
      seen += 1;
      captured = part.slice(PREFIX.length);
    } else if (part) {
      rest.push(part);
    }
  }

  if (seen > 1) return null;
  /* Not rewritten at all — which is the normal case in development, where this
     same handler is never used, and would also be the case if the rewrite in
     vercel.json were ever removed. Leaving the URL alone is right in both. */
  if (captured === null) return raw;

  let path: string;
  try {
    path = decodeURIComponent(captured);
  } catch {
    return null;
  }

  return `/api/${path}${rest.length ? `?${rest.join("&")}` : ""}`;
}

/**
 * Every request, inside one isolation scope and one flush.
 *
 * The wrapper is separate from `serve` below for two reasons, both of which
 * were review findings rather than taste.
 *
 * **The scope.** Fluid Compute runs several requests concurrently in one
 * instance — the same fact behind src/log.ts's rule against a module-level
 * "current request" — so anything attached to Sentry's *global* scope would
 * turn up on another request's error, intermittently. One isolation scope per
 * invocation, opened here, is what makes the tags on an issue belong to the
 * request that raised it.
 *
 * **The reach.** The `finally` has to cover the health route and the URL
 * restoration too, not just the routed body. An earlier version put the try
 * inside, after both, so a failure in either was the one kind of failure this
 * whole exercise is for and the one kind that went unreported.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return withMonitoringScope(async () => {
    try {
      await serve(req, res);
    } finally {
      /* **The line without which none of this works.** A Vercel function
         freezes the instant its handler resolves, and Sentry's transport is an
         in-memory buffer drained by a background worker that then never runs.
         So the events that go missing are the ones raised at the end of a
         request — which is all of them. src/monitoring.ts § flushMonitoring.

         Awaited rather than handed to `waitUntil`: awaiting keeps the
         invocation alive until the buffer drains, which is the property we
         need, and it costs no new dependency. The response has already been
         written by this point, so nothing a reader is waiting for is held up by
         it. */
      await flushMonitoring();
    }
  });
}

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const restored = originalUrl(req.url ?? "");
  if (restored === null) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Ambiguous request path" }));
    return;
  }
  /* Mutated before anything reads it. `handleApi` takes the request as it finds
     it, which is exactly what makes it transport-free and reusable — so putting
     the URL right is this file's job, not its. */
  req.url = restored;

  const path = restored.split("?")[0] ?? "";

  /* Answered here rather than in src/routes.ts on purpose: it reports on the
     deployment — which store, which TLS mode, whether the database answers —
     and none of that is the application's business. It also has to work when
     the application does not. */
  if (path === "/api/health") {
    await health(req, res);
    return;
  }

  try {
    const handled = await handleApi(req, res);
    if (handled) return;
    /* handleApi only claims `/api/*`. Anything else reaching this function means
       the routing in vercel.json sent us something it shouldn't have, so say so
       rather than returning a generic 404 that looks like a missing article. */
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `No API route for ${path}` }));
  } catch (err) {
    /* The same shape as the dev middleware's error path in vite.config.ts, and
       for the same reasons: reaching here means handleApi's own `finally` never
       ran, so this is the only line this request will ever get. The path is
       stripped of its query string before it goes anywhere near the message —
       redaction matches key paths, never text, so a `?token=…` written into a
       message would be unredactable. See docs/project/logging.md. */
    log("http").error(
      { ...errorFields(err), method: req.method, path, status: 500 },
      `${req.method} ${path} 500`,
    );
    /* Anything reaching here escaped handleApi's own catch, which means it is
       unexpected by definition — there is no "did it name its own status?"
       question to ask, the way there is in src/routes.ts. */
    captureFailure(err, { method: req.method, path, status: 500 });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      /* Not `(err as Error).message`. This is the last-resort catch, so what
         is in here is the raw text of whatever escaped every other handler — a
         database driver's message, a parse error quoting its own input, an SDK
         error built from an upstream response body. None of that is ours to
         publish, and the reader could not act on it anyway. The whole error is
         already in the log line above, where somebody can. */
      res.end(JSON.stringify({ error: UNEXPECTED_FAILURE.message }));
    } else {
      res.end();
    }
  }
}
