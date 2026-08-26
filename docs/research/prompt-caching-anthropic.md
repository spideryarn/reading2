# Prompt caching, for the Anthropic API

> **Status.** Research, 2026-08-26. Written to answer a question about whether and how to use
> prompt caching in this project's calls to Claude (`@anthropic-ai/sdk`). Nothing here is wired up
> yet — this is the reference to work from when we do.

Prompt caching lets Claude skip re-processing the part of a request that's identical to a recent
one. Mark a point in the request with `cache_control`, and everything before that point can be
read back cheaply next time instead of paid for at full price. It only helps when requests share a
long, unchanging prefix — a big system prompt, a document, a tool list — followed by something
that varies.

## 1. Mechanics

You mark a spot with `cache_control: {type: "ephemeral"}` on a content block. The API caches
everything from the start of the request up to and including that block.

Where you can put a breakpoint: any content block — system text blocks, tool definitions, and
message content blocks (text, image, document, tool_use, tool_result). **Up to 4 breakpoints per
request.** You can also skip picking a spot entirely and put `cache_control` at the top level of
`messages.create()`, which auto-places it on the last cacheable block.

The request is rendered in a fixed order — **tools, then system, then messages** — and this order
is what "the prefix" means. A breakpoint on the last system block caches the tools and the system
prompt together; a breakpoint on the last message caches everything before it, tools and system
included.

The match is an **exact-byte prefix match**. There's no fuzzy or semantic matching — one different
character anywhere before the breakpoint (a timestamp, a re-ordered JSON key, a different tool)
invalidates everything from that point on.

**Lookback window.** Each breakpoint only looks back 20 content blocks for a prior cache entry. In
a long agentic loop with many tool_use/tool_result pairs, a single turn can add more than 20
blocks, and the next breakpoint silently misses. Fix by placing an extra breakpoint every ~15
blocks in long turns.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## 2. Minimum cacheable prefix length

Below this many tokens, a `cache_control` marker is accepted but does nothing — no error, just
`cache_creation_input_tokens: 0` and `cache_read_input_tokens: 0` in the response.

| Model | Minimum |
|---|---:|
| Claude Opus 5, Claude Fable 5, Claude Mythos 5 | 512 tokens |
| Claude Opus 4.8, **Claude Sonnet 5**, Sonnet 4.6, Sonnet 4.5, Opus 4.1, Opus 4 | 1,024 tokens |
| Claude Opus 4.7, Mythos Preview | 2,048 tokens |
| Claude Opus 4.6, Opus 4.5, Haiku 4.5 | 4,096 tokens |
| Haiku 3.5 | 2,048 tokens |

This isn't a smooth progression — Opus 4.6 and Haiku 4.5 both need 4,096 tokens, a higher bar than
the newer Opus 5 needs (512). If this project migrates models, check this table again rather than
assuming a lower minimum carries over.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## 3. TTL

Two options, set per breakpoint:

```json
"cache_control": {"type": "ephemeral"}                // 5 minutes (default)
"cache_control": {"type": "ephemeral", "ttl": "1h"}    // 1 hour
```

No beta header is needed for the 1-hour TTL — it's generally available on the Claude API, Amazon
Bedrock, Claude Platform on AWS, Vertex AI, and Microsoft Foundry.

**The TTL is measured from the start of the request that writes or reads the cache**, not from
when the response finishes — so a slow response eats into the window.

**A cache hit refreshes the TTL for free.** Reading a cache entry resets its clock to another full
5 minutes (or 1 hour), and you're billed at the cheap read rate for that, not the write rate. So a
cache that's being hit steadily never expires in practice — it only expires from being idle longer
than its TTL.

**Mixing TTLs in one request:** if you use both a 1-hour and a 5-minute breakpoint, longer TTLs
must appear before shorter ones in the request. Anthropic's docs describe billing this as three
zones — tokens up to the highest cache hit are reads, tokens from there to the last 1-hour
breakpoint are 1-hour writes, and tokens from there to the last 5-minute breakpoint are 5-minute
writes.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## 4. Pricing

