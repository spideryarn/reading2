# A transport blip fails an import: a countable retry on the Messages wire

Up: [plans.md](../project/plans.md)

Report `spya-x4zut6` (Sentry `SPIDERYARN-READING2-BH`), from Greg, 2026-10-03, queue item
`qi-bj949xn6`. The pre-filled failed-import report; he left "What I expected" empty:

> This import failed.
>
> Job: spya-srcm53
> Article: we-must-pace-the-frontier-spya-qhda2b
> Status: error
> Failed at step: arc
> Failure kind: retry
> Added: 2026-10-03T15:09:41.688Z
> Started: 2026-10-03T15:09:59.095Z
> Ended: 2026-10-03T15:09:59.796Z

## What happened

Read from production's runtime log (Vercel, 15:09–15:11 UTC, read-only):

- The article itself imported fine. `fetch`, `extract`, `blocks`, `structure`, `assets` and
  `labels` all finished between 15:09:11 and 15:09:57.
- At 15:09:41 the reading view queued ten single-step jobs, one per mode. Nine finished (`tweets`,
  `crossrefs`, `simple`, `glossary`, `quotes`, `ideas`, `skim` and so on). The tenth was
  `spya-srcm53`, `steps: ["arc"]`.
- Its claim ran on a cold-started function (`cold start: module import`, 1555 ms, logged at
  15:09:58.902). The step failed 595 ms after it began:

  ```
  "err":{"type":"Error","message":"Anthropic SDK request failed, status 503. [ai-upstream]", …},
  "step":"arc","ms":595,"aiCalls":1,"aiCostNanos":0,"aiUnpriced":1
  ```

- **The logged error carries no `status` field.** `safeError` in `src/log.ts` copies `status` off
  an error whenever it is a number, and `anthropicCallFailed` sets it only when the SDK's error had
  one. So the SDK's error had **no HTTP status**, and the "503" in the message is the default
  `anthropicCallFailed` substitutes (`typeof err.status === "number" ? err.status : 503`). No
  server said 503.

  An `APIError` with no status is one of two things in the Anthropic SDK: the connection failed
  (`APIConnectionError`, `APIConnectionTimeoutError`), or the response was a `200` whose stream
  carried an `error` event (the SDK throws `new APIError(undefined, …)` for those). The log cannot
  say which, because we flattened both into "status 503". Either way no listener had heard a
  start or any text. Whether the provider billed anything for that attempt is unknown: its row
  says unpriced, not free.

## The root cause, and its class

`messagesClient` in `src/messages-stream.ts` sets `maxRetries: 0`. Its comment says why: one
`SpendRecord` must be one HTTP attempt, and the SDK's built-in retry hides up to three attempts
behind one record. It then says what that costs:

> a transport blip that the SDK used to paper over now surfaces as a failed step. That is the
> honest trade — the pipeline already retries at the step level, where a retry is visible on the
> job

**That last clause is not true of anything automatic.** The only step-level retry is the reader
pressing Retry. So every one of the eighteen `streamMessage` call sites fails its whole step, and
with it the job, on a single dropped connection. With ten model calls per import, a small
per-call blip rate is a noticeable per-import failure rate.

The class: **a safeguard was removed for a good reason, and its replacement was named in a comment
but never built.** `src/pdf-read.ts` (`TRANSPORT_ATTEMPTS`) is the one stage that did build the
replacement, as the same comment points out.

A second, smaller defect: the diagnostic states a status nobody sent. That is why this took a log
read and an inference to diagnose.

## What we will do

### Stage 1: a countable transport retry inside `streamMessage`

`streamMessage` retries an attempt that **failed before the response began**, up to
`TRANSPORT_ATTEMPTS = 3` goes in total, with a short backoff (about 0.5 s, then 1.5 s, with
jitter).

- **Each attempt is its own metered call**: its own `beginSpend`, its own `SpendRecord`. A blip
  that is retried once leaves two rows, the first with outcome `error` and no cost. So the rule
  the `maxRetries: 0` comment protects, *one record, one network attempt*, still holds. The SDK's
  `maxRetries` stays `0`.
- **"Before the response began" means no `message_start` was seen.** After `message_start` the
  model is generating, tokens are being billed, and `onStart`/`onText` listeners may already have
  fired, so that failure is not retried and surfaces exactly as today.
