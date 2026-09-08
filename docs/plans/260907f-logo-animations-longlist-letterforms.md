# Longlist: logo hover animations — the letterforms

One of eight parallel longlists generated on 2026-09-07 against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md). **My framing was: treat the ten
letters as the medium and the type itself as the material.** No sweeps, no glows, no scanner lines
passing over the top of the wordmark — every idea below has to come out of the letterforms
themselves, the spaces between them, the invisible horizontals they sit on, or a property that type
actually has. Where the other longlists get to light the word, this one can only ever move, weight,
slant, break, clip or re-space it. Nothing here is implemented, and a few of these are deliberately
silly.

## What the type actually is — five things I had to check first, and three of them bite

Read this before costing any idea below; four of the seventeen depend on it.

1. **The two copies of the wordmark are not in the same typeface.** `.logo-text`, the corner copy,
   sets `font-family: var(--font-brand)` — `'Trebuchet MS', sans-serif`
   ([styles/tokens.css § Wordmark](../../styles/tokens.css)), which is a **static** face and on this
   Linux box is not installed at all, so it falls through to the generic sans. The dock copy's
   wrapper is `.dock-btn-label`, which the brief already flags as deliberately not `.logo-text` — and
   which therefore sets **no font at all** and inherits `.dock { font-family: var(--font-ui) }`, i.e.
   **Geist Variable** ([src/web/styles/dock.css](../../src/web/styles/dock.css)). Same word, same
   0.82rem, same `--highlight`, two different faces. Nobody appears to have noticed.
2. **So exactly one copy has a live axis, and it is the wrong one.** Geist Variable ships `wght
   100 900` and a *separate real italic* face (`@fontsource-variable/geist/wght.css` and
   `wght-italic.css`, both imported in [tailwind.css](../../src/web/tailwind.css)). There is **no
   `slnt`, no `wdth`, no `opsz`** — one axis, plus a true italic. Trebuchet has none of it. Any
   weight-axis idea is therefore **dock-only today**, or costs one token edit
   (`--font-brand: 'Geist Variable', …`), which would incidentally make the two copies match.
