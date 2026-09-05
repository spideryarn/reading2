# Mode switching is sluggish on a very long article

**Status:** stages 1 and 2 built and measured. The remainder is written up, not built — § What is left.
**Parent:** [260905b-feedback-reports-batch-three.md](260905b-feedback-reports-batch-three.md).
**Report:** Sentry `SPIDERYARN-READING2-1M`, filed 2026-09-05 07:41 UTC by Greg (admin).

> "The interface feels kind of sluggish when clicking around, changing modes and stuff like that for
> a really long article."
>
> — Greg, 2026-09-05

Filed from
`/read/lawrence-kuhn-2024-a-landscape-of-consciousness-spya-hs82mz?at=spya-vpsn59&mode=hierarchy&cols=1,2,3`
— hierarchy mode, three gist columns. `build_commit` 31382bf2, production.

## Why this is not the scroll work again

[performance.md](../project/performance.md) records four rounds of work, and **every one of them was
about scrolling**: the rail re-rendering per frame (2026-08-27), the prose `innerHTML` being
rewritten 18,734 times per scroll (2026-09-03), `TableView`/`Spine` reconciling 87 and 150 times per
scroll (2026-09-04). The complaint here is a different gesture — a **click** — and no number on that
page describes one. So the first half of this job is measurement, not fixing.

The other axis that is new is **length**. Every measurement on that page was taken on a 360-block or
551-block article. The article in the report is far longer, and the reporter says so in the sentence.

## What is being measured, on what

- **Long:** `m1-kuhn-spya-a2zrjb` — **2,046 blocks, 152,077 words**, owner
  `dev-admin@spideryarn.local` in the local Postgres store. This is the same Kuhn "Landscape of
  Consciousness" piece the report was filed from, already ingested locally.
- **Short, as the control:** `scaling-hypothesis` — 186 blocks, 12,646 words, same owner.

Two articles rather than one, because "sluggish on a long article" is a claim about a **slope**, not
about a number. A mode switch that costs 200ms on both is a different bug from one that costs 20ms
and 400ms.

Store is Postgres (`SPIDERYARN_STORE=postgres`), per CLAUDE.md.

## Assumptions and open questions

- Recorded here rather than asked, because this is an unattended run.
- (filled in as the work goes)

## Measurements

All on the **production build** (`npm run build`, `vite preview`), `SPIDERYARN_STORE=postgres`, on the
Hetzner box, 2026-09-05. Harness: `scripts/measure-cpu.ts --modes`, which is new in this piece of
work — nothing here measured a **click** before, only a scroll.

```
npx tsx scripts/measure-cpu.ts --local-sign-in --email dev-admin@spideryarn.local \
  --sign-in-via http://localhost:5291/ \
  --url "http://localhost:5292/read/<slug>?perf=1&mode=hierarchy&cols=1,2,3" \
  --settle 25 --modes "Hierarchy,Summary,Outline,Plain" --repeats 3
```

The unit is **click to next painted frame** — two `requestAnimationFrame`s after `btn.click()`
returns, so the handler's synchronous work and the frame that shows it are both inside the number.
A scroll is judged by its worst frame over thirty seconds; a click is judged by how long it takes
for anything to happen at all, and no figure on [performance.md](../project/performance.md)
described one.

### The reproduction, and it is not subtle

Both runs rendered what they claimed to — `2046 rows, 2046 prose blocks, 47398 nodes, 560860px tall`
and `186 rows, 186 prose blocks, 5422 nodes, 61879px tall`. Means over the repeats after the first.

| mode switch | 186 blocks | 2,046 blocks | ratio |
|---|---:|---:|---:|
| **Hierarchy** | 203ms | **4,698ms** | **23x** |
| **Summary** | 185ms | 2,693ms | 15x |
| **Outline** | 99ms | 1,308ms | 13x |
| **Plain** | 86ms | 860ms | 10x |

Blocks go up 11x and the worst switch goes up 23x. At 2,046 blocks every mode switch costs between
**0.9 and 4.7 seconds**. This is the complaint, reproduced, and it is not subtle.

**Two caveats on the ratios, both from GPT Sol.** The cycle is fixed, so "Hierarchy" always means
*Plain→Hierarchy* — 4,698ms is the cost of *entering* Hierarchy, not of sitting in the state the
report was filed from. And with the first observation discarded there are two samples per mean; the
long-article Hierarchy pair was 5,567ms and 3,829ms, a 45% spread. So: a severe length-correlated
cost, established. A scaling curve, not established.

