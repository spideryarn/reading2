# Feedback

The **Feedback** button in the top-right corner, the dialog behind it, and the two places a bug
report ends up. Part of
[dev-and-deployment-overview.md](dev-and-deployment-overview.md).

Greg asked for it on 2026-08-31:

> I want to add a `Feedback` button somewhere, perhaps top-right. It should pop up a dialog box,
> with a request from the user to describe "Steps to reproduce", "What you expected to see", and
> "What you saw instead". It should always send the user-email. It should give them the option
> (default-false) to send extra diagnostics (screenshot, relevant article contents, warning/error
> messages, contents of web browser errors/logs/console, etc). And anything else that will help us
> correlate it with our Vercel logs.

The design work, the options weighed and the two reviews that changed it are in
[the plan](../plans/260831aj-feedback-button-and-bug-reports-to-sentry.md). This doc is the map.

## The shape of it

```
FeedbackDialog.tsx  ──POST /api/feedback──▶  routes.ts  ──▶  Postgres `feedback`   (authoritative)
                                                        └──▶  Sentry               (best effort)
```

**The row is written first and it is the report.** The reader is told the report landed because the
row landed; the Sentry item is a mirror for the sake of the tools that already watch Sentry, and it
cannot fail the request. Only a *newly created* row is mirrored — Sentry does not dedupe feedback
events, so a retry would otherwise file the same bug twice there while filing it once here.

**The browser posts to us rather than to Sentry directly**, which is the load-bearing architectural
choice and the plan argues it at length. In one line: it is the only arrangement where the
authentication, the validation, the consent and the durable copy all happen somewhere we control.

Its cost is real and named — **when our API is down, the way to report that our API is down is also
down** — and the answer is not a browser-direct backdoor but the Copy button the dialog shows on a
failed send, so the reader still has their words and somewhere to put them.

## Where the code is

