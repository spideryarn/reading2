# AI cost: can we rely on provider numbers instead of computing our own?

**Question, in Greg's words, 2026-08-27:**

> This billing stuff is tricky to get right. Can we rely on the responses from the API, and/or a
> really reputable library?

**Short answer.** Partly. OpenRouter's `usage.cost` is a real invoice line — trust it, don't
recompute it, for the five call sites that already go through OpenRouter. Anthropic's Messages API
never returns a dollar figure, on any plan — only token counts — so the seven direct-SDK call sites
have no provider number to rely on at all. Anthropic does have an organisation-level **Admin Cost
API** that reports real dollars, and it is exactly the right shape for a monthly reconciliation
check against our own arithmetic — but it cannot replace per-call, per-user computation, because it
has no concept of "user" and reports a day late in daily buckets. No library qualifies as
"reputable" by this repo's own bar (long-lived, heavily documented, lots of pretraining data): the
field is too young. Worse, the one candidate this plan's research already looked at —
`@pydantic/genai-prices` — has a **documented, real, closed-as-not-planned bug** in exactly the
class of arithmetic this plan is most worried about getting wrong. That is not a reason to distrust
libraries in the abstract; it is a specific data point about the specific library on the table.
**Recommendation: keep computing, keep the reconciliation design already in the plan, do not adopt
a library, and add the Admin Cost API as a second, independent reconciliation check on top of the
OpenRouter one.**

Researched 2026-08-27. Every URL below was fetched live today unless marked otherwise.

---

## 1. Anthropic's Admin Usage & Cost API

Confirmed by fetching
[the live docs page](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) today.

**Two endpoints, not one:**

- `GET /v1/organizations/usage_report/messages` — token counts (uncached input, cached input,
  cache creation, output), bucketed and filterable/groupable.
- `GET /v1/organizations/cost_report` — dollar amounts, daily buckets only.

**Auth.** An **Admin API key**, format `sk-ant-admin01-...` — a different credential from a normal
Claude API key, created in Console → Settings → Organization. Quoting the docs: *"The Admin API is
unavailable for individual accounts. To collaborate with teammates and add members, set up your
organization."* This app runs under Greg's individual Anthropic account today (per
[setup-dev.md](../project/setup-dev.md)) — **whether an Admin key exists for this account is
unverified and worth checking before building anything on this**, since the whole API may not be
reachable until an "organization" exists in Console.

**Dimensions you can filter and group by**, for the usage endpoint: `api_key_id`, `workspace_id`,
`model`, `service_tier`, `context_window`, `inference_geo` (data residency), and `speed` (the
fast-mode beta). The cost endpoint groups by `workspace_id` or `description` only — grouping by
`description` gives you back parsed `model` and `inference_geo` fields inside each row. **There is
no `user` or arbitrary-metadata dimension on either endpoint.** Anthropic has no idea our app has
users; the finest grain is "which API key made this call," and this app doesn't mint one API key
per reader.

**Time granularity.** Usage endpoint: `1m`, `1h`, or `1d` buckets, with default/max bucket counts of
60/1,440 (minute), 24/168 (hour), 7/31 (day). Cost endpoint: **`1d` only, no finer**.

**Freshness.** *"Usage and cost data typically appears within 5 minutes of API request completion,
though delays may occasionally be longer."* Polling: *"once per minute for sustained use."*
Retention/lookback isn't stated as a hard limit on the page fetched — the max bucket counts above
(31 daily buckets = 31 days per single request) imply pagination is needed to look back further, and
pagination is supported (`has_more` / `next_page`), but the docs page doesn't state an absolute
retention cutoff (e.g. "data is deleted after N months"). **Not verified — worth a direct query if
this ever gets built.**

**Cost format.** Quoting the docs: *"All costs in USD, reported as decimal strings in lowest units
(cents)."* Real currency, not a computed estimate on Anthropic's side — this is literally what they
bill. One documented exception: **Priority Tier costs use a different billing model and are excluded
from the cost endpoint entirely** — track those through the usage endpoint's `service_tier` filter
instead, as a token-count proxy.

