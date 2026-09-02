# Review this plan before it is built

You reviewed the *findings* behind this plan an hour ago and reshaped it substantially — the slim
realtime design, the `byok_upstream_nanos` normalisation, the test-ledger redirect, the five cost
categories, the distribution-shaped report. Thank you; all of it is folded in.

This is the resulting plan doc. Review it as a plan someone is about to build from.

Specifically:

1. **Did I misread any of your guidance?** Especially on the realtime session row, the CHECK
   constraint shape, and what you meant by the endpoint being the seam.
2. **Stage boundaries.** Each stage is meant to end green, committable and deployable. Does Stage 1
   really stop cleanly given it renames a column that `totalRows()`, both store adapters and the
   report all read? Is the rename worth the churn, or should the column keep its name and only the
   CHECK and the write path change?
3. **Stage 2 is the biggest.** Is it one stage or two? What would you split it at?
4. **What is missing entirely.**
5. **What should be cut.** Be aggressive. This is an alpha with no users, and the codebase's own
   rule is that new machinery is a proposal, not a freebie.
6. **Anything in here that is now stale or wrong**, given you have seen the evidence.

One thing I did not take your advice on, deliberately: you said cut the admin spend column. Greg
asked for it explicitly when given the choice, so it stays, last in Stage 3 and first to drop. Say
if you think that is a mistake worth arguing.

The plan follows.

---

# Cost tracking that can set a price

**Status: planned, not built.** Written 2026-09-02. Reviews share the letter `g`.

## Why now

Stripe is arriving — a different agent is building it. The pricing model is not settled, but it is
likely a fixed monthly subscription including some allowance.

> And so I want to know how much cost is being incurred before we, so that we can optimize that
> pricing model.
>
> — Greg, 2026-09-02

That is the whole goal. **This job is measurement and visibility, not enforcement.** Every number
below exists so a price can be set against it.

## What is already true, and it is a lot

Cost tracking was built on 2026-08-27/28 and the design is sound —
[260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md),
[ai-gateway.md](../project/ai-gateway.md). Two seams, one vendor, a row per call carrying
OpenRouter's own settled figure rather than our arithmetic, `owner_id` on every row, and two
tripwire tests that fail when a new file can reach a provider without declaring itself.

**Nothing here re-litigates that.** The gap is not in the ledger's design; it is in three places:
the ledger has defects that make its numbers wrong in specific, checkable ways; the single most
expensive feature writes no rows at all; and the reporting is developer-shaped rather than
pricing-shaped.

## Decisions taken

**Greg, 2026-09-02:**

- **Spend caps are out of scope.** There is an account-level cap set in OpenRouter. *"Note that we
  have a cap set in OpenRouter, so I'm less worried about setting a cap software-side for now."*
  - **Except that cap cannot see live conversation**, which bills a separate `OPENAI_API_KEY`
    direct from the browser. The fix is a cap in the OpenAI dashboard — Greg's action, not code.
- **Meter live conversation, on browser-reported usage.** *"I thought we had discussed this, and
  concluded that it was a nuisance to do it properly-properly serverside, and that we had actually
  done this, but based for now on browser report (which is unreliable, because the user could mess
  with it, but good enough for a v1)."*
- **Report credits and cash.** Credits stay the stored, reconcilable figure; cash is derived.
- **CLI report plus a spend column on `/admin/users`.** No per-article cost on the metadata page.

**A correction that matters, because a plan is read as a record.** The live-conversation metering
was *decided and reviewed* on 2026-08-31 — [realtime-voice-cost-tracking.md](realtime-voice-cost-tracking.md),
headed "Status: decided, not built" — and reaching exactly the conclusion Greg remembers. It was
never built: a repo-wide grep for `realtime_sessions|realtime-spend|usageSource` returns one hit, in
prose. This is [silent-success.md](../reusable/silent-success.md) at the scale of a workstream — a
decision read back later as if it had shipped. The plan is a good design and this job builds from
it; it is not existing code.

## The findings

Marked by how they are known. Everything below was re-checked against the code at today's line
numbers rather than taken from a subagent's report.

### Tier 0 — the numbers are wrong right now

