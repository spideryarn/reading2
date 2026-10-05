---
reports: spya-s0gppw
ending: shipped
---
# The quote fill is stronger in the dark appearance

Report `spya-s0gppw` (SPIDERYARN-READING2-D9), a suggestion, from Greg (admin, production row
proven), 2026-10-05 07:15 UTC, from `/changelog#release-129`, queue entry `qi-tknpc37k`:

> The quote highlighting color is not very visible against the black background in dark mode. Take a
> screenshot and see if you can slightly tweak it.

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261005f](../plans/261005f-dark-quote-fill-stronger.md). The reasoning now lives in
[quotes.md § Stronger on the dark page](../project/quotes.md#stronger-on-the-dark-page-since-2026-10-05).
This also answers `[Q-quote-fill-strength]` in
[261003_1447](261003_1447-quotes-filled-like-a-highlighter-pen-search-outlined.md) for the dark
page.

**Changed again the same day**: Greg found it still a little hard to see on an iPad, and the dark
fill became a deeper purple. § The question, and Greg's answer, at the end.

## What changed

In the dark appearance only, the purple fill behind a quote is stronger. An ordinary quote is about
40% stronger and a top-priority one about 12%, so the two are a little closer together than they
were and still tell apart. The colour is the same purple, and the light appearance is exactly as it
was.

Before and after, the same article:
[before](../plans/261005f-shot-article-dark-before.png),
[after](../plans/261005f-shot-article-dark-after.png); and the `/design` specimens, where the
ordinary quote is the second one down:
[before](../plans/261005f-shot-design-dark-before.png),
[after](../plans/261005f-shot-design-dark-after.png).

It is a slight change, as asked. Two things stop it going further without a different trade: a
blue search outline drawn over a top-priority quote gets hard to see, and the strip that marks
quotes down the spine shares the colour, so a deeper purple would dim it.

## What was checked

`tests/quote-fill.test.ts` now holds the dark strengths: the faintest quote has to be a set distance
from the page (the old one fails that), the eight automatic search colours stay readable over the
strongest quote, and the light appearance's colour and strengths are pinned to what they were.
Screenshots in Chrome at desktop width, signed in, dark before and after; the same article in the
light appearance before and after came out as identical files. GPT Sol reviewed the plan and the
code.

**Not checked**: Firefox; phone width; an OLED phone at low brightness, which may be where this was
seen.

## Found on the way, not fixed

GPT Sol's review found pairings the test never summed, which were already under their targets and
are slightly further under now: softer text inside a code block under a top-priority quote, and a
glossary or cross-reference underline under one. Each needs a top-priority quote in that spot. It is
queue entry `qi-9wyymfdy`, a proposal waiting for a yes.

## The question, and Greg's answer

`[Q-dark-quote-colour]` asked whether the dark quote colour should be a deeper purple as well:
**A**, as built, the same lavender drawn stronger; or **B**, a deeper purple in the prose with the
spine strip keeping its colour, which gives up his rule of 2026-09-10 that the two are one colour
(*"use the same colour we use for their outline-border"*). The recommendation was A unless it still
looked too faint.

Greg, 2026-10-05, after looking at A on an iPad:

> the purple Quote-highlights in dark mode on an iPad screen were a little hard to see. I don't mind
> if they're slightly different from the Spine

**So B, built the same day**, on `dev`, not deployed. Plan:
[261005j](../plans/261005j-dark-quote-prose-colour-deeper-purple-spine-keeps-its-own.md); the
reasoning is in
[quotes.md § A deeper purple in the dark prose](../project/quotes.md#a-deeper-purple-in-the-dark-prose-since-2026-10-05).

In the dark appearance the fill behind a quote is now a deeper, more saturated purple, drawn more
strongly, so it reads as purple where the first fix read as grey-purple. The strip that marks quotes
down the spine keeps its lighter colour, at the same hue. The light appearance is exactly as it was.

The words on a quote are as readable as before or more so, and a full-confidence blue search
outline over a top-priority quote is easier to see. The tiers are slightly further apart in
OKLab distance and slightly closer in luminance contrast. Of the pairings Sol found above, soft text in a code block under a top-priority quote now
clears its target; the glossary underline improves, while the cross-reference underline loses a
very small amount of contrast. Both remain under 3:1, which stays with `qi-9wyymfdy`.

Before and after, dark, the same article at desktop width
([before](../plans/261005j-shot-before-article-dark-1440.png),
[after](../plans/261005j-shot-after-article-dark-1440.png)) and at an iPad's 820
([before](../plans/261005j-shot-before-article-dark-820.png),
[after](../plans/261005j-shot-after-article-dark-820.png)). It is a bigger step than the first
fix: a page with many quotes reads as quite purple. In the light appearance the computed colours
are the same before and after.

**Not checked**: a real iPad, which is where it was seen; Safari and Firefox; phone width.

## Independent review

The review corrected the arithmetic and the claim that only one pairing loses contrast. In
particular low-confidence search outlines lose contrast on the deeper purple, even though their
opaque bands improve. The smaller page-coloured gap and the reader washes' lower luminance contrast
are recorded in [the plan's overlap audit](../plans/261005j-dark-quote-prose-colour-deeper-purple-spine-keeps-its-own.md#independent-review-overlaps-and-grounds).
These losses are small and on signals that were already under 3:1, so they were accepted as the
price of the more visible quote Greg asked for; adjusting the outline is the next step if a search
hit over a top-priority quote proves hard to see. The palette and
strengths were left as built.
