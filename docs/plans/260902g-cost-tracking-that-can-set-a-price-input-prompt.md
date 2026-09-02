# Input wanted: making cost tracking good enough to set a price against

You are advising on an alpha-stage TypeScript/ESM reading app (Spideryarn). No real users yet;
speed wins, but the code must still be good to work with in six months. Preference is strongly for
**fewer moving parts** — an extraction with one caller, or a registry for three things, is
over-engineering, not cleanup.

## The situation

Greg is about to add **Stripe subscriptions** (a different agent is doing the Stripe work). Likely
model: a fixed monthly subscription including some token allowance or some number of article
uploads. Before setting the price he needs to know **what a user and an article actually cost**.

Cost tracking already exists and is good. Built 2026-08-27/28:

- Every paid model call goes through one of **two seams** — `src/messages-stream.ts` (Anthropic
  Messages shape, the pipeline stages) and `src/ai-call.ts` (OpenAI chat shape + embeddings). All
  traffic goes to **OpenRouter**, whose `usage.cost` is a settled figure we record verbatim rather
  than computing.
- An `AsyncLocalStorage` spend collector (`src/ai-spend.ts`) opened per pipeline step (`runStep`)
  and per HTTP request (`handleApi`).
- One row per finished call in `ai_calls` (37 columns; `drizzle/0021`, `0023`, `0025`), written by
  an injected sink, awaited before the collector closes. `owner_id` is NOT NULL with an FK to
  `auth.users`.
- `npm run cost` (`scripts/ai-cost.ts`) reports by day/job/model/article/owner/scope, plus a
  `--reconcile` against OpenRouter's own `GET /api/v1/key`.
- Two tripwire tests: `no-undeclared-spend` (can this file reach a provider, and is that declared)
  and `paid-cli-ledger` (does each paid CLI entrypoint open the ledger).

**Greg has just said he is NOT worried about software-side spend caps**, because he has set an
account-level cap in OpenRouter. So caps/quotas/reservations are OUT OF SCOPE. This job is
measurement and visibility only.

(Note we pointed out to him: the OpenRouter cap cannot see live conversation, which bills a
separate `OPENAI_API_KEY` direct from the browser. We have suggested he set an OpenAI dashboard cap
too. That is a dashboard action, not code.)

## What three parallel audits found (all verified against code at today's line numbers)

### The big hole: live conversation is entirely unmetered

Live conversation mode is voice dialogue on **OpenAI's Realtime API** (`gpt-realtime-2.1`, voice
`marin`, plus a separately-billed `gpt-live-transcribe`). `src/live.ts` mints a short-lived token
and **the browser opens WebRTC straight to OpenAI**, so no server seam sees the spend.

- Zero rows, zero log lines. `src/live.ts:581` — "**Nothing is metered.**"
- The type system forbids a row: `Wire = "messages" | "chat" | "embeddings"`, `ProviderAccount =
  "openrouter" | "anthropic"`, and `NonTaskAiJob` has no `live_conversation`.
- It is not even a declared bypass — it sits in the capability scan's ALLOWED list
  (`tests/no-undeclared-spend.test.ts:193`). `scripts/ai-cost.ts:290` `liveConversationGap()`
  prints the hole by name on every run.
- **The browser already receives the usage and discards it.**
  `src/web/live/useLiveConversation.ts:724` handles `response.done` but reads only
  `e.response.output` for function calls; `usage` is never touched. A repo-wide grep for
  `usage|input_tokens` under `src/web/live/` returns nothing.
- Input transcription is billed separately and reported on
  `conversation.item.input_audio_transcription.completed`, NOT on `response.done` — so a
  `response.done`-only meter would still miss a cost line.
- Caps are **browser constants only** (`useLiveConversation.ts:245`: 5-min idle, 20-min session),
  enforced by a `setInterval`. `src/live.ts:586` — "a per-reader ceiling this server could enforce
  does not exist." No session record of any kind exists server-side.
- Pricing (research doc, fetched 2026-08-31): audio in **$32/Mtok**, audio out **$64/Mtok**, cached
  audio in $0.40/Mtok. Estimated **$0.06–$0.11/min cached, $0.18–$0.46/min uncached**. At the
  20-minute cap that is roughly **$1.20–$9 per session**, with no limit on sessions per reader.
- `src/live.ts:591` notes the article is re-sent per session and the prompt cache belongs to the
  session — so hang-up-and-restart pays full uncached price for the whole article again, pushing
  real use toward the upper band.
- For scale: a whole default article ingest is ~**$0.52** (measured). One live minute can cost
  most of an article; one session can cost twenty.

