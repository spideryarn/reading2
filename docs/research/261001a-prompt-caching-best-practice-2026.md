# Prompt caching best practice, October 2026: what is new since August

A re-check of the three August research docs
([anthropic](260826b-prompt-caching-anthropic.md), [callsites](260826c-prompt-caching-callsites.md),
[openrouter](260826d-prompt-caching-openrouter.md)) against the primary sources as they stand on
2026-10-01, plus the OpenAI side, which August barely touched. Open it when you are about to change
a breakpoint, a TTL, an effort setting or a fan-out, and want to know what the vendors currently say
rather than what we wrote in August. It deliberately does not repeat the August mechanics.

Labels used throughout: **CONFIRMED** (read in a primary source today, quoted or closely
paraphrased), **SECONDARY** (blog or search snippet; treat as a lead), **INFERRED** (my arithmetic or
reasoning from confirmed facts), **NOT FOUND** (looked, did not find).

## 1. Anthropic

**Breakpoints.** CONFIRMED: up to 4 per request. A top-level `cache_control` ("automatic caching")
puts one on the last cacheable block and slides it forward as a conversation grows. Edge cases,
CONFIRMED: if the last block already carries an explicit `cache_control` with the same TTL the
automatic one is a no-op; with a different TTL the API returns 400; with 4 explicit breakpoints
already present it returns 400 (no slot left); if the last block is ineligible it silently walks
backward, and skips caching if it finds none. Automatic mode uses one of the four slots. (Our chat
postmortem already rules automatic mode out on the request path; this is the reason it is brittle.)

**Where they go.** CONFIRMED: "Place the breakpoint on the last block whose prefix is identical
across the requests you want to share a cache." Static material (tools, system, context, examples)
first. A breakpoint on the last tool caches all tools up to and including it.

**Lookback.** CONFIRMED, and sharper than August: the system checks at most 20 positions per
breakpoint, counting the breakpoint itself as the first. On the Claude API a run of consecutive
`tool_use` blocks counts as one position, and so does a run of consecutive `tool_result` blocks, so
parallel tool calls no longer push the old entry out of the window by themselves. Long turns still
need an extra breakpoint.

**Cache key.** CONFIRMED list of things that invalidate: tool definitions (everything), web-search
toggle, citations toggle, `speed` setting (tools survive, system and messages do not), images
anywhere (messages only), tool choice (messages only), thinking configuration, and
`output_config.effort`. Exact wording on thinking: the configuration "is rendered into the prompt,
so changing it always invalidates message blocks; tool and system caches are also invalidated on
models that render the configuration ahead of them." The table marks effort the same way:
messages always invalidated, tools and system "model-specific". So effort being part of the key,
which we measured in August, is now documented, and which tiers survive depends on the model. Which
tiers survive an effort change on Sonnet 5 or Opus 5.x is NOT FOUND (see open questions).

**Minimum cacheable length. This table changed.** CONFIRMED today:

| Minimum | Models |
|---|---|
| 512 | Opus 5.5, Opus 5, Sonnet 5.5, Fable 5 / 5.1, Mythos 5 / 5.1 |
| 1,024 | Sonnet 5, Sonnet 4.6, Sonnet 4.5, Opus 4.8, Opus 4.1, Opus 4 |
| 2,048 | Opus 4.7, Mythos Preview, Haiku 3.5 |
| 4,096 | Haiku 4.5, Opus 4.6, Opus 4.5 |

August's openrouter doc listed Opus 4.8 at 4,096 and said Sonnet 5 was absent; both are now stale.
The labels-batch floor discussed in `prompt-caching.md` (about 1,107 tokens against 1,024) is right
for Sonnet 5 but would clear the floor with room to spare on Sonnet 5.5 or Opus 5.x (512), so the
short-prefix labels case on small articles may start caching if the model moves. Below the floor
nothing is cached and no error is returned.

**Pricing multipliers.** CONFIRMED: 5-minute write 1.25x base input; 1-hour write 2.0x; read 0.1x
on most models, but **0.05x on Opus 5.5** and 0.025x on Fable 5.1 / Mythos 5.1. Opus 5.5 example
given by Anthropic: base $4, 5m write $5, 1h write $8, read $0.20 per MTok. Reads on Opus 5.5 are
therefore twice as cheap as a blanket "0.1x" assumption.

