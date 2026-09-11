# The gutter waits to be asked on a finger too

**[SPIDERYARN-READING2-2G](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2G)** · reported
2026-09-07 17:42 UTC · *shipped*

## What Greg said

> On a touch device, only show the icons to the left of the blocks in the vertical gutter when I
> select a block.

## What changed

**Zero gutter affordances are drawn until you tap a paragraph**, measured in a browser at a touch
viewport with `matchMedia` verified rather than assumed: 0 of 388, against 14 on a 390 × 844
screenful and 23 on an 820 × 1180 one before. Tapping a paragraph lights that row's controls at
0.705; tapping another moves them; tapping a link, a mark or a picture on a *different* row leaves
the selection where it was. On a pointer nothing moved — the row hover still gives 1 and the
permalink still 0.6.

The sibling report from the same batch listed this one as *"gutter icons revealed on `:hover`, so
never revealed on a finger"*, and **that is the opposite of what was wrong**. The gutter already had
a touch rule, added three days earlier because a finger produces no `tr:hover` and the chat door was
shut on the iPad. It fixed that by **removing the gate rather than replacing it** — so every row of
the article drew its buttons, permanently, and the column's own governing sentence (*at rest the
gutter shows state, on hover it shows affordances*) was false on touch. Same class as the glossary
order button, from the other end, and created by the fix for it.

The two **state** marks stay on every row: the bookmark, and the blue chip on a block that already
has conversations. Fable arbitrated that rather than confirming it, and the argument that settled it
is that a note is painted twice — in the prose and in the gutter — while a whole-block conversation
is painted once, so hiding the chip is a strictly larger loss.

The design, the arbitration, the reproduction and both review rounds are in
[260908e-gutter-icons-on-touch-only-when-a-block-is-selected.md](../plans/260908e-gutter-icons-on-touch-only-when-a-block-is-selected.md);
the rule a future touch change should follow is in
[touch.md § The gutter, and the row a finger is on](../project/touch.md#the-gutter-and-the-row-a-finger-is-on).

## The thing worth carrying forward

**A touch rule that only guards the CSS has guarded half of it.** The whole design is an explicit
list of what a tap must *not* select — a link, a mark, a picture, a gutter control — and for one
commit that list was ornamental, because a tap also fires the compatibility `mouseenter` and a
second, ungated handler was writing the same state before the list was ever consulted. GPT Sol found
it in the built code, and the evidence establishing it was **already in our own plan doc**: a
reproduction three sections earlier had watched a tap set the row on a build where `mouseenter` was
the only writer there was. Both of us read past it.

That is the general shape, and it is worth more than this report: `@media (hover: none)` in a
stylesheet is only half a device gate whenever JavaScript can write the same state. The other half
is `matchMedia("(hover: hover)")` in the handler.

## Two costs accepted rather than solved

- **The permalink, the chat door and the "?" have no route anywhere else in the app**, so each is now
  two taps instead of one, and nothing teaches a reader that untapped prose is hiding anything.
  Shipped on the administrator's own request. The nearest thing to a hint is that the blank gutter
  strip selects the row too, so a reader who prods the empty margin gets the controls.
- **A hybrid iPad is untouched by any of this**: with a Magic Keyboard it reports `hover: hover`, so
  neither the old blanket reveal nor the new gated one ever applied to it. Pre-existing, and this
  report is evidence Greg's own device is not in it — he was complaining of too many icons, which
  only happens where the rule applies.

## A separate bug found on the way — *shipped* 2026-09-11

`tr:hover .blk-permalink { opacity: 0.6 }` is (0,2,1) and `.blk-permalink:hover { opacity: 1 }` is
(0,2,0), and pointing at the permalink matches both — so **it never brightened when you pointed at
it**, against a comment two lines above saying it did. Pre-existing, and the same class as a bug this
stylesheet already fixed once. Left out of the touch fix because it is a visible change to *desktop*
hover, and listed in [awaiting-approval.md](awaiting-approval.md); the Overseer closed that row as
*fix it* on 2026-09-11, under Greg's *"use your judgment"*.

**Fixed as the row proposed**: the recessive rule is now `:where(tr:hover) .blk-permalink` at
(0,1,0), so `:hover` and `:focus-visible` outrank it, and the `tr:hover .blk-permalink.failed`
workaround is gone because `.failed` now wins on its own. Measured in Chrome against the old and new
rules side by side: pointing at the permalink went **0.6 → 1**; on the row it is still 0.6, the chat
button still 1, a failed permalink still 1. An open "…" panel now draws the permalink at full
strength too, as that panel's own rule always intended. `tests/gutter-target-size.test.ts` pins the
shape, and was red before the change.
