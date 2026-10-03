---
reports: spya-a868zs, spya-vskqfn
queue: qi-djn8h9bn
---
# A tap opens Structure's row cards and the reading-time line's card

Two of Greg's reports were answered on hover only. **Structure's row cards**
(spya-a868zs, plan [260916b](260916b-rich-tooltips-on-structure-mode-rows.md)) and **the
reading-time line's card** (spya-vskqfn, notes 261001_0951 and 261001_1604) both open when a
mouse points at them or the keyboard focuses them. Neither opens on a tap, so on an iPad they
might as well not exist. Both notes named this as deferred. This plan builds only that missing
part.

> Add rich tooltips to Structure mode (so I can see summary of that bit of the text)
>
> — Greg, 2026-09-12 (spya-a868zs)

> There are vertical lines now next to some blocks. What are they for? They should ideally have
> tooltips to explain themselves.
>
> — Greg, 2026-10-01 (spya-vskqfn)

## What a tap will do

The rule is [touch.md](../project/touch.md)'s: **the first tap opens the card; the second does
what a click does.**

1. **A Structure row, in both of Structure's faces** — the two-column one (`StructurePanel.tsx §
   Row`) and the nested list for a narrow band (`OutlinePanel.tsx § Row`). A finger's first tap
   on a row that has a card opens it, and the card ends "Tap again to go here", which is the
   spine's wording. The second tap on the same row jumps there. A row with no card jumps on the
   first tap, as it does now. That is the part you are standing in (260916b § subtractive) and
   the measuring copies, which draw no card. A mouse click and Enter jump at once, as now.
2. **The reading-time line.** A tap on the strip opens the "Reading time" card. There is no
   second step, because the line does nothing when pressed. Tapping anywhere else, or
   scrolling, closes it.

## How

- **Structure rows: `useTapReveal`, one per row**
  ([useTapReveal.ts](../../src/web/useTapReveal.ts), built for Citations in 260930a). It already
  records the press at `pointerdown` and decides at the click, which is the iPad fix from 260924c
  (on iOS 18.2 and later a finger's click says `mouse`). Each row owns its own state. That
  matters: the trap in [260828g](../postmortems/260828g-spine-hover-cards.md) was *one shared*
  armed state controlling many tooltips in a delay group. Here every tooltip is controlled by
  state of its own, which behaves like the uncontrolled tooltip each row has today. Being
  controlled is also what sets `mouseOnly` on `useHover` (Tooltip.tsx), so the synthesised hover
  from the second tap cannot close the card before the click lands. Opening one row's card
  closes the others through `useDismiss`'s outside press and the delay group, exactly as hovering
  does now.
- **The tap hint**: `RowCard` and the list's card take an optional `tap` line, passed only while
  `reveal.tap` is set (only when a finger opened the card).
- **A card a finger opened closes on scroll.** This is touch.md's rule for the spine and the
  glossary: the card follows its row, so without it a finger-opened card rides up the band and
  stays. It goes in `useTapReveal`, as a capture-phase `scroll` listener on `document` that is
  only subscribed while a finger-opened card is open, so that it also hears the band's own
  scroller. Citations' two buttons pick it up as well, which is the same rule and arguably a fix.
- **The reading-time line: a `click` listener in BlockLinkCard's delegated set.** A click on
  `READING_LINE` opens its card at the click's height, if it isn't already open, and clears any
  close timer that the lift's `pointerout` scheduled. The card is marked as opened by a click,
  and such a card closes on the next scroll (capture, as above). **No pointer typing at all**,
  and that is deliberate: the press commits nothing, so a mouse click on an already-hovered line
  is a no-op, and a mouse click on a line whose card hasn't opened yet just opens it a little
  early. The WebKit bug cannot bite a rule that never reads `pointerType`. The existing
  `over(touch) → close()` already shuts the card on the next tap elsewhere. A tap on the strip
  does not select the block, because TableView's `NOT_A_BLOCK_SELECTION` includes `.blk-gutter`.
  That is what happens today.

## The strip is 5.6px wide, which is too narrow for a finger

`.blk-gutter > span.blk-read` is at most `--blk-gutter-x` (0.35rem) wide: the gap between the
gutter column and the words. That is fine for a mouse and a coin flip for a finger. Three options:

- **(a) Leave it.** A miss lands on the prose and selects the block, which is harmless. It is
  honest, but most taps will miss.
- **(b) On a coarse pointer, widen the hit box leftwards over the gutter column, but only while
  the column is empty.** On touch the gutter icons are drawn only on the selected row
  (`tr.row-active`, plan 260908e), so on any other row the column is blank space that a tap falls
  straight through. A transparent `::before` on the strip reaching about 1.25rem left, under
  `@media (any-pointer: coarse)` and `:where(tr:not(.row-active))`, gives a target of about 26px.
  It never covers an icon, because there are none on that row. It never covers the prose. The
  cost is that a tap on that blank column beside a *read* paragraph opens the card instead of
  selecting the block. A tap on the prose still selects it.
  **One complication:** "blank" is not quite true. State marks are drawn whether or not the row
  is selected. Those are a comment marker (`.blk-gutter[data-marked] > .blk-cmt`), a chat button
  on a block with conversations (`.block-chat.has`), and possibly a set bookmark. The overhang
  is a later, positioned sibling, so it would sit over them and take their taps. So the rule
  also needs `:not(:has(> <a visible mark>))` on the gutter, and those marks have to be listed
  exhaustively, which is the fragile part. If the reviewer can see a less fragile way to exclude
  them, take it. Otherwise fall back to (a).
- **(c)** Widen it to the right, over the words. **Rejected**: it would steal taps from the
  prose, which is the one thing touch.md says we never take.

**Taking (b)**, scoped as above, unless the review finds a collision. The simpler option, (a),
was passed over because it ships a card that is in principle reachable and in practice not, which
is the state the report is about.

## After GPT Sol's plan review

The review is in [261003c-tap-opens-cards-on-touch-plan-review-sol.md](261003c-tap-opens-cards-on-touch-plan-review-sol.md).
Its verdict was "sound direction, revise before building", and each finding was handled as follows:

1. **A cardless row would have needed two taps**: `useTapReveal`'s `commits` changes only the
   hint, not the reveal. Fixed: the hook now lives in a `CardRow` component that only a row
   with a card renders. That also keeps it off the measuring copies.
2. **(b), but by stacking, not by listing.** Every gutter `button`/`a` is raised to `z-index: 1`
   under a coarse pointer. A drawn control wins its own rectangle, and a hidden one is already
   `pointer-events: none`. Sol's exhaustive list of what can be visible on a non-active row is
   in the review, and it is the reason a `:has()` list was not attempted.
3. **The line is `aria-hidden` yet now clickable.** Not changed, by decision. The line is
   decoration, and "nothing about reading time is announced" was decided when the card was built
   (BlockLinkCard.tsx § the `aria-describedby` effect; privacy.md § Reading time). A keyboard
   could not open its hover card before this change either, and this change adds a pointer path
   only. Making reading time accessible is a separate question for Greg, not part of this report.
4. **Clear the open timer on click.** It already did: `press` clears `openTimer`, `closeTimer`
   and `pending` before `show`. There is a test for a click inside the hover delay.
5. **A scroll also clears the recorded press.** Done in `useTapReveal`.
6. **A two-row test inside the real group.** Added: `structure-card-opens.test.tsx`, "a finger
   moving from one row's card to another's".

## Not doing

- Not extracting the spine's press queue (`takeRailPress`) into a shared module. `useTapReveal`
  is already the shared, simpler form for one control per hook, and the spine's queue exists for
  a 12px rail where a press and its click can land on different bands. That is not the case
  here.
- Not touching the gutter icons' cards (already tap-able since 261002e), or Marginalia's notes.

## Checks

- Unit (jsdom) for the Structure row: a finger press then click reveals and does not jump; a
  second finger tap jumps; a mouse click jumps on the first; a keyboard click (`detail 0`)
  jumps; a no-card row jumps on the first tap. In OutlinePanel, the same.
- Unit for BlockLinkCard: a click on the reading line opens the card; `pointerout` before the
  click does not close it; a scroll closes a click-opened card.
- Browser: Chrome at 834×1194 with `hasTouch`, real CDP `Input.dispatchTouchEvent` taps, off
  centre as well as on (touch.md's trap). Check both Structure faces and the reading line, and
  that a tap on the prose still selects a block.
