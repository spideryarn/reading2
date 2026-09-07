# Share measured geometry — after profiling the scroll and layout reads

Status: **CLOSED — deferred with evidence.** Stage 1 convicted the duplicated scan; **Stage 2c's counterfactual then showed the proposed fix does not acquit it**, so Stage 3 was refused under the rule written before the measurement, and Stages 3–5 were never built. What shipped: Stage 2's three read hoists, the geometry instrument, and its harness. What did not: the shared-snapshot service. See § "Stage 2c result" for the numbers and § "Review ledger — round 2" for the five P1s that had to be fixed before those numbers could be trusted.
Source baseline `cc749e0f1061583f1a8877dc3db5b6c1b2c162e3` (branch `worktree-a8-shared-geometry`).

This is item **A8** of
[the main-app architecture review](260905e-main-app-architecture-review.md#a8-share-measured-geometry-without-forcing-all-navigation-to-mean-the-same-thing),
and its checklist is that document's *Stage: Consolidate geometry only after the preceding baseline*.
That stage is the authority; this plan is how it gets run.

## The job, in one paragraph

**It is a measurement job first, and its first checkbox is a real branch.** The review says: profile
the actual scroll and layout reads now that A7 has landed, and *if they are not material, close this
stage as deferred with the evidence* — a new observer service has a real maintenance cost. Only if
the profile convicts does anything get built, and then only a **pilot on two consumers**, with a
standing instruction to stop if the subscription machinery outweighs a small duplicated measurement.

## What is already known, so this does not rediscover it

### The duplicated quantity is already named, and it is section row tops

Two hooks run a rAF-batched `scroll` listener over the *same element list* and read the *same*
property from each element, in two separate frame callbacks:

| | element list | per-frame read | when |
|---|---|---|---|
| [`App.tsx`](../../src/web/App.tsx) § `useReadingPosition` | `rowsForBlockIds(sections.map(s => s.blockId))` | `el.getBoundingClientRect().top` for every section | always, on every scroll frame, unless a glide is in flight |
| [`useColumnContext.ts`](../../src/web/useColumnContext.ts) § `measure` | `rowsForBlockIds(sections.map(s => s.blockId))` | `el.getBoundingClientRect().top` for every section | only while a gist column mode is on |

Both then hand the resulting `tops` array to the *same pure function*,
[`position.ts`](../../src/web/position.ts) § `activeSectionIndex` — **but against different lines**,
and that difference is the thing the review says must survive. `useReadingPosition` measures against
`stickyOffset() + 1`, the line under the sticky bars, because `?at=` names the section whose heading
has gone under the header. `useColumnContext` measures against `window.innerHeight * FOCUS_LINE`
(40% down), because the fisheye follows where the eye is, and its own file already says why the
sticky line would be wrong for it. **The measurement is shared; the answer is not.**

**`useColumnContext` has two call sites and they are mutually exclusive with each other, but not with
`useReadingPosition`.** [`App.tsx`](../../src/web/App.tsx) § `outlineLive` runs with
`enabled: mode === "outline"` and `depths: []`; [`TableView.tsx`](../../src/web/TableView.tsx) §
`ColumnPanels` runs with `enabled: true` whenever gist columns are showing. So the duplication is not
a gist-column special case — **outline mode pays it too**, because `outlineLive` still runs the
per-section rect loop even with no header rects to collect. Only a reader on plain prose with no gist
columns and not in outline escapes it, and they still pay `useReadingPosition`.

Two more consumers read the same quantity on other cadences.
[`keynav.ts`](../../src/web/keynav.ts) § `measureRow` does
`Array.from(rows, r => r.getBoundingClientRect().top)` over **every** block row on a key press or a
swipe release — gesture-rate, and a candidate for the *fresh on-demand* path rather than the cached
one. But [`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx) § `useReaderRow` calls that same
`measureRow()` **on every scroll frame** while a scatter diagram mode is on, which is `O(all blocks)`
per frame rather than `O(sections)`. Its own docstring concedes this. It was not on the review's list
and it is the heaviest per-frame consumer in the file set, so Stage 1 measures it.

### Two duplications smaller than the headline, and one of them is nearly free to fix

Found in the census, 2026-09-06, and worth writing down separately because they are not the shared
snapshot and do not need it:

- **`useReadingPosition` calls `stickyOffset()` twice in one frame** — App.tsx § `measure`, once for
  `line` and once for `atTop`. Each call is a `getBoundingClientRect()` on the controls bar **plus** a
  `getComputedStyle()` in [`safe-area.ts`](../../src/web/safe-area.ts) § `safeAreaInsets`. That is
  four layout reads per scroll frame where two would do, on every article regardless of length, and it
  is a one-line hoist. `keynav` and `DiagramPanel` call it again on their own cadences.

  **`safe-area.ts` has already written down the condition under which it wants a cache, and this job
  is that condition.** Its comment records Sol's second pass — only `top` and the horizontal insets
  are consumed, and those are the stable ones, so a cache *would* be safe — and then says:

  > It is still not worth writing until somebody measures `stickyOffset` on a scroll and finds this
  > in the profile; performance.md is where that would go.

  So the cache is not a drive-by: it is a change that file explicitly deferred to a measurement this
  job takes. It is still second in line behind the hoist, which halves the calls without adding any
  invalidation to get wrong, and it is only written if the profile still shows `safeAreaInsets` after
  the hoist.
- **`useColumnContext` reads `window.innerHeight` twice in one body** — once for the focus line, once
  for `viewportH`.

Neither is the subject of A8, both are inside its file set, and the review's own licence for cleanups
the work exposes covers them. They are **Stage 2**, a small commit — but, per Sol F3, one that is
reached **only if Stage 1 optimises**, and they are *measured* before and after rather than asserted.
Stage 1 did optimise, and it confirmed both directly: `stickyOffset` runs **2 calls per frame** and
`safeAreaInsets` **70 calls per 30-frame gesture**, so the duplication is real and is now countable.

### The read/write interleave that matters is not the one the review names

The census found a stronger candidate than `watchBarVisibility`:
[`ContextPanel.tsx`](../../src/web/ContextPanel.tsx) § `place` runs from a layout effect keyed on
`rect.top` — which is `useColumnContext`'s sticky-header `bottom`, and
[`TableView.tsx`](../../src/web/TableView.tsx) says plainly that near the masthead this fires on *most
frames*. `place` reads `getBoundingClientRect`, `offsetTop`, `offsetHeight` and `clientHeight`, then
**writes `p.scrollTop`** — and it runs once per mounted gist panel.

**This is a candidate read/write interleave, not an established one** (Sol F8). The source establishes
the *order*; it does not establish that each `scrollTop` write dirties layout, nor that the next
panel's read flushes it. An earlier draft asserted "a forced reflow per panel per frame" as fact, and
that was over-claimed. Stage 1's browser trace must establish the **number and ownership** of any
resulting layout events. It is worth measuring rather than assuming, because the spike below found the
interleaved shape costing **380–400ms per frame** where the clean shape cost 4–5ms — if this pattern
is real here, it dwarfs everything else in this plan; if it is not, the plan should stop mentioning
it. Stage 1 measures the first screenful specifically, because that is where it would live.

### The pattern this stage would introduce is already in the tree, and it works

[`Spine.tsx`](../../src/web/Spine.tsx) already does exactly what A8 describes, and it is the strongest
single piece of evidence available:

- `measure()` reads one rect per **row** — all of them, not just sections — and converts to
  **document space** (`r.top + window.scrollY`), caching `tops`, `docTop` and `docHeight`.
- It is invalidated by a `ResizeObserver` on `document.body`, `window.resize`,
  [`fonts.ts`](../../src/web/fonts.ts) § `onFontsChanged`, and the `layoutKey` prop — the four
  triggers the review lists, minus image load, which the body observer catches.
- Its scroll callback `apply()` then performs **zero forced-layout reads**: it takes `window.scrollY`
  and does arithmetic against the cached document-space tops.

So "cached document-space tops plus explicit invalidation" is not a speculative design here. It is a
shipped, tested design in this same reading view, on the *heavier* element list, and the two hooks
above are the ones that did not get it. That materially lowers the risk the review was pricing, and
it is why the pilot in Stage 3 is a port rather than an invention.

### performance.md already ranks this, and already states the trap

[performance.md § Still open, ranked](../project/performance.md#still-open-ranked-with-citations)
item 4 is this job, in one paragraph:

> **Zero DOM reads per frame** is still available: rows are normal-flow, so a row's viewport position
> is `documentTop − scrollY` and could be arithmetic against offsets cached per layout. Sol's warning
> is worth heeding — the sticky column headers are **not** ordinary rows, their `top` is deliberately
> dynamic near the masthead, and `useReadingPosition` has no observer at all, so a naive cache would
> go stale on a late image or a font swap and point at the wrong section. Wrong position is worse than
> slow position.

Two things follow and both are binding on Stage 3. **The sticky column-header rects in
`useColumnContext` are not cacheable by this scheme at all** — `ColumnRect.top` is documented as
deliberately dynamic near the masthead — so only the *section tops* half moves to the cache and the
header rects stay per-frame. And **`useReadingPosition` has no observer today**, so giving it cached
tops means giving it invalidation it currently does not have; that is added correctness, not only
speed, and it is also the largest way this change could go wrong.

### A7 named the residue as this job's ground, and was careful not to over-claim it

[260905i](260905i-measure-annotation-computation-before-optimising-it.md) made annotation ~40× cheaper
per gesture and moved end-to-end time by **~6%**, because annotation was only **10–14%** of the
gesture. Its write-up is explicit that what the other ~86% *is* was not established — only that it
falls outside those two memos, and that it "likely includes React reconciliation and commit, the live
DOM's own `innerHTML` parse, style, layout, paint and the geometry reads". **This job must not inherit
that as a premise.** Geometry being *some* of the residue is a hypothesis; how much is what Stage 1
measures.

The re-runnable harness A7 promoted — [`scripts/measure-annotation.ts`](../../scripts/measure-annotation.ts) —
is the starting point, not a blank page: it already does local sign-in, population counting before any
timing, warmup discarding, raw per-repetition vectors, and refusal to report when `window.__perf` is
missing or no blocks rendered. [`annotation-cost.ts`](../../src/web/annotation-cost.ts) is the model
for a per-subsystem counter module behind `?perf=1`.

### A count of reads is not a count of reflows, and this plan must not confuse them

The census's own caveat, and it is the single most important thing to hold on to. Inside **one** rAF
callback with no interleaved write, `S` rect reads cost **one** forced layout plus `S` cheap property
lookups — the browser flushes once and the rest are served from the flushed tree. So a headline like
"1,012 reads per frame" is an upper bound on *work*, not a count of *reflows*, and quoting it as the
latter would be the same mistake as quoting a scalar microbenchmark.

What actually costs a reflow is **a read after a write**: 1 for the first read of the frame, plus 1
for every write that lands between two reads. Nothing in the code orders the four-to-five rAF
callbacks with respect to one another; the census established that nothing enforces reads-before-
writes across consumers, and did **not** establish the actual runtime ordering. That is a thing to
measure, not to reason about.

So the count is a diagnostic and the timing is the decision, exactly as the rule below says. If the
profile comes back saying `S` rect reads in one callback cost almost nothing, **that is a defer**, and
the shared-snapshot machinery would have been bought for a saving that was already free.

### The heavy workload already exists locally, and it is heavier than expected

Surveyed 2026-09-06 against the local Supabase (`127.0.0.1:54362`), 80 articles, 38 with a published
tree. Section counts are **exact, not approximated**: the survey imported the app's own
`buildGeometry` ([`tree.ts`](../../src/web/tree.ts)), `sectionDepth` and `buildSections`
([`position.ts`](../../src/web/position.ts)) and reconstructed block order from
`revision_blocks.ordinal`, so these are the numbers `useReadingPosition` itself would get. A dated
example, not a durable fact.

| slug | owner | blocks | leaf depth | **sections** | gists |
|---|---|---:|---:|---:|---|
| `m1-kuhn-spya-a2zrjb` | `dev-admin@spideryarn.local` | 2,046 | 3 | **1,237** | all 127 internal nodes |
| `evaldeepen-e5aq8o9s-book-spya-yynkqz` | `eval@spideryarn.local` | 2,569 | 4 | **1,166** | all 145 |
| `replication-crisis-spya-hrjamq` | `referee-test-260901@example.com` | 551 | 3 | 51 | all 60 |
| `scaling-hypothesis` | `dev-admin@spideryarn.local` | 186 | 3 | 35 | all |

**So Stage 1b is not needed and is struck.** `m1-kuhn` clears the ≥ 150-section bar by 8×, has gists
so the gist columns can be switched on, and is owned by the dev admin — no seeding, no generation, and
a defer is available on real evidence if the numbers say so.

Three things to carry into the measurement:

- **Measure three articles, not two** (Sol F7). `m1-kuhn` is 1,237 sections over 2,046 blocks —
  nearly one section per two blocks, a very wide shallow tree, and a verdict earned only there is
  weaker than one an ordinary article also produces. An earlier draft said so and then applied the
  rule as though it did not matter. So:

  | article | role | sections | tree shape |
  |---|---|---:|---|
  | `m1-kuhn-spya-a2zrjb` | heavy, **wide and shallow** | 1,237 | leaf depth 3 |
  | `evaldeepen-e5aq8o9s-book-spya-yynkqz` | heavy, **deeper shape control** | 1,166 | leaf depth 4 |
  | `replication-crisis-spya-hrjamq` | ordinary-size control | 51 | leaf depth 3 |

  **A defer requires *both* heavy shapes below budget.** A conviction on only one heavy shape is
  labelled **workload-specific** and may authorise only the two-consumer pilot — whose retention still
  has to clear Stage 5's payback rule.
- **The stored `article_revisions.section_count` column is not this number.**
  [`library-scalars.ts`](../../src/library-scalars.ts) counts tree nodes at a hardcoded `depth === 2`,
  where the reader uses `sectionDepth(geometry) = max(1, leafDepth − 1)`. For the 4-deep
  `evaldeepen` tree the column says **32** against a real 1,166; on the 3-deep trees it is off by one
  or two because it does not collapse supplements the way `navigableItems` does. Do not use that
  column for anything here, and do not "fix" it in this job — it is another stage's file.
- **`replication-crisis` now has 17 comments, not 5.** A7's streaming probe created twelve locally
  and its write-up discloses it. Its own baseline table is therefore over a different workload than
  any run this job takes, which is one more reason this job's A/B happens within a single session.

### One layout write already lands in the middle of the read frame

[`scroll.ts`](../../src/web/scroll.ts) § `watchBarVisibility` runs its own rAF and **writes**
`document.documentElement.dataset.bars`, which changes the sticky bars' contribution to layout. It
reads only `window.scrollY`, so it is cheap on its own — but a style write from one frame callback
invalidates layout for the rect reads in the other two, in the same frame. It only attaches while the
short-viewport media query matches, so a laptop pays nothing. Stage 1 should say whether this
read-after-write interleave is real on a phone-sized viewport; it is the one place a shared snapshot
would win by **ordering** rather than by count.

## Decision rule, written before the measurement

Recorded up front so the answer cannot be chosen after seeing the numbers. It follows A7's shape
deliberately, with one deviation argued below.

### What is reported, and what a self-timer cannot tell you (Sol F1)

An earlier draft of this section said "geometry's attributable share" and made an inclusive
`performance.now()` timer around each sampler decisive. **That is unsound, and this repository has
already recorded why**: forced layout is charged to whichever function performs the first read after
another subsystem dirtied the DOM, so moving that read moves the apparent cost without removing any
work ([performance.md](../project/performance.md)). A self-timer observes the stall; it does not
establish **ownership** of it, and it does not establish **preventability**.

Both wrong verdicts follow from that, and each is a way this job could end confidently and wrongly:

- **False optimise** — a section sampler inherits the cost of a layout that a React commit or a CSS
  write made necessary. Sharing the scan would not remove that layout, because paint needed it anyway;
  the number would move to another function and the reader would feel nothing.
- **False defer** — an earlier, uninstrumented read pays the flush, and both candidate scans then look
  cheap because they are reading an already-clean tree.

So every gesture is reported as **three** numbers, not two:

1. **end-to-end**, action to second painted frame;
2. **non-overlapping sampler JavaScript time** — inclusive parent and leaf buckets are never summed;
3. **browser `Layout` and `RecalculateStyle` events from a Chrome performance trace**, with the write
   that dirtied layout identified, not only the read that flushed it.

A synchronous layout is reported *under* the read that triggered it and is **not** called attributable
to that reader. Counts are reported too and are **diagnostic only**: counts say what the work is, the
trace says whose it is, and timing says whether it matters.

**Stage 3 is authorised only where the trace, or a perf-only counterfactual, demonstrates that
removing or reordering the duplicated section-top scan removes browser work while destinations remain
identical.** A saving that only moves the cost to another function is not a saving.

### The instrument was spiked before the plan was approved, and it works

Because F1 could have invalidated the whole of Stage 1, it was settled by experiment rather than by
argument. Chrome 152.0.7977.75 headless via Playwright on the Hetzner box, 1280×900, a synthetic
2,000-row table with non-uniform prose, a `position: sticky` `<thead>` **and** a separate sticky
controls bar whose height a data attribute toggles — i.e. the real page's shape. Forty frames per
case, three full runs. Cross-checked against CDP `Performance.getMetrics` (`LayoutCount`,
`LayoutDuration`, `TaskDuration`). Harness under the session scratchpad, `a8spike-*`; a dated
experiment, not a durable fact.

| case | what it does | median/frame at n=1,237 | `LayoutCount` delta |
|---|---|---:|---:|
| **A** clean read | n rect reads during a real wheel scroll, nothing writes | **3.7–5.3 ms** (max 12.4–15.6) | **0**, every run |
| **B** dirtied read | one sticky-bar height write, then n rect reads | 9.65–17.05 ms | 40 = one flush/frame |
| **C** interleaved | 20 alternating read → `scrollTop` write pairs | **378–400 ms** (max 713–930) | 800 = 20 flushes/frame |
| **D** control | n reads of `dataset.block`, no geometry | 0.85–1.2 ms | 0 |

**Four things this settles, and they reshape the plan rather than merely confirming it.**

1. **The inclusive timer is a sound instrument.** It cleanly separates no-layout (~0.2–5ms) from one
   forced layout per frame (~1–17ms) from thrashing (~380–930ms), and CDP corroborates every
   qualitative claim. F1's worry was real in principle; the instrument survives it **provided the
   trace check is taken too**, which is exactly F1's remedy.
2. **`LayoutCount` is better evidence than timing, and it is free.** It was *exact and identical
   across all three runs* while the timings swung by 5× on this contended box. So Stage 1 reports it
   as a first-class number, not a footnote: it answers "did anything dirty layout" with no noise at
   all, which is the question F1 is really about.
3. **A pure scroll does not dirty layout, even with sticky positioning.** `LayoutCount` was **0** in
   every run at every length. Chrome composites sticky offsets off the main thread. So the naive story
   — "scrolling forces layout, so cache the tops" — is **wrong**, and had this job asserted it, it
   would have been asserting something false.
4. **And the duplication is material anyway, which is the surprise.** Reading 1,237 *already-clean*
   rects still costs **3.7–5.3ms median, 12.4–15.6ms max**, and case D proves that is the rect reads
   and not the loop. Two consumers doing it is 7–11ms of a 16.7ms frame, before React, before paint.
   **The cost is the reads themselves, not a forced layout** — which means the shared snapshot is
   still the right shape, but the plan may not justify it with a layout-thrash story it has now
   disproved.

One caveat carried forward honestly: CDP's fine-grained `LayoutDuration`/`RecalcStyleDuration`
undercount relative to the JS timer, while `TaskDuration` reconciles with it. Use `TaskDuration` for
magnitude and `LayoutCount` for ownership. And the box is contended — the spike had to run three
sessions to see through it, so **Stage 1 runs at least three sessions and compares medians**, per
the standing note that a red or slow batch here is usually the box.

### Which buckets may decide, and which may only inform (Sol F4)

Stage 1 instruments seven sites but Stage 3 changes **two**. An earlier draft applied the threshold
"across the instrumented geometry samplers combined", which would let `DiagramPanel`'s all-block
per-frame scan or `ContextPanel.place` cross the line and authorise an observer service that does not
touch the cost that convicted.

**Stage 1 therefore records two verdicts.** The **A8 pilot verdict** uses only the non-overlapping
cost of the duplicated section-top scans in `useReadingPosition` and `useColumnContext`, measured
while both are active. Every other instrumented site is **diagnostic and cannot authorise Stage 3**.
If another site convicts, that is recorded as a separately scoped follow-up and A8 still defers unless
its own two-consumer duplication convicts. Instrumenting `DiagramPanel` is useful; letting it decide
this pilot would be the error.

### The workload is fixed before it is run, and a median alone may not defer (Sol F6)

**The scroll gesture is pinned in the harness**, or repetitions are not comparable with each other or
between builds: fixed scroll **distance**, **delta sequence**, **cadence**, **start position**,
**enabled mode**, and **settling frames**. A scroll that varied in any of those would give a
run-to-run range that swamps the effect.

**The statistic is the median of at least five warmed repetitions, the first discarded** — the same
rule A7 used, and A7 recorded that its Stage 1a ran four warmed rather than five. This job runs
`--repeats 6 --warmup 1` throughout so the rule is met rather than reconciled afterwards.

**But a median may not carry a defer on its own.** Report **p50, p95 and maximum** frame intervals and
sampler times. One 20ms forced layout every fifth frame gives a comfortable median, is plainly visible
to a reader, and produces **zero `longtask` entries** — that API starts at 50ms, which
[`perf.ts`](../../src/web/perf.ts) already documents. So: a run with excess missed-refresh intervals,
or a conspicuous maximum, is **investigated and reported**, and **may not defer merely because its
median and long-task count are low**.

**Before the geometry buckets are read**, and recorded in this document first, take on each viewport:
the actual **refresh cadence** of the machine, and an **uninstrumented fixed-scroll baseline**. These
calibrate the noise floor. They are taken blind to the quantity under test, which is what keeps this
from being a rule chosen after the fact.

**Optimise** if, on the heavy workloads, any of these holds. The numbers below are precommitted; the
baseline above may **tighten** them but may never loosen them — that asymmetry is the whole guard,
because a threshold raised after seeing an uncomfortable number is not a threshold.

1. **Scroll, per frame.** The **p50** scroll frame spends **≥ 4ms** in the two pilot samplers, **or**
   the **p95** frame spends ≥ 8ms, **or** the run drops frames outside the uninstrumented baseline's
   recorded range.

   *Why 4ms and not A7's 8ms.* A7's threshold was half a 60Hz frame for a cost paid **once per
   gesture**. This cost is paid **every frame for as long as the reader scrolls**, so the same
   absolute number is a permanently worse deal: 8ms every frame is half the frame budget conceded
   forever to two hooks that between them move one URL parameter and one panel. A quarter of a frame
   is the most a per-frame sampler may take before it is a plausible reason for a dropped frame
   during continuous scrolling — and the p95 clause is there because the p50 clause alone cannot see
   the sparse-bad-frame shape above.

2. **Scroll, duty cycle.** During the fixed scroll, the two pilot samplers occupy **≥ 10%** of the
   main thread. Duty cycle is defined as A7 defined it: total sampler ms divided by wall time from the
   first scroll event through the final painted frame — the denominator is wall time and the numerator
   is the sum over however many frames actually ran, never per-frame arithmetic.

3. **A layout-changing gesture.** A discrete gesture that invalidates layout (mode switch, granularity
   column toggle, opening a comment) spends **≥ 8ms** in the two pilot samplers at the median. Same
   clause and same reasoning as A7, because this one *is* once-per-gesture.

**Until the fixed workload has been run and the baseline recorded, Stage 1 may conclude only
"inconclusive" — never optimise and never defer.**

**Defer** only when the workload that stayed below every threshold was **the heavy one**. Heavy is
defined by **section count**, not block count, because the per-frame loop is over sections: the heavy
workload must have **≥ 150 sections** with a usable hierarchy tree, and — for the `useColumnContext`
half — generated gists so a gist column can actually be switched on. A low number on a light workload
is not a defer; it is a finding that the workload was not heavy enough. The survey above found
`m1-kuhn-spya-a2zrjb` at **1,237 sections with gists**, so this condition is already satisfiable and
nothing has to be generated first.

**Defer is a good outcome and the plan says so.** What is not acceptable is closing this either way
without numbers. A defer writes the numbers down, so the next person knows when to revisit.

**Zero is not a result until a control moves.** Every zero-work assertion, in the browser and in the
suite, is paired with a changed-input control that must move every counter being trusted, and the
rendered row and section counts are asserted nonzero before any timing is believed
([silent-success.md](../reusable/silent-success.md)). A7's harness already refuses to report when
`window.__perf` is missing or no blocks rendered; that refusal is kept.

## Review ledger — round 1, plan stage

GPT Sol, 2026-09-06, `gpt-5.6-sol` at high effort, against the plan before any code existed. Verdict:
**request changes** — established P1s F1, F2 and F3 blocked the plan as written. The review itself is
[260906d-share-measured-geometry-plan-review-sol.md](260906d-share-measured-geometry-plan-review-sol.md)
and the prompt is
[260906d-share-measured-geometry-plan-review-prompt.md](260906d-share-measured-geometry-plan-review-prompt.md).
(Both were called `260906d-plan-review-*` until the merge of 2026-09-07, when they collided add/add
with A10's identically-named pair. A10's were already on `dev` and referenced from two other docs, so
theirs kept the path and these took the `<plan-slug>-review-*` name the rest of `docs/plans/` uses.)

**All nine findings accepted; none overruled.** Two of them (F1, F5) were changes this plan needed
rather than polish, and F5 in particular closed a correctness hole the plan's own wording had opened.

| ID | Severity | Finding, in short | Disposition |
|---|---|---|---|
| F1 | P1 established | An inclusive self-timer attributes a forced layout to whichever read flushed it, not to the write that dirtied it — enabling both a false optimise and a false defer | **Accepted.** Three reported numbers instead of two; a Chrome trace must identify the dirtying write; Stage 3 needs a counterfactual. Then **spiked in a browser before approving the plan** — see § The instrument was spiked |
| F2 | P1 established | The parent checklist requires delayed image/font/viewport tests; Stage 4 did not require them, so an implementation could satisfy this plan while proving none | **Accepted**, added verbatim as Stage 4 item 3 |
| F3 | P1 established | Stage 2 claimed to run "whichever way Stage 1 decides"; the checklist says a defer closes the stage, and the safe-area cache is machinery, not a hoist | **Accepted.** Stage 2 now runs only on an optimise; the cache is a conditional substage 2b |
| F4 | P1 reasoned | Combining all instrumented buckets lets `DiagramPanel` or `ContextPanel` convict and authorise a pilot that does not touch them | **Accepted.** Two verdicts; only the two duplicated section scans may authorise Stage 3 |
| F5 | P1 reasoned | "Notify on selected-result change" is too narrow — `positionToWrite` also depends on `atTop`, the held id, the section partition and `glideTarget()` | **Accepted.** Consumers evaluate their full decision every sample; suppress only equal final outputs |
| F6 | P1 reasoned | A median hides sparse bad frames, `longtask` starts at 50ms, and the 4/8ms budgets were not derived from any baseline; the scroll workload was unpinned | **Accepted with one modification** — see below |
| F7 | P2 reasoned | Only the wide shallow heavy article was to be measured, though a deeper-shaped heavy article exists | **Accepted.** Three articles; a defer needs both heavy shapes below budget |
| F8 | P2 established | "A forced reflow per panel per frame" in `ContextPanel` was asserted from call order alone | **Accepted**, downgraded to a candidate the trace must establish |
| F9 | P2 established | The pilot had no precommitted retain/revert rule, so any positive movement could be called sufficient after the fact | **Accepted.** Stage 5 rewritten as four conditions fixed in advance |

**The one modification, and why.** F6 proposed that Stage 1 record the baseline and *then* amend this
document with the numeric budgets. That is right about calibration and wrong about sequence: choosing
the number after taking a measurement is the exact failure a precommitted rule exists to prevent, and
A7's discipline turns on it. So the precommitted 4ms/8ms/10% stand, and **the baseline may tighten
them but never loosen them.** Everything else in F6 — the pinned workload, p50/p95/max, the
"inconclusive" verdict until the baseline is recorded, and a conspicuous maximum blocking a defer —
is taken as written.

## Anti-goals

From the review, and none of them is in scope:

- **No prose virtualisation, no replacing the HTML table, no new navigation state machine.**
- **No collapsing the three questions into one answer.** The URL tracks the section under the sticky
  line; the fisheye tracks its focus line; explicit navigation owns a glide target. Consumers keep
  their own pure selection functions and are notified only when *their* selected result changes.
- **No publishing the whole snapshot through `Reader` state.** That would invalidate the tree every
  frame, which is the thing the current design already avoids.
- **No caching for an explicit jump** until cached measurements have proved equivalent. A stale fast
  answer is the wrong optimisation for navigation; `scrollToBlock` and `keynav` keep measuring fresh.
- **No invalidation on total article height alone.** Rows redistribute while the total stays equal.
  App-owned changes invalidate explicitly.
- **No restructuring `App.tsx`.** The A1 job is moving `Reader` and its position hook into new files
  concurrently. Changes stay inside the small geometry modules; the `App.tsx` edit, if any, is the
  smallest possible one at the hook's measurement seam.
- No repo-wide reformatting, no renames, no `styles.css`, no `/design`.

## Stages

### Stage 1 — profile, and be willing to close the stage

**The smallest experiment that can decide this.**

1. **Population confirmed in the loaded page, not only in the database.** The survey above settles
   which articles to use; what it does not settle is that the *rendered* page has them. Before any
   timing, read out of the running page: the `tr[data-block]` count, the number of section rows the
   hook actually resolved (`rowsForBlockIds` returns `null` holes), the gist column headers present,
   and that `window.__perf` exists. An article whose tree is missing produces zero sections and would
   report a comfortable number for the wrong reason; so would signing in as the wrong owner, which
   gives a 404 that looks like a very fast page — A7 hit exactly that.
2. **A geometry-cost counter module**, modelled on `annotation-cost.ts`: off unless `?perf=1`, a
   `"counts"` mode that increments per read site, and a `"full"` mode adding leaf clocks. Instrument
   these sites inclusively, each as its own bucket:

   | site | why it is in |
   |---|---|
   | `useReadingPosition` § `measure` | the per-frame `O(sections)` sampler |
   | `useColumnContext` § `measure` | the other one, plus header rects |
   | `DiagramPanel` § `useReaderRow`'s `measure` | per-frame `O(all blocks)` in a scatter mode |
   | `ContextPanel` § `place` | the read→write interleave, per panel, first screenful |
   | `Spine` § `measure` | the invalidation-time `O(all blocks)` scan; the control that must move |
   | `scroll.ts` § `stickyOffset` | called two to four times a frame across consumers |
   | `scroll.ts` § `watchBarVisibility`'s `apply` | the other write in the frame |

   Report the count of reads **separately** from wall time, and report **`longtask` and dropped-frame
   counts during the scroll** as a third column, since a per-frame cost that never lands in a long
   task is a different finding from one that does.

   **Built 2026-09-06 as [`geometry-cost.ts`](../../src/web/geometry-cost.ts)**, and its accounting
   convention has to be stated here because it is easy to get backwards and every later number depends
   on it:

   > **`reads` are exclusive; `ms` is inclusive.** A parent counts only the reads it performs itself,
   > and a nested leaf owns its own — so the `reads` column *sums* across all ten sites to the frame's
   > real total with nothing double-counted, while **the ten `ms` numbers must never be summed**
   > (Sol F1's "inclusive parent and leaf buckets are never summed", made structural rather than
   > documented).

   Two consequences worth knowing before reading any output. `diagramReaderRow` correctly reports
   **zero reads**, because everything it causes happens inside `measureRow` — that zero is the
   accounting working, not a dead counter. And `readingPosition` reports `1 + resolved rows`, falling
   to `1 + 0` during a glide, which is the existing rect-skip showing up in the data.

   A `writes` field was added to the tally beyond the contract, because
   `ContextPanel.place`, `Spine`'s `apply` and `watchBarVisibility` are the three sites that write,
   and F8 turns on whether their writes actually land between other consumers' reads.

   **What the suite cannot see**, stated because it decides how much weight the browser run carries:
   `tests/geometry-cost.test.ts` drives the real functions in jsdom for seven sites, but
   `readingPosition`, `diagramReaderRow` and `contextPanelPlace` are module-local to large components
   and are **not** covered — a dropped `noteGeometry` at those three would not go red. The browser run
   is their only check, so their population counts must be confirmed nonzero there before any of their
   numbers are believed.

   **Leaf clocks are off during the decision run**, for A7's reason: the per-section rect loop is the
   interval being measured, so two clock reads per section against a 4ms threshold would perturb the
   very number the rule is applied to. `"full"` is a separate diagnostic whose absolute numbers are
   not decisive, and whose bias must be named when it is quoted.
3. **Production build**, `npm run build` then `vite preview`, never the dev server — `main.tsx` wraps
   the app in `<StrictMode>` unconditionally and the dev server serves unbundled modules. A7 measured
   ~3× inflation from that, which is why it refused to decide on a dev number. **`npm run build`, not
   `npm run build:api`**: the API build refuses a stale client shell after a commit.
4. **Gestures:** a continuous scroll (the primary one, and the one no previous job has measured) —
   run **twice**, once from the top of the article so `ContextPanel.place` is live while the header is
   still sticking, and once from the middle where it is not. Then a granularity column toggle, a mode
   switch, and opening a comment. Two viewports: desktop, and a phone-sized one so
   `watchBarVisibility` is actually attached. If a scatter diagram mode is reachable on the workload,
   scroll in it too — `useReaderRow` is the heaviest per-frame consumer found.
5. **Apply the rule in writing**, in this document, before any Stage 3 code exists.

**Stage 1 can end the job.** If every threshold is clear on the heavy workload, this stage closes as
**deferred with evidence**, the review's checkbox is ticked as deferred, the numbers go into
performance.md, and the job is done. That is a legitimate finish and not a failure.

**Done when:** the numbers exist with their run-to-run range, the population counts are recorded
beside them, the commands are recorded so they can be re-taken, and the decision rule has been applied
in writing.

### Stage 1 result — **optimise**, on clauses 1 and 3, on both heavy shapes

> **Retaken 2026-09-07 on the corrected harness. The section immediately below is the current
> result; everything after it is the superseded first run of 2026-09-06, kept because the way it was
> wrong is the most useful thing in this document.** F10's counterfactual is still owed and Stage 3 is
> still ungated — see Stage 2c.

Production build, `vite preview` on port 5310, Playwright against system Chrome on the Hetzner box.
Three sessions per configuration, `--repeats 6 --warmup 1`, pinned scroll of 30 × 100px = 3,000px at a
requested 16ms cadence with a 500ms settle, run from the top **and** from the middle. Re-runnable:
[`scripts/measure-geometry.ts`](../../scripts/measure-geometry.ts).

**Sign-in is not optional and the harness will tell you so.** Each of the three articles has a
different owner — `dev-admin@spideryarn.local` for `m1-kuhn`, `eval@spideryarn.local` for
`evaldeepen`, `referee-test-260901@example.com` for `replication-crisis` — and `--local-sign-in`
needs `--sign-in-via <dev origin>` because it imports the app's own SDK from `/src/web/lib/`, which
`vite preview` does not serve. Both mistakes were made on the retake and both were refused rather than
measured: a signed-out page renders nothing and costs nothing, *"which reads as a good result"*.

**Population confirmed in the loaded page before any timing**, and the corpus survey checks out
against the instrument, which is the cross-check that matters: `readingPosition` reports **1,238**
reads per call on `m1-kuhn` (1,237 sections + one `scrollY`) and **52** on `replication-crisis`
(51 + 1). Those are the survey's exact numbers, arrived at by a counter that knows nothing about
`<td>` elements. The measured refresh cadence with nothing happening was p50 16.7ms — that is the
noise floor, and it is why the frame numbers below are not the box being idle-slow.

#### Retaken, 2026-09-07, on the corrected harness — **the verdict stands, and one claim did not**

The numbers below this heading are the **first run**, and they are superseded. F11, F12 and F13 are
fixed, and the three sessions were retaken on the corrected harness against a production build of
`97bcd4c7`. Verdict unchanged: **optimise**, on clause 1 and clause 3, on both heavy shapes.

**Per scroll frame, over real frames — one entry per frame, the two samplers summed within it.**
Three sessions × two start positions, desktop, `--repeats 6 --warmup 1`.

| article | sections | p50 | p95 | max | clause 1 |
|---|---:|---|---|---|---|
| `m1-kuhn` | 1,237 | 9.40 – 10.80 | 14.60 – 17.20 | 32.10 – 77.40 | **fires** on both halves |
| `evaldeepen` | 1,166 | 7.50 – 8.10 | 10.10 – 11.20 | 28.40 – 53.60 | **fires** on both halves |
| `replication-crisis` | 51 | 1.40 – 1.60 | 4.10 | 5.30 | under, correctly |

Clause 1 needs p50 ≥ 4 **or** p95 ≥ 8. Both heavy shapes clear **both** thresholds in every session
that was allowed to publish; the light control clears neither, which is the discrimination the control
exists to provide.

**Clause 2 still does not fire**, and by more margin than before: duty cycle p50 2.2–2.3% on
`m1-kuhn`, 1.5–4.6% on `evaldeepen`, against a 10% threshold. The honest reading is unchanged from the
first run — the pilot is a small fraction of wall time, and it is **not** why this page is slow.

**Clause 3 fires**, on the correct quantity. Clause 3 is written about the median **total pilot ms per
gesture**, because that cost is paid once per gesture rather than every frame — so the per-frame
figure is the wrong statistic to compare against it. Column toggle: 10.6–14.3 ms. Mode switch:
25.0–33.6 ms. Both are over 8 ms on both heavy articles in every session.

##### What the correction actually changed, which is not what was expected

The prediction was that p95 would rise. It did, and the p50 barely moved:

| `m1-kuhn`, session 1, from the top | first run | retaken |
|---|---|---|
| p50 | 10.33 | 9.40 |
| p95 | ~11.10 | **14.60** |
| max | ~11.10 | **42.00** |

The first run's "p50/p95" were percentiles across five per-repetition **means**, so the whole quoted
spread was the spread *between repetitions* — which is why its p95 and its max were nearly the same
number. That is the tell, visible in the old output and not noticed: a p95 equal to the max means the
vector had about five entries in it.

Two things follow, and only one was anticipated:

- **The tail was invisible.** Real frames reach 42–77 ms in the pilot on `m1-kuhn`. Averaging inside a
  repetition removed them entirely. This is exactly what Sol's F6 asked for and what F11 found had
  been silently undone.
- **The centre was slightly overstated.** The mean of a right-skewed distribution sits above its
  median, so the first run reported 10.33 where the true median is 9.40. The old method was wrong in
  *both* directions at once — too high in the middle, far too low in the tail — which is worth saying
  plainly, because "we were being conservative" would have been the comfortable summary and it is not
  true.

The harness now prints the mean beside the distribution, labelled *"a mean has no tail; do not quote a
percentile of it"*, so the two cannot be confused again.

##### One number that did not reproduce, and one session that was refused

The first run's clause-3 line claimed a granularity toggle spent **12.50 ms at the median**. Retaken,
the column toggle's *per-frame* p50 is 3.50–4.40 ms and its *per-gesture* total is 10.6–14.3 ms. The
12.50 was the per-gesture quantity all along, so the finding survives — but the earlier write-up had
already mislabelled it once (quoting a p95 against a rule about medians, corrected under F17), and
that is twice now that this clause has been supported by the wrong statistic. The clause is about
per-gesture totals. Nothing else.

**F13 refused `evaldeepen` session 2, scroll-from-the-middle**, with *"4 warmed valid repetition(s)
out of 6 — the rule this plan committed to before measuring is 5, so nothing here may be quoted"*. Sol
predicted exactly that session would fall short. Its raw vectors are printed and excluded, the
cross-session table prints `—` for it, and the run exits non-zero. That is the rule working on its
first contact with real data rather than being quietly relaxed.

`comment-open` refused on both heavy articles in all sessions — neither has stored comments. A
refusal, not a zero.

##### The duplication, measured rather than argued

On `m1-kuhn`, one 3,000px gesture:

| site | calls | reads | reads per call |
|---|---:|---:|---:|
| `readingPosition` | 30 | 37,140 | **1,238** |
| `columnContext` | 30 | 37,260 | **1,242** |
| everything else, eight sites | — | 366 | — |
| **total across all ten** | | **74,766** | |

1,238 is 1,237 sections plus one `scrollY`; 1,242 is the same scan plus the fisheye's fixed reads. The
two hooks are **99.5% of every layout read the page performs during a scroll**, and they are reading
the same 1,237 rectangles as each other, in two rAF callbacks, to produce one URL parameter and one
integer.

That is the mechanism this plan exists to remove. It is still **not** proof that removing it removes
time — that is Stage 2c's job, and it remains ungated.

##### A caveat on comparability

These numbers were taken **after** Stage 2's hoists and after F14 and F15 landed, so the retaken
figures are not a clean statistical re-derivation of the first run's workload — they are the corrected
statistics of a slightly cheaper page. Stage 2 moved reads out of the pilot's *leaves*
(`stickyOffset`, `safeAreaInsets`), which the pilot's inclusive `ms` still contains, so a small part of
any downward movement in p50 is Stage 2 rather than F11. The direction of the verdict does not depend
on separating them; a claim about the *size* of Stage 2's effect would, and none is made here.

#### THE FIRST RUN, 2026-09-06 — superseded, and kept for how it was wrong

Everything from here to the end of this section is the original measurement, taken on the harness
before F11, F12 and F13 were fixed. Its verdict was right and its statistics were not. Read it with
the retaken block above.

#### The pilot verdict — `readingPosition` + `columnContext` only, per Sol F4

Per **scroll frame**, p50 (and p95), across three sessions × two start positions:

| article | sections | p50 range | p95 range | clause 1 (p50 ≥ 4 or p95 ≥ 8) |
|---|---:|---|---|---|
| `m1-kuhn` (wide, shallow) | 1,237 | **9.20 – 11.90 ms** | 10.61 – 14.12 | **fires, every run** |
| `evaldeepen` (deeper shape) | 1,166 | **7.32 – 15.81 ms** | 8.34 – 18.09 | **fires, every run** |
| `replication-crisis` (control) | 51 | 1.33 – 1.89 ms | 1.59 – 2.19 | does not fire |

**Both heavy shapes convict, so this is not workload-specific** — the condition F7 set for a full
verdict rather than a hedged one. The ordinary-size control sits comfortably under, which is what
tells us the cost is the section loop and not a fixed overhead.

**Clause 3 fires too**: a granularity column toggle spends **12.50 ms** in the pilot at the median
against an 8ms budget, and a mode switch spends **about 27.1 ms** at the median.

> **Citation corrected, 2026-09-07 (Sol F17's neighbour).** This sentence originally gave the mode
> switch's pilot cost as "a p95 of 421.60 ms". The clause is written about the median, so quoting a
> p95 against it compared two different statistics and made the margin look roughly fifteen times
> larger than it is. The median is 27.1 ms, which still fires clause 3 against 8 ms — the finding
> survives, the arithmetic behind it did not. Sol caught it while confirming that clause 3 fires at
> all, which is the useful shape of a review: the conclusion was right and the evidence for it was
> not.

**Clause 2 never fires, and that is the honest half.** Duty cycle peaked at 6.1% against a 10%
threshold. The reason is not that the pilot is cheap but that the frames are enormous — frame
intervals on `m1-kuhn` ran p50 83–133ms with ~62 dropped frames per repetition. So **the pilot is
about 2–6% of wall time and is not why this page is slow**, exactly as A7 found annotation was 10–14%
of its gesture. Both halves go in the write-up, because a report that implied A8 fixes the sluggishness
would send the next person to the wrong room. What justifies the work is the mechanism, not the share:
**74,430 layout reads per 3,000px scroll**, from two hooks whose combined output is one URL string and
one integer.

#### Where the time actually goes, and it is not the flush

| | `m1-kuhn` per gesture |
|---|---:|
| `TaskDuration` (main thread busy) | 13,882 ms |
| `LayoutDuration` | 284 ms |
| `LayoutCount` | 56 flushes |
| pilot inclusive ms | 339 ms |
| total layout reads, all ten sites | 74,726 |

Layout is ~2% of the main thread. **The pilot's cost is the reads themselves, not forced layout** —
which is what the pre-plan spike predicted and what makes sharing the scan a real saving rather than a
relabelling. `LayoutCount` (56) tracks the write count (`spineApply` 30 + `contextPanelPlace` 16 = 46)
rather than the read count, so the flushes belong to the writers.

**F1's warning stays live, and Stage 4 must discharge it.** Some part of the pilot's 339 ms is the
flush that `spineApply`'s and `contextPanelPlace`'s writes made necessary, and sharing the scan will
not remove that. What it should remove is the *second* consumer's 37,290 clean reads. The A/B in
Stage 4 is the counterfactual F1 requires, and it is what decides whether this was real.

#### `contextPanelPlace` is bigger than the pilot — but F8 is **not** established (Sol F10)

| gesture, `m1-kuhn` | calls | inclusive ms | per-call p95/max |
|---|---:|---:|---|
| scroll from the middle | 32 | **743.4** | 60.5 / 73.6 ms |
| scroll from the top | 16 | 308.8 | 63.6 / 108.7 ms |
| granularity column toggle | 3 | 130.5 | 173.4 / 173.4 ms |

F8 asked that the read/write interleave be established rather than asserted. An earlier draft of this
section claimed it now was. **It is not**, and Sol's F10 is right that it cannot be: what is measured
here is *time*, and time does not attribute a flush to the write that caused it — which is precisely
F1, the finding this whole instrument was reshaped around, reappearing in the conclusion I drew from
its output. Only the counterfactual or a real trace can establish F8, and neither has been run.

What **is** established: `contextPanelPlace` is the single most expensive geometry site in the reading
view — 743 ms in one gesture, more than double both pilot buckets combined, from **32 calls doing 272
reads**. Its cost per read is roughly 600× the pilot's (F17: an earlier draft said "four orders of
magnitude", which was wrong arithmetic as well as an overclaim). That ratio is *consistent with* a
flush per call. It is not evidence of one.

**Per F4 this cannot authorise the A8 pilot and does not change its verdict.** It is recorded here as a
separately scoped follow-up with its numbers attached, so the next person does not have to rediscover
it. It is plausibly worth more than everything else in this plan.

#### Two things the phone run says that the desktop run cannot

`section cells on screen=0` on a 390px viewport: **there are no gist columns on a phone**, so
`columnContext` never runs and there is no duplication to share. Yet the pilot still measures
**4.81–5.67 ms** per scroll frame, from `readingPosition` alone, still paying 1,238 reads a frame.
So on a phone the sharing half of Stage 3 buys nothing and only the *caching* half would — worth
knowing before assuming one fix serves both. And `watchBarVisibility` is confirmed attached there
(30 calls, one write) and confirmed cheap (1.2–2.8 ms per gesture), which closes it as a suspect.

### ~~Stage 1b — generate a heavy workload~~ — **struck before the job started**

A7 needed this stage because its heavy workload had to be seeded. This one does not: the corpus
survey found `m1-kuhn-spya-a2zrjb` at 1,237 sections with gists on every internal node, eight times
the threshold, already on disk and owned by the dev admin. Nothing is generated and nothing is
inserted. Recorded rather than deleted, because "why is there no 1b" is a question a reader will ask.

### Stage 2 — the duplications that need no machinery

**Reached only if Stage 1 optimises** (Sol F3). An earlier draft said this stage ran "whichever way
Stage 1 decides, because it adds nothing to maintain". That was wrong twice over: the governing
checklist says that if the reads are immaterial the stage closes as **deferred**, full stop; and the
safe-area cache below is not free — it introduces invalidation, which is machinery. **If Stage 1
defers, record the duplicate-call counts as part of the evidence and close the job with no production
changes.** Hoisting a read that has been measured not to matter is work whose own justification says
it is pointless.

It is a separate stage and a separate commit from the snapshot so that a Stage 3 which has to be
reverted does not take it with it, and so that Stage 3's A/B is measured against a baseline these are
already in.

1. Hoist `useReadingPosition`'s second `stickyOffset()` call to one per frame.
2. Hoist `useColumnContext`'s second `window.innerHeight` read.

Steps 1 and 2 are mechanical hoists within one function body: same values, same order, fewer reads.

**Stage 2b — safe-area caching. A separate conditional substage**, reached only if the profile taken
*after* the hoists independently convicts `safeAreaInsets`. Before any cache is written, establish and
test **every** invalidation event. The invalidation is the whole risk and it is not only resize and
orientation: in an ordinary Safari tab the browser's own toolbar minimises **while the reader is
scrolling**, which is what `safe-area.ts`'s own comment warns about. **If the honest invalidation set
turns out to include scroll, the cache buys nothing and is dropped** — recorded here as a finding
rather than shipped as a cache that re-reads every frame anyway.

**Acceptance is the counters, not the argument**: the read counts for those sites must fall by the
predicted amount and the resulting `?at=` and `focusRow` values must be identical over the same
scripted scroll. If the counters do not move, the instrument is wrong and that is the finding.

#### Stage 2 addendum, 2026-09-07 — a third instance arrived while this ran

The `origin/dev` merge brought `keynav.ts § measureOrigin`, the DOM half of the new jump-origin
feature. It calls `readingLine()` **twice** in one body — once to decide whether the first row has
crossed the line, once to pick the block — and each call is a `stickyOffset()`, so a rect on
`.controls` plus a `getComputedStyle`. That is precisely Stage 2's pattern, written independently by
somebody else, in the week Stage 2 removed the same shape from `App.tsx` and `useColumnContext.ts`.

Hoisted, on the same argument: nothing between the two uses writes to the DOM, so the second call
could only ever have returned what the first did. It is one call in the early-return branch too,
which is what that branch already cost. Suites: `spine-jump-origin`, `keynav`, `spine-here` (40).

**That three independent authors wrote this shape in one file set inside a week is itself evidence for
the thesis of this plan** — not proof that the *shared snapshot* is worth building, which is Stage
2c's job, but proof that "read the same geometry twice because the two readers cannot see each other"
is the normal outcome here rather than an oversight. It is also the same class as F14, with the sign
flipped: two reads of one value are harmless exactly when nothing moves between them, and a clock is
the case where something always does.

**Not instrumented, deliberately.** `measureOrigin` is a genuine eleventh geometry site and a third
consumer of the one-rect-per-row scan. Adding it now would change `GEOMETRY_LEAVES` and the exact-count
assertions mid-flight while F11's frame tagging is being built. Recorded here; decided after.

### Stage 2c — the counterfactual that authorises Stage 3 (Sol F10)

**Stage 3 may not begin until this has run and passed.** That ordering is the whole finding: the plan
already required "a trace or counterfactual showing that removing the duplicate scan removes work",
and Stage 1 was written up as though Stage 4's A/B would discharge it — but Stage 4 happens *after*
Stage 3 is built, so the gate would have been checked only once the thing it guards already existed.

It also cannot be discharged by the timing already in hand. A self-timer records *when* work
happened, not *which* work caused it; F1 said so about forced layout and it is equally true here.
`LayoutCount` 56 against 46 attempted writes cannot attribute anything either. **The only cheap
instrument that attributes is removal**: take the reads away and see whether the time goes with them.

#### Method

One session, one browser, the same pinned gesture, two arms interleaved rather than run back to back,
so drift on a shared box cannot masquerade as an effect:

- **Arm A** — the code as it stands.
- **Arm B** — a **throwaway spike**, not the Stage 3 service. `useColumnContext`'s per-frame row scan
  is replaced by a reuse of tops already read in that frame. It does **not** have to be correct: it is
  allowed to produce a wrong `focusRow`, because nothing about the reading is being trusted, only the
  cost. Making this explicit matters — an arm B that had to be right is a Stage 3 implementation, and
  then the gate is again inside the thing it guards.

Arm B is reverted before Stage 3 begins. It is a measurement, not a first draft.

#### What is written down before arm B runs

From **arm A's own counters**, and recorded here before arm B is run at all:

1. the predicted read reduction, in reads per scroll frame and per gesture;
2. arm A's pilot p50/p95 per frame (post-F11, so a real frame distribution);
3. the **run-to-run range** of that statistic across arm A's five warmed repetitions — the noise
   floor, which is what stops a difference inside the noise being read as an effect.

Writing (3) down before seeing arm B is the point. A threshold chosen afterwards is not a threshold.

#### Arm A, written down before arm B was built

Taken from the retake of 2026-09-07 on `m1-kuhn`, desktop, three sessions × two start positions.

**1. The predicted read reduction.** `columnContext` performs `2 + resolvedRows + gistHeaders + pin`
reads per frame; on `m1-kuhn` that is **1,242**, of which **1,237** are the section-row rectangles
`readingPosition` has already read in the same frame. Removing the second scan should therefore take:

- **1,237 reads per scroll frame**, leaving `columnContext` at **5**;
- **37,110 reads per 3,000px gesture** (30 sampler calls), taking the ten-site total from **74,766**
  to about **37,656** — a 49.6% fall in every layout read the page performs during a scroll.

Anything materially short of that means the spike did not do what it claims, and nothing else it
reports may be read.

**2. Arm A's pilot per-frame distribution.** p50 **9.40–10.80**, p95 **14.60–17.20**, max
**32.10–77.40** across the six runs.

**3. The run-to-run range — the noise floor.** The widest per-repetition spread inside a single run is
session 2 from the top: **9.99–13.82**, a range of **3.83 ms**. That is the number arm B has to beat,
and it is deliberately the *widest* observed rather than the average, because a threshold set at the
friendliest noise estimate is not a threshold.

**So: arm B must remove ~37,110 reads per gesture, and improve the pilot p50 by more than 3.83 ms.**

#### The rule, precommitted

**Stage 3 is authorised only if both hold:**

1. **The reads actually go.** Arm B's measured pilot reads fall by the predicted number from (1),
   within rounding. If they do not, the spike did not do what it claims and nothing else it reports
   means anything — this is the paired zero-work control that
   [silent-success.md](../reusable/silent-success.md) asks for, and it fails loudly rather than
   quietly reporting an improvement.
2. **And the time goes with them.** Arm B's pilot p50 improves by more than arm A's run-to-run range
   from (3).

**If 1 holds and 2 does not, Stage 3 is refused and this plan closes as deferred with evidence** —
and that is a real outcome, not a formality. It would mean the reads are not what the time is made
of, that sharing them buys a smaller number in the counter and nothing on the clock, and that the
observer's maintenance cost has bought nothing. It would also retire the Stage 1 write-up's claim
that "the cost is the reads, not the flush", which F10 correctly says is not yet established.

**If neither holds**, the instrument itself is in question before the pilot is.

`LayoutCount`, `LayoutDuration` and `TaskDuration` are recorded for both arms and reported alongside,
but they do not decide this: the browser-spike section above already found a pure scroll dirtying no
layout at all, so a `LayoutCount` that does not move is the expected result rather than a refutation.

#### Stage 2c result, 2026-09-07 — **condition 1 passed, condition 2 failed. Stage 3 is refused.**

Arm B built as specified: `useColumnContext` reads the section rows **once**, outside every frame, and
`measure` reuses that array. `focusRow` is therefore wrong the moment the reader scrolls, which the
method explicitly permits. Arm B was reverted immediately after measuring; the working tree diff is
empty.

Same box, same preview build, same pinned 3,000px gesture, `m1-kuhn`, three sessions × two start
positions.

##### Condition 1 — the reads went. **Passed, exactly as predicted.**

| | arm A | arm B | predicted |
|---|---:|---:|---:|
| `columnContext` reads per gesture | 37,260 | **150** | 150 |
| `columnContext` reads per frame | 1,242 | **5** | 5 |
| all ten sites, per gesture | 74,766 | **37,441** | ~37,656 |

The spike did what it claims. So everything else it reports may be read.

##### Condition 2 — the time did not go with them. **Failed.**

Pilot ms per **scroll frame**, p50, by session:

| start | arm A | arm B | improvement |
|---|---|---|---:|
| from the top | 9.40 / 10.40 / 10.80 | 7.50 / 7.10 / 6.50 | median **3.30** |
| from the middle | 9.80 / 10.70 / 10.50 | 8.00 / 7.30 / 6.80 | median **3.20** |

**The threshold, fixed in the commit before arm B existed, was 3.83 ms.** The improvement is 3.20–3.30
ms. Paired run by run, **one of six** clears it (session 3 from the top, 4.30 ms); five do not.

The rule says: *"If 1 holds and 2 does not, Stage 3 is refused and this plan closes as deferred with
evidence."* It does not hold. **Stage 3 is refused.**

##### Why this is a real answer and not a near miss

Three things make the refusal firmer than the 0.5 ms shortfall makes it look.

**Arm B is an optimistic bound — no correct implementation can do better.** Because its `tops` are
stale, `focusRow` never changes, so the `same` comparison short-circuits and `setLive` almost never
fires. A correct shared snapshot must do strictly *more* work than arm B: publish real values, and
re-render the panels when they move. Arm B is the ceiling on what sharing could buy, and the ceiling
is inside the noise.

**Removing 99.6% of a hook's layout reads removed about half of its time.** `columnContext` went from
37,260 reads and 212.5 ms to 150 reads and 90.9–103.9 ms. If the reads were the cost, that residual
should have collapsed too. Whatever the other ~95 ms is, it is not the section scan — and it is
untouched by the thing this plan proposed to build.

**Arm B still fires clause 1.** With the duplication *entirely gone*, the pilot's p50 is 6.50–8.00 ms
(threshold 4) and its p95 is 10.40–18.90 ms (threshold 8). The shared snapshot would not have brought
the page under the budget that justified proposing it. That is the sharpest fact here: the proposed
remedy does not fix the condition that convicted the code.

##### What the evidence actually points at

`readingPosition`'s own cost barely moved between arms — 128.0 ms against 117.9–134.4 ms — because its
reads never changed. It reads 1,238 rectangles every frame and costs about 4.0–4.3 ms per call on its
own. **That is most of what remains, and sharing cannot touch it**: sharing removes the *second* scan,
and the first one is the expensive one.

The remedy for a first scan is not to share it but to **stop performing it per frame** — cached
document-space tops with explicit invalidation, which is the pattern `Spine.tsx` already ships and
which § "The pattern already ships here" describes. That is a different change from the one this plan
proposed: larger, with a correctness surface this plan's own two traps are about (fresh measurement
for an explicit jump; rows redistributing while total height stays equal), and it needs its own
verdict rather than inheriting this one.

It is written down here as the next thing somebody should weigh, **not** as an approved successor.
Stage 1 convicted the code; Stage 2c has now shown the proposed fix does not acquit it.

##### What survives

- **Stage 2 stands** — the three hoists were separately justified, cost nothing, and are unaffected by
  this. So do F14's behaviour fix, F15's seam, and the corrected harness, all of which are about the
  instrument rather than the pilot.
- **The instrument stands and is re-runnable**, with its refusals now proven against real data.
- **`contextPanelPlace` remains the largest single geometry site** and remains a separately scoped
  follow-up, untouched by any of this.

##### Stage 3, 4 and 5 are not run

Stage 3 was gated on this and the gate refused. Stage 4 proves Stage 3, and Stage 5 decides whether to
retain what Stage 3 built; with nothing built, neither has anything to do. They are left in this
document as written, so that a future attempt starts from the design rather than from scratch — and so
that F2's and F5's requirements are not lost, since both would bind any future version of this work.

### Stage 3 — share one snapshot between two consumers — **NOT BUILT; refused by Stage 2c**

> **This design was never implemented.** Stage 2c's counterfactual showed that removing the duplicated
> scan buys 3.20–3.30 ms per frame against a 3.83 ms noise floor, and leaves the pilot still over
> clause 1's budget. The design is kept below because it is the answer to a question somebody will ask
> again, and because F2's and F5's requirements are written into it and would bind any future attempt.
> Read it as a proposal that was measured and declined, not as work outstanding.

**Gated on Stage 2c above.** A **pilot**, and the review's standing instruction is to stop if the machinery outweighs the
duplication.

1. A reader-scoped, read-only geometry snapshot at the **existing measurement seam** — document-space
   section tops, computed in one pass, exactly as `Spine.measure()` already does for rows. One
   scheduled read per frame or per invalidated layout, reads batched before any write.
2. **`useReadingPosition` and `useColumnContext` share only the measured section tops.** Each
   evaluates its **complete** consumer decision independently, on every scroll sample and on every
   explicit invalidation.

   **This replaces an earlier wording that said "notified only when its selected result changes", and
   the correction is the sharpest finding of the review (Sol F5).** `positionToWrite` does not depend
   only on the active section: it also depends on `atTop`, on the **held** fine-grained block id, on
   the current section partition, and on `glideTarget()`. So a service that suppressed notification
   whenever the active section index was unchanged would silently break at least three real cases:

   - a real gesture cancels a glide **without** crossing into another section — the suppressed write
     is exactly the one that resumes tracking;
   - the reader reaches the top of the article while still inside the first section — `at` must be
     cleared, and the section index never moved;
   - a new layout changes which section **contains the held paragraph** without changing the currently
     selected section id — the springback bug `position.ts` documents at length.

   So: the URL selector receives current `scrollY`, the sticky line, `glideTarget()`, the held URL
   value and the section generation, and **glide cancellation schedules it even when the active
   section is unchanged**. The fisheye independently selects against its own 40% focus line.
   **Suppress only equal final consumer outputs — never equal active-section indices.**

   `useColumnContext`'s sticky column-header rects stay per-frame reads: they are documented as
   deliberately dynamic near the masthead and are not cacheable by this scheme.
3. Invalidation is explicit: article/column/spine/layout change (`layoutKey`), root-font change via
   `onFontsChanged`, a `ResizeObserver` on the measured content, image load, resize, and relevant bar
   transitions. **Never total article height alone.**
4. Explicit jumps keep measuring fresh — `scrollToBlock`, `keynav` — until cached measurements have
   proved equivalent against a fresh read in a test.

### Stage 4 — prove it, or hand the pilot back

1. Tests must retain `position.ts`'s fine-grained `?at=` preservation inside a section, suppression
   during a programmatic glide, interruption by a real gesture, and link/history semantics.

   **But note what the existing suite does and does not cover.**
   [`tests/reading-position.test.ts`](../../tests/reading-position.test.ts) exercises `position.ts`'s
   *pure* functions and is handed a `tops` array as an argument — including a case called *"keeps
   writing after a reflow, rather than going quiet"*, which passes a **new** `tops` array in. So it
   tests that the pure logic copes with moved boundaries, and it would go on passing unchanged if the
   cache that produced `tops` were stale, because nothing in it ever measures anything. That is
   exactly the failure performance.md warns about — *wrong position is worse than slow position* —
   and the suite as it stands cannot see it. **A new test that drives the measurement seam, not the
   pure function, is a required deliverable of this stage, not a nice-to-have.** Write it red first:
   move a row without changing the article's total height, and watch the cached answer be wrong
   before the invalidation is added.
2. **Count layout reads and listener/subscriber teardown, not only the resulting block ids.** Hidden
   and visible transitions, a new layout, an article change, and a native gesture interrupting a
   glide. A mutation of the finished code must make the suite red — checked at the end of the stage,
   because red-first only tests the diff.

3. **The three checklist cases the earlier draft would have let an implementation skip** (Sol F2).
   The parent checklist requires testing delayed **image**, **font** and **viewport** changes; Stage 3
   names those as invalidation triggers but nothing here required them to be *tested*, so an
   implementation could have satisfied this plan while proving none of them. Required, as separate
   tests:

   > Drive the real measurement seam through a delayed article-image load, through `onFontsChanged`,
   > and through a viewport resize/movement, as separate tests. In each case move section rows after
   > the initial snapshot, assert that the URL and fisheye destinations match a **fresh DOM
   > measurement**, count exactly the expected number of remeasurements, and prove every listener and
   > observer is removed on unmount and on article replacement.
4. Re-run Stage 1's harness on the same build session, A/B, and demonstrate a reduction in repeated
   reads **alongside identical destinations**. Identical destinations is the acceptance, not a bonus.
5. Update the geometry and performance signposts:
   [performance.md](../project/performance.md) (append — that file is shared),
   [column-context.md](../project/column-context.md), [url-state.md](../project/url-state.md).

### Stage 5 — retain or revert, on a rule written before the result (Sol F9)

An earlier draft asked only for "a reduction", and then allowed an unpaying pilot to be "reverted or
left as the whole of the change" — which is not a rule, because any positive movement could be
declared sufficient once it was known. The observer has a maintenance cost and it has to be earned.

**Retain the pilot only if all four hold:**

1. the same-session A/B removes the **predicted** duplicated reads — the number named before the run,
   not whatever reduction turned up;
2. **every destination is preserved** — `?at=` values and `focusRow` identical over the fixed scroll,
   and over each explicit jump;
3. **no listener or observer leak**, proved by the teardown counts, not by absence of a symptom;
4. it improves the baseline-derived Stage 4 metric **outside that metric's recorded run-to-run
   range** — on a box this contended, an improvement inside the noise is not an improvement.

**Otherwise revert the pilot**, and say so here. Extending beyond the two consumers needs a separately
measured verdict and is not authorised by this one.

## Review ledger — round 2, Stage 1 code and result

[The review](260906d-stage1-review-sol.md), from the prompt at
[260906d-stage1-review-prompt.md](260906d-stage1-review-prompt.md), run against `5fdf1065..914f59c4`.

**Verdict: request changes, and Stage 3 authorisation refused.** Sol's summary of why is worth
quoting rather than paraphrasing: *"The raw data probably supports 'optimise,' but the instrument has
not yet earned that verdict under the precommitted rules."* That is the right distinction. The
direction of the answer survives — Sol's own provisional re-derivation still puts both heavy articles
over clause 1 — but four of the five P1s say the published numbers were computed a different way from
the way the plan promised, and the fifth says the probe changed the page.

All eight findings are **accepted**. One (F16) is accepted in part and settled below.

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F10 | P1 established | The counterfactual gate this plan set for itself was never run. The harness only calls `Performance.getMetrics`; it never starts a trace, and `LayoutCount` 56 against 46 attempted writes cannot attribute ownership. So neither "the cost is the reads" nor "F8 is now established" follows | **Accepted.** Stage 3 is unauthorised until the perf-only A/B counterfactual runs. `contextPanelPlace` goes back to **candidate**, and § "F8 is now established" is wrong as written |
| F11 | P1 established | `pilotMsPerSamplingFrame` is a *mean* — total ms over max calls — and the report then takes p50/p95 across five such repetition means and labels them per scroll frame. That is not the distribution F6 asked for, and it flattens exactly the sparse tail F6 existed to preserve | **Accepted.** Tag each parent sample with its rAF frame, sum the two non-overlapping sites within a frame, take percentiles over *that* vector, and re-run. Every published p50/p95 is provisional until then |
| F12 | P1 established | The population gate refuses only zero blocks, zero nodes, a missing instrument or mode `off`. An article whose section tree failed to render still records `readingPosition` calls, and no pathname or article identity is asserted, so a redirect to a different valid article passes | **Accepted.** Assert final pathname and article identity, expose an independent resolved-section count, and assert each fixed workload's expected section range, depth and gist-column presence before timing. Sol checked these particular logs and their fingerprints are right, so the runs are not retrospectively void — the gate is |
| F13 | P1 established | `scrollVerdict` accepts 80% of the requested distance, so the "pinned workload" F6 required is not pinned; and `report` publishes on one warmed sample where the rule says five. Warmed 2,900px and 2,976px repetitions are in the logs | **Accepted.** Tolerance tightens to rounding, publication refuses below five warmed valid repetitions, and the affected sessions re-run. Sol notes this leaves four valid repetitions in some runs and three in `evaldeepen` session 2 middle |
| F14 | P1 established | **The instrument changes behaviour.** In `scroll.ts § apply`, `parentGeometryClock()` consumes a `performance.now()` immediately before the existing `performance.now() < quietUntil` test, so with counting on the second read can land the other side of the boundary. Sol reproduced it: `quietUntil` 250, clocks 249 then 251, bar hidden with counting on and quiet with it off — and that flips whether a layout-affecting write happens | **Accepted.** Read the clock once and use the one value for both the quiet-window decision and the timer start. This is a bug I shipped and it gets a postmortem: the class is *a probe that participates in the thing it measures*, and it is the one failure Stage 1 was explicitly not allowed to have |
| F15 | P2 established | The suite is mutation-blind at the site that authorises the work. Sol ran it: mutating covered `measureRow` fails as it should, but changing `readingPosition`'s read count to `1`, and separately moving its timer start next to `noteGeometry`, both leave all 12 tests green | **Accepted.** This confirms my own suspicion 2 and makes it worse than I wrote it: the gap is not merely uncovered, it is uncovered precisely where the number came from. Extract `readingPosition`'s measurement body behind a driveable seam and assert emitted reads and timer placement against spied accessors |
| F16 | P2 reasoned | "Optimise" does not justify doing A8 *next*: clause 2 genuinely fails, the pilot is 2–6% of ~13.9s of main-thread work, and `contextPanelPlace` is larger | **Accepted in part; settled below** |
| F17 | P3 established | "Four orders of magnitude" is arithmetically wrong: 743/272 against 339/74,430 is ~600×, or 2.8 orders | **Accepted.** Say ~600×, and stop using the ratio as evidence of reflow ownership at all — per F10 it is not evidence of that |

Sol also **confirms** three things it went looking to break and did not: all ten read constants are
correct, including `ContextPanel`'s 9/8 branches and the exclusive zero at `diagramReaderRow`; there
is no parent/leaf double-counting; and clause 3 does fire on the mode switch — though at a median of
about 27.1ms, where the write-up quoted the p95. Fix that citation too.

### F16, settled

Sol is right about the fact and I am overruling the recommendation, because it asks this job to
become a different job.

The fact stands and is already in this plan: clause 2 does not fire, the pilot is a small fraction of
wall time, and `contextPanelPlace` is bigger. What F16 proposes — investigate `ContextPanel` first,
then re-run A8 — is the reverse of F4, which was accepted specifically so that an unrelated bucket
could not decide this pilot's fate. F4 stops `contextPanelPlace` **authorising** A8; it equally stops
it **vetoing** A8. A8 is the assigned stage and its own two buckets convict on their own numbers.

What does change: the verdict word. It is **"eligible for optimisation"**, not "optimise", until F10's
counterfactual runs. And `contextPanelPlace` is recorded here, again and more loudly, as a separately
scoped follow-up that is plausibly worth more than everything else in this plan.

### What this costs, in order

1. ~~**F14 first**, because it is a live behaviour change in committed code, and a postmortem with
   it.~~ **Done, 2026-09-07.** `geometry-cost.ts` gains `parentGeometryClockFrom(now)`; `apply` reads
   `performance.now()` once a frame and uses the one value for both the quiet-window comparison and
   the timer. Red first:
   [tests/probe-does-not-change-the-page.test.ts](../../tests/probe-does-not-change-the-page.test.ts)
   fails on the old code, passes on the new, and carries two controls so it cannot pass by never
   running the listener. Swept the other eight instrumented files: none of them reads a clock at all,
   so `apply` was the only instance. The postmortem is
   [260907a-a-probe-that-read-the-same-clock-twice.md](../postmortems/260907a-a-probe-that-read-the-same-clock-twice.md),
   and its finding is that this job had already fixed the *harmless* form of the same class in Stage 2
   — two reads of one value, which agree only when nothing moves between them. A clock never does.
   **One consequence for the data:** `barVisibility`'s write count in § "Stage 1 result" was taken
   from a page that only exists while the probe is running, so it re-runs with the rest.
2. ~~**F11 + F13 + F12**, the harness corrections~~ **— code done, 2026-09-07; the re-run is still
   owed.** Until the three sessions are re-run, every number in § "Stage 1 result" stays provisional
   and is marked so.

   - **F11.** `GeometryTally` gains `frames`, parallel to `samples`, carrying the
     `DOMHighResTimeStamp` that `requestAnimationFrame` hands its callback — an **argument**, never a
     clock read, which is the whole of F14's postmortem applied to its own fix. `noteGeometry` takes
     it as a trailing optional so the eight untouched sites record exactly what they did. The harness
     builds a real per-frame vector (`pilotFrameMs`: group by id, sum the two non-overlapping pilot
     sites, `NO_FRAME` calls each their own frame) and takes p50/p95/max over *that*. A build that
     publishes `samples` without `frames` is refused rather than silently averaged.
     `pilotMsPerSamplingFrame` survives with a docstring saying what it is — a mean, across which no
     percentile may be taken.
   - **F12.** `Population` gains `pathname`, `docTitle` and a `resolvedSections` count read from the
     DOM rather than from the counters, so the gate and the thing it gates do not share an assumption.
     `FIXED_WORKLOADS` records the three articles' fingerprints and the run refuses a wrong pathname,
     a wrong block count or depth, missing gist columns, or a section count out of range — with the
     identity check *before* the baseline early return, and re-checked after `discreteRun`'s own
     navigation.
   - **F13.** `PINNED_TOLERANCE_PX = 1` replaces the 80% band, and now refuses **overshoot** as well
     as shortfall — the old rule could not express that at all, so a repetition that travelled 3,400px
     of a pinned 3,000 was quoted as pinned. `MIN_WARMED_REPETITIONS = 5` is enforced before any
     summary is printed, in the cross-session table too, so there is no back door.

   **The re-run is done, 2026-09-07** — see § "Retaken, 2026-09-07" above. The verdict stands at
   **optimise** on clauses 1 and 3. On its first contact with real data F13 refused `evaldeepen`
   session 2 from the middle at 4 warmed repetitions of 6, which is the session Sol predicted would
   fall short, and the run exits non-zero rather than quietly quoting it.

   **Verified rather than accepted:** typecheck clean, 51 tests green across the three geometry
   suites, biome clean on all five files, and my own mutation — `PINNED_TOLERANCE_PX` 1 → 600 and
   `MIN_WARMED_REPETITIONS` 5 → 1 — turned 4 tests red and then green again on restore.

   **Two things carried forward rather than solved.** `resolvedSections` is a different DOM query from
   `sectionCells` but not a third independent mechanism, and when no gist column is drawn it is
   legitimately 0 — so the phone configuration is still gated only on identity, not on the section
   tree, because nothing rendered in the DOM witnesses that tree with the column off. And
   `FIXED_WORKLOADS` hardcodes local-corpus numbers with ±2–3% bands: a dated fact about this
   machine's database, in a gate that fails loudly. That is the right trade — a re-imported corpus
   *should* stop the run — but it is a maintenance cost now owned, and `replication-crisis`'s range is
   327 DOM cells rather than 51 sections, which is easy to misread later.
3. **F10's counterfactual**, which is the gate on Stage 3 and cannot be skipped by doing Stage 3 and
   calling Stage 4's A/B the discharge — that is the ordering error F10 names.
4. ~~**F15's seam**, which Stage 3 wants anyway.~~ **Done, 2026-09-07.**
   `useReadingPosition`'s measurement body is lifted out of two nested closures into
   [reading-position.ts](../../src/web/reading-position.ts) § `measureReadingPosition`, leaving the
   hook only the ref and the URL write. No injected accessors: it reads the real DOM, and
   [tests/reading-position-seam.test.ts](../../tests/reading-position-seam.test.ts) spies on
   `Element.prototype.getBoundingClientRect` — a version that took its readers as parameters would be
   a version whose test never exercised the reads.

   **Both of Sol's exact mutations now fail.** Read count `1 + resolved` → `1`: 4 red. Timer start
   moved down beside `noteGeometry`: 1 red. Restored green after each. The suite also pins the
   exclusive-reads convention directly — the controls bar's rect is charged to `stickyOffset` and not
   to this parent — and carries the paired zero: with the probe off, no clock is read and the row
   rects still happen, so it reads as "the probe is silent" rather than "nothing ran".

   A side benefit worth naming for A1, who is moving `Reader` and its position hook into new files:
   this takes ~45 lines out of `App.tsx` rather than adding any.
5. F17 and the clause-3 citation, prose.

Stage 2 is unaffected: it is two hoists inside one function body each, it was authorised by clause 1,
and clause 1 survives Sol's own re-derivation.
