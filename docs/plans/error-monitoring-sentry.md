# Knowing it broke, after the day it broke

**2026-08-27.** Greg asked for production error monitoring, "probably Sentry",
and asked whether Vercel can do it from logs instead. This is the answer to
both, and the design. **Built the same day** — see [What got built](#what-got-built),
which is also where the four things this plan got wrong are recorded.

> I want to add error monitoring (probably Sentry) for production. Can you do it
> for me programmatically? Can Vercel automatically integrate with Sentry from
> logs or similar?
>
> — Greg, 2026-08-27

Scope decided by Greg the same day: **server errors and browser errors**, no
performance tracing, no session replay.

## Why now

[logging.md § Error tracking](../project/logging.md#error-tracking) already named the trigger:

> **The trigger is specific: the first time you want to look at something that
> happened more than 24 hours ago.**

Vercel Pro keeps runtime logs for **one day**. The app now has a real domain, a
database, and a reader who is not the person who deployed it. A 500 on Tuesday
is currently unrecoverable on Wednesday.

## The short answer to Greg's second question

**No — not for this account.** There are two different Vercel↔Sentry
integrations and the automatic one is closed to us.

| | Native Marketplace integration | Non-native integration |
|---|---|---|
| Who it is for | Sentry docs: *"This setup is designed for **new Sentry users** and unifies billing within the Vercel platform."* | Everyone else |
| Available to an existing Sentry org | **No.** *"There is no path for existing Sentry organizations to use the Vercel Marketplace integration."* | Yes |
| Forwards Vercel logs and traces to Sentry via Drains | Yes, in one step | Possible, but wired by hand — and see below for what a drain is and is not |
| Sets `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, DSN on the Vercel project | Yes | Yes |
| Notifies Sentry of every deployment (releases) | Yes | Yes |
| **Removes the need for the SDK in your code** | **No** | **No** |

Both sentences above are quoted from
[Sentry's Vercel integration doc](https://docs.sentry.io/organization/integrations/deployment/vercel/),
fetched 2026-08-27. Greg has an existing Sentry org, so the native path is out.

And even if it were open, the last row is the one that matters: the integration
is a *convenience layer around* the SDK, never a replacement for it. It uploads
source maps and marks releases. It does not turn a crash into an issue.

### What about a plain Log Drain?

Vercel Drains are Pro and above, billed at **$0.50/GB** of uncompressed JSON
([Vercel Drains docs](https://vercel.com/docs/drains), page dated 2026-08-25).
**This path is real** — Sentry has its own page for it
([docs.sentry.io/product/drains/integration/vercel/](https://docs.sentry.io/product/drains/integration/vercel/))
and it will take both Vercel's logs and its OpenTelemetry traces.

*(An earlier draft of this section said flatly that Sentry had no endpoint for
Vercel's log schema and that a drain would need a translator we would have to
write. That was wrong, and it is corrected rather than deleted because it was
the kind of wrong that would have settled the question.)*

What it does **not** do is turn a log line into an **issue**. Everything Sentry
is actually for here — grouping the thousandth occurrence with the first, a
source-mapped stack trace, an alert on a new kind of error — is built around
events the SDK captured, not around parsing stdout. A drain gets you the same
Pino lines in a second window, kept longer.

**So: with zero code changes you get no error tracking.** You get Vercel's
runtime logs for one day, and — for $0.50/GB — the option of keeping those same
lines somewhere for longer. Neither groups anything or tells you when something
new breaks.

### What a drain *would* be good for, later

Not errors — **retention**. A log drain to a cheap sink (Better Stack, Axiom)
would keep the Pino lines past 24 hours, which is a different question from "did
something break". Worth revisiting only if the log lines turn out to be what we
miss. Deliberately not in this plan.

## The thing that makes this harder here than in a normal app

This is the whole reason this document is longer than "npm install".

[error-boundary.md](error-boundary.md) is a record of the same bug found four
times: **text this app did not write keeps ending up inside `Error.message`** —
a provider's error body, a model's output, the reader's selected quote, the
article's own prose, every bound parameter of a failed SQL query. The rule GPT
Sol wrote for it:

> No arbitrary `Error`, and no arbitrary string, may cross an HTTP, SSE, log, or
> persisted-error boundary.

**Sentry is a fifth egress, and the worst of the five**, because the first four
stay on machines we control and this one ships the text to a third party who
keeps it for 30 days on the free tier and 90 on the paid one. `Error.message`
and `Error.stack` are precisely what an error tracker is *for*.

That doc says three of the four egress points are still open — `src/jobs.ts`,
the pipeline stages, and the chat and search modules each build their own
errors. Only the store seam is guarded
([`src/store/db-errors.ts`](../../src/store/db-errors.ts)).

**So the fifth egress gets its guard built at the same time as the egress, not
after it.** That is the one non-negotiable part of this plan.

### And the SDK's own defaults are pointed the wrong way

From
[the Node SDK's data-collected doc](https://docs.sentry.io/platforms/javascript/guides/node/data-management/data-collected/)
and [options reference](https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/),
fetched 2026-08-27. `sendDefaultPii` is off by default and is **deprecated as of
v10.54.0** in favour of a granular `dataCollection` object — whose defaults are
*on* for nearly everything:

| `dataCollection` key | SDK default | What it would mean here |
|---|---|---|
| `stackFrameVariables` | `true` | **Local variables in every stack frame.** In this codebase a local is called `html`, `article`, `answer`, or `apiKey`. This is the single most dangerous default on the list |
| `genAI` | `true` (in and out) | Generative-AI input and output content — i.e. the prompt, which contains the article, and the model's answer |
| `httpHeaders` | `true` (req and res) | `Authorization: Bearer …` on our own API calls |
| `httpBodies` | all | A comment POST body carries the reader's selected passage |
| `cookies` | `true` | The Supabase session |
| `urlQueryParams` | `true` | |
| `userInfo` | `true` | |
| `frameContextLines` | `5` | Our own source. Fine, and useful |

Every one of those except the last is turned off explicitly in this plan.

Note the shape of that table, because it is
[silent-success](../reusable/silent-success.md) waiting to happen: a
misconfigured Sentry works perfectly. Events arrive, issues group, the dashboard
looks right — and the leak is a field nobody scrolled down to.

## The design

**Read this section with [What got built](#what-got-built) beside it.** Four of
the decisions below were wrong, and GPT Sol's review
([the answer](error-monitoring-sentry-review-sol.md)) says why with evidence out
of the installed source rather than out of the documentation. They are left here
rather than quietly corrected, because two of them are the kind of mistake that
looks exactly like the fix — `tracesSampleRate: 0` above all — and a plan that
silently agreed with itself afterwards would teach nobody anything.

Five files, one of which is new, plus config.

### 1. `src/monitoring.ts` — new, the only file that imports `@sentry/node`

Three exports, and a hard rule that none of them ever throws — the same rule
`src/log.ts` keeps and for the same reason: monitoring must not be able to turn
a working request into a failed one.

```ts
export function initMonitoring(): void          // idempotent; a no-op with no DSN
export function captureFailure(err: unknown, context?: Fields): void
export function flushMonitoring(ms?: number): Promise<void>
```

**No DSN, no Sentry.** `SENTRY_DSN` unset means every function above returns
immediately. That is what keeps this laptop, `npm test` and `npm run dev` exactly
as they are today, and it is why no test needs a network stub.

Init options, with the reasoning that is not obvious:

```ts
Sentry.init({
  dsn,
  environment: process.env.VERCEL_ENV ?? "development",
  release: __SPIDERYARN_BUILD_COMMIT__,     // the same stamp /api/health reports
  tracesSampleRate: 0,                       // errors only — the default is 1.0
  registerEsmLoaderHooks: false,             // no import-in-the-middle; we do not instrument
  dataCollection: {
    stackFrameVariables: false,
    genAI: false,
    httpHeaders: false,
    httpBodies: false,
    cookies: false,
    urlQueryParams: false,
    userInfo: false,
  },
  beforeSend: scrub,
});
```

- **`tracesSampleRate: 0`** — the SDK's default is `1.0`. Leaving it would send a
  trace for every request, which is quota we did not ask for and a second data
  path to audit.
- **`release`** — reuse `resolveBuildStamp()`, already compiled into the API
  bundle by `vite.api.config.ts` and already reported by `/api/health`. A third
  spelling of "which build is this" would be one too many.
- **`registerEsmLoaderHooks: false`** — `@sentry/node@10.71.0` depends on
  `import-in-the-middle` and eight OpenTelemetry packages, whose only job is
  auto-instrumentation for tracing. With tracing off they are cold-start cost and
  nothing else. **Open question for review:** whether this is enough to keep them
  out of the hot path, or whether the honest answer is that `@sentry/node` is a
  heavy dependency for a job this small (see [What we did not
  do](#what-we-considered-and-did-not-do)).

### 2. `scrub` — the fifth egress guard

Modelled directly on `SAFE_ERROR_PROPS` in [`src/log.ts`](../../src/log.ts) and
on `db-errors.ts`: **an allowlist of what may pass unchanged, and everything
else is replaced.** The direction is inverted on purpose, because a blocklist is
a list and this whole area is a history of lists that were complete when they
were written.

What Sentry receives for an error:

| Field | What we send |
|---|---|
| `type` | the error's class name — `TypeError`, `FetchFailure` |
| `value` | **the class name again, or a `messages.ts` code** — *not* `err.message`, unless the class is on the allowlist below |
| stack frames | in full. Sentry parses these out of `err.stack` and ignores the message line, so frames survive the message being replaced |
| tags/context | `SAFE_ERROR_PROPS` only — `code`, `status`, `statusCode`, `errno`, `syscall`, `retryable` — plus `route`, `method`, `step`, `slug` |

The allowlist of classes whose message we wrote ourselves, and may therefore
send: errors carrying a numeric `status` (this codebase's existing mark for "I
chose this failure and its wording"), `ChatConflict`, and the two `messages.ts`
sentences `db-errors.ts` already emits. Everything else loses its message.

**This costs something and the cost should be argued with rather than
accepted:** a Sentry issue that says `TypeError` with no message is a worse
issue. The frames still say which file and line, which is most of what you
needed — but not all of it. The alternative, sending messages and trusting a
regex to scrub them, is the option that has already failed four times in this
repo.

### 3. Where capture is called from — three seams, no sprinkling

**a. `src/routes.ts`, the outer catch.** There is already a rule there for
telling a failure we chose from one we did not, and it is *not* the status code:

> the test is not the status code but whether the error *named* one

`logRequest` uses it to decide whether to keep a stack. `captureFailure` uses the
same boolean to decide whether to report at all. One rule, two consumers — so a
`httpError(400, …)` for a bad slug never becomes a Sentry issue, and a
`TypeError` mapped to 500 always does.

**b. `src/jobs.ts`, `runStep`'s catch.** An ingest step that throws is exactly
the "happened while nobody was watching" case this whole exercise is for. Note
`INTERRUPTED`/cancel is already excluded there and must stay excluded.

**c. `src/vercel.ts`, the handler.** A `finally` that flushes (below), and
capture for anything that escapes `handleApi` entirely.

Not called from `src/log.ts`. Tempting — one seam, everything at `error` level
goes to Sentry — and wrong: it would couple two subsystems that must fail
independently, and `log.ts`'s first rule is that a log call can never throw.

**The one place that cannot be covered**, and it should be written down rather
than discovered: `api/index.js`'s import-failure catch. Reaching that means the
module that would define `captureFailure` is the very thing that would not load.
It stays a `console.error`, as it already documents.

### 4. Flushing, or the events never arrive

The failure mode that makes serverless error tracking look like it works and
silently not:

> Vercel serverless functions do not support "fire-and-forget" background tasks
> … once the function returns the response payload, it stops processing.

Sentry's transport is an in-memory buffer drained by a background worker. On
Vercel the buffer dies with the freeze. So `src/vercel.ts` gets:

```ts
} finally {
  await flushMonitoring(2000);
}
```

Two seconds, not more: `maxDuration` is 300s but a hung Sentry must not hold a
reader's request open.

**The half that is easy to forget:** the ingest queue runs *after* the response
has been sent. Its captures need their own flush at the end of a failed step,
because there is no later moment that will do it for them. Flagged as a review
question — this may be a pre-existing problem with the queue on Vercel that
Sentry merely inherits.

**And how we prove it works rather than assume it:** deploy, hit a deliberate
throwaway route that throws, and check the issue actually lands in Sentry. A
flush that does nothing looks exactly like a flush that worked
([silent-success](../reusable/silent-success.md)); the only check that is not
also fooled is an event appearing at the far end.

### 5. The browser half

- `src/web/monitoring.ts`, the mirror of the server one, reading
  `import.meta.env.VITE_SENTRY_DSN`. Same allowlist scrub, same no-DSN-no-Sentry
  rule.
- Called from `src/web/main.tsx` **before `startPerf()`** — the first thing in
  the file, so an error while the app is booting is still caught.
- `tracesSampleRate: 0`, `browserTracingIntegration` off, **`replayIntegration`
  off**. Replay records the screen, and the screen is somebody's article.
- **A React error boundary, which this app does not currently have at all.**
  `grep` for `componentDidCatch` in `src/web/` returns nothing, so today a throw
  during render is a white page with no message. That is worth fixing on its own
  merits and this is the moment.

### 6. Source maps

Without these the client half is close to worthless — `dist/assets/index-*.js`
minified, so every issue is a column number.

- `vite.config.ts`: `build.sourcemap: "hidden"` — emitted, uploaded, and **not**
  referenced from the bundle, so nothing points a stranger at our source.
- `sentryVitePlugin({ … , sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] } })`,
  placed **after every other plugin**, per Sentry's Vite docs.
- **It must be a no-op when `SENTRY_AUTH_TOKEN` is absent**, or `npm run build`
  breaks on this laptop and in every agent's tree. This is the change most likely
  to break somebody else's day.
- Server side: `vite.api.config.ts` gets `build.sourcemap: true` too. The bundle
  is `minify: false` already, but it concatenates every module into one
  `vercel.js`, so a stack trace names a line in a file nobody wrote.

Source-map upload needs `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`
at **build** time. Note the trap already documented for
`VITE_SUPABASE_URL` in [deployment.md](../project/deployment.md#environment-variables):
build-time variables change nothing until the next build.

## Doing it programmatically

Greg asked. Almost all of it, yes.

**What a machine can do**, given an org and an auth token:

```
POST /api/0/teams/{org}/{team}/projects/       create the project
GET  /api/0/projects/{org}/{project}/keys/     read the DSN back
vercel env add SENTRY_DSN production           …and VITE_SENTRY_DSN, SENTRY_ORG,
                                               SENTRY_PROJECT, SENTRY_AUTH_TOKEN