Multipliers on the base input price:

| Operation | Multiplier |
|---|---:|
| Cache write, 5-minute TTL | 1.25× |
| Cache write, 1-hour TTL | 2× |
| Cache read (either TTL) | 0.1× |

For **Claude Sonnet 5** ($2.00 / $10.00 per MTok, input/output — this project's model, per
[setup-dev.md](../project/setup-dev.md) and [`src/models.ts`](../../src/models.ts)):

| Operation | Price per MTok |
|---|---:|
| Base input (uncached) | $2.00 |
| Cache write, 5m | $2.50 |
| Cache write, 1h | $4.00 |
| Cache read | $0.20 |

**Break-even.** A write is a bet that you'll read the same prefix again before it expires:

- 5-minute TTL: write (1.25×) + one read (0.1×) = 1.35×, versus paying full price (1×) twice —
  break-even is right around the **second** use of the same prefix.
- 1-hour TTL: write (2×) + one read (0.1×) = 2.1×, versus 2× uncached — the 1-hour TTL needs about
  **three** uses to pay off, because the write itself costs more.

If a prefix is only ever going to be sent once, don't cache it — you'll pay the 1.25×/2× premium
and never earn back the read discount.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## 5. Response fields — what to log to prove caching is working

```json
"usage": {
  "input_tokens": 50,
  "cache_creation_input_tokens": 5120,
  "cache_read_input_tokens": 100000,
  "output_tokens": 503,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 148,
    "ephemeral_1h_input_tokens": 100
  }
}
```

- `cache_creation_input_tokens` — tokens written to a new cache entry this request (billed at the
  write multiplier).
- `cache_read_input_tokens` — tokens served from an existing cache entry (billed at the read
  multiplier).
- `input_tokens` — **only the uncached remainder**, i.e. tokens after the last cache breakpoint
  that weren't themselves written to cache. Total prompt size is the sum of all three fields, not
  `input_tokens` alone.
- `cache_creation` — the breakdown of `cache_creation_input_tokens` by TTL, present when mixing
  5-minute and 1-hour breakpoints in one request.

**To verify caching is actually working:** log `cache_read_input_tokens` alongside
`cache_creation_input_tokens`. If `cache_read_input_tokens` stays at 0 across repeated requests
that should share a prefix, something in the prefix is changing byte-for-byte every time (see
§6) — diff the two rendered request bodies to find it. This is the kind of failure this project's
[logging.md](../project/logging.md) calls out: the log line has to carry the counts, or a caching
regression looks like a normal, quiet request forever.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## 6. Invalidation gotchas

This is the section that matters most, because every one of these fails **silently** — no error,
just a cache write where you expected a cache read, and a bill that doesn't match your mental
model.

**Top 5:**

1. **Anything non-deterministic in the prefix.** `Date.now()` or a UUID interpolated into a system
   prompt, unsorted `JSON.stringify` of an object, a `Set` iterated in insertion order that isn't
   guaranteed — any of these make every request's prefix bytes different, so nothing after them
   ever matches. This is the single most common cause of "caching isn't working."
2. **Changing the tool list.** Tools render first, at position 0. Adding, removing, reordering, or
   even editing a tool's description or schema invalidates the tools cache and everything after it
   (system + messages). Build the tool list deterministically (e.g. sorted by name) and don't vary
   it per user or per request.
3. **Switching models.** Caches are model-scoped — there's no shared cache between two different
   model IDs, even if the prompt text is byte-identical. There's no workaround for this one; if a
   sub-task uses a cheaper model, it starts its own cache from scratch.
4. **Putting a breakpoint at the wrong place, or at the end of the whole prompt instead of the end
   of the shared part.** If the marker sits after the varying question rather than before it, every
   request writes a brand-new cache entry that's never read again — you pay the write premium on
   every single call and the read discount on none of them.
