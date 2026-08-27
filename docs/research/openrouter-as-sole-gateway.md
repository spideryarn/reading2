# Routing every model call through OpenRouter — what we'd gain, what we'd lose

Written 2026-08-27, for the cost-tracking work. The question on the table: this app currently calls
the Anthropic SDK directly for Sonnet 5 (with prompt caching and streaming) and OpenRouter for
everything else (some models, and voyage-4 embeddings). Greg's proposal is to collapse that to
**one** transport — OpenRouter for everything — so cost tracking reads one usage shape and
`usage.cost` off every response instead of doing per-provider price arithmetic. This asks whether
that actually works, and what it costs.

See also [prompt-caching-openrouter.md](prompt-caching-openrouter.md) (2026-08-26) — the earlier,
narrower research that answered "can `explain.ts`/`converse.ts` keep their current OpenRouter
raw-HTTP shape and get caching too?" This doc is broader: it assumes the *whole* app, including the
one caller still on the Anthropic SDK, moves to OpenRouter, and it goes further into what's lost
outside caching. Where the two agree, this doc doesn't re-derive it — it links back.

Followed [third-party-library-selection.md](../reusable/third-party-library-selection.md): prefer
primary docs, note dates, flag anything older than ~a year, say explicitly what couldn't be
confirmed.

## 1. Verdict, in three sentences

**Yes, with one caveat, and the caveat has a specific fix.** Prompt caching, extended thinking,
native tool use, and Anthropic's own `stop_reason` values all survive the move *if* the Anthropic
calls go through OpenRouter's **Anthropic Messages-compatible endpoint** (`/api/v1/messages`, the
"Anthropic Skin") rather than through OpenRouter's OpenAI-shaped chat-completions endpoint — the
recurring "caching silently doesn't work" bug reports below are overwhelmingly about the OpenAI-shaped
path, not this one. The open question that stops this being an unqualified yes is whether the Skin's
response carries OpenRouter's own `usage.cost` field or only Anthropic-native usage counters — that
determines whether moving there keeps the "free cost, no arithmetic" win the whole proposal is for,
and it needs a live probe (§5) rather than a doc read.

> **Settled by probe, 2026-08-27 — see §5a.** The Skin carries **both**: Anthropic's native additive
> counters (including the 5m/1h cache split, `service_tier` and `inference_geo`) *and* OpenRouter's
> `cost`, in one `usage` object. So the verdict above is an unqualified yes on the fidelity question.
> Two things the probes added that this doc could not have known: `provider: {order:["anthropic"]}`
> is **mandatory** on the Skin rather than advisory, because the unpinned default was a different
> upstream every time; and the Anthropic SDK's `finalMessage()` silently drops `cost` on the
> streaming path, though it is on the wire.

## 2. What we would gain

Taking the proposal at face value, argued fairly:

- **One transport, one code path.** Right now `src/explain.ts`/`src/converse.ts`/`src/search.ts` do
  raw HTTP to OpenRouter (see [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts)) while
  the Anthropic-SDK caller is a second shape with its own error handling, retry behaviour and usage
  fields. One transport means one thing to get right.
- **One usage shape, and `usage.cost` in dollars, on every response, with no per-model price
  table on our side** — confirmed shape, §4 below. Today, cost tracking against the Anthropic SDK
  path means keeping Anthropic's price table (input/output/cache-write/cache-read, per model) in our
  own code and multiplying; against OpenRouter it's `usage.cost` as-is. Collapsing to one path
  removes the price table entirely, not just for OpenRouter's models.
- **One API key, one dashboard, one place logs and cost tracking read from.**
- **Model swapping without a code change.** Already true for the OpenRouter-shaped calls; would
  extend to Sonnet 5.
- **Embeddings and chat models already share the vendor** (voyage-4 is already OpenRouter-only), so
  this removes an asymmetry that exists today rather than introducing a new one.

## 3. What we would lose

### 3.1 CONFIRMED

**Two request shapes exist, and they are not equivalent — the choice between them is the whole
ballgame.** OpenRouter exposes Anthropic models two ways:

1. **OpenAI-shaped `chat/completions`** (`https://openrouter.ai/api/v1/chat/completions`) — what
   this app's three OpenRouter callers already use. `reasoning`, `cache_control`, tool calls, and
   `finish_reason` are all *normalized* into OpenAI's vocabulary before they reach you.
