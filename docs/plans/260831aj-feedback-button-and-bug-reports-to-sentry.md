# A Feedback button, and where a bug report goes

## Goal

A **Feedback** button in the top-right of the window. It opens a dialog asking three questions —
*Steps to reproduce*, *What you expected to see*, *What you saw instead* — and sends the answer
somewhere we will actually look.

Greg, 2026-08-31:

> I want to add a `Feedback` button somewhere, perhaps top-right. It should pop up a dialog box,
> with a request from the user to describe "Steps to reproduce", "What you expected to see", and
> "What you saw instead". It should always send the user-email. It should give them the option
> (default-false) to send extra diagnostics (screenshot, relevant article contents, warning/error
> messages, contents of web browser errors/logs/console, etc). And anything else that will help us
> correlate it with our Vercel logs. I'm thinking it should send this to Sentry somehow?

The thing this is really for is the gap named in
[sentry-error-monitoring.md § The two gaps](../project/sentry-error-monitoring.md#the-two-gaps-both-open):

> On 2026-08-28 every ingest on the live site had been failing and the way we found out was Greg
> trying to read an article.

Sentry hears about a **throw**. It does not hear about a summary that is subtly wrong, a column that
will not scroll, a button that does nothing, or a job that reports success and produces nothing —
and this codebase's own [silent-success.md](../reusable/silent-success.md) says that last class is
most of what goes wrong here. **The reader is the only instrument that detects those.** This is the
wire from that instrument.

## The decisions Greg made, 2026-08-31

Asked directly, and the answers set the shape of everything below:

- **Where a report lands: a Postgres table *and* Sentry.** Not one or the other.
- **Who gets the button: signed-in readers only.** No unauthenticated write endpoint, and the email
  is the one the gate verified rather than one a browser typed.
- **How much article data:** *"Whatever you think will be useful. Presumably we already have it in
  our database, so consider what information exists in the browser/state that might be helpful for
  debugging later, and include that."* — answered in [What a report carries](#what-a-report-carries).
- **Screenshot:** *"If it's complex, defer it. But do at least a bit of a spike, with some Sonnet
  web research (see the doc about third-party library-selection criteria) to see if we can get this
  working soon without tooo much work."* — the spike is a stage of its own, and the feature ships
  without it if the answer is "complex".

## Where this has got to

| | stage | commit |
|---|---|---|
| ✅ | the table and the store | `a072827` |
| ✅ | the route, and the Sentry mirror | `ba2ff5e` |
| ✅ | the client log buffer and its seams | `d1b9db0` |
| ✅ | **fixing GPT Sol's code review** — five blockers, see below | `c77a976`, `1d4bd8a` |
| ✅ | the button, the dialog, the diagnostics collector, the screenshot paste | |
| ✅ | **the third review** — GPT Sol on the UI half, NO-SHIP, see below | |
| ✅ | the browser pass, and `docs/project/feedback.md` | |

**GPT Sol's code review of the first three stages returned NO-SHIP**, and it was right on every
count — see [the code review](260831aj-feedback-button-and-bug-reports-to-sentry-code-review-sol.md).
The five, each verified before being acted on:

1. **The global scope still leaks.** Replacing the isolation and current scopes is not enough:
   `prepareEvent` *starts* from the global scope. Reproduced —
   `getGlobalScope().setExtra("globalProse", …)` reaches the final envelope. The same mistake one
   layer out: the leak that was tested for got fixed, and the boundary was declared closed. The fix
   is a guard at the **final envelope/transport boundary**, after scope merging and event processors.
2. **A log injection.** `Unexpected field: ${key.slice(0, 40)}` is written to logs as `reason`, so an
   authenticated caller can stream arbitrary prose into our logs forty characters at a time, *without
   touching the rate limiter* — breaking this plan's own stated rule. There is a **pre-existing
   instance of the same bug** on the admin route from `c5c7e37`; both fixed.
3. **The screenshot sniff is defeatable.** `PNG_SIGNATURE || articleProse` passes eight bytes of
   check and is forwarded to a third party. Decode and re-encode server-side so the bytes are ours —
   `@napi-rs/canvas` is already a dependency.
4. **`mirrored_at` claimed delivery it cannot know about.** The SDK sends asynchronously and
   `sendEnvelope` swallows transport failures, so an outage leaves the column populated with nothing
   delivered — [silent-success.md](../reusable/silent-success.md) in the very column we would use to
   find stranded reports. And its test mocked a *synchronous throw*, which is not how an outage
   behaves, so it passed while the real failure mode stayed broken.
5. **The concurrency tests could not fail.** The lock ordering is correct — GPT Sol checked it — but
   the tests are sequential: delete the `pg_advisory_xact_lock` line and every one still passes.

The lesson worth keeping, because it is the same one twice: **a guard is worth exactly what its test
can disprove.** Both times the code was right about the case it imagined and silent about the case
beside it.

## References

Read these first; they are the constraints rather than the background.

- [`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts) — `safeEvent`, the allowlist that
  rebuilds every error event before it leaves. **The single most important file for this plan**, and
  the one whose rule this feature is a deliberate, consented exception to.
- [`src/monitoring.ts`](../../src/monitoring.ts) — the server half, its four rules, and the header
  explaining why Sentry is "a fifth boundary and the worst of the four before it".
- [`src/web/monitoring.ts`](../../src/web/monitoring.ts) — the browser half. Note what it turns off:
  Session Replay ("It records the screen, and the screen is somebody's article"), breadcrumbs
  (`maxBreadcrumbs: 0`, three separate locks), and `httpContext`.
- [sentry-error-monitoring.md](../project/sentry-error-monitoring.md) — what reaches Sentry today,
  what does not, and the two open gaps this plan half-closes.
- [security.md](../project/security.md) / [security-map.md](../project/security-map.md) — what may
  leave this machine at all.
- [logging.md](../project/logging.md) — the rule that a log line never carries article prose, which
  this feature must not quietly undo through a side door.
- [260826p-error-boundary.md](260826p-error-boundary.md) — *"No arbitrary `Error`, and no arbitrary
  string, may cross an HTTP, SSE, log, or persisted-error boundary."*
- [url-state.md](../project/url-state.md) — what the address bar already encodes, which is a lot.
  Read it for what a *parsed* location can safely carry, and for `q` and `find`, which are
  reader-typed text and are why the raw URL is never sent.
- [sql.md](../project/sql.md) / [database.md](../project/database.md) — columns over JSON, keys over
  good intentions; and the rule about never pointing a migration at production without asking.
- [third-party-library-selection.md](../reusable/third-party-library-selection.md) — the criteria the
  screenshot spike is judged against.
- [silent-success.md](../reusable/silent-success.md) — why this feature exists, and the failure mode
  to design its own checks against.

## What was verified before designing, rather than assumed

Sentry's own docs do not answer the question this design turns on, so it was answered by running the
SDK. **`@sentry/core` 10.71.0, our exact `init` options, a fake transport, the envelope printed.**

1. **`beforeSend` does not run on a feedback event.** `client.js` routes `beforeSend` only when
   `isErrorEvent(event)`, which is `event.type === undefined`; `captureFeedback` builds an event with
   `type: "feedback"`. So `safeEvent` **never sees a feedback report** — it neither mangles it nor
   guards it.

   This is the load-bearing fact of the plan, and it cuts both ways. The good half: nothing has to be
   loosened, and `safeEvent` stays exactly as strict as it is for errors. The dangerous half: **the
   feedback path has no safety net at all**, so everything on it has to be built deliberately. See
   [The exception, stated out loud](#the-exception-stated-out-loud).
2. **`dedupeIntegration` passes it through** — its `processEvent` returns early for any event with a
   `type`, so a second report of the same bug is not silently dropped as a duplicate.
3. **`tags` is a top-level field of `SendFeedbackParams`**, not only reachable through
   `captureContext` as the research first suggested.
4. **The ambient scope is merged in, and this is a hazard rather than a convenience.** The first
   draft of this plan recorded it as the latter — "the isolation scope's `user` is attached
   automatically, so *always send the user-email* costs nothing extra" — which was true and was the
   wrong lesson to draw. `prepareEvent` merges global, isolation *and* current scope data into the
   feedback event, so **extras, contexts, tags, breadcrumbs and an unreduced `user` all ride along**.
   Proven, with a hostile scope, in
   [Building the parameters is not enough](#building-the-parameters-is-not-enough-and-i-proved-myself-wrong-about-this).
5. **Attachments work from the server SDK.** `hint.attachments` are appended to the envelope as
   `{"type":"attachment"}` items by `client.sendEvent`. So the diagnostics blob and (later) a
   screenshot can ride along from Node, not only from the browser.
6. **`@sentry/node-core/light` exports `captureFeedback`**, and the envelope item type comes out as
   `"feedback"`. The server can file a report; a browser SDK is not required.

That last point is what makes the architecture below possible.

## Principles, key decisions

### The browser posts to us; we file to Sentry

The report goes **client → `POST /api/feedback` → Postgres → Sentry**, not client → Sentry.

The obvious alternative — call `Sentry.captureFeedback()` straight from the dialog, using the browser
SDK we already ship — is simpler by one hop and was rejected for four reasons, in order of weight:

1. **The durable copy gets written first.** Greg asked for a table *and* Sentry. If the browser filed
   to Sentry and then posted to us, a report could half-succeed in either direction. One write, in
   the order that matters: the row we own is the one that must land.
2. **It would be a second egress that no server ever sees.** *(But see the cost below: server-relay
   means the feedback channel fails at the same moment the app does.)* `src/monitoring.ts` opens with *"The
   fifth egress. Errors leave this machine here, and nowhere else."* A browser-direct call adds a
   sixth, bypasses `safeEvent` (see above), and is invisible to us. Routing through our own server
   keeps the property that a report is written down here before it goes anywhere.
3. **The button would be dead on every laptop.** `initClientMonitoring` returns immediately unless
   `import.meta.env.PROD` *and* a `VITE_SENTRY_DSN` — deliberately, so dev never reports. A
   browser-direct feedback button therefore does nothing under `npm run dev`, and the way you find
   that out is by shipping it.

   **The plan used to add "via the server, the button works locally and writes a row". That is now
   false** and GPT Sol caught it: since the store is Postgres-only, a laptop still on the filesystem
   store gets a 501. It becomes true when local development moves to Postgres, which
   [260831b](260831b-finish-the-database-move.md) is doing this week. Corrected rather than deleted,
   because a plan that quietly drops a claim it made is worse than one that shows the correction.
4. **The email is the gate's, not the browser's.** The server already has a `VerifiedUser` at the
   one seam that calls `setRequestOwner`. A client-supplied address is a claim.

**The cost, named — and one of them is real.** One extra hop, and a screenshot travels base64 through
our own function. But the one that matters is **correlated failure**: when the API or Postgres is
down, the feedback channel is down too, which is exactly when a reader most wants it.

The answer is *not* to sneak browser-direct Sentry back in as a fallback — that reintroduces all four
objections at the worst moment, unsupervised. It is that **a failed submit must offer the reader
their own report back**: the filled-in text, copyable, with an email address to send it to. The
report is not lost, and nothing leaves the machine by a path we did not choose.

### The exception, stated out loud

**This is the one channel on which a reader's own words leave this machine on purpose.**

Everything in [`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts) exists because *"four times
now, an `Error.message` in this codebase has turned out to contain the article"*. A feedback report
inverts that: the reader typed the words themselves, into a box that says where they go, having
pressed a button labelled Feedback. That is consent, and it is a different thing from a leak.

But **consent licenses the message, not the machinery**. So the same rule `safeEvent` follows applies
at this new seam, in the same words: **build the payload, do not clean it.**

- The server constructs the Sentry payload field by field from a typed shape. Nothing off the wire
  is spread into it.
- The diagnostics blob is an allowlist at *both* ends — the client builds it from named fields, and
  the server validates against the same named list and drops the rest. Two independent mechanisms,
  the same argument `dataCollection` gets in `initMonitoring`: redundant, and free.
- Every free-text field is length-capped before it is stored or sent, so one paste of an entire
  article cannot become an attachment.

The distinction that keeps this honest is the one `safeEvent` already draws about `user`: the field
is *set by us*, at one seam, from a shape we declared — it is not a passthrough that happens to be
allowed.

#### Building the parameters is not enough, and I proved myself wrong about this

**This is the most important correction in the plan, and the reason the review was worth doing.**

The plan originally said that constructing `SendFeedbackParams` field by field made the payload
closed. GPT Sol said that does not follow, because `captureFeedback` ends in
`scope.captureEvent()`, and `prepareEvent` merges **global + isolation + current** scope data —
`getCombinedScopeData` in `@sentry/core`'s `utils/scopeData.js`. That is exactly the ambient
enrichment `safeEvent` strips off errors, and `safeEvent` does not run here.

I tested it rather than taking either of us on trust. A hostile isolation scope, our exact `init`
options, the fake transport, the real envelope printed:

| seeded on the scope | reached the envelope |
|---|---|
| `setExtra("articleProse", …)` | **yes** — `extra` |
| `setContext("provider", {body})` | **yes** — `contexts.provider` |
| `setTag("leakyTag", …)` | **yes** — `tags` |
| `addBreadcrumb({message, category:"console"})` | **yes** — `breadcrumbs` |
| `user.username`, `user.ip_address` | **yes** — both, unreduced |

So my first probe proved less than I claimed from it: it used a *benign* scope, and the check agreed
with the code because it shared an assumption with it — [silent-success.md](../reusable/silent-success.md)
exactly. `ip_address` is the sharpest instance: `safeUser` drops it deliberately, and on this path
`safeUser` never runs.

**A fresh current scope alone does not fix it either** — also tested, also leaked, because the
isolation scope is merged regardless of what current scope you pass.

**What does work**, verified, all five markers gone and `user` reduced to `{id, email}`:

```ts
withIsolationScope(new Scope(), () => {     // a CLEAN isolation scope, two-arg form
  const scope = new Scope();                // and a clean current scope
  scope.setClient(getClient());
  scope.setUser({ id, email });             // re-added explicitly, from the gate
  scope.setTag("report_id", reportId);
  captureFeedback(params, hint, scope);
});
```

`beforeSendFeedback` cannot serve as the allowlist instead: it fires *before* scope capture.

The test for this must seed hostile extras, contexts, tags, breadcrumbs and user properties and
assert on the **final envelope**, not on the object handed to `captureFeedback`. A test that captures
on a clean scope proves nothing, which is how the first version of this got it wrong.

And the gate's email is passed explicitly as `SendFeedbackParams.email` — `contexts.feedback.contact_email`
is what Sentry's feedback UI reads, and it is a different field from `user.email`.

### Article identifiers, not article prose

Greg left this to judgement. The answer is **identifiers, and no prose**, and his own question
contains the argument: *"presumably we already have it in our database"*.

The slug and the revision id let us open the exact article the reader was looking at, from our own
Postgres, at the revision they saw. The prose adds nothing we cannot already get — and it is
precisely the thing `monitoring-scrub.ts` exists to keep off the wire. Sending it would buy us a copy
of what we have, at the cost of the one rule this codebase has defended four times.

So the report carries block **ids**, not block text. [block-ids.md](../project/block-ids.md) is the
reason that is enough: an id is the address of a passage, and every feature in the app already
addresses text that way.

### Simpler options passed over

- **A `mailto:` link.** Genuinely simplest, zero code. Rejected because it carries none of the
  diagnostics, depends on a configured mail client, and produces nothing queryable.
- **Sentry's own `feedbackIntegration()` widget.** A drop-in button and dialog, no UI work at all.
  Rejected on three counts: its dialog is not our three questions; it files browser-direct (all four
  objections above); and it would pull the widget and its bundled DOM-to-canvas renderer into the
  client bundle.
- **A Postgres table only.** Boring and ours, but nothing then links a report to the release, the
  errors around it, or the source maps, and there is no interface to read one until we build it.
  Greg chose both.
- **Session Replay for "what you saw instead".** It is the best possible answer to that question and
  it is refused for the reason already written in `src/web/monitoring.ts`: *"It records the screen,
  and the screen is somebody's article. Not a cost decision."* That reasoning does not weaken because
  a different feature would like it.
- **Silently attaching console output.** Rejected: console output in this app has twice turned out to
  contain article text (`src/web/upload.ts` logs 400 characters of an upstream body; `lib/api.ts`
  logs the server's response body). It goes behind the tick-box, truncated, or not at all.

## What a report carries

Three groups. The first two are about the *application* and go every time; the third is the reader's
opt-in and is default-off, as Greg asked.

### Always — the reader's words

The three fields, stored separately rather than glued into one string, so we can query "how many
reports mention scrolling" later without regex over prose. Each length-capped.

### Always — where they were

- **A parsed, versioned location. Never `location.href`.** The first draft of this plan sent the
  full URL and called it "the highest-value field, and it costs nothing". GPT Sol killed it, and it
  was the worst thing in the plan: in this app the address carries **`?q=` and `?find=`, which are
  reader-typed search text**, and `/add/…`, which is *a third-party URL* that may carry credentials
  or a query token, and auth-callback parameters — plus every parameter added after this code is
  written, which it will know nothing about.

  Sending it would also have contradicted a decision already made two files away:
  `httpContext` and `urlQueryParams` are off in both halves of monitoring precisely so a URL does not
  leave.

  So the report carries a **versioned, closed structure** built by us: route kind, the validated
  slug, closed-vocabulary view/mode values, granularity level, the block ids in view. Never the raw
  query string, never the `/add/` target. The version number is there so an old report is still
  readable when the shape changes.
- The **build commit** (`__SPIDERYARN_BUILD_COMMIT__`) and environment — the same string the release
  and the source maps were uploaded under, so a report names a deploy.

### Opt-in — "Send extra diagnostics"

Default false, with the copy saying plainly what each line means, per
[copy.md](../project/copy.md) and the research finding that a silent bundle of console output is the
wrong default.

- **Recent API calls** — a small ring buffer kept by `src/web/lib/api.ts`: method, path, status,
  duration, and **`x-vercel-id`**. This is Greg's *"anything else that will help us correlate it with
  our Vercel logs"*, and it is the direct answer: `x-vercel-id` is the request id Vercel logs under,
  it is readable because these are same-origin requests, and a reader files feedback seconds after
  the request that went wrong. Nothing in this repo correlates a browser to a server log today.
- **Device and browser facts** — viewport, `devicePixelRatio`, user agent, language,
  `navigator.onLine`, timezone, `prefers-color-scheme`, `prefers-reduced-motion`. These were in the
  always-on group until GPT Sol pointed out they are **facts about the reader, not the application**,
  and together they fingerprint. Behind the tick-box, where facts about a person belong.
- **Recent uncaught errors and unhandled rejections**, via a new shared
  **`safeDiagnosticError()`** exported from `monitoring-scrub.ts` — *not* by exporting the private
  `authored()` boolean and re-deciding at the call site.

  The plan first said "the stack survives either way, because a stack is code locations". That is
  weaker than the reasoning already in this repo, and `safeFrame` is the proof: it strips query
  strings and fragments from `filename` and drops `abs_path`, because a browser stack can carry a
  full URL with a query in it, a `data:` or `blob:` URL, an extension URL, or eval text — and
  `Error.name` is writable, so even the name is not automatically safe. One function returns the
  whole decided shape: an identifier-shaped type, an authored message if allowed, and parsed
  allowlisted frames. The rule stays in the file that owns it.

- **The log of the run-up** — the last N entries of a client-side log buffer, normally thrown away.
  Greg's idea, 2026-08-31, and it is better than the three hardcoded seams this plan first had.
  Design in [The client log buffer](#the-client-log-buffer) below.

#### The console is not scraped, and that is a correction

Greg asked for *"contents of web browser errors/logs/console"*. Taken literally — patching
`console.error` / `console.warn` and shipping what they say — that is a leak, and the survey found
the specific reason:

- [`src/web/lib/api.ts`](../../src/web/lib/api.ts) `logFailure` writes **300 characters of the
  server's response body** to the console on every failed request.
- [`src/web/upload.ts`](../../src/web/upload.ts) writes 400 characters of an upstream response body.

Those two are named *by name* in [`src/web/monitoring.ts`](../../src/web/monitoring.ts) as the reason
breadcrumbs are locked off three separate ways: *"Both would have gone straight to Sentry as
breadcrumbs on the next error."* A console scraper is that decision undone through a side door,
behind a tick-box the reader cannot possibly evaluate.

**So we record what we chose, at seams we name, instead of scraping what anything happened to
print.** A new ring buffer is written to from exactly three places that already see every failure —
`logFailure`, `attempt`'s transport `catch`, and `AppBoundary`'s `componentDidCatch` — and each entry
is **structured fields, never text**: method, path, status, duration, `x-vercel-id`, timestamp.

This is better for us as well as safer. "GET /api/article/foo → 500 in 4.2s, x-vercel-id lhr1::abc"
is a row we can pivot on; three hundred characters of somebody's article with a stack trace in it is
not.

### The client log buffer

Greg, 2026-08-31, on reading the refusal above:

> perhaps we could add some logging library that stores local state ephemerally that normally just
> gets thrown away (or has a fixed FIFO length), but could be included in the error message as a
> rich log of what happened in the runup to the problem?

**Yes, and it is a better design than the three fixed seams above** — that was a cramped special case
of this. The property that makes it safe is the one both versions share, and this one states
better: **we write the log calls**, so the buffer is an allowlist by construction. It only ever
contains what we decided to put in it. A `console.*` interceptor is the opposite — it collects what
*other* code chose to print, which is why it is refused.

#### No library. It is about eighty lines.

Researched against
[third-party-library-selection.md](../reusable/third-party-library-selection.md), 2026-08-31.
`loglevel`, `consola`, `tslog`, `winston`, `debug` and pino's browser build were all measured.

`tslog` 5.1.0 actually ships a first-party `ringBufferTransport` — the only library-provided
implementation of exactly this. It is **six weeks old**, with no Stack Overflow answers, blog posts
or issue history behind it, which fails this repo's headline criterion outright.

But the deciding argument is not that. It is that **none of these libraries knows this app's
denylist**, so the redaction layer — the part that actually carries the safety — has to be written by
hand whichever library sits in front of it. Once that is written, the buffer is about thirty lines.
Adding a dependency to save thirty lines while still hand-writing the fifty that matter does not earn
its keep. `src/web/lib/api.ts` already refuses a client logger; see below for why that refusal is
being revisited rather than ignored.

#### The four rules, each from evidence

1. **Redact and truncate at write time, not at send time.** Sentry's own `beforeBreadcrumb` runs on
   every add rather than on the way out, and the
   [OWASP logging cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
   calls this minimisation at the source. Redacting on the way out means the sensitive value sat in
   memory as a live reference for its whole life, which is strictly worse.
2. **Never push a raw object, an `Error`, or a DOM node into the buffer.** This is a real leak, not a
   style rule: a retained reference keeps the object and everything it reaches alive until it is
   evicted — Firefox tracked the same mechanism in `console.log` as
   [Bugzilla #1717362](https://bugzilla.mozilla.org/show_bug.cgi?id=1717362). Call sites extract the
   fields they need; the buffer stores flat, already-truncated values.
3. **Named fields, never `Record<string, unknown>`.** A closed `LogFields` type, extended
   deliberately. This is the same argument `SAFE_PROPS` in `monitoring-scrub.ts` already makes: an
   allowlist drops the property nobody thought about, which is always the one that leaks. Plus a
   key-name denylist (`password`, `token`, `secret`, `auth`, `cookie`, …) as the second, redundant
   mechanism.
4. **Lazy serialisation, eager redaction.** Store redacted plain objects; `JSON.stringify` once, only
   when the reader ticks the box. Stringifying on every call pays the cost on the hot path for
   entries that are almost all evicted unread — and `JSON.stringify` throws on a circular reference,
   from inside a `catch`, which is the failure `src/log.ts`'s `describe` already warns about.

A true fixed-capacity circular array (pre-allocated, `head`/`count`, overwrite in place), ~200
entries, ~300 characters per message. Notably Sentry's own buffer is *not* one — it is `push` then
`slice(-maxCrumbs)` on every overflow — and a real ring is both simpler to reason about and cheaper.

#### It reverses a written decision, and that is deliberate

[`src/web/lib/api.ts`](../../src/web/lib/api.ts) says in its header:

> There is no client-side logger here and there should not be one … a browser already has a console.

That was right when it was written and this plan makes it wrong, so the comment gets updated in the
same change rather than quietly contradicted. **The stated reason is true for a developer sitting at
the machine and false for a reader on their own laptop, whose console we will never see.** That gap
is the entire thing this feature exists to close. The rule that survives intact is the one underneath
it — a response body never becomes a user-facing message, and now also never becomes a log entry.
- **Article identifiers** — slug, revision id, view/mode, granularity level, which artefacts exist,
  block count, root block id, and the block ids on screen. No prose; see above.
- **Job state** — any in-flight ingest job's id, step and status. The 2026-08-28 outage was failing
  ingests, and this is the field that would have named it.
- **A screenshot the reader pastes in.** Not one we take: see [the spike](#the-screenshot-spike) for
  why one-click capture costs a dependency that fails this repo's own library criterion, and why the
  most popular option would misrender every picture it took.

## Postgres only, and the filesystem store gets nothing

This was an open question for about an hour, and Greg closed it by pointing at
[260831b-finish-the-database-move.md](260831b-finish-the-database-move.md): the move off files is
being finished now, and **its stage 4 deletes the filesystem store outright**.

So the question answers itself. A files adapter for feedback would be twenty lines written against a
module with days to live, plus a `tests/store-parity.test.ts` obligation to keep two implementations
agreeing until one of them is deleted. `feedbackStore` is Postgres-only, and the files branch throws
the **501 refusal** that `visibilityStore` already establishes as the house pattern for a
Postgres-only feature.

The worry that made it a question — a Feedback button dead on a laptop — mostly evaporates with it,
since the laptops are moving to Postgres too. What is left of it is worth one line of care: the
dialog must render the 501 as a sentence saying the report was not saved, not as a spinner that
stops. A button that can only fail is worse than no button, because pressing it is how you find out
(the rule `Masthead.tsx` already states about the rename pencil).

## The durable report, decided before the migration is generated

GPT Sol refused the table stage as written: it named only the three answers, `owner_id` and
`created_at`, and left screenshot storage explicitly undecided — *"If diagnostics or screenshots
exist only in Sentry, the claim that the durable row is the authoritative report is false for those
parts."* That is correct, so the contract is settled here.

**Columns** (stable, queryable): `id` (client-minted, unique per owner — the idempotency key),
`owner_id`, `reporter_email` (a **snapshot** taken from the gate at submit time, not a join —
`auth.users` is not ours and an address can change), `steps`, `expected`, `actual`, `consented`
(whether the tick-box was on), `route_kind`, `slug`, `build_commit`, `environment`,
`request_vercel_id`, `diagnostics_version`, `mirrored_at` (null until Sentry took it),
`sentry_event_id`, `created_at`.

**`jsonb`**, with the sentence [sql.md](../project/sql.md) demands for not being a column: the
bounded diagnostics blob. It is versioned, its shape will change, and no part of it is queried —
that is the exception the rule allows, and `article_revisions.summary` is the precedent.

**`bytea`**: the processed screenshot, small and already downscaled. It lives here as well as in
Sentry, because otherwise the durable row is not the whole report.

### Two destinations, and what happens when the second one fails

- **The row is authoritative.** It is written first, and its success is what the reader is told
  about.
- The store returns a **discriminated `created | duplicate | limited`**, and only a *newly created*
  row is mirrored. Feedback is not deduped by Sentry (verified), so mirroring a retry would file the
  same report twice.
- `mirrored_at` records that Sentry took it. The crash window between insert and mirror is real,
  small, and **accepted rather than engineered away** — an outbox is the alternative and it is more
  machinery than an alpha feedback button is worth. `mirrored_at` being null is the query that finds
  anything stranded.

### The rate cap is inside that operation, not in front of it

`count` then `insert` is raceable — concurrent requests all see the same count and all insert. So:
check idempotency, take an **owner-scoped advisory lock inside the transaction**, count over an
indexed `(owner_id, created_at)`, insert. **Ten reports an hour.**

Said plainly: that stops a loop and one account hammering. It is not a defence against account
farming and does not pretend to be.

### The screenshot is validated on the server

Client-side downscaling is not validation. The server enforces the **decoded** byte size, and writes
a constant filename and content type — a client-supplied MIME type or filename is never forwarded to
Sentry or stored.

## One open question for Greg

**There is no rate limiting anywhere in this repo.** This is the first authenticated write with no
natural ceiling on it — a comment is bounded by passages, a job by articles, but feedback is bounded
by nothing. The plan below adds a per-owner cap (a `count` over the last hour) because it is four
lines, and names it here rather than letting it be inherited.

## Stages & actions

Ordered so the valuable half ships first: a working button that files a real, queryable report is
the whole point, and every stage after it is enrichment. Stop after the second stage and the feature
is already worth having.

### Preparation

- [x] Send this plan to GPT Sol for review, fold in what survives, bring its questions back to Greg.
      Done; findings folded in above and below. **No `git pull`** — an earlier draft had one, copied
      from the planning template, and GPT Sol was right that it does not belong: in this shared tree
      a pull can merge or rebase into another agent's in-progress work, which the working agreements
      forbid.
- [ ] Baseline recorded before any of this lands: **12 test files / 14 tests already failing**,
      largely the peer session's in-flight `toc`→`hierarchy` rename. Diff against that at the end
      rather than reading a red suite as this feature's fault.

### Stage: the table and the store

- [x] Add `feedback` to [`src/db/schema.ts`](../../src/db/schema.ts), after `readerProfiles`.
      Columns, not JSON, per [sql.md](../project/sql.md) — the three questions are three `text`
      columns, not one blob, so "how many reports mention scrolling" is a query rather than a regex.
      `ownerId: uuid("owner_id").notNull()` with **no `.references()`**; the `auth.users(id)` FK is
      added by hand in a `--custom` migration, as every other owner column is.
      `check()` on any closed vocabulary. `createdAt()` helper.
- [x] `npm run db:generate` → `drizzle/0039_feedback.sql`, plus the custom migration for the FK.
      **Read the SQL before applying it.** Apply locally only; ask Greg before anything touches the
      remote database ([database.md](../project/database.md)).
- [x] Update the two tests that are *designed* to go red here:
      `tests/db-schema-drift.test.ts` (the exact alphabetical list of table names) and
      `tests/db-schema.test.ts` (the `pg_constraint` check for the new FK).
- [x] `FeedbackStore` in [`src/store/contracts.ts`](../../src/store/contracts.ts), returning the
      discriminated `created | duplicate | limited`; `pg-feedback.ts` registered in
      `src/store/index.ts` with the files branch throwing the 501.
      **Modelled on `pg-comments.ts` and the transactional stores, not `pg-reader.ts`** — GPT Sol's
      correction, and it is right: `pg-reader` is a scalar upsert, while this is append-only,
      idempotent and rate-limited inside one transaction.
- [x] A focused test that the files branch refuses with 501 and that the dialog reports that refusal.
      `tests/store-parity.test.ts` does **not** discover a new contract automatically, so nothing
      else would catch it.
- [x] **Log lengths, never text** — `logger.info({ chars: body.length }, …)`, the rule
      `pg-comments.ts` already keeps.
- [x] `npm test && npm run typecheck`.

**What landed, 2026-08-31.** `drizzle/0039_feedback.sql` (the table) and
`drizzle/0040_feedback_owner_fk.sql` (the `auth.users` key, by hand, as every other owner column
is), applied to the local database only. `src/db/schema.ts` § feedback,
[`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts), the contract in `contracts.ts`, the
501 in `src/store/index.ts`, and `tests/feedback-store.test.ts`.

Four things were decided here that the plan left open, and each is argued at its own definition:

- **The screenshot's bytes live in the row**, as `bytea`, capped by a CHECK on `octet_length` — so
  the durable row really is the whole report rather than a stub beside Sentry.
- **The diagnostics blob and its version are two columns**, not a version inside the blob, so the
  version can be filtered on without reading the blob and there is one copy of it.
- **Consent is a constraint, not an intention**: `feedback_diagnostics_consented` makes a row that
  carries diagnostics the reader did not agree to a state this database does not have. The
  screenshot is deliberately outside that rule — pasting a picture in *is* the consent for it.
- **The advisory lock is taken before the idempotency read**, not after. With it after, two copies
  of one retry both find nothing, serialise on the lock, and the loser gets a uniqueness error that
  becomes a 500 — the reader's report failing for a reason that is not about their report.

The half of the 501 item this stage cannot do is **that the dialog reports the refusal**; the store
refuses with a sentence saying the report was not saved, and showing it belongs to the dialog stage.

### Stage: the route, and a report that lands

The end-to-end skeleton. After this stage a `curl` files a real report.

- [x] **Write the failing route test first** and watch it go red — `tests/feedback-route.test.ts`,
      copying `call()` from `tests/routes.test.ts` and `acceptAny` / `AUTHED_HEADERS` from
      `tests/helpers/authed.ts`. 16 of its 17 were red before a line of the route existed; the
      seventeenth — *an anonymous request gets 401* — was green from the start, because the gate in
      `handleApi` runs before any route matches. That one is still worth having: a button hidden in
      the client is not a gate, and the test is what says so.
- [x] `POST /api/feedback` in [`src/routes.ts`](../../src/routes.ts), matched on `path` not `url`.
      Its own body limit, the way `MAX_AUDIO_BODY_BYTES` is its own rather than raising the shared
      64 KB for forty other routes.
- [x] A validator beside `createFree`. **No request text in any `httpError` message** — those are
      written to logs as `reason`. Bracketed codes per [copy.md](../project/copy.md).
- [x] A client-minted idempotency id, so a double-submit or a retry cannot file twice.
- [x] The per-owner hourly cap from the open question above.
- [x] `npm test && npm run typecheck`.

**What landed, 2026-08-31.** `POST /api/feedback` in `src/routes.ts` — `fileFeedback`,
`parseFeedback`, `feedbackWhere`, `feedbackAnswer`, `feedbackScreenshot`, `feedbackEnvironment`,
`requestVercelId`, and `MAX_FEEDBACK_BODY_BYTES` beside `MAX_AUDIO_BODY_BYTES` — plus
[`src/feedback-payload.ts`](../../src/feedback-payload.ts) and `tests/feedback-route.test.ts`.

The HTTP mapping: **201** created, **200** duplicate (a retry that finds its own earlier report has
succeeded, and an error would make a client retry a submit that already worked), **429** limited
with a `Retry-After` and `[fb-often]`, **413** for a body or a decoded screenshot past its cap,
**400** for everything the validator refuses, **401** from the gate for a stranger.

Four things were decided here that the plan left open:

- **The environment is asked of the server, not of the browser** — the same `VERCEL_ENV ?? NODE_ENV`
  pair `initMonitoring` builds Sentry's from. A client-supplied value would be a claim, and the whole
  point of the column is that it is not. Same for `reporterEmail` (the gate's) and `requestVercelId`
  (this request's own header, which a browser cannot set).
- **The diagnostics blob got a v1 shape**, in `src/feedback-payload.ts`, so the server has a named
  allowlist to validate against before the dialog exists to build one. It imports nothing, so the
  dialog can share the declaration rather than keep a second, looser copy. Recent errors carry a
  **name and no message** in v1 — the `safeDiagnosticError()` this plan asks for belongs to the log
  buffer stage, and until it exists a name is what may travel.
- **A screenshot is identified by its own magic bytes**, PNG or JPEG, and refused otherwise. Not
  tidiness: without it the field is a 400 KB hole through which any bytes at all — an article
  included — reach a third party as an attachment.

  **Superseded on 2026-09-01, and it was not enough**: eight bytes of signature followed by anything
  at all still passes, and a valid PNG can carry text chunks, EXIF and a whole appended payload after
  `IEND`. The screenshot is now decoded and written again — see the review stage below. The filename and content type are written from
  that sniff, so there is no field in which a caller could put either, and an unexpected key in the
  body is a 400 rather than something ignored.
- **The `fb-` codes are inline in `src/routes.ts`**, not in `src/messages.ts`, following `cmt-` and
  `mic-`: that file is about failures a model call can return, and `tests/messages.test.ts` requires
  every `CODE_KINDS` key to belong to a message in it.

### Stage: the Sentry mirror

- [x] `src/feedback.ts` — build the Sentry payload **field by field from a typed shape**, the same
      "build, do not clean" rule `safeEvent` follows, at the seam `safeEvent` provably does not
      cover. Tag it with our report id so a Sentry item and a Postgres row name each other.
- [x] Wrap it so it **can never throw** and never fails the request — rule 2 of
      [`src/monitoring.ts`](../../src/monitoring.ts). The row is already written; a Sentry outage
      must not turn a filed report into an error for the reader.
- [x] A test that asserts the built payload contains the three answers and **nothing outside the
      allowlist**, and one that asserts a throwing Sentry leaves the request successful.
- [x] Note in the doc that this event bypasses `beforeSend`, with the evidence, so the next person
      does not assume `safeEvent` is covering it —
      [sentry-error-monitoring.md](../project/sentry-error-monitoring.md#a-feedback-report-is-the-one-thing-here-beforesend-never-sees).

**What landed, 2026-08-31.** [`src/feedback.ts`](../../src/feedback.ts) and
`tests/feedback-mirror.test.ts`.

**The table above was reproduced rather than trusted.** A naive `src/feedback.ts` — parameters built
field by field, `captureFeedback` on the ambient scope — was written first and run against the
hostile scope with a fake transport, and every one of the five markers reached the envelope:
`extra.articleProse`, `contexts.provider`, `tags.leakyTag`, two `breadcrumbs`, and a `user` carrying
`username` and `ip_address: 203.0.113.7`. Then the two clean scopes went in and all five went. That
is the red-before-green this plan asks for, on the one assertion it exists for.

Three things decided here:

- **`markMirrored` is never written hopefully.** No client, no mirror, and no `mirrored_at` — so the
  `mirrored_at is null` query keeps meaning "Sentry did not take this" rather than "Sentry was
  switched off". That is also the ordinary case on a laptop.
- **`report_id` and the user go on the scope; every other tag goes in `SendFeedbackParams.tags`.**
  Those two are the fields that join the event to a row and to a person, and they are set at the one
  seam that knows both.
- **`server_name` and `contexts.runtime` still ride**, added by `prepareEvent` after any hook can
  reach them. They are facts about the server rather than about the reader, and Sentry already has
  this project's source maps. Accepted, and written into the file's header rather than found later.

  **Reversed for `server_name` on 2026-09-01.** It is also a free-form string an event processor can
  write, and once the envelope guard existed there was nothing that could tell a hostname from a
  paragraph. `contexts.runtime` stays, rebuilt from two shape-checked fields.

### Stage: what the second review sent back, 2026-09-01

**GPT Sol reviewed the built code and would not have shipped it.**
[260831aj-…-code-review-sol.md](260831aj-feedback-button-and-bug-reports-to-sentry-code-review-sol.md)
is the review; every finding in it was reproduced before it was fixed. The five, and what each cost:

- [x] **The global scope still leaked, and so did an event processor.** The plan's own correction
      above — replace the isolation and current scopes — was *itself* incomplete, because
      `prepareEvent` **starts from the global scope** and merges the other two into it, and an event
      processor runs after all three. Reproduced: global extras, a global scope attachment (they are
      appended *after* `hint.attachments`, so they arrive as extra envelope items) and a processor's
      rewrite of `extra`, `tags` and `server_name` all reached the final envelope.

      So the guard moved to the **envelope**, on the line before the transport, in a new
      [`src/feedback-envelope.ts`](../../src/feedback-envelope.ts). It **rebuilds** the feedback item
      from what `mirrorFeedback` registered before capturing — only `event_id` and `timestamp` are
      taken off the event, both shape-checked — and writes the attachment items from the
      registration, so an ambient attachment wearing our own filename is never copied rather than
      filtered.

      Of the two designs the review would accept, this is "wrap the transport", taken through the
      SDK's own `beforeEnvelope` hook. Chosen over replacing the transport factory in
      `initMonitoring` for a reason worth stating: the guard installs itself on **whatever client
      `mirrorFeedback` finds**, so the test's client and the production client run the same code. A
      guard wired into `initMonitoring` would have to be re-wired by hand in the test, and the test
      would then be evidence about the test.

      **`server_name` no longer rides**, reversing the third bullet of the stage above. It was
      accepted there as "a fact about the server"; it is also a free-form string an event processor
      can write, and the guard cannot tell a hostname from a paragraph. `contexts.runtime` stays,
      rebuilt from two shape-checked fields.
- [x] **Caller-controlled strings crossing boundaries.** Four of them:
      - `Unexpected field: ${key}` in **two** routes — feedback's and, pre-existing from `c5c7e37`,
        `transcribeDictation`'s. `logRequest` writes an `httpError` message as `reason`, so that is
        an authenticated caller writing prose into our logs a request at a time without ever
        reaching the rate limiter, which counts reports and not refusals. Both are fixed prose now.
      - The diagnostics blob was length-capped and not shape-checked, so `blockIds` took 200
        arbitrary 64-character strings and an API `path` took 200 arbitrary characters. Every field
        in [`src/feedback-payload.ts`](../../src/feedback-payload.ts) is now an identifier, a closed
        vocabulary, a number in range or a timestamp; paths are reduced to **route templates**
        (`/api/chat/:x/live`); block ids go through `isSpideryarnId`. That file now imports
        `src/ids.ts`, `src/modes.ts` and `src/read-address.ts`, all of which are import-free enough
        for the dialog to share it.
      - `requestVercelId` was truncated and never shape-checked, then made a Sentry tag — relying on
        Vercel to overwrite the header rather than establishing the invariant. Shape-checked now.
      - **The screenshot.** `sniffScreenshot` checked eight bytes, so `PNG_SIGNATURE || articleProse`
        was stored and forwarded. Replaced by [`src/feedback-image.ts`](../../src/feedback-image.ts),
        which takes the file apart, inflates the raster, checks it is exactly the size the header
        says, and **writes a new PNG**. Text chunks, EXIF and anything after `IEND` are never copied.
- [x] **`mirrored_at` claimed delivery it could not know about.** Split into `mirror_attempted_at`
      (written when the event is handed over) and `mirrored_at` (written only for a 2xx from the
      transport, via `afterSendEvent`), so `mirror_attempted_at is not null and mirrored_at is null`
      is a trustworthy stranded-report query. `markMirrored` is conditional on `mirrored_at is null`
      and answers whether a row changed. `drizzle/0045_feedback_mirror_attempted.sql`.
- [x] **The concurrency claim had no test that could disprove it.** Two `Promise.all` tests, and one
      thing that had to be discovered to make them real: **`pg` opens connections one at a time**, so
      the first `Promise.all` against a cold pool is not concurrent and says it is. With the pool
      warmed and the advisory lock deleted, six concurrent submits of one id produce four uniqueness
      violations and eleven distinct ids produce eleven `created`. Both were watched red.
      Also: `isolationLevel: "read committed"` is now explicit, and the cap uses the database's
      `now()` for both the cutoff and the retry rather than this process's clock.
- [x] **The outer body cap refused bodies the inner validator accepted.** `MAX_FEEDBACK_BODY_BYTES`
      is now derived term by term from the schema, and there is a maximum-valid positive control:
      the largest report the validator takes, at every cap at once, with the answers in the character
      `JSON.stringify` expands furthest.

**One thing was not fixed the way the review asked**, and it is worth naming. The review said to
decode and re-encode the screenshot with `@napi-rs/canvas`, which is already a dependency. Measured
2026-09-01 with Vercel's own tracer: naming that package from anything the API function reaches adds
**34 MB** to the bundle — one Skia binary — and turns `tests/pdf-bundle-trace.test.ts` red, which
lists `@napi-rs/canvas/index.js` under `MUST_NOT_SHIP` for exactly this reason and was written after
two production outages about that package. So the re-encode is a PNG decoder in about 200 lines of
`node:zlib` instead, and **JPEG is refused**: its entropy-coded scan cannot be length-checked without
a baseline decoder, so a rebuilt JPEG would still forward an opaque caller-supplied span, and half a
guarantee at this seam reads exactly like a whole one.

**That is a product decision, and it is Greg's:** the dialog stage below must produce PNG. If a
JPEG paste turns out to matter, the two ways forward are a baseline decoder or accepting the 34 MB.

### Stage: the button and the dialog

- [x] `FeedbackButton.tsx`, fixed top-right, mirroring `HomeLogo.tsx`'s fixed top-left.
      **The bars must reserve the space**, the way they already reserve `--logo-w` on the left —
      `.masthead-inner` and `.bar` run to the right edge and a long title reaches it, so an
      unreserved fixed button lands on top of the article's own title.
- [x] `FeedbackDialog.tsx` as a **native `<dialog>` with `showModal()`, following
      [`Lightbox.tsx`](../../src/web/Lightbox.tsx)** — not `AnnotateDialog`. GPT Sol's correction and
      a good one. `Lightbox`'s own header explains the split: the three hand-rolled
      `<aside role="dialog">` panels are non-modal *on purpose*, because you are meant to keep
      reading behind them. Feedback interrupts the page, so it is the modal case, and `showModal()`
      gives inert background, focus trapping and restoration, top-layer painting (no z-index budget)
      and Escape — four things the others each hand-roll.

      **And `AnnotateDialog`'s first-Escape-clears-the-box would be destructive here**, where there
      are three populated fields to lose.
- [x] ⌘/Ctrl+Enter submits; the **synchronous `sending` ref latch**, because `disabled` alone lets
      two clicks inside one frame through.
- [x] A failed submit shows the reader their own text, copyable, with somewhere to send it — the
      correlated-failure answer above.
- [x] `fb-*` classes in `styles.css`, not Tailwind — the house convention for dialogs.
- [x] Do **not** add `/api/feedback` to `CACHEABLE` in `lib/api.ts`. There is deliberately no offline
      write queue, so a failed submit must tell the reader rather than pretend.
- [x] Copy per [copy.md](../project/copy.md): say plainly what the tick-box sends, in the reader's
      words. They are not operating an AI application.
- [x] **Name the signed-in mounting condition explicitly**, and test both halves: the button is
      absent for an anonymous reader, and `POST /api/feedback` still answers 401. GPT Sol asked for
      both; a button hidden in the client is not a gate.
- [ ] **Stop and show Greg** — this is the first stage with anything to look at.

### Stage: what the third review sent back, 2026-09-01

[The UI review](260831aj-feedback-button-and-bug-reports-to-sentry-ui-review-sol.md) — GPT Sol, on
the client half, which neither earlier review had seen. **NO-SHIP again**, and right again. Two
blockers, two highs, two mediums; all fixed below.

The pattern across three reviews is worth naming, because it is the same one every time: **a
comment that describes the intended behaviour while the code does the opposite, and an author who
reads past it because they wrote both.** Twice now that has been the finding that mattered most.

1. **Blocker — the draft was destroyed by closing the dialog.** An effect cleared every box whenever
   `open` became true, under a comment claiming that *"a reader who closed it by accident and
   reopened it in the same second is the one person this would infuriate"*. It infuriated exactly
   them: a failed send, an Escape, a reopen, and the only copy of what they had written was gone.
   The draft now survives dismissal and is cleared in one place — `discard()`, on the way out of the
   thank-you panel.
2. **Blocker, the same finding's other half — a stale request could land in a new draft.** Closing
   mid-flight left the request running; a later success painted "Thank you" over a report that was
   never sent, and closing *that* threw the new words away. Every completion is now guarded on the
   report id still being current.

   The report id also moved from `useMemo` to `useState`. **`useMemo` is not storage** — React
   documents it as a hint that may be discarded and recomputed, so an idempotency key kept there is
   a key that may silently change, which is the one property it exists to have.
3. **The test written for blocker 2 found a third bug.** Closing mid-flight left the synchronous
   `sending` latch set, so on reopening Send did nothing at all — the words were there, the button
   looked live, and pressing it was silent. Abandoning the attempt is safe *because* the id is
   durable: press Send again, the same id goes out, and a first request that did land comes back
   `duplicate`. The awkward test earned its keep the way the easy one would not have.
4. **High — a screenshot still being re-encoded was silently dropped.** Paste and press ⌘+Enter in
   the same second and the POST was built from `shot === null`. Now `preparing` disables Send and
   refuses the keyboard path, and a generation counter means the newest paste wins whichever
   finishes first.
5. **High — the narrow controls bar lost the reservation.** `.controls` at `max-width: 731px` set a
   flat `padding-right: 0.75rem`, overriding § shell's `--feedback-w` term. **This is the third time
   a flat override has thrown that term away** (the masthead's shorthand did it on the left in
   August, and again in this query), and it was worse here: the bar is `overflow-x: auto` at that
   width, so the last control does not merely sit under the button, it *scrolls* under it.
6. **Medium — the failed-send fallback had no destination.** The panel offered Copy while the
   sentence beside it said to send the report by email, and named nobody. It now carries a
   `mailto:` to `ADMIN_EMAIL` — the same constant that decides who sees `/admin`, so there is one
   answer to "who runs this" — with the report id in the subject, and it says so when the browser
   refuses the clipboard.
7. **Medium — `x-vercel-id` was kept raw in the ring buffer** and validated only at collection,
   against the buffer's own first rule (*redact at write time*). Validated at write time now, with
   the collector and server checks kept as redundancy.
8. **`Error.name` was shape-checked but not closed** — `throw { name: "PROVIDER_BODY_MARKER" }` is
   an identifier and would have travelled. Replaced with a closed vocabulary at both ends. No live
   leak: nothing in this app assigns search text or a provider body to `Error.name`. It is the same
   argument `SAFE_PROPS` and `public/dto.ts` have already had — an allowlist drops the value nobody
   thought about, and a shape check does not.
9. **The client-keeps / server-drops class, audited in full.** A value the client sends in a shape
   the server does not accept **vanishes with no error at either end**, which is indistinguishable
   from a value that was never collected — the same invisible failure as everything else in this
   plan's history. Two were closed (`errors[].name`, `api[].vercelId`) and the rest audited:

   - **Fixed, because it was the expensive one.** The server drops an entire *call* when its path
     will not template, taking the status, the timing and the **`x-vercel-id`** with it — and that
     id is the only thing in this app that ties a browser to a line in a Vercel log. The request
     odd enough to lose its path is the one most worth correlating. The collector now sends `/:x`,
     the server's own word for a segment it will not repeat, and the row survives.
   - **Left, and named rather than fixed**: `article.level` and `article.blockCount` (out of range
     → that field becomes null, the rest of the article survives); `device.userAgent`,
     `device.language`, `device.timezone` (the browser writes them and the server shapes them —
     that is the design, and the cost of a loss is one fact about a machine); `job.step` and
     `job.status` (a shape here, a closed list there — and `job` is `null` in v1 anyway).

     Each loses one field rather than a row, which is why they are worth naming and not worth code.
     If a report ever arrives with a suspiciously empty `device`, this is the paragraph to read.

10. **Test gaps Sol named, now covered**: the visibility test ran only on `/` and would have passed
   if the button were mounted on the reading view alone, so it now covers anonymous `/read/<slug>`
   — the one address an anonymous person sees a real page at — and a second signed-in route.

   **And one of my own tests was proving nothing.** The stale-request test passed with the guard
   removed, because the sequence I wrote never diverged the id. The damaging sequence needs a report
   to have been *filed* in between, since that is the only thing that mints a new one. Rewritten,
   and red without the guard.

### Stage: the client log buffer and the diagnostics

- [x] `src/web/log-buffer.ts` — the ring buffer and the `log()` call, to the four rules in
      [The client log buffer](#the-client-log-buffer). No dependency. Module state, the shape
      [`src/web/offline.ts`](../../src/web/offline.ts) already establishes for cross-tree state that
      is not URL state.
- [x] **Tests first, and each must be red before it is green**: that a denied key name is redacted;
      that a long message is truncated; that the buffer never exceeds its capacity and evicts
      oldest-first; that nothing is serialised until it is asked for.
- [x] **"Three seams see every failure" was false**, and GPT Sol listed the misses:
      [`src/web/upload.ts`](../../src/web/upload.ts) uses XHR and never touches `apiFetch`;
      `Tweets.tsx` catches and logs, so it reaches neither the global handler nor `AppBoundary`;
      `leavingFetch` has its own failure path; and "recent API calls" needs **successes and non-2xx
      responses too**, not only the transport `catch`.
- [x] So the entry is a **discriminated union — `api` | `upload` | `client-error`** — written through
      one narrow recording function. An `AppBoundary` error does not have a method, a path or a
      status, and forcing it into an API-shaped row would have produced three empty columns.
- [x] **Strip the query string from every recorded path.** `apiFetch("/api/library/search?q=…")`
      otherwise captures reader-typed text — the same leak as `location.href`, one layer down, and
      worth stating twice because it was missed twice.
- [x] Build the collector **before** the tick-box that offers it, so the checkbox never promises
      something that is not there.
- [x] Update the header of [`src/web/lib/api.ts`](../../src/web/lib/api.ts), which currently says
      there should not be a client logger, with the reasoning above.
- [x] Read `x-vercel-id` off responses in `apiFetch`. Same-origin, so it is readable; this is the
      only thing in the repo that would tie a browser to a Vercel log line. Landed with the buffer.
- [x] The uncaught-error listener — `window`'s `error` and `unhandledrejection`, recording the
      error's **name only** into the buffer.

      **And `safeDiagnosticError()` was not built, which is a correction to this plan rather than
      an omission.** The bullet above used to say the listener would put messages through
      `authored()`. There is nowhere for a message to go: `FeedbackClientError` on the wire is
      `{ name, at }`, so a function whose job is to decide what may be said about an error would
      have had nothing to decide and no caller. It becomes necessary the day a message or a frame
      is admitted to the wire shape, and not before. Written down because a plan that quietly drops
      a named function is how the next reader concludes it was forgotten.
- [x] The always-on context: **route kind, validated slug, and build commit. Never `location.href`**
      — this bullet said otherwise until 2026-09-01 and was left standing after the section above
      had already reversed it, which is exactly the drift the reviews keep finding. The device and
      viewport facts moved behind the tick-box, where facts about a person belong.
- [x] A test proving the diagnostics blob contains no article prose, built from a fixture that has
      prose in every field it could leak from. **A check you have never seen fail is not evidence**
      ([silent-success.md](../reusable/silent-success.md)) — make it red first. It was seen red
      three separate ways, one per field it protects.

#### Two fields that ship as `null`, and they are not the same kind of gap

- **`job`** — nothing publishes into it. The ingest queue became a tab-level service
  ([`src/web/jobEngine.ts`](../../src/web/jobEngine.ts)) on 2026-09-01 and both it and `useJobs.ts`
  were being rewritten while this was built, so wiring a publisher into somebody else's in-flight
  work was the wrong trade. The reader half exists and is tested; finishing it is one
  `setFeedbackJobContext(…)` in one effect.
- **`revisionId`** — this one cannot be finished on the client at all. `Article` in
  [`src/types.ts`](../../src/types.ts) does not carry the revision it was projected from, and
  nothing under `src/web/` knows it. It needs the read payload to carry it, which is a different
  piece of work. The field stays in the shape so that when it lands it is a publisher change rather
  than a wire change — and a report that names a deploy but not a revision is still worth having.

### Stage: the screenshot

Greg: *"If it's complex, defer it. But do at least a bit of a spike … to see if we can get this
working soon without tooo much work."*

**The spike's answer is that half of it is not complex at all, and that half ships.** Full findings
in [the spike section below](#the-screenshot-spike).

- [ ] **Clipboard paste and drag-and-drop into the dialog.** About fifty lines, zero dependencies,
      no permission prompt, and it can never break on our CSS because it never touches our CSS. The
      reader takes their own screenshot (⌘⇧4, PrtScn) and pastes; a `paste` listener pulls the image
      off `clipboardData.items`, and a file input covers the reader who would rather pick a file.
- [ ] Downscale to 1600px on the long edge and send as **PNG** — not JPEG; see the note at the end
      of the review stage above for why the server refuses one — under ~300 KB, as a base64 field. **Its own body limit on the route**, the way
      `MAX_AUDIO_BODY_BYTES` is its own — a screenshot is four figures past what the other routes
      need, and raising the shared 64 KB for forty routes to admit one caller gives away the thing
      the limit was for.
- [ ] It rides to Sentry as an `attachment` envelope item, which is
      [verified to work from the server SDK](#what-was-verified-before-designing-rather-than-assumed).
      Store the bytes in Postgres or leave the image to Sentry alone — decide when writing the table;
      the row must at least record that a screenshot existed.
- [ ] **A one-click capture is deferred, and named so the next person does not re-derive it.**

#### The screenshot spike

Researched against [third-party-library-selection.md](../reusable/third-party-library-selection.md),
2026-08-31.

**`html2canvas` is out, and this is the finding that matters.** It has not shipped since 1.4.1
(January 2022) and its colour parser does not understand `oklch()` / `oklab()` — four open issues
since Color-4 landed, and the fix PR has never been merged. Our compiled CSS contains **39 `oklch()`
and 114 `color-mix()`** occurrences, because that is what Tailwind v4 emits. So the most popular,
most-pretrained-on option is the one that would visibly misrender every screenshot it took.

Worth recording, because it kills a natural worry: `color-mix()` is never what a library has to
parse. The spike checked `getComputedStyle` in a real browser — the engine resolves
`color-mix(in oklab, …)` to a plain `oklab(…)` before any JavaScript sees it. The only question is
whether a library understands `oklch()`/`oklab()` **syntax**, and every candidate except html2canvas
does, either with its own parser (`html2canvas-pro`) or by construction (the `foreignObject`-based
tools, which hand the string back to the browser's own CSS engine).

The best technical fit is **`@zumer/snapdom`** — 53 KB gzipped, zero dependencies, actively shipped,
and the only candidate whose docs explicitly promise correct behaviour on all three of this app's
hard surfaces: fixed/sticky chrome, the `<canvas>` force diagram, and the SVG sketch view.

**And it is deferred anyway**, because it fails this repo's own headline criterion — *"long-lasting
community, lots of docs/discussion/examples, so there will be lots of pretraining data"*. It is a
2024-era library with a name almost nothing has been trained on. That criterion exists for a reason
and this plan is not the place to make an exception to it for a tick-box.

`getDisplayMedia` is separately rejected: **`safari_ios: false`** — no mobile support at all — and
the options that would reduce the picker friction (`preferCurrentTab`, `selfBrowserSurface`) are
Chromium-only, so Firefox and Safari get the full "choose a window" picker on every capture.

So paste ships now, and if the reports show people want one click, `@zumer/snapdom` behind a lazy
`import()` is the upgrade — the capture function is one call, and the dialog does not change.

### Finishing

- [ ] `npm test`, `npm run typecheck`, `npm run check`, `npm run lint` on the touched files.
- [ ] Drive the real UI in a **Sonnet subagent** ([browser-testing.md](../project/browser-testing.md))
      — file a report, check the row lands, check the dialog at a narrow window and with a long
      article title, and confirm the button does not sit on the title.
- [ ] Docs: a new `docs/project/feedback.md`, owned by
      [dev-and-deployment-overview.md](../project/dev-and-deployment-overview.md); update
      [sentry-error-monitoring.md](../project/sentry-error-monitoring.md) with the feedback channel
      and the `beforeSend` fact; update [database.md](../project/database.md) and
      [security.md](../project/security.md) for the new egress.
- [ ] Second GPT Sol review, **on the diff, not the plan** — weight it higher than the first.
- [ ] Commit, by name, in one command.

### Deliberately not in this plan

- **Anywhere to read the reports.** There is no admin view; the first ones get read with `psql` and
  in Sentry. Worth building only once there are reports to read.
- **Alerting.** Still the open gap in
  [sentry-error-monitoring.md](../project/sentry-error-monitoring.md), unchanged by this, and a
  report that nobody is paged about is still a report we have.
- **Replying to a reporter.** The email is there; the reply is Greg's mail client.