5. **The 20-block lookback window in long agentic turns.** If one turn appends more than 20 content
   blocks (common with many tool_use/tool_result pairs), the next breakpoint can't see back far
   enough to find the earlier cache write, and it silently misses. Needs an intermediate breakpoint
   roughly every 15 blocks in long tool-use turns.

**Full invalidation hierarchy** — not every change invalidates everything; the cache has three
tiers (tools, system, messages) and a change only invalidates its own tier and the tiers after it:

| Change | Invalidates tools cache | Invalidates system cache | Invalidates messages cache |
|---|:---:|:---:|:---:|
| Tool definitions (add/remove/edit) | yes | yes | yes |
| Model switch | yes | yes | yes |
| `speed`, web search toggle, citations toggle | yes | no | no |
| System prompt content | yes | no | no |
| `tool_choice`, adding/removing images, thinking on/off | yes | yes | no |
| Message content | yes | yes | no |

Read that table as: a change to `tool_choice` or to `thinking` doesn't cost you the tools+system
cache — only tool definitions and the model itself force a full rebuild. So it's safe to flip
`tool_choice` or toggle thinking per-request without worrying about cache cost.

**Whitespace and ordering do matter** — the match is byte-exact, so any change to serialized JSON
key order, whitespace, or formatting in the cached region breaks the match. This is why
"non-deterministic serialization" (an unsorted dict, an unstable `JSON.stringify`) is worth
grepping for specifically.

**`temperature` and `max_tokens` do not participate in the cache key** — they're generation
parameters, not part of the rendered prompt, so changing them doesn't invalidate anything.

**Interleaved / adaptive thinking:** thinking blocks can't be marked with `cache_control` directly,
but on models that support it they get cached automatically as part of a previous assistant turn
when you pass tool results back. Turning thinking on or off is a system/tools-tier change (see the
table above) — it doesn't touch the messages cache.

**Two escape hatches exist** for changes that would otherwise blow the whole cache, both by moving
the change into `messages[]` after the cached prefix instead of editing the top-level request:

- **Mid-conversation system messages** (Claude Opus 5, Opus 4.8, Fable 5, Mythos 5 — **not**
  Sonnet 5, so not usable with this project's model — no beta header): append
  `{"role": "system", "content": "..."}` to `messages[]` instead of editing the top-level `system`
  field, to inject an operator instruction without invalidating the history prefix.
- **Mid-conversation tool changes** (Opus 5 onward, behind beta header
  `mid-conversation-tool-changes-2026-07-01`): `tool_addition`/`tool_removal` blocks instead of
  editing the top-level `tools` array.

Since this project uses Sonnet 5, neither escape hatch applies today — a system-prompt or
tool-list change here means paying the full rebuild cost. That's a real constraint worth knowing if
this project's system prompt ever needs runtime-injected state.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## 7. Concurrency

**A cache entry only becomes readable once the first response that writes it has started
streaming** — not once it's fully finished, but once the stream begins. If N requests that share
an uncached prefix are all fired at once, none of them can read what any of the others is still
writing, so all N pay the full write price. There's no server-side de-duplication or queuing that
protects you from this.

**Recommended warm-up pattern for a fan-out:** send one request first, wait for it to start
streaming (the first token, not the full response), then fire the remaining N−1. Those N−1 will
land after the first one's cache write has begun and can read it.

**Pre-warming (deliberately, ahead of real traffic):** send a request with `max_tokens: 0` and the
cache breakpoint on the shared content (not on a placeholder message). It runs a prefill, writes
the cache, and returns immediately with `content: []`, `stop_reason: "max_tokens"`, and a normal
`usage` block — no output tokens billed, just the cache-write charge. This is worth doing when
first-request latency is user-visible, the shared prefix is large, and there's a natural moment
before traffic arrives (app start, a scheduled window) to fire it. Not worth it if traffic is
already more frequent than the TTL, since real requests keep the cache warm on their own.
`max_tokens: 0` is rejected together with `stream: true`, `thinking.type: "enabled"`,
`output_config.format`, a forced `tool_choice`, or inside a Batches request.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## 8. Best-practice patterns

**Rule zero: put static content first, dynamic content last.** The rendered order is always tools
→ system → messages, so anything you want cached has to physically precede anything that varies.
This one ordering decision determines whether caching is possible before any `cache_control`
marker is even placed.

**(a) A long static document + varying question.** Put the document in `system` (or in the first
message), with the breakpoint on the last block of the document — not on the question. The
question, which changes every request, goes after the breakpoint with no marker of its own.

```json
"system": [
  {"type": "text", "text": "<large shared document>", "cache_control": {"type": "ephemeral"}}
],
"messages": [{"role": "user", "content": "<varying question>"}]
```

**(b) A growing conversation.** Put the breakpoint on the last content block of the most recently
appended turn, every turn. Each new request then reuses the entire prior conversation as a cache
hit, and only the newest turn is an uncached write. Earlier breakpoints stay valid as read points,
so hits accumulate as the conversation grows — you don't need to remove old breakpoints, just add
a new one at the end each turn (bounded by the 4-breakpoint max, so drop the oldest if you're
using all 4).

**(c) A batch of N calls sharing one big document.** Same as (a), but be deliberate about the first
call: since a cache entry isn't readable until the first response starts streaming, send the first
request alone, wait for its stream to begin, then fire the rest — or pre-warm with a
`max_tokens: 0` call before the batch starts (§7).

**(d) Tool definitions.** Tools render first, so if they're static, cache them along with the
system prompt by putting the breakpoint on the last system block (it covers tools + system
together). If a project has both a stable core tool set and a few tools that vary, keep the
variable ones out of `tools` entirely if possible — any change to the tool list is a full
invalidation (§6), so there's no such thing as caching "most of" the tool list.

**The two-breakpoint pattern** (one at the end of the static prefix, one at the end of the
conversation so far) covers (a) and (b) at once: breakpoint 1 caches the document/system/tools;
breakpoint 2 caches the conversation up to now, on top of that. Each new turn moves breakpoint 2
forward and leaves breakpoint 1 untouched.

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-caching

## 9. Common misconceptions

- **"Caching is automatic once I've cached it before."** No — every request that wants a cache hit
  must itself include a matching `cache_control` breakpoint at a byte-identical prefix. There's no
  implicit caching from having sent similar content before; you opt in per request.
- **"A shorter prefix still caches, just less efficiently."** No — below the model's minimum
  (§2), nothing is cached at all, not even partially. It's a hard floor, not a diminishing return.
- **"I can put the breakpoint at the very end of the prompt and get the best cache."** This is
  backwards for shared-prefix + varying-suffix requests — putting the marker after the varying part
  means the "cached" bytes are different every time, so every request is a write and none is a
  read (§6, gotcha 4). The breakpoint has to sit at the boundary between what's shared and what
  isn't, not at the end of everything.
- **"Temperature or max_tokens changes will break my cache."** They don't — they're not part of
  the rendered prompt and don't participate in the cache key at all (§6).
- **"Parallel requests will share the very first cache write."** Only if they're staggered enough
  for the first to start streaming before the rest are sent (§7). Fired simultaneously, they race
  and all lose.
- **"The 1-hour TTL needs a beta header, like some other Anthropic features."** It doesn't — it's
  GA with no beta header required (§3), unlike the mid-conversation tool-change escape hatch in
  §6, which does need one.

## Sources

- Prompt caching (main reference for all sections above):
  https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Anthropic Claude API skill's cached prompt-caching notes (used to draft the initial pass, then
  checked against the live page above): `shared/prompt-caching.md` in the bundled `claude-api`
  skill, and the TypeScript-specific syntax in that skill's `typescript/claude-api/README.md`.
- Current model pricing (Sonnet 5 numbers used in §4):
  https://platform.claude.com/docs/en/pricing.md
