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

Seven components, as a closed TypeScript union rather than free-form strings — a typo in a component
name is invisible, because the line is still written and just never matches the filter built around
the name you meant.

| component | file | what it says |
|---|---|---|
| `http` | [`src/routes.ts`](../../src/routes.ts) | one line per API request: method, path, status, `ms`. Level follows the status — 4xx is the client's fault and is not an alarm, 5xx is ours and is |
| `jobs` | [`src/jobs.ts`](../../src/jobs.ts) | the queue: enqueued, each step's transition, the outcome — and **what the step cost in money**, on every one of those three. See [ingest-queue.md](ingest-queue.md) |
| `pipeline` | [`src/pipeline.ts`](../../src/pipeline.ts) | **what a step cost in tokens** — model, tokens in and out, `ms`. Its `model` is the stamp name (`claude-sonnet-5`), not the wire id the request carried; [setup-dev.md](setup-dev.md) says why those differ |
| `store` | [`src/api.ts`](../../src/api.ts), [`src/comments.ts`](../../src/comments.ts) | the silent fallbacks, chiefly the fixture one |
| `auth` | [`src/auth.ts`](../../src/auth.ts) | **only ever our side failing.** A refused token is not logged here — that is an ordinary 401 and the `http` line already says so. Nothing in this component may carry a token, a `sub` or an email address |
| `health` | [`src/vercel-health.ts`](../../src/vercel-health.ts) | the two errors `GET /api/health` catches — the store check and the schema check. The endpoint is public, so the caller gets the driver's message truncated to 200 characters and the whole of it comes here. Trimming the response is only safe while the untrimmed copy is somewhere |
| `model` | [`src/explain.ts`](../../src/explain.ts), [`src/converse.ts`](../../src/converse.ts), [`src/search.ts`](../../src/search.ts) | the model calls with a reader waiting on them — explaining a selection, chat, and semantic search |

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

### The two counts that are the only alarm there is

`cacheReadTokens` and `cacheWriteTokens` ride alongside `inputTokens` and `outputTokens`, on both the
`pipeline` line and the three `model` lines, and they are there for a reason worth stating plainly:
**a prompt cache that has silently stopped working is invisible.** The answer is still correct, no
error is raised, and the only symptom is a larger bill. A `cacheReadTokens` of 0 on a call that
should have been a repeat is the whole of the warning system.

