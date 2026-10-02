# Prompt caching — paying for the article once

Up: [architecture.md](architecture.md)

The article is the long part of many prompts and it never changes. This is how we stop paying for it
every time.

Built 2026-08-26 from [prompt-caching.md](../plans/260826g-prompt-caching.md), which has the reasoning and
the alternatives. The research behind it:
[anthropic](../research/260826b-prompt-caching-anthropic.md) (mechanics, pricing, invalidation),
[openrouter](../research/260826d-prompt-caching-openrouter.md) (the request-path calls),
[callsites](../investigations/260826c-prompt-caching-callsites.md) (the audit). Revisited 2026-10-01:
[current practice](../research/261001a-prompt-caching-best-practice-2026.md), a
[production audit](../investigations/261001a-prompt-caching-production-audit/README.md) of every call
against thirty days of real spend, and [the plan](../plans/261001l-prompt-caching-across-every-call.md)
those led to — mostly a decision *not* to add machinery, § What production actually does.

This doc is the operating manual: where the caches are, what breaks them, and how to tell.

## The one rule

**A cache matches bytes, not intentions.** The prefix has to be identical, character for character,
from the very top of the request. Two prompts that render the same article two reasonable ways share
nothing at all.

That is why there is one module — [`src/article-prompt.ts`](../../src/article-prompt.ts) — and why
nothing else may render the article for a prompt. Nine hand-written near-copies is what this app had
before, and two of them had already drifted.