**TTL.** CONFIRMED: lifetime is measured from the *start* of the request that wrote or last read the
entry, not from the end of its response, so a 4-minute stream leaves about 1 minute. Every read
refreshes the entry at no charge. Latency is identical for 5m and 1h. The docs list "cache hits are
not deducted against your rate limit" as a reason to use 1h; they do not say it is 1h-only.
SECONDARY: several blogs report that on 2026-03-06 Anthropic changed the *default* TTL from 1h back
to 5m without announcement. This matters only if we ever relied on a default. Not verified against a
primary source.

**When 1h pays (Anthropic's own guidance, CONFIRMED):** use 5m if the prefix is reused more often
than every 5 minutes (it refreshes free). Use 1h for prefixes reused less often than every 5 minutes
but more often than hourly: side-agents that run past 5 minutes, chats where the user may pause, and
when latency matters.

**Mixing TTLs.** CONFIRMED: 1h entries must appear *before* 5m entries in the request. Billing:
reads for the highest hit position A, 1h writes for the span from A to the last 1h breakpoint B, 5m
writes from B to the last breakpoint C. Usage carries a breakdown:
`cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }`, and
`cache_creation_input_tokens` is their sum.

**Concurrency. CONFIRMED, verbatim:** "For concurrent requests, note that a cache entry only becomes
available after the first response begins. If you need cache hits for parallel requests, wait for the
first response before sending subsequent requests." So an entry is **not** readable before the
writing request has at least begun responding. It does not need to finish. This matches August and
our `checkBatchedDraw` reasoning.

**Pre-warming.** CONFIRMED: the docs still describe pre-warming a system prompt or tool definitions
to remove the first-call miss latency. August's note that `max_tokens: 0` does this with no billed
output was CONFIRMED in August; I did not see that passage in today's fetch (NOT FOUND today).

**Isolation.** CONFIRMED: caches are isolated between organizations, and on the Claude API also per
workspace. Bedrock and Google Cloud isolate at organization level only. Via OpenRouter we call with
OpenRouter's upstream account, so what we share with is not documented (NOT FOUND).

**Thinking.** CONFIRMED: thinking blocks cannot carry `cache_control` but are cached as part of
request content on later calls that carry tool results, and count as input tokens when read. On
Opus 4.5+ and Sonnet 4.6+ prior thinking blocks are kept by default, so adding non-tool-result user
content does not invalidate; on older Opus/Sonnet and all Haiku they are stripped and it does.
Practical meaning: a multi-turn chat on Sonnet 5 or Opus 5.x keeps its cache across plain user turns.

**Usage fields.** CONFIRMED: `input_tokens` counts only tokens after the last breakpoint. Total
input is `cache_read + cache_creation + input_tokens`.

## 2. OpenRouter

CONFIRMED from the OpenRouter prompt-caching guide read today unless marked.

- **Pass-through.** Anthropic-style `cache_control` on content blocks is honoured. A top-level
  `cache_control: {type: "ephemeral"}` is also documented: it applies to the last cacheable block and
  advances ("best for multi-turn"). Anthropic's edge cases presumably apply upstream (INFERRED).
- **TTL.** `"ttl": "1h"` is documented as ordinary: 2x write vs 1.25x. No beta header is required of
  the caller. August asked for a live `cache_write_tokens` check; I found no record that we did one
  (see open questions).
- **Cross-dialect translation.** A block with Anthropic-style `cache_control` gets a
  `prompt_cache_breakpoint` when routed to a supporting OpenAI model. SECONDARY: TTL values do not
  transfer, and an OpenAI-style breakpoint becomes a default 5-minute Anthropic marker.
- **Sticky routing.** After a request that uses caching, OpenRouter remembers which provider served
  it; stickiness expires after 10 minutes of inactivity. `session_id` (max 256 chars, body field or
  `x-session-id` header) is used directly as the sticky key. If the sticky provider is unavailable
  OpenRouter falls back to the next-best provider, and the cache is then cold. Our pinning to
  anthropic with `require_parameters: true` already does most of this for Claude; a `session_id` per
  article is a cheap extra for GPT-routed or unpinned calls. Whether `session_id` helps when only one
  provider is allowed is NOT FOUND. The 10-minute stickiness is shorter than a 1h cache entry, so a
  1h entry can outlive the routing that reaches it unless the provider is pinned (INFERRED).
- **Usage fields.** `usage.prompt_tokens_details.cached_tokens` (read), `cache_write_tokens`
  (written), and `cache_discount`: "Some providers, like Anthropic, will have a negative discount on
  cache writes, but a positive discount ... on cache reads."
- **OpenAI pricing note.** OpenRouter says cache writes are free before the GPT-5.6 family and 1.25x
  from GPT-5.6 on; reads "0.25x or 0.50x" depending on model. This conflicts with OpenAI's own page
  for 5.6+ (0.1x); likely different model sets. On 5.6+ you can switch automatic caching off per
  request with `prompt_cache_options.mode: "explicit"` and no marked blocks, to avoid write charges on
  one-shot prompts.
- **`prompt_cache_key` / `prompt_cache_retention` pass-through:** NOT FOUND in the guide. Do not
  assume it works; test.
- SECONDARY: third-party July 2026 tests report zero cached tokens through OpenRouter on some models
  (one write-up lists GPT-4o and Claude). One blog's observation, but it argues for measuring our own
  hit rate rather than trusting the flag.

## 3. OpenAI GPT models

Primary source: the developers.openai.com prompt-caching guide, read today (the old
platform.openai.com URL 301s there). The guide has **split into two regimes at GPT-5.6**.

**GPT-5.6 and later (CONFIRMED):**
- Minimum 1,024 visible input tokens.
- `prompt_cache_key` is optional, for separate accounting: "The key is not needed to optimize caching
  on these models."
- Retention is set with `prompt_cache_options.ttl`, not `prompt_cache_retention`.
- Explicit mode exists: `prompt_cache_options.mode: "explicit"` with
  `prompt_cache_breakpoint: {mode: "explicit"}` on blocks; up to four cache writes per request. This
  is what OpenRouter translates our `cache_control` into.
- Writes cost 1.25x the uncached input price; reads 0.1x on most models, 0.05x on GPT-6.1 Sol.
- Usage: `usage.input_tokens_details.cached_tokens` and `cache_write_tokens`.

**Earlier models (GPT-5.5, 5.4, 5.2, 5.1 and before; CONFIRMED):**
- Automatic prefix caching, no write charge, model-dependent read discount.
- Cached-token counts are reported rounded down to a multiple of 128.
- `prompt_cache_key` is "essential for routing": use a stable key for requests that share a reusable
  prefix. Routing hashes "the initial tokens after the hidden OpenAI content, including tool
  definitions when present". Guidance: about 15 requests per minute in total across all prefixes using
  each key; above that, requests overflow to other machines and miss.
- `prompt_cache_retention`: `in_memory` (typically 5 to 10 minutes of inactivity, up to an hour) or
  `24h` (typically about 30 minutes, up to 24 hours).

**Do fan-outs share a key?** For earlier models, yes: one key per article routes all of that
article's calls together, and stays under the 15-a-minute guidance as long as it is per article, not
global. A global key would break that guidance. For 5.6+ there is nothing to tune; the prefix hash
routes.

**Does OpenAI also need a warm-up?** NOT FOUND stated. By analogy parallel requests probably miss
each other's writes (INFERRED); measure.

## 4. General patterns

1. **Static first, variable last.** CONFIRMED by Anthropic. The article, then the stage instruction
   after the breakpoint (our explain "search harder" lesson is this).
2. **Fan-out warm-up.** CONFIRMED mechanism. Send one, wait for the first token, send the rest.
   Cost: one request of latency. Alternative: pay N-1 duplicate writes (1.25x each) to stay parallel,
   which the labels batch does on purpose. INFERRED saving: (N-1) x (1.25 - 0.1) = 1.15 x prefix per
   extra call; for a 20k-token prefix and N=4 that is about 69k token-equivalents of input.
3. **Multi-turn.** Move the breakpoint to the end of the latest turn each time; the previous
   position is read and the new tail written. Top-level automatic mode does exactly this, but needs a
   free slot and a matching TTL.
4. **Measure.** Log `cache_read`, `cache_write` and uncached input per call; hit rate is
   `read / (read + write + uncached)` per feature, plus a count of writes with no later read per cache
   group. On the chat wire the same numbers are `cached_tokens` and `cache_write_tokens`.

## What this changes for Spideryarn

1. **1h TTL break-even (INFERRED, arithmetic on confirmed multipliers).** In units of the prefix's
   base input price: 5m write 1.25, 1h write 2.0, read 0.1 (0.05 on Opus 5.5), uncached 1.0 per call.
   Against no caching, a 5m write pays on the first reuse (1.35 vs 2.0). A 1h write is slightly behind
   after one reuse (2.1 vs 2.0) and ahead from the second (2.2 vs 3.0). Against 5m, 1h wins as soon as
   even one gap between uses exceeds 5 minutes: two uses 10 minutes apart cost 2.5 on 5m (two writes)
   and 2.1 on 1h. If every gap stays under 5 minutes, 5m refreshes free and always wins. So: 1h for
   reader sessions where questions come minutes apart (search, chat, explain on one article), 5m for
   pipeline fan-outs and anything read once.
2. **Verify 1h through OpenRouter once, on both wires**, by checking `cache_write_tokens` and cost,
   before relying on it. Keep the 1h-before-5m ordering rule in any mixed request.
3. **Sticky routing lasts 10 minutes** at OpenRouter; a 1h entry reached through a rerouted provider
   is a miss. Keep the anthropic pin and consider a per-article `session_id`.
4. **Effort and thinking are in the key, officially.** The glossary-is-its-own-cache decision stands;
   the primary docs agree. Keep `thinking` and `tool_choice` fixed within a cache group.
5. **Update the minimum-length numbers** in `prompt-caching.md` and the August openrouter doc:
   Sonnet 5 is 1,024; Opus 5, Opus 5.5 and Sonnet 5.5 are 512; Haiku 4.5 is 4,096. On 512-floor models
   the labels warm-up skip (`estimatedCacheable: false`) becomes wrong for small articles, so the
   threshold should come from the model, not a constant.
6. **Reads on Opus 5.5 cost 0.05x**, so high-powered-AI calls gain more from caching than estimated;
   re-run the cost model for them.
7. **For GPT-routed calls**, nothing is needed on 5.6+: automatic, key optional. For earlier GPT
   models set `prompt_cache_key` per article (never global) if OpenRouter forwards it. Note 5.6+
   charges 1.25x on writes automatically, so one-shot prompts are slightly dearer; explicit mode with
   no breakpoints avoids it.
8. **Treat our own usage log as the authority** over any vendor or blog claim, including this doc.

## Open questions to settle by measurement

1. Does `ttl: "1h"` through OpenRouter's Messages wire and its chat/completions wire both show as
   `ephemeral_1h` writes at 2x cost? (One call each; read `cache_creation` and the cost.)
2. On Sonnet 5 and Opus 5.x, after an `effort` change, do the tools and system tiers still read?
   The docs say "model-specific" and name no models.
3. Does a second request sent before the first response begins really miss on our path (delay 0 versus
   delay until first token)? Confirms warm-up value in practice.
4. Does OpenRouter forward `prompt_cache_key`, `prompt_cache_retention` or `session_id` upstream to
   OpenAI, and does `session_id` change hit rate when the provider is already pinned?
5. Which of our calls actually route to GPT, and is it 5.6+ (automatic) or older (key needed)?
6. What is the real 5m hit rate per feature over a week of readers? That decides whether 1h is worth
   switching on for search/chat/explain.
7. Is the 2026-03-06 default-TTL change real, and does it affect OpenRouter calls that omit `ttl`?
   (Cheap check: send without `ttl`, read the `cache_creation` breakdown.)
8. Does `max_tokens: 0` pre-warming still work through OpenRouter?

## Sources (read 2026-10-01)

- Anthropic, Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
  (fetched via a summarising fetcher; quotes are as returned, worth a spot check against the page)
- OpenRouter, Prompt caching guide: https://openrouter.ai/docs/guides/best-practices/prompt-caching
  (same caveat)
- OpenAI, Prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
  (redirected from platform.openai.com/docs/guides/prompt-caching)
- SECONDARY, search snippets only, not opened: dev.to "Anthropic Silently Dropped Prompt Cache TTL
  from 1 Hour to 5 Minutes"; particula.tech "5-Minute TTL Regression Explained"; releasebot.io
  OpenRouter release notes; tokenminning.ai and aireiter.com OpenRouter caching write-ups.
- Not read: the Anthropic and OpenRouter changelog pages themselves, so "anything new since August"
  is covered only by the differences visible in the current guides above.

Up: [research.md](../project/research.md)
