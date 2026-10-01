---
reports: spya-gcdwps
ending: shipped
---
# Quotes (and Glossary) leave no room for the list on a landscape iPhone

Feedback row `spya-gcdwps` (2026-09-10 20:51 UTC), from Greg (admin), in production, build
`3bc0878f`, in Quotes on `temporal-context-reinstatement-spya-dhqkf9`. No Sentry issue: the row was
never mirrored, so there is no status to write.

> I can't use the Quotes or Glossary modes very well on landscape iPhone because all the stuff at
> the top of their columns takes up the vertical real estate, and I can't see the actual result.
>
> So remove anything redundant, move explanations behind tooltips, and take screenshots to try and
> find ways to make things vertically more compact but still usable and attractive.
>
> Also investigate other modes to look for similar problem.

**Ending: Shipped** — on `dev`, not deployed (`b41bd6c3`, review fixes in `d1e16d76`).

What we did: Glossary's half had already shipped from a later report
([260929_0043](260929_0043-glossary-header-takes-less-room.md)). Quotes now does the same: no head
row while the order row is drawn, no "order" word, the count and the profile badge (an icon) at the
order row's end. A screenshot pass at 844×390 measured every mode; the clearly redundant ones were
trimmed (Citations' head and foot, under `spya-nca765`, and Diagram's empty head row). What was not
trimmed, and why, is in the plan's stage 3, and the one product call — letting the order rows scroll
sideways on one line rather than wrap onto two touch-height lines — went to the Overseer as a
recommendation.
[261001l](../plans/261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md).

**Follow-up, 2026-10-01 — the order rows, shipped.** Greg chose the recommendation (question
`Q-landscape-orders`, option B): *"On touch screens only, keep it to one line and let it scroll
sideways."* On a touch screen the order buttons in Quotes, Citations and Glossary (and Debate and
FAQ, which draw the same row) now stay on one line and scroll sideways like the bottom bar, the
count and profile badge pinned at the end, and the order in force is scrolled into view when the
band opens. At 844×390 the row is 54px, down from 98; a mouse sees no change. On `dev`, not deployed
(`7ce23c5d1`, review fixes and the browser pass in `fd6bf2ca7`).
[261001o](../plans/261001o-order-buttons-one-sideways-scrolling-line-on-touch-screens.md).
