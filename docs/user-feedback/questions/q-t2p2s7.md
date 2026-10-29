---
id: q-t2p2s7
report: spya-ga6m76
status: open
asked: 2026-10-29
title: Should the reminder bar also appear on a full-screen iPad and a laptop?
refs: docs/plans/261029d-a-reminder-bar-at-the-top-and-add-a-selection-to-the-glossary.md · docs/user-feedback/261028_2332-a-reminder-bar-at-the-top-while-you-scroll-back.md · SPIDERYARN-READING2-PW
---
The new reminder bar (title, authors, date, read time and your how-much-read pie, at the top of the screen while you scroll back) appears only where the bottom bar slides away, which is a phone either way up and any small window. Should it appear on bigger screens too?

A. Keep it where the bottom bar slides (recommended). The two bars stay one gesture. Costs: on a full-screen iPad or a laptop you will never see it, because the bottom bar does not slide there.
B. Every screen size. You see it on the iPad and the laptop too. Costs: there it is the only thing that comes and goes, and while you scroll back it covers the top two lines of text.
C. Touch screens of any size (phone and iPad), not a laptop. Costs: one more condition in the code, and a laptop with a touch screen counts as a laptop.

Recommendation: A, unless you were reading on a full-screen iPad when you filed this, in which case C.

Details

What you asked, on 2026-10-28, reading Consciousness in Artificial Intelligence: when you scroll one way the bottom bar comes back; could a bar at the top come back with it, showing the title, author, publication date, how much you have read and anything else useful, as a reminder, and leave again when you scroll the other way.

What is built (on dev, not deployed): a slim two-line bar fixed to the top of the reading column.

```
+------------------------------------------------------+
| Consciousness in Artificial Intelligence: Insights...|
| Butlin, Long, Elmoznino et al. - arXiv - 2023 - ~95 min (pie) |
+------------------------------------------------------+
   the text, which does not move when it comes or goes
```

It comes back when you scroll back, and goes when you read on, exactly when the bottom bar does. It does not show at the top of the article (the heading is there already), while a mode is open, or straight after a jump to a passage (it would cover where you landed). Nothing in it is pressable. It covers text rather than pushing it down, so nothing jumps.

Why this is a question: our code makes the bottom bar slide only on a small screen, under about 731 pixels wide or 620 tall. A phone is always inside that. A full-screen iPad is not: its bottom bar stays put, so with A the reminder bar never appears there. Your report says the bottom bar slid for you "like when I'm on an iPad", so you may have been on a phone, or on an iPad in split view. If you want it on the iPad as you normally hold it, that is C (or B).

What would decide it: whether you want the reminder where you actually read most. Changing it later is a one-line change to where the bar is allowed to appear.
