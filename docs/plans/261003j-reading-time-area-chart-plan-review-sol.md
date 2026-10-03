The SVG step chart is a reasonable small version of the requested change. It reuses the existing geometry and adds no dependency. I would fix the boundary arithmetic and tighten the performance and validation parts before building. No files changed.

1. **F1 — P1, established: the reach formula violates the stated level invariant.**  
   At [plan line 38](/home/greg/code/spideryarn2/.claude/worktrees/fbjhe9mc-reading-time-area-chart/docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md:38), floating-point rounding can advance reach prematurely. Running the proposed formula against the real `readLevel`, with zero words:

   | Seconds / ratio | `readLevel` | Proposed reach | `floor(reach / 4)` |
   |---|---:|---:|---:|
   | `1.3999999999999997` | 2 | 12 | 3 |
   | `2.7999999999999994` | 3 | 16 | 4 |

   The exact four boundaries agree; the failure is immediately **below** them. An ordinary numerical sweep can miss this.

   Smallest fix: obtain the authoritative level from `readLevel`; return 0 or 16 for levels 0 and 4, otherwise clamp the logarithmic result to `[4 × level, 4 × level + 3]`. That correction passed 12,012 boundary probes and 30,000 ordinary ratio probes. Add tests at each boundary and its immediately neighbouring representable values; avoid adding a blanket epsilon.

2. **F2 — P2, established: the cost assessment overlooks full-table re-renders.**  
   Reach state updates occur in `OwnedReader`, which creates a fresh capability object in [ArticlePage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbjhe9mc-reading-time-area-chart/src/web/article/ArticlePage.tsx:559). Consequently, `Reader` re-renders. Its `selectProse` callback depends on the entire `owner` object in [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbjhe9mc-reading-time-area-chart/src/web/reader/Reader.tsx:2172), and is passed to `TableView`. That changing callback defeats the table’s shallow memo comparison on every reach update.

   This already happens on level changes; the plan increases its frequency. Visible slowdown is unmeasured, but the invalidation chain is established.

   Smallest fix: make that callback depend on the ownership boolean it actually uses, then verify a reach-only update leaves `TableView`’s render count unchanged. Correct the cost paragraph: the logarithmic steps also have varying elapsed-time intervals, rather than a fixed `~0.2`.

3. **F3 — P2, reasoned: the full-reach edge needs an explicit clipping policy.**  
   With the proposed right-hand edge at `x = 16`, a centred 1px stroke extends 0.5px beyond the full-width SVG. SVG viewport clipping and the enclosing `.spine`’s `overflow: hidden` would cut away that outer half. `non-scaling-stroke` preserves thickness through the unequal scaling; it does not prevent clipping. [SVG painting](https://www.w3.org/TR/SVG2/painting.html#VectorEffects), [SVG overflow](https://www.w3.org/TR/SVG2/render.html#OverflowAndClipProperties).

   Smallest fix: specify how the edge remains fully inside the rail at reach 16—for example, reserve half a CSS pixel on the right—and include a saturated stretch in the browser check.

4. **F4 — P2, established: the named tests omit the hook whose state contract changes.**  
   The stage names `tests/reading-time*.test.ts`, which does not include `tests/use-reading-time.test.tsx`. Pure reach tests and seeded Spine tests cannot verify the new state map.

   Add hook tests proving that reach changes **within an unchanged level**, while the `levels` map retains its identity; unchanged reach retains its identity; disabling and changing articles clear reach; and the opening GET combines correctly with local credit. In particular, the existing level-equality `continue` in `recompute` must not skip the independent reach calculation.

The remaining choices look sound. `preserveAspectRatio="none"` gives the intended independent horizontal and vertical scaling; a tall viewBox is not itself a huge rendered surface. [SVG coordinate transforms](https://www.w3.org/TR/SVG2/coords.html#ComputingAViewportsTransform). Quiz and gutter consumers can remain unchanged if their map and identity semantics are preserved.

Keeping the chart under `.spine-here` is a reasonable browser-tested starting point, though its 0.8 wash leaves only 20% of the underlying edge’s colour contribution. Check both themes, a long article, and active search/quote overlays. Update the old run-count/geometry assertions; retaining `.spine-read` and its tree position preserves the existing ordering checks, including the quote-strip test.

VERDICT: build after fixes