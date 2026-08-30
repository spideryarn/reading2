Verdict: **BLOCK COMMIT** on findings 1–4. The two requested test files pass—52 tests—but several green tests miss the broken paths.

1. **BLOCKER — outgoing scroll correction applies the inverse incorrectly**

**What:** `a.ty += dy` is correct for `"in"`, but `"out"` then inverts that adjusted anchor, producing `-dy / s`. The required outgoing correction is `+dy` after inversion.

**Where:** [SketchView.tsx:410](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:410), [sketch-zoom-and-peek.test.tsx:468](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/sketch-zoom-and-peek.test.tsx:468)

**Why:** With the real first region, `s ≈ 0.2769`. If Back changes scroll by 100px at 0.4px/unit, the raw outgoing translation is `-541.7`; it should become `-291.7`. The code produces `-1444.4`. The overview can enter from far above the intended region.

The test composes uncorrected transforms because jsdom’s `clientWidth` is zero. It never reaches this arithmetic.

It also records only the old pixels-per-unit. When a scrollbar disappears, the new SVG becomes wider, so the claimed equal unit scale no longer holds. A later browser scroll-anchoring adjustment would likewise escape the single layout-effect measurement.

**Do instead:** Prefer a pixel-space FLIP based on pre/post-swap rectangles. If retaining canvas units, read both old and new scales and build direction-specific matrices. Add non-zero-width, changed-scroll tests for both directions and a scrollbar-changing browser case.

2. **BLOCKER — the lower scale clamp breaks “contain”**

**What:** `Math.max(0.12, raw)` enlarges scenes beyond small source boxes.

**Where:** [sketch-paint.ts:813](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-paint.ts:813), [sketch-paint.test.ts:591](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/sketch-paint.test.ts:591)

**Why:** A 150×60 opening node targeting a 650-high scene has `raw ≈ 0.092`; clamping to `0.12` makes the thumbnail 78 units high, outside the node. The test named “never starts so small” passes precisely while violating the contain contract. This is the clearest additional test that is green for the wrong reason.

**Do instead:** If `raw < 0.12`, decline the anchor and fade. Alternatively accept the smaller scale. Sweep box sizes and assert every non-null anchor is fully contained.

3. **BLOCKER — animation ownership still does not cover reloads or surface remounts**

**What:** The active `Animation` exists only in the layout-effect closure. It is cancelled on another `nav`, but not when `sketch` changes or Enlarge/Close replaces `.sk-stage`.

**Where:** [SketchView.tsx:312](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:312), [SketchView.tsx:390](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:390), [SketchView.tsx:995](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:995)

**Why:** A reload during the 280ms leaves the reused stage wearing the old scene’s transform while its contents change. Enlarge/Close removes the animated node, but the detached animation remains retained until another navigation or component unmount.

Detail→detail is correctly unanchored, including a nested region carrying `opens`. A second navigation also correctly cancels the previous run. StrictMode’s initial extra effect pass sees `nav === 0`; the uncovered problem is invalidation outside `nav`.

**Do instead:** Keep an active-animation ref plus generation number. Cancel it when the sketch or stage surface changes. Test reload and Enlarge/Close during a never-finishing animation.

4. **BLOCKER — region keys still leak into browser scrolling**

**What:** Arrow/Home/End call `stopPropagation()` but not `preventDefault()`.

**Where:** [SketchView.tsx:864](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:864)

**Why:** The keys no longer move the hidden listbox marker, but their browser default can scroll `.sk-scroll` or the page. The plan’s claim that key leakage was fixed is therefore only partly true—and the new behaviour can move the picture instead.

**Do instead:** Also call `preventDefault()`. Test a genuinely focused region and assert both `defaultPrevented` and unchanged listbox selection.

5. **HIGH — forward focus works, but its test does not prove the keyboard path, and Back still loses focus**

**What:** The forward flag and updated listbox label are logically sound, but the test clicks a region that was never focused. Separately, the focused Back button unmounts without requesting a focus destination.

**Where:** [SketchView.tsx:453](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:453), [SketchView.tsx:655](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:655), [sketch-zoom-and-peek.test.tsx:398](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/sketch-zoom-and-peek.test.tsx:398)

**Why:** The existing assertion passes because every region click sets `takeFocus`, not because focus survived an activated, unmounting control. Keyboard Back still falls to the body. `useEffect` also permits a brief body-focus interval before restoring focus.

**Do instead:** Focus the region, activate it with Enter/Space, and test the announcement destination. Generalize the focus request to Back and use a layout effect if the body-focus interlude is observable.

6. **HIGH — the peek is not quite “the real painting with only words removed”**

**What:** Three details contradict that claim:

- Opening-region labels are withheld from `front`; therefore their non-text corner marks are omitted from the nested rendering.
- Hiding edge-label text leaves its page-coloured label plate behind as a blank hole.
- `.sk-note-fold` is a stroke but lacks `non-scaling-stroke`.

**Where:** [sketch-paint.ts:531](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-paint.ts:531), [sketch-paint.ts:887](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-paint.ts:887), [SketchView.tsx:964](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/SketchView.tsx:964), [styles.css:8151](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8151)

**Why:** Labelled edges can show unexplained blank rectangles, while nested doors lose visible non-text paint. Tests use no labelled edge and mostly assert class counts; they would not detect the simplified-shape regression the prior review named. The real fixture also activates only the first inferred door, leaving the diamond-bearing second target unverified.

**Do instead:** Define explicitly which primitives form a thumbnail: omit text and its plates, retain non-text region-label primitives, and cover every stroked primitive. Test bands, diamond/hex/note, dashed edges, a labelled edge, and both inferred doors.

The browser mechanisms themselves are sound: nested SVGs are clipped by the UA stylesheet, `pointer-events` is inherited, and non-scaling strokes are calculated in the outer host viewport. [SVG rendering](https://svgwg.org/svg2-draft/render.html), [CSS pointer events](https://drafts.csswg.org/css-ui-4/#pointer-events-control), [SVG vector effects](https://svgwg.org/svg2-draft/painting.html#VectorEffects)

7. **MEDIUM — the mark is improved, but the stack remains unproven and can leave the canvas**

**What:** The corner mark now standardizes all four region styles, which substantially answers my earlier concern for the real corpus. It still excludes opening nodes and narrow regions by design. The stack’s `y + 5` is never clamped to scene height; its test claims “never off canvas” while checking only the x-axis.

**Where:** [sketch-paint.ts:609](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-paint.ts:609), [sketch-paint.test.ts:441](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/sketch-paint.test.ts:441)

**Why:** A full-width region touching the bottom has zero horizontal offset and its vertical sliver clipped away, so the stack silently vanishes. At 288px, the 12-unit corner is roughly 4.5px and the five-unit stack offset roughly 1.9px: it may still read as punctuation plus a shadow.

**Do instead:** Clamp the vertical offset using scene height or omit the stack when neither axis can show it. At 288px, check whether the corner remains recognizable, whether the stack reads as depth rather than shadow, dashed/full-width cases, focus-ring coverage, light/dark contrast, and whether the peek’s scrim looks like a glitch.

This last perceptual judgment is my **least-confident finding**. The arithmetic and lifecycle findings are firm.