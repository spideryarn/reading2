# The labels leave the blocking step

**Status: draft, under cross-family review.** Written 2026-09-06, out of
[260904d](260904d-deepen-fat-sections.md) § *Question 5*, where a measured run found that the thing
blowing the ingest deadline was not the feature that plan was building.

## The ask

Greg, 2026-09-06:

> Do we need the labels? What do we use them for? Can we generate them lazily? I'm willing to make
> product changes if it will dramatically simplify things.

and then, having heard the answer:

> Get input from GPT Sol re how best to make the labels lazy-loaded, then proceed autonomously.

So the decision is taken: **the nav labels stop being generated inside the blocking ingest
`hierarchy` step.** This plan is about *how*, not *whether*.

## The number this exists for

The `hierarchy` step has a **740 s effective claim deadline** (`LEASE_MS = 760_000` minus
`DEADLINE_MARGIN_MS = 20_000`, [`src/jobs.ts`](../../src/jobs.ts)), and
`DEFAULT_JOB_CONCURRENCY = 3`.

Three passes over Moby-Dick (2,569 blocks), 2026-09-05, from `byAiJob` in
`evals/results/deepen-5b-2026-09-05-e5aq8o9s/run.json` against the step durations in
[260904d § What stage 5b actually measured](260904d-deepen-fat-sections.md#stage-5b-results):

| job | `hierarchy` step | cascade: calls / $ / wall / concurrency | labels: calls / $ / wall / concurrency | labels % of wall | labels % of $ |
|---|---|---|---|---|---|
| `spya-wcb7kq` | 574.5 s | 9 / $1.691 / 112.3 s / 2.15× | 26 / $1.794 / 456.8 s / 2.07× | **79.5%** | 51.5% |
| `spya-avuffm` | 516.2 s | 8 / $0.736 / 40.6 s / 4.45× | 26 / $1.800 / 468.4 s / 2.07× | **90.7%** | 71.0% |
| `spya-fm4y2w` | **overran 740 s** | 9 / $0.821 / 53.2 s / 4.10× | 30 / $2.135 / 682.4 s / 1.79× | **≥92%** | 72.2% |

"Concurrency" is `summedDurationMs / wallClockMs`; `CONCURRENCY = 4` in
[`src/labels.ts`](../../src/labels.ts), starting at 1 and widened after the first batch returns.

**Labels dominate the step's wall clock.** On the third pass the label pass alone (682 s) would have
blown the deadline with the cascade contributing nothing. The deepening cascade — the feature 260904d
was built to add — made it worse only *indirectly*, by re-cutting the batch plan from 26 to 30.

⟨An earlier note in this session said the cascade ran at ~10× concurrency against labels' 2.3×. That
was wrong; the table above is recomputed from `run.json` and the cascade runs at 2.15–4.45×. The
labels-dominate-the-clock conclusion is unchanged and is if anything stronger, because the cascade
has less headroom than it appeared to.⟩

### And inside that, one call is the whole pass <a id="the-straggler"></a>

Measured 2026-09-06 from `spideryarn.ai_calls`, and it is consistent across all three passes:

| pass | label calls | the longest call | its input | the pass | the longest call's share |
|---|---|---|---|---|---|
| `spya-wcb7kq` | 26 | **373 s** | 173,582 tok | 457 s | **82%** |
| `spya-avuffm` | 26 | **390 s** | 173,589 tok | 468 s | **83%** |
| `spya-fm4y2w` | 30 | **602 s** | 173,583 tok | 682 s | **88%** |

The median label call is **21 s** and the next largest input is **30,889** tokens. Everything else
finishes inside 70 s, in parallel.

**The queue is not the problem, and this was measured rather than argued.** Replaying the recorded
per-call durations — first call alone for the cache warm-up, the rest at width *w* — reproduces the
actual wall clock exactly at width 4 (456 s vs 457, 468 vs 468, 682 vs 682), which says
`CONCURRENCY = 4` is being achieved. Widening it barely helps, because the pass is bounded by one
call rather than by queue width:

```
  width  1 -> 1221s      width  6 -> 654s
  width  2 ->  741s      width  8 -> 643s
  width  4 ->  682s      width 12 -> 637s     (job spya-fm4y2w)
```

**The cause is one node.** Walking the stored tree for `evaldeepen-e5aq8o9s-book-spya-yynkqz` (2,714
nodes), the lowest-level sections by child count are:

```
    973 children   n0831  "The Sermon's Lesson Restated"
    191 children   n2010  "Whale Skeleton and Fossil History"
     94 children   n2355  "Log, Life-Buoy, and the Rachel"
      6 sets in total exceed MAX_BATCH = 60
```

A sibling set is indivisible by design — *"Generate siblings together"*, the rule
[`labels.ts`](../../src/labels.ts):45 calls the one that decides whether this works — so `n0831`
becomes a single call asking for **973 labels** with ~173,000 input tokens, which is within 15% of
the model's context ceiling. The structure call had put **38% of Moby-Dick under one heading**.

**Lazy labelling does not remove this call; it moves it.** The 600 s and the ~$1.30 are still spent,
and the request still sits near the context ceiling. Greg chose that deliberately on 2026-09-06, over
the alternative of capping oversized sibling sets first — so the cap is **not** in this plan and the
sibling rule is untouched. What the cap would have bought, and what it would have cost, is in
[§ Alternatives](#alternatives-considered) so the next reader can weigh it rather than rediscover it.

Two things follow that are *not* this plan's business but should not be lost:

- **This is the case [260904d](260904d-deepen-fat-sections.md) exists to fix.** A fat section that
  gets subdivided stops being a 973-child sibling set. The cascade ran on pass 3 and did not reach
  `n0831` — worth knowing which bound stopped it.
- **973 sibling labels cannot be read as a set by any surface we have.** Outline mode draws at most
  8 (`PARAGRAPH_CAP`), the spine at most 5 (`MAX_CHILDREN`). Only the scrolled `Paragraphs` column
  shows them all, and never side by side.

## What a nav label is, so the trade is legible

`navLabel` is **a pointer to prose, never a substitute for it** — the distinction
[granularity-zoom.md](../project/granularity-zoom.md) draws against `gist`, which *is* substitutable
prose. A label's whole job, from [hierarchy.md](../project/hierarchy.md):

> A row's only job is to distinguish itself from its siblings.

It is navigation chrome. **It has no downstream server-side consumer** — not chat, search, glossary,
ideas, notes or diagrams. Surveyed 2026-09-06, it reaches a reader through exactly four surfaces:

| surface | on by default? | how many at once | what happens with no label |
|---|---|---|---|
| spine hover card ([`Spine.tsx`](../../src/web/Spine.tsx):912) | **yes**, but hover-only | ≤ 5 (`MAX_CHILDREN`) | falls to `title`, then `""`; empty rows are filtered out, so the row **disappears** |
| outline mode rung 5 ([`outline.ts`](../../src/web/outline.ts):118) | opt-in mode, current section only | ≤ 8 (`PARAGRAPH_CAP`) | `rowText` returns `null`, **row not drawn** |
| `Paragraphs` column ([`TableView.tsx`](../../src/web/TableView.tsx):985) | opt-in, never auto-fit | whole article in the DOM | `{navLabel ?? title}` → **a visible blank cell** |
| outline mode's leaf column | it *is* the view | whole article | as above |

Default mode is `plain` ([`src/modes.ts`](../../src/modes.ts):179) and draws none of it. Across the
eight articles in `data/`, 853 of 888 depth-3 nodes carry a label (~96%).

**The one visible regression risk is the blank cell**, and [`tree.ts`](../../src/web/tree.ts):161
already documents the hazard — "a run of forty blank leaf cells".

## Why this is safer than the plan that tried it before

[260831ah](260831ah-toc-on-request-and-the-tree-that-costs-nothing.md) proposed deferring the
**whole** `hierarchy`/`toc` step and publishing a free heading tree meanwhile. GPT Sol stopped it
with ten P0s and three P1s, and it is still marked *"STOPPED, being recut"*.

Almost all of those P0s were about the **tree** being absent or provisional: `checkProduct` rejecting
an undeclared product, publication refusing a revision without a real tree, the client not branching
on `tree.provisional`, geometry built from the tree unconditionally even in Plain mode, and a scroll
anchor that cannot survive a tree replacement.

**Deferring only the labels does not create any of those states.** The tree still lands inside the
blocking step, still publishes, still builds geometry, is never provisional. What is deferred is a
field that is *already legal to be absent* — [`tree-invariants.ts`](../../src/tree-invariants.ts):239
warns rather than fails, publish guards
([`pg-revisions.ts`](../../src/store/pg-revisions.ts):1376) count only `problems`, and
[hierarchy.md](../project/hierarchy.md) already says an unlabelled leaf is "tiled by the tree,
rendered verbatim in the reading view, addressable by its id — and invisible in Hierarchy. Nothing is
lost; nothing is duplicated."

Which of 260831ah's findings still bite the narrower change is the first question in the review.

## What stands in the way, found before the review

Five things, each verified against the code.

1. **The freshness stamp for the whole `hierarchy` step is read off `labels.json`.**
   [`artifacts.ts`](../../src/store/artifacts.ts) § `STAMP_SOURCE` has `hierarchy: "labels"`, because
   `tree.json` carries only `version` and `generator` while `labels.json` records `sourceHash` — "the
   only output of stage 4 that can answer *is this still about the current article*". Decoupling
   labels means moving that stamp, and that touches **every published article**.
2. **`mergeLabels` replaces rather than overlays** ([`labels.ts`](../../src/labels.ts):1360, argued at
   :1345). Handed a partial map it wipes every label not in it. Deliberate — mixing this run's labels
   with last week's is the trap it was written against — but it means a deferred or partial run
   cannot simply call it.
3. **Three hard gates live inside stage 4** and would fire on a deferred run:
   `assertEveryBlockLabelled`, `assertInsideCoverageFloor` (`COVERAGE_FLOOR = 0.95`) and
   `checkCoverage` ([`hierarchy.ts`](../../src/hierarchy.ts):636). They have to go somewhere.
4. **`planBatches` assumes the whole tree.** It walks from `tree.rootId`, sorts globally, and ends in
   `assertCoversEveryBlock`. Worse, `renderOutline` puts the **whole article's outline** into every
   batch's prompt *and* into `batchFingerprint`, so a per-section call would show the model less
   context and could never match a whole-tree run's checkpoints in either direction.
5. **Absence is overloaded.** The same missing field would mean "deliberately unlabelled — a
   pull-quote, a caption, a supplement" *and* "not written yet". [`hierarchy.ts`](../../src/hierarchy.ts):2090
   already names this: deferring the labels "needs a state that says 'still arriving' rather than an
   absence that says nothing."

## What we already have that this should reuse

- **`arc` left `DEFAULT_INGEST_STEPS` on 2026-08-29** ([260829f](260829f-defer-arc-and-rename-hierarchy.md)).
  That is the precedent for a step leaving the blocking list, and it is the one that made `useArc`
  possible.
- **[`useStepJob.ts`](../../src/web/useStepJob.ts) has nine callers.** `useArc` is the only one that
  fires on first open rather than on a button, and its docstring (:1–56) is the template: seeded from
  the article payload so the ordinary path costs no request; a **narrow read endpoint** rather than
  refetching `/api/article/:slug`; and mounted in `OwnedReader` so a visitor issues no POST.
- **`generateLabels` already takes a `CheckpointStore` and an `AbortSignal`**, resumes per batch on
  `batchFingerprint`, and reports "N of M sections labelled".
- **[`heading-tree.ts`](../../src/heading-tree.ts):157 already sets `navLabel` on heading leaves from
  the author's own text** — free, no model call. `parseLabels` overwrites heading labels from
  `block.text` today rather than trusting the model, so this is not a new idea, only an unused one.

## The shape being reviewed

Three candidates, and the review is asked to pick one:

- **(A) A separate automatic `labels` step**, out of `DEFAULT_INGEST_STEPS`, run right after
  `hierarchy` under its own claim and lease. The article is readable the moment the tree lands; the
  labels arrive a minute later without anyone asking. No UI trigger, no interactive paid-work state
  machine.
- **(B) True on-demand** — nothing until a reader opens outline mode or the `Paragraphs` column.
- **(C) Hybrid** — automatic for the opening batches, on demand beyond.

**(A) is the working assumption.** GPT Sol, on the prior round, was explicit: *"Do not start with
per-group UI-triggered lazy generation"*, because (B) buys duplicate-demand suppression, per-reader
billing policy, retries, partial storage and ~30 s of first-use latency for a saving that only
materialises if most readers never open those surfaces — which nobody has measured. Sol also
established the mechanical objection: `planBatches` packs several sibling sets per request, so
"one sibling group per demand" turns ~30 calls into hundreds, and the honest version of (B) is
"demand selects a preplanned batch", which is most of (A)'s machinery plus a state machine.

## Stages

*To be finalised against the review. Sketch:*

- **Stage 1 — the stamp.** Move `STAMP_SOURCE.hierarchy` off `labels.json` onto the tree or a
  hierarchy manifest, with the migration for existing articles. Nothing about labels changes. This is
  the piece most likely to be underestimated and it is independently shippable.
- **Stage 2 — the "still arriving" state.** A representation that distinguishes *deliberately
  unlabelled*, *not written yet* and *tried and failed*; the DTO field; the client rendering for
  each, including the blank-cell fix at `TableView.tsx:985`.
- **Stage 3 — the step split.** `labels` becomes its own step with its own budget; the three gates
  move; `mergeLabels`' contract is restated for a two-write world; the checkpoint rows are shown to
  survive.
- **Stage 4 — out of the default list, and the hook.** `labels` leaves `DEFAULT_INGEST_STEPS`;
  a `useLabels` on the `useArc` pattern.
- **Stage 5 — measure it.** The same book, ingested both ways, and the `hierarchy` step back under
  its deadline with margin.

## What this deliberately does not fix

Moving the label pass out of the blocking step **moves the cost rather than removing it**: 450–680 s
of wall clock and $1.79–$2.14 per book pass are still bought. Three separate questions, none of them
in this plan's scope unless the review says otherwise:

- **~~The effective-concurrency gap~~** — **settled, and it was not a gap.** The 2.07× figure is
  entirely the one straggler; the replay in [§ one call is the whole pass](#the-straggler) shows
  width 4 achieved exactly. Sol's caution — that an effective figure of 2.07 does not by itself prove
  width 4 is unused, since a serial first call, duration variance and a slow tail can produce it —
  was right, and this is what checking it found.
- **The 973-child sibling set**, which survives this plan intact and is still 82–88% of the label
  pass wherever it lands.
- **Mechanical/extractive labels**, which was Sol's own first recommendation and is the option that
  would delete this machinery rather than move it. Its blocker is that it is unmeasured: in a
  read-only count over four labelled fixtures an unmodified first sentence met the 6–20-word contract
  for only 43–59% of paragraphs. The eval already emits the materials for a blinded sibling test
  (`npm run eval:hierarchy -- … --shuffle`, [`evals/hierarchy-labels.ts`](../../evals/hierarchy-labels.ts):409).
- **A cheaper model for labels.**

## Alternatives considered

- **Raise `CONCURRENCY`.** One line. **Rejected on measurement, not on argument** — the replay in
  [§ one call is the whole pass](#the-straggler) shows width 4 is already achieved and width 12 saves
  under 7%, because the pass is bounded by a single 602-second call. This is the one alternative that
  is now closed rather than deferred.
- **Cap oversized sibling sets, and stop there.** Split a set past `MAX_BATCH` into chunks for the
  *label call only*, leaving the tree alone. Measured to be the largest single lever available: it
  removes 82–88% of the label pass's wall clock and takes the `hierarchy` step from 574 s to roughly
  200 s, which is the deadline overrun gone for one change in `planBatches`. **Greg chose lazy over
  this on 2026-09-06**, having been shown the numbers above. The reason to keep it written down is
  that it is cheap and still available: what it costs is that two paragraphs in the same section
  could get labels written by different calls, which contradicts
  [`labels.ts`](../../src/labels.ts):45 as currently stated — though at 973 siblings no surface we
  have compares the whole set, so the guarantee is already unobservable there. Anyone reviving it
  should rewrite the rule to state its bound rather than break it quietly.
- **Replace model labels with extractive ones.** GPT Sol's preferred answer to the prior question,
  and genuinely the option that removes the most machinery — model calls, concurrency tuning,
  prompt-cache warm-up, shortfall repair, displacement detection, checkpoints, coverage budgets and
  the label/tree freshness coupling all go. Not chosen **because Greg asked for lazy**, and because
  it is unproven; kept alive as the thing the blinded eval could still unlock.
- **Leave it and raise the deadline.** Rejected: `DEFAULT_JOB_CONCURRENCY = 3` means a step that is
  marginal alone is not marginal under load, and the lease exists to stop a wedged job holding a
  claim for ever.
