/**
 * The one file Vercel routes to, and deliberately the only file in `api/`.
 *
 * ## Why it is JavaScript
 *
 * Vercel's Node builder compiles any TypeScript it finds here using this repo's
 * own TypeScript 7, which it cannot drive — and then reports success and ships a
 * function that fails on every request. vite.api.config.ts has the full story.
 * The real handler is src/vercel.ts, compiled to api-dist/vercel.js by the build
 * command in vercel.json.
 *
 * ## Why it is `index.js` and not `[...path].js`
 *
 * Because `[...path].js` does not do what its name says. Vercel's filesystem
 * routing treats **every** bracketed filename as ONE path segment — the `...`
 * is not honoured outside Next.js — so it compiles to roughly `^/api/([^/]+)$`.
 * Measured on a real deployment, 2026-08-26:
 *
 *     /api/library         -> reached the function
 *     /api/article/writes  -> 404 NOT_FOUND, from the platform
 *     /api/jobs/abc/retry  -> 404 NOT_FOUND, from the platform
 *
 * which is nearly every route in src/routes.ts. It also silently appended its
 * captured segment to the query string (`/api/health?...path=health`), and
 * several routes there match against the full url rather than the path, so even
 * the routes that *did* arrive were one refactor away from 404ing too. GPT Sol
 * called both of these in review before the deployment did.
 *
 * So the catch-all is an explicit rewrite in vercel.json instead, and
 * src/vercel.ts puts the URL back together before anything routes on it.
 *
 * ## Why the import is inside the handler
 *
 * A module-level `import` that throws takes the function down before any of our
 * code runs, and Vercel answers `FUNCTION_INVOCATION_FAILED` with the reason
 * nowhere a person can reach it — no build log, no runtime log. Importing inside
 * a `try` costs one `await` on a cold start and turns "it crashed" into a stack
 * trace you can read. It is how the ERR_REQUIRE_ESM below was found at all.
 * **That sentence used to end "…and everything here is behind the deployment's
 * login wall, so the stack is not being handed to strangers." It was false.**
 * Vercel generates two production hostnames and only one was ever removed;
 * `spideryarn-greg-detre.vercel.app` answered an unauthenticated `curl` from
 * outside on 2026-08-26, and a production domain cannot be SSO-protected on the
 * Pro plan at all. See docs/project/deployment.md.
 *
 * So the reason is fixed along with the code: the stack goes to the log, where
 * `vercel logs` can reach it, and the caller gets a sentence. The comment is
 * named here rather than quietly deleted because the comment is why nobody
 * looked. GPT Sol, 2026-08-26.
 */

export default async function handler(req, res) {
  /**
   * ## Why this file holds a stopwatch
   *
   * Everything the server records about a request starts its clock inside
   * src/routes.ts — which is to say **after** the `await import` below has
   * finished loading a 3.4 MB bundle that statically pulls in jsdom, pg +
   * drizzle, Stripe and the Anthropic SDK. So a production log line saying
   * `GET /api/library 200 10ms` is true, and is not the wait. This is the only
   * place in the program that runs before that import, so it is the only place
   * the number can be taken.
   *
   * Two numbers, not one, and the second is the load-bearing one: moving the
   * heavy imports behind a handler-local dynamic import would collapse the
   * `reportBundleImport` figure while merely shifting the same wait later in the
   * same request. `reportFirstRequest` brackets the whole invocation from
   * `startedAt`, so it cannot be improved that way — only by the wait actually
   * going away.
   *
   * **The logging is not done here.** This file is plain JavaScript,
   * deliberately outside the compiled bundle (see the header above), so it
   * cannot reach src/log.ts — the logger is on the far side of the very import
   * being measured. So the seam is: take the times here, hand them across, and
   * let the compiled world decide what to say and when. src/cold-start.ts owns
   * both decisions, including "once per instance", which is why these calls are
   * unconditional — a rule kept in two places, one of them in a file no test
   * can import, is a rule kept in neither.
   */
  const startedAt = performance.now();
  let mod;
  try {
    mod = await import("../api-dist/vercel.js");
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    /* The whole thing, to the log — this is still the only place the reason for
       a failed import can be read, and that was the point of importing inside a
       `try`. `console.error` rather than src/log.ts, deliberately: reaching here
       means the module that defines the logger is the very thing that would not
       load. */
    console.error("[api] the compiled API failed to load", {
      message: err?.message ?? String(err),
      code: err?.code ?? null,
      node: process.version,
      stack: String(err?.stack ?? "").split("\n").slice(0, 15),
    });
    res.end(
      JSON.stringify(
        {
          error: "The compiled API failed to load",
          hint: "api-dist/vercel.js is built by `vite build --config vite.api.config.ts`, which vercel.json runs as part of the build command. `vercel logs` has the reason.",
        },
        null,
        2,
      ),
    );
    return;
  }
  /* `typeof`, not a bare call: a deployment whose `api-dist/` predates
     src/cold-start.ts has no such export, and a TypeError here would turn a
     working request into a 500 over a measurement. The absence of the log line
     is then the signal, which is the right cost for a diagnostic. */
  if (typeof mod.reportBundleImport === "function") {
    mod.reportBundleImport(performance.now() - startedAt);
  }
  try {
    await mod.default(req, res);
  } finally {
    /* In a `finally` so a first request that threw still reports its number — a
       cold start that ends in a 500 is still a cold start, and dropping it would
       bias the figure towards the requests that went well. Nothing in here can
       throw and displace that outcome: the `typeof` guard covers a stale bundle,
       and src/log.ts's `wrap` makes a log call structurally non-throwing. */
    if (typeof mod.reportFirstRequest === "function") {
      mod.reportFirstRequest(performance.now() - startedAt);
    }
  }
}