```

**What needs a human in a browser, and there is no way round it:** minting the
first auth token (Sentry → Settings → Auth Tokens), because a token is what
authenticates every call above and it cannot be created by an unauthenticated
one. Two minutes, once. Everything after that is scripted.

Scopes needed on the token: `project:read`, `project:write`, `project:releases`
— Sentry's Vite docs ask for *"Project: Read & Write"* and *"Release: Admin"*.

## Environment variables this adds

| Name | Where | Why |
|---|---|---|
| `SENTRY_DSN` | Vercel Production (+ Preview?) | server capture. **Runtime** |
| `VITE_SENTRY_DSN` | Vercel Production (+ Preview?) | browser capture. **Build time** — see the trap above |
| `SENTRY_AUTH_TOKEN` | Vercel, build only | source-map upload. A real secret |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Vercel, build only | source-map upload |

All five also go in `.env.example` with a line saying what they do, and the
values in `.env.local` for anyone who wants to test capture locally.

**Preview: an open question for Greg.** Turning it on for Preview means every
agent's branch deploy reports into the same project, which is noise; leaving it
off means a preview cannot be used to check that any of this works. The
recommendation is *on for Preview*, with `environment` distinguishing them —
Sentry's environment filter exists for exactly this, and a monitoring change you
cannot test on a preview is one you can only test in production.

## Cost

From [sentry.io/pricing](https://sentry.io/pricing/), fetched 2026-08-27:

| | Developer (free) | Team |
|---|---|---|
| Price | $0 | $26/mo billed annually |
| Errors | **5k/month** | 50k/month |
| Retention | **30-day lookback** | up to 90-day |
| Users | 1 | unlimited |
| Replays | 50 | 50 |

**Free is the plan**, and note what it already buys: 30 days against Vercel's
one. That is the entire trigger from logging.md, met by the free tier.

The quota risk is not traffic — this app has one reader. It is a **loop**: 5k
events is about one every nine minutes for a month, and a poller that throws
every two seconds spends the month's allowance in three hours. The ingest queue
polls. `dedupeIntegration` is on by default and Sentry rate-limits per issue, but
neither is a spend cap, so the honest mitigation is to look at the number after
the first week. Sentry's spike protection is on by default on all plans and is
the backstop.

One thing to check rather than assume: the pricing page lists *"API &
third-party integrations"* against Team rather than Developer. If that turns out
to gate the Web API used below for project creation, the programmatic path needs
a token from a browser-created project instead — which changes two minutes of
setup and nothing else.

## Tests

Following the house rule that a check must be seen to fail:

1. **The scrub, against the real leak.** Build a `DrizzleQueryError`-shaped error
   whose message contains a sentinel, run it through `scrub`, assert the sentinel
   is absent from every field of the resulting event. This is the
   error-boundary.md sentinel test, narrowed to one egress — and unlike that one,
   it is a few lines.
2. **No DSN, no calls.** Assert `captureFailure` with `SENTRY_DSN` unset makes no
   network call and does not throw. Guards the property every other test relies
   on.
3. **The expected/unexpected rule.** `httpError(400)` is not captured; a bare
   `TypeError` is. Same boolean `logRequest` uses.
4. **The build with no token still builds.** Cheapest possible guard on the
   change most likely to break a peer's tree.

Note per [tests-inherit-env-local](../reusable/): vitest inherits `.env.local`
through `loadEnvLocal()`, so tests 1–3 must stub `SENTRY_DSN` explicitly rather
than assume it is unset — otherwise the control passes on a laptop that has no
DSN and fails on the one that does.

## What we considered and did not do

- **A log drain to a custom endpoint that forwards to Sentry.** Covered above:
  it is a service we would have to write and host, to replace a library that
  exists.
- **Skipping the SDK and posting to Sentry's envelope endpoint by hand.** About
  sixty lines, no dependency, very much this repo's "prefer boring" instinct —
  and it means hand-building stack frames, and owning grouping and source-map
  resolution ourselves. Rejected, but it is the honest fallback if
  `@sentry/node`'s OpenTelemetry dependency tree turns out to cost real cold-start
  time. **Worth measuring before/after.**
- **Session replay.** Records the article on the reader's screen.
- **Performance tracing.** Greg scoped it out; it is also a second data path with
  its own defaults to audit, and traces carry URLs and route params.
- **A correlation id.** [logging.md § The correlation id, not
  yet](../project/logging.md#the-correlation-id-not-yet) defers it until there
  are real users. Sentry issues carry their own id, which covers most of what it
  was for.

## What got built

All of it, on 2026-08-27, after
[GPT Sol's review](error-monitoring-sentry-review-sol.md) turned four of the
decisions above around. The review's verdict was *"revise before build"* and it
was right on every count that mattered; what follows is what the code does now,
organised around the four.

### 1. The message allowlist lost its second branch

The plan let any error carrying a numeric `status` send its message, on the
grounds that a status is this codebase's mark for *"I chose this failure and I
chose its wording"* — the mark [`db-errors.ts`](../../src/store/db-errors.ts)
already treats as an allowlist. One counter-example killed it, from
[`src/term-lookup.ts`](../../src/term-lookup.ts):

```ts
throw Object.assign(new Error(
  `"${entry.name}" does not appear in this article, …`), { status: 409 })