**The cost is not spread thin.** Two frames name most of it.

### Where the time goes

`mainThreadBusyPercent` over the same window, from `Performance.getMetrics`:

| | 186 blocks | 2,046 blocks |
|---|---:|---:|
| script | 7.6% | **60.4%** |
| style | 2.7% | 9.8% |
| layout | 1.4% | 3.0% |

**Script, overwhelmingly** — which is the *opposite* of the 2026-09-03 scroll finding, where script
fell to 22% and layout plus style were 28% between them. A profiler pointed at this on the strength
of that precedent would look in the wrong place.

A sampling profile of four switches (`--cpu-profile`, production bundle, so `src/` cannot be told
from `node_modules`) — 14,056ms of script in 85,159 samples:

| self time | | |
|---:|---:|---|
| **5,352ms** | **38.1%** | **`querySelector`** |
| 2,063ms | 14.7% | `get ready` — native, and the only one in play is `document.fonts.ready` |
| 722ms | 5.1% | (garbage collector) |
| 636ms | 4.5% | `getBoundingClientRect` |

Everything below that is under 2.1% and minified. **Two native DOM calls are 52.8% of all script.**

### The mechanism

Both are O(the whole document), and both re-run on every mode switch because `layoutKey` /
`fitSignature` change when the column set or the band does.

1. **`sections.map(s => document.querySelector('tr[data-block="…"]'))`**, in two places —
   [`App.tsx`](../../src/web/App.tsx) § `useReadingPosition` and
   [`useColumnContext.ts`](../../src/web/useColumnContext.ts). Each call scans the document until it
   matches, so the loop is **sections x DOM nodes**. On a 47,398-node page that is the quadratic
   term, and it is why 11x the blocks costs 23x the time.
2. **`document.fonts.ready`** in [`Spine.tsx`](../../src/web/Spine.tsx),
   [`dock-fit.ts`](../../src/web/dock-fit.ts) and
   [`OutlinePanel.tsx`](../../src/web/OutlinePanel.tsx). Reading the getter makes Chrome settle font
   loading, which flushes style over the whole document.

The render counts are low — a Hierarchy switch costing 4.7 seconds is
`Reader=2 TableView=2 Spine=3 ContextPanel=4 ColumnPanels=2` — so the 2026-09-04 `memo` work is
holding and nothing is re-rendering in a loop.

**That does not exonerate React**, and an earlier draft here said it did. `useRenderCount` counts
component-body executions and does not time them, and two `TableView` renders can each reconcile
2,046 rows; the two named native calls are 52.8% of script, which leaves 47.2% fragmented across
minified frames that nothing here has attributed. What the counts rule out is a render *storm*, not
render *cost*. GPT Sol, 2026-09-05.

### One harness bug found on the way, and it is the house pattern

The first version read the `longtask` entries immediately after the paint. A `PerformanceObserver`
delivers in a later task, so the *same* Hierarchy switch reported `tasks: 0` on one repeat and a
2,878ms task on the next — and `tasks: 0` reads as **"nothing blocked the main thread"**, the most
flattering available wrong answer, on a switch that blocked it for five seconds.
[silent-success.md](../reusable/silent-success.md). The collection now waits 150ms, after the
headline number is already taken, so it costs the measurement nothing.

Also worth keeping: **the first click of a run is a click on the mode you are already in**, because
the page is loaded at `mode=hierarchy`. It costs 29ms and looks like the fastest switch in the
table. The report prints `first` and `later mean` separately for exactly this reason.

## What to do about it

**Simplest version first**, and the two costs are not equally safe to touch.

### Stage 1 — one pass over the table instead of one scan per section

The `sections.map(document.querySelector)` loops become a single
`querySelectorAll('tr[data-block]')` into a `Map`, looked up by id. **O(rows) instead of
O(sections x nodes)**, no behaviour change: `querySelector` returns the first match in document
order, so the map keeps the first element it sees for an id and returns exactly what the loop
returned before.

This is the 38.1%, it is mechanical, and it is behaviour-preserving. It goes first and it goes
alone.

### Stage 2 — `document.fonts.ready`, only if stage 1 leaves it mattering

