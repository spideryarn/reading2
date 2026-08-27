# Repairing Readability with a second-stage model

**Status: a spike, with numbers, and a recommendation that is no longer the thing that was asked
for.** Nothing in the pipeline has changed. Stage 2 is
[content-extraction.md](../project/content-extraction.md).

> After we run Mozilla Readability on HTML imports, I wonder how/whether we could/should run a
> frontier model (or perhaps just Luna) on the before and after to correct things? … Perhaps create
> an evals set of a few cases where Mozilla Readability doesn't do a great job, and see whether
> running Luna as a post-processing 2nd-stage helps.
>
> — Greg, 2026-08-27

## The short answer

We found a real failure, on a page already on the shelf, and **it is fixed for free by four lines of
deterministic code with no model in the loop**. A model pass may still earn a place, but it is now
the *fourth* thing to try rather than the first, and the eval has to be built before the question
can be settled honestly.

## What is actually broken, measured

`data/constitution` — Anthropic's own Claude's Constitution — loses **48,147 characters, 26% of the
article**, including whole named sections. Readability returns an article, nothing throws, and the
piece reaches the reading view looking complete. Checked directly rather than inferred: the strings
`three types of principals`, `hard constraints that remain`, `Operators: Companies and individuals`
and `Claude typically cannot verify claims` are all absent from what stage 2 produces, and all
present in `raw.html`.

The other two cached HTML articles are clean — Noema loses one 144-character standfirst, PG loses
nothing.

### Why, and it is not a scoring failure

The lost text sits inside collapsed accordions:

```
  <p class="body-3 serif">                                    the article's own prose
   └ <div class="…ExpandableSection…__body">
      └ <div role="region" aria-hidden="true">                ← here
         └ <div class="…expandableSection">
            └ … <article> … <main id="main-content">
```

Readability skips `aria-hidden="true"` nodes on purpose —
`node_modules/@mozilla/readability/Readability.js:2701`, in its visibility check. It is honouring
the accessibility tree, which is the right instinct and the wrong answer here: **an accordion is
closed, not absent.** The reader would see that text by clicking. Readability cannot click.

This matters beyond one page. Expandable sections are ordinary on documentation sites, FAQs, papers
with collapsible appendices and any long piece with a "read more". The failure is silent every time.

### The fix, and what it costs

Remove `aria-hidden="true"` (and `hidden`) before parsing:

| Page | stock | un-hidden | probes found |
|---|---:|---:|---|
| constitution | 141,436 | **180,791** | 0/5 → **4/5** |
| noema | 52,643 | 52,643 | unchanged |
| writes | 3,096 | 3,096 | unchanged |

**+39,355 characters recovered, nothing lost on the pages that were already right, no model, no
money, no latency.** The fifth probe is the author-bio block, which is arguably boilerplate.

That is one page's evidence and it must not be shipped on one page's evidence — un-hiding is exactly
the kind of change that could drag in a hidden mobile nav, an off-screen menu or a
screen-reader-only duplicate on some other site. It is a candidate with a strong first result, and
the eval below is what would settle it.

### And the external number

WCXB, a 2026 benchmark of 2,008 human-reviewed pages (CC-BY-4.0), scores Mozilla Readability at
**0.825 mean word F1 on its article subset**, against 0.932 for `rs-trafilatura`, 0.928 for
MinerU-HTML and 0.903 for `dom-smoothie`. So there is a real, published gap between Readability and
the better deterministic extractors, on exactly our page type — and it says nothing about a model
pass, because none of the systems above the gap is one.

## Six ways it goes wrong

The eval is built from this list, and a fixture that fills no slot measures nothing — the discipline
of [evals/pdf/README.md](../../evals/pdf/README.md).

