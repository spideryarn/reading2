# Structure's fourth level, staged: measured, and it passes

2026-11-01, for feedback `spya-pn7gvw` and Greg's answer `spya-xb2rrn` to
[q-k25zfg](../user-feedback/questions/q-k25zfg.md), queue item `qi-p6s6g6vw`. Plan
[261101d](../plans/261101d-structure-fourth-level-staged-second-call.md). Follows
[261101b](261101b-structure-fourth-level-two-wordings-measured.md), where the one-call approach
failed. Up: [investigations.md](../project/investigations.md).

**The question.** Does a second, staged pass — today's whole-document call untouched, then code
choosing sub-sections from the author's sub-headings and one scoped call writing their titles and
gists — make the fourth level reliably, without harming anything stage 1 made, at an acceptable
cost?

**The answer: yes, on every gate the plan set before the run.** Shipped on by default.

## How it was measured

[`evals/structure-fourth-level/`](../../evals/structure-fourth-level/staged-run.ts) `staged-*.ts`,
on 19 documents from the **local** database (this session could not read production; the local
copies include the report's paper): five from 261101b's set and fourteen fresh, among them a
1,025-block book on the whole-document path. **Paired**: each run makes stage 1 once per document
(production's request, parser, builder and re-ask), scores it as the control, then runs
production's own stage 2 on that very tree. Two runs (`staged-1`, `staged-2`), separated in time.
The planner was then corrected (below) and stage 2 re-run on the same two sets of stage-1 trees
(`staged-1b`, `staged-2b`), which is what the numbers below are. **$11.10 in all**, smoke runs, the
September wave's trial and the labels comparison ($2.26) included; about $0.80 more re-ran the
local paper for the browser check.

## What came back

| gate (set before the run) | result |
|---|---|
| 1. the paper: 2.4.1–2.4.6 under 2.4, nothing else in 2.4 but the opening; 2.5 left beside it | pass, both runs |
| 2. every new node depth 3 under a section, only leaves under it, starting where planned | pass, every article |
| 3. every stage-1 node kept with every field; the same leaves | pass, every article |
| 4. sections lost to a bad answer ≤ 1 in 20; no call failing whole | 0 of 128; 0 |
| 5. boundary recall ≥ 90% against an independent annotation | **98%** (199/204) on held-out trees; precision 98% (199/203) |
| 6. gists fit and are faithful, ≤ 1 in 20 flagged, blind reader | 40/40 fit; 38/40 faithful |
| 7. cost and time on articles stage 2 touches | median **+37%** structure cost, **+9 s**; worst +87%; book 52 s of a 700 s step |
| 7. labels step on both trees, four articles | +1% to +6% cost, same batches, 0 dropped |

- **12 of 19 documents got sub-sections**; the other seven have no author sub-headings below their
  sections, or only siblings stage 1 merged, and stage 2 costs them nothing.
- **Stage 1 swallowing a sibling is common** — 60 sections over the two runs were skipped as
  `holds-sibling-heading` (haslemere, synesthesia, gestalt, replication-crisis, parts of the book) —
  and stage 2 leaves every one exactly as stage 1 made it, never demoting the sibling.
- **Cost**: the paper $0.13 on top of stage 1's $0.22 (+59%), and $0.13 against structure and
  labels together ($0.64), about +21%. Llama 2 is the worst case (+87%, $0.23), the GDL book +77%.
- **The gate-6 sample was drawn from `staged-1`'s first planner**; the call and prompt did not change
  after it, only which sections are chosen. Of the two unfaithful gists, one (a clause about pointer
  networks) may be my sampler's doing: it cut that item's prose at 12,000 characters.
- **The four extra boundaries are all the book's PDF artefacts**: a bold definition and two repeated
  running headings tagged as headings, which the annotator folded away.

## What was decided along the way, and ruled out

- **September's deepening wave was tried first and dropped for articles.** On the paper it made the
  right tree at +180% cost; a batch was refused on all three draws because one of its three
  sections (the Bibliography) cannot be divided, throwing away two good answers; and its heading
  rule would demote swallowed siblings. Details in the plan.
- **`sourceHeading` cannot anchor the rule**: stage 1 never writes it on sections (0 times in the
  paper's answer). The section's own heading is found by position and by its siblings' level.
- **One correction after the first runs, judged on held-out annotations.** `staged-1`'s recall was
  74%: a section whose siblings start at mixed levels lost its own heading, and in a numbered
  document an unnumbered sub-topic heading at the section's own tag read as a sibling (most of the
  book). The fix was tuned on `staged-1`'s annotation (99%/98% there) and then judged on a second,
  independent annotation of `staged-2`'s different stage-1 trees: 98%/98%. The second annotator's
  brief mentioned mis-tagged sub-topic headings, which the first did not; that is a small leak of the
  fix's idea into its test, named here.
- **Not done: a long section with no sub-headings is not divided.** That is a later rollout with its
  own measurement (the plan's narrower first step, from Sol's first review).
- **No checkpoint** for stage 2 in v1: a retried step buys it again, about a tenth of stage 1.