**Cache breakdown.** The usage endpoint's own bullet list: *"Token tracking: Measure uncached input,
cached input, cache creation, and output tokens."* So yes — the same four buckets our schema already
plans to store. It is not stated whether the cache-creation breakdown further splits by 5m/1h TTL at
this endpoint (our plan's `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`
distinction, confirmed on the per-call `usage` object) — that level of detail wasn't visible in what
was fetched. **Not verified.**

**SDK.** No official TypeScript SDK method surfaced in the docs page or in search — the examples are
all raw `curl`. Treat this as **raw HTTP only** unless the `claude-api` skill or the Anthropic
TypeScript SDK's changelog says otherwise (not checked here — worth a quick look before implementing,
since a typed wrapper existing would change the effort estimate).

**Rate limits.** Only the polling guidance above (\"once per minute for sustained use\") — no
numeric rate limit (requests/minute) was stated on the fetched page.

### Can this be a reconciliation check? Yes, with real caveats

This is the question Greg most wanted answered, so being precise about what would and wouldn't line
up matters more than the summary above.

**What would line up:**
- The cost endpoint gives a real, invoiced-quality daily USD total per workspace, groupable by
  model (via `description`). Our seven Anthropic-SDK call sites all run under this project's own
  Anthropic account/workspace (assuming no separate workspace split by stage — not verified), so in
  principle: sum our `ai_calls` rows for calls that actually reached the Anthropic SDK, group by
  UTC day and model, and diff against Anthropic's own daily total for the same day and model.
- Both sides ultimately derive from the same underlying token counts, so if our price table is
  right, the two totals should match to the cent — this is a stronger check than the OpenRouter
  cross-check that's already in the plan, because it independently verifies the Anthropic list
  price too, not just our reading of the usage object.

**What would not line up, or needs care:**
- **Timezone/bucket boundary.** The Cost API buckets by day; the plan's open question #6 (UTC vs
  calendar month) applies here identically — a call at 23:58 UTC and one at 00:02 UTC land in
  different daily buckets on Anthropic's side, and our own `created_at` needs to be compared in the
  same UTC day, not local time, or the two totals will disagree by exactly the boundary calls every
  day. Cheap to get right, easy to get wrong silently.
- **No per-user or per-call join.** The Cost API can at best confirm "our Tuesday total for
  `claude-sonnet-5` matches Anthropic's Tuesday total for `claude-sonnet-5`." It cannot confirm any
  individual row, and it cannot attribute anything to a reader. It is a **total-vs-total** check,
  the same shape as the OpenRouter reconciliation already in the plan, not a row-level one.
- **Scope creep risk.** If this Anthropic account or API key is ever used for anything outside this
  app (a one-off script, an eval run under a different owner, Greg testing something by hand from
  the CLI), the org-level total includes that too, and the reconciliation will show unexplained
  drift that isn't a pricing bug at all. The plan's own question #4 (\"do the evals count?\") is
  relevant here — evals hit the same Anthropic account and would show up in Anthropic's total
  whether or not they're written into `ai_calls`.
- **5-minute freshness plus daily-only granularity for cost** means the earliest a full day's
  reconciliation can run is the next day, once the last cache-bucket boundary has closed. Fine for a
  daily cron, not useful as a live check.
- **Admin key availability is the actual blocker to verify first.** If Console requires converting
  this individual account into an "organization" before an Admin key can be minted, that's a real
  setup cost, not a research question — worth five minutes in Console before this gets scheduled as
  a phase.

**Verdict:** yes, build it as a second reconciliation, alongside (not instead of) the
already-planned OpenRouter provider-vs-computed check. It closes exactly the gap the plan itself
names: *"the seven Anthropic-SDK stages... have no provider figure to check against."* It should be
a daily cron-ish job (or a `npm run cost --reconcile` command run by hand), not inline in the
request path, given the 5-minute lag and 1-day-only cost granularity. It is org-total-vs-our-total,
never per-user — the per-user number still has to be ours alone, computed and stored the way the
plan already designs.

