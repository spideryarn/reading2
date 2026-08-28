/**
 * The reader's half of error monitoring. The server's is
 * [src/monitoring.ts](../monitoring.ts), and **the rules are the same file** —
 * [src/monitoring-scrub.ts](../monitoring-scrub.ts), which both import, so
 * neither can drift into a laxer version of the other.
 *
 * What is different here is the failure this exists to catch. On the server it
 * is a 500 nobody saw. In the browser it is the **blank page**: a throw during
 * render, or a module that fails to evaluate, leaves an empty `#root` and no
 * message anywhere. `www.spideryarn.com` was exactly that for a few hours on
 * 2026-08-26, and the only reason anybody found out was that Greg looked.
 *
 * ## What is deliberately off
 *
 * - **Session Replay.** It records the screen, and the screen is somebody's
 *   article. Not a cost decision.
 * - **Tracing.** Greg scoped it out, and note that the way to turn it off is to
 *   *omit* `tracesSampleRate` rather than set it to `0` — see the long note in
 *   src/monitoring.ts, because zero means "sampling nothing", not "off".
 * - **Breadcrumbs.** `maxBreadcrumbs: 0`, no `breadcrumbsIntegration`, and
 *   `safeEvent` drops them anyway. Three locks, because the default set records
 *   `console` arguments — and [`src/web/upload.ts`](upload.ts) logs 400
 *   characters of an upstream response body, while
 *   [`src/web/lib/api.ts`](lib/api.ts) logs the server's response body. Both
 *   would have gone straight to Sentry as breadcrumbs on the next error.
 * - **`browserApiErrorsIntegration`**, which wraps timers and event handlers to
 *   attribute errors better. It is safe, and it is instrumentation we do not
 *   need for a bare error report.
 */
import {
  captureException,
  dedupeIntegration,
  getIsolationScope,
  globalHandlersIntegration,
  init,
  withScope,
} from "@sentry/react";

import { type Fields, safeEvent, sanitise } from "../monitoring-scrub.js";

/**
 * The commit, compiled in by `define` in vite.config.ts.
 *
 * Declared behind a `typeof` guard at its use site, the same shape
 * src/vercel-health.ts uses, because **there is no `define` in dev** — the
 * constant simply does not exist there, and a bare reference is a
 * `ReferenceError` on the first line of the app.
 */
declare const __SPIDERYARN_BUILD_COMMIT__: string;

let started = false;

/**
 * Start reporting, if there is anywhere to report to.
 *
 * `VITE_SENTRY_DSN` rather than `SENTRY_DSN`: Vite only exposes variables with
 * its own prefix to client code, and this one is **read at build time and
 * compiled into the bundle**. That is the trap documented for
 * `VITE_SUPABASE_URL` in docs/project/deployment.md — setting it on the Vercel
 * project changes nothing until the next build — and it applies here in full.
 *
 * No DSN means every function in this file returns immediately, which is what
 * keeps `npm run dev` and every test exactly as they were.
 *
 * **And a DSN is no longer enough on its own.** The server's rule 1 in
 * src/monitoring.ts explains why at length; the short version is that "no DSN
 * locally" was true only until somebody put one in `.env.local`, and this file
 * runs in the browser under `npm run dev` where the server's half does not.
 * `import.meta.env.PROD` is false for the dev server and true for a built
 * bundle, which is the boundary wanted, and unlike the server's `VERCEL` it is
 * compiled in rather than read at runtime — so a dev bundle cannot be talked
 * into reporting by an environment variable.
 */
export function initClientMonitoring(): void {
  try {
    if (started) return;
    const dsn = import.meta.env.VITE_SENTRY_DSN;
    if (!dsn) return;
    if (!import.meta.env.PROD) return;
    started = true;

    init({
      dsn,
      environment: import.meta.env.VITE_VERCEL_ENV ?? import.meta.env.MODE,
      /* **The same string the server reports and the maps were uploaded
         under.** Three producers, one value, from `resolveBuildStamp()`. If
         they disagree, Sentry has the map and will not use it — and says
         nothing about why, which is the shape of failure this whole change
         keeps running into. */
      release: typeof __SPIDERYARN_BUILD_COMMIT__ === "string" ? __SPIDERYARN_BUILD_COMMIT__ : undefined,
      /* Off, then two added back by name. The browser default set includes
         breadcrumbs (see the header), `httpContext` (which attaches
         `location.href`, the referrer and the user agent), and the linked-errors
         walk over `err.cause` that would send each link's message. */
      defaultIntegrations: false,
      integrations: [
        /* The one that does the work: `window.onerror` and
           `onunhandledrejection`. Without it nothing is reported automatically
           and this whole file is decoration. It hands the raw error to Sentry,
           which is why `beforeSend` has to be an allowlist rather than a tidy-up
           — see monitoring-scrub.ts. */
        globalHandlersIntegration(),
        dedupeIntegration(),
      ],
      maxBreadcrumbs: 0,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        stackFrameVariables: false,
        frameContextLines: 0,
      },
      beforeSend: safeEvent,
    });
  } catch {
    /* A monitoring library that will not start is not a reason for the app not
       to start. Same rule as the server half, and it matters more here: this
       runs before React does, so a throw would be the blank page it exists to
       report. */
  }
}

/**
 * Say who is reading, so an issue names a person rather than a browser.
 *
 * > Make sure we send up the user's email address (if logged-in) as part of
 * > every error.
 * >
 * > — Greg, 2026-08-28
 *
 * `null` clears it, which is what a sign-out must do: the next error on this
 * tab belongs to nobody, and leaving the old address on the scope would attach
 * it to whoever picks the iPad up next.
 *
 * ## Why this is called from `lib/api.ts` and not from here
 *
 * The obvious version subscribes to `supabase.auth.onAuthStateChange` in this
 * file. That would be a bug, and an expensive one: this module is imported by
 * [boot.tsx](boot.tsx), so importing `lib/supabase.js` here would pull Supabase
 * into the **entry chunk** — where it is evaluated *before* boot.tsx's first
 * statement runs, because static imports always are. And `lib/supabase.ts`
 * throws at module load when its two build-time variables are missing, which is
 * precisely the blank-page failure boot.tsx exists to report. So the obvious
 * placement would have moved that throw to before the reporter was armed, and
 * quietly undone the one thing boot.tsx is for.
 *
 * `lib/api.ts` already has an `onAuthStateChange` listener, lives in the main
 * chunk, and is evaluated well after Sentry is running. It calls this.
 */
export function setClientMonitoringUser(user: { id: string; email?: string } | null): void {
  try {
    if (!started) return;
    getIsolationScope().setUser(
      user === null ? null : { id: user.id, ...(user.email && { email: user.email }) },
    );
  } catch {
    // As below.
  }
}

/** Report a failure the app caught itself — the error boundary, chiefly. */
export function captureClientFailure(err: unknown, context?: Fields): void {
  try {
    if (!started) return;
    const { error, withheld, props } = sanitise(err);
    withScope((scope) => {
      scope.setTag("message_withheld", withheld);
      for (const [key, value] of Object.entries({ ...props, ...context })) {
        if (value !== undefined && value !== null) scope.setTag(key, String(value));
      }
      captureException(error);
    });
  } catch {
    // As above.
  }
}
