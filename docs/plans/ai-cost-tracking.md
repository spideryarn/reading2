# AI cost tracking — what every model call costs, and who it cost it for

**Status: plan, not built.** Written 2026-08-27.

Greg, 2026-08-27, on why:

> For my tracking, so I can estimate costs and set pricing. Also so we can define a spend limit per
> user.

That second sentence is the one that shapes the schema. A number that only answers *"what did this
month cost me"* is a different table from one that answers *"what did this month cost me **for that
person**"*, and the difference has to be designed in on the first day, because a call that has
already happened without an owner on it can never be attributed afterwards.

Nothing about spend limits is built here. What is built is the record they would have to read.

## What exists today

Two things, and the gap between them is the whole of this work.

**The numbers are computed.** Every model call in this app already has its token counts in hand.
Seven pipeline stages read `message.usage` off the Anthropic SDK; three request-path calls read
`usage` off OpenRouter's stream; embeddings read a dollar figure OpenRouter hands back directly.

**The numbers are then logged and dropped.** [`src/pipeline.ts`](../../src/pipeline.ts) writes one
line per *step* carrying `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
`cacheWriteTokens` and `ms`. That line is the only durable trace, and on Vercel it is durable for
one day ([logging.md § Vercel](../project/logging.md)). Ask in November what August cost and there
is no answer and never will be.

There is a table waiting for them. [`src/db/schema.ts`](../../src/db/schema.ts) declares `ai_calls`,
borrowed from the old app, with `purpose`, `provider`, `model`, `promptTokens`, `completionTokens`,
`costMicros`, `latencyMs`, `finishReason`, `error`, `rawResponse`. **Nothing writes a single row to
it.** GPT Sol said so during the semantic-search review and it is still true:

> `ai_calls` does not get its first writer here. It is a table nothing writes.

### This reverses a decision, and the reversal should be said out loud

[logging.md § What we left](../project/logging.md) lists the old app's `ai_calls` table under
things deliberately **not** copied, with two reasons:

> **The Postgres table.** It bought queryability nobody used and dragged in a two-phase write, a
> service class, a policing lint rule, a verification script and four migrations. Our job records
> already have the shape.

> **Cost estimates.** […] We log token counts, which are facts, and leave cost to whoever is doing
> the arithmetic.

Both were right at the time and one of them is still right. "Queryability nobody used" was a fair
description of an app with one user and no bill to split. It stops being fair the moment somebody
wants to set a price and cap a stranger's spending, which is what changed on 2026-08-27.

The second — *leave cost to whoever is doing the arithmetic* — is the part worth keeping in spirit
and reversing in fact. The reason it was written is the old app's actual bug: a hardcoded
`totalTokens * 0.000003`, model-agnostic, multiplying *total* tokens by an input rate. Wrong by
construction and confidently printed. The lesson from that is **not** "never compute cost". It is
"a cost figure with no model, no date and no source is worse than no figure at all". So everything
below stores the tokens *and* the price it used *and* where the price came from, and can be
recomputed from the tokens if the price turns out to have been wrong.

## The three facts that decide the design

### 1. A step is not a call

[`src/pipeline.ts`](../../src/pipeline.ts) logs once per step. But `labels` runs its batches **in
parallel**, `summarise` batches per parent and retries once with the parse error fed back, and
`glossary` and `ideas` fan out the same way. The per-step number is a sum over many calls, and the
retries are in the sum too.

So one row per *call* cannot be written at the pipeline seam. It has to be written where the call
is.

**Which is not the same as twelve call sites each remembering to record.** The first version of
this plan proposed exactly that, plus a grep-based test to catch a forgotten thirteenth, and GPT
Sol was right that the test is the weak part: a new provider, a changed URL, or a different SDK
method all walk straight past a grep. The replacement is **three gateway modules** —

```
  7 Anthropic stages ─┐
                      ├─► src/ai/anthropic.ts   ─┐
  4 OpenRouter chat ──┼─► src/ai/openrouter.ts  ─┼─► one recorder ─► ai_calls
  1 embeddings     ───┴─► (JSON, same module)   ─┘
```

— with one rule enforced by a test: **nothing outside `src/ai/` may import `@anthropic-ai/sdk` or
name an OpenRouter URL.** That is greppable in a way that "did you remember to record" is not,
because it fails on the *import*, which a new call site cannot avoid writing.

It also fits [architecture.md § Stage ownership](../project/architecture.md#stage-ownership)
better than editing twelve stages would. The gateway owns timing, usage extraction, status, raw
capture and recording; a stage hands it metadata and consumes the stream, exactly as stages already
hand `article-prompt.ts` their prompt rather than assembling one.

Pilot one of each *transport* rather than one stage — an Anthropic stream, an OpenRouter SSE
stream, an OpenRouter JSON call, and embeddings — because those are the four shapes that can differ,
and `toc` alone would prove only the first.

This cuts against [logging.md](../project/logging.md)'s rule — *log at the seam the queue already
owns, not inside another agent's stage* — and it should: that rule is about **logging**, which is
per-step by nature, and it stays exactly as it is. Nothing below removes or changes a single
existing log line. The per-call record is a second, different thing that happens to read the same
numbers.

### 2. Anthropic and OpenRouter disagree about what "input tokens" means

This is the one that will silently produce a wrong bill, so it goes near the top.

On **OpenRouter**, `prompt_tokens` *includes* the cached tokens. The fresh tokens are what is left
after subtracting.

**Measured against OpenRouter's own reported charge, 2026-08-27**, with two identical ~18k-token
calls a few seconds apart:

```
              prompt_tokens  cached  cache_write  completion   OpenRouter's OWN cost
  cold           18224          0      18212          4          $0.045594
  warm           18224      18212          0          4          $0.0037064

  hypothesis A — prompt_tokens INCLUDES cached, so subtract:
      cold  (18224-0-18212)x$2 + 18212x$2.50 + 0x$0.20 + 4x$10  (per Mtok) = $0.04559400  ✓ exact
      warm  (18224-18212-0)x$2 + 0x$2.50 + 18212x$0.20 + 4x$10             = $0.00370640  ✓ exact

  hypothesis B — prompt_tokens EXCLUDES cached, so add:
      cold                                                       = $0.08201800  ✗ off by 1.8x
      warm                                                       = $0.04013040  ✗ off by 10.8x
