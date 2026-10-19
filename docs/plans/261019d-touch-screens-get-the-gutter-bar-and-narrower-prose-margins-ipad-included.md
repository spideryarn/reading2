# Every touch screen gets the gutter bar and the narrower margins, the iPad included

**Status:** built 2026-10-19, on `dev`. § What the plan review changed and § What the screenshots showed come after the design and correct it where they differ. Report `spya-eebnxu` (#609, suggestion, admin, sent from an iPad in
portrait with Marginalia on), Overseer queue item `qi-yksnyp7w`. It also answers the deferred half
of the last one, `qi-a2h4xwxw` ("iPad/every touch screen: the gutter bar instead of the column?").

> In a previous message, I said that it would be great to reduce the right-hand margin to make as
> much use of the horizontal real estate of the screen, especially, you know, on a narrow phone like
> a portrait iPhone. And we moved the few icons when you select a paragraph, like the permalink and
> the context and whatever, to the top right of the paragraph, so that we didn't need to keep that
> right-hand vertical gutter space all the time. Okay, great. I still feel like we could be making
> more use of the horizontal real estate. In other words, I think we could be shrinking the
> horizontal margins, especially on the right-hand side, and maybe even a tiny bit on the left-hand
> side to move it closer to the spine. And I think it depends on how much screen real estate we
> have, but if we really don't have much, even on a portrait iPad when I've got marginalia mode on,
> I think I might want a bit more right-hand margin for the text than conceivably even some
> left-hand margin, I'm not sure, so that I get just a few more characters on each line.
>
> — Greg, 2026-10-18 (spya-eebnxu)

