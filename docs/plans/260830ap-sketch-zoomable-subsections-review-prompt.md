# Review: making Sketch's sub-diagrams visibly zoomable

You are reviewing a **plan, before it is built**, in the spideryarn2 repository
at /Users/greg/Dropbox/dev/experim/spideryarn2. Read-only; do not edit files.

Greg's ask, verbatim:

> In the Sketch Diagram, we have sub-diagrams for particular sub-sections. Could
> we make it clearer in the main diagram that some sub-sections are zoomable,
> and ideally even show some kind of zooming animation in/out and even
> show/hint in the main diagram the structure within the sub-section?

## Read, in this order

1. `docs/plans/260830ap-sketch-zoomable-subsections.md` — the plan under review.
2. `docs/project/diagram.md` § "The fourth: Sketch" onwards — what the reader
   touches today, and § "What is deliberately not here".
3. `src/sketch-scene.ts` — the schema and the validator. Note `SketchRegion.opens`,
   `opensInferred`, `inferRegionOpens`, `CANVAS_W`.
4. `src/sketch-paint.ts` — scene → drawing primitives, pure, no DOM. Note
   `PaintedRegion`, `paintScene`'s layering (`behind` / `links` / `nodes` / `front`).
5. `src/web/SketchView.tsx` — the panel: the scene row, the region-label press,
   the roving-tabstop listbox, the `<dialog>` enlarge.
6. `src/web/styles.css` § sketch (search for `--------- § sketch`).
7. `docs/plans/260830j-sketch-diagram.md` — how this feature got built, especially
   "The door the model forgot to fit" and "Not doing".
8. `CLAUDE.md` and `docs/reusable/silent-success.md` for the house rules.

`data/noema-mythology-of-conscious-ai/sketch.json` is a real artefact: an
overview with two regions and two zoom scenes, and **no `opens` anywhere** — both
doors are inferred. Read it; it is the case this plan has to work on.

## What I most want you to attack

1. **The mark.** The claim is that an offset duplicate panel ("a stack of
   cards") survives being scaled to a 288px band where a glyph does not, and
   that it means "there is another layer behind this". Is that legible or is it
   noise on a picture that already has regions, boxes and edges in eight hues?
   Is there a better always-on mark? Note the region styles `band`, `dashed`,
   `bracket`, `plain` — two of them have no panel to stack and the plan leaves
   them with the corner mark alone.

2. **The peek, and whether it lies.** A scrim over the region plus a ghost of
   the target scene's nodes as rounded rects, edges as straight centre-to-centre
   hairlines. Node shape is dropped; routing is dropped. `diagram.md § The shapes
   make claims` records that this picture has already twice asserted through
   geometry something stronger than the prose. **Is a straight-line, shape-less
   ghost a version of that same failure, or is it honestly a thumbnail?** If it
   is the failure, what is the honest cheap alternative?

3. **The zoom, and the order of operations.** The plan sets the open scene
   synchronously and then animates, deliberately, so a missing `Element.animate`
   or an unsettled `finished` promise cannot swallow the navigation. Is the
   layout-effect-plus-ref design right, and what breaks it? Specifically:
   - a second press mid-flight (region → region, or Back while going in);
   - the `<dialog>` enlarge, which unmounts and remounts the whole picture body
     (`{full && <div className="sk sk-in-full">{body}</div>}`) — the animation
     state lives above that;
   - React strict mode double-invoking effects;
   - the `.sk-scroll` container being scrolled when the press happens, and the
     incoming scene being shorter than the outgoing one.

4. **The anchor's arithmetic.** Going in: `translate(rx, ry) scale(rw/CANVAS_W)`
   → identity, on a `<g>` inside the SVG. Going out: the inverse. This rests on
   every scene sharing `CANVAS_W` and on `width: 100%` +
   `preserveAspectRatio="xMidYMin meet"`, so a canvas unit is the same pixel
   size in both scenes. Check that reasoning, and check the "out" transform is
   actually the inverse rather than something that looks like one. Does
   `transform-box` / `transform-origin` on an SVG `<g>` behave as assumed?

5. **Accessibility and input.** The picture is one `role="listbox"` tab stop with
   a roving marker; a zoomable region's label is a separate `role="button"`
   inside it. The peek is triggered by hover *and* focus. What does a screen
   reader make of a purely visual peek? Should the animation be announced or
   suppressed? `prefers-reduced-motion` is respected — is that enough, or does
   this need a way to turn it off outright? Touch has no hover at all.

6. **What is missing.** Name anything a reader would need that these three
   parts do not give — and anything here that is not worth its complexity. If
   one of the three should be dropped, say which and why.

## What I am not asking

Do not redesign the model prompt or the schema — nothing in `sketch-scene.ts`
changes here. Do not relitigate the band-versus-modal decision. Do not propose
a library.

## Answer format

For each finding: **what**, **where** (file and section), **why it matters**,
and **what to do instead**. Rank them, most serious first, and say plainly which
ones you would block the build on. Say which of your findings you are least
confident in — they get checked before they are acted on.
