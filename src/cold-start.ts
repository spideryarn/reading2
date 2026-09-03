/**
 * **What a cold start cost, said once per instance.**
 *
 * The two numbers nothing else in this app can see. `api/index.js` does
 * `await import("../api-dist/vercel.js")` — a 3.4 MB unminified bundle that
 * statically imports jsdom, pg + drizzle, Stripe and the Anthropic SDK — and the
 * request clock in src/routes.ts starts *after* that. So a `GET /api/library`
 * line saying 10 ms is true and is not the wait, and the invisible part is
 * exactly the part a reader notices on the first open after a break.
 * docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 1.
 *
 * ## The seam, and why the timing is taken somewhere else
 *
 * `api/index.js` is plain JavaScript, deliberately outside the compiled bundle
 * (its own header says why), so it cannot import src/log.ts — the logger lives
 * on the far side of the very import being measured. It therefore does the one
 * thing it can do without importing anything: read `performance.now()` either
 * side, and hand the numbers to `reportBundleImport` / `reportFirstRequest`,
 * which src/vercel.ts re-exports for it. **The measuring happens outside the
 * logged world; the logging happens inside it**, and neither half knows the
 * other's business.
 *
 * ## Why the once-per-instance decision is here and not there
 *
 * `api/index.js` calls both on **every** request, unconditionally, and this
 * module drops all but the first. One decision, in one place, that a test can
 * reach — tests/cold-start-report.test.ts. The alternative (a flag in
 * `api/index.js` too) is the same rule written twice, and the copy in the file
 * that cannot be imported is the copy nothing checks.
 *
 * The module-level flags are per-instance state, which is precisely the scope
 * wanted: a Vercel function evaluates this module once on a cold start and then
 * serves however many requests before it freezes. That is also why this is not
 * rule 4 in src/log.ts ("no module-level current request") — nothing here is
 * about a request, and the second and later requests are what it exists to
 * ignore.
 *
 * ## Why two numbers rather than one
 *
 * GPT Sol's review of the plan, and it is the finding that matters: a
 * handler-local dynamic import would make the import timer look faster while
 * merely moving the same wait later in the same request. `firstRequest` brackets
 * the whole invocation — import included — so it cannot be improved by moving
 * work around inside it. One number alone would report a success that had not
 * happened.
 *
 * ## Why `health`
 *
 * `Component` in src/log.ts is a closed union, and its `health` arm is described
 * there as being for the things that report on the **deployment** rather than on
 * the application. A cold start is a property of a function instance, not of any
 * article, reader or route — nobody asked for it and no request is really its
 * subject. That is `health` exactly, and a sixteenth component for two lines an
 * instance would be a filter nobody would think to build.
 */
import { log } from "./log.js";

/**
 * Whether each number has already been said. Reset only by
 * `resetColdStartReporting`, which exists for the tests.
 */
let saidImport = false;
let saidFirstRequest = false;


/**
 * Whole milliseconds, like `since()` in src/log.ts.
 *
 * `performance.now()` differences arrive as `8843.808092000001`, and the seventh
 * decimal place of a number about to be compared against a 600 ms threshold is
 * noise wearing precision's clothes. Same unit and same rounding as every other
 * `ms` in the logs, so these lines can be charted beside them.
 */
function whole(ms: number): number {
  return Math.round(ms);
}

/**
 * **How long `await import("../api-dist/vercel.js")` took.**
 *
 * Called on every request and logged on the first. On a warm invocation the
 * import resolves from the module cache in microseconds, so the readings after
 * the first are not small cold starts — they are not cold starts at all, and
 * mixing them in would make the median of these lines a number about warm
 * requests wearing the cold start's name.
 */
export function reportBundleImport(ms: number): void {
  if (saidImport) return;
  saidImport = true;
  log("health").info({ phase: "moduleImport", ms: whole(ms) }, "cold start: module import");
}

/**
 * **How long the first invocation took end to end**, from the top of
 * `api/index.js`'s handler to the response being written — the import included.
 *
 * Reported from a `finally`, so a first request that threw still contributes its
 * number: a cold start that ends in a 500 is still a cold start, and losing it
 * would bias the figure towards the requests that went well.
 *
 * Under Fluid Compute several requests can be in flight in one instance, so
 * "first" means the first to *finish*. That is the honest reading of it and it
 * is the right one anyway — whichever finishes first paid for the import.
 */
export function reportFirstRequest(ms: number): void {
  if (saidFirstRequest) return;
  saidFirstRequest = true;
  log("health").info({ phase: "firstRequest", ms: whole(ms) }, "cold start: first request");
}

/**
 * Forget that either number has been said. **For tests only.**
 *
 * A fresh instance is what production gets, and a test file is one process
 * serving many "instances" — without this, every case after the first would
 * assert about a module that had already spoken, and would pass by measuring
 * silence.
 */
export function resetColdStartReporting(): void {
  saidImport = false;
  saidFirstRequest = false;
}
