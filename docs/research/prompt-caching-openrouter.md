# Prompt caching through OpenRouter

Written 2026-08-26. This is research, not a plan — it answers whether the two
request-path model calls in this app (`src/explain.ts` and `src/converse.ts`,
which the reader waits on: "explain this sentence" and the chat panel) can use
Anthropic's prompt caching while still going through OpenRouter, the way they
do today. See [setup-dev.md](../project/setup-dev.md) for which model each
call uses, and [`src/models.ts`](../../src/models.ts) for the model id
(`anthropic/claude-sonnet-5`) that both calls pass.

## The short answer

Yes — no need to switch off OpenRouter or the raw-HTTP shape these two files
already use. Add one field to the request body. But the two calls are not
equally good fits: `converse.ts`'s shape is close to ideal for it as written;
`explain.ts`'s shape needs a small restructure to actually get paid back.

## How OpenRouter exposes it

Two modes, both documented at
[openrouter.ai/docs/features/prompt-caching](https://openrouter.ai/docs/features/prompt-caching)
and the near-duplicate
[openrouter.ai/docs/guides/best-practices/prompt-caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching):

**Automatic** — one field at the top of the request body, sibling to `model`
and `messages`:

```json
{
  "model": "anthropic/claude-sonnet-5",
  "cache_control": { "type": "ephemeral" },
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

OpenRouter's own example shows plain string `content`, not an array of parts
— **this works with the message shape both `explain.ts` and `converse.ts`
already send.** No restructuring needed to turn caching on at all. The
docs describe it as "recommended for multi-turn conversations": it marks the
last cacheable block and "advances it forward as conversations grow" —
i.e., on request N+1 with a longer history, the growing prefix from request N
gets picked up automatically. That is exactly `converse.ts`'s shape: article
in the second message, `history` re-sent in full on every call, only the tail
growing. Turning this on there is genuinely just adding the one field.

**Explicit breakpoints** — `cache_control` on individual content blocks, for
control over *which* prefix gets cached. This is where the docs' examples
require `content` to be an **array of parts**, not a plain string:

```json
{
  "role": "system",
  "content": [
    { "type": "text", "text": "Base instruction" },
    { "type": "text", "text": "LARGE BODY", "cache_control": { "type": "ephemeral" } }
  ]
}
```

Max **4 explicit breakpoints** per request. There is no evidence OpenRouter
silently rewrites `role: "system"` into Anthropic's separate top-level
`system` parameter in a way that would strip `cache_control` — the docs' own
examples put `cache_control` directly on a `system`-role message's content
block, so it's meant to survive whatever translation happens underneath.

### Why `explain.ts` needs the explicit form, and `converse.ts` doesn't

`explain.ts` sends one `user` message whose text is
`"Here is the whole article... <full article> ... The reader has selected
this passage... <quote> ... Explain it."` — the article and the
reader's quote are **one string, one block**. Automatic caching marks a
*block* as the breakpoint; if that block's bytes differ because the quote at
the end changed, the whole block is a cache miss, every time, for every
distinct selection. Turning on automatic caching here as-is would add write
cost (1.25x) with no matching reads. To get the actual payoff — the article
body repeats across every passage a reader selects in the same article — the
user content needs to become an array: one part for the article (marked
`cache_control`), one part for the per-selection quote instruction (unmarked).
That's a small, mechanical change to `renderArticle`'s caller, not a
provider switch.

`converse.ts` already puts the article in its own `user` message, separate
from the growing `history` and the new `question` — that's already
block-per-turn. Automatic top-level `cache_control` there should cache the
system prompt + article + prior turns as one growing prefix, with only the
newest question uncached, matching the doc's stated design point.

## Minimum token thresholds

Documented, and model-specific:

| Threshold | Models |
|---|---|
| 4,096 tokens | Opus 4.8, 4.7, 4.6, 4.5; Haiku 4.5 |
| 2,048 tokens | Haiku 3.5 |
| 1,024 tokens | **Sonnet 4.6, 4.5**; Opus 4.1, 4 |

Sonnet 5 isn't in the page's table verbatim (it's not fully current), but the
project's own SYSTEM prompt in `explain.ts` is a few hundred words and the
article is rendered at "~15k tokens for the test article" per that file's own
comment — comfortably over any plausible Sonnet threshold once the article is
the cached block. The bare system prompt alone, cached on its own, might sit
close to or under a 1,024-token floor and simply not qualify — another reason
the article, not the system prompt, is the block worth marking.

## The 1-hour TTL

`"cache_control": { "type": "ephemeral", "ttl": "1h" }` — presented as
ordinary, no beta header or extra opt-in mentioned anywhere in OpenRouter's
docs. (Talking to Anthropic directly, the 1-hour TTL needs the beta header
`extended-cache-ttl-2025-04-11`; OpenRouter's docs don't mention needing that
header from callers, which reads as OpenRouter adding it upstream itself, but
this isn't stated outright — worth confirming with a live `cache_write_tokens`
check rather than trusting the omission.) Cost: 2x base input price to write,
vs 1.25x for the default 5-minute TTL. Reads are 0.1x either way.

For `explain.ts` and `converse.ts`, the default 5-minute window is probably
fine — a reader selecting several passages, or asking several chat questions,
in one sitting will land within 5 minutes of each other. 1h only pays off if
sessions are longer than that or traffic on one article is sparse.

## Pricing and reading it back from `usage`

- Cache write (5 min): 1.25x input price. Cache write (1h): 2x. Cache read: 0.1x.
- The response's `usage.prompt_tokens_details` carries `cached_tokens` (read
  from cache) and `cache_write_tokens` (written to cache this call).
  **Verified live 2026-08-26** — both are nested inside `prompt_tokens_details`,
  and neither is a sibling of `prompt_tokens`. Spelled out because the first
  implementation read the write count from `usage.cache_write_tokens`, one level
  too high, and got `null` on every call while the reads worked.
- **`usage: { include: true }` and `stream_options: { include_usage: true }`
  are both deprecated and now no-ops** — per OpenRouter's usage-accounting
  docs, full usage details are always included automatically, streaming or
  not. `converse.ts` already sends `stream_options: { include_usage: true }`
  (with a comment explaining why); that's now unnecessary but harmless, not
  wrong.
- For streaming, usage arrives exactly once, in the **final SSE chunk**,
  paired with an empty `choices` array — this is exactly what `converse.ts`'s
  `sseChunks`/`usage` handling already assumes (it holds `chunk.usage` from
  whichever chunk carries it, since the usage-bearing chunk has no `delta` to
  render).
- **To verify caching is real**, read `prompt_tokens_details.cached_tokens` on
  a second call and confirm it's nonzero and close to the token count of the
  cached block. `cache_write_tokens` on the first call in a burst confirms the
  write happened. A `cache_discount`-style single dollar-amount field was not
  found in current docs — the per-token breakdown is the mechanism to log, the
  same way `searchesFrom` already exists in `explain.ts` to catch a field
  OpenRouter renamed out from under the app.

## Provider routing and whether pinning is needed

OpenRouter can serve `anthropic/claude-sonnet-5` from more than one upstream
(Anthropic direct, Bedrock, Vertex, etc. — whichever providers list the
model), and a cache genuinely lives on one upstream: "a cache lives where it
was written," per OpenRouter's own
[sticky-routing blog post](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/).
Two ways to keep hits landing on the same one:

1. **Sticky routing (default, automatic).** OpenRouter identifies a
   "session" by hashing the first system/developer message and the first
   non-system message, and routes follow-up requests for that session back to
   whichever provider wrote the cache — *when that provider's cache-read price
   beats normal input price*. No config needed. Its default session-identity
   hash is a problem specifically for `explain.ts`: since the first user
   message there embeds the reader's quote, that hash differs on every call
   even for the same article, so the built-in heuristic won't reliably treat
   repeated selections on one article as "the same session." OpenRouter
   exposes an explicit `session_id` request field for exactly this case —
   worth setting to (e.g.) the article's slug if going this route.
2. **Manual pinning** — `provider: { order: ["anthropic"], allow_fallbacks:
   false }`. Deterministic, and documented to **override** sticky routing
   outright ("your order wins over sticky routing"). This also make logs
   easier to read (one upstream, not "whichever OpenRouter picked").

Given this app already logs `model` (the upstream-reported model string) per
call, pinning `provider.order: ["anthropic"]` is the simpler, more legible
choice over relying on the session-hash heuristic — it removes one more
"quietly not what you think" axis matching this file's own house style
(explain.ts's `searchesFrom`, converse.ts's stall-vs-deadline distinction).

## Streaming

Confirmed above under Pricing: one usage-bearing chunk, at the very end,
before `[DONE]`, `choices: []`. `converse.ts` is already built for that shape.

## Gotchas, and the SDK question

- **Automatic caching on a single flat string that changes near the end
  buys nothing but write cost.** This is `explain.ts`'s current shape — see
  above.
- **Explicit breakpoints need array `content`.** Straightforward, but it's a
  real code change to both files' message-building functions, not a one-line
  flag flip.
- **Provider-routing risk is real, not theoretical**: a
  [Zed issue](https://github.com/zed-industries/zed/issues/52576) reports
  `cache_read_tokens` staying at 0 through OpenRouter with Claude Sonnet 4.6;
  it was closed via a Zed-side PR, and the OpenRouter-side root cause was
  never stated in what's public. Read as: don't trust caching is working from
  the absence of an error — always check `cached_tokens` on a live call before
  believing it, exactly the way `searchesFrom` and `citedBlocks` already exist
  in this codebase to catch a silently-broken field.
- **Minimum-token floor.** A short system prompt alone, cached on its own,
  may sit under the threshold and simply never cache — one more reason to
  target the article body specifically, since it's reliably large.
- **Should these two calls move to the Anthropic SDK instead, just for
  reliable caching?** No — not recommended. Prompt caching itself is no more
  reliable on the Anthropic SDK than through OpenRouter's raw-HTTP shape (same
  underlying mechanism, same header/field-level access via `cache_control`);
  what the SDK would *not* preserve is `openrouter:web_search`, the server
  tool both `explain.ts` and `converse.ts` depend on and whose usage-field
  quirks (`server_tool_use` vs `server_tool_use_details`) both files already
  work around. Moving to the Anthropic SDK means re-implementing web search
  against Anthropic's own `web_search_20260209` tool (different result-block
  shape, different usage fields, no OpenRouter dashboard/billing), for no
  caching benefit that isn't already available through OpenRouter. The
  cheaper, lower-risk path is: keep the raw-HTTP OpenRouter shape, add
  `cache_control` (top-level for `converse.ts`, restructured explicit
  breakpoint for `explain.ts`), pin `provider.order: ["anthropic"]`, and log
  `cached_tokens`/`cache_write_tokens` next to the existing token counts to
  verify it's actually landing — the same "log the field that would catch the
  silent failure" pattern this codebase already uses twice.

## Sources

- [openrouter.ai/docs/features/prompt-caching](https://openrouter.ai/docs/features/prompt-caching)
- [openrouter.ai/docs/guides/best-practices/prompt-caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
- [openrouter.ai/docs/use-cases/usage-accounting](https://openrouter.ai/docs/use-cases/usage-accounting)
- [openrouter.ai/docs/api-reference/overview](https://openrouter.ai/docs/api-reference/overview)
- [openrouter.ai/docs/features/provider-routing](https://openrouter.ai/docs/features/provider-routing)
- [openrouter.ai/blog/tutorials/prompt-caching-sticky-routing](https://openrouter.ai/blog/tutorials/prompt-caching-sticky-routing/)
- [github.com/zed-industries/zed issue #52576](https://github.com/zed-industries/zed/issues/52576) —
  real-world report of OpenRouter+Anthropic cache reads staying at 0
- Anthropic's own docs on the 1-hour TTL beta header (`extended-cache-ttl-2025-04-11`),
  used above only as a point of comparison for what OpenRouter may or may not
  be adding on callers' behalf — not independently confirmed against
  OpenRouter's docs, which don't mention the header either way