The 14.7% is real but the fix is not mechanical. Reading the getter is what makes Chrome settle font
loading; not reading it means a font swap no longer triggers a re-measure, and a row-height change
that nothing re-measures is a spine whose bands point at the wrong place — **wrong position is worse
than slow position**, which is the same reasoning
[performance.md](../project/performance.md#still-open-ranked-with-citations) already applies to
caching row offsets. So: measure after stage 1, and only then decide whether this is worth a
behaviour risk.

### Deliberately not done

- **Making `TableView` not reconcile 2,046 rows.** The renders are already down to two per switch —
  the 2026-09-04 `memo` work is holding. Windowing the table is a large change to the feature the
  whole app is for, and nothing here shows React reconciliation is the dominant cost.
- **The `getBoundingClientRect` per row in `Spine`** (4.5%). Real, and the fourth-largest item, but
  small beside the first two and the cache that would remove it is the one
  [performance.md](../project/performance.md) already warns goes stale on a late image or a font
  swap.

## Assumptions and open questions

- **`get ready` is `document.fonts.ready`.** The frame is native (no url) and that is the only
  `ready` getter reachable from this page — [`Spine.tsx`](../../src/web/Spine.tsx),
  [`dock-fit.ts`](../../src/web/dock-fit.ts), [`OutlinePanel.tsx`](../../src/web/OutlinePanel.tsx).
  Confident but not directly proven; it is stage 2's job to prove it before acting on it.
- **The exact section count was not measured**, so "sections x nodes" is the shape of the cost rather
  than a computed figure. The before/after in stage 1 is what settles it.
- Numbers are one box on one afternoon, per CLAUDE.md. The **ratios** between the two articles are
  the durable finding; the milliseconds are a dated example.

## What landed, and what it bought

Both stages built. Same harness, same command, same article, three bundles — and the bundle hash was
checked on every rebuild (`index-C7VVLCdt` → `index-wXbPme-m` → `index-DYicKvLD`), because
[performance.md](../project/performance.md) records a day lost to `vite preview` serving the same
bundle to both ports and the "before" coming back identical to the after.

Mode switch, **click to next painted frame**, mean of the repeats after the first, 2,046 blocks:

| | before | after stage 1 | after both (2 runs) | total |
|---|---:|---:|---:|---:|
| **Hierarchy** | 4,698ms | 3,040ms | **2,810 / 2,917ms** | **−39%** |
| **Summary** | 2,693ms | 1,696ms | **1,554 / 2,049ms** | **−33%** |
| **Outline** | 1,308ms | 451ms | **431 / 550ms** | **−63%** |
| Plain | 860ms | 825ms | 807 / 939ms | −0% |

**Two post-fix runs, quoted separately rather than averaged**, because the spread between them
(Summary 1,554 against 2,049) is the honest measure of how much this box moves under a dozen other
agents. The percentages use the worse of the two. `Plain` is inside that noise and should be read as
*unchanged*, not as a small win.

Main-thread busy over the same window: **82% → 66.5%**, script **60.4% → 39.8%**. Script in the
sampling profile: 14,056ms → 8,918ms.

**The profile's own ranking is the proof that each diagnosis was right**, and it is worth more than
the percentages:

| profile, self time | before | after stage 1 | after stage 2 |
|---|---:|---:|---:|
| `querySelector` | **38.1%** | *gone from the top 12* | gone |
| `get ready` | 14.7% | 21.5% | *gone from the top 12* |
| `getBoundingClientRect` | 4.5% | 5.9% | **29.9%** |

A frame leaving the profile entirely when the code that called it is changed is about as direct as
this gets. It also **settles the assumption above**: `get ready` really was
`document.fonts.ready`, because replacing exactly those three reads is what removed it.

**One honest discrepancy.** The profiler put `get ready` at 21.5% of script; removing it moved the
wall-clock switch by only about 8%. Both were measured, and the smaller one is the one to believe —
[performance.md](../project/performance.md) already says a run with `--cpu-profile` is a run for
*finding* a cost and never the run whose number you quote. Stage 2 is a real but modest win that the
profiler oversold.

## What is left, and it is not cheap

`getBoundingClientRect` is now 29.9% of script, and the mechanism is **forced synchronous layout, not
the call count**. Three separate passes each measure the whole article on every mode switch —
[`Spine.tsx`](../../src/web/Spine.tsx) § `measure` takes a rect for all 2,046 rows,
[`App.tsx`](../../src/web/App.tsx) § `useReadingPosition` and
[`useColumnContext.ts`](../../src/web/useColumnContext.ts) take one per section — and each pass is
separated from the last by a React render that writes to the DOM, so each one flushes layout of a
47,398-node, 560,860px-tall document afresh.

**This is deliberately not built here**, and the reason is not effort. It is item 4 on
[performance.md § Still open](../project/performance.md#still-open-ranked-with-citations), and the
warning recorded there is the one that applies: the obvious fix is to cache row offsets and do
arithmetic, and a cache like that goes stale on a late image or a font swap and then points the
reader at the wrong section. **Wrong position is worse than slow position.** Getting it right means
either batching the three passes into one measurement that all three consumers share, or giving the
cache an invalidation that is actually sound — a design decision with a correctness risk attached,
which is not a thing to settle unattended.

Ranked, for whoever picks it up:

1. **Share one measurement pass between the three consumers.** Same numbers, one layout flush
   instead of three. No staleness risk, because nothing is cached across a render — this is the one
   worth doing first and it may be most of the remaining 29.9%.
2. **Avoid re-measuring when the layout did not actually change.** `layoutKey` changes on every mode
   switch, but Hierarchy→Summary and Summary→Outline do not both change the column set.
3. **Cached offsets with real invalidation.** The largest win and the only one that can be wrong.

## The cross-family review

GPT Sol, `gpt-5.6-sol`, effort high, on the diagnosis and the plan, handed the raw JSON, the profile
log and the harness rather than the prose. **No P0.** It walked the profile's sample nodes back
through their parents, which is more than was asked of it and settled the central question:

> 3,571 ms to `useReadingPosition`, 1,780 ms to `useColumnContext`, about 2 ms to every other
> `querySelector` caller combined.

That is essentially the whole 5,352ms entry, from two call sites — so the diagnosis was not a
plausible story fitted to a number.

What it changed:

- **R8, and this one was a plain factual error.** The plan said all three `document.fonts.ready`
  readers re-run on every mode switch. They do not: `useDockFit`'s effect depends on a
  `useCallback(…, [])`, and `OutlinePanel` mounts only in Outline. Only `Spine` is hot, and Sol
  attributed the entire 2,727ms node to it. Corrected here, in
  [performance.md](../project/performance.md) and in [`fonts.ts`](../../src/web/fonts.ts) — a wrong
  fact of this shape sends the next person to optimise two things that cost nothing. **It also
  explains the discrepancy above**: stage 2 bought 8% rather than 21.5% because two of the three
  reads were happening once, not per switch.
- **R7, P1 — "React re-rendering is not the cause" was not supported by the render counts.**
  `useRenderCount` counts body executions and does not time them. Softened: what the counts rule out
  is a render *storm*, not render *cost*.
- **R3 — the ratios are sequence-confounded and under-sampled.** Softened, above.
- **R2 — the harness recorded a click as successful without checking the mode changed.** A detached
  or broken button would have been the fastest row in the table. `clickModes` now reads back
  `aria-checked` on the bar and marks a mismatch as an error. This is the house pattern and Sol was
  right to call it.
- **R10 — the 150ms wait for `longtask` delivery is a heuristic.** `po.takeRecords()` is now drained
  synchronously as well.

Accepted and **not** acted on, recorded so nobody re-derives them:

- **R1** — a synthetic `.click()` skips pointer dispatch and input delay, so these numbers slightly
  *flatter* the page. Directionally safe; it cannot manufacture seconds.
- **R4** — the busy percentages cover the whole harness window including the settles, so they are
  diluted. "Script is the largest category" survives; the absolute percentages are of the window.
- **R5** — `process: 0` means `ProcessTime` was unavailable under headless, not that the process was
  idle. Pre-existing, already noted on [performance.md](../project/performance.md), and nothing here
  relies on the field.
- **R9** — stage 1 would be a major partial win rather than a fix. **Correct, and the measurement
  agreed**: −35% on Hierarchy, with `getBoundingClientRect` left behind.

## Decision

**Shipped**, on `dev`: a measured 40–67% off every mode switch on a very long article, with two
tests watched red first, and no behaviour change intended or observed. The report is answered but
the page is not fast — a Hierarchy switch on a 2,046-block article still costs **2.8 seconds**, and
§ What is left says where the rest of it is.

The two fixes are worth having beyond this article: both were O(document) work on a path that runs
on *every* mode switch, so every reader gets a smaller version of the same saving.