```

Eight decimal places on both calls. That also confirms the price table to the cent — $2/$10 per
million, cache write x1.25, cache read x0.1 — against real billing rather than against a docs page.

**A note on how nearly this went wrong.** The first version of this section claimed the same thing
"verified" against
[evals/results/prompt-caching-constitution.md](../../evals/results/prompt-caching-constitution.md).
That was circular: the `cost` column in that file is computed by the eval's own `costs()` function,
which subtracts — so my arithmetic agreeing with it proved only that I had re-derived the same
function. It was not evidence about OpenRouter at all, and it looked exactly like evidence. Hence
the probe above, which compares against a number OpenRouter sent rather than one we produced.

On the **Anthropic SDK** the opposite holds, and this is now confirmed against
[Anthropic's own caching docs](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching)
by the research pass: `usage.input_tokens` counts the tokens **after the last cache breakpoint
only**. The three figures are disjoint and you *add* them:

```
total input  =  input_tokens + cache_read_input_tokens + cache_creation_input_tokens
```

Summing `input_tokens` alone under-counts every cached call.

Anthropic also now splits the cache write by TTL, and the two are priced differently:

```json
"usage": {
  "input_tokens": 1024,
  "output_tokens": 350,
  "cache_creation_input_tokens": 248,        // the sum, kept for compatibility
  "cache_read_input_tokens": 0,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 148,        // x1.25
    "ephemeral_1h_input_tokens": 100         // x2.0
  }
}
```

Cache read is x0.1. This app only uses the 5-minute default today, so the flat
`cache_creation_input_tokens` would be enough — but reading the breakdown costs nothing and means
the day somebody reaches for a 1-hour cache is not also the day the bill quietly goes 60% wrong.

Seven of the twelve call sites are on the SDK and five are on OpenRouter. **A single shared
`cost(tokens)` helper would therefore be wrong for one of those groups, by roughly the size of the
cache — which here is about 95% of the prompt.** It would be wrong quietly, in the direction of
"looks plausible". This is [silent success](../reusable/silent-success.md) with a currency symbol
on it.

Hence: two priced shapes, named for the wire format they came off, and no function that takes a
bare "input tokens" number without knowing which.

### 3. The owner is already in scope everywhere, and that is lucky

Per-user attribution turns out to be free. [`src/owner.ts`](../../src/owner.ts) keeps the owner in
an `AsyncLocalStorage`, and every path that reaches a model call is inside one:

- **request path** — `handleApi` opens the scope and the gate fills it.
- **local pump** — [`src/jobs.ts:509`](../../src/jobs.ts) `pump()` calls
  `runAsOwner(owner, …)` around the whole advance loop, deliberately, because *"with concurrency 1,
  the whole of Bob's job ran in Alice's context"* was measured rather than guessed.
- **on Vercel** — the pump does not run (`if (process.env.VERCEL) return`); jobs are advanced from
  an API route, so they are inside `runInRequest` with the gate's owner.
- **bare CLI** — no scope, and `currentOwnerId()` falls back to `SPIDERYARN_OWNER_ID`.

So `currentOwnerId()` answers correctly at all twelve sites without threading a single new argument.

## What changes in the schema

### `owner_id` has to go on `ai_calls`, and [`src/owner.ts`](../../src/owner.ts)'s comment is wrong about this one

That file currently lists `ai_calls` among the tables that deliberately do **not** carry an owner:

> each belongs to a row that does (an article, a revision, a thread), and carrying the owner twice
> is a second copy to disagree with the first.

Good rule, wrong table. Two reasons:

1. **`article_id` is `on delete set null`.** Delete an article and its cost rows keep their money
   and lose their person — permanently, and without erroring. A billing record that a delete can
   silently orphan is not a billing record.
2. **Not every call has an article.** Library search and an ordinary chat with no article open have
   nothing to hang off.

So `owner_id uuid not null`, and the comment in `owner.ts` gets a sentence saying why this one is
the exception. Open question for Greg below: what happens to a deleted user's spend history.

### The rest of the columns

| column | why |
|---|---|
| `owner_id` | above. **Not null.** Indexed with `created_at` |
| `cache_read_tokens`, `cache_write_tokens` | the only warning that a prompt cache has stopped working ([prompt-caching.md](../project/prompt-caching.md)). Also the difference between $0.01 and $0.12 |
| `cache_write_5m_tokens`, `cache_write_1h_tokens` | priced differently (1.25x and 2x). A flat total cannot be priced correctly if both TTLs are in play |
| `reasoning_tokens` | OpenRouter reports `completion_tokens_details.reasoning_tokens`. Anthropic has no such field — thinking is billed as output tokens — so this is nullable and means "not reported", never "zero" |
| `web_searches` | billed per search ($0.01 on `anthropic/claude-sonnet-5`), and invisible to token arithmetic. `src/openrouter-stream.ts` already counts them |
| `cost_source` | `provider` \| `computed` \| `unpriced`. Which kind of number `cost_nanos` is |
| `is_byok` | OpenRouter reports it. Under somebody's own key `cost` legitimately reads zero while real money is spent, and a row that does not say which arrangement it was under cannot be read correctly later |
| `service_tier` | Anthropic reports it. Batch is **half price**; a computed cost that ignores it is wrong by 2x |
| `inference_geo` | Anthropic reports it. `"us"` is a documented **1.1x on every category** |
| `thinking_tokens` | Inside `output_tokens`, not additional. Not a pricing input — the answer to "did it spend its whole budget thinking" |
| `cost_computed_nanos` | our arithmetic, kept **alongside** the provider's figure — see below |
| `price_version` | which row of the price table was used, so a wrong price is findable and fixable |
| `job_id`, `step_name` | so "what did that ingest cost" is one query |
| `attempt` | a retry is a separate call and separately billed |

### Dollars: nano-dollars in a `bigint`, not micro-dollars in an `integer`

The declared column is `costMicros: integer`. Nothing writes it, so changing it is free today and
awkward later.

Micro-dollars are *probably* fine — the worst rounding is under a micro-dollar per row, and ten
thousand rows of it is a cent. But a single query-embedding call is around $0.0000006, which is
**less than one micro-dollar**, so it rounds to zero and the row reads as free. Nano-dollars in a
`bigint` make the question not exist, and cost one column type. Small call, worth making now.

### The reconciliation, which is the part that keeps the price table honest

Where OpenRouter reports what it actually charged, store **both** its figure and ours.

```
       OpenRouter call                     Anthropic SDK call
       ───────────────                     ──────────────────
  cost_nanos          = provider's    cost_nanos          = ours
  cost_computed_nanos = ours          cost_computed_nanos = ours (same number)
  cost_source         = 'provider'    cost_source         = 'computed'
                │
                └──► the two should agree. When they stop agreeing,
                     OUR PRICE TABLE HAS GONE STALE — and the seven
                     Anthropic-SDK stages, which have no provider
                     figure to check against, are now being priced
                     wrong too, silently.
