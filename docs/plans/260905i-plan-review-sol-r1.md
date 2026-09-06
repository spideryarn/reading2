Do not build from this plan yet. Its direction is good, but three established contract gaps can produce a confident “defer” while the costly path remains.

## Findings

**F1 — P1 — streamed deltas still re-resolve every anchor**

- File/symbol: [candidate plan § Stage 2 `anchorsByBlock`](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:143), [`useComments.send` delta branch](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/useComments.ts:457), [`TableView.marksByBlock`](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/TableView.tsx:457)
- Established from source. `anchorsByBlock` is planned to depend on `comments`, but every streamed delta replaces both the comment object and the comments array. Removing `openComment` from the dependency list therefore fixes selection, not streaming: `resolveMark` still runs for every comment, and a fresh grouped map can still wake `proseHtml`.
- This directly violates the parent requirement that resolution depend only on HTML or anchor changes and the plan’s own “a delta that leaves the anchor alone must cost nothing.”
- Smallest change: specify a bounded reconciliation cache keyed by semantic anchor inputs—identity, block ID, quote, start, and the block-content generation—not by the comment object. Preserve the previous grouped map and per-block arrays when no anchor was added, removed, or changed. Require a streamed-body-only delta to produce zero `resolveMark`, `renderedText`, `annotateHtml`, zoom parses, and prose mutations.

**F2 — P1 — the timing described does not identify annotation time**

- File/symbol: [candidate plan § Wall clock](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:114)
- The counters measure calls, while “`performance.now()` around each gesture” measures an unspecified interval. If it ends when `click()` returns, it can omit React completion and paint and report a comfortable false result. If it waits for the visible result, it also includes search resolution, scrolling, layout, geometry, and panel work and can blame annotation for an alarming total it did not cause.
- The fallback is not decision-grade either: `annotateHtml` cost varies with HTML size, text-node count, number and overlap of marks, and mark positions. Multiplying one average by a call count loses that distribution and omits the map/spread/block-loop work.
- Smallest change: define two separate production-build measurements:

  1. In-page event dispatch through the second painted frame, using the established click probe’s two-`requestAnimationFrame` boundary.
  2. Accumulated time around the actual `marksByBlock` and `proseHtml` computations, with their leaf-function counts.

  Apply the decision to attributable annotation time while reporting end-to-end latency beside it. Treat the scalar microbenchmark fallback as diagnostic only unless it replays the exact recorded inputs.

**F3 — P2 — the thresholds are applied to the wrong unit**

- File/symbol: [candidate plan § Decision rule](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:49)
- Sixteen milliseconds is a complete 60Hz frame, not a budget for one subsystem. Fifteen milliseconds of annotation plus ordinary React/layout work can miss a frame while this rule says defer. It is also already more than one frame at 120Hz.
- Eight milliseconds per delta ignores cadence. Seven milliseconds at 30 deltas/second occupies 210ms of the main thread each second but is deferred; nine milliseconds twice a second triggers optimisation despite being much less consequential.
- Smallest change: make gesture decisions from total action-to-paint plus annotation’s attributable share. For streaming, measure the real or faithfully replayed delta cadence and report total annotation milliseconds per second and worst/p95 delta time; precommit the acceptable duty-cycle/headroom rather than only a per-delta cutoff.

**F4 — P1 — the fixture matrix omits the workload that controls the answer**

- File/symbol: [candidate plan § Fixture matrix](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:101)
- Established partly by running a corpus inventory. The largest committed glossary has 19 entries referring to 42 distinct blocks. The only comments fixture has three comments, one deliberately naming an invalid block, leaving two resolvable anchors. That does not satisfy the parent checklist’s “many comments and overlapping glossary/search marks.”
- Repeating blocks under fresh IDs without explicitly remapping glossary block lists makes almost every clone unmarked, so it takes `annotateHtml`’s fast path. It would strongly bias the result toward defer.
- Merely changing `Block.id` also leaves the old root ID inside `block.html` and leaves tree ranges, note references, and internal links naming the originals. The row/prose count guard can still pass over this malformed article.
- Smallest change: define separate workload cohorts—long/unmarked, long/many anchors, long/dense glossary, and long/overlapping comment+term+hit marks. The clone helper must remap and validate block IDs in block objects, root HTML IDs, tree nodes/ranges, glossary occurrences, comment/chat anchors, and supplied search marks. Assert the number of resolvable anchors, marked blocks, figures, and overlaps before timing.

