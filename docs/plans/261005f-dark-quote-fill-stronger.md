# The quote fill in the dark appearance: stronger

Report `spya-s0gppw` (SPIDERYARN-READING2-D9), Greg, 2026-10-05 07:15 UTC, queue entry
`qi-tknpc37k`:

> The quote highlighting color is not very visible against the black background in dark mode. Take a
> screenshot and see if you can slightly tweak it.

It is also his answer, for the dark page, to `[Q-quote-fill-strength]` in
[261003_1447](../user-feedback/261003_1447-quotes-filled-like-a-highlighter-pen-search-outlined.md),
which asked whether the fill was strong enough. The light appearance is not touched.

**Built**: the two fill strengths are per appearance, and the dark page's went from 0.20 / 0.32 to
**0.28 / 0.36**. The colour did not move. The first version of this plan also moved the colour; GPT
Sol's review showed what that would have cost, and it is under § Passed over.

## What was there, measured

A quote in the prose is `mark.hit[data-quote]`: the colour `--quote-rgb` at an alpha of
`--quote-a` (0.70 to 1.00, the fade) times a strength per tier (0.20 light, 0.32 heavy), which was
written once in `annotations.css` and served both themes.
[quotes.md § A highlighter pen](../project/quotes.md#a-highlighter-pen-which-is-how-a-quote-says-how-much-it-matters).

On the dark page (`oklch(0.145 0 0)`, about `rgb(10 10 10)`) the colour is `204 151 243`, a pale
lavender. At the faintest light quote's 14% that is `rgb(37 30 43)`: a dark grey with a little
purple in it. Most quotes on a first open are in the light tier.

## The change

| on the dark page | before (0.20 / 0.32) | after (0.28 / 0.36) | floor |
|---|---|---|---|
| faintest light quote, alpha | 0.14 | 0.196 | |
| faintest light quote, OKLab distance from the page | 0.107 | 0.146 | > 0.14 (new) |
| brightest light quote, distance | 0.132 | 0.181 | |
| strongest heavy quote, distance | 0.230 | 0.256 | |
| faintest vs page, contrast | 1.22 | 1.37 | > 1.15 |
| soft ink on the strongest fill | 5.36 | 4.85 | > 4.5 |
| heavy vs light at the tier boundary | 1.275 | 1.188 | > 1.12 |
| blue search colour (`--cat-4`) on the strongest fill | 3.35 | 3.03 | > 3 (new) |
| spine strip | unchanged | unchanged | |

So a light quote is about 40% stronger and a heavy one about 12%. The tiers are closer together
than they were, and still apart.

**What holds each number.** Heavy at 0.36: a search hit over a quote draws its outline on the fill,
and the blue automatic search colour drops under 3:1 at 0.38. Light at 0.28: that clears the new
OKLab floor at 0.146; at 0.30 the step between the tiers is 1.14, close to its floor.

**Where the strengths live.** `--quote-fill-light` and `--quote-fill-heavy`, beside `--quote-rgb` in
`styles/tokens.css`, set in both blocks. `annotations.css` keeps `--quote-fill` as the per-mark
variable and sets it from them. `styles/tokens.css` already holds per-theme numbers that are not
colours (`--reading-weight`).

**The test** (`tests/quote-fill.test.ts`): `fillStrength` reads the tokens per theme; the stylesheet
is held to using them; on the dark page the faintest fill must be more than 0.14 from the page in
OKLab (red on the old values, 0.107), because the existing contrast floor passed on the fill Greg
complained about; the eight automatic search colours must clear 3:1 on the strongest dark fill; and
the light page's colour and strengths are pinned to exactly what they were.

## Passed over

- **A more saturated purple as well** (`187 85 249` at 0.34 / 0.50), the first version of this plan.
  It is the better-looking of the two in a side-by-side render: more purple, less grey, a bigger
  step between the tiers. GPT Sol's review found what it breaks. The spine strip shares the colour
  and is drawn on the rail's panel and its tint, not on the page, where the darker colour falls from
  3.3:1 to 2.2:1 on an ordinary part. The blue search colour over a heavy quote falls to 2.9:1. And
  on the light-tier quotes, the ones that were the complaint, keeping the colour and raising the
  strength is as visible as the new colour was. Giving the spine a colour of its own would lift the
  first, against Greg's *"use the same colour we use for their outline-border"* (2026-09-10). Not
  for a report that asked for a slight tweak.
- **Going further with the colour kept** (0.30 / 0.38): the blue search colour goes under 3:1 and the
  soft ink is at 4.6.
- **Give a link or the soft ink inside a quote the full ink colour**, option B of
  `[Q-quote-fill-strength]`. A different trade, not needed here.
- **Two theme selectors in `annotations.css`** rather than tokens. A theme fork in a component sheet,
  and the test would parse selectors.

## Found, not fixed here

GPT Sol's review found that the test's foregrounds are all summed over the page, and a quote can sit
on other grounds. These were under their floors before this change, and it moves each a little
further:

| pairing, dark page, strongest fill | before | after |
|---|---|---|
| soft ink in a block drawn on `--muted` (a code block; non-gistable prose) | 4.24 | 3.88 |
| caption ink (`--ink-faint`) on the same | 2.43 | lower (2.26 at the 0.50 Sol summed) |
| glossary dotted rule | 2.70 | lower |
| cross-reference rule | under 3 | lower |
| spine strip on an active part | 2.60 | unchanged |

Each needs a heavy quote in that place. They are one piece of work: sum the real grounds and the
real overlaps in the test, in both themes, then decide per pairing. Queue entry `qi-9wyymfdy`, a
proposal until Greg authorises it.

## Checked

- `tests/quote-fill.test.ts` red on the old values for the new distance floor, green after.
- Playwright, system Chrome, 1440 wide at 2x, signed in, article `trolls-spya-cvwbcf` and `/design`:
  [article before](261005f-shot-article-dark-before.png),
  [article after](261005f-shot-article-dark-after.png),
  [/design before](261005f-shot-design-dark-before.png),
  [/design after](261005f-shot-design-dark-after.png). Computed fills on the article, dark: light
  tier `rgba(204 151 243 / 0.17)` to `0.24`, heavy `0.282` to `0.318`.
- The same article in the light appearance, before and after: the two PNGs are byte-identical.

**Not checked**: Firefox (not on the box); phone width (the same rule at every width); an OLED phone
at low brightness, which is plausibly where Greg saw it; a search hit over a quote in a real article
(summed, and on `/design`).

## Reviews

- Plan: [GPT Sol](261005f-dark-quote-fill-stronger-review-sol.md), *build with the changes above*.
  Findings 1 and 3 (spine, search colour) and 4 (the simpler option is enough) changed the design;
  5 was a stale number in a table this version no longer has; 6 is the light-page pin; 7 confirmed
  the token home; 2 is § Found, not fixed here.
- Code: [GPT Sol](261005f-code-review-sol.md), *ship after the fixes I made*. No P0 or P1. It
  corrected ranges that ignored `quoteAlpha`'s rounding (a light quote reaches 0.88, not 0.87) and
  three explanations that said the soft ink or chroma was the limit when the blue search outline
  and lightness are. It mutation-tested each of the four new assertions red, and confirmed every
  route loads `styles/tokens.css` before `annotations.css`, so the tokens are never undefined where
  a quote is drawn.
