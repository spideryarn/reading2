# Sketch: saying that a part opens, and showing what is inside it

> In the Sketch Diagram, we have sub-diagrams for particular sub-sections. Could
> we make it clearer in the main diagram that some sub-sections are zoomable,
> and ideally even show some kind of zooming animation in/out and even
> show/hint in the main diagram the structure within the sub-section?
>
> — Greg, 2026-08-30

Three asks, and they are the same ask at three depths: **the overview does not
say that a part leads anywhere.** [diagram.md § Sketch](../project/diagram.md#sketch)
is the feature; [sketch-diagram.md](sketch-diagram.md) is how it got built, and
[§ The door the model forgot to fit](sketch-diagram.md#the-door-the-model-forgot-to-fit)
is the last time this exact problem came up — a door existed and nobody could
see it.

## What is there now, and why it is not enough

A region whose `opens` names a scene is pressable *by its label*, and the only
things that say so are a **dotted underline** on that label and, on a node,
`stroke-width: 2` instead of `1.2`. In the band the canvas is scaled from 760
units to under 400 pixels, so the label is about 5px tall and the underline is a
grey smudge; the extra half-pixel of stroke on a node is nothing at all. The
affordance is real, it is correct, and it is invisible at the size the reader
actually meets it.

So the three parts below are ordered by how much they cost and how little they
can go wrong:

1. **The mark** — a zoomable part is drawn differently, and the difference has
   to survive being 5px tall. Always on.
2. **The peek** — hover or focus a zoomable region and a ghost of the scene
   inside it fades up over that region. On demand.
3. **The zoom** — pressing it does not cut, it moves: the part you pressed
   expands to fill the frame, and Back reverses it.

Each works without the next. If the animation is wrong on somebody's machine
they still get a marked, peekable door.

## 1. The mark: contrast, not geometry

**A region that opens something is drawn hotter than one that does not** — a
brighter edge and a stronger wash, on the region's own panel. Nothing is added
to the picture. Beside its name there is an "expand" corner mark, inside the
name's own hit box, doing the second job: saying *why* those regions are
brighter, once the picture is big enough to read it.

### It was a stack of cards, and a browser killed it

The first version was geometry: a second copy of the region's panel, offset five
units down and right, on the argument that a duplicate is a shape you *see*
where a glyph is a symbol you have to *read*. GPT Sol doubted it twice, both
times as the finding it was least confident in. It was right both times. From
the browser pass on the real drawing at 288px, 2026-08-30:

> I could not see a second panel at all — the region just looks like one
> bordered box. Zooming into the exact bottom-right corner … revealed only a
> very faint darker line just outside the main border, indistinguishable from a
> soft drop shadow or a rendering artifact.

And the finding that actually mattered, which was not about the stack:

> At band width, I could not tell which regions were pressable.

Which is the whole of what Greg asked for.

**The arithmetic the design never did.** The band scales 760 canvas units into
under 400 pixels, so every *distance* is roughly halved: five units of offset is
2.5 CSS pixels, drawn as a 5%-opacity fill. The corner mark was twelve units —
six pixels — and invisible there too. Anything measured in canvas units shrinks
with the picture, and a motif that depends on a small distance cannot survive
the one size that matters most.

**Contrast is the property that does not shrink.** An alpha is an alpha at any
scale, and a stroke held by `vector-effect: non-scaling-stroke` is the same line
in the band as at full screen. So the affordance moved out of the painter and
into the stylesheet: `sk-region-opens`, against the 0.24 stroke and 0.07 wash an
ordinary region gets. What the reader learns is *the brighter boxes are the ones
that open*.

That rule has to sit **below `.sk-region` in the file**, and it did not at first:
both are a single class, so they have equal specificity and the later one wins.
Written next to the rest of this feature, every declaration in it was outvoted
by the plain region's own numbers and the affordance did not exist. Nothing
errors and nothing warns.

### The mark, and why it is universal

Two brackets on a diagonal, the outward "expand" corners — the same gesture the
Enlarge button's icon makes. Two things keep it honest. It sits **beside the
words, inside the label's own hit box**, not out at the region's tidier
right-hand corner: the press target is the name, so a mark parked anywhere else
would say "press me" and not be pressable, which is this feature's own failure
rebuilt one layer down. And it is dropped entirely when the region is too narrow
to hold it, rather than drawn outside one.

**Every region style gets it**, including `plain` and `bracket`, which have no
panel at all. That was already true when the panel carried a stack the two of
them could not have, and it is why the mark survived the stack: it was the only
part of the old design that did not depend on the model's choice of style.

The dotted underline on the label stays. Third signal, weakest, free.

**Nodes that `opens` get nothing new.** No mark inside them, no ghost — a node's
box is 150–300 units wide and every door on every real drawing so far is a
region's. They keep the heavier stroke they already had, and they do get the
anchored zoom, because that costs nothing. Untested ground rather than a
compromise. § Not doing.

**An inferred door is marked exactly like a written one.** `opensInferred` says
whose work the link was, and that matters to `score.inferred` and to nobody
else — a reader who can press it is not short of anything.
[diagram.md § The scene is checked again in the browser](../project/diagram.md#the-scene-is-checked-again-in-the-browser).

## 2. The peek: the scene itself, small, inside the region it belongs to

Hover or focus a zoomable region's label and, over that region's own area:

- a **scrim** in the page colour at 0.88, from just under the label downwards,
  so the region's own boxes recede and its name stays legible — the name is the
  control that summoned this;
- the target scene, **painted by `paintScene` and dropped into a nested SVG
  viewport** the size of the region, `preserveAspectRatio="xMidYMid meet"`, so
  the browser scales it uniformly and clips what will not fit;
- and nothing else. `pointer-events: none` on the whole group — a scrim that
  could be hovered would take the pointer off the label, unset the peek, hand
  the pointer back, and do it again sixty times a second.

The **only** thing dropped is the words, by one stylesheet rule, because a
region is a fifth of the canvas high and 12-unit text lands at about a pixel.
Strokes get `vector-effect: non-scaling-stroke` so the shapes do not dissolve at
that scale.

**Why a thumbnail of the real thing rather than a count or a caption.** "4 more
inside" is a fact about the scene; the shape *is* the scene. Greg's example for
this whole feature was three arguments that converge, and a converging funnel is
recognisable at thumbnail size when the words in it are not.

**The first version of this was a second, simplified painter** — a rounded rect
for every node whatever its shape, a straight centre-to-centre hairline for
every edge — and it was wrong twice over. GPT Sol, 2026-08-30:

> The claim that it "cannot claim a structure the zoom scene does not have" is
> too strong. It discards shapes, direction, line style, routing, regions,
> paths, labels, and potentially the visual grouping that made the scene
> meaningful. … That is not a literal thumbnail.

On the real drawings that meant throwing away the diamond one zoom scene opens
with, the two `band` regions that make another read as parallel tracks, and the
dashes that separate a worked example from the main convergence — while its
straight lines crossed boxes they had nothing to do with and invented junctions.
A picture that asserts more than the article does is exactly the failure
[diagram.md § The shapes make claims](../project/diagram.md#the-shapes-make-claims-and-the-prompt-says-so)
already records twice. And a second painter is a second answer to the question
[`sketch-paint.ts`](../../src/sketch-paint.ts) exists to be the only answer to —
the *one painter, two sinks* rule, broken quietly.

The nested viewport is less code than the simplified painter was, and the only
arithmetic left is which rectangle to draw into: `peekViewport` in the pure
painter, `PEEK_LABEL_STRIP` for the strip the scrim must not cover.

**What the view owns, because an earlier draft of this plan claimed it owned
nothing:** the hover and focus state, choosing the target scene, and placing the
overlay. Only the geometry is pure.

## 3. The zoom: the part you pressed becomes the picture

Pressing a region's name (or a node that `opens`) currently swaps one scene for
another between two frames. Nothing says the second is *inside* the first, so
the reader has to take it on trust — and the scene row above is the only thing
that tells them where they ended up.

**So the new scene enters from the box you pressed.** The whole of it, shrunk
to sit inside that box, growing to full size — *contain, centred*, with
`s = min(rw/760, rh/targetHeight)`. Going back out, the overview starts at the
exact inverse: magnified about the same box, so the part just left fills the
frame, then pulling back to itself. Opacity goes 0.35 → 1 alongside, over 280ms
on an ease-out curve.

**Not the box's footprint exactly, and that was the first version's mistake.**
`translate(rx, ry) scale(rw/760)` matches width only. GPT Sol, 2026-08-30:

> The 712×180 first region opens a 760×650 scene. The proposed scale produces
> about 712×609, not 712×180.

The real regions are nearly the canvas's width and a fifth of its height, so
matching the footprint is a 94% scale — a twitch, not a zoom — and matching both
axes means distorting the picture. Fitting the whole scene into the box is a
real zoom and it is honest in the way that matters: everything you are about to
see appears where you pressed. `zoomAnchor` declines outright when the result
would be a scale over 0.9, and the plain fade takes over.

**Both scenes are 760 units wide and the SVG is `width: 100%` with
`preserveAspectRatio`, so one canvas unit is the same number of pixels in every
scene.** That is what makes the anchor honest rather than decorative. It is also
a thing that would silently stop being true if anything ever gave a scene its
own width, so `CANVAS_W` being shared is now load-bearing in a second place and
the tests say so.

**And the picture is nearly always scrolled**, which the first version ignored.
The overview is 1150 units tall in a band under 400px; the scene it opens is
shorter, and the browser silently clamps `scrollTop` to what the new picture can
offer. So the scroll position and the pixels-per-unit are read *before* the
swap, and the anchor is shifted by whatever the scroll actually did — measured,
converted back to canvas units, and declined outright if either measurement is
not real (a container with no width gives a shift of infinity).

**Anchored only between the overview and a part, never part to part.** Back
always lands on the overview, so an anchor taken inside one detail scene means
nothing in another; carrying it across would zoom out to a rectangle from a
picture the reader is no longer in. Every other move is the plain fade.

### The swap happens first, and the animation is decoration

The order in the handler is: **set the open scene, then try to animate.** Not the
other way around.

An animation-then-swap would put the whole navigation behind a callback that can
fail to arrive — `Element.animate` missing, the element unmounted mid-flight, a
`finished` promise that never settles because the tab went to the background. A
reader would press a region's name and land nowhere, which is
[silent-success.md](../reusable/silent-success.md) with a `finished` promise in
it, and it is the same failure as the door that was there and did nothing.

So: `setOpen` runs synchronously on the press. A `useLayoutEffect` then reads a
pending anchor off a ref and starts the entrance animation on the freshly
rendered scene, so there is no frame of the new picture sitting untransformed.
If `Element.animate` is not a function — jsdom, in every test in this repo — or
the reader has asked for reduced motion, that effect returns and the scene is
simply *there*. Which is what happens today.

**Arriving with no anchor is a normal case, not an error.** The scene row is the
way in that does not depend on the model having wired an `opens`, and pressing a
chip means "show me that part", not "zoom into this box". With no anchor the new
scene gets a plain fade with a small scale from its own centre. The anchor is
also forgotten when the reader changes scene by any route other than Back, so
Back can never animate out to a box the reader never pressed.

## Where the pieces go

| | |
|---|---|
| the corner mark, `peekViewport`, `zoomAnchor`, `anchorTransform` | [`src/sketch-paint.ts`](../../src/sketch-paint.ts) — all pure |
| the affordance itself — `sk-region-opens`, below `.sk-region` | `§ sketch` in [`styles.css`](../../src/web/styles.css) |
| the press, the anchor, the scroll correction, the entrance, the focus move | [`src/web/SketchView.tsx`](../../src/web/SketchView.tsx) |
| the scrim, the ghost, the non-scaling strokes, reduced motion | `§ sketch` in [`styles.css`](../../src/web/styles.css) |
| the same colours again, for the offline harness | [`evals/sketch/svg.ts`](../../evals/sketch/svg.ts) |
| the real artefact, with no doors of its own | [`tests/fixtures/sketch-noema.json`](../../tests/fixtures/sketch-noema.json) |

Nothing in `sketch-scene.ts` changes. This is entirely about drawing and
pressing what the schema already carries — no new field, no new prompt, no
redraw, and every sketch already on disk gets all three.

## Tests

In [`tests/sketch-paint.test.ts`](../../tests/sketch-paint.test.ts), which has no
DOM: the stack appears only on a region that opens something and only where
there is a panel to stack; it never leaves the canvas; the corner mark lands
inside the label's own hit box and is dropped rather than drawn outside a region
too narrow for it; `peekViewport` keeps clear of the label strip, stays inside
the region, and declines a region with no room; `zoomAnchor` contains and
centres, declines what is not worth animating, and composes with its own inverse
to the identity.

In [`tests/sketch-zoom-and-peek.test.tsx`](../../tests/sketch-zoom-and-peek.test.tsx),
jsdom, in three parts:

- **The fallback**, which is what jsdom runs by default because it has no
  `Element.animate`: the mark reaches the DOM, the peek appears on hover and on
  focus and is gone on leave and on blur, and the press navigates.
- **The animation, watched.** An `animate` that records what it was handed:
  going in starts inside the pressed box, going out is its exact inverse, a chip
  press is a plain fade with no anchor, a second press cancels the first, and a
  reader who has asked for less motion gets no animation and the same
  navigation. GPT Sol, 2026-08-30 — *"Every planned jsdom test takes the
  `Element.animate`-missing path … it provides no evidence that the zoom ever
  runs correctly."*
- **The real drawing.** `tests/fixtures/sketch-noema.json` is a copy of the
  artefact for the Noema essay — the one Greg pressed — and it carries **no
  `opens` on any item**: both doors exist only because `inferRegionOpens` works
  them out. Every other test here writes an `opens` by hand, so every one of
  them could pass while the one real artefact went on being a picture with no
  visible way in. That is the corpus-missing-the-field pattern in
  [silent-success.md](../reusable/silent-success.md), and Sol named it. A copy
  rather than a read of `data/`, which is gitignored: a test that read it would
  pass here and fail structurally anywhere the tree has not been ingested.

**Each of these was checked against a mutation aimed at it** — the swap moved
behind the animation, the peek left unhidden, the fit made non-uniform, the
anchor kept for a chip press, the cancel removed, reduced motion ignored, the
stack drawn for every region, the label strip covered. Twenty-three mutations,
twenty-three reds. One of them was **green on the first pass**: clearing the
peek on the way into a scene, because the fixture's zoom scene had no regions
and a stale index was harmless by accident. The fixture now has one, and a test
that no change can redden is testing nothing.

## Not doing

- **No re-layout, still.** The ghost is scaled, never re-flowed.
- **No second model call** and no new prompt field. If the prompt later asked
  for a per-region summary the peek could show words as well, and it does not
  need to.
- **Nothing new on a node that opens.** No stack behind its shape, no mark
  inside it, no ghost — a node's box is 150–300 units wide and a ghost inside
  one would be four grey specks. It keeps the heavier stroke it already had, and
  it does get the anchored zoom, because that costs it nothing. Every door on
  every real drawing so far is a region's, so this is untested ground rather
  than a compromise.
- **No reciprocal highlight yet** — hovering a scene chip and having its region
  light up in the overview is the obvious next thing and it is a separate,
  smaller piece of work.
- **No pan or free zoom inside the picture.** Enlarge is the answer to size, for
  the reasons in
  [diagram.md § 288px](../project/diagram.md#288px-is-not-a-size-a-diagram-fits-in-and-zooming-inside-it-does-not-help),
  and a second zooming gesture would be a second answer to a settled question.

## What GPT Sol's review changed

The plan went to `gpt-5.6-sol` before it was built
([the prompt](sketch-zoomable-subsections-review-prompt.md),
[the answer](sketch-zoomable-subsections-review-sol.md)). Its verdict was **do
not build as written**, with four blockers. Three of them were right and are
folded in above:

- **The anchor could not do what the plan said.** `translate(rx, ry) scale(rw/760)`
  matches width only; the real 712×180 region opening a 760×650 scene would have
  produced 712×609. Now *contain, centred*, with the scroll correction and the
  overview-only rule. § 3.
- **The peek was a second painter, and it lied.** Now the real `paintScene`
  output in a nested viewport. § 2.
- **The animation had no test that watched it**, and the region button lost
  focus and leaked arrow keys into the listbox behind it. All three fixed.

The fourth, **#5 on the mark**, is the one Sol was least confident in and it is
a perceptual judgment: an offset duplicate may read as a drop shadow rather than
as depth. Sol's counter-proposal is one piece of standard control chrome
independent of region style and node shape. What went in keeps the stack *and*
makes the corner mark universal — every region style gets it, and its stroke is
`non-scaling-stroke` so it is the same weight in the band as at full screen. The
stack is the part to remove if it reads as a shadow at 288px, and that is a
question for a person looking at the real drawing, not for a test.

Not taken:

- **"Drop the peek from the first build."** The reason to keep it is that the
  objection was to *the simplified redraw*, not to the idea, and the nested
  viewport answers the objection with less code than the version Sol was
  reading. Greg asked for exactly this — "show/hint in the main diagram the
  structure within the sub-section" — and a title-and-caption in the card is the
  one thing the scene row already does.
- **Folding the region labels into the listbox's active-descendant sequence.**
  Sol is right that a `listbox` should not hold interactive descendants, and
  that is true of the code as it shipped before this work. Making regions
  `option`s of the same list is a real change to how the picture is navigated
  and it belongs on its own. What is fixed here is the damage: arrows pressed on
  a region name no longer walk the marker behind it, and focus moves to the
  picture when the group holding it unmounts.

## What the second review changed, which is where the bugs were

The code went back to `gpt-5.6-sol`
([prompt](sketch-zoomable-subsections-code-review-prompt.md),
[answer](sketch-zoomable-subsections-code-review-sol.md)) and the verdict was
**block commit**, on four things the plan-stage review could not have seen
because none of them existed yet. That is the whole argument for weighting the
second review higher, and this is the clearest case of it the repo has: the
first review corrected the *design*, the second found the *arithmetic*.

- **The scroll correction was on the wrong side of the inverse.** It was folded
  into `ty` before the transform was built — right for going in, and for going
  out the inverse then multiplied it by `1/s` and flipped its sign. On the first
  real region (`s ≈ 0.277`), a Back after 100px of scroll gave −1444 where −292
  was right, and the overview entered from far above the part it was pulling out
  of. It is now a `shiftY` argument to `anchorTransform`, applied after the
  inverse. Sol supplied the arithmetic and it reproduces to the decimal.
- **The lower clamp on the scale broke the one promise the anchor makes.**
  `Math.max(0.12, s)` reads as a floor on how dramatic the swoop may be and is
  really a licence to overflow: a 150×60 node opening a 650-unit scene has
  `s ≈ 0.092`, and 0.12 starts the scene 78 units tall inside a 60-unit box.
  **And the test passed because of the bug** — it asserted only that `s` never
  fell below 0.12. Out of range is now a decline at both ends, and what is
  asserted is containment, swept over 150 box-and-scene combinations.
- **The entrance was only ever cancelled by the next navigation.** A reload of
  the artefact mid-flight left the reused `<g>` wearing the old scene's
  transform while its contents changed; Enlarge and Close detached the animated
  node with the animation still on it. There is now an animation ref, cancelled
  on a new sketch and by a callback ref when the stage element changes.
- **Swallowing the arrows on a region's name was half a fix.**
  `stopPropagation` stopped them walking the listbox marker behind the group and
  left the browser's own default, which scrolls the picture. So the selection
  stopped moving and the picture started. `preventDefault` too.

Three smaller ones, all taken: the peek was dropping the corner mark of any
region *inside* the scene it previewed (an opening region's label is deliberately
kept out of `front`), it was leaving an edge label's page-coloured plate behind
as a blank hole punched through a connector once the words were hidden, and its
`non-scaling-stroke` was a list of six class names that had already missed one —
now written by element, which cannot go stale. The stack could also fall off the
bottom of the canvas: it was clamped horizontally and not vertically, and the
test that said "never off canvas" checked only x.

**And the tests Sol said were green for the wrong reason.** Three were, and each
is now written against the path it claimed: the animation tests never reached
the scroll correction at all, because jsdom lays nothing out and both reads
returned the same number — the clamp is now modelled explicitly, first read
before the swap, every read after it after; the focus test clicked a region that
had never held focus, so it passed on the flag rather than on focus surviving an
unmounting control; and the peek tests used only boxes and unlabelled solid
edges, so a return to the simplified painter would not have shown. Nine
mutations aimed at the nine fixes, nine reds.

Sol's one remaining open finding was the same one it was least sure of the first
time — whether the stack read as depth or as a drop shadow at 288px. A browser
pass answered it: as a drop shadow, or as nothing. § 1 has what replaced it.
**Twice flagged, twice as the least-confident finding, and right both times.**

## Open

- **Does the peek want a delay?** A ghost that appears the instant the pointer
  crosses a label would flicker as the reader sweeps the picture. `TooltipGroup`
  already has 300ms open / 120ms close and this could borrow those numbers, but
  it is not a tooltip and it is inside an SVG.
- **Does the contrast do the job the stack could not?** The stack was killed by
  a browser pass at 288px and this replaced it; the replacement has been
  reasoned about and not yet looked at. The question is the original one: at
  band width, can a reader tell which regions open something?
- **The peek at true band scale was called "borderline, not solidly legible"**
  by the same pass — present and readable as shapes when magnified, close to the
  edge without. Worth a second opinion before deciding whether it needs a
  stronger scrim or a larger inset.
- **Not yet looked at at all**: the enlarged view, the console, and the keyboard
  paths. The browser pass ran out before reaching them.
- **The picture is still two tab stops**, and a `listbox` should not hold
  interactive descendants. Above, under what was not taken.
- **The scroll is not reset on a scene change.** A reader deep in a 1150-unit
  overview who presses a chip lands part-way down a 500-unit scene, because the
  browser clamps and nothing else moves it. The anchored zoom corrects for this;
  the plain fade does not.
