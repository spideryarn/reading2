# The gutter shows as many icons as the row has room for

**Status:** built and measured, 2026-09-05.
**Follows:** [260905b — the three go back in a line](260905b-gutter-back-to-a-vertical-line-and-a-help-prompt-that-admits-nearby-blocks.md),
which is the change this one undoes half of.

## What Greg asked for

Yesterday's line of three costs every short paragraph 24px of height, and he
looked at the result:

> Ok, how about we say that for short paragraphs, it only shows permalink and
> comment buttons, and only reveals the question mark and flag buttons for longer
> paragraphs, since they're less important. That way everything stays in a
> vertical line and we can keep the vertical gutter narrow. And indeed,
> especially on mobile we want the margins either side of the text to be
> minimal, to maximise the space we have for the text.
>
> — Greg, 2026-09-05

and then, a few minutes later, replaced the mechanism with a better one:

> Or actually, here's a new/better idea - for short paragraphs we simply show a
> `...` button that reveals them all? That would be simpler and more consistent
> as a UI for the user.
>
> — Greg, 2026-09-05

He is right about why: under "show as many as fit" alone, a reader cannot learn
the rule — the "?" is beside this paragraph and not that one, for a reason that
is never stated. A "…" says *there is more here*, in the same place, every time.

"Flag" is his word for the bookmark — he confirmed it when asked. So his
sentence means: **always permalink and chat; the "?" and the mark are the ones
that may be folded away.**

## The three asks, and they are separate

1. **Short rows stop being stretched.** The row floor goes, and with it the
   `.gutter-pad` class.
2. **The gutter narrows to one column**, which is what makes the margin small —
   worth 24px of prose on every screen and most on a phone.
3. **A "…" opens what does not fit**, so nothing is unreachable.

## The arithmetic, which decides everything else

At a 16px root, with no floor at all, this is how many 24px slots fit beside a
row without the row growing:

| row | natural height | `avail = h − --blk-top − --block-pad` | slots |
|---|---:|---:|---:|
| one-line paragraph | 39.1px | 24.0px | **1** |
| two-line paragraph | 66.3px | 51.2px | **2** |
| three-line paragraph | ~93.5px | ~78.4px | **3** |
| four lines or more | 120px+ | 105px+ | **4** |
| heading | 39.9px | 18.9px measured from `--blk-top` | **0** — see below |

So a one-line paragraph has room for exactly one control. **A heading has room
for none, measured that way**, which is GPT Sol's third finding and the reason it
gets a box of its own: measured from the top of the cell rather than from a
heading's doubled `--blk-top`, the room is 36.9px — one slot with 12.9px to
spare, in space that is a heading's empty top padding and nothing else.

## The mechanism: a container query, not JavaScript

CSS cannot count a paragraph's lines, but it does not need to. Give the gutter a
**definite height** — `top: --blk-top` and a height of the cell minus the two
pads — and it is exactly `avail` above. Make it a size container, and
`@container (height >= …)` then asks the only question that matters: *does the
next slot fit?*

    .blk-gutter {
      height: calc(100% - var(--blk-top) - var(--block-pad));
      container-type: size;
    }

The default, outside every query, is the most collapsed state, so a browser
without container queries gets the safe end rather than a control hanging into
the next paragraph.

**Why not the alternatives:**

- **Measuring in JavaScript** (a `ResizeObserver` per row, a `short`/`tall`
  class) — several hundred observers on a long article, a second source of truth
  for a fact the layout already knows, and a frame of the wrong answer on every
  resize.
- **`repeat(auto-fill, --blk-slot)` with `grid-auto-rows: 0`** — genuinely
  CSS-only and it hides the overflow with no query at all, but it cannot know
  *whether* anything was hidden, so it cannot decide when to draw the "…".
- **Keeping the floor and shrinking the slot to 20px** — breaks the 24px target
  Greg asked for on 2026-09-04 and still stretches two-line paragraphs.

## What each row shows

