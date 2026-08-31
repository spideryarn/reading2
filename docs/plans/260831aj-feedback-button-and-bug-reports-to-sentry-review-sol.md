The core decision is sound: reader-entered feedback is a legitimate, consented exception, and it should not weaken `safeEvent`. Your load-bearing Sentry conclusion is also correct.

I would not build the current plan yet, though. The proposed diagnostic payload is not actually closed, and the table/delivery contract is still underspecified.

## Findings

### 1. The diagnostic allowlist still has several direct leak paths

The largest problem is [`location.href` being sent in full](/home/greg/code/spideryarn2/docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md:199).

In this app, the URL can contain:

- Reader-entered search text in `q` or `find`.
- An entire third-party URL under `/add/…`, including credentials or query tokens.
- Auth callback or recovery parameters.
- Future parameters the feedback code knows nothing about.

That directly contradicts the existing decision to disable `httpContext` and URL query collection. Send a parsed, versioned location instead: route kind, validated article slug, closed mode values, block IDs, and other specifically allowed state. Never send the raw query string or `/add/` target—even with diagnostics enabled.

The proposed raw stack is unsafe too. The assertion that “a stack is code locations” is weaker than the existing scrubber’s reasoning. [`safeFrame`](/home/greg/code/spideryarn2/src/monitoring-scrub.ts:82) strips queries/fragments and excludes context lines, locals, absolute paths and future fields. A browser `Error.stack` can also contain:

- The error message on its first line.
- Full URLs with query strings.
- `data:`, `blob:` or extension URLs.
- Eval text.
- Arbitrary writable `Error.name` values.

Do not export and reuse the private `authored()` boolean. Export a shared `safeDiagnosticError()` that returns an identifier-shaped error type, an authored message if allowed, and parsed allowlisted frames. Or omit stacks from the attachment.

Also, viewport, user agent, language, timezone, colour scheme and reduced-motion preference are browser/device diagnostics. They are about the reader and can fingerprint them. They belong behind the default-off checkbox. Safe route state, build commit and environment can reasonably remain core report metadata.

Finally, “field-by-field parameters” does not prove the final Sentry envelope is allowlisted. `captureFeedback()` builds its event and then calls `scope.captureEvent()`, where scope data and event processors can add user, extras, contexts, breadcrumbs and trace context. That is precisely the ambient enrichment [`safeEvent` removes from errors](/home/greg/code/spideryarn2/src/monitoring-scrub.ts:112).

Use a fresh or cleared scope, explicitly re-add the trusted `{id, email}`, and test the actual fake-transport envelope—not merely the object handed to `captureFeedback`. Seed hostile extras, contexts, breadcrumbs and user properties in the test. There is a `beforeSendFeedback` hook, but it fires before scope capture and cannot serve as the final allowlist.

For Sentry’s feedback UI, pass the gate’s email explicitly as `SendFeedbackParams.email`; automatic scope `user.email` is a separate field.

### 2. The durable report and two-destination semantics are not defined yet

The table stage currently names only the three answers, `owner_id`, and `created_at`. Before generating the migration, the plan must decide the complete persisted report:

- Client-minted report ID and uniqueness rule.
- Reporter-email snapshot, or an explicit decision that every reader must join `auth.users`.
- Safe route/app context and build.
- Whether diagnostics were consented to.
- Diagnostics schema/version and contents.
- Screenshot presence and where its bytes live.
- Feedback request’s Vercel ID.
- Whether Sentry mirror state/event ID is recorded.

The screenshot stage explicitly leaves “Postgres or Sentry alone” undecided. That needs settling before the table is built. If diagnostics or screenshots exist only in Sentry, the claim that the durable row is the authoritative report is false for those parts.

For a simple v1, I would store bounded diagnostics as versioned `jsonb`, store a small processed screenshot as `bytea`, and keep the stable/queryable fields as columns. If keeping screenshots only in Sentry is preferred, say plainly that they are best-effort attachments rather than part of the durable copy.

The Sentry mirror also has an unavoidable retry window:

1. Insert row.
2. Send to Sentry.
3. Process dies or response is lost.
4. Client retries the same ID.

Because feedback is not deduped, retrying the mirror can create duplicate Sentry items; not retrying can leave a row that never reached Sentry. The plan should choose semantics rather than let the implementation choose accidentally. The simplest honest policy is:

- The row is authoritative.
- The store returns a discriminated `created | duplicate | limited` result.
- Mirror only a newly created row.
- Accept and document the small crash window, optionally recording `mirrored_at` for manual replay.

If “table and Sentry” must be guaranteed rather than normal-case behaviour, this needs an outbox/retry mechanism.

