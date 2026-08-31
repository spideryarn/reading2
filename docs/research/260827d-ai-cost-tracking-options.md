# AI cost tracking: options

**Question.** We want to know, per call and rolled up, what our AI spend is — Anthropic direct
calls, OpenRouter calls (which cover both GPT-5.6 Luna and the Anthropic-via-OpenRouter path — see
[setup-dev.md](../project/setup-dev.md)), any embeddings, and any transcription. Two questions have
to be answerable with a number we'd defend in a bill: **"what did ingesting this article cost?"**
and **"what is this user costing us per month?"** — the second one because the product owner wants
to set a per-user spend limit and price the product against it. We also want to know if the prompt
cache stops hitting, and we want raw provider responses stored with automatic pruning rather than
kept forever.

This doc does not recommend code yet — it maps the terrain: what the providers actually return,
where the going price tables live, what the observability platforms are for, and what a sane
schema looks like. A build plan is separate work.

**Search coverage note, read before trusting this doc as complete.** WebSearch worked throughout;
one WebFetch call failed with a DNS/network error early on and was retried successfully on other
URLs, and one OpenRouter docs URL 404'd (worked around by search + a second doc page — see Q3). A
second pass (below) went further: it live-fetched OpenRouter's actual `/api/v1/models` and
`/api/v1/embeddings/models` endpoints with `curl` rather than trusting docs prose, and used this
repo's own committed eval data as ground truth for a question neither provider's docs answer
directly (whether cache tokens are counted inside or outside "prompt tokens" — see "the most
important finding," below). That second pass also **corrected** a claim from the first pass: I had
written that `cost_details.upstream_inference_cost` was BYOK-only and "won't apply to us"; it turns
out that caveat is scoped to one specific lookup endpoint, and the field works fine — and is already
in use — for this repo's non-BYOK embedding calls. Where I could not get past a marketing page to
the actual schema or source code, I say so rather than guessing. Things I still could **not** verify
first-hand: Langfuse's actual Postgres/ClickHouse column layout (I have their documented behaviour,
not their DDL); real numbers for "how big is a raw Anthropic response" (reasoned from token counts
rather than measured, flagged at that section); and how long an OpenRouter generation id stays
queryable via `/api/v1/generation?id=` (not stated in the docs page I reached).

## The most important finding: the two providers do not use the same cache-accounting formula

**Confirmed. This is real and it is silent if missed.** Anthropic's `usage.input_tokens` and
OpenRouter's `usage.prompt_tokens` answer a *different question*, even for the exact same
underlying Claude Sonnet 5 call:

| Provider | Does the "input/prompt tokens" field include cache tokens? | Formula |
|---|---|---|
| **Anthropic Messages API** | **No — disjoint.** `input_tokens` is only the tokens *after* the last cache breakpoint. | `total_input = input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (**add**) |
| **OpenRouter (any model, incl. `anthropic/claude-sonnet-5`)** | **Yes — inclusive.** `prompt_tokens` counts the whole prompt, cached or not. | `fresh = prompt_tokens - cached_tokens - cache_write_tokens` (**subtract**), then price each part separately |

**Anthropic's own docs state the additive rule explicitly** — quoting
[platform.claude.com's prompt-caching page](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching):
> "The `input_tokens` field represents only the tokens that come after the last cache breakpoint in
> your request — not all the input tokens you sent. To calculate total input tokens:
> `total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens`"

**OpenRouter's docs do not state the subtractive rule anywhere I could find** — the usage-accounting
and prompt-caching pages describe `cached_tokens` and `cache_write_tokens` as sub-breakdowns of
`prompt_tokens_details` without saying whether `prompt_tokens` itself already includes them. So the
proof here is empirical, not documentary — and it's already sitting in this repo, checked in:

> **Do not use the committed eval as the proof of this.** An earlier version of this section cited
> [evals/results/prompt-caching-constitution.md](../../evals/results/prompt-caching-constitution.md)
> and said its figures "match OpenRouter's reported cost exactly". They do not: the `cost` column in
> that file is *computed by the eval itself*, by `costs()` in
> [evals/prompt-caching.ts](../../evals/prompt-caching.ts) lines 45–80, which already subtracts.
> Re-deriving the same arithmetic and finding it agrees proves only that the same function was read
> twice. It is not evidence about OpenRouter, and it looks exactly like evidence.

**The real proof is a live probe, run 2026-08-27** — two identical ~18k-token calls to
`anthropic/claude-sonnet-5` a few seconds apart, comparing both hypotheses against the `cost`
**OpenRouter itself returned**:

```
              prompt_tokens  cached  cache_write  completion   OpenRouter's OWN reported cost
  cold           18224          0      18212          4          $0.045594
  warm           18224      18212          0          4          $0.0037064

  A — INCLUSIVE (subtract):  cold $0.04559400 ✓ exact     warm $0.00370640 ✓ exact
  B — DISJOINT  (add):       cold $0.08201800 ✗ 1.8x      warm $0.04013040 ✗ 10.8x
```

Eight decimal places on both. This also confirms the price table itself against real billing:
$2/$10 per million, cache write ×1.25, cache read ×0.1.

If `prompt_tokens` were disjoint from the cache fields (the Anthropic-shaped reading), the warm
call's fresh count would be `47789` tokens rather than `50`, and the arithmetic would be off by
roughly 47,700 tokens — the entire article. That's the scale of the silent error a shared formula
would produce: not a rounding difference, but a bill that's wrong by very close to 100% on every
cached call, in the direction of *undercounting* cost if you apply Anthropic's additive rule to
OpenRouter's numbers (you'd add the cache tokens back in on top of a `prompt_tokens` figure that
already contains them), or *overcounting* if you apply OpenRouter's subtractive rule to Anthropic's
numbers (you'd subtract cache tokens from an `input_tokens` figure that never included them, going
negative or double-discounting).

**This repo has 7 call sites on the Anthropic SDK and 5 on OpenRouter** (per the product owner's own
count). **A single shared `cost(usage)` helper across both providers is therefore a live bug, not a
convenience** — it can only be correct for one provider's shape at a time. The fix is a
provider-tagged discriminated union (`{provider: 'anthropic', usage: AnthropicUsage} | {provider:
'openrouter', usage: OpenRouterUsage}`) with two separate pricing functions, never one function that
takes "prompt tokens" and "cache tokens" as generic named arguments — the generic names are exactly
what hides which rule applies.

**The existing `evals/prompt-caching.ts` price table and `costs()` function already implement the
correct *OpenRouter* formula** (subtractive — see the quoted lines above) but its own comment says
"there is nowhere in the app that knows prices — the app does not bill anyone." That's no longer
true once this work lands, so that function is worth promoting into the shared pricing module
**as the OpenRouter half only** — do not reuse its subtraction against an Anthropic SDK `usage`
object, and rename it so the provider it's for is in the name (e.g. `openRouterCost`, not `costs`).

### Two more divergences worth citing while on this topic

- **`cache_creation_input_tokens` vs. the nested `cache_creation` breakdown (Anthropic only).**
  Confirmed on the same docs page: `cache_creation_input_tokens` is defined as the **sum** of
  `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. Trust the nested
  breakdown for pricing (5m writes are ×1.25, 1h writes are ×2.0 — pricing the flat total at a
  single multiplier is wrong the moment both TTLs appear in one request), and use the flat total
  only as a checksum that the breakdown sums correctly.
