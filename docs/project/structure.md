# Structure mode

Up: [reading-view-overview.md](reading-view-overview.md)

The article's tree, in the band, with two faces chosen by the band's width. It shares the tree with
[granularity-zoom.md](granularity-zoom.md) rather than having a structure of its own. The tree comes
from pipeline stage 4, the `structure` step (called `hierarchy` until 2026-10-02), and how it is cut
is [structure-step.md](structure-step.md).

## What it is for

> I like the 2-column version of Structure mode.
>
> But the 1-column version of Structure mode shows the top-level sections in the top half, and then
> the lower-level underneath that, which is very confusing. For the 1-column version of Structure,
> we should just use Outline mode - that's a better 1-column experience.
>
> So, in other words, if the page is wide, show the current Structure 2-column mode. If it's
> narrower, show the current Outline mode. And get rid of Outline mode altogether (because it will
> have been subsumed by Structure mode).
>
> — Greg, 2026-09-08, feedback SPIDERYARN-READING2-2S, in [260910g](../plans/260910g-structure-mode-subsumes-outline.md)

> I like the way the Structure Mode works with choosing 1- and 2-column mode based on the width of
> the browser. The 1-column mode is fine. But the 2-column mode is a little hard to read because the
> text is small the columns are really narrow. Perhaps we only switch to 2-column mode when the
> window is a little wider, and provide more space for the 2 columns, etc. And also make the visuals
> a bit more consistent (e.g. colours, highlighting) etc across 1- and 2-column modes.
>
> — Greg, 2026-09-28, in [260928a](../plans/260928a-structure-two-columns-readable.md)

> Add a toggle to Structure mode to switch between the Fisheye submode (which should be the default,
> and which is what we're using now), and Expanded mode (which would show everything fully, all of
> the summaries and everything expanded and visible).
>
> — Greg, 2026-10-01, spya-gxyhcc, in [261001q](../plans/261001q-structure-fisheye-expanded-and-arrow-keys.md)

Open this doc to find your way in; the plans below are still where the design and its reasoning
live.

## Fisheye and Expanded

Two views, chosen by chips in the band's head row and kept in `?structure=`
([url-state.md](url-state.md)). **Fisheye**, the default, is everything below: the two faces, each
opened up around where you are reading. **Expanded** is one list in every band width — every part
and every section under it, at any depth, each with its gist, and each part's arc — and it is the
one time this band scrolls. It is the list face's own component with an `expanded` prop
(`OutlinePanel`), built by the same `outlineProjection`, so the rows, the marks and the keyboard are
the list's. It follows the reader only when they cross into another section, so a reader who
scrolls the column by hand keeps their place until then. No paragraph rows: the summaries Greg
asked to see are the gists. The plan, and GPT Sol's review of it, is
[261001q](../plans/261001q-structure-fisheye-expanded-and-arrow-keys.md); the keys that went with
it are [keyboard.md § ← / → in Structure](keyboard.md).

## The two faces, and how it got here

Where the band is
wide enough (609px border-box, a 1165px window — [narrow-windows.md](narrow-windows.md)) it is two linked columns: every part on the left, the sections of
the one you are in on the right. Where it is not, it is a nested list, deep where you are reading
and shallow everywhere else. [260910g](../plans/260910g-structure-mode-subsumes-outline.md) is the two faces;
[260907c](../plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md) is the
two columns, built behind the switch on 2026-09-06 so the three structural modes could be compared;
and [260828aw](../plans/260828aw-outline-mode.md) is the nested list, which was **Outline mode**
until 2026-09-10. That comparison ended with Outline retired, its list kept as Structure's narrow
face, Structure out from behind the switch in Outline's place in the bar, and Hierarchy unchanged
— until Hierarchy was removed on 2026-09-29 in Structure's favour. `?mode=outline` and
`?mode=hierarchy` both still open Structure. Where Structure draws its own numbers, section titles
drop the article's own leading number ("3.2 Methods" becomes "Methods"), so the two never
disagree; the Spine and the prose keep it ([260929d](../plans/260929d-remove-hierarchy-mode-and-heading-numbers.md)).

Also: [260928a](../plans/260928a-structure-two-columns-readable.md) moved the switch to two columns
later and made the faces look alike, and
[260916b](../plans/260916b-rich-tooltips-on-structure-mode-rows.md) gave the rows rich tooltips.

## Where the code is

Each file's header comment says what it owns.

- [`src/web/modes/structure/`](../../src/web/modes/structure/StructureMode.tsx) — the mode
  controller, which picks the face; its header has the rule for which.
- [`src/web/StructurePanel.tsx`](../../src/web/StructurePanel.tsx) — the two columns, drawn from the
  projection in [`src/web/structure.ts`](../../src/web/structure.ts).
- [`src/web/OutlinePanel.tsx`](../../src/web/OutlinePanel.tsx) and
  [`src/web/outline.ts`](../../src/web/outline.ts) — the nested list, the narrow face, under its old
  name.
- [`src/web/useColumnContext.ts`](../../src/web/useColumnContext.ts) — which section the reader is
  in, Structure's "you are here" in both faces; the name is left over from the gist columns, and
  [column-context.md](column-context.md) is that history.

---

Up: [reading-view-overview.md](reading-view-overview.md)
