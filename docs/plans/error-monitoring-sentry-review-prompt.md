# Review: adding Sentry error monitoring to Spideryarn

You are reviewing a **plan, before it is built**. Read
`docs/plans/error-monitoring-sentry.md` first — that is the artefact under
review. Then read enough of the code it names to check its claims.

Read-only. Do not change any files.

## The app, briefly

TypeScript, ESM throughout, deployed to **Vercel Pro with Fluid Compute**.
A Vite/React 19 SPA plus **one** Node serverless function: `api/index.js` is a
thin forward to `api-dist/vercel.js`, which is `src/vercel.ts` bundled by
`vite.api.config.ts` (SSR mode, everything external, `minify: false`). All
routing is in `src/routes.ts` (`handleApi`), transport-free, mounted as Vite dev
middleware locally. Logging is Pino to stdout via `src/log.ts`. An ingest queue
in `src/jobs.ts` does work after the HTTP response has returned.

Files worth reading: `src/log.ts`, `src/routes.ts` (the `logRequest` /
`serveApi` catch at the bottom), `src/vercel.ts`, `api/index.js`,
`vite.api.config.ts`, `vite.config.ts`, `src/store/db-errors.ts`,
`src/jobs.ts`, `docs/project/logging.md`, `docs/plans/error-boundary.md`.

## What I most want from you

**1. The privacy design — is it right, and is it enough?**
`docs/plans/error-boundary.md` records the same class of bug found four separate
times: text this app did not write (article prose, the reader's selected quote, a
model's answer, every bound SQL parameter) ends up inside `Error.message`. Sentry
is a new, fifth egress for exactly that, and it leaves the machine.

The plan's answer is an allowlist-shaped `scrub` in `beforeSend`: send the error's
class and its stack frames, drop `err.message` unless the class is on a short
allowlist of errors we authored. Attack that. Specifically:

- Is dropping the message the right trade, or is it so damaging to Sentry's
  usefulness that it will be quietly reverted in a month? Is there a third option
  I have missed?
- **Stack frames are not obviously safe either.** Does Sentry's frame data carry
  anything beyond file/line/function — and does `frameContextLines` (default 5)
  reading our own source files pose any risk I have not thought about? What about
  the client, where a frame is resolved through an uploaded source map?
- The plan turns off every `dataCollection` category except `frameContextLines`.
  Is that list complete for `@sentry/node@10.71.0` and `@sentry/react@10.71.0`?
  Is there any other default — an integration, a `contexts` field, `extra`, the
  `request` object, breadcrumbs — that would carry untrusted text or a secret and
  is not covered?
- **Breadcrumbs specifically.** `maxBreadcrumbs` defaults to 100. On the client,
  do the default breadcrumb integrations record `fetch`/XHR URLs, console output,
  or DOM text? Several of this app's URLs contain a slug; some console output has
  historically contained article text. On the server, does anything record the
  Pino output as breadcrumbs?

**2. The flush.** Vercel freezes the process at response time, so Sentry's
buffered transport loses events unless flushed. The plan awaits
`Sentry.flush(2000)` in a `finally` in `src/vercel.ts`. Check:

- Is awaiting inside the handler actually sufficient on Vercel's Node runtime, or
  is `waitUntil` (from `@vercel/functions`) the correct mechanism now?
- The app **streams** several routes (SSE, see `sse(res)` in `src/routes.ts` and
  `src/openrouter-stream.ts`). Does a flush in a `finally` interact badly with a
  response that has already ended, or with a client that disconnected?
- `src/jobs.ts` runs steps **after** the response. Its Sentry events have no
  later moment to flush. Is per-step flushing right, or is the queue already
  broken on Vercel in a way that makes this moot? (Read `src/jobs.ts` and say
  what you actually find, rather than assuming.)
- Fluid Compute serves several requests concurrently in one instance.
  `src/log.ts` has a whole rule about this (no module-level "current request").
  **Does the plan have the equivalent bug?** Sentry's global scope is
  module-level. Should captures be wrapped in `Sentry.withIsolationScope`, and
  does the plan's design accidentally attribute one request's context to
  another's error?

**3. The dependency.** `@sentry/node@10.71.0` pulls in `import-in-the-middle`,
`@opentelemetry/instrumentation`, `@opentelemetry/sdk-trace-base` and five more.
We want **error capture only** — `tracesSampleRate: 0`,
`registerEsmLoaderHooks: false`, no auto-instrumentation.

- Is `registerEsmLoaderHooks: false` the right lever, and does it actually stop
  the OTel machinery loading, or only stop it hooking?
- What is this likely to cost in cold start for a function that is already
  bundling `jsdom`, `pg` and the Anthropic SDK as external deps? Is there a
  lighter official package (`@sentry/node-core`?) that does error capture only?
- The plan names a fallback: post to Sentry's envelope endpoint by hand, ~60
  lines, no dependency. Given this repo's stated "prefer boring" principle, is
  that actually the better call here? Argue it properly, including what it costs
  (grouping, source-map resolution, frame parsing).
- `vite.api.config.ts` leaves everything non-relative external. Confirm
  `@sentry/node` will be traced and packaged correctly by Vercel that way, and
  flag anything about its native/ESM shape that would break the way
  `html-encoding-sniffer` did (that file documents an `ERR_REQUIRE_ESM` that only
  reproduced in the deployed function).

**4. The capture seams.** The plan captures from three places: the outer catch in
`serveApi`, `runStep`'s catch in `src/jobs.ts`, and `src/vercel.ts`. It reuses
`logRequest`'s existing rule — *did the error name its own status?* — to decide
expected vs unexpected, rather than the status code.

- Read that code. Is the rule actually reusable the way the plan claims, or does
  it have edge cases (e.g. `ChatConflict`, `ENOENT`→404, `db-errors.ts`'s
  translated errors, which now carry a `status`) that would make real bugs
  invisible?
- Are there important failure paths the three seams **miss**? Unhandled
  rejections, the SSE generators, `readBody`, the auth gate, top-level module
  failures.
- The plan deliberately does *not* hook `src/log.ts`. Agree or disagree.

**5. Anything about the Vercel/Sentry integration story that is wrong.** The plan
claims: the native Marketplace integration is closed to existing Sentry orgs; the
non-native one only sets env vars and marks releases; a log drain to Sentry is not
a real path because Sentry has no endpoint for Vercel's log schema; and therefore
with zero code changes you get nothing. Check any of that you can.

**6. The source-map change.** `vite.config.ts` gains `build.sourcemap: "hidden"`
plus `sentryVitePlugin` last. Several agents share this working tree and build
locally with no `SENTRY_AUTH_TOKEN`. Is "no-op without a token" reliably
achievable with `@sentry/vite-plugin@5.4.0`, or does it warn/fail in ways that
will annoy people? Is `"hidden"` right, or should it be `true`?

**7. Anything else.** Tests that should exist and are not in the plan. Ordering
mistakes. Anything that will fail *silently* — this repo has a whole document
about that pattern (`docs/reusable/silent-success.md`) and it is the failure mode
I care most about catching here.

## How to answer

Findings first, most important first, each with: what is wrong, why it matters
here specifically, and what to do instead. Say which claims you verified by
reading a file and which are from your own knowledge. If you think a part of the
plan is right, say so briefly rather than padding — but do say so, because I need
to know what you actually checked.
