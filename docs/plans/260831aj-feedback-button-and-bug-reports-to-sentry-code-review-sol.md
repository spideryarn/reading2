I would not ship this yet. The store design is mostly sound, but the Sentry boundary and delivery bookkeeping both make claims the built code does not uphold.

## Findings

### 1. Blocker: replacing two scopes still leaves the global scope—and its attachments

[feedback.ts](/home/greg/code/spideryarn2/src/feedback.ts:171) replaces the isolation and current scopes. Sentry’s `prepareEvent` starts with the global scope, then merges those two scopes into it; it also appends all scope attachments after the caller’s `hint.attachments` ([prepareEvent.js](/home/greg/code/spideryarn2/node_modules/@sentry/core/build/esm/utils/prepareEvent.js:24)).

The test seeds only isolation and current scopes ([feedback-mirror.test.ts](/home/greg/code/spideryarn2/tests/feedback-mirror.test.ts:112)). Its module-level helpers also write current scope, not global scope.

I reproduced this against the installed SDK and the final fake-transport envelope:

- `getGlobalScope().setExtra("globalProse", "ARTICLE_PROSE_MARKER")` reached `event.extra`.
- `getGlobalScope().addAttachment({ filename: "ambient.txt", data: "PROVIDER_BODY_MARKER" })` added a second attachment containing those bytes.

No production call currently writes global scope, but “nobody currently uses this SDK API” is not a final allowlist. Client/global event processors are another post-construction mutation point.

Insist on a guard at the final envelope/transport boundary, after scope merging and event processors, or a genuinely isolated feedback transport. Add hostile global extras, a global attachment, and an event processor to the envelope test; assert the exact attachment set and contents. `safeEvent` and `sanitise` are correctly not relied upon here.

### 2. Blocker: several caller-controlled strings and bytes cross boundaries under allowlisted field names

There are multiple concrete channels:

- [routes.ts](/home/greg/code/spideryarn2/src/routes.ts:3762) interpolates an arbitrary JSON key into `httpError`: `Unexpected field: ${key.slice(0, 40)}`. `logRequest` writes that message as `reason`. An authenticated caller can therefore stream arbitrary prose or PII into logs, 40 characters per invalid request, without reaching the rate limiter. This directly breaks the plan’s “no request text in any `httpError` message.” Use fixed prose.

- [feedback-payload.ts](/home/greg/code/spideryarn2/src/feedback-payload.ts:184) rebuilds object keys, but many values are merely length-capped: API `path`, `vercelId`, timestamps, article slug/revision/view/mode/block IDs, and job id/step/status. For example, `blockIds` accepts 200 arbitrary 64-character strings, and API paths preserve arbitrary path segments. A caller can place article prose or a provider body inside those named slots. Validate identifier shapes and closed vocabularies; record route templates rather than raw paths.

- [requestVercelId](/home/greg/code/spideryarn2/src/routes.ts:3663) truncates an inbound header but does not validate its shape, then [feedback.ts](/home/greg/code/spideryarn2/src/feedback.ts:122) makes it a Sentry tag. The code is relying on Vercel overwriting the header, rather than establishing the invariant itself.

- [sniffScreenshot](/home/greg/code/spideryarn2/src/feedback-payload.ts:308) checks only eight PNG bytes or three JPEG bytes. `PNG_SIGNATURE || articleProse` passes and is stored and forwarded. Valid PNG/JPEG containers can also carry arbitrary text metadata, EXIF, or appended bytes. Decode and re-encode pixels server-side, with dimension limits, so the forwarded bytes are genuinely constructed by the server.

The current tests exercise unknown top-level diagnostics and an SVG with no image prefix. They do not cover hostile values inside allowed fields or a prefixed polyglot.

### 3. Blocker: `mirrored_at` means “capture was requested,” not “Sentry took it”

[mirrorFeedback](/home/greg/code/spideryarn2/src/feedback.ts:183) calls `captureFeedback`, receives an event ID synchronously, and immediately calls `markMirrored`.

The SDK then processes and sends the event asynchronously. Its `sendEvent` does not return the send promise, and `sendEnvelope` catches transport failures and resolves with an empty result ([client.js](/home/greg/code/spideryarn2/node_modules/@sentry/core/build/esm/client.js:330)). Thus a network failure, processor drop, rate limit, or disabled transport can leave `mirrored_at` populated although nothing arrived.

