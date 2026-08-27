Verdict: revise before build. The plan’s direction is sound, but the current configuration would both leak data and suppress real production faults.

## Findings

### 1. Blocker: numeric `status` is not a safe-message mark

The proposed message allowlist sends every error with numeric `status` unchanged. That already leaks article-derived text:

- [`term-lookup.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/term-lookup.ts:171) throws a `409` whose message contains `entry.name`.
- Several store errors interpolate slugs.
- [`owner.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/owner.ts:224) uses `status: 500` for a genuine authentication-order invariant failure.

It also damages reporting: that `owner.ts` bug would be treated as expected and never captured, while `ChatConflict` and `ENOENT` have no status and would be captured despite being mapped to expected 409/404 responses in [`routes.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3182).

Do instead:

- Introduce an explicit authored type/brand such as `PublicHttpError` or `SafeDiagnosticError`.
- Give it a stable safe diagnostic code, separate from its reader-facing message.
- Report every 5xx by default, including errors with `status: 500`; suppress only explicitly marked expected failures.
- For unknown errors, send validated constructor name plus sanitized stack.
- Use stable codes and the top in-app frame as the fingerprint. This is the useful third option between raw messages and featureless `TypeError`.
- Validate allowed values too. `code`, `syscall`, `slug`, and even `Error.name` are strings an upstream component can influence. Hash the slug if article identity is not meant to leave the system.

Dropping arbitrary messages is the right default. The mistake is treating `status` as proof that a message is authored.

### 2. Blocker: the SDK configuration is invalid and enables tracing

The plan says `tracesSampleRate: 0` disables tracing and that the default is `1.0`. Both are wrong for 10.71.0.

The exact installed implementation considers spans enabled whenever `tracesSampleRate` is non-null, including zero: [`hasSpansEnabled.js`](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/@sentry/core/build/esm/utils/hasSpansEnabled.js:3). A runtime probe found:

- No sampling option: 17 default integrations.
- `tracesSampleRate: 0`: 44 integrations, including Postgres, Anthropic, OpenAI, GraphQL, Redis and web frameworks.

The Node SDK also initializes OpenTelemetry unless `skipOpenTelemetrySetup` is true: [`sdk/index.js`](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/@sentry/node/build/esm/sdk/index.js:54). `registerEsmLoaderHooks: false` prevents the ESM loader hook; it does not prevent OTel modules being imported or initialized.

The `dataCollection` object also has three invalid shapes and two omissions. In 10.71.0:

- `genAI` is `{ inputs, outputs }`, not boolean.
- `httpHeaders` is `{ request, response }`, not boolean.
- `httpBodies` is an array; `[]` disables it.
- `graphQL` and `databaseQueryData` are missing.

See the exact interface in [`datacollection.d.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/@sentry/core/build/types/types/datacollection.d.ts:20). If forced past TypeScript, the partial object resolves omitted or malformed properties to permissive defaults in [`resolveDataCollectionOptions.js`](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/@sentry/core/build/esm/utils/data-collection/resolveDataCollectionOptions.js:3).

Do instead:

```ts
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
}
```

Omit `tracesSampleRate` entirely. If retaining `@sentry/node`, also use `skipOpenTelemetrySetup: true`, `registerEsmLoaderHooks: false`, and a curated integration list.

### 3. Blocker: `beforeSend` must guard the whole event, not only its primary message

Default integrations add substantial data independently of `dataCollection`:

- `RequestData` always adds the complete request URL; there is explicitly no `dataCollection` switch for this: [`requestdata.js`](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/@sentry/core/build/esm/integrations/requestdata.js:23).
- `LinkedErrors` adds messages from the cause chain.
- `NodeSystemError` copies enumerable error properties into `contexts`.
- Browser `HttpContext` adds `location.href`, referrer and user agent.
- Browser and server session integrations emit non-error envelopes which do not pass through `beforeSend`.
- `extra`, `contexts`, `user`, `request`, tags and breadcrumbs remain possible egresses.