| | Failure | What the reader sees |
|---|---|---|
| **T** | Truncation | The piece stops early, or a middle section is missing |
| **B** | Boilerplate | Nav, related-articles rails, newsletter box, comments, footer |
| **W** | Wrong container | A sidebar or an abstract instead of the body |
| **S** | Lost structure | Tables, code, captions, footnotes, math flattened or dropped |
| **D** | Duplication / order | An AMP or print variant inlined twice; sections interleaved |
| **N** | Nothing | `parse()` returns null — the one failure that is already loud |

GPT Sol's objection to this table is fair and recorded rather than resolved: T, W and B are outcomes
with overlapping causes, and a wrong container shows up as truncation *and* boilerplate at once. Its
proposed axes — acquisition completeness, content recall, content precision, order/duplication,
structural fidelity, metadata fidelity — are the right ones for *scoring*. The letters above are
kept for *choosing fixtures*, which is a different job: they name the shapes a corpus needs to
cover. **`N` is also not the only loud failure** — an exception, or a 600-character paywall notice
returned as a complete article, are failures the current stage calls success.

## The ladder, cheapest first

Reordered after the review. The original plan started at rung 3.

| | Rung | Cost | Status |
|---|---|---|---|
| **0** | Pre-clean the DOM before Readability — un-hide collapsed regions | free, deterministic | **measured, works on the one case we have** |
| **1** | Deterministic candidate variants: a semantic root, Readability's own options | free, deterministic | measured, **helps nothing** — see below |
| **2** | A second extractor as a candidate (`dom-smoothie`, or trafilatura out of process) | free at runtime, a new dependency | not tried — needs Greg's call |
| **3** | A model **detects** a bad extraction; no article text in its output | cheap | **measured** |
| **4** | A model **repairs** by selecting source nodes | cheap, as it turns out | **measured** |

Rung 1 was tested on all three cached pages and moved nothing: `charThreshold: 0`,
`nbTopCandidates: 20`, `linkDensityModifier: 0.3`, re-rooting at `<main>`/`<article>`, and stripping
`nav`/`aside`/`footer`/`header` all returned byte-identical text on the Constitution and missed all
five probes. Worth knowing, and worth knowing *why*: `charThreshold` is not a "keep more text" dial
— Readability already re-runs itself with progressively less aggressive flags when a result comes in
under it (`Readability.js:1546`), so changing it moves when those fallback passes happen, not how
much survives.