| what | file |
|---|---|
| the corner button, and who sees it | [`src/web/FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) |
| the dialog | [`src/web/FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) |
| the diagnostics allowlist, shared by both halves | [`src/feedback-payload.ts`](../../src/feedback-payload.ts) |
| the client ring buffer the diagnostics read | [`src/web/log-buffer.ts`](../../src/web/log-buffer.ts) |
| the route | [`src/routes.ts`](../../src/routes.ts), § feedback |
| the store, the idempotency and the rate cap | [`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts) |
| the Sentry mirror | [`src/feedback.ts`](../../src/feedback.ts) |
| the guard on the final Sentry envelope | [`src/feedback-envelope.ts`](../../src/feedback-envelope.ts) |
| the screenshot, taken apart and written again | [`src/feedback-image.ts`](../../src/feedback-image.ts) |
| the table | [`src/db/schema.ts`](../../src/db/schema.ts), § feedback |
| the reader-facing sentences | [`src/messages.ts`](../../src/messages.ts), § feedback |

## The one rule

**A feedback report is the one place in this app where a reader's own prose is deliberately allowed
to leave.** Everywhere else, [`safeEvent`](../../src/monitoring-scrub.ts) exists to stop exactly
that: [security-map.md](security-map.md) and [logging.md](logging.md) are built on the idea that
article text and reader text do not go to third parties.

So this is an **exception, and it is stated out loud rather than smuggled in**. What makes it
legitimate is consent: the reader typed those three answers into a box labelled with what happens to
them. Nothing else gets the same permission, and the exception does not widen `safeEvent` by one
byte — the feedback path builds its own payload rather than relaxing the scrubber.

That gives the rule for anyone adding a field:

> Everything in a report is either **something the reader typed into this dialog**, or **a value
> from a closed vocabulary we wrote**. There is no third category, and "it is probably fine" is not
> one.

Three things follow, and each of them was got wrong once before it was got right:

- **Never the raw URL.** In this app the address bar carries `?q=` and `?find=`, which are the
  reader's own typing, and `/add/<a whole third-party URL>`, which may carry a credential. The
  report carries a route *kind* from a list, a validated slug, and nothing else off the address.
  [url-state.md](url-state.md) is what makes the address that rich in the first place.
- **Never an `Error.message` or a stack.** Error messages in this codebase have four separate times
  turned out to contain the article. Reports carry an error's *name*, and only a name **on a closed
  list** — `safeDiagnosticName` in [`src/feedback-payload.ts`](../../src/feedback-payload.ts), the
  built-in and `DOMException` names plus the three error classes `src/web/` authors. `Error.name` is
  writable, so a shape check was not one: `PROVIDER_BODY_MARKER` is a perfectly good identifier.
  Anything off the list is recorded as `Error` — reduced, not dropped, because the row's timestamp is
  half of what the buffer is for. Held at both ends, so neither trusts the other.
- **Never the `console`.** Greg's request said "contents of web browser errors/logs/console", and
  taken literally that is a leak — see below.

## The tick-box, and what is behind it

Default false, as Greg asked. Ticked, it adds:

- **The last few requests this page made** — method, route template, status, duration, and
  `x-vercel-id`. That last one is the answer to Greg's *"anything else that will help us correlate
  it with our Vercel logs"*: it is the id Vercel logs the request under, it is readable because
  these are same-origin, and **nothing else in this repo ties a browser to a line in a server log**.
  [vercel-hosting-deployment.md](vercel-hosting-deployment.md) is how you then find it.
- **The names of recent client errors.**
- **Which article and which passages** — ids, never prose. [block-ids.md](block-ids.md) is why an id
  is enough: every feature already addresses text that way, and we have the text in our own Postgres.
- **Facts about the browser and the screen.** These are behind the tick-box rather than always-on
  because they are facts about *the reader* rather than about the application, and together they
  fingerprint.

Untick it and the collector is never called at all. Three separate things enforce that — the client,
the route (`[fb-consent]`), and a CHECK on the table — and the client's is the only one that stops
the collection happening rather than merely refusing the result.

### The console is not scraped, and that is a correction to the request

Patching `console.error`/`console.warn` and shipping what they say would collect what *other* code
chose to print. The survey found the specific reason it is unsafe here: `logFailure` in
[`src/web/lib/api.ts`](../../src/web/lib/api.ts) prints 300 characters of a response body, and
`upload.ts` prints 400 — both of which can be article text.

Greg's own replacement is better and is what shipped:

> perhaps we could add some logging library that stores local state ephemerally that normally just
> gets thrown away (or has a fixed FIFO length), but could be included in the error message as a
> rich log of what happened in the runup to the problem?
>
> — Greg, 2026-08-31

That is [`src/web/log-buffer.ts`](../../src/web/log-buffer.ts): a fixed-capacity ring, written
through one narrow function, holding flat already-truncated values. **The property that makes it
safe is that we write the log calls**, so it is an allowlist by construction — the exact opposite of
a console interceptor. Its four rules, and the evidence behind each, are in the plan.

## The screenshot

The reader takes their own (⌘⇧4, PrtScn) and **pastes, drops, or picks** it. There is no one-click
capture: `html2canvas` cannot parse `oklch()`, which is what Tailwind v4 emits throughout our CSS,
so the most obvious library is the one that would visibly misrender every shot it took. The full
spike — including the candidate that *would* work and why it is still deferred — is in the plan.

**PNG only, and the server rebuilds it.** The bytes are taken apart and a new file is written from
the raster, so everything that leaves us is a constant, a validated number, or pixel data. A JPEG
cannot be given that treatment without a baseline decoder, so one is refused — in practice this is
nearly invisible, because the client's own canvas round-trip turns whatever was pasted into a PNG
before it is sent. The reasoning, and the 34 MB of Vercel bundle that the obvious alternative would
have cost, are in [`src/feedback-image.ts`](../../src/feedback-image.ts).

## Trying it locally

**It needs the Postgres store, and that is not the default.** `SPIDERYARN_STORE` is `files` unless
you say otherwise, and the files branch answers `POST /api/feedback` with a 501 by design — there is
a Postgres implementation and a filesystem *refusal*, the same asymmetry `AdminStore` and
`VisibilityStore` have ([`src/store/index.ts`](../../src/store/index.ts)). So:

```
SPIDERYARN_STORE=postgres npm run dev
```

Without it the button is there, the dialog opens, and Send fails with a sentence saying this copy of
the app cannot file reports — which is correct behaviour and looks exactly like a bug if you do not
know about this paragraph. [supabase-local.md](supabase-local.md) is how to get Postgres running at
all.

## Reading the reports

There is no admin view. The first ones get read with `psql` against the `feedback` table
([database.md](database.md)) and in Sentry
([sentry-error-monitoring.md](sentry-error-monitoring.md)). Building a view is worth doing once
there are reports to read.

Two columns worth knowing when you do:

- **`mirror_attempted_at` and `mirrored_at` are different questions.** The first is set when we hand
  the report to the SDK; the second only when a transport acknowledgement comes back. They were one
  column until GPT Sol pointed out that the SDK sends asynchronously and swallows transport
  failures, so the single column said "delivered" about reports that never arrived. A row with an
  attempt and no delivery is the interesting one.
- **`request_vercel_id`** is the feedback POST's own id, read from the request headers on the
  server — the browser cannot put its own response header into its own request.