```

`entry.name` is a glossary term lifted out of the article. **Choosing a
failure's status is not choosing every word of its message**, and the two had
been quietly conflated. What is left is one test — the message must end in a
bracketed code `kindOfMessage` recognises — and that set really is closed, since
`tests/messages.test.ts` round-trips every sentence in `messages.ts` through it.

### 2. `tracesSampleRate: 0` turns tracing *on*

The plan said the SDK's default was `1.0` and that zero disabled it. Both wrong,
and this is the one worth remembering. From `@sentry/core`'s own source:

```js
// Note: This check is `!= null`, meaning "nullish". `0` is not "nullish".
return !!options && (options.tracesSampleRate != null || !!options.tracesSampler);
```

Setting a rate at all is how you ask for spans. **Measured here on 10.71.0**,
independently of the review, by initialising `@sentry/node` twice and counting:

| `tracesSampleRate` | default integrations |
|---|---|
| omitted | **17** |
| `0` | **44** |

and the twenty-seven extra include `Anthropic_AI`, `OpenAI`, `Postgres`,
`PostgresJs`, `Graphql`, `Redis`, `Express` and `Http`. The option is now
absent, and `tests/monitoring-config.test.ts` fails if anybody puts it back.

### 3. `beforeSend` builds the event instead of cleaning it

The plan's `beforeSend` deleted three fields. The review listed what else
arrives without asking: `RequestData` attaches the whole request URL and has no
`dataCollection` switch at all; `LinkedErrors` sends every message in the
`cause` chain; `SystemError` copies an error's enumerable own properties into
`contexts` — which is the `FetchFailure.url` leak `src/log.ts` already had once;
and a stack **frame** may carry `vars`, `context_line`, `pre_context`,
`post_context`, `abs_path` and `module`. Worse, Node's context-lines integration
opens whatever filename the parsed frame supplies, without restricting it to
this project.

So [`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts) rebuilds the event
from an allowlist, field by field, and the integration list is
`initWithoutDefaultIntegrations` plus three added back by name — `Dedupe`,
`OnUncaughtException`, `OnUnhandledRejection`. `frameContextLines` is `0`.
Breadcrumbs are locked three times over (`maxBreadcrumbs: 0`, no breadcrumb
integration, and dropped in `beforeSend`), because the browser default records
`console` arguments and [`src/web/upload.ts`](../../src/web/upload.ts) logs 400
characters of an upstream response body.

