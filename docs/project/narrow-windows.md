# Narrow windows, and the screen behind them

> **Split out of [design-css-overview.md](design-css-overview.md) on 2026-09-07**, verbatim apart
> from the heading levels and a couple of "see above" links that had to become cross-doc ones. That
> doc is still the map — the stylesheets in load order, which mechanism owns what, the colour
> tokens. This is one area of the territory.

## Narrow windows: wrap, do not shrink

There are no breakpoints on the shelf and it does not need any — `max-w-4xl` makes the page fluid
below 896px and `mx-auto` simply stops doing anything. What a narrow window actually breaks is the
**rows**, and the rule that keeps them honest is: *a row of things whose widths you do not control
must be allowed to wrap.*

Three of them were not, and were fixed on 2026-08-27 as a set:

- the page's masthead line, wordmark against the **You** / **Design** links
- a card's bottom meta line — word count, question count, and a note whose text is whatever the
  current sort makes it (`opened 3 weeks ago`, `added 26 Aug 2026`)
- the tooltip, capped at `min(22rem, calc(100vw - 1.75rem))`. Floating UI's `shift` already keeps a
  panel on screen, but shifting a 352px box inside a 390px viewport pins it to one edge with
  nowhere left to go; capping the width is what lets it stay near the thing it is about.