“Keep stack frames in full” is unsafe too. A frame can carry `abs_path`, `module`, `platform`, `context_line`, `pre_context`, `post_context`, `vars`, addresses, debug metadata and free-form function/file names: [`stackframe.d.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/@sentry/core/build/types/types/stackframe.d.ts:2).

More seriously, Node’s context-lines integration opens whatever filename the parsed frame supplies, without restricting it to the application root: [`contextlines.js`](/Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/@sentry/node-core/build/esm/integrations/contextlines.js:125). A synthetic or modified stack can therefore cause local file contents to be attached.

Do instead:

- Start with curated integrations, preferably `initWithoutDefaultIntegrations`.
- Set `frameContextLines: 0`.
- Have `beforeSend` construct an allowlisted event: sanitized exception values, validated frames, stable fingerprint, safe tags, release/environment, and the `debug_meta` needed for source maps.
- Drop `request`, `user`, `extra`, arbitrary `contexts`, transaction names and breadcrumbs defensively.
- For frames, preserve only the fields needed for grouping/source maps; strip query strings and fragments from filenames and URLs.
- Uploading source maps will still let Sentry show original source context. It resolves from uploaded `sourcesContent`; it does not recover live DOM text or article prose. The upload itself does give Sentry the project source, including server source, which should be recorded as an accepted disclosure.

### 4. Blocker: browser breadcrumbs would immediately leak current console data

The default browser breadcrumb integration records console arguments, XHR/fetch URLs, navigation URLs and DOM interactions. [Sentry documents those defaults](https://docs.sentry.io/platforms/javascript/guides/svelte/enriching-events/breadcrumbs/).

This repo has concrete leaks:

- [`upload.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/upload.ts:114) logs 400 characters of an upstream XHR response body.
- [`api.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/lib/api.ts:94) logs the server response body.

Sentry’s integration retains both the rendered console message and the original argument array. XHR/fetch breadcrumbs do not normally include response bodies, but do include full URLs. DOM breadcrumbs do not generally send `innerText`, but serialize element paths and attributes including `aria-label`, `title`, `alt`, `name`, ids and classes.

Use `maxBreadcrumbs: 0`, remove the Breadcrumbs integration, and still delete breadcrumbs in `beforeSend`. If breadcrumbs are introduced later, allowlist specific same-origin route templates and strip dynamic paths/query strings.

On the server, default console instrumentation can create console breadcrumbs. Pino output itself will not: this app’s Pino destination writes directly to stdout, and Sentry’s Pino integration is not enabled by default. Do not add it.

### 5. High: the capture rule suppresses important errors and misses three streaming seams

Reusing `logRequest`’s rule is wrong. That rule answers “is a stack useful in this log line?”, not “should operations be alerted?”

Consequences include:

- The `owner.ts` status-500 invariant is invisible.
- Authored 502 provider failures are invisible.
- `ChatConflict` is reported even though it is expected.
- Every `ENOENT` is reported even though the route maps it to 404.
- `StoreFailure` is safe and worth reporting, but has no status and loses its authored diagnostic message under the plan.

The outer catch also never sees errors swallowed after SSE headers are sent:

- Explanation stream: [`routes.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:560)
- Chat stream: [`routes.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:1190)
- Search stream: [`routes.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:1651)

Those are some of the failures monitoring is most needed for. Capture both the primary stream failure and secondary “could not persist the failure” errors there.

`readBody` and the auth gate are inside `serveApi`’s catch and are covered. The health route and URL restoration occur before the existing `src/vercel.ts` try and are not. Wrap the entire Vercel handler.

The browser claim that initialization at the beginning of `main.tsx` covers boot failures is also false: all static imports—including `App`—evaluate before the first statement in [`main.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/main.tsx:1). To cover module-evaluation failures, make the entry initialize Sentry and then dynamically import the real application entry.

The acknowledged `api/index.js` gap is not entirely unavoidable. Its import catch could lazily load the lightweight SDK and send a narrowly constructed event. If that also fails, retain the existing console fallback.

### 6. High: the queue/flush premise is stale; use `waitUntil`

The queue does not run after the response on Vercel. [`jobs.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:508) returns immediately from `pump()` when `VERCEL` is set. Production work is driven by the browser’s long-running `/advance` request, which awaits one complete step before answering: [`routes.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3133).

Therefore:

- The queue is not already broken.
- A failed step is still inside the Vercel invocation.
- Per-step flushing is unnecessary and would duplicate lifecycle work.

Awaiting `Sentry.flush()` before the async handler resolves is sufficient to keep the invocation alive, but `waitUntil(flush())` is the intended Fluid Compute mechanism for telemetry after the response. It avoids holding response completion open and remains bounded by `maxDuration`. [Vercel explicitly recommends `waitUntil` for logging and analytics](https://vercel.com/kb/guide/troubleshooting-inconsistent-logs-in-vercel-functions); Fluid also allows several requests to share one instance. [Vercel Fluid Compute documentation](https://vercel.com/docs/fluid-compute).

Streaming is not a problem: the route awaits the stream until `res.end()`, then the handler’s finalization runs. Client-disconnect behavior deliberately continues some model work, so the flush correctly happens after that work. It cannot alter an already-ended response.

Do not discard the boolean returned by `flush(timeout)`. A `false` result is the exact silent failure this plan is meant to prevent; emit one safe local log line and test it.

### 7. High: add explicit request isolation

The SDK has global, current and isolation scopes. Fluid Compute allows concurrent requests in one process. The default HTTP integration tries to create request isolation, but this plan should not depend on automatic HTTP instrumentation—especially when initialization can occur after the cold request has already entered Vercel’s wrapper.

Wrap the whole handler in `Sentry.withIsolationScope`. Pass capture-specific tags/contexts directly or through a synchronous `withScope`. Never mutate the global scope with request, slug or route data.

Add an interleaving test: two concurrent requests with distinct safe tags, breadcrumbs and failures must produce two events with no crossed fields.

### 8. High: the server source map will never be uploaded

The build order is client first, API second: [`vercel.json`](/Users/greg/Dropbox/dev/experim/spideryarn2/vercel.json:4). The plan puts the Sentry plugin only in `vite.config.ts`, while `api-dist/vercel.js.map` is created later by `vite.api.config.ts`. The plugin cannot upload a file that does not exist yet.

Put the plugin in both builds, or run one explicit upload step after both builds. Use the same explicit release value for both.

For plugin 5.4.0:

- Missing auth token does not quietly no-op: installed code logs missing-token warnings for release creation and source-map upload.
- `disable: !token` works, but conditionally omitting the plugin is clearer.
- Set plugin telemetry off.
- With a configured token, the default upload failure stops the build. Keep that behavior: silently deploying unmapped monitoring is worse.
- Generate maps only when upload is enabled, or delete them independently. Otherwise a no-token Vercel build leaves guessable `.map` files in public `dist`.

`"hidden"` is right for production. `true` adds a public reference and weakens the fallback if deletion fails.

### 9. Medium: use the official lightweight SDK, not a hand-written envelope client

`@sentry/node-core/light` is an exported official entry point and does not initialize the full OTel runtime. It still has permissive default integrations, so use its `initWithoutDefaultIntegrations`.

Local cold-process measurements—not a Vercel forecast—were:

- Bare Node: ~30 ms
- `@sentry/core`: ~90–100 ms, +21 MB RSS
- `@sentry/node-core/light`: ~110–120 ms, +35 MB RSS
- `@sentry/node`: ~190–210 ms, +50 MB RSS

The full installed OTel tree is about 21 MB on disk. Existing `jsdom`, `pg` and Anthropic imports do not make an additional eager dependency free.

The plan overstates the manual-envelope burden: Sentry’s backend still performs grouping and source-map resolution. But a reliable manual client must parse cross-runtime stacks, construct mechanisms and envelopes, handle normalization, rate limits, retries, buffering and flush semantics. That is more than a trustworthy 60-line utility. The light SDK is the boring compromise.

Packaging should work: `@sentry/node` has dual ESM/CJS exports, requires Node 18+, and has no native addon. The emitted bare import fits the dependency-tracing rule in [`vite.api.config.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/vite.api.config.ts:101). I found no equivalent of the `html-encoding-sniffer` CJS-to-ESM trap. A deployed import/capture smoke test remains necessary because local execution cannot prove Vercel’s trace result.