(Read "a bit more right-hand margin for the text" as "a bit more of the right-hand margin given to
the text": the whole report asks for smaller margins.)

## References

- [261018g](261018g-phone-portrait-gutter-icons-above-the-paragraph.md): the phone half, built
  2026-10-18 and deployed before this report was sent (build 956a2380 contains 6b4437ae4).
- [gutter.css](../../src/web/styles/gutter.css) § a narrow screen and a finger: the bar.
- [narrow-window.css](../../src/web/styles/narrow-window.css): the phone's pad tokens, nested in
  `@media (max-width: 731px)`.
- [shell.css](../../src/web/styles/shell.css): `--text-pad-l`, `--text-pad-r`, `--blk-gutter-x`.
- [layout.ts](../../src/web/layout.ts) `fitMargin`: how the prose and the Marginalia column split
  the window.

## What it looks like now

Measured on the dev server for this tree, `/read/scaling-hypothesis`, touch emulated (`(hover: none)`
and `(pointer: coarse)` both match), 16px root. Shots `before-A…G.png` in the session scratchpad;
the after shots are committed beside this plan.

| | window | cell | pad L / R | ordinary paragraph's line |
|---|---|---|---|---|
| A phone, Plain | 390 | 378 | 9.6 / 20 | ≈348 (89%) |
| C iPad portrait, Marginalia | 820 | 544 | 22.4 / 35.2 | ≈486 (59%) |
| D small iPad portrait, Marginalia | 768 | 544 | 22.4 / 35.2 | ≈486 |
| E iPad Pro portrait, Marginalia | 1024 | 724 | 22.4 / 35.2 | 65ch cap (≈571) |
| F iPad landscape, Marginalia | 1180 | 808 | 22.4 / 35.2 | 65ch cap |

In C, where Greg was, the 820px goes: spine 12, left pad 22.4, text ≈486, right pad 35.2 (the
gutter column, empty on almost every row), then the Marginalia column, 264, whose notes start
`--marg-gap` (20px) inside it. So the prose's words end about 55px before the notes' words start,
and start 34px from the spine.

(The first pass measured a blockquote, which is indented further; the ≈486 and the 65ch cap of
≈571 are an ordinary paragraph's, from the after run.)

The phone (A) already has 261018g's numbers. What is left of its 42px is the 12px spine, a 9.6px
left pad, and a 20px strip that holds the bookmark and chat marks at rest (a 15px glyph and its 4px
inset; `tests/gutter-phone-bar.test.ts` holds that floor).

## The design

**Give every touch screen what the phone got: the bar above the paragraph, and the same two pads.**
That is exactly the deferred question `qi-a2h4xwxw`, and this report is Greg's answer to it: he
wants the room on an iPad too.

1. gutter.css § a narrow screen and a finger: the condition `(max-width: 731px) and (hover: none)`
   becomes `(hover: none)`. Nothing in the block depends on the width: the bar is ≤ four 24px
   controls (≈134px), positioned against the cell's right edge, which is wider on an iPad than on
   a phone.
2. narrow-window.css: the pad trio (`--text-pad-l: 0.6rem`, `--text-pad-r: max(1.25rem, 19px)`,
   `--blk-gutter-x: 0px`) leaves the `max-width: 731px` block for a top-level `@media (hover: none)`
   block placed after it, so it still beats the narrow window's `--text-pad-l: 0.9rem` by source
   order. It stays in narrow-window.css because shell.css says that is the one file that redefines
   the geometry tokens afterwards.

The result in C: the line goes from ≈486 to ≈514px, +28px or about 6%, three or four more
characters a line, and the words end 40px rather than 55px before the notes. The left pad is the
phone's 0.6rem everywhere a finger is, one rule rather than a value per width; Greg asked for "a
tiny bit" closer to the spine, and this is 12.8px closer.

**Where the line is already at its cap** (E, F, and Plain at most iPad widths), the prose stays at
`--reading-measure` (65ch) and is centred in its cell (`.prose`'s clamp), so the pads that went
become a few px of whitespace either side. Nothing gets worse; nothing gets wider either, which is
right: 65ch is the measure we chose on purpose.

**What does not change:** a mouse, at any width (the column it reveals on hover stays, because a
hover reveal over the prose would cover the words under the pointer); the layout arithmetic in
layout.ts (`proseAloneMaxPx`, `fitMargin`) works in cell widths and is untouched; every JS path.

## The phone, where there is little left

At 390 the words already take 89%. The remaining options each cost something, so they are named
here and not built:

- **Drop the at-rest strip** (20px) and draw the bookmark/chat marks somewhere else (the spine, or
  over the end of the line). The marks are state meant to sit beside the paragraph; moving them is
  a redesign, and drawing them over the words covers words.
- **Shave the strip or the left pad by 2–3px.** Under 1% of the line; not worth a change.

So the phone is left as 261018g left it, and the note says so.

## Options passed over

- **Rebalance the iPad's Marginalia split**: give the prose more of the 264px column
  (`fitMargin`'s `PROSE_MIN` priority). Greg's "it depends on how much screen real estate we have"
  points at it, but it is a product trade-off (notes at ~20 characters a line are already narrow)
  and a change to the fit everyone gets. Mentioned in the note rather than built.
- **Narrow `--marg-gap`** between the prose and the notes. It is shared by every window and every
  device, and with the right pad down to 20px the two now sit 40px apart, which is about right.
- **A smaller left pad on a mouse too.** Not asked for, and the desktop is not short of room.

## Trade-offs, named

The same as 261018g's, now on the iPad: a mark at rest is a glyph in a 20px strip without its count
(the count is in the bar); while a paragraph is selected, the bar can cover the last word or two of
the line above it.

## Checked by

- `tests/gutter-phone-bar.test.ts`: its condition becomes `(hover: none)`, and the pad test reads
  the top-level block. Watched red before the CSS moves.
- `npm test`, `npm run typecheck`.
- After shots, touch: 390 (unchanged), 768 and 820 with Marginalia (wider line, bar on tap, mark
  at rest), 1180 landscape; and 1440 desktop with a mouse (unchanged column).

## What the plan review changed

GPT Sol (`261019d-plan-review-sol.md`): no P0, *build with changes*.

- **P1, not taken: make the right pad a full `--blk-slot` (24px).** The mark's box is 24px and the
  pad 20, so the box reaches 4px into the prose, and on a heading the fold chevron (later in the
  DOM) takes those 4px: a mark on a heading has a 20px target. Fixing it costs every line on every
  touch screen 4px, which is the opposite of what Greg asked for, to fix a target that is still
  20px and only on marked headings. 261018g made the same call. Recorded in narrow-window.css §
  a no-hover screen, so the next reader sees it was weighed.
- **P2, taken: `(hover: none)` is the primary pointer, not "every touch screen".** A touchscreen
  laptop driven by its mouse reports `hover: hover` and keeps the column. The comments and
  touch.md say so.
- **P2, taken: check a band beside the prose, a band with Marginalia, a heading, a footnote and
  the masthead's alignment.** Below.
- **P2, taken: touch.md** said a full-width iPad keeps the column. Updated.

It found the cascade sound (shell.css before narrow-window.css, nothing more specific sets the
tokens) and no JS that keys off the old query.

## What the screenshots showed

Shots `261019d-shot-…`, touch unless named:

| | window | pads L / R | ordinary paragraph's line |
|---|---|---|---|
| iPad portrait, Marginalia | 820 (and 768) | 9.6 / 20 | 21.6–533.1, **511.5px against ≈486** |
| iPad landscape / Pro portrait, Marginalia | 1180, 1024 | 9.6 / 20 | 570.9 (the 65ch cap, as before) |
| phone, Plain | 390 | 9.6 / 20 | 347.2 (unchanged) |
| desktop, mouse, Marginalia | 1440 | 22.4 / 35.2 | 570.9 (unchanged) |

- At 820 the line is 25px longer, about three more characters (shot 1). The cell is still 544 and
  the notes column still starts at 556.
- A tap brings up the bar, 134 × 30, flush with the cell's right edge at 556, so it stops where
  the notes column starts (shot 2). The permalink copies and the row stays selected.
- A bookmarked row shows its mark in the strip at rest, and one tap opens it (shots 3, 3b). A
  heading's bar sits above it, clear of the fold chevron, which still folds.
- With a band (Summary), and with a band and Marginalia (Structure), at 1180, the bar stays inside
  the cell, and neither the page nor `.reader` scrolls sideways (shot 6).
- The masthead's title starts 2.3px right of the prose at 1024 and 1180, the same offset as the
  desktop's at 1440, so the alignment is as it was.
- A mouse at 1440 keeps the vertical column on hover (shot 8).
