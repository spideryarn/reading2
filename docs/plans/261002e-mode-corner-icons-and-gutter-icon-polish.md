# The band's corner icons, and the gutter's

**Status:** planned 2026-10-02; revised after the Sol plan review (below).

Two reports from Greg the same morning, both about small icons not lining up or not answering.

`spya-hf4svm`, on Summary:

> We've added (i) and profile icons to every mode. Great. But their position/sizing/alignment looks
> a bit off, especially on a phone. Take screenshots and see if you can improve this. And perhaps
> update docs or make this reusable/template as part of creating new modes so that it's a bit more
> standardised.

`spya-jc0vm6`, on Glossary:

> Re the icons in the vertical gutter next to a block:
> - Problem: when I hover my mouse over the Bookmark icon, it doesn't glow
> - Make sure they all have tooltips
> - Also, please slightly increase the vertical gaps between them

## What the screenshots showed

The screenshots were taken with Playwright against the local dev server on `ds-spya-me0d4g`, at a
phone (390), an iPad (820) and a laptop (1440) width. They are in the session scratchpad, and the
boxes below are CSS px from its `before-boxes.json`.

**The corner.** Every band has its (i) (plan 261001m), placed by `ModeSurface`, the same in every
mode. The profile badge (`WrittenForYou`, "written for you") is not: **each mode puts it in its own
top row, wherever that row has room.**

| | (i) | profile badge |
|---|---|---|
| size, phone/iPad | 24 × 24, no ring | **40 × 40, with a ring** (narrow-window.css gives `.prof-badge.icon-only` the 2.5rem finger floor) |
| size, laptop | 24 × 24 | 19.8 × 19.8 |
| centre line, phone | y 19.2 | y 28.4 in Summary (**9px lower**), 26.4 in Quotes |
| where | top-right corner, every band | Summary, Quotes: left of the (i), at varying gaps. **Ideas and Tweets: top-left**, as the row's first item. Glossary: **a second row** down. |

So on a phone the two icons in the corner are a 40px ringed circle beside a 24px bare glyph, on two
different centre lines, and on a laptop the gap between them is different in every mode.

**The gutter.** The permalink, chat and "?" turn `--highlight` (orange) when pointed at. **The
bookmark button stays grey, and so does the "…"**, because neither has a `:hover` colour rule: the
three that glow were each given one separately (`.blk-permalink:hover`, `.block-chat:hover`,
`.blk-help:hover`) and the two that came later were not. Every control has a `title`, but a native
title appears only after about a second, in the browser's own style, and tooltips.md calls a native
`title` a regression. That is likely why they read as "no tooltip". The slots are 24px apart, which
leaves 9px between two 15px glyphs.

## The design

### 1. One corner, owned by `ModeSurface`

`ModeSurface` gains a `profile?: ReactNode` slot beside `about`. When it is given one, the corner
becomes a small row, `.band-corner`, positioned exactly where the (i) is now, holding **the profile
badge, then the (i)**:

```
┌ mode-band ─────────────────────────── (👤)(i) ┐   ← ModeSurface's, every mode the same
│ [the mode's own top row, padded clear]        │
```

- **One size for both**: a new `--band-corner-btn`, 1.5rem with a pointer and **2rem on a coarse
  pointer**, for the (i) and the badge alike. A 40px ringed circle in the corner is the thing that
  looks wrong on the phone. 2rem (32px) is above WCAG 2.2's 24px minimum. It is under the 2.5rem
  floor the sort rows use, but a corner icon has no neighbour to hit by mistake.
- **The badge in the corner is the bare icon**, with no ring, like the (i) beside it. Its colour
  still carries the changed-profile state, and the panel it opens still says that state in words
  (WrittenForYou.tsx § `compact`).
- **`--band-about-room` grows with what is in the corner.** `.has-profile` adds a second
  button's width and the gap. Every top row already pads its right edge by that variable, so no
  mode's stylesheet changes.