```

That is the whole argument for storing a redundant number. The five OpenRouter calls are a
continuous test of the price table that the seven Anthropic calls depend on. Without it, a price
change is discovered when somebody notices the bill does not match, which is the same "logged but
never checked" failure this plan exists to avoid.

A drift check belongs in `npm run cost` output, not in an alert nobody wired up.

## Where prices come from

Only one of the two paths needs a price table at all. OpenRouter reports its own charge, so the
table exists for the **seven Anthropic-SDK stages** and for cross-checking the other five.

**Anthropic never returns a cost figure** — token counts only, confirmed in the research pass. So
those seven are priced by arithmetic or not at all. The prices, as of 2026-08-27:

| model | input $/Mtok | output $/Mtok |
|---|---:|---:|
| `claude-sonnet-5` — this app's `CAPABLE_MODEL` | $2.00 | $10.00 |
| `claude-opus-5` | $5.00 | $25.00 |
| `claude-haiku-4-5` | $1.00 | $5.00 |

with cache write x1.25 (5m), x2.0 (1h) and cache read x0.1 against the input price.

### Anthropic returns no cost anywhere — checked, not assumed

Greg, 2026-08-27:

> This billing stuff is tricky to get right. Can we rely on the responses from the API, and/or a
> really reputable library?

Fair challenge, and the first half has a definite answer. A live call to `claude-sonnet-5`,
inspecting **the response body and every response header**:

```
headers:  anthropic-organization-id, anthropic-workspace-id, anthropic-ratelimit-*  (x12),
          cf-ray, content-type, date, request-id, ...
          → nothing mentioning cost, price, billing or charge. Only rate-limit counters.

usage:    { input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
            cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens },
            output_tokens, output_tokens_details: { thinking_tokens },
            service_tier: "standard", inference_geo: "global" }
