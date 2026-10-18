# On a phone, the paragraph's icons come up above it, and the prose gets the column back

**Status:** built 2026-10-18, on `dev`. Read § What the plan review changed and § What the screenshots showed; § The design below is the pre-review draft, and those two sections supersede it where they differ. Report `spya-k49y3q` (#600, suggestion, admin), Overseer queue item
`qi-zcxnha83`, Sentry SPIDERYARN-READING2-JP.

> I would love to make just a tiny bit more horizontal space for the text in portrait mode on a
> phone, or more generally. So I think we could edge the text slightly closer to the left towards
> the spine. And then on the right-hand side, we leave space for the gutter for the icons for sort
> of permalink and question and chat and bookmark. I understand why we're doing that, but most of
> the time we're not using that space and it's just a waste. So I'm wondering is maybe we could
> find a different way to reveal them. We only reveal them on click—oh, sorry, tap, a touch on the
> paragraph anyway on a mobile or touch device. So I wonder if we could put them above or below
> instead of to the side. I don't know. Take screenshots. Perhaps consider the best practices. It
> works pretty well, and I'm reluctant to make it worse. But yeah, it does seem like a waste that
> there's a bit of space to the right of every single paragraph on a portrait mobile phone where
> that horizontal real estate is really precious that we're not using most of the time, and that we
> only need it when there's an explicit action. So it feels like there might be somewhere else or
> something else we can do on an explicit touch to reveal those icons. Take screenshots. Use your
> judgment.
>
> — Greg, 2026-10-17

## References

- [gutter.css](../../src/web/styles/gutter.css) § the gutter: the column, the container queries
  that decide how many icons a row draws, the `(hover: none)` reveal on `tr.row-active`, and the
  "…" panel.
- [shell.css](../../src/web/styles/shell.css): `--text-pad-l` / `--text-pad-r`. The right pad *is*
  the gutter's column, computed from it.
- [narrow-window.css](../../src/web/styles/narrow-window.css) `@media (max-width: 731px)`: the phone
  already shrinks `--text-pad-l` to 0.9rem.
- [touch.md § The gutter, and the row a finger is on](../project/touch.md#the-gutter-and-the-row-a-finger-is-on):
  at rest the gutter shows *state*, and a tap shows *affordances*.
- [260908e](260908e-gutter-icons-on-touch-only-when-a-block-is-selected.md) (tap to reveal) and
  [261003c](261003c-block-gutter-icons-move-to-the-right-of-the-block.md) (the column moved right).

## What it looks like now (390 × 844, touch)

Shots `261018g-shot-1-before-phone-rest.png`, `-2-before-phone-tapped.png`,
`-3-before-phone-more-open.png`, `-3a-short-paragraph-tapped.png`, `-4-before-ipad-tapped.png`.

| | px |
|---|---|
| spine | 0–12 |
| left pad (`--text-pad-l`, 0.9rem) | 14.4 |
| text | ≈ 325 of 390 (83%) |
| right pad (`--text-pad-r`, the column) | 35.2: a 24px slot plus 5.6 each side |

At rest that 35px is empty on almost every paragraph. The things in it are the reading-time
hairline, a bookmark mark with its count, and a blue chat mark with its count. A tap reveals the
permalink, chat, bookmark and "?" in a vertical column, and a short paragraph folds the rest
behind a "…".

## Best practice, briefly

Touch reading apps show actions for a passage you tapped in a **floating bar next to it**, not in a
column reserved down the side of every paragraph. Examples are iOS's edit menu, Apple Books' and
Kindle's highlight bars, and Medium's highlight menu. The bar sits above the touch point, so the
finger does not cover it. It overlaps whatever is there, and it goes away when you tap somewhere
else. Space is only used when there is an explicit action, which is what Greg asked for.

## The design: only on a phone-sized touch screen

The condition is `@media (max-width: 731px) and (hover: none)`. That is the existing phone
breakpoint, restricted to a finger. A narrow desktop window has a mouse that hovers, so it keeps
the column, and the iPad keeps it too: it has room, and the report is about the phone. "Or more
generally" is deferred (see below).

1. **The prose gets the room.** On the phone `--text-pad-l` goes from 0.9rem to 0.6rem, edging
   the text towards the spine as asked. `--text-pad-r` goes from 35.2px to 1.1rem (17.6px), which
   is just wide enough to hold a 15px glyph. Together that gives about 22px more line, roughly 7%
   (≈325 → ≈347px at 390).
2. **At rest, the strip shows state only, and it is smaller.** The bookmark mark and the blue chat
   mark (the two facts the column shows at rest) stay, as glyphs in the 17.6px strip, without their
   counts. They are **indicators, not buttons** there (`pointer-events: none`), so a tap on one
   falls through to the cell and selects the row. That is the same tap that opens the bar, and the
   bar has the full mark with its count. The reading-time hairline stays beside the strip. Its hover
   target is moot on a finger.
3. **A tap shows a horizontal bar above the paragraph.** On `tr.row-active` the gutter stops being
   a column. It becomes a one-row, opaque, bordered and shadowed bar of 24px targets with an 8px gap,
   at the paragraph's top-right corner, overhanging **upward** into the gap and the previous
   paragraph's last line. It holds the mark (with its count) if there is one, then the permalink,
   chat (with its count), bookmark and "?". All of them always fit (≤ 5 × 24 + gaps ≈ 160px), so
   the container-query count and the "…" are not used on the phone. The bar is
   `pointer-events: auto`, and `.blk-gutter` is already in `NOT_A_BLOCK_SELECTION`, so a tap on its
   padding does not select the paragraph underneath. This is the same consent argument as the "…"
   panel: an overhang you asked for, which goes when you tap elsewhere.
   **Above, not below**: the finger is on the paragraph, and the next lines are what you are about
   to read.
4. **What stays the same:** the desktop and the iPad, every JS path (selection, the tap rules, the
   handlers), the spine, the marks in the prose, and the heading's fold chevron (it sits at the
   prose's right edge, inside the measure).

Everything is CSS, in one new block at the end of gutter.css § the gutter, plus the two pad tokens
in narrow-window.css's phone block (restricted to `hover: none` by a nested query). There is no
schema or prompt change, and no change to who can see what.

## Trade-offs, named

- **A bookmark or chat mark at rest becomes an indicator: two taps to open it, where it was one.**
  The passage's own highlight in the prose still opens a comment in one tap. The count is shown only
  in the bar.
- **The bar covers the right end of the previous paragraph's last line** while a paragraph is
  selected. It covers nothing while you are reading.
- **The first paragraph on screen** puts its bar up under the top bar, or off the top of the
  article. The top bar leaves on scroll, and v1 does not flip the bar below. That is deferred until
  a screenshot shows it hurts.

## The simpler options passed over

- **Shrink the pad and let the revealed column overlay the prose.** One line of CSS, but it covers
  the right edge of the very paragraph you just tapped, all the way down it. Greg asked for above
  or below.
- **Drop the right pad entirely** and put the marks at rest somewhere else (the spine, the end of
  the paragraph). That gains another 17px, but the marks are state the reader is meant to see
  beside the paragraph, and moving them is a bigger change than this report asked for.
- **A bottom action bar fixed to the screen** (iOS Photos' selection bar). It is further from the
  paragraph, needs JS, and fights the existing bottom bar.

## Deferred

- **The iPad / "more generally"**: whether the same bar should replace the column on every touch
  screen, so the iPad gets its 35px back too. Queued as its own entry, because it is a bigger
  visual change on a device where room is not scarce.

## Checked by

- `npm test`, `npm run typecheck`. `tests/gutter-target-size.test.ts` and
  `tests/gutter-touch-contrast.test.ts` keep asserting what they do. A new test pins the phone
  block: the pads, the condition, and that the active bar is horizontal and `pointer-events: auto`.
- Before-and-after screenshots at 390 × 844 touch (rest, tapped on a long paragraph, tapped on a
  short one and on a heading, a marked paragraph at rest and tapped, the first paragraph under the
  top bar), and at 820 × 1180 touch and 1440 desktop to show that nothing changed there.

## What the plan review changed

GPT Sol (`261018g-phone-gutter-plan-review-sol.md`) found no P0, and three P1s that were taken:

- **The bar names every control.** Once the gutter is no longer a size container, the
  height-counting `@container` rules stop matching, and without them every control but "…" is
  `display: none`. So the bar sets `display` on each control by name, hides "…", and sets the mark's
  opacity and pointer events explicitly. `tests/gutter-phone-bar.test.ts` pins this.
- **The marks at rest stay one tap, not two.** § The design said they would be indicators only.
  Instead the gutter box stays 24px wide, flush with the cell's edge, so a mark keeps its 24px
  target, reaching 4px past the pad into the prose. The glyph is drawn inside the pad. This takes
  back the first trade-off below.
- **`z-index: 3` on the bar**, as the open panel has, so it is not left to the stacking order of
  the coarse-pointer `z-index: 1` controls in the row above.

Not taken: Sol's cleaner alternative, a `.blk-actions` wrapper round the controls so that only the
wrapper becomes the bar. It would have rewritten every `.blk-gutter > *` rule and the
`:nth-child` count. Instead the reading-time hairline is `display: none` on the selected row only,
and moves to the cell's outer edge at rest, because the 1.25rem pad has no room for a gap, a line
and a glyph. A heading's and a footnote's own gutter boxes are outranked by specificity (0,3,2)
rather than reset one by one. Sol's P2 on scope is taken in the wording: the condition means "a
narrow window with no hover", which includes an iPad in a narrow split view. That is right, since
the question is room and a finger.

## What the screenshots showed

Shots 5–11 (`261018g-shot-…`), 390 × 844 touch unless named:

- The text runs 21.6 → 368.9, **≈347px against ≈325 before** (+7%). There is no horizontal
  overflow.
- At rest the strip shows only the marks and the hairline at the edge (shot 5).
- Tapped, the bar is 134 × 30, flush right, and ends at y 729.7, where the paragraph's text starts
  at 729.5. It holds the permalink, chat, bookmark (or the mark with its count) and "?", with no
  "…" (shots 6, 7, 8, 9). The permalink copies, and a tap on the bar's padding leaves the selection
  where it was. A mark at rest opens its comments in one tap.
- **The cost, seen:** over a previous paragraph's last line the bar usually sits in blank space.
  Over a long heading line it hides the line's last word while the row is selected (shot 7,
  "YORK."). That is the overlay trade-off named above, and it lasts only until the next tap.
- The iPad (shot 10) and desktop hover at 1440 (shot 11) are unchanged: the vertical column.
- Not cleanly tested: the very first paragraph under the top bar. Also, in one run the browser
  agent saw taps stop selecting rows after a comment dialog had been opened. It did not reproduce
  in separate runs, and this change touches no JS, so it is recorded here rather than chased.

## What the code review changed

GPT Sol (`261018g-phone-gutter-code-review-sol.md`) found no P0, and fixed two P1s itself:

- **The pad has a px floor: `max(1.25rem, 19px)`.** At a 9px or 12px root, 1.25rem is narrower
  than the 15px glyph plus its 4px inset, so the mark would have overlapped the prose.
- **The reading-time strip's tap target is `--blk-slot` wide**, not the pad's width, to keep the
  24px target floor.

It also added regressions to `tests/gutter-phone-bar.test.ts` for both, and corrected the
specificity note in gutter.css. It found the cascade, `[data-open]`, the focus and failure states,
the one-slot sharing and `BlockGutter`'s focus logic sound.
