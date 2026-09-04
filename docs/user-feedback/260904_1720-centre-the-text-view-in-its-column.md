# Always centre the Text view within its column

**[SPIDERYARN-READING2-18](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-18)** · reported
2026-09-04 17:20 UTC · resolved 2026-09-04 · *shipped, with no conditional*

## What the reader said

> Always centre the Text view within its column when visible, no matter which mode is active. It
> looks better that way.

## The framing was wrong in a way that made the job easier

The first read of this was "there is a conditional centring rule and he is asking us to delete a
condition" — and conditions usually exist because a case needed them.

Not so. `Fit.alone` and `PROSE_ALONE_MAX_REM` centre the whole **table** when the prose is the only
column. **Nobody had ever centred the measure inside its cell.** So this *adds* a rule beside the
existing one; `src/web/layout.ts`, the cap and `tests/text-alone-centring.test.ts` are untouched, and
the new test is a sibling rather than an edit.

He was right about the symptom: in a band mode at 1600px the prose cell is ~1190px while the measure
is ~740px, all of the slack sitting on the right.

## What shipped

`margin-inline: auto` on `.prose`, self-limiting so it does nothing once the cell is narrower than
the measure. The block gutter follows with `left: calc(0.35rem + max(0px, (100% − pads −
measure)/2))` — written out separately rather than sharing a variable, because `100%` in the gutter
is the cell's *padding* box while `margin-inline: auto` divides the *content* box.

Measured, not eyeballed. Summary at 1600px: 230.5px left, 219.3px right — the 11.2px asymmetry is
exactly `--text-pad-l` − `--text-pad-r`. At 900px and 390px every mode is a no-op to the pixel.

## Two things that had to follow the text, and one that had to opt out

**The masthead.** A centred column under a left-aligned title looks like a bug, so the title moves to
the prose's own left edge. `margin-inline: auto` would not do it: the bar reserves 24px on the left
against 144px on the right for Feedback, so auto would have landed the title 60px out.

**The column header** — and this is where the report nearly got answered wrongly. Shipped as asked,
Hierarchy looked *worse*: `TEXT verbatim` stayed at the cell's left edge, ~180px from the text it
names, while `PARTS` and `SECTIONS` sat squarely over theirs. The implementing agent's recommendation
was to stop centring when a gist column is beside the prose.

**Overruled, because the same defect had already been fixed once in the same change.** The masthead
was a left-aligned title over a centred column and was fixed by moving the title, not by un-centring
the prose. The header is that bug with a different element. So the header moves too: **−0.016px**
between header-left and first-word-left at 1600px.

Second look, after: *"The detached header was the whole of it… the two things that name the column
now share an edge, and the space reads as the text column's own margin rather than as a column that
failed to line up."* So no conditional, and Greg's literal request survives intact.

**Footnotes opt out as a block.** `.notes-head` and `.note-num` are absolutely positioned at their
own 0.8rem/600, so the same offset means something ~90px different there — a centred note would have
stranded its own number 200px away from it.

## Three traps found by measuring rather than reasoning

- **`ch` depends on the variable font's weight axis, not only its size.** A 2.8px error in the
  gutter until it matched weight too. `.masthead-inner` deliberately matches size only: the byline
  and source note inherit weight from it, and emboldening four pieces of small print is a worse
  trade than 2.8px.
- **A table cell does not resolve percentage padding against its own width.** The obvious version —
  the offset as `padding-left` on the `<th>` — put the heading **239px past** the prose. Hence a
  margin on a block *inside* the cell, where `100%` is defined. Probed in a browser before the app
  was touched.
- **This build cannot have a registered `@property`.** Vite/Tailwind silently replaces it with its
  `initial-value` — verified in a real browser (registered property correct, unregistered twin 68px
  out) before accepting that the clean fix was ruled out.

## Left as it is

Plain is not quite a no-op: the 50rem cap rounds up, so the cell is ~6px wider than 65ch and the
documented "title 4px left of the prose" is now 6.5px. The alternative is a `:not(.text-alone)`
exception, which reintroduces exactly the conditional this report asks to be rid of.
