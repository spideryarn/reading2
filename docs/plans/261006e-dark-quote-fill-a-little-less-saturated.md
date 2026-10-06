# The dark quote fill, a little less saturated

Greg, 2026-10-06, report `spya-hsbz0z`, the morning after
[261005j](261005j-dark-quote-prose-colour-deeper-purple-spine-keeps-its-own.md) made the dark fill
a deeper purple:

> Now the purple Quote highlighting is a little toooo saturated. Just dial it down a bit. Take
> screenshot

**Which appearance.** The dark one. Yesterday's two changes moved the dark page only, and he asked
for both from an iPad in the dark appearance; the light page's fill has been the same since
2026-10-03 and nobody has complained about it. So the light page is not touched, and a test pins it.

**Built**: on the dark page `--quote-prose-rgb` goes from `151 48 208` to **`143 70 189`**: the same
hue (310) and the same OKLab lightness (0.54), with four fifths of the chroma (0.232 to 0.185). The
heavy tier's strength goes from 0.60 to **0.58**; the light tier's stays 0.48. The spine strip is
untouched.

| on the dark page | lavender (until 10-05) | 10-05 purple | now | floor |
|---|---|---|---|---|
| faintest quote, chroma over the page | 0.035 | 0.099 | 0.076 | 0.065 to 0.09 |
| strongest quote, chroma over the page | 0.059 | 0.156 | 0.119 | under 0.13 |
| faintest quote, OKLab distance from the page | 0.146 | 0.171 | 0.162 | > 0.16 |
| faintest vs page, contrast | 1.37 | 1.32 | 1.35 | > 1.15 |
| ink on the strongest fill | 8.90 | 9.56 | 9.52 | > 4.5 |
| soft ink on the strongest fill | 4.85 | 5.21 | 5.19 | > 4.5 |
| soft ink, strongest fill, block on `--muted` | 3.88 | 4.61 | 4.52 | > 4.5 |
| blue search colour on the strongest fill | 3.03 | 3.25 | 3.24 | > 3 |
| heavy vs light where the tiers meet, contrast | 1.19 | 1.16 | 1.13 | > 1.12 |

So it is about a quarter less saturated at both ends, and sits between the lavender he found too
faint and the purple he found too much, nearer the purple. Its distance from the page is close to
the adopted floor after his "hard to see" complaint (0.162 against 0.16), so a larger cut spends
more of the remaining visibility margin. If this is still too much, the next step gives some
visibility back, and that is his call to make from a screenshot.

**Why the heavy strength moved.** A less saturated purple at the same lightness is slightly lighter
in luminance, so the soft ink in a code block under a top-priority quote fell to 4.42, under the
4.5 floor added yesterday. At 0.58 it is 4.52. That also dials the heavy tier down a little, which
is the direction asked for. The cost is the step between the tiers: 1.16 to 1.13, floor 1.12.

**The test** (`tests/quote-fill.test.ts`): a new "not too saturated" check, chroma under 0.09 at
the faintest and 0.13 at the strongest, seen red on yesterday's values (0.0986). Two of yesterday's
floors had to come down with the colour, because they were set from the colour he has now turned
down: the faintest quote's chroma, 0.08 to 0.065 (still about 1.8 times the lavender's), and "more saturated
than the strip by", 0.05 to 0.03. Everything else is unchanged and green.

## Passed over

- **Only lowering the strengths.** At 0.42 / 0.54 the same purple loses a tenth of its chroma on
  the page but falls to 0.151 from the page, under the visibility floor from his iPad report. It is
  the colour that is too much, so the colour is what moved.
- **A bigger cut** (three quarters of the chroma). It can just clear the floors: `141 74 185`
  at 0.48 / 0.575 gives faintest distance 0.1605, soft ink on `--muted` 4.5066 and tier contrast
  1.1264. At heavy strength 0.58 the soft ink is 4.4804, under its floor. The built point leaves
  more margin and fits "a bit"; the floors do not mathematically rule out this alternative.
- **Touching the light page.** Above.

## Independent review

An independent [Python script](261006e-review-colours.py) recomputed the table in gamma-encoded
sRGB source-over on opaque grounds. All entries agree at the displayed precision except the
tier-boundary contrast: **1.132702**, corrected above to 1.13. Source OKLCH is approximately
`0.539701 0.232267 309.886` before and `0.540087 0.184837 309.850` after: the hue and lightness
are preserved within integer-sRGB rounding, with 20.42% less source chroma. On the page the
faintest and strongest chroma fall 23.16% and 23.74%; faintest OKLab distance falls 4.98%.

**The choice fits the request.** Lowering chroma rather than both strengths retains more of the
faint quote's visibility. The lowered chroma floors are a deliberate response to the new complaint,
not unchanged acceptance criteria: 0.065 is about 1.8 times the lavender's 0.03523, and the source
chroma margin above the strip is now 0.04580 rather than 0.09323. The visibility floor remains
0.16. The ceiling rejects yesterday's actual faintest and strongest chroma, 0.098556 and 0.155977,
against 0.09 and 0.13. These are regression bounds, not measured human perception thresholds.
The rejected three-quarter-chroma alternative was also recomputed: it can pass with a smaller
heavy strength, so the claim that it necessarily fails the distance floor was corrected above.

