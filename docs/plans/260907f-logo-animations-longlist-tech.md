# Longlist: hover animations for the wordmark — the mechanism-first lane

One of eight longlists generated on 2026-09-07 against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md); read that first for the DOM,
the constraints and the format. **My framing was the inverted one**: start from what the browser's
animation engine is uniquely good at, and only then ask what beautiful thing that particular
mechanism could do to a 20px spider and ten small letters. Every other lane started from meaning and
went hunting for a mechanism; this one went the other way, one technique at a time — `@property`,
`mask-composite`, `background-clip: text`, `clip-path`, SVG filters, `offset-path`,
`animation-composition`, `steps()`/`linear()`, 3D, WAAPI — asking of each *what can only this do
here?* The consequence is that a few of these are more interesting as machines than as pictures, and
one or two are here mostly to prove the mechanism does not pay. That is the point of the lane, and
the prioritisation pass should feel free to bin the ones whose meaning is thin.

## Before the list: six facts about this DOM that change what is buildable

These came out of reading the stylesheets rather than the brief, and several of them contradict or
sharpen it. They apply to most ideas below, so they are stated once here.

1. **`@property` may or may not survive the build, and the repo's own note says it does not.**
   [`src/web/styles/tokens.css` § `--bar-bottom`](../../src/web/styles/tokens.css) records an
   incident where "Vite's CSS transform **drops the `@property` rule and statically replaces every
   `var()` reference to it with its `initial-value`**" — a bar that could never move, from a
   stylesheet that looked right and errored nowhere. I could not reproduce that on 2026-09-07: both
   `lightningcss.transform()` and `@tailwindcss/node`'s `compile()` + `optimize()` over a test sheet
   kept the `@property` block intact (lightningcss additionally emits a `@supports`-guarded
   `*,::before,::after{--x:<initial>}` fallback for old Safari/Firefox, which is inert in browsers
   that have the feature). So the note may be stale, or the failure may have needed the layer nesting
   this repo does. **Every idea below marked `@property` must be spiked with a five-line sheet and
   checked in `npm run build` output before it is designed around** — and the bulletproof escape
   hatch, which needs no CSS build cooperation at all, is one line of TypeScript at module load:
   `CSS.registerProperty({ name: "--sy-angle", syntax: "<angle>", inherits: false, initialValue: "0deg" })`,
   inside a `try`. That is JS for *registration*, not for animation, which stays within the brief's
   "CSS-first".

2. **`.logo > span` is the selector that works in both DOMs.** The brief warns that the wrapper is
   `.logo-text` in one place and `.dock-btn-label` in the other and tells you to select on
   `.logo-letter`. That is right for per-letter work, but several mechanisms below
   (`background-clip: text`, `clip-path` across the whole word, `-webkit-text-stroke`) need **one box
   around all ten letters**. The `.logo-image` is an `<img>`, so `.logo > span` matches exactly the
   wrapper span and nothing else, in both components, without naming either class. Use it.

3. **The two copies of the wordmark are in different typefaces**, which the docs do not say anywhere.
   `.logo-text` sets `font-family: var(--font-brand)` — Trebuchet MS, **not a variable font**
   ([`styles/tokens.css`](../../styles/tokens.css) § wordmark). `.dock-btn-label` sets nothing and
   inherits `--font-ui` (Geist Variable, axis 100–900) from `.dock`. So **the variable weight axis
   the brief points at exists only on the dock copy**; on the corner copy an animated `font-weight`
   would get the browser's synthetic bolding, which is a smear, and would change advance widths and
   reflow the row. Every weight-axis idea is therefore dock-only or dead. Worth flagging to Greg as a
   consistency bug independent of this work.

