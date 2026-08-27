/**
 * The fifth egress. Errors leave this machine here, and nowhere else.
 *
 * Read docs/plans/error-monitoring-sentry.md for why this exists,
 * docs/plans/error-monitoring-sentry-review-sol.md for the four blockers that
 * shaped it, and docs/plans/error-boundary.md for the rule it implements. The
 * short version of all three:
 *
 * Vercel Pro keeps runtime logs for **one day**, so a 500 on Tuesday is
 * unrecoverable on Wednesday. Sentry is how we find out about something that
 * broke while nobody was watching. And:
 *
 * > No arbitrary `Error`, and no arbitrary string, may cross an HTTP, SSE, log,
 * > or persisted-error boundary.
 * >
 * > — GPT Sol, docs/plans/error-boundary.md
 *
 * **Sentry is a fifth boundary and the worst of the four before it**, because
 * those all end on a machine we control and this one ends at a third party who
 * keeps it for a month. `Error.message` and `Error.stack` are exactly what an
 * error tracker wants, and in this codebase an `Error.message` has four times
 * turned out to contain a provider's error body, a model's whole answer, the
 * reader's selected passage, or every bound parameter of a failed SQL query.
 *
 * ## The four rules
 *
 * 1. **No DSN, no Sentry.** With `SENTRY_DSN` unset every function here returns
 *    immediately and the SDK is never initialised. That is what keeps this
 *    laptop, `npm test` and `npm run dev` exactly as they were, and why no test
 *    in this repo needs a network stub.
 * 2. **Nothing here ever throws.** The same rule src/log.ts keeps, for the same
 *    reason: monitoring must not be able to turn a working request into a
 *    failed one. Every export is wrapped.
 * 3. **`beforeSend` builds the event rather than cleaning it.** This is the
 *    load-bearing one and it is rule 6 of src/log.ts applied to a second
 *    destination. A cleaner has to anticipate every field a future SDK version
 *    might add; a builder does not. **Everything not named in `safeEvent` is
 *    dropped**, including fields nothing here has heard of.
 * 4. **Zero integrations by default.** `initWithoutDefaultIntegrations`, then
 *    three added back by name. The default set is fifteen, and five of them
 *    exist to attach exactly the things rule 3 is about — see `INTEGRATIONS`.
 */
import {
  captureException,
  dedupeIntegration,
  flush,
  initWithoutDefaultIntegrations,
  onUncaughtExceptionIntegration,
  onUnhandledRejectionIntegration,
  withIsolationScope,
} from "@sentry/node-core/light";
import { log } from "./log.js";
import { type Fields, safeEvent, sanitise } from "./monitoring-scrub.js";

let started = false;

/**
 * The three integrations kept, out of the fifteen the SDK would install.
 *
 * The twelve dropped, and why the list is worth reading rather than trusting:
 * `LocalVariables` sends the locals of every frame; `ContextLines` reads source
 * files off disk at capture time, using whatever filename the parsed stack
 * supplies and without restricting it to this project; `Console` turns every
 * `console.*` call into a breadcrumb, and **two of this repo's four leak rounds
 * were dependencies printing for us** — JSDOM quoting the page it was parsing
 * and the Anthropic SDK's own logger printing whole articles; `RequestData`
 * attaches the full request URL; `SystemError` copies an error's enumerable own
 * properties into `contexts`, which is the `FetchFailure.url` leak src/log.ts
 * already had once; `LinkedErrors` walks `err.cause` and sends each message;
 * `Modules`, `NodeContext`, `ChildProcess`, `ProcessSession`, `Http` and
 * `NativeNodeFetch` are for tracing and sessions, which are off.
 *
 * **`pinoIntegration` is available and must never be added.** It would forward
 * this application's log lines to Sentry, and src/log.ts's whole design rests
 * on stdout being the only destination.
 */
const INTEGRATIONS = [
  /* Cheap quota insurance. Not a spend cap — it drops consecutive duplicates,
     which is not the same as rate-limiting an issue — so it is a mitigation for
     a stuck loop and not a defence against one. */
  dedupeIntegration(),
  /* The two failures that never reach a `catch` anywhere. `mode: "warn"` so the
     process is not killed by the reporter: on Vercel an unhandled rejection in
     one concurrently-served request would otherwise take the others with it. */
  onUnhandledRejectionIntegration({ mode: "warn" }),
  onUncaughtExceptionIntegration(),
];