Rung 2 is the one the external number points at, and it is a dependency decision rather than a
technical one — [vision.md § Principles](../project/vision.md#principles) says prefer boring and
names the two exceptions already made.

## What the model arm actually did

[`evals/extraction/rescue.mts`](../../evals/extraction/rescue.mts). Rungs 3 and 4 turn out to be
**one call**: the inventory already knows which blocks were dropped, so the only thing worth asking
is which of them were the article and which were the furniture. The answer is a list of ids, in the
document's own order, and deterministic code does the copying.

Judged over the blocks genuinely absent from the extraction:

| page | blocks absent | Luna restores | Sonnet restores | "restore everything" |
|---|---:|---:|---:|---:|
| constitution | 157 | 135 (49,753 ch) | 125 (46,740 ch) | 157 |
| noema | 29 | 2 (254 ch) | 1 (144 ch) | 29 |
| writes | 0 | — no call made — | | 0 |

Luna costs about 4.3k input and 1.4k output tokens on the 657 KB page, and takes 22 seconds. That is
far cheaper than expected, and the reason is the inventory: the model never sees the article, only a
few hundred rows of `id, tag, chars, snippet`.

**Three things in that table matter more than the totals.**

**It discriminates.** The first control was worthless and looked fine: on a page Readability handles
well, almost everything it dropped really was article prose, so "restore everything" scores
perfectly while knowing nothing. Mixing in blocks that are *known* furniture — bylines, category
tags, "Published by the Berggruen Institute" — separates the two, and Luna leaves 27 of 29 on the
Noema page while restoring the standfirst and a pull-quote. On the Constitution it leaves 22 of 157.
It is not saying yes to everything.

That control had to be fixed once, and the way it broke is the useful part: its first version swept
in every short block including ones Readability had **kept**, so Luna was handed eight section
headings that were never dropped, and its perfectly correct *"these are the article"* was counted as
a rescue. A control that includes the answer measures the control. It now filters on blocks the
extraction genuinely lacks.

**Luna is as good as Sonnet here.** 135 against 125, 2 against 1 — no gap worth paying for, which
answers the "or perhaps just Luna" directly. With the caveat that agreement between two models given
the same prompt and the same row format is weaker evidence than it looks.

**And it overlaps almost entirely with the free fix.** Un-hiding recovers 39,355 characters on the
Constitution for nothing; Luna restores 49,753 on the same page for a fifth of a cent and 22
seconds. **They are mostly the same characters.** The honest question is not "does Luna help?" —
it does — but "does Luna help *after* rung 0 has run?", and that is one experiment nobody has done
yet.

## Designs 3 and 4, and the one that is still ruled out

### Detect only

The model sees a description of the raw page and of what Readability kept, and answers: did this go
wrong, in what way, how sure. It emits **no article text**, so there is nothing to fabricate. What
it buys is an honest error that names the alternative — the thing the
[original version got right](../project/original-version/extraction.md#the-correction-the-escalation-ladder-was-never-built).

**Detection is not free of risk**, which the first draft of this plan had wrong. A false positive
rejects a good article, or spends money on a repair that was not needed, or tells a reader the
publisher's text is suspect. It has to be scored as precision and recall at the real base rate, not
as accuracy — if 3% of pages fail, a detector that always says "fine" is 97% accurate.

### Repair by reference — the model points, code copies

The model returns operations over nodes that already exist. Deterministic code copies those nodes.
No character of the article is written by a model.

**But source-grounded is not the same as faithful**, and this is the review's sharpest point. A
wrong `insert-after` moves a qualification away from the claim it limits, puts a section's
conclusion under someone else's heading, or reverses an argument's order — while every single word
passes the provenance check. That can be worse than one invented sentence, because nothing catches
it.

So if this rung is reached, the operation language is **a source-order inclusion mask, not free
placement**: the model chooses which source nodes are in, and order is the document's own. Then code
enforces no ancestor/descendant overlap, no node twice, source order preserved, and a hard failure —
not a best effort — on anything ambiguous. Less expressive on purpose. If a repair needs free
reordering, it is not a safe selector any more.

The "byte for byte" claim in this file's first draft was also wrong: parsing, cloning, serialising
and sanitising all change entities, whitespace and markup. The defensible claim is that **every
emitted character originates in a source text node.**

### Rewrite — still ruled out, for a corrected reason

The first draft said a rewritten document re-mints every block id. **That is factually wrong, and
the correction matters**: stage 2 *always* writes a fresh document, and stage 3 carries ids across
by matching a new block to an old one on its text
([block-ids.md](../project/block-ids.md#surviving-stage-2-which-is-the-case-that-actually-matters)).
Ids survive a fresh document already.

What they do not survive is **changed words**. So the real objection to a rewrite is id *churn*: a
model that tidies a sentence, splits a paragraph or fixes a typo silently orphans every note and
highlight anchored there — and it looks like nothing happened. Rung 4 carries a smaller version of
the same risk wherever it reconstructs a wrapper, and the eval has to measure id stability across
two runs, not just text quality.

The other reason stands unchanged and is the stronger one: a model that quietly modernises an
author's spelling or drops a clause produces prose that reads perfectly and is not what was
published, and for a web article we have no independent witness to check it against. The PDF stage
spends its whole design budget on exactly this problem and it *has* a text layer to check against
([pdf-read.ts](../../src/pdf-read.ts)).

## The instrument, and the four times it was wrong

[`evals/extraction/inventory.mts`](../../evals/extraction/inventory.mts) — no model, no network, no
money. It flattens the raw page into blocks and says which survived into Readability's output.

It has been confidently wrong four times, and every one of them printed a tidy number:

1. **A list of block tag names** found *one* block of 67 characters in PG's 3,096-character essay
   and printed `ratio 100.0%` underneath. His HTML is a `<table>` holding a `<font>` holding the
   whole essay split by `<br>`; not one tag on that page is on anybody's list.
2. **"Deepest element with 20+ characters"**, the fix for it, reported 12,231 characters of the
   Noema essay as dropped when Readability had kept every word — a paragraph containing a long link
   has a *child* over the threshold, so it shattered into fragments that are contiguous in the
   document and in no string we build.
3. **An exact substring test** called PG's entire essay dropped while the ratio beside it said 100%:
   one block, one all-or-nothing comparison, one reflowed `<br>` in the middle.
4. **Counting shingles without their positions** scored a wholly truncated article as
   nothing-dropped, because the synthetic paragraphs shared phrasing — which is what a page of
   repeated legal notices does for real.

All four are now cases in [`tests/extraction-inventory.test.ts`](../../tests/extraction-inventory.test.ts),
each watched failing against the version that had the bug. That is why `compare()` takes the before
and the after as two strings rather than reading a directory and calling Readability: an instrument
nobody can test at a seam is an instrument nobody tests.

There is also a `coverage` number — what fraction of the page's text the walker can see at all —
because failure 1 is the one that cannot be caught by any check computed *from the rows*.

### The better mechanism, found by the review and verified here

Text matching is the wrong tool, and there is a direct one. Readability takes a `serializer` option;
give it the identity function and it returns a **DOM node** instead of a string. Stamp every element
of the source with a temporary id first, and the output carries the provenance:

| Page | source elements | output elements | carrying a source id |
|---|---:|---:|---:|
| noema | 791 | 317 | 294 (**92.7%**) |
| constitution | 1,161 | 457 | 456 (**99.8%**) |
| writes | 102 | 22 | 9 (40.9%) |

Reproduced independently of the review, which reported 294/317 on Noema and got exactly that. The
nodes without an id are `div` and `p` wrappers Readability generates, a bounded set that can be
mapped through their descendants. PG's 40.9% is the honest floor: his markup is so degenerate that
Readability rebuilds it, and there the text matcher is the better tool. **Both, and report where
they disagree** — two instruments that agree are worth more than either.

And the stamping is inert: text output is byte-identical with and without it on all three pages,
which had to be checked rather than assumed, because Readability weights `class` and `id`.

## What the ratio is and is not

Extracted text over raw text, two-sided, as
[the original version's harness](../project/original-version/extraction.md#quality-measurement-real-and-worth-rebuilding)
did it. It is **an anomaly signal, not a quality score**, and the difference is not pedantic: the
denominator is the whole page, which contains navigation and footers no correct extraction would
keep, in a proportion that varies by template rather than by quality. A per-corpus calibration or
nothing.

One number here is worth recording because it shows how the same ratio can be computed two ways and
differ by a factor of three. Raw `body.textContent` on the Constitution is 592,942 characters, of
which **68% is `<script>`** — embedded application JSON. The harness strips `script`, `style`,
`noscript`, `template` and `svg` before counting anything, so its denominator is 191,875. A ratio
built on the unstripped number reads 0.239 and looks catastrophic; the same extraction against the
stripped one reads 0.737. Neither is wrong arithmetic. Only one is measuring the page.

## The eval, redesigned

`evals/extraction/`, run by hand, results committed —
[evals/README.md](../../evals/README.md).

**Typed assertions are not enough on their own, and the first draft had the PDF lesson backwards.**
`evals/pdf/README.md` says the *missing* golds make its figures a smoke test rather than a gate. The
lesson is to build adequate golds, not to find a cheaper substitute for them. Both arms can score
90% on a handful of sentence checks while differing materially.

The affordable form of a real gold, and the one to build: label **source DOM nodes** as
`main` / `boilerplate` / `metadata` / `excluded` against a frozen `raw.html` with a committed hash,
then derive the expected text from the labels deterministically. The human work is deciding
boundaries, not retyping an article. A fixture is immutable — if the publisher fixes a typo, that is
a new fixture version, never a quietly updated hash, which is the rule the PDF fixtures already
state for their bytes.

Scoring, three levels:

1. **Article-level acceptability** — is this safe to put on the shelf? One missing section fails it.
   This is the number a decision gets made on.
2. **Token-weighted precision and recall** against the derived gold — how bad, and in which
   direction.
3. **Typed structural checks** — tables, headings, lists, code, captions, footnotes, order,
   duplication, and **block-id stability across two runs**. Bag-of-words scoring cannot see any of
   these.

Not the block as the unit of gold: arms split and merge blocks differently and would be scored on
their own segmentation.

**The scorer gets tested against the broken state first** — the raw body, the first 20% of the
article, the article with the rail glued back on — and the run fails if those score well. A check
never seen failing is not evidence.

### Sample size, and the honest limit

- 30–50 genuinely hard articles to detect a large repair effect.
- **At least 100 ordinary articles** for the regression estimate, and this is the one an
  enriched hard set cannot substitute for. Zero regressions in 100 pages still leaves a ~3% upper
  bound at 95%.
- Several domains per failure family, not one handcrafted fixture each.
- Uncertainty clustered **by article** — a hundred assertions off one page are not a hundred
  observations.
- Every model arm: frozen fixture hash, prompt hash, exact model id and provider settings; every raw
  response saved; **at least three uncached repetitions per fixture**; mean, worst run and failure
  rate reported, not just the mean. Luna once dropped thirteen words from a PDF page it had already
  read correctly — which is why `src/pdf-read.ts` retries and only caches an answer that passed an
  independent check.
- A development set for prompt changes and a **locked** test set.

WCXB's article pages are CC-BY-4.0 and already carry main-content golds. Starting from a corpus
somebody else annotated is cheaper and less self-serving than annotating our own, and it makes the
number comparable to a published one.

## Build order

1. ~~The inventory harness~~ — **built**, tested, four bugs and all.
2. Add source-id provenance beside the text matcher, and report disagreements.
3. Fixtures: a frozen corpus, WCXB's article subset first, plus our own hard cases.
4. Rung 0 across the whole corpus. If un-hiding regresses nothing and fixes a real slice, it ships
   on its own and the rest of this waits.
5. Rung 2, if Greg wants a dependency weighed.
6. **Rung 3/4 against the residual, not against stock.** Both have been measured against stock
   Readability, which is the wrong denominator now that rung 0 exists. Re-run the model arm on
   pages already pre-cleaned: if the residual is a copyright line and a pull-quote, the answer to
   Greg's question is "a model helps, and the free fix already got there first".

## Decisions for Greg

- **Ship rung 0 now, on this evidence, or wait for the corpus?** It is four lines and it recovers a
  quarter of an article we already have. It is also the sort of change that could pull rubbish in on
  a page we have not looked at.
- **Is a second extractor allowed?** The published gap between Readability and trafilatura on
  article pages is larger than anything a repair pass has been shown to buy. It is a new dependency,
  so it is the sort of thing vision.md says to weigh rather than slip past.
- **Is annotating ~100 ordinary articles worth it** to get a regression number, or is the answer
  "ship the deterministic rungs, skip the model entirely"?
- **A model arm is now cheap enough to be a real option** — a fifth of a cent and 22 seconds on a
  657 KB page, because it reads an inventory rather than the article. That was the assumption this
  plan expected to fail, and it did not.

## See also

- [content-extraction.md](../project/content-extraction.md) — the stage this sits after
- [block-ids.md](../project/block-ids.md) — what churns if anything edits words
- [original-version/extraction.md](../project/original-version/extraction.md) — the fidelity harness
  and the "no silent fallback" rule
- [silent-success.md](../reusable/silent-success.md) — why a bad extraction is invisible today
- [readability-repair-pass-review-sol.md](readability-repair-pass-review-sol.md) — GPT Sol's review
  of the first draft, which is most of why this one is different
