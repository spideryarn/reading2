---
reports: spya-ucu35y
ending: shipped
---
# Every mode gets an (i) in its top-right corner

Greg's suggestion from the Feedback dialog (he is admin), SPIDERYARN-READING2-8H, filed 2026-10-01
from the Tweets mode. Not built by anyone before (checked against `git log origin/dev`,
`docs/plans/`, this directory and `gjd-remote ls`); the session that picked it up was the one named
for it.

`spya-ucu35y`:

> In Tweet-thread mode, it says "Written by claude-sonnet-5 · tweets/5 · 1 Oct 2026 · 20.0s" at the
> bottom.
>
> Move this into a tooltip for a (i) icon in the top-right. see tooltips.md
>
> And then update any other modes to move out similar such explanatory/output/metadata text (unless
> it's really valuable) to follow this (i) approach, and update new-mode.md and design docs
> accordingly.
>
> And perhaps rename new-mode.md -> mode.md (along with any references).
>
> Each mode should have such an (i) icon, which contains information like:
> - how many X (of y)
> - other useful explanatory information about what this is, why, how it works, caveats, how to
>   understand it, etc
> - when it was generated/ran
> - what model was used
> - etc etc as per mode as you see fit

**Ending: shipped.** Every mode band has an (i) in its top-right corner, put there by `ModeSurface`
so every band gets it the same way, in every state. Its card opens with the mode's own words (the
same two paragraphs as the Dock's card on that mode), then its counts, its caveats, and who wrote
it: model, version, the exact time and how long ago, how long it took. Tweets' "Written by" foot
went in there, and so did the head-row counts, Debate's "Searched on" and foot lines, Quotes'
discarded note, and the hand-rolled (i)s of Diagram, Trajectory, FAQ and Citations. What stayed on
the band: empty states, running and failed jobs, counts beside the control they describe, "Question
3 of 8", and Timeline's year line (its rows leave the year out because of it). `new-mode.md` is
`mode.md`, and it holds the rule.

One exception, for Greg to overrule if he likes: **Referee has no corner (i)**. Its *how this
works* card is long and opens inside the band, so it is already that mode's (i), just not in the
corner.

Plan and reasoning:
[261001m-every-mode-gets-an-i-in-its-top-right-corner.md](../plans/261001m-every-mode-gets-an-i-in-its-top-right-corner.md).
Commits on `dev`: 6024a5f5 (the rename), 68816cd6 (the (i) everywhere), 10b519ed (GPT Sol's code
review and the browser check).
