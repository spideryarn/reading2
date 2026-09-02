# Colour scales

**Three palettes that are not the brand.** `--spideryarn-orange` says *this is us*; these say
*these are different things*, *this much of it*, and *which side of the middle*. The values live in
[`styles/colourscales.css`](../../styles/colourscales.css) and are documented inline; this page is
the reasoning, the sources, and the honest account of what each one gets wrong.

> create a few — e.g. for oppositional red/green, degrees of intensity as hotness, and
> categorical/distinctive/random
>
> — Greg, 2026-08-26

One of them is in use today: the categorical set gives every saved search its own colour
([search.md](search.md)) — derived from a hash of the search's id, or, since 2026-08-27, chosen by
the reader from a swatch popover on the row ([search.md § Changing a row's colour](search.md),
[260827l-search-row-colour.md](../plans/260827l-search-row-colour.md)). **The picker is the one control in the app
that shows a reader this palette, and it still does not know what is in it**: a swatch is
`var(--cat-N-rgb)` and a choice is the number `N`, so everything on this page stays one edit in one
stylesheet. That is also why the survey of colour-picker libraries came back recommending none of
them — every one of them wants a parsed colour value, and an arbitrary colour is the thing the
argument below is against. The other two are built now rather than when they are needed, because the
alternative is that the first feature to want a ramp invents one inline, and by the time there are
two of those neither can be changed.

| Scale | Tokens | Means | Status |
|---|---|---|---|
| **Categorical** | `--cat-0` … `--cat-15` (+ `-rgb`) | these are different things | in use — one per saved search. **The hash reaches the first eight; a reader can pick any of the sixteen** |
| **Sequential (hot)** | `--heat-0` … `--heat-8` | this much of it, and it is hot | ready, unused |
| **Sequential (neutral)** | `--vir-0` … `--vir-8` (+ `-rgb`) | this much of it | in use — how far through the article a paragraph is |
| **Diverging** | `--div-0` … `--div-8`, `--div-rg-0` … `--div-rg-8` (+ `-rgb`) | which side of the middle | in use — how a referee's for/against criterion cuts, in the panel row **and** in the prose |

## Two rules that apply to all three

### The page is near-black, so every published scale is upside down

Every scale in the literature was designed for paper. That has one consequence that changes the
values and one that changes the *shape*:

- **Dark colours vanish.** ColorBrewer's `Blues` starts at `#f7fbff` and ends at `#08306b`; on
  `--background` (`oklch(0.145 0 0)`) the last three steps are darker than the page. Three of
  Okabe–Ito's eight are lifted here for exactly this reason, and the dark end of the heat ramp
  carries a warning not to paint it on the page.
- **A diverging scale's white pivot becomes its loudest point.** RdBu, coolwarm, PiYG and the rest
  all pivot on white, because on paper the neutral value should be the quietest thing there. Drop
  one onto black unchanged and the *middle* is now the brightest thing on the page — so a scale
  that means "this value is neither" screams it. Both diverging scales here pivot on a dark
  neutral just above the page, with lightness climbing toward both ends.

This is the same class of mistake as [`design-css-overview.md`](design-css-overview.md) §
Colour records for `--highlight-wash`: a value carried across from a light-mode source, correct in
its own context, quietly wrong in ours.

### Stops, not `color-mix`

A ramp built by interpolating two endpoints in CSS is shorter and wrong in two ways that do not
announce themselves.

- **The hue goes somewhere you did not ask for.** `color-mix(in oklch, …)` interpolates hue on the
  *shorter* arc by default ([CSS Color 5](https://drafts.csswg.org/css-color-5/#hue-interpolation)),
  which for our blue (255°) and red (27°) runs 255° → 360° → 27° and passes through magenta. Not
  green — an earlier version of this paragraph said "long way round" and "shorter arc" in the same
  sentence and named the wrong intermediate; a GPT Sol review caught the contradiction. Whichever
  route it takes, the point stands: the middle of a two-endpoint mix is a hue nobody chose, and for
  a diverging scale the middle is the value that matters most.

  `tokens.css` already carries a scar from the same family of problem: `--highlight-wash` mixes
  `in oklab` because `--page` is written `oklch(0.145 0 0)` with a hue *explicitly* set to 0, so
  polar interpolation interpolates it and drags the mix round to 11.7° — a wash that is quietly pink
  rather than warm.
- **Gamut clipping flattens the middle.** Intermediate colours that fall outside sRGB are clipped
  per channel, which loses the most chroma exactly where the ramp is trying to be legible.

So every stop is written out. Interpolating *between adjacent stops* at render time is fine — they
are close enough that neither failure has room to happen.

## Categorical — sixteen hues that mean "these are different things", eight of them automatic

**Two numbers, and everything below turns on the gap between them.**
`CATEGORICAL_SLOTS` is 8 — what the hash hands out on its own — and
`PALETTE_SLOTS` is 16, what a reader may choose from
([hit-colours.ts](../../src/web/hit-colours.ts)). Greg asked for the second on
2026-08-27:

> And add more colours, arranged more naturally.
>
> — Greg, 2026-08-27

Growing one number instead of two would have been simpler and wrong twice.
**Every saved search would have changed colour**, because the automatic slot is
`hash % CATEGORICAL_SLOTS` and changing the modulus moves every run in every
article at once — silently, to everybody. And **the argument in the next
section would have broken exactly where it matters**: eight really is the top of
the range anyone claims is reliably distinguishable, and the automatic set is
the hard case — nobody chose those hues, several are overlaid on one paragraph,
and the reader is telling apart searches they never coloured. A hue somebody
picked on purpose is a different question, and the answer to it is "give them a
wheel".

The eight new ones fill the gaps rather than extending the list. Okabe–Ito's
seven chromatic hues sit at 43°, 73°, 105°, 168°, 236°, 261° and 345° in OKLCH —
three crowded into the warms and four gaps of 58° to 84°. The additions land at
14, 126, 147, 191, 213, 282, 303 and 326, leaving fifteen chromatic hues spaced
21–32° apart the whole way round. Each is the highest chroma sRGB will hold at
its lightness and hue, capped at 0.16 so none shouts louder than the originals,
and every lightness falls between 0.69 and 0.78 — inside the range the original
eight already occupy, and far above the page's 0.145.

**That "arranged more naturally" is a checked property, not a hand-written
list.** `PALETTE_BY_HUE` orders the picker's grid, and
`tests/hit-colours.test.ts` reads this stylesheet, converts every triplet to
OKLCH and requires the array to be sorted by hue angle — so a hue that moves
turns a test red instead of quietly putting the grid out of order. The
achromatic slot sorts last, which is where the neutral belongs; giving a
colourless colour a hue angle would have parked the grey in the middle of the
spectrum.

**What the sixteen cost, measured rather than asserted.** In normal vision the
closest pair is 0.059 in OKLab — comfortably apart, though tighter than the
eight were. Under simulated dichromacy it is much worse: deuteranopia collapses
slot 5 and slot 11 to 0.016, and tritanopia takes slot 0 and slot 2 to zero.
That is the honest reason these are opt-in and the automatic set is not — a
reader who cannot tell teal from reddish purple will not choose both, whereas
the hash would cheerfully hand them out together.

## The original eight, and why those eight

**Okabe–Ito, lifted for a black page.** The source is Masataka Okabe and Kei Ito's Color Universal
Design set (2002, revised 2008), the most-used colour-blind-safe qualitative palette there is. Two
changes, both forced by the ground:

- Its eighth colour is **black**, which on this page *is* the page. It has become a light neutral
  (slot 7), and that is the weakest slot in the set — deliberately the one an eighth search reaches.
- **Five of the remaining seven are lifted**, keeping hue and roughly keeping chroma: the blue
  (`#0072B2`, much the darkest and moved furthest), the bluish green (`#009E73`), the vermilion
  (`#D55E00`), the reddish purple (`#CC79A7`) and the orange (`#E69F00` → `#E8A33B`). Only the sky
  blue (`#56B4E9`) and the yellow (`#F0E442`) are the published values untouched — they were already
  light enough.

  An earlier version of this page said *three*, and labelled the orange "unchanged" when it is not;
  a GPT Sol review compared the stylesheet against the source and found both. The published hex is
  recorded beside every entry in the stylesheet precisely so that this comparison is possible
  without a reference open, which only helps if the labels are right.

### Why Okabe–Ito rather than something prettier

Three properties, and only the first is obvious.

1. **It varies lightness, not just hue.** That is what gives a dichromat a second channel. A
   palette of eight hues at one lightness — which is what you get by rotating hue in HCL, and what
   most "generate me N distinct colours" recipes produce — collapses to eight identical greys for
   somebody who cannot see the hue difference.
2. **It was designed for this and not adapted to it.** Tol's schemes and IBM's five-colour set are
   the other serious candidates. IBM's is five, which is too few here. Tol's `bright` is seven and
   excellent, but its `#BBBBBB` grey and its `#4477AA` blue are both darker than we can use, so
   adopting it would mean the same lifting exercise with a less-cited base.
3. **It is not a rainbow.** A hue-spread rainbow is fine for categories — the objection to rainbows
   is about *ordered* data — but it fails colour blindness harder than a designed set, because
   nothing has been done about the pairs that collapse.

### How many is too many

Eight is at the top of what anyone is willing to call distinguishable, and it is eight here because
Okabe–Ito is eight, not because eight was measured. The practical ceiling quoted in the
visualisation literature is around seven, and IBM's colour-blind-safe palette stops at five. So the
honest position: **the first five or six searches are comfortably telling apart, the seventh and
eighth are a stretch, and the ninth wears a colour it shares with an earlier one.**

That is survivable only because of the next section.

### Nobody else has solved overlapping highlights either

Worth knowing before anyone assumes there was an obvious answer we missed. Multi-colour highlights
that can overlap on the same words are **not a solved problem in the tools you would expect to have
solved it**:

- **Hypothes.is** has had multi-colour highlighting as an open, unimplemented feature request since
  2017 ([product-backlog#198](https://github.com/hypothesis/product-backlog/issues/198)). Two
  annotations on the same sentence just double up the same yellow.
- **Readwise Reader** does not support multiple highlight colours at all. Their own docs tell you to
  use *tags* when you want more than one kind of highlight — they moved the distinction out of
  colour entirely.
- **PDF annotators** generally treat overlapping same-colour highlights as a *bug report*: the
  double alpha goes muddy, and users file it.

The techniques that exist, and what each costs:

| Technique | What it loses |
|---|---|
| `mix-blend-mode: multiply` | two colours drift toward brown, three toward black; text contrast degrades per layer |
| Priority / z-order (the CSS Custom Highlight API has a literal `priority` property) | the overlap itself — you can no longer see that two things met here |
| First-match precedence | same as priority |
| **Stacked underline bars, one per highlight** | ~3px of leading, and it caps out |
| Left-edge gutter bar | phrase-level precision; it can only say "something is in this paragraph" |
| Striped / hatched background | legibility — at 17px type the stripe period is bigger than the letterforms |

The fourth is what Greg picked and what is built, and it is the one that keeps the colour off the
glyph background entirely — which is why the text's contrast is **identical** whether one search
matched or four. Everything else on that list makes the words harder to read exactly where the
reader most cares.

We take the gutter bar too, at paragraph scale, because the two answer different questions.

### The contrast trap this design sidesteps

WCAG 1.4.3's 4.5:1 applies to the **composited** colour, not to the flat hex you wrote down. Stack
two 30% washes and the number you need to check is a colour that exists nowhere in your stylesheet,
that no browser tool will compute for you, and that changes with how many highlights happen to
overlap at that spot.

Splitting the channels removes the question rather than answering it: the wash never composites with
another wash, so the prose contrast has exactly one value and it is the same one it has always had.

### Colour is never the only carrier

Under deuteranopia the two warm slots (1, vermilion, and 6, orange) converge, separated only by
about nine points of lightness. That is a real cost, and the mitigation is the only one that
actually works: **the criterion is printed in full beside every dot**, named in every result row's
hover card, and put in the row's `aria-label`. Colour here is a shortcut for something the reader
can always read; it is never the message.

WCAG 1.4.1 says the same thing, and it happens to be the right rule rather than a box to tick — the
eight-colour legend nobody can hold in their head is a usability problem long before it is an
accessibility one.

**The one place a mark in the prose carries a judgement, and what it costs.** Since 2026-09-02 a
referee's for/against criterion paints its passages by *direction* rather than by which criterion
found them ([referee-mode.md § Criteria](referee-mode.md#1-criteria-the-referees-own-criteria-marked-in-the-prose)).
Greg asked for it, because the panel and the prose were painting one phrase from two different
palettes and contradicting each other. Everything else this page says still applies, and the prose
has no words in it, so the rule had to be met at the mark itself rather than in the panel:

- **The mark carries a sign** — `−` counts against, `+` counts for, `·` counts neither way, `±` for
  two results pointing opposite ways over one phrase. Written as `data-dir` and drawn through a CSS
  `::after`, so it is generated content: it survives greyscale and every dichromacy, and it cannot
  be copied out of the article or reach the block's text offsets. Its **alt text is the direction in
  words** (`content: "−" / "counts against"`), so a reader using a screen reader hears the carrier
  where the judgement is rather than only in a panel they may not have opened — the wording is
  `directionWords` in [`src/web/valence.ts`](../../src/web/valence.ts), and
  `tests/valence.test.ts` reads this file's copy of it off disk so the two cannot drift.
- **The Criteria panel prints a key** whenever such a criterion is switched on — all four glyphs, in
  the ramp the reader is actually on rather than in the words "red" and "green".
- **The identity hue stops being claimed where it is no longer true.** On a for/against criterion
  the panel's colour control reaches only the paragraph bar and the rail, so the tick beside it is
  neutral and the control says *bar and rail colour*. A tinted tick there would be pointing at
  marks it no longer paints.

The identity channel is not lost, only moved: the bar down the left of the paragraph and the spine
rail still read the palette slot, which is the § below on *the two answer different questions* doing
its job. What is knowingly given up is the phrase-level version of it — a red mark no longer says
*which* criterion said so. That is written down in
[260902e-make-referee-mode-understandable.md](../plans/260902e-make-referee-mode-understandable.md)
rather than left to be rediscovered.

### One local collision worth knowing about

Slot 6 is close to `--spideryarn-orange` (`#DB8A45`), which on this page means *highlight* and draws
comment underlines. They are different marks in different places — a 2px rule at the foot of a wash
against an underline on the text — so they are told apart by position rather than by hue. Worth
knowing before anyone moves either.

### Assigning a colour to a search

[`src/web/hit-colours.ts`](../../src/web/hit-colours.ts) hands out **slot numbers**, never colours,
and this stylesheet is the only place the two meet. The same seam runs through
[`annotate.ts`](../../src/web/annotate.ts), which writes `--h0: var(--cat-3-rgb)` onto a mark: the
slot is a fact about which question was asked, the hue is a fact about the palette, and neither half
should be able to change the other.

The assignment is **linear probing from a hashed first choice, oldest search first**. The property it
buys is stability: a saved search is a thing you come back to, and a colour meaning "this question"
is worth nothing if it is a different colour tomorrow. So appending a search never recolours an
existing one, a reload never reshuffles, and ticking a box never changes anything's hue.

The cost, stated plainly because there is no version of this without one: **deleting a search can
recolour the searches made after it.** Its slot is freed, and a later search whose first choice was
that slot takes it. The two ways out are both worse — storing the colour on the run means a schema
change and a server with an opinion about the palette, for a derived value; never reusing a freed
slot means keeping tombstones forever. A colour changing when you delete the search above it is
something the reader watched happen. The other two fail quietly.

The hashed preference (rather than "first search gets slot 0") exists only to shrink that cost:
position-based assignment means deleting the first of five shifts *all four* of the others, so every
colour on the page changes at once.

### The "random" case, which is what this is

Greg's ask named three kinds, and the third was *categorical/distinctive/random* — colours for
things you do not know about in advance. That is exactly the situation here: a saved search is
created by a reader typing a question, and there is no list of them to design against.

There are two ways to do it, and the choice is not close.

**Hash to a continuous hue.** The classic recipe is the golden-angle rotation (Martin Ankerl, 2009):
start anywhere and add 137.508° each time, so every new hue lands in the largest remaining gap and
the set stays maximally spread however many you generate. It is elegant and it is wrong here for two
reasons. It gives no colour-blindness guarantee at all — two categories can land 15° apart and be
indistinguishable. And done in HSL, which is how it is usually done, the perceived lightness swings
wildly by hue even with S and L numerically fixed: yellows come out loud, blues come out muddy. (The
fix for the second half is to rotate hue in OKLCh at fixed L and C, which is genuinely better and
still does not fix the first half.)

**Hash to an index into a curated palette**, which is what `assignSlots` does. Every colour has been
chosen for mutual distinctness and colour-blind safety by somebody who looked at all eight together,
and the degradation past the end of the palette is a repeat rather than a colour nobody vetted.

The rule that falls out, and it is the general one: **use a fixed palette up to its size; only reach
for golden-angle-in-OKLCh beyond it.** We do not have a beyond — the ninth search repeats a hue,
because a ninth *distinguishable* hue is not available at this point and pretending otherwise would
be worse than repeating.

## Sequential — two ramps of nine steps that mean "this much of it"

**Inferno**, from matplotlib — Nathaniel Smith and Stéfan van der Walt's set, presented at SciPy
2015 and designed with `viscm` against the CAM02-UCS perceptual space.

Chosen over viridis for the reason Greg's framing asks for: the axis he described is *hotness*, and
inferno is the blackbody ramp — dark, red, orange, yellow, white — so the cultural reading and the
perceptual one agree. Viridis is the choice for a quantity with no temperature in it — that day
came on 2026-08-27, and it is the next section.

### The property that actually matters is monotonic lightness

Every step is lighter than the one before it. That single property is what makes the ramp survive
greyscale printing, every dichromacy, and a bad projector, without any of them having to be thought
about — because lightness is the channel all three of those preserve.

Measured rather than assumed: these nine stops run L 0.048 → 0.978 in near-even steps, checked in
[`tests/colour-scales.test.ts`](../../tests/colour-scales.test.ts) — which also pins that the steps
stay *roughly even*, because monotonic is necessary and not sufficient. A ramp that spends six steps
between L 0.90 and 0.95 is still monotonic and its top third is still six colours nobody can tell
apart. That is the specific complaint against the naive blackbody ramp (MATLAB's and matplotlib's
`hot`), which blows out to white too early and washes out its high values. **Inferno is the fix for
exactly that** while keeping the same visual vocabulary, which is the second reason to prefer it
here over rolling our own black→red→yellow ramp.

It is also the property `jet` and every other rainbow ramp lacks, which is the whole of why they are
wrong for ordered data. A rainbow has bright bands in the middle (yellow, cyan) and dark ones at the
ends, so it **invents boundaries the data does not have** and hides differences it does. The case is
made in Borland and Taylor, *Rainbow Color Map (Still) Considered Harmful* (IEEE Computer Graphics
and Applications, 2007), and restated for a wider audience in Crameri, Shephard and Heron, *The
misuse of colour in science communication* (Nature Communications, 2020).

### Viridis, for the same job with no heat in it

Same source, same property, same reason it survives greyscale and dichromacy:
monotonic lightness, `viscm`, CAM02-UCS. It is here because **inferno makes a
claim** — dark, red, orange, yellow, white is the blackbody ramp, and a reader
reads *hotter* off it. Reading position is not hot. Neither is a count, a score,
or a duration.

It has one practical advantage over inferno on this page, and it is worth
knowing before choosing between them: **every viridis stop is clear of
`--background`**, where `--heat-0` is darker than the page and `--heat-1` is
above it by only 0.07. So viridis has no "start at step 2" caveat to forget.
Both facts are pinned in [`tests/colour-scales.test.ts`](../../tests/colour-scales.test.ts).

Written as `-rgb` triplets as well as hex, unlike `--heat-*`, because a component
sets `--cat-rgb` to one of them inline and the stylesheet paints it at an alpha —
the same indirection the categorical set uses (`rampStyle` in
[`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx)).

### Start at `--heat-2` when painting on the page

Two claims, and only the first is arithmetic. `--heat-0` (`#000004`, L 0.048) is genuinely darker
than `--background` (L 0.145), so a value near zero would be drawn as a hole. `--heat-1` (`#1b0c41`,
L 0.217) is *above* the page — but by 0.07, which reads as a smudge rather than as a value.

An earlier version of this page said both were darker than the page, which was wrong about the
second, and the error survived writing because nothing measured it. Both boundaries are now pinned
in [`tests/colour-scales.test.ts`](../../tests/colour-scales.test.ts), including that `--heat-2` —
the stop this advice sends you to — really is clear of the page.

The dark stops are kept anyway, so the ramp is the published one and can be sampled correctly if it
is ever drawn on white.

## Diverging — nine steps with a middle that means "neither"

Two of them, and which is the default is the one opinion in the stylesheet worth arguing about.

### `--div-*` is blue ↔ red, and it is the one to use

Red and green is what people ask for, because red-bad / green-good is a convention almost everybody
holds. It is also the single worst pair available. Red–green confusion is what colour blindness
overwhelmingly *is* — deuteranomaly and protanomaly together affect roughly 8% of men of northern
European descent and about 0.5% of women — and to a deuteranope a red–green diverging scale is a
scale that gets darker in the middle and says nothing at all about which side you are on.

Blue against red keeps the warm/cool opposition that makes the convention legible, keeps the "hot"
end hot, and survives every common dichromacy. It is why ColorBrewer's own colour-blind-safe filter
keeps `RdBu` and drops `RdYlGn`.

### `--div-rg-*` is red ↔ green, and it is here because it was asked for

Use it where the reader already knows which end is which from something other than the colour — a
printed number, a label, a position — so the hue is a shortcut rather than the message. Do not use
it as the only carrier of a good/bad judgement. This is the same rule the categorical set follows,
and for the same reason.

**A sign counts as "something other than the colour", and that is how the prose meets this rule.**
Referee mode's panel meets it four times over — rank, direction in words, the referee's own pole
label, the signed number — and its marks in the prose meet it once, with the `−` / `·` / `+` after
the marked phrase. One carrier is enough where it is *co-located with the mark itself*; four in a
panel three inches away are not, which is the distinction the first draft of that plan got wrong and
a cross-family review caught. See § *Colour is never the only carrier* above.

**Both ramps are written as `-rgb` triples with the plain `--div-N` derived from them**, the same
call `--vir-*` and the categorical set make: a component sets a custom property to one of these
inline and the stylesheet interpolates it into `rgb(…)` — [`annotate.ts`](../../src/web/annotate.ts)
does exactly that with `--h0` … `--h5`. Handing a mark the plain spelling, whose value is itself an
`rgb(…)` expression, makes the declaration invalid at computed-value time and the stripe paints
nothing at all, with no error anywhere; hence two functions with two names in
[`valence.ts`](../../src/web/valence.ts) rather than one a caller can get subtly wrong.

**Which of the two a criterion is drawn with is a property of the mode, not of the criterion** —
`?refscale=rg|br`. The two ramps put red at opposite ends: `--div-rg-0` is red for *against* where
`--div-8` is red for *favour*, so two criteria each choosing their own would have put opposite
verdicts behind the same red underline.

Blue against **orange** is actually the pair the literature cites most often — it is the
Wong/Okabe–Ito opposition, and it is ColorBrewer's PuOr. It is not used here for a reason local to
this app rather than a general one: orange is the brand, and a scale whose "positive" end wears the
colour that means *Spideryarn* everywhere else would be one hue doing two jobs on one page. Blue ↔
red is the next-best colour-blind-safe pair and has no such conflict.

### These two are generated, not transcribed — and here is why

**There is no canonical dark-ground diverging scale to copy.** Searching for one in 2026 turns up an
open design problem rather than a named scheme; every published diverging scale pivots on white. So
these are built from the one property that makes Fabio Crameri's `vik` colour-blind-safe *by
construction*: **luminance symmetric about the midpoint.**

That property is orientation-free. A dichromat who cannot separate the two hues can still read
distance-from-neutral off the lightness — and that works just as well with the symmetry mirrored
about a dark pivot as about a white one. So both arms are the same five lightnesses in the same
order,

```
L   0.82   0.705   0.59   0.475   0.36   0.475   0.59   0.705   0.82
    ├──────────── blue ────────────┤ pivot ├──────────── red ─────────┤
```

with only hue and a chroma taper differing between them, and chroma clamped per step to what sRGB
can actually display at that lightness.

**The first version of this was hand-picked hex and it was wrong.** `--div-3` came out *darker than
the pivot*, so the blue arm dipped below the middle and climbed back — which is precisely the
non-monotonic-lightness fault that this whole page says makes rainbow ramps invent boundaries. It
was caught by measuring, after the paragraph asserting the opposite had already been written. Nine
plausible hex codes tell you nothing; the relationship between them is the entire content of a
colour scale, and it is now measured in
[`tests/colour-scales.test.ts`](../../tests/colour-scales.test.ts).

### The dark pivot, again

Both scales pivot on a dark neutral a little above the page, with lightness climbing toward both
ends. See [The page is near-black](#the-page-is-near-black-so-every-published-scale-is-upside-down)
above — this is where that rule bites hardest, because getting it wrong does not look broken, it
looks like the middle of your data is the interesting part.

### Anchor the middle to zero, not to the data

Not a property of the palette but of whoever uses it, and the mistake is easy: with data running
from −2 to +9, putting the neutral colour at the *data* midpoint (+3.5) means every genuinely
neutral value is drawn in the "negative" colour. The pivot belongs at the value that means neither,
which is almost always zero, and the ends are then asymmetric — which is honest, and looks it.

## What is not decided

- **No `cividis`.** (Nuñez, Anderton & Renslow, PLOS ONE 2018) — the one built specifically so that
  colour-blind and non-colour-blind viewers see near-identical gradients, and the right choice over
  either ramp here anywhere the colour is doing more work than the number beside it. One more block
  of nine stops, when it is wanted.

  **Viridis is no longer on this list.** It was added on 2026-08-27 for the Drift and Trail pictures
  ([diagram.md](diagram.md)), which colour a dot by how far through the article its paragraph is.
  That is an ordered quantity with no temperature in it, which is exactly the case this file said
  viridis was for — and the first draft of that feature reached for `--heat-*` because it was
  already in the file. A GPT Sol review named it. See § Sequential below.
- **Nothing checks these against a colour-blindness simulator.** The lightness properties *are*
  measured now ([`tests/colour-scales.test.ts`](../../tests/colour-scales.test.ts)), which is the
  half that catches the silent failures. The other half — a dichromacy transform with a minimum
  CIEDE2000 between every pair — is not built. The concrete way to do it by hand is
  [Viz Palette](https://susielu.com/data-viz/viz-palette) (Susie Lu & Elijah Meeks), which renders a
  palette across real chart types and flags pairs that are too close under deuteranomaly and
  protanopia; the npm package `color-blind` would let it become a test.
- **The eight categorical hues have not been measured, only sourced.** Okabe–Ito is well attested;
  the three lifted values are ours, and lifting a colour changes its relationships with the others
  by an amount nobody here has computed.
- **Whether an eighth search should get a colour at all**, rather than a pattern or a number.

## See also

- [`styles/colourscales.css`](../../styles/colourscales.css) — the values, and the note beside each
  departure from its source
- [`src/web/hit-colours.ts`](../../src/web/hit-colours.ts) — slot assignment, and why it is a hash
- [search.md](search.md) — the one feature using the categorical set, and what the colour is *for*
- [design-css-overview.md](design-css-overview.md) — where this file sits in the cascade, and the
  `oklab`-not-`oklch` trap
- **`/design`** ([`DesignPage.tsx`](../../src/web/DesignPage.tsx)) — all three scales rendered
  against the real ground. Look at it after touching any value here;
  [browser-testing.md](browser-testing.md) is emphatic that a screenshot is not evidence about
  colour

### Sources

- Okabe & Ito, *Color Universal Design* — <https://jfly.uni-koeln.de/color/>
- Paul Tol, *Colour Schemes* (technical note) — <https://personal.sron.nl/~pault/>
- ColorBrewer — <https://colorbrewer2.org/> (the "colorblind safe" filter is the relevant control)
- matplotlib's perceptually uniform colormaps, and the `viscm` tool behind them —
  <https://bids.github.io/colormap/>
- Borland & Taylor, *Rainbow Color Map (Still) Considered Harmful*, IEEE CG&A 27(2), 2007
- Crameri, Shephard & Heron, *The misuse of colour in science communication*, Nature Communications
  11, 5444 (2020) — <https://doi.org/10.1038/s41467-020-19160-7>
- Nuñez, Anderton & Renslow, *Optimizing colormaps with consideration for color vision deficiency*
  (cividis), PLOS ONE 13(7):e0199239, 2018
- Fabio Crameri, *Scientific Colour Maps* — <https://www.fabiocrameri.ch/colourmaps/> (`vik` is the
  diverging scale whose luminance symmetry these two are built on)
- Martin Ankerl, *How to Generate Random Colors Programmatically* (the golden-angle recipe), 2009 —
  <https://martin.ankerl.com/2009/12/09/how-to-create-random-colors-programmatically/>
- Viz Palette, Susie Lu & Elijah Meeks — <https://susielu.com/data-viz/viz-palette>
- Hypothes.is, multi-colour highlighting — open since 2017 —
  <https://github.com/hypothesis/product-backlog/issues/198>
- CSS Custom Highlight API, `Highlight.priority` —
  <https://developer.mozilla.org/en-US/docs/Web/API/Highlight/priority>
- Björn Ottosson, *A perceptual color space for image processing* (OKLab) —
  <https://bottosson.github.io/posts/oklab/> (the matrices `tests/colour-scales.test.ts` uses)
