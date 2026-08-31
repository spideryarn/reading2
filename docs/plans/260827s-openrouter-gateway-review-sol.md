# Verdict

Greg’s position wins.

The previous “no, feature loss” argument was weak and is now partly obsolete. OpenRouter currently supports:

- Anthropic’s Messages shape through the Anthropic SDK
- adaptive thinking and per-stage effort
- prompt caching
- Anthropic-style fallbacks
- half-price Sonnet 5 batch inference

I would route all normal inference through OpenRouter, but keep the direct-Anthropic adapter until one live contract probe passes. Do not rewrite the seven stages into OpenAI Chat Completions unnecessarily: point the existing Anthropic SDK at OpenRouter’s `/api/v1/messages`.

## 1. How much actually disappears?

A substantial amount.

The current [pricing module](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pricing.ts:1) is 406 lines. Its [test file](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/pricing.test.ts:52) is 298 lines and currently has **25 tests**, not the plan’s stale count of 20.

With every call using OpenRouter’s provider-reported cost:

- Delete the model price table and effective dates.
- Delete `priceAnthropicCall`.
- Delete `crossCheckOpenRouter`.
- Delete `costDrift`.
- Delete additive-versus-subtractive cache arithmetic.
- Delete `price_version` and `cost_computed_nanos`.
- Delete the planned Anthropic Admin Cost API reconciliation.
- Delete 22 of the 25 pricing tests.
- Move the roughly five-line `providerCostToNanos` conversion and its three tests into the recorder.

So yes: [the plan’s two reconciliations](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:845) collapse to one provider-cost path. That is real simplification, not slideware.

What remains:

- The call lifecycle: running/ok/error/aborted.
- Raw token and cache counts for diagnosis.
- Missing final usage on aborted streams.
- Generation IDs and later recovery.
- Account reconciliation: stored call totals versus OpenRouter Activity/export.
- Cash accounting. OpenRouter says `usage.cost` is credits consumed, while buying credits incurs a 5.5% fee. Therefore inference attribution becomes trivial, but bank-cash accounting is still roughly `credits × 1.055`—our arithmetic from OpenRouter’s published fee. [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting), [fee FAQ](https://openrouter.ai/docs/faq).

“One transport” also does not mean one response shape. You still have Chat SSE, Chat JSON, embeddings, and—if you preserve native stage semantics—Anthropic Messages. The cost seam becomes uniform; the protocol seam does not.

## 2. What breaks or degrades?

### Adaptive thinking: CONFIRMED preserved

This was the weakest part of the earlier objection.

OpenRouter now documents that on Claude 4.6+:

```json
{
  "reasoning": {
    "enabled": true,
    "effort": "high"
  }
}
```

uses adaptive thinking and maps `effort` to Anthropic’s `output_config.effort`. Omitting `reasoning.max_tokens` is important; setting it selects obsolete budget-based behavior on older models. Sonnet 5 itself rejects manual `budget_tokens`. [OpenRouter’s Claude migration guide](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/claude-4-6), [Anthropic’s Sonnet 5 documentation](https://platform.claude.com/docs/en/docs/about-claude/models/whats-new-sonnet-5).

Better still, OpenRouter’s `/api/v1/messages` accepts `thinking` and `output_config` directly, so the seven stages need not translate them at all. OpenRouter officially demonstrates using `@anthropic-ai/sdk` with `baseURL: "https://openrouter.ai/api"`. [OpenRouter Messages/SDK documentation](https://openrouter.ai/docs/guides/routing/model-fallbacks).

Guessing one fixed effort would be wrong. Spideryarn’s own quality eval recorded arc losing 11 vocabulary-retention points at medium, while glossary at high spent 4,558 additional output tokens and became more formulaic. Those are Spideryarn eval figures, not provider arithmetic; the resulting intentional split is recorded in [models.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:588).

### Refusal mapping: UNKNOWN until probed

For OpenAI-shaped Chat Completions, do not assume refusal becomes `finish_reason: "refusal"`. The normalized field generally uses values such as `stop`, `length`, `content_filter`, and `error`; `native_finish_reason` is where the original value may survive. The shared [StreamChunk type](/Users/greg/Dropbox/dev/experim/spideryarn2/src/openrouter-stream.ts:361) currently drops `native_finish_reason`.

The Messages endpoint’s schema includes `stop_reason: "refusal"` and `stop_details`. But its published example is internally contradictory: it shows `stop_details.type: "refusal"` alongside `stop_reason: "end_turn"`. That makes runtime behavior **UNKNOWN**, despite the intended schema. [OpenRouter Messages reference](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages?explorer=true).

If refusal silently stops arriving, every stage tries to parse refusal prose as JSON:

| Stage | Consequence |
|---|---|
| ToC | Misreported JSON parse failure instead of `MODEL_REFUSED`. |
| Arc | Generic parse failure; correct reader-facing refusal disappears. |
| Tweets | Same. |
| Glossary | Same. |
| Ideas | Same, potentially confused with malformed/unanchored output. |
| Labels | May classify it as incomplete, buy a second call, then report “failed twice.” See [labels.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/labels.ts:1368). |
| Summaries | Worst case: treats refusal as a repairable parse error, buys another call, then silently salvages the batch as missing summaries. See [summarise.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:931). |

This is the only feature concern I consider genuinely decision-relevant.

### Maximum tokens: CONFIRMED mechanical, with streaming traps

Mapping `stop_reason: "max_tokens"` to Chat’s `finish_reason: "length"` is mechanical.

The traps are implementation details:

- Capture the terminal choice before a final usage-only chunk whose `choices` is empty.
- Treat EOF without a terminal reason as a transport failure.
- Check `length` before attempting JSON parsing.
- Preserve Anthropic’s separate context-window-exceeded case.

Using `/messages` avoids even this translation.

### Typed errors and retries: CONFIRMED replaceable

Pointing the existing Anthropic SDK at OpenRouter preserves `APIError`, `err.status`, `finalMessage()`, and SDK retries. The SDK retries connection failures, 408, 409, 429, and 5xx twice by default. [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript).

Therefore [anthropic-call.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/anthropic-call.ts:44) need not disappear. Its safe status mapping remains useful; only its provider description changes.

Rewriting the stages to raw `fetch` would regress reliability unless a central retry layer replaces that behavior. The existing raw callers are inconsistent: embeddings retries 429/5xx, PDF reading retries thrown transport failures, and the streamed request-path callers generally do neither.

### Batch pricing: CONFIRMED not foreclosed

The previous claim that OpenRouter prevents half-price Batch is stale.

OpenRouter currently lists Claude Sonnet 5 Batch at **$1/M input and $5/M output**, versus $2/$10 normally—prices published by OpenRouter. It also exposes a beta async Batch API supporting `/v1/messages`. [OpenRouter Anthropic catalog](https://openrouter.ai/anthropic), [Batch API example](https://openrouter.ai/openai/gpt-5.6-luna%3Abatch/api).

The caveat is operational:

- It is a separate submit/poll/results workflow, not merely a `service_tier` switch.
- OpenRouter’s API is beta.
- Direct Anthropic Message Batches are mature and supported directly by the SDK.
- Batch removes useful streaming progress, though that matters little for unwatched work.

So Batch is no longer a cost argument against OpenRouter. It is an argument for keeping the direct adapter available until OpenRouter’s beta path proves reliable.

## 3. The strongest case for all-OpenRouter

The steelman is strong:

- One account, bill, usage vocabulary, spend-control system, and activity feed.
- Provider-reported per-call cost for all twelve actual paid call sites.
- No price-table maintenance or silent price drift.
- One place to create per-user keys and budgets.
- Easy model substitution.
- Provider-level and model-level failover during an Anthropic outage.
- Existing prompt caching already works.
- Adaptive thinking and stage-specific effort now work.
- Batch work does not intrinsically require native Anthropic ownership.
- Pipeline stages are JSON-producing background jobs; they care less about latency and transport purity than request-path calls do.

OpenRouter fallback is genuinely useful, but pipeline requests should add `require_parameters: true`; its default is false, while `allow_fallbacks` defaults true. Otherwise availability can silently win over caching/reasoning compatibility. [Provider-routing defaults](https://openrouter.ai/docs/guides/routing/provider-selection).

The costs are vendor concentration, another network hop, the credit-purchase fee, and reliance on OpenRouter’s parameter translation and beta Batch implementation. An OpenRouter outage would now affect both ingest and interactive reading.

“One rate-limit budget” is also double-edged: label fan-out could starve chat. Use separate OpenRouter keys/budgets for interactive and pipeline traffic under the same account.

## 4. Ranked options

1. **OpenRouter as the normal path, retaining Anthropic-shaped Messages.** Point the existing Anthropic SDK at OpenRouter. Keep the transport-neutral recorder and a dormant direct-Anthropic configuration until the probe and production canary pass. Best balance.

2. **Keep both transports behind one normalized cost seam.** Lowest migration risk, but retains the price table and daily reconciliation. Use if the Messages probe fails.

3. **Temporary staged migration.** Move ToC and summaries first because they have no explicit cache sharing. Move arc and tweets together; splitting them loses their shared cached prefix. Labels should move last because its parallel batching and retry semantics are touchier. Acceptable rollout plan, poor permanent architecture.

4. **Rewrite all callers to OpenAI-shaped Chat Completions.** Unnecessary translation work and creates the refusal ambiguity. Inferior to using OpenRouter’s Messages endpoint.

5. **Move everything direct to Anthropic.** Worst option. PDF reading uses Luna, embeddings use Voyage, and request-path features use OpenRouter-specific routing. “One direct SDK” would actually become several vendors, keys, bills, retry policies, and usage shapes.

## 5. The measurement that settles it

Run one OpenRouter Messages contract matrix through the existing Anthropic SDK configured with:

```ts
new Anthropic({
  baseURL: "https://openrouter.ai/api",
  apiKey: OPENROUTER_API_KEY,
});
```

Send the exact current stage fields:

```json
{
  "model": "anthropic/claude-sonnet-5",
  "thinking": { "type": "adaptive" },
  "output_config": { "effort": "high" },
  "provider": {
    "order": ["anthropic"],
    "allow_fallbacks": true,
    "require_parameters": true
  }
}
```

Make four cheap calls:

1. A normal JSON request with a cache breakpoint.
2. The identical request again within five minutes.
3. A prompt already verified directly against Anthropic to produce `stop_reason: "refusal"`.
4. A deliberately tiny `max_tokens` request guaranteed to truncate.

Inspect the raw response—not only SDK types—for:

- `usage.cost`, finite and non-null
- cold `cache_creation_input_tokens`
- warm `cache_read_input_tokens`
- `output_tokens_details.thinking_tokens`
- `stop_reason: "refusal"` or an unambiguous equivalent
- `stop_details.type: "refusal"`
- `stop_reason: "max_tokens"`
- `provider` and `openrouter_metadata.attempt`
- `X-Generation-Id` for later recovery

Then repeat those bodies through OpenRouter’s beta Batch API using the `/v1/messages` skin and confirm per-item cost and refusal fields.

Why this is decisive: OpenRouter’s generic accounting documentation says every response includes `usage.cost`, but its Messages response schema currently omits that field; its refusal example is also contradictory. Those are documentation conflicts, not details to reason through.

If Messages preserves refusal/truncation and reports recoverable per-call cost—including Batch—I would migrate all seven stages. If either cost or refusal is absent/ambiguous, I would retain both transports and the current normalized-cost plan.