4. **Dark only, unconditionally.** The brief says "light and dark themes both"; the codebase says
   otherwise — `color-scheme: dark`, no toggle, no `prefers-color-scheme`, Greg's call 2026-08-24
   ([design-css-overview.md § Colour](../project/design-css-overview.md#colour-one-source-dark-only)).
   That is a *simplification*, and it matters to this lane: additive/`plus-lighter` blend modes,
   glows and `screen` compositing all work on a near-black ground and would need rethinking on white.
   Use them freely; just do not write a hex.

5. **The word can be absent entirely.** `.logo-text` is `display: none` below 731px
   ([`narrow-window.css`](../../src/web/styles/narrow-window.css)), and `.dock-fit-3
   .dock-btn-label` is `display: none` at the bar's tightest rung
   ([`dock-fit.css`](../../src/web/styles/dock-fit.css)). Any letter-based animation must still read
   as *something* when the spider is alone, or must be one that the random picker simply does not
   offer when the word is hidden.

6. **Two mechanical traps in the box itself.**
   - `.logo` is `display: inline-flex`, so a `::before`/`::after` **becomes a flex item and moves the
     row**. Every pseudo-element below is `position: absolute`. `.logo-home` is `position: fixed` so
     it is already a containing block; `.dock-home` is statically positioned and needs
     `position: relative` added, which is layout-neutral.
   - `<img>` is a **replaced element and cannot have pseudo-elements**. Anything that recolours the
     spider needs a painted box overlaid on it and masked to the PNG's alpha, not a pseudo on the img.
   - Both `.logo-home:hover` and `.dock-home:hover` already run `opacity: 0.85 → 1` over `0.15s`. An
     animation that also writes `opacity` on `.logo` will fight it. Write opacity on the *children*
     or on a pseudo-element instead.

**And the one rule the motion guard imposes: never `animation-fill-mode: forwards`.** The global
guard flattens duration to `0.01ms` and iteration count to `1`; with the default `fill-mode: none`
the element snaps back to its base style, which is correct. With `forwards` it freezes at `100%`,
which is the "letter left rotated, mask left half-swept" failure the brief warns about. Every
keyframe set below is written so that `0%` and `100%` are both the resting state.

**On performance, once, for all of them.** The animated box is at most 120×44 CSS px and the spider
is 20×20. Filters, masks, `background-position` and `text-shadow` all repaint a region smaller than
a single tweet avatar, so **none of these is a 60fps problem on its own merits**. The three real
risks are named where they occur: (a) `filter: blur()` over *text* forces a glyph re-raster every
frame and also makes the text illegible, (b) `feTurbulence` regenerates noise per frame unless the
seed is held, and (c) the corner copy is `position: fixed`, so a permanently-`will-change`d filter
there can cost on every scroll — put `will-change` inside `:hover`, or leave it out.

---

## The longlist

### 1. Angle Turn

**What the reader sees.** A band of lighter orange rotates once around the spider, like a lamp
carried in a circle around it — the legs on the lit side brighten and dim in turn as it goes past.
The letters do not move at all.

**Why it belongs.** The mark is six legs radiating from a centre; a rotation is the only motion that
treats it as the radial object it is rather than as a rectangle.

**Mechanism.** The one effect that is *impossible* without a registered custom property, because a
`conic-gradient`'s `from` angle is not an interpolable value in an ordinary `@keyframes`.

```css
@property --sy-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }

.logo { position: relative; }               /* .dock-home only; .logo-home is already fixed */
.logo.anim-turn::after {
  content: ""; position: absolute; left: 0.7rem; top: 50%;   /* over the img */
  width: 20px; height: 20px; margin-top: -10px; pointer-events: none;
  background: conic-gradient(from var(--sy-angle),
    var(--highlight) 0turn, var(--highlight-ink) 0.18turn, var(--highlight) 0.42turn,
    var(--highlight) 1turn);
  -webkit-mask-image: url(/spideryarn-logo.png);
          mask-image: url(/spideryarn-logo.png);
  mask-size: 20px 20px; mask-repeat: no-repeat;
  animation: sy-turn 2.4s linear infinite;
}
@keyframes sy-turn { to { --sy-angle: 360deg; } }
```

The real `<img>` stays underneath and unchanged, so a browser that drops the whole pseudo-element
still shows a correct static spider. `left: 0.7rem` is `.logo-home`'s padding; the dock copy's is
`0.6rem` and tightens to `0.45rem` at rung 3, so this wants a `--logo-pad` token rather than three
magic numbers.

**Cost.** Medium.

**Risk.** `@property` (see fact 1). If it silently degrades, the angle is stuck at `0deg` and you get
a static two-tone spider that looks *deliberate* — which is the good kind of degradation, and also
the kind nobody notices is broken. Verify in the built stylesheet, not in the editor.

---

### 2. Silk Line

**What the reader sees.** A narrow band of pale, almost-white orange travels left to right *through
the letterforms themselves* — not over them, not behind them — so for a moment the S and the p are
lit and the rest of the word is not. It crosses in about a second and the word settles back.

**Why it belongs.** Reading is left-to-right and one thing at a time; a sheen that moves through the
word at reading speed is the app's own subject rendered as light.

**Mechanism.** `background-clip: text` on the wrapper span, with an animated `background-position`.
This repo already ships the static half of this on `.site-display`
([`site.css`](../../src/web/styles/site.css)) **including the two guards that make it safe**, and
they should be copied rather than rediscovered: the `@supports` names *both* spellings, and a plain
`color` sits above it, because a browser that takes `-webkit-text-fill-color: transparent` and not
the clip paints **nothing at all**.

```css
@supports ((background-clip: text) or (-webkit-background-clip: text)) {
  .logo.anim-silk > span {
    background-image: linear-gradient(100deg,
      var(--highlight) 0%, var(--highlight) 38%,
      var(--highlight-ink) 50%, var(--highlight) 62%, var(--highlight) 100%);
    background-size: 300% 100%;
    background-position: 100% 0;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: sy-silk 1.6s ease-in-out infinite;
  }
}
@keyframes sy-silk { 0%, 100% { background-position: 100% 0; } 50% { background-position: -60% 0; } }
```

`background-position` is a length/percentage pair, so it interpolates in a plain keyframe — **no
`@property` needed**, which is why this is the safest member of the whole family.

**Cost.** Easy.

**Risk.** The trap `site.css` documents in capitals: the background box is the **whole span**, so on
a short word the interesting stops can land on empty space and never appear. Ten letters at 0.82rem
is about 62px of box — check the stops against a screenshot, not against a swatch. Second risk: at
this size the sheen band must be wide relative to the word or it reads as a flicker.

---

### 3. Thread Thickens

**What the reader sees.** The spider's yarn swells — every stroke gets perceptibly fatter, the loops
of the body close up towards each other, and then it thins back down. Nothing translates or rotates;
the shape itself breathes.

**Why it belongs.** It is the one motion that says *this is made of thread* rather than *this is a
picture of a spider*, because only something with a stroke width can gain one.

**Mechanism.** `<feMorphology operator="dilate">` in an inline SVG filter, applied to the bitmap
with `filter: url(#sy-fat)`. **No CSS property fattens a shape** — `stroke-width` needs vector
geometry we do not have, and `blur` softens rather than thickens — so this is genuinely unreachable
except through an SVG filter, and it works on the existing PNG with no trace.

```html
<!-- once, in App.tsx: an inline <svg width="0" height="0" aria-hidden> -->
<filter id="sy-fat" x="-30%" y="-30%" width="160%" height="160%">
  <feMorphology operator="dilate" radius="0">
    <animate attributeName="radius" values="0;9;0" dur="1.8s" repeatCount="indefinite"/>
  </feMorphology>
</filter>
```

```css
.logo.anim-thick .logo-image { filter: url(#sy-fat); }
```

`radius` is in the *source image's* pixels — the PNG is 1203×1272 and drawn at 20px, so a radius of
9 is roughly a sixth of a drawn pixel of growth; the useful range needs measuring. **`radius` cannot
be driven from CSS**, which is why this uses SMIL `<animate>`; the alternative is defining four
static filters and swapping `filter:` between them with `steps(4)`, which is uglier and jumps.

**Cost.** Hard (new shared markup for the filter, and SMIL).

**Risk.** SMIL runs whether or not the pointer is there — it is not gated by `:hover` and the motion
guard **does not touch it**, because the guard flattens CSS `animation-duration` and SMIL is not a
CSS animation. That is a real accessibility hole, not a nitpick: it needs
`begin="…mouseenter"`/`end="…mouseleave"` on the `<animate>`, or the filter swapped in by class and
the SMIL element only mounted while hovered. Say so in the plan or it will ship unguarded.

---

### 4. Draught Ripple

**What the reader sees.** The spider ripples as though a web it is sitting on has caught a draught —
the legs wave slightly out of phase with each other, the body wobbles, and nothing anywhere is a
straight line for a second and a half.

**Why it belongs.** A web moves in air; a spider on it moves with the web. It is the only idea here
that makes the mark feel like a physical object rather than a graphic.

**Mechanism.** `<feTurbulence>` generating fractal noise, fed as the displacement map to
`<feDisplacementMap>`, animated by moving the noise field rather than regenerating it:

```html
<filter id="sy-wob" x="-20%" y="-20%" width="140%" height="140%">
  <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" result="n">
    <animate attributeName="baseFrequency" values="0.02;0.035;0.02" dur="1.5s" repeatCount="indefinite"/>
  </feTurbulence>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="18" xChannelSelector="R" yChannelSelector="G"/>
</filter>
```

**Cost.** Hard (same shared-markup and SMIL cost as #3).

**Risk.** Two, and the first is the one people get wrong. **Animating `baseFrequency` regenerates
the entire noise field every frame**, which is the expensive part of `feTurbulence` — at a 24×24
filter region that is still trivially cheap, but the same filter on the *word* would not be, so keep
it on `.logo-image`. Second: `scale` is in device pixels and a value tuned on a 20px mark is wildly
wrong at 2× DPR in some engines; test on both. Third: the same unguarded-SMIL problem as #3.

---

### 5. Unravel

**What the reader sees.** The spider begins to come apart from the outside in — a soft edge eats
inwards along the legs until only the knot of the body is left, holds for a beat, and then the legs
come back. It looks like wool being pulled off a shape.

**Why it belongs.** The product's name is a spider *made of yarn*, and yarn's one property no other
material has is that it unravels back into a single thread.

**Mechanism.** Two mask layers on the overlay box composited against each other — the technique
`mask-composite` exists for and that no gradient or `clip-path` can imitate, because it needs the
*intersection* of an arbitrary alpha silhouette and a moving soft-edged shape.

```css
.logo.anim-unravel::after {
  content: ""; position: absolute; /* geometry as #1 */
  background: var(--highlight);
  -webkit-mask-image: url(/spideryarn-logo.png), radial-gradient(circle at 50% 50%, #000 0 40%, transparent 72%);
          mask-image: url(/spideryarn-logo.png), radial-gradient(circle at 50% 50%, #000 0 40%, transparent 72%);
  mask-size: 20px 20px, 200% 200%;
  mask-position: 0 0, center;
  mask-composite: intersect;               /* -webkit-mask-composite: source-in */
  animation: sy-unravel 2s ease-in-out infinite;
}
@keyframes sy-unravel {
  0%, 100% { mask-size: 20px 20px, 400% 400%; }
  50%      { mask-size: 20px 20px, 90% 90%; }
}
.logo.anim-unravel .logo-image { opacity: 0; }   /* the overlay IS the spider here */
```

**Cost.** Medium.

**Risk.** `mask-composite` and unprefixed `mask-image` are Chrome 120+ / Safari 15.4+ / Firefox 53+;
older WebKit needs `-webkit-mask-composite`, whose **keyword vocabulary is different**
(`source-in`, not `intersect`) — so both spellings are required and they are not synonyms. If the
composite is dropped the last mask layer wins, which here is the radial, so you get an orange circle
where the spider was: **that degradation is ugly, not neutral**, and it is the one idea in this list
that needs an `@supports (mask-composite: intersect)` guard around the whole thing including the
`opacity: 0`.

---

### 6. Iris From Centre

**What the reader sees.** A circle opens outwards from the spider's body and passes over the ten
letters, and inside the circle the word is a paler, hotter orange than outside it. The boundary is
hard-edged, like a spotlight with no falloff.

**Why it belongs.** It puts the spider at the origin of the word — the mark is the source and the
name radiates out of it.

**Mechanism.** `clip-path: circle()` on a duplicated, differently-coloured copy of the word. A
gradient cannot do a hard circular edge with a *different colour inside and out* while keeping the
text crisp; `clip-path` can, and it interpolates a `circle()` radius natively.

```css
.logo.anim-iris > span { position: relative; }
.logo.anim-iris > span::after {
  content: "Spideryarn"; position: absolute; inset: 0;
  color: var(--highlight-ink); pointer-events: none;
  clip-path: circle(0% at -18px 50%);          /* the spider's centre, in span coords */
  animation: sy-iris 1.9s ease-out infinite;
}
@keyframes sy-iris { 0% { clip-path: circle(0% at -18px 50%); } 70%, 100% { clip-path: circle(220% at -18px 50%); } }
```

**Cost.** Medium.

**Risk.** The `content: "Spideryarn"` duplicate is **the whole risk**: it is a hard-coded string in
CSS that must not drift from the JSX, it may be picked up by a screen reader in some engines (add
`aria-hidden` semantics by keeping it a pseudo — pseudos are generally not exposed, but
`content` strings have been read historically), and it is text selectable in Firefox. The
alternative — clipping the *real* span and stacking a second real span in JSX — costs markup but
removes all three. `-18px` also assumes the gap, so it wants a token.

---

### 7. Shutter Read

**What the reader sees.** A block of colour jumps from letter to letter — S, then p, then i —
snapping instantly to each rather than sliding, at about five letters a second, then vanishing at
the n and starting again from the S. It reads as something *scanning*, not as something *moving*.

**Why it belongs.** The pipeline processes a document block by block, discretely; this is the only
easing in CSS that can say "discrete" rather than "smooth".

**Mechanism.** `steps()` is the point. A masked overlay whose `mask-position` is stepped, so the
in-between positions never render:

```css
.logo.anim-shutter > span { position: relative; }
.logo.anim-shutter > span::before {
  content: ""; position: absolute; inset: -2px -1px;
  background: var(--highlight-wash);
  clip-path: inset(0 90% 0 0);
  animation: sy-shutter 2s steps(10, jump-none) infinite;
  z-index: -1;
}
@keyframes sy-shutter { to { clip-path: inset(0 0 0 90%); } }
```

`steps(10, jump-none)` is exact: ten letters, ten held positions, first and last both shown.
`jump-none` rather than the default `jump-end` is the difference between landing on the n and
skipping it.

**Cost.** Easy.

**Risk.** Letters are **not equal width** — the i and the r are half the S — so a ten-step
equal-width sweep lands mid-glyph most of the time and looks like a bug rather than a rhythm. The
honest fixes are per-letter `animation-delay` on the letters themselves (#8) or a monospace-only
variant; the equal-step version should be prototyped before it is planned.

---

### 8. Ten Delays

**What the reader sees.** The letters lift and drop one after another, left to right, each
overshooting slightly at the top before settling — a wave passing through the word about twice a
second, three or four letters up at any moment.

**Why it belongs.** Ten letters given ten slightly different times is the smallest possible statement
that a piece of text is made of parts, which is what granularity zoom is about.

**Mechanism.** One keyframe set, ten delays, and `linear()` doing what would otherwise take eight
keyframes:

```css
.logo.anim-wave .logo-letter {
  display: inline-block;                    /* the brief's point: they are inline today */
  animation: sy-hop 1.1s infinite;
  animation-timing-function: linear(0, 0.45 18%, 1.06 42%, 0.98 55%, 1 70%, 1);
  animation-delay: calc(sibling-index() * -0.06s);   /* modern; see risk */
}
@keyframes sy-hop { 0%, 45%, 100% { transform: none; } 22% { transform: translateY(-2px); } }
```

The **negative** delay is what makes it a standing wave rather than ten animations that start
staggered and then drift; every letter is at a different point of the *same* cycle from frame one.
`linear(…)` expresses the overshoot-and-settle in one declaration, which is exactly what it was
added to CSS for.

**Cost.** Easy (Medium if you write the fallback delays out).

**Risk.** `sibling-index()` is Chrome 138+ and not yet everywhere; where it is missing the whole
`animation-delay` declaration is invalid and **all ten letters move together**, which looks like a
different, worse animation rather than like nothing. Write the ten `:nth-child()` rules instead —
they are ten lines, they are boring, and they work in every browser. Second risk: `translateY(-2px)`
inside a 44px box is safe, but anything above ~4px starts clipping against the dock's frame.

---

### 9. Gooey Yarn

**What the reader sees.** As the animation starts, the spider and the S stretch towards each other,
bulge, and fuse into one blob with a smooth waist — then separate again with the surface tension of
a drip coming off a tap. Nothing has a hard edge for about half of it.

**Why it belongs.** Two things joined by a thread, behaving like one thing; it is the only idea here
where the spider and the word are physically connected rather than merely adjacent.

**Mechanism.** The gooey filter, and **the pure-CSS `blur` + `contrast()` version does not work
here** — that trick needs opaque shapes on an opaque background, because `contrast()` acts on colour
channels, and our mark is an alpha silhouette on transparency. The version that works on
transparency operates on the alpha channel:

```html
<filter id="sy-goo">
  <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b"/>
  <feColorMatrix in="b" mode="matrix"
     values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="g"/>
  <feComposite in="SourceGraphic" in2="g" operator="atop"/>
</filter>
```

```css
.logo.anim-goo { filter: url(#sy-goo); }
.logo.anim-goo .logo-image { animation: sy-lean 1.6s ease-in-out infinite; }
.logo.anim-goo .logo-letter:first-child { display: inline-block; animation: sy-lean-back 1.6s ease-in-out infinite; }
@keyframes sy-lean      { 0%,100% { transform: none } 50% { transform: translateX(3px) scale(1.06) } }
@keyframes sy-lean-back { 0%,100% { transform: none } 50% { transform: translateX(-3px) } }
```

The `20 / -9` in the last row of the colour matrix is the alpha ramp: it takes the blurred alpha,
multiplies it hard and biases it down, so mid-alpha becomes either 0 or 1 and the blurred edges snap
back to a hard boundary — which is what makes two blurs that overlap read as one connected shape.

**Cost.** Hard.

**Risk.** The filter is on `.logo`, so it blurs the **letters** too — and blurred 10px text is
unreadable mush, plus a per-frame glyph re-raster. It has to be scoped: put the goo filter on a
wrapper that contains only the img and the first letter, which means new markup, or accept the effect
on the spider alone (which loses most of the charm). This is the idea most likely to be beautiful in
a prototype and unshippable in the real DOM, and it should be prototyped before it is planned.

---

### 10. Out Of Register

**What the reader sees.** Each letter briefly splits into a cool blue ghost and a warm orange ghost
offset a pixel either side, as though a print run were misaligned — and then the two slide back
together and lock into one crisp word.

**Why it belongs.** Two readings of the same text, briefly out of register and then agreeing: the
article and the model's gloss, which is the whole shape of this product.

**Mechanism.** `text-shadow` takes an arbitrary list of offsets and colours, and the whole list
interpolates in a keyframe as long as it stays the same length — the only property that lets you
animate *several* coloured copies of text at once without duplicating a single element.

```css
.logo.anim-register .logo-letter {
  animation: sy-reg 1.4s cubic-bezier(.2,.8,.2,1) infinite;
  animation-delay: calc(sibling-index() * -0.05s);
}
@keyframes sy-reg {
  0%, 100% { text-shadow: 0 0 0 var(--chat-mark), 0 0 0 var(--highlight-ink); }
  35%      { text-shadow: -1.5px 0 0 var(--chat-mark), 1.5px 0 0 var(--highlight-ink); }
}
```

`--chat-mark` is the existing cool blue and `--highlight-ink` the lifted orange, so it stays inside
the palette. Using zero-offset shadows at rest rather than `none` is what keeps the list
interpolable — `text-shadow: none` and a list do not interpolate, they swap.

**Cost.** Easy.

**Risk.** This is one notch away from looking like a broken monitor or a 2014 glitch-art trend, and
the difference is entirely the *amplitude* and the *settle*. Above about 2px it is cheap; without a
clean lock at the end it is annoying. Also, `--chat-mark` means "a chat's mark" everywhere else in
the app, so borrowing it here is a small semantic theft worth declaring.

---

### 11. Hollow Fill

**What the reader sees.** The ten letters empty out into thin orange outlines — you can see the page
through them — and then the colour floods back in from left to right, letter by letter, until the
word is solid again.

**Why it belongs.** This app already draws quotes in the prose as an *outline* rather than a fill —
"search hits fill; quotes outline"
([quotes.md § The stroke](../project/quotes.md#the-stroke-which-is-how-a-quote-says-how-much-it-matters))
— so hollow-then-filled is already part of its visual vocabulary, and reusing it here costs the
reader nothing to read.

**Mechanism.** `-webkit-text-stroke` plus a transparent fill. Nothing else in CSS gives text an
outline that is *inside the glyph's own metrics*, so no layout moves:

```css
.logo.anim-hollow .logo-letter {
  -webkit-text-stroke: 0.5px var(--highlight);
  animation: sy-hollow 1.8s ease-in-out infinite;
  animation-delay: calc(sibling-index() * -0.07s);
}
@keyframes sy-hollow {
  0%, 100% { color: var(--highlight); }
  40%      { color: transparent; }
}
```

**Cost.** Easy.

**Risk.** At 0.82rem Trebuchet a 0.5px stroke already closes the counters of the **e**, the **a** and
the **r**, and a 1px stroke turns them into blobs — the effect will look far better in a mockup at
3rem than it does at the real size. Test at the real size first. `text-stroke` unprefixed does not
exist; `-webkit-text-stroke` is universally implemented and is not going anywhere, but it is
formally non-standard, so a lint or a reviewer will flag it.

---

### 12. Both At Once

**What the reader sees.** The whole wordmark sways gently as one object, like a sign in a breeze —
and *at the same time* each letter jitters a few tenths of a pixel on its own, faster. Two rhythms,
one slow and one fast, visibly independent of each other.

**Why it belongs.** The whole and its parts moving at different rates *is* granularity zoom, rendered
as motion instead of as a tree.

**Mechanism.** `animation-composition: add`, which is the only way two `@keyframes` can both write
`transform` on the same element and have the results **sum** rather than the later one replacing the
earlier. Without it you have to hand-compose the two motions into one keyframe set, which stops being
possible the moment their periods are not a simple ratio.

```css
.logo.anim-both .logo-letter {
  display: inline-block;
  animation: sy-sway 2.7s ease-in-out infinite, sy-jit 0.38s ease-in-out infinite;
  animation-composition: add;
  animation-delay: calc(sibling-index() * -0.11s), calc(sibling-index() * -0.03s);
}
@keyframes sy-sway { 0%,100% { transform: rotate(-0.8deg) } 50% { transform: rotate(0.8deg) } }
@keyframes sy-jit  { 0%,100% { transform: translateY(0) }   50% { transform: translateY(-0.6px) } }
```

Because the two periods are 2.7s and 0.38s — not a whole-number ratio — the combined motion does not
repeat for over a minute, which is exactly what the brief's "still look right after ten seconds"
asks for.

**Cost.** Easy.

**Risk.** `animation-composition` is Chrome 112 / Safari 16 / Firefox 115 — good coverage, and where
it is missing the value falls back to `replace`, so **the last animation in the list wins**. That
means the ordering above is load-bearing in a way nothing signals: without support you get the jitter
alone, which is the worse half. Put the sway last if the degraded state should be the sway.

---

### 13. Crawling Dot

**What the reader sees.** A single small orange dot detaches from the spider, travels a curved path
that arcs up over the top of the word and comes down at the n, then fades. It leans into the curve as
it goes, the way a thing being dragged along a thread would.

**Why it belongs.** A thread is a *path*, and this is the only mechanism that makes something follow
one. It draws the yarn without drawing yarn.

**Mechanism.** `offset-path` and `offset-distance` on an ordinary absolutely-positioned pseudo — no
SVG, no JS, and `offset-rotate: auto` handles the leaning for free.

```css
@supports (offset-path: path("M0 0 L1 1")) {
  .logo.anim-crawl::after {
    content: ""; position: absolute; left: 0; top: 0;
    width: 3px; height: 3px; border-radius: 50%; background: var(--highlight-ink);
    offset-path: path("M 26 22 C 50 -2, 78 -2, 104 20");
    offset-rotate: auto;
    offset-distance: 0%;
    animation: sy-crawl 1.9s cubic-bezier(.45,0,.55,1) infinite;
  }
}
@keyframes sy-crawl {
  0%   { offset-distance: 0%;   opacity: 0 }
  12%  { opacity: 1 }
  88%  { opacity: 1 }
  100% { offset-distance: 100%; opacity: 0 }
}
```

**Cost.** Medium.

**Risk.** **The path is hard-coded in the element's own pixel coordinates**, and the two copies of the
wordmark are different widths — the dock's `.dock-home` narrows at fit rungs 1–3 and loses its word
entirely at rung 3, at which point the curve arcs over empty bar. Either scope this to `.logo-home`
and say so, or express the path in `%`-friendly terms (`ray()` cannot do this; `shape()` can, and is
newer and patchier). Without `offset-path` the `@supports` block drops entirely and there is simply
no dot, which is a clean degradation.

---

### 14. Six Legs

**What the reader sees.** The spider draws itself: a single line starts somewhere in the knot of the
body, traces round the loops and then out along each leg in turn, as though a pen were following the
yarn — about a second and a half from nothing to the whole mark.

**Why it belongs.** The mark is *one continuous stroke of yarn*, and self-drawing is the only
technique that shows you it is continuous rather than telling you.

**Mechanism.** The classic `stroke-dasharray` / `stroke-dashoffset` reveal, which needs the SVG trace
the brief flags as optional. `pathLength="1"` is the detail that makes it maintainable: it
renormalises every subpath to a length of 1 regardless of its real geometry, so the CSS is
`stroke-dasharray: 1; stroke-dashoffset: 1 → 0` for every leg with no per-leg measuring, and
per-leg staggering becomes six `animation-delay`s rather than six hand-computed lengths.

```css
.logo.anim-draw .sy-svg path {
  stroke: var(--highlight); fill: none; stroke-linecap: round;
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: sy-draw 1.5s ease-out infinite;
}
@keyframes sy-draw { 0% { stroke-dashoffset: 1 } 55%, 100% { stroke-dashoffset: 0 } }
```

**Cost.** Hard — a tracing pass, and a second copy of the mark to keep in sync with the PNG. But note
what else the trace unlocks, because the cost is amortised across a lot of this list: per-leg motion,
`feMorphology` on real geometry, a `<path>` for #13's `offset-path`, and a mark that is sharp at any
size.

**Risk.** Two copies of a logo diverge — that is a certainty over a year, not a risk. And the resting
state is the trap the brief warns about: with the guard flattening this to one 0.01ms iteration and
`fill-mode: none`, the element reverts to its base style, so **the base style must be
`stroke-dashoffset: 0`** and the animation must run `0 → 1 → 0`, not `1 → 0`. Written the obvious way
round, a reduced-motion reader gets an invisible logo.

---

### 15. Warm Drift

**What the reader sees.** Almost nothing: the spider's orange drifts a few degrees warmer and back,
and a very soft glow the shape of its legs breathes in and out around it. You would not be able to
describe it afterwards, only notice the corner felt alive.

**Why it belongs.** The brief asks for a range down to barely-there, and this is the bottom of it —
the version that could be the default without ever becoming tiresome.

**Mechanism.** Two filters on the img alone, and `drop-shadow` rather than `box-shadow` is the whole
point: it follows the PNG's **alpha**, so the glow is leg-shaped rather than a 20px square.

```css
.logo.anim-warm .logo-image {
  animation: sy-warm 3.2s ease-in-out infinite;
}
@keyframes sy-warm {
  0%, 100% { filter: hue-rotate(0deg) drop-shadow(0 0 0 transparent); }
  50%      { filter: hue-rotate(-10deg) drop-shadow(0 0 3px color-mix(in oklab, var(--highlight) 60%, transparent)); }
}
```

**Cost.** Easy.

**Risk.** `hue-rotate()` is a **linear-RGB matrix approximation, not a real hue rotation** — it
drags saturation and lightness with it, and the orange goes muddy-brown or pink surprisingly fast.
Keep it inside ±12deg and check against the swatch on `/design`. The glow needs to stay under ~4px or
it becomes the "warm glow pulse" the previous app already had and the brief warns against re-listing.

---

### 16. Edge On

**What the reader sees.** Each letter turns on its own vertical axis, one after another down the
word, going edge-on and momentarily invisible before coming back round to face you — a row of small
flip-boards.

**Why it belongs.** The same text seen from another angle is the app's central move; every mode is a
different face of one article.

**Mechanism.** 3D, which needs the perspective on the ancestor and `preserve-3d` to survive nesting:

```css
.logo.anim-flip > span { perspective: 320px; transform-style: preserve-3d; }
.logo.anim-flip .logo-letter {
  display: inline-block; backface-visibility: visible;
  animation: sy-flip 2.2s cubic-bezier(.5,0,.5,1) infinite;
  animation-delay: calc(sibling-index() * -0.09s);
}
@keyframes sy-flip { 0%, 55%, 100% { transform: rotateY(0) } 27% { transform: rotateY(180deg) } }
```

**Cost.** Medium — Hard if it needs a *different* back face. The obvious back face is the gist of the
word, but there is nothing per-letter to show and `content: attr(data-ch)` would mean adding a
`data-ch` to each span in both components. Without a back face the letters simply read mirrored for
half the turn, which is fine at this size and half a beat.

**Risk.** Ten letters each on their own `perspective`-free 3D context is the classic way to get a
row of letters that appear to rotate around *ten different vanishing points* — the perspective must
be on the shared parent, as above, or it looks wrong in a way that is hard to name. Also, 3D
transforms promote each letter to its own compositor layer; ten tiny layers is nothing, but do not
extend the technique to the prose.

---

### 17. First Letter Lit

**What the reader sees.** Only the capital S changes: it warms to a paler orange and picks up a small
halo, holds, and cools again. The other nine letters and the spider are completely still.

**Why it belongs.** The S is the letter the spider sits against, and lighting exactly one thing is
the most restrained statement the corner could make.

**Mechanism.** `::first-letter`, and the interesting part is the **restriction**: it accepts only a
short property list — font properties, `color`, `background`, `text-shadow`, `text-decoration`,
margins, padding, border, `line-height`, `vertical-align`, `float`, `text-transform`. **`transform`
is not on it and will silently do nothing**, which is the trap; so this idea is colour and shadow or
it is not this idea. It also needs a block container:

```css
.logo.anim-first > span { display: inline-block; }   /* ::first-letter needs a block box */
.logo.anim-first > span::first-letter {
  animation: sy-first 2.4s ease-in-out infinite;
}
@keyframes sy-first {
  0%, 100% { color: var(--highlight); text-shadow: none; }
  50%      { color: var(--highlight-ink); text-shadow: 0 0 4px color-mix(in oklab, var(--highlight) 50%, transparent); }
}
```

**Cost.** Easy.

**Risk.** `display: inline-block` on the wrapper is a real change to a box that lives in two
different flex rows — it should be layout-neutral here, but "should" is doing work, and the dock's
fit ladder is sensitive to that row's measurement. Check both. Second: `@keyframes` on
`::first-letter` is legal but under-tested across engines; if it does nothing, nothing happens, which
is at least a safe failure.

---

### 18. Never Twice

**What the reader sees.** Whatever animation was picked, it is *never quite the same twice* — the
letters bob in a different order, the sweep comes from a slightly different angle, the timing is a
touch different. Hover ten times and you get ten variations, not ten repeats.

**Why it belongs.** Greg asked for a *random* animation per hover; this makes the randomness go one
level deeper than the picker, for nearly free.

**Mechanism.** This is the one place JS genuinely buys something CSS cannot reach, and it is worth
saying exactly what. **CSS keyframes are static text**: a stagger written as `-0.06s × index` is the
same stagger every time. WAAPI's `element.animate()` takes the keyframes as *data*, so the delays,
the amplitude and the direction can be generated per hover:

```ts
for (const [i, el] of letters.entries()) {
  el.animate(
    [{ transform: "none" }, { transform: `translateY(${-1 - Math.random() * 2}px)` }, { transform: "none" }],
    { duration: 900 + Math.random() * 400, delay: -Math.random() * 900, iterations: Infinity,
      easing: "cubic-bezier(.3,.8,.3,1)" },
  );
}
```

The cheaper half of the same idea, and the one to try first, stays in CSS: set the per-letter
`--sy-i`, `--sy-amp` and `--sy-dur` as **inline custom properties from JS** and let the CSS keyframes
read them. That keeps every animation in the stylesheet where it can be read, and confines the JS to
"pick numbers", which is the same job the picker is already doing.

**Cost.** Hard (JS in the hover path, and it must be torn down on `mouseleave` or the animations
leak).

**Risk.** **WAAPI animations are not covered by the global motion guard.** The guard is a CSS rule
that flattens `animation-duration`; an animation created by `element.animate()` never reads it. Any
WAAPI path must check `matchMedia("(prefers-reduced-motion: reduce)").matches` itself — and that is
a second implementation of a rule the codebase has deliberately kept in one place, which is a real
argument for the inline-custom-property variant over the full WAAPI one.

---

## Mechanisms I worked through and would not use

Listed because the lane's job is to cover the space, and a checked "no" is worth as much as a "yes".

- **`filter: blur()` + `contrast()` gooey (the pure-CSS version).** Does not work on an alpha
  silhouette over a transparent ground; it needs opaque shapes on an opaque backdrop. See #9 for the
  version that does work.
- **CSS counters.** `counter()` values are integers resolved at layout and are **not animatable** —
  there is no interpolation and no `steps()` hook. A ticking counter needs a strip of digits
  translated under `overflow: hidden`, which is a lot of markup for a joke.
- **`::selection`.** Not an animation surface at all — it has no `@keyframes` path and only paints
  while text is selected, which is approximately never on a wordmark. Worth *one static rule* so a
  selected wordmark is orange-on-dark rather than the browser's blue, but that is a polish task, not
  an idea.
- **`backdrop-filter`.** There is nothing behind the wordmark in either position — the corner is
  structurally empty and the dock is an opaque bar. It would cost a compositor layer to blur a flat
  colour.
- **`animation-timeline: scroll()` / `view()`.** The repo already uses `scroll()` well on
  `.site-nav`, but the trigger here is hover, and there is no timeline for "how long the pointer has
  rested". (`view()` on the dock as the page scrolls is a *different, interesting* idea, and it is
  not this brief.)
- **`@starting-style` + `transition-behavior: allow-discrete`.** Right tool for an element appearing;
  wrong shape for a loop that runs while a pointer rests. Would matter if an idea needed a
  pseudo-element to go from `display: none`.
- **Canvas + `requestAnimationFrame`.** A real yarn simulation — a hanging catenary, legs with
  inertia — is the one thing on this whole list that CSS cannot express in any form, and it is still
  not worth it: a 20×20 canvas plus an rAF loop plus a DPR-aware resize plus its own reduced-motion
  check, permanently mounted in the corner of every signed-in page, to render something the reader
  looks at for 400ms. Say no here so nobody has to say no later.
- **The variable weight axis.** Only reachable on the dock copy (fact 3), and animating `font-weight`
  changes advance widths, which the brief forbids outright. It would need
  `font-variation-settings: "wght" …` on an element with a fixed inline size — possible, but the
  payoff at 0.82rem is a barely-visible thickening that #3 does better on the spider.

## The cheapest three, if only three get built

`#2 Silk Line`, `#8 Ten Delays`, `#15 Warm Drift`. All Easy, none needs `@property`, new markup, an
SVG trace or JS, all three are safe at one frame, and between them they cover the letters, the
per-part stagger and the mark — which is the whole surface. Everything else in this list is an
argument for spending more.
