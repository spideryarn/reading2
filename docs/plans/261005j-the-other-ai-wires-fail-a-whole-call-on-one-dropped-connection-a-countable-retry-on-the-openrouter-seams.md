# The other AI wires fail a whole call on one dropped connection: a countable retry on the OpenRouter seams

Up: [plans.md](../project/plans.md)

Queue item `qi-wwhdcejd`, deferred from
[261003m](261003m-a-transport-blip-fails-an-import-one-countable-retry-on-the-messages-wire.md)
(report `spya-x4zut6`). That plan gave the Messages wire a retry for a failure before the answer
begins, each attempt its own spend record, and left `src/ai-call.ts` unaudited. This is the audit
and the fix.

## The audit: what one dropped connection does today

`src/ai-call.ts` has five seams, and each makes exactly one `fetch`: `openRouterStream`,
`openRouterJson`, `openRouterImage`, `openRouterTranscription`, `openRouterDecisions`. **None
retries anything.** A `fetch` that rejects, or a 5xx, ends the call and writes one `error` row.

What that costs depends on the caller. Traced call site by call site on 2026-10-05:

| Wire / seam | Callers | One dropped connection or 5xx today |
| --- | --- | --- |
| chat, streamed | explain, dig-deeper's answer, citation-investigate, chat and candidates (per round), search, quiz-mark, link-summary, the three referee runs | The reader gets an error sentence and has to press again. No caller retries. |
| chat, whole (`openRouterJson`) | debate (a pipeline step), pdf-frontmatter, pdf-authors, pdf-figure-locate, simple-check, quiz-verdict, citations-find, citation-paper-passages, citation-influence, dig-deeper-search, upload-source-guess, paper-metadata, shelf-scores | Debate and paper-metadata each **fail their pipeline step**. citations-find stops the investigation. The rest fall back silently to a worse result: no front matter, an unchecked Simple level, a figure left refused, no influence line. |
| chat, whole, with its own loop | `pdf` (`src/pdf-read.ts` § `withTransportRetries`) | A dropped connection is retried, three goes. **A 5xx is not**: it fails the chunk, and with it the PDF step. |
| embeddings, with its own loop | `src/embeddings.ts` § `embedBatch` | A 5xx or 429 is retried, five goes. **A dropped connection is not**: it fails the batch. |
| chat, whole, with its own loops | `shelf-topics` (`src/shelf-terms/model-topics.ts`): `nameLevel` is run twice on failure, and so is the filing pass | Any failure is asked once more. Covered. |
| images | Illustrated's plates | The plate is marked failed and the run carries on, a plate short. |
| transcription | dictation | The reader sees a sentence and a Retry button. |
| decisions | quick search, the command bar's pick | Quick search errors. The bar falls back to its own list. |

So yes: every wire fails the whole call on one blip, except three callers that built their own
loop, and two of those three each cover only half of the failures.

## What we will do

### Stage 1: one retry, in the gateway, shared by all five seams

A private helper in `src/ai-call.ts` runs an attempt up to `TRANSPORT_ATTEMPTS` (3) times. The
five seams each wrap their existing body in it. The rules are the Messages wire's, restated for a
wire with no SDK:

- **Each attempt is its own `Meter`**, so its own `beginSpend` and its own row. A call that
  blipped once is two rows, `error` then `ok`. *One record, one network attempt* still holds.
