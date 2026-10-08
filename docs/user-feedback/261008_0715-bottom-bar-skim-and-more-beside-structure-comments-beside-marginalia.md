---
reports: spya-wm5gu2, spya-mcs4gb
ending: shipped
comment: Skim and More now sit in Structure and Summary's group, and Comments sits with Marginalia, after it. On a phone More is now almost on screen, but the bar still scrolls sideways.
---
# Bottom bar: Skim and More beside Structure and Summary, Comments beside Marginalia

Two suggestions from Greg (admin, provenance proved by `feedback-reporter.ts`), 2026-10-08, batched
as Overseer queue item `qi-ecakhf63`.

Report `spya-wm5gu2` (Sentry SPIDERYARN-READING2-EM), 07:15 UTC:

> In the bottom bar, move the skim mode icon into the same group after structure and summary.

Report `spya-mcs4gb` (Sentry SPIDERYARN-READING2-EQ), 07:19 UTC:

> On the bottom bar, I'm glad we've got the three dots that hide the extra modes. I wonder if we
> could put those, right now they're sort of out on their own. I'm wondering if we could put those
> perhaps just after the skim mode, just after structure and summary as part of that group, rather
> than out on their own. And also, I wonder if we could put the comments icon inside a group with
> marginalia, perhaps after marginalia.

**Ending: Shipped**, both, on `dev`, not deployed. Plan:
[261008d](../plans/261008d-bottom-bar-groups-skim-and-more-join-structure-and-summary-comments-joins-marginalia.md).

## What changed

```
before  [Plain] [Structure Summary | Skim | Search Chat Learn] [⋯ More] [Marginalia]  ⚡  Comments Metadata
after   [Plain] [Structure Summary Skim ⋯ More | Search Chat Learn] [Marginalia Comments]  ⚡  Metadata
```

- Skim is in the same run as Structure and Summary (after Diagram, with experimental features on).
- More is straight after Skim, inside that frame. A gathered mode that is open (say Glossary) is
  drawn straight after More.
- Comments is in Marginalia's frame, after it, on the reading view and on the Metadata page.
- The help page's description and its picture of the bar are updated.

One trade-off taken without asking, in the plan's § D2: More now sits inside the group a screen
reader announces as "what the middle column shows". It has to, being between two of those buttons.

## The phone (related queue item `qi-t22r9mt4`)

At 390px More was past the right-hand edge. Now it is almost all on screen (x 354–398 of 390), but
the bar still scrolls sideways (1018px of content in 390). That queue item stays open. The browser
pass also found that Playwright's simulated tap did not open More on WebKit, though a click did.
This code is unchanged here and may be an emulation quirk. Worth trying on a real iPhone.
