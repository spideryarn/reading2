Verdict: **do not build the plan as written**. The state-first navigation decision is right, but the anchored zoom, peek, and accessibility model need revision first. I would drop the peek from the first build.

One caveat: `SketchView.tsx`, `sketch-paint.ts`, and later `styles.css` changed concurrently after I read the requested baseline. This is a review of the plan and original code, not those in-progress edits. I made no changes.

1. **BLOCKER — the anchor transform cannot map the real scenes to their regions**

**What:** `translate(rx, ry) scale(rw/760)` matches width only. It cannot make a scene “exactly fill” an arbitrary region without distortion unless their aspect ratios match.

**Where:** [plan § The zoom](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/sketch-zoomable-subsections.md:108), and the real [first region](/Users/greg/Dropbox/dev/experim/spideryarn2/data/noema-mythology-of-conscious-ai/sketch.json:24), [first target](/Users/greg/Dropbox/dev/experim/spideryarn2/data/noema-mythology-of-conscious-ai/sketch.json:343), [second region](/Users/greg/Dropbox/dev/experim/spideryarn2/data/noema-mythology-of-conscious-ai/sketch.json:92), and [second target](/Users/greg/Dropbox/dev/experim/spideryarn2/data/noema-mythology-of-conscious-ai/sketch.json:546).

**Why it matters:** The 712×180 first region opens a 760×650 scene. The proposed scale produces about 712×609, not 712×180. The second produces about 712×487 inside a 712×170 region. Scene heights and the SVG’s layout height also change, so shared `CANVAS_W` does not preserve the on-screen vertical anchor or scroll position.