```

No dollar figure exists to rely on. For the seven direct-SDK calls the arithmetic is unavoidable
*unless we change where the calls go* — which is the real question, and it is below.

**But the response does carry the things that change the price**, which is the part that makes the
arithmetic defensible rather than a guess:

- **`service_tier`** — batch is half price, priority tier is its own rate. A computed cost that
  ignores it is wrong by 2x on any batched call.
- **`inference_geo`** — `"us"` carries a documented **1.1x multiplier on every category**, input,
  output, cache writes and reads alike.
- **`output_tokens_details.thinking_tokens`** — thinking is billed as output and is already inside
  `output_tokens`, so this is a breakdown rather than an addition. Recording it is what makes
  "the model spent its whole budget thinking" answerable, which
  [logging.md](../project/logging.md) already names as the question a failed chat turn turns on.

None of the three were in this plan before the probe. All three are columns.

Today all three are constant — nothing in this app sets `service_tier` or `inference_geo`, and the
grep for Batch API use finds only this app's own request batching. So they are recorded because the
*provider said them*, not because we vary them. That is the cheap kind of insurance, and one of the
two is a live temptation rather than a hypothetical: **the Batch API is half price and the pipeline
is exactly the non-latency-sensitive work it exists for** ([logging.md](../project/logging.md) notes
nobody is watching those calls). The day somebody takes that offer, a table reading `service_tier`
stays right on its own, and one that assumed "standard" doubles every pipeline cost silently.

Also worth having: `anthropic-organization-id` and `anthropic-workspace-id` come back on every
response, and the Cost API below groups by workspace. That is the join key for reconciliation, free
on every call.

### The near-miss that made these prices effective-dated

GPT Sol's review opened with a blocker: Sonnet 5 was about to go from $2/$10 to $3/$15 on
2026-09-01, five days out, which would put every direct-SDK cost a third under the bill.

Checked against
[Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing), and the
finding is **half right in the way that matters**. There genuinely was such an increase scheduled —
Sol had not invented it. It is also not going to happen:

> The $2/$10 per million input/output token pricing for Claude Sonnet 5, announced at launch as
> introductory pricing through August 31, 2026, is now the standard price. **The previously
> scheduled increase to $3/$15 per million input/output tokens on September 1, 2026 will not
> occur.**

So the table above stands. But a price change was scheduled, dated, and cancelled *inside the week
this plan was written*, which is a better argument for effective-dating than any I would have
constructed. **Prices get a `from` date and the table is a list of rows, not a single row per
model.**

Snapshot-at-call-time already handles a price change for calls made *after* someone edits the
table. What it cannot handle is the gap between the change and the edit: a rate that changes at
midnight UTC and a deploy at nine in the morning is nine hours of calls priced wrong and
permanently so, because the snapshot is what gets billed from. Effective dates let the new row be
committed *before* the boundary, so the switch happens on time whether or not anybody is awake.

That needs `call_started_at` on the row — the price is a property of when the call happened, not of
when it was recorded — and a test that pins the boundary in UTC.

### Anthropic will tell us the dollars — just not per call, and not with this key

The Messages API returns no cost. Anthropic's **Admin Cost API** does. Both endpoints exist and were
probed live on 2026-08-27:

```
GET /v1/organizations/cost_report              → 401 authentication_error, "invalid x-api-key"
GET /v1/organizations/usage_report/messages    → 401 authentication_error, "invalid x-api-key"
```

A 401 with a structured error body rather than a 404 is the endpoints confirming they are there. The
401 is because **`.env.local` holds `sk-ant-api…`, an ordinary key, and these need `sk-ant-admin…`**
— a separate Admin API key created in the Console. So this route is open to us but **not switched
on**, and that is a thing for Greg rather than a thing to build around. It is the first item in the
questions below.

Why it matters more than it sounds: it turns the arithmetic from something we assert into something
we **check**. Per-call cost stays computed — the Cost API has no per-request dimension and cannot
attribute to one of Greg's readers — but "our total for 2026-08-26" versus "Anthropic's own reported
cost for 2026-08-26" is a daily reconciliation, and a price table that has gone stale, a
`service_tier` we forgot to read, or a cache formula that silently flipped all show up as a gap the
next morning.

That is the honest answer to *can we rely on the responses*: **not for the dollars, but yes for a
daily ground truth that stops our dollars drifting.** The report is the thing that would tell us,
and `npm run cost` should print the two totals side by side rather than only ours.

⟨Granularity, freshness, retention and whether the buckets line up with our timestamps are with the
research pass — `docs/research/ai-cost-authoritative-sources.md`.⟩

### What the table deliberately does not cover

Only `claude-sonnet-5` is reachable on both wires, so **it is the only model the reconciliation
below actually cross-checks.** The PDF reader is on Luna and embeddings are on Voyage, both
OpenRouter-only, both carrying their own cost and neither priced here. That is by design and not a
gap — but it does mean the price table's continuous test covers one row of three, which is worth
knowing before trusting the drift check to catch everything.

### The option that would delete the arithmetic entirely

Worth stating plainly because it is the real answer to Greg's question, and the plan had not
considered it: **if all twelve call sites went through OpenRouter, every call would carry a
provider-reported `usage.cost` and there would be no price table and no cache arithmetic at all.**

Two of the three things that would sink that idea are already measured here, and neither sinks it:

- **Anthropic prompt caching works through OpenRouter.** The probe above is the evidence — a
  `cache_control: {type: "ephemeral"}` breakpoint produced `cache_write_tokens: 18212` cold and
  `cached_tokens: 18212` warm, priced at the 1.25x and 0.1x rates. This is not a thing that has to
  be given up.
- **OpenRouter took no per-token margin on either probe.** 18 prompt tokens billed at exactly
  $0.000036 — Anthropic's list price to the digit — and `cost` equal to `upstream_inference_cost`
  on both the chat and the embeddings call.

What it would cost is Anthropic-native surface this app actually uses: the SDK's typed errors
(which [`src/anthropic-call.ts`](../../src/anthropic-call.ts) is built on), `stop_reason: "refusal"`
and `stop_details`, `thinking: {type: "adaptive"}` and `effort`, and `finalMessage()`. Plus a second
hop in front of every pipeline stage, and a single vendor in front of both halves of the app rather
than one.

**Verdict: no — but not for the reason the research gave.**

The research pass argued that prompt caching over OpenRouter depends on sticky routing via
`session_id`, which this app does not send, so moving traffic there risks a silent cache-hit
regression. That objection does not survive contact with the code.
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) has already been here:

> Ordered, **not** `allow_fallbacks: false`. A cache lives on the upstream that wrote it, so naming
> Anthropic first is what keeps repeat calls landing where the article already is — and OpenRouter's
> own sticky routing hashes the first user message, which varies here, so the heuristic would miss
> exactly the case this is for.

`PROVIDER_ORDER` is the answer to that problem and is a *better* one than `session_id` for this
workload, chosen deliberately and written down. My own probe agrees: a cold write and a warm read
three seconds apart, no `session_id`, 18,212 tokens read from cache.

The real reasons are the other two, and they are enough:

- **Feature loss, all of it load-bearing.** The SDK's typed errors are what
  [`src/anthropic-call.ts`](../../src/anthropic-call.ts) is built on, and its whole point is that an
  upstream error body carrying the article must not reach a reader; `stop_reason: "refusal"` and
  `stop_details` likewise. `effort` and adaptive thinking reach OpenRouter only through its
  parameter-mapping layer — reachable (`reasoning`, `reasoning_effort` are in its supported
  parameters for this model) but mapped rather than native, and a mapping that silently drops a
  parameter is this project's least favourite failure shape.
- **It buys nothing that is still a problem.** The two-formula cache arithmetic was the thing worth
  avoiding, and it is already written, tested against a real bill, and green. Rerouting seven stages
  through a second vendor to delete a solved problem is paying a real cost for a settled one.

Recorded rather than dismissed, because it is the right question and the answer could change: if
this app ever grows a third provider, the argument for one gateway that reports its own cost gets
much stronger.

One thing the option did surface that matters regardless — **OpenRouter's margin is a 5.5% fee on
buying credits, not a per-token markup.** That is why the probes found `cost` equal to Anthropic's
list price. It also means `usage.cost` is *credits consumed*, and the cash that left the bank is
about 5.5% higher. Which is question 5 below, and no longer hypothetical.

### A table in git, not a package — and the library that proves the point

Greg's question was *"can we rely on … a really reputable library?"* The honest answer turned out to
be sharper than "the field is young".

The strongest candidate is [`@pydantic/genai-prices`](https://github.com/pydantic/genai-prices) —
from the Pydantic team, actively maintained, pushed the day this was written, 359 stars, created
June 2025. Its documented contract for Anthropic cache tokens is correct on paper.

**And it has a field-reported bug of exactly the class this plan exists to prevent.**
[pydantic-ai#4364](https://github.com/pydantic/pydantic-ai/issues/4364), mirrored in Langfuse#12306:
genai-prices sums Anthropic's three input fields into one `input_tokens`, a caller emits that
*alongside* the separate cache fields, and the consumer adds them again. From the issue itself:

> 130213 + 128955 + 1253 = 260421. The real prompt was 130213 tokens.

Roughly **2x**, and the reported consequences are the ones that matter here: cost estimates doubled,
and **cache hit rate reading ~50% when it was ~99%.** That is not a peripheral bug. The cache-hit
number is *the entire alarm system* this plan is built around —
[prompt-caching.md](../project/prompt-caching.md): a cache that stops working returns the right
answer and only costs more. A library that can make a healthy cache look half-broken would be
disabling the smoke detector.

It is **closed as not planned**, so it is a live property rather than a fixed one. And the trigger is
precisely the situation this plan's schema creates: a second layer that also reads
`cache_read_tokens` and `cache_write_tokens`, which ours must, because those are their own columns.

So the decision stands, now on evidence rather than on taste. Three supporting reasons:

1. **We call three models.** The whole table is nine numbers
   ([models.ts](../../src/models.ts) is the closed list). A dependency covering a hundred providers
   carries ninety-seven we will never look up.
2. **Auto-update is a liability here.** It refetches prices from GitHub hourly. For a number
   somebody bills against, a price that changes without review is the problem, not the solution —
   and its own README says the data "cannot be exactly correct".
3. **It does not meet the bar in
   [third-party-library-selection.md](../reusable/third-party-library-selection.md)** — *long-lived
   community, lots of docs and discussion*. Fourteen months old.

`tokenlens` describes its own cost estimation as "fast, rough" and not billing-grade; LiteLLM's
`model_prices_and_context_window.json` is raw data that still needs the same arithmetic written by
hand. **Nothing in this space clears the bar**, and the reason is not immaturity — it is that the
hard part was never the price table. It is the cache accounting, and that is where the one credible
library is demonstrably wrong.

A literal table in [`src/pricing.ts`](../../src/pricing.ts), with the date checked and the URL
checked against, next to the numbers. Revisit if the model list stops being three long.

### The endpoint that gave us the OpenRouter half

`GET https://openrouter.ai/api/v1/models`, fetched live on 2026-08-27, returns 417 models. For
`anthropic/claude-sonnet-5`:

```json
"pricing": {
  "prompt":                "0.000002",
  "completion":            "0.00001",
  "web_search":            "0.01",
  "input_cache_read":      "0.0000002",
  "input_cache_write":     "0.0000025",
  "input_cache_write_1h":  "0.000004"
}
```

USD per single token — `0.000002` is $2 per million, which is confirmed independently by the eval
arithmetic above landing on the committed figure to five decimal places. 251 of the 417 models
carry `input_cache_read`. The full set of pricing keys seen across all models is: `audio`,
`audio_output`, `completion`, `image`, `image_output`, `input_audio_cache`, `input_cache_read`,
`input_cache_write`, `input_cache_write_1h`, `internal_reasoning`, `overrides`, `prompt`,
`web_search`.

**And one hole, found by looking — then found to be a different hole than it looked.**
`voyageai/voyage-4`, this app's embedding model, returns **zero matches** in that endpoint. First
reading: the model is simply absent, so a scraped price table reports every embedding call as free.