2. **The "Anthropic Skin"** (`https://openrouter.ai/api/v1/messages`, base URL
   `https://openrouter.ai/api`) — documented as speaking Anthropic's native Messages protocol
   directly: *"Claude Code speaks its native protocol straight to OpenRouter, and the Skin handles
   model mapping and passes advanced features through untouched... Thinking blocks, native tool use,
   streaming, and multi-turn context all work as they do against Anthropic directly."*
   ([openrouter.ai/blog/tutorials/claude-code-openrouter](https://openrouter.ai/blog/tutorials/claude-code-openrouter/),
   dated 2026-06-16 on the page). One stated caveat on this endpoint: *"the integration is only
   guaranteed to work with the Anthropic first-party provider"* — i.e. don't expect it to also proxy
   non-Anthropic models with fidelity.

Everything under "what we'd lose" below is a property of choosing (1) over (2). This app's
existing OpenRouter calls already made that choice, for the OpenAI-shaped endpoint — worth
re-deciding rather than carrying forward by default if Sonnet 5 moves over too.

**3.1.1 — Caching silently breaks on the OpenAI-shaped endpoint, repeatedly, in the wild, and
almost always for the same reason: a request shape that looks right and isn't.** A recurring pattern
across independent projects, all within roughly the last year:

- `microsoft/vscode` issue #312939 (opened 2026-04-27, unresolved as of this fetch): GitHub Copilot's
  OpenRouter provider sent a Copilot-specific `copilot_cache_control` field at the message level;
  OpenRouter doesn't recognize it, so every agentic Claude request was billed at full price with no
  cache discount. The report notes the same code path's *native* `AnthropicLMProvider` (i.e. talking
  to Anthropic directly, or presumably the Skin) works correctly — the gap is specific to the
  OpenAI-compatible chat-completions path.
- `OpenRouterTeam/ai-sdk-provider` #389 and #35 — the Vercel AI SDK's OpenRouter provider silently
  drops caching when `system` is sent as a plain string rather than an array of content parts with
  `cache_control` on the block; users report `cache_read_input_tokens` staying at 0 with no error.
- `zed-industries/zed` #52576 — `native_tokens_cached` stays 0 through OpenRouter + Sonnet, closed via
  a Zed-side PR; OpenRouter's actual root cause on their side isn't stated in what's public. (Already
  cited in [prompt-caching-openrouter.md](prompt-caching-openrouter.md).)
- `NousResearch/hermes-agent` #20957 — reports that going through the `chat_completions` wire shape
  specifically drops the cache marker, because *"Anthropic's caching only honors `cache_control` on
  top-level system content blocks in the native `anthropic_messages` format"* when routed that way —
  this is one issue reporter's characterization, not confirmed against OpenRouter's own docs directly,
  so treat as suspected/consistent-with rather than proven.

None of these is "OpenRouter's caching doesn't work" full stop — every fixed/explained one turns out
to be a client sending the wrong shape (wrong field name, string instead of array, wrong endpoint) and
OpenRouter accepting the malformed request without erroring, which is the dangerous part: **it fails
by silently costing more, not by rejecting the request.** This app's own earlier research
([prompt-caching-openrouter.md](prompt-caching-openrouter.md)) independently arrived at the same
conclusion and the same defence: verify with a live call and log `cached_tokens`/`cache_write_tokens`
on every request rather than trusting the absence of an error. That defence generalizes to "moving
everything to OpenRouter" — it doesn't newly need building, but it now needs applying to a fourth
caller (the current Anthropic SDK one).