- **Reasoning/thinking tokens are billed as ordinary output tokens on Anthropic, confirmed via
  search of Anthropic's own pricing material**: "extended thinking tokens are billed as output
  tokens at standard rates — not as a separate pricing tier." Corroborated independently by live
  data pulled from OpenRouter's `/api/v1/models` today (see Q3 below): the `anthropic/claude-sonnet-5`
  pricing object has **no** `internal_reasoning` key at all (30 of 417 models on OpenRouter do have
  one — mostly Google Gemini variants that bill reasoning at a separate rate), which is consistent
  with Anthropic folding thinking tokens into the ordinary completion price rather than billing them
  separately. So `output_tokens` already includes any thinking tokens on both paths for Claude —
  no separate reasoning line to add.

## The short answer

For this project — one small team, filesystem-then-Postgres app, TypeScript/ESM, no existing
observability stack — **don't adopt an external platform. Build one small table plus one small
price-table package**, because:

- We need per-user billing-grade numbers, which means the source of truth has to be *our* database
  joined to *our* users table — no external platform gives you that join for free, and Helicone/
  Langfuse per-user dashboards assume you're sending them a `user_id` you already track yourself,
  which is exactly the work of building the column.
- Every serious external option (Langfuse, Helicone, Traceloop) is either a proxy in the request
  path (added latency and a new outage surface) or an async exporter (another service to run,
  even self-hosted). Both are more infrastructure than "one Postgres table with an index."
  [version-control.md](../project/version-control.md) and this repo's whole "boring first" stance
  say to not add a service until the plain-table version has actually run out of road.
- The two providers we call (Anthropic direct, OpenRouter) both return everything we need in the
  response's own `usage` object — nothing has to be inferred or estimated except historical prices
  for models whose prices later change, which is what "snapshot the price at call time" is for.
  **But the two `usage` objects are not the same shape and, critically, not the same cache-token
  accounting rule** — see "the most important finding," directly below. Getting this wrong is not a
  rounding error; it's wrong by roughly the size of the cache, which on this app's own measured
  numbers is ~95% of the prompt on a cache hit.

