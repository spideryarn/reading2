# Logging

```bash
npm run dev            # JSON to stdout
npm run dev:pretty     # the same, piped through pino-pretty for a human
LOG_LEVEL=debug npx vitest run tests/jobs.test.ts    # tests are silent unless you ask
```

The logger is [`src/log.ts`](../../src/log.ts), and its header comment carries the rules. This
document carries the reasoning.

## What logging is for here

**Logging is what the server says to whoever is running it.** Nothing else in this project can do
that job. A job's outcome is written to `data/_jobs/<id>.json`, which survives a restart and is
genuinely good; an error is sent to the reader as JSON, which is what the reading view needs. But
neither reaches the person operating the thing, and once this is on Vercel there is no terminal to
look at.

Before this existed, `handleApi` caught every error, mapped it to a status, sent it to the client,
and told stdout nothing at all. A 500 in production was completely invisible unless the reader
happened to mention it. That was the gap.

### The CLI output is not logging

Every `console.log`/`console.error` call in `src/` and `scripts/` is **staying**. They are in
pipeline stages' `main()` functions and in the standalone scripts — `db-migrate`, `typecheck`,
`run-codex`, `validate-tree`, `toc-flatten` — and they all write to a terminal somebody is watching:

```
Blocks:    412  ({"paragraph":331,"heading":38,…})
Tokens:    48213 in, 6104 out
Elapsed:   71.3s
Wrote:     /Users/greg/…/data/noema-…/tree.json
```

That is a **user interface** — a person at a terminal watching `npm run toc` — and turning it into
JSON would make it worse for the only purpose it has. The rule is the destination, not the function
name: if a human is watching it scroll past, it is output; if you would want it a week later with a
timestamp and a slug attached, it is a log.