/**
 * Start reporting, if there is anywhere to report to. Idempotent.
 *
 * ## Why `@sentry/node-core/light` and not `@sentry/node`
 *
 * `@sentry/node` initialises an OpenTelemetry SDK whether or not you asked for
 * tracing, and pulls `import-in-the-middle` and eight OTel packages — about
 * 21 MB on disk — whose only job is auto-instrumenting the libraries a trace
 * would measure. GPT Sol measured cold process start locally: bare Node ~30 ms,
 * `@sentry/node-core/light` ~110–120 ms, `@sentry/node` ~190–210 ms. `light` is
 * an official exported entry point, not a private path, and error capture is
 * all of what this file uses.
 *
 * ## `tracesSampleRate` is omitted, and that is not the same as setting it to 0
 *
 * The obvious way to turn tracing off is `tracesSampleRate: 0`. It does the
 * opposite. From `@sentry/core`'s own `hasSpansEnabled`:
 *
 *     // Note: This check is `!= null`, meaning "nullish". `0` is not "nullish"
 *     return !!options && (options.tracesSampleRate != null || !!options.tracesSampler);
 *
 * So zero is a *sampling rate*, and setting one is how the SDK knows you want
 * spans at all. GPT Sol probed the installed 10.71.0: no sampling option → 17
 * default integrations; `tracesSampleRate: 0` → **44**, including Postgres,
 * Anthropic, OpenAI, GraphQL and Redis instrumentation. A textbook
 * docs/reusable/silent-success.md: the setting reads as "off", the SDK reads it
 * as "on and sampling nothing", and everything appears to work.
 *
 * ## `dataCollection`
 *
 * Every category here is **on by default** — the interface is in
 * `node_modules/@sentry/core/build/types/types/datacollection.d.ts`, and its own
 * doc comments are the authority, since the website disagrees with it about
 * `userInfo`. A partial or misshapen object resolves the omitted keys to the
 * permissive default, so the block is written out in full on purpose. Most of
 * it is redundant against `safeEvent` and `INTEGRATIONS`, and it stays anyway:
 * two independent mechanisms failing the same way is unlikely, and it is free.
 *
 * The two worth naming: `stackFrameVariables` sends the locals of every frame,
 * and `databaseQueryData` — by its own description "query parameters, inline
 * literal values within query text, mutation/request bodies, and returned
 * result data" — is precisely the Drizzle leak src/store/db-errors.ts exists to
 * stop, offered back as a feature.
 */
export function initMonitoring(): void {
  try {
    if (started) return;
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return;
    started = true;

    initWithoutDefaultIntegrations({
      dsn,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      integrations: INTEGRATIONS,
      // Nothing collects them and `safeEvent` drops them; this is the third lock.
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
    /* Rule 2. A monitoring library that will not start is not a reason for the
       server not to start. */
  }
}

/**
 * Report a failure, having first decided what a failure is allowed to say.
 *
 * `context` is for fields **we** name — a route, a step, a slug — never a value
 * off the request. It rides as tags rather than as `extra` because tags are
 * filterable in the issue list, and because `safeEvent` drops `extra`.
 */
export function captureFailure(err: unknown, context?: Fields): void {
  try {
    if (!started) return;
    const { error, withheld, props } = sanitise(err);
    /* An isolation scope per capture, never the global one. Vercel's Fluid
       Compute runs several requests concurrently in one instance — the same
       fact that gives src/log.ts its rule against a module-level "current
       request" — so a tag set globally would attach one request's route to
       another request's error, intermittently. That is the nastiest shape of
       bug there is: invisible until the moment you are relying on the report to
       tell you what happened. */
    withIsolationScope((scope) => {
      scope.setTag("message_withheld", withheld);
      for (const [key, value] of Object.entries({ ...props, ...context })) {
        if (value !== undefined && value !== null) scope.setTag(key, String(value));
      }
      captureException(error);
    });
  } catch {
    // Rule 2.
  }
}

/**
 * Get the buffered events out before the process stops existing.
 *
 * **Without this, error tracking on Vercel looks exactly like it is working and
 * silently is not.** Sentry's transport is an in-memory buffer drained by a
 * background worker; a Vercel function freezes the instant its handler
 * resolves, and the buffer freezes with it. So the events that never arrive are
 * the ones raised at the end of a request, which is all of them. Same shape as
 * the reason src/log.ts refuses Pino transports, and it fails the same way: the
 * lines you lose are the ones you wanted.
 *
 * **The return value is not discarded.** `flush` resolves `false` when the
 * buffer did not drain in time, and that is the exact silent failure this whole
 * file is meant to prevent — so it says so, once, to the one destination that
 * is definitely still working.
 *
 * Two seconds, not more. `maxDuration` is 300s, but a reader whose request has
 * already been answered should not be held open because Sentry is slow.
 */
export async function flushMonitoring(ms = 2000): Promise<void> {
  try {
    if (!started) return;
    const drained = await flush(ms);
    if (!drained) log("http").warn({ ms }, "sentry buffer did not drain before the deadline");
  } catch {
    // Rule 2.
  }
}

/**
 * Run a request inside its own isolation scope.
 *
 * The transport-level half of the rule `captureFailure` keeps per capture, and
 * the reason it is a separate export: on Vercel one instance serves several
 * requests **concurrently**, so "the current request" does not exist at module
 * scope — the same fact that gives src/log.ts its rule against a module-level
 * `currentLogger`, and the same failure if it is ignored. Tags set inside this
 * callback cannot reach a request that is running beside it.
 *
 * A no-op passthrough when there is no DSN, so the client half and the dev
 * middleware pay nothing for it.
 */
export function withMonitoringScope<T>(fn: () => Promise<T>): Promise<T> {
  if (!started) return fn();
  try {
    return withIsolationScope(fn);
  } catch {
    // Rule 2. A scope that will not open is not a reason not to serve.
    return fn();
  }
}

/** Test seam. Not for production code — `initMonitoring` is idempotent on purpose. */
export function resetMonitoringForTests(): void {
  started = false;
}

/** Test seam: the event builder, so a test can assert on what would be sent. */
export const buildSafeEvent = safeEvent;
