# Count AI calls that die part-way, and transport retries

Queue item `qi-da5rpd2v`. Up: [plans.md](../project/plans.md). It follows
[261005j](261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md),
which built the retry and left one question open.

## What it is for

A model call can fail in two places. **Before its answer began** — the connection dropped, or the
provider said 503 — and since 261005j we ask again, up to three goes. **After its answer began** —
the stream died half-way — and we do not ask again, because that means paying for the call twice.
Whether to start doing so ("B") is Greg's call, and he asked for the numbers first:

> A or maybe B would be better. if we go with B, let's add logging/monitoring so we'll be able to
> notice how often retries happen (and hopefully diagnose them)
>
> — Greg, 2026-10-06, on [Q-pay-twice-for-a-broken-answer]

So this builds the counting and nothing else. **B is not built.** After a week of data the Overseer
puts the question to Greg again with the counts.

## What cannot be answered today

`ai_calls` already has a row per attempt, so a retried call is two rows, `error` then `ok`. But a
row says only `outcome = 'error'`. From the ledger you cannot tell:

- whether a failed row was **followed by another attempt** or was the call's last word;
- whether it failed **before or after the answer began**;
- **why**: the HTTP status, or which kind of network failure.

## The design

Revised after GPT Sol's plan review ([the review](261006b-count-ai-calls-plan-review-sol.md),
verdict *change first*, eight findings, all taken; the ledger is at the foot).

### Four nullable columns on `ai_calls` (one additive migration)

| column | type | meaning |
|---|---|---|
| `attempt` | `smallint` | 1-based: which go this row was, inside one call's retry loop. **A row with `attempt > 1` is a retry that really started.** Null on a row no retry loop of ours counted: old rows, realtime, and a seam called with `retryTransport: false`, whose caller owns the loop |
| `failure_phase` | `text` | `before_answer` or `mid_answer`, on a row whose outcome is not `ok`; null on an `ok` row and on old rows. A CHECK holds it to those two |
| `failure_class` | `text` | a label for the cause from a **closed, literal vocabulary**; null on an `ok` row |
| `failure_status` | `integer` | the HTTP status of the response, when there was one |

**There is no `retried` column** (F3). The first draft had one, meaning "another attempt followed
this failure". Both wires write the failed attempt's row before the backoff, and a Stop during the
backoff means no attempt follows, so the column would have needed either a deferred write or an
update to a ledger row. The ordinal says the same thing from the other side with no protocol: the
retry's own row has `attempt > 1`, and it exists only if the retry started. The ordinal is threaded
from the loop into each attempt (`asTransportAttempts` passes `n` to its callback; `acceptedStream`
and `streamMessage` already count).

**The phase boundary is the acceptance boundary on each seam, stated on its own terms** (F2), not
"whatever the retry does not cover": on the OpenRouter stream, a `2xx` with a body in hand
(`acceptedStream` returned); on the Messages wire, `message_start` (`attempt.begun`); on the four
whole-call OpenRouter seams, `2xx` response headers. A whole-call seam that gets **503 headers and
then fails reading the body** is `before_answer` with `failure_status = 503`, although today's
retry does not ask again for it: the status is recorded when the headers arrive, before the body
is read, not taken from `ProviderRefused` alone.

**`failure_class` is mapped, never sanitised** (F6, F7). A pure function maps what it recognises to
a literal and everything else to a fixed fallback; no string from an error, a cause or an abort
reason is ever stored, filtered or not. The vocabulary:

- `refused` — a non-2xx response (the status is in its own column)
- `network:<CODE>` for a `<CODE>` on an allowlist (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`,
  `EPIPE`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`,
  `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`), found by a bounded walk of `cause` (the
  Anthropic SDK wraps the `TypeError`, so the code can sit two causes down); plain `network`
  otherwise
- `provider:<type>` for the Messages wire's in-band event types on an allowlist
  (`overloaded_error`, `api_error`, `timeout_error`, `rate_limit_error`, `authentication_error`,
  `permission_error`, `invalid_request_error`, `not_found_error`, `request_too_large`,
  `billing_error`); `in_band` for an OpenRouter error chunk or envelope
- `unfinished` — the stream ended without `[DONE]`
- `unreadable` — a 2xx whose body would not parse
- `stall`, `deadline`, `abort` — see below
- `other`

### Three mis-recordings found on the way, fixed here

A count of part-way deaths is wrong if some of them are recorded as something else. Three are:

1. **An in-band error chunk on the OpenRouter stream is an `aborted` row.** `openRouterStream`
   records a consumer's throw as `aborted`, because a `return()` is all it sees, and the consumer
   throws on `chunk.error`. The generator sees every chunk, so it notes the error chunk and records
   `error` / `mid_answer` / `in_band`. Sol checked that nothing charges or releases a slot on the
   difference between `aborted` and `error`.
2. **A 2xx whose JSON will not parse is an `ok` row** (F1). `meterBody` swallows the parse failure
   and `openRouterJson` returns `null`. It becomes `error` / `mid_answer` / `unreadable`. The
   caller still gets `null`: the return contract does not change.