### 4. `@sentry/node` → `@sentry/node-core/light`

`@sentry/node` initialises an OpenTelemetry SDK whether or not you asked for
tracing — about 21 MB on disk — and `registerEsmLoaderHooks: false` stops the
loader hook, not the loading. `light` is an official exported entry point.
Cold-process start, measured locally: bare Node ~30 ms, `light` ~110–120 ms,
`@sentry/node` ~190–210 ms.

The plan's fallback — hand-write the envelope client, ~60 lines — was rejected
for a better reason than the plan gave. Sentry's backend still does the grouping
and the source-map resolution, so that part was overstated; what a real client
must do is parse cross-runtime stacks, build mechanisms and envelopes, and
handle normalisation, rate limits, retries, buffering and flush semantics. That
is not a trustworthy sixty lines.

### And three more the review found

**The capture rule was wrong, in both directions.** Reusing `logRequest`'s
*"did it name its own status?"* test answers a different question — *is a stack
useful in this log line?* rather than *should anybody be told?* It would have
hidden [`src/owner.ts`](../../src/owner.ts)'s deliberate `status: 500` invariant
failure and reported every `ENOENT`. The rule is now **the status we answered
with**: `status >= 500`, the same threshold `logRequest` uses to decide between
`warn` and `error`, so the log and the tracker cannot drift apart about what a
fault is.

