# A document was refused for an answer it never had to give

Greg uploaded Kuhn's *A Landscape of Consciousness* (2024) — 142 pages, 2,025 blocks — to production
on 2026-09-03 and again on 2026-09-04, and it never became an article. The second day's failure was
`TooLongForOnePass`:

> The table of contents needs about 89,575–90,100 tokens for this article, and one model response
> holds 128,000 including the model's own reasoning. This article has to be processed in sections,
> which is not built yet.

**The article's real answer is 10,996 tokens.** Measured, on the same document, same prompt, same
effort: `stop_reason: end_turn`, a valid tree (`checkTree`: 0 problems) tiling all 2,025 blocks, using
45% of one response. The estimate was **8.21× the truth**, and the refusal was `blocked` — no Retry
button — so there was nothing the reader could do, on either day.

## The class: a linear estimate, fitted at one scale, used as an admission gate at another

`estimateHierarchyTokens` charged one internal node per four blocks:

```ts
const internal = Math.ceil(blocks.length / 4) + 6;
return 500 + internal * 175;
```

`N/4` was fitted to three trees of 19, 141 and 360 blocks, where it held. What it models — how many
internal nodes a model writes — does not grow linearly with the article, because the prompt asks for a
shallow tree over a long one. So the error is not constant: it climbs with length, and it climbs
fastest exactly where the number is load-bearing.

Measured across 32 real trees (~20 distinct articles):

| blocks | actual answer tokens | estimate | over |
|---|---|---|---|
| 41 | 2,581 | 3,475 | 1.35× |
| 120 | 3,789 | 6,800 | 1.79× |
| 551 | 6,769 | 25,700 | 3.80× |
| 1,093 | 12,305 | 49,500 | 4.02× |
| **2,025** | **10,996** | **90,275** | **8.21×** |

**Name the class: an estimator validated inside its fitted range, and relied upon outside it, by a
gate that refuses rather than measures.** The gate's own test pinned the boundary — 1,976 blocks — and
called the boundary "the feature". So the test agreed with the estimator by construction, and the one
thing neither could see was whether the number was true of a document twice as long as anything in the
corpus. This is [silent-success.md](../reusable/silent-success.md) inverted: not a check that passes
while doing nothing, but a check that *fails* while measuring nothing.

The function's own comment said *"every real tree comes out 1.5x–2.3x under the estimate"*. The measured
range is **1.09×–8.21×** — wrong in both directions, and nobody re-ran it because it read like a
measurement rather than a recollection.

## What made it expensive rather than merely wrong

Three things, and each is worth separating:

- **It was `blocked`.** A cost cap dressed as a capability limit. `blocked` means *asking again will be
  refused*, and it withholds the Retry button — correct if the document truly cannot be described,
  which was never established.
- **The sentence named the fix as unbuilt.** *"has to be processed in sections, which is not built
  yet"* pointed at a feature (260826h § D) rather than at the number, so every reader of that message —
  including this job's first plan — went looking for the sectioning work instead of the estimate.
- **It moved.** 260903k raised `MAX_PAGES` 100 → 250 on 2026-09-04, which took the document past the
  *page* gate and straight into this one. Two cost gates in series, each written without the other in
  view.

## Two things this nearly got wrong in turn, both caught by review

Recorded because the near-misses carry more than the fix does.

**The first plan claimed the answer was *bounded*** — that the prompt's "3 levels deep, 5–9 children"
capped internal nodes near 91 whatever the length, making the ceiling a pure artefact. GPT Sol returned
DO-NOT-SHIP: "aim for" is guidance, headings are hard boundaries that can demand more, and `buildTree`
enforces neither depth nor fan-out — it was shown accepting depths `[0,1,2,3,4]`. **A bound in the
estimator would have been a claim the runtime does not keep.** The corpus *does* saturate near 91; that
is a fact about how the model behaves, not a guarantee, and the difference is the whole finding.

**Correcting the answer term alone would have truncated the very call that proved the fix.** The Kuhn
call spent **47,289 tokens on thinking**, above `THINKING_HEADROOM`'s 40,000. An estimate corrected to
~11,000 would have granted ~51,000 and hit `max_tokens` — trading a free refusal for an eight-minute
paid failure. The reservation had to move too, and only a measurement could say so.

## What would have caught it

Ranked by ease and by value, which do not agree here.

