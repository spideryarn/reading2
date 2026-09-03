/**
 * **jsdom, loaded the first time something actually parses HTML.**
 *
 * ## Why this file exists
 *
 * `api/index.js` answers every request by `await import`ing a single 3.5 MB
 * `api-dist/vercel.js`, and the server's own request clock only starts after
 * that. jsdom was statically imported by six modules in that bundle
 * (`blocks`, `extract`, `sanitize`, `collect-assets`, `injection-scan`,
 * `chat-tools`), so a bare `GET /api/library` — which never parses any HTML —
 * paid for all of it before it began.
 *
 * Measured on the built bundle by swapping jsdom for an empty stub and timing
 * the import both ways, interleaved: **~1.0 s of a ~3.3 s module import, about
 * a third**, and by some distance the largest single item that the shelf does
 * not need. drizzle is bigger still and is on the shelf's own query path, so it
 * is a floor rather than a target.
 * docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 4.
 *
 * ## Why `createRequire` rather than `await import`
 *
 * Because the alternative is not a smaller change, it is a different program.
 * `splitIntoBlocks`, `readArticle`, `imageUrlsIn`, `articleLinks` and
 * `sanitizeHtml` are **synchronous** exported functions with call sites and
 * tests all over the repo, and `await import("jsdom")` inside any of them turns
 * that whole chain async — which is the redesign this stage was told to stop
 * and report rather than slip in.
 *
 * jsdom is CommonJS, so `require` loads exactly what the static ESM import
 * loaded — Node's ESM loader for a CJS dependency goes through the same CJS
 * cache — and it does it **synchronously**. Nothing above this line changes.
 *
 * ## The one way this could fail, and what stops it
 *
 * A specifier the deployment's file tracer cannot read is how two production
 * outages started here (src/pdf.ts, docs/postmortems/260827a-pdfjs-dommatrix-serverless.md):
 * the bundle ships, the package does not, and every request 500s. `require` is
 * a literal call with a literal string, which is exactly what `@vercel/nft`
 * reads — but "exactly what it reads" is an opinion until something asks it.
 * `tests/pdf-bundle-trace.test.ts` runs the real tracer over the real built
 * bundle and now asserts jsdom's entry point is collected, which is the only
 * check here that is not another opinion about what the tracer probably does.
 *
 * **Not for the browser.** Everything in this file is server-side by
 * construction; the client's sanitiser is src/web/sanitize.ts and shares none
 * of it.
 */
import { createRequire } from "node:module";

import type * as Jsdom from "jsdom";

/**
 * Resolved from **this module's own location**, which after bundling is
 * `api-dist/vercel.js` — one directory below the deployment root, so the walk
 * up to `node_modules/jsdom` is the same one the static import made. In
 * development and under vitest it is `src/jsdom-lazy.ts` and the answer is the
 * same package.
 */
const nodeRequire = createRequire(import.meta.url);

/** Memoised, so the cost is paid once per process rather than once per call. */
let cached: typeof Jsdom | null = null;

/**
 * The jsdom module. Synchronous, and free after the first call.
 *
 * Callers destructure what they need at the top of the function that needs it:
 *
 * ```ts
 * const { JSDOM, VirtualConsole } = jsdom();
 * ```
 *
 * Do **not** hoist that to module scope — that is the static import again,
 * wearing a function call.
 */
export function jsdom(): typeof Jsdom {
  cached ??= nodeRequire("jsdom") as typeof Jsdom;
  return cached;
}