**F5 — P2 — the `TableView` bench cannot drive several claimed gestures**

- File/symbol: [candidate plan § Bench](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:95), [`TableView` props](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/TableView.tsx:108)
- `TableView` contains no find box or glossary panel, does not own the comment stream, and has no “scroll prop.” Direct `root.render` calls can model prop transitions, but they cannot prove the real gesture changed those props or that the timing window includes the upstream work.
- StrictMode adds another count trap: the copied test mounts `TableView` directly without StrictMode, while the development app uses it. Production does not double-invoke in the same way, so exact dev/test counts are not comparable.
- Smallest change: call this a prop-transition bench and list exactly what it models. Pair it with production-app browser gestures that assert an observable before/after state as well as counters. Reset after the settled mount, use only zero/nonzero invariants in the unit bench, and never apply the timing rule to a development/StrictMode count.

**F6 — P2 — directly sharing `search-hits.pages` risks turning sparse parsing into an eager article parse**

- File/symbol: [candidate plan § shared rendered-text cache](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:139), [`search-hits.page`](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/search-hits.ts:456)
- The current `page()` eagerly executes `blocks.map(renderedText)`. Comments and `termMarks` are sparse: they currently parse only blocks named by anchors or glossary occurrences. Having either consumer obtain text through `page()` would make the first annotation on a 2,046-block article parse all 2,046 blocks.
- Smallest change: make the shared owner a lazy per-block rendered-text cache under the blocks-array `WeakMap`. `page()` may fill every entry because search needs them all; comments and terms should request only their named blocks. Leave search-specific `index`, `scale`, and folding caches in `search-hits.ts`.

**F7 — P2 — the per-block reuse keys would still miss broadly**

- File/symbol: [candidate plan § bounded per-block reuse](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:146), [`TableView.proseHtml`](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/TableView.tsx:568)
- Treating global `openTerm` as a block input invalidates every block whenever the selected term changes, even though only blocks containing the old or new term need different output.
- `hitMarks()` also creates fresh maps and arrays when the open result changes. An identity comparison would therefore miss every hit-bearing block, not just the old and new selected hit. The composite `marks` array inside `proseHtml` is freshly allocated on every pass and cannot itself be a reuse key.
- Smallest change: specify the equality contract. Cache the source per-block arrays before concatenation, plus only the effective selected flags relevant to that block. Preserve or reconcile hit arrays so an open-result change touches only blocks containing the previous or next result. Continue recomputing one block from all mark kinds together so overlapping ranges retain their shared `<mark>`.

**F8 — P1 — the required changed-glossary-entry regression is absent**

- File/symbol: [candidate plan § Stage 2 correctness set](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:152), [parent A7 acceptance](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905e-main-app-architecture-review.md:407)
- Established from the two documents. The parent explicitly requires a changed glossary entry to update its block; the candidate lists only selection, overlaps, figures, note return, removal, article, and access changes.
- Smallest change: add a red regression that changes an entry’s forms and occurrence blocks while `article.blocks` remains stable. Assert that the old underline disappears, the new one appears, an overlapping comment/search still shares the resulting `<mark>`, and only affected prose nodes change.

**F9 — P2 — unconditional counters are unnecessary permanent instrumentation**

- File/symbol: [candidate plan § Instrument](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/docs/plans/260905i-measure-annotation-computation-before-optimising-it.md:86), [`perf.ts` off-state contract](/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure/src/web/perf.ts:1)
- An integer increment is small, not free. More importantly, the browser still needs `?perf=1` before `window.__perf` exists, so unconditional increments do not prevent that browser failure. The changed-input control is what proves the instrument is active.
- Smallest change: enable counters when `startPerf()` or the bench explicitly resets/enables them, and require the positive control to move every counter being trusted. If keeping them unconditional, measure their overhead and state why every production reader should retain them after A7.

## What is sound

The blocks-array identity is a sound outer invalidation key given the documented immutability contract. Rebuilding the existing cache into a fresh map correctly evicts removed blocks. Reusing completed HTML preserves overlap semantics, note-return behavior, and figure handles provided any changed mark kind recomputes the block from all marks together. Article/access-change coverage, DOM identity checks, and browser verification are also the right safeguards.

I ran the committed-corpus inventory described in F4 and the existing `tests/prose-not-rebuilt.test.tsx`; the latter passed both tests. No files were changed.

**Verdict: do not proceed.** Revise F1, F2, F4, and F8 before Stage 1; the remaining findings can be settled in the same edit.