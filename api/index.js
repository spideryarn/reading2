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
 * Everything here is behind the deployment's login wall, so the stack is not
 * being handed to strangers.
 */

export default async function handler(req, res) {
  let handle;
  try {
    ({ default: handle } = await import("../api-dist/vercel.js"));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify(
        {
          error: "The compiled API failed to load",
          hint: "api-dist/vercel.js is built by `vite build --config vite.api.config.ts`, which vercel.json runs as part of the build command.",
          message: err?.message ?? String(err),
          code: err?.code ?? null,
          node: process.version,
          stack: String(err?.stack ?? "").split("\n").slice(0, 15),
        },
        null,
        2,
      ),
    );
    return;
  }
  await handle(req, res);
}