The outgoing transform is not merely “scale about the box.” With origin zero, the exact inverse of `translate(tx,ty) scale(s)` includes translation: `matrix(1/s,0,0,1/s,-tx/s,-ty/s)`. SVG does not implicitly choose the pressed region as the origin: non-root SVG elements use `0 0`, and `transform-box` initially references the view box. [CSS Transforms specification](https://drafts.csswg.org/css-transforms/).

**What to do instead:** Choose explicitly between:

- A measured pixel-space FLIP transition using the pressed element’s `getBoundingClientRect()`, while temporarily preserving the outgoing scroll position and container height.
- A contained thumbnail: `s = min(rw/760, rh/targetHeight)`, centred inside the region, with explicit clipping and explicit matrices.
- The cheaper honest version: an unanchored directional scale/fade.

Test both real Noema regions. The proposed “maps the full canvas onto the region rectangle” assertion should currently be impossible to satisfy without distortion.

2. **BLOCKER — no planned test observes the animation, and the transition lifecycle is incomplete**

**What:** Every planned jsdom test takes the `Element.animate`-missing path. That proves navigation survives without animation; it provides no evidence that the zoom ever runs correctly.

**Where:** [plan § swap first and Tests](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/sketch-zoomable-subsections.md:134), the modal remount in `SketchView.tsx`, and production’s [StrictMode root](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/main.tsx:182).

**Why it matters:** The plan does not define one owner for the active animation or cover:

- A second scene change or Back during the 280ms transition.
- Region-to-region navigation. Back still means overview, so an anchor taken from another detail scene does not belong to the overview.
- Enlarge/Close replacing the animated DOM node.
- StrictMode’s setup/cleanup/setup cycle.
- A tall overview being scrolled, then replaced by a shorter SVG that clamps `scrollTop` and may remove its scrollbar.
- Restoring the overview’s previous scroll before Back finishes at its region.

Canceling Web Animations also rejects their `finished` promise, so any promise observation must handle cancellation. [Web Animations specification](https://www.w3.org/TR/web-animations-1/).

**What to do instead:** Keep the state-first navigation, but add:

- One `Animation` ref and transition generation number; cancel the prior animation before starting another.
- An anchor scoped to `{fromScene, toScene, surface, overviewScrollTop}`.
- Anchored animation only for overview ↔ detail. Detail ↔ detail and scene-row changes should clear the anchor and fade.
- Explicit invalidation when band/modal DOM ownership changes.
- A controllable `animate` stub test, a `<StrictMode>` test, and browser checks for mid-flight Back, scene change, Enlarge/Close, and a scrolled real artefact.

3. **BLOCKER — the peek redraws a different diagram and lacks a viable layer**

**What:** The claim that it “cannot claim a structure the zoom scene does not have” is too strong. It discards shapes, direction, line style, routing, regions, paths, labels, and potentially the visual grouping that made the scene meaningful.

**Where:** [plan § The peek](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/sketch-zoomable-subsections.md:73), [diagram.md § The shapes make claims](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:1426), and `Painted`’s `behind / links / nodes / front` layering in `sketch-paint.ts`.

**Why it matters:** In the real target scenes:

- “Why We’re Tempted” uses two `band` regions to express parallel tracks.
- The other target begins with a diamond.
- Dashed, directed edges distinguish worked examples from the main convergence.

The proposed ghost turns these into rounded rectangles and undirected straight hairlines. Straight centre lines can also cross intervening boxes and create apparent junctions. That is not a literal thumbnail.

The layering is also unresolved. A scrim must sit above the overview’s nodes and links, while the live region label remains visible and pressable. The current four layers have no such slot. “Nothing about it goes in `SketchView`” cannot be true: the view must own hover/focus state, select the target scene, and place the overlay.

**What to do instead:** Drop the peek from the first build. On region hover/focus, put the target scene’s title and caption in the existing card and accessible description.

If a visual peek remains essential, render the real `paintScene` output in a clipped nested viewport, preserving shapes, regions, line styles and arrowheads while omitting only unreadable text. Do not create a second simplified graph painter.

4. **BLOCKER — the region button conflicts with the listbox and loses focus on navigation**

**What:** The SVG claims to be one listbox tab stop, but zoomable region labels are separately focusable `button` descendants.

**Where:** [diagram.md § Interaction](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/diagram.md:1416), `SketchView.tsx`’s SVG listbox and region-label groups, and [plan § peek focus](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/sketch-zoomable-subsections.md:75).

**Why it matters:** A listbox is expected to own `option` or `group → option` descendants; its interaction model does not support embedded interactive controls. [WAI-ARIA listbox specification](https://www.w3.org/TR/wai-aria/#listbox), [WAI listbox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/).

Concretely:

- The picture now has multiple tab stops.
- Arrow keys on a focused region button can bubble into the node listbox handler.
- Activating the region removes the focused SVG group, with no focus destination or scene-change announcement.
- A visual focus peek tells a screen reader nothing about the destination.

**What to do instead:** Either include zoomable regions in the listbox’s existing active-descendant sequence, or move actual region controls outside the listbox. Keep DOM focus on the SVG—or deliberately move it to the new scene—and announce the destination scene title. The peek and animation should be `aria-hidden`; announce navigation, not decoration.

`prefers-reduced-motion` is sufficient for one short optional transition. I would not add an app-specific motion switch yet. Touch should remain one tap to open; the peek must never be required.

5. **HIGH — the stack is neither universal nor yet shown to mean “zoom”**

**What:** An offset duplicate is likely to read as a shadow, registration error, or multiplicity. It is especially noisy for a dashed outline. It also disappears entirely for `plain`, `bracket`, and an opening node with `shape: "bare"`.

**Where:** [plan § The mark](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/sketch-zoomable-subsections.md:40) and the allowed [node and region styles](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:82).

**Why it matters:** The primary affordance would depend on model-selected presentation. The corner “expand” mark also duplicates the vocabulary of the existing Enlarge modal, although this action changes scenes rather than enlarging the same scene. Geometry tests cannot establish that either signal survives at 288px or means the intended thing.

**What to do instead:** Prototype one standardized piece of control chrome independent of region style and node shape—for example, a deliberately large portal/corner treatment adjacent to the pressable label, with a non-scaling stroke. Use it for all four region styles and bare nodes. Treat the stack as an optional secondary treatment only if it proves useful.

This should be checked on the real artefact at 288px and 400px before committing to the motif.

6. **HIGH — the specified acceptance case is absent from the test plan**

**What:** The real artefact contains zero `opens`; both useful doors arise only after `readSketch` inference. The proposed tests can all pass using hand-authored explicit `opens`.

**Where:** [plan § Tests](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/sketch-zoomable-subsections.md:173) and [the real artefact](/Users/greg/Dropbox/dev/experim/spideryarn2/data/noema-mythology-of-conscious-ai/sketch.json:1).

**Why it matters:** This is the repository’s documented “corpus missing the field” silent-success pattern. The implementation could work perfectly on synthetic explicit doors while the article Greg actually pressed remains unchanged.

**What to do instead:** Add an end-to-end fixture test that:

- Starts from raw JSON with zero `opens`.
- Runs it through `readSketch` using the real block order.
- Verifies both inferred overview regions receive exactly the same mark and interaction as explicit doors.
- Opens each expected target through the rendered region label.
- Exercises the accessible description and reduced-motion path.

My least-confident finding is **#5, the mark’s visual meaning**. It is a perceptual judgment and should be checked first with an at-scale spike. The arithmetic, lifecycle, layering, accessibility, and missing-fixture findings are considerably firmer.

My 80–20 version would ship the universal mark, target title/caption on hover or focus, and state-first navigation with a modest scale/fade. I would drop the peek and defer spatially anchored zoom until its pixel geometry and scroll behavior are demonstrated in the real panel.