The “Sentry outage” test at [feedback-route.test.ts](/home/greg/code/spideryarn2/tests/feedback-route.test.ts:358) mocks a synchronous throw from `captureFeedback`. That is not how a real transport outage behaves; the test passes while the production failure mode remains broken.

The reverse window also exists: Sentry can receive the event and the database update can fail, leaving `mirrored_at` null. Manual replay can then duplicate it. That crash window was accepted, but false positive delivery was not. Consequently, `mirrored_at is null` is not trustworthy in either direction.

Choose one honest contract:

- Record `mirror_attempted_at` and stop claiming delivery; or
- Obtain a per-event transport acknowledgement before marking delivered.

Also make `markMirrored` conditional on `mirrored_at is null` and report whether a row changed. That does not eliminate the send/mark crash window, but it prevents silent overwrites.

### 4. High: the lock is plausible, but the tests never exercise concurrency

The order in [pg-feedback.ts](/home/greg/code/spideryarn2/src/store/pg-feedback.ts:195) is correct under PostgreSQL’s default `READ COMMITTED`:

- Lock before idempotency closes the uniqueness race.
- Idempotency before the cap gives retries the right answer.
- One transaction-scoped lock per transaction cannot deadlock by lock ordering.
- `hashtext` collisions only serialize unrelated owners.
- Transaction-scoped advisory locks work through Supabase’s transaction pooler.

However:

- The duplicate and cap tests are sequential ([feedback-store.test.ts](/home/greg/code/spideryarn2/tests/feedback-store.test.ts:267)). Delete the advisory-lock statement and all of them still pass.
- Correctness implicitly depends on `READ COMMITTED`. Under `REPEATABLE READ`, the lock statement can establish a snapshot before waiting; reads after the wait can miss the preceding transaction. Drizzle supports explicitly setting `isolationLevel: "read committed"`.
- The window compares database `created_at` values with application `Date.now()`. Clock skew can weaken or over-tighten the cap. Use one database clock for the cutoff and retry time.

Add two genuine `Promise.all` tests: concurrent same-ID submission must yield exactly one `created`, and eleven distinct concurrent IDs must yield exactly ten `created` plus one `limited`.

### 5. Medium: the outer body cap rejects bodies accepted by the inner validator

[MAX_FEEDBACK_BODY_BYTES](/home/greg/code/spideryarn2/src/routes.ts:286) allows the screenshot’s exact base64 expansion plus 96 KiB. But the diagnostics arrays and answers are capped in JavaScript string units, not UTF-8 bytes.

I constructed a body satisfying the current inner field limits and screenshot sniff:

- Actual JSON: 662,501 bytes
- Outer limit: 631,640 bytes

It is rejected by `readBody` before the validator can explain anything. The existing test proves only that one megabyte is rejected; it does not prove the largest accepted report fits. Derive a conservative byte ceiling from the complete schema and add a maximum-valid positive test.

## Tests that currently overclaim

- “Anonymous gets 401” is useful as a global gate regression, but removing `/api/feedback` entirely leaves it green. It is not evidence about this route.
- The concurrency tests are serial.
- The Sentry-outage test models a synchronous SDK throw, not a transport failure.
- The hostile-envelope test omits global scope and global attachments.
- The screenshot test omits valid-prefix garbage and metadata.
- The successful-request log test cannot detect the unexpected-key leak.
- The body-limit test has no maximum-valid positive control.

## What held up

The HTTP mapping is right: `201 created`, `200 duplicate`, and `429 limited` with a correctly rounded delta-seconds `Retry-After`. Duplicate lookup is owner-scoped, so one owner cannot learn another’s report. The auth behavior matches the project rules: anonymous requests get 401, while ownership is hidden by scoped reads rather than 403. Store success logs do not include the three answers or email, and guarded database failures do not expose Drizzle parameters.

## Changes I would insist on

1. Close the egress boundary: final-envelope allowlisting, fixed validation errors, semantic diagnostics validation, and server-side screenshot decode/re-encode.
2. Make mirror state honest and test a real asynchronous transport failure.
3. Add real concurrent store tests, explicitly pin `READ COMMITTED`, use the database clock, and add a maximum-valid body test.

Until the first two are fixed—and the concurrency claim has a test capable of disproving it—I would not ship.