**0.1 A double-count trap aimed at the billing query.** *Proved from the code and measured.*
[`drizzle/0023`](../../drizzle/0023_ai_calls_cost_provenance.sql)'s CHECK makes `credits_used_nanos`
and `computed_cost_nanos` mutually exclusive, and says why: *"a SUM over both would double-count."*
But **`upstream_inference_nanos` is outside that constraint**, and
[`src/ai-call.ts:587`](../../src/ai-call.ts) sets it on every chat-wire call, BYOK or not. 29 of 29
non-BYOK rows carry it equal to `credits_used_nanos`. The rule that makes a total correct — add
`upstream` only when `is_byok` — lives **only in JS**, in `totalRows()`
([`src/store/ai-calls.ts:73`](../../src/store/ai-calls.ts)). An auditor writing the obvious SQL got
$23.54 where the truth was $11.77. The next thing anyone writes against this table is a
per-owner-per-month aggregate in SQL, for Stripe.

**0.2 The test suite writes real rows into the dev Postgres ledger.** *Measured.* 3888 of 3924 rows
are `test-chat-route-fixture` / `test-remember-route-fixture` / `test-candidates-route-fixture`.
The **filesystem** store already separates them — `_ai-calls.test.jsonl`, keyed on `NODE_ENV`
([`src/store/ai-calls-fs.ts:65`](../../src/store/ai-calls-fs.ts)), with a comment about this exact
accident and how it was found. `ai-calls-pg.ts` has no equivalent: `grep NODE_ENV` returns nothing.
So every count, every `By owner` and `By article` line is meaningless, and the permanent "3872 calls
reported no cost" warning masks the one signal that would show a real unpriced problem. A
copy-paste sibling that carried the documented half of a contract and dropped the undocumented half
— the shape [improve-the-codebase.md](../reusable/improve-the-codebase.md) predicts.

**0.3 Two disjoint ledgers, and the default reads the one production never writes.** *Reproduced.*
`SPIDERYARN_STORE` defaults to `files`. Bare `npm run cost` reported **$28.67 / 565 calls** from
`data/_ai-calls.jsonl`; `SPIDERYARN_STORE=postgres npm run cost` reported **$2.54 / 3924 calls**
from Postgres. Neither run says the other store exists. `--reconcile` compares only whichever is
live, and reported our $0.66 against OpenRouter's $4.11 for the month — a gap that cannot be driven
to zero, which is what makes reconciliation a check rather than a ritual.

### Tier 1 — cheap, mechanical, evidence in hand

**1.1 `web_searches` is null on 100% of 3908 rows, guarded by a false comment.** *Proved.*
[`src/ai-call.ts:651`](../../src/ai-call.ts) hard-codes it null: *"no caller here uses a server-side
web search."* Four callers do. And the parser is not merely available — it is **already called on
those very calls**: `whereSearchCountCameFrom` runs at
[`src/explain.ts:576`](../../src/explain.ts) and
[`src/referee-criteria-run.ts:613`](../../src/referee-criteria-run.ts) for their own purposes, while
the ledger row for the same call stores `null`. The number is computed and discarded at the ledger
boundary. Per-result search billing is inside `usage.cost`, so the money is right and the
attribution is absent.

**1.2 Unpriced rows are counted as free in every breakdown.** *Proved.* `by()` in
[`scripts/ai-cost.ts:113`](../../scripts/ai-cost.ts) discards the unpriced count, so a day, job,
model, article or owner line cannot show it. Only the top-level "short by an unknown amount"
survives. 16 of 329 product calls.

**1.3 `jobSpend()` drops `computed`.** *Proved.* [`src/jobs.ts:754`](../../src/jobs.ts) —
`aiCostNanos: credits + upstream`. Zero today because computed is eval-only, and a latent
under-report on the single line that says what an ingest cost.

**1.4 The register claims more completeness than it has.** *Proved.* `evals/live/*.mts` (which also
calls `/v1/audio/speech`) and `scripts/run-codex.ts` spend real money and are in neither
`DECLARATIONS` nor printed by `npm run cost` — they sit in the ALLOWED map, which prints nothing.
`OPENAI_API_KEY` is required by [`src/live.ts:522`](../../src/live.ts) but is in neither
`.env.example` nor the health report's EXPECTED list: the one credential whose spend nothing can see
is also the one nothing documents. And [ai-gateway.md](../project/ai-gateway.md)'s "thirteen call
sites" is 20 in `src/`.

### Tier 2 — the hole

**2.1 Live conversation writes no rows at all.** *Proved.* `gpt-realtime-2.1` plus a separately
billed `gpt-live-transcribe`; audio in **$32/Mtok**, audio out **$64/Mtok**. Roughly
**$0.06–$0.11/min cached, $0.18–$0.46/min uncached**, and
[`src/live.ts:591`](../../src/live.ts) notes the article is re-sent per session with the cache
belonging to the session — so hang-up-and-restart pays full uncached price again, pushing real use
toward the upper band. At the 20-minute browser cap that is **$1.20–$9 a session**, with no limit
on sessions. For scale, a whole default article ingest is **$0.52**.