3. **The copy that could afford a width change hasn't got the axis; the copy with the axis can't
   afford it.** `.logo-home` is `position: fixed` with `width: var(--logo-w)` (8.5rem = 136px) and
   `height: var(--bar-h)` (44px) — a fixed box, so anything happening inside it is invisible to page
   layout. `.dock-home` is a flex item in a row whose **fit ladder decides rungs by measuring
   whether the row overflows** ([dock-fit.css § the bar's fit ladder](../../src/web/styles/dock-fit.css)).
   That is the sharp edge behind the brief's "must not move the layout": a real advance-width change
   in the dock could in principle flip a rung *while you hover*, un-hiding or hiding labels
   elsewhere in the bar. **`transform` never affects layout**, so every translate/skew/scale idea
   below is free of this; only ideas 1 and 17, which change real metrics, carry it.
4. **The ten spans have already destroyed kerning.** Each `.logo-letter` is its own shaping run, so
   no pair in `Spideryarn` is kerned and no ligature can form. That kills "a ligature forms" as an
   idea outright — and hands us idea 7, which makes the damage the subject.
5. **`.logo-letter` is inline and needs `display: inline-block` for any transform.** Safe to add:
   the JSX emits the spans adjacently with no whitespace text nodes between them, so inline-block
   introduces no word-spaces. Set `transform-origin` deliberately on every one of these — `bottom`
   is what keeps the baseline still, and a letter that lifts off its baseline when it shouldn't is
   the difference between typography and a novelty.

**One markup change unlocks half this list, and it is two lines.** Several ideas want a per-letter
stagger, and CSS cannot compute a child's index. Today that means ten `:nth-child()` rules per
animation. Adding `style={{ "--i": i }}` to the span in both
[HomeLogo.tsx](../../src/web/HomeLogo.tsx) and `DockHome` in [Dock.tsx](../../src/web/Dock.tsx)
turns every stagger into one line — `animation-delay: calc(var(--i) * 40ms)` — and costs nothing to
anything else. **I'd recommend it before building any of these.** Indices below are 1-based and
`:nth-child()` works identically in both wrappers, because in both the letters are the wrapper's
only children:

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| `S` | `p` | `i` | `d` | `e` | `r` | `y` | `a` | `r` | `n` |

Ascender or cap: 1, 4 (and the tittle on 3). Descenders: 2, 7. Counters: 2, 4, 5, 8. The compound
seam falls between 6 and 7. Select as `.logo:hover .logo-letter:nth-child(n)` and
`.logo.long-press .logo-letter:nth-child(n)` — **on `.logo`, never on either wrapper**.

---

## The longlist

### 1. Weight Wave

**What the reader sees** — a swell of boldness travels along the word from `S` to `n`, each letter
thickening and thinning in turn like a pulse moving down a rope, so the word is never uniformly
weighted while you hover. It loops slowly, about one pass every 1.4s, and at any frozen instant it
just looks like a word with an odd emphasis rather than a word mid-animation.

**Why it belongs to this product** — weight is the one thing a typeface can do that a picture of a
typeface cannot, and a reading tool ought to know that.

**Mechanism** — `@keyframes wave { 0%,100% { font-variation-settings: 'wght' 450 } 50% { 'wght' 650 } }`
on `.logo:hover .logo-letter`, with `animation-delay: calc(var(--i) * 55ms)`. Animate
`font-variation-settings` and not `font-weight`: the former interpolates continuously, the latter
snaps between named instances on a static face. **Dock copy only today** — the corner copy has no
axis (see preamble 2). To get both, point `--font-brand` at `'Geist Variable'`, which is one line in
[styles/tokens.css](../../styles/tokens.css) and is arguably a fix rather than a cost.

**Cost** — Easy as dock-only (a dozen lines); Medium if the token change is in scope, because
changing the brand face is a design decision that wants Greg rather than a stylesheet.

**Risk** — this is the one idea whose glyph advances genuinely change, so in the dock's flex row a
600→650 excursion across ten letters is a pixel or two of real width against a fit ladder that
decides by measurement. Cap the excursion, and check whether the ladder re-measures on anything
other than resize before shipping it.

### 2. The Tittle Falls

**What the reader sees** — the dot over the `i` detaches, drops the height of the x-height onto the
baseline, sits there for a beat as a full stop, then springs back up and re-seats itself. Everything
else in the word is perfectly still; one 2px dot does the whole animation.

**Why it belongs to this product** — the smallest mark on the page turning out to be the one doing
something is the product's whole argument about reading closely.

**Mechanism** — CSS cannot address part of a glyph, so: mask the real tittle off the `i` with
`.logo:hover .logo-letter:nth-child(3) { mask-image: linear-gradient(to bottom, transparent 0 0.34em, #000 0.34em) }`,
and draw the travelling dot as that span's `::before` — `position: absolute; width: .16em;
height: .16em; border-radius: 50%; background: currentColor`, animated on `translateY` from `0` to
about `0.5em` with a `cubic-bezier` that overshoots slightly on the way back up. Needs
`position: relative; display: inline-block` on the span.

**Cost** — Medium.

**Risk** — the `0.34em` cut line is a guess about where a specific face puts its tittle, and there
are **three faces in play** (Trebuchet, the Linux fallback, Geist). Get it wrong by a hair and you
either clip the top of the stem or leave a crumb of the old dot behind. Verify in both copies on
both machines, or make the cut a custom property set per wrapper.

### 3. The Spider Takes the Dot

**What the reader sees** — the spider glyph to the left of the word slides right along the top of
the letters, and as it passes over the `i` the tittle is simply gone; the spider carries on to the
end of the word, then returns to its corner and the dot is back. Nothing is eaten on screen, it just
stops being there under the body.

**Why it belongs to this product** — it is the only idea in this list where the mark and the
wordmark are in the same story, and the name is a predator.

**Mechanism** — the same tittle mask as idea 2, but the mask's stop is animated rather than the dot:
`.logo:hover .logo-image { transform: translateX(…) }` on a 900ms keyframe, and the `i`'s
`mask-image` switches at the moment of crossing via a second keyframe whose `animation-delay` is
tuned to it. Two animations synchronised by delay, not by JS.

**Cost** — Medium.

**Risk** — the spider crossing the letters means it is *over* the type for 600ms, and a 20px opaque
image over 13px letters looks like an accident unless it rides above the ascender line rather than
through it. Also the two timings are coupled by hand, so a duration change breaks the joke silently.

### 4. Descenders Take Root

**What the reader sees** — the `p` and the `y`, the only two letters that hang below the line, grow
a hairline thread downward from their tails, which curls into a small hook and holds; when you leave,
the threads retract into the letters. Nothing above the baseline moves at all.

**Why it belongs to this product** — it finds the spider's legs already present in the word, rather
than drawing legs on top of it.

**Mechanism** — `::after` on `.logo:hover .logo-letter:nth-child(2)` and `:nth-child(7)`, absolutely
positioned at the descender terminal, `width: 1px; background: currentColor; transform-origin: top;
transform: scaleY(0)` animating to `scaleY(1)` over ~6px, the `y` delayed 120ms behind the `p` so
they are not synchronised. The hook is a `border-bottom-left-radius` on a slightly wider box, or a
second tiny `::before`.

**Cost** — Medium.

**Risk** — vertical room. The corner box is 44px and the baseline sits near its middle, so 6px is
comfortable there; in the dock the bar is the same height but the wordmark is vertically centred
against buttons, so a thread that clears its own box will be clipped by the bar. Keep it to 5px and
check the dock first, not second.

### 5. The Line Sags

**What the reader sees** — a hairline appears under the word, exactly on the baseline, and then
takes the letters' weight: the middle of the word settles a pixel or two below the ends, the line
bowing with it like a washing line, before both pull taut again and the line fades.

**Why it belongs to this product** — it reveals the baseline, which every reader has been using all
their life without ever seeing it.

**Mechanism** — `.logo { position: relative }` and a `.logo::after` hairline, `height: 1px;
background: var(--rule-strong)`, absolutely positioned at the baseline, with the bow drawn by
`transform: scaleY()` on a thin box plus a `border-radius`, or more honestly by an inline SVG
`<path>` with an animated `d`. The letters follow one shared keyframe sampled at different phases —
`animation-delay: calc(var(--i) * -60ms)` with a **negative** delay, which starts every letter at a
different point of the same sine rather than staggering ten copies. That trick is the whole idea and
is worth spelling out to whoever builds it.

**Cost** — Medium (Hard if the bow becomes an SVG path).

**Risk** — two pixels of sag at 13px is nearly invisible and four is a broken layout; the window
between "elegant" and "the wordmark is falling over" is narrow, and it will read differently in the
two faces because their baselines sit at different fractions of the box.

### 6. The Invisible Horizontals

**What the reader sees** — five faint hairlines fade in across the wordmark at the descender line,
baseline, x-height, cap height and ascender line, hold for half a second like a type specimen
diagram, and fade out; the word itself never moves. For a moment the logo is a lesson in how type is
built.

**Why it belongs to this product** — Spideryarn's entire pitch is showing you the structure that was
always in the text; this is that argument applied to the letters themselves.

**Mechanism** — one `.logo::before`, absolutely positioned over the word, painted with five stacked
`linear-gradient` background layers at `em`-derived offsets — you only get two pseudo-elements, so
multiple background layers rather than five elements is the move. Fade with `opacity` on a 1.2s
keyframe, `background-color: transparent`, colours from `var(--rule)` with the baseline in
`var(--rule-strong)` so it reads as the important one.

**Cost** — Medium.

**Risk** — the five offsets are metrics of a specific face, and we have three; get them from
`ex` units and `cap` where supported rather than hard-coding `em` fractions, or it will look
authoritative and be wrong.

### 7. Kerning Returns

**What the reader sees** — the word tightens. The letters slide by fractions of a pixel into the
positions a proper kerning table would have given them — the `y` tucking under nothing, the `r`
closing on the `y`, the `a` snugging up — so the word visibly becomes better-set while you look at
it, then relaxes back to its slightly loose resting state.

**Why it belongs to this product** — the ten spans really did break kerning (preamble 4), so this is
the logo briefly admitting a flaw and correcting it, which is a very Spideryarn kind of joke.

**Mechanism** — `transform: translateX()` per letter, **cumulative**: closing the `r`+`y` pair by
0.4px means letters 7–10 all move 0.4px, and closing `y`+`a` too means 8–10 move 0.9px. So ten
`:nth-child` rules with running totals, not per-pair values — this is the one idea where a
`--i`-based one-liner does not work. Never `letter-spacing`, which would change the box.
`transition: transform 400ms` on hover rather than a keyframe, so it settles and stays settled.

**Cost** — Easy (a dozen lines, all of them arithmetic).

**Risk** — sub-pixel translations at 13px land on device-pixel boundaries differently per zoom
level, so on some machines nothing appears to happen and on others one letter jumps. Also: the good
version of this ends with the *right* spacing, which raises the question of why the resting state is
wrong.

### 8. The Seam Opens

**What the reader sees** — the word splits where it is actually a compound, between `r` and `y`:
`spider` slides a few pixels left, `yarn` a few right, and a single thread of yarn stretches taut
across the gap between them before they close again and the thread goes slack and disappears.

**Why it belongs to this product** — it puts the animation exactly where the reader's eye already
finds a seam, which is the difference between an effect and an observation.

**Mechanism** — `.logo:hover .logo-letter:nth-child(-n+6) { transform: translateX(-3px) }` and
`:nth-child(n+7) { transform: translateX(3px) }`, both `transition: transform 300ms`, plus a
`.logo::after` 1px thread absolutely positioned over the seam with `transform: scaleX()` from 0 to 1
and `transform-origin: center`. Transform-only, so the box never changes.

**Cost** — Easy.

**Risk** — six pixels is a lot at this size; the word can read as broken rather than parted. And it
only lands for someone who already sees `spider`+`yarn` as two words, which is most people but not
all.

### 9. Counters Fill

**What the reader sees** — the enclosed holes in `p`, `d`, `e` and `a` fill with orange one after
the other, left to right, as if ink were pooling in them, and then drain back out in the same order.
The letters' outlines never move; only their interiors change state.

**Why it belongs to this product** — counters are the part of a letterform nobody consciously looks
at, and making them the subject is the most type-native thing on this list.

**Mechanism** — CSS cannot address a counter, so a per-letter `::after` disc positioned at the
counter's centre in `em`, `border-radius: 50%; background: var(--highlight)`, `transform: scale(0)`
→ `scale(1)`, on spans 2, 4, 5, 8 with 90ms delays between them. Four absolute positions, hand-tuned
per face. The honest alternative is an SVG trace of the four glyphs (Hard, and a second copy of the
mark to keep in sync — the brief's warning applies).

**Cost** — Medium as pseudo-elements; Hard as SVG.

**Risk** — this is the idea most likely to look like dirt. A counter at 0.82rem is two or three
pixels across, so the fill is a subpixel dot, and the honest finding is that **the right size for
this effect is larger than the counter is**. If it needs to overspill the letter to be visible, it
is no longer the idea.

### 10. Selected Text

**What the reader sees** — a selection block sweeps across the wordmark left to right at the speed
of a dragged cursor, each letter flipping to selected colours as the edge passes it and staying that
way; hold the pointer and the whole word sits selected, leave and it deselects from the left.

**Why it belongs to this product** — selecting a passage is the gesture this entire app is built
around — comments, quotes, questions all start there — so the logo demonstrating it is not decoration.

**Mechanism** — you cannot animate `::selection`, so fake it: an absolutely positioned
`.logo::before` in `var(--highlight-wash)` with `transform: scaleX()` from `transform-origin: left`,
sitting **behind** the letters (`z-index: -1` inside a `position: relative` `.logo`), and the letters
switching to `var(--highlight-ink)` via ten `:nth-child` rules with matched delays. Both tokens
already exist in [src/web/styles/tokens.css](../../src/web/styles/tokens.css).

**Cost** — Medium.

**Risk** — the wash and the letter-colour changes are two mechanisms that have to agree frame by
frame; if they drift by 30ms you get a letter that is dark on dark for two frames, which is the
`--accent` failure mode that dock.css already warns about. Also: a wash in the dock means
hovered-or-selected, so this may read as the wordmark becoming a mode.

### 11. Not In The Dictionary

**What the reader sees** — a wavy underline appears beneath `Spideryarn` exactly as a browser's
spellchecker would draw it, sits there accusingly for a beat, and then fades as though the word had
just been added to the dictionary; the letters do not move.

**Why it belongs to this product** — a made-up compound word admitting it is a made-up compound
word, in a tool for reading, is a good joke told in one gesture.

**Mechanism** — `text-decoration: underline wavy; text-decoration-thickness: 1px;
text-underline-offset: 3px` on `.logo:hover`, with `text-decoration-color` transitioning from
transparent. `text-decoration` is inherited into the spans and does not affect layout.

**Cost** — Easy.

**Risk** — the colour. A spellcheck squiggle that isn't red doesn't read as a spellcheck squiggle,
and **there is no red token in this palette** — I checked; the closest is `--highlight`, the brand
orange. A hard-coded red is a bug per the brief, so either this idea earns a `--danger` token or it
draws in `--highlight` and becomes a proofreader's mark rather than a spellchecker's, which is a
different and slightly weaker joke.

### 12. Bad Line Break

**What the reader sees** — the word breaks where a typesetter would break it: a hyphen appears after
`spider` and `yarn` drops to a second line beneath the `S`, so for a moment the logo is a badly
justified paragraph. Then `yarn` slides back up and the hyphen goes.

**Why it belongs to this product** — it is a joke that only works because the name is hyphenatable at
a real morpheme boundary, and the product is about how text is structured.

**Mechanism** — transform only, never an actual line break: `:nth-child(n+7)` gets
`transform: translate(-Xpx, 1.25em)` where X is the measured width of `spider`; the hyphen is a
`::after` on `:nth-child(6)` with `content: "-"` fading in. Vertical room: a second 13px line inside
a 44px box is affordable in the corner, marginal in the dock.

**Cost** — Medium (X has to be measured once per face and hard-coded, which is the ugly part).

**Risk** — it will look broken, because it is a picture of something broken. That is either the
whole charm or a support ticket, and I would not bet either way without showing it to someone.

### 13. Saccade Order

**What the reader sees** — each letter lifts a pixel and settles, but not left to right: the word
brightens in the order an eye actually lands on it — the capital first, then the tall `d`, then the
descenders, then the crowded middle last — so the flourish has a rhythm that feels oddly natural and
is hard to put your finger on.

**Why it belongs to this product** — this app exists because reading is not a uniform left-to-right
scan, and this is that fact made into a stagger.

**Mechanism** — pure `animation-delay`, one `:nth-child` rule each, in a non-monotonic order:
1 (0ms), 4 (60), 7 (110), 2 (150), 6 (190), 9 (210), 3 (240), 5 (260), 8 (280), 10 (300). Motion is a
`translateY(-1px)` and back on `transform-origin: bottom`. The delays are the entire idea; the motion
should be as small as it can be and still register.

**Cost** — Easy.

**Risk** — at 1px nobody sees it and at 3px it is a wave like every other wave; the order is doing
work that the amplitude will drown. Also, an eye does not really saccade within one short word, so
this is a poetic claim rather than a true one — fine for a logo, not for a doc.

### 14. It Leans

**What the reader sees** — the word tips into an italic, letter by letter from the left, as though
someone had begun writing it faster; the baselines stay exactly where they were, only the stems lean.
It straightens when you leave.

**Why it belongs to this product** — italic is the oldest way text has of changing its own voice
mid-sentence, and it costs nothing to say so.

**Mechanism** — two versions, and they are different animations. The cheap one:
`transform: skewX(-9deg); transform-origin: bottom` per letter, staggered — a **synthesised oblique**,
the letters unchanged in shape. The better one, dock-only: `font-style: italic` on hover, which loads
the real Geist Italic face already imported in [tailwind.css](../../src/web/tailwind.css) — and a
real italic is a *different set of letterforms* (a single-storey `a`, a different `e`), so the word
briefly changes shape rather than merely leaning. That second version is free and more interesting,
and it cannot be staggered, because a font swap is not interpolable.

**Cost** — Easy (either version).

**Risk** — the synthesised skew looks synthesised: stem weights distort and the round letters go
lopsided, which at 13px reads as blur rather than italic. The real-italic version changes advance
widths (a metrics risk in the dock's row, per preamble 3) and only exists on one of the two copies.

### 15. The r's Trade Places

**What the reader sees** — the word's two `r`s — the one in `spider` and the one in `yarn` — lift off
the baseline and arc over the top of the intervening letters in opposite directions, swapping
positions, then settle. Because they are identical, the word is unchanged when they land, and the
only evidence anything happened is the path they took.

**Why it belongs to this product** — a purely structural gag that only this word can tell, because
this word happens to contain the same letter twice at a useful distance.

**Mechanism** — `:nth-child(6)` and `:nth-child(9)` get mirrored keyframes: `translate(+Xpx, -8px)`
arcing over via a two-stop keyframe with an ease that flattens at the apex, X being the measured
distance between the two `r`s. `z-index` on the travelling pair so they pass over the letters
between. Transform-only, so the box is untouched.

**Cost** — Medium.

**Risk** — the punchline is that nothing changed, and an animation whose payoff is "no difference" is
one step from an animation that looks like it failed. The path has to be the show; if the arc is
small the two `r`s just twitch.

### 16. Knit From Both Ends

**What the reader sees** — on hover the letters do not appear left to right; `spider` and `yarn`
interleave, so the word assembles as `s-y-p-a-i-r-d-r-e-n`, each letter fading up and sliding a pixel
along the baseline into place. It reads as two threads being braided into one word.

**Why it belongs to this product** — the name is a braid of two words, and this is the only idea here
that animates the compound rather than merely acknowledging it.

**Mechanism** — `animation-delay` per `:nth-child`, interleaved: 1 (0ms), 7 (45), 2 (90), 8 (135),
3 (180), 9 (225), 4 (270), 10 (315), 5 (360), 6 (405). Each letter runs the same 200ms
`opacity: .35 → 1` plus `translateX(-2px) → 0`. **The resting state must be the finished word** —
never `opacity: 0` in the resting rule, or a reduced-motion reader gets a wordmark frozen at one
frame with letters missing, which is exactly the trap the brief names.

**Cost** — Easy.

**Risk** — with hover as the trigger, this replays every time the pointer crosses the logo, and a
word that reassembles itself on every pass gets old faster than anything else on this list. It wants
to be a rare pick, or to run once and stay put.

### 17. Small Caps, Briefly

**What the reader sees** — the nine lowercase letters rise to meet the cap height of the `S`, so the
wordmark reads for a moment as SPIDERYARN in small capitals, and then drops back to lowercase. The
baseline never moves; only the tops do.

**Why it belongs to this product** — the same word in two typographic registers, which is the sort of
thing you only notice if you have been paying attention to type.

**Mechanism** — the honest version is `font-variant-caps: all-small-caps` on `.logo:hover`, which is
**a font feature neither face reliably ships**, so the browser synthesises it by scaling the caps —
and a synthesised small cap has wrong stem weights, which is precisely the thing typographers
complain about. The fake version, `transform: scaleY(1.3); transform-origin: bottom` per letter, has
the same flaw more visibly and additionally distorts the round letters. Either way the advance widths
change under `font-variant-caps`, which is a dock metrics risk.

**Cost** — Easy to build, and the difficulty is entirely in whether it is worth building.

**Risk** — it will look like a bad small caps, because it will be a bad small caps. Listed because
the brief asked for the range, and because knowing *why* this one is bad is more useful than not
having tried it.

---

## Notes for whoever prioritises

- **Cheapest genuinely good ones**: 8 (The Seam Opens), 13 (Saccade Order), 7 (Kerning Returns), 11
  (Not In The Dictionary) — all Easy, all transform- or decoration-only, all safe at one frame.
- **Highest ceiling**: 2 (The Tittle Falls) and 6 (The Invisible Horizontals). Both are the kind of
  thing someone screenshots.
- **Do not build without deciding the font question first**: 1, 14, 17. And note that answering that
  question — pointing `--font-brand` at Geist Variable — would also end the situation where the two
  copies of the wordmark are set in different faces, which is worth raising with Greg regardless of
  whether any animation ships.