The rule is one sentence: **fill the column top-down in a fixed order — the
reader's mark, the permalink, chat, "?" — and whenever something is left over,
the last slot that fits becomes "…", which opens all of them.**

| slots | no note (3 controls) | with a note (4 controls) |
|---|---|---|
| 1 — one-liner, heading | … | … |
| 2 | permalink, … | mark, … |
| 3 | permalink, chat, "?" | mark, permalink, … |
| 4+ | permalink, chat, "?" | mark, permalink, chat, "?" |

This is toolbar overflow, which readers already know from every browser tab
strip: the order never changes, and a dot at the end means *the rest*. Fable
arbitrated it, 2026-09-05, and its table had one error worth recording — it
assumed four controls on every row, so it hid the "?" behind the dot on
three-slot rows. A reader with no note on the paragraph has only three controls,
and three slots hold them: **the dot appears only when something is actually
hidden**, which is also what keeps it off almost every row of a real article.

Three consequences, named rather than discovered later:

- **The mark outranks the address.** Greg chose that
  ("promote the mark when it exists", 2026-09-05) and the gutter's own rule
  agrees — it is *state*, and the permalink is one press away in the panel.
  The cost is that adding a note pushes chat and "?" down one, which the
  2 × 2 pad existed to prevent. That guarantee is spent deliberately.
- **The "?" is the first to go**, and that is a feature: it is the one control
  that spends money on a single press, so an extra press in front of it is a
  guard rather than a tax.
- **At one slot the "…" wins outright, and that is a walk-back.** Fable's
  arbitration, and the first build, put the mark in that single slot at rest and
  swapped the "…" in on hover. It reads beautifully and cannot be reached: there
  is no hover on a phone, and a `display: none` button is not in the tab order,
  so on **every** noted one-line paragraph — not only the orphaned ones this
  section first named — chat and the "?" were unreachable by keyboard and by
  touch alike. The rule doing the swapping was also `(0,5,1)` against the count
  rules' `(0,3,0)`, so it forced the dot on at *every* capacity: at four slots
  with four controls, a fifth item in a four-slot box, hanging below its own row.
  GPT Sol's first two findings on the built code. The fix is to delete rather
  than to scope, so a one-slot noted row shows the "…" and the mark is one press
  behind it. What is lost is the mark at rest on that one row shape; `mark.cmt`
  still paints the passage, except for an orphaned note, which now lives only
  behind the dot.

## How the CSS says it

Two questions, asked separately. **How much room is there** is the container
query. **How much is there to show** is `data-controls`, written on the gutter by
`BlockGutter.tsx` — 1 to 4 — and every rule that draws or hides the "…" is keyed
on it.

The first draft asked the second question with `:has(.blk-cmt)`, on the
reasoning that a note is what makes four controls out of three. That is a proxy,
not the count, and GPT Sol's review of this plan took it apart: `comments`,
`onChatAbout` and `onHelp` are independent at the component's boundary, so a
visitor with a note came out with a mark and no way to the address under it, and
a caller passing one callback and a note had three controls treated as four. All
eight combinations are now rendered and read in `tests/block-gutter.test.tsx` —
which is what `tests/gutter-pad-floor.test.tsx` was for, and why its deletion
had to be a replacement.

    .blk-gutter > * { display: none; }                          /* the safe default */
    .blk-gutter[data-controls="1"] > * { display: inline-flex; }
    @container (min-height: 48px) and (min-height: 3rem) { … first 1 + "…" … }
    @container (min-height: 72px) and (min-height: 4.5rem) { … first 2, or all 3 … }
    @container (min-height: 96px) and (min-height: 6rem) { … all four … }

**Every threshold is written twice**, and that is Sol's first finding: a query
cannot read a custom property, and `--blk-slot` is `max(1.5rem, 24px)`, so
`(min-height: 48px) and (min-height: 3rem)` is how `max()` is spelled in plain
query grammar. At a 20px root the slot is 30px and the rem half bites; hard-coded
pixels would have offered a 20px reader three 30px targets in room for two.

The default sits *outside* every query, so a browser without container queries
gets the most collapsed state rather than a control hanging into the paragraph
below.

