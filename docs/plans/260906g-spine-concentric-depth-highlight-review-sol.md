Verdict: the L2 design is technically sound and should keep the existing React render budget. The proposed paint position is correct. The plan needs revision in three places before implementation: the supplement case contradicts the mechanism, the stale-measure guarantee is overstated, and the performance argument against L3 is false.

## 1. DOM order and paint order

The conclusion is right.

The effective paint order is:

1. `.spine-part`
2. proposed `.spine-here`
3. `.spine-tick`
4. `.spine-matches` / `.spine-match`
5. `.spine-hit`
6. `.spine-viewport`

Although `.spine-match` is nested inside `.spine-matches`, the practical tree-order result is the same. With positioned elements and no intervening `z-index`, later content paints above earlier content.

Putting the fill on `.spine-hit[aria-current]` would paint it after search marks. A strong 0.8 fill would substantially obscure them. The existing hover wash already paints above search marks, but it is temporary and only 14%; that does not make an always-present 0.8 fill acceptable.

The proposed insertion point—after the L1 parts and before the L2 ticks—is exactly right. The hairlines should paint above the ring. Otherwise the ring would obscure its own top boundary and undermine the plan’s “one of these sections” rationale. See [Spine.tsx](/home/greg/code/spideryarn2/src/web/Spine.tsx:665) and [styles.css](/home/greg/code/spideryarn2/src/web/styles.css:1869).

The viewport remains topmost, as intended.

## 2. Render budget

“Zero new React renders” is correct.

`hereHit` already changes at L2 boundaries in the existing scroll effect, and the setter is guarded by a local ID mirror ([Spine.tsx](/home/greg/code/spideryarn2/src/web/Spine.tsx:472)). Adding one element derived from that state introduces:

- no new state;
- no new effect or listener;
- no setter on ordinary scroll frames;
- one small reconciliation during renders that already happen.

`hereHitId` is sufficient to recover the geometry because node IDs are unique within the current tree and `metrics.hits` contains the relevant band. A direct lookup is enough:

```ts
const hereRing =
  hereHitId === null
    ? null
    : metrics?.hits.find((b) => b.entry.node.id === hereHitId) ?? null;
```

A `useMemo` is unnecessary. Even if used, its dependencies would not themselves cause renders; they would only govern recomputation during existing renders.

The claim should be narrowed from “not a performance question” to “no additional React renders or scroll subscriptions.” There is still one extra painted layer and an O(number of hits) lookup during existing renders, but both are negligible at this rail’s size.

The current render-budget tests pass: 25 tests across `spine-scroll` and `spine-card`.

## 3. Childless parts and coincident geometry

Checking whether the hit ID is also present in `metrics.l1` works, but it is indirect and requires another scan.

The safer discriminator is already on `Band`: child bands have `parent`; L1 fallbacks do not. Use:

```ts
hereRing?.parent !== undefined
```

That directly expresses “this is a real L2 rather than an L1 standing in for its children” and is derived from the current `Metrics`, so it cannot drift from the construction in `measure`.

There is another coincident case the plan has not resolved: an L1 with exactly one L2 child. Because children partition their parent, that child has identical geometry. A leaf child covering its whole parent is explicitly permitted by the tree invariant for a one-block section ([tree-invariants.ts](/home/greg/code/spideryarn2/src/tree-invariants.ts:327)), and the existing spine-card fixture contains a one-child part.

If the rule is really “do not double-paint identical geometry,” skip both:

```ts
const distinctL2 =
  hereRing?.parent !== undefined && hereRing.parent.total > 1;
```

If single-child parts should still receive the stronger semantic L2 fill, the plan should say so explicitly.

There is also a direct contradiction around supplements:

- `buildOutline` always gives supplements `children: []` ([tree.ts](/home/greg/code/spideryarn2/src/web/tree.ts:433)).
- `measure` therefore always turns a supplement into an L1 fallback hit.
- The proposed childless-part rule skips its ring.
- Consequently, the planned `.spine-here.supplement` opacity can never be used.

Choose one policy. I recommend treating supplements like every other childless L1: no ring, with only the dimmed active L1 fill. Delete the proposed supplement-ring styling and wording from the plan.

## 4. Stale-measure guard

The guard works, but only after the new `metrics` object has committed.

The sequence after a completed measurement is safe:

1. New `metrics` commits.
2. `hereHit.metrics !== metrics`, so the ring disappears.
3. The scroll effect recomputes `hereHit`.
4. The ring returns using new geometry.

No old geometry can be selected from the new metrics during that sequence.

However, there can be an earlier stale frame:

