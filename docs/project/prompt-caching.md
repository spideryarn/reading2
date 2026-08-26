# Prompt caching — paying for the article once

The article is the long part of nine prompts and it never changes. This is how we stop paying for it
every time.

Built 2026-08-26 from [prompt-caching.md](../plans/prompt-caching.md), which has the reasoning and
the alternatives. The research behind it:
[anthropic](../research/prompt-caching-anthropic.md) (mechanics, pricing, invalidation),
[openrouter](../research/prompt-caching-openrouter.md) (the request-path calls),
[callsites](../research/prompt-caching-callsites.md) (the audit).

This doc is the operating manual: where the caches are, what breaks them, and how to tell.

## The one rule

**A cache matches bytes, not intentions.** The prefix has to be identical, character for character,
from the very top of the request. Two prompts that render the same article two reasonable ways share
nothing at all.

That is why there is one module — [`src/article-prompt.ts`](../../src/article-prompt.ts) — and why
nothing else may render the article for a prompt. Nine hand-written near-copies is what this app had
before, and two of them had already drifted.

## Where the caches are

Three, not one, and the reason is that the prefix starts at the top of the request: **tools, then
system, then messages.** Anything ahead of the article that differs between two calls stops them
matching before the article is even reached.

| Cache | Who shares it | The rendering |
|---|---|---|
| **request path** | search, chat, explain — one entry *each*, per article | `articleWithIds` |
| **pipeline** | arc, tweets, glossary — one shared entry per article | `articleText` |

Note what the pipeline row does **not** mean. Each of those three makes *one* call per run, so none
of them caches anything for itself; the entry only pays off when two of them run close together —
within one ingest, or a top-up landing inside the 5-minute TTL of the pass before it. That is
opportunistic by nature, and the eval is what will say how often it actually happens. The labels row
is the one that is reliable, because its four batches run together by construction.
| **labels** | the four parallel batches of one run | the outline, via `batchParts` |

The request path gets three entries rather than one because the three differ *before* the article:
search sends no tools, chat and explain send `openrouter:web_search`, and all three have their own
system prompt. Unifying those to chase one shared entry would mean degrading three prompts to suit an
optimisation, which is the wrong way round. It costs less than it sounds — the win was never the
first touch, it is that explain used to hit a cache *never* and chat re-paid the article on *every
turn*.

**Not cached, on purpose:** the table of contents (one call per article — a prefix used once costs
1.25× and earns nothing back) and summaries (each batch sends only the slice its scope covers, so
batches mostly share nothing; the `repair` retry was moved out of position zero as the prerequisite,
but the breakpoint is not in yet).

## The marker that used to ruin it

`converse.ts` and `explain.ts` both wrote the reader's position **into the article body**:

```ts
`[${i}]${b.id === at ? " ←READER IS HERE" : ""} ${b.id}: ${b.text}`
```

So the article's bytes changed on every scroll and every selection. Explain never sent the same
prefix twice in its life.

The position now travels in the varying part, after the breakpoint — `readerPositionLine`. The model
is told the same thing; the article stays identical. **Do not put it back.**
[`tests/article-prompt.test.ts`](../../tests/article-prompt.test.ts) goes red if anyone does, and
that test is the only thing that would notice — see below.

## How to tell whether it is working

**You cannot tell by looking.** A cache that has silently stopped hitting returns the same correct
answer, raises no error, and costs more. It is
[silent-success.md](../reusable/silent-success.md) exactly.

Two defences, and neither substitutes for the other:

- **`tests/article-prompt.test.ts`** proves the prefix is *stable* — byte-identical across two
  questions, two selections, two reading positions, a growing conversation. Deterministic, no
  network, runs on every change. It cannot prove anything was cached.
- **`npm run eval:caching -- data/<slug>`** proves it is *cached*, by calling twice and reading the
  number back. Costs money, run by hand, results committed under `evals/results/`. The pass
  condition is a non-zero `cacheReadTokens` on the second call. See
  [testing.md](testing.md) for why the two live in different folders.

**Run 2026-08-26 against the live API: all three articles pass.** On the constitution, a cold call
writes 47,739 tokens and costs $0.119 — *more* than the $0.096 it would have cost uncached, which is
the 1.25× write premium — and every call after it costs $0.0097. That is the whole bargain in two
lines, and break-even at the second use is not a projection any more.

