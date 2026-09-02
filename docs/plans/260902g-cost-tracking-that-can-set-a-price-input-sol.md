The blunt answer: do not set the price from the current aggregate data. Stripe plumbing can proceed, but Stripe must not treat `ai_calls` as a billing ledger. Fix the measurement population, add a slim realtime meter, run controlled journeys, then price with a large margin.

Your broader product conclusion is right: uploads are not the main cost driver. Engagement is—and voice is in a different economic class from everything else.

## 1. Sequencing

Your instinct is mostly right. I would do this in order:

1. **Make totals and populations trustworthy.**

   - Stop the BYOK double-count trap.
   - Stop tests writing to the real ledger and remove the known fixture rows—with Greg’s approval before the delete.
   - Declare Postgres authoritative for pricing. Either import legitimate filesystem history once or set a clean measurement cutoff; do not build a permanent union of two ledgers.
   - Fix `web_searches`, `jobSpend()`’s missing `computed`, and unpriced counts in breakdowns in the same pass. They are small, known defects.

2. **Add the slim realtime meter.**

3. **Run defined cold journeys** across representative articles and voice sessions.

4. **Build the pricing aggregate and choose a provisional price.**

Live conversation should not go first because there are no users whose spend is being lost. But it must be instrumented before the pricing experiment: it is too large to extrapolate safely.

One correction: the individual OpenRouter `usage.cost` values are not wrong. The current aggregate is wrong because its population and total expression are wrong.

## 2. Realtime design: keep the parent, cut the outbox

The full design is appropriate for invoices, overages, quotas, or customer-visible usage statements. For an alpha pricing estimate, IndexedDB persistence and ack recovery are excessive.

But I would not reduce it to completely stateless best-effort posts. Keep a minimal `realtime_sessions` row because it cheaply buys four important things:

- A denominator: sessions that produced zero reports remain visible.
- Server-owned owner, article, model, pricing version, and start time.
- A trustworthy wall-clock sanity bound.
- A session ID for grouping `ai_calls.run_id`.

The alpha version I would build is:

- Create the session row when minting the OpenAI client secret.
- Post every `response.done` immediately.
- Post every completed input-transcription usage event separately.
- Authenticate every post and look up the session server-side.
- Compute dollars server-side.
- Use provider response/event IDs as idempotency keys.
- Keep a small in-memory retry queue while the tab lives.
- Use `fetch(..., { keepalive: true })` or `sendBeacon` on teardown as a final hint.
- Make session close best-effort.
- Do not build IndexedDB yet.
- Do not add `usageSource` yet. When sideband exists, add it and deterministically backfill earlier realtime rows as `client_report`.
- Keep realtime as a first-class paid seam, but it need not be a separate module with one caller. The authenticated endpoint can be that seam until extraction earns its keep.

What this loses:

- The final turn can disappear on a crash or immediate tab close.
- Reports produced during an outage disappear when the tab goes away.
- A partially reported session does not reveal exactly how many turns are missing.
- The aggregate is biased downward by an unknown—but probably small—amount.

I would accept that for controlled pricing experiments and early alpha telemetry. I would regret omitting the session row and idempotency; I would not regret postponing IndexedDB. Add the durable outbox before usage affects an allowance, an invoice, or a promise made to users.

