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
- **A wrapped title keeps the list's 1.5 line height.** The draft tightened it to 1.4; Greg named
  line spacing as one of the two problems, so it stays (Sol, R1).

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

## Plan review (GPT Sol, 2026-10-21)

[Prompt](261021g-phone-sizes-part-two-plan-review-prompt.md),
[answer](261021g-phone-sizes-part-two-plan-review-sol.md). Exit 0, *build with changes*, nine
findings. These supersede the Stage 2 table above where they disagree:

- **R1 (P1) Don't tighten line spacing that Greg named.** Taken: titles keep 1.5.
- **R2 (P1) `narrow-window.css` sets `--band-corner-btn` back to 2rem under a coarse pointer**, after
  mode-band.css. Taken: the 40px goes there, replacing the 2rem, with its comment updated.
- **R3 (P1) The `Button` floor works through `twMerge` (a `min-h` survives `h-7`), but "each one
  alone in its row" was not established.** There are 116 `Button`s in 49 files, and some sit in
  rows (AccessSharing, ProfilePanel, the quiz row). Taken: the browser pass covers those dense
  rows. The top bar's edit-title control is an `IconButton`, not a `Button`; it gets a local coarse
  class rather than widening every `IconButton`.
- **R4 (P1) Three halos break `.tap-target`'s clearance contract.** The facts row wraps, the fold
  toggle already overlaps the gutter by 4px, and `.skim-where` lies over its own row's button.
  Taken: the facts-row controls are drawn `inline-flex` 40px tall instead, so a wrapped line keeps
  its room. **The fold toggle and Skim's place button are deferred** until each has a 40px cell
  of its own.
- **R5 (P1) `.matter-stub-info` must be 40 wide as well as tall.** Taken.
- **R6 (P1) The gutter bar would cover about two lines, not 1.5; it has at most four controls.**
  **Deferred, for Greg.** It is the product trade-off of whether the bar hides two lines of the
  paragraph above or the paragraph moves. touch.md § The gutter owns that question, and Greg has
  asked about the gutter twice.
- **R7 (P2) Keep Quiz's 8px gap between steppers.** Taken: four 40px controls with their gaps come
  to 184px.
- **R8 (P2) Glossary's hide button and the footer links are cheap.** Taken, both. The dock's 39px
  is raised to 40 rather than left as an unwritten exception.
- **R9 (P2) A per-rule declaration test is not a cascade.** Partly taken. The `Button` variants and
  the `IconButton` class are tested directly. The browser pass reads computed sizes and is the
  real check. A cascade-folding test helper is passed over: the suite has no browser, and the
  computed pass is what 261021c's C2 needed.

## What landed

**Stage 1** is as planned, with Sol's R1 (titles keep 1.5). Its code review (round 1, below) found
that the coarse *Bring into this chat* rule came before the base `padding` shorthand at equal
specificity, so its inline padding had been reset since 261021c. Sol moved the rule. At 390 every
source's button sits under its own title. One-line rows are 99.4px apart title to title and
two-line rows 113.5. Desktop's rows are unchanged. Pushed to `dev` ahead of Stage 2, because it
is the part Greg is waiting on.

**Stage 2**, built by an Opus subagent from the table as § Plan review amended it:

- **`40px`, never `2.5rem`.** Tailwind's `size-10` and `min-h-10` are 2.5rem, which is 38.4px at
  the measured iPhone's 15.36px root (261021c's C2). Every new size is `40px` or
  `max(40px, 2.5rem)`. Building the stage found seven older finger floors written as a bare
  2.5rem: Search's sort, Reception's *dig* and Investigate's *more*, `origin-chat`, the badge,
  Glossary's sort and the live arrow. They are fixed, and the shelf card's action row and its "⋯"
  now say `size-[40px]`. A test fails on any bare 2.5rem inside a coarse-pointer block.
- **The band corner moved to `any-pointer: coarse`** with the 40px, since it is a target. The
  (i) and the badge are 8px apart.
