---
id: q-z27hq2
report: spya-c8z66b
status: answered
asked: 2026-10-15
acted: spya-zrfpc0
title: Figures in Skim's Gist, More and Most: their own stop, or alongside a quote? And chosen by the model, or by a rule?
refs: SPIDERYARN-READING2-J5 · qi-r4rvhyqw · qi-647czja2 · docs/plans/261015b-figures-follow-ups-tables-as-pictures-louder-structure-marks.md · docs/user-feedback/261015_2040-figures-in-the-skim-route.md · qi-77vvdcac · docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md
---
You asked for figures to appear in the Gist, More and Most walks, as the model sees fit. Two choices before we build it.

1. Where does a figure go?
A. Alongside a quote (recommended). The model may attach a figure to a stop whose passage is about it, and that stop shows a "Figure 2 ›" button that jumps to the figure. The stops and their counts stay as they are. Costs least, and routes already planned keep working.
B. As a stop of its own, between quotes. A walk could go quote, figure, quote. Closer to "include some figures along with quotes", but the route's code assumes every stop is a quote, so this is about three times the work, and we would have to decide whether a figure counts toward a pass's length.

2. Who picks the figure?
A. The model, as you said (recommended). It sees each figure's caption and section, and we measure the prompt change on papers with figures before it ships.
B. A rule: a stop whose paragraph says "Figure 2" gets Figure 2. No model change and free, but it only finds figures the text names.

Recommendation: 1A and 2A.

Details

What you asked, on 2026-10-15, from Skim on your Mental Imagery paper: "Perhaps we should also have the option to include some figures along with quotes in the main Gist/More/Most Skim trajectories (as the LLM sees fit)".

Background. Skim walks a paper three times (Gist, More, Most). Each stop is one of the paper's Quotes, chosen and ordered by a model. Since 2026-10-11 there is also a fourth part, Figures, which walks every figure and table in order. The route itself has never included a figure.

Why it was not built straight away. The step that plans the route has been tuned through thirteen measured prompt versions, and every part of the walk (the stop list, the door in the prose, the stop card, which pass a stop is carried into) is built around a stop being a quote. Adding figures changes what the model is given and what it answers, so it needs a measured prompt change, not a quick edit.

What each choice gives you in use. With 1A, on a Gist stop about imagery being like weak perception, the stop's row would show a small "Figure 1 ›" next to the quote; pressing it scrolls to Figure 1 and flashes it. With 1B, the walk itself would step to Figure 1 as stop 3 of 5, with the figure's caption on its row.

What would make you pick B for question 1: if what you want is for the walk itself to step through some figures, not just point at them.

Done in the meantime: your two other reports from the same minute. Structure's figure marks were already on that paper but too faint to notice, and are now darker and bigger. Tables were already in the Figures walk; a table published as a picture now counts as a table too.

Greg's reply, 2026-10-17 (spya-zrfpc0):

"I was thinking 1B, perhaps with some kind of commentary or cue to make it easier to see why the figure is being included. Use your judgment. / 2A"

Built as 1B and 2A, with a cue on every figure. A figure follows the quote it goes with and is walked in that quote's pass, and it counts in that pass's length. Plan 261017d, measured in investigation 261017b. Figure stops are not shown to visitors yet; that is asked in q-gq0f4k.