**A plan for this already exists and was already reviewed by you**:
`docs/plans/realtime-voice-cost-tracking.md`, headed "Status: decided, not built." It proposed:
widen `Wire` with `"realtime"`, `ProviderAccount` with `"openai"`, `AiJob` with
`"live_conversation"`; a **third first-class seam** `src/realtime-spend.ts` (explicitly NOT a
declared bypass — "a permanent product feature is not an admitted bypass"); a durable
`realtime_sessions` parent table with `beginRealtimeSession` / `recordRealtimeResponse` /
`recordRealtimeTranscription` / `closeRealtimeSession`; one `ai_calls` row per `response.done` plus
one per paid input transcription; `costNanos = null`, `computedCostNanos` set,
`costSource = "computed"`; a new `usageSource: "client_report" | "sideband"` column; the browser
posting each `response.done` immediately keyed on `response.id`, held in an **IndexedDB outbox**
until acked, with `sendBeacon` on `pagehide` as a hint only; the endpoint accepting a narrow
projection and never a client-supplied dollar amount.

**0% of it is built.** A repo-wide grep for `realtime_sessions|realtime-spend|usageSource` returns
one hit, in prose.

### Live defects found on the way (all confirmed)

1. **`web_searches` is null on 100% of 3908 rows.** `src/ai-call.ts:651` hard-codes it null with a
   comment claiming "no caller here uses a server-side web search" — **four call sites falsify
   that** (`explain` up to 8 searches, `referee-criteria` up to 8, `chat` and `referee-candidates`
   via Exa at up to 30 results/turn). The money is correct (it is inside OpenRouter's `usage.cost`)
   but per-result search spend is unattributable. A correct parser already exists at
   `src/openrouter-stream.ts:331` and is simply not called from `Meter.saw()`.

2. **A double-count trap aimed straight at the billing query.** `drizzle/0023`'s CHECK makes
   `credits_used_nanos` and `computed_cost_nanos` mutually exclusive, and its own comment says why:
   "a SUM over both would double-count." But **`upstream_inference_nanos` is outside that
   constraint**, and `src/ai-call.ts:587` sets it on every chat-wire call, BYOK or not. Measured:
   29 of 29 non-BYOK rows carry it equal to `credits_used_nanos`. The rule that makes a total
   correct — add `upstream` only when `is_byok` — lives ONLY in JS, in `totalRows()`
   (`src/store/ai-calls.ts:73-77`). An auditor writing the obvious SQL `SUM` got $23.54 where the
   truth was $11.77. The next thing anyone writes against this table is a per-owner-per-month
   billing aggregate in SQL.

3. **The test suite writes real rows into the dev Postgres ledger.** 3888 of 3924 rows are
   `test-chat-route-fixture` / `test-remember-route-fixture` / `test-candidates-route-fixture`.
   The **filesystem** store already separates tests (`_ai-calls.test.jsonl`,
   `src/store/ai-calls-fs.ts:65-74`, with a comment about exactly this accident); the Postgres
   store has no equivalent. Every count, every `By owner` and `By article` line, and the permanent
   "3872 calls reported no cost" warning are meaningless as a result — and that warning is the only
   signal that would show a real unpriced problem.

4. **Two disjoint ledgers, and the default reads the wrong one.** `SPIDERYARN_STORE` defaults to
   `files`. Bare `npm run cost` reported **$28.67 / 565 calls** from `data/_ai-calls.jsonl`;
   `SPIDERYARN_STORE=postgres npm run cost` reported **$2.54 / 3924 calls** from Postgres. No
   command sees both, neither says the other exists, and production is Postgres.
   `--reconcile` compares only whichever is live: it reported our $0.66 against OpenRouter's
   $4.11 for the month, a gap that cannot currently be driven to zero.

5. **Unpriced rows are silently counted as free in every breakdown.** There is no computed fallback
   in the app at all — `computedCostNanos` is hard-coded null at both seams
   (`src/messages-stream.ts:562`, `src/ai-call.ts:634`), and `ANTHROPIC_PRICES` in `src/pricing.ts`
   is imported only by evals and tests. So an aborted stream, a stall, a deadline, or a 200 with no
   usage records `cost_source='none'` and contributes exactly $0. `by()` in `scripts/ai-cost.ts:113`
   discards the unpriced count, so per-day/job/model/article/owner lines cannot show it. Only the
   top-level "short by an unknown amount" line survives. 16 of 329 product calls.

6. **`jobSpend()` drops `computed`** (`src/jobs.ts:754`: `aiCostNanos: credits + upstream`) — zero
   today because computed is eval-only, but it is a latent under-report on the single line that
   says what an ingest cost.

7. **The register is less complete than it claims.** `evals/live/*.mts` (which also calls
   `/v1/audio/speech` TTS) and `scripts/run-codex.ts` spend real money and are in neither
   `DECLARATIONS` nor printed by `npm run cost` — they sit in the ALLOWED map. The doc's claim of
   "thirteen call sites" is now 20 in `src/`. `OPENAI_API_KEY` is required by `src/live.ts:522` but
   is in neither `.env.example` nor the health report's EXPECTED list — the one credential nothing
   can see the spend of is also the one nothing documents.

### What the reporting cannot do

The ledger is good; the reporting is developer-shaped, not pricing-shaped.

- **No SQL aggregate exists anywhere.** `CostStore.read(since, until)` fetches every row in a
  window and sums in JS. No `GROUP BY`, no `SUM`. That is fine at 4k rows and not at 400k.
- **No owner filter** on `costStore.read()`, and no `--owner` flag; the report prints raw UUIDs with
  no join to `auth.users` — and accounts come from the Supabase **Auth service over HTTP**
  (`src/store/admin-accounts.ts`), not a table, so it is not a single SQL join.
- **No ingest-vs-reading split.** `scope_kind` (`job_step` vs `request`) gives it and no report uses
  it. This is exactly the split that decides whether to price on uploads or on usage.
- **No admin UI for cost at all.** `/admin/users` shows counts and dates
  (`src/web/admin-columns.tsx:67`); `src/admin.ts` never mentions `ai_calls`.
- **No article has ever been fully ingested in either ledger.** Every job is a dev re-run of one or
  two steps. The most complete article covers 6 of 13 steps for $0.909. A full ingest is
  *extrapolated* at $1.50–$3, not measured.
- **"Cost" is still undefined for pricing.** `usage.cost` is OpenRouter **credits**; cash is ~5.5%
  higher because their fee is on buying credits, not per token. Question 5 to Greg in the original
  plan is still unanswered.

### A pricing-structure finding worth your view

`DEFAULT_INGEST_STEPS` (`src/pipeline.ts:235`) is only five steps — fetch, extract, blocks,
hierarchy, assets — and of those only `hierarchy` buys a model call (~$0.52 measured). The other
eight in `STEP_ORDER` (arc, tweets, glossary, quotes, ideas, timeline, quiz, sketch) are
deliberately off the default, each with a comment saying "it costs a model call", and are triggered
on demand by the reader. Add chat, explain, search, quiz-mark, referee, dictation, embeddings and
live conversation, all reader-triggered.

So the marginal cost of an article is not fixed at upload; the cost driver is **engagement**, not
uploads. That seems to argue against "N articles per month" as the headline lever.

## What I want from you

Be blunt and concrete. Push back where I am wrong.

1. **Sequencing.** My instinct is that the data-integrity defects (2, 3, 4) come first, because
   every pricing number computed before they are fixed is wrong, and Stripe work is starting now
   against this same table. Is that right, or is metering live conversation urgent enough to go
   first given it is the largest unknown?

2. **The live-conversation design, revisited for an alpha.** The existing plan specifies a durable
   `realtime_sessions` table, an IndexedDB outbox, ack-based retry, and a new `usageSource` column.
   Is that worth its keep for a feature with no users, when the goal is a *pricing estimate* rather
   than an invoice? Is there a materially simpler version — e.g. post each `response.done` usage
   immediately to one endpoint that writes an `ai_calls` row, best-effort, accepting some loss —
   that gets Greg a good enough number for far less machinery? What specifically would that lose,
   and would you regret it? Argue both sides and then pick one.

3. **Trusting the browser.** The usage numbers can only come from the reader's tab. Is a narrow
   projection (token counts only, never a dollar amount, server does the arithmetic from a price
   table) sufficient, given no caps depend on it and it is used only for aggregate pricing
   analysis? What is the cheapest sanity check worth having — e.g. bounding reported tokens against
   session wall-clock?

4. **The double-count trap (2).** What is the right fix? Options I see: (a) extend the `0023` CHECK
   to cover `upstream_inference_nanos`; (b) stop writing it on non-BYOK rows; (c) add a SQL view or
   generated column that is the single correct "what this row cost" expression, so no future query
   can get it wrong. Is (c) the right shape or is it machinery? Note the codebase strongly prefers
   putting a shared invariant where it already lives over minting a new home.

5. **The test-pollution fix (3).** The fs store solved this by writing to a different file. What is
   the right equivalent for Postgres — a separate schema, a `is_test` column, a per-run
   `scope_kind`, refusing to write when `NODE_ENV=test`? Which one will still be right in six
   months?

6. **The unpriced-rows problem (5).** Should the app grow a computed-cost fallback so an aborted or
   stalled call contributes a lower-bound estimate instead of $0 — reusing the `ANTHROPIC_PRICES`
   machinery that already exists but is eval-only? Or does that put an estimate somewhere it will
   later be mistaken for a settled figure, which the schema went to some trouble to prevent?

7. **What the pricing report should actually be.** Given the goal is "set a subscription price",
   what is the minimum reporting that answers it? My draft: per-owner-per-month totals split by
   `scope_kind` (ingest vs reading) and by job, plus one measured full-pipeline ingest of a
   representative article, plus a per-article lifetime cost. What am I missing, and what would you
   cut?

8. **Anything we have not asked.** Especially: what will hurt when Stripe lands and someone tries to
   reconcile a subscriber's bill against this table?
