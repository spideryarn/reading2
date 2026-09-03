Verdict: the Postgres aggregation is broadly sound, but this is not yet safe as Stripe-grade accounting. Two findings can materially overstate contribution margin.

## Findings

- **[P1] Realtime reports can be accepted at zero or negative cost.** [`parseRealtimeUsage`](</home/greg/code/spideryarn2/src/live.ts:867>) permits modality details to sum to less than their parent totals, but [`priceResponseRow`](</home/greg/code/spideryarn2/src/live.ts:1160>) prices only those details. I directly produced:

  - `inputTokens=1000`, `outputTokens=200`, all modality details zero → accepted with `computedCostNanos=0`.
  - `inputTextTokens=100`, `cachedTextTokens=1000` → accepted with `computedCostNanos=-3,200,000`.

  Cached details are bounded by `cachedTokens`, not their corresponding text/audio totals. [`wholeOrNone`](</home/greg/code/spideryarn2/src/web/live/meter.ts:109>) also turns malformed present values into zero, despite claiming to default only absent values. Require complete priced splits or mark the row unpriced; separately enforce `cachedText <= inputText`, `cachedAudio <= inputAudio`, and non-negative costs in Postgres.

- **[P1] “Monthly contribution margin” compares a full monthly price with arbitrary—or incomplete—spend.** [`--price`](</home/greg/code/spideryarn2/scripts/ai-cost.ts:156>) is accepted with custom ranges and even `--all`; [`printMargin`](</home/greg/code/spideryarn2/scripts/ai-cost.ts:774>) blindly subtracts that period’s cost from one monthly price. Worse, the default current-month range extends to next month, so on September 2 it reports `$20 minus two days’ spend` as monthly margin. Refuse `--price` for incomplete/non-monthly periods, or rename it to a price for the selected period.

- **[P2] Historical spreads use today’s account population.** [`accountDenominator`](</home/greg/code/spideryarn2/scripts/ai-cost.ts:885>) includes every currently live Auth account regardless of the report’s `until`. A later signup therefore enters an August report as zero spend, while an account subsequently deleted disappears from it. Historical median/p95 figures will change over time. At minimum filter on the already-available `createdAt`; Stripe ultimately needs the subscriber population active during the billing interval.

- **[P2] Realtime coverage and realtime spend use different cohorts.** Spend is bounded by `ai_calls.started_at`, while [`realtimeSessionCoverage`](</home/greg/code/spideryarn2/src/store/ai-calls-spend-pg.ts:367>) bounds sessions by `issued_at`, and its `NOT EXISTS` examines calls from all time. A session issued before the range but used inside it contributes cost with no session; one issued inside but used just after it is considered non-silent although its cost is absent. This becomes routine at billing boundaries.

- **[P2] The write seam can still construct a CHECK-invalid cost row.** The BYOK normalization itself matches the migration’s three-part predicate exactly. However, [`SpendRecord`](</home/greg/code/spideryarn2/src/ai-spend.ts:48>) permits both `costNanos` and `computedCostNanos`; [`costSourceOf`](</home/greg/code/spideryarn2/src/ai-spend.ts:277>) chooses `provider`, while the projection still copies the computed value. Postgres then rejects it under [`ai_calls_one_cost_source`](</home/greg/code/spideryarn2/drizzle/0023_ai_calls_cost_provenance.sql:53>), losing the ledger row. Current gateway callers avoid the shape, but the public contract does not. Make provenance a discriminated union.

- **[P2] Legacy JSONL translation does not match the migration predicate.** [`translateByokUpstream`](</home/greg/code/spideryarn2/src/store/ai-calls-fs.ts:143>) preserves the old value whenever `isByok === true`; the migration additionally requires `cost_source='provider'` and `provider_account='openrouter'`. Thus an old BYOK-shaped `cost_source:'none'` row with a non-null upstream value becomes invalid and is counted unreadable rather than retained with a null upstream value. BYOK rows whose upstream value was null are handled correctly. The current 565-line corpus lacks the failing shape, but the historical parser could produce it because those fields were captured independently.

- **[P2] The category report’s “credits” column is not credits.** [`printCategories`](</home/greg/code/spideryarn2/scripts/ai-cost.ts:675>) labels the column `credits` but prints `totalNanos`—credits + BYOK + computed. Also, the unclassified headline uses uplifted cash while its detail lines use raw totals, so they need not reconcile. Separately, the note claiming p95 “IS the most expensive account” is false once the population reaches 20.

- **[P3] Idempotency holds in Postgres, but not in the filesystem ledger.** Postgres’s deterministic ID plus `ON CONFLICT DO NOTHING` correctly absorbs a lost-acknowledgement retry. [`fsCostStore.record`](</home/greg/code/spideryarn2/src/store/ai-calls-fs.ts:264>) appends both copies, however, and [`read`](</home/greg/code/spideryarn2/src/store/ai-calls-fs.ts:278>) does not deduplicate them. The test explicitly permits duplicate rows and checks only that their IDs match. Any filesystem `totalRows()` call counts both.

## Checks that hold

- The BYOK CHECK and normal production projection agree.
- The test-ledger adapter is resolved per method call; I found no captured adapter or destructured implementation that defeats it.
- `unknown` is prominent and remains included in totals and product spread. A new `AiJob` does not disappear, so refusing all non-empty `unknown` would be the wrong invariant.
- Nearest-rank calculation and `price - p95(cost)` direction are correct.
- The cash uplift touches only `creditsNanos`; BYOK upstream and computed spend are not uplifted.

The cash number remains an allocation estimate, not bank-statement cash: OpenRouter documents a 5.5% card fee with a minimum and different crypto pricing, plus a separate BYOK fee after the free request allowance. [OpenRouter FAQ](https://openrouter.ai/docs/faq), [BYOK guide](https://openrouter.ai/docs/guides/overview/auth/byok). Track actual purchases/fees before Stripe depends on it. Also, OpenAI’s current model page does publish image pricing, so “no image price exists” is stale, although refusing images while the session disables them remains safe. [GPT Realtime 2.1 pricing](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)

Validation: typechecking passed; 177 focused tests passed. Route and Postgres integration checks were blocked by this sandbox’s read-only/network restrictions. The required independent GPT Sol review likewise could not initialize because its app-server needed filesystem access. No files were changed.