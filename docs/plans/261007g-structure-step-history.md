# Structure (the step): the history moved out of the reference doc

Moved verbatim from [docs/project/structure-step.md](../project/structure-step.md) on 2026-10-07, when the docs sweep
split over-long reference docs (docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § Three
questions, 3). The reference doc keeps what is true now; this keeps how it came to be. Nothing here is
current unless the reference doc says so. A Greg quote whose intent is still live stayed in the reference doc, so a story here
may skip over the words he said in the middle of it.

## The opening

(The step was called `hierarchy` until 2026-10-02, and this file was
`hierarchy.md` — [261002b](../plans/261002b-rename-the-hierarchy-step-to-structure-everywhere.md). The Hierarchy
*mode* that gave it that name — gist columns beside the prose — was removed on 2026-09-29, [260929d](../plans/260929d-remove-hierarchy-mode-and-heading-numbers.md).)

**The step was called `toc` until 2026-08-31**, and this file was `table-of-contents.md`. The
reading-view mode gave that name up on 2026-08-29 and the step deliberately kept it, which left one
concept wearing two names across the UI, the code and the database; Greg reversed that half so all
three say the same word —
[260831ak-rename-the-toc-step-to-hierarchy-everywhere.md](../plans/260831ak-rename-the-toc-step-to-hierarchy-everywhere.md).
The rows moved in [`drizzle/0041_rename_toc_step_to_hierarchy.sql`](../../drizzle/0041_rename_toc_step_to_hierarchy.sql);
the filesystem store's copies moved with a one-off script that was deleted on 2026-10-06, a month
after the store itself.

## The partition is derived, not checked

#### What this cost, and how we got here

Three shapes in three days, each one bought by an article somebody lost:

| | what it did | what it cost |
|---|---|---|
| until 2026-08-30 | refused any tiling fault | 4 structure calls in 13 |
| 2026-08-30 | snapped boundaries; bounded by size, then by count | an article with two slips |
| 2026-08-31 | derives the tiling; nothing about it refuses | a dropped section, rarely |

A paid calibration on 2026-08-30 threw on **4 of 13** structure calls, bimodal by kind: two partition
gaps and two `sourceHeading` claims outside their node's range. The structure call takes about 163
seconds and most of the stage's bill, so every refusal cost a reader a whole article after the money
was spent.

The first fix snapped a boundary shut, bounded at one block. That bound was fitted to four
observations that were **all off by one and all from HTML articles with headings** — the half of the
corpus where the model has the author's own structure to agree with. PDF ingest reached production
the same day, PDFs are headingless, and a 9-page arXiv paper lost its ToC to a gap of three.

So the size bound went, leaving a count: **one distinct boundary per answer**. That was fitted to the
same four observations, and the code comment said in as many words that a headingless PDF with two
independent slips would still lose its whole ToC. On 2026-08-31 one did — a Princeton memory paper,
one gap of a block at depth two and one overlap of two at depth one. Fixing that by raising the
number would have been the third guess at a threshold nobody had evidence for, so instead the
question it answered was removed. See
[260831ai-hierarchy-tiling-normalisation.md](../plans/260831ai-hierarchy-tiling-normalisation.md).

## A child's backwards range is a disagreement, not a lie

### Fatal range checks before 2026-09-04

**That list had a second entry — a range that runs backwards — until 2026-09-04.** The refusal was
explicit and tested, so it was a decision rather than an oversight; what was too broad was its
premise.

Measured, and it is why this changed: `smart-low` lost `gwern-scaling-long` to exactly this — one
block backwards at `root > child 7 > child 1` — in the run that moved production to `low`
([hierarchy-waves-real-corpus](../../evals/results/hierarchy-waves-real-corpus-2026-09-04.md)).

## The root was the last node whose range was believed

### The same fatal range checks before root clamping

**A root that misses the article's ends was on that list until 2026-09-04, and it should never have
been.**

It is not a corner. `openai-huggingface` ends on an empty paragraph, a stranded footnote the prompt
renders as `NOT-GISTABLE: (withheld)`, and a blog footer whose entire text is `No posts`; ending the
article before those three is what a careful reader would do, and **three independent arms — Sonnet
at `medium`, Sonnet at `low`, and glm-5.3-flash — each did, and each lost the article to the same
sentence** ([hierarchy-cheap-models](../../evals/results/hierarchy-cheap-models-2026-09-03.md),
recommendation 3).

## A section that starts one block below its own heading is snapped onto it

Measured on a 142-page
Kuhn paper, 2026-09-04, replaying the saved structure answer: of 82 non-root nodes, **24 started on
a heading block and 53 on the block immediately after one**, and 75 of the 82 named a
`sourceHeading`. Every unbacked claim reproduced was at that offset — the heading fell into the
previous section's tail, `planChildRanges` believed the start, and `buildTree` dropped the claim as
out of range. `droppedHeadings: 59` was counting that, and it read as the author's structure being
overruled. It was not.