The browser already receives the numbers and drops them:
[`useLiveConversation.ts:724`](../../src/web/live/useLiveConversation.ts) handles `response.done` and
reads only `output` for function calls. Input transcription is billed separately and arrives on
`conversation.item.input_audio_transcription.completed`, so a `response.done`-only meter still
misses a cost line.

### Tier 3 — the reporting cannot answer the question

**3.1 No SQL aggregate exists anywhere.** `CostStore.read(since, until)` fetches every row in a
window and sums in JS. Fine at 4k rows, not at 400k, and Stripe will want this monthly.
**3.2 No owner filter, no name.** No `--owner` flag; raw UUIDs with no join to `auth.users`, and
accounts come from the Supabase Auth service over HTTP
([`src/store/admin-accounts.ts`](../../src/store/admin-accounts.ts)), not a table — so it is not a
single SQL join.
**3.3 No cost categories — and `scope_kind` is not the split it looks like.** *Proved; this
corrects an earlier draft of this plan.* A reader asking for an optional stage does it with
`POST /api/jobs { slug, steps: ["glossary"] }` ([`src/routes.ts:5710`](../../src/routes.ts)), which
creates a **job** and is recorded as `scope_kind: "job_step"`
([`src/jobs.ts:580`](../../src/jobs.ts)). So reader-triggered enrichment is indistinguishable from
base ingest by scope. The categories have to be derived from the job and step name. GPT Sol caught
this, 2026-09-02.
**3.4 No cost anywhere in the UI.** `/admin/users` shows counts and dates
([`src/web/admin-columns.tsx:67`](../../src/web/admin-columns.tsx)); `src/admin.ts` never mentions
`ai_calls`.
**3.5 No article has ever been fully ingested in either ledger.** Every job is a dev re-run of one
or two steps; the most complete covers 6 of 13 steps for $0.909. A full ingest is *extrapolated* at
$1.50–$3. **We do not have the number this whole job exists to produce.**

## The pricing-structure finding

[`src/pipeline.ts:235`](../../src/pipeline.ts) `DEFAULT_INGEST_STEPS` is five steps — fetch,
extract, blocks, hierarchy, assets — of which only `hierarchy` buys a model call (~$0.52). The other
eight in `STEP_ORDER` are deliberately off the default, each with a comment saying *"it costs a model
call"*, and are triggered on demand. Add chat, explain, search, quiz-mark, referee, dictation,
embeddings and live conversation, all reader-triggered.

**So an article's cost is not fixed at upload; the driver is engagement, not uploads.** A reader who
uploads three articles and talks to them for an hour costs far more than one who uploads fifty and
reads them plainly. That is worth deciding deliberately rather than inheriting, and it is a product
call for Greg once Stage 4 has produced real numbers.

## Stages

Each ends green, committable and deployable.

### Stage 1 — make the existing numbers trustworthy

Nothing downstream is worth computing until this lands, and Stripe is being built against this table
now. Sol's framing, worth keeping: *"the individual OpenRouter `usage.cost` values are not wrong.
The current aggregate is wrong because its population and total expression are wrong."*

- **0.1, the double-count trap — normalise the row, don't paper over it.** Sol picked option (b)
  over a view: write `upstream_inference_nanos` only on BYOK rows, null it elsewhere, backfill the
  existing non-BYOK values to null, and add a CHECK that it is null unless
  `cost_source = 'provider' AND is_byok AND provider_account = 'openrouter'`. **Rename it
  `byok_upstream_nanos`** while the schema is young, so the name carries the condition. Then the
  obvious sum is simply correct:
  `COALESCE(credits,0) + COALESCE(byok_upstream,0) + COALESCE(computed,0)`. A view *"encodes the
  conditional but preserves misleading raw data"*, and is bypassable.
- **0.2, test pollution — reuse the answer that already exists.** Under the test harness, make the
  selected `costStore` write to the disposable filesystem test ledger even when the app store is
  Postgres. Keep focused `pgCostStore` tests against Postgres with explicit cleanup. Sol rejected
  `is_test`, a synthetic `scope_kind`, and refusing writes (which would stop route tests exercising
  the metering lifecycle at all). **Deleting the 3,888 existing fixture rows needs Greg's yes** —
  local dev DB, but still a delete of data this job did not create.
- **0.3, two ledgers — declare Postgres authoritative for pricing.** Either import legitimate
  filesystem history once or set a clean measurement cutoff. Sol: *"do not build a permanent union
  of two ledgers."* Every report says which store it read.