**3.1.2 — Typed errors are gone; you get HTTP status + a JSON `error.code`/`error.message`, not
Anthropic SDK exception classes.** OpenRouter's error shape
([openrouter.ai/docs/api_reference/errors-and-debugging](https://openrouter.ai/docs/api_reference/errors-and-debugging) —
fetched via search summary only, the direct fetch 404'd; treat this citation as secondary) is:
`error.code`, `error.message`, `error.metadata.provider_name` telling you OpenRouter vs. upstream
failed. The Anthropic SDK's `RateLimitError`, `OverloadedError`, etc. as distinct catchable exception
*types* don't exist on this path — you'd match on the numeric code instead. This app's own
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) already made this trade for its three
existing callers (`providerRefused(status)` maps status → message, deliberately not repeating the
provider's own text — see that file's extensive comments on why) so this isn't a new pattern to
invent, just one more caller adopting a pattern already proven out. Confirmed distinct from Anthropic's
own error taxonomy; not independently verified whether the Skin endpoint (native Messages shape)
returns Anthropic's own error JSON instead — plausible given it claims to pass the protocol through
untouched, but **not confirmed** — see §5.

**3.1.3 — No per-request markup on inference; the fee is on money movement, not on tokens.**
Official FAQ, fetched directly, quoted verbatim: *"no markup on inference pricing"* on inference
itself; **5.5%** (Stripe, $0.80 minimum) or **5%** (crypto) on buying credits; a separate **5%
BYOK fee**, but only above a monthly free allowance (quoted elsewhere as $25k/mo pay-as-you-go,
$200k/mo enterprise — this specific number is from a secondary source, not the FAQ page itself, so
treat the *existence* of the allowance as confirmed and the *size* as unconfirmed).
Note several SEO/aggregator sites returned by search (`ofox.ai`, `flo2.com`, `checkthat.ai`, and
similar) confidently claim "OpenRouter charges a 5.5% fee on every request" — this is **wrong**
per OpenRouter's own FAQ and should be disregarded; it's evidently a confusion between the
credit-purchase fee and a per-inference fee. Worth remembering when weighing any other claim from
that same tier of source below.

**3.1.4 — Anthropic's dedicated `/v1/messages/count_tokens` endpoint has no OpenRouter equivalent.**
OpenRouter's documented alternative is: every response already carries token counts
(`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`) — i.e. you find out the
count *after* paying for the call, not before. If this app relies anywhere on knowing token count
ahead of a call (budget-fitting, truncation decisions), that capability doesn't transfer. **Not
checked** whether the Skin endpoint proxies Anthropic's `count_tokens` — plausible given it claims to
be protocol-transparent, but not found stated anywhere. See §5.

**3.1.5 — `usage.cost` accounting for cache discounts: the field exists, its provenance is thinner
than it looks.** Fetched directly from
[openrouter.ai/docs/use-cases/usage-accounting](https://openrouter.ai/docs/use-cases/usage-accounting),
verbatim shape:

```json
{
  "completion_tokens": 2,
  "completion_tokens_details": { "reasoning_tokens": 0 },
  "cost": 0.95,
  "cost_details": { "upstream_inference_cost": 19 },
  "prompt_tokens": 194,
  "prompt_tokens_details": {
    "cached_tokens": 0,
    "cache_write_tokens": 100,
    "audio_tokens": 0
  },
  "total_tokens": 196
}
```

`cost` is described as "credits charged to your account" — i.e. it's OpenRouter's own billing
figure, computed from the same cached/written/plain token counts sitting right next to it in the same
object, at OpenRouter's list prices for that model (confirmed no-markup, §3.1.3). It should be
*arithmetically* consistent with cache pricing by construction, since OpenRouter has to bill correctly
regardless of whether we read `cost` or compute it ourselves from the token breakdown — but this is
inference from the shape of the response and OpenRouter's stated no-markup policy, not something a
doc states outright as "cost already applies the 0.1×/1.25×/2× cache multipliers." **Not independently
verified against a live call.** `cost_details.upstream_inference_cost` is explicitly "only available
for BYOK requests" — irrelevant unless this app moves to BYOK, which nothing in the proposal implies.

One live discrepancy worth flagging rather than smoothing over: an earlier `WebFetch`-summarized read
of the prompt-caching docs page claimed a `cache_discount` field exists in responses; the direct fetch
of the usage-accounting page (quoted above, more authoritative — it's the page whose whole subject is
the usage shape) shows no such field. Treat `cache_discount` as **not confirmed to exist**; `cost` and
the token-detail breakdown are the two fields to build on.

**3.1.6 — `stop_reason`/`finish_reason` fidelity depends on which endpoint, and reports of loss are
specifically about the OpenAI-shaped one.** Anthropic's own reasons are `end_turn`, `max_tokens`,
`stop_sequence`, `tool_use`, `pause_turn`, `refusal`
([platform.claude.com/docs — Stop reasons and fallback](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)).
Search turned up a claim (secondary source, not an OpenRouter doc page) that going through
OpenRouter's OpenAI-compatible surface maps `refusal` → `content_filter` and has, in at least one
historical case, surfaced Anthropic's own `end_turn` string unmapped where a caller expected OpenAI's
`stop` — i.e. inconsistent normalization on that path, which is exactly the kind of thing a
`chat_completions`-shape adapter gets wrong at the edges. **Not verified against OpenRouter's own
docs directly** — worth a live check (§5) before depending on any particular mapping. The Skin
endpoint, if it's genuinely protocol-transparent as claimed, should return Anthropic's own six values
verbatim; not independently confirmed.

**3.1.7 — Provider-level automatic retry/backoff exists but is coarser than the Anthropic SDK's.**
OpenRouter documents transparent fallback to a backup provider on 429/500/502/503/529-class errors,
*"if an error occurs before any tokens are written — even on a streaming request"* (secondary-source
summary of
[openrouter.ai/docs/api_reference/errors-and-debugging](https://openrouter.ai/docs/api_reference/errors-and-debugging),
not independently fetched — see 3.1.2 on that page's fetch failing directly). That's provider-*level*
retry (try a different upstream), not the Anthropic SDK's request-level retry-with-backoff on the
*same* provider honoring `Retry-After`. For this app specifically, provider fallback is already
turned off by design — `PROVIDER_ORDER = { order: ["anthropic"] }` in
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) is an *ordering preference*, not
`allow_fallbacks: false`, precisely so a cache miss is preferred over an outright failure — so this
app would already get provider fallback if Anthropic itself failed, same as today. Whether OpenRouter
also does same-provider retry with backoff (not just failover) isn't confirmed either way.

**3.1.8 — Service tiers (Anthropic's Priority/Batch) are reachable, but through the `service_tier`
field on Anthropic's *own* protocol, not confirmed on the OpenAI-shaped path.** OpenRouter documents
`service_tier: "flex" | "priority" | "fast" | "default"` at the top level, and separately states this
parameter "is also accepted on... the Anthropic Messages API"
([openrouter.ai/docs/guides/features/service-tiers](https://openrouter.ai/docs/guides/features/service-tiers) —
fetched via search summary, not verified directly). One summary explicitly said service tiers are
"not directly supported for Anthropic models through OpenRouter's native \[chat/completions\]
implementation" but are on the Messages API — consistent with the general pattern in this section: the
Skin preserves Anthropic-specific surface area the OpenAI-shaped endpoint doesn't. Batch API access
specifically through OpenRouter: **not confirmed either way.**

### 3.2 SUSPECTED / not independently confirmed

- **Latency (TTFT) overhead of the extra hop.** No measured numbers found from a credible source.
  Every number found was from SEO-farm content (see the disregarded-source list in §3.1.3) and not
  trusted here. **Needs a live probe** — timing our own requests against both paths on the same model,
  same time of day.
- **OpenRouter-imposed rate limits above Anthropic's own.** Not found documented as a fixed number;
  OpenRouter's error docs (secondary-source summary) distinguish "OpenRouter's own cap" from
  "upstream provider capped you" via whether `error.metadata` names a provider, but no ceiling number
  was found stated anywhere credible.
- **Uptime/incident history.** Aggregator sites (StatusGator and similar) report **99.97% uptime over
  the trailing 30 days** and **3 outages in 2025–2026 of 35–50 minutes each** as of early August 2026
  — treat this as a rough, low-confidence read of third-party monitoring, not an OpenRouter-published
  SLA. Confirmed separately: **OpenRouter does not publish a formal SLA** and offers no downtime
  credits. An OpenRouter outage genuinely can take down an app that direct-Anthropic calls would have
  survived — that's structurally true of any added hop regardless of the specific uptime number, and
  is the one risk in this section that doesn't need a probe to believe.
- **Sticky-routing details beyond what's quoted in §4** — the hashing mechanism is documented (§4),
  but how reliably it holds under real traffic patterns (concurrent readers on different articles,
  OpenRouter's own load-balancing pressure) isn't something docs can answer; it's an operational
  question.

## 4. Prompt caching over OpenRouter — the full answer

This repeats and extends [prompt-caching-openrouter.md](prompt-caching-openrouter.md) (2026-08-26,
already reviewed and load-bearing for this app's existing three OpenRouter callers); new material
here is the endpoint-choice framing (§3.1) and re-confirmation of the field shapes directly against
docs rather than through this app's existing three callers' code comments.

**Request syntax**, confirmed directly from
[openrouter.ai/docs/features/prompt-caching](https://openrouter.ai/docs/features/prompt-caching):

```json
// 5-minute default
"cache_control": { "type": "ephemeral" }

// 1-hour TTL — no beta header needed from the caller (unconfirmed whether
// OpenRouter adds Anthropic's extended-cache-ttl-2025-04-11 header upstream
// itself, or the model in use doesn't require it; not stated either way)
"cache_control": { "type": "ephemeral", "ttl": "1h" }
```

Two modes: automatic (one `cache_control` at the request root, marks the last cacheable block, "the
last cacheable block" advancing forward as a conversation grows) and explicit (per-content-block
`cache_control`, max **4 breakpoints** per request, requires array-shaped `content`).

**Minimum cacheable prefix**, confirmed: 4,096 tokens (Opus 4.5–4.8, Haiku 4.5), 2,048 (Haiku 3.5),
1,024 (Sonnet 4.5/4.6, Opus 4/4.1) — Sonnet 5 isn't in the table verbatim; this app's own
[prompt-caching.md](../project/prompt-caching.md) has independently measured Sonnet 5's floor at
1,024 tokens against the live API, which is the number to trust over the OpenRouter table's silence.

**Response usage shape**, confirmed verbatim from the usage-accounting docs (§3.1.5 above):
`prompt_tokens_details.cached_tokens` (read) and `prompt_tokens_details.cache_write_tokens` (write) —
**both nested inside `prompt_tokens_details`**, not top-level siblings of `prompt_tokens`. This app's
own code ([`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) `Usage` interface) already
reads both a nested and a legacy top-level `cache_write_tokens` defensively, because a live call on
2026-08-26 put the write count in the nested location while an earlier, non-streamed code path had
found it top-level — i.e. this has already moved once in practice and the defensive dual-read is
warranted, not paranoia.

**Pricing**: cache write 5-min = 1.25× base input; cache write 1h = 2×; cache read = 0.1×. Matches
Anthropic's own published multipliers exactly (per
[prompt-caching.md](../project/prompt-caching.md)'s own citation of Anthropic's pricing) — no
OpenRouter-specific surcharge found on cache operations specifically, consistent with the
no-markup-on-inference finding in §3.1.3.

**`usage.cost` and cache pricing**: see §3.1.5 — the field exists, is well-shaped, and should by
construction reflect cache multipliers, but this specific claim ("cost already prices in the cache
discount correctly") was not verified against a live response pair (cold call vs. warm call, diffing
`cost`). **Needs the live probe in §5.**

### Cache routing stability (Q2)

**Documented, from OpenRouter's own sticky-routing blog post**
([openrouter.ai/blog/tutorials/prompt-caching-sticky-routing](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/),
dated **2026-07-21** on the page — five weeks old as of this research, well within the "flag if over
a year" bar, noted anyway since it's the load-bearing citation for this whole subsection):

- **Automatic (default, no config):** OpenRouter "recognizes a conversation by hashing its first
  system or developer message and its first non-system message." Matching hashes route to the same
  upstream that holds the warm cache. This is the mechanism this app's own earlier research
  ([prompt-caching-openrouter.md](prompt-caching-openrouter.md)) already flagged as a poor fit for
  `explain.ts`, since its first user message embeds the reader's selected quote and therefore differs
  on every call for the same article — **confirms**, rather than merely repeats, that earlier finding:
  this is exactly what the blog post's own hashing description implies.
- **Explicit `session_id`** (top-level request field, or `x-session-id` header): *"When you pass it,
  OpenRouter uses it directly as the sticky routing key instead of deriving a key from the opening
  messages."* Sticky routing then "kicks in after the first successful request, before any cache hit
  has happened" (vs. automatic mode, which only starts routing sticky after a cache hit is *observed*
  — i.e. automatic mode's first two calls on a fresh session may not even land on the same upstream).
  Recommended by OpenRouter for agent workflows. Sessions expire after **10 minutes** of inactivity,
  reset by each successful request.
- **Manual pinning** — `provider: { order: ["anthropic"], allow_fallbacks: false }` (secondary-source
  paraphrase of provider-routing behaviour, not independently re-verified this session — but this
  app's own [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) `PROVIDER_ORDER` constant
  already documents, from its own earlier research, that an explicit `order` **overrides** sticky
  routing outright). This app already does this — `order: ["anthropic"]`, deliberately *not*
  `allow_fallbacks: false`, so a provider outage degrades to a slower failure mode rather than a hard
  one.

None of this is folklore-versus-docs the way the task brief worried it might be — the hashing
description is stated plainly in OpenRouter's own post, matches what this app's earlier research had
inferred independently, and the `session_id` field is real and named exactly that. The one thing not
confirmed: whether `session_id` and `provider.order` combine (does pinning a provider make
`session_id` redundant, or do they solve different problems — provider identity vs. within-provider
session affinity across OpenRouter's own internal routing)? Not found stated either way.

## 5. Open questions that need a live probe, not another doc read

1. **Does `usage.cost` on a cache-warm call actually reflect the 0.1× read discount?** Fire the same
   request twice (cold, then warm within 5 min), diff `cost` and `prompt_tokens_details`. This is the
   single most load-bearing unconfirmed claim in this doc, because it's the entire premise of the
   "route everything through OpenRouter for free cost tracking" proposal.
2. **Does the Anthropic Skin (`/api/v1/messages`) response carry `usage.cost`, or only Anthropic's
   native usage counters (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
   `cache_read_input_tokens`)?** If the Skin doesn't carry `cost`, the two goals — "keep Anthropic
   fidelity" and "get `usage.cost` for free" — are in tension and this app would have to choose, or
   compute cost itself for calls on the Skin path while reading it for free on the chat-completions
   path. This is the caveat the three-sentence verdict in §1 is built around.
3. **Does the Anthropic Skin proxy `/v1/messages/count_tokens`?** Not found stated. Matters only if
   this app currently or plans to rely on pre-flight token counts.
4. **Does the Skin return Anthropic's typed error bodies (so an SDK-shaped error handler could work
   against it), or OpenRouter's own `error.code`/`error.message` shape regardless of endpoint?**
5. **Actual TTFT overhead**, OpenRouter vs. Anthropic direct, same model, timed back to back.
6. **Whether `session_id` is needed in addition to `provider.order: ["anthropic"]`** for this app's
   specific call patterns, or whether pinning alone is sufficient — a live multi-call test against one
   article, reading `cached_tokens` back, the same eval methodology this app's own
   [`npm run eval:caching`](../project/prompt-caching.md#how-to-tell-whether-it-is-working) already
   uses for its three existing OpenRouter callers.


## 5a. Answered — live probes, 2026-08-27

Run by the main agent against the real API with the app's own key, after this doc was written. Every
number below was **produced by OpenRouter or by Anthropic**, not by our code. Item numbers match §5.

### The headline: the Skin returns Anthropic's native usage shape *and* OpenRouter's `cost`

Answers §5.2, which the §1 verdict was built around. `POST https://openrouter.ai/api/v1/messages`,
non-streamed, `usage` verbatim:

```json
{"input_tokens":40,"output_tokens":600,
 "output_tokens_details":{"thinking_tokens":0},
 "cache_creation_input_tokens":0,"cache_read_input_tokens":0,
 "cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0},
 "inference_geo":null,"server_tool_use":null,
 "service_tier":"standard","speed":"standard",
 "cost":0.00608,"is_byok":false,
 "cost_details":{"upstream_inference_cost":0.00608,
   "upstream_inference_prompt_cost":0.00008,
   "upstream_inference_completions_cost":0.006}}
```

**There is no tension to resolve.** Anthropic's additive counters, the 5m/1h split, `service_tier`
and `inference_geo` — the three fields we had thought were the reason to keep calling Anthropic
directly — all arrive, with `cost` beside them. Note also `is_byok:false` with
`upstream_inference_cost` populated, which reconfirms that the BYOK caveat in §3.1.5 applies to the
async `/generation` lookup rather than to the sync response.

### §5.1 — `cost` does reflect the cache discount

Same request twice, a ~13.9k-token system block with one `cache_control` breakpoint, through the
Skin:

| | `input_tokens` | `cache_creation` | `cache_read` | `cost` |
|---|---|---|---|---|
| cold | 13 | 13,863 | 0 | 0.0347235 |
| warm | 13 | 0 | 13,863 | 0.0028386 |

Checked against the list prices in [`src/pricing.ts`](../../src/pricing.ts):
cold `13×$2 + 13863×$2.50 + 4×$10` per Mtok = **0.0347235**; warm `13×$2 + 13863×$0.20 + 4×$10` =
**0.0028386**. Exact to seven decimal places, both. The 1.25× write and 0.1× read multipliers are
applied, and a 12.2× drop between cold and warm is the discount arriving.

### §5.4 — the Skin validates against Anthropic's schema, but does not reject unknown keys

`thinking: {"type":"banana"}` is refused with `invalid_request_error`, and the error body enumerates
the permitted values — `"enabled"`, `"disabled"`, **`"adaptive"`**. So `thinking` is genuinely parsed
on this path rather than accepted and ignored, and adaptive is a first-class option.

The error envelope is Anthropic-shaped (`{"type":"error","error":{"type":"invalid_request_error",…}}`)
with OpenRouter's own detail in a `metadata.raw` field alongside.

**But a control run matters more than the acceptance did:** a made-up top-level key
(`"spideryarn_nonsense": true`) is accepted silently, 200, no complaint. So *"OpenRouter accepted my
request"* is never evidence that OpenRouter honoured a field. Only an observable change in the
response is.

### §5.6 — `provider` pinning works on the Skin, and the default is not Anthropic

Applying exactly that rule. Three calls, identical but for the `provider` key:

| request | upstream that answered | `cost` |
|---|---|---|
| no `provider` key | Claude Platform on AWS | 0.000182 |
| `{"order":["anthropic"]}` | **Anthropic** | 0.000082 |
| `{"only":["anthropic"]}` | **Anthropic** | 0.000082 |

The upstream *changed*, so the field was honoured — which the bogus-key control above is what makes
that inference safe. Two consequences:

1. **`PROVIDER_ORDER` is mandatory on this path, not advisory.** A cache lives on the upstream that
   wrote it. Unpinned, the default here was a different upstream on every probe, so an unpinned
   migration would look like it worked and quietly never hit a cache — precisely the failure §3.1.1
   catalogues, arrived at from a new direction.
2. **The same model bills differently by upstream.** Flagged, not explained: two identical 16-token
   calls, 0.000182 via AWS against 0.000082 via Anthropic. Too small a sample to draw a rate from,
   large enough that a cost model must record *which upstream answered* — `provider` is on the
   response and should be a column.

### The one that was not on the list: streaming drops `cost` from `finalMessage()`

The seven pipeline stages all use `client.messages.stream(...)` and read `finalMessage()`. Pointing
the **Anthropic SDK itself** at the Skin works — `baseURL: "https://openrouter.ai/api"` with
`authToken` — and streaming, `cache_control`, adaptive thinking and native `stop_reason` all survive.
But:

```
finalMessage() usage.cost: (absent)
captured from raw streamEvent -> cost: 0.018773
```

`cost` **is** on the wire, in the `message_delta` event, next to the full native usage object. The
SDK's `finalMessage()` merges only the fields its own types know about and silently drops the rest.
One `stream.on("streamEvent", …)` handler recovers it.

This is the trap on this route, and it is the [silent-success](../reusable/silent-success.md) shape
exactly: everything works, the cost column is `null`, and nothing anywhere errors. Whatever gets
built here needs a test that fails when `cost` stops arriving.

### Still open

- §5.3 (does the Skin proxy `count_tokens`) — **not probed, and not needed.** Nothing in `src/`
  calls it; [`src/token-budget.ts`](../../src/token-budget.ts) deliberately estimates instead, and
  [`src/labels.ts:722`](../../src/labels.ts) says why.
- §5.5 (TTFT overhead) — not measured.
- Whether a real `stop_reason: "refusal"` comes back verbatim on the Skin. `max_tokens` and
  `end_turn` both do, so it very likely does, but a refusal could not be triggered deliberately and
  seven stages branch on it.

## 6. Does anyone credible run Anthropic-only production traffic through OpenRouter? (Q5)

Findings here are thin and mixed confidence — this was the least well-documented of the five
questions. Nothing found rises to "a named production app publishing that they route 100% of
Anthropic traffic through OpenRouter and it works" or a clear "and here's why we moved back."

- Claude Code itself is documented, by OpenRouter, to support exactly this pattern (Anthropic-only,
  full fidelity claimed) via the Skin, and Anthropic's own Claude Code product is the most scrutinized
  consumer of the Messages protocol that exists — if the Skin silently dropped thinking blocks or tool
  use, that would likely have surfaced loudly given Claude Code's usage volume. This is inference,
  not a citation of anyone stating "we verified this in production," so treat it as suggestive rather
  than proof.
- One Hacker News thread (undated in what was retrieved) describes OpenRouter's Cloudflare protection
  blocking specific raw HTML/JS payloads in POST bodies that succeed against OpenAI/Anthropic direct —
  a real, if narrow, reliability difference, not caching- or fidelity-related.
- One blog post (Charles Jones, `charlesjones.dev`) describes migrating a personal agent setup
  (OpenClaw) *to* OpenRouter specifically because Anthropic changed subscription-based billing
  support, then separately notes considering moving back off OpenRouter over provider-outage
  concerns, landing on "I'd rather have redundancy than depend on one provider's decisions" — a
  single-operator anecdote, not a case study with numbers, and it's arguing information in both
  directions depending which paragraph you read.

**Could not confirm** a clear "moved production traffic to OpenRouter-only, and here's the outcome"
account either way. This question is better answered by this app's own live probes (§5) than by
searching further — the population of "companies running Anthropic-exclusively through OpenRouter and
writing about it" appears to be small to nonexistent in public writing as of this date.

## 7. Sources

Fetched or searched 2026-08-27 unless noted.

- [openrouter.ai/docs/features/prompt-caching](https://openrouter.ai/docs/features/prompt-caching) — fetched directly
- [openrouter.ai/docs/guides/best-practices/prompt-caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching) — referenced, not re-fetched this session (already used in prompt-caching-openrouter.md, 2026-08-26)
- [openrouter.ai/docs/use-cases/usage-accounting](https://openrouter.ai/docs/use-cases/usage-accounting) — fetched directly, verbatim JSON quoted §3.1.5/§4
- [openrouter.ai/docs/features/provider-routing](https://openrouter.ai/docs/features/provider-routing) — fetched directly
- [openrouter.ai/blog/tutorials/prompt-caching-sticky-routing](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/) — fetched directly, dated 2026-07-21 on page
- [openrouter.ai/docs/guides/best-practices/reasoning-tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) — fetched directly
- [openrouter.ai/docs/guides/features/service-tiers](https://openrouter.ai/docs/guides/features/service-tiers) — fetched via search summary, not re-verified directly
- [openrouter.ai/docs/api_reference/errors-and-debugging](https://openrouter.ai/docs/api_reference/errors-and-debugging) — direct fetch returned 404; content here is from search-engine summary only, lower confidence
- [openrouter.ai/docs/faq](https://openrouter.ai/docs/faq) — fetched directly, fee structure §3.1.3
- [openrouter.ai/blog/tutorials/claude-code-openrouter](https://openrouter.ai/blog/tutorials/claude-code-openrouter/) — fetched directly, dated 2026-06-16 on page
- [platform.claude.com/docs/en/build-with-claude/handling-stop-reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) — via search summary
- `github.com/microsoft/vscode` issue #312939 — fetched directly, opened 2026-04-27, unresolved as of fetch
- `github.com/OpenRouterTeam/ai-sdk-provider` issues #389, #35 — via search summary
- `github.com/zed-industries/zed` issue #52576 — via search summary (already cited in prompt-caching-openrouter.md)
- `github.com/NousResearch/hermes-agent` issue #20957 — via search summary, characterization not independently verified
- Hacker News item 43793743 — via search summary, undated in retrieval
- `charlesjones.dev` blog post on OpenClaw/OpenRouter migration — via search summary
- StatusGator (`statusgator.com/services/openrouter`) and similar aggregators — via search summary, low confidence, used only for the rough uptime figure in §3.2, explicitly flagged as such
- Disregarded as unreliable: `ofox.ai`, `flo2.com`, `checkthat.ai`, `truefoundry.com`, `usagepricing.com`, `apimart.ai` and similar SEO/aggregator "OpenRouter pricing 2026" posts — several make claims (e.g. a per-request 5.5% fee) directly contradicted by OpenRouter's own FAQ; treated as unreliable throughout and not cited for anything not independently corroborated
- This app's own prior research, load-bearing and re-confirmed rather than re-derived:
  [docs/research/prompt-caching-openrouter.md](prompt-caching-openrouter.md) (2026-08-26),
  [docs/project/prompt-caching.md](../project/prompt-caching.md)