### 10. Medium: the Vercel integration account story is too categorical

The conclusion “the SDK is still required” is verified: the current [Vercel Sentry Marketplace page](https://vercel.com/marketplace/sentry/sentry) explicitly tells React users to install `@sentry/react` and verify by throwing an error.

I could not independently confirm the existing-organization prohibition from Vercel’s current page. Its wording says “connect your Sentry project,” then describes completing Sentry registration. Keep the quoted Sentry statement, but verify the actual account installation screen before making it an architectural premise.

The Drains page names Dash0 and Braintrust as examples, not an exhaustive list; current Vercel material also names Statsig and Kubiks. [Vercel Drains documentation](https://vercel.com/docs/drains). The narrower claim is sound: Vercel emits its own JSON schema, while Sentry’s event/envelope ingestion expects Sentry events, so a custom drain requires a translator. A log drain is also not equivalent to exception grouping.

### 11. High: the tests need to guard silent success, not merely compilation

Add these before implementation:

- A recursive sentinel test covering every exception in the cause chain, frames, request, URLs, user, contexts, extra, tags and breadcrumbs.
- Direct regression cases for the term-lookup 409 leak, the owner status-500 bug, `ChatConflict`, `ENOENT`, and `StoreFailure`.
- Assert the resolved `dataCollection` values, not only the supplied object.
- Assert the exact enabled integration names; fail if a tracing, breadcrumb, request, session, local-variable or context-lines integration appears.
- Concurrent isolation-scope test.
- SSE failure tests for explanation, chat and search.
- Verify `flush(false)` becomes a visible safe failure.
- No-token build: no warning, no network, no client or API maps left in deployable output.
- Token build: both client and API maps uploaded under the same release, then removed.
- Far-end canary: event arrives, maps to original client and server source, expected release/environment is present, and a unique privacy sentinel is absent everywhere.
- Client static-import failure test, not only a React render-boundary test.

Also correct the quota claim: `dedupeIntegration` removes some consecutive duplicate client events; it is not a per-issue spend cap, and Sentry should not be assumed to rate-limit each issue.

## Parts of the plan that are right

- Treating Sentry as a fifth privacy egress is exactly right.
- Unknown raw messages should be dropped.
- Not wiring Sentry through `src/log.ts` is right; add explicit capture beside swallowed-error logs instead.
- No replay is essential here.
- A React error boundary is worthwhile.
- A far-end deployed canary is the right final proof.
- Hidden source maps are preferable to referenced maps.
- The three named capture seams are useful, but not sufficient.
- Awaited flushing is technically sufficient; `waitUntil` is the better Vercel lifecycle mechanism.

All repository claims above were verified by reading the named files. SDK behavior was verified against the exact installed 10.71.0/5.4.0 code and small local runtime probes. Cold-start impact remains an inference until measured on a preview deployment. No files were changed.