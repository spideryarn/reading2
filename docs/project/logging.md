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
   copy. That is **not done yet**; it spans three stage files and changes what the reader sees when
   a model call fails, so it needs a decision rather than a patch. Until then the rule is: **never
   log a stored `error` string, however sure you are of what is in it.**

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

### Two we know about and have not changed

Written down because a known gap is cheaper than a rediscovered one.

- **`JSON.stringify(message.stop_details)`** in the four Anthropic stages (`toc.ts`, `arc.ts`,
  `tweets.ts`, `glossary.ts`), on a message that a failed step logs with `errorFields`. Checked
  against the SDK: `RefusalStopDetails` currently holds a policy category and nothing else, so this
  leaks nothing today. It is listed because the shape is the risky one — a whole provider object
  stringified into a logged message — and it becomes a leak the day the SDK adds a field, with no
  test failing and no code changing here. The fix is `stop_details?.type`, one line in four files,
  and it costs whatever a future field would have told us. Not done: four stage files, and a
  speculative harm.
- **The `${detail.slice(0, 400)}` throws**, described above. The real fix, and the bigger one.

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
