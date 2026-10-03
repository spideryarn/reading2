The approach is small and fits the existing code. I would keep the opacity changes and bounded cubic joins, but simplify the stretch ends and make the easing budget precise. No P0 or P1 established.

1. **F1 — P2, established: half-run budgets can overlap for neighbours joined by the tolerance.**

   [`SAME_STRETCH_PX`](/home/greg/code/spideryarn2/.claude/worktrees/fbbguwsn-spine-reading-chart-softer/src/web/spine-marks.ts:333) accepts both positive gaps and negative overlaps under one document pixel. The plan budgets easing from each run’s original height without specifying a shared-boundary adjustment.

   Concrete example: two 24px runs, starting at `0` and `23.75`, with different reaches and a cap above 12px. Each permits a 12px ease. Centre the join on the second run’s top and it starts at `11.75`, before the first run’s opening ease finishes at `12`. Centre it on the first run’s bottom and it instead overlaps the closing ease. The midpoint overlaps both.

   This establishes a hole in the proposed budgeting rule; whether actual DOM measurements produce this input remains unverified.

   **Smallest fix:** normalize each joined boundary once, then calculate easing budgets from those effective intervals. Test positive and negative fractional discrepancies, particularly when the eases consume the available run height. Require nondecreasing y, including controls.

2. **F2 — P2, reasoned: tapering every stretch to zero can work against “quieter,” and is extra scope.**

   The [endpoint proposal](/home/greg/code/spideryarn2/.claude/worktrees/fbbguwsn-spine-reading-chart-softer/docs/plans/261003o-spine-reading-chart-quieter-and-smoothed-into-a-curve.md:45) adds two strokes crossing almost the entire rail to every isolated read run.

   For a saturated run 2.5 rail pixels tall and approximately 11.5px wide, the two cap curves together have roughly 23px of centreline, compared with the existing 2.5px vertical edge. A non-scaling 1px stroke therefore occupies much of that small bump. Reducing stroke opacity to 0.7 does not necessarily make the resulting mark quieter; the visual consequence needs checking.

   **Simplest version:** smooth transitions between read runs, retaining today’s open edge at stretch starts and ends. This preserves an isolated block’s reach and removes the endpoint budgeting and left-edge clipping concerns. The fill can still follow the same curved boundary, with separate baseline closure commands. Consequently, prohibit horizontal *steps in the edge*, rather than every `H` in the area.

   If endpoint tapers stay, explicitly include isolated 1–3px runs in the visual comparison.

3. **F3 — P2, established: the cap needs a definition of half-span versus total length.**

   [The cap paragraph](/home/greg/code/spideryarn2/.claude/worktrees/fbbguwsn-spine-reading-chart-softer/docs/plans/261003o-spine-reading-chart-quieter-and-smoothed-into-a-curve.md:48) says an ease is capped at a hundredth of document height, “about 8px on an 800px rail.” If that budget applies on **each side** of a boundary, the complete transition spans 16 rail pixels.

   The proportional cap itself is sensible: it limits distortion on the displayed overview without requiring another DOM measurement. A fixed number of document pixels would vary substantially in displayed size between articles.

   **Smallest fix:** explicitly define `e` as the half-span, with a join from `boundary − e` to `boundary + e`, and acknowledge its maximum total span of 2% of rail height. If 8px was intended as the complete transition, halve the cap. Also qualify the “under two pixels” trade-off: it applies to short blocks, not long merged runs.

The remaining geometry checks out:

- Independent SVG scaling preserves cubic continuity and vertical endpoint tangents. A tall viewBox does not itself create a tall rendered surface; `non-scaling-stroke` keeps the line thickness constant. [SVG coordinate transforms and vector effects](https://www.w3.org/TR/SVG2/coords.html).
- Keeping control-point x values between the endpoint reaches prevents horizontal overshoot. Ordered control-point y values prevent backtracking.
- On exactly adjoining intervals, allocating at most half a run to each neighbouring ease avoids overlap. An isolated short run reaches its maximum only at its midpoint, but matching vertical tangents make that maximum smooth, rather than a sharp cusp.
- The existing right inset protects the stroke at `x = 16`. At `x = 0`, part of a centred stroke is clipped by `.spine`; the quote strip paints later, so the curve does not paint over it. That does not guarantee visual independence from translucent quotes.
- The existing-code description is accurate. There is one production caller, in `Spine.tsx`, and no production parser of the path strings. The tests assert exact strings and require updating.

I changed no files. During the review, another process rewrote the tests; the run then reported **11 passing and eight failing curve assertions against the existing step implementation**. That is not validation of the proposed implementation.

VERDICT: build after fixes