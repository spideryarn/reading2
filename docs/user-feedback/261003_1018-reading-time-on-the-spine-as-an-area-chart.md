---
reports: spya-jhe9mc
ending: shipped
---
# Reading time on the spine, drawn as an area chart

A suggestion from Greg (admin; `scripts/feedback-reporter.ts` exited 0, which proves the production
row and matched the Sentry event), sent from the reading view of
`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`, build `5b769459`.

## spya-jhe9mc, 2026-10-03 10:18 (Sentry event `cf0b25b31d4e4b6db6aaef089c8e22b0`)

> I think the spine is now indicating which bits I have spent time reading and which bits I haven't,
> but I can't make sense of it. I wondered about having, using some kind of horizontal line or area,
> like an area chart, but sort of rotated 90 degrees, where the, yeah, I'm almost imagining like a
> water level but rotated 90 degrees. So the distance from the left-hand margin would be an
> indication of how much time I've spent reading it, and maybe the area would have some kind of
> semi-opaque color that it adds. And so I could just look at a glance and see that wiggly line going
> down to show which bits I've read the most, or something else. But right now I can't easily tell
> what I've read and what I haven't.

**Shipped**, on `dev`. The spine's faint grey four-step bar is now a cyan semi-opaque area from the
rail's left edge with a solid line down its right-hand edge, in sixteenths of the rail rather than
quarters. The plan, what was passed over, and the browser shots:
[261003j](../plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md).

One question is open for Greg and was not waited on: whether the chart should have more room than
the 12px rail (the plan's [Q-jhe9mc-1]).

The Sentry status write is left to the next sweep.
