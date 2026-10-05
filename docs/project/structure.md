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

> at the very least I want all the headings for this subsection and its siblings to be visible. I
> mean, I think I'd also like to see the summary for this lowest level subsection, even if that does
> mean that it can't show the whole top-level structure visibly, that I'd have to scroll in structure
> mode to see the whole of the top-level structure.
>
> — Greg, 2026-10-03, spya-s46j8f, in [261003k](../plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md)

Open this doc to find your way in; the plans below are still where the design and its reasoning
live.

## Fisheye and Expanded

Two views, chosen by chips in the band's head row and kept in `?structure=`
([url-state.md](url-state.md)). **Fisheye**, the default, is everything below: the two faces, each
opened up around where you are reading. **Expanded** is one list in every band width — every part
and every section under it, at any depth, each with its gist, and each part's arc — and its list
always scrolls. It is the list face's own component with an `expanded` prop
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
and shallow everywhere else.

**The list has a floor, and scrolls rather than go below it** (since 2026-10-03,
[261003k](../plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md)).
It always draws every part, the sections directly under the part you are in, and the available
summary of the current one. Deeper subsections still need Expanded; that extension is
[deferred in the plan](../plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md#not-in-this-change).
With room to spare it adds the part's arc and then the section's paragraphs. Without
room for the floor it draws the floor anyway and the list scrolls, following the reader as
Expanded does and keeping the whole of the current part's block in view when that fits. Before
that the list never scrolled and dropped the sections and the summary instead, and from 2026-09-10
it cut titles to one line as a last resort; both went. The two columns still never scroll. [260910g](../plans/260910g-structure-mode-subsumes-outline.md) is the two faces;
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

## When it is only the headings

A long document's structure can fall back to a tree built from the author's own headings, with no
summary on any section and some sections named by their opening words
([structure-step.md § The fallback](structure-step.md#the-fallback-a-tree-from-the-documents-own-headings)). Nothing on screen said so
until 2026-10-05.

> B yes add an indication. Although I'm not delighted by falling back to the original headings. I
> feel like it should be possible to do this robustly, progressively and fairly low-latency, e.g.
> just the top-level headings first, then the lower-level headings within each of those? then do
> the summaries later in parallel? or something like that. Run evals etc.
>
> — Greg, 2026-10-05, answering [Q-plain-tree-notice]

This section is the indication. The rest of what he asks for, a structure that does not need the
fallback, is separate work.

**The line.** *"These section names are the document's own headings and opening words. The fuller
version, with a line on what each section says, could not be made."* ("And opening words", because
a stretch with no heading of its own is named by its first words.) It is in the band's head row, under the Fisheye and Expanded
chips, so it is in the columns, the list and Expanded alike. It shows exactly when the tree is
marked `provisional: "headings"`, never because gists happen to be missing, and every reader sees
it, a visitor included.

**Try again**, for the owner only, beside the line (which then adds *"Trying again may make it."*).
One press runs the `structure` step again, forced by name. What it buys:

- **The structure call**, but only the slices that failed: the ones that answered are checkpointed
  ([structure-step.md § When one answer will not fit](structure-step.md#when-one-answer-will-not-fit)).
- **The paragraph labels again**, as the free job every new tree queues. This is why `structure`
  is not on Metadata's re-run list ([`src/rerun-steps.ts`](../../src/rerun-steps.ts)); here the old
  labels were written for sections the new tree replaces, so nothing good is lost.
- **The arc again, if the tree changed.** The tab that pressed asks for it, once and unforced, when the run finishes,
  because arc sentences are matched to parts by block range and a re-cut tree would otherwise drop
  them without a word.

It costs no import slot. The other things made from the old tree (Glossary, Quotes, Ideas and the
rest) are kept and read as out of date in their own modes, as after any change to the article;
nothing remakes them.

The run can fall back again, which is why the line says *may*. Nothing refetches the article, so a
finished run says *"Finished. Reload the page to see what it made."* with a Reload button, and
after the reload the line is either gone or still there.

One arm per kind of stand-in tree: the words are chosen by a `switch` on `Tree.provisional` in
[`src/web/StructureNotice.tsx`](../../src/web/StructureNotice.tsx), so a second kind is a compile
error there until it has words.

## Where the code is

Each file's header comment says what it owns.

- [`src/web/StructureNotice.tsx`](../../src/web/StructureNotice.tsx) — the line a headings tree
  draws, and the owner's *Try again*.

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