**Several omitted pairings regress.** On the strongest page fill, low-confidence categorical
outlines improve at `--hit-a` 0.35, 0.45 and 0.675; the opaque bands lose 0.012 to 0.030 contrast
ratio points, still all above 3. On light-tier quotes, translucent outlines do lose contrast:
at the faintest quote and `--hit-a: 0.45`, slots 0, 1, 3–9 and 13–15 regress, including crimson
2.973 to 2.935 and pink 3.543 to 3.501. At `--hit-a: 0.675`, all sixteen regress at the faintest
quote (losses 0.038 to 0.100). This is a real source value: `hitMarks` maps confidence onto
0.35–1 before CSS applies `0.35 + 0.65 * --hit-a`; confidence zero therefore draws at outline
alpha 0.5775, not 0.35. The script includes additional endpoints and strengths.

The page-coloured gap improves on both tiers (strongest 1.8983 to 1.9054), and cross-reference
rules improve (strongest 2.5562 to 2.6210). The glossary rule improves on a heavy quote, but loses
on a light quote: faintest 3.3994 to 3.3653; last light 3.1327 to 3.0981. Beside the reader's
yellow, green, blue and pink washes, OKLab separation decreases respectively from 0.2003, 0.2055,
0.1393, 0.1368 to 0.1634, 0.1689, 0.1056, 0.1037 at the strongest quote, and from 0.1635,
0.1459, 0.0843, 0.0818 to 0.1423, 0.1230, 0.0653, 0.0641 at the faintest. Luminance contrast
improves beside the strongest quote but falls beside the faintest (yellow 1.414 to 1.381, green
1.239 to 1.210, blue 1.214 to 1.185, pink 1.194 to 1.166). On overlapping words the reader's
wash replaces the quote, so there is no additional compositing there.

| strongest fill on another ground | yesterday | now |
|---|---|---|
| soft ink on `--card` | 4.8523 | 4.7886 |
| soft ink on `--panel` | 4.9427 | 4.8895 |
| soft ink on `--muted` | 4.6093 | 4.5196 |
| soft ink on `--surface-raised` / `--popover` | 4.5179 | 4.4193 |
| opaque blue search colour on `--card` | 3.0292 | 2.9894 |
| opaque blue search colour on `--panel` | 3.0856 | 3.0524 |
| opaque blue search colour on `--muted` | 2.8774 | 2.8215 |
| opaque blue search colour on `--surface-raised` / `--popover` | 2.8204 | 2.7589 |

Ink and link contrast also fall on each of these grounds; faintest distance and chroma fall on
each. Glossary contrast falls on `--muted` (2.3664 to 2.3621) and `--surface-raised` (2.3326 to
2.3234); cross-reference rules and the page-coloured gap improve. The script gives every sum.
The two new threshold crossings are soft ink on the raised surface and blue on the card.
Neither ground was found hosting `mark.hit[data-quote]` in the reading prose: active rows use
`--panel`, opaque blocks and article table headers use `--muted`, and quote panels/cards contain
plain text or scores. Treat the crossings as limits on future reuse, not established reader-path
failures. Altering other rules or surfaces is wider work, left for the owner to decide.

No current reference to the old triplet or dark heavy strength was found in `src/`, `styles/`,
`tests/` or `docs/project/`; the remaining mentions are history, approximate constraints or
unrelated priority thresholds. The light appearance and spine values are unchanged.

## Checked

- Requested Vitest run: five files passed, 249 tests passed and 9 skipped (258 collected).
- Reviewed the new [dark `/design` screenshot](261006e-shot-after-design-dark-1440.png) against
  yesterday's specimen: the reduced saturation looks modest and the quote/gap remain clear.
  Layout/cropping differ, so this is visual inspection, not a pixel comparison. This review did
  not drive a browser or establish appearance on a real iPad; see the separate browser check.
- The browser check: Playwright, system Chrome, signed in, article `trolls-spya-cvwbcf` in Quotes
  mode, 2x, framed as yesterday's were. Dark:
  [1440](261006e-shot-after-article-dark-1440.png) (yesterday's:
  [1440](261005j-shot-after-article-dark-1440.png)),
  [820](261006e-shot-after-article-dark-820.png) (yesterday's:
  [820](261005j-shot-after-article-dark-820.png)). Light:
  [1440](261006e-shot-after-article-light-1440.png), [820](261006e-shot-after-article-light-820.png).
  Computed, dark, at 1440, 820 and 390: ordinary `rgba(143 70 189 / 0.408)`, top-priority `0.51`
  (0.58 at full fade on `/design`), `.spine-quote` `rgba(204 151 243 / 0.88)`. Light, 1440 and 820:
  `rgba(127 66 166 / 0.17)`, `0.282`, strip `0.88`, the values of both earlier checks. No
  horizontal overflow at any width.
- **At 390 the Quotes band covers the prose**, so [the phone shot](261006e-shot-after-article-dark-390.png)
  shows the list and not a fill; the phone evidence is the computed colour only.
- The reviews were one, not two: GPT Sol took the plan and the code together
  ([prompt](261006e-review-prompt.md), [answer](261006e-review-sol.md)), because the change is three
  numbers. Verdict: ship. The regressions above were read and accepted as the price of the cut: all
  are small, and the two threshold crossings are on grounds no quote is drawn on today.

**Not checked**: a real iPad, which is where Greg saw it; Safari and Firefox.