**Three streaming seams were invisible.** Past `sse(res)` the outer catch never
runs, so explain, chat and search each reported nothing — and a stream is
exactly where a model call fails. All three now capture, and so do their
secondary "could not record the failure" catches, which are a different and
worse event.

**The client's boot hole.** Initialising Sentry on the first line of
`main.tsx` cannot catch a module that throws while evaluating, because static
imports — `App` among them — are evaluated first. That is precisely the
blank-page failure this app has already had in production. So there is a new
entry, [`src/web/boot.tsx`](../../src/web/boot.tsx), which starts Sentry and
then `import()`s the app dynamically. Verified in the built output: the entry
chunk is 103 KB with a DSN (35.6 KB gzipped) and carries a genuine dynamic
import of `main`, and **8 KB with no DSN**, Sentry having been tree-shaken out
entirely — so a build without monitoring pays nothing for it.

### Two changes on 2026-08-28, after the canary landed

**The signed-in reader's email now rides on every error.** Greg's ask:

> Make sure we send up the user's email address (if logged-in) as part of every
> error.

`user` becomes the one field past the event builder that carries a person, cut
to `id` and `email` — Sentry's `User` has an index signature, and `ip_address`
is inferred from the connection unless refused. What is *not* turned on to
achieve it is `dataCollection.userInfo`, which stays `false`: that option lets
instrumentation populate `user.*` from whatever it finds, which is a far wider
promise than *the address of the person the gate just let in*. The identity is
set by us, at one seam, from a `VerifiedUser`.