Sources: [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
(fetched 2026-08-27); linked reference pages for
[Usage API](https://platform.claude.com/docs/en/api/admin-api/usage-cost/get-messages-usage-report)
and [Cost API](https://platform.claude.com/docs/en/api/admin-api/usage-cost/get-cost-report) were
not independently fetched — the parent page's inline examples and FAQ cover everything cited above,
but the full request/response schema on those reference pages is unverified.

---

## 2. Routing everything through OpenRouter

### Would it actually eliminate the arithmetic?

Yes, mechanically — every response would carry `usage.cost`, so the two-formula cache-accounting
problem this plan exists to solve would simply not arise for the calls that moved. But "radical
simplification" undersells what changes underneath, and three of the four sub-questions below argue
against it.

### Does OpenRouter add a margin over Anthropic's list price?

**No, not per-token.** Confirmed directly from
[OpenRouter's own FAQ](https://openrouter.ai/docs/faq), fetched today: *"We pass through the pricing
of the underlying providers without any markup on inference pricing"* — users *"pay the same rate as
you would directly with the provider."* This matches the plan's own two live probes (`cost` equal to
Anthropic list price, equal to `upstream_inference_cost`) and generalises it from "true on our two
probes" to "true by OpenRouter's own stated policy," which is a stronger claim.

The margin is entirely on **moving money into the platform**, confirmed on the same page:
*"OpenRouter charges a 5.5% ($0.80 minimum) fee when you purchase credits"* (5% flat for crypto).
And on **BYOK usage beyond a free allowance**: pay-as-you-go gets *"$25,000 per month with no BYOK
fee"*; past that, *"a fee of 5% of what the same model and provider would normally cost on
OpenRouter."* Enterprise's allowance is $200,000/month. This app is not on BYOK for Anthropic (it
buys OpenRouter credits directly, per the existing plan), so the BYOK fee is irrelevant to us; the
5.5%-on-topup fee is the real number, and it is a fee on *cash in*, not a per-call charge — it
doesn't show up in any individual call's `usage.cost` at all, which is exactly why the plan's
probes found `cost == upstream_inference_cost` to the decimal.

### Does prompt caching work identically through OpenRouter?

**Mechanically yes, but with a caveat this plan has not yet accounted for: sticky routing.**
Confirmed from [OpenRouter's own prompt-caching writeup](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/),
fetched today:

> "A warm cache only helps if the next request lands on the provider endpoint that holds it."
> "...turn one can write a cache on one provider while turn two lands somewhere else."
> "A cache lives where it was written. If a later request routes to a different provider endpoint,
> that endpoint can't read the earlier cache."

OpenRouter's fix is a `session_id` parameter that pins a conversation to the same upstream provider
endpoint after the first request: *"With `session_id`, sticky routing kicks in after the first
successful request, before any cache hit has happened."* It degrades gracefully if that endpoint
goes down (*"OpenRouter falls back to the next available provider instead of failing the
request"*) — which is good for availability and bad for cache hit rate, silently.

**This app pins routing to `anthropic/claude-sonnet-5` specifically** (not an open model class), so
in practice there is only one upstream provider in play and this risk is much smaller than it would
be for a multi-provider model class — but Anthropic itself serves from multiple regions/backends
behind that one OpenRouter model slug, and whether `session_id` is being set anywhere in this app's
current OpenRouter call sites is **not verified here** — worth checking
[`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) directly, since a silent cache-hit-rate
regression is exactly the [silent-success](../reusable/silent-success.md) shape this whole plan is
built to catch.

The `cache_control` mechanics (explicit breakpoints, 5m default / `"ttl": "1h"` opt-in) are
confirmed the same on the wire regardless of gateway — Anthropic's own request shape is what's being
forwarded — so nothing about the caching *contract* changes; the risk is purely about **which
upstream endpoint a given request lands on**, which is a gateway-routing property, not a caching-API
property.

### Latency and reliability cost of the extra hop

Not independently measured here — cited from a third-party comparison
([Maxim AI's "Best OpenRouter Alternative in 2026"](https://www.getmaxim.ai/articles/best-openrouter-alternative-in-2026-a-production-ai-gateway-comparison/),
a vendor-authored piece selling a competing gateway, so treat the specific numbers as directional
rather than neutral): it claims OpenRouter adds roughly 25–40ms versus a specialised low-latency
gateway's ~11 microseconds. **Not verified first-hand and sourced from a competitor's marketing
page** — flagged rather than trusted. What is more solid: this app already routes some calls through
OpenRouter today (5 of 12 sites), so its real-world latency and reliability profile for *this app
specifically* is something the team can already measure from existing logs rather than needing a
third-party benchmark at all.

### What is lost by going through OpenRouter instead of the Anthropic SDK

This is the section that actually settles the question, and the plan's own list of Anthropic-native
features is the right one to check one by one:

- **`thinking: {type: "adaptive"}` / `effort` levels.** Reachable through OpenRouter, but indirectly
  and with a documented gap. OpenRouter maps its own `reasoning.effort` parameter to Anthropic's
  `output_config.effort` — confirmed via search results citing OpenRouter's own migration-guide
  content (*"As of June 22, 2026, OpenRouter maps `reasoning.effort` to Anthropic's
  `output_config.effort` on Claude 4.6 and newer models"*) — so the feature exists, but it is a
  second-hand parameter mapping maintained by OpenRouter rather than a first-class Anthropic SDK
  field, and search turned up at least one concrete failure mode of exactly this kind of mapping (a
  different client library, Hermes, silently sending no effort signal at all on the channel
  OpenRouter actually honours). **Verdict: works, but every such mapping is a second thing that can
  drift out of sync with Anthropic's own parameter names, silently — this project has already lived
  through exactly that shape of bug with the "three spellings" problem in
  [setup-dev.md](../project/setup-dev.md).**
- **`stop_reason: "refusal"` / stop details.** Present through OpenRouter too, since it's part of the
  underlying Anthropic response being forwarded — search results reference the refusal stop reason
  occurring at a "materially higher rate on Claude Fable 5" with no indication it's Anthropic-SDK-
  only. Not independently verified against a live OpenRouter response in this research pass, but
  nothing found suggests it's stripped.
- **The SDK's typed errors and streaming helpers (`finalMessage()`, etc.).** These are properties of
  the **Anthropic TypeScript SDK's client code**, not of the wire protocol — they exist because the
  SDK wraps the raw SSE stream in typed classes. Going through OpenRouter means going through
  OpenRouter's own client library (or hand-rolled SSE parsing, which this app already does in
  [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts)), so these helpers are **gone by
  construction**, not degraded — replaced by whatever OpenRouter's SDK or this app's own
  hand-written stream plumbing provides instead. That is real lost convenience for the seven
  currently-Anthropic-SDK call sites, not a hypothetical.

### Is this a production pattern or a dev/experimentation gateway?

Mixed evidence, and it points toward "start here, outgrow it," not "wrong from day one." A
third-party comparison piece (again, vendor-authored — treat directionally) frames it plainly:
*"OpenRouter is ideal for getting started and testing models... production infrastructure benefits
from a dedicated AI gateway with lower overhead, stronger controls, and the option to
self-host."* Concretely, the same source lists production-relevant gaps: no self-hosting option,
credit-purchase fees that compound at scale, BYOK fees past the $25k allowance, and "limited
governance for multi-team deployments." None of those are billing-integrity concerns — they're
operational/cost-at-scale concerns, and this project is nowhere near the volume where they'd bite.
Companies do run real production traffic through OpenRouter (the recent
[$113M Series B at ~$1.3B valuation, May 2026](https://www.usagepricing.com/blueprint/openrouter),
per search results) — it is not a toy — but the honest read is that it's positioned and priced as a
convenience/aggregation layer, not as the thing a company scales its entire inference spend through
once volume is large.

### Verdict on "everything through OpenRouter, so cost is always reported and never computed"

**Not a sane architecture change for this project, but not because of billing.** The billing
argument for it is real and strong — it would eliminate the two-formula problem entirely for the
calls that moved. But it's the wrong trade to make *for that reason*, because:

1. It doesn't eliminate the two-formula problem — it just moves every call site to the side that
   already works today. The plan's actual exposure is the seven Anthropic-SDK sites, and those exist
   because those seven specifically want SDK-native features (thinking, `effort`, typed errors,
   streaming helpers) that this section just confirmed are diminished or gone through OpenRouter.
   Moving them to eliminate a billing arithmetic problem would be trading a solved problem (the
   arithmetic — Phase 1 is built and tested) for a real one (losing SDK features seven call sites
   were presumably written to use).
2. The sticky-routing caveat means "cost is always reported and never computed" doesn't buy "the
   cache always hits" for free — that's a second property this plan already tracks
   ([prompt-caching.md](../project/prompt-caching.md)) and moving providers doesn't make it need
   less attention, it adds a new way for it to silently regress (routing drift) that doesn't exist
   on the direct SDK path at all.

**The two-formula problem is already solved and tested** (Phase 1, `src/pricing.ts`, 20 tests) —
that's the part of the plan this research doesn't change. Routing everything through OpenRouter
would be re-solving an already-solved problem at the cost of real capability. Recommend: no change
to which call sites use which transport. Keep both gateways as planned.

---

## 3. Libraries, re-examined

The plan rejected `@pydantic/genai-prices` for three reasons: too broad (covers a hundred providers,
we call three models), auto-refetches prices hourly (a liability for a billing number), and doesn't
meet the bar in
[third-party-library-selection.md](../reusable/third-party-library-selection.md) — 359 stars is
young. Re-examined here, and the rejection holds — more strongly than the plan already argued.

### `@pydantic/genai-prices` — the cache-accounting bug this plan is worried about, found in the wild

Current stats: **359 GitHub stars**, **17,095 npm weekly downloads**, latest version **0.0.71**,
published 10 days before this check. Repo created 2025-06-21 and pushed the day of this check.
Actively maintained, low but real usage, genuinely a 0.0.x package.

> **Corrected 2026-08-27.** This section first said 114 stars and called the earlier pass's 359
> stale or a different repo. The 359 was right: `GET api.github.com/repos/pydantic/genai-prices`
> returns `"stargazers_count": 359`, `"created_at": "2025-06-21"`. Checked against the API rather
> than a search snippet. It does not change the conclusion — fourteen months old either way — but a
> research doc that corrects a correct number in the wrong direction is worse than one that never
> checked.

Its documented usage shape does follow Anthropic's additive rule correctly on paper — confirmed from
[the package's own README](https://github.com/pydantic/genai-prices/blob/main/packages/js/README.md),
fetched today: it wants a total `input_tokens` figure that *already includes* cache reads and writes,
plus separate `cache_read_tokens` / `cache_write_tokens` for the differential pricing, and warns
explicitly: *"Do not pass only the uncached count as `input_tokens`. Cache tokens are partitions of
the total, so their combined count cannot exceed `input_tokens`."* That's the right contract.

**But the contract being right on paper is not the same as it being safe in practice, and there is a
real, closed, unresolved bug that proves it**:
[pydantic-ai issue #4364](https://github.com/pydantic/pydantic-ai/issues/4364), and the mirrored
[Langfuse issue #12306](https://github.com/langfuse/langfuse/issues/12306), both found via search
and the pydantic-ai issue fetched in full today. The bug: `genai-prices`'s internal usage-extraction
mappings sum Anthropic's `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`
into one internal `Usage.input_tokens` field — correct, matching the README's contract — **but
pydantic-ai then emits that already-summed total to OpenTelemetry alongside separately-reported
`cache_read_tokens` / `cache_write_tokens`**, and a downstream consumer (Langfuse) added all three
together again, producing a token count roughly **double** the real one (130,213 real tokens
reported as 260,421). Quoting the issue directly: *"genai-prices maps all three Anthropic input
fields into `Usage.input_tokens` (they sum because multiple mappings share the same `dest`)."* The
issue is **closed as "not planned"** — i.e., not going to be fixed as reported, which in context
reads as "this is a caller-side integration bug, not ours to fix," but the practical result for
anyone wiring this library into a second system (exactly what a Langfuse-style integration, or our
own gateway, would be doing) is the same: **the exact class of bug this whole plan exists to
prevent, happening for real, in the one library that was proposed as the alternative to hand-rolled
arithmetic.**

This doesn't mean the library's core pricing math is wrong — it means that *the moment a second
layer (an app, an exporter, a dashboard) also touches the cache token counts*, which is unavoidable
if we want `cache_read_tokens` and `cache_write_tokens` as their own columns (the plan's own schema
wants exactly this, for the "has the cache stopped working" alarm), there is a well-documented,
live, real-world way to double-count that this project would inherit for free by adopting the
library and then doing anything with the cache fields ourselves — which is exactly what
[prompt-caching.md](../project/prompt-caching.md) requires.

### `tokenlens`

Confirmed via its own docs and npm: provides `getTokenCosts()` returning `inputUSD`, `outputUSD`,
`reasoningUSD`, `cacheReadUSD`, `cacheWriteUSD`, `totalUSD` — genuine per-category cost breakdown,
not a single number. It self-describes cost estimation as fast/rough rather than billing-grade (per
the earlier research pass's finding, not re-verified in full here) and its focus is context-budget
management (does this fit? should we compact?) with cost as a secondary feature, not a billing
product. No evidence found, in this pass, of the same kind of caller-integration double-counting bug
found in genai-prices — but that's an absence of evidence, not a verification; nobody was found to
have stress-tested it the way the Langfuse/pydantic-ai issue stress-tested genai-prices.

### LiteLLM's `model_prices_and_context_window.json`

Confirmed to carry separate `cache_creation_input_token_cost` and `cache_read_input_token_cost`
fields per model (example found: `claude-3-5-haiku-20241022` → `1e-06` / `8e-08`). It's a raw JSON
file, Python-first project, not an npm package — using it means vendoring or fetching the JSON
ourselves and writing our own cache-aware pricing function against it, which is functionally
identical to the plan's current "table in git" approach except sourced from someone else's table
instead of hand-checked against Anthropic's own docs. Doesn't solve anything the current plan
doesn't already solve, and doesn't remove the arithmetic risk — a caller still has to correctly wire
`cache_creation_input_token_cost` against the right token count, which is exactly the mistake found
in genai-prices's callers above.

### `llm-cost` (npm)

**Could not verify.** The npm page returned HTTP 403 on fetch and no independent confirmation of
recency, maintenance, or cache-accounting correctness was found in this pass. Per the earlier
research round, this was already the weakest-evidenced of the four — nothing here changes that;
treat it as unverified rather than as a candidate.

### Is there a genuinely "reputable" one, by this repo's own bar?

**No — and this pass makes the "no" firmer, not softer.** The bar in
[third-party-library-selection.md](../reusable/third-party-library-selection.md) is *long-lasting
community, lots of docs/discussion/examples*. Every candidate here is a 2024–2026 package (LiteLLM's
JSON file is the oldest and most-battle-tested artifact of the bunch, but it isn't a library with an
API — it's raw data you'd still write your own cache-aware code against). The one candidate with
real GitHub-issue-level scrutiny (`genai-prices`, via its adoption inside pydantic-ai and Langfuse)
turned up a genuine double-counting bug in the exact area this plan cares most about. That is
evidence *for* "none qualify," not evidence against the field being real — it's a young field where
correctness on the cache-accounting question specifically has not yet been proven at scale by
anyone. **This confirms the plan's existing decision to hand-write a nine-number table rather than
adopt a library — do it with more confidence than the plan currently states it, not less.**

---

## 4. What do people billing end users actually do?

### The general pattern: request-level metadata first, provider invoices second

The clearest single source found is Braintrust's own framing, from
[their 2026 cost-tracking playbook](https://www.braintrust.dev/articles/how-to-track-llm-costs-2026)
(a vendor's own content, but describing engineering practice rather than selling a specific number)
and a second, non-vendor piece surfaced by search
([nhimg.org, "LLM cost attribution needs request-level metadata, not invoices"](https://nhimg.org/articles/llm-cost-attribution-needs-request-level-metadata-not-invoices/)):
the provider invoice is not the attribution mechanism — it tells you tokens bought, by model and
sometimes by API key, which is cost *reporting*, not cost *attribution*. Attribution to a user, a
feature, or an agent run requires **our own request-level record with a `user_id` on it**, because
the provider has no idea a "user" exists. This directly validates the plan's own core design
decision (a per-call `ai_calls` row with `owner_id`) rather than adding anything new to it.

### Metered billing platforms (Orb, Metronome, Lago, OpenMeter) and LLM usage specifically

Confirmed from search across multiple comparison pieces (none independently deep-dived in this
pass — treat as directional): these platforms are built for *charging customers* based on metered
usage events you send them — they are downstream consumers of a cost number, the same role
Langfuse/Helicone would play, not a source of authoritative LLM pricing themselves. None of them
compute Anthropic or OpenRouter token pricing on your behalf; you still feed them a cost or usage
event you already computed. One useful, concrete finding from search results on this exact failure
mode: *"if inclusive counts are stored as-is, cached tokens are priced twice and the tracked cost
overstates the invoice"* — i.e., **the OpenAI/OpenRouter-style inclusive cache accounting is the one
that trips people up in practice**, which corroborates this plan's own emphasis (the plan's
divergence write-up treats both directions as equally dangerous; the external evidence suggests the
inclusive-counted-as-additive mistake, "double counting," is the one that actually happens to real
teams). This is the same shape of bug as the genai-prices/Langfuse issue above, just described in
the abstract by a different source rather than found in a specific library.

**No evidence found of a documented, standard tolerance for drift between internal metering and a
provider's invoice** — none of the sources fetched or surfaced by search state a number like "keep
drift under X%." This looks like an open, per-company judgment call industry-wide, not a solved
convention — worth treating as our own decision (the plan's `npm run cost` drift-report line) rather
than something to benchmark against an external standard, because no external standard was found.

---

## 5. Anything that makes the arithmetic unnecessary?

Nothing new beyond what's covered above. To be explicit about what was checked and ruled out:

- **A per-request cost header or beta on Anthropic's Messages API.** Not found. The Admin Cost API
  (§1) is the only dollar-denominated Anthropic surface that exists, and it is org/day-level, not
  per-request.
- **A `count_tokens`-style cost endpoint.** Anthropic has `POST /v1/messages/count_tokens` for token
  *counting* before a call (not investigated in this pass, out of scope — it answers "how many
  tokens will this cost," not "what did this dollar-cost"), but nothing found that turns a
  completed call's usage into a dollar figure server-side.
- **Anything on Anthropic's roadmap about per-call cost.** Not found — no changelog, blog post, or
  docs page surfaced mentioning this as planned.

---

## Recommendation

**Do we compute or reconcile?** Both, as the plan already designs — and this research adds one more
independent reconciliation, not a replacement for the existing one:

1. Keep computing cost for the seven Anthropic-SDK call sites from token counts × the hand-written
   price table (Phase 1, already built and tested).
2. Keep the existing OpenRouter provider-vs-computed reconciliation for the five OpenRouter call
   sites (already designed in the plan).
3. **Add a second, independent check**: a periodic (daily, not inline) pull from Anthropic's Admin
   Cost API, summed by UTC day and model, compared against the sum of our own `ai_calls` rows for
   Anthropic-SDK calls over the same UTC day and model. This is the piece Greg's question was really
   asking for — a real dollar figure from Anthropic itself, checkable against our arithmetic — and
   it exists and is reachable, with the caveats in §1 (Admin key provisioning unverified, org-total
   not per-user, UTC bucket alignment matters, evals/one-off CLI runs pollute the total unless
   excluded or accepted).

**Do we take a library?** No. Re-examined honestly against the criteria doc, and the answer is
firmer than before, not softer — `@pydantic/genai-prices`, the strongest candidate, has a documented
real-world double-counting bug in the exact cache-accounting arithmetic this plan is built around,
found through its adoption in Langfuse and pydantic-ai. No library in this space meets the
"long-lived, heavily documented" bar yet. Keep the hand-written table.

**What changes in the plan:** one addition — the Admin Cost API reconciliation as a Phase 5 item
(alongside the OpenRouter drift check that's already there), with the setup caveat (Admin key /
organization requirement) checked before it's scheduled. Nothing else in the plan's design,
schema, or phasing needs to change as a result of this research.

## What we could not verify

- Whether an Anthropic **Admin API key** is currently obtainable for this project's Anthropic
  account, or whether it requires converting to an "organization" in Console first.
- Whether Anthropic's Admin Cost/Usage API has a **hard retention cutoff** for historical data (the
  docs page fetched didn't state one explicitly).
- Whether the Admin Usage API's cache-creation breakdown includes the 5m/1h TTL split, or only the
  flat total.
- Whether there is an **official Anthropic TypeScript SDK method** for the Admin API, versus raw
  HTTP only.
- The `llm-cost` npm package — fetch returned HTTP 403; nothing independently confirmed about it in
  this pass.
- Whether `session_id` (OpenRouter's sticky-routing parameter for cache reuse) is currently being
  sent by any of this app's OpenRouter call sites — worth a direct grep of
  [`src/openrouter-stream.ts`](../../src/openrouter-stream.ts) rather than assuming either way.
- Whether OpenRouter strips or preserves `stop_reason: "refusal"` on a live response — inferred from
  general search results, not confirmed against an actual OpenRouter response in this pass.
- The latency figures for OpenRouter's added hop (25–40ms) are from a competing gateway's own
  marketing page, not independently measured.
- Whether any metered-billing platform (Orb/Metronome/Lago/OpenMeter) has LLM-specific tooling built
  in versus being a generic usage-event sink — the comparison pieces found were shallow on this
  specific point.

## Sources (fetched or searched 2026-08-27 unless noted)

- [Anthropic Usage and Cost API docs](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) — fetched in full
- [pydantic/genai-prices JS package README](https://github.com/pydantic/genai-prices/blob/main/packages/js/README.md) — fetched in full
- [pydantic-ai issue #4364, "Anthropic cache tokens double-counted"](https://github.com/pydantic/pydantic-ai/issues/4364) — fetched in full
- [Langfuse issue #12306](https://github.com/langfuse/langfuse/issues/12306) — found via search, cited but not independently fetched
- [OpenRouter FAQ](https://openrouter.ai/docs/faq) — fetched in full (fee/markup language)
- [OpenRouter usage-accounting docs](https://openrouter.ai/docs/use-cases/usage-accounting) — fetched (did not contain fee info, confirmed `cost` field meaning)
- [OpenRouter prompt-caching / sticky-routing blog post](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/) — fetched in full
- npm/GitHub metadata for `@pydantic/genai-prices` (17,095 weekly downloads, v0.0.71) — via search. The star count was cross-checked against the GitHub API afterwards: 359, not the 114 this doc first reported
- `tokenlens` docs and npm page — via search
- LiteLLM `model_prices_and_context_window.json` — via search, example values cited from search-result excerpts, not fetched directly
- [Braintrust, "How to track LLM costs (2026)"](https://www.braintrust.dev/articles/how-to-track-llm-costs-2026) — via search summary, not fetched in full
- [nhimg.org, "LLM cost attribution needs request-level metadata, not invoices"](https://nhimg.org/articles/llm-cost-attribution-needs-request-level-metadata-not-invoices/) — via search summary
- Comparison pieces on OpenRouter production fit and latency (Maxim AI, TrueFoundry, various) — vendor-authored, treated as directional not authoritative
- This project's own [260827q-ai-cost-tracking.md](../plans/260827q-ai-cost-tracking.md) and
  [260827d-ai-cost-tracking-options.md](260827d-ai-cost-tracking-options.md) — read in full before this research pass

## See also

- [260827q-ai-cost-tracking.md](../plans/260827q-ai-cost-tracking.md) — the plan this research feeds into
- [260827d-ai-cost-tracking-options.md](260827d-ai-cost-tracking-options.md) — the first research round (options
  survey, live probes confirming the cache-accounting divergence)
- [prompt-caching.md](../project/prompt-caching.md) — why the cache columns are the alarm this whole
  design protects
- [third-party-library-selection.md](../reusable/third-party-library-selection.md) — the selection
  bar no library here clears
