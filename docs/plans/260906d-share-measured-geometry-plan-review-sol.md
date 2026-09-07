Verdict: **request changes / refuse approval**. Established P1s F1, F2, and F3 block the plan as written. I reviewed the final observed candidate contents with SHA-256 `e137b05a…e5b9aee`; no files were changed.

### F1 — P1 — established: the decisive timer can attribute layout to the wrong cause

(a) The plan calls time inside the samplers “geometry’s attributable share” and makes it decisive ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md:220)). But this repository already records the exact failure: forced layout was charged to whichever function happened to perform the first read after another subsystem dirtied the DOM; moving that read would move the apparent cost without removing it ([performance.md](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/docs/project/performance.md:726)).

That enables both wrong verdicts:

- false optimise: a section sampler inherits layout caused by a React/CSS write, although sharing its scan would not remove the layout needed for paint;
- false defer: an earlier uninstrumented read pays the flush, leaving both candidate scans looking cheap.

Inclusive self-timers observe the stall, but do not establish ownership or preventability.

(b) Replace the “two numbers” paragraph and amend Stage 1 instrumentation with:

> Every gesture reports end-to-end time, non-overlapping sampler JavaScript time, and browser `Layout`/`RecalculateStyle` events from a Chrome performance trace. A synchronous layout is reported under the read that triggered it, but is not called attributable to that reader: the trace must also identify the dirtying write. Stage 3 is authorised only where the trace or a perf-only counterfactual demonstrates that removing or ordering the duplicated section-top scan removes browser work while destinations remain identical. Inclusive parent and leaf buckets are never summed.

### F2 — P1 — established: required delayed image/font/viewport tests are absent

(a) The authoritative checklist explicitly requires testing delayed image, font, and viewport changes ([parent checklist](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/docs/plans/260905e-main-app-architecture-review.md:701)). Stage 3 names those invalidations, but Stage 4 only requires an equal-total-height row mutation, hidden/visible transitions, layout/article changes, and interruption ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md:389)). An implementation can therefore satisfy the plan while never proving three checklist cases.

(b) Add this exact Stage 4 item:

> Drive the real measurement seam through a delayed article-image load, `onFontsChanged`, and viewport resize/movement, as separate tests. In each case move section rows after the initial snapshot, assert that the URL and fisheye destinations match a fresh DOM measurement, count exactly the expected remeasurement, and prove every listener and observer is removed on unmount and article replacement.

### F3 — P1 — established: Stage 2 does not honestly run “whichever way”

(a) The governing instruction says that if the reads are immaterial, close the stage as deferred ([parent checklist](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/docs/plans/260905e-main-app-architecture-review.md:699)). The plan instead always proceeds to production changes and says they add no machinery ([candidate](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/docs/plans/260906d-share-measured-geometry-after-profiling-scroll-and-layout-reads.md:350)).

The two local hoists are mechanical, but caching `safeAreaInsets` is not: it changes when the value is observed and necessarily introduces cache invalidation. The plan itself acknowledges that mobile toolbar movement may invalidate it during scrolling. This directly contradicts both “nothing built unless the profile convicts” and “adds nothing to maintain.”

(b) Replace the Stage 2 opening and cache step with:

> Stage 2 is reached only if Stage 1 optimises. If Stage 1 defers, record the duplicate-call counts and close the job without production changes. Steps 1 and 2 are local hoists. Safe-area caching is a separate conditional substage, reached only if the post-hoist profile independently convicts `safeAreaInsets`; it must first establish and test every invalidation event, and is dropped if scroll itself must invalidate it.

### F4 — P1 — reasoned: unrelated buckets can authorise the wrong pilot

(a) The decision combines every instrumented sampler, including `DiagramPanel`’s all-block scan, `ContextPanel.place`, `Spine`, and bar work. Stage 3 changes only the duplicated section-top scans in `useReadingPosition` and `useColumnContext`.

Thus `DiagramPanel` or `ContextPanel` can cross the threshold while both pilot consumers are cheap, causing an observer service to be built that does not touch the cost that convicted. The source confirms that `useReaderRow` measures every block each scroll frame ([DiagramPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/src/web/DiagramPanel.tsx:580)).

(b) Replace “across the instrumented geometry samplers combined” with:

> Stage 1 records two verdicts. The A8 pilot verdict uses only the non-overlapping cost of the duplicated section-top scans in `useReadingPosition` and `useColumnContext` while both are active. Every other site is diagnostic and cannot authorise Stage 3. If another site convicts, record a separately scoped follow-up; A8 still defers unless its two-consumer duplication convicts.

Including `DiagramPanel` in the census is useful, not scope creep; allowing it to decide this pilot is the error.

### F5 — P1 — reasoned: “selected result” is too narrow for URL correctness