1. **Cheapest, and it would have caught it: log the estimate against the actual, every run.** Both
   numbers exist at the moment of the call. One log line — `{ estimated, actual, ratio }` — turns
   "is this estimator still true?" into a query rather than an investigation. Nothing recorded the
   ratio, so an 8× overprediction was invisible until a document crossed the line. This is the same
   lesson as 260904a's recommendation 2 (*log the hit rate, not the exception*) arriving at a second
   site: **instrument the quantity, not the failure.**
2. **Cheap, high value: make a refusal carry its own falsification.** A gate that refuses a document
   should say what it would take to admit it, and something should periodically test that claim. Here
   a single call with the budget lifted — the experiment that resolved this in one afternoon — could
   have been an eval arm from the day the gate was written.
3. **Moderate: fit-range assertions.** An estimator should record the range it was fitted over and
   fail loudly, or degrade to measuring, outside it. `N/4` was fitted to ≤360 blocks and applied at
   2,025 with nothing marking the extrapolation.
4. **Do not** pin a boundary constant in a test and call the boundary the feature. `token-budget.test.ts`
   pinned 1,976 blocks, which made the estimator's own arithmetic the thing under test — the test could
   only ever agree with it. It is now pinned on an adversarial shape instead.

## Fixed

- The node term is re-derived from the prompt's own rules — heading count, long-run splits and the
  ancestors those need — and still grows with the article, because the runtime bounds nothing.
  `175` tokens per node stays: worst observed 145, Kuhn 132.
- `STRUCTURE_HEADROOM` is a measured, stage-specific 64,000, above the observed 47,289.
- Thinking was measured not to expand into the larger budget (8 calls, 2 articles, 2 budgets, 2
  repeats), which reconciles [260826a](260826a-toc-max-tokens.md): that expansion was an
  `effort: "high"` phenomenon and this stage has run at `"medium"` since. **Re-check if effort rises.**
- The false "1.5x–2.3x" claim on the function is replaced by the measured range and its date.

## Still open, and named here so it is not lost

The tree that comes back at this length is *valid* but not *good*: one section spans 241 blocks, which
becomes a label batch four times `MAX_BATCH`, and `oversizedSets` only reports it. And 53 of 82 nodes
start one block *after* their heading rather than on it — the cause of `droppedHeadings: 59`. Both are
[260826h](../plans/260826h-toc-scaling.md) § J, and both are stage 8 of
[260904b](../plans/260904b-a-long-pdf-finishes-without-a-retry-click.md).

## A second bug, same day, opposite direction — and the same missing habit

Fixing the checker's false positives introduced a false *negative*, within hours, and it is worth
recording beside the first because the two share a cause.

`pass0` fuses a page's printed folio onto the heading that follows it — the text layer holds
`649.5.10.` where `64` is the folio and `9.5.10.` the heading — so a correctly transcribed `9.5.10`
scored as invented. The first fix admitted any line-initial numbered heading with **1–4 leading digits
stripped**. That cleared all eight real cases and kept the two known true positives (`12`, `13`).

It also silently admitted `12.3.` transcribed as `2.3.` — a corrupted section number, exactly the
class the check exists to catch. GPT Sol found it by *constructing* the case; the implementer had
verified against the ten cases it was handed, and all ten passed.

**Name the class: a check loosened to clear the failures in front of you, validated only against those
failures.** A widened rule needs an adversarial case built on purpose — "what does this now let
through that it should not?" — and that question is not answered by re-running the examples that
motivated the change. The implementer's own account is the clearest statement of it: *"the measurement
that would have caught this — constructing the adversarial `12.3. → 2.3.` case rather than only
checking the ten cases handed to me — is what I should have done and didn't."*

**Fixed** by taking the option first declined as over-engineering: `folioOffset` elects one offset for
the whole document by vote (offset 27 is line-initial on 141 of 142 pages, runner-up 10) and strips
only *that* number, on the page it belongs to, only when what remains is itself a numbered heading.
Extra haystack entries fell from 260 to 11; the eight fixes hold, `12` and `13` still fail, and
`12.3. → 2.3.` now fails too. It also reaches the **chunk** score, which is the one that gates — a gap
in the first version.

**Still open, and the right long-term answer:** have `pass0` keep the text-layer item boundary it
currently discards, so the folio and the heading never fuse and none of this has to be inferred. It
changes every page's text, so it needs its own measurement pass against the fixture corpus.
