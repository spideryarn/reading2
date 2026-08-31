# Every LLM call site, and where caching would pay off

Written 2026-08-26. This is the research behind a caching decision, not the decision itself — it
answers "where are the calls, how big is the shared part, and is there a byte-identical prefix to
cache" for every place this app talks to a model. See
[original-version/prompt-caching.md](../project/original-version/prompt-caching.md) for the design
the previous app wrote and never shipped — this doc checks whether we are set up to actually build
it, and the short answer is **not yet, for the same reason they weren't**: nine call sites, and no
two of them wrap the article the same way.

Verified against the code on 2026-08-26. `grep -rn "cache_control\|ephemeral" src evals scripts`
returns **zero hits** — nothing in this app sets a cache breakpoint anywhere, on either provider.

## The nine call sites

| # | File : line | Function | Client / model | Calls per article | Static across calls? |
|---|---|---|---|---|---|
| 1 | [`src/toc.ts:473`](../../src/toc.ts) | `generateToc` | Anthropic SDK, `MODEL` | 1 (pipeline, once per content hash) | `system` only |
| 2 | [`src/arc.ts:235`](../../src/arc.ts) | `generateArc` | Anthropic SDK, `MODEL` | 1 | `system` only |
| 3 | [`src/tweets.ts:393`](../../src/tweets.ts) | (thread generator) | Anthropic SDK, `MODEL` | 1 | `system` only |
| 4 | [`src/glossary.ts:774`](../../src/glossary.ts) | (glossary generator) | Anthropic SDK, `MODEL` | 1 per top-up (usually 1) | `system` only |
| 5 | [`src/labels.ts:481`](../../src/labels.ts) | (label generator) | Anthropic SDK, `MODEL` | N batches, 4-way parallel (`CONCURRENCY = 4`, `p-queue`) | `system` + outline |
| 6 | `src/summarise.ts:824` | (summary generator) | Anthropic SDK, `MODEL` | N batches, 3-way parallel (`CONCURRENCY = 3`, own `pooled` helper) | `system` only |
| 7 | [`src/converse.ts:279`](../../src/converse.ts) (fetch at 348) | `converse` | OpenRouter fetch, `OPENROUTER_MODEL` | 1 per chat message, request path | `system` only |
| 8 | [`src/explain.ts:163`](../../src/explain.ts) (fetch, via `fetchOrExplainWhy`, at 396) | `explain` | OpenRouter fetch, `OPENROUTER_MODEL` | 1 per selection, request path | `system` only |
| 9 | [`src/search.ts:293`](../../src/search.ts) (fetch at 335) | `findPassages` | OpenRouter fetch, `OPENROUTER_MODEL` | 1 per search, request path | `system` only |

All six Anthropic-SDK stages instantiate their own client — `new Anthropic()` at
[`toc.ts:473`](../../src/toc.ts), [`arc.ts:235`](../../src/arc.ts),
[`tweets.ts:393`](../../src/tweets.ts), [`glossary.ts:774`](../../src/glossary.ts),
[`labels.ts:481`](../../src/labels.ts), `summarise.ts:824`. No shared
client factory, no shared request-building wrapper. The three OpenRouter call sites each build their
own `fetch` to `https://openrouter.ai/api/v1/chat/completions` the same way — no shared wrapper
there either.

### Real sizes

`data/constitution/blocks.json` (354KB on disk) has 360 blocks and 141,472 characters of block
text — about 35,400 tokens at a plain chars/4 estimate. `data/noema-mythology-of-conscious-ai/`
(153KB) has 141 blocks and 52,573 characters — about 13,100 tokens. `explain.ts`'s own comment
independently says "~15k tokens for the test article", which lines up. Both are well past
Anthropic's cache-breakpoint minimum (1,024–2,048 tokens depending on model — check current figures
with the `claude-api` skill before implementing).

Each stage's `system` string (the one genuinely constant thing per stage, across every article
forever) is small by comparison — measured by pulling the `SYSTEM` template literal out of each
file and counting chars/4:

| Stage | `SYSTEM` size |
|---|---|
| `toc.ts` | 1,950 chars ≈ 490 tokens |
| `labels.ts` | 1,846 chars ≈ 460 tokens |
| `summarise.ts` | 2,707 chars ≈ 680 tokens |
| `arc.ts` | 2,918 chars ≈ 730 tokens |
| `tweets.ts` | 3,049 chars ≈ 760 tokens |
| `glossary.ts` | 3,426 chars ≈ 860 tokens |

None of these alone crosses the cache minimum comfortably on every model, and — more importantly —
a system prompt that's read once per article gets zero within-run benefit from caching. The article
text is the part worth caching, both because it's an order of magnitude bigger and because (see
below) it's the one thing several stages genuinely share.

## Does everyone wrap the article the same way? No — not even close

This is the question the doc exists to answer, because it's the one the previous app got wrong and
never recovered from (see [prompt-caching.md § The prerequisite that killed
it](../project/original-version/prompt-caching.md#the-prerequisite-that-killed-it)). Reading each
stage's own article-rendering function:

**Pipeline (Anthropic SDK), four different block-rendering formats:**

- `toc.ts` — [`renderBlocks`](../../src/toc.ts) (line 122): `` `[${i}] ${b.id} <${b.tag}>${mark}: ${b.text}` `` joined by blank lines. Includes array index, block id, tag, gistable mark. The user message is *only* this — no instructions in the user turn at all, everything else lives in `system`.
- `arc.ts` and `tweets.ts` — both use plain `blocks.map((b) => b.text).filter(Boolean).join("\n\n")`. This one line is byte-identical between the two files (same formula, copy-pasted rather than shared), but it's embedded in prompts that are not identical: `arc.ts`'s `renderPrompt` (line 114) puts dynamic instructions first, then `=== STRUCTURE ===`, then `=== FULL TEXT ===`; `tweets.ts`'s `renderPrompt` (line 245) puts dynamic instructions first, then `=== THE ARTICLE ===` (title/byline), then `=== ITS SHAPE ===`, then `=== ITS FULL TEXT ===`. Different headers, different section order, different preamble. `glossary.ts`'s `renderPrompt` (line 634) uses the same plain-text join again, under yet another set of headers (`=== THE ARTICLE ===` / `=== ITS SHAPE ===` / `=== ITS FULL TEXT ===`, plus a variable-length "already in the glossary" block inserted *before* the article section on later calls).
- `labels.ts` — [`renderBatch`](../../src/labels.ts) (line 308): `` `[${n}] <${b.tag}>${kind}: ${b.text}` `` (ordinal, not block id; a `HEADING` flag) for a narrow window of blocks around the batch (`CONTEXT_BLOCKS = 1` either side) — not the whole article. The one part that *is* static per article is `renderOutline(tree)` (line 290), a short list of section titles, and it does come first in the prompt: `"THE ARTICLE'S OUTLINE\n\n${outline}\n\nTHE SECTIONS YOU ARE LABELLING\n\n..."`. That's the one call site already ordered cache-friendly — but the shared part is the outline (a few hundred tokens), not the full article.
- `summarise.ts` — `renderPrompt` (line 404) calls `textOf(scope, blocks, order)` (line 393), which **slices to the target node's block range**, not the whole article, except when the target is depth 0 ("THE WHOLE ARTICLE"). So even within one summarise run, the "full text" block varies batch to batch by construction. A `repair` string is also prepended at position zero on retry, which would shift a cache-breakpoint hash on the very call it's most likely to matter for.

**No two of the six produce the same bytes for the same article.** Even the two that share a
one-line formula (`arc.ts`/`tweets.ts`) wrap it in different headers, and both bury it after
variable-length instructions rather than putting it first.

**Request-path (OpenRouter), a third pattern — the marker problem:**

- `converse.ts` — [`renderArticle`](../../src/converse.ts) (line 193) and `explain.ts` —
  [`renderArticle`](../../src/explain.ts) (line 148) are near-identical: `` `[${i}]${marker} ${b.id}: ${b.text}` `` for every block, with a head of `TITLE` / `BY` / `PUBLISHED IN` / `URL`. But the `←READER IS HERE` marker is injected **inside the per-block loop**, at whichever block the reader is currently on (`converse.ts`) or selected (`explain.ts`). That means the "static" article body isn't static at all — it changes every time the reader scrolls or selects a different passage, because the marker moves through the middle of the text rather than sitting in a separate, stable section. Two independent copies of this function exist (not shared), and they'd need to agree even after that fix.
- `search.ts` — [`renderArticle`](../../src/search.ts) (line 154) is a **third, simpler variant**: `` `[${i}] ${b.id}: ${b.text}` ``, no marker, no `URL` line (three head fields instead of four). This is the one call site that's already genuinely static per article — nothing in `renderArticle(meta, blocks)` depends on the call. The query is appended after it (`"Here is the whole article.\n\n${renderArticle}\n\n---\n\nThe reader is looking for..."`), so the ordering (article first, variable part last) is already right.
- `converse.ts` (comment at line 304) has already reasoned about this explicitly: *"the article goes in the FIRST user message... keeping [the system prompt] article-free is what makes it cacheable"* — but no `cache_control` is ever actually attached. The intent was there; the implementation stopped short.
- `converse.ts`'s `recentHistory` (line 231, `HISTORY_TURNS = 20` at line 85) is a sliding window: once a conversation passes 20 turns, the oldest pair drops off and every later message shifts left in the array — which would invalidate any cache breakpoint placed after the article on a long-running chat, even if the article block itself were stable.

## The seam question

**There is no shared seam for building a request.** Nine call sites, nine ad hoc request bodies.
What *is* shared:

- **Response parsing.** [`src/parse-json.ts`](../../src/parse-json.ts) (`parseJsonFrom`) is a real
  shared layer — used by the storage modules (`chat.ts`, `comments.ts`, `searches.ts`) and by the
  model-calling stages via each one's own `parseJson` wrapper that strips code fences first. This is
  the one place a caching-aware refactor could hook a `cache_read_input_tokens` /
  `cache_creation_input_tokens` log line without touching six call sites individually — but only if
  the six calls first go through one function that returns the raw `message`, which they don't yet.
- **Output-budget sizing**, not input counting. [`src/token-budget.ts`](../../src/token-budget.ts)
  computes `max_tokens` (answer + `THINKING_HEADROOM`) from a stage's own estimate of its answer
  size. It does not count or estimate input/article tokens at all — there's no reusable "how big is
  this prompt" helper anywhere in the repo today.
- **Where token counts get logged.** Not inside any stage. Each stage reads
  `message.usage.input_tokens` / `output_tokens` off its own Anthropic response and returns it on
  its result object (e.g. `toc.ts:549-550`, `arc.ts:288-289`, `tweets.ts:453-454`,
  `glossary.ts:853-854`, `labels.ts:455-456`, `summarise.ts:745`). The actual log line is written
  centrally, once per step, from [`src/pipeline.ts`](../../src/pipeline.ts) (e.g. lines 499–507 for
  the `toc` step): `plog.info({ slug, step, model, inputTokens, outputTokens, ms, ... })`. That's
  the seam CLAUDE.md's logging.md refers to — it's a *logging* seam, not a request-building one, and
  it doesn't exist for the three OpenRouter calls (those log from inside `converse.ts` / `explain.ts`
  / `search.ts` themselves, under the `model` component, per `src/log.ts`'s own `Component` union
  comment at line 173). Neither logging path reads `cache_read_input_tokens` today, because nothing
  ever populates it.

## Caching verdict, ranked

1. **`search.ts` — the readiest call site.** Article-first ordering already, no per-call marker in
   the article body, and a real repeat-call pattern (a reader can search the same article more than
   once in a session). Adding a `cache_control` breakpoint after `renderArticle(meta, blocks)` is the
   smallest change on this list with a plausible payoff. Needs turning the single `content` string
   into a content-block array so there's a block boundary to mark, and needs confirming OpenRouter's
   passthrough for Anthropic models actually honours `cache_control` in its (OpenAI-shaped) request
   body — verify with the `claude-api` skill before building.
2. **`converse.ts` / `explain.ts` — cache-hostile as built, fixable.** Both already isolate the
   article into its own message/section (good), but both break it by burying a moving marker inside
   the per-block loop instead of stating "reader is at block X" as a separate line after a stable
   block list. Fix the marker placement first; then these become as cacheable as `search.ts`, and
   both are genuinely repeat-called per article (multiple chat turns, multiple explain requests).
3. **`labels.ts` and `summarise.ts` — real multi-call-per-article stages, but the shared prefix is
   thin.** `labels.ts`'s outline is static and already first, but it's short (a title list, not the
   article). `summarise.ts`'s article slice actually *varies* by target scope, so there's no one
   static block to cache across its own batches without restructuring `textOf` to always send the
   whole article and let the model attend to the requested range. Cache-worthy only after that
   restructure.
4. **`toc.ts`, `arc.ts`, `tweets.ts`, `glossary.ts` — one call per article, ever (content-hash
   cached).** Caching within a single stage's own calls is worthless here — there's only one call to
   read a cache written by. The only way these four earn anything from caching is **cross-stage**:
   one shared, byte-identical article block, written once (by whichever of the six pipeline stages
   runs first for an article) and read by the other five in the same ingest run. That crosses
   Anthropic's break-even (one write, several reads) easily, and the six calls happen close enough
   in time to fit inside any plausible cache TTL. This is the prize the original app's design was
   aiming at and never reached — see next section for why it isn't free.

**Flagged as likely net-negative today:** none of the nine calls are cache-hostile in the sense of
"pure one-off, adding a breakpoint would only cost the write premium" — every call site sends
enough article text, often more than once per article, that caching is at worst neutral once the
prefix is actually shared. The risk is elsewhere: a cache write that's never read (see below).

## Is a cross-feature shared prefix actually achievable?

Not with a cache breakpoint alone — the six pipeline stages have **six different `system` strings**,
each carrying that stage's own instructions. Anthropic's cache match is prefix-based over the whole
request (system, then messages, in order); if `system` differs, nothing after it can be a cache hit
against a different stage's call, no matter how identical the article bytes are. So "one shared
cached prefix serving toc + arc + summarise + glossary + labels" is not achievable by just
reordering each stage's own prompt — it needs the article moved *out* of each stage's own
instructions and into a block that's identical across all six requests, which in Anthropic's API
means restructuring `system` itself into an array: `[{ type: "text", text: SHARED_ARTICLE_BLOCK,
cache_control: { type: "ephemeral" } }, { type: "text", text: STAGE_INSTRUCTIONS }]`. Only the
marked block and everything before it need to match for a cache hit — what comes after can differ
per stage. That is close to what the previous app specified (article inside `system`, dynamic
instructions after), and it is exactly the "one shared helper, one wrapper tag" prerequisite their
own postmortem names — see [prompt-caching.md § What we'd do,
concretely](../project/original-version/prompt-caching.md#what-wed-do-concretely).

Concretely, three things block it today:

1. **Four incompatible block-rendering formats** in the pipeline stages alone (id+tag+mark;
   plain text; ordinal+tag+heading-flag; scoped slice), so there is no `SHARED_ARTICLE_BLOCK` to
   point at yet.
2. **The article isn't in `system` anywhere** — every stage puts it in the user message, mixed with
   that stage's own headers and instructions.
3. **The OpenRouter calls are a separate provider path.** Even if the six Anthropic-SDK stages
   shared one article block, that cache is Anthropic-side and per-API-key; whether OpenRouter's three
   calls could join the same cache, or need a parallel cache of their own via OpenRouter's own
   passthrough, is unverified — check before assuming a nine-way shared cache is one project rather
   than two.

## What to log if this gets built

Per the previous app's own conclusion (point 4 of their "what we'd do, concretely" list): **log
whether the cache was read or written on every call**, not just whether it was attempted. A cache
that silently stops hitting looks identical to one that's working —
[silent-success.md](../reusable/silent-success.md) again. Concretely: extend the return shape each
stage already sends back (`inputTokens`, `outputTokens`) with `cacheReadTokens` /
`cacheCreationTokens` read off `message.usage.cache_read_input_tokens` /
`cache_creation_input_tokens`, and let `plog.info` in `src/pipeline.ts` log them the same way it
already logs the other two — that's the existing seam, and it's the only one that needs touching to
make caching observable.