- **What is retried**, and only these:
  - `fetch` itself rejected with a `TypeError` and the signal is not aborted. That is what
    `fetch` throws for a network failure (undici's "fetch failed"). No response existed.
  - the response's status is one of 408, 409, 500, 502, 503, 504, 529 **and its body priced
    nothing** (the meter saw no cost). A refusal that carries a cost was billed, and is not
    bought again.
- **What is never retried**: an abort; a 429 (a rate limit is a queue, and pdf-read, embeddings
  and Structure each have a policy for it); any other status; a `200` of any kind, including one
  whose body will not read or does not parse; and, on the stream, anything after the `200`
  arrived. That last line is deliberately tighter than the Messages wire, which retries up to
  `message_start`: here the boundary is the response headers, because a `200` on this wire means
  OpenRouter has accepted the work and may be billing it.
- **Backoff** is the Messages wire's: about 0.5 s, then about 1.5 s, jittered, and cut short by
  the signal. A Stop or a deadline during the wait ends the call as the abort it is (the
  signal's own reason is thrown), with no further attempt and no row for the wait.
- **The stream resets `options.end` at the start of every attempt** and calls
  `options.onActivity()` twice around a retry: before the backoff and again before the next
  request. So a failure that lands just before a caller's stall clock would fire does not have
  the wait counted as provider silence. The caller's overall deadline is untouched.
- **The seam says which failures may be asked again, and a caller's own loop asks it.** A
  `ProviderRefused` carries `priced` (the meter saw a cost in its body). An error from `fetch`
  itself is remembered as *never answered* at the `send` boundary, which is the only place that
  can tell it from a `200` whose body then broke. One exported predicate,
  `worthAskingAgain(err)`, is true for a never-answered `TypeError` and for an unpriced
  refusal with a transient status. The gateway's helper uses it, and so do the loops that opt
  out below. Without this an opted-out loop would bypass both safety rules.
- **The constants and the wait move to one small module**, `src/transport-retry.ts`
  (`TRANSPORT_ATTEMPTS`, `TRANSPORT_BACKOFF_MS`, `TRANSIENT_STATUSES`, `backoffMs`,
  `waitOrStop`), which `src/messages-stream.ts` imports instead of keeping its own copies. One
  home for the policy. `src/pdf-read.ts` keeps its own, because its policy is different (429,
  `Retry-After`, a width gate).

**An opt-out, `retryTransport: false`,** on each seam's options, for a caller that already owns
this decision. Without it the loops multiply (3 × 3 requests on the PDF reader). Five callers
pass it:

| Caller | Why it opts out | What changes in the caller instead |
| --- | --- | --- |
| `pdf` (`src/pdf-read.ts`) | Its loop already retries a dropped connection, through a width gate the gateway cannot see. | Its loop also retries a refusal that `worthAskingAgain`. That closes its 5xx gap without re-buying a priced one. Its handling of other thrown errors is left as it is: it asks again after any non-abort throw, which includes a `200` whose body broke. That is wider than the gateway's rule, it is older than this plan, and it is said here rather than changed. |
| `embeddings` | Its loop already retries 5xx and 429, five goes, honouring `Retry-After`. | Its loop also retries a never-answered failure (by `worthAskingAgain`, not by the error's class). And it stops retrying a 5xx that was priced. |
| `shelf-topics`, every call in `model-topics.ts` | Both of its outer retries already ask once more on any failure. | Nothing. |
| `pdf-figure-locate` | `MAX_LOCATE_CALLS` promises at most eight model calls an article, and the counter counts asks. A hidden retry would make it twenty-four. | Nothing. A blip leaves the figure refused, as today. |
| `command-pick`, `command-pick-words` | Both calls share one 5 s deadline, the usual pair takes 1.6 s, and a failure already falls back to the bar's own list. Two seconds of backoff is worse than the fallback. | Nothing. |

### Stage 2: docs

`ai-gateway.md` § "A transport blip is retried" says *Messages wire only*; it gets the other
wires, the tighter boundary, and the opt-out. The stale comment at `src/spend-declarations.ts`
(*"`openRouterJson` retries a 429"*, which it never did) is corrected. No postmortem: the class
was named in
[the 261003m postmortem](../postmortems/261003f-a-removed-retry-whose-replacement-was-a-sentence-in-a-comment.md) and this is its deferred half, not a new bug.

## Trade-offs, named

- **A retried attempt's cost is unknown, not zero.** A connection can drop after the provider
  took the work. The failed row is unpriced, and the retry may pay twice for the first moment of
  a call. The Messages wire accepted the same. The calls where that is dearest: an Illustrated
  plate (about $0.07) and the three calls that run a billed web search (`dig-deeper-search`,
  `citations-find`, `debate`). The *priced refusal is not retried* rule covers the case where
  the provider tells us; nothing covers the case where it does not.
- **Callers' own counts are not threaded.** `checkCalls` (Simple's fidelity check), quick
  search's `tally.requests` and Illustrated's "N call(s)" count *asks*. After a retried blip the ledger has one more row than
  the count. The Messages wire added `attempts()` for this; here a failed call throws, so there
  is no return value to carry the count, and a second channel for it is machinery for a log
  line. The ledger is the truth. The one count that is a spend cap, `locateCalls`, opts out
  instead.
- **A watched call that blips takes up to two seconds longer** before it either answers or
  fails. Taken as plainly better than failing, as in 261003m.

## The simpler options passed over

- **No opt-out; let the loops multiply.** Nine requests for one PDF chunk and fifteen for one
  embedding batch on a bad minute, aimed at a provider that is already struggling.
- **Delete the three callers' loops and let the gateway do it all.** The PDF reader's loop is
  tied to its width gate and its 429 policy, and embeddings' to `Retry-After`. The gateway would
  have to learn both.
- **Retry any thrown error, not only `TypeError`.** A plain `Error` from `fetch` is not a network
  failure; in this repo it is a test double or the provider guard, and retrying it turns about
  twenty route tests into six-second ones for nothing.

## Not built: retrying a call that died part-way through its answer

On both wires, a stream that dies after the answer began still fails. Retrying it means paying
for the call twice, so it goes to Greg as a question with numbers, and nothing here builds it.

**[Q-pay-twice-for-a-broken-answer], Greg, 2026-10-06:**

> A or maybe B would be better. if we go with B, let's add logging/monitoring so we'll be able to
> notice how often retries happen (and hopefully diagnose them)

So the order is: count first, then decide. Every call that dies part-way through its answer, and
every transport retry, is recorded so its frequency and cause can be read; B (one retry for
pipeline steps) is built only if that count says part-way deaths fail imports more than rarely.
Queued as its own item.

## Tests (red first)

A new `tests/ai-call-transport-retry.test.ts`, against a stubbed `fetch`, for each of the five
seams where it applies:

1. `fetch` rejects with `TypeError("fetch failed")` once, then answers: resolves, two requests,
   two rows `error` then `ok`. **The reproduction, red today**, on all five seams.
2. a 503 then an answer: the same. A 400, a 402, a 429: one request, rejects.
3. three failures: rejects after exactly three requests, three `error` rows, and the error is
   the last attempt's own (a `ProviderRefused` keeps its status).
4. a 503 whose body carries a cost: one request, one priced `error` row.
5. a plain `Error` from `fetch`: one request.
6. `retryTransport: false`: one request.
7. an abort during the backoff: rejects with the signal's reason, no second request, one row.
8. stream: a `200` whose body breaks before its first frame: one request. A failure after a
   chunk was yielded: one request. `end` is reset per attempt; `onActivity` is called before the
   second attempt; the consumer sees each chunk once.
9. `src/pdf-read.ts`: a 503 is retried by its own loop, and the gateway is asked with
   `retryTransport: false` (so the existing "one call per attempt" test still tests *its* loop).
   `src/embeddings.ts`: a `TypeError` is retried by its own loop, likewise.
10. The shared constants: `messages-stream.ts`'s own retry tests stay green on the import.

Existing tests that assert one row after a 5xx or a `TypeError` are asserting the old behaviour;
each is rewritten to the new one or moved to a status that is not retried, and the plan's
progress section lists which.

## Progress

- [x] GPT Sol review of this plan
- [x] Stage 1 red tests (45 of 98 red before the fix: [the list](261005j-red-first.txt)), then the retry
- [x] Stage 2 docs
- [x] GPT Sol code review
- [x] Mutations, and the affected suites on the final tree

## GPT Sol's plan review

[The review](261005j-the-other-ai-wires-plan-review-sol.md), verdict *change first*. Six findings,
all accepted and written into the plan above:

1. F1 (P1): a caller's own loop could re-buy a priced refusal, because `ProviderRefused` did not
   say whether it was priced. It now does, and the loops ask `worthAskingAgain`.
2. F2 (P1): a `TypeError` caught around the whole call cannot tell `fetch` failing from a `200`
   whose body broke. The seam now remembers which, at `send`. The PDF reader's older, wider rule
   is named rather than changed.
3. F3 (P1): the figure locator's cap of eight would have become twenty-four. It opts out.
4. F4 (P1): `shelf-topics` has two outer retries, not one. Every call in that file opts out.
5. F5 (P2): the stall clock is reset before the backoff as well as after it.
6. F6 (P3): paper-metadata fails its step; it does not fall back.

## As built

- **Two shapes, one rule.** The four whole-call seams wrap their body in `asTransportAttempts`.
  The stream has its own small loop, `acceptedStream`, because its retry ends at the response
  headers rather than at the end of the call. It is a plain `async` function, not part of the
  generator, so a consumer's `return()` cannot land between a meter and its `finish`. Both ask
  `mayAskAgain` and wait in `backOff`.
- **`ProviderRefused` takes `priced` as a required fourth argument**, so every construction
  site has to say. `src/pdf-read.ts` § `refuseBodyError` builds one from an error found inside a
  `200` and says `true`: the provider accepted that work, and it keeps a 5xx-in-a-200 the
  verdict it has always been there.
- **Embeddings asks again after a dropped connection with its existing backoff** (2 s,
  doubling, five goes), not the gateway's short one. That is about 30 s of waiting inside its
  240 s budget, the same as it already spends on a 5xx.

Existing tests that changed, and what each became:

| Test | Was | Now |
| --- | --- | --- |
| `ai-call.test.ts` "still refuses on the status when the refusal's body is not JSON…" | five 502 bodies, one row each | the same five bodies on a 403. It is about the body; a 502 is now asked again. |
| `ai-call.test.ts` "records a fetch that never connected"; `ai-call-images.test.ts` "records the call even when the request never connected"; `ai-call.test.ts` "records a refused call as an error row" (decisions, 500) | one request, one row | unchanged assertions, with `retryTransport: false`. The retried version of each is in the new file. |
| `ai-call.test.ts` "clears it when the second call never gets a body at all" | second call refused with a 503 | refused with a 403. The per-attempt reset of `end` is tested in the new file. |
| `quick-search.test.ts`, four tests on what quick search does once a chunk has failed | the failing chunk answered 502 | it answers 403, a verdict refused once. Quick search does not opt out: a chunk that blips is asked again inside its 20 s deadline. |
| `embeddings.test.ts`, two tests on a `TypeError` from `fetch` | failed at once | same assertions on a fake clock, because the batch is now asked five times. |
| six test files that build a `ProviderRefused` | three arguments | four. |

## GPT Sol's code review

[The review](261005j-the-other-ai-wires-code-review-sol.md) of `949fa80ba`, verdict *land after
the listed fixes*. It could run no test (the machine was refusing test runs for memory), so I ran
its tests and its fixes afterwards; the results are under Gates.

1. F7 (P1), fixed by the reviewer and kept: a Stop that landed just after a backoff resolved, or
   inside the stream's second `onActivity`, could open another meter for a request an aborted
   `fetch` never sends. That is a spend row for nothing, not a charge. Both loops now check the
   signal before a retry creates its meter. Six tests, and
   [a postmortem](../postmortems/261005i-cancellation-checked-before-an-await-does-not-authorize-the-next-attempt.md)
   naming the class.
2. F8 (P3), fixed by the reviewer and kept: four sentences that claimed more than the code or
   the evidence did.
3. F9 (P1), reported by the reviewer as wider than the stage: the Messages wire's loop, built in
   261003m, has the same gap after its wait. I added the same check there
   (`src/messages-stream.ts`). It has no test of its own: the window is between a timer firing
   and the next line, and the existing "an abort during the backoff" test does not reach it.

The reviewer also noted, and I left alone, that three seams (`openRouterJson`,
`openRouterImage`, `openRouterStream`) still write a row for a call whose signal was aborted
before the first attempt. That is older than this plan and `tests/ai-call-images.test.ts`
characterises it.

## Gates

- `npm run typecheck` on the stage commit: green.
- The 22 affected suites on the stage commit plus the reviewer's edits: 964 of 965 green. The
  one red was my own edit landing on the wrong test in `tests/ai-call-images.test.ts` (it put
  `retryTransport: false` on the test of a `200` whose body breaks, which must pass without
  it). Moved to the right test.
- **Mutations**, each against `tests/ai-call-transport-retry.test.ts` (104 tests), source put
  back after each, unmutated run green at the end:

  | Guard removed | Tests that went red |
  | --- | --- |
  | the `priced` check in `worthAskingAgain` | 7 |
  | the abort check in `mayAskAgain` | 5 |
  | the never-answered mark (any `TypeError` retried) | 6 |
  | a failed stream attempt finishing its own meter | 18 |
  | the cancellation check at retry entry, whole-call seams | 4 |
  | the opt-out | 16 |
  | the cancellation check at retry entry, stream | 2 |

  The reviewer's six tests were written before its fix and never seen red by it; the fifth and
  seventh rows are them going red.