**The box the query measures is two insets**, `top: --blk-top` and
`bottom: --block-pad`, not `height: calc(100% - …)`. The percentage form says the
same thing and is defensible by spec; Sol's fifth finding is that percentage
heights inside table cells are an interoperability-sensitive corner, and this is
the number the whole invariant now rests on.

**A heading's box is its own shape.** `top: 0`, `bottom: --block-pad / 2`,
`align-content: end`. A heading's `--blk-top` is doubled — it belongs to what
follows it, so it carries three pads of empty space above — and a box that began
there would be 18.8px tall at a 16px root, less than a target, so the query would
be measuring a box smaller than the control it was about to allow. Starting at
the top of the cell makes the queried room and the paintable room the same
36.9px, and bottom-aligning puts the slot beside the heading's words. Sol's
third finding.

**Why not the alternatives:**

- **Measuring in JavaScript** (a `ResizeObserver` per row, a `short`/`tall`
  class) — several hundred observers on a long article, a second source of truth
  for a fact the layout already knows, and a frame of the wrong answer on every
  resize.
- **`repeat(auto-fill, --blk-slot)` with `grid-auto-rows: 0`** — genuinely
  CSS-only and it hides the overflow with no query at all, but it cannot know
  *whether* anything was hidden, so it cannot decide when to draw the "…".
- **Keeping the floor and shrinking the slot to 20px** — breaks the 24px target
  Greg asked for on 2026-09-04 and still stretches two-line paragraphs.

## What "…" opens

The gutter's own column, unfolded downward over the gutters of the rows beneath
— never over the prose, because it is 24px wide and the prose starts 35px to the
right of it. Opaque, a hairline border, absolutely positioned so nothing
reflows; dismissed on Escape, on a press anywhere outside, and on choosing
anything in it.

Implemented as the gutter itself rather than a second panel: `[data-open]` turns
`container-type` off, releases `bottom` and the height, and shows every child.
So there is one copy of each control and one set of handlers — a duplicate panel
would be a second place for the chat button to drift out of step with the first.
It also raises `z-index`, because every gutter is positioned and none of the
others names a level, so the *later* rows would otherwise paint over it; and it
re-anchors a heading's gutter to the top, or the panel would unfold upward over
the paragraph before it. Both are Sol's sixth finding.

**The invariant is narrowed rather than broken**, and Sol asked for it to be said
this way: *no **closed** control overhangs its row.* An open, opaque disclosure
that the reader has just pressed a button to produce, and that closes on Escape,
on a press outside and on choosing anything, deliberately owns the rows beneath
it. An overhang that is simply always there is a control stealing hits from a
paragraph nobody was pointing at.

Rejected: a flyout into the left margin (there is no left margin on a phone, so
it would be two behaviours); growing the row while it is open (a layout jump,
which is the thing Greg objected to in the first place); a popover over the
prose (the prose is the point).

## The three other things this touches

- **`--blk-gutter-w` halves.** The second column existed only to hold the
  bookmark beside the line; the mark is now *in* the line, so the column goes,
  `--text-pad-l` drops from 59.2px to 35.2px at a 16px root, and the prose gets
  24px back on each side. This is the "narrow gutter" half of Greg's ask.
- **`proseAloneMaxPx` in layout.ts is `slot * 2`** and becomes `slot`: 808px at a
  16px root, 1010 at 20, 612 at 12. `tests/gutter-target-size.test.ts` reads the
  stylesheet and fails if the two disagree, which is how this stays true.
- **The `90vw` caveat reopens**, and gets fixed rather than re-deferred. It bites
  where `9 × (--text-pad-l + --text-pad-r + --spine-w) < --reading-measure`:
  842 against 742 with the pad's width (inert), 626 against 742 without it
  (live). The fix is one line — the gutter's `left` calc centres on
  `var(--reading-measure)` where `.prose` centres on
  `clamp(45ch, 90vw, var(--reading-measure))`, and the gutter already sets the
  prose's own `font-size` and `font-weight` so `ch` means the same number in
  both places. Sol's seventh finding is the caveat on the caveat: this matches
  the **ordinary paragraph** measure, and a callout (58ch), a caption (48ch) or
  an opaque block sets its own — which the gutter has always deliberately not
  followed, or the column would be ragged.

