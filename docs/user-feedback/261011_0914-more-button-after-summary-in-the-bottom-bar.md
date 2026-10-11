---
reports: spya-hdde62
ending: shipped
comment: The More button now sits straight after Summary in the bottom bar, before Skim, on every screen. On a phone it stays there too, rather than jumping to the front.
---
# Bottom bar: More straight after Summary

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-11 09:14 UTC, a suggestion filed from
`/read/rhizome-1000-plateaus-introduction-lambert-says-spya-jc9azw`. Sentry
SPIDERYARN-READING2-HH (#568). Queue entry `qi-8f4jc4h3`, session
`fbhdde62-more-button-after-summary`. No addenda when re-read before this note.

> In the bottom bar, we have the triple dot more button that displays more modes. Let's move that
> to the right of the summary, and maybe, maybe to the right of the skim mode.

**Ending: Shipped**, on `dev`. Plan
[261011x](../plans/261011x-more-button-after-summary-in-the-bottom-bar.md).

Greg's first choice was taken: `Plain | Structure Summary ⋯ [Diagram] Skim | Sources …`. More had
stood after Skim on a wide screen, and on a phone with Experimental on, or with Diagram open, it
jumped to the front of the group because that place was off the edge (plan 261009c). Two buttons
earlier, it is on screen at 360 and 390 in every state the browser check tried, so that jump
should no longer happen on today's bar. The guard stays in case the bar grows. The order has one
home, `MORE_AFTER` in `src/web/Dock.tsx`, so the metadata page's bar follows it. The Help page and
its screenshot say the new order.

An open gathered mode, Glossary say, still stands after Skim as a run of its own. Only More moved.

Left over, queued rather than built: in one browser run under heavy load, More once led the frame
at 390 and did not do it again in fourteen tries. That is the older guard, not this change, and it
is `qi-tqmgzjys`.