Also, “token counts only” is too narrow. OpenAI’s transcription event schema permits token-based or duration-based usage, and `gpt-live-transcribe` is currently listed at $0.017 per audio minute. Accept a discriminated usage projection containing either token detail or seconds—still never dollars. [Realtime server events](https://developers.openai.com/api/reference/resources/realtime/server-events), [GPT Live Transcribe pricing](https://developers.openai.com/api/docs/models/gpt-live-transcribe).

## 3. Trusting the browser

Yes. For aggregate pricing analysis with no entitlement consequences, browser-reported usage is sufficient.

The cheapest worthwhile validation is:

- Session belongs to the authenticated owner and has not expired.
- Provider IDs are non-empty, bounded strings and unique.
- Counts are non-negative safe integers.
- Detail counts do not exceed their parent totals.
- Per-response input does not exceed the model context and output does not exceed configured maximum output.
- Transcription duration does not exceed session wall-clock plus generous tolerance.
- Model, article, owner, timestamps, and pricing version come from the server/session.
- Invalid reports are rejected and logged by safe identifiers; never silently clamped.

Do not impose one cumulative “tokens per session minute” ceiling. Realtime rebills conversation context on later turns, including the article, so cumulative input can grow much faster than wall-clock. Bound each response against the context window and bound actual audio/duration against elapsed time.

Current official limits for `gpt-realtime-2.1` are a 128k context and 32k maximum output; its published audio rates remain $32/$0.40/$64 per million input/cached-input/output audio tokens. [OpenAI’s model page](https://developers.openai.com/api/docs/models/gpt-realtime-2.1).

## 4. Double counting

Choose **(b), enforced by a CHECK**. Do not add a view yet.

`upstream_inference_nanos` is only additive when `is_byok = true`. On non-BYOK calls it is merely a component already included in `credits_used_nanos`, and nothing currently uses that component diagnostically.

Therefore:

- Write upstream cost only for BYOK rows.
- Null it for non-BYOK rows.
- Clean the existing non-BYOK values.
- Add a constraint equivalent to:

```sql
upstream_inference_nanos IS NULL
OR (
  cost_source = 'provider'
  AND is_byok IS TRUE
  AND provider_account = 'openrouter'
)
```

- Prefer renaming it to `byok_upstream_nanos` while the schema is young.

Then the correct numeric total becomes structurally boring:

```sql
COALESCE(credits_used_nanos, 0)
+ COALESCE(byok_upstream_nanos, 0)
+ COALESCE(computed_cost_nanos, 0)
```

Unpriced coverage remains a separate count.

Option (a) alone cannot help because the three columns are not conceptually exclusive today. Option (c) encodes the conditional but preserves misleading raw data. A view is also optional and bypassable. Normalize the row so the obvious sum is correct.

## 5. Test pollution

Do not add `is_test`, invent a `scope_kind`, or merely filter test rows in reports. Environment and business scope are different dimensions, and every future query would have to remember the exclusion.

Do not refuse writes either; that would stop route tests exercising the metering lifecycle.

For now, reuse the solution that already exists:

- When running under the test harness, make the selected `costStore` use the disposable filesystem test ledger even when the application store is Postgres.
- Keep direct tests of `pgCostStore` against Postgres, with explicit cleanup.
- Delete the known fixture rows once, after approval.

That separates broad request tests from the persistent ledger while retaining focused Postgres adapter coverage. If the entire integration suite later needs stronger isolation, create a dedicated test database for the whole app. A special schema just for `ai_calls` would be the wrong intermediate architecture.

## 6. Unpriced rows

Add a computed fallback only when the row contains enough billable facts to support one.

Good:

- Complete or partial token details are present.
- The answered route/model and applicable pricing are known.
- Web-search charges and cache categories are accounted for.
- The result is stored as `cost_source='computed'` with `price_version`.
- Non-`ok` outcomes are explicitly reported as lower bounds.

Bad:

- Pricing an unknown OpenRouter route from `ANTHROPIC_PRICES`.
- Guessing output tokens from duration or emitted text.
- Producing a number when required cache, search, provider, or transcription dimensions are absent.
- Calling a zero-token/no-usage call free.

So: widen the existing computed mechanism carefully, but do not promise that it closes every aborted-call gap. For genuinely unpriceable rows, the right representation is still `none`.

More importantly, every breakdown must display its unpriced count. A line such as “chat: $4.20, 16 calls unpriced” is useful; “chat: $4.20” is false precision.

## 7. Minimum pricing report

Your draft misses distributions, zero-spend subscribers, coverage, and the actual cost phases.

Also, `scope_kind` is not an ingest-versus-reading split. Reader-triggered glossary, quiz, ideas, and similar jobs are still `job_step`. Derive at least these categories:

- Base upload: paid default-ingest steps.
- On-demand article enrichment: optional pipeline steps.
- Interactive text/search: request-scoped calls.
- Voice: realtime plus transcription.
- Non-product: eval and developer CLI work.

The minimum useful output is:

- A coverage header: authoritative source, credential/project, settled/computed/unpriced counts, reconciliation gap, and realtime sessions with zero reports.
- Per-subscriber billing-period cost, including subscribers with **zero** calls.
- Mean, median, p90/p95, and maximum—not just totals.
- The same distribution split across the four product categories above.
- Unit costs for:
  - cold default upload,
  - optional enrichment,
  - interactive request/turn,
  - voice minute/session.
- A scenario table: light, expected, heavy, and pathological usage, with gross margin at candidate prices.
- Cash COGS as well as OpenRouter credits. Allocate purchase fees in the report; do not rewrite settled row costs.

For measurements, one “full pipeline article” is insufficient and somewhat artificial. Measure at least a short HTML article, a long HTML article, and a PDF. Report default upload separately from an “engaged reader” journey. The all-steps run is an upper-bound scenario, not “ingest cost.”

I would cut:

- Admin UI.
- Auth email joins.
- A general aggregate API shared with the filesystem store.
- Per-article “lifetime” cost as a headline—it has no stable endpoint.
- A generic SQL view if the normalized columns already add correctly.

A Postgres-specific `GROUP BY` for this report is justified now. Do not widen `CostStore` merely to preserve filesystem parity for a pricing query whose source of truth is Postgres.

## 8. What will hurt when Stripe lands

The largest risks are conceptual:

- **`ai_calls` is COGS attribution, not customer billing.** A fixed subscription invoice reconciles against Stripe subscription state. Do not derive invoices from model calls.
- **An advertised allowance without enforcement is unlimited in practice.** Caps can remain outside this measurement job, but before real users either exclude voice, label it limited beta/fair-use, or implement the allowance.
- **Calendar months do not equal Stripe billing periods.** Queries must support arbitrary half-open `[period_start, period_end)` ranges per subscription.
- **The denominator must come from subscriptions.** `ai_calls` cannot show subscribed owners who spent zero, so an average computed only from ledger owners will be biased upward.
- **Late client reports can cross period boundaries.** Keep event/session time distinct from row insertion time.
- **Development and production need separate provider keys/projects.** Otherwise reconciliation includes experiments. Give realtime its own OpenAI project/key as well.
- **Cash cost is not provider credits.** Gross margin must include OpenRouter credit-purchase fees, direct OpenAI spend, Stripe fees, and eventually variable infrastructure—not only `ai_calls`.
- **Account deletion currently conflicts with historical attribution** because `owner_id` restricts deletion. Stripe/customer deletion will force that policy question sooner than expected.
- **Raw tokens are a poor customer-facing allowance.** Audio, cached audio, text, search, and transcription tokens have radically different economics and are incomprehensible to readers. If an allowance becomes necessary, voice minutes are a much better product unit.

Finally, run a quality bake-off against `gpt-realtime-2.1-mini` before freezing the plan. Its published audio rates are $10 input and $20 output per million, versus $32/$64 for the current model. If the reading conversation remains good enough, that product choice will move the price more than most ledger refinements. [OpenAI’s `gpt-realtime-2.1-mini` page](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini).

My recommendation: price the core text-reading subscription from base upload plus engaged-text p95, and treat voice as a separate explicit allowance or beta feature. “N articles per month” can remain a secondary abuse boundary, but it should not be the headline economic model.