> [!CAUTION]
> **Two live examples of getting the tier wrong, both from the explain feature, 2026-08-26.** A
> "search the web properly" button needed to tell the model to look harder. The obvious place is the
> system prompt — which costs a second cache write of the whole article, because system renders
> *before* messages and the article's breakpoint is after it. Avoiding that, the first draft instead
> raised `max_uses` on the web-search tool. That is **worse**: tools render at position 0, so a tool
> edit invalidates all three tiers, for both variants. The instruction now rides in the last user
> part, after the breakpoint, and the tool definition is byte-identical on every call.
> [260826l-explain-deeper-answers.md](../plans/260826l-explain-deeper-answers.md#what-the-review-changed).

## Where the caches are

Three, not one, and the reason is that the prefix starts at the top of the request: **tools, then
system, then messages.** Anything ahead of the article that differs between two calls stops them
matching before the article is even reached.

| Cache | Who shares it | The rendering |
|---|---|---|
| **request path** | search, chat, explain — one entry *each*, per article. All three use an **explicit** breakpoint on the article; see the chat postmortem for why automatic mode is not an option here | `articleWithIds` |
| **pipeline** | one entry per **group**, and a group is a matching effort **and** renderer — read off [`STAGE_EFFORT`](../../src/models.ts) and `ARTICLE_RENDERER`, never kept in a list here. On 2026-10-01 that was five: the big `ids` group (tweets, ideas, timeline, quiz, faq, simple), glossary with quotes, and arc, crossrefs and sketch each alone — sketch since it moved to `low` effort that day, [measured](../investigations/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md). **In production almost none of it is used** — [§ What production actually does](#what-production-actually-does) | `articleText` or `articleWithIds`, per stage |
| **labels** | the parallel batches of one run | the outline, via `batchParts` |

All three are OpenRouter's caches now, and were not always — see
[§ Every cache now goes through OpenRouter](#every-cache-now-goes-through-openrouter).

Note what the pipeline row does **not** mean. Apart from Simple's three-call fan-out below, an article
stage makes one call per run, so it caches nothing for itself. The ordinary stage marker is enabled
only when another member of its group is in the **same job**; merely running two mode jobs inside the
5-minute TTL does not mark either one. Simple is the exception: it owns all three calls and their
`MeteredCall.onStart` coordination inside one call site.

The labels row reads as the reliable one — its four batches run together by construction — and on the
small articles it caches nothing at all. Its shared prefix is the system prompt plus the tree's
outline, and that comes to roughly **660 tokens** on the 141-block article and **950** on the
360-block one: both under the 1,024-token floor below. So the breakpoint is accepted and does
nothing there, and `generateLabels` skips the warm-up that would otherwise pay a batch of latency to
warm a cache that cannot exist, reporting `estimatedCacheable: false` beside the number of calls it
made.

**This paragraph used to end "it will start working on its own the day an article's outline is long
enough". It has.** Measured on a 16,855-word, 186-block article, the labels prefix is **~1,107
tokens** and clears the floor: three parallel batches each write it, a fourth call (a shortfall
re-ask, issued after they return) reads 1,107 back
([evals/results/cost-per-article-2026-09-03.md](../../evals/results/cost-per-article-2026-09-03.md)).
Nothing changed in the code; the corpus grew. Worth keeping in mind as the prediction that came true
quietly — no test went red and no line moved, which is the ordinary way a doc stops being accurate.

That fan-out is also the one place here where **writing an entry nobody reads is the correct
choice**: the three batches start together, and an entry is not readable until the first response
begins streaming, so two of the three writes are known to be wasted before they are made. We pay
them to keep the batches parallel. `evals/cost` § `checkBatchedDraw` therefore does not match writes
to reads one-for-one — it asks only that *some* later call collected, which is the question that
distinguishes a leak from a deliberate cost.

Both fields, because the flag alone cannot carry it: `cacheReadTokens: 0` is also what a run of one
fresh call reports, and what a fully resumed run reports, and neither of those is a fault. The pair
separates "there was nothing to read" from "there was, and it did not". And it is an *estimate* — four
characters to a token — so a prefix within a few percent of the floor could fall either side. That is
accepted: the worst case is a few cents and a batch of latency, and the alternative is a
`count_tokens` round trip before every run. GPT-5.6-sol, 2026-08-26.

### Glossary is a third cache, and the reason is not the article

`arc`, `tweets` and `glossary` did emit byte-identical article text — that part of the design worked.
(Tweets has since moved to `articleWithIds`, on 2026-09-29, so it left arc's group for the `ids` one;
the argument below about effort is unchanged.)
They still cannot share a cache, because **`output_config.effort` is part of the cache key**, and
the three stages are not all set to the same effort (`src/models.ts` § `STAGE_EFFORT`, which is
the one place that says which runs at what).

This is measured, not inferred — four calls with an identical 7,291-token cached block, varying only
`effort`, in [../research/260826b-prompt-caching-anthropic.md](../research/260826b-prompt-caching-anthropic.md).
Changing effort paid a full write; changing back read the original. GPT Sol's review raised it and
the repo's own research doc said the opposite, so it had to be settled with an experiment.

It is worth sitting with how this failed. Two stages can be made to agree on every byte of a 47,000
token prompt, and one number sitting *outside* that prompt — a number about how hard to think, which
has nothing to do with the article — silently puts them in different caches. Byte-identity of the
text was necessary and it was not sufficient, and no amount of reading the two prompts side by side
would have shown it.

**Decided, by measuring it** ([effort-vs-quality.md](../../evals/results/effort-vs-quality.md)):
the efforts stay as they are, and glossary stays a second cache. Two articles, three stages, both
values — arc at `medium` loses 11 points of vocabulary retention on one article, and glossary at
`high` gets markedly more formulaic on the other while spending 4,558 more output tokens. No value
wins, so aligning would mean paying in writing quality to win a cache. The settings on disk were
chosen for what each stage writes, and that is the right reason to choose them.

The same choice was measured for four more modes on 2026-10-01 — Sketch, Illustrated, Structure and
Ideas, eight articles and two blind judges —
[261001c](../investigations/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md).
Only Sketch moved, from `high` to `low`, which took it out of the `ids` group: it chose quality and
price over a cache share that production almost never collects ([below](#what-production-actually-does)).

The effort table now lives in [`src/models.ts`](../../src/models.ts) beside `CAPABLE_MODEL`, because both
are part of the cache key, and **that table is half the cache grouping** — `sharesArticleCache` in
[`src/pipeline.ts`](../../src/pipeline.ts) reads it rather than keeping a second list that could
drift back out of agreement with it.

**Half, since 2026-08-27, and it used to say "the".** Effort is the *surprising* half, which is why
it got written down first — but the bytes are the obvious half, and they stopped being uniform when
[ideas](ideas.md) arrived. That stage answers with block ids, so it must send `articleWithIds` where
the arc, the glossary and the summary sent `articleText` (the thread did too until 2026-09-29, when
it started naming its source blocks and moved to the ids rendering); the two renderings of one
article agree on the head and on nothing after it. Matching on effort alone would have marked the
article on an `arc` run because `ideas` was queued behind it at the same effort, paid the 1.25×
write premium, and collected no read at all. `ARTICLE_RENDERER` in `src/models.ts` is the second
table, and the predicate reads both.

The shape is worth remembering past this instance: **a grouping that is correct because of a fact
nobody wrote down stops being correct the moment the fact does.** Every article stage using one
renderer was that fact.

### And on the normal path, the pipeline breakpoints lose money

`DEFAULT_INGEST_STEPS` is `fetch, extract, blocks, structure, assets`
([`src/pipeline.ts`](../../src/pipeline.ts)) — `arc` moved out of it on 2026-08-29
([260829f](../plans/260829f-defer-arc-and-rename-hierarchy.md)), and `tweets`, `glossary` and
`summary` were always things a reader asks for later, by Greg's decision of 2026-08-25. So an
ordinary ingest now runs **no article stage at all**, and a top-up minutes or days later has long
missed the 5-minute TTL.

That is a 25% write premium paid on every ingest against a read that, on the normal path, never
comes. On the constitution it is about **2.4¢ an article** — small, and reliably wasted.

The paragraph above already called this opportunistic. The correction GPT Sol supplied is that
misses are not the unlucky case here, they are the *default* case, which is a different thing to
write in a doc and a different thing to decide about.

**So the breakpoint is conditional.** A stage marks the article only when **another step of the same
job** is in its cache group — `cacheArticleForStep` in [`src/pipeline.ts`](../../src/pipeline.ts),
set from `job.steps` in [`src/jobs.ts`](../../src/jobs.ts) and carried on `StepContext.cacheArticle`.
An ordinary ingest therefore marks nothing, a job that asks for glossary and quotes together marks **both**,
and a `{ steps: ["glossary"] }` job on its own marks nothing, which is correct: there is no second
call.

The default is **off**. A cache write costs 1.25× and an unread prefix never earns it back, so the
question a stage has to answer is not "could this be cached" but "is anyone coming".

> **"Another step", not "a later step" — and for eight days this doc described an optimisation that
> had never once worked.** The predicate asked only whether a *later* step of the job would read what
> this one writes. That marks the stage that **writes** the entry and never the one that **reads** it,
> because the reader is the last member of its group by construction. A request carrying no
> `cache_control` performs no lookup however warm the entry is, so every batched pair paid the 1.25×
> premium and collected nothing — the precise loss this whole section exists to prevent, reintroduced
> by the commit that documented it as fixed.
>
> Found by measuring money, in `evals/cost`, and by nothing else: the job succeeded, the artefacts
> were right, and `tests/article-cache-group.test.ts` asserted the broken behaviour as correct.
> **Fixed 2026-09-03** and verified on a paid run — `arc` writes 25,428 tokens, `tweets` reads 25,428
> back and its uncached input falls from 27,533 to 2,112, worth $0.0458 on that one pair (predicted
> $0.045770, measured $0.045756).
> [260903c](../postmortems/260903c-the-conditional-article-cache-breakpoint-marks-the-writer-but-never-the-reader.md)
> is the whole story, including why the `status === "done"` filter the postmortem originally
> recommended was dropped.

**Where the predicate has to guess, it guesses yes**, and the arithmetic is the reason. A marker sent
onto a cold prefix costs 0.25× of it; a marker withheld from a warm one costs 0.9×. Wrongly marking
is 3.6× cheaper than wrongly withholding — which is also why *fixing* the bug above was worth 3.6×
what deleting the optimisation would have saved (18.6% of a batched job against 5.2%).

That asymmetry is an argument for marking unconditionally, the way every stage did before
`24335207`, and **we are deliberately not taking it**, because the break-even is a rate nobody has
measured. **Two rates, and they are not the same number** — GPT Sol caught this paragraph quoting
one and proposing to measure the other:

| you measure | break-even | why |
|---|---:|---|
| the **per-call warm-hit rate** — of all marked calls, the fraction that find a live prefix | 0.25 / (0.25 + 0.9) ≈ **21.7%** | each call either writes at 1.25× or reads at 0.1×, against 1.0× for never marking |
| the **conversion rate** — of first presses, the fraction followed by a same-group second inside the TTL | 0.25 / 0.9 ≈ **27.8%** | the first press always pays the 0.25× premium; only the second collects the 0.9× saving |

Measure whichever you will actually observe, and say which. Settling it by argument is exactly how
this section got its last two entries.
The request path gets three entries rather than one because the three differ *before* the article:
search sends no tools, chat and explain send `openrouter:web_search`, and all three have their own
system prompt. Unifying those to chase one shared entry would mean degrading three prompts to suit an
optimisation, which is the wrong way round. It costs less than it sounds — the win was never the
first touch, it is that explain used to hit a cache *never* and chat re-paid the article on *every
turn*.

**Not cached, on purpose:** the structure step's **whole-document call** (one call per article —
a prefix used once costs 1.25× and earns nothing back) and summaries (each batch sends only the slice
its scope covers, so batches mostly share nothing; the `repair` retry was moved out of position zero
as the prerequisite, but the breakpoint is not in yet).

**The structure step's other calls are a different question, and they do mark a prefix.** The deepening
wave ([`src/structure-expand.ts`](../../src/structure-expand.ts) § `expansionRequest`) sends one
scoped call per fat section, all sharing `EXPAND_SYSTEM` plus the frozen wave-1 outline, and every
one of them carries a breakpoint on that shared part. Two things about it that are decisions rather
than defaults:

- **It reports whether the prefix could be cached at all.** `ExpansionRequest.estimatedCacheable` is
  `estimateTokens(system + outline) >= CACHE_FLOOR_TOKENS`. The estimate used to land at 1,150–1,400
  against a floor of 1,024, near enough to fall either side; `expand/4`'s QUESTIONS block took
  `EXPAND_SYSTEM` to 1,631 on its own and `expand/5`'s plain-words rule took it to 1,895 and `expand/6`'s shared core to 2,114, so the flag
  is now `true` whatever the outline. It is still reported rather than assumed — a zero in
  `cache_read_input_tokens` is
  what both "there was nothing to read" and "there was, and it did not" look like, and this flag is
  what separates them. § The floor.
- **There is no warm-up call**, where [`src/labels.ts`](../../src/labels.ts) has one. The prefix is
  about 2,700 tokens — 2,114 of prompt plus a frozen outline measured at about 590 on both books —
  against per-call evidence measured at 14,889 and 76,558, so running the first call alone would buy
  about 3% of a book wave's input tokens for a whole call's latency. It was about 1% before
  `expand/4`; the answer is still no, with less room. The reasoning is on `runExpansionWave`, so that
  whoever changes the packing sees it.

Nothing of this reaches a reader yet: the wave is behind `SPIDERYARN_DEEPEN_STRUCTURE`, which is off
([260904d](../plans/260904d-deepen-fat-sections.md) § stage 8).

## What production actually does

**Measured 2026-10-01, and it is the fact to start from: the ordinary one-call article stages have
never cached anything in production.** Zero reads and zero writes on every arc, tweets, glossary,
quotes, ideas, sketch, timeline, quiz and faq call in thirty days of `ai_calls` — the audit, with its
SQL, is [261001a-prompt-caching-production-audit](../investigations/261001a-prompt-caching-production-audit/README.md).

Not a bug. Those stages mark the article only when another step of **their own job** is in the group
(above), and the reading view posts one job per mode, so the predicate is false on essentially every
real call. The rule that stops us paying 1.25× for nothing has, in practice, switched their article
caching off — and on the numbers that is about right:

- **The money is small.** $72 of spend in those thirty days, and the best any marking rule could have
  saved was a few dollars of it.
- **The one recurring shape is the import burst** — the add page's tick box queues every main mode at
  once ([`queueAutoModes`](../../src/web/auto-modes.ts)), and mode jobs on one article run in
  parallel since 2026-09-29. Of the jobs it posts only **two pairs** can share an article —
  tweets with ideas, glossary with quotes — worth about **2.6¢ an import** on a 10,000-token article.
- **Capturing it needs cross-job coordination**, and that has no honest signal: the moment an entry
  becomes readable is the writer's `message_start`, which only the writer's process sees; a step
  persisted as `running` says nothing about it. Marking the pairs *without* waiting makes it worse
  (both write, neither reads). Posting each pair as one job would work with the code as it is, and
  holds Quotes behind Glossary and Ideas behind Tweets on every import.

So it is **deliberately not done**, by Greg's rule for caching — sparingly, and for good reason
(2026-10-01, via the Overseer). [261001l](../plans/261001l-prompt-caching-across-every-call.md) has
the design that was reviewed and dropped, and why. **Revisit** when the audit's SQL, re-run on
post-2026-09-30 data, shows the import pairs worth materially more than a dollar a month.

**Per article, and with every mode sharing one prefix** (Greg's follow-up, same day): a normal
article costs about a dollar, and a perfectly shared article cache would take at most about 15–16%
off it. What can be built without changing any mode's output is about 4%, because every cold call pays
the write. Thinking is about a quarter of the bill. The article's real size in a prompt is about 0.35 tokens per character, not the
quarter the audit assumed. Measured in
[261001b](../investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md); the
options, waiting on Greg, are in
[261001o](../plans/261001o-one-shared-article-first-prefix-cached-across-modes.md).

**Where caching does pay, it is inside one call site that fans out over one article** — and there
the coordination is in-process and exact. Simple's three levels are the worked example
([261001j](../plans/261001j-simple-press-cost-and-latency.md)): the slowest level goes first with the
article marked, the other two start once its stream has begun (`MeteredCall.onStart` in
[`src/messages-stream.ts`](../../src/messages-stream.ts)), and a press fell from $0.142 to $0.090.
**A new call site that fans out over one article should reuse that, not build a second one** — and
should measure it cold, the way `evals/simple/fanout-spike.ts --cold` does, or a cache left warm by
an earlier run fakes the saving.

**An open question, not chased:** Debate shows cache reads in production with no breakpoint of its
own (its three passes open differently, so they cannot be sharing one with each other). Something
upstream of us is caching part of its web-search loop; nobody has looked at what.

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

### And moving it out of the body is what broke chat

Worth reading beside the paragraph above, because it is the same line of code and the fix for one
bug was the cause of the other.

Chat used OpenRouter's **automatic** breakpoint until 2026-08-26 — `cache_control` at the top level
of the request body, which marks *the last cacheable block*. When the position moved out of the
article it landed in the final user message, which is exactly the block automatic mode marks. And
the final user message is not what gets stored: the route stores the bare question, so the next turn
replayed it **without** the position line, the marked block was never reproduced, and — writes happen
only at the breakpoint — there was no article-only entry underneath. Every turn after the first paid
a cold write of the whole article, whenever the reader had scrolled, which is always.

Chat now has an explicit breakpoint on the article, like the other two.
[260826h-chat-cache-automatic-breakpoint.md](../postmortems/260826h-chat-cache-automatic-breakpoint.md) has the
whole of it, including why all three defences on this page were blind to it.

**The rule it leaves behind: automatic mode needs the last user message to be reproduced
byte-identically on the next request, and nothing in this app guarantees that.** Prefer an explicit
breakpoint at the boundary you actually mean.

## Every cache now goes through OpenRouter

**Until 2026-08-27 there were two caches in a different sense than this page means.** The three
request-path calls cached at OpenRouter; the seven pipeline stages cached at Anthropic, because they
held their own `new Anthropic(…)` and talked to `api.anthropic.com`. Everything now goes through
OpenRouter — Greg's decision, and [ai-gateway.md](ai-gateway.md) is the whole of it.

Nothing above changed. `cache_control` is still placed by
[`src/article-prompt.ts`](../../src/article-prompt.ts), the breakpoints are still explicit, the
groupings are still `STAGE_EFFORT` and `ARTICLE_RENDERER`, and the floor is still 1,024 tokens. What
changed is where the entry lives and how you read it back.

**It was checked, not assumed.** A cold call through the Skin wrote 13,863 cache-creation tokens at
`cost` 0.0347235; the warm repeat of the same request read the same 13,863 at `cost` 0.0028386. Both
match [`src/pricing.ts`](../../src/pricing.ts)'s list prices to the digit — 1.25× write, 0.1× read —
which is the second thing that run proves: OpenRouter is not adding a per-token markup on top.

### The provider pin stopped being advice

`provider: { order: ["anthropic"] }` was already on the three request-path calls, described in
[§ What breaks a cache](#what-breaks-a-cache) as the sixth thing on a list. **On the pipeline stages
it is now the difference between a cache and no cache at all**, because there is a routing layer
where there used to be none.

A cache lives on the upstream that wrote it. Unpinned, live probes landed on *"Claude Platform on
AWS"* every single time rather than on Anthropic — so an unpinned stage would produce the right
article, raise nothing, and never read a cache again. The bill roughly triples and no line anywhere
says so. `MESSAGES_PROVIDER` in [`src/messages-stream.ts`](../../src/messages-stream.ts) is injected
by `streamMessage` rather than passed by each stage, for exactly that reason: a stage that forgets it
does not fail, it just quietly stops hitting the cache.

**And it carries a third field the request-path pin does not: `require_parameters: true`.** This is
the one that would have been walked into. `allow_fallbacks` defaults to **true** and
`require_parameters` defaults to **false**, so a fallback upstream that does not support
`cache_control` may be handed the request and serve it *without it* — successfully. That is not a
degraded answer. It is a full-price answer that looks exactly like a cheap one, which is every
failure on this page wearing a new hat. With the field set, an upstream that cannot honour the
parameter is not offered the request at all.

`order` rather than `only` on both wires, and that part is unchanged and still right: banning
fallback outright turns an Anthropic outage into a hard failure, and a cache miss costs money where
an unavailable model costs the reader the feature.

### The two usage shapes are a wire difference now, not a vendor one

This is the part most likely to catch somebody reading a log line. The same cache, reported two ways,
depending on which protocol the request went down:

| | reports | `prompt_tokens` / `input_tokens` |
|---|---|---|
| **Messages wire** — the pipeline stages | Anthropic's native `cache_read_input_tokens` and `cache_creation_input_tokens`, plus the `cache_creation.ephemeral_5m/1h` split | **additive** — the cached tokens are *not* in it |
| **chat wire** — search, explain, chat | OpenRouter's normalised `prompt_tokens_details.cached_tokens` | **inclusive** — `prompt_tokens` counts the whole prompt, cached or not |

So `inputTokens` on a `pipeline` line and `inputTokens` on a `model` line are not the same
measurement, and a repeat call that reads a 47,000-token article shows a small `input_tokens` on one
and a large `prompt_tokens` on the other. Both are correct. Neither is wrong about the cache.

**It used to be true that this difference tracked the vendor**, and it no longer does — which matters
because "we talk to Anthropic here and OpenRouter there" was the sentence a reader would have used to
predict which shape to expect, and that sentence is now false everywhere while the two shapes
survive. The thing to key on is [`TASK_WIRE`](../../src/models.ts).

### And the Skin returns the cost as well

The pipeline half of this page used to end at token counts, because Anthropic's response carries no
price. OpenRouter's Anthropic-compatible endpoint returns Anthropic's native `usage` **and** its own
`cost` in the same object — so a cached call now says both what it did and what it cost, with no
price table in between. That is what
[§ What a step cost, in money](logging.md#what-a-step-or-a-request-cost-in-money) puts on each step's log line,
and it is a second, independent way to notice a cache that has stopped working: the token counts and
the money have to move together.

One trap worth carrying over: **`finalMessage()` in the Anthropic SDK drops `cost`.** It is on the
wire, in the `message_delta` event, and the SDK's merge keeps only the fields its own types know
about. `meterStream` subscribes to the raw stream events instead. A stage reading
`message.usage.cost` would get `undefined` for ever and nothing would error.

## How to tell whether it is working

**You cannot tell by looking.** A cache that has silently stopped hitting returns the same correct
answer, raises no error, and costs more. It is
[silent-success.md](../reusable/silent-success.md) exactly.

Three defences, and none substitutes for another:

- **`tests/article-prompt.test.ts`** proves the prefix is *stable* — byte-identical across two
  questions, two selections, two reading positions, a growing conversation. Deterministic, no
  network, runs on every change. It cannot prove anything was cached.
- **`npm run eval:caching -- <slug> [--wire=chat|messages|both]`** proves it is *cached*, by calling
  and reading the number back. Costs money, run by hand, results committed under `evals/results/`.
  On the chat arm, the second call must read roughly the article's own size — not merely a non-zero
  system prefix. The Messages arm has the exact condition below. See [testing.md](testing.md) for why
  the two live in different folders.

  **It checks search and chat.** It used to say "search / chat / explain" and call `findPassages`
  only, and that gap is how the chat bug above survived for a day: the doc repeated the eval's claim
  rather than the eval. Explain shares the other two's article rendering and their explicit
  breakpoint, so it is covered by construction — which is a weaker thing than being called, and is
  written here as such.

  **It covers the Messages wire too, since 2026-10-01** — the gap this paragraph used to name. The
  `messages` arm calls real stage functions with the article marked: quotes at another effort first
  as a cold negative control, then `generateGlossary` and `generateQuotes` at their normal shared
  effort. Both intended-cold keys have to write and read zero; a prior warm entry makes the result
  inconclusive, not failed. The final call has to read **exactly** what glossary wrote, and every
  measurement must contain exactly one completed ledger row. A partial read or hidden retry fails.
  The first run used the older glossary → quotes → control order and measured 16,192 written, 16,192
  read back, control 0 —
  [the result](../../evals/results/prompt-caching-noema-mythology-of-conscious-ai-2026-10-01.md).
  The eval loads the reader-facing store view; a shelf title override can therefore make its metadata
  bytes differ from a pipeline draft's extracted metadata. It proves the two stages share the bytes
  they are handed, not that it replayed one particular production job byte for byte.
  **It checks the wire and the stages' byte layout, not the job wiring** that decides whether a real
  job marks the article at all: that is
  [`tests/article-cache-call-site.test.ts`](../../tests/article-cache-call-site.test.ts), which walks
  real jobs through Postgres and reads `ctx.cacheArticle`. Forcing the flag in an eval and calling
  that coverage of production is the shape [silent-success.md](../reusable/silent-success.md) warns
  about.
- **`aiCost` on the step's own log line**, which is new since 2026-08-27 and is the only one of the
  three that watches a *real* run rather than a run somebody set up. A cached read is roughly a
  tenth the price of a fresh one, so the same step costing ten times more than it did last week is
  the cache having stopped, in a number nobody had to compute. It cannot tell you *why*, and it says
  nothing on a step that was skipped. See
  [logging.md § What a step cost, in money](logging.md#what-a-step-or-a-request-cost-in-money).

**Run 2026-08-26 against the live API: all three articles pass.** (Against OpenRouter, which is what
those three calls already used — the pipeline's move to it came a day later and is
[covered above](#every-cache-now-goes-through-openrouter).) On the constitution, a cold call
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
| `cacheReadTokens`, `cacheWriteTokens` | the `model` lines in search, explain, converse — from `prompt_tokens_details.cached_tokens`, the chat wire's spelling |
| the same two | the `pipeline` line, from the seam in [`src/pipeline.ts`](../../src/pipeline.ts) — from `cache_read_input_tokens`, the Messages wire's |
| `tooShortToCache` | the request-path lines only |
| `aiCalls`, `aiCost` | the `jobs` line, from the seam in [`src/jobs.ts`](../../src/jobs.ts) — what the step actually paid |

**`cacheReadTokens: 0` on a repeat call is still the alarm**, and since 2026-08-27 it has a
companion rather than being alone: a step whose `aiCost` jumps by roughly ten times is the same fault
said in money. Watch the pair — a cache that broke moves both, and only one of them moving is
usually a bug in the *reporting*. Counts only — no prose, nothing sensitive, per
[logging.md](logging.md).

## The floor, and why zero is ambiguous

Sonnet 5 will not cache a prefix under **1,024 tokens**. Under it, the breakpoint is accepted and
does nothing: no error, and zeros in both usage fields — which is indistinguishable from a cache that
has broken. `underCacheFloor` exists to tell those two apart, and callers log it rather than throwing,
because a short article is a perfectly good article that simply cannot be cached.

The floor is a property of the model, not of us: Opus 5 and Opus 5.5 need 512 (5.5 measured live on
2026-09-30, `HIGH_POWER_CACHE_FLOOR_TOKENS` in [`src/article-prompt.ts`](../../src/article-prompt.ts)),
Anthropic's page also gives 512 for Sonnet 5.5, Haiku 4.5 needs 4,096, and the progression is not
monotonic ([261001a](../research/261001a-prompt-caching-best-practice-2026.md)). **Anything that edits [`src/models.ts`](../../src/models.ts) should
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
   its queue at concurrency 1 and widens after the first batch returns — but **only when its prefix
   clears the floor**, because the first version serialised unconditionally and so paid a whole
   batch of latency, every run, for a discount that did not exist at these lengths. See
   [`src/labels.ts`](../../src/labels.ts). The exact signal, where one process owns the fan-out, is
   `MeteredCall.onStart` — [§ What production actually does](#what-production-actually-does).
5. **Editing one stage's article rendering.** There is one renderer for a reason; changing it changes
   what several stages send.
6. **Provider routing.** A cache lives on the upstream that wrote it. Every call sends a `provider`
   preference — `{ order: ["anthropic"] }` on the request path
   ([`PROVIDER_ORDER`](../../src/openrouter-stream.ts)), the same plus `require_parameters: true` on
   the pipeline ([`MESSAGES_PROVIDER`](../../src/messages-stream.ts)) — an ordering, deliberately
   **not** `allow_fallbacks: false`. Banning fallback would turn an Anthropic outage into a hard
   failure on a call a reader is waiting for, and a cache miss costs money where an unavailable
   feature costs the reader the feature. **This moved from sixth on a list to a precondition when
   the pipeline moved onto OpenRouter** — see
   [§ The provider pin stopped being advice](#the-provider-pin-stopped-being-advice), which is also
   where `require_parameters` is explained and why it is not optional.

Changing `temperature` or `max_tokens` does **not** break anything — they are not part of the
rendered prompt.

## The prices this rests on

Sonnet 5, per MTok, as of 2026-08-26: input `$2.00`, cache write (5 min) `$2.50`, cache read `$0.20`.
Those were Anthropic's list prices, and the 2026-08-27 migration re-checked both of them through
OpenRouter — write and read each billed at list to the digit, so the arithmetic on this page did not
have to move when the route did. Break-even is the **second** use of a prefix, which is why
single-use prefixes are left unmarked.
The 1-hour TTL is deliberately not used — it doubles the write and needs three uses, and a reading
session's calls land within minutes of each other. A cache hit refreshes the TTL for free.

**Three uses against *not marking*, which is the comparison that matters.** One write and *n* reads
cost 2.0 + 0.1n of the prefix's uncached price at 1h, against 1 + n unmarked, so 1h needs two
later reads inside the hour; the 5-minute write needs one. A source that says 1h "pays for a single
reuse" is comparing it with a 5-minute marker, not with leaving the article unmarked. Re-checked
2026-10-01 against the 30-day audit: no group has enough two-read hours to be worth it
([261001l](../plans/261001l-prompt-caching-across-every-call.md) § Not doing).

## See also

- [prompt-caching.md (the plan)](../plans/260826g-prompt-caching.md) — the steps, and the honest assessment
- [original-version/prompt-caching.md](original-version/prompt-caching.md) — the same design, written
  for the previous version of this app and never built. It named the prerequisite that killed it —
  five prompts each wrapping the article differently — and warned this repo would reproduce it. It
  did. This is that debt paid.
- [ai-gateway.md](ai-gateway.md) — one vendor, two wires: why every cache on this page is now
  OpenRouter's, and the four things about that which fail without saying so
- [silent-success.md](../reusable/silent-success.md) — the shape of every failure on this page
- [logging.md](logging.md) · [testing.md](testing.md) · [setup-dev.md](setup-dev.md)