- **Which failures are retried** (as built, after GPT Sol's plan review):
  - the connection failed or timed out, or the body broke before its first frame;
  - a `200` whose stream opened with an `error` event of type `timeout_error`,
    `overloaded_error` or `api_error`, or with no type at all;
  - a status of 408, 409, 500, 502, 503, 504 or 529.

  Never a 400/401/402/403/404/413/422, nor an error event that is a verdict (billing,
  authentication, invalid request and so on): those say the same request will get the same
  answer. Never an abort. **Never a 429**: Structure deepening already has a rate-limit policy
  (`Retry-After`, a shared width gate) that a blind retry here would hide two of every three 429s
  from.
- **`message_start` is the boundary because nothing has been shown before it. It does not prove
  nothing was billed.** A connection can drop after the provider accepted the work. So a retry
  accepts that it may pay twice for the first moment of a call, and the failed attempt's row has
  an unknown cost.
- **`attempts()` on the call**, so the two callers that publish their own request count
  (`SimpleRun.calls`, a label batch's `requests`) still agree with the ledger after a retry.
- **The signal is honoured in the backoff.** A Stop or a step deadline during the wait ends the
  call as an abort, without another attempt.
- **Listeners survive the retry.** `onText` and `onStart` listeners are kept in a list and
  attached to each attempt's stream. Because a retry only happens before `message_start`, a
  listener never sees text from two attempts.
- `aborted()` says whether the call as a whole ended by abort, including a Stop that landed in
  the wait between two attempts.

Cost of the wait: at most about 2 s of backoff plus the failed attempts' own time, inside step
deadlines of 60 s and up. A blip that fails in 0.6 s costs about a second.

### Stage 2: the diagnostic says what happened

`anthropicCallFailed` keeps mapping a status-less failure to the `[ai-upstream]` reader sentence
(it is still the right one: trouble at the far end, try again). The **diagnostic** stops saying
"status 503" for it and says which it was, in our own fixed words chosen by `instanceof`:
"connection timed out", "connection failed", or "no HTTP status (the stream ended in an error)".
Still `{ authored }`, because every character is ours and nothing is interpolated from the SDK.

### Docs

`ai-gateway.md` and the `maxRetries` comment get the corrected account. A note in
`docs/user-feedback/`. A postmortem, since the class has a name.

## The simpler option passed over

**Turn the SDK's own retry back on (`maxRetries: 2`).** One line. Passed over because it breaks
the accounting rule the line was written for: three attempts behind one record, and the SDK also
retries after a 5xx that arrived post-generation, which is a billed attempt nobody counted.

**Retry the step in the job runner instead.** Passed over because `runStep` is fenced by claims,
deadlines and a draft revision, a step can hold several model calls (Simple makes six) and would
re-buy the ones that worked, and the same blip would still fail every caller outside a job.

## What this does not do (deferred, named)

- **The other wire.** `src/ai-call.ts` (chat, explain, search, the OpenAI-shaped calls) has its
  own rules about retries and is not touched. Whether it has the same gap is a separate question
  with its own queue entry.
- **Retrying after `message_start`.** A stream that dies mid-answer is still a failed step. That
  needs a decision about paying twice, so it is not slipped in here.
- **The job that failed.** `spya-srcm53` stays as it is in production; Greg's Retry on the card
  (or opening the article's Arc) writes it. Nothing here writes to production.

## Tests (red first)

In `tests/messages-stream.test.ts`, against the stubbed transport:

1. the transport throws once, then answers: `finalMessage()` resolves, two requests were sent, and
   the spend report has two calls, `error` then `ok`. **This is the reproduction, and it is red
   today.**
2. a `200` whose stream opens with an `error` event, then a good answer: same.
3. a 503 then a good answer: same. A 400: one request, rejects.
4. three failures: rejects after exactly three requests, three `error` records.
5. a failure after `message_start`: one request, rejects, `onText` fired once only.
6. an abort during the backoff: rejects as an abort, no further request.
7. `onStart` and `onText` fire once for a call that succeeded on its second attempt.

In `tests/anthropic-call.test.ts`: a status-less error's diagnostic no longer contains "503", and
still ends `[ai-upstream]`; a real 503's is unchanged.

## Questions for Greg

None that block. One to note: the retry applies to every Messages-wire call, including ones a
reader is watching (a watched call that blips now takes about a second longer rather than
failing). I took that as plainly better; say if not.

## GPT Sol's plan review

[The review](261003m-a-transport-blip-plan-review-sol.md), verdict *change first*. Seven
findings, all accepted and built:

1. No generic 429 retry (it would trample Structure deepening's rate-limit policy).
2. `attempts()`, so Simple's and Labels' own request counts stay true.
3. "Nothing was generated" was unsupported; the claim is now "nothing was shown, cost unknown".
4. Status-less error events are retried by type, not wholesale; 409 added.
5. `aborted()` is about the call, not the current stream.
6. Tests for the exact `message_start` boundary and for nothing left pending.
7. The remaining "one `streamMessage`, one record" sentences now say "one attempt".

## Progress

- [x] GPT Sol review of this plan
- [x] Stage 1 red tests (seven red before the fix), then the retry
- [x] Stage 2 diagnostic
- [x] GPT Sol code review
- [x] Docs, postmortem, feedback note, queue entry for the other wire (`qi-wwhdcejd`)

## GPT Sol's code review

[The review](261003m-a-transport-blip-code-review-sol.md), verdict *land*. It fixed five things
itself; I read its diff and kept all of it:

1. P1: a stream that failed before anyone awaited `finalMessage()` raised an unhandled rejection.
   It now has its own `error` and `abort` listeners.
2. P1: a signal that was already aborted wrote a spend row for a request that never went out. It
   now makes no request, writes no row, and reports zero attempts.
3. P1: three test doubles lacked `attempts()`. **It missed a fourth**
   (`tests/stage-stamp-agreement.test.ts`), which the full suite found and I fixed.
4. P2: tests that Simple and Labels publish real attempt counts.
5. P2: two more comments that still said "one record, one call".

Its sixth finding it left for me, as wider than the change: three Structure sentences
(`src/structure.ts`, `src/structure-deepen.ts`, `structure-step.md`) said a call is never sent
again or that two calls is the worst case, which the gateway's retry makes untrue of *network
requests*. I corrected the three sentences. No behaviour changed there.

## Gates

- `npm run typecheck`: green.
- Full suite, first run: 8 files red. One was the missing test double above; one was the feedback
  endings map, regenerated; one was the reviewer's new test caught mid-edit; five were a fresh
  worktree with no build (`npm run build`, `npm run build:fleet`). All 14 files re-run alone: green.
- Full suite, second run on the final tree: green, 1491 files passed and 1 skipped.
