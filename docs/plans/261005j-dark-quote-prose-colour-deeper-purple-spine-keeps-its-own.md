# The dark quote fill: a deeper purple in the prose, and the spine keeps its own

Greg, 2026-10-05, answering `[Q-dark-quote-colour]` in
[261005_0715](../user-feedback/261005_0715-quote-fill-stronger-in-the-dark-appearance.md), a few
hours after [261005f](261005f-dark-quote-fill-stronger.md) made the same lavender stronger:

> the purple Quote-highlights in dark mode on an iPad screen were a little hard to see. I don't mind
> if they're slightly different from the Spine

That is option B of the question. It releases, for the dark prose fill only, his rule of 2026-09-10
that the spine strip and the quote in the prose are one colour (*"use the same colour we use for
their outline-border"*).

**Built**: on the dark page the fill in the prose is `--quote-prose-rgb`, `151 48 208`, a purple at
the strip's hue (310) that is darker with about 1.7 times its OKLab chroma, drawn at **0.48 / 0.60** where
the lavender was at 0.28 / 0.36. The spine strip keeps `--quote-rgb`, `204 151 243`. On the light
page `--quote-prose-rgb` is set to the same `127 66 166` as `--quote-rgb`, and nothing there moved.

## Why a darker colour is the more visible one

The lavender is light, so only a little of it can go over the page before the words on it lose
contrast: 0.36 was its ceiling. A little of a pale colour over near-black is a dark grey. A darker,
saturated purple can be drawn at 0.60 before the same words reach the same contrast, and what
arrives on the page is purple.

| on the dark page | lavender, 0.28 / 0.36 | deeper purple, 0.48 / 0.60 | floor |
|---|---|---|---|
| faintest light quote, OKLab distance from the page | 0.146 | 0.171 | > 0.16 (raised) |
| faintest light quote, chroma | 0.035 | 0.099 | > 0.08 (new) |
| faintest vs page, contrast | 1.37 | 1.32 | > 1.15 |
| strongest heavy quote, distance | 0.256 | 0.290 | |
| ink on the strongest fill | 8.90 | 9.56 | > 4.5 |
| soft ink on the strongest fill | 4.85 | 5.21 | > 4.5 |
| a link on the strongest fill | 4.23 | 4.55 | > 3 |
| blue search colour (`--cat-4`) on the strongest fill | 3.03 | 3.25 | > 3 |
| heavy vs light at the tier boundary, contrast | 1.188 | 1.158 | > 1.12 |
| heavy vs light at the tier boundary, OKLab distance | 0.047 | 0.048 | |
| soft ink, strongest fill, block on `--muted` (a code block) | 3.88 | 4.61 | > 4.5 (new) |
| caption ink (`--ink-faint`), same | 2.22 | 2.64 | none |
| glossary dotted rule on the strongest fill | 2.51 | 2.58 | > 2.5 (pin) |
| cross-reference rule on the strongest fill | 2.56 | 2.56 | > 2.55 (pin) |
| spine strip | unchanged | unchanged | > 3 |

The faintest fill's luminance contrast with the page falls from 1.37 to 1.32, and the tier
boundary's luminance contrast falls from 1.188 to 1.158, while its OKLab distance rises slightly.
The fill is a little less bright and much more purple. Whether that reads as more visible on a real iPad is
the thing no sum here can say; the screenshots are the nearest check available on the box.

**How the values were picked.** A scan over purples at hue 310 (lightness 0.46 to 0.70, three
chromas) and both strengths, keeping candidates against the foregrounds considered at the time, then taking the most visible
faintest fill. The independent review below found that this did not establish that every
foreground pairing was no worse than on the lavender. Several colours tie near the top;
`151 48 208` is the one in the middle of them. 0.48 / 0.62 and 0.50 / 0.62 are a little more
visible and put the soft ink on `--muted` at 4.50, on its floor; 0.60 leaves room.

**Where it lives.** `--quote-prose-rgb` beside `--quote-rgb` in `styles/tokens.css`, in both theme
blocks. `annotations.css` § quote fills reads it, in one place. `spine.css` § `.spine-quote` is
untouched.

**The test** (`tests/quote-fill.test.ts`): `over()` composites the prose colour and `stripOver()`
the strip's; the two stylesheets are held to their own token; the OKLab floor went from 0.14 to
0.16; new on the dark page are a chroma floor at the faintest fill, "deeper than the strip at the
same hue", the soft ink on `--muted`, and minimum-contrast pins on the glossary and cross-reference rules; a control
shows the strip would fail 3:1 in the prose colour; the light page's pin gained the new token. Seen
red on the lavender values first: the distance floor, the chroma floor, deeper-than-the-strip, and
the soft ink on `--muted`.

## Passed over

- **One colour for both, somewhere between.** Every purple dark enough to be drawn strongly in the
  prose is under 3:1 as a 2px strip on the page, and lower still on the rail's panel (2.1). Greg
  released the rule, so there is no reason to pay that.
- **Stronger still** (0.50 / 0.62): above.
- **Lifting the glossary and cross-reference rules to 3:1 under a heavy quote.** They were under it
  before any of this; the glossary improves and the cross-reference falls very slightly
  (2.5635 to 2.5562). That is a change to those two rules, not to the fill, and
  stays with queue entry `qi-9wyymfdy`, which this change otherwise mostly answers for the dark page
  (the soft ink on `--muted` now clears its floor; the caption ink is better and still has none).

## Independent review: overlaps and grounds

The table uses gamma-encoded sRGB source-over compositing on opaque grounds. An independent Node
script recomputed every row. The ink ratios above were corrected from 9.29 / 9.99 to 8.90 / 9.56;
the other rows agree after rounding. The strip at its 0.70 floor remains 4.71:1 on the page and
4.57:1 on the panel; substituting the prose purple would give 2.20 and 2.14 respectively.

**The claim that only one pairing gets worse was too broad.** The search band is opaque, but the
confidence outline uses alpha `0.35 + 0.65 * --hit-a`. On the strongest page fill:

| additional pairing | lavender | deeper purple |
|---|---|---|
| sky blue (`--cat-0`), outline at `--hit-a: 0` | 1.698 | 1.626 |
| bluish green (`--cat-2`), outline at `--hit-a: 0` | 1.647 | 1.529 |
| blue (`--cat-4`), outline at `--hit-a: 0` | 1.487 | 1.453 |
| bluish green, outline at `--hit-a: 0.45` | 2.550 | 2.504 |
| cross-reference rule, more digits | 2.5635 | 2.5562 |
| page-coloured gap, strongest fill | 2.040 | 1.898 |
| comment underline | 2.074 | 2.091 |
| citation dashed rule | 3.217 | 3.288 |
| pressed quote's white ring | 9.703 | 10.427 |

All sixteen search colours, including the reader-picked `--cat-8` to `--cat-15`, improve as opaque
bands or full-confidence outlines. The purple `--cat-14` band goes from 3.68 to 3.96; its outline
also improves at the tested confidences. Several other colours lose contrast at low confidence.
Those smaller losses were accepted for the more visible quote (the alternative is to
adjust the confidence outline or the palette). Both colours and strengths are as built.

The reader's four washes **replace** the quote's fill on the same marked words, so there is no
extra compositing there. Beside a strongest quote their OKLab distances all grow (yellow 0.108 to
0.200, green 0.119 to 0.205, blue 0.075 to 0.139, pink 0.075 to 0.137), while luminance contrast
falls (1.091 to 1.015, 1.244 to 1.158, 1.270 to 1.182, 1.291 to 1.202 respectively). At the
faintest quote their OKLab distances also grow. The site defines no selection colour; browser and
OS selection painting cannot be guaranteed by these token calculations.

Soft ink on the strongest fill improves on `--card` (4.26 to 4.85), `--panel` (4.40 to 4.94),
`--muted` (3.88 to 4.61), and `--surface-raised` / `--popover` (3.75 to 4.52). Link ink improves
on all these grounds too. The article's active row and `/design` specimens use the panel. Quotes
band rows contain plain quoted text, and the quote hover card contains scores and reasoning;
neither draws `mark.hit[data-quote]`, and ScoreBars keep their existing accent. Public article
prose uses the same stylesheet. The existing shortfall for caption ink remains. The opaque blue search band also remains
under 3:1 on `--muted` (2.42 to 2.88) and `--surface-raised` / `--popover` (2.34 to 2.82);
these improve, and the page-only 3:1 assertion does not cover them.

## Checked

- `tests/quote-fill.test.ts` in vitest: red on the lavender values for the distance floor (0.146),
  the chroma floor (0.035), deeper-than-the-strip and the soft ink on `--muted` (3.88); green on
  the new values, with `appearance-palette`, `block-flash`, `css-tokens` and `doc-links` (247
  passed). `npm run typecheck` green.
- Playwright, system Chrome, signed in, article `trolls-spya-cvwbcf` in Quotes mode and `/design`
  § Marks in the prose, dark, at 1440, 1024 and 820 wide, 2x:
  [article 1440 before](261005j-shot-before-article-dark-1440.png),
  [after](261005j-shot-after-article-dark-1440.png);
  [article 820 before](261005j-shot-before-article-dark-820.png),
  [after](261005j-shot-after-article-dark-820.png);
  [/design 1440 before](261005j-shot-before-design-dark-1440.png),
  [after](261005j-shot-after-design-dark-1440.png);
  [/design 820 before](261005j-shot-before-design-dark-820.png),
  [after](261005j-shot-after-design-dark-820.png);
  [a search hit over a quote, after](261005j-shot-after-design-dark-searchover-1024.png).
  Computed, dark, all three widths: ordinary `rgba(204 151 243 / 0.24)` to
  `rgba(151 48 208 / 0.408)`, top-priority `0.318` to `0.53`, `.spine-quote`
  `rgba(204 151 243 / 0.88)` both times.
- Light, before and after: the computed fills and strip are identical
  (`rgba(127 66 166 / 0.17)`, `0.282`, `0.88`), and the `/design` PNGs are byte-identical. The two
  article PNGs are not: the two passes caught the page at different scroll and toolbar states.

**Not checked**: a real iPad, which is where Greg saw it; Firefox and Safari; phone width.

GPT Sol's review ([261005j-code-review-sol.md](261005j-code-review-sol.md)) ended *do not ship*
with no P0 or P1: its reasons were that it could not get a vitest run through the box-wide lock in
force that hour, and the low-confidence outline losses in the section above, which it left for a
decision. The vitest run was made afterwards and is the first bullet; the losses were accepted.
What Sol itself ran:

The arithmetic and parser mutation checks were run with plain Node scripts.

A lightweight Node harness ran the actual colour-test source: all 26 assertion groups passed.
Fourteen independent in-memory mutations turned the relevant checks red: restoring lavender and
its strengths (distance, chroma, deeper-colour, muted-soft-ink and strip-substitution control);
moving the strip to the prose token; adding a second live use of the prose token; moving the fill
back to the strip token; reducing either rule's base opacity to 1%; changing the light prose or
dark strip triplet by one; substituting blue, pale purple or black for the prose colour; raising
the heavy strength to 0.8; moving a reader highlight's hue to 310; and darkening `--cat-14` to page
grey. These checks use the real assertion callbacks with Node assertions, not the Vitest runner.
The parser was also checked separately against appended hover and attribute variants: it keeps
reading the base rules. The changed block-flash literal was checked present, and its old-token
mutation absent.
