The revision is much stronger, but one original blocker remains: the synthetic workloads that protect against false deferral still have no decision-grade timing path.

## Findings

### F4 — P1 — the decisive cohorts are constructed but never timed by the decisive instrument

The plan says the prop-transition bench never supplies milliseconds ([plan § bench](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:178)). It then defines four synthetic cohorts “before [they are] timed” ([plan § cohorts](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:194)), but the production wall-clock section only names the two real database articles, with seeding a longer one optional ([plan § wall clock](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:219)).

Therefore:

- The synthetic dense-glossary and overlap cohorts receive counts but no Chrome timing.
- The 551-block article remains the largest decision workload despite only 177 raw marks.
- The plan can still defer A7 without ever timing the workload F4 was meant to protect.

This is the same false-defer hole as round 1, so it remains F4 rather than receiving a new ID.

Smallest correction: make the expensive cohort conditional. Measure the real 551-block article first. If it crosses a threshold, proceed immediately. Only if it would otherwise defer, seed one long local article with dense, overlapping marks and time it in the production browser. That removes the need for a general-purpose clone/remapping framework unless the real measurement actually demands one.

### F3 — P2 — the units are better, but the decision is not fully precommitted

The thresholds now use sensible units, but two problems remain in [the decision rule](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:111):

- The plan reports min/median/max but never says which statistic determines optimise versus defer.
- The 30% clause is mathematically redundant. If total latency exceeds 50ms, 30% is over 15ms, which has already crossed the absolute 8ms clause.

Specify warmed repetitions and the statistic applied—probably the median for discrete gestures, with conspicuous maxima investigated rather than silently ignored. Cut the 30% clause.

### F7 — P2 — fresh hit arrays still defeat the stated equality key

The plan correctly notices that `hitMarks` supplies fresh maps and arrays, but then proposes keying reuse on those source arrays ([plan § Stage 2.3](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:261)). That does not solve the problem it identifies.

Today [`hitMarks()`](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/search-hits.ts:1135) rebuilds every per-block array and embeds `open` into a newly created mark whenever `openKey` changes. Consequently, an identity key still invalidates every hit-bearing block.

The plan must explicitly choose one:

- Make base hit-mark arrays independent of `openKey`, then apply the selected flag per relevant block; or
- Reconcile new hit arrays against the previous arrays and preserve unchanged identities.

The same separation is implied for comments/chats, but it needs to be explicit for hits.

### F10 — P2 — accumulated timers cannot produce “worst single delta”

The proposed instrument records accumulated timers ([plan § instrument](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:160)), while the rule asks for the worst individual streamed delta and annotation milliseconds per second.

Totals alone cannot recover either:

- The streaming interval is undefined—first received delta to last received delta, final state update, or final painted frame.
- React may batch several received deltas into one render.
- Separate maximum values for `marksByBlock` and `proseHtml` may come from different renders.

Record per-render annotation samples, or at minimum `{total, invocations, max}` around one combined annotation-computation boundary. Define duty cycle as total annotation time divided by wall time from the first state-changing delta through the final painted frame.

### F11 — P2 — leaf timers perturb the outer measurement they are meant to explain

The decision timer surrounds the memo bodies, but the plan simultaneously adds two `performance.now()` calls to every `renderedText`, `resolveMark`, `annotateHtml`, and `addZoomHandles` invocation. `proseHtml` currently calls `addZoomHandles` once per block ([TableView](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/TableView.tsx:568)), so the 551-block run adds over a thousand clock reads inside the decision interval before counting the other leaves.

That overhead can matter against an 8ms threshold. Use:

- Outer memo timers for the decision run.
- Cheap leaf counters during that run.
- Leaf timers only in a separate diagnostic run, or validate their overhead with a no-op control.

### F12 — P2 — Stage 3 does not require proof that the optimisation improved production latency

[Stage 3](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:278) verifies behavior and says to append “the result,” but does not explicitly rerun the same production gestures and compare attributable and end-to-end timings with Stage 1.

Require the identical built-app workload after Stage 2. Otherwise the implementation can satisfy the count regressions while producing no material browser improvement.

### F13 — P3 — the development measurement is not literally an upper bound

StrictMode and unbundled modules make the development result likely slower, but they do not establish a mathematical upper bound on production scheduling and browser work. Call it a “development-only baseline expected to be inflated”; the production result correctly remains authoritative.

## Prior-finding ledger

- F1: settled. Semantic anchor inputs, content invalidation, preserved grouped/per-block identities, and the body-only zero-work acceptance are substantive.
- F2: settled. The two measurement boundaries now answer different questions correctly. F10 and F11 concern the instrument’s sample shape and observer effect, not the original attribution-boundary defect.
- F3: partially settled; remains open as described above.
- F4: not settled; the workloads and production timing remain disconnected.
- F5: settled.
- F6: settled.
- F7: not settled; the equality contract does not yet stabilize hit arrays.
- F8: settled. The regression includes changed forms, changed occurrence blocks, overlap preservation, and affected-node identity.
- F9: settled.

## What the memo timer does and does not attribute

The current annotation primitives are synchronous. Detached-element `innerHTML` parsing, `TreeWalker` traversal, serialization, array construction, block iteration, and `addZoomHandles` all occur inside the memo stack and will be counted.

It excludes:

- React reconciliation and commit work below the memo.
- The live DOM’s `innerHTML` assignment and parsing.
- MutationObserver delivery.
- Style, layout, paint, and subsequent geometry measurement.

That is acceptable if the number is consistently called “annotation computation.” The companion end-to-end measurement captures the excluded consequences. Timing the whole `proseHtml` loop slightly over-attributes figure-handle scanning to annotation, but that work is causally rerun by annotation invalidation and Stage 2 would avoid it, so it belongs in A7’s preventable cost.

## Cheaper decisive first experiment

The new baseline should make attribution the first and smallest Stage 1 action:

1. Add only inclusive timers around `marksByBlock` and `proseHtml`.
2. Run the production build on the 551-block article.
3. Measure a glossary press, then comment open/close.

The glossary press is especially clean: `openTerm` reruns `proseHtml` across the article but does not rerun `marksByBlock` or `termMarksByBlock` ([current dependencies](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/TableView.tsx:613)). If its memo timer is near the 927ms total, A7 is established immediately. If it is small, A7 is largely exonerated and the gap points toward commit/layout/geometry; the comment probe then separately checks anchor resolution.

Only after those measurements cross the threshold should the plan build the permanent bench, synthetic workloads, shared cache, and full correctness matrix.

No files were changed.

**Verdict: do not proceed.** F4 remains an established P1 false-deferral path; correct that production-timing connection before Stage 1.