Both halves write to the **isolation** scope. Under Fluid Compute the global
scope is shared between concurrently-served requests, so a global `setUser`
would put one reader's email on another reader's error — intermittently, on the
one field where being wrong is worst.

The browser half is called from `lib/api.ts`'s existing auth listener rather
than from `web/monitoring.ts`, and that is load-bearing rather than tidy: that
module is in the entry chunk, so importing `supabase` from it would evaluate
`lib/supabase.ts` *before* `boot.tsx`'s first statement — and that file throws
at module load without its build-time variables, which is exactly the blank page
`boot.tsx` exists to report. The obvious placement would have moved the throw to
before the reporter was armed.

**And the upload turned out not to be slow.** The 114 seconds the API build
spent uploading was a cold start. Measured with genuinely changed code:

| | client | API |
|---|---|---|
| first ever upload | 19 s | 114 s |
| every upload after | 8 s | 6 s |

Sentry's chunked upload negotiates checksums first and sends only what it does
not have, server-side rather than from a local cache — so a fresh Vercel build
machine gets the same benefit. Nothing was turned off. One line changed in
`scripts/deploy.ts`'s `BUILD_ENV` so the local preflight *deterministically*
does not upload, rather than not uploading because nobody happens to export the
token.

### What is deliberately still not done

