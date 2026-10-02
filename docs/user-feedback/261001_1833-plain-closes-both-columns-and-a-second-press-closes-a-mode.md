---
reports: spya-e47u5f, spya-ba8kqp
ending: shipped
---
# Plain closes both columns, a second press closes a mode, and Plain and Marginalia get their own boxes

Two reports from Greg (admin), both about the bottom bar's modes.

SPIDERYARN-READING2-96 (`spya-e47u5f`), 2026-10-01 18:33 UTC, a suggestion, on
`https://www.spideryarn.com/read/melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj?at=spya-s8dmnr&mode=summary&summary=brief`:

> If I click the "Plain" mode, it should close both left-hand and right-hand column modes.
>
> And if I click a mode that's already active, it should deactivate that mode.

`spya-ba8kqp`, 2026-10-02 13:01 UTC, relayed by the Overseer into the same session:

> In the Reading view bottom-bar, move the Plain and Marginalia modes into their own icon-groups.

**Ending: Shipped**, on `dev`. Plan
[261002g](../plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md).

What changed:

- **Plain** now closes the mode on the left and the Marginalia column on the right, in one step, so
  one Back brings both back.
- **Pressing the mode you are in** closes it and leaves Marginalia alone. Marginalia's own button
  already worked this way. If a mode has stepped aside on a phone, pressing it still brings it back.
- **The bar is three boxes**: Plain, then the other modes, then Marginalia.

Two choices made at review. Choosing the mode you are in from the command bar (⌘K) still leaves you
in it, because a command names a place to go rather than a button to flip. And a mode whose read
failed is now retried by closing it and opening it again, since pressing it a second time closes it.

One thing left for Greg, raised twice by GPT Sol. To a screen reader the mode buttons are radio
buttons, and pressing a radio button that is already on normally leaves it on. Here it now switches
to Plain instead. It still works and is announced, but it is not what a screen-reader user would
expect. The proper fix is to make them on/off buttons rather than radio buttons. That touches about
twenty test files, so it is in the plan's § Deferred rather than done.