The rate limit belongs inside that same store operation. A standalone `count` followed by `insert` is raceable: concurrent requests all see the same count and all insert. Under Postgres, check idempotency first, then serialize per owner inside a transaction—an owner-scoped transaction advisory lock is adequate here—count over an indexed `(owner_id, created_at)`, and insert. A named limit such as 10 reports/hour is sufficient for an authenticated alpha v1 against loops and one-account abuse. It is not a defence against account farming, and need not pretend to be.

For screenshots, client downscaling is not validation. The server must enforce decoded-byte size, use constant filename/content type, and never forward a client-supplied MIME type or filename.

### 3. The console correction is right, but “three seams see every failure” is false

Refusing to scrape `console.*` is the right decision. Opt-in cannot make arbitrary console arguments safe.

The proposed replacement under-delivers slightly because the named seams are incomplete:

- [`upload.ts`](/home/greg/code/spideryarn2/src/web/upload.ts:105) uses XHR and never passes through `apiFetch`.
- `Tweets.tsx` catches and logs a failure, so it reaches neither the global listener nor `AppBoundary`.
- `leavingFetch` has its own failure case.
- `attempt`’s catch sees transport failures, but “recent API calls” requires recording successful and non-2xx responses too.
- `AppBoundary` errors do not fit the stated API-row shape of method/path/status/request ID.

Use a discriminated union such as `api`, `upload`, and `client-error`, with one narrow recording function. Instrument the explicit production seams and never accept general console arguments. Strip query strings from API paths before recording them; `apiFetch("/api/library/search?q=…")` otherwise captures reader text.

This gives Greg more useful information than console scraping without recreating breadcrumbs.

## Architecture and existing-code checks

Server relay is still the right primary architecture. It centralizes auth, validation and consent, and ensures the owned row lands first. The missing cost is correlated failure: when the API or Postgres is down, the feedback channel is down too—the exact time it may be most useful. I would keep the server relay and add a visible copy/email fallback after a failed submission, rather than silently introducing browser-direct Sentry.

`x-vercel-id` is the right platform identifier. Vercel documents it in response headers, and its custom error-page token is explicitly said to match the request ID; runtime logs expose `requestId` as a searchable field. It is readable from same-origin responses. [Vercel request headers](https://vercel.com/docs/headers/request-headers.rsc), [runtime logs](https://vercel.com/docs/logs/runtime), [custom error pages](https://vercel.com/docs/custom-error-pages).

Two refinements:

- Read the feedback POST’s own `x-vercel-id` from `req.headers` on the server and attach it directly. The client cannot include that request’s response header in the request itself.
- Treat prior API response IDs as optional, length-capped values. Do not enable tracing.

The current plan now records Greg’s later Postgres-only decision. Given the imminent deletion of the filesystem store, the 501 adapter is the correct choice. But two corrections follow:

- The earlier architecture claim that the server path “works locally and writes a row” is now false until local development moves to Postgres.
- [`tests/store-parity.test.ts`](/home/greg/code/spideryarn2/tests/store-parity.test.ts:1) does not automatically discover a new store contract. A 501 implementation creates no parity obligation; add a focused test proving the files branch refuses and the dialog reports that refusal. Had JSONL remained the choice, explicit parity tests, serialized writes, idempotency/rate semantics and a separate test file would all have been required—the adapter would not be twenty lines.

The cited schema-drift exact list, FK pattern, `createFree` logging rule, route `call()` helper, `fitView`, and migration number `0039` are accurate. `pg-reader.ts` is not the best model for the write itself, though: it is a scalar upsert, while feedback is append-only, idempotent and rate-limited. `pg-comments` plus the transactional stores are closer precedents.

The dialog precedent is also wrong. Feedback interrupts the page, so it should follow the native modal [`Lightbox`](/home/greg/code/spideryarn2/src/web/Lightbox.tsx:10), not the non-modal `AnnotateDialog`. Native `<dialog>` provides inert background, focus trapping/restoration, top-layer rendering and Escape handling. With three populated fields, AnnotateDialog’s “first Escape clears the box” behaviour would be especially destructive.

The plan also needs explicit tests that the button is absent for anonymous readers and that the server still returns 401. The UI stage currently does not name its signed-in mounting condition.

Finally, remove `git pull` from preparation. In this shared tree it can merge/rebase into other agents’ in-progress work and conflicts with the working agreements.

## Changes I would insist on before implementation

1. Replace raw URL/raw stack/device-always-on diagnostics with a versioned allowlist, and prove the final Sentry envelope using hostile scope state and the fake transport.

2. Define the complete persisted report and dual-write semantics before generating the table—including email, consent, diagnostics, screenshot storage, idempotency, and an atomic owner rate cap.

3. Build the diagnostic collector before exposing its checkbox, cover all named production failure seams with discriminated records, and use a native modal with explicit signed-in visibility.

Read-only review only; I changed no files.