- **1.1 `web_searches`, 1.2 unpriced per breakdown, 1.3 `jobSpend`, 1.4 the register and
  `OPENAI_API_KEY`** — small, known, same pass.
- **1.2 is a rule, not a field:** every breakdown line shows its unpriced count. Sol: *"'chat:
  $4.20, 16 calls unpriced' is useful; 'chat: $4.20' is false precision."*
- **On the computed fallback (1.2's tempting over-reach):** widen it only where the row carries
  enough billable fact — real token detail, a known route and price. **Not** pricing an unknown
  OpenRouter route from `ANTHROPIC_PRICES`, not inferring output tokens from duration, not calling a
  no-usage call free. Where a row is genuinely unpriceable, `none` remains the honest answer.
- A red test first for each, per [silent-success.md](../reusable/silent-success.md). For 0.1 that
  means computing a total the wrong way and watching the constraint catch it.

**Done:** `npm test`, `npm run typecheck`, `npm run check` green. `npm run cost` prints numbers that
are correct and labelled with the store they came from, and the fixture rows are gone.

### Stage 2 — meter live conversation

Built from [realtime-voice-cost-tracking.md](realtime-voice-cost-tracking.md), but **slimmer than
that plan specifies** — GPT Sol's call, 2026-09-02: *"The full design is appropriate for invoices,
overages, quotas, or customer-visible usage statements. For an alpha pricing estimate, IndexedDB
persistence and ack recovery are excessive."*

**Keep** a minimal `realtime_sessions` row, created when the client secret is minted. It is cheap
and buys four things the stateless version cannot: a **denominator** (sessions that reported nothing
stay visible), server-owned owner/article/model/price-version/start-time, a wall-clock bound to
sanity-check reports against, and an id to group `ai_calls.run_id` by.

**Cut, for now:** the IndexedDB outbox, ack-based retry, and the `usageSource` column — added later,
with a deterministic backfill of earlier rows as `client_report`, on the day a sideband exists.
Also cut: a separate `src/realtime-spend.ts` module. The authenticated endpoint *is* the seam until
extraction earns its keep — a module with one caller is machinery, not cleanup.

- Widen `Wire`, `ProviderAccount`, `AiJob`.
- Post every `response.done` and every completed input-transcription event immediately; small
  in-memory retry queue while the tab lives; `keepalive`/`sendBeacon` on teardown as a hint only.
  Session close is best-effort.
- **The usage projection is a discriminated union — token detail *or* seconds.** Sol's correction:
  OpenAI's transcription events permit duration-based usage and `gpt-live-transcribe` is billed
  **per audio minute**, so "token counts only" would have failed to price half the feature.
- **Never a client-supplied dollar amount.** The server prices it, from a price version it owns.
- Idempotency on the provider's own response/event ids.
- Validation, rejecting rather than clamping: session belongs to the authenticated owner and has not
  expired; ids non-empty and bounded; counts non-negative safe integers; detail counts not exceeding
  their parents; per-response input within the model context and output within the configured max;
  transcription duration within session wall-clock plus tolerance. **Not** a cumulative
  tokens-per-minute ceiling — realtime rebills conversation context on later turns, so cumulative
  input legitimately outgrows wall-clock.
- Prices for `gpt-realtime-2.1` and `gpt-live-transcribe` into `src/pricing.ts`, effective-dated.
- Retire the ALLOWED-list entry and `liveConversationGap()`.

**Done:** a real live session in a browser produces rows, and `npm run cost` shows live spend
alongside everything else.

**Known loss, accepted:** the final turn can vanish on a crash or instant tab close, and a partially
reported session does not say how many turns are missing. The aggregate is biased low by a probably
small unknown. Sol: *"Add the durable outbox before usage affects an allowance, an invoice, or a
promise made to users."*

### Stage 3 — a report that answers the pricing question

Sol rewrote most of this. A total is not an answer; a **distribution** is.

- **Five derived cost categories**, since `scope_kind` cannot give them (3.3): base upload (paid
  default-ingest steps), on-demand enrichment (optional pipeline steps), interactive text and search
  (request-scoped), voice (realtime plus transcription), and non-product (eval and dev CLI).
- **A coverage header**: which store is authoritative, which credential, settled/computed/unpriced
  counts, the reconciliation gap, and realtime sessions that reported nothing. Without it every
  figure below is unfalsifiable.
- **Per-owner cost for an arbitrary half-open `[start, end)` period**, not a calendar month —
  Stripe billing periods are not months.
- **Mean, median, p90, p95 and max**, per category. A mean alone will price for a customer who does
  not exist.
- **Unit costs**: cold default upload, one enrichment stage, one interactive turn, one voice minute
  and one voice session.
- **A scenario table** — light, expected, heavy, pathological — with gross margin at candidate
  prices.
- **Cash beside credits**, allocated in the report. Settled row costs are never rewritten.
- Postgres-specific `GROUP BY`. Sol: do **not** widen `CostStore` to preserve filesystem parity for
  a query whose source of truth is Postgres.
- A spend column on `/admin/users`. *Sol would cut this*; Greg asked for it explicitly and it is
  cheap, so it stays — but it is the last item and the first to drop.

**Done:** one command answers "what did each owner cost over this period, by category, with the
spread" — and says how much of itself it could not see.

### Stage 4 — measure, and write the numbers down

The deliverable Greg actually asked for. Sol: one "full pipeline article" is *"insufficient and
somewhat artificial"*, and an all-steps run is an upper bound, not "the ingest cost".

- **Three article shapes**, each measured cold: a short HTML article, a long HTML article, a PDF.
- **Base upload measured separately from an engaged-reader journey**, because they are different
  products economically.
- One live conversation session, driven in a browser, measured end to end.
- A table of unit costs, and the scenario table populated with real numbers.

**Costs real money** — order $5–15 across all of it, most of it the voice session. Flagged rather
than slipped in.

**Done:** this doc carries measured numbers, and Greg can set a price against them.

## The simpler option passed over

**Do only Stage 4 — measure what we have and price off that.** Rejected: 0.2 and 0.3 mean the
numbers currently in the ledger cannot be read, and 2.1 means the most expensive feature contributes
zero. Measuring on top of that produces a confident wrong answer, which is worse for a pricing
decision than no answer.

**Do only Stages 1 and 4, skipping live metering.** Tempting, and rejected because a live minute can
cost most of an article and a session can cost twenty. Any allowance set without that number is set
blind on the largest term.

## Scope — what this job does not look at

Spend caps, quotas and reservations (Greg's call above). Stripe itself. The `evals/` spend, beyond
naming it honestly in the register. Anything about *reducing* cost — prompt-cache tuning, cheaper
models, fewer stages — which is a separate job that this one produces the evidence for.

## What the Stripe agent needs to know

Handed over rather than discovered later. All from GPT Sol, 2026-09-02.

- **`ai_calls` is COGS attribution, not a customer billing ledger.** A fixed subscription invoice
  reconciles against Stripe subscription state. Do not derive invoices from model calls.
- **Billing periods are not calendar months.** Every query must take an arbitrary half-open
  `[period_start, period_end)`.
- **The denominator comes from subscriptions, not from this table.** `ai_calls` cannot show a
  subscriber who spent nothing, so an average over ledger owners is biased upward.
- **Event time and insert time must stay distinct** — a late client report can cross a period
  boundary.
- **`owner_id` is `ON DELETE RESTRICT`**, deliberately, so billing history survives. Customer
  deletion will force that policy question sooner than expected.
- **An advertised allowance with no enforcement is unlimited.** Caps are out of scope here; before
  real users, voice either gets excluded, labelled limited-beta/fair-use, or enforced.
- **Raw tokens are a poor customer-facing unit.** Audio, cached audio, text, search and
  transcription tokens have radically different economics and mean nothing to a reader. **Voice
  minutes** are a far better product unit if an allowance is needed.

## The thing that may matter more than any of this

Sol's closing point, and it is a product call for Greg rather than an engineering one:

> run a quality bake-off against `gpt-realtime-2.1-mini` before freezing the plan. Its published
> audio rates are $10 input and $20 output per million, versus $32/$64 for the current model. If the
> reading conversation remains good enough, that product choice will move the price more than most
> ledger refinements.

That is roughly a **3x cut** on the most expensive thing the app does. Not in this job's scope, and
named here so it is not lost. Its pricing figures come from Sol's web access and are **unverified in
this repo** — check them before acting.

Sol's own recommendation on the model, for the record: *"price the core text-reading subscription
from base upload plus engaged-text p95, and treat voice as a separate explicit allowance or beta
feature. 'N articles per month' can remain a secondary abuse boundary, but it should not be the
headline economic model."*

## See also

- [ai-gateway.md](../project/ai-gateway.md) — the two seams, and the four things that fail silently
- [260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md) — the original design
- [realtime-voice-cost-tracking.md](realtime-voice-cost-tracking.md) — the live-conversation design,
  decided and unbuilt
- [live-conversation.md](../project/live-conversation.md) — the feature itself
