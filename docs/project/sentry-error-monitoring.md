# Sentry: what broke while nobody was watching

**It is installed, and it is on.** Built 2026-08-27 — free tier, errors only — and `SENTRY_DSN` was
verified set in production on 2026-08-28.

That first line is the point of the doc. On 2026-08-28 an agent grepped the repo, found nothing it
recognised, and told Greg there was no error tracking here — while `src/monitoring.ts` and a live DSN
sat in front of it. **Check before concluding we do not have this.**

Logs and error tracking answer different questions. A log tells you what happened during a request
while you are watching; retention is one day. An error tracker tells you something broke when you
were *not*, groups the thousandth occurrence with the first, and keeps the stack trace for 30 days.
The other two places to look are in [debugging.md](debugging.md).

## How to look at it

**There is a Sentry MCP**, at `https://mcp.sentry.dev/mcp`, and this repo registers it in
[`.mcp.json`](../../.mcp.json) — so this is a tool call once you have run `claude mcp login sentry`
in a browser, and a browser tab until you have. This doc said the opposite until 2026-08-31, which
is the mistake in its own opening paragraph made a second time: the Sentry MCP had shipped and
`claude mcp add --help` was already using it as its worked example. `SENTRY_ORG` and
`SENTRY_PROJECT` are set on the Vercel project (`npx vercel env ls production` lists them; the values
are encrypted, so read them from the Sentry UI or ask Greg).

A failed ingest step arrives tagged `step`, `slug` and `jobId`, from `captureFailure` in
[`src/jobs.ts`](../../src/jobs.ts).

## What reaches it, and what does not

**Capture is an explicit call beside the log line, never a side effect of logging.** The seams are
[`src/routes.ts`](../../src/routes.ts)'s outer catch, a call on each streaming route's own failure,
a second on several of them for a failure to *record* the result, and
[`src/jobs.ts`](../../src/jobs.ts)'s failed step and pump.

**The count moves every time a mode ships, so ask rather than read it here** — this paragraph said
"three streams" until 2026-09-05, by which time `routes.ts` alone held thirteen. Ask with
`grep -c 'captureFailure(' src/routes.ts`, and note the trailing `(`: without it the import line is
counted too and the answer is one too many.

**The rule for the request seams is the status we answered with**, `>= 500` — the same threshold
`logRequest` uses to choose between `warn` and `error`, so the log and the tracker cannot come to
disagree about what counts as a fault.

**`pinoIntegration` exists and must never be added.** It would forward log lines to Sentry, and the
whole design of [logging.md](logging.md) rests on stdout being the only destination. The two
subsystems must be able to fail independently: a log call never throws, and that guarantee is worth
more than the convenience.

### Why a failed step is a 200

`advanceJob` answers **200** on a job whose step threw, so the `>= 500` rule would never have
reported it — which is exactly why `src/jobs.ts` captures explicitly instead.

The 200 is correct. The call did what it was asked: it ran a step and recorded a failure on the job.
Returning 500 would turn a recorded *application* failure into a *transport* failure, and
[`src/web/useJobs.ts`](../../src/web/useJobs.ts) **retries** transport failures. The reader is not
misled either — the shelf renders a red card carrying the error. GPT Sol's call, 2026-08-28,
reviewed in [260828at-html-ingest-var-data-sol.md](../plans/260828at-html-ingest-var-data-sol.md).