## What the floors do now

`.gutter-pad` is gone — the class, the rule, the condition in TableView.tsx and
`tests/gutter-pad-floor.test.tsx`. **The one-slot floors stay**, and Sol's second
finding is why: the default state always draws one 24px control, and at a 12px
root a natural one-line paragraph has about 18px of room, so the target would
hang 1.56px below its row. `td.text` floors at `--blk-top + --blk-slot +
--block-pad` and `td.text.kind-heading` at `--blk-slot + --block-pad`; at a 16px
root the first costs 0.04px and the second nothing at all.

## Built, and measured

Measured in Chrome on the box, on `/read/scaling-hypothesis` — 186 `td.text`
rows, 25 of them headings — signed in as the owner.

**The invariant, which is the only one that matters: zero overhangs.** Every
visible control's `bottom` against its own `<tr>`'s `bottom`, over all 186 rows ×
three root sizes (12, 16, 20px) × two viewports (1280 × 900 and 390 × 844) —
**1,116 row-checks, no control crossing its row anywhere**, headings included.
Re-run afterwards under both readings of "visible" (drawn, and
opacity-perceived), at rest and hovered: still zero.

**The slot counts match the table**, at a 16px root:

| gutter box | drawn |
|---|---|
| 24.02px (a 39.09px one-line row) | the "…" alone |
| 51–55px | permalink, "…" |
| 78.36px | permalink, chat, "?" — and **no dot**, because three controls fit |
| 96px+ | the same three, and no dot; a note makes a fourth, which also fits |

**The four-control case, with a real note on the block.** A bookmark-only
comment on four blocks chosen by height — a one-liner, two lines, three lines,
and a mid-document heading — all reporting `data-controls="4"`:

| gutter box | at rest | hovered |
|---|---|---|
| 24.0px, one-liner | the mark | the "…" — the two **swap** |
| 33.1px, heading | the mark | the "…" |
| 54.8px, two lines | the mark | mark, "…" |
| 78.4px, three lines | the mark | mark, permalink, "…" |

**The first two rows of that table are the behaviour Sol then killed**, and they
were measured before the review. A one-slot noted row now shows the "…" at rest
and on hover, and the mark is behind it; the two-slot and three-slot rows are
unchanged. Re-measured after the fix — see § Re-measured below.

**And the note costs the row nothing.** Same row measured before and after the
comment was made: 39.094 → 39.094, 69.906 → 69.906, 93.438 → 93.438, 36.109 →
36.109. Four deltas of exactly 0.000px.

**Headings.** The bottom-anchored box comes out at 26.23px at a 12px root, 33.14
at 16 and 41.44 at 20 — one slot at every one — and the control's bottom edge
lands on the heading prose's own bottom edge to the hundredth of a pixel, which
is the point of anchoring it there rather than under the doubled padding.

**The "…" panel.** Unfolds downward on a paragraph *and* on a heading, which is
the case that needed its own rule; all four controls out at exactly 24 × 24;
`elementFromPoint` at the centre of a control overlapping the row below returns
that control rather than anything underneath, so the raised `z-index` is doing
its job; its right edge is 276.7px against the prose's 283.3px, so it covers no
words; Escape closes it and so does a press elsewhere.

**The prose is wider.** `--text-pad-l` is 35.2px at both viewports, against
59.2px before. `.prose` is 738.1px at 1280 × 900 and 328.4px at 390 × 844.

**Not measured the first time, and it mattered:** a four-control row with 96px+
of gutter — a note on a paragraph of four lines or more — was reasoned rather
than seen, on the grounds that it is the least interesting cell of the table.
It was in fact the cell where the hover swap put a fifth item in a four-slot
box, and Sol found it by reading specificity. The lesson is the file's own:
*a check you have never seen fail is not evidence*, and "nothing interesting can
happen here" is how a cell goes unmeasured.

