---
id: q-trbv2r
report: none
status: answered
asked: 2026-10-21
title: On a phone, should the icons above a tapped paragraph grow to the 40px size other buttons now have?
refs: fby4yhnp (phone sizes part two) · docs/project/controls.md · decisions file item 88
acted: spya-v6c8dz
---
Most small buttons on phones were enlarged to 40px this week so they are easy to hit. One row was left alone: the icons that appear above a paragraph when you tap it.

A. Leave them as they are. At 40px the row would cover about two lines of the paragraph above instead of one.
B. Enlarge them anyway, accepting that they hide more of the text above while shown.

Recommendation: A.

Details

A few other small targets were also left and are listed in controls.md: the shelf's sort and topic chips, Skim's place button, the fold arrow, a figure's zoom button, links inside a footnote card, and Structure's rows.

## Greg's answer, 2026-10-21 18:41 UTC (in the Feedback dialog, reply `spya-v6c8dz`)

> Take screenshots, use your judgment. If you think the answer is a clear-cut yes, then make a minimal update to the docs so that you always do this going forwards.

Acted on 2026-10-22: yes, B. On dev, in docs/plans/261022e-phone-tap-bar-at-40px-and-a-wider-gap-between-paragraphs-of-model-answers.md. Before and after shots were taken at 390px with touch on. The four icons above a tapped paragraph are now 40 × 40 each, touching, where they were 24 × 24 with 8px gaps. The bar is 42px tall instead of 30, so it covers about a line and a half of the text above it instead of one. That text is the paragraph above the one you tapped, and only while the bar is up. The judgment: the bar exists only to be pressed by a finger, so it is the clearest case for the 40px rule. The default for next time is one line in docs/project/controls.md § The numbers: a control drawn over text is not an exception, so cover more text or move the control, and never shrink the target. The bar is off that file's "still under 40" list. One thing to know: when a paragraph's top sits just under the sticky top bar, the icon bar is hidden beneath it until you scroll a little. That was already true at 30px. It is now true for 12px more of scroll.