Use `@pydantic/genai-prices` (or a hand-copied slice of LiteLLM's price JSON) as the price table,
snapshot the resolved USD amount onto the row at call time, and store the raw response as JSONB
with a `pg_cron` job that drops it after N days while keeping the numeric columns forever. Detail
below.

## Options table

| Option | Type | Self-hostable | Cost | TS SDK | Needs a framework? | Runs as | Maturity (2026) |
|---|---|---|---|---|---|---|---|
| **Hand-rolled table + price package** | Library, not a platform | N/A — it's our DB | Free (a Postgres table) | N/A, we write it | No | Nothing extra | Depends entirely on us |
| [Langfuse](https://langfuse.com) | Tracing + evals platform | Yes, MIT core ([license breakdown](https://langfuse.com/self-hosting/license-key)) | Free self-hosted (EE features need a license key); cloud from $0 | Yes, official | No — works with plain SDK calls | Separate service (Postgres + ClickHouse + Redis + S3-compatible blob store) | Very active — 33.8k GitHub stars, pushed same day as this research |
| [Helicone](https://helicone.ai) | Gateway/proxy + observability | Yes, Apache-2.0 | Free self-hosted infra cost only; cloud from $79/mo | Yes, but the fast path is a **proxy** (base-URL swap) | No | Proxy service (Postgres + Redis + ClickHouse + MinIO) or async logging | Active — 6.1k stars, pushed the day before this research. Note: Helicone [announced joining Mintlify in 2026](https://www.opentechhub.io/helicone/), worth watching for roadmap drift |
| [Traceloop / OpenLLMetry](https://github.com/traceloop/openllmetry) | OpenTelemetry instrumentation library | Yes (it's a library, not a hosted thing by itself) | Free (Apache-2.0); Traceloop's own dashboard is a paid add-on | Yes — `@traceloop/node-server-sdk`, incl. `@traceloop/instrumentation-anthropic` | No, but it *emits* OTel spans, so you need something OTel-consuming downstream (any of the above, or your own collector) | In-process instrumentation; export target is separate | Active — 7.4k stars, pushed 2026-08-10 |
| [Braintrust](https://braintrust.dev) | Eval + observability platform | No — hosted only | Paid, usage-based | Yes | No | Hosted SaaS | Active, well-documented; their [2026 cost-tracking article](https://www.braintrust.dev/articles/how-to-track-llm-costs-2026) is one of the better field guides on this exact problem |
| LangSmith | Observability platform | Partial (self-host is Enterprise-tier only) | Paid | Yes | Works standalone but is built for LangChain/LangGraph apps | Hosted or Enterprise self-host | Active, but pulls in LangChain-shaped assumptions we don't want |
| Portkey | AI gateway | Partial | Paid tiers, free tier exists | Yes | No | Proxy/gateway | Active, less evidence gathered here — deprioritized per the research brief |
| Phoenix / Arize | Observability + evals | Yes, open source | Free self-hosted; paid cloud | Yes (Python-first; JS exists) | No | Separate service | Active, but ecosystem and docs skew Python/LangChain — weaker fit for a TS project |
| OpenTelemetry GenAI semantic conventions | Attribute-naming spec, not a product | N/A | Free | `@opentelemetry/*` core is stable; GenAI-specific attrs are not yet | No | N/A | **Still `Development`, not `Stable`, as of July 2026** — see Q2 below |

Skipped a deep dive on Portkey per the brief's priority order; the above is what search surfaced,
not a verified first-hand read.

## Q3 (priority 1): where does authoritative pricing come from?

This is the one that actually matters for defensible per-user billing, so it gets the most detail.

### Anthropic: no cost in the response, ever

The Messages API `usage` object returns **token counts only** — never a dollar figure. Confirmed
via the `claude-api` skill (bundled, checked against Anthropic's own docs) and via
[platform.claude.com/docs/.../prompt-caching](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching)
(note: `docs.anthropic.com` now 301-redirects to `platform.claude.com` — bookmark the new host).
So for direct Anthropic calls, **we compute cost ourselves** from `usage` × a price table we own.
Current per-model prices (from the `claude-api` skill, cached 2026-06-24, and this project's own
tiers — see [setup-dev.md](../project/setup-dev.md)):

| Model | Input $/1M | Output $/1M |
|---|---|---|
| `claude-opus-5` | $5.00 | $25.00 |
| `claude-sonnet-5` (our `CAPABLE_MODEL`) | $2.00 | $10.00 |
| `claude-haiku-4-5` | $1.00 | $5.00 |

Prompt-cache multipliers, relative to the base input price, confirmed on the same page:

| Operation | Multiplier |
|---|---|
| 5-minute cache write | ×1.25 |
| 1-hour cache write | ×2.0 |
| Cache read (hit) | ×0.1 |

This project's caching design is in [prompt-caching.md](../project/prompt-caching.md) — worth
reading alongside this, since it's the reason cache-write/cache-read tokens need their own columns
rather than being folded into "input tokens."

### The usage object, field by field (2026)

Confirmed by WebFetch against the live doc:

```json
{
  "usage": {
    "input_tokens": 1024,
    "output_tokens": 350,
    "cache_creation_input_tokens": 248,
    "cache_read_input_tokens": 0,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 148,
      "ephemeral_1h_input_tokens": 100
    }
  }
}
```

- `input_tokens` — tokens **after the last cache breakpoint only**, not the full input. This is
  the one silent trap: `total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens
  + input_tokens`. Summing `input_tokens` alone under-counts every cached call.
- `cache_creation_input_tokens` — sum of the `cache_creation` breakdown, kept for
  backward-compatibility with clients that don't read the breakdown.
- `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` — split by TTL, needed
  because they're priced differently (×1.25 vs ×2.0 above). If we ever use 1h caching, we need this
  split; if we only ever use 5m ephemeral (the default), `cache_creation_input_tokens` alone is
  enough, but storing the breakdown costs nothing and future-proofs the schema.
- `cache_read_input_tokens` — tokens served from cache this call, priced ×0.1.

I could not find a `server_tool_use` field in what I fetched (mentioned as a possibility in the
research brief) — the pages I reached only documented the caching-related fields above. If the
pipeline starts using server-side tools (web search etc., see the `claude-api` skill's Server Tools
section), re-check the usage shape then; those tools bill separately and may add their own field.

### OpenRouter: cost is in the response, and there's a second lookup

Confirmed by WebFetch against `openrouter.ai/docs/use-cases/usage-accounting`, and cross-checked by
fetching the **live** `/api/v1/models` and `/api/v1/embeddings/models` endpoints directly
(2026-08-27 — see the raw numbers below):

- `usage: {include: true}` **and** the OpenAI-compatible `stream_options: {include_usage: true}`
  are both **deprecated and now no-ops** — quoting the docs verbatim: *"The `usage: { include: true
  }` and `stream_options: { include_usage: true }` parameters are deprecated and have no effect."*
  Usage detail ships on **every** response automatically now, streaming or not, flag or no flag.
  This directly answers the "does it work on streaming, does it add latency/cost, does it conflict
  with `stream_options`" question: no conflict, because neither parameter does anything any more —
  the two are functionally identical (both ignored) rather than one superseding the other.
  - **What this means for this repo's actual call sites, checked in the code**:
    [`src/pdf-read.ts:395`](../../src/pdf-read.ts) and `evals/pdf/bakeoff/bakeoff.mts` send
    `usage: { include: true }` — harmless, does nothing, safe to leave or drop.
    [`src/explain.ts:520`](../../src/explain.ts), [`src/search.ts:617`](../../src/search.ts) and
    [`src/converse.ts:1008`](../../src/converse.ts) send the OpenAI-style `stream_options: {
    include_usage: true }` — also now a no-op, but **usage is arriving in these three streams
    regardless and nothing currently reads it**. Grepping `usage\.` across those three files turns
    up only `usage.server_tool_use_details.web_search_requests` /
    `usage.server_tool_use.web_search_requests` (for the web-search-count feature in
    [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts)) — **`usage.cost`,
    `usage.prompt_tokens`, `usage.completion_tokens` and the cache sub-fields are not extracted
    anywhere in these three call sites today.** That is the actual gap this work needs to close for
    5 of the 12 call sites, not a "check whether the flag is set" problem.
- The `usage` object on a chat completion:

```json
{
  "usage": {
    "prompt_tokens": 194,
    "completion_tokens": 2,
    "total_tokens": 196,
    "cost": 0.95,
    "cost_details": { "upstream_inference_cost": 19 },
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "cache_write_tokens": 100,
      "audio_tokens": 0
    },
    "completion_tokens_details": { "reasoning_tokens": 0 }
  }
}
```

- `usage.cost` is OpenRouter's own computed charge to our account, in **credits (effectively USD)**
  — this is authoritative for what we're billed. **Use this field directly rather than recomputing
  OpenRouter cost from a price table** — it's the actual invoice line, not an estimate, and per the
  divergence section above, *if* you do recompute it, the subtractive formula is the one that
  reconciles.
- `cost_details.upstream_inference_cost` — **narrower BYOK caveat than my first pass reported.**
  The docs' exact sentence is: *"When obtaining usage information via generation ID, the
  `upstream_inference_cost` field is only available for BYOK requests"* — that caveat is scoped to
  the **async `/api/v1/generation?id=...` lookup**, not to the field as it appears inline on the
  direct response. And this repo's own committed data proves the inline field populates for
  non-BYOK, credit-billed models too: [`src/embeddings.ts:222`](../../src/embeddings.ts) reads
  `usage.cost_details.upstream_inference_cost` for every embedding call regardless of provider, and
  [evals/results/embedding-retrieval-2026-08-26.md](../../evals/results/embedding-retrieval-2026-08-26.md)
  shows a real, non-zero corpus cost for `bge-m3` ($0.00046) — a non-BYOK, OpenRouter-credit-billed
  model. So the field does work inline for both BYOK and pay-as-you-go; the only thing to actually
  avoid is relying on it from the **generation-ID lookup** for a non-BYOK call.
- `prompt_tokens_details.cached_tokens` / `cache_write_tokens` — the OpenRouter-normalized
  equivalent of Anthropic's cache fields, present when the underlying model is Anthropic (routed
  through `anthropic/claude-sonnet-5`, per [setup-dev.md](../project/setup-dev.md)'s three-spelling
  problem — this is a second place that spelling matters, since OpenRouter's usage shape is generic
  across providers and Anthropic's own shape is what determines whether these sub-fields appear).
  **These are inclusive of `prompt_tokens`, not additive to it** — see the divergence section above.

**`GET /api/v1/generation?id=<id>`** — confirmed via WebFetch of
`openrouter.ai/docs/api-reference/get-a-generation`. Returns, among other fields: `total_cost`,
`usage` (USD), `upstream_inference_cost` (BYOK-only per the caveat above), `cache_discount`,
native token counts (`native_tokens_prompt`, `native_tokens_completion`, `native_tokens_cached`,
`native_tokens_reasoning`, `native_tokens_completion_images`), normalized token counts
(`tokens_prompt`, `tokens_completion`), and request metadata (`model`, `provider_name`,
`finish_reason`, `streamed`, `service_tier`, web-search counts). Useful as a **recovery path** if a
stream is cut before the final usage frame arrives — exactly the risk the abort-handling code in
`src/openrouter-stream.ts` is built around. **Not verified: how long a generation id stays
queryable.** The docs page I reached doesn't state a retention window, and I didn't find it
elsewhere — treat "fetch it soon after the call, don't rely on it as a long-term audit log" as the
safe assumption until that's confirmed by OpenRouter support or by testing an old id.

**`GET /api/v1/models` — confirmed live** (fetched the endpoint directly, 2026-08-27, 417 models).
Units are **USD per single token, as decimal strings** (not per-thousand or per-million) — verified
by cross-checking the live `anthropic/claude-sonnet-5` entry against Anthropic's own published
prices:

```json
{
  "prompt": "0.000002",           // = $2.00 / M — matches Anthropic's own Sonnet 5 input price exactly
  "completion": "0.00001",        // = $10.00 / M — matches Anthropic's own Sonnet 5 output price exactly
  "web_search": "0.01",           // $0.01/search = $10/1,000 — matches Anthropic's published web-search tool price exactly
  "input_cache_read": "0.0000002",     // = $0.20/M — exactly ×0.1 of the base input price
  "input_cache_write": "0.0000025",    // = $2.50/M — exactly ×1.25 of the base input price (5m TTL)
  "input_cache_write_1h": "0.000004"   // = $4.00/M — exactly ×2.0 of the base input price (1h TTL)
}
```

Every one of those six numbers matches Anthropic's own list price and cache multipliers to the
cent — **strong evidence OpenRouter passes Anthropic's pricing through unmodified for this model**,
with no separate per-token margin baked in (consistent with the earlier finding that OpenRouter's
margin is a 5.5% fee on credit *purchases*, not a per-token markup). I would not assume this holds
for every provider on OpenRouter — only checked Anthropic-routed pricing here.

Two field names the product owner asked about, confirmed against the live data:
- **`internal_reasoning`** — a separate per-token price for models that bill extended-reasoning
  output at a different rate than ordinary completion tokens. Confirmed present and non-zero on 30
  of the 417 models returned live today (spot-checked: several Google Gemini 3.x variants). **Absent
  from the `anthropic/claude-sonnet-5` entry** — consistent with the earlier finding that Claude
  bills thinking tokens at the standard output rate rather than separately.
- **`overrides`** — conditional pricing exceptions for the same model, keyed by UTC day/time
  window, inheriting any price not explicitly overridden. Confirmed present on 60 of 417 models live
  today; example pulled directly from the endpoint is a weekday/weekend/time-of-day discount
  schedule on `deepseek/deepseek-v4-flash-vision-exp`. **Not present on `anthropic/claude-sonnet-5`**
  — Anthropic pricing through OpenRouter doesn't vary by time of day as of this check, so this is a
  field to be aware of for other models rather than one that changes anything for our current tiers.

**Embedding models are on a *separate* endpoint, and this matters — it's the answer to "why isn't
voyage-4 in the price list."** `GET /api/v1/models` returned **zero** matches for `/voyage/i` when I
checked it live, confirming the product owner's finding — but that's because chat-completion models
and embedding models are catalogued separately on OpenRouter. The authoritative endpoint for
embeddings is `GET /api/v1/embeddings/models`, confirmed live (33 models, fetched 2026-08-27) and it
does list `voyageai/voyage-4` and every other model this repo's embeddings code can call:

| Model | `pricing.prompt` (USD/token) | USD/M | Matches this repo's own eval table? |
|---|---|---|---|
| `voyageai/voyage-4-lite` | `0.00000002` | $0.02 | ✓ — matches [`evals/embedding-retrieval.ts`](../../evals/embedding-retrieval.ts)'s committed $/M column exactly |
| `voyageai/voyage-4` | `0.00000006` | $0.06 | ✓ exact match |
| `baai/bge-m3` | `0.00000001` | $0.01 | ✓ exact match |
| `openai/text-embedding-3-small` | `0.00000002` | $0.02 | ✓ exact match (BYOK — billed to Greg's own OpenAI account per [`src/embeddings.ts`](../../src/embeddings.ts)) |

**So: for a price-table lookup that needs to cover embeddings as well as chat, query (or vendor)
both `/api/v1/models` and `/api/v1/embeddings/models` — a price table built from only the first will
silently have no entry for any embedding model, which is exactly the "$0.00 that isn't really zero"
failure mode the product owner flagged.** In practice this repo doesn't need the lookup at all for
embeddings billing, since — per the correction above — `usage.cost_details.upstream_inference_cost`
already comes back correctly on the inline embeddings response for every model it uses, BYOK or not.

**Bottom line for OpenRouter: store `usage.cost` (chat) or `usage.cost_details.upstream_inference_cost`
(embeddings, per this repo's existing convention) verbatim as the authoritative charge.** Don't
recompute it from a price table for routine billing — that's the Anthropic-direct case, not this
one. Where a local price-table figure is computed anyway (see "provider-reported vs. locally-computed"
below), treat it as a cross-check, not the number of record.

### Provider-reported cost vs. locally-computed cost — which to store, and when they disagree

This is the direct answer to "does this change the recommendation shape": **yes — for the 5
OpenRouter call sites, record the provider's own number; only the 7 Anthropic-direct call sites need
a locally-computed figure at all.** But store both where both are available, because a mismatch is
exactly the kind of thing that should be visible rather than silently overwritten:

- **OpenRouter calls**: `usage.cost` (or `cost_details.upstream_inference_cost` for embeddings) is
  the number of record — it's what OpenRouter actually bills. **Also** compute a local estimate from
  the price table for these calls, store it in a second column (`computed_cost_usd_micros`), and
  alert (or just log a warning) if the two disagree by more than a rounding tolerance. A silent
  divergence here is precisely the "prompt cache stopped working and nothing said so" failure mode
  from the original brief — if OpenRouter's real charge for a call is suddenly close to the
  no-cache price while the local estimate (computed from the same `usage` object, so it can't
  itself detect a cache miss) still assumes a hit, they'll disagree and that disagreement is the
  signal.
- **Anthropic-direct calls**: there is no provider-reported cost at all (confirmed above — the
  Messages API never returns one), so the price-table computation *is* the number of record. No
  second column needed here; there's nothing to cross-check it against except the monthly Admin
  Cost API total (see below), which is aggregated and roughly a day delayed, not per-call.
- **Reconciliation against Anthropic's own numbers**: the [Usage and Cost Admin
  API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) (confirmed via WebFetch,
  2026-08-27) is the closest thing Anthropic has to a machine-readable cost source, but it answers a
  different question than per-application-user billing does. It's **organization-level**, filterable
  by `api_key_id`, `workspace_id`, or `model` and grouped the same way — the finest grain it offers
  is "spend on this API key," not "spend by this app's `user_id`," because Anthropic has no idea
  those exist. Data lands "within 5 minutes" per their own FAQ, but the **Cost** endpoint is daily
  granularity only (`bucket_width=1d`), so it's a good sanity check for "did our computed monthly
  total roughly match what Anthropic actually billed the org" — not a live per-user source. (One
  option this doc will flag but not recommend: minting one Anthropic API key per user so the Admin
  API's `api_key_id` filter becomes a per-user filter — that's a real amount of new key-management
  infrastructure for a benefit our own `ai_calls` table already gives us for free, so skip it.)

### Third-party price-table packages

| Package | Maintained? | Notes |
|---|---|---|
| [`@pydantic/genai-prices`](https://github.com/pydantic/genai-prices) (also has a Python package) | Yes — pushed the same day as this research (2026-08-27), 359 stars, 53 open issues (normal churn for a price-tracking repo). From Pydantic, the team behind `pydantic-ai` | TS/JS package, bundles YAML price data per provider, has an "auto-update" mode that refetches from GitHub hourly. Best-effort — their own README admits prices "cannot be exactly correct" |
| [LiteLLM `model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) | Yes, very actively — auto-updated by a GitHub Action on new model launches | Not an npm package per se — it's a raw JSON file you fetch or vendor yourself. Huge coverage (100+ providers), Python-first project but the JSON is language-agnostic |
| `tokenlens` | Yes — 125k weekly npm downloads, used by Vercel and Midday per its own site | Broader scope than pure pricing (context budgeting, compaction hints); cost estimation is "fast, rough" by its own description, not billing-grade |
| `llm-cost` (npm) | Turned up in search, not independently verified for freshness | Smaller/less-evidenced than the above three |

**Recommendation: use `@pydantic/genai-prices` for Anthropic-direct pricing**, since it's freshest,
TS-native, and from a team with a track record (Pydantic). Don't lean on any third-party package for
*OpenRouter* pricing — OpenRouter tells you the actual cost directly (`usage.cost`), so a price
table there would be redundant and could disagree with the real invoice.

### Snapshot at call time, or recompute later?

Both Langfuse's own docs and the Braintrust cost-tracking article (below) converge on the same
answer, and it matches this repo's instinct: **snapshot.**

- Braintrust: "log the token counts returned by the provider response, because those counts are
  closest to the invoice" — i.e., store what's true about the *call*, not a derived dollar figure
  computed against a price table you might change your mind about later.
- Langfuse's approach is closer to "recompute at query time from a maintained model-price registry"
  by default, but explicitly supports ingesting a pre-computed cost when you have it (exactly
  OpenRouter's `usage.cost`) and says "user-defined models take priority."

For **billing** (the per-user monthly total the product owner wants to set a spend limit against),
recompute-at-query-time is the wrong choice: if Anthropic changes Sonnet's price next quarter, a
recompute silently rewrites last month's invoice-equivalent number. **Snapshot the resolved USD
amount onto the row at call time**, using whatever price was authoritative then (OpenRouter's own
`usage.cost`, or our price-table lookup for Anthropic-direct calls at that moment). Keep the raw
token counts too, so a *historical* "what would this have cost under today's prices" query is still
possible by joining against a price-table-with-effective-dates table if we ever build one — but the
number we show a user or bill against is the frozen one.

## Q4 (priority 2): exact usage field names, 2026

Covered above in full for both providers. Summary table for the schema section:

| Field | Anthropic Messages API | OpenRouter |
|---|---|---|
| Input tokens (uncached) | `usage.input_tokens` | `usage.prompt_tokens` |
| Output tokens | `usage.output_tokens` | `usage.completion_tokens` |
| Cache write tokens | `usage.cache_creation_input_tokens` (+ `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`) | `usage.prompt_tokens_details.cache_write_tokens` |
| Cache read tokens | `usage.cache_read_input_tokens` | `usage.prompt_tokens_details.cached_tokens` |
| Reasoning tokens | n/a on Anthropic usage object (thinking is billed as output tokens) | `usage.completion_tokens_details.reasoning_tokens` |
| Cost in response | **never** | `usage.cost` (billed amount); `usage.cost_details.upstream_inference_cost` (populates inline for BYOK **and** pay-as-you-go — confirmed against this repo's own embeddings data; the BYOK-only caveat is scoped to the async `/generation?id=` lookup only) |
| "Input/prompt tokens" includes cache tokens? | **No — additive.** `input_tokens` excludes both cache fields; sum all three for the true total | **Yes — inclusive.** `prompt_tokens` already contains the cached/written tokens; subtract to find the fresh portion |

**The last row is the one to read twice** — see the divergence section above for the worked proof
and why one shared cost formula is wrong for one of the two providers.

## Q6 (priority 3): schema and retention

### What to store — two tiers, not one row shape

Split into a small **numeric** row (cheap, queried constantly, kept forever) and a **raw payload**
(expensive, queried rarely, pruned). This is the same shape the old app used (see
[llm-plumbing.md](../project/original-version/llm-plumbing.md)'s `ai_calls` table) — its field list
was right, its choice to keep the database was the only thing wrong for a filesystem-era app, and
we're on Postgres now anyway (see the "reversed" filesystem-over-database note in
[CLAUDE.md](../../CLAUDE.md)), so this time the shape and the storage finally match.

```sql
create table ai_calls (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  latency_ms            integer not null,        -- timed ourselves; see the gotcha below

  -- who / what
  user_id               uuid references users(id),      -- for per-user attribution & limits
  article_slug          text,                            -- for "what did this article cost"
  task                   text not null,                   -- e.g. 'toc', 'explain', 'search', matches TASK_TIER in src/models.ts
  provider              text not null,                    -- 'anthropic' | 'openrouter'
  model                 text not null,                    -- the wire id actually sent, per src/models.ts's three-spelling rule

  -- tokens (store all of them, every call, even when zero)
  input_tokens          integer not null default 0,
  output_tokens         integer not null default 0,
  cache_write_tokens    integer not null default 0,
  cache_read_tokens     integer not null default 0,
  reasoning_tokens      integer not null default 0,

  -- cost — snapshotted, not recomputed. Two columns, not one — see "provider-reported vs
  -- locally-computed" above: OpenRouter rows get both (for cross-checking); Anthropic-direct
  -- rows only ever populate the computed column, because Anthropic never reports a cost.
  cost_usd_micros           bigint not null,      -- the number of record: provider's own cost where one exists, else computed
  computed_cost_usd_micros  bigint,               -- always our own price-table computation; null only if the price table had no entry
  price_source              text not null,        -- 'openrouter_usage_cost' | 'openrouter_upstream_inference_cost' | 'genai_prices_2026_08_27' | ...

  status                text not null,            -- 'success' | 'failed' | 'aborted'
  finish_reason         text,
  error_message         text,

  raw_response          jsonb                     -- pruned on a schedule, see below
);

create index on ai_calls (user_id, created_at);
create index on ai_calls (article_slug);
create index on ai_calls (created_at);  -- for the pruning job
```

**Cost as integer micro-dollars (`bigint`), not `numeric` or `float`.** This is a standard
ledger/billing pattern (avoids float rounding entirely, and `bigint` arithmetic for `sum()` across
millions of rows is faster than `numeric`). `numeric` would also work and is more forgiving if
someone forgets the micro-dollar convention; the tradeoff is purely "do we trust every future
writer to remember to divide by 1e6." Given this is a small team, either is defensible — flagging
the choice rather than treating it as settled.

**`price_source`** matters because we have two different pricing regimes (OpenRouter's own billed
`usage.cost` vs. our own price-table lookup for Anthropic-direct calls) and because a price table
package version changes over time — worth being able to answer "was this row priced from the price
list that existed on the day of the call, or recomputed later by mistake."

**The pricing function must be provider-tagged, never a single generic `cost(tokens)` helper** — see
"the most important finding" section near the top of this doc. Anthropic's `input_tokens` is
disjoint from its cache fields (add them); OpenRouter's `prompt_tokens` already includes them
(subtract them out). Write two functions — `anthropicCost(usage: AnthropicUsage)` and
`openRouterCost(usage: OpenRouterUsage)` — behind a discriminated union on `provider`, not one
function that both providers' call sites funnel through with differently-shaped arguments. The
existing `costs()` in [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts) already implements
the OpenRouter half correctly (subtractive) and is worth promoting into the shared module under a
provider-specific name — but it would silently overbill or underbill if reused as-is against an
Anthropic SDK `usage` object.

**The one gotcha worth stealing outright**, confirmed relevant by the old app's own postmortem-style
note in [llm-plumbing.md](../project/original-version/llm-plumbing.md): don't trust SDK-reported
timing fields — they found the SDK omitted `startTimestamp`/`finishTimestamp` in production and
silently read as zero-latency. Time every call ourselves, `Date.now()` around the request, same as
they eventually did.

### Raw response size and pruning

I could not find a solid public number for "how many KB is a typical Anthropic Messages API JSON
response" — this is arithmetic, not a verified measurement. A response's JSON overhead (field
names, nesting, the `usage` object, IDs) is small — a few hundred bytes — and the dominant cost is
the `content` text itself, roughly 4 characters per token. A `toc` or `arc` pipeline call producing
a few thousand output tokens is very roughly 10–20 KB of raw JSON; a chat/explain response is
smaller. At, say, 500 calls/day this is single-digit MB/day of JSONB — not disk-threatening on its
own, but it compounds over months, and it's exactly the "31 MB of raw responses dominates the DB"
shape the brief called out once an article's worth of prompt-cached system-prompt bytes get
included in a few of these calls (a cached system prompt shows up in the request, not the response,
so this mostly affects generation calls with long output, not every row equally). **Treat this
estimate as a reason to prune, not as a number to build a capacity plan on** — measure `pg_size_pretty(pg_total_relation_size('ai_calls'))` after a week of real traffic before deciding a retention window.

**Retention pattern — confirmed as a common, documented approach**: `pg_cron` (a Postgres extension
Supabase enables with a dashboard toggle, no separate service) scheduling a plain SQL statement.
Two shapes people actually use, both found via search of Supabase's own docs and community threads:

1. **Simple delete-old-rows**, fine at our scale: a scheduled function that runs
   `update ai_calls set raw_response = null where created_at < now() - interval '30 days' and raw_response is not null`
   — note this *nulls the JSONB column*, not deletes the row, so the numeric/billing columns are
   never touched by retention. Wrap it in a `plpgsql` function and schedule the function call with
   `cron.schedule(...)`, which is the pattern Supabase's own docs recommend (schedule a function
   call, not raw SQL inline, so the logic is versioned in a migration).
2. **Partition-and-drop**, worth it only once row counts get large: `pg_cron` paired with
   `pg_partman` to range-partition `ai_calls` by month and detach/drop whole partitions past the
   retention window — much cheaper than a row-by-row `DELETE`/`UPDATE` at high volume because
   dropping a partition is a metadata operation, not a scan. Overkill for where this project is now;
   worth knowing the pattern exists for when it isn't.

Given our current scale (per [performance.md](../project/performance.md), this is a small team's
app, not high-QPS), **option 1 is the right starting point**: a `pg_cron` job that nulls
`raw_response` after a fixed window (30 days is a reasonable first guess — long enough to debug a
recent "why did this look wrong" complaint, short enough that JSONB never dominates). Revisit
partitioning only if `ai_calls` grows past a size where the nightly `UPDATE` itself becomes slow.

## Q1/Q2: observability platforms and OpenTelemetry GenAI conventions — the short version

Covered in the options table above. Two things worth saying in prose:

- **None of Langfuse, Helicone, or Traceloop is disqualified on capability** — all three would
  happily record per-call cost and let you group by a `user_id` you send them. The reason not to
  adopt one is architectural fit, not a feature gap: each adds either a proxy in the request path
  (Helicone's fast path) or a separate service to run and keep up (Langfuse's Postgres + ClickHouse
  + Redis + blob store, self-hosted; Traceloop needs an OTel collector target). For a project whose
  house rule is "boring: filesystem over database... no framework churn" (CLAUDE.md), a Postgres
  table is the more boring choice. Revisit if/when we want dashboards, alerting, or LLM-as-judge
  evals on top of the cost data — that's genuinely what these platforms are for, and building it
  ourselves later is not wasted work since the underlying `ai_calls` table would just become one of
  their ingestion sources.
- **OpenTelemetry's GenAI semantic conventions are not stable.** As of mid-2026 the whole
  convention set lives in its own repo (`open-telemetry/semantic-conventions-genai`, split out of
  the main OTel spec repo in June 2026) and, as of a July 2026 status check found via search,
  **nothing in it is marked Stable** — it's all still `Development`. That means the attribute names
  (`gen_ai.usage.input_tokens` and similar) could still change. Not worth adopting as our column
  names today; worth revisiting once the spec stabilizes, since it would make our data portable
  into any OTel-speaking tool without a translation layer. For now, name our own columns in plain
  English (`input_tokens`, not `gen_ai_usage_input_tokens`) rather than betting on a moving target.

## Q5: embeddings

This repo already calls Voyage's `voyage-4` through OpenRouter's embeddings endpoint — see
[`src/embeddings.ts`](../../src/embeddings.ts) and [`evals/embedding-retrieval.ts`](../../evals/embedding-retrieval.ts)
— so this isn't hypothetical. Its API is **not** OpenAI-compatible — custom request/response schema,
requires an explicit `input_type` field (`"query"` vs `"document"`, never defaulted, per the file
header comment in `embeddings.ts`) — but usage accounting is the same shape as any token-based API:
the response reports tokens consumed, priced per-model. Confirmed **live** by fetching
`GET https://openrouter.ai/api/v1/embeddings/models` directly (2026-08-27, 33 models) — this is a
**separate catalog from `/api/v1/models`**, which is why `voyage-4` doesn't show up there (see the
"Embedding models are on a separate endpoint" section above). Confirmed prices, matching this repo's
own committed eval numbers to the cent:

| Model | $/M tokens |
|---|---|
| `baai/bge-m3` | $0.01 |
| `voyageai/voyage-4-lite` | $0.02 |
| `voyageai/voyage-4` (the one this repo actually uses — `EMBEDDING_MODEL` in `src/embeddings.ts`) | $0.06 |
| `openai/text-embedding-3-small` | $0.02 (BYOK — billed to the user's own OpenAI account, not OpenRouter credits) |

Nothing embeddings-specific complicates cost tracking beyond "it's another `provider`/`model` row in
the same `ai_calls` table" — no caching concept, no reasoning tokens, no separate input/output split
(embeddings are input-only). They fit the schema above with `output_tokens = 0` and
`cache_write_tokens = cache_read_tokens = 0`. One thing to carry over from the code that's already
there, not a new finding: `src/embeddings.ts` already reads
`usage.cost_details.upstream_inference_cost` rather than `usage.cost`, specifically so the BYOK
`text-embedding-3-small` arm doesn't silently report $0 — and per the correction above, that same
field is confirmed to also report correctly for the non-BYOK arms (`bge-m3`, `voyage-4`), so this
existing convention can be trusted and reused as-is for the new `ai_calls` table rather than switched
to `usage.cost`.

## Q7: making the numbers usable

Not deeply researched this round (deprioritized per the brief), but the framing is worth recording
because it's the trap the old app fell into — see
[llm-plumbing.md](../project/original-version/llm-plumbing.md#timeouts-and-the-numbers-that-exist): *"a year of
production and the question 'what does this cost us' was still unanswerable, because the logging
existed and nobody ever aggregated it."* Cheapest fix, worth doing on day one rather than as
follow-up work: print a running total at the end of every pipeline CLI run (`npm run toc`, `npm run
arc`, etc. — see [architecture.md](../project/architecture.md) for the stage list), and have one
`SELECT sum(cost_usd_micros) / 1e6 ... group by user_id` query saved somewhere reachable (a `psql`
snippet in a doc is enough at this scale; a dashboard is Q1/Q2 territory).

## What we're NOT doing, and why

- **Not adopting Langfuse, Helicone, or Traceloop now.** Architectural fit, not capability — see
  Q1/Q2 above. All three remain reasonable future upgrades once we want dashboards/alerting/evals
  rather than "a number in the database."
- **Not building on the OpenTelemetry GenAI semantic conventions yet.** They're explicitly
  `Development`, not `Stable`, as of mid-2026 — adopting now means renaming columns later for no
  benefit we can use today.
- **Not recomputing OpenRouter's cost from a price table.** OpenRouter hands us the actual billed
  amount in `usage.cost`; recomputing it independently would only introduce a second number that
  can disagree with the real invoice.
- **Not treating `cost_details.upstream_inference_cost` as BYOK-only on the inline response** —
  corrected from the first pass of this doc. The BYOK-only caveat in OpenRouter's docs is scoped to
  the async `/generation?id=` lookup; the inline field on the direct response populates for
  pay-as-you-go models too, confirmed against this repo's own committed non-BYOK embeddings data
  (`bge-m3`, non-zero cost). `src/embeddings.ts` already relies on this correctly.
- **Not using one shared `cost(usage)` helper across both providers.** Anthropic's cache fields are
  additive to `input_tokens`; OpenRouter's are inclusive of `prompt_tokens`. A generic helper can
  only get one of the two right — see "the most important finding," near the top of this doc.
- **Not recomputing embedding cost from a price table when the provider's own number is available.**
  `usage.cost_details.upstream_inference_cost` already reports the true charge inline for every
  embedding model this repo uses (BYOK or not); a locally-computed number is a cross-check, not a
  replacement.
- **Not partitioning `ai_calls` by month yet.** The pattern (pg_cron + pg_partman) is documented and
  ready to reach for, but at this project's current volume a simple `UPDATE ... SET raw_response =
  null` on a cron schedule is the right amount of infrastructure. Revisit if the table gets large
  enough that nightly pruning itself becomes slow.
- **Not treating the raw-response size estimate in Q6 as measured.** It's arithmetic from token
  counts, not a real measurement — flagged there, repeated here so it doesn't get cited as fact
  later.

## Sources (checked 2026-08-27)

- [Anthropic prompt caching docs](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching) — usage fields, cache pricing multipliers, the additive `total_input_tokens` formula (note: `docs.anthropic.com` now redirects here)
- `claude-api` skill (bundled with this Claude Code install, cached 2026-06-24) — current per-model Anthropic pricing, usage/cost fields, model migration notes
- [OpenRouter usage accounting docs](https://openrouter.ai/docs/use-cases/usage-accounting) — `usage.cost`, `cost_details`, `prompt_tokens_details`, deprecation of both `usage: {include: true}` and `stream_options: {include_usage: true}`, BYOK scope of `upstream_inference_cost` on the generation-ID lookup
- [OpenRouter "Get a Generation" API reference](https://openrouter.ai/docs/api-reference/get-a-generation) — full `/api/v1/generation?id=` response schema
- **Live-fetched `GET https://openrouter.ai/api/v1/models`** (curl, 2026-08-27, 417 models) — confirmed pricing units (USD/token), the exact `anthropic/claude-sonnet-5` pricing object, `internal_reasoning` present on 30/417 models and absent from Anthropic's, `overrides` present on 60/417 with a live time-of-day-discount example
- **Live-fetched `GET https://openrouter.ai/api/v1/embeddings/models`** (curl, 2026-08-27, 33 models) — confirmed `voyageai/voyage-4`, `voyageai/voyage-4-lite`, `baai/bge-m3`, `openai/text-embedding-3-small` pricing, matching this repo's committed eval numbers exactly; confirmed this is a separate catalog from `/api/v1/models`
- This repo's own committed data used as primary evidence for the cache-token-accounting divergence: [`evals/results/prompt-caching-constitution.md`](../../evals/results/prompt-caching-constitution.md), [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts), [`evals/results/embedding-retrieval-2026-08-26.md`](../../evals/results/embedding-retrieval-2026-08-26.md), and the current call sites in [`src/embeddings.ts`](../../src/embeddings.ts), [`src/pdf-read.ts`](../../src/pdf-read.ts), [`src/explain.ts`](../../src/explain.ts), [`src/search.ts`](../../src/search.ts), [`src/converse.ts`](../../src/converse.ts), [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts)
- [Anthropic Usage and Cost Admin API docs](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) — org/workspace/API-key granularity, 5-minute data freshness, daily cost bucketing, confirms no per-application-user dimension exists
- Search results on Anthropic web search tool pricing ($10/1,000 searches) and extended-thinking billing (billed as ordinary output tokens, not a separate tier) — corroborated by the live OpenRouter pricing data (matching `web_search: "0.01"`, and no `internal_reasoning` key on Anthropic's entry)
- [pydantic/genai-prices](https://github.com/pydantic/genai-prices) — repo metadata pulled via `gh api` (359 stars, pushed 2026-08-27); [JS package README](https://github.com/pydantic/genai-prices/blob/main/packages/js/README.md)
- [LiteLLM `model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) and its [auto-update workflow](https://docs.litellm.ai/docs/proxy/sync_models_github)
- [tokenlens](https://www.tokenlens.dev/) and its [npm page](https://www.npmjs.com/package/tokenlens) (125k weekly downloads claim)
- [Langfuse token-and-cost-tracking docs](https://langfuse.com/docs/observability/features/token-and-cost-tracking) — snapshot-vs-recompute behaviour, per-user aggregation via Metrics API
- [Langfuse licensing](https://langfuse.com/self-hosting/license-key) and [open-sourcing announcement](https://langfuse.com/blog/2025-06-04-open-sourcing-langfuse-product) — MIT core, `/ee` license-gated modules; repo metadata via `gh api` (33.8k stars)
- [Helicone GitHub repo](https://github.com/helicone/helicone) — Apache-2.0, repo metadata via `gh api` (6.1k stars); [cost package README](https://github.com/Helicone/helicone/blob/main/packages/cost/README.md); [Helicone pricing](https://www.helicone.ai/pricing); [Mintlify join announcement](https://www.opentechhub.io/helicone/)
- [Traceloop/OpenLLMetry GitHub repo](https://github.com/traceloop/openllmetry) — repo metadata via `gh api` (7.4k stars, pushed 2026-08-10); [`@traceloop/instrumentation-anthropic`](https://www.npmjs.com/package/@traceloop/instrumentation-anthropic)
- Braintrust, [How to track LLM costs (2026): per-user, per-feature, and per-agent-run attribution](https://www.braintrust.dev/articles/how-to-track-llm-costs-2026) — recommended tagging fields, hard-cap-at-proxy advice for per-user spend limits
- [John Hodge, "The state of the OpenTelemetry GenAI semantic conventions (July 2026)"](https://john-hodge.com/blog/opentelemetry-genai-semantic-conventions/) and a second corroborating post found via search — GenAI conventions split into their own repo June 2026, nothing marked Stable as of July 2026
- Search results on Voyage AI pricing (voyage-4 family, $0.02–$0.12/M tokens, 200M free tokens, 33% batch discount) — not cross-checked against Voyage's own docs directly, taken from aggregator sites; flagged as such
- Search results on `pg_cron` / Supabase scheduled retention patterns, including [Supabase's own Cron announcement](https://supabase.com/blog/supabase-cron) and a [Supabase community discussion on scheduled deletes](https://github.com/orgs/supabase/discussions/28864)
- This project's own docs: [llm-plumbing.md](../project/original-version/llm-plumbing.md) (the `ai_calls` table this borrows from, and the "logged but never aggregated" trap), [prompt-caching.md](../project/prompt-caching.md), [setup-dev.md](../project/setup-dev.md) (model tiers and the three-spelling problem), [database.md](../project/database.md)
