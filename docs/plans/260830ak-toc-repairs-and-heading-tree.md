# Two repairs in stage 4, and the heading tree as a module

**Landed 2026-08-30.** Greg's go-ahead, after
[the research](../research/260830a-opening-an-article-before-the-toc.md): *"re 'build the two repairs' and
'the heading tree'. Proceed, perhaps with advice from GPT Sol, and definitely with review from GPT
Sol."*

The review is [260830ak-toc-repairs-and-heading-tree-review-sol.md](260830ak-toc-repairs-and-heading-tree-review-sol.md),
against [the prompt](260830ak-toc-repairs-and-heading-tree-review-prompt.md). Three of its findings changed
the code; a fourth changed a doc.

## What was measured first

A paid calibration threw on **4 of 13** structure calls (31%), bimodal by kind rather than spread by
size: two partition gaps of exactly one block, two `sourceHeading` claims outside their node's
range. Every tiling failure ever recorded here is off by one block. The structure call is ~163s and
88% of the stage's wall clock, so a refusal costs the reader the article.

## What was built

**R2 — an off-by-one partition is snapped shut, not refused.** In
[`src/toc.ts`](../../src/toc.ts), on the model's proposal *before* any node is built — repairing
after the walk would mean growing a leaf to match and splicing it in, which is how you get two
leaves for one block. Repairing the proposal also makes the cascade fall out for free: moving a
node's start moves its first child's start, and a repair that stopped at one level would trade a
broken partition at depth 1 for a broken one at depth 2.

**R3 — a `sourceHeading` no heading in the node's range backs up is dropped.** It is provenance, not
structure: the only consumer is the `§` badge meaning "the author wrote this heading". The repair
reads the same `sameHeading` predicate `checkTree` uses, over the node's own range, so anything it
keeps the invariant keeps — a repair, not a second opinion.

**B1 — the heading tree as a product module.** [`src/heading-tree.ts`](../../src/heading-tree.ts),
moved out of `evals/toc-structure/`, with a tree-level `provisional: "headings"` marker, a narrow
`checkTree` exemption, and a named crossing at the public boundary. One implementation, two jobs:
the eval's arm zero and the product's free tree. See
[table-of-contents.md § the tree the author's headings give us for free](../project/table-of-contents.md#heading-tree).

## What the review changed

1. **The bound moved from per boundary to per answer.** As written, R2 allowed unlimited independent
   one-block repairs — a five-deep chain, or four separate slips, each defensible alone, together
   walking a misaligned tree past the check one block at a time. The budget is now **one distinct
   boundary coordinate per answer**; a cascade of the same boundary shares a coordinate and stays
   free. Raising it wants a measured distribution, and thirteen calls is not one.

2. **The eval had to be told, and this is the lesson worth keeping.** R2 and R3 mend exactly the two
   families whose throw rate `evals/toc-structure` exists to measure. From the moment they landed,
   an arm making either mistake scored `outcome: "ok"` with nothing recorded, and
   `sourceHeadingValid` became necessarily 1 for every paid arm. **A repair inside the code under
   measurement silently redefines the measurement, and nothing fails when it does.** Each result now
   carries a `repaired` block, the runner prints it, and `evals/README.md` says to read the two
   together.

3. **A malformed claim is counted too.** A `sourceHeading` that was a number, or nothing but spaces,
   was discarded without being counted — so the one case that says the model's output has gone
   strange was the one case nobody was told about.

4. Sol also noticed that a child ending *beyond* its parent was reported as stopping `-1 block(s)
   before` it ends. Fixed.

## Where the counts go, and why that is the feature

`buildTree` fills in a `BuildReport`; `generateToc` counts it into `TocRun`; the CLI prints a
`Repaired:` line **every run, including at zero**; `src/pipeline.ts` logs both numbers. That is the
same discipline `strandedSupplement` follows, for the same reason: a repair nobody is told about is
indistinguishable from the bug it repaired ([silent-success.md](../reusable/silent-success.md)). If
these numbers climb, the prompt has drifted and the repairs are hiding it.

There is no aggregation or alert yet — Sol's point, and it is right. Persisting the rate and
alerting when it departs from the calibration baseline is the next thing, not a threshold invented
from thirteen calls.

## What was deliberately not built

**The fallback wiring**, and the reason is a good one. A heading tree used only when the structure
call fails was the obvious next step this morning; it is not now, because **R2 and R3 recover every
structure failure we have measured**, so the failure it existed to catch is largely gone. It would
still need most of the provisional-state machinery, would still wait out the 163-second call before
helping anyone, and would leave arc, ideas, sketch and similarity permanently unavailable on any
article that took it.

So nothing yet produces a provisional tree for a reader. What remains of B, in order: **gate the
paid work a tree triggers** (`useArc` auto-starts on open; `similar` buys embeddings on a mode
toggle and keys its cache on `structureHash`), **build the replacement seam**, then **publish
provisionally and replace atomically**. `labels.json` records `structureHash` too, so a tree swap
needs a matching label swap or an explicit "labels arriving" state.

## Verification

`npm test` and `npm run typecheck`. The suite has failures that are not this work's — peers' fixture
uuid collisions (`tests/fixture-ids.test.ts` names them), a stale `wordCount` scalar for
`scaling-hypothesis` in the local database, and four broken links in a peer's
`docs/plans/260830x-title-normalisation-review7-prompt.md`. The typecheck errors in
`evals/toc-structure/floor-combined.mts` and `src/store/pg.ts` predate this work.

One flake **was** this work's and is fixed: `tests/toc-write-guard.test.ts` imported `src/toc.ts`
inside its first test, so growing that module charged the *control* with the transform and tipped it
over the 5-second default under parallel load. The import moved to `beforeAll`. A control that goes
red for a reason unrelated to what it controls is the most misleading flake there is.