1. A resize, mode-band change, `layoutKey` change, or outline replacement changes the page.
2. The new measurement is only scheduled through `requestAnimationFrame`.
3. Until it runs, both `metrics` and `hereHit.metrics` still reference the old object.
4. The guard passes and the old rail geometry—including the ring—may remain painted.

That is already true of the parts, ticks, matches, and viewport height. It is not introduced by this change, but the plan’s statement that a re-measure always yields “no ring for one frame” is too strong.

I would document that the ring inherits the existing rail’s pre-measure stale window, rather than expanding this ticket to version all metrics by `layoutKey`.

## 5. Existing machinery

Most surrounding mechanisms need no change:

- `armed`: independent. An open tooltip will receive updated `here` content on the existing L2 render; touch-open cards still close on scroll.
- `layoutKey` and the mode band: they trigger remeasurement correctly, subject to the stale window above.
- `?spine=0`: the entire component is unmounted, so there is no separate ring state to clean up.
- Search gutter: safe with the proposed order. Marks remain opaque and above the ring.
- Focus: the later `.spine-hit:focus-visible` outline remains above the ring.
- Accessibility: `aria-current="location"` already exposes exactly the visual fact being added. Do not add a live announcement or a second `aria-current`; continuous announcements while scrolling would be harmful. An empty decorative ring needs no accessible content, though `aria-hidden="true"` would make its intent explicit.

Two decisions are missing:

1. `data-nav-depth` remains `1`, so arrows over the spine step by L1 even though its strongest fill and click targets are L2. This mismatch already partly exists, because clicks land on L2, but the new visual makes it more conspicuous. I would retain L1 navigation for this ticket—the rail still shows the whole L1 structure—but update the explanatory comment and explicitly record the decision.

2. Very short L2s can produce a subpixel-height ring. Unlike hits, matches, and the viewport, the proposed ring has no `min-height`. Decide whether strict proportionality wins or whether the current section must remain at least 1px visible. The 95%-L1 fixture will not exercise this.

## 6. The L3 product call

Doing only L2 now is defensible. The plan’s technical rationale for rejecting L3 is not.

First, the viewport band does not mark the current paragraph. It marks the entire visible viewport. The paragraph containing the 35% reading line is somewhere inside that band along with several other paragraphs. An L3/leaf marker would convey additional information.

Second, an L3 marker does not require roughly 360 React renders. It can be another single imperative element updated by the existing scroll effect:

- precompute L3/row geometry during `measure`;
- add a ref;
- retain a local current-leaf ID alongside `hereId` and `hitId`;
- change its `top` and `height` only when the reading line crosses a leaf boundary.

No second listener or effect is required. Locating the leaf can use a sorted array/binary search, or search only within the current L2. That is cheap, though not literally free.

Third, “depth 3 is the paragraph level” is true of all thirteen current local trees—I verified that—but not of the code contract. The documentation explicitly allows leaf depth to vary from 3 to 5 ([granularity-zoom.md](/home/greg/code/spideryarn2/docs/project/granularity-zoom.md:313)), while `buildOutline(..., 3)` merely truncates the spine projection at depth 3 ([App.tsx](/home/greg/code/spideryarn2/src/web/App.tsx:1781)). A future depth-5 tree would have internal depth-3 nodes.

Keep L3 out of v1 if desired, but rewrite the reason to: L2 directly solves the reported problem; another fill in a 12px rail may add more visual noise than orientation; prototype it only if L2 proves insufficient. Performance and viewport equivalence are not valid reasons.

## 7. Test plan

The 95%-L1 fixture is a good product reproduction and an expected `.spine-here` assertion will go red before implementation because that element does not exist.

The wording “assert no ring is drawn today, then…” should not become two lasting assertions. The failing-first test should immediately express the desired result, be observed failing, and then pass after implementation.

The fixture should assert:

- exactly one ring;
- its geometry matches the current L2, not its L1;
- it moves on an L2 crossing;
- it corresponds to the button carrying `aria-current`;
- it disappears outside the article;
- no ring for an L1 fallback;
- the chosen behavior for a single-child L1;
- the resolved supplement behavior;
- DOM order: part → ring → tick → matches → hit → viewport;
- unchanged render counts.

The existing equal-sized fixture is already sufficient for most mechanism tests. The 95% fixture is chiefly valuable for the browser screenshot.

JSDOM will not catch:

- actual paint/stacking mistakes unless DOM order is asserted;
- opacity and contrast in either theme;
- search-mark legibility;
- subpixel bands;
- the pre-measure stale frame;
- browser paint cost;
- whether L1 keyboard stepping still feels coherent beside a strong L2 fill.

Those require the planned browser screenshots, ideally including search marks and one very short L2—not only the 95%-L1 and nine-part cases.