/**
 * **Tell Vercel there is work left after the response.**
 *
 * A Vercel instance is suspended once its response is complete — not when the
 * handler's promise settles. Anything awaited after `res.end` (the feedback
 * mirror and its acknowledgement, the Sentry flush) therefore ran only when a
 * later request happened to wake the same instance, minutes later or never:
 * 13 of Greg's reports on 2026-10-01 never reached Sentry, and 86% of all rows
 * never recorded an acknowledgement.
 * docs/postmortems/261002b-a-pipeline-whose-only-consumer-reads-the-lossy-copy.md.
 *
 * The platform's answer is the request context's `waitUntil`. This is the read
 * `@vercel/functions` makes (its `get-context.js`), without the package: the
 * package is five lines here and twenty-three packages in the lock, through
 * `@vercel/oidc`. docs/plans/261002b-feedback-reports-lost-after-the-response.md.
 *
 * **The price of reading it by hand is that it could stop matching silently**,
 * if the platform ever moved the symbol. So it may not: on a deployment
 * (`VERCEL` set) with no `waitUntil` to be found, `keepAlive` says so, once per
 * instance. Off Vercel — the dev server, the tests — there is no context, and
 * nothing is said, because awaiting is all there is and all that is needed.
 */
import { log } from "./log.js";

/** The symbol the platform's request context is published under. */
export const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

interface RequestContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

let warned = false;

/**
 * Hand `promise` to the platform so the instance stays awake until it settles.
 * Returns whether anything took it. Never throws: it runs on every request, and
 * a failure here is not a reason not to serve (rule 2 of src/monitoring.ts).
 */
export function keepAlive(promise: Promise<unknown>): boolean {
  try {
    const holder = (globalThis as unknown as Record<symbol, { get?: () => RequestContext } | undefined>)[
      VERCEL_REQUEST_CONTEXT
    ];
    const context = holder?.get?.();
    if (typeof context?.waitUntil === "function") {
      /* Called as a method, the way `@vercel/functions` calls it
         (`context.waitUntil?.(promise)`): a detached call would lose `this`. */
      context.waitUntil(promise);
      return true;
    }
  } catch {
    /* Said below, the same as finding nothing: either way the work after the
       response is not protected. */
  }
  warnOnce();
  return false;
}

/** Once per instance, and only on a deployment — off Vercel there is nothing to find. */
function warnOnce(): void {
  if (!process.env.VERCEL || warned) return;
  warned = true;
  try {
    log("http").warn(
      {},
      "no vercel waitUntil: work after the response will be frozen until the next request",
    );
  } catch {
    // Rule 2 of src/monitoring.ts.
  }
}