`src/web/` has zero `console` calls and is gaining none. See [§ The browser](#the-browser-nothing-yet).

## The decision: Pino

Chosen 2026-08-25 by the process in
[third-party-library-selection.md](../reusable/third-party-library-selection.md), whose first
criterion is a long-lived community with enough documentation and discussion that a coding model
already knows the idiom.

| | weekly downloads | latest | releases in 12mo | verdict |
|---|---|---|---|---|
| **pino** | 44.8M | 10.3.1 | 18 | **chosen** |
| winston | 29.0M | 3.19.0 | 5 | alive, but built around *transports*, and on Vercel there is exactly one destination |
| consola | 57.5M | 3.4.2 | **0** | downloads are transitive (Nuxt/unjs); pretty CLI output, not JSON |
| roarr | 10.8M | 7.21.7 | 6 | downloads nearly all transitive from one author |
| tslog | 2.0M | 5.1.0 | 9 | good API, too small a community — fails criterion one |
| LogTape | 387K | 2.3.2 | **241** | genuinely interesting, runs on edge, but the API is still moving. Revisit in a year |
| bunyan | 4.0M | 1.8.15 | 0 | **dead** — last release 2021-01-08. Pino is its successor |

Two things settled it beyond the numbers.

**The original version of this app used Pino**, at
`/Users/greg/dev/spideryarn/reading/lib/services/logger.ts` — so the conventions carry, and Greg has
read this output before. See [§ What we took from theirs](#what-we-took-from-theirs-and-what-we-left).

**The runner-up was no library at all** — `console.log(JSON.stringify(…))`, which is what
[Vercel's own guide](https://vercel.com/kb/guide/add-structured-application-logs-to-vercel-functions)
shows. It lost on one specific thing: `JSON.stringify(new Error("x"))` is `{}`. Every hand-rolled
JSON logger silently drops stack traces until somebody writes the serialiser, and the line still
looks perfectly fine — [silent-success.md](../reusable/silent-success.md) exactly. Pino ships
`pino-std-serializers`. The second thing it loses on is redaction, where hand-rolled means the first
key nobody thought of leaks.

## Three ways this differs from theirs, deliberately

Their config is a good file and most of it is copied. These three are changed on purpose.

### 1. No transports. Pretty printing is a shell pipe

`pino({ transport: { target: "pino-pretty" } })` **spawns a worker thread**. Their own config needed
`serverExternalPackages: ['pino', 'pino-pretty']` in `next.config.ts` to make that work, and their
planning doc records that pino-pretty had already been ripped out once before for "worker thread
incompatibility" — the error being:

```
TypeError: The worker script or module filename must be an absolute path...
```

That particular damage is Next.js-specific and we have no Next.js. The reason we still refuse the
transport is serverless: **a Vercel function freezes at response time, and a worker thread's buffered
writes never land.** The lines you lose are the ones at the end of a request, which are the ones you
wanted. Pino's [own docs](https://github.com/pinojs/pino/blob/main/docs/asynchronous.md) say to use a
synchronous destination on Lambda for this reason.

Their config guards the transport behind `NODE_ENV !== 'production'`, which works — and means the
whole mechanism exists only for development, one wrong environment variable away from putting a
worker thread inside a serverless function. So: `npm run dev:pretty` is `vite | pino-pretty`. Same
output, no worker, nothing that *can* leak into production because it is not in the program.
(`pino-pretty` passes non-JSON lines through untouched, so Vite's own banner survives the pipe.)

### 2. `sync: true`, stated rather than inherited

Measured rather than assumed: on pino 10.3.1 the default destination already survives an immediate
`process.exit(0)` — five lines logged, five lines landed. Pino's own documentation is contradictory
on this point, which is precisely why it is written down explicitly. Stating it turns a guarantee
that is currently incidental into one somebody would have to delete on purpose.

### 3. A `redact` list, because they had none

Theirs has no `redact` config at all — every privacy rule was convention, enforced by review. Here is
what that bought, and it is worth the space because it is the strongest argument in the whole
investigation:

- their best-practices doc lists a safe/unsafe table saying **never log personal data**
- three sections earlier, the same doc's standard request pattern logs `userEmail: user.email` on
  every API route
- their planning doc ticks a checkbox reading *"Ensure no sensitive data (passwords, tokens, email
  addresses) logged"*
- and `components/auth/login-form.tsx` logs `email: data.email` on both failed and successful login,
  alongside `navigator.userAgent`

Three documents, one ticked box, and the code doing the opposite of all of them. A list in a config
file is not a better rule than a rule in a document — it is a rule that runs.

## Levels, and what each one means here

Their logger set the level by environment and then used exactly two — `info` for everything that
happened and `error` for everything that failed. "Level" became a volume knob rather than a severity.
Here each one has a job:

| level | means | example |
|---|---|---|
| `error` | **ours, and broken.** Something failed that should not have | an unexpected throw reaching the catch-all; a corrupt `comments.json` |
| `warn` | **suspicious, still working.** The thing that is invisible in the response | a request answered from the `example/` fixture; a 4xx; a job record that would not parse |
| `info` | **it happened, and you would want it a week later** | a request completed; a step finished, with what it cost |
| `debug` | **useful while you are looking.** Off in production | a step skipped as already done; a fetch's size |

Default level is `debug` in development, `info` in production, and **`silent` under test** — Vitest
sets `NODE_ENV=test`, and without that guard every test touching a route prints a wall of JSON around
its assertions. `LOG_LEVEL` overrides all of it, which is how you debug a failing test.

## What gets logged, and where

Five components, as a closed TypeScript union rather than free-form strings — a typo in a component
name is invisible, because the line is still written and just never matches the filter built around
the name you meant.

| component | file | what it says |
|---|---|---|
| `http` | [`src/routes.ts`](../../src/routes.ts) | one line per API request: method, path, status, `ms`. Level follows the status — 4xx is the client's fault and is not an alarm, 5xx is ours and is |
| `jobs` | [`src/jobs.ts`](../../src/jobs.ts) | the queue: enqueued, each step's transition, the outcome. See [ingest-queue.md](ingest-queue.md) |
| `pipeline` | [`src/pipeline.ts`](../../src/pipeline.ts) | **what a step cost** — model, tokens in and out, `ms` |
| `store` | [`src/api.ts`](../../src/api.ts), [`src/comments.ts`](../../src/comments.ts) | the silent fallbacks, chiefly the fixture one |
| `model` | [`src/explain.ts`](../../src/explain.ts), [`src/converse.ts`](../../src/converse.ts) | the model calls with a reader waiting on them — explaining a selection, and chat |

### The one that answers an open question

Every model stage already computed `inputTokens`, `outputTokens` and `elapsedMs`, printed them from
its `main()`, and **threw them away when run through the queue** — which is now the normal way to
ingest anything. So [Q7 — how much does a tree cost?](open-questions.md#q7) was unanswerable, not
because it was hard but because the numbers were being discarded three lines after being computed.

They are logged from [`src/pipeline.ts`](../../src/pipeline.ts), and that location is the point:
**log at the seam the queue already owns, not inside another agent's stage.** Every number needed is
already in scope in the `STEPS` closures, so no stage file has to be reached into
([architecture.md § Stage ownership](architecture.md#stage-ownership)). The one exception is `model`,
which was a private const in `src/toc.ts` and `src/arc.ts` and is now on their returned run objects.

The same seam gives the block-id counts for free — `{ total, minted, carried, reused }` from stage 3.
An article re-run that mints new ids instead of carrying the old ones has **orphaned every comment on
it** ([block-ids.md](block-ids.md)), and that is not visible in the response, in the artefacts, or
anywhere else.

### The fixture alarm, and what it can never fire for

The `store` warning on [`src/api.ts`](../../src/api.ts) says when an article was answered out of
`example/` rather than out of its own directory. That is the fallback which
[disguised a real path traversal as a refusal](security.md#why-it-survived-being-looked-at): a
shallow `../../etc` finds no `blocks.json`, falls through to the fixture, and returns HTTP 200 with
plausible content. The response cannot tell you which directory answered. Now one line can.

Two things about it are worth knowing, both found while wiring it up:

- **It stays quiet for `example` itself.** Asking for the fixture and getting the fixture is the
  fixture working. Warning there would put a line on every fresh-clone page load, and an alarm that
  fires when nothing is wrong is an alarm nobody reads.
- **A corrupt article cannot trigger it.** `readJson` returns `null` for `ENOENT` and *rethrows*
  everything else, so a `blocks.json` that exists and will not parse throws out of `loadArticle` as a
  500 — it never reaches the fallback. Absent falls through; malformed does not. Two genuinely
  separate paths, which is worth writing down because the natural assumption is that both end up at
  the fixture, and a corrupt article looking like a fixture read is exactly the confusion this
  warning would otherwise cause.

## What never gets logged

The redact list is in [`src/log.ts`](../../src/log.ts). Beyond it, three standing rules:

- **No article prose, ever.** Not the text, not a comment's `quote`, not the model's `answer`. The
  reader's selected sentence is the most private thing this app holds. Ids, slugs, counts, statuses
  and timings.
- **Slug, not URL,** wherever a slug identifies the thing. See below.
- **Nothing sensitive in the message string.** This one is a consequence of how redaction works and
  is not negotiable — see the next section.

### Redaction is path-based, and that is the whole limitation

`redact` is built on `fast-redact`. It matches **the position of a key in the object**, never a value
and never the message. So:

```ts
log("model").info({ url }, "fetching");        // redactable
log("model").info(`fetching ${url}`);          // can never be redacted
```

It will not notice an API key inside an error message, a token in a URL's query string, or — once
[Drizzle](../plans/postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth) lands — a
bound query parameter at `params[3]`, which has no key name to match on at all. That last one is why
`params` is redacted wholesale rather than by field; it is the only thing a path-based redactor can
do about a positional array.

The list is a floor, not a guarantee. The guarantee is the habit.

### An error is not a safe thing to log whole

Pino's standard error serialiser copies an `Error`'s **enumerable own properties** onto the line.
That is a good default and it was a leak here. [`FetchFailure`](../../src/fetch.ts) carries a `url`,
so a single `log.error({ err })` on a failed fetch emitted:

```json
"err":{"type":"FetchFailure","message":"…","code":"dns",
       "url":"https://user:pw@host/article?token=SECRET"}
```

Credentials, query string and all. `redact` could not have stopped it: its paths are fixed at
startup, `err.url` was not among them, and **no list of paths can anticipate what property some
error class invented later will decide to carry.**

So the direction is inverted. [`src/log.ts`](../../src/log.ts) serialises `err` itself and copies
only an allowlist — `code`, `status`, `statusCode`, `errno`, `syscall`, `retryable` — plus `type`,
`message` and `stack`. An allowlist drops the property nobody thought about, which is always the one
that leaks.

**The corollary is a rule, because `message` and `stack` are still kept and have to be:**

> **Do not interpolate untrusted content into an error you intend to throw.**

A message is free text, and nothing structural can clean it. Two places got this wrong and are
fixed: `explain` throws `OpenRouter ${status}: ${body.slice(0, 400)}`, four hundred characters of a
provider's response body, which `src/comments.ts` was logging as a field called `reason` — so a
provider that echoes the request back would have put the reader's selected quote into the log on a
line that reads like a status code. And `handleApi` was logging `req.url` with its query string
intact, into the message string where redaction can never look.

All of this came out of a GPT/Codex review of the change (2026-08-25). It is written up at length
because every one of these looked completely fine, and three of them were written by an agent that
had just finished writing the rules they broke.

### What a URL gives away

**No log line carries a full article URL today.** The `slug` identifies the article everywhere, and
`slug` is what the queue, the store and the HTTP layer all use.

That is worth stating because a log of article URLs is a **reading history**, which is more revealing
than it looks — and because an earlier draft of this document claimed the URL *was* logged once at
enqueue, which was simply false: the enqueue line never carried it. GPT/Codex caught the
contradiction while reviewing the change, and caught something worse alongside it. The URL was
reaching the log — not from any line that asked for it, but from
[`FetchFailure`](../../src/fetch.ts) carrying a `url` property that Pino's default error serialiser
copied onto every failed-fetch line, credentials and query string included. See
[§ An error is not a safe thing to log whole](#an-error-is-not-a-safe-thing-to-log-whole).

If a URL ever does need logging, put the **hostname** in, not the URL. And if this project ever has
real users, revisit this alongside [the correlation id](#the-correlation-id-not-yet).

## Vercel

From [Vercel's runtime logs documentation](https://vercel.com/docs/logs/runtime), page dated
2026-08-03. This project is heading for Vercel Pro with Fluid Compute
([deploy-and-repo-move.md](../plans/deploy-and-repo-move.md#two-facts-that-make-the-rest-easier)).

**Capture is just stdout and stderr.** No agent, no SDK, no integration — which is the whole reason
this design is nothing more than "write JSON to stdout".

**Retention on Pro is one day.** That is the most important operational fact here and it shapes
everything below. Logs are enough for "I deployed and something is wrong". They are no use at all for
"a reader hit a bug on Tuesday". Observability Plus raises it to 30 days.

**Limits:** 256 KB per line, **256 lines per request**, 1 MB per request. Roomy, but a line per block
during an ingest would blow the line ceiling on a long article, and past it you can only query the
most recent. This is why `store` logging is sparing and why per-block logging does not exist.

### Two traps worth knowing before they bite

**`console.warn` is filed as an `error`** by Vercel in a non-streaming function — its own mapping
table says so. Since Pino writes every level to stdout, everything we emit arrives as `info` and the
real level lives in the JSON `level` field. So **Vercel's own level filter will not tell you our
levels apart** — everything is `info` to it. Whether you can filter on our `level` field instead
depends on the unresolved question in the next paragraph; until somebody checks a real deployment,
assume you are searching raw text and that `"level":"error"` is a *string to grep for* rather than a
facet. This mostly matters for the `console` calls that remain in CLI scripts, which never run on
Vercel anyway.

**Structured fields may not be indexed.** Two Vercel pages contradict each other: the KB guide says
structured JSON "becomes searchable in the dashboard", while the reference doc lists a fixed set of
searchable fields and then says the feature "is limited to the `message` and `requestPath` field".
Unresolved, and cheap to settle with one deploy. Until somebody does, **do not design around the
optimistic reading** — put anything you will want to grep for in the `msg` string *as well as* in the
object, which is why log messages here look redundant:

```ts
log("jobs").info({ slug, step, ms }, `ingest ${step} for ${slug}`);
```

### Fluid Compute: keep the logger stateless

Fluid Compute means **one instance serves several requests concurrently**. So there is no such thing
as "the current request" at module scope. A module-level `currentLogger` would attribute lines to the
wrong article, intermittently — which is about as nasty as bugs get, because it is invisible until
the moment you are relying on the log to tell you what happened.

The rule: make a child logger and pass it down. `log("jobs").child({ jobId, slug })` inside `runJob`
is the correct shape.

### Edge functions

Pino's Node build **does not run on edge/workerd**. No edge functions are planned, so this is a
non-issue — with one exception worth naming now so nobody meets it at deploy time: if the
[one-email beta gate](auth.md) ever becomes edge middleware, that file logs with `console`, not Pino.

## The browser: nothing, yet

`src/web/` has no logger and no `console` calls, and that is the decision rather than an oversight.

The usual argument for client logging — that errors experienced by users are lost in their own
browsers and you only learn about them through reports — is an argument about users this app does not
have. When something breaks, the one reader has DevTools open. The client already surfaces its
failures in the UI rather than swallowing them (`useComments`, `useJobs`, `App` and `Library` all
carry error state to the screen), which is better than logging them.

The original version reached the same place by accident: its Pino logger never ran in the browser at
all, its "client-side error logging" was `console.error` calls in two auth forms, and its Next.js
error boundary reported to nothing. Browser errors were, in production, invisible. That was fine for
the same reason it is fine here.

**If that changes,** the cheap version is about twenty lines and no dependency: an error boundary
plus `window.onerror` and `window.onunhandledrejection`, POSTing `{ message, stack, url }` to an
endpoint that logs it server-side. Two things to get right — rate-limit it, because a render loop
will eat the 256-line budget, and do not send the article URL.

## Not built

**Stated in the future tense on purpose.** The original version's docs describe Sentry and Better
Stack in the present tense, with setup steps and a monthly cost (*"Total: ~$60/month"*), and
**neither was ever installed.** A document describing an aspiration in the present tense is
indistinguishable from one describing reality, and the check you would naturally run — read the doc —
returns the answer you were hoping for. That is
[silent-success.md](../reusable/silent-success.md#the-remedy-statable) applied to prose, and this
section exists so this file does not join the list.

So, plainly: **there is no error tracker, no log drain, no metrics dashboard, and no database of
model calls.** What exists is what is described above, and nothing else.

### Error tracking, when

Logs and error tracking answer different questions. A log tells you what happened during a request
while you are watching. An error tracker tells you something broke when you were not, groups the
thousandth occurrence with the first, and keeps the stack trace longer than a day.

**The trigger is specific: the first time you want to look at something that happened more than
24 hours ago.** At that point the choice is Sentry's free tier or Vercel's Observability Plus —
crashes point at the first, request behaviour at the second. Nothing here has to change either way;
Sentry can ingest Pino output.

### The correlation id, not yet

The best idea in the original version, and about forty lines: its middleware minted an id per
request, services took it as a parameter and made a child logger from it, the id went into the
error body, and a 5xx toast showed a "Report" link containing it. That is the whole chain from a user
saying "it broke" to the log line that says why.

It earns its keep when a request crosses a process boundary and a stranger reports a bug. We have one
process and one reader who can say what he clicked. **Add it the day there are real users** — and
note that Fluid Compute makes the child-logger-passed-down shape mandatory anyway, so the groundwork
is already the house style.

### Supabase gives us nothing here

Its Logs Explorer covers Supabase's own stack — `postgres_logs`, `auth_logs`, edge function logs.
There is no supported path for pushing an app's logs into it. Two things it is still good for:
`postgres_logs` will show slow queries and connection-pool trouble that our logs never will, and now
that [Drizzle owns the data and Supabase is Auth
alone](../plans/postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth), `auth_logs` is
the **only** place the login side is visible. Do not go hunting for it in Vercel.

## What we took from theirs, and what we left

Their system, at `/Users/greg/dev/spideryarn/reading`, is much larger: a Pino logger with six child
loggers, correlation ids through Next.js middleware, an `ai_calls` Postgres table capturing every
model call, an ESLint rule policing the one permitted way to write to it, a verification script, and
four migrations. Its own planning doc estimates *"3-4 weeks focused"* for the logging infrastructure
alone — the entire budget for a feature, in a one-reader app.

**Taken:** Pino and most of the config shape. Levels by environment. `base: { service, env }`. Level
as a label rather than a number. Timing from the outside rather than trusting a provider's own
timestamp fields — theirs recorded that *"the SDK currently omits `startTimestamp`/`finishTimestamp`
in all responses"*, which is why [`src/explain.ts`](../../src/explain.ts) measures its own latency.
Their privacy list, as an actual `redact` config. The field list from `ai_calls` — as fields on a log
line, not as a table.

**Left:**

- **The Postgres table.** It bought queryability nobody used and dragged in a two-phase write, a
  service class, a policing lint rule, a verification script and four migrations. Our job records
  already have the shape.
- **Six exported child loggers.** Five component names in a field cost nothing; six imports to keep
  straight cost something.
- **Fatal-on-logging-failure.** Theirs rethrows when the telemetry write fails — *"a critical error
  that prevents proper tracking of AI usage and costs"*. Defensible under their fail-fast principle,
  and it means a Postgres hiccup can take down a user-facing feature. **A metrics write must never
  kill a model call.**
- **Cost estimates.** Theirs computed cost three ways in three places, one of them
  `totalTokens * 0.000003` — a single hardcoded rate, model-agnostic, multiplying *total* tokens by
  what looks like an input rate. Wrong by construction. We log token counts, which are facts, and
  leave cost to whoever is doing the arithmetic.

### The half-migration, and the one line that caused it

Their best-practices doc blesses the partly-converted state as a named pattern, **"Mixed Approach
(Current Pattern)"**, illustrated with a `console.log` and a `requestLogger.info` on adjacent lines.
Once that is in the standards document there is no day on which adding a `console.log` is wrong.

The result, counted today: **605 logger calls against 1,992 `console` calls.** That reads worse than
it is — 1,103 of the console calls are in `tests/`, `e2e/` and `tools/`, where console is correct,
and 599 of the 605 logger calls are in `api/`, `services/` and `auth/`, so on the server the split is
about 70/30 in the logger's favour. It still never finished, and there was never a rule that would
have finished it.

**Here the rule is the destination, not the file.** `console` in `scripts/` and in stage `main()`
functions is correct and permanent. `console` in a request path is a bug. That is a line somebody can
actually hold.

## The ways this fails silently

1. **A log line that reports success while carrying nothing.** `JSON.stringify(new Error("x"))` is
   `{}`. This is why `errorFields` exists and why `tests/log.test.ts` asserts on the *stack being
   present in the emitted bytes* rather than on the helper having been called.

2. **A secret in the message string.** Redaction is path-based. `log.info({ apiKey }, "…")` is
   redacted; `` log.info(`key ${apiKey}`) `` is not, and both look equally careful in review.
   `tests/log.test.ts` pins this limitation deliberately, so that anyone who later assumes otherwise
   gets a red test rather than a leak.

3. **A borrowed tool that matches the wrong syntax.** Their repo has
   `scripts/detect-masked-errors.ts`, a good idea — it greps for swallowed errors and fails the build.
   Its pattern is:

   ```js
   const EMPTY_CATCH_REGEX = /catch\s*\([^)]*\)\s*{\s*}/g   // requires the parens
   ```

   This codebase uses bare `catch {` **exclusively** — dozens of them, and **zero** matches for their
   pattern. Copy the script unchanged and it reports a clean bill of health on a file it never looked
   at. A tool built to prevent silent success, failing silently. If it is ever ported, fix the
   pattern first and prove it by breaking something on purpose.

   Re-run the count rather than trusting one written down here. An earlier draft of this document
   gave exact figures for this and for the `console` calls above; both were wrong within the hour,
   because several agents work this tree at once. **A count in a doc is a claim with a shelf life** —
   state the shape of the thing and let the reader run `grep`.

   (For what it is worth, the bare catches were read through while this was written, and the ones
   read were all deliberate and carried a comment saying why. The gap in this codebase was never lost
   exceptions — it was errors correctly propagated to the client leaving no trace on the server.
   Which is worth saying because it is the opposite of what you would guess: the obvious suspect,
   `catch {}`, was innocent, and the culprit was a `catch` that did everything right.)

4. **A component name that is nearly right.** `log("jobs")` takes a closed union, so a typo is a
   compile error. Were it a plain string, the line would still be written and would simply never
   match the filter built around the name you meant.

5. **An error class that carries something private.** `FetchFailure` has a `url`; the default
   serialiser copies it; nothing in the log line looks wrong. Covered above and pinned by a test
   that asserts the credential and the token are absent *from the bytes*, separately — a check for
   the whole URL would pass if half of it survived.

6. **A logger that throws.** `errorFields` used to `JSON.stringify` whatever was thrown, which throws
   on a circular object and on a `BigInt` — from inside a `catch`, so the real failure was replaced
   by `Converting circular structure to JSON`. The error-reporting path destroying the error. This
   is why the logger is now non-throwing by construction rather than by care at each call site.

7. **Vercel filing a `warn` as an `error`**, and structured fields that may not be indexed. Both
   above; both make the dashboard quietly disagree with what the code did.

## Related docs

- [architecture.md § Stage ownership](architecture.md#stage-ownership) — why the pipeline logs from
  the seam rather than from inside each stage
- [ingest-queue.md](ingest-queue.md) — the queue whose lifecycle the `jobs` component narrates
- [comments.md](comments.md) — the model call in a request handler, and why it is the exception
- [security.md](security.md) — the fixture fallback that the `store` warning now watches
- [block-ids.md](block-ids.md) — why re-minted ids are worth a warning
- [testing.md](testing.md) — and `tests/log.test.ts`, which proves the redaction rather than
  restating the config
- [deploy-and-repo-move.md](../plans/deploy-and-repo-move.md) — Vercel Pro, Fluid Compute, and the
  single-process assumptions this all has to survive
- [silent-success.md](../reusable/silent-success.md) — the pattern this document is mostly about

### A note on quotes

House style here is to quote Greg directly, and this document does not, because **there is nothing to
quote.** Both repos' documentation was searched: there is no sounding-board conversation about
logging, and every logging doc in the original version is agent-written in the planning-doc house
format. His voice does not appear in any of it.

The nearest thing is his principles file, `docs/reference/CODING_PRINCIPLES.md` in the original repo,
which carries no date — so these are attributed to the file rather than to a day:

> Raise errors early, clearly & fatally. Prefer not to wrap in try/except so that our tracebacks are
> obvious.

> **Fail fatally & immediately with clear, debuggable, user-visible error messages.** When errors or
> unforeseen situations occur, don't mask problems - expose them clearly for debugging and user
> understanding. Better to fail fast than fail silently.

That is the spirit this file tries to follow: the point of a log line is to make a failure impossible
to miss, and the point of most of the decisions above is to stop a log line from being one more thing
that reports success while doing nothing.
