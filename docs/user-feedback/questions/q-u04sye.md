---
id: q-u04sye
report: spya-x0rfs2
status: open
asked: 2026-10-09
title: Skim: make the current stop quieter, so the quote stands out?
refs: docs/plans/261009j-skim-question-optional-and-the-border.md § Not built · docs/plans/261009j-shots/proposal-before-row.png · proposal-after-row.png · proposal-before-door.png · proposal-after-door.png · proposal-after-page.png · docs/user-feedback/261009_1028-skim-question-optional-smaller-and-one-bar.md
---
In Skim, the open stop's quote is the third-loudest thing in its own box, under a bold two-line section heading and above black-filled chips. Should we quieten the rest so the quote is what you read first?

A. All three changes below. The quote becomes the strongest line in the box; the chips read as labels rather than buttons, though they still open on hover or tap.
B. Only the quieter section heading (1). The smallest change, and most of the gain.
C. Leave it as it is now: the bar is already fixed and the question already smaller.

1. Section heading on the open stop: one size smaller (0.82rem), grey instead of white, semi-bold instead of bold.
2. Chips (Terms it uses, Ideas it bears on): an outline instead of a black fill, grey text. In the mock-up the outline was too faint; it would be built with the stronger border colour.
3. The small line under "Next stop ›" in the article: upright instead of italic.

Recommended: A.

Details

Your report spya-x0rfs2 (2026-10-09) said the orange bar on each Skim step was drawn in two parts with a rounded break, and asked whether Skim could be made easier to take in. The bar is fixed and on dev: the open stop is now one box with one straight bar. Your other two reports that morning made the question above a quote optional and smaller; that is on dev too.

For the wider question, three subagents looked at screenshots: one briefed as a product manager, one as a UI designer, one as a first-time reader. All three said the quote, which is the point of the stop, is drowned out. The bold heading above it is the loudest text in the box, and the black chips below are the highest-contrast shapes on the screen. These three changes are what they proposed that has no effect beyond the look.

Before and after pictures, the after ones made by injecting the CSS into the page (nothing is built): docs/plans/261009j-shots/proposal-before-row.png and proposal-after-row.png (the open stop), proposal-before-door.png and proposal-after-door.png (the line under Next stop), proposal-after-page.png (the whole page).

Proposed and left out, so you know they were considered: putting the profile banner on one line (it was changed this morning by another piece of work); making the other stops in the list quieter and their headings one line (it would make the route harder to scan as a list); a label such as "Ask yourself:" before the question (the band's (i) now explains it instead).

What would decide it: whether the section heading earns its weight. It tells you where in the paper the stop is, which matters when the route jumps about; quieter, it is still there, just not first.
