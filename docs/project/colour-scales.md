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
([search.md](search.md)). The other two are built now rather than when they are needed, because the
alternative is that the first feature to want a ramp invents one inline, and by the time there are
two of those neither can be changed.

| Scale | Tokens | Means | Status |
|---|---|---|---|
| **Categorical** | `--cat-0` … `--cat-7` (+ `-rgb`) | these are different things | in use — one per saved search |
| **Sequential** | `--heat-0` … `--heat-8` | this much of it | ready, unused |
| **Diverging** | `--div-0` … `--div-8`, `--div-rg-0` … `--div-rg-8` | which side of the middle | ready, unused |

## Two rules that apply to all three

### The page is near-black, so every published scale is upside down

Every scale in the literature was designed for paper. That has one consequence that changes the
values and one that changes the *shape*:

- **Dark colours vanish.** ColorBrewer's `Blues` starts at `#f7fbff` and ends at `#08306b`; on
  `--background` (`oklch(0.145 0 0)`) the last three steps are darker than the page. Three of
  Okabe–Ito's eight are lifted here for exactly this reason, and the two darkest steps of the heat
  ramp carry a warning not to paint them on the page.
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

- **Hue takes the long way round.** `color-mix(in oklch, …)` interpolates hue on the shorter arc,
  and for a diverging scale the endpoints are more than 180° apart — so "blue to red" travels
  through green, and the middle of the scale is a colour nobody asked for. `tokens.css` already
  carries a scar from the neighbouring version of this: `--highlight-wash` mixes `in oklab` because
  `--page` is written `oklch(0.145 0 0)` with a hue *explicitly* set to 0, so polar interpolation
  drags the mix round to 11.7° and the result is pink rather than warm.
- **Gamut clipping flattens the middle.** Intermediate colours that fall outside sRGB are clipped
  per channel, which loses the most chroma exactly where the ramp is trying to be legible.

So every stop is written out. Interpolating *between adjacent stops* at render time is fine — they
are close enough that neither failure has room to happen.

## Categorical — eight hues that mean "these are different things"

**Okabe–Ito, lifted for a black page.** The source is Masataka Okabe and Kei Ito's Color Universal
Design set (2002, revised 2008), the most-used colour-blind-safe qualitative palette there is. Two
changes, both forced by the ground:

- Its eighth colour is **black**, which on this page *is* the page. It has become a light neutral
  (slot 7), and that is the weakest slot in the set — deliberately the one an eighth search reaches.
- Three of its colours sit below L\* 0.65 and disappear into a near-black ground. The blue, the
  bluish green and the vermilion are lifted, keeping hue and chroma. The published hex is recorded
  beside each in the stylesheet, so the change is visible rather than something you would have to
  infer by comparing against a reference.

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

### Colour is never the only carrier

Under deuteranopia the two warm slots (1, vermilion, and 6, orange) converge, separated only by
about nine points of lightness. That is a real cost, and the mitigation is the only one that
actually works: **the criterion is printed in full beside every dot**, named in every result row's
hover card, and put in the row's `aria-label`. Colour here is a shortcut for something the reader
can always read; it is never the message.

WCAG 1.4.1 says the same thing, and it happens to be the right rule rather than a box to tick — the
eight-colour legend nobody can hold in their head is a usability problem long before it is an
accessibility one.

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

## Sequential — nine steps that mean "this much of it"

**Inferno**, from matplotlib — Nathaniel Smith and Stéfan van der Walt's set, presented at SciPy
2015 and designed with `viscm` against the CAM02-UCS perceptual space.

Chosen over viridis for the reason Greg's framing asks for: the axis he described is *hotness*, and
inferno is the blackbody ramp — dark, red, orange, yellow, white — so the cultural reading and the
perceptual one agree. Viridis is the choice for a quantity with no temperature in it and is worth
adding beside this the day one turns up.

### The property that actually matters is monotonic lightness

Every step is lighter than the one before it. That single property is what makes the ramp survive
greyscale printing, every dichromacy, and a bad projector, without any of them having to be thought
about — because lightness is the channel all three of those preserve.

It is also the property `jet` and every other rainbow ramp lacks, which is the whole of why they are
wrong for ordered data. A rainbow has bright bands in the middle (yellow, cyan) and dark ones at the
ends, so it **invents boundaries the data does not have** and hides differences it does. The case is
made in Borland and Taylor, *Rainbow Color Map (Still) Considered Harmful* (IEEE Computer Graphics
and Applications, 2007), and restated for a wider audience in Crameri, Shephard and Heron, *The
misuse of colour in science communication* (Nature Communications, 2020).

### Do not paint the bottom two stops on the page

`--heat-0` (`#000004`) and `--heat-1` (`#1b0c41`) are darker than `--background`, so a value near
zero would be drawn as a hole. Whatever uses this ramp should either start at `--heat-2` or paint it
on a lighter surface. Both dark stops are kept anyway, so that the ramp is the published one and can
be sampled correctly if it is ever drawn on white.

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

### The dark pivot, again

Both scales pivot on `#4f4f52`, a dark neutral a little above the page, with lightness climbing
toward both ends. See [The page is near-black](#the-page-is-near-black-so-every-published-scale-is-upside-down)
above — this is where that rule bites hardest, because getting it wrong does not look broken, it
looks like the middle of your data is the interesting part.

### Anchor the middle to zero, not to the data

Not a property of the palette but of whoever uses it, and the mistake is easy: with data running
from −2 to +9, putting the neutral colour at the *data* midpoint (+3.5) means every genuinely
neutral value is drawn in the "negative" colour. The pivot belongs at the value that means neither,
which is almost always zero, and the ends are then asymmetric — which is honest, and looks it.

## What is not decided

- **No `viridis`.** Wanted the moment something needs a sequential ramp with no temperature in it.
  One more block of nine stops when it happens.
- **Nothing checks these against a colour-blindness simulator in CI.** The right test is a render
  through a dichromacy transform with a minimum ΔE between every pair, and it does not exist. Today
  the check is a person looking at `/design`.
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