- `WrittenForYou` takes a `corner` prop rather than a new component: the panel, labels and
  Regenerate are unchanged. The modes stop placing it and pass it as `profile=` instead: Summary,
  Glossary, Quotes, Ideas, Tweets.
- **Ideas loses its words.** It is the one mode that shows *"written for you"* in full, and its
  comment argues the words matter more there. Greg asked for standardisation, so it becomes the
  same icon as everywhere else. The panel's first line says the same fact in words.
- **Sketch** draws its badge in `.sk-bar`, inside Diagram's band, and SketchView is one of
  several pictures that band switches between. It moves to the corner if lifting it into
  `DiagramPanel` is small; otherwise it is deferred by name below.

The guard in `tests/every-mode-draws-its-surface.test.tsx` already finds the (i) as the band's
first child. It will look for `:scope > .band-corner > .band-about` instead. A new check in the same
sweep: any `.prof-badge` in a populated band is inside the corner. That makes "the badge goes in the
corner" something a new mode cannot forget, which is the "reusable/template" half of the report.

### 2. The gutter

- **One hover rule for all five controls**: `.blk-permalink, .block-chat, .blk-bookmark,
  .blk-help, .blk-more` turn `--highlight` when pointed at. The three existing per-control rules
  fold into it. `.blk-cmt` (the reader's own mark) is already `--highlight`; it lifts to full
  opacity, as now. `.block-chat.has` stays blue at rest, as it must (gutter.css says why), and
  turns orange on hover as it already does.
- **House tooltips, through the card the gutter already has.** BlockLinkCard.tsx is one delegated
  card for the whole reading view. It already serves the gutter's reading-time line, and it exists
  because a Floating UI instance per trigger is too many on a long article. The gutter's controls
  join its selector. Each control carries its words in `data-tip` instead of `title`: the same
  strings, kept state-dependent where they already are (the permalink's *Copied*, the chat count).
  The card is drawn with `ControlTip`'s shape, using the same classes and delays as every other
  tooltip. Removing `title` stops a native one from appearing on top of the house one. A finger
  gets no card, as now: the card is pointer-only, and a tap on a gutter control does the thing.
  The card refreshes if the open control's `data-tip` changes (the permalink after a copy).
- **A 4px gap between slots**: `row-gap: max(0.25rem, 4px)`, which makes 13px between glyphs instead
  of 9. **The cost**: the container queries that decide how many controls a row can draw are
  thresholds of n × slot, and become n × slot + (n − 1) × gap: two slots at 52px/3.25rem instead of
  48/3rem, three at 80/5rem instead of 72/4.5rem, four at 108/6.75rem instead of 96/6rem. A row in
  the 4px band below each new threshold folds one control behind the "…". No row gets taller.
  The rem and px halves still flip at the same 16px root, so the `and` form stays exact.
  `tests/gutter-target-size.test.ts` pins these strings, and moves with them.

### Docs

- mode.md, under *Every band has an (i)*: one line saying the profile badge goes in `profile=` and
  lands in the corner. This is signposting, not a rule change.
- design-css-overview.md § The band's (i): the corner row and `--band-corner-btn`.
- tooltips.md: the gutter's controls are the delegated card's, with no `title`.
- The comments in gutter.css and BlockGutter.tsx that say `title`.

## The simpler options passed over

- **Fix the sizes and leave the badge where each mode puts it.** This is less churn, but the
  report is about the badge and the (i) not lining up, and a badge in five different places cannot
  line up with anything. It would also leave nothing for the next mode to follow.
- **Keep `title` on the gutter and add only the hover colour.** Every control does have a title, so
  "make sure they all have tooltips" might be met on paper. But a second's delay and the browser's
  own style is why it reads as missing, and the delegated card is already in the reading view, so
  joining it costs a selector and a branch.
- **A bigger slot instead of a gap** (`--blk-slot` 24 → 28px): this gives the same space, but grows
  the one-line paragraph's floor and the rhythm with it. A gap only moves the thresholds.

## Deferred, by name

- **Sketch's badge**, if lifting it out of SketchView into DiagramPanel's band turns out to be more
  than a prop. The plan doc's status will say which.
- **Tweets' copy button** sits about 2px off the (i)'s centre line. This is the mode's own head row,
  and the corner change may fix it; if it does not, it is noted rather than chased.
- **The phone gutter shot.** The screenshot script could not select a row by tapping; the touch
  reveal is untouched by this plan, so it is checked by the existing tests rather than a new shot.
- `fbkd5dk5-gutter-icons-right` is a queued session whose name says it will move the gutter. It
  starts hours after this lands, so it will build on this rather than collide with it.

## Stages

1. The corner: `ModeSurface.profile`, `.band-corner`, sizes, the five modes moved, the guard.
2. The gutter: hover rule, delegated tooltips, gap and thresholds, tests.
3. Docs, `npm test`, `npm run typecheck`, lint on touched files, after-screenshots at the three
   widths, GPT Sol code review, push to `dev`, feedback note.

## What GPT Sol's plan review changed

`261002e-…-plan-review-sol.md`, verdict *revise then build*. Every finding was checked against the
code and held. What moved:

- **No `.band-corner` wrapper** (finding 4). The badge is a second direct child of the band, after
  the (i), positioned absolutely one button-width to its left. The (i) stays first in the DOM and
  in tab order, as plan 261001m decided; the badge comes next. `mode-surface-changes-no-markup`'s
  baselines keep `button.band-about` first.
- **Whether a badge is there is asked of the DOM, not of the prop** (finding 1). `WrittenForYou`
  returns `null` for an unprofiled artefact, and a `ReactNode` cannot say that ahead of time. So the
  room grows with `.mode-band:has(> .prof-badge)`, and nothing is reserved for an absent badge.
  The tests mount both a profiled and an unprofiled fixture.
- **The corner's own styling beats the coarse floor** (finding 2): `.mode-band > .prof-badge`
  resets `min-width`/`min-height`, and sets the border to none, inside the same `pointer: coarse`
  block that sets the 2.5rem floor. That floor still applies to badges outside the corner.
  WrittenForYou needs no new prop: the band's selector owns the corner look.
- **A head row always holds the corner** (finding 3). Glossary, Quotes and Ideas keep their
  fragment heads, so the row survives with nothing in it. `.mode-band.has-about > .band-head` gets
  a `min-height` of the corner button plus its two insets, so an emptied row is exactly as tall as
  the icons it holds, and the corner can't hang into the list below.
- **Tooltips open on mouse hover and on keyboard focus, never on touch** (finding 5).
  `focusin` stays as it is.
- **The card re-reads `data-tip` when it changes** (finding 6): the open trigger is watched for
  `data-tip` attribute mutations, so *Copied*, *Couldn't copy* and More → Close update in place.
- **One line, not a `ControlTip`** (finding 8): the gutter's tips are one sentence each, drawn with
  `TipNote`. The card adds **no `aria-describedby`** to a gutter control, because its words already
  are, or nearly are, the control's `aria-label`; it would only be read twice. `.blk-cmt` joins
  the selector.
- **The `title` tests become `data-tip` tests**, plus a "no `title`" check and a hover/focus card
  test (finding 9).
- **The one-slot negated query moves too** (finding 7): `not ((min-height: 52px) and
  (min-height: 3.25rem))`. Sol confirmed the positive thresholds, 52/3.25, 80/5 and 108/6.75.
- **`.blk-permalink.failed` keeps its red** (finding 11): the shared hover rule is written before
  it, so equal specificity and later source order still give the red. The shared colour applies on
  `:focus-visible` too.
- **Sketch is deferred** (finding 10): `OwnerSketch` owns `useSketch` below Diagram's surface, so
  the badge cannot be handed up as a prop; it needs a render-prop or an owner wrapper. It stays in
  `.sk-bar`, its picture's own toolbar, for now.