Second reading, and the correct one: **embedding models are in a different catalog.**
`GET /api/v1/embeddings/models` returns 33 of them, and voyage-4 is there —
`{"prompt": "0.00000006"}`, i.e. $0.06/Mtok, matching this repo's own committed embedding eval
figures. Verified live, 2026-08-27.

Which makes the lesson sharper rather than weaker. The danger was never "the model does not exist".
It was **that we looked in the one catalog we knew about, found nothing, and a zero would have been
indistinguishable from an answer.** A scrape of `/api/v1/models` alone still produces exactly the
silent failure described — it just does so while the price sits in plain sight one endpoint over.

It does not matter much in the end, because embeddings are the one call that already gets a real
dollar figure back: [`src/embeddings.ts`](../../src/embeddings.ts) reads
`usage.cost_details.upstream_inference_cost`. But it decides the rule:

> **A model with no price is an error, not a zero.** The price lookup returns "no price for this
> model" as a distinct answer, the row is written with `cost_nanos = null` and `cost_source =
> 'unpriced'`, and `npm run cost` prints the unpriced count on its own line. A missing price must
> never be able to look like a cheap call.

### OpenRouter already tells us what it charged — take its number

I expected this to need a flag. It does not. OpenRouter's `usage: { include: true }` **is
deprecated and now a no-op** — usage detail ships on every response automatically — and this app was
never setting it anyway (the flag in the three call sites is `stream_options: { include_usage: true }`,
which is the OpenAI-compatible one and a different thing). So nothing changes at the call site.

What arrives already is:

```json
"usage": {
  "prompt_tokens": 194, "completion_tokens": 2,
  "cost": 0.95,
  "cost_details": { "upstream_inference_cost": 19 },
  "prompt_tokens_details": { "cached_tokens": 0, "cache_write_tokens": 100 },
  "completion_tokens_details": { "reasoning_tokens": 0 }
}
```

**`usage.cost` is what OpenRouter actually charged our account** — the invoice line, not an
estimate, already including whatever markup and routing it applied. For the five OpenRouter call
sites, store it verbatim and do not recompute it. A second number computed from a price table could
only ever disagree with the real bill.

**And nothing in this app has ever read it.** Grepped: `usage.cost` appears at none of
[`src/explain.ts`](../../src/explain.ts), [`src/converse.ts`](../../src/converse.ts),
[`src/search.ts`](../../src/search.ts) or
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts). Those files read `prompt_tokens`,
`completion_tokens` and the two cache counts carefully — the plumbing is all there — and then let
the one field that states the actual charge go past unread. So the gap on the OpenRouter half is not
a flag to send or a request to change: **it is four lines that pick a value off an object the app is
already parsing.** (`stream_options: { include_usage: true }`, which those three do send, is now a
no-op like OpenRouter's own accounting flag — usage ships regardless. Harmless, and its comment
should say so.)

### A bug I thought I had found in embeddings, and did not

Worth keeping, because the reasoning was good and the conclusion was wrong, and the only thing that
separated them was a real call.

The research pass reported that `cost_details.upstream_inference_cost` is **populated for BYOK
requests only**. [`src/embeddings.ts`](../../src/embeddings.ts) reads that field and only that
field. And `voyageai/voyage-4` was chosen precisely *because* it "bills to OpenRouter credits rather
than through BYOK" ([semantic-search.md](semantic-search.md)) — so it is *not* BYOK, so the field
should be absent, so embedding cost should be silently reporting `0` everywhere.

Neat, consistent, and false. One real embeddings call, 2026-08-27:

```json
{ "prompt_tokens": 7, "total_tokens": 7,
  "cost": 4.2e-7,
  "is_byok": false,
  "cost_details": { "upstream_inference_cost": 4.2e-7,
                    "upstream_inference_prompt_cost": 4.2e-7,
                    "upstream_inference_completions_cost": 0 } }
