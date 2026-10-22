---
id: q-z3j0ep
report: spya-vywcpu
status: open
asked: 2026-10-22
title: Should the reading column's width cap come down with the measure, which makes bands wider on iPads and laptops?
refs: docs/plans/261022d-reading-measure-in-real-characters.md · docs/user-feedback/261021_2302-reading-measure-in-real-characters.md · spya-vywcpu · spya-xebdgz · SPIDERYARN-READING2-6G
---
The text column is now narrower (about 60 characters a line, as you asked in spya-vywcpu), but the box the layout reserves for it has not shrunk with it. Shrinking that box brings the Marginalia notes about 120px closer to the text, but it also makes every mode's left-hand band wider on mid-sized windows. Which do you want?

A. Shrink it for both. Marginalia notes sit about 40px from the text instead of about 160px. The left-hand band becomes wider from about a 980px window upwards instead of 1220px. On an iPad in landscape (1194px wide), the band goes from 400px to 544px, and the Tweets band goes from 496px to 544px, which is the landscape width you called too wide for Tweets on 30 Sept.

B. Shrink it for Marginalia only, and keep the bands as they are now. This gets the closer notes without changing any band. The cost is one extra number in the layout code: "where bands start to widen" becomes separate from "how wide the text box is".

C. Leave both as they are. Nothing changes, and Marginalia notes stay about 160px from the text on a wide screen.

Recommendation: B. It gets the visible improvement and doesn't touch band widths you had already tuned by eye. If you'd like wider bands on an iPad in landscape anyway, A is simpler.

Details

What you asked (spya-vywcpu, 21 Oct, on the iPad): the column held about 70 characters a line, and you wanted it within 45 to 65. You were right: it was 70. The column's width was written as "65 zeros wide", and in the reading font a zero is wider than an average letter. It is now 56 zeros, which comes to a median of about 60 characters, and at most about 65 on nine lines in ten. That is shipped and does not depend on this question.

The question is about a second number. The layout code keeps a box that is "as wide as the text could ever need": the measure plus its padding. It was set when the text was in a sans font, and nobody updated it when the reading font became a serif on 2 Oct. So the box is now 808px for a text column of about 494px. In Plain view you cannot see this, because the text centres itself in the box. You can see it in two places:

1. Marginalia. The notes column starts at the box's right edge, so there is about 160px of empty page between the end of a line and its note. If the box matched the text, the gap would be about 40px.

2. Band widening. On 1 Oct (spya-xebdgz) you asked that when the window is really wide, the mode band should take the extra page, without changing how narrower windows look. The rule is that the band gets whatever the text box cannot use. A smaller box means "really wide" starts sooner: at 980px instead of 1220px. At a 16px font, the standard band would be:
   1024px window: 400 now, 444 with A
   1194px (iPad landscape): 400 now, 544 with A
   1280px: 460 now, 544 with A
   1440px and above: 544 either way

The text itself stays the same width in every option. Only the empty space around it moves.

What would decide it: whether wider bands on an iPad in landscape and on small laptops are welcome (A), or whether those layouts should stay as you tuned them (B).