**Also not exercised:** `@media (hover: none)`. A 390px viewport in desktop
Chrome is a narrow window, not a touch device, so the touch reveal rules were
reasoned rather than seen. They are unchanged by this work — the "…" was added
to the three lists that already existed — but that is an argument, not a
measurement.

**One thing the measurement taught that the design did not say.** In the two-slot
bracket the "…" is *drawn* at rest and invisible until the row is hovered, because
it is an affordance and obeys the same `opacity` rule as the permalink. So the
mark sits alone in a two-slot gutter at rest with a slot held empty beneath it.
That is the gutter's grammar working as intended — at rest it shows state — and
it is why the browser check had to be run under both definitions of "visible".

## Re-measured, after the code review

The two fixes above change what is drawn, so the sweep was run again — and this
time **hovering every row**, with `CSS.forcePseudoState` over the DevTools
protocol rather than a mouse, checked first against a known rule
(`tr:hover .blk-permalink { opacity: 0.6 }`) so that it was forcing real style
resolution rather than agreeing with itself.

**The case the first pass skipped, measured.** A note on a four-line paragraph —
`data-controls="4"`, gutter box 105.55px:

| state | drawn | perceived | overhang |
|---|---|---|---|
| at rest | mark, permalink, chat, "?" | the mark | none |
| hovered | mark, permalink, chat, "?" | all four | none |

Four controls, **no dot**, in both states. Under the rule Sol killed, the hovered
row would have drawn a fifth.

**The one-slot noted rows.** The one-liner and the heading now draw the "…" at
rest and hovered, and the mark not at all — which is the walk-back, seen rather
than argued.

**The sweep: 186 rows × three roots × two states = 1,116 row-states, with four
notes in place. Zero overhangs.** And the stylesheet now carries the reason
rather than the result: **no `tr:hover` selector in the gutter touches
`display`**, so the pointer cannot change *how many* controls are drawn at all.
That is the invariant `tests/gutter-target-size.test.ts` asserts, and it is the
one that did not need a pointer to hold — the first browser pass hovered nothing,
which is exactly why it missed the bug.

**The keyboard path.** Enter on the "…" opens the column and lands the focus on
the first control; forward Tab then walks the rest of the column and out; Escape
closes and returns the focus to the "…". A mouse click opens it and moves no
focus.

**The panel.** All four controls exactly 24 × 24 inside it, the 1px border
outside them rather than clipping them.

**One consequence, seen and worth stating.** On a hover device, a noted one-line
paragraph now shows an *empty* gutter at rest: the "…" is an affordance, so it is
`opacity: 0` until the row is hovered. The mark is in the prose, not the column.
On touch the dot is visible at all times, by the `(hover: none)` rule it shares
with the other three. So the gutter's grammar — *at rest it shows state* — holds
everywhere except the one row shape too small to hold both the state and the way
to everything else.

## Reviews

- [260905c-gutter-review-sol-plan.md](260905c-gutter-review-sol-plan.md) — GPT
  Sol on this plan before it was built. Five findings, all taken: the thresholds
  had to scale with the root, the one-slot floors had to stay, a heading needed
  its own box, `:has(.blk-cmt)` had to become a real count, and the query box is
  better as two insets. Its verdict on the plan as written was that it "will lose
  controls and recreate the exact cross-row input bug the floor was introduced to
  prevent" — which was fair, and the diff above is what answers it.
- [260905c-gutter-review-sol-code.md](260905c-gutter-review-sol-code.md) — the
  same reviewer on the built code, and the one that earned its keep. Two
  blocking findings, both taken: the surviving hover swap outranked every count
  rule and put a fifth control in a four-slot gutter, and the disclosure was not
  keyboard-coherent. Plus a false box-model claim, a wrong figure at a 20px root
  (`--text-pad-l` is 44px there, not 46), and eight comments still describing
  the layout of the day before — including the whole § the gutter header, which
  this work had rewritten everywhere except where it actually lives.