**Measured, before and after, on the real answer** (no paid calls — the saved answer replayed through
`buildTree`; the plan has the table):

| | Kuhn, 142pp | noema × 43 saved trees |
|---|---|---|
| backed `sourceHeading` | 24 → **74** of 75 claimed | unchanged |
| `droppedHeadings` | 59 → **9** | 0 → 0 |
| headings starting a node | 21 → **67** of 254 | unchanged |
| `repairedBlocks` | 40 → 86 | 0 → 0 |
| `checkTree` problems | 0 → 0 | 0 → 0 |

`repairedBlocks` **rises**, and that is the repair being honest rather than a regression: 46 headings
really did change hands. The no-op half is the half that matters — 43 saved trees over noema and
`openai-huggingface` come out byte-identical, because the model already put those starts on the
headings.

### Keeping cascade normalisation in step with buildTree

For a while the snap *was* something left for it to mend, and that mattered from wave 2
on: a scoped call would be shown a slice `planChildRanges` had derived while its own answer was
derived by a rule with no snap in it.

## The apostrophe that failed eleven headings

The first article to reach this check with apostrophes in its headings — the Anthropic constitution,
36 of them — failed on **eleven**, and every one of the eleven was an apostrophe. None was a heading
the model had actually got wrong, which is the only thing the check exists to catch.

## Why they are two steps

### Live label failures and the sweep’s successor-job check before 2026-10-07

Until 2026-10-07
  only the sweep asked, so a live failure wrote `failed` over a successor still queued
  ([261007e](../plans/261007e-seventh-sweep-pipeline-tidy-one-successor-rule-and-the-dead-filesystem-session.md)).

### The label-batch floor and tail merge

Measured before
it landed: 4 of 31 batches across the fourteen articles on Greg's machine were under the floor, on
three of them; afterwards, 1 of 28, and that one is a ten-block article which has no neighbour to
merge into.

### The two effort and coverage lines in [the reference doc](../project/structure-step.md#two-steps)

*(Both lines said the opposite of the code from 2026-08-30 until 2026-08-31, which is the drift
CLAUDE.md warns about: a doc that restates a constant is a second copy that nothing keeps in step.)*

## Three artefacts, and what survives a failed run

### generateStructure’s three separate filesystem writes

It used to write the three files itself, in a fixed order with the tree last. That ordering was
about three *separate* writes: `writeFile` truncates before it has anything to put there, and
*existence* is what [`src/pipeline.ts`](../../src/pipeline.ts) reads as "this step is done", so a
kill mid-write left a present, truncated tree that a retry skipped. One write for all three removes
both halves of that. **The ordering survived in `npm run structure`'s own `main()` until 2026-09-05,
and now survives nowhere**: that command goes through the queue, so there are no three files and no
order to get right.

## The budget

### The estimated block-count boundary

It used to be pinned in the tests at exactly 1,976
  blocks, on the argument that the boundary *is* the feature. The number itself turned out to be
  wrong by a factor: `estimateStructureTokens` charged one node per four blocks, which is a rate
  fitted to three trees of 19, 141 and 360 blocks, and re-measured over 32 trees from 10 to 2,025
  blocks it over-predicts monotonically with length — 1.35× → 2.2× → 3.8× → 4.0× → **8.21×**. The
  8.21× is the paper it refused, which a real call then answered in 10,996 tokens of a 128,000
  budget.

### Trailing material mistaken for truncation after the oversized-estimate and truncated-answer failures

**A third failure used to hide behind the second, and it looked identical.** On 2026-09-03 this step
died on `dhammatalks.org/suttas/MN/MN10.html` saying *"it breaks at position 5409 of 13547
characters"* — which reads like a truncated answer and was not one, since `ranOut` had already ruled
truncation out. The likeliest reading is a whole tree with another 8,138 characters written after it,
though nothing kept the response, so that stays a candidate rather than a fact.

## The fallback: a tree from the document's own headings

### The labels-could-not-ask fallback on a model’s tree

From
  2026-10-05 to 2026-10-06 it did (`labels-could-not-ask`), and the reader lost every gist.

## Longer pieces

### The proposed structure call for articles too long for one answer

The shape first
proposed for it, from GPT-5.6-sol's review and written up in
[260826h-toc-scaling.md § D](../plans/260826h-toc-scaling.md): build the authored-heading skeleton mechanically;
make bounded, navigational section cards in parallel; run one global pass over the ordered cards to
assign top-level boundaries and sibling titles; then generate each coarse subtree in parallel with
the whole global outline in front of it.

Note what is *no longer* on that list: the labels. They are already batched, and they are the half
that scaled worst.

### The copied live prompt

A copy was, for
a fortnight, and it went stale without a word: it still said *"Do not write a `gist` field — that is
a later stage"* long after the gists moved back into this call, and it had never gained *"Go 3
levels deep"*.