```

`is_byok: false` **and** `upstream_inference_cost` populated. The BYOK-only claim is wrong — or at
least far narrower than stated — and `src/embeddings.ts` is fine as written. Nothing to fix.

Two things to carry forward from it. **`cost` and `upstream_inference_cost` were identical on both
probes**, so on this account OpenRouter is adding no visible markup — which is worth re-checking
occasionally rather than assuming for ever. And `is_byok` is a real field, so it is worth a column:
the day a model is reached through somebody's own key, its `cost` legitimately goes to zero while
real money is still being spent, and a row that does not say which arrangement it was under cannot
be read correctly afterwards.

The research doc has been corrected in place so the wrong claim is not read back later as fact.

## Where the write goes, and the two ways it must not break anything

### It must never break a call

Greg picked **report only** — no caps, no refusals — and the corollary is stronger than it sounds.
From [logging.md](../project/logging.md), on what the old app got wrong:

> **Fatal-on-logging-failure.** Theirs rethrows when the telemetry write fails […] it means a
> Postgres hiccup can take down a user-facing feature. **A metrics write must never kill a model
> call.**

So `recordAiCall` catches everything and returns. The one thing it does on failure is write a
`warn` log line, because a recorder that has silently stopped recording is the same class of bug as
a cache that has silently stopped caching.

### But it must be awaited, and that is the non-obvious half

The instinct is fire-and-forget: don't make the reader wait on a metrics write. **That is wrong on
Vercel.** A serverless function may be frozen the moment its response is sent, and an un-awaited
promise then never runs — so the rows that go missing are exactly the request-path ones, the ones
attributable to a *user*, which is the half Greg actually asked for. Await it, inside the catch.

The cost is a single indexed insert on a pooled connection, after the model call has already
returned. Next to a call that took two seconds, it is not a number worth optimising.

### The `files` / `postgres` mode problem, which is genuinely undecided

[`src/store/index.ts`](../../src/store/index.ts) has a hard rule:

> **No fallback, ever.** Nothing here catches a Postgres error and retries against the filesystem.

That rule exists to stop the two stores diverging where a parity test cannot see it. It does not
obviously apply here, because there is no filesystem implementation of `ai_calls` to diverge *from*
— but the default store mode is still `files`, and a local `npm run toc` with no Supabase running
must not start erroring.

Three options, and this is a question for the review rather than a decision I should make alone:

1. **Follow the store flag.** In `files` mode write nothing. Honest and consistent — and it means
   the default configuration silently records nothing, which is the worst property available.
2. **Always Postgres, degrade to a warn line if there is no `DATABASE_URL`.** Cost tracking is not
   article storage and does not have a second implementation to disagree with. My preference.
3. **A JSONL sidecar in `files` mode.** Works locally, does not work on Vercel (no writable disk),
   so it is two mechanisms of which one is never exercised in production.

## Storing the raw response, and pruning it

Greg chose *always store, with automatic pruning*, over my recommendation of failure-only. Taking
that as decided — with one refinement that I think gets him what he asked for and removes the risk
he named.

**Prune the column, not the row.** Delete `raw_response` from rows older than N days; keep the row
for ever. The money history is what he wants to bill from and it is tiny; the raw response is what
he wants for debugging and it is only useful while fresh. Nulling it out cannot ever be the thing
that loses a cost record.

On size, two numbers, and only one of them is real. The old app's `ai_calls` was **31 MB over 306
rows** — about 100 KB each, dominating its entire database
([postgres-migration.md](postgres-migration.md)). That one is measured. The research pass's estimate
for *our* responses is 10–20 KB for a long generation call and less for a chat answer, and it is
arithmetic from token counts rather than a measurement — so it should not be quoted back as fact.
The honest move is `select pg_size_pretty(pg_total_relation_size('ai_calls'))` after a week of real
traffic, and pick the window from that rather than defending a guess.

**There is no scheduler in this project today.** Checked: no `crons` in `vercel.json`, no `pg_cron`
in `supabase/`, nothing in `scripts/`. [`src/jobs.ts`](../../src/jobs.ts) says so outright — *"There
is no scheduler on Vercel, and inventing one would be a second mechanism to keep alive"* — and
solved its own version of this by sweeping at the top of every advance instead.

There are two honest options and the research pass changed my mind about which wins.

**`pg_cron`, scheduled from a migration.** It is a Postgres extension Supabase enables with a
toggle, so it needs no Vercel scheduler and no new service — it runs *inside the database the rows
are already in*. Scheduled from a migration rather than the dashboard, so the schedule is in git
like everything else. One statement:

```sql
update ai_calls set raw_response = null
where created_at < now() - interval '30 days' and raw_response is not null;
```

**Or an opportunistic prune** inside `recordAiCall`, guarded by a marker row, following the
`failExpired` precedent above.

I had preferred the second, on the grounds that it runs exactly when the table is growing and so
cannot silently stop while the table fills. That argument is real but it buys less than it costs:
it puts a periodic `UPDATE` inside a path a reader is waiting on, to protect a table whose growth is
slow and whose pruning is not urgent. **`pg_cron` is the better call.**

Greg's stated worry about this option was the right one — *"the pruning job failing is silent"* — so
it gets answered directly rather than argued away: **`npm run cost` prints the table size and the
age of the oldest surviving `raw_response`.** A pruner that has stopped then shows up in the report
he already looks at, which is a better detector than the prune-on-write scheme was, because it also
catches a prune that is running and not working.

**The privacy line.** A raw response for `toc`, `glossary` or `summarise` contains model output
derived from the reader's article. In their own database row that is fine. It must never reach a log
line or an error message — and [`src/store/db-errors.ts`](../../src/store/db-errors.ts) exists
because *"a failed Drizzle query puts every bound parameter into `Error.message`"*, which is
precisely this risk. The insert goes through `guardDbStore` like everything else.

## The calls that cost money and produce no usage

A cost table that only records calls that *finished* is a cost table that under-reports, and it
under-reports exactly the calls somebody is complaining about.

**An aborted stream is still billed.** This app aborts deliberately — a reader hitting Stop, a
deadline firing in `embedAll`, `LEASE_MS` expiring on a job. The final `usage` frame may never
arrive, so the honest record is a row with `error` set, `finish_reason` `'aborted'`, and null token
counts, rather than no row at all. **A missing row and a free call must not look the same.**

Which means a single insert *after* a usable response is the wrong lifecycle, and "store the raw
response always" is not even possible under it — there may be no response. The gateway therefore:

- **mints a `call_id` before any network IO**, and records from a `finally`, not a success path;
- stores `status` (`running` | `ok` | `error` | `aborted`), `started_at` and `finished_at`
  separately, so a call that never came back is distinguishable from one that returned nothing;
- keeps unknown usage as **`NULL`, never `0`** — the whole point of the exercise;
- keeps the provider's own request/generation id, which is the only handle on a call afterwards.

The old app had `pending | success | failed` and a correlation id
([llm-plumbing.md](../project/original-version/llm-plumbing.md)); this plan dropped both without
noticing, and the review caught it. They come back.

### An aborted call's cost is a lower bound, and the row has to say so

The uncomfortable half, and it does not have a fix — only an honest label.

Aborting the HTTP connection stops the billing clock **only for providers that support server-side
cancellation.** OpenRouter's list of those includes Anthropic, and this app pins routing to
`anthropic/claude-sonnet-5` rather than routing openly, so we are in the favourable case. That is
luck rather than design: the guarantee is a property of the upstream, and it would stop applying —
silently — the day a task moved tier or the provider pin in
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) stopped biting.

For the direct Anthropic SDK path there is no documented cancellation semantics at all. The safe
assumption is the industry one: by the time a client closes its connection the model is mid-
generation, most serving stacks do not check client liveness between tokens, and generation — with
billing — often continues past the abort. Whether the final usage frame arrives on an aborted stream
is provider-dependent and, as far as the research could establish, guaranteed by nobody.

So the rule for the schema, and it should be written on the column rather than left to be inferred:

> **On a row with `status = 'aborted'`, the cost is a lower bound.** It is what streamed before we
> stopped listening, not what was generated and charged. `npm run cost` reports aborted spend on its
> own line rather than folding it into the total.

The distinction that would resolve this — *did the provider actually stop, or did we merely stop
listening* — **is not observable from here.** `readerAborted` and the deadline signals in
`openrouter-stream.ts` know only our side of it. Worth saying plainly, because a cost table that
looks authoritative is exactly the thing somebody will later bill from.

The metric the research turned up for this is worth stealing eventually: **paid-to-delivered token
ratio**, which real deployments have measured above 1.5x. It is invisible on any dashboard built
from provider-reported usage — which is what this table is — so it is a thing to be aware this table
*cannot* tell us, rather than a column to add.

**One trade to write down rather than solve.** Recording only in `finally` means a process killed
mid-call leaves no row at all. The alternative — a `pending` row written *before* the call — costs
a second write on every call to catch a case that ends in a job marked failed anyway. Taking the
loss, deliberately, and saying so: a crashed process loses its cost record, and `revision_step_runs`
already knows the step was attempted.

That is what OpenRouter's `GET /api/v1/generation?id=…` is for: the id is on the stream, so the cost
can be fetched afterwards even when the stream was cut. Two cautions, both from the research pass —
the response shape was not verified first-hand, and `upstream_inference_cost` is genuinely BYOK-only
*on that endpoint* (which is where the caveat that misled me actually belongs). Treat it as a
recovery path to smoke-test in Phase 3, not as a thing to depend on.

**A failed call is billed too**, often — a 500 after the model has generated, a refusal, a
`max_tokens` truncation that this app treats as an error. [logging.md](../project/logging.md) has
already learned this lesson once, in prose worth reusing here:

> when a line is added to a success path, ask what the failure path says.

Same rule, same reason. `recordAiCall` is called from the `catch` as well as the success path, and
the twelve wirings are not finished until both are done.

## What gets built, and in what order

Greg asked for all four of the things I offered, so all four are here. Ordered so that each phase is
useful on its own and nothing later is needed to make something earlier true.

**Phase 0 — done, 2026-08-27.** Three live probes, about five cents in total, which is why two
sections above changed: the cached-token rule is now measured against OpenRouter's own reported cost
rather than inferred, the price table is confirmed to the cent, and the embeddings "bug" turned out
not to exist. Nothing below rests on an unverified reading of a docs page.

**Phase 0b — the decisions, before any more code.** The review's own reordering, and it is right:
what is left to settle is not another probe but a set of definitions, each of which changes a
column. What "cost" means (question 5 below); the store-mode adapter; owner deletion; the call
lifecycle, statuses and identifiers. All are written down above as recommendations; they need
Greg's yes rather than more research.

**Phase 1 — the price table and the two formulas.** ✅ **Built, 2026-08-27** —
[`src/pricing.ts`](../../src/pricing.ts) and [`tests/pricing.test.ts`](../../tests/pricing.test.ts),
20 tests. Pure functions, no IO. The two OpenRouter fixtures are the measured probe responses
together with the cost OpenRouter reported, so the assertion is against a bill rather than against
our own arithmetic; breaking the subtraction turns four of them red, which was checked rather than
assumed. Still to do here: the effective-date rows, and absorbing the constants in
[`evals/prompt-caching.ts`](../../evals/prompt-caching.ts), whose comment *"there is nowhere in the
app that knows prices"* has stopped being true.

**Phase 2 — the gateways.** `src/ai/anthropic.ts` and `src/ai/openrouter.ts`: timing, `call_id`,
status, usage extraction, raw capture, and the record-from-`finally`. Plus the migration and the
cost-store adapter. Proven against **one call of each transport** — an Anthropic stream, an
OpenRouter SSE stream, an OpenRouter JSON call, embeddings — rather than one stage, because those
four are the shapes that can differ.

**Phase 3 — move the remaining call sites behind the gateways**, and add the import rule as a test:
nothing outside `src/ai/` may import `@anthropic-ai/sdk` or name an OpenRouter URL. That is the
check the grep-for-a-recorder test could not be, because it fails on something a new call site
cannot avoid writing.

**Phase 4 — a total at the end of every run.** The cheapest of the four and the one that makes cost
stop being invisible day to day.

**Phase 5 — `npm run cost`.** Spend by day, stage, model, article and owner; the cache-saving
figure; the unpriced count; the aborted-spend line; the oldest surviving raw response and the
pruner's last successful run.

And **two reconciliations rather than one**, which between them are what stop the computed half
drifting:

```
  OpenRouter calls   our crossCheck  vs  usage.cost           per call, continuous
  Anthropic calls    our sum by day  vs  /v1/organizations/cost_report   per day, per model