The request-path lines also carry `tooShortToCache`, because under the model's minimum prefix a
breakpoint is accepted and does nothing — returning the same zeros as a broken cache. The boolean is
what tells those two apart. See [prompt-caching.md](prompt-caching.md#how-to-tell-whether-it-is-working).

Counts only, like everything else here: no prose, no article text, no criterion, no question.

### What a step or a request cost, in money

Since 2026-08-27 every model call in this app goes through OpenRouter, and OpenRouter puts
`usage.cost` on the response — a figure from the party doing the billing, not one we worked out.
[ai-gateway.md](ai-gateway.md) is the decision; what it means here is that a log line can carry a
cost without a price table behind it.

**Two lines carry it, not one.** Each pipeline step's line in [`src/jobs.ts`](../../src/jobs.ts),
and each API request's line in [`src/routes.ts`](../../src/routes.ts) — because a step is what the
pipeline spends money in and a request is what a *reader* spends it in, and until that second scope
existed every chat turn, explanation, search and dictation was recorded into no collector at all.
Same fields, same formatter (`spendFields` in [`src/ai-spend.ts`](../../src/ai-spend.ts)), so the
two can be added up together:

| field | means |
|---|---|
| `aiCalls` | how many model calls this step or request actually made |
| `aiCostNanos` | the total in nano-dollars — an integer, for anything that adds them up |
| `aiCost` | the same number as `$0.0142`, for the person reading the line |
| `aiUnpriced` | how many of those calls came back with no cost at all. **Present only when it is not zero** |
| `aiPending` | calls started and never recorded — always a bug. **Present only when it is not zero** |
| `aiPendingJobs` | which jobs those were, because a bare count says something leaked without saying where |
| `aiRunId` | the id every ledger row from this step or request carries, so the line and the rows can be joined |
| `aiWriteFailures` | calls that happened and left **no row**. **Present only when it is not zero** |

A line with none of these made no model call at all, which is most of them.

**`aiRunId` is the join, and it exists because the fields above are a summary.** Since 2026-08-28
each call is also a row — in `ai_calls` or in `data/_ai-calls.jsonl`
([ai-gateway.md](ai-gateway.md)) — and the question a surprising `aiCost` provokes is *which calls*.
Without an id on both sides, answering it means guessing at a timestamp range.

**`aiWriteFailures` is the one anomaly the ledger itself cannot report**, because the evidence is
the row that is not there. A failed insert is logged, counted here, and then invisible to every
later `npm run cost`. It is not the same as `aiUnpriced`, which is a row that exists and does not
know what it cost.

**A third line carries a total, and it is a different kind of total.** `endJob` in
[`src/jobs.ts`](../../src/jobs.ts) reports what the *whole ingest* cost, and it does not come from a
collector at all — a job spans several `advanceJob` calls with no frame in common, so the number is
queried back out of the ledger by `job_id`. Two fields exist on that line only:

- **`aiCostStatus: "unavailable"`** — the ledger could not be read. The one thing this line must be
  able to say, because a database that was down all afternoon and a job that spent nothing must not
  print the same number.
- **`aiCostStatus: "partial"`, with `aiUnreadable`** — some of the ledger would not parse, so the
  total below it is short by that many calls. GPT Sol found the first version dropping that count
  between the store and this line, which turned a short total into a confident one.

**Several fields rather than one number, because a bare total cannot be checked.** `aiCalls` is the
thing nobody can guess from outside — one step is often several calls, since `summarise` batches per
parent and `labels` fans out — so a total of $0.30 over nine calls and a total of $0.30 over one are
the same line without it. And `aiUnpriced` is what stops a total that is quietly short from reading
as a cheap run: a call that was aborted or that failed mid-stream never reached the `message_delta`
event carrying `cost`, so it is recorded as *happened, cost unknown* rather than as zero. **Its
presence on a line is a fact to explain**, which is why it is omitted when zero rather than logged
as `aiUnpriced: 0` — and why absent numbers are `null` everywhere underneath rather than `0`, since
a zero is indistinguishable from a free call and understates a bill for as long as nobody looks
([`src/ai-spend.ts`](../../src/ai-spend.ts)).

**One anomaly cannot be on these lines at all**, and it is worth knowing why rather than assuming it
was forgotten: a call that finishes *after* its step or request has already reported. By definition
that arrives after the line is written, so no field on it could ever be non-zero — a first draft
added one and it was a counter nobody could read. It is counted process-wide by `lateCalls()`
instead, beside `unscopedCalls()`, and each increment writes its own `warn` line — the counter alone
lives in one process's memory where nobody reads it, and the line is the part that reaches a person.

**`npm run cost` deliberately does not print either counter.** It is a different process and would
start them both at zero, so the pair of noughts would be reassuring and mean nothing. What it asks
instead is the question the rows can answer: how many reported no cost, and how much went on calls
that failed.

All of them are omitted together when a step made no calls. Most steps in most jobs are cached or free,
and four zeroes on every line is noise that makes the lines that matter harder to find.

**Logged from `jobs.ts`, which is the same rule as the section above** — log at the seam the queue
already owns, not inside another agent's stage
([architecture.md § Stage ownership](architecture.md#stage-ownership)). It is a stronger case here
than it was for tokens, because a step is *not* a model call: no stage can report its own total, and
threading one up would be a return-type change on all seven of them plus a place to forget it in
each. `collectSpend` in [`src/ai-spend.ts`](../../src/ai-spend.ts) is an `AsyncLocalStorage`, so the
stages say nothing at all and the seam still gets the whole bill —
[`src/messages-stream.ts`](../../src/messages-stream.ts) records each call on their behalf.

**And the cost is on the failure and cancel lines too, not only the success one.** That is
[§ The failure line carries what the success line carries](#the-failure-line-carries-what-the-success-line-carries)
applied to money, and it is one of the clearer cases for it: a step that failed had usually already
*paid* for the call that failed, and the Retry a reader presses afterwards pays again. A cost that
appears only on success would report the cheapest possible version of a bad day. `collectSpend`
hands the records back through an `onDone` callback rather than through its return value precisely
because the return value never happens when the step throws.

The same seam gives the block-id counts for free — `{ total, minted, carried, reused }` from stage 3.
An article re-run that mints new ids instead of carrying the old ones has **orphaned every comment on
it** ([block-ids.md](block-ids.md)), and that is not visible in the response, in the artefacts, or
anywhere else.

### The failure line carries what the success line carries

A rule that arrived the way most of these do — from a bug nobody could diagnose.

Greg hit chat's `[ai-empty]` failure on 2026-08-26 (chat-tools.md
[§ Still open](chat-tools.md#still-open)) with eight tool calls visible on his screen. The line
[`src/converse.ts`](../../src/converse.ts) wrote about it said `model`, `ms` and `finishReason`, and
nothing else. Not the round count, so a turn that reached the tool cap and one that gave up on its
first request write the same line. Not the tool count, so the eight calls he could see appear nowhere
in the record. Not a token count, so a model that spent its whole output budget thinking is
indistinguishable from one that spent none — which is the *specific* question that failure turns on,
and the question the previous version of it turned on too.

Every one of those numbers already existed. They were on the **success** line and nowhere else.

Which is exactly the wrong way round: an answer that arrived needs no diagnosis, and a turn that
failed is the one somebody has to reconstruct afterwards from a log they cannot re-run. So the eight
failure paths in `converse` now spread the same `rounds`, `tools`, `chars` and four token counts the
success line carries, from one `turnSoFar()` helper.

**And the success line spreads it too**, which is the half that makes "they cannot drift" a fact
about the code rather than a promise in a comment. The first version of this left the success line
maintained by hand — a GPT Sol review pointed out that two hand-maintained sets drift the moment
somebody adds a number to one of them, which is exactly how `converse` arrived at a failure line
with three fields on it.

Worth generalising, because this is not a chat problem: **when a line is added to a success path, ask
what the failure path says.** The natural instinct is the opposite one — the happy path is where you
are looking when you write the numbers, and an error already feels informative because it has an
error in it. It usually is not. `err` says what broke; it says nothing about what the request had
already done, and that is most of what a diagnosis is.

**The same rule has a second half, which took a second look to see: per-*item* state is lost too.**
`converse` resets `finishReason`, `roundText` and its tool-call map at the top of every round, so at
the moment anything throws, every round but the last is unrecoverable. A middle round that hit
`max_tokens` reports `length` and is then overwritten — and a turn that ends on some other reason
then reads as proof that the budget was fine, when the budget has only been checked for one request
out of four. The failure lines carry `finishReasons`, `roundChars` and `roundCalls` as arrays now.

Arrays rather than a line per round, and that is this file's own rule rather than a taste: a caller
that emits a line per item deletes the end of its own request's logs on Vercel
([§ Vercel](#vercel)). Four rounds would have been safely under the cap either way; one line is still
one line.

It is checked rather than trusted:
[`tests/chat-empty-answer-log.test.ts`](../../tests/chat-empty-answer-log.test.ts) reproduces Greg's
turn exactly — three rounds asking for three, three and two tools, then a fourth round offered no
tools that writes nothing — and reads the fields off the child's stdout. A child process because the
logger is `silent` under `NODE_ENV=test`, so an in-process assertion would be satisfied by a logger
that emits nothing at all; the same harness and the same reasoning as
[`tests/stop-details.test.ts`](../../tests/stop-details.test.ts).

### The fixture alarm, and what it can never fire for

The `store` warning on [`src/api.ts`](../../src/api.ts) says when an article was answered out of
`example/` rather than out of its own directory. That was the fallback which
[disguised a real path traversal as a refusal](security.md#why-it-survived-being-looked-at): a
shallow `../../etc` found no `blocks.json`, fell through to the fixture, and returned HTTP 200 with
plausible content. The response cannot tell you which directory answered. One line could.

**The fallback was removed on 2026-08-30** and the warning stayed. It is now an assertion rather than
a report: nothing can reach it, and if it ever fires again somebody has widened `candidateDirs` and
the symptom would otherwise be invisible in the response. That is the whole reason it is a log line
and not a comment.

Two things about it are worth knowing, both found while wiring it up:

- **It stays quiet for `example` itself.** Asking for the fixture and getting the fixture is the
  fixture working. Warning there would put a line on every fresh-clone page load, and an alarm that
  fires when nothing is wrong is an alarm nobody reads.
- **A corrupt article could never trigger it.** `readJson` returns `null` for `ENOENT` and *rethrows*
  everything else, so a `blocks.json` that exists and will not parse throws out of `loadArticle` as a
  500 — it never reached the fallback. Absent fell through; malformed did not. Two genuinely
  separate paths, which is worth writing down because the natural assumption is that both ended up at
  the fixture, and a corrupt article looking like a fixture read is exactly the confusion this
  warning would otherwise cause.

## What never gets logged

The redact list is in [`src/log-redaction.ts`](../../src/log-redaction.ts) — its own module rather
than a constant inside [`src/log.ts`](../../src/log.ts), so that `tests/log.test.ts` can *import* it
instead of parsing it out of the source with a regex. **Adding or removing a path is a two-line
change**, one in that module and one in `REQUIRED_PATHS` at the top of the test, which keeps a
hand-written copy of the list and compares the two. That duplication is deliberate: a test whose
coverage is derived entirely from the configuration proves every configured path works, and can never
prove the right paths are configured — delete one and the derived checks quietly stop asking about
it. See [§ Proving redaction, not assuming it](#proving-redaction-not-assuming-it).

Beyond the list, three standing rules:

- **No article prose, ever.** Not the text, not a comment's `quote`, not the model's `answer`. The
  reader's selected sentence is the most private thing this app holds. Ids, slugs, counts, statuses
  and timings.
- **Slug, not URL,** wherever a slug identifies the thing. See below.
- **Host, not URL, when the URL was not the reader's.** Chat's tools fetch pages the *model* chose
  ([chat-tools.md](chat-tools.md)), and it chose them because of what the reader asked — so a full
  URL in a log line is a fact about a reader's question, and a path can carry the question inside
  it. `hostOf` in [`src/urls.ts`](../../src/urls.ts) is what those lines log. A tool's `label` is
  worse still: it quotes the reader's own words back, which is what makes it worth putting on the
  screen and what keeps it out of the log entirely.
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
[Drizzle](../plans/260825f-postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth) lands — a
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

**And it came back twice the next day, which is the part worth learning from.** `src/chat.ts` was
written by copying `src/comments.ts` and copied the `reason` field with it — the exact line that had
just been removed. Then `src/searches.ts` was written the same way and did it a third time. Each
copy carried its own comment explaining why the value was safe: "the stored error string, never the
answer", "the stored error string, never the criterion and never a quote". Both true, and neither is
the point — the stored error string is *where the provider's response body is*.

Three things follow from that, and the third is the one that matters:

1. A fix that lives only in one file's history does not survive that file being used as a template.
   All three sites now carry the reasoning in full and name each other.
2. **A comment asserting that something is safe is not evidence that it is.** All three were written
   by someone who had reasoned about it and reached the wrong answer, and the comment made the next
   reader confident rather than curious.
3. Removing the field at each log site is whack-a-mole, and the mole won twice. **The durable fix is
   at the throw site**: `src/explain.ts`, `src/converse.ts` and `src/search.ts` each build
   `` `OpenRouter ${status}: ${detail.slice(0, 400)}` ``, and as long as they do, every file that
   stores that message and logs it is one copy-paste away from the same leak. Putting the body
   somewhere structured — where `safeError`'s allowlist drops it — would make the pattern safe to
   copy.

   **Done, 2026-08-26.** Not by putting the body somewhere structured but by **not keeping it at
   all**: the failed response is drained and dropped unread, and the three files throw
   `providerRefused(status)` / `providerFailedMidAnswer()` / `providerSpokeNonsense()` from
   `src/openrouter-stream.ts`. Data parked on an object marked do-not-log is data waiting for the
   next serialiser to find it. There were **six** sites, not the three counted here — each file also
   had a second throw for an error carried inside a *successful* response — plus a seventh nobody
   had spotted: `search.ts` rethrew `response.json()`'s `SyntaxError`, and V8 quotes the first
   characters of the offending input in that message. What the reader sees did change, and the
   interim wording is flagged for Greg in
   [260826m-simplification-audit.md § A.5](../plans/260826m-simplification-audit.md). The rule below still stands
   for every file that stores such a message: **never
   log a stored `error` string, however sure you are of what is in it.**

### And then it was found twice more, which is the part worth keeping

The count went three → six → seven above. **It was thirteen, and then fifteen.** Two later sweeps, on
the same day, each found sites the previous one could not have found because it was looking at a
list rather than at a kind of moment.

*Sweep two* — six pipeline stages (`arc`, `labels`, `summarise`, `toc`, `glossary`, `tweets`) each
threw `` `Model refused: ${JSON.stringify(message.stop_details)}` `` on Anthropic's
`stop_reason: "refusal"`. That object is the provider's own words about a request carrying the whole
article, and `jobs.ts` copies a failed step's error onto the job, which the ingest card renders. One
sentence now, `MODEL_REFUSED` in [`src/messages.ts`](../../src/messages.ts).

*Sweep three* — the **request** failing rather than answering. Verified against the installed SDK
rather than assumed (`node_modules/@anthropic-ai/sdk/core/error.js`, `APIError.makeMessage`):
`Error.message` on a thrown `APIError` is `` `${status} ${error.message}` `` built straight from the
upstream body, or the whole body stringified if it has no `.message`. None of the six stages caught
it. [`src/anthropic-call.ts`](../../src/anthropic-call.ts) is the request-failure analogue of
`providerRefused`, and reuses `providerHttpFailure` rather than growing a second mapping. The same
sweep found `labels.ts` throwing the model's own output back in a validation error two lines below a
sibling branch commented *"Shape, not value"*, and `vercel.ts`'s last-resort catch sending
`(err as Error).message` — whatever escaped every other handler — straight to the client.

**The lesson is not "we missed some".** Each sweep closed every site it was looking for. What made
the next one possible was changing what was being looked *for*: first "OpenRouter's HTTP error
bodies", then "Anthropic's refusal payloads", then "any moment where a provider's own text becomes
an `Error`". A list of sites is a snapshot; the genre is the thing. This is written down as Rule 1
in [260826m-simplification-audit.md](../plans/260826m-simplification-audit.md) — *grep the genre, not the list* —
and it was written after an earlier undercount, by the person who then went on to sweep by list
twice more.

**A fourth round then found what no amount of grepping this repo could have**, because the leak was
a dependency's: JSDOM's default virtual console quotes the page it failed to parse (a malformed
`@import` prints the page's own text *and* the full source URL to stderr, round Pino entirely), and
the Anthropic SDK has a logger of its own that reads `ANTHROPIC_LOG` and, at `debug`, prints whole
outgoing prompts — the whole article — plus raw upstream error bodies. Both closed:
[`extract.ts`](../../src/extract.ts) passes an empty `VirtualConsole`, and all six stages construct
their client with `logLevel: "off"`. **That second one is now one line rather than six**: since the
gateway migration of 2026-08-27 the stages do not build clients at all —
[`src/messages-stream.ts`](../../src/messages-stream.ts) builds the one, and sets `logLevel: "off"`
on it. The SDK is still the SDK, so `ANTHROPIC_LOG=debug` would still print whole outgoing prompts
if that setting were dropped; there is simply one place left to drop it from.

The honest status: **four declarations that this class was closed, four of them wrong.** The fifth
round was the one written up in [260826p-error-boundary.md](../plans/260826p-error-boundary.md) — Drizzle puts every
bound parameter into `Error.message`, so a failed comment write puts the reader's quote, and then
the model's answer, into an error that is returned, logged, streamed and stored. **That one was
live, not latent**: production sets `SPIDERYARN_STORE=postgres`
([deployment.md](deployment.md#environment-variables)), so comments there are Postgres rows and the
quote is a bound parameter.

It is closed at one seam rather than at each site, which is the first of these fixes that is not a
sweep. [`src/store/db-errors.ts`](../../src/store/db-errors.ts) wraps every Postgres store on its
way out of [`src/store/index.ts`](../../src/store/index.ts), and **the direction is inverted the way
`SAFE_ERROR_PROPS` is**: an allowlist of what may pass through unchanged — an error carrying a
numeric `status`, and `ChatConflict` — and everything else is replaced with one of two sentences in
[`src/messages.ts`](../../src/messages.ts). A store that starts interpolating a row into a message
next year is covered without anybody adding it to a list.

What survives the translation is fields rather than prose: the SQLSTATE (as `code`, so
`SAFE_ERROR_PROPS` carries it into the line for free), and a `database call failed` line from the
seam with the table, the constraint, the routine and which method threw. `detail`, `hint`, `where`
and `internalQuery` are dropped, because the first two quote row values and the last two quote query
text. The stack keeps its frames and loses its message line, so it still points at the query.

The cost, said out loud: a plain bug in a Postgres store now reaches the log without its message.
The frames are still there, which is most of what a `TypeError` was going to tell you — and the
alternative was leaving free text on the safe side of a boundary because it is *probably* safe,
which is the argument that has now been wrong four times.

Still not built, and still the better half: the **sentinel non-interference test** in that plan,
which is one test that replaces the habit, and the closed `PublicFailure` type at every egress.

The same review found the rule broken in a second shape, which is easier to miss because the leak and
the log are in different files. `src/toc.ts` validated a node's range and threw
``Node "${mn.title}" has a range not in blocks.json`` — a label the model wrote *about the article*,
put into an error message. Nothing logs it there. But a pipeline step that throws is logged by
[`src/jobs.ts`](../../src/jobs.ts) with `errorFields`, which keeps `message` **and** `stack`, so the
title would have landed in the log twice, from a file that never calls the logger at all.

**The first fix dropped the title, kept the range, and was half a fix with a confident comment on
it.** The comment said the range was "the pair of block ids you would go and look up" — a property
the code had never checked. `mn` is `JSON.parse` of the model's response with a TypeScript cast in
front of it, and **the cast proves nothing at runtime**: a model that writes
`"range": ["Feeling is metabolic, not computational", "spya-k3m9qt"]` misses the lookup, which is
precisely the branch that throws, and the sentence goes into the message. One piece of model output
had been swapped for another. That is lesson 2 above happening again, to the person who had just
written it down. Found by a second GPT/Codex review, 2026-08-26.

The rule the code keeps now is narrower and checkable: **name a value only once it has passed
validation, and describe the shape of anything that hasn't.** A string that passes
[`isSpideryarnId`](../../src/ids.ts) is `spya-` plus six characters from a fixed 32-character
alphabet ([block-ids.md](block-ids.md#the-format)) and cannot spell a word of anybody's article, so
quoting it is safe. Anything else is reported as `not a block id (a 71-character string, withheld)`,
alongside the node's position in the model's own tree — `root > child 2` — which is derived from the
shape of the answer rather than from anything in it, and is what you would go and look at anyway.
`checkCoverage` had the same hole in its invented-label check and is closed the same way: the count
is always exact, the well-formed ids are named, the rest are withheld. Both are held by tests in
[`tests/toc-build.test.ts`](../../tests/toc-build.test.ts) that feed a phrase of article prose where
a block id belongs and assert it never reaches the thrown message.

So the rule has a second half: **an error is a value that travels, and where it is thrown is not
where it is written down.** Anything interpolated into a message that can reach a catch-all has been
logged, whatever the file it was thrown from thought it was doing.

### The sixth shape: the seam is on the way out, and logging happens before that

The `db-errors.ts` seam above wraps a store **on its way out**. So it protects everything that reads
the error *after* the store returns — and nothing that reads it *inside*, before the rethrow. That
gap is where the sixth instance of this class lived, found by GPT Sol reviewing the publish
finalizer on 2026-08-30 ([the review](../plans/260830ad-v1-publish-finalizer-review-sol.md), critical 1).

[`finishIn`](../../src/store/pg-jobs.ts) binds a job's whole `steps` array and its title — a step's
`detail` may be article prose and the title *is* the article's. When it failed,
[`publish-session.ts`](../../src/store/publish-session.ts) caught the Drizzle error and put its
message into the `reason` it handed `failRevision`, which logs `reason` **verbatim**
(`logDraftFailure` in [`pg-revisions.ts`](../../src/store/pg-revisions.ts)). By the time
`guardDbStore` scrubbed anything, the line was already on stdout. There was a second copy of it one
branch along: if the compensating cleanup itself failed, `errorFields(cleanup)` handed a raw driver
error to `safeError`, which keeps `message` on purpose.

Both are now fixed strings and class names — `nameOf(err)`, never `err.message`. **The general rule
this leaves is worth more than the fix:** a wrapper that translates on egress cannot cover a callee
that logs on the way to throwing, so any `log` call inside a guarded store must build its own line
from values it chose, exactly as if there were no seam at all.

### Proving redaction, not assuming it

[`tests/log.test.ts`](../../tests/log.test.ts) reads the bytes on file descriptor 1 and asserts the
secret **is not in them** — a stronger claim than "the line says `[redacted]`", which a key that
vanished entirely would also satisfy. That much has been true since the tests were written.

What was not true was the coverage. The first version derived *both* its list of paths to try *and*
the fixture carrying the sentinels from the logger's own `REDACT`. That proves every configured path
works and says nothing about whether the right paths are configured. GPT/Codex found the mutation
that shows it: delete `req.headers.authorization` from the list, and no sentinel is generated for it,
the shape checks still see plenty of plausible paths and still see `apiKey`, the hand-picked fixture
never mentioned it — **the whole suite passes while that header leaks.** Confirmed by running it,
2026-08-26: twenty-two green with the value going to stdout in full.

So the test now keeps `REQUIRED_PATHS`, a hand-written copy of the list, and compares the two as sets
in both directions. A second copy of a constant is normally a smell; here it is the point, because a
list derived from the thing it is checking cannot disagree with it, and disagreeing with the code
when the code is wrong is the test's entire job. **Do not tidy it into an import.** Both directions
are checked because a subset check would let the copy decay into a stale prefix that protects the
first seventeen paths and nothing added since — so adding a path goes red too, until it is signed for
in both files.

The sentinel fixture is built from the **union** of the two lists, so a deleted path shows up twice:
once as a list mismatch, and once as its value appearing in the emitted line. The second is the one
that matters, because it is the leak itself rather than a statement about configuration.

The same shape of hole was in the exit test. The SIGKILL scenario — the only one that can tell a
synchronous destination from an asynchronous one — used to switch off the check on how the child
died, so deleting its `process.kill` line would have left a child that exits cleanly, flushes on the
way out, and passes: the test silently becoming a duplicate of the one above it, which stays green
with `sync: true` removed. It now asserts the child really was killed. That is fussier than
`child.signal === "SIGKILL"`, because `node_modules/.bin/tsx` is a wrapper that spawns the real Node
underneath and reports its death as **exit status 137** rather than as a signal; the naive assertion
was written first and went red on a child that had died exactly as intended.

The honest limit on that test: five short lines over a local pipe is not proof of Vercel's freeze
behaviour, and it is not proof about volume. An asynchronous destination that happened to dispatch
five small writes immediately would pass it while still losing larger writes or writes behind
back-pressure. What it pins is the regression that is easy to cause — somebody deleting `sync: true`
because pino flushes on exit anyway — not the whole property.

**A cheaper capture, for the tests that are about a caller rather than about the logger.**
`log.test.ts` spawns a child process because the thing under test *is* `src/log.ts` — its level, its
destination, its behaviour on SIGKILL. A test that only wants to know what string some caller handed
the logger does not need a subprocess, and
[`tests/helpers/log-capture.ts`](../../tests/helpers/log-capture.ts) is the in-process version:
`fs.writeSync` is patched on the CommonJS `fs` object `sonic-boom` itself holds, because
`pino.destination({ sync: true })` writes to **file descriptor 1** and never touches
`process.stdout.write` — so stubbing the stream captures nothing and passes. Two things a caller
must do, and the second is the one that matters: raise `LOG_LEVEL` inside `vi.hoisted`, since
`level()` is read once at module load and vitest's `NODE_ENV=test` otherwise makes it `silent`; and
**assert that the capture caught a line you expected before asserting that it lacks a sentinel**,
because every way this can go wrong produces an *empty* capture, and an empty capture satisfies every
`not.toContain` ever written. Used by
[`tests/jobs-publish-finalizer.test.ts`](../../tests/jobs-publish-finalizer.test.ts) and
[`tests/publish-session-cleanup-log.test.ts`](../../tests/publish-session-cleanup-log.test.ts) for
the sixth shape above.

### `JSON.parse` quotes the file back at you

The rule above — don't interpolate untrusted content into an error you throw — has a shape nobody
here wrote and everybody here used. **V8's own `JSON.parse` error message contains the input:**

```
JSON.parse("I'm sorry, I can't summarise that article")
→ SyntaxError: Unexpected token 'I', "I'm sorry"... is not valid JSON
```

Found by a GPT/Codex review, 2026-08-26, and it is the same trap as `FetchFailure`'s `url` one level
further down: nobody wrote the leak, the platform did, and the code that reaches the log looks
completely ordinary. Two details, both measured on node v26.7.0 rather than remembered:

- **Up to twenty characters the input is quoted in full**, with no ellipsis. Past that it is the
  first ten plus `...`. So "about ten characters" understates it — a short corrupt file, or a short
  model refusal, is echoed whole.
- **It only fires when the content is malformed from the start.** The other shape,
  `Expected ':' after property name in JSON at position 14`, is purely positional and gives nothing
  away. Malformed-from-the-start is exactly what a truncated write looks like, and exactly what a
  model that answered in prose looks like — so the two commonest real failures are the two that leak.

Everything this app parses is the article's prose, the reader's own writing, or a model's answer
about one of those. And a `SyntaxError` that reaches a `catch` is written down **twice**, because
`safeError` keeps `message` and `stack` and the message is embedded in the stack.

The fix is one module, [`src/parse-json.ts`](../../src/parse-json.ts), used by every parse whose
error can reach a log line. It throws a `MalformedJson` naming the artefact, keeps the byte offset
(positional, useful, safe), and says which *shape* of failure it was — ran out part-way, never began
as JSON at all, or broke at an offset — without a character of the content.

Three things about it are load-bearing:

- **`cause` is deliberately not set.** `safeError` follows `cause` chains on purpose, so wrapping the
  `SyntaxError` — the reflex fix, and the one a reviewer asks for — puts the quotation straight back
  in under a different key. `tests/parse-json.test.ts` asserts on the absent `cause`.
- **Truncation is detected from the offset, not from V8's wording.** There are at least three
  wordings for "the input ran out" and only one of them says so; matching that English is a list that
  goes stale in a Node upgrade with nothing going red. Breaking at or past the last character is
  arithmetic, and it means the same thing whatever it was called.
- **The stage files are the half that is easy to miss.** `src/toc.ts`, `src/arc.ts`,
  `src/glossary.ts`, `src/tweets.ts` and `src/summarise.ts` never call the logger — but a step that
  throws is logged by [`src/jobs.ts`](../../src/jobs.ts) with `errorFields`. Same lesson as the
  `mn.title` throw above: an error is a value that travels, and where it is thrown is not where it is
  written down. Both their model-response parses *and* their `blocks.json`/`tree.json` reads go
  through the helper — and `blocks.json` **is** the article.

**A developer debugging a bad model response loses those characters, and that was checked rather than
waved through.** The stages write `tree.json`, `arc.json` and the rest *after* parsing succeeds, so a
response that fails to parse is not on disk anywhere — those quoted characters really were the only
copy. The trade is still right: they are the *first* ten, and after a code fence is stripped the
first ten characters of a model's JSON are `{"summaries` on every run, successful or not. What
distinguishes the failures is their shape, and the shape is what the helper reports. There is
deliberately **no environment variable** that turns the quoting back on — that is the mechanism
[§ No transports](#1-no-transports-pretty-printing-is-a-shell-pipe) rejected for pino-pretty, living
in the program and one wrong variable from production. If a raw response ever genuinely needs
keeping, write it beside the artefact on purpose.

**Where it was left alone, and why.** A dozen other `JSON.parse` calls discard the error entirely —
`catch { return null }` in the stage files' `readJson`, `catch { previous = undefined }` in
[`src/blocks.ts`](../../src/blocks.ts), the per-record `catch` in `loadFromDisk`, the per-chunk one in
[`src/converse.ts`](../../src/converse.ts), and `readBody` in [`src/routes.ts`](../../src/routes.ts),
which throws a fixed 400 string. None of them can reach a log line, so none of them changed.
[`src/search.ts`](../../src/search.ts) already had it right before any of this, throwing
`"The model's list of passages was not valid JSON."` — a fixed string, no content, three named
outcomes. It is the pattern the rest now follow.

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

**The sentence at the top of this section was false twice more before it was true**, and both were
found by the second GPT/Codex review rather than by anyone writing the code. Neither leak came from
a line that logged a URL; both came from a URL being put into an error *message*, in a file with no
logger in it:

- `parseJobRequest` refused an unusable URL with `` `Could not make a slug from ${url}` ``, and
  `logRequest` writes an `httpError`'s message as `reason`. So the source URL came back at `warn`
  through the one path that had been carefully stripped forty lines earlier.
- `fetchDocument` reported an unfollowable redirect as
  `` `That site redirected somewhere unreadable: ${location}` `` — a header written by a **remote
  server**, on an error that a failed fetch step hands to `errorFields`.

Both are fixed and pinned by tests. The pattern is worth more than the two instances: a claim about
what the logs contain cannot be checked by reading the logging code, because the leak is never in the
logging code. `src/pipeline.ts` also carried a comment asserting the URL "is already written once
when the job is enqueued" — never true, and it read as permission to relax.

If a URL ever does need logging, put the **hostname** in, not the URL. And if this project ever has
real users, revisit this alongside [the correlation id](#the-correlation-id-not-yet).

## Where to look when production breaks

Moved, so there is one copy. **[debugging.md](debugging.md)** is the front door — which of the three
places answers which question — and the recipes live with the thing they operate:

- **[vercel-hosting-deployment.md](vercel-hosting-deployment.md)** — the log queries, and the three
  traps. Two of them are about *these* lines meeting that platform: the error dashboard never sees a
  handled failure, and filtering by `level` returns silence rather than our errors.
- **[sentry-error-monitoring.md](sentry-error-monitoring.md)** — the 30-day half.

The rest of this file is *why the lines are shaped the way they are*.

## Vercel

From [Vercel's runtime logs documentation](https://vercel.com/docs/logs/runtime), page dated
2026-08-03. This project is heading for Vercel Pro with Fluid Compute
([260825d-deploy-and-repo-move.md](../plans/260825d-deploy-and-repo-move.md#two-facts-that-make-the-rest-easier)).

**Capture is just stdout and stderr.** No agent, no SDK, no integration — which is the whole reason
this design is nothing more than "write JSON to stdout".

**Retention on Pro is one day.** That is the most important operational fact here and it shapes
everything below. Logs are enough for "I deployed and something is wrong". They are no use at all for
"a reader hit a bug on Tuesday". Observability Plus raises it to 30 days.

**Limits:** 256 KB per line, **256 lines per request**, 1 MB per request. Roomy, but a line per block
during an ingest would blow the line ceiling on a long article, and past it you can only query the
most recent. This is why `store` logging is sparing and why per-block logging does not exist.

So there is a rule, and it is about shape rather than volume: **if the number of lines a piece of
code emits grows with the data, the caller says it once instead.** A line per skipped directory is a
line per *article on the shelf*, on every homepage load — the cost grows with the library while the
information in it does not. Both places this came up ([`loadFromDisk`](../../src/jobs.ts) reading the
queue, [`listArticles`](../../src/api.ts) walking the shelf) now collect into an array and emit one
line carrying `{ count, first five names, of }`. The count is what tells you the scale, the names are
what make it actionable, and the cap is what stops a long line being the one that gets truncated by
whatever is collecting it. The loop that finds the problem is not the right place to report it.

**It came back a third time, in a helper rather than in a loop.** `readJson` in
[`src/api.ts`](../../src/api.ts) warned once per unreadable file, which is exactly right for the
seven callers that read a single article — and `describeDir` calls it three times per directory
inside the shelf walk. Measured on 300 corrupt directories: **300 warnings on one homepage load**,
past the 256-line ceiling, so the tail of that request's logs was dropped. A helper that logs is
convenient until it is called in a loop, and the loop is always somewhere else. `readJson` now takes
an `unreadable` array; passing one moves the *saying* to the caller, never removes it.

Two things that only showed up once it was reproduced, both worth more than the fix:

- **The existing aggregate line was unreachable on the path that needed it.** `Promise.all` rejects
  on the first corrupt directory while the other 299 are still running and still logging, so the
  code emitted 300 warnings and never reached the summary. `Promise.allSettled` is what makes a
  bounded line possible at all; the first rejection is rethrown afterwards, so the shelf still fails
  exactly as it did.
- **A capped list of names has to be ordered, or it is not a name.** The five reported were whichever
  concurrent reads happened to fail first, so the same broken shelf accused different directories on
  different loads. Verdicts now come back through `allSettled` in *input* order; the `unreadable`
  names arrive through a throw and so are sorted before being cut. Pinned by
  `tests/library-log-volume.test.ts`, which runs two real loads and compares — a single call cannot
  disagree with itself.

Whether one corrupt file *should* blank the whole shelf rather than dropping one card is a separate
question, deliberately left alone: only the logging changed.

### Two traps worth knowing before they bite

**`console.warn` is filed as an `error`** by Vercel in a non-streaming function — its own mapping
table says so. Since Pino writes every level to stdout, everything we emit arrives as `info` and the
real level lives in the JSON `level` field. So **Vercel's own level filter will not tell you our
levels apart** — everything is `info` to it. This mostly matters for the `console` calls that remain
in CLI scripts, which never run on Vercel anyway.

**Both halves of this are now settled on a real deployment**, 2026-08-28, and they landed on opposite
sides — which is why the paragraph above used to hedge:

- **The level facet is useless to us, confirmed.** `get_runtime_logs` filtered to
  `level: ["error","warning"]` returned *no logs* over a window containing two lines whose body reads
  `"level":"error"`; Vercel had tagged both `[info/serverless]`. So `"level":"error"` is a **string
  to grep for**, never a facet — and the cost of getting this wrong is silence that reads as health.
- **Structured fields *are* reachable by text search.** Two Vercel pages contradict each other — the
  KB guide says structured JSON "becomes searchable in the dashboard", the reference doc says the
  feature "is limited to the `message` and `requestPath` field" — and the pessimistic one is wrong,
  at least for `query`. Searching `ENOENT` matched lines carrying that string only inside the nested
  `err` object, nowhere in the message or the path.

The redundancy below stays anyway. It costs nothing, it survives whatever Vercel changes next, and
the `msg` string is what a human actually reads in a wall of JSON:

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

So, plainly: **there is no log drain, no metrics dashboard, and no database of model calls.** What
exists is what is described above, plus the error tracker below, and nothing else.

### Error tracking

**Built on 2026-08-27** — Sentry, free tier, errors only — and it is on. The whole of it now lives in
**[sentry-error-monitoring.md](sentry-error-monitoring.md)**; only the part that is a rule *about
this file* stays here:

- **Capture is not wired through the logger, deliberately.** A log line does not become a Sentry
  event. The two subsystems must be able to fail independently, and rule 5 here is that a log call
  never throws. Capture is an explicit call beside the log line, at six seams.
- **`pinoIntegration` exists and must never be added.** It would forward these lines to Sentry, and
  the whole design of this file rests on stdout being the only destination.
- **It is a fifth egress, so everything under [§ what never gets logged](#what-never-gets-logged)
  applies to it** — more so, because the message leaves the machine.

Vercel's Observability Plus is still the other half of the question and is still not bought: crashes
point at Sentry, request behaviour at Vercel. A **log drain** — which would keep these lines past 24
hours — is a third thing again, and also not done.

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
alone](../plans/260825f-postgres-migration.md#the-client-drizzle-for-data-supabase-for-auth), `auth_logs` is
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
  what looks like an input rate. Wrong by construction. We logged token counts, which are facts, and
  left cost to whoever was doing the arithmetic.

  **There is a cost on the line now, and the reason it is not the same mistake is that nobody here
  computes it.** Since 2026-08-27 every call goes through OpenRouter and comes back with its own
  `usage.cost`; `aiCost` is that number added up, not a rate multiplied by a token count
  ([§ What a step or a request cost, in money](#what-a-step-or-a-request-cost-in-money)). The objection above was never to
  logging money — it was to logging a *guess* at it, dressed as a fact. One honest caveat survives:
  OpenRouter's figure is credits consumed, and its margin is a ~5.5% fee on buying credits rather
  than a per-token markup, so the cash that left the bank is about 5.5% higher than any total on
  these lines ([ai-gateway.md](ai-gateway.md)).

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

8. **An error message that was safe when it was written.** `httpError(400, ...)` messages are logged
   as `reason` by `logRequest`, so they are published rather than merely said. One of them
   interpolated the source URL — `` `Could not make a slug from ${url}` `` — which put credentials
   and a query string into a `warn` line, undoing the query strip forty lines away in the same file.
   The code that stripped and the code that leaked were both correct in isolation; only the pair was
   wrong. Pinned by `tests/jobs.test.ts`, and the invariant is now stated at `logRequest` itself,
   which is the place someone editing a `throw` two hundred lines away will never look — so treat
   the test as the real guard.

9. **An error message written by the platform rather than by us.** Every rule above is about what
   *we* interpolate into a message — and `JSON.parse` puts the malformed input into its own
   `SyntaxError` with nobody's help. So the review question that catches the other eight ("does this
   code put anything private in the message?") answers *no* here, and is wrong, because the code does
   not build the message. Closed by [`src/parse-json.ts`](../../src/parse-json.ts) and pinned by
   `tests/parse-json.test.ts`, which asserts sentinels are absent from the emitted bytes at six real
   call sites. See [§ `JSON.parse` quotes the file back at you](#jsonparse-quotes-the-file-back-at-you).

10. **A leak that has not happened yet, in code that is correct today.** The six Anthropic stages
    threw `` `Model refused: ${JSON.stringify(message.stop_details)}` `` — a whole provider object
    stringified into a message that `errorFields` then keeps. Checked against the SDK,
    `RefusalStopDetails` holds a policy category and nothing else, so it leaked nothing on the day it
    was written. The review question every other item here answers — *does this put anything private
    in the message?* — answered **no**, correctly, and would have gone on answering *no* right up
    until the SDK added a field. No code here would change. No test would fail. That is the
    difference between this one and the nine above: they were wrong when written, and this one was
    right when written and stops being right on somebody else's release day.

    Closed by `MODEL_REFUSED` (see [§ sweep two](#and-then-it-was-found-twice-more-which-is-the-part-worth-keeping)),
    and pinned by `tests/stop-details.test.ts`, which is the part worth copying. It does **not** read
    the SDK's field list — a test pinned to today's fields goes red on a bump that changed nothing
    and stays green for any field it did not think of. It hands the stages a refusal stream whose
    `stop_details` **already carries the field that does not exist yet**, and then asserts only about
    bytes: the sentinel is absent from what the logger put on fd 1, and absent from every request
    that went back out.

    The control is the whole trick. "The sentinel is absent" is satisfied perfectly by a stream that
    never delivered `stop_details`, by an SDK that stopped putting it on the message, and by a stage
    that died before it called anything. So a seventh call in the same child **is the deleted code** —
    the old message, built the old way, logged the way `jobs.ts` logs one — and its sentinel has to be
    *present*. If that ever goes missing, the six absences became free, and the run says so.

### Nothing outstanding

~~**The `${detail.slice(0, 400)}` throws**, described above. The real fix, and the bigger one.~~
**Done 2026-08-26** — see above. It was six sites and then seven, not three.

~~**`JSON.stringify(message.stop_details)`** in the Anthropic stages.~~ **Done 2026-08-26** — item 10
above. It was six stages, not the four the note claimed; the note was written from a list rather than
from a grep, which is the mistake that section is about.

## Related docs

- [debugging.md](debugging.md) — the front door when something is broken
- [vercel-hosting-deployment.md](vercel-hosting-deployment.md) — where these lines end up, how to
  query them, and the two traps that turn an outage into silence
- [sentry-error-monitoring.md](sentry-error-monitoring.md) — the other destination, and why it is
  deliberately not fed from here
- [architecture.md § Stage ownership](architecture.md#stage-ownership) — why the pipeline logs from
  the seam rather than from inside each stage
- [ingest-queue.md](ingest-queue.md) — the queue whose lifecycle the `jobs` component narrates
- [ai-gateway.md](ai-gateway.md) — where every model call goes, and where `usage.cost` comes from
- [prompt-caching.md](prompt-caching.md) — what the cache counts on these lines are for, and why
  the same cache is reported two different ways on the two wires
- [comments.md](comments.md) — the model call in a request handler, and why it is the exception
- [security.md](security.md) — the fixture fallback that the `store` warning now watches
- [block-ids.md](block-ids.md) — why re-minted ids are worth a warning
- [testing.md](testing.md) — and `tests/log.test.ts`, which proves the redaction rather than
  restating the config
- [260825d-deploy-and-repo-move.md](../plans/260825d-deploy-and-repo-move.md) — Vercel Pro, Fluid Compute, and the
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