3. **A 2xx carrying an error envelope is an `ok` row** (F1). `src/pdf-read.ts` finds the envelope
   after the gateway has finished the meter. Where the gateway can recognise the envelope itself
   (`{ error: … }` at the top level and no `choices`), it records `error` / `mid_answer` /
   `in_band`. Again the caller's return value and its own retry are untouched.

**The retreat, decided now:** if 2 or 3 would need a caller's contract to change, it is left, and
the plan and the page say that the count misses it.

### Stalls: counted if the reason can be typed in one place, otherwise said to be unmeasured

One kind of part-way death is recorded as an abort: our own stall clock firing on a provider that
went silent. At the gateway the signal is a composite and a stall's reason is a plain
`Error("stalled")`, the same shape as a reader's Stop (F8), so today it cannot be told apart. If
the stall and deadline reasons are made in one or two shared places (`src/stream-run.ts`), they
become small typed errors and an `aborted` row gets `failure_phase` and `stall` / `deadline` /
`abort`, including when the cancel ended the stream cleanly without throwing. **If they are made in
many places, this is not built**, `aborted` rows keep null failure fields, and the page says stalls
are not measured rather than showing a zero.

### A log line

Through `src/log.ts`, at `warn`, one per event, with job, wire, model, attempt, class and status and
nothing else: `ai transport retry` as a retry's attempt starts, `ai call died part-way` when a
`mid_answer` error is recorded. No Sentry call is added; if `log.warn` already leaves a
breadcrumb, that is the breadcrumb.

### Where it is shown

`/admin/costs` gets a **Failures and retries** section, and `npm run cost:analyse` the same
figures: per day and per job, the retries, the calls that gave up after the last go, the calls
that died part-way, and under them the causes (class, status, upstream, model).

**On the cube, not beside it** (F4). The first draft had a separate grouped read; admin-costs.md's
rule covers every table on the page, and a second read would not follow the page's scope and
filters or see the same snapshot. So `spendCube` gains `failure_phase`, `failure_class` and
`failure_status` as grouping columns (they are null on nearly every row, so the cube barely
grows) and two measures by `COUNT(*) FILTER`: `retries` (`attempt > 1`) and `counted`
(`attempt is not null`). The page and the report share the folds.

**Counts, not rates** (F5). A ledger row is an attempt, not a call, and rows from before the
migration, and from the loops this does not count, have nothing to say. So the section shows the
counts with the number of counted attempts beside them as context, claims no percentage, and
shows a day with no counted attempt as *not measured* rather than as zero.

## Not in scope

- B itself.
- `src/pdf-read.ts` and `src/embeddings.ts` keep their own retry loops and call the gateway with
  `retryTransport: false`; their rows get phase, class and status, and a null `attempt`. Counting
  their loops is a second mechanism and is left out. Said on the page.
- Realtime rows (`src/live.ts`): untouched, all four null.

## Stages

1. **The columns and the recording.** Migration; `SpendRecord` and the row writer; both wires fill
   the fields; the log lines. Red-first tests against a stubbed `fetch` / transport, extending
   `tests/ai-call-transport-retry.test.ts` and the Messages wire's retry tests: a blip then an
   answer is rows `(1, error, before_answer)` and `(2, ok)`; three failures end at `attempt = 3`;
   a Stop during the backoff leaves one row and no `attempt = 2`; a stream that breaks after a
   chunk is `mid_answer`; a whole-call 503 whose body breaks is `before_answer` with the status;
   `retryTransport: false` leaves `attempt` null; a wrapped `ECONNRESET` and two distinct Messages
   event types map to distinct labels; an error name or cause code off the allowlist never reaches
   the column; each of the three mis-recordings, red first.
2. **The read and the page.** The grouped query, the section, `cost:analyse`, the docs
   (`cost-tracking.md`, `admin-costs.md`, `ai-gateway.md`), a browser check at three widths.

Each stage: `npm test`, `npm run typecheck`, a GPT Sol code review, a commit.

## Order in production

`npm run deploy` applies pending migrations before the code ships, so the columns exist before
anything writes them. All four are nullable with no default, so the old code keeps inserting
through the gap.

## Progress

- [x] GPT Sol review of this plan: F1–F8 all taken, as marked above. F3 was taken by removing the
  column it objected to rather than by building the protocol it proposed; F8 by the either/or it offered.
- [x] Stage 1 (code and tests written, not yet reviewed or committed). The four columns
  (`drizzle/20261006014116_ai_calls_attempt_and_failure.sql`), both wires filling them, the
  vocabulary and its pure mapping in a new `src/call-failure.ts`, the two `warn` lines, and all
  three mis-recordings fixed with no caller's return value or retry changed.
  **Stalls were not built**, by the either/or above: the stall reason is made in eight runners
  (`grep '"stalled"' src`) and the deadline in about twenty, so an `aborted` row has an `attempt`
  and null failure fields, and `stall` / `deadline` / `abort` are not in the vocabulary. Stage 2's
  page has to say stalls are not measured.
  Three things differ from the text above. The envelope test also requires no `data`, not only no
  `choices`, since embeddings and images answer there. `failure_status` is filled whenever a
  response arrived, so it is `200` on a `mid_answer` row. And mis-recordings 2 and 3 move rows
  from `ok` to `error`, which the existing failed-call count on `/admin/costs` will show as a rise
  that is not a change in behaviour.
- [ ] Stage 2