```

The second is the one Greg's question earns. Group our Anthropic-SDK rows by **UTC day and model**
and diff against Anthropic's own reported cost for the same bucket. Three caveats to build in rather
than discover: the buckets are UTC and ours must be too; Anthropic has **no per-user dimension at
all**, so this reconciles the total and never the attribution; and anything else on the same
account — `evals/`, a one-off CLI run — lands in Anthropic's figure and not in ours, so those have
to be either recorded too or explicitly subtracted. A diff that is always non-zero for a known
reason is a check nobody reads.

**Phase 6 — the article's own number**, on the metadata page: what it cost to prepare, and what
questions about it have cost since.

**Phase 7 — the spend page in the app.**

Not built, deliberately: any cap, any threshold, any refusal. Greg chose report-only. What phase 2
must leave possible is the query a cap would need — hence the `(owner_id, created_at)` index. A cap
that reads `sum()` before every call is a design problem for the day somebody wants one, and
guessing at it now would be guessing at a change nobody has made.

## Why not a library

There are good ones and the research pass looked at them properly —
[ai-cost-tracking-options.md](../research/ai-cost-tracking-options.md) has the table. The short
version: **none of Langfuse, Helicone or Traceloop is ruled out on capability.** All three would
record per-call cost and group by a user id. They are ruled out on fit.

- **Helicone**'s fast path is a **proxy** — every model call routed through a third party. This app
  sends whole articles in its prompts. That is a privacy decision, not a latency one, and it is not
  one to make for a metrics feature.
- **Langfuse** self-hosted is Postgres *plus* ClickHouse *plus* Redis *plus* a blob store. Against
  "prefer boring… one server process", that is four new things to keep alive so that a number can
  be looked at.
- **Traceloop/OpenLLMetry** emits OpenTelemetry spans, which then need something to consume them.
- **OpenTelemetry's GenAI semantic conventions** are still `Development`, not `Stable`, as of mid
  2026 — so adopting their attribute names today means renaming columns later for a benefit we
  cannot use yet. Our columns are named in plain English instead.

And the deciding argument: what Greg asked for is a per-user total he can **set a price against**.
That number has to be our database joined to our own users table. Every platform above would have
us send it a `user_id` we are already tracking — which is precisely the column this plan adds. The
platform would be sitting on top of the work, not replacing it.

Worth revisiting the day the want is dashboards, alerting or evals rather than a number. `ai_calls`
would become one of their ingestion sources, so none of this is wasted.

## What the GPT Sol review changed

Full review in
[ai-cost-tracking-review-sol.md](ai-cost-tracking-review-sol.md); its verdict was *"do not build
this plan as written"*, and it was right. Both load-bearing token formulas survived; most of the
rest moved. Folded in above: the gateway seam replacing twelve recorders, the call lifecycle and
`call_id`, effective-dated prices, `ON DELETE RESTRICT`, and the reconciliation covering one model
rather than three. The remainder, kept short because each is now a decision rather than an argument:

- **A success log line, which Greg asked for and the plan had not delivered.** He chose *both* a log
  line and a row; the plan said existing log lines were untouched, and those are per-*step*
  aggregates with no dollar figure on them. The gateway writes one structured line per call —
  ids, purpose, model, usage, cost, status, latency — and never the raw response.
- **`waitUntil` rather than a bare `await` on the request path.** The Vercel premise was right —
  an un-awaited promise can be frozen — but
  [`waitUntil`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)
  exists for exactly this and keeps the insert off the reader's latency. Pipeline calls stay
  awaited, because the end-of-run total has to be exact. It is bounded by the function's duration,
  so it is not a completeness guarantee and a future spend cap must not be built on it.
- **`pg_cron` and the transaction pooler: probably fine, and not verified.** A cron job's own
  execution does not go through the pooler at all — pg_cron opens its own direct session-mode
  connection — so none of the four things
  [`src/db/client.ts`](../../src/db/client.ts) warns about apply to the job when it runs. Scheduling
  it from a migration *does* cross the pooler, but `cron.schedule(...)` is a single statement in one
  implicit transaction, and every one of those four footguns is about state surviving *across*
  round-trips. **That is inference from pg_cron's architecture plus PgBouncer semantics, not a
  Supabase doc anybody could quote.** So it gets a five-minute empirical check before it is relied
  on: schedule a trivial job through the pooler connection, confirm it lands in `cron.job` and
  actually fires. Cheap, and exactly the kind of assumption that otherwise fails in production and
  nowhere else.
- **`pg_cron` needs schema-qualifying.** `ai_calls` lives in the `spideryarn` schema and the plan
  scheduled a bare `update ai_calls`; the cron worker's search path cannot be assumed to include
  it. Schedule `select spideryarn.prune_ai_call_raw_responses()` instead, with a fixed empty
  `search_path`, and read `cron.job_run_details` for the last successful run. Also: **table size is
  the wrong alarm** — an `UPDATE` leaves dead tuples and does not shrink the relation. The useful
  checks are the age of the oldest surviving raw response and the last successful run, which is
  what `npm run cost` should print.
- **`bigint` does not arrive as a JS number.** Neither does `sum(bigint)`, and `BigInt` will not
  `JSON.stringify`. The column is `cost_usd_nanos` — currency in the name — and the decode and
  serialisation are their own small piece of work rather than an assumption.
- **There is no universal run identity.** `job_id` covers queued ingests and nothing else: a bare
  CLI stage, an eval and a request-path call all need to answer "which run was this". A `run_id`
  minted per process-or-request, kept separate from the job's `attempt_id` and from a provider
  retry counter, is what makes "a total at the end of every run" mean anything when two runs
  overlap.
- **A cost store adapter, rather than "always Postgres".** In `files` mode an awaited insert against
  a stopped Supabase opens a pool, waits out a connection timeout, and — per
  [`src/db/client.ts`](../../src/db/client.ts) — leaves the pool holding the CLI open. Multiply by
  every batch in a run. So: `postgres` mode writes a row, `files` mode writes a JSONL sidecar, and
  neither ever retries against the other. That also answers what `article_id` means in `files`
  mode, where the article may have no Postgres row at all.
- **"Prefer whichever is non-zero" was wrong about the two OpenRouter cost fields.** `usage.cost`
  is credits charged to the account; `upstream_inference_cost` is what the upstream charged. They
  can both exist and mean different things. Store both, and define which one the word "cost" means
  in the report — list-price inference, credits consumed, or cash including credit-purchase fees.
  That is a question for Greg, below.

Two things it flagged that are **not** being done, with reasons. A **spend-reservation ledger** for
the future cap is correctly identified — `sum()` before a call is racy — but building a reservation
system for a cap nobody has asked to switch on yet is guessing at the shape of that change; the note
is here so the day it arrives is not the day somebody discovers the race. And **no backfill**: the
grep proving nothing writes `ai_calls` is evidence about the source, not about the live table, so
the first migration checks the table is empty rather than assuming it.

## Questions for Greg

0. **Can you get an Admin API key — and do you want to?** It is what turns the Anthropic half of the
   cost from an assertion into something reconciled against Anthropic's own daily figure. Without
   it, those seven stages' cost is our arithmetic and nothing checks it.

   Two things to know before saying yes. It is a *separate, more powerful* credential than the one
   in `.env.local`, and it would only ever be read by `npm run cost`, never by the app. And it may
   not be one click: Anthropic's docs say **"The Admin API is unavailable for individual accounts"**
   and require setting up an organization first. This project runs on an individual account
   ([setup-dev.md](../project/setup-dev.md)), so the real question may be *"are you willing to
   convert the account to an organization"* rather than *"will you make a key"*. Worth five minutes
   in the Console to find out which, before anything is built on it.
1. **A deleted user's spend history** — keep it or delete it? ~~Every other owned table cascades.~~
   **Wrong, and corrected by the review:** every owner FK in
   [`drizzle/0001_auth_fks_and_guards.sql`](../../drizzle/0001_auth_fks_and_guards.sql) is
   `ON DELETE RESTRICT`, with a comment saying why — *"deleting the account must not silently"*
   delete the data. So `ai_calls` follows the existing rule rather than breaking it: `RESTRICT`,
   and deleting a user is already a thing this schema refuses to do quietly. The open question is
   only what happens the day you *do* want to delete an account while keeping its billing history,
   and the answer then is a billing-account row that outlives the `auth.users` row rather than a
   cascade.
2. **The `files`-mode question above** — option 2 is my recommendation but it is a real fork.
3. **How long before a raw response is pruned?** 14 days was my straw man. It is a
   how-far-back-do-you-ever-look question, not a technical one.
4. **Do the evals count?** `evals/` calls real models and spends real money, from the CLI. They
   would land under the dev owner. Worth having, or noise in the numbers?
5. **What does "cost" mean, for the number you set a price against?** No longer hypothetical:
   **OpenRouter's margin is a 5.5% fee on buying credits, not a per-token markup** — which is why
   the probes found `usage.cost` exactly equal to Anthropic's list price. So `usage.cost` is
   *credits consumed*, and the cash that left your bank is about 5.5% more. Anthropic's own calls
   have no such gap. Three candidate meanings, and they differ by real money:

   ```
     list price of the inference   →  what the model would cost anywhere
     credits deducted             →  usage.cost, and what the drift check compares against
     cash out of the bank         →  credits x 1.055 on the OpenRouter half, x1 on the Anthropic half
   ```

   For "what does a reader cost me", credits is close enough. For setting a price with a margin in
   it, cash is the only honest one. Pick one and name the column after it — a column called `cost`
   gets read as whichever the reader assumed.
6. **UTC or your calendar month?** "What did August cost" needs a timezone, and a call at 00:30 BST
   on 1 September is a July call in UTC. Only matters at the edges, and only ever matters if a bill
   is drawn from it.

## See also

- [docs/research/ai-cost-tracking-options.md](../research/ai-cost-tracking-options.md) — the
  options weighed, the libraries rejected, and the pricing sources
- [original-version/llm-plumbing.md](../project/original-version/llm-plumbing.md) — the old app's
  `ai_calls`, its field list, and its three-different-cost-calculations bug
- [logging.md](../project/logging.md) — the log lines this does not change, and the decision this
  reverses
- [prompt-caching.md](../project/prompt-caching.md) — why the two cache columns are the alarm
- [open-questions.md § Q7](../project/open-questions.md#q7) — *how much does a tree cost*, which
  this answers properly rather than by one experiment
