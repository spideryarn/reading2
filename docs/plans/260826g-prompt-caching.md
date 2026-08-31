# Prompt caching: pay for the article once

**Built 2026-08-26**, with four deviations from the plan below — see
[What actually landed](#what-actually-landed) at the foot of this file. The operating manual is
[docs/project/prompt-caching.md](../project/prompt-caching.md). The research behind every claim here:
[260826c-prompt-caching-callsites.md](../research/260826c-prompt-caching-callsites.md) (where the money goes),
[260826b-prompt-caching-anthropic.md](../research/260826b-prompt-caching-anthropic.md) (mechanics and pricing),
[260826d-prompt-caching-openrouter.md](../research/260826d-prompt-caching-openrouter.md) (the request-path calls).

## The problem, and the prize

A reader who searches an article, asks a question about it, then selects a sentence to explain
sends the whole article to the model three times — 13k tokens each trip for the Noema piece, 35k
for the constitution, at full price, while they wait. Every chat turn sends it again. Every glossary pass sends it again. The article
is the long part of nine prompts, it never changes, and we pay for it like it changes every time.

Anthropic's prompt caching fixes exactly this shape: mark the unchanging prefix, pay 1.25× to
write it once, then 0.1× to read it back — with Sonnet 5 at $2.00/MTok, that's $0.20/MTok for
every repeat. Break-even is the **second** use. Chat alone reuses the article on every turn.

The catch, and the reason this needs a plan rather than a flag: caching matches **bytes**, and
today the article is byte-identical in none of the nine prompts. Nine call sites each render it
their own way, and two of them stamp `←READER IS HERE` into the middle of the body — so those
two could never hit a cache in their lives. The previous version designed all of this, hit the
same prerequisite — *make five prompts agree about how the article is wrapped* — and never
started ([original-version/prompt-caching.md § The prerequisite that killed
it](../project/original-version/prompt-caching.md#the-prerequisite-that-killed-it), which warned
in as many words that this repo would reproduce the failure). The
[borrow-list](../project/original-version/borrow-list.md#do-these-now-while-they-are-still-free)'s
top two rows are this work. This plan is the cashing of it.

## The design in three sentences

**Three cached prefixes, not one.** The id-annotated rendering (search, explain, converse — the
calls a reader waits on) becomes one shared function once the position marker moves out of the
body. The bare-text rendering (arc, tweets, glossary, summarise) becomes a second shared
function, moved to the *front* of each prompt. Labels keeps its own deliberately id-free
rendering and caches its shared outline; toc stays uncached — its rendering is genuinely its
own, and forcing it into a common shape would be changing a prompt to suit an optimisation,
which is the wrong way round.

### Where the caches actually are — fewer than you'd hope, and worth saying first

Two limits, both consequences of the same fact: the cache match runs over the **whole request**,
in the order tools → system → messages, from byte zero.

**The request path gets three caches per article, not one.** The article bytes will be shared —
but the prefix starts at tools and system, and those differ: search deliberately sends no tools
("no page on the web can answer it"), explain and converse send `openrouter:web_search`, and all
three have different system prompts. That changes the arithmetic less than it sounds: the win
was never the first touch, it is that explain today *never* hits a cache across a reader's
selections, and chat re-pays the article on *every turn*. Both are within-feature, and both are
fully unlocked. Unifying three system prompts to chase one shared cache would degrade the
prompts for the optimisation's sake — not doing it.

**Pipeline stages can only share a prefix by restructuring `system`.** The six stages have six
different `system` strings, and every one puts the article in the user message, *after* its own
system prompt — so no reordering inside the user message can ever line two stages up
([260826c-prompt-caching-callsites.md § Is a cross-feature shared prefix actually
achievable?](../research/260826c-prompt-caching-callsites.md#is-a-cross-feature-shared-prefix-actually-achievable)).
The fix is the article as the first block of a `system` **array**, stage instructions second —
step 4, and it is a real restructure, not a reorder. Even then, sharing is opportunistic: arc
runs at ingest (`DEFAULT_INGEST_STEPS` in [`src/pipeline.ts`](../../src/pipeline.ts)), while
tweets, glossary and summaries run when somebody asks — often not within 5 minutes of each
other. The shared block is still worth building (a full regeneration hits it, so does a reader
asking for two things in one sitting, and one renderer is what stops the copies drifting), but
the *reliable* pipeline wins are within-stage: labels' 4-way fan-out over its outline,
summarise's repair retry and split parents, and a glossary top-up landing within the TTL of the
pass before it.

## The shared helper

**New module: `src/article-prompt.ts`.** Two functions, each returning the complete article
block, **heading included** — because the block's wrapper is where byte-identity dies today:
arc, tweets and glossary share a one-line body formula and then wrap it in three different
header sets in different orders. The helper owning the whole block, heading and all, *is* the
"settle one wrapper tag" decision the previous version never took
([borrow-list](../project/original-version/borrow-list.md#do-these-now-while-they-are-still-free)):

```ts
/** The article for prompts that cite blocks: TITLE/BY/PUBLISHED IN/URL head,
 *  then `[i] id: text` per block. No position marker — ever. */
export function articleWithIds(meta: Meta, blocks: Block[]): string;

/** The article for prompts that must not cite blocks: the same head,
 *  then bare block text joined with blank lines. */
export function articleText(meta: Meta | null, blocks: Block[]): string;

/** True when the block is too short for Sonnet 5's 1,024-token cache floor —
 *  the marker would silently do nothing. Callers log it; nothing throws. */
export function underCacheFloor(text: string): boolean;
```

Two deliberate unifications inside `articleWithIds`: the head always carries the `URL:` line
(today search omits it — inert there, since search has no web tool), and the `←READER IS HERE`
marker is gone from the body. Explain and converse say where the reader is in their **varying
suffix** instead — one line after the cached block naming the block id — which does the same job
and leaves the article identical across every scroll position and every selection.

**Who it does not serve, and why that's right:**

- **toc** (`[i] id <tag>: text`) — needs the tags to see structure, makes one call per article.
  A prefix used once costs 1.25× and returns nothing.
- **labels** (`[n] <tag>: text`, no ids) — withholds ids *on purpose* so the model cannot cite
  them, and sends a windowed slice, not the whole article. Its cacheable part is the outline,
  which is not the article.

`underCacheFloor` reuses the chars-per-token estimate already in
[`src/token-budget.ts`](../../src/token-budget.ts) — export it rather than minting a second
constant that can drift.

## The steps

Each lands on its own, each checkable on its own. Cheap and high-value first.

### 1. One renderer, and the marker moves out of the body

*Files: new `src/article-prompt.ts`; `src/search.ts` (~155), `src/explain.ts` (~150),
`src/converse.ts` (~195) delete their private `renderArticle`s and call it; explain and
converse gain the position line in their suffixes. New `tests/article-prompt.test.ts` (step 6
has the cases).*

Pure refactor — no caching yet, no behaviour change beyond the marker's new home and search's
new `URL:` line. This is the step the previous version never took, and it is the whole
prerequisite. Also extract each file's request assembly into an exported pure builder
(`buildSearchRequest`, `buildExplainMessages`, `buildConverseMessages`) returning the messages
it will send — that is what makes step 6 possible without a network.

### 2. Turn caching on for the request path

*Files: `src/search.ts`, `src/explain.ts`, `src/converse.ts`.*

- **converse** — add top-level `"cache_control": {"type": "ephemeral"}` beside `model` in the
  request body. OpenRouter's automatic mode works with the plain-string messages the file
  already sends, and its advance-as-the-conversation-grows behaviour is exactly chat's shape:
  the article sits in its own early user message, history is re-sent in full, only the tail
  grows. The reader-position line goes in the final user message with the question — it isn't in
  stored history, so each turn re-pays only the previous turn at write rate, never the article.
  One known edge: past `HISTORY_TURNS` (20) the sliding window drops the oldest pair and every
  later message shifts, so a very long chat degrades to hitting only the system-plus-article
  prefix. That is still the long part, and not worth machinery.
- **explain** and **search** — explicit breakpoint, which needs array `content`:

  ```ts
  { role: "user", content: [
      { type: "text", text: articleWithIds(meta, blocks),
        cache_control: { type: "ephemeral" } },
      { type: "text", text: suffix },  // the selection / the criterion
  ] }
  ```

- All three: pin `provider: { order: ["anthropic"], allow_fallbacks: false }` — a cache lives on
  one upstream, and pinning beats OpenRouter's session-hash heuristic, which explain's varying
  first message defeats anyway
  ([260826d-prompt-caching-openrouter.md](../research/260826d-prompt-caching-openrouter.md#provider-routing-and-whether-pinning-is-needed)).
- All three: read `usage.prompt_tokens_details.cached_tokens` and `cache_write_tokens` and put
  them on the existing `model` log lines (step 8).

### 3. One article block for the pipeline: unify the wrappers, and put it first

*Files: `src/glossary.ts` (~670), `src/tweets.ts` (~262), `src/arc.ts` (~114),
`src/summarise.ts` (~435).*

All four put the article **last**, and no two wrap it the same way — arc says
`=== FULL TEXT ===`, tweets and glossary say `=== ITS FULL TEXT ===` under different preambles.
This step is both fixes at once: each `renderPrompt` becomes article block first — from
`articleText`, so the wrapper is settled in one place, not four — then the stage's skeleton,
meta and instructions. Two specific fixes ride along:

- **glossary**: the `${already}` list — which grows every pass and today sits directly *before*
  the article, invalidating the previous pass's cache — moves after it.
- **summarise**: the `repair` string on a retry is prepended at **position zero**, which moves
  every byte behind it. It moves to the end, with the instructions. A retry that can't reread
  the article it just paid for is the most avoidable miss in the repo.

Still no `cache_control` — this step is pure ordering, deterministic, and testable. It is also
the step with a quality question attached; see the honest assessment for how we check it.

### 4. Breakpoints for the pipeline stages

*Files: `src/arc.ts`, `src/tweets.ts`, `src/glossary.ts`, `src/summarise.ts`, `src/labels.ts`.*

For the four bare-text stages, the article moves **out of the user message and into `system`**,
as the first block of an array, with the stage's own system prompt after it. Be clear this is
the expensive step, not a reorder: `system` changes shape in four files, and the article
changes *rooms*. It is also the only arrangement that can work — the six stages have six
different system prompts, and a differing `system` sits in front of the article and breaks the
match before it starts. Only the marked block and what precedes it must match; everything after
may differ per stage. It is Anthropic's own canonical document-then-breakpoint pattern, and
close to what the previous version specified:

```ts
system: [
  { type: "text", text: articleText(meta, blocks),
    cache_control: { type: "ephemeral" } },
  { type: "text", text: SYSTEM },
],
messages: [{ role: "user", content: renderTask(opts) }],
```

- **summarise**: only the root scope uses `articleText` (its full-text batch is then
  byte-identical to the other stages'). A non-root scope's text gets a breakpoint only when
  that scope spans more than one batch (a parent split at the eight-child cap, or the repair
  retry) — the batch builder knows. Marking a single-use scope is a 25% premium for nothing.

  **The trade we are declining:** `textOf` sends each batch a *slice* of the article, so its
  batches share nothing; sending the whole article every time would create one shared prefix.
  Declined. The arithmetic is a wash, not a win: cached, every batch still bills the full
  article at 0.1× plus one 1.25× write, while today's slices sum to roughly one article per
  batched tree level — which of those is smaller depends on the tree's shape, so cost decides
  nothing. What decides it is the prompt: a batch scoped to one section seeing the whole piece
  is an invitation to summarise outside its scope, and re-evaluating summary quality across
  every node to serve an optimisation is the wrong way round. The slice is a prompt decision,
  and bytes serve the prompts.
- **labels**: its shared part is the outline, identical across all four parallel batches.
  `renderBatch` (~335) splits into two content parts with the breakpoint after
  `THE ARTICLE'S OUTLINE`. If the outline is under the floor the marker silently no-ops, which
  costs nothing — but log `underCacheFloor` so the silence is visible.
- **toc**: untouched.

### 5. First call alone, then the rest

*Files: `src/labels.ts` (`CONCURRENCY = 4`), `src/summarise.ts` (`CONCURRENCY = 3`).*

A cache entry is unreadable until the request writing it has started streaming, so a
simultaneous fan-out has every call pay the write and none get the read
([260826b-prompt-caching-anthropic.md § Concurrency](../research/260826b-prompt-caching-anthropic.md#7-concurrency)).
Await the **first** batch to completion, then run the rest at the existing concurrency. Simpler
than plumbing a first-token signal, and the pipeline is not latency-critical — it costs one
batch's duration per stage. For summarise, order the pool so a batch that shares a prefix with
another goes first.

### 6. The tests

*File: new `tests/article-prompt.test.ts`, plus cases in `tests/labels-batching.test.ts` and the
stage tests.* All deterministic — no network, no model, per
[testing.md](../project/testing.md#what-we-test-and-what-we-dont). The whole failure mode here
is [silent-success.md](../reusable/silent-success.md): a broken cache looks exactly like a
working one, the field is present, the bill goes up. The testable surface is the pure builders
from steps 1 and 4.

- **Same article, two questions** → `buildExplainMessages` / `buildSearchRequest` produce a
  byte-identical (`toBe`) first content part. Same for two different selections.
- **Two reader positions** → converse's article message identical for `at: A` and `at: B`; the
  position appears only in the final user message. Same across a growing history.
- **The three features agree** → the article part from search, explain and converse builders is
  the *same string* — one renderer, provably, so an inlined re-copy goes red.
- **The marker cannot creep back** → `articleWithIds` output, and every builder's article part,
  `not.toContain("READER IS HERE")`.
- **Repair doesn't move the prefix** → summarise's builder with and without `repair` returns an
  identical `system[0]`; the repair text appears only in the task message.
- **Glossary pass two matches pass one** → builder with `existing: []` and with a grown
  `existing` list returns an identical `system[0]`.
- **Labels batches share the outline** → all four batches' first content part identical, and the
  breakpoint part contains no paragraph text.
- **The floor guard** → `underCacheFloor` flips at the boundary the token estimate implies, and
  the example fixture's `articleText` output clears 1,024 tokens with margin — so a future
  change that quietly shrinks the shared block below the floor (where caching no-ops with zeros
  in both fields and no error) goes red instead.

### 7. Prove it against a real model: `npm run eval:caching`

*Files: new `evals/prompt-caching.ts`, a script line in `package.json`, results committed under
`evals/results/` with a line in `results/README.md`.*

The deterministic tests prove the prefix is *stable*; only this proves it is actually *cached*.
Neither substitutes for the other — a stable prefix nobody marked, and a marked prefix that
quietly stopped matching, both look exactly like success
([silent-success.md](../reusable/silent-success.md)). An eval, not a test: it calls a model,
costs money, and its results are committed so the next change is compared against a number
rather than somebody's memory ([testing.md](../project/testing.md#evals-are-not-tests-and-live-in-their-own-folder)).
It follows [`evals/toc-labels.ts`](../../evals/toc-labels.ts)'s shape and runs against the same
two committed texts — `data/constitution` (360 blocks, ~35.4k tokens) and
`data/noema-mythology-of-conscious-ai` (141 blocks, ~13.1k tokens) — with one honest difference
from its sibling: toc-labels measures artefacts that already exist, and this one has to spend.

What it runs and reports, per call:

- **The reader's sequence** — search, then a chat question, then an explain, then a second of
  each, on one article. The first three show what cross-feature sharing actually is (expected
  per the design: three writes, three caches); the second three are the claim under test — each
  must show a non-zero `cached_tokens` close to the article's token count, plus
  `cache_write_tokens` and the upstream provider, so a silent OpenRouter miss is visible.
- **One pipeline stage twice** on the smaller text — `cache_creation_input_tokens` on the
  first, non-zero `cache_read_input_tokens` on the second.
- **One cross-stage pair** (arc then tweets, back to back) — whether the shared system-block
  prefix really carries across stages. Believed, not yet observed; the eval is the arbiter.
- **The money** — each call's cost at the observed cache rates against the same call uncached.

The committed number is most of the answer to
[open-questions.md § Q7](../project/open-questions.md#q7) — per house rules, the answer moves
into the docs and Q7 shrinks. And the Zed/OpenRouter report of cache reads stuck at zero is why
this step is not optional: never believe caching from the absence of an error.

### 8. Logging

*Files: the six stage files' `*Run` interfaces, `src/pipeline.ts` (the five log sites at
501–649), and the `model` log lines in `src/search.ts`, `src/explain.ts`, `src/converse.ts`.*

`cacheReadTokens` and `cacheWriteTokens` join `inputTokens`/`outputTokens` on every `*Run`,
summed across a stage's calls the way `LabelRun` already sums, and logged from the same seam in
`pipeline.ts` — not from inside anyone's stage. The CLI `console.log` token lines gain the same
two counts. Request-path lines carry OpenRouter's spellings. Counts only: no prose, nothing
sensitive, per [logging.md](../project/logging.md). A cache that stops hitting looks exactly
like one that is working; a `cacheReadTokens: 0` streak in the logs is the only alarm there is,
so it ships on day one, before anyone trusts a cost number.

### 9. Docs

- **New `docs/project/prompt-caching.md`** — where the three
  prefixes live, the one renderer, how to read the cache counts in a log line, and the floor.
  Plus its signpost row in `CLAUDE.md`.
- [original-version/prompt-caching.md](../project/original-version/prompt-caching.md) — a
  dated note at the top: cashed, and where.
- [original-version/borrow-list.md](../project/original-version/borrow-list.md) — strike the two
  "do now" rows and item 1 of "build next", the way the done rows already read.
- [logging.md](../project/logging.md) — the two new count fields.
- [search.md](../project/search.md), [glossary.md](../project/glossary.md),
  [summaries.md](../project/summaries.md), [comments.md](../project/comments.md) — one line each
  where prompt order or the marker is described today.
- [open-questions.md](../project/open-questions.md) — Q7, per step 7.
- [testing.md § Evals](../project/testing.md#evals-are-not-tests-and-live-in-their-own-folder)
  and [`evals/README.md`](../../evals/README.md) — the two new evals, beside `toc-labels.ts`.
  `CLAUDE.md`'s testing row already names `evals/`, so it needs only the new doc's signpost.

## Honest assessment

**What it costs.** Steps 1, 3 and 6 are a day of careful, boring byte-shuffling — which is
precisely the work that killed the previous version's attempt, so calling it boring is not
calling it optional. Step 4 is the structural one: `system` changes shape in five files and the
article changes rooms. Steps 2, 5 and 8 are small. The evals cost a few dollars per run.

**First touch gets dearer.** A write is 1.25×. A reader who searches once and leaves pays 25%
more for that search than today; a pipeline stage that runs alone pays 25% more on its article
tokens. Break-even is the second use, and chat turns, repeated explains, glossary top-ups and
the labels fan-out all reuse — but a cache is a bet, and this plan places it only where the
reuse is real, which is why toc and single-use summarise scopes stay unmarked.

**Reordering could change output quality.** Models weight recency; moving the instructions from
before a 35k-token article to after it is not a free edit. The direction of the move matches
Anthropic's own long-context guidance — document first, task last — so it is more likely to help
than hurt, but "likely" is not a measurement — and the check is an eval, not an eyeball.
Before landing steps 3 and 4: snapshot the incumbent artefacts for both committed texts (keep
the incumbent — the habit [testing.md](../project/testing.md) records), regenerate, and re-run
`npm run eval:toc` for labels; for glossary, tweets and arc — which have no eval today — apply
toc-labels' mechanical measures to the before/after pair, vocabulary retention above all, since
it is the one that has already caught a reorder-shaped regression (the batch prompt turning
"technorati" into "technologists"). A small `evals/reorder-quality.ts` doing that comparison is
part of step 3's definition of done. If quality drops, the reordering is wrong and caching does
not happen at that call site — bytes serve the prompts, not the other way round.

**The money is cents today, and that is worth saying out loud.** A cache read of the
constitution costs about $0.007 against $0.071 uncached — real money only when multiplied by
readers this app does not yet have. Two reasons to do it now anyway: cached tokens skip
prefill, so the calls a reader actually waits on get faster, which is felt at any scale; and
the byte discipline is the borrow-list's cheapness-times-regret case — nearly free across nine
call sites today, and the previous version is the measurement of what it costs later.

**The OpenRouter path can silently not work.** There is a public report of cache reads stuck at
zero through OpenRouter with Claude. Provider pinning and step 7's live check are the defences;
if reads stay zero after pinning, the fallback question — move explain/converse to the Anthropic
SDK — has already been answered no in the research (it would cost the web-search tool), so the
honest outcome would be: request-path caching waits, pipeline caching proceeds.

**Cross-stage sharing may not materialise.** It needs stages within 5 minutes of each other and
identical everything before the article block — same thinking config, no tools, same model. The
eval checks it once; if it fails, nothing else in the plan is diminished.

**A model change flushes every cache.** Caches are model-scoped. `src/models.ts` already treats
a model change as making artefacts stale, so this adds no new policy — but a comparison run via
a `SPIDERYARN_*_MODEL` override will show all-write, no-read logs, which is correct and worth
not being alarmed by.

## Deliberately not doing

- **The 1-hour TTL.** 2× writes need three uses to pay off; a reading session's interactions
  land within 5 minutes of each other, and a hit refreshes the TTL for free.
- **Pre-warming** (`max_tokens: 0` on page load). The previous version specified it and never
  needed it; ours would spend money on articles nobody asks anything about. Revisit only if
  first-question latency is ever the complaint.
- **Caching toc**, or forcing toc and labels into the shared rendering. Their prompts differ for
  prompt reasons.
- **Unifying the three request-path system prompts** to share one cache across features — see
  "Where the caches actually are" above.
- **Widening summarise's `textOf` to the whole article per batch** to manufacture a shared
  prefix — declined in step 4, where the arithmetic and the scope-bleed risk are spelled out.
- **`session_id` sticky routing.** Pinning the provider is deterministic and easier to read in
  a log.
- **A shared LLM client seam.** Nine call sites is a real smell, but building one is a bigger
  decision than caching should make as a side effect. The renderer plus the `*Run` fields are
  the narrow seams this needs.

## See also

- [260826c-prompt-caching-callsites.md](../research/260826c-prompt-caching-callsites.md) — the audit this plan executes
- [260826b-prompt-caching-anthropic.md](../research/260826b-prompt-caching-anthropic.md) /
  [260826d-prompt-caching-openrouter.md](../research/260826d-prompt-caching-openrouter.md) — mechanics
- [original-version/prompt-caching.md](../project/original-version/prompt-caching.md) — the
  design that was never shipped, and this plan's answer to it
- [silent-success.md](../reusable/silent-success.md) — the failure shape everywhere above
- [logging.md](../project/logging.md) — what a model call may write down
- [testing.md](../project/testing.md) — why the tests stop at the builders

---

## What actually landed

Built 2026-08-26. Steps 1, 2, 4, 5, 6, 8 and 9 went in as written. Four deviations, each with its
reason:

**1. Summaries got the prerequisite but not the breakpoint.** The `repair` string moved out of
position zero, which is the fix that had to happen either way. No `cache_control` though, for two
reasons: `textOf` sends only the slice a batch's scope covers, so batches mostly share nothing and
marking a single-use scope is a 1.25× premium for no read; and another agent was concurrently
restructuring that same prompt (adding block ids to `textOf`, with a test pinning them), so
reordering it would have collided with live work. The plan's conditional-marking idea —
mark only a scope that spans more than one batch — is still the right shape when someone returns to it.

**2. `underCacheFloor` does not reuse a constant from `token-budget.ts`.** The plan says to export
the chars-per-token estimate from there. There isn't one — that file sizes `max_tokens` for *output*
and never counts input. `estimateTokens` and `CACHE_FLOOR_TOKENS` live in
[`src/article-prompt.ts`](../../src/article-prompt.ts) instead.

**3. Provider routing is an ordering, not a ban.** The plan and the research both said
`provider: { order: ["anthropic"], allow_fallbacks: false }`. The `allow_fallbacks: false` half was
dropped: it turns an Anthropic outage into a hard failure on three calls a reader is sitting and
waiting for. A cache miss costs money; an unavailable feature costs the reader the feature. The
ordering alone still keeps repeat calls landing where the cache is.

**4. The GPT Sol review did not complete.** The Codex workspace was out of credits, then briefly
refilled, then exhausted again 165k tokens into a high-effort run — mid-review, and researching
exactly the right question (whether `output_config.effort` and a `system` array interact with cache
invalidation). Nothing usable came back. The prompt is kept ready at
[260826g-prompt-caching-review-prompt.md](260826g-prompt-caching-review-prompt.md); **run it at a lower effort**, or
it will burn a refill before it reports. This is still outstanding.

### The eval has run, and it found two bugs

`npm run eval:caching` was run against the live API on 2026-08-26 for all three articles. **All three
pass.** Numbers in `evals/results/`, summarised in
[evals/results/README.md](../../evals/results/README.md). The headline, from a genuine cold start on
the constitution: the first call costs 25% more, every call after it costs 10%, break-even at the
second use.

It also caught two defects that were invisible to the whole test suite, which is the argument for
having spent the money:

- **`cache_write_tokens` was read one level too high** — it is nested inside
  `prompt_tokens_details`. Every log line reported `cacheWriteTokens: null`, which reads as "the
  provider did not tell us" rather than as "we asked wrongly". The research doc had it right; it was
  read carelessly.
- **`tooShortToCache` measured only the marked block**, not the whole prefix. The prefix starts at
  byte zero and includes the system prompt, so an 893-token article whose request caches 2,056
  tokens was reporting `true`. A false alarm — the costly direction, because nobody believes the
  next one.

Both fixed, both now pinned by tests in
[`tests/article-prompt.test.ts`](../../tests/article-prompt.test.ts).

**The quality check on the reordered prompts is set up but not concluded.** Moving the article ahead
of the instructions in `arc`, `tweets` and `glossary` is not a free edit — models weight recency. The
direction matches Anthropic's own long-context guidance, but that is a reason to expect it to be
fine, not evidence that it is. [`evals/reorder-quality.ts`](../../evals/reorder-quality.ts)
(`npm run eval:reorder`) measures it, and **the incumbent numbers are already captured** at
`evals/results/reorder-quality-before.md` — taken before anything was regenerated, because they stop
being obtainable afterwards. What remains is to regenerate those artefacts and compare. If vocabulary
retention falls, put that stage's prompt back and leave it uncached.
