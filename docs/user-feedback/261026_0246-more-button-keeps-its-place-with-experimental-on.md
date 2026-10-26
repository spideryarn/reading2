---
reports: spya-d0pyzt
ending: shipped
comment: The More button now stands in the same place in the bottom bar whether Experimental features is on or off, straight after Skim. Diagram, the experimental mode that used to push it along (and on a phone, to the front), now comes after it.
---
# Bottom bar: More keeps its place with Experimental on

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-26 02:46 UTC, a suggestion filed from
`/read/index-spya-wq3rud?mode=summary`. Sentry SPIDERYARN-READING2-P8 (#709). Session
`fbd0pyzt-more-dots-same-place`. No addenda when re-read before this note. The earlier moves are
[261017_2300](261017_2300-more-button-after-skim-in-the-bottom-bar.md) and
[261011_0914](261011_0914-more-button-after-summary-in-the-bottom-bar.md).

> In the bottom bar, move the three dots when we're in experimental features mode to be in roughly
> the same position they are in the main mode. So I think that's to the right of skim maybe, or the
> left, I forget, but it's a bit further right than it currently is. Where in experimental features
> mode, right now it's all the way to the left.

**Ending: Shipped**, on `dev`. Plan
[261026d](../plans/261026d-more-button-keeps-its-place-with-experimental-on-diagram-after-more.md).

**Why it moved.** More stands straight after Skim. Diagram, the one experimental mode in that run,
stood before Skim, so the switch put one more button ahead of More. On a wide screen that moved More
one place right. On a phone it pushed More's place off the edge, and the 261009c guard then moved
More to the front of the frame, which is the "all the way to the left" Greg saw.

**The fix.** Diagram's row now comes after Skim, so it is drawn after More:
`Plain | Structure Summary Skim ⋯ Diagram | Sources …` with the switch on, and
`Plain | Structure Summary Skim ⋯ | Sources …` with it off. The command bar's mode list follows
the same order. The guard stays, for a bar that grows.

**Checked in a browser** (Playwright, before on unchanged `dev`, after on this tree; Summary mode,
switch off then on). Before, with the switch on, More's x moved from 403 to 437 at 1440 and from
263 to 295 at 1024. At 390 and 360 with touch, More jumped from x 311 to the front of the frame,
at 179. After, More was at the same x with the switch on and off at every width (403, 263, and 311
with touch).