Two rows were already right and are worth knowing about, because they are the pattern to copy.
`ShelfControls` is `flex-wrap` around a `flex-wrap` fieldset, so the chips reflow inside their own
group and the Unread / view-toggle pair takes its own line, still right-aligned by `ml-auto`. And
the dense table is inside `overflow-x-auto`, which is the other half of the rule: content that
genuinely **cannot** reflow — a six-column table — scrolls in its own box rather than pushing the
page sideways. Same call as the code blocks in
[typography.md § Content that cannot reflow](typography.md#content-that-cannot-reflow).

The check is one line in the console, at whatever width you are worried about:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth  // must be 0
```

## The reading view's narrow window, which is a different problem

Everything above is the shelf, where a narrow window breaks *rows*. On the reading view it breaks
the **columns**, and the fix is not CSS at all — it is arithmetic in
[`src/web/layout.ts`](../../src/web/layout.ts), which stops offering gist columns once one will not
fit beside the prose. [`styles/narrow-window.css`](../../src/web/styles/narrow-window.css)
§ **a narrow window** and § **a short viewport**, near the end of the import order, are only what is
left over after that: the wordmark and the two bars that were silently clipping
their own controls. **Two more used to be on that list and are not any more**, and both left for the
better reason. Since 2026-08-31 the prose gutter is icons at every width, so there is
nothing for a narrow window to ration ([prose-gutter-icons.md](../plans/prose-gutter-icons.md)) —
3.7rem of them since 2026-09-04, when the targets grew to WCAG's 24px
([260904b-gutter-help-button-and-detached-streaming-chat.md](../plans/260904b-gutter-help-button-and-detached-streaming-chat.md)),
and back to 2.2rem — one 24px column — the day after, when the gutter stopped
reserving room and started measuring it: it is a size container, and a
`@container` query draws as many controls as the row has space for, with a "…"
for whatever is left over
([260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md](../plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md)).
**That is the one place in this stylesheet where a container query decides what
is drawn**, and it is worth knowing about before reaching for a media query for
something a box already knows; and
since 2026-09-03 the mode band going full-screen is a *class*, not a query — `Reader` writes
`band-covers` on `.reader` from `fit.modeW === 0`. That one could never have been a width: the
crossover is the window minus the rail, so it moves with `?spine=0`, and the `@media (max-width:
843px)` that guessed it disagreed with `fitMode` from 832 to 843 with the rail off, laying the band
over an article the table had just been squeezed to make room for
([`styles/narrow-window.css`](../../src/web/styles/narrow-window.css) § a band with no room).
That is the shape to aim for — a breakpoint disappears when the wide layout stops being
extravagant or when somebody who knows the answer writes it down, not when the narrow one gets
another rule.

**And it happened again on 2026-09-05, in the first of those two ways.** § a narrow window carried
four `display: none` rules taking the controls bar's labels, the `↑↓` readout, the `fit`/`auto` and
`reading`/`outline` chips and the tree version off a phone. The wide bar was then cut down to the
granularity pills and nothing else
([260905d](../plans/260905d-declutter-the-reading-view-top-bars.md)), so the two widths agree by
construction and the four rules had nothing left to hide.

Three things worth carrying to whatever is built next:

- **The breakpoint is derived, not chosen.** `731px` is `GIST_MIN + PROSE_MIN + the spine`, minus
  one — the width at which layout.ts gives up the last gist column and the prose column *becomes*
  the window. `tests/layout.test.ts` pins the crossover on the TypeScript side; since 2026-08-28
  `tests/spine-width.test.ts` reads the query out of the stylesheet and checks it against the same
  sum, which is the half a layout test cannot see. Both are needed: the number is written down five
  times and the compiler checks none of them. **It was six until 2026-09-03**, and the one that went
  is the interesting one — see the paragraph above: a derived breakpoint that is only correct in one
  spine state is not a copy to keep in step, it is a copy to delete.
- **A row that does not fit must scroll, never clip.** `.dock-modes` had `overflow: hidden` for a
  good reason (rounded corners on a segmented control) and it quietly turned into a machine for
  deleting buttons: 48px of clip over a 245px control, five of six modes unpressable, no scrollbar
  and no sign anything was missing. `flex: none` on anything whose overflow is hidden, and
  `overflow-x: auto` on the bar around it — **at every width, not inside a media query**, which is
  the second half of the same lesson: that fallback lived in the 731px query until 2026-09-02, so
  the one width band where the bar had started overflowing again had no floor under it.
- **When what has to fit is the content, a media query is the wrong tool.** The bottom bar dropped
  its labels at `max-width: 1100px`, a number measured against six modes. At thirteen the spelled-out
  row wants 1416px, so two thirds of a laptop screen showed every label *and* ran the last buttons
  off the edge. It is measured now — [`src/web/dock-fit.ts`](../../src/web/dock-fit.ts),
  [`styles/dock-fit.css`](../../src/web/styles/dock-fit.css) § the bar's fit ladder, and
  [260902k](../plans/260902k-the-bottom-bar-measures-its-own-fit.md) for the shape of the argument.
  A breakpoint is right when the *window* is what changed; this bar keeps growing instead.
- **`.controls` is usually not there at all**, since 2026-09-08. What is left in it is Hierarchy's
  granularity pills and a visitor's read-only chip, so on every other reading view it was 44px of
  nothing — held on screen in a band mode by the guard below, which is how a reader came to report
  it. `Reader` draws it only when `barHasContent` ([`src/web/layout.ts`](../../src/web/layout.ts))
  says there is something to put in it, and `:root:not(:has(:where(.reader) > .controls))` in
  [`styles/shell.css`](../../src/web/styles/shell.css) then lets `--bar-bottom` fall to the status-bar
  inset. Two things follow that will catch you out: **`.controls` is not a safe thing to
  `querySelector`** — an author's prose may contain one and the sanitiser keeps it, so ask
  `controlsBar()` in [`src/web/scroll.ts`](../../src/web/scroll.ts) — and every rule keyed on the
  bar's *presence* now has a state where it is absent.
  [260908a](../plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md).
- **`.controls` moves by `transform`; everything under it moves by `top`.** A bullet here used to
  say a transform on that bar computed to identity and could not be used. That was wrong, and it was
  wrong for the reason [browser-testing.md § a hidden tab](browser-testing.md) now describes: a CSS
  transition does not advance in a tab that is not frontmost, so every reading of the moved bar
  returned the value it started from and agreed with itself. Verified with transitions disabled,
  2026-08-27: switching `--bar-bottom` gives `matrix(1,0,0,1,0,-44)`. The split is a real one and
  worth keeping — a transform moves only the paint, where animating a sticky element's own `top`
  re-runs the stickiness constraint every frame — but it is a choice, not a limitation.
- **The bottom bar moves the same way**, since 2026-08-28, driven by `--dock-bottom`: the
  bottom-edge twin of `--bar-bottom`, `0px` while the bar is away and its resting room otherwise.
  Anything pinned *above* the bar (the mode band, the overflow fade) reads it directly; anything
  that must clear the bar permanently (`.reader`'s bottom padding, the dialogs) reads `--dock-space`
  instead. **Do not tie the document's height to the moving one** — a page that grows and shrinks
  under the finger scrolling it is worse than a bar in the way.

The full account, including what the measuring harness cannot see, is
[docs/plans/260827t-mobile-reading-view.md](../plans/260827t-mobile-reading-view.md).

## What a control owes a finger

`narrow-window.css` § **a coarse pointer** is where a control's size for a finger is decided, and
until 2026-09-08 it had reached the bottom bar and one footnote link and **nothing inside a mode
band** — because Greg was pointing at the bottom bar when he asked for it:

> Also, make our button-bar at the bottom a bit easier to press, e.g. bigger buttons, slightly more
> spaced out.
>
> — Greg, 2026-08-28

The only other control it ever reached is the footnote's *back to your place* link
(`footnotes.css` § a coarse pointer, 2026-09-06, 44px). Everything in a mode band was whatever
height its text happened to be. The order rows in the glossary and quotes bands were **23px**, and
64% of a row's own box was not on a button. That is
what SPIDERYARN-READING2-2J was reported against
([260908a](../plans/260908a-glossary-order-button-not-clickable-on-touch.md) — which is also honest
that the incident was never reproduced, and that a floor is not a diagnosis).

Two rules now live there beside the dock's, and both are floors rather than fixes:

- **40px minimum on the two order rows**, the same number the dock's buttons answer to — Apple's
  44pt less the hairline a neighbour shares.
- **16px minimum on every text field**, in its own section (§ a field iOS zooms into) and under
  **`any-pointer: coarse`** rather than `pointer: coarse`. iOS Safari zooms the whole page in when a
  field under 16px takes focus and does not zoom back out, and every piece of this app's chrome is
  `position: fixed` against a viewport the reader can then no longer see all of. The usual counter is
  `maximum-scale=1` on the viewport meta, and it is not available here: it would take pinch-zoom off
  the article. So the field moves instead — and it moves for any device with a touchscreen, because
  one point of type is not the chrome the paragraph above is rationing, and an iPad with a Magic
  Keyboard reports `pointer: fine` while its reader still taps the glass.

  Two things about that rule are load-bearing rather than decorative. **It lists the types that
  raise a keyboard rather than excluding the ones that do not** — the negative version reached the
  feedback dialog's visible `type="file"` picker, a control with no keyboard and nothing to zoom.
  And **it carries a `:root` for specificity**, said out loud rather than hidden: the fields are
  styled by classes, `.remember .chat-input` is two of them, and a rule that loses is
  indistinguishable from one that wins anywhere but a rendered page. This rule shipped broken twice
  on exactly that, and a browser caught it both times while the suite stayed green.

  **The utilities layer is out of reach from it.** `@layer theme, base, app, utilities` puts every
  `tw:` class after the stylesheets, so the four Tailwind-styled fields — sign-in's email and
  password, the shelf's search, Add URL, and the library's in-place title editor — carry
  `tw:any-pointer-coarse:text-base` at their own call sites.

[`tests/touch-controls.test.ts`](../../tests/touch-controls.test.ts) holds both, and says in its own
header what a text scanner can and cannot prove about whether a finger lands on a button.

**The band's other controls have not had this treatment**: the threshold slider is 16px tall, and
half a dozen buttons in the glossary band are between 19 and 28. The floor went to the control that
was reported, not to the band.

## The screen is bigger than the window: `env(safe-area-inset-*)`

`index.html` carries `viewport-fit=cover`, so on an iPhone the document is laid out across the whole
physical screen and the notch, the home indicator and — in the installed app — the status bar all
overlap it. [`styles/tokens.css`](../../src/web/styles/tokens.css) § **safe areas** turns each edge into a
token (`--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right`) and every piece of fixed or sticky chrome adds the one it faces. The
article itself does not: prose running a few pixels behind a rounded corner is what `cover` is for.

Three things to know before touching any of it:

- **Every one of them is `0px` on every machine we develop on**, so a rule with a mis-typed `env()`
  name falls back to the same `0px` and looks perfect. There is nothing to see until it is on a
  phone. To check one, set the token to `40px` at `:root` and watch the chrome move — a rule that
  cannot be made to move that way will not move on the device either. Run a nonsense control
  (`--zz-control`) alongside it, or you are testing your method rather than the rule.
- **`cover` is not standalone-only.** In an ordinary Safari or Chrome tab it also opens up the notch
  in landscape and the home indicator in portrait, and Safari's bottom inset *changes* as its
  toolbar minimises. Only the top inset is reliably zero in a tab.
- **Two things cannot do this arithmetic in CSS** and read the numbers through
  [`src/web/safe-area.ts`](../../src/web/safe-area.ts): `fitView`, which divides the window's width
  in pixels and must not spend width the notch has taken, and `stickyOffset`, which predicts where
  the controls bar's bottom edge will be. Reading the custom property back is not an option —
  an unregistered one is never substituted for the CSSOM, and `@property` does not survive this
  build. So the module measures a probe instead.

The plan, the review that found three of these, and the install path they exist for:
[docs/plans/260828av-mobile-screen-real-estate.md](../plans/260828av-mobile-screen-real-estate.md).

## See also

- [design-css-overview.md](design-css-overview.md) — the map this was split out of:
  the stylesheets in load order, which mechanism owns which rule, and the colour tokens
- [controls.md](controls.md) — the one height and one radius the controls in these rows agree on