- **`waitUntil`.** The review prefers it to an awaited flush as the Fluid
  Compute mechanism, and also says awaiting *is* sufficient. Awaiting costs no
  dependency, so awaiting it is. Worth revisiting if flush latency ever shows up.
- **Per-step flushing in the queue.** Not needed, and the plan's reasoning for
  wanting it was stale: `pump()` returns immediately when `VERCEL` is set, so
  production ingest is driven by the browser's `/advance` request and a failed
  step is still inside a live invocation.
- ~~**The far-end canary.**~~ Done, 2026-08-28. An error shaped like the Drizzle
  leak — a bound parameter in its message — was captured and flushed against the
  real project. It arrived as `Error` with no message, `message_withheld: true`,
  real frames, an empty `url` and `transaction`, and no trace of the canary
  string anywhere in it. That is the check that is not fooled by a flush which
  silently does nothing.
- **The `api/index.js` gap.** The review is right that its import-failure catch
  could lazily load the SDK. Left alone: that path runs when the module system
  is already failing, and adding a module load to it is the wrong instinct.

## Open questions for Greg

1. **Preview environment on or off?** Recommendation above: on.
2. **Messages dropped by default** — are you happy with Sentry issues that say
   `TypeError` and a stack but no message, in exchange for the guarantee that no
   article prose leaves the machine? The alternative is a scrubbing regex, which
   is the thing that failed four times.
3. **Free tier, or is this worth paying for?** Free is the recommendation until
   the volume is known.

## See also

- [logging.md](../project/logging.md) — what the server says to whoever is
  running it, Vercel's one-day retention, and the four leak rounds
- [error-boundary.md](error-boundary.md) — the rule this plan's scrub implements,
  and the sentinel test it is a narrow version of
- [deployment.md](../project/deployment.md) — the Vercel project, and the
  build-time-variable trap
- [security.md](../project/security.md) — the two untrusted parties
