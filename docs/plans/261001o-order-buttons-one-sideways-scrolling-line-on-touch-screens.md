# Order buttons: one sideways-scrolling line on touch screens

The follow-up to [261001l](261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md)
§ Stage 3, "Not trimmed, and why", for report `spya-gcdwps`
([note](../user-feedback/260910_2051-quotes-and-other-bands-on-a-landscape-phone.md)). Greg chose it
on 2026-10-01 (question `Q-landscape-orders`, option B), as it was put to him:

> B. On touch screens only, keep it to one line and let it scroll sideways. This saves about 49px,
> but orders past the edge stay hidden until you swipe. You made the same choice for the bottom bar
> on 2026-08-28.

## The problem

On a touch screen every order button has a 40px floor (narrow-window.css § a coarse pointer, the fix
for SPIDERYARN-READING2-2J). In the ~290px band of a landscape iPhone the row of four orders wraps
onto two of those lines: 98px of a 338px band, measured at 844×390 in 261001l, in Quotes, Citations
and Glossary alike.

## What we build

**CSS, under the same `@media (pointer: coarse)` that sets the floor** — the wrap is caused by the
floor, so it is undone under the same query. Desktop, and a fine pointer at any width, are untouched.

- `.gloss-sort`, `.quotes-rank` (the row): `flex-wrap: nowrap`.
- `.gloss-sort-group` (the buttons): `flex-wrap: nowrap`, `min-width: 0`, `flex: 0 1 auto`, and the
  bottom bar's sideways treatment (dock.css § the floor under the bar's fit ladder):
  `overflow-x: auto; overflow-y: hidden; scrollbar-width: none`, `::-webkit-scrollbar { display:
  none }`, and every child `flex-shrink: 0`. The same declarations, cited rather than shared: the
  dock's are unconditional and these are touch-only, so one selector list cannot hold both.
- `.gloss-sort-trail` (the count and the profile badge, Glossary and Quotes): `flex-shrink: 0`. It
  already sits at the far end with `margin-left: auto`, so it stays pinned while the group scrolls.
  The (i) is the band's own (`BandAbout`, absolutely placed in the corner) and is not in the row.
- A scrolling box clips its children's focus outline (2px + 1px offset). A few px of padding on the
  group, given back with a negative margin, keeps the ring visible without changing the row's height.

**One small component, `src/web/OrderGroup.tsx`**: the `role="group"` div every order row already
draws by hand, plus a layout effect that, when the band opens (and whenever the selection changes),
scrolls the pressed button into the group's view by setting `scrollLeft` from the two rects. Not
`scrollIntoView`, which also scrolls every scrolling ancestor — the band and the page. Where nothing
overflows it changes nothing, so it needs no touch condition of its own; the touch-only rule stays
in one place, the CSS.

**All five rows that draw `.gloss-sort-group`**, not just the three named: Quotes, Citations,
Glossary, and also Debate and FAQ. They are one control written five times; the 40px floor already
reaches all five, so they all wrap the same way, and a row that wrapped while its siblings scrolled
would be the drift touch-controls.test.ts exists to stop. Debate's row measured 54px (one line) in
261001l, so it mostly gains nothing — but it can still wrap on a narrower band.

## What the plan review changed

GPT Sol, read-only, on this plan ([review](261001o-order-row-plan-review-sol.md)):

1. **High — Quotes would still have wrapped.** narrow-window.css loads before quotes.css, so an
   equal-weight `.quotes-rank { flex-wrap: nowrap }` there loses to quotes.css's own `wrap`, and a
   test that only asked whether `nowrap` was *written* would have passed. Built instead: the touch
   rules live in glossary.css § a touch screen, after the base rules, and Quotes' one line in
   quotes.css after its own. The test walks the rules in cascade order and asks which `flex-wrap` a
   touch screen ends up with — red against the narrow-window.css placement, checked.
2. **Medium — reveal only on opening is not enough.** A font swap, a rotation or the trail arriving
   can push the pressed order out without the selection changing. `OrderGroup` re-reveals on a
   `ResizeObserver` (group and buttons) and on `onFontsChanged`.
3. **Low — the test took `any-pointer` too, and the component test lacked the left-edge case.** Both
   added. `flex: 0 1 auto` and `min-width: 0` dropped from the CSS: the first is the default and the
   second was already there.

## The simpler option passed over

Pure CSS, no component: the row scrolls, but a band opened with the fourth order selected would show
the first three and hide the one that is on. The reader could not see how the list is ordered, which
is the one thing the row is for. The component is ~30 lines and replaces five hand-written copies of
the same div.

## Not done

- No fade or arrow at the clipped edge. Greg accepted "hidden until you swipe", the same as the dock;
  an edge hint is a later decision if the swipe turns out not to be found.
- Search's `.srch-sort-btn` row is a different control with its own styles; not touched.

## Checks

- **A test for the touch-only rule** in tests/touch-controls.test.ts: the row's `nowrap` and the
  group's `overflow-x: auto` are written inside a `(pointer: coarse)` block, and not in any rule
  outside one (that second half is what keeps desktop unchanged). Red first: written before the CSS.
- **A component test** for `OrderGroup`: in jsdom with stubbed rects, the pressed button right of the
  view moves `scrollLeft`; one already in view leaves it alone.
- **Playwright** at 844×390 with `hasTouch`/`isMobile` (so `pointer: coarse` matches) and at 1280×900
  with a mouse, in Quotes, Citations and Glossary: the row's height, whether it scrolls, whether the
  trail is inside the band's right edge, and with the last order selected and the band reopened,
  that it is in view. Screenshots beside this plan.
- `npm test`, `npm run typecheck`, lint on the touched files.
