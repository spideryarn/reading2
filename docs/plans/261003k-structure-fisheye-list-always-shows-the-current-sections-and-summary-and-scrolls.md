# Structure's fisheye list always shows the sections you are among, and scrolls when it must

Up: [structure.md](../project/structure.md)

Feedback report `spya-s46j8f`, from Greg (an admin, so trusted input), 2026-10-03, on the Entropy
article in Structure mode's Fisheye view:

> In structure mode, in fisheye submode, it does a good job of kind of expanding and contracting to
> try and keep the whole structure visible. But actually, I think it probably treats that constraint
> of making sure that the whole structure is visible within the column as more important than, you
> know, than the desire to be able to show a bit more detail. So I'm wondering how to tweak it, but
> at the very least, if I'm reading, you know, a subsection or whatever the term is, I think at the
> very least I want all the headings for this subsection and its siblings to be visible. I mean, I
> think I'd also like to see the summary for this lowest level subsection, even if that does mean
> that it can't show the whole top-level structure visibly, that I'd have to scroll in structure
> mode to see the whole of the top-level structure. I think that's probably better because though
> it's nice to be able to always see where I am within the whole piece, it's probably also important
> to be able to see where I am within this section and to get the summary of this. So there's a
> balance between saying probably always show the summary for the lowest-level heading. And probably
> always show the lowest level headings and their siblings.

## What happens today

