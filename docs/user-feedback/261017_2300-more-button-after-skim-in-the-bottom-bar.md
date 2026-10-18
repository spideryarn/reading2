---
reports: spya-c0va9e
ending: shipped
comment: More now stands straight after Skim, at the end of its group. On a phone with Diagram showing that place is off the edge, so More moves to the front of the group there, as it did before 2026-10-11.
---
# Bottom bar: More straight after Skim

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-17 23:00 UTC, a suggestion filed from
`/read/rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`. Sentry
SPIDERYARN-READING2-JG (#594). Queue entry `qi-wkwce962`, batched with spya-xtkv73; session
`fbxtkv73-glossary-note-more-skim`. No addenda when re-read before this note. The earlier move is
[261011_0914](261011_0914-more-button-after-summary-in-the-bottom-bar.md).

> Move the three dots mode one to the right in the bottom bar after Skim but still in the same group

**Ending: Shipped**, on `dev`. Plan
[261018f](../plans/261018f-glossary-new-list-reason-behind-an-info-button-and-more-after-skim.md).

The bar now reads `Plain | Structure Summary [Diagram] Skim ⋯ | Sources …`, with no line between
Skim and More. An open gathered mode follows More as a run of its own (`Skim ⋯ | Glossary | …`). The
order has one home, `MORE_AFTER` in `src/web/Dock.tsx`, so the metadata page's bar follows. The Help
page's words and its bottom-bar screenshot say the new order.

One consequence, named rather than hidden: on a phone (360 to 390 wide) with Diagram drawn, the place
after Skim is off the edge, so More moves to the front of the group there. That guard dates from
plan 261009c and is how the bar behaved until 2026-10-11. Without Diagram, More stays after Skim on a
phone, and the browser check saw both.