Worth knowing what that run caught, because it is the argument for spending the money: two defects
the entire test suite was blind to. `cache_write_tokens` was being read from `usage.cache_write_tokens`
when it is nested in `prompt_tokens_details`, so every log line said `cacheWriteTokens: null` — which
reads as "not told" rather than "asked wrongly". And `tooShortToCache` measured only the marked block
instead of the whole prefix, so a short article whose request cached fine reported `true`. Neither
could have failed a unit test: one needs a live response, the other needs to be compared against what
the provider actually did.

Every call also logs its counts, next to the tokens it already logged:

| Field | Where |
|---|---|
| `cacheReadTokens`, `cacheWriteTokens` | the `model` lines in search, explain, converse |
| the same two | the `pipeline` line, from the seam in [`src/pipeline.ts`](../../src/pipeline.ts) |
| `tooShortToCache` | the request-path lines only |

**`cacheReadTokens: 0` on a repeat call is the alarm.** There is no other one. Counts only — no
prose, nothing sensitive, per [logging.md](logging.md).

## The floor, and why zero is ambiguous

Sonnet 5 will not cache a prefix under **1,024 tokens**. Under it, the breakpoint is accepted and
does nothing: no error, and zeros in both usage fields — which is indistinguishable from a cache that
has broken. `underCacheFloor` exists to tell those two apart, and callers log it rather than throwing,
because a short article is a perfectly good article that simply cannot be cached.

The floor is a property of the model, not of us: Opus 5 needs 512, Haiku 4.5 needs 4,096, and the
progression is not monotonic. **Anything that edits [`src/models.ts`](../../src/models.ts) should
look at `CACHE_FLOOR_TOKENS`.** A model change also flushes every cache — caches are model-scoped —
so a comparison run via a `SPIDERYARN_*_MODEL` override will show all writes and no reads, which is
correct and not a fault.

## What breaks a cache

In rough order of how easily it happens here:

1. **Anything per-call inside the marked block.** The marker above is the worked example. A
   timestamp, a growing list, a reader's question — if it varies, it belongs after the breakpoint.
2. **A breakpoint after the varying part instead of at the boundary.** Every call writes, none
   reads: strictly worse than not caching, and invisible.
3. **Reordering so the article no longer comes first.** `glossary`'s already-found list used to sit
   directly before the article and grows on every top-up, so it guaranteed a miss on the one run
   most likely to be repeating work.
4. **A firing fan-out.** A cache entry cannot be read until the request writing it has begun
   streaming, so four simultaneous batches all pay the write and none gets the read. `labels` starts
   its queue at concurrency 1 and widens after the first batch returns — see
   [`src/labels.ts`](../../src/labels.ts).
5. **Editing one stage's article rendering.** There is one renderer for a reason; changing it changes
   what several stages send.
6. **Provider routing.** A cache lives on the upstream that wrote it. All three OpenRouter calls
   send `provider: { order: ["anthropic"] }` — an ordering, deliberately **not**
   `allow_fallbacks: false`. Banning fallback would turn an Anthropic outage into a hard failure on
   a call a reader is waiting for, and a cache miss costs money where an unavailable feature costs
   the reader the feature.

Changing `temperature` or `max_tokens` does **not** break anything — they are not part of the
rendered prompt.

## The prices this rests on

Sonnet 5, per MTok, as of 2026-08-26: input `$2.00`, cache write (5 min) `$2.50`, cache read `$0.20`.
Break-even is the **second** use of a prefix, which is why single-use prefixes are left unmarked.
The 1-hour TTL is deliberately not used — it doubles the write and needs three uses, and a reading
session's calls land within minutes of each other. A cache hit refreshes the TTL for free.

## See also

- [prompt-caching.md (the plan)](../plans/prompt-caching.md) — the steps, and the honest assessment
- [original-version/prompt-caching.md](original-version/prompt-caching.md) — the same design, written
  for the previous version of this app and never built. It named the prerequisite that killed it —
  five prompts each wrapping the article differently — and warned this repo would reproduce it. It
  did. This is that debt paid.
- [silent-success.md](../reusable/silent-success.md) — the shape of every failure on this page
- [logging.md](logging.md) · [testing.md](testing.md) · [setup-dev.md](setup-dev.md)
