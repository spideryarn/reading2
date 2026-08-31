# Review: the code for making Sketch's sub-diagrams visibly zoomable

You are reviewing **built code** in the spideryarn2 repository at
/Users/greg/Dropbox/dev/experim/spideryarn2. Read-only; do not edit files.

**You reviewed the plan for this a few hours ago and said "do not build as
written", with four blockers.** Your review is at
`docs/plans/260830ap-sketch-zoomable-subsections-review-sol.md`. Three of your blockers
were taken and the code below is the result; the fourth (#5, the mark) was
partly taken. `docs/plans/260830ap-sketch-zoomable-subsections.md`
§ "What GPT Sol's review changed" says what happened to each, including what was
NOT taken and why. **Check that section against the code**: if it claims a
finding was addressed and it was not, that is the most valuable thing you can
find here.

Weight this as a code review. The plan-stage review could not see a `useRef`
read at the wrong moment or a keyframe that composes to the wrong matrix; those
bugs did not exist yet.

## Read, in this order

1. `docs/plans/260830ap-sketch-zoomable-subsections.md` — the plan as it now stands.
2. The diff of what was built: `/tmp/sketch-zoom.diff` (also just read the files).
3. `src/sketch-paint.ts` — the pure half. `paintRegion` (the stack and the corner
   mark), `peekViewport`, `PEEK_LABEL_STRIP`, `zoomAnchor`, `anchorTransform`.
4. `src/web/SketchView.tsx` — `goTo`, the `useLayoutEffect` that runs the
   entrance, the focus effect, the region-label group, the peek rendering.
5. `src/web/styles.css` § sketch — search for `a part that opens`.
6. `tests/sketch-paint.test.ts` (the last three describes) and
   `tests/sketch-zoom-and-peek.test.tsx` (all of it).
7. `tests/fixtures/sketch-noema.json` — a copy of the real artefact, which
   carries no `opens` at all; both doors are inferred by `readSketch`.
8. `CLAUDE.md` and `docs/reusable/silent-success.md`.

## What I most want you to attack

1. **The zoom's arithmetic and lifecycle**, which is where your blockers were.
   - `zoomAnchor` is now *contain, centred*: `s = min(box.w/CANVAS_W, box.h/sceneHeight)`,
     clamped to [0.12, 0.9], declining above 0.9. `anchorTransform(a, "out")` is
     meant to be the exact inverse of `"in"`. Verify the algebra, and verify the
     test that checks it is checking the right composition rather than a
     plausible-looking one.
   - The **scroll correction**: `goTo` records `scrollTop` and
     `svg.clientWidth / CANVAS_W` *before* the swap; the layout effect reads the
     new `scrollTop` and shifts `a.ty` by the delta in canvas units. Is that the
     right sign? Is it right for the "out" direction, where the transform is
     inverted after the shift? What happens when the container has no
     scrollbar, when `clientWidth` is stale, or when the swap changes the
     element's height and the browser clamps asynchronously?
   - The **anchor is taken only when `open === null`** at press time. Confirm
     that closes the detail-to-detail hole you named, including the path where a
     node inside a detail scene carries an `opens`.
   - The effect is keyed on a `nav` counter with the anchor in a ref. Walk
     StrictMode, a `sketch` reload mid-flight, Enlarge/Close remounting the body
     (`{full && <div className="sk sk-in-full">{body}</div>}`), and a press
     during the 280ms.

2. **The peek.** It is now `paintScene`'s real output in a nested `<svg>` with
   `viewBox` and `preserveAspectRatio="xMidYMid meet"`, over a scrim, with
   `.sk-peek text { display: none }` and `vector-effect: non-scaling-stroke`.
   Is that honest now, or does something else still lie? Does the nested
   viewport clip the way I claim? Is `pointer-events: none` on the group
   sufficient to stop the hover fighting itself? Does `non-scaling-stroke`
   inside a nested viewport do what I think?

3. **The focus move.** Pressing a region's label opens a scene where that label
   does not exist, so the focused element unmounts; a `useEffect` keyed on `nav`
   then calls `svg.current?.focus()` when a flag is set. Is an effect the right
   place, is the flag reset correctly, and does focusing the listbox actually
   announce the new scene (its `aria-label` is the scene title and caption)?
   The region group also now swallows Arrow/Home/End so they do not reach the
   listbox behind it. Is anything else leaking?

4. **The tests, adversarially.** 23 mutations were run against them and all 23
   went red — but one was green on the first pass (clearing the peek), because
   the fixture's zoom scene had no regions and a stale index was harmless by
   accident. **Find another test of that shape**: one that passes for a reason
   other than the one it claims. In particular the animation tests, which stub
   `Element.animate` and read the first keyframe's `transform` string.

5. **The mark, which is your finding #5 and the one you were least sure of.**
   What shipped: the stack *and* a corner mark that is now universal across all
   four region styles, sits inside the label's own hit box (so pressing the mark
   presses the name), is dropped when the region is too narrow, and uses
   `non-scaling-stroke` so it is the same weight in a 288px band as at full
   screen. Nodes that `opens` got nothing new. Is that enough of your
   "standardized control chrome", or is the stack still the wrong motif? A
   browser check at 288px has not been done yet — say what you would look for.

6. **Anything that is worse than before.** This adds an animation, an overlay
   and a focus move to a panel that had none of them. Name anything that could
   make the picture harder to use, slower, or wrong in a state I have not
   listed.

## Answer format

For each finding: **what**, **where** (file and line), **why it matters**, and
**what to do instead**. Rank them, most serious first, and say which you would
block a commit on. Say which of your findings you are least confident in.
