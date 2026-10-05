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

## A question for Greg

### [Q-dark-quote-colour] Should the dark quote colour be a deeper purple as well?

Background: the fill is a pale lavender drawn faintly, which over black reads as grey-purple. A
more saturated purple reads as purple at the same strength, and in a side-by-side it looked better
than what was built.

- **A. As built**: same colour, stronger. The spine strip and search outlines are unaffected.
- **B. A deeper purple in the prose, and the spine strip keeps today's colour.** More obviously a
  highlighter. It means the strip and the fill are no longer literally one colour, which you asked
  for on 2026-09-10 (*"use the same colour we use for their outline-border"*), and the blue search
  outline over a quote needs a look.

Recommendation: **A** unless it still looks too faint once deployed; then B is the next step.
