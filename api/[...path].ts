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
 * ## The filename
 *
 * `[...path].ts` is Vercel's catch-all: `/api/article/writes` and
 * `/api/jobs/abc/retry` both land here with `req.url` still the URL the browser
 * asked for, which is what `handleApi` routes on. A single `api/index.ts` plus a
 * rewrite would NOT work — a Vercel rewrite replaces the path the function sees,
 * so every request would arrive claiming to be `/api/index` and `handleApi`
 * would 404 all of them.
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

import { errorFields, log } from "../src/log.js";
import { handleApi } from "../src/routes.js";
import { health } from "./_health.js";

export const config = { runtime: "nodejs" };

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0] ?? "";

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
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: (err as Error).message }));
    } else {
      res.end();
    }
  }
}