(a) Distinct focus lines and fresh jump reads are stated correctly. The remaining hole is notification semantics. `positionToWrite` depends on more than the active section: `atTop`, the held fine-grained block, the current section partition, and `glideTarget()` ([position.ts](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/src/web/position.ts:170)).

If “selected result” means active section ID, the service can suppress the exact notification needed when:

- a real gesture cancels a glide without crossing another section;
- the reader reaches the article top while still in the first section;
- a new layout changes which section contains the held paragraph without changing the currently selected section ID.

The current hook evaluates those inputs on each scheduled scroll sample ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/src/web/App.tsx:1546)).

(b) Replace Stage 3 item 2 with:

> `useReadingPosition` and `useColumnContext` share only the measured section tops. Each evaluates its complete consumer decision independently on every scroll sample and explicit invalidation. The URL selector receives current `scrollY`, sticky line, `glideTarget()`, held URL value, and section generation; glide cancellation schedules it even when the active section is unchanged. The fisheye independently selects against its 40% focus line. Suppress only equal final consumer outputs, not equal active-section indices.

### F6 — P1 — reasoned: the decision rule can confidently miss visible jank

(a) Median sampler time structurally ignores sparse bad frames. For example, one 20ms forced layout every fifth frame yields a comfortable median; it may also produce zero `longtask` entries because those start at 50ms, a limitation already documented in [`perf.ts`](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/src/web/perf.ts:1). Dropped frames are reported but never affect the verdict. The scroll workload also lacks a fixed distance, delta cadence, duration, and mode matrix, so repetitions need not be comparable.

The fixed 4ms/8ms promises are not derived from the measured refresh or workload baseline.

(b) Replace the three numeric clauses with:

> Before revealing the geometry buckets, record the actual refresh cadence and an uninstrumented fixed-scroll baseline on each viewport, then amend this document with the numeric decision budgets. The harness fixes scroll distance, delta sequence, cadence, start position, enabled mode, and settling frames. Report p50, p95 and maximum frame intervals and sampler times. A run with excess missed-refresh intervals or a conspicuous maximum is investigated and may not defer merely because its median and `longtask` count are low. Until the baseline-derived budgets and fixed workload are recorded, Stage 1 may conclude only “inconclusive,” never optimise or defer.

### F7 — P2 — reasoned: the available heavy shape control is not used

(a) The corpus survey says `m1-kuhn` is unusually wide and shallow, while `evaldeepen` allegedly has 1,166 sections over a deeper 2,569-block tree. Yet the plan measures only `m1-kuhn` and a 51-section control. A verdict produced only by the nearly one-section-per-two-block tree is explicitly called weaker, but the rule treats it identically.

I could verify the source-side counting/cadence premises, but not these database-derived corpus counts.

(b) Replace the workload instruction with:

> Measure both surveyed heavy articles—`m1-kuhn` as the wide/shallow case and `evaldeepen` as the deeper shape control—plus `replication-crisis` as the ordinary-size control. Defer requires both heavy shapes below budget. A conviction on only one heavy shape is labelled workload-specific and may authorise only the two-consumer pilot, whose retention still depends on Stage 4’s payback rule.

### F8 — P2 — reasoned: `ContextPanel`’s forced-reflow count is asserted before measurement

(a) Source proves that `place` reads geometry and then writes `scrollTop` ([ContextPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a8-shared-geometry/src/web/ContextPanel.tsx:151)). It does not prove that each panel’s `scrollTop` write dirties layout or that the next panel forces another reflow. The plan nevertheless states “a forced reflow per panel per frame” as established fact.

(b) Replace that sentence with:

> This is a candidate read/write interleave. Source establishes the order, but not that each `scrollTop` write dirties layout or that the next panel flushes it. Stage 1’s browser trace must establish the number and ownership of any resulting layout events.

### F9 — P2 — established: the pilot has no precommitted retain/revert rule

(a) Stage 4 requires merely “a reduction,” while Stage 5 allows an unpaying pilot to be “reverted or left as the whole change.” Any positive movement can therefore be declared sufficient after the result is known, despite the observer’s maintenance cost.

(b) Replace Stage 5 with:

> Retain the pilot only if the same-session A/B removes the predicted duplicated reads, preserves every destination, has no listener/observer leak, and improves the baseline-derived Stage 4 metric outside its recorded run-to-run range. Otherwise revert the pilot. Extend beyond two consumers only under a separately measured verdict.

Source census notes: I confirmed the two section scans, the second `useColumnContext` call site in Outline, duplicate `stickyOffset` and `innerHeight` reads, `DiagramPanel`’s all-row per-frame scan, and the `ContextPanel` read/write sequence. I did not run a test: the unresolved evidence is browser trace and local-corpus evidence, neither of which the permitted isolated test could establish.