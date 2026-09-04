# The hierarchy structure pass, in waves

**Status: paused after stage 1b, with the prerequisites landed and the ceiling still there.**
Started 2026-09-04. The `hierarchy-waves` worktree was removed on 2026-09-04; everything below is on
`dev`, and a successor needs a fresh one.

**Landed:** stages 0, 0b, 0c (three production fixes on the incumbent path, each independently
worth having) and 1a, 1b (the eval's wall-clock measurement, and the cascade's deterministic core in
`src/hierarchy-cascade.ts` — pure, 38 tests, reviewed twice, and **called by nothing**).

**Not built:** the rest of stage 1 (the shared request seam and the paid experiment), stage 2 (the
production cascade core) and stage 3 (integration). **So the headline problem is untouched**: an
article past 1,976 blocks still throws `TooLongForOnePass`, the wait is still 163–320s, and the tree
is still exactly three internal levels. What did change is that three articles that used to lose
their hierarchy outright now build one, and stage 4 got 17–45% cheaper and ~25% faster.

**Fixtures.** `2701-h` (2,569 blocks) and `1228-h` (1,326) are stage 3's acceptance test. Their
`blocks.json` was not kept — it is deterministic and free to rebuild — but the extracted HTML is, at
`output/2701-h.html` and `output/1228-h.html` in the primary checkout. Both are gitignored, so that
is the only copy; the rebuild commands are in [the fixture section](#the-fixture-that-proves-the-ceiling-built-before-the-fix).

Stage 4's structure call is one whole-document model call. It is **163–320 seconds and about 88% of
the ingest wait**, it **refuses any article past 1,976 blocks** outright, and it pins **exactly three
internal levels** whatever the article's length. This plan replaces it with a breadth-first cascade
of smaller calls, so that the wait shrinks, the ceiling goes away, and depth becomes a property of
the article rather than a constant in a prompt.

Greg, 2026-09-04:

> I want to make the Hierarchy generation more efficient and not timeout for huge articles. My best
> suggestion is that we do it in multiple passes, e.g. one pass for L1 (and perhaps L2), another
> pass for L3, another pass for L4 (for long articles), etc. And/or we could break up the lower
> levels and parallelise, e.g. one agent does all the sections for one part, another does all the
> sections for another part, etc. And we should do this in a way to optimise for prompt caching.

And, 2026-08-30, the half of the argument that is not about latency:

> We want to be able to support more than 3 levels, because for a book-length text we'll probably
> need the extra hierarchy.

## The measurement that decided it, taken before anything was designed

Both advisors named the same worst case: a small question might still pay the **~6,300 reasoning
token floor per call** that [260830a § "The cost model was wrong by 3x"](../research/260830a-opening-an-article-before-the-toc.md)
measured, in which case more calls would be slower *and* dearer, and the whole plan collapses. That
floor was measured when the stage ran at `effort: "high"`; it has run at `medium` since 2026-08-30
and nobody re-measured it.

A `waves` arm already existed in `evals/hierarchy-structure/arms.ts` and had **never been run**.
Running it against `incumbent` is the experiment, and it cost $1.19:

| run 1 | calls | wall clock | cost | reasoning tokens |
|---|---|---|---|---|
| `incumbent` (production) | 1 | **135s** | $0.1484 | 11,184 |
| `waves` | 4 (1 + 3 parallel) | **~74s** | $0.1670 | 3,423 · 1,131 · 1,358 · 1,716 |

**The floor is not a floor at `medium`.** Wave 1 asked a smaller question *at the same `max_tokens`
as the incumbent* — `runWaves` passes `structureRequest(body).maxTokens` straight through — and spent
**3,423** reasoning tokens against the incumbent's 11,184. So it is the question that shortens the
thinking, not the room, which is the opposite of what the `high`-effort postmortem found and is why
this is worth building.

**And the cost went up, not down.** Every later call re-sends its slice, so input rose from 11,114
tokens to 21,438. That is the number prompt caching and the outline-plus-slice request shape below
are for. Latency is the prize; cost is the thing to hold roughly level.

**"Waves think less in total" is withdrawn.** The short-fixture run showed waves using less total
reasoning than the incumbent, and the first draft of this plan said so. On the real corpus it is the
other way round — **20,969 against 14,177** on the 360-block `constitution`, 15,810 against 13,378 on
`gwern-scaling-long`. More calls over more prose think more in total even when no single call thinks
much. The narrower true statement is that **a scoped call thinks in proportion to what it is asked**:
on `constitution` four of the eight calls spent under 500 reasoning tokens, three of them zero, while
the four deep ones spent 3,004–6,871 each and took 37–83 seconds. That is the whole argument for
packing, and it means the saving must come from asking fewer, better-scoped questions rather than
from the cascade shape by itself.

**The latency win is not established, and the first version of this section said it was.** Two
things went wrong and GPT Sol found both by reading `run.json` rather than the write-up:

- **The run measured an 84-block `constitution`, not the 360-block one.** The worktree seeds `data/`
  from `tests/fixtures/data-root/`, and the copy meant to replace it with the real corpus used
  `cp -rn`, which skips files that already exist. Every cell recorded `matchesManifest: false` and
  nobody read it. So the run describes two *short* documents, which is not the case this plan is for.
- **The pooled means hid the pairs.** In two of the four pairs there is essentially no latency win
  (74.9s vs 83.3s; 85.6s vs 83.3s), and the cost premium runs 9%, 13%, 36%, 65%. The incumbent's own
  two draws of one document differ by 51 seconds — more than the gap being claimed.

What survives is the reasoning-token finding, which is a within-run comparison on identical input and
does not depend on length: across all 17 wave calls none exceeded 3,423 reasoning tokens, while the
four incumbent calls used 6,311–11,184.

The corrected run over the real corpus is
[hierarchy-waves-real-corpus-2026-09-04.md](../../evals/results/hierarchy-waves-real-corpus-2026-09-04.md);
the first run and its warning are
[hierarchy-waves-2026-09-04.md](../../evals/results/hierarchy-waves-2026-09-04.md).

**So the case for building this rests on the absent reasoning floor, the removed ceiling and variable
depth.** The latency win is the *hypothesis under test*, and the gate on it is per-document direction
across ≥4 interleaved repeats with the packed executor — not a pooled mean.

## What was already known, and what it changes

This is the fourth pass over this stage, and most of the expensive questions have already been
bought. The plan starts from those numbers rather than re-deriving them.

- **The structure call is the wait.** `STEP_BUDGET_MS.hierarchy = 320_400` — the largest chunk of the
  630.4s job budget and the one with the least headroom (`src/jobs.ts`).
- **The ceiling is arithmetic, not luck.** `budgetFor` throws `TooLongForOnePass` before the call
  when the estimated answer plus `THINKING_HEADROOM` exceeds `MODEL_MAX_TOKENS`
  (`src/token-budget.ts`). Today that is 1,976 blocks.
- **Three fixed levels is already a recorded defect** —
  [260826h § J](260826h-toc-scaling.md): on a 360-block article the chapter fan-out is 5,7,3,11,5,9,4
  against a prompt asking for 5–9, and one section swallows thirty paragraphs.
- **The model is stable exactly where we do not need it.** On a well-headed article the free
  deterministic carving in `src/heading-tree.ts` reproduces the paid call's depth-1 carving exactly;
  on a headingless one the *same* recipe on byte-identical input gave 8, 7, 8 and 3 parts across
  four runs ([260830a § 7b](../research/260830a-opening-an-article-before-the-toc.md)).
- **Blind judging has twice ranked `effort: "low"` above production's `medium`** — eight of eight
  judgements across two evals and two judge families, at 76s vs 149s and $0.13 vs $0.22 on a
  184-block article, with the *same* 6/7 success rate
  ([hierarchy-effort](../../evals/results/hierarchy-effort-2026-09-03.md),
  [hierarchy-cheap-models](../../evals/results/hierarchy-cheap-models-2026-09-03.md)). The named
  fault in `medium` is that it **welds the author's own sections together** — valid, silent and
  shipped, against `low`'s failure mode of throwing loudly with a Retry button.
- **Tiling faults can no longer throw.** `planChildRanges` derives a tiling from the model's child
  *start* points rather than checking one, so the two families that made 4 of 13 structure calls
  throw in the 2026-08-30 calibration are gone. What still throws: an invented block id, a backwards
  range, a root that misses the article's ends.

Three prior recommendations from those evals are still unimplemented, and this plan absorbs all
three: flip the effort to `low` **if this plan's own repeats agree**; retry when `buildTree` throws;
chase the 3-block tail that failed `openai-huggingface` identically on three different models.

## The fixture that proves the ceiling, built before the fix

Nothing in the corpus was long enough to trip `TooLongForOnePass` — the biggest was 669 blocks
against a 1,976-block bound — so a claim that the cascade removes the ceiling could not have been
tested. Two Gutenberg texts now sit in `data/` (gitignored; `fetch`, `extract` and `blocks` make no
model calls, so they cost nothing to rebuild):

| slug | text | blocks | words | headings | `estimateHierarchyTokens` | today |
|---|---|---|---|---|---|---|
| `2701-h` | *Moby-Dick* | **2,569** | 209,219 | 142 | 114,075 | **throws `TooLongForOnePass`** |
| `1228-h` | *On the Origin of Species* | 1,326 | 155,478 | 24 | 59,650 | fits, at 99,650 of 128,000 |

`2701-h` is the acceptance test for stage 3 and `1228-h` is the contrast case that must not regress.

**They are gitignored, so write down how to get them back** — this file lost them once already, to a
`rm -rf data` that restored the fixture invariant `worktree:check` enforces and took these with it.
Both stages are deterministic and free:

```
npm run fetch   -- "https://www.gutenberg.org/files/2701/2701-h/2701-h.htm"
npm run extract -- "https://www.gutenberg.org/files/2701/2701-h/2701-h.htm" output/2701-h.html
mkdir -p data/2701-h && npm run blocks -- output/2701-h.html data/2701-h/blocks.json
```

…and `1228/1228-h` for *Origin of Species*. If `output/<slug>.html` still exists, the third line
alone rebuilds the fixture byte-identically without touching the network.

**And Moby-Dick makes a design point the shorter corpus could not.** Its free heading tree finds
**137 depth-1 parts** — a chapter list, not a carving. A cascade whose wave 1 merely accepts the
author's boundaries would hand the reader a 137-item top level, which is the fan-out target off by a
factor of twenty. So at book length **wave 1's job is grouping, not splitting**, and the recipe has
to be able to say so. This is also the case where the whole article stops fitting one context window,
which is what `StructureContext.overview` exists to make replaceable.

## What the client already supports, and what it does not

Checked rather than assumed, because it decides whether variable depth is a plan or a project:

- `src/web/tree.ts` computes `maxDepth` from the tree's own nodes and builds `columnDepths` from it;
  `columnLabel` already falls through to `Level ${depth}` past "Sections"; `layout.ts` takes
  `gistDepths` as a list and drops coarse columns first when the window is narrow.
- `src/labels.ts` § `planBatches` reads section-hood off the tree's *shape* — the internal nodes
  whose children are all leaves — rather than off a depth constant, so the label pass follows a
  variable-depth tree without changing.
- **Two fixed vocabularies do need generalising**: `SummaryPanel.tsx` § `DEPTH_LABELS` is a
  three-element array, and the spine assumes L1 bands with L2 ticks.

## The shape

> one global L1 call → breadth-first, deterministically packed parent-expansion batches →
> normalise each answer immediately → assemble once → labels

**Breadth-first, level-synchronised, not free-running subtrees.** Both advisors landed here
independently. A whole-level barrier buys a frozen, complete outline for every later call,
deterministic batches and therefore deterministic checkpoint fingerprints, the chance to pack several
parents into one call, and no race-dependent prompt where one subtree saw cousins another did not.
Free-running subtrees save the tail of the critical path and cost more calls, which is the expensive
direction. It is a later scheduler optimisation, measured against the barriers, not a v1.

**The unit of work is one parent's complete child set, and units are packed.** This is the rule
`src/labels.ts` § `planBatches` already lives by — *generate siblings together; generate disjoint
sibling groups in parallel* — packed by predicted child nodes rather than raw blocks:

```
predictedChildren(parent) = clamp(2, 9, ceil(parentBlockCount / 9))
```

Whole parents in document order, up to **36 predicted children, 4 parents, or an input-token cap**,
whichever comes first — the token cap because four parents of nine predicted children each can still
carry far more prose than one request should. An oversized parent gets a call to itself and is never
split across calls. On a 360-block article that is 1 call for wave 1, 1–2 for the chapters, and a
third wave only for the sections still over the terminal size — far below the ~39 the research doc
feared, and fewer than the four and five calls the unpacked eval arm made.

**None of these numbers is evidence-backed yet**, because the arm that has run makes one call per
parent and therefore validates none of them. They are a starting heuristic; the cascade records
**predicted against actual children** per call so they can be tuned from a run rather than re-guessed.
`maxInputTokensPerBatch` is the weakest of them — 24,000, chosen as roughly twice the incumbent's
measured 11,114 input tokens on the real corpus, which is an order-of-magnitude argument and not a
measurement.

**And only the token cap can be breached by a single parent**, which is worth knowing before anyone
tunes it: `predictedChildren` clamps at 9, well under the 36 cap, and one parent is never more than
the 4-parent cap. So "an oversized parent gets a call to itself" means precisely "a parent whose
slice is too long to send", and raising `maxInputTokensPerBatch` removes the only escape hatch a
single parent has.

**Packing is not an optimisation, it is what makes the cascade affordable.** On the real corpus the
unpacked arm made 7 and 8 calls and spent $0.39 and $0.52, against the incumbent's single call at
$0.23 and $0.29 — a 1.7×–1.8× premium, far worse than the 9–65% the short-fixture run suggested. A
cascade that costs twice as much is not one we would ship whatever it does for latency.

**The stopping rule is exact, and it is not a block count alone.** Expand a node iff **either** it
holds more than 9 blocks that `isStructural` says yes to, **or** it still contains an unresolved
authored heading — a heading that is not already the start of one of its children. Three corrections
are folded into that one sentence:

- The draft said "split above ~12, stop at ≤~9" and left 10–12 undefined. A rule that becomes a
  checkpoint fingerprint cannot have an undefined band.
- **Counting raw blocks counts the wrong things.** An empty paragraph, a withheld apparatus block and
  a `No posts` footer are all blocks and none of them is navigation. `isStructural`
  (`src/block-policy.ts`) is the predicate the label pass already uses for exactly this.
- **A size rule alone can break the hard-heading rule.** A node of eight blocks containing two of the
  author's own headings would stop, and its leaves would then span a heading — which the prompt calls
  a hard boundary everywhere else. The heading clause is what stops the terminal level quietly
  merging across one.

**"Unresolved" needed a definition, and the obvious one never terminates.** Read literally — a
heading that is not already the start of one of the node's children — a node with no children yet
has *every* heading in its range unresolved, **including the one it starts on**. Since a node created
from a heading begins on one, every such node would expand for ever, bounded only by the depth cap.
So *resolved* includes the node's own start. That is the difference between a working governor and an
infinite cascade, and the first draft of this plan did not have it.

**Structural blocks, not raw ones, in the prediction too.** The plan's formula said
`ceil(parentBlockCount / 9)` while its stopping rule counted structural blocks, and the two must
agree: a node padded with images and withheld apparatus would otherwise be called *terminal* by the
governor and predicted four children by the packer, which is a prediction the governor contradicts.
The formula is `clamp(2, 9, ceil(structuralBlocks / terminalBlocks))`.

Depth then falls out of the article: a short post gets one internal level, a paper three, a book
five. That is [Fable's bottom-anchoring argument](#reviews) — the reader reads the zoom slider as
*stride*, not as a depth number, so the rightmost gist column always means "one sentence per ~7
paragraphs" and extra altitude appears on the left, where a reader expects a long piece to have more
of it.

**A single-child expansion does not terminate either, and the cap is not the answer.** If an answer
proposes exactly one child, that child inherits its parent's whole range and the governor says the
same thing one level down. `maxDepth` bounds it, but absorbing it there is silent — it burns four
calls and reports `capReached` for a reason that is not about the article. **It is a retry trigger**,
owned by stage 2 along with the rest of the retry semantics, not something the governor should paper
over.

**The depth cap is 5, and what happens when it is reached is part of the contract.** It is not "UI
sanity" — a node that is still over the terminal size at depth 5 is a node whose label sibling set
will be oversized, which is the defect this plan exists to fix, reappearing at the bottom. So the
cascade **records `capReached` with the nodes that hit it and their spans**, and stage 1's eval
reports it. Treating such a node as silently terminal is the option that is not available: it
contradicts the all-or-nothing completeness the cascade otherwise guarantees, and it is invisible in
every mechanical measure. Whether the answer is to fail loudly or to raise the cap is a decision for
the first run that produces one — Moby-Dick at 2,569 blocks is the article that will.

**What a deep call sees: its own range, one block either side, and the frozen global outline.** Not
the whole article. The whole article is financially attractive inside today's context window and it
does not survive a book, it makes every local decision attend over irrelevant prose, and — measured
below — the caching arithmetic turns against it once there are more than a handful of calls.

**The cascade takes two inputs, and that is the book-scale seam:**

```ts
interface StructureContext {
  overview: string;                    // the whole rendered article today; ordered section cards later
  evidenceFor(range: BlockRange): Block[];
}
```

Nothing in the wave engine may assume its shared prefix *is* the rendered article. With that one
distinction, the eventual book path — bounded raw chunks → parallel section cards → one global L1
pass over the ordered cards → local expansion against the card outline — replaces `overview` and
reuses the batching, the retries, the normalisation and the assembly unchanged.

### Prompt caching: do it where it is free, and say how little it buys

Greg asked for this explicitly, so the honest answer belongs in the plan rather than in a comment.

The shared prefix is **the common rules plus the frozen outline**, not the article, and it has to be
physically first because a cache prefix starts at the top of the request:

```ts
system: [
  { type: "text", text: commonRules },
  { type: "text", text: frozenOutline, cache_control: { type: "ephemeral" } },
],
messages: [{ role: "user", content: theTargetsAndTheirSlices }],
```

*(The first draft of this block had the article above the breakpoint and the rules below it — which
caches the article and does not cache the rules, the exact opposite of the sentence above it. Sol
caught it. Worth leaving recorded: a cache breakpoint is a position, and prose describing one is not
evidence about where it is.)*

**The cost argument for slices was overstated and is withdrawn.** The plan claimed whole-article
caching "loses its advantage once `m` is large", and that is not derivable from `m`. With `P` the
article and `S` the total volume of later slices, it is `1.25P + 0.1P(m−1)` against `P + S`, and
which wins depends on `S` — on how much of the article is still being expanded — not on the call
count. **The reasons slices are right are feasibility and attention**: a book does not fit one
context window at any price, and a local split attending over the whole work is worse at its job.
Those are sufficient. The arithmetic is not.

**The outline is not stable across waves, and that is the thing to decide before the prefix is
frozen.** Wave 1 cannot warm a prefix containing an outline it has not yet produced, and if the
prefix carries *the outline so far* then every barrier invalidates it and each wave is a fresh cold
cohort needing its own warm-up decision. Two candidates, and stage 1 must pick one and measure it:
the **immutable depth-1 outline**, which is stable from wave 2 onward and cacheable across every
later wave; or the **current frontier's outline**, which is more informative and cacheable only
within its own wave. Default to the first, because a prefix that changes every barrier is a prefix
that never pays for itself.

**No warm-up call is needed for the first cohort's first wave**, because the wave before it is the
warm-up: wave 3 cannot begin until wave 2 has finished. The cold fan-out cases are the *first* wave
of a cohort, a resumed run, a TTL expiry and an effort transition; there, serialise the first *real*
missing batch (never a dummy request) when the prefix is estimated above 1,024 tokens and at least
two calls remain in that cohort, then widen to concurrency 4 — the pattern `src/labels.ts` already
implements and instruments.

A paid write can go unread here, and the run must be able to say so: wave 1 produces no expandable
child; every later batch resumes from a checkpoint; the five-minute TTL expires; a wave changes
effort or model; routing moves upstream; the prefix is under the 1,024-token floor; or the
breakpoint is on the writer and missing from the readers. `estimatedCacheable` plus
`cacheReadTokens`, as labels reports them, is what separates "there was nothing to read" from "there
was, and it did not".

### Assembling a tree from many answers, without a hole in the middle

**The existing eval arm has a semantic hole, and copying it would ship the hole.** `runWaves` slices
each later call from the *raw* wave-1 ranges and only calls `buildTree` at the very end — but
`planChildRanges` can move those ranges when it derives the tiling. A subtree can therefore be
generated from one slice of prose and finally attached to a different range. `assertTreeSound` will
confirm the repaired tree tiles; **nothing can detect that a title and a gist were written about the
wrong paragraphs.** That is [silent-success.md](../reusable/silent-success.md) exactly, and it means
the quality numbers from the arm above are not to be trusted even though its latency and cost numbers
are.

**And it does not parse answers the way production does.** `runWaves` reads every response with
`parseJsonFrom(stripFence(raw))`; the pipeline reads them with `parseJsonAnswer`, which finds the
document inside a preamble or a sign-off and only refuses when a second `{` follows it
([260903k](260903k-model-json-answer-extraction-in-the-shared-parse-seam.md)). The first cell of the
corrected run died on exactly that difference — *"a complete JSON document ends at position 1,922 and
51 more characters follow it"* — after seven calls and $0.41. A recipe that parses more strictly than
production throws where production would not, and its measured throw rate is then a property of the
harness. Routing the eval through the shared executor fixes this by construction, which is most of
what stage 1 is for.

So: **normalise every answer immediately, before its ranges can become input to another call.** The
cascade holds explicit state — every node `pending | terminal | expanded` — and converts to a plain
nested `ModelNode` for `buildTree` only when no node is `pending`. `assertCascadeComplete` is the
guard, and it is a different question from `assertTreeSound`, which checks representation rather than
whether the granularity we asked for was ever produced.

Five further incompatibilities to design around, all found by review rather than by running it:

- `ModelNode.range` requires a start *and* an end; the wave answer format gives starts only.
- `planChildRanges` falls back to a previous child's claimed *end* when two starts collide — so a
  wave answer with no ends needs that fallback replaced rather than silently unavailable.
- A missing `children` today means "terminal, grow leaves"; in a cascade it must mean "awaiting
  expansion" until the cascade says otherwise.
- `buildTree` mints `n0001…` depth-first, so **node ids cannot be checkpoint keys** — a fingerprint
  over the prompt's own bytes plus the grouping is, as in labels.
- A final `buildTree` over already-normalised answers would count the same repairs twice.

**The response format is ordinals, like labels**, because a model asked to key a map by ids it must
copy will eventually copy one wrong:

```json
{"targets": [{"target": 1, "parentGist": "…",
              "children": [{"start": "spya-…", "title": "…",
                            "gist": "…", "sourceHeading": "…"}]}]}
```

The exact target ordinal set is required — no duplicates, no extras — and child ends are derived
immediately from strictly increasing starts. `sourceHeading` is optional and must be *in* the
schema: it is how a node records that the author wrote its title, it is what the `§` badge in the
reading view is drawn from, and a response format that omits it would silently strip the provenance
from every node the cascade creates.

**Starts-only removes the duplicate-start fallback rather than replacing it, and that is the
decision.** An earlier draft of this section said the fallback "needs replacing rather than being
silently unavailable" — but its only input *was* the previous child's claimed end, so there is
nothing left to fall back to. Two children claiming one start is therefore **drop and count**, which
is exactly what `planChildRanges` already does when a backwards end makes its own fallback ineligible
([above](#backwards-child)). The alternative — hand the colliding child the next block — writes a
boundary nobody proposed, which the derivation explicitly refuses to do. Nothing of the article is
lost either way; what is lost is that section's *name*.

> [!WARNING]
> **The cascade's repair figures are not comparable with the incumbent's, and nothing about them says
> so.** `PartitionRepair` has four kinds, and `"short"` and `"over"` are both statements about a
> child's claimed *end*. With ends out of the schema an answer **cannot disagree with itself**: two
> of the four kinds become unreachable, interior repairs reduce to clamping distance, and the closing
> boundary can never fault. So a cascade arm will show fewer repairs than a one-call arm **as a
> property of its response format**, not as a better run — and `repairedBlocks` is the figure
> `hierarchy.md` tells you to read first. Anyone scoring the two against each other has to know this,
> and the eval must label it rather than leaving it to be noticed.

**An expansion answer may not redefine its target's own range.** The ordinal already identifies a
parent whose range the code owns; a wave that answered about a different stretch than it was given is
the mistake, not a boundary to reconcile.

### And the shape is constrained by a schema, not by asking nicely <a id="structured-outputs"></a>

Greg, 2026-09-04:

> BTW I thought there was a way to give GPT Luna etc a JSON schema for it to match its output
> against? Would that help with parsing errors and reliability etc?

**Yes, and it is measured rather than assumed.** A probe on 2026-09-04 sent
`output_config: { effort, format: { type: "json_schema", schema, name } }` through `streamMessage` —
the pinned Messages wire, through OpenRouter — with a user message explicitly asking the model to
explain its reasoning first and sign off afterwards. The answer was **bare JSON, no preamble, no
sign-off**, for $0.0013. That is the field being honoured end to end, not merely accepted, which is
the distinction `src/messages-stream.ts` § `MESSAGES_PROVIDER` exists to insist on.

**This was deferred one day earlier, and its own condition has now fired.**
[260903k](260903k-model-json-answer-extraction-in-the-shared-parse-seam.md) rejected it — *"Not
strict structured output via a tool schema. It is the permanent cure and it rewrites the
prompt-and-parse seam of eleven paid stages… Its own job, later, **if this recurs**."* It recurred
twice today. And the objection has weakened on its own terms: that plan was weighing the *tool
schema* route, and `output_config.format` is not a tool. The prompt is unchanged and the format
spec is additive, so it is adoptable **one stage at a time** rather than as a rewrite of eleven.

So the cascade's answers are schema-constrained from stage 1, where the response contract is being
written from scratch anyway. Two things it buys:

- **The wrapper class of failure stops existing.** One of the two `waves` throws on the real corpus
  was *"a complete JSON document ends at position 1,922, and 51 more characters follow it"* — after
  seven calls and $0.41. `src/parse-json.ts` recovers a document from a preamble or a sign-off; with
  a schema there is nothing to recover from.
- **It composes with starts-only ordinals.** Under a schema whose child object has `start` and no
  `end`, a **backwards range is not expressible** — which is the other failure the real corpus
  produced (`smart-low`'s *"range that runs backwards"*, the one genuine model fault in the run).
  The two changes together remove both observed classes, and neither is a retry.

**What a schema does not do, said plainly.** It constrains shape, not meaning. A `start` pointing at
the wrong block is schema-valid; so is a title about the wrong prose. `planChildRanges`, the derived
tiling, `assertTreeSound` and the invariants all keep their jobs, and the normalise-immediately rule
above is untouched. A schema is not a reason to trust an answer more — only a reason to stop paying
for one class of accident.

**Two things to check before this is load-bearing**, neither of which the probe settles: whether
`output_config.format` participates in the cache key the way `effort` measurably does — it is
constant per wave, so it should not churn a prefix, but "should" is what the effort finding punished
last time; and whether a schema-constrained call's refusal and truncation behaviour differs, since
`wasRefused` and the `max_tokens` path both read `stop_reason`. Deterministic tests for both, and the
cache pair measured on a real two-call probe.

### The gist rule this breaks, declared rather than discovered

[granularity-zoom.md § Generation](../project/granularity-zoom.md) says a parent's gist is written
*from its children's gists*, so that level N is genuinely a compression of level N+1. In a top-down
cascade a node's gist is written when its parent is split, before its children exist.

**Declared delta for v1:** a node's `title` is fixed when it is created, and its **expansion call may
replace its `gist`** using the children it has just produced. That recovers most of the rule at no
extra call.

**It does not recover it transitively, and that must not be discovered later.** Rewriting a node's
gist from its new children leaves its *grandparent*'s gist standing on that node's *old* gist, so a
four-level tree still does not satisfy the rule from the bottom up. Blind judging **at several
depths** is the gate; a separate bottom-up pass is built only if the upper gists are shown to drift.

## Product decisions, settled before building

Taken from Fable's review, with the reasoning kept:

- **Variable depth: yes, bottom-anchored.** Governed by the terminal span (≤9 blocks), not by a
  target depth. Depth ≈ log₇(blocks/7), capped at 5.
- **Publication stays all-or-nothing in v1.** A tree that stopped one wave early passes
  `validate-tree`, has a gist on every internal node, covers every block, and is byte-identical *in
  kind* to a tree whose governor legitimately stopped there. Publishing it as final is silent
  success. Per-wave checkpoints already make a failed deep wave cheap to retry, which captures most
  of the value with no new reader-facing state. Publish-shallow needs a declared tree-level marker,
  a job-card sentence and downstream gates, and it is a later piece of work.
- **No progressive opening in v1.** Attractive later, and safer here than it has ever been — a later
  wave never *moves* a boundary, it only subdivides, so depth-1 ranges are final from ~40s on. But
  labels batch on leaf sibling groups that change as sections subdivide, `structureHash` moves with
  every wave while glossary and summary hash only the blocks, and research §5's three prerequisites
  (image privacy, stage 3 not publishing opened blocks, no replacement path in an open reader) are a
  separate project. Waiting for a complete tree at ~74s already beats 135–320s.
- **Effort is two decisions, not one**, and conflating them was a mistake in the first draft of this
  plan. **(a) The incumbent one-call path** should go to `low` now: equal pooled success, roughly
  half the latency and 45% of the cost, and eight of eight blind comparisons preferring it, across
  two evals and two judge families. Both the eval that produced that evidence and GPT Sol's review
  recommend it outright, and it is one line in `src/hierarchy.ts` § `EFFORT`. Holding it back until
  the cascade ships bundles an independently-supported improvement into a later project for nothing.
  **(b) The wave recipe's effort** is measured separately, because effort may interact with the
  smaller task shape, and because every wave must share one value or the cohort loses its prefix.
- **Heading seeding is measured, not assumed — and its first measurement is encouraging.** Fable
  argues the free carving should *be* the L1 geometry wherever the headings are usable, which would
  delete wave 1's hardest question. Sol warns that "a list of heading blocks" and "a whole
  deterministic proposal" are two different interventions whose evidence must not be pooled — and
  `headings-listed` and `headings-seeded` exist as separate arms.

  `headings-seeded` ran for the first time on 2026-09-04, two draws on two documents: **$0.196 and
  128s on `gwern-scaling-long` against the incumbent's $0.244 and 168s**, and **seven depth-1 parts
  on all four draws** where the incumbent gave six and then seven. Cheaper, faster and *more stable*
  than production. It is not a finding at n=2 — its first draw was the slowest cell in the whole run
  before its second draw arrived, which is a fair warning about this stage — but it makes seeding the
  most promising unexplored option and it bears directly on what wave 1 should be asked to do.

  **And Moby-Dick says seeding cannot simply be adopted at book length**: its heading tree finds 137
  depth-1 parts, so a wave 1 that merely accepts the author's boundaries hands the reader a 137-item
  top level. Seeding and grouping have to be the same call. Both arms run properly in stage 1's
  measurement; whichever wins is adopted afterwards, as its own change.

## Stages

Each ends green and committable. The risky part was measured before anything was built.

**Stage 0 — the root's range is derived like everybody else's. Landed 2026-09-04.**
Three independent arms — Sonnet at `medium`, Sonnet at `low`, glm-5.3-flash — lost
`openai-huggingface` to the same sentence: *"it skips 0 block(s) at the start and 3 at the end"*. The
article ends on an empty paragraph, a stranded footnote the prompt renders as
`NOT-GISTABLE: (withheld)`, and a blog footer whose entire text is "No posts", so ending the article
before them is what a careful reader does. The cause is a contract that was inconsistent at one
node: `planChildRanges` derives every child's range, but **the root has no parent**, so its range was
believed and then met a hard equality assertion. `buildTree` now clamps the root to the article's
ends before descending — widening, never shrinking, because a block with no leaf is unresolvable
everywhere in the reading view — records the clamp as a `repair` at the boundary that moved, and
keeps the guard behind it as a post-condition.
This is a prerequisite rather than a detour: **wave 1 produces the root's own range**, so the cascade
would have inherited the same fatal asymmetry. It is also
[hierarchy-cheap-models](../../evals/results/hierarchy-cheap-models-2026-09-03.md) recommendation 3,
outstanding since 2026-09-03.
**Done:** two new tests seen red with the guard's own message and now green; the real 95-block
article builds, covers every block, passes `checkTree`, and reports 3 repaired blocks; two existing
tests that asserted the refusal rewritten to assert the repair.

**Stage 0b — two prerequisites on the incumbent path, before any cascade code. Landed 2026-09-04.**

*`EFFORT` is `"low"`.* Eight of eight blind judgements across two evals and two judge families, the
same pooled 6-in-7 reliability, and this plan's own run on the two long articles: $0.264 against
$0.293 and 150s against 172s on `constitution` for the same seven parts, and $0.135 against $0.234 —
42% less — on `gwern-scaling-long` for **eight parts against six**, which is the welding fault
happening in front of us. The two failure modes are not commensurable, and that is the argument:
`medium` welds two of the author's sections under one title, silently, for every reader of that
article, and nothing in the pipeline can detect it; `low`'s fault is a tiling violation that throws
loudly and costs one Retry.

*Three guards fired on that one line, and all three were right.* The request-parity pin
(`tests/hierarchy-structure-request-parity.test.ts`), the eval's incumbent-parity pin, and — the
interesting one — the assertion that the eval's isolated-effort arm differs from the incumbent in
effort. Production moving to `low` made **`smart-low` a second copy of `incumbent` under another
name**, so the arm keeps its job and changes its value: it is `smart-medium` now, and it asks the
same question with production as the control rather than as the challenger. Results filed before
today name `smart-low` and are not one series with anything it produces, because the control moved.
`evals/README.md` also said the incumbent runs at "effort high", which had been untrue for five days;
it now points at the constant instead of restating it.

*`splitBlocks` counts a stranded supplement before it returns.* It walked back from the last block
looking for a trailing apparatus run and, when the last block was body, returned `stranded: 0`
without counting anything earlier. `openai-huggingface` is that shape — a footnote at index 93, a
blog footer reading "No posts" after it — so it built no Notes node, buried the note under an
ordinary branch, reported zero, and printed the usual "0 nodes over 0 blocks". `body` and `groups`
are unchanged on both paths; what changes is that the run says what happened. It matters *now*
because stage 0 just made that article publishable.
**Done:** both fixes have a test seen red first — the `stranded` one on the shape that reaches it,
with a control proving zero is still reachable; the real article now reports its one stranded note.
The effort evidence is written into `EFFORT`'s own comment, where the previous two flips are argued.

**Stage 0c — a backwards child range is derived from, not refused. Landed 2026-09-04.**
The `low` flip's one genuine failure in four draws was `smart-low` losing `gwern-scaling-long` to
*"root > child 7 > child 1 has a range that runs backwards"*. The obvious pairing was the automatic
retry the eval asked for on 2026-09-03 — and it **does not fit the job lease**: the arithmetic
`fetch ≤110 + extract 10 + blocks 5 + hierarchy 320.4 + assets ≤185 = 630.4s < 740s` leaves 109.6s,
and a second structure call needs more than that. Lowering `STEP_BUDGET_MS.hierarchy` on four `low`
draws is not available either — it is an admission estimate, not an enforced timeout, and two ~150s
calls are not a worst-case bound.

So the failure is removed instead of retried, at no latency cost. `planChildRanges` believes a start
and computes every end, so **a child's own end is a redundant second statement of a boundary the
derivation already discards**; a backwards pair whose ids both resolve is those two statements
disagreeing, which is what the repairs absorb everywhere else. It is not evidence the node's title
and gist describe the wrong prose — the model wrote those from the whole article, not from its range.
The one thing it costs: a backwards end is **ineligible for the duplicate-start fallback**, because
borrowing an end we have just called wrong would invent a split point and attach *both* neighbours to
the wrong prose; a following child with no claim left is dropped, as it always was. The root still
throws, having no parent to derive from.

**A decision reversed on evidence, and the third fixture to be walked back for the same reason** —
the size bound went 2026-08-30, the count bound 2026-08-31, and now this. Three tests that pinned the
refusal move to the plainest fault that is left, an invented block id.
**Done:** three new tests seen red, including a control that an invented id still throws and one that
a backwards *root* still throws; the recorded failing shape now builds `gwern-scaling-long` into 7
parts with no dropped children and clean invariants. If the automatic retry is still wanted later,
GPT Sol's shape is deadline-aware, at `low`, gated on ≥505.4s of claim remaining.

**Stage 1 — the shared request seam, and the paid experiment. No production behaviour change.**
Build the request builder (returning a complete transport body, not four fragments), the pure batch
planner, the immediate normaliser, and a minimal cascade executor; give the eval's `waves` arm a
structured `WaveRecipe` and route it through the shared executor, deleting its copied `runWaves`.
Add `elapsedMs` around the whole arm plus per-call `wave`, `startedOffsetMs` and `endedOffsetMs` —
summed `CallStats.ms` is not latency, and the barrier and cold-cache serialisation are exactly what
it misses. Keep incumbent request bytes identical, pinned by
`tests/hierarchy-structure-request-parity.test.ts` extended to cover the serialised transport body of
both shapes, including effort and the *absence* of a cache marker on the incumbent.

**The prompt and response contract is frozen at the end of this stage**, so six things must be in it
before it closes, or they become migrations: input-token-aware packing; the heading-aware stopping
rule and the exact depth-cap behaviour; `sourceHeading` in the response; the corrected prefix
ordering and the per-wave cold-cache policy; **the JSON schema on `output_config.format`**
([above](#structured-outputs)), with its cache-key and refusal/truncation behaviour checked; and
**per-call output budgeting from that wave's own answer**. That last is not a refinement — `structureRequest` today sizes `max_tokens` from
`estimateHierarchyTokens` over the *whole tree*, which is the very total-output refusal the cascade
exists to remove, and inheriting it would leave `TooLongForOnePass` in place under a new architecture.
**Done:** deterministic tests pass; incumbent bytes unchanged; a repeated run over three documents
(well-headed, misleading-headings, headingless) reports measured wall time, cache accounting,
reasoning distributions, `capReached`, and predicted-against-actual children.

*Landed so far:*

- **1a — the eval measures wall clock** (2026-09-04). `ArmResult.elapsedMs` around the whole cell,
  `performance.now()` not `Date.now()`, present on a `threw` row too; per-call `wave`,
  `startedOffsetMs`, `endedOffsetMs` so the barrier structure is visible rather than inferred. All
  optional, because a run.json written before today has no such measurement and should stay silent
  rather than be backfilled with the approximation it replaces. The load-bearing test is the one that
  fails if anyone later folds `elapsedMs` back into a sum.
  **A note on how those were seen red**, because the obvious way does not work here: vitest strips
  types without checking them, so removing a field from an interface leaves fixture literals passing
  at `npm test`. The gate is `npx tsc --noEmit -p tests/tsconfig.json`, which `npm run typecheck`
  runs and a bare `tsc -p tsconfig.json` does not.
- **1b — the deterministic core**, `src/hierarchy-cascade.ts`: `shouldExpand`, `structuralBlocksIn`,
  `predictedChildren`, `estimateExpansionTokens`, `planExpansionBatches`, `normaliseExpansion`,
  `assertCascadeComplete`, and the `pending | terminal | expanded` state. Pure — no model, no
  network, no store. 24 tests, 18 of them watched red against a naive stub and three more under
  individual perturbation. It is **not wired into `generateHierarchy`**; nothing in production calls
  it yet. `nameValue` is exported from `src/hierarchy.ts` rather than copied, because it is one rule
  about what is safe to put in a log line and a second copy could only drift into leaking a
  paragraph.

*What the review changed, because the first version of 1b was not acceptable.* GPT Sol's verdict was
that "the completion state and single-child handling leave exactly the silent-success path this
module says it prevents", and it reproduced each finding rather than reasoning to it:

- **`assertCascadeComplete` did not prove completeness.** A ten-structural-block root marked
  `"expanded"` with no children passed the guard, made `shouldExpand` say `true`, and had `buildTree`
  quietly grow ten leaves under it — a whole wave of the article missing, with the module's own guard
  as the casualty. Status and shape are now one discriminated union (`terminal` has no children,
  `expanded` has at least two *in the type*, `pending` has none), revalidated at runtime because a
  resumed cascade arrives as checkpoint JSON where a cast proves nothing, and cross-checked against
  `capReached` both ways. `finaliseCascade` is the one road to a buildable tree.
- **A one-child answer was accepted as an expansion**, and one child inherits its parent's whole
  range, so the governor asks the identical question one level down until `maxDepth` runs out.
  Fewer than two *kept* children — counted after planning, so a collapse is seen too — is now
  `ExpansionRefused`, and the refusal carries the drops that caused it without merging them into the
  run's report, which would have double-counted a retried batch.
- **The token cap was one number doing two jobs.** It is now a soft `maxEvidenceTokensPerBatch` for
  packing and a hard `maxRequestTokensPerBatch` for feasibility, and an oversized target is a union
  member rather than a flag, so a `switch` that ignores it does not compile. The estimator counts the
  ±1 context blocks, whose "effectively constant" was simply false.
- **A privacy leak.** The completeness error interpolated raw model ranges; Sol reproduced one
  carrying a sentence of article prose. It routes through `nameValue` now, as every other throw in
  the file already did.
- **`nameValue` moved to `src/ids.ts`.** Exporting it from `src/hierarchy.ts` made a pure arithmetic
  module load the whole of stage 4 at runtime, and would have become a real
  `hierarchy → cascade → hierarchy` cycle the moment `generateHierarchy` wired the cascade in.
- **`sourceHeading: ""` was silently deleted** by a truthiness spread, so the cascade would have
  reported fewer `droppedHeadings` than the incumbent on identical output.
- **The heading clause filters to `isBodyEvidence`**, because a supplement heading's text is withheld
  from the prompt and expanding on one asks the call to split at a boundary it cannot see. This
  matters more since stage 0b: `splitBlocks` reports stranded supplements now, and its fallback hands
  the whole article through.

*Tests went 24 → 38*, each new one watched red under its own perturbation. The one that matters most
is the **differential test**: normalise an answer, hand it to the real `buildTree`, and require that
it changes no range and records no repair. That is what makes keeping the two derivations separate
safe, and it replaces an "idempotence" test that never touched `buildTree` at all.

*The maintenance debt this stage creates, named rather than left to be found:* `normaliseExpansion`
is about 90% of `planChildRanges`, deliberately not shared — they differ exactly where it matters,
and parameterising on an optional `ends` would thread a conditional through every line of both. Sol
agreed, and named the seam for the day it is needed:
`{ childIndex, claimedStart, fallbackStart? }`. **The derivation rule must not fork**, and the
differential test is what says so out loud.

*Two things stage 2 inherits, explicitly.* `maxRequestTokensPerBatch: 120_000` is a placeholder with
a discoverable right answer — the context window less the output budget — and should be read off
`src/models.ts` rather than kept. And the hard bound is only as hard as the overhead the caller
declares: `UNMEASURED_OVERHEAD` exists so that passing nothing is visible, but a real
serialise-and-count belongs in the request builder.

**Stage 2 — the production-grade cascade core, still not selected by `generateHierarchy`.**
Explicit `pending | terminal | expanded` state, `assertCascadeComplete`, batching, abort-on-first-
fatal, checkpoint fingerprints and validation under a new `"hierarchy-structure"` namespace (with its
database CHECK), and final conversion through `buildTree` plus `assertTreeSound`. **All retry
semantics live here**, including the one the eval asked for as "retry when `buildTree` throws" — once
every answer is normalised and validated as it lands, that is not a separate feature but the batch
retry seen from outside, and building it twice would mean building the first one to be deleted.
**Done:** injected failures resume the exact completed batches; no incomplete cascade can
materialise as a tree; every synthetic multi-wave fixture tiles under the existing invariants; and
**the real `planBatches` and `generateLabels` run against a synthetic variable-depth tree**, which is
the assertion that matters — "no label call before completion" only says when, not whether the label
pass can read a tree of this shape at all.

**Stage 3 — production integration and observability.** Switch `generateHierarchy` to the cascade,
aggregate every call's cost, cache, repair and `capReached` figures onto `HierarchyRun` and the
step's log line, keep artefact publication all-or-nothing, re-size `STEP_BUDGET_MS.hierarchy` and the
`LEASE_MS` arithmetic that turns on it, generalise `SummaryPanel.tsx` § `DEPTH_LABELS`, and update
`hierarchy.md`, `prompt-caching.md` and `granularity-zoom.md` in the same stage.

**The spine is deliberately not "generalised".** Its L1 bands and L2 ticks are top-anchored, and on a
five-level tree "the depths the spine represents" is a design question with a right answer, not a
mechanical substitution of `maxDepth`. Decide what the spine should show on a deep tree, or leave it
top-anchored and say why — do not let a loop over `columnDepths` decide it.
**Done:** `2701-h` (2,569 blocks) produces a tree where it previously threw `TooLongForOnePass`, and
`1228-h` (1,326 blocks) has not regressed; browser check of a re-ingested article at 2, 3 and 4
internal levels; full tests, typecheck and `npm run check` green.

## What is deterministic, and what only an eval can answer

**Deterministic** (no model call): incumbent and wave request bytes and breakpoint position; batching
covers every target exactly once and never splits a sibling set; the 9/10-block stopping boundary;
strict target-ordinal coverage; invented, duplicate, reversed and non-increasing starts; immediate
range normalisation and exact tiling; a `pending` node refusing finalisation; no premature leaf
creation; fingerprint sensitivity to prompt version, model, effort, overview, ranges, outline, recipe
and grouping; checkpoint rejection when its targets differ; queued work aborting after one fatal
failure; resuming without constructing an API client; no label call before the cascade completes;
`buildTree` + `assertTreeSound` over multi-wave fixtures; the cache scheduler below the floor, with
one call left, and with several.

Every one of those is written and **watched red first**, with the intended assertion checked as the
one that fires — a generic red proves nothing ([silent-success.md](../reusable/silent-success.md)).
Useful perturbations: move the breakpoint after the varying task; remove one frontier target; omit
effort from the fingerprint; treat `pending` as terminal.

**Only an eval can answer:** whether a smaller `max_tokens` shortens thinking or merely truncates —
the spike above says the *question* shortens it, which is a different claim and the one that matters;
`medium` versus `low` on quality, latency and cache cohorts; whole article versus range-plus-outline;
barriers versus free scheduling; heading-list versus heading-tree seeding; whether OpenRouter
actually wrote and read the prefix (only a paid two-call probe counts, and it must show a read of
roughly the marked prefix, not merely a non-zero number); and title, gist and boundary quality, which
is blind-judged with ≥4 interleaved repeats per arm per document, framed as non-inferiority: **as
good as, faster, never refuses.**

## Alternatives considered

- **Free-running subtrees instead of level barriers.** Saves the tail of the critical path, costs
  more calls, loses deterministic batching and fingerprints, and lets one subtree see cousins another
  did not. A later scheduler optimisation, once the barriers are measured.
- **Every deep call sees the whole cached article.** Attractive at today's lengths and it fails at
  book scale, wastes attention on irrelevant prose, and loses its cost advantage once `m` is large.
  Kept as an eval arm (`context: "whole-article"`), not as the default.
- **Shrinking `max_tokens` to shorten thinking.** The causal claim is unsupported —
  [260826a](../postmortems/260826a-toc-max-tokens.md) establishes expansion at `high` and says
  nothing about `medium`. A tight budget bounds spend and may simply truncate earlier. The spike
  shows the smaller question thinking less *at the incumbent's own budget*, which is the effect we
  actually want and does not require squeezing the ceiling.
- **Reusing `acceptGap` for structure.** No. A missing label is bounded and countable; a missing
  structural expansion changes the navigation geometry.
- **A separate bottom-up gist pass.** Not until blind judging shows the upper gists drifting; the
  expansion call rewriting its parent's gist recovers most of the rule for free.
- **The four rejected shapes from the earlier round** — raise `max_tokens`, recover from truncation,
  the Batches API, dropping the leaf level — stay rejected for the reasons in
  [260826h § Alternatives](260826h-toc-scaling.md).

## Reviews

- **Fable**, 2026-09-04 — the product calls: bottom-anchored variable depth, all-or-nothing in v1,
  no progressive opening yet, run at `low`, make the heading skeleton the geometry where usable, and
  the gist rule this breaks.
- **GPT-5.6-sol**, 2026-09-04, twice — first on the design: breadth-first barriers, packing by
  predicted children, range-plus-outline over whole-article, the `StructureContext` seam, the
  normalise-immediately hole in the existing eval arm, the ordinal response format, the checkpoint
  namespace, and the staging above. Then on this document, where it found the things that were wrong
  *in it* rather than in the design, by reading `run.json` and the code instead of the prose:
  - the run measured an 84-block `constitution` and every cell said `matchesManifest: false`;
  - the pooled means hid two pairs with no latency win and a cost premium up to 65%;
  - the caching example marked the article as cached and the rules as varying, contradicting its own
    paragraph, and the "large `m`" cost argument was not derivable from `m`;
  - wave 1 cannot warm a prefix containing an outline it has not produced;
  - `expand iff > 9 blocks` counts the wrong blocks and can merge across an authored heading;
  - the depth cap needs declared behaviour, not "UI sanity";
  - `structureRequest`'s whole-tree budget would carry `TooLongForOnePass` into the new architecture;
  - the effort decision is two decisions and one of them is already supported.

  Everything in that list is now fixed above. Its one finding I have not acted on is the observation
  that `No posts` is still treated as structural at all — a stage-3 extraction question, not this
  stage's, and recorded here so it is not lost.

## See also

- [hierarchy.md](../project/hierarchy.md) — the stage
- [260826h-toc-scaling.md](260826h-toc-scaling.md) — the split that moved the labels out, and
  alternatives A–J including the coarse-to-fine shape this plan builds
- [260830a-opening-an-article-before-the-toc.md](../research/260830a-opening-an-article-before-the-toc.md)
  — the measured evidence, and Greg's first statement of the wave idea
- [260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md) — why `max_tokens` is a
  ceiling and `effort` is the leash
- [prompt-caching.md](../project/prompt-caching.md) — where the caches are and what invalidates them
