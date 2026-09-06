## Findings

1. **Moderate — `min-height: 2px` does not guarantee two visible pixels at the bottom of the track.**  
   [styles.css:1942](/home/greg/code/spideryarn2/.claude/worktrees/spine-concentric/src/web/styles.css:1942) fixes `top` and lets `min-height` grow downward. For the final L2, `.spine { overflow: hidden }` clips that growth at the rail’s bottom. A section occupying 0.5px at the end can therefore still show only 0.5px. For a short middle section, the two-pixel ring instead spills into the following section.

   Screenshot a very short **final** L2 and a short middle L2. If the final one vanishes, either clamp the ring inward or explicitly accept and document this edge exception.

2. **Low — the DOM-order test is weaker and more fragile than its comment claims.**  
   [spine-here.test.ts:269](/home/greg/code/spideryarn2/.claude/worktrees/spine-concentric/tests/spine-here.test.ts:269) uses the first whitespace-separated class and `indexOf`.

   - It proves the ring follows the **first** `.spine-part`, not all parts.
   - If a part becomes `className="active spine-part"`, `indexOf("spine-part")` becomes `-1` and the “after parts” assertion silently passes.
   - It does not pin the full stated `part → ring → tick → matches → hit → viewport` sequence.

   This is worth fixing now because the test exists specifically to protect an otherwise invisible paint-order contract. Select elements by `.matches()`/`classList`, assert they exist, and compare the ring against the last part and first element of each following layer.

3. **Low — two comments now misstate the implementation, and one CSS declaration is dead.**

   - [Spine.tsx:710](/home/greg/code/spideryarn2/.claude/worktrees/spine-concentric/src/web/Spine.tsx:710) still says the L2 targets are merely a pointing concession and not what the rail is about. The new strongest fill is expressly L2; the corrected plan required this comment to be updated.
   - [styles.css:1911](/home/greg/code/spideryarn2/.claude/worktrees/spine-concentric/src/web/styles.css:1911) says “Fill means which section,” although the quieter active-part fill still means current L1. “Nested fills mean current part and section” would be accurate.
   - [styles.css:1881](/home/greg/code/spideryarn2/.claude/worktrees/spine-concentric/src/web/styles.css:1881) still transitions the part’s `background`, but no active rule changes that background anymore. Remove it, or move a transition to `::before`’s opacity if the tint should animate.

## Answers

1. **The discriminator is correct for valid article trees.** The truthy optional-chain check narrows `hereBand` and `parent`; `hereRing` is inferred as `Band | null`, not `Band | undefined`. The compiler reports no Spine error.

   With several nonempty children that exactly partition an inclusive parent range, one child cannot span the whole parent: the siblings would necessarily overlap. Only malformed outline data could violate that. A one-child L2 is genuine structurally but deliberately skipped because valid geometry is identical to its parent.

2. **The JSX order is correct:** all parts, ring, all ticks, search layer, hits, viewport. The ring therefore paints over the part and under its own top tick and search marks. The test should nevertheless be strengthened as above.

3. **React render count stays flat, but absolute work does not.** The new code adds no state, effect, listener, setter, or layout read. The `.find` runs on every existing `SpineInner` render—including tooltip/focus renders, not only section crossings—and never on ordinary scroll frames without a render. It adds one `O(hits)` scan, one React element/reconciliation path, and one painted layer. The existing scroll fixture does contain multiple L2s, so it is suitable for pinning renders per crossing.

4. **The ring’s top hairline exists.** Every L2 receives a tick at its own `top`; it is not relying only on the following section’s tick. Because ticks render later, the current section’s tick paints over the ring at the same percentage coordinate. Whether `var(--rule)` remains visually distinct over the 0.8 fill is still a screenshot question. The `min-height` bottom behavior has the clipping caveat above.

5. **Element opacity is safe here.** It creates a stacking context, but the ring is empty and has only a background, so opacity affects nothing else. The later sibling layers still paint above it. Supplement dimming is unaffected because supplements never get a ring. The only inconsistency with consequences is the now-unused part-background transition.

6. **Still worth checking:**

   - Screenshots can settle dark/light contrast, whether the part remains readable, tick visibility, search-mark legibility, and short middle/final L2 paint and clipping.
   - Hover/focus screenshots or interaction can settle whether those states remain distinct.
   - Screenshots cannot settle render counts, forced layout, paint cost, the pre-measure stale frame, accessibility semantics, or keyboard-navigation coherence. Those need tests, a performance trace/frame capture, accessibility-tree inspection, and keyboard interaction respectively.
   - The new jsdom tests also do not prove that `.spine-here` has any effective CSS at all; deleting its CSS leaves the structural assertions green.

## Verification

- `tests/spine-here.test.ts`: independently rerun, **9/9 passed**.
- TypeScript: independently reproduced exactly the two stated unrelated dock-fixture errors.
- `HEAD`, local `dev`, and `origin/dev` are the same commit, so the errors are pre-existing relative to this scoped change.
- The required property was introduced by ancestor commit `bea197dc`, not literally by `9e348d34`; describing it as the other agent’s `9e348d34` work is substantively right but imprecise.
- My independent six-file rerun was also terminated by the busy box, without an assertion failure, so there remains no new clean full-suite result.
- No visual approval is possible until the browser pass returns.

No files were edited.