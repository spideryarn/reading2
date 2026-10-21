# Phone sizes, part two: the citations' spacing, and the rest of the 40px targets

Follow-up to [261021c](261021c-minimum-text-and-touch-target-sizes-on-a-phone.md), which shipped
the 13px text floor and Chat's 40px targets. Overseer item `qi-c4nmmq5m`. The report is
`spya-y4yhnp`, and Greg added to it afterwards (addendum `spya-byxz0r`, 2026-10-21 05:25 UTC):

> I think this font size issue was specific to the citations that it was providing, by the way. I
> mean, actually, it was as much about sort of line spacing or paragraph spacing being quite close
> as font size.
>
> — Greg, 2026-10-21 (`spya-byxz0r`)

The original, from Sources › Investigate on an iPhone: *"I like the way it cites all of its sources,
but the font is too small and they're too close together for an iPhone."*

261021c was on `dev` and not yet deployed when he wrote the addendum, so it describes production's
old layout, not 261021c's.

## What is wrong now, measured

A Sonnet pass at 390 × 844, DPR 3, touch, iPhone UA, on a local copy of Greg's own thread
(`spya-usmpmr`, read from production, read-only). The copy uses the same text and the same eight
web citations, with real block ids swapped in. Screenshots and raw numbers were in the session
scratchpad.

**"From the web", on `dev` with 261021c in.** The text is 13.6px with a 20.4px line height, so size
is no longer the problem. The rhythm is:

- Each title is centred in a 40px `inline-flex` box. The rows have nothing between them.
- *Bring into this chat*, also 40px, fits beside a short title (2 of 8 rows) and wraps under a
  long one (6 of 8).
- So the space from one title to the next runs **12, 58, 12, 58, 68, 58, 48px**. Where a pill
  wraps, it sits 7px under its own title and 10px over the next one. **A pill reads as belonging
  to the title below it.** Before 261021c the list was 0–1px apart; 261021c made the targets big
  without giving the list a shape.

**The answer's prose** is 15.36px on a 23px line, with 9.6px between paragraphs. The passage-id
chips are 13px and do not open up the line. The web links' host labels are 13px. None of this is
the citations Greg meant, so it is left alone (§ Not doing).

**The deferred targets** were measured in the same pass. The table under Stage 2 has the numbers.

## Stage 1: the sources list has a shape (the part Greg is waiting on)

Under `any-pointer: coarse` only. Desktop keeps its compact list.

```
 FROM THE WEB
 ───────────────────────────────────────────
 The Order of Time (book)                      ← title, top-aligned in a ≥40px link box
 [↓ Bring into this chat]                      ← always under its own title, 40px
 ───────────────────────────────────────────   ← hairline between sources
 The Order of Time review: Where physics and
 philosophy meet
 [↓ Bring into this chat]
 ───────────────────────────────────────────
```

- **Every source is one row, with its button always under its own title**, not beside it when
  there's room. That makes all rows the same shape, and a row's button can't be read as the next
  title's.
- **A hairline (`--rule`) between rows**, plus 0.5rem of padding above and below each. This is
  how the rest of the band separates items in a list.
- **The link stays a ≥40px box but is a block, not a centred flex box.** Its padding puts a
  one-line title in a 40px box. A wrapped title's lines stay together at the list's line height,
  instead of being centred in a box taller than they are.
- **Line height for a wrapped title: 1.4**, a little tighter than 1.5, so a two-line title reads
  as one item. The hairline and the padding between rows are what separate items.

The simpler option passed over: just add a margin between `<li>`s and leave the button floating.
That fixes the 1px case, but a wrapped pill still sits nearer the title below it than its own.
The ambiguity was the problem.

Also passed over: **an icon-only *Bring in* button on the title's line.** It would be half the
height, but on a phone it would drop the words that say what the button does. 261017e chose the
words.

The cost: 8 sources now take about 8 × 96px, against 8 × 40–86px. The list is the last thing in an
answer, so the extra length costs nothing above it.

## Stage 2: the rest of the 40px targets

The deferred list in 261021c, measured. The verdict is the measuring pass's, and the action is
this plan's. **Simplest first**: where a target can grow without moving anything but itself and
its row, it grows. The crowded ones are written up for Greg (below) rather than redesigned here. Under
`any-pointer: coarse` throughout, as 261021c.

| Target | Now | Action |
|---|---|---|
| shadcn `Button`, every size (`xs` 24, `sm` 32, `default` 36, `icon*`): run buttons, empty states, Glossary *Look up*, Search *find*, Quiz *Answer*, /profile's *Sign out* and *Manage billing*, shelf *File*/*Add* | 24–36px | **≥40 high, and icon sizes ≥40 wide**: one line in `button.tsx`'s base classes (`tw:any-pointer-coarse:min-h-10`) and the icon sizes. The measuring pass found each one alone in its row. Every row and empty state that has one grows by up to 8px. |
| `band-about` ⓘ, and the owner's `.prof-badge.icon-only` beside it | 32 × 32, 3px apart | `--band-corner-btn` is 40 under a finger, so `--band-about-room`, which derives from it, follows. The badge is 40 too, with the gap opened. |
| the top bar's privacy, archive and edit-title icons | 28 × 28 at a 36px pitch | 40 × 40 drawn, at a 40px pitch. About 145px is free on the row. |
| `origin-link`, `counts-toggle`, `fold-all`, `read-time-trigger` | 18–21px tall, ≥40 wide | `.tap-target`, which gives vertical halos. Nothing pressable sits within 9px above or below. |
| the gutter bar (a selected row on a no-hover screen) | 24px controls at a 32px pitch | **40px slots, no gap**: 4 controls make 174px, 5 make 214px. The bar grows from 30 to about 46px tall, so it covers about 1.5 lines of the paragraph above, not one. |
| the shelf card's *+ Tag*, and "opened … ago" | 48 × 24 and 98 × 18 | `.tap-target`. The nearest pressable control is 55px away. |
| Skim's place button `.skim-where` | 19 × 32 | `.tap-target`, centred on the mark. It overlaps only its own row's press area. |
| Quiz: the *Only what I've read* checkbox's label, the share pie, Previous/Next/Show all | label 22 tall; pie 24; steppers 28 at 8px gaps | The label is 40 tall, the pie 40 with an 8px gap, and the steppers 40 with no gap. |
| *Dictate* (`.prof-mic`, /profile and Quiz) | 24 × 26 | 40 × 40, drawn. |
| *References* stub `.matter-stub-open` + `.matter-stub-info` | 21px tall, 2.4px apart | Both 40 tall, with the gap opened to 8px. |
| `.fold-toggle` 24, `.zoom-btn` 28, `.gloss-hide` 29 | | `.tap-target` where the measuring pass found room: the fold toggle and the zoom button. `.gloss-hide` sits on its term's own button, so it is written up. |

**Written up for Greg, not built:**

- **The shelf's sort, filter and topic chips** (28px at a 32–36px pitch). 40px chips make the
  shelf's controls about 120px taller on a phone. That is "things getting bigger", but by a
  screenful's sixth, and the controls might rather fold behind one button.
- **The gutter's at-rest marks** (24px, flush to the screen edge). A 40px target there takes the
  right 16px of the prose's last characters away from selecting the row.
- **A footnote card's source links**, and the card's title link. They are inline text in a
  citation, a line apart, and a link that wraps can't take a halo. Their exemption is the same as
  prose links'.
- **Structure's numbered rows in the prose** (28px), the footer links (20px), the spine's hit
  strips, and Glossary's hide button.
- The dock at 39px stays as 261021c left it.

## The guard

261021c's guard is a text-size test, and nothing checks target sizes. A test of every pressable
thing's size needs a browser, and the suite has none. So the guard is the same as 261021c's: a
cascade test per rule in `tests/tap-target.test.tsx`, so that a later rule can't quietly undercut
one of these (C2 in 261021c was exactly that), plus the browser pass below.

## Done looks like

- **Stage 1.** At 390 with touch, every source's button sits under its own title. The title-to-title
  spacing for one-line titles is equal, and the hairlines separate the rows. Desktop is unchanged.
  A screenshot is compared with the one above. Then typecheck, `npm test`, and a Sol code review.
- **Stage 2.** A Sonnet browser pass re-measures every row of the table at ≥40 × 40 (a halo
  counts) and checks that nothing clips, overlaps or wraps that didn't before. Desktop is unchanged.
  Then typecheck, `npm test`, and a Sol code review.
- **Docs.** controls.md § The numbers says how the sources list and the `Button` floor work.
  phone-and-touch.md is touched only if a line there goes stale.

## Not doing

- **The answer's paragraph spacing** (9.6px between paragraphs, on a 23px line). Greg's addendum
  is about the citations, and this spacing is the same on every answer on every screen. It is
  offered in the note.
- **Desktop floors.** These are still under a finger only, as 261021c decided.