Structure's Fisheye has two faces ([structure.md](../project/structure.md)). This is about the
**list face**, the one nested list drawn whenever the band is narrower than 609px (a window under
1165px, or any window with Marginalia open, as Greg's was).

The list never scrolls. It is built at five levels of detail, "rungs" (`src/web/outline.ts`):

```
1  every part, one line each
2  + the sections of the part you are in
3  + the summary sentence of the section you are in
4  + the arc sentence for the part you are in
5  + the paragraphs of the section you are in
```

`OutlinePanel` draws all five hidden, measures them, and shows the tallest one that fits the band.
If rung 3 does not fit, the reader gets rung 2 or rung 1. And since 2026-09-10 a rung with whole
(wrapped) titles beats a more detailed rung with titles cut to one line. So on a long-titled
article in a laptop-height band the reader can be left with rung 1: the ten parts and nothing
about the section they are in.

The Entropy article is exactly that. Its tree (read from production, read-only) is 10 parts, each
with 3 to 6 sections, each section with a 25 to 40 word summary, and several part titles wrap to
three lines in a 300px band. Greg was at `spya-ajt4fw`, the start of section 1.5 "Two Key Ideas".

The **two-column face** (wide windows) is not changed. Its right-hand column already is "the
sections of the part you are in, with the current one's summary", at a fixed rung, whatever the
height.

## What changes

**Rung 3 becomes the floor of the fisheye list.** The reader always gets every part, every section
of the part they are in, and the summary of the section they are in.

- If rung 3 fits, nothing changes from today: the tallest fitting rung from 3 to 5 is shown and
  the list does not scroll.
- If rung 3 does not fit, **rung 3 is shown anyway and the list scrolls**, as Expanded's does. It
  follows the reader: when they move into another section the list is scrolled so the whole of the
  current part's block (the part row down to its last section) is in view if it fits in the list,
  and otherwise so the current section's row sits a third of the way down. A reader who scrolls
  the list by hand keeps their place until they cross into another section, which is Expanded's
  rule (261001q).

**The one-line title clamp goes.** It existed only as the floor for "not even rung 1 fits whole in
a panel that cannot scroll". The panel can scroll now, so the floor is the scroll, and titles are
always whole. That also halves the hidden measuring copies (five, not ten).
`data-outline-clamp` on the band is replaced by `data-outline-scroll` (`"1"` when the list is
scrolling), which is also what the stylesheet keys the scroll on.

Rungs 1 and 2 stay in the projection: with no current part (the reader is above the first part) or
in the Notes, rung 3 draws the same rows as rung 1, and `outlineProjection` is unchanged.

## The simpler options passed over

- **Keep the clamp as a middle step** (whole titles and fits, then one-line titles and fits, then
  scroll). Fewer lines changed, but it prefers cutting every title to one line over scrolling, and
  Greg has said both that cut titles are "really hard to tell what each one's about" (2026-09-08)
  and that scrolling is acceptable here. It also keeps ten hidden copies and a second state.
- **Only reorder the preference** (detail over whole titles, never scroll). Does not help when
  rung 3 does not fit even clamped, which is any phone.
- **Tell the reader to use Expanded.** Expanded shows every section's summary, which is a much
  longer list; what he asked for is the fisheye with a floor.

## Not in this change

- The two-column face. If a part has more sections than its column holds, it still windows them
  behind "N earlier / N later" counters rather than scrolling. Rare (one part's sections get the
  whole height), and a separate change if wanted.
- Trees deeper than part → section → paragraph. The fisheye list draws two levels above the
  paragraphs; the "section you are in" is the reader's section at `sectionDepth`, and on a four-level
  tree that is a sub-section the fisheye list does not draw. Unchanged here; Expanded draws them.
  GPT Sol's plan review (F1) called this the request left unmet, and for such an article it is.
  Measured in production on 2026-10-03, read-only: 42 of 43 current trees are three levels deep
  and one is four. So it is deferred, not dismissed, and it is in the Overseer's queue under this
  report's id.

## GPT Sol's plan review

[The review](261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls-plan-review-sol.md):
no P0, three P1, one P2. It agreed with leaving the two columns alone, removing the clamp, and
letting the list take the wheel.

- **F1, deeper trees**: deferred with a number, above.
- **F2, a summary cut at the foot**: taken. "A third of the way down" is now held so that a row
  which fits in the list is never cut; a row taller than the list starts at its top. It was
  Expanded's rule too, so Expanded gets the fix.
- **F3, Home and End could mark a row that is off screen**: taken. The key now scrolls the list
  the least amount that shows the row it chose.
- **F4, tests**: taken for the three above and for a hand-scrolled place being kept. Not taken: a
  second, many-part fixture. What happens to the scroll when one part closes and another opens is
  a layout question, and the browser check asks it on a real article.

## The code

1. `src/web/OutlinePanel.tsx`
   - `fit` becomes `{ rung, scroll }`. In `measure`: read candidate 3's height; if it is over the
     room, `{ rung: 3, scroll: true }`; otherwise the tallest fitting rung from 3 up (ties to the
     lower rung, as now), `scroll: false`.
   - Hidden candidates rendered once each, no clamp set. `listClass` goes.
   - The follow-along effect runs when `expanded || fit.scroll`, on the drawn projection's
     `currentId`. In the fisheye it prefers the whole current-part block, as above.
   - `data-outline-scroll` replaces `data-outline-clamp`.
2. `src/web/styles/outline-mode.css`: the Expanded scroll rule also applies to
   `.mode-band.outln[data-outline-scroll="1"] .outln-list`; `.outln-list.clamp` removed; the header
   comments that say the list never scrolls are corrected.
3. Tests, red first (`tests/outline-panel.test.tsx`): a band too short for rung 3 still draws the
   current part's sections and the current section's summary and reports scroll; a band that fits
   rung 3 does not scroll; the two clamp tests are replaced; the follow effect moves the fisheye
   list when the section changes. `tests/mode-surface-changes-no-markup.test.tsx`: the attribute
   name.
4. Docs: `structure.md` (Greg's words and the floor), the comments in `outline.ts`,
   `StructureMode.tsx` § `VIEW_HOW`, `src/modes.ts` where they say the list never scrolls. Help
   text if it says so.
5. Browser check (jsdom does no layout, so the fit is only proved in a browser): desktop with the
   list face, iPad, phone; a long article at a short height shows `data-outline-scroll="1"`, the
   current section and its summary on screen, and the list follows on crossing a section.