What the 200 *does* hide is the whole class from Vercel's error dashboard, which only sees 5xx —
[vercel-hosting-deployment.md § the trap](vercel-hosting-deployment.md#the-trap-get_runtime_errors-will-not-show-you-an-application-failure).
The comment in `src/jobs.ts` § `runStep` says why the explicit capture is there: *"the reader sees a red
card, and without this nobody else ever hears about it."*

## It is a fifth egress, and the logging rules apply to it

Everything [260826p-error-boundary.md](../plans/260826p-error-boundary.md) says about an `Error.message` carrying
article text is *more* true when the message leaves the machine:

- `Error.message` is dropped unless it ends in a code from [`src/messages.ts`](../../src/messages.ts)
- the whole event is rebuilt from an allowlist in
  [`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts)
- the SDK's own defaults — which include the local variables of every stack frame — are turned off
  one by one

The full build, the options reference and the source-map story are in
[260827y-error-monitoring-sentry.md](../plans/260827y-error-monitoring-sentry.md).

## A feedback report is the one thing here `beforeSend` never sees

A reader pressing **Feedback** files a row in Postgres and a copy in Sentry
([`src/feedback.ts`](../../src/feedback.ts)). That copy does **not** go through `safeEvent`, and
this is worth knowing before you assume otherwise:

`beforeSend` is routed only for an *error* event — `client.js` checks `isErrorEvent(event)`, which
is `event.type === undefined` — and `captureFeedback` builds an event with `type: "feedback"`. So
the allowlist that rebuilds every error event before it leaves never runs on this one. Nothing had
to be loosened for the feature, and nothing is guarding it either.

Two consequences, both deliberate:

- **The reader's own words go, on purpose.** They typed them into a box that says where they go,
  having pressed a button labelled Feedback. That is consent, and it is a different thing from a
  leak. It is the only channel in the app with that property.
- **Consent licenses the message, not the machinery.** So `src/feedback.ts` builds the payload
  rather than cleaning it — and, because `prepareEvent` merges global + isolation + current scope
  data, it captures on **two fresh scopes**. Building the parameters field by field is *not* enough:
  measured against a hostile scope with a fake transport, extras, contexts, tags, breadcrumbs and a
  `user` carrying `username` and `ip_address` all reached the envelope.

### Two fresh scopes were not enough either

`prepareEvent` starts from the **global** scope and merges the other two into it, and an event
processor runs after all three. So the guard that actually closes this seam sits at the
**envelope**, on the line before the transport: [`src/feedback-envelope.ts`](../../src/feedback-envelope.ts),
which **rebuilds** the outgoing feedback item from what `mirrorFeedback` registered before it
captured. Only `event_id` and `timestamp` are taken off the event, both shape-checked; every
attachment is written from the registration, so an ambient scope attachment wearing our own filename
is not merely filtered, it is never copied.

`server_name` no longer rides, reversing a line in the plan: it is a free-form string an event
processor can write and no check can tell a hostname from a paragraph. `contexts.runtime` stays,
rebuilt from two shape-checked fields.

[`tests/feedback-mirror.test.ts`](../../tests/feedback-mirror.test.ts) asserts on the final envelope
rather than on the object handed to the SDK, because a test that captures on a clean scope proves
nothing — and it now seeds global extras, a global attachment and an event processor, each of which
was verified to reach the envelope before the guard went in.

### `mirrored_at` used to mean "we asked", and now says what it means

`captureFeedback` returns an event id **synchronously** and the SDK sends later: `Client.sendEvent`
does not return the send promise, and `sendEnvelope` catches every transport failure and resolves an
empty result. So a row could say Sentry had taken a report that never arrived — the shape
[silent-success.md](../reusable/silent-success.md) is about, in the one column that finds a stranded
report. Since 2026-09-01 there are two:

| column | written when |
|---|---|
| `mirror_attempted_at` | the event was handed to the SDK — a thing we know |
| `mirrored_at` | the transport answered **2xx**, via the SDK's `afterSendEvent` hook |

So **`mirror_attempted_at is not null and mirrored_at is null` is the query for a report Sentry did
not take.** The acknowledgement is best-effort with a two-second ceiling and is awaited *after* the
reader has been answered, so it costs a warm function and never a spinner; if it does not arrive the
row honestly says attempted-not-confirmed.

### A screenshot is decoded and written again, and only PNG

The bytes a reader pastes are taken apart and a new file is written from the raster
([`src/feedback-image.ts`](../../src/feedback-image.ts)) — so text chunks, EXIF, private chunks and
anything appended after `IEND` are never copied rather than filtered out. **JPEG is refused**,
because its entropy-coded scan cannot be length-checked without a baseline decoder. `@napi-rs/canvas`
would decode both and is already a dependency; naming it from the API function was measured at
**+34 MB** in the Vercel bundle and turns `tests/pdf-bundle-trace.test.ts` red, so that trade is
Greg's to make rather than one to slip into a bug fix.

The reasoning in full, including the table of what leaked, is in
[260831aj-feedback-button-and-bug-reports-to-sentry.md](../plans/260831aj-feedback-button-and-bug-reports-to-sentry.md).

## The two gaps, both open

**Nothing alerts.** Sentry receives the event and waits for somebody to open a dashboard. The useful
shape is an alert on the structured `step failed` events. On 2026-08-28 every ingest on the live site
had been failing and the way we found out was Greg trying to read an article.

### The health check cannot see it

`SENTRY_DSN` is **not** in the list of variables `/api/health` reports, and
[`initMonitoring`](../../src/monitoring.ts) returns silently when the DSN is absent. So *"monitoring
is switched off"* and *"monitoring found nothing"* are the same picture from outside — the shape
[silent-success.md](../reusable/silent-success.md) is about. The fix is one entry in the health
check's env list, and it is not done.

## Related docs

- [debugging.md](debugging.md) — which of the three places to look, and in what order
- [vercel-hosting-deployment.md](vercel-hosting-deployment.md) — the one-day half, and its traps
- [logging.md](logging.md) — why capture is not wired through the logger
- [security.md](security.md) — what may leave this machine at all
- [260827y-error-monitoring-sentry.md](../plans/260827y-error-monitoring-sentry.md) — the plan it was built from

---

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md)
