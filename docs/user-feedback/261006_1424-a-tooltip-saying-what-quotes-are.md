---
reports: spya-tpmde9
ending: shipped
---
# A tooltip saying what Quotes are

Report `spya-tpmde9` (Sentry SPIDERYARN-READING2-DX), a suggestion, from Greg (admin, provenance
proved against the production row), 2026-10-06 14:24 UTC, from an article open in Citations mode.
No screenshot.

> Add a tooltip for Quotes, so readers know what they are (and any further information about them)

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261006j](../plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md).

## What changed

Quotes already had a card on the bar's button and behind the (i) in the Quotes band. The place that
never said what a quote is was the card on a purple-filled quote in the text, which is what a reader
sees of Quotes in every other mode. That card now opens with:

> A passage the AI picked out as worth keeping, in the article's own words. Stronger purple means a
> higher Importance or Striking score. *More in Help →*

The second sentence is left off a quote that has no score. The link goes to Help's section on
Quotes. [Light](../plans/261006j-shot-card-light-1440.png),
[dark](../plans/261006j-shot-card-dark-1440.png).

Help's section on Quotes was also corrected where it promised things a quote may not have (two
scores, a reason) or said the passages are what "the author put best", which the app cannot know.

**This reading of the report is an assumption**, since there was no screenshot: that "Quotes" meant
the purple fills. The plan says why.

## Left out, each with its own queue entry

- A card for the purple strip in the spine: `qi-d79es6n8`.
- A tap opening this card on a touch screen, so a phone reader gets it too: `qi-hrr5p2qn`, queued
  before this report.
- Found on the way, and older than this: where a quote is also a glossary term, the card can be
  taller than a short window and its lower half cannot be reached: `qi-ee6ke78h`.
- **A question for Greg**, `qi-78gf6x87`: the card waits 900ms before opening, three times longer
  than a glossary term's, so that it does not keep popping up over a long quote. That may be why a
  tooltip was asked for where one already was. Shorten it?

## What was checked

`tests/quote-hover-card.test.tsx` (seen failing first) and `tests/help-page.test.tsx`; GPT Sol
reviewed the plan and the code, and its findings and what was done about each are in the plan;
Chrome on the box, in Citations mode, light and dark.
