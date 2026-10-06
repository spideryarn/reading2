---
reports: spya-hsbz0z
ending: shipped
---
# The dark quote fill, a little less saturated

Report `spya-hsbz0z`, a suggestion, from Greg (admin), 2026-10-06 05:39 UTC, from an article in
Quotes view, the morning after
[261005_0715](261005_0715-quote-fill-stronger-in-the-dark-appearance.md) made the dark fill a
deeper purple:

> Now the purple Quote highlighting is a little toooo saturated. Just dial it down a bit. Take
> screenshot

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261006e](../plans/261006e-dark-quote-fill-a-little-less-saturated.md). The reasoning lives in
[quotes.md § A little less saturated](../project/quotes.md#a-little-less-saturated-since-2026-10-06).

## What changed

**The dark appearance only.** The purple behind a quote is the same hue and the same depth as
yesterday's, with about a quarter less saturation on the page, and a top-priority quote is drawn a
touch less strongly. The light appearance is exactly as it was, and so is the strip that marks
quotes down the spine.

It is a small step, as asked. It is as far as it can go while staying as visible as the "a little
hard to see" report of the day before requires: a bigger cut makes the faintest quotes harder to
see again.

Yesterday and today, dark, the same article at an iPad's 820
([yesterday](../plans/261005j-shot-after-article-dark-820.png),
[today](../plans/261006e-shot-after-article-dark-820.png)) and at desktop width
([yesterday](../plans/261005j-shot-after-article-dark-1440.png),
[today](../plans/261006e-shot-after-article-dark-1440.png)).

## What was checked

`tests/quote-fill.test.ts` has a new check that the fill is under yesterday's saturation, seen
failing on yesterday's colour first. Chrome on the box, signed in, at 1440, 820 and 390 wide: the
computed dark fill is the new colour at all three, and the light fill and the spine strip are the
values they were. GPT Sol reviewed the plan and the code together and recomputed the numbers.

**Not checked**: a real iPad, which is where it was seen; Safari and Firefox. At phone width the
Quotes list covers the prose, so there is no phone screenshot of the fill itself, only its computed
colour.
