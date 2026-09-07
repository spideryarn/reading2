Verdict: **request changes; refuse Stage 3 authorization.** The raw data probably supports “optimise,” but the instrument has not yet earned that verdict under the precommitted rules.

## Findings

1. **F10 — P1 — established: the required ownership/counterfactual gate was not run.**

   - **(a)** The plan requires a Chrome trace identifying the dirtying write and says Stage 3 is authorised only after a trace or counterfactual shows that removing the duplicate scan removes work ([plan](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md:254)). The harness only calls `Performance.getMetrics`; it never starts tracing ([measure-geometry.ts](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/scripts/measure-geometry.ts:412)). Aggregate `LayoutCount=56` versus 46 attempted writes cannot identify ownership. Consequently, neither “the pilot’s cost is the reads themselves” nor “F8 is now established” follows. The result itself admits that the counterfactual remains until Stage 4, after Stage 3 has already been authorised.
   - **(b)** Run the perf-only counterfactual or a causally useful Chrome trace before Stage 3. Until then, retain the timing result but restore `ContextPanel` to “candidate” and mark Stage 3 unauthorised.

2. **F11 — P1 — established: clause 1 is applied to repetition averages mislabeled as frame p50/p95.**

   - **(a)** `pilotMsPerSamplingFrame` computes `(total readingPosition ms + total columnContext ms) / max(calls)`—a mean ([measure-geometry.ts](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/scripts/measure-geometry.ts:340)). The report then takes p50/p95 across five such repetition means and labels them “per SCROLL frame” ([measure-geometry.ts](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/scripts/measure-geometry.ts:1440)). That is not the precommitted distribution of frame costs. Provisional index-pairing of the raw vectors gives materially different ranges:

     - `m1-kuhn`: p50 8.70–10.90, p95 13.40–17.00
     - `evaldeepen`: p50 7.30–15.00, p95 10.10–32.30
     - control: p50 0.90–1.40, p95 3.90–4.40

     The heavy articles still cross clause 1, but the published statistics are wrong, especially the sparse tail F6 was intended to preserve.
   - **(b)** Tag each parent sample with the rAF timestamp/frame identity, sum the two non-overlapping sites per frame, and take percentiles over that vector. Re-run or label any reconstruction from the existing untagged arrays provisional.

3. **F12 — P1 — established: the population gate can accept a page whose section tree did not render, or the wrong nonempty reading page.**

   - **(a)** `populationVerdict` refuses only zero blocks/nodes, missing instrumentation, or mode `"off"` ([measure-geometry.ts](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/scripts/measure-geometry.ts:607)). With prose rows but zero sections, `readingPosition` still records calls and its one `scrollY` read; no gist headers means the control deliberately does not require `columnContext`. The harness can therefore report a cheap heavy article whose hierarchy failed. It also records neither the final pathname nor a loaded article identity, so a redirect to another valid article passes. The supplied runs themselves do have the expected population fingerprints, so this did not affect these particular logs.
   - **(b)** Assert final pathname/article identity and expose an independent resolved-section count. For these fixed workloads, also assert their expected depth, section range, and desktop gist-column presence before timing.

4. **F13 — P1 — established: the harness does not enforce the pinned-distance or five-warmed-sample contract.**

   - **(a)** `scrollVerdict` accepts anything at least 80% of the requested distance, so `scrollVerdict(2400, 3000)` passes ([measure-geometry.ts](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/scripts/measure-geometry.ts:693)). `report` publishes statistics whenever even one warmed sample remains, despite the rule requiring five ([measure-geometry.ts](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/scripts/measure-geometry.ts:1323)). The supplied decision logs include warmed 2,900px/2,976px repetitions; rejecting them leaves only four valid repetitions in some runs and three in `evaldeepen` session 2/middle.
   - **(b)** Use a defensible near-exact tolerance—at most rounding, not 20%—and refuse to quote until five warmed, valid repetitions exist. Re-run affected sessions.

5. **F14 — P1 — established: instrumentation changes `watchBarVisibility` behaviour at the quiet-window boundary.**

   - **(a)** With the probe on, `parentGeometryClock()` consumes a new `performance.now()` immediately before the existing `performance.now() < quietUntil` decision ([scroll.ts](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/src/web/scroll.ts:338)). In a `/tmp` test with `quietUntil=250`, clock values `249` then `251` hid the bar with `"counts"` enabled; the same input with the probe off remained quiet. That also changes whether a layout-affecting write occurs.
   - **(b)** Read the clock once and reuse that value for both the original quiet-window decision and the parent timer start.

6. **F15 — P2 — established: the decisive call site remains mutation-invisible.**

   - **(a)** The unmodified suite passed 12/12. Changing covered `measureRow` from `rows.length` to `rows.length + 1` failed exactly. In contrast, changing `readingPosition`’s read count to `1`, and separately moving its timer start immediately before `noteGeometry`, both left all 12 tests green. The browser control would also pass because it requires calls, not correct timing. This confirms the documented three-site gap matters most at the site authorising the work.
   - **(b)** Extract the `readingPosition` measurement body behind a small driveable seam and test emitted reads and timer placement against spied geometry accessors. `ContextPanel` and `DiagramPanel` can follow as diagnostic coverage.

7. **F16 — P2 — reasoned: “optimise” does not justify doing A8 next.**

   - **(a)** Clause 2 genuinely fails: the pilot is only 2–6% of approximately 13.9 seconds of main-thread work. `contextPanelPlace` alone reports 743ms versus roughly 339ms for the pilot, although F10 means its cause is not yet established.
   - **(b)** Keep the absolute-budget verdict as “eligible for optimisation,” but investigate the dominant `ContextPanel`/main-thread cost first, then rerun A8 before investing in the shared service. Do not retroactively loosen the 4/8ms rule.

8. **F17 — P3 — established: “four orders of magnitude” is arithmetically wrong.**

   - **(a)** The stated figures give `743/272 ≈ 2.73ms/read` versus `339/74,430 ≈ 0.00455ms/read`: about 600×, or 2.8 orders of magnitude, not four ([plan](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md:593)).
   - **(b)** Say “roughly 600×” and avoid treating that ratio as proof of reflow ownership.

All ten current read constants themselves check out, including the 9/8 `ContextPanel` branches and the exclusive zero at `diagramReaderRow`; I found no parent/leaf read double-counting. Clause 2 does not fire, while clause 3 does fire—the mode-switch median pilot total is about 27.1ms, although the write-up cites its p95 instead. No repository files were changed.