- **The masthead's pitch is 48, not 40.** Its 8px gap is the row's own, which it shares with the
  Metadata page. Three icons take 36px more of the row, and about 145px was free.
- **The facts row's dotted rules became text underlines** on the 40px boxes. A border would hang
  10px under the word.
- **The shelf's Tag and date take the halo, not a drawn box.** A drawn 40px Tag would make every
  card 16px taller.
- **The dock's 39.4** came from the bar's height less its hairline, frame and margins. `--dock-h`
  now does that sum against 40.
- **`gloss-hide` was built after all** (Sol's R8).

**The browser pass at 390** found the list's items at 40, bar a few hand-rolled controls that do
not use `Button`. All are now fixed: Quiz's *Answer* (36, beside a 40px microphone), /profile's
*Sign out* (31) and its *Dictate* (squeezed to 34), the Metadata page's *Archive*, *Share…* and
*Contents* (34–36), and Search's saved-search icons (29 wide). It found no clipping, no overflow
(`scrollWidth` 390 throughout) and no new wrapping, and desktop sizes are unchanged.

**Still under 40, and not built** (controls.md lists them): the gutter bar and its marks (R6, for
Greg), the shelf's sort and topic chips, `.skim-where`, `.fold-toggle`, `.zoom-btn` (28, not
built after all), footnote-card links, Structure's rows, and the threshold slider. Also small
labels the pass noticed but that the plan never listed: `.gloss-gate-label`, `.quiz-disclose`
and `.srch-thorough`, each about 20px tall.

## Code review (GPT Sol, round 1 of each stage)

**Stage 1**: [prompt](261021g-phone-sizes-part-two-code-review-1-prompt.md),
[answer](261021g-phone-sizes-part-two-code-review-1-sol.md). Exit 0, *ship with fixes applied*:
C1, the padding shorthand order (above), and C2, a test that pins the shape and the source order.

**Stage 2**: [prompt](261021g-phone-sizes-part-two-code-review-2-prompt.md),
[answer](261021g-phone-sizes-part-two-code-review-2-sol.md). Exit 0. Its verdict, *do not ship*,
was on the candidate before its fixes. The reviewer fixed C1–C6 in the tree, and they were read
and kept, bar one part of C3:

- **C1 (P1)** Quiz's *Answer* loses `.quiz-go` once marked but can still be pressed, so the rule is
  now `.quiz-actions .chat-send`.
- **C2 (P1)** Footer links and Search's icons got their other axis too.
- **C3 (P1)** Origin-chat, Search's sort and Reception's floors moved from `pointer` to
  `any-pointer`, matching 261021c. **Overruled for the dock.** Sol had moved the dock's
  `--dock-h` and `.dock-btn` too. touch.md § How big a thing has to be keeps the bar on
  `pointer: coarse` on purpose: it is bulk chrome, and a touchscreen laptop would get a bigger bar
  it never touches. So the dock stays where it was, with its 40px sum. touch.md now says that a
  single target's floor is the `any-pointer` exception (Sol's C8, which it left unedited believing
  touch.md needed Greg's approval; it is not one of the rule docs CLAUDE.md names).
- **C4 (P1)** The Tag halo reached into the card's stretched title link; the measuring pass's
  "55px" was to the next *button*. The pill now reserves its overhang with a block margin, and the
  date is drawn at 40 in a row that is already 40 tall.
- **C5 (P1)** The mention picker's rows and Reception's expanders and section heads, at 40.
- **C6 (P2)** The test's declaration folding was hardened.
- **C7 (P1, reported)** Ten live Tailwind classes in seven components wrote the finger size as
  `size-10` or `min-h-10` (2.5rem); the review's eleventh textual hit was a comment describing one
  of them. They are now `[40px]` under `any-pointer-coarse`, and the guard scans
  `src/web/**/*.tsx` for the pattern; both the fixed pixel floor and the hybrid-pointer query are
  pinned. The guard was shown red first.

**After the review**, the browser re-measure found the Metadata page's second *Archive*, the one in
its Archive section, still at 34. It is a copy of `QUIET_BUTTON`'s classes, and is now floored too.
