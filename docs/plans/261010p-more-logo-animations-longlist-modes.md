# More wordmark animations — longlist: the wordmark becomes a mode

Up: [261010p-more-logo-animations.md](261010p-more-logo-animations.md)

The framing: each mode is a lens on an article, so for a moment the wordmark *is* the article and
one lens passes over it. The word gets quoted, cited, cross-referenced, skimmed, quizzed, set as
maths, indented as a tree; the spider gets bookmarked, searched, talked to, painted. A reader who
knows the app should recognise the mode; a stranger should see an ordinary, pleasing typographic
or iconic gesture (quotation marks, a magnifying glass, a typing bubble), never a fault.

Thirteen ideas: **six mark-only, seven letters-only**, so every one can join a loader track. Brief:
[261010p-more-logo-animations-brief.md](261010p-more-logo-animations-brief.md).

**Overlap with the September features list**
([260907f-logo-animations-longlist-features.md](260907f-logo-animations-longlist-features.md)),
which took glossary, search, quotes, ideas, learn, quiz, timeline, comments, links, live
conversation, diagram, structure and referee. Where I come back to one of those modes I take a
different gesture, and say so in the idea. None of the September near-misses is re-proposed.

Shared notes:

- Every pseudo-element here is absolutely positioned. The letters already have
  `position: relative` (the base block in `logo-animations.css`), and `.logo-mark` is a box that is
  exactly the spider, so `inset: 0` means "on the spider".
- Colours are `--wordmark-ink`, `--highlight`, `--highlight-text`, `--highlight-ink`, `--ink`,
  `--panel`, and `color-mix()` of those, never hex.
- "Underlying style" means what the reduced-motion guard leaves showing: every pseudo-element
  below rests at `opacity: 0` or `scale(0)` in its base declaration and has no `forwards` unless
  I say so.

---

## Mark-only

### 1. Bookmarked

**Mode:** Comments (bookmark a passage).

**Reach:** mark.

**What the reader sees.** A tiny ribbon bookmark (white, with the notched tail) drops from behind
the spider's top-right shoulder with a small overshoot, hangs for a beat, then retracts upwards.
The spider has been kept for later.

**Why it's Spideryarn.** The first thing anyone does in Comments is bookmark a block; here the
reader bookmarks the reader.

**CSS mechanism.** `.logo-mark::after`: about 4×7px, `top: -2px; right: -1px`, `background:
var(--wordmark-ink)`, `clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%)`, base
`transform: scaleY(0)` with `transform-origin: top`. Keyframes: `0% scaleY(0)` → `18% scaleY(1.15)`
→ `26% scaleY(1)` → hold to `80%` → `100% scaleY(0)`. 1.6s, `infinite` on the loader. `z-index: -1`
puts it behind the leg it crosses, which reads as tucked rather than stuck on.

**Risk.** At 20px a white 4×7 sliver can read as a chipped pixel unless the notch is visible. Check
it on a 1× screen; give it 5×8 if the notch is lost. Clipped above in the 40px bar? Not really: it
starts 2px above the spider's top.

**Where.** Both. It starts instantly, so it suits hover.

### 2. Dwell

**Mode:** Reading time (the spine's tint, which reaches further where you have spent longer).

**Reach:** mark.

**What the reader sees.** A hairline appears just left of the spider, and a faint tint grows
rightwards from it behind the spider in small discrete steps, a little more for each half-second
you stay. Move away and it's gone. The mark is measuring how long you've lingered on it.

**Why it's Spideryarn.** It *is* the reading-time spine, drawn the way the spine draws it (a line
down the edge, a tint that reaches further). The joke is that what it measures is your hover.

**CSS mechanism.** `.logo-mark::before` is the hairline: `left: -3px; top: 0; bottom: 0; width:
1px; background: var(--highlight)`, opacity 0 → 0.8 over the first 8%. `.logo-mark::after` is the
tint: `left: -3px; right: 0; top: 0; bottom: 0; z-index: -1; background: color-mix(in oklab,
var(--wordmark-ink) 14%, transparent); transform-origin: left`, keyframes on `scaleX` 0 → 0.3 →
0.55 → 0.8 → 1 with `animation-timing-function: steps(1, end)` between stops (so it accrues rather
than slides), then an opacity fade over the last 12%. 3s, `infinite` on the loader.

**Risk.** Cutting it off at any frame snaps away a 14% tint, which is near enough to rest to pass.
A rectangle behind the spider may read as a selection box on a pale host; tune the mix per theme.
The median hover only sees the hairline and the first step, but that is still a complete, quiet
gesture.

**Where.** Both, and best on a long hover, where it rewards you for staying.

### 3. Magnifier

**Mode:** Search.

**Reach:** mark.

**What the reader sees.** A small magnifying glass (a white ring with a short handle) glides in
from the lower right and stops over the spider, which swells about 25% inside the lens, as if
found. The lens lifts away and the spider shrinks back.

**Why it's Spideryarn.** Search is the mode you open to find one thing in a long piece. Here the
thing found is the spider. A stranger sees the universal "search" glyph acted out.

**CSS mechanism.** `.logo-mark::after` is the ring: `inset: -2px; border: 1.5px solid
var(--wordmark-ink); border-radius: 50%`. `.logo-mark::before` is the handle: a 1.5×5px bar at the
ring's lower-right, `rotate(45deg)`. Both run the same keyframes: `translate(9px, 7px)` with
opacity 0 → `25%` translate(0) opacity 1 → hold to `70%` → `100%` back out to `translate(9px,
7px)` with opacity 0. `.logo-image` runs a sibling keyframe: `scale(1)` → `scale(1.25)` across
25–35% → hold → back to 1 by 85%. 1.8s.

**Risk.** A white ring round the mark looks like a keyboard focus outline when it is still. The
travel and the handle are what stop that, so neither may be cut in polish. The ring's 2px
overflow could clip on the shelf heading.

**Where.** Both. On the loader it pairs well with any letters track, because the lens never
touches the word.

### 4. Typing…

**Mode:** Chat (and every streamed answer).

**Reach:** mark.

**What the reader sees.** A tiny speech bubble pops out above the spider's right shoulder, and
three dots ripple inside it, as if the spider were writing back. Then the bubble pops away and
the spider gives the smallest nod.

**Why it's Spideryarn.** It is the chat band's own typing indicator. It is also the house rule,
"stream any model call a person is waiting on", with a spider doing the waiting.

**CSS mechanism.** `.logo-mark::after`: `bottom: 72%; left: 72%; width: 10px; height: 7px;
border-radius: 3.5px 3.5px 3.5px 1px` (the flat corner is the tail), `background:
var(--wordmark-ink)`, plus three `radial-gradient(circle, var(--ink) 0.8px, transparent 1px)`
layers sized 2×2px. Keyframes: the bubble goes `scale(0)` → `scale(1)` (origin bottom left) by
10%; the three dots' `background-position` y values (animatable as a list) dip 1px in turn from
15% to 80%; the bubble goes back to `scale(0)` by 92%. `.logo-image`: `translateY(1px)` and back
around 92–100% (the nod). 2.4s.

**Risk.** At 20px the dots are 1px and may merge into a grey smudge on a 1× display. Hover still
reads as "a speech bubble", which is enough, and at 2.2× on the loader it is unmistakable. The
bubble sits about 6px above the spider's top: inside the 40px bar, but check the shelf heading.

**Where.** The loader above all (the screen is a wait for a model, so this is the honest
animation), and fine on hover.

### 5. Painted In

**Mode:** Illustrated (the Sketch, painted).

**Reach:** mark.

**What the reader sees.** The spider fades to a pale pencil line, as though it were the sketch.
Then its orange floods back outwards from the knot at the centre to the tips of the legs, like
watercolour wicking along the strand.

**Why it's Spideryarn.** It is Sketch then Illustrated in one gesture: the model's line drawing,
then the painting. The order of the two modes is the order of the frames.

**CSS mechanism.** `.logo-image`: `filter: grayscale(1) brightness(1.7) opacity(0.7)` over 0–15%,
held, back to `none` at 100%. `.logo-mark::after`: `inset: 0; background: var(--highlight)`, with
two mask layers, `url(/spideryarn-logo.png) center / 100% 100%` and `radial-gradient(circle,
#000 var(--spya-paint), transparent calc(var(--spya-paint) + 2px))`, composited with
`mask-composite: intersect` (`-webkit-mask-composite: source-in`). A registered `@property
--spya-paint` (`<length-percentage>`) goes 0% → 75% over 25–90%, and the pseudo fades out over
the last 10%, once the image's filter is gone. 2.6s. Gated in `@supports` like Radius Sweep.

**Risk.** The pencil phase is the far-from-rest frame. A grey spider looks disabled, so a hover
cut off at 20% snaps from grey to orange. The snap itself is harmless, but keep the grey phase
short. It is the second user of `@property` and of a mask on the mark, so it needs Radius Sweep's
fallback reasoning, rewritten.

**Where.** The loader. On hover only if the pencil phase is squeezed under 120ms.

### 6. Listening

**Mode:** Live conversation (talking to the article aloud).

**Reach:** mark.

**What the reader sees.** Soft rings ripple out from the spider unevenly, two close together,
then a pause, then one, then a pause, like the cadence of someone speaking. The spider itself
swells a hair with each burst.

**Why it's Spideryarn.** Live conversation is the mode where the article listens. The uneven
cadence is speech, which separates it from a generic "live" pulse. (September's Quiet Meter put
the same mode's bursts on the letters; this one is the spider's version, with rings instead of
bobbing.)

**CSS mechanism.** `.logo-mark::before` and `::after`: `inset: 0; border-radius: 50%; border: 1px
solid color-mix(in oklab, var(--highlight) 70%, transparent)`, base `opacity: 0`. One keyframe set
with irregular stops: `scale(0.7)`, opacity 0.8 → `scale(1.7)`, opacity 0 at 0–25%, again at
12–37% on the second pseudo (by a delay), nothing from 40–60%, one ring at 60–85%. `.logo-image`
does `scale(1.04)` pulses at the burst starts. 2.2s. Every ring ends at opacity 0, so any cut-off
frame is near rest.

**Risk.** Rings round an icon are the commonest UI pulse there is, so without the irregular
rhythm it is "notification badge". The rhythm is the idea. Rings at 1.7× overflow the spider by
about 7px a side; fine in the bar, check the corner.

**Where.** Both.

---

## Letters-only

### 7. In Quotes

**Mode:** Quotes (the lines worth keeping).

**Reach:** letters.

**What the reader sees.** Two orange curly quotation marks slide in from just outside either end
of the word and settle, raised at cap height: “Spideryarn”. They hold, then drift back out and
fade.

**Why it's Spideryarn.** It is the Quotes mode's verdict on the name itself: a line worth
keeping. And a stranger gets a second joke for free, the knowing "so-called" quote marks.
(September's Marked For Keeping did Quotes with a left rule and a wash. This one uses the actual
glyphs, which read at once.)

**CSS mechanism.** `.logo-letter:nth-child(1)::before { content: "\201C"; }` and
`:nth-child(10)::after { content: "\201D"; }`: absolutely positioned, `top: calc(var(--logo-px) *
-2)`, `left: calc(var(--logo-px) * -6)` and `left: calc(100% + var(--logo-px) * 1)` respectively,
`color: var(--highlight-text)`, the letter's own font. Base `opacity: 0`. Keyframes: `0%` opacity 0,
`translateX(∓ var(--logo-px) * 4)` → `22%` opacity 1, translate 0 → hold to `78%` → `100%` back
out. 1.8s. Pseudo-element text changes no box.

**Risk.** The left mark sits in the gap between the spider and the S, and that gap differs per
host (touch devices, the shelf). It may kiss the spider; it needs measuring in all four hosts, and
`-5` may have to become `-4`. On the corner copy the right mark overhangs the fixed box by a few
px. The quote glyphs differ between Geist and the fallback faces, but any curly quote reads.

**Where.** Both. Instant and legible inside 300ms.

### 8. Cited

**Mode:** Sources / Bibliography (what the piece cites).

**Reach:** letters.

**What the reader sees.** A tiny orange superscript "1" pops up after the final n, a footnote
marker: Spideryarn¹. It holds, glows once as if hovered, and fades.

**Why it's Spideryarn.** A reading app that takes provenance seriously footnotes its own name.
Hover cards on citations are how the Sources mode meets you in the prose.

**CSS mechanism.** `.logo-letter:nth-child(10)::after { content: "1"; position: absolute; top:
calc(var(--logo-px) * -3); left: calc(100% + var(--logo-px) * 1); font-size: 0.55em; color:
var(--highlight-text); }`, base `transform: scale(0)`, origin bottom left. Keyframes: `scale(0)` →
`15% scale(1.2)` → `22% scale(1)` → `50%` adds `text-shadow: 0 0 calc(var(--logo-px)*3)
var(--highlight)` and back → hold → `100% scale(0)`. 1.6s. (Ticking "1" → "2" → "3" with discrete
`content` keyframes is tempting, but Safari's support is shaky, so a single "1" it is.)

**Risk.** A small "1" beside a product name is also the shape of an unread-notifications badge, so
the reader may look for a message. The superscript position and the serif-less digit decide it;
square brackets "[1]" are the fallback if it reads as a badge. It overhangs the right edge by
about 4px.

**Where.** Both.

### 9. See Below

**Mode:** Cross-references (the article linked to itself, claim to the passage behind it).

**Reach:** letters.

**What the reader sees.** An orange underline grows under "Spider" as if it were a link. Then
"yarn" flashes warm and cools, like a block you have just jumped to, while the underline fades. The
first half of the name cites the second.

**Why it's Spideryarn.** A claim links to the passage that supports it, and clicking flashes the
target. That is exactly two beats, and the name happens to split into two words.

**CSS mechanism.** Letters 1–6: `::after` with `left: 0; right: 0; bottom: calc(var(--logo-px) *
-2); height: 1px; background: var(--highlight); transform: scaleX(0); transform-origin: left`,
animated to `scaleX(1)` with `animation-delay: calc(var(--i) * 40ms)` so the six segments join up
into one line drawn left to right, held to 60%, then opacity to 0. Letters 7–10: `color` →
`var(--highlight-text)` and `text-shadow: 0 0 calc(var(--logo-px)*4) color-mix(in oklab,
var(--highlight) 55%, transparent)` at about 45%, decaying to rest by 85% (a flash, so a fast
attack and a slow release, unlike Dew's even pass). No 0%/100% colour stops, as in Dew. 1.4s.

**Risk.** Six joined underline segments can show seams at fractional sizes; let each overlap its
neighbour by half a `--logo-px`. The colour half is close kin to Dew, so they shouldn't both be
drawn back to back (the picker's job).

**Where.** Both. The underline starts at once.

### 10. Three Times Round

**Mode:** Skim (a route through quotes, walked three times at increasing depth).

**Reach:** letters.

**What the reader sees.** Three letters light in turn, and not in left-to-right order: the n, then
the S, then the y. A pause. Then six light, a little faster. A pause. Then all ten in a quick
sweep. The word has been skimmed three times, each time deeper.

**Why it's Spideryarn.** It is Skim's exact shape: a handful of stops, then about a dozen, then
most of the piece, with the results visited first.

**CSS mechanism.** Three `@keyframes` sets, one per depth at which a letter joins. Letters in the
first pass (`n, S, y`) glow at 8%, 40% and 72%; letters that join in the second (`d, r, i`) glow at
40% and 72%; the rest glow at 72% only. The glow is Dew's palette (`color:
var(--highlight-text)` plus a soft `text-shadow`), each a short peak about 6% wide. The order
within a pass comes from per-letter `animation-delay`s of 0–200ms (n before S before y). No
0%/100% colour stops, so every letter starts and ends at `--wordmark-ink`. 3.6s, `infinite` on the
loader.

**Risk.** The median hover sees only the first pass: three scattered letters lighting one after
another. That is fine as a gesture, but it is the stepped-opacity "rendering fault" September
warned about if the peaks are too dim; glow, don't dim. Ten nth-child membership rules are
mechanical but easy to get wrong silently, so a test should count each letter's passes.

**Where.** The loader above all (it needs the whole 3.6s), and acceptable on hover.

### 11. Set in TeX

**Mode:** Maths (TeX in the prose, drawn as maths).

**Reach:** letters.

**What the reader sees.** The letters lean one by one into an italic slant from S to n, as though
the word had been typeset as ten maths variables multiplied together. They hold slanted for a
beat, then straighten from the n back to the S.

**Why it's Spideryarn.** In TeX every unspaced letter run is a product of italic variables, so
*Spideryarn* in maths mode is S·p·i·d·e·r·y·a·r·n. A reader who has seen the Maths mode render
gets the joke; a stranger sees a neat typographic flourish.

**CSS mechanism.** `.logo-letter`: `transform: skewX(-11deg)` with `transform-origin: 50% 100%`
(so the baseline stays put), on keyframes `0%` none → `30%` skew → hold → `100%` none.
`animation-delay: calc(var(--i) * 35ms)` on the way in. The way back is reversed by a second
keyframe percentage per letter, or more simply by `calc((9 - var(--i)) * 35ms)` folded into the
hold length. 1.3s. Transform only, so no box changes; synthetic `font-style: italic` is avoided
because Geist ships no italic and the fallbacks differ.

**Risk.** Mild: at 13px a skew is sometimes read as faux-italic, which it is, and that is fine.
The skewed `y` descender leans left into the `r`; at -11deg that is under a pixel.

**Where.** Both. It reads at 300ms because the first letters skew immediately.

### 12. Indent

**Mode:** Structure (the nested table of contents).

**Reach:** letters.

**What the reader sees.** The word becomes a tiny outline. "Spider" stays at the top level,
"yarn" steps down and in one level, and "rn" steps down and in again, a three-rung staircase.
It holds, then folds back up into one line.

**Why it's Spideryarn.** Structure draws the piece as a nested list, and here the name is parsed
into a heading, a subheading and a sub-subheading. The moves are discrete, a level at a time,
unlike Sag's smooth curve.

**CSS mechanism.** Letters 7–8: `translate(calc(var(--logo-px)*1.5), calc(var(--logo-px)*3))`.
Letters 9–10: `translate(calc(var(--logo-px)*3), calc(var(--logo-px)*6))`. Keyframes `0%` 0 →
`20%` level 1 for all of 7–10 → `35%` 9–10 to level 2 → hold to `75%` → `100%` 0, with a crisp
`cubic-bezier(0.2, 0, 0, 1)` per step so each rung clicks into place. Optionally a 1px hairline
`::before` on letters 7 and 9 at their left edge, a tree's guide line, fading in with each step.
1.6s.

**Risk.** 6 `--logo-px` of downward travel is under the measured 8px ceiling. The 3px rightward
shift pushes the `n` past the word's right edge, which is acceptable in "a few px" but needs
checking in the dock row. If the hairline guides are dropped it is just a staircase, which is
still a pleasant still.

**Where.** Both.

### 13. Cloze

**Mode:** Quiz (the article asks, you answer).

**Reach:** letters.

**What the reader sees.** "yarn" blanks out to four short underlines, Spider_ _ _ _, a
fill-in-the-blank question. Then the letters are filled back in one at a time, y, a, r, n, and each
underline turns orange as its answer lands, before it all clears.

**Why it's Spideryarn.** Quiz makes you produce the answer rather than recognise it. A cloze on
the name is the smallest possible quiz.

**CSS mechanism.** Letters 7–10: `color` to `transparent` across 5–15%; an `::after` hairline
(`left: 10%; right: 10%; bottom: calc(var(--logo-px) * -1.5); height: 1px; background:
color-mix(in oklab, var(--wordmark-ink) 60%, transparent)`) fades in at the same time. From 40%
each letter's colour returns to rest and its hairline flips to `var(--highlight)`, staggered with
`animation-delay: calc((var(--i) - 6) * 120ms)`. Everything fades to rest by 100%. 2s.

**Risk.** This is the brief's own warning: four missing letters look like a font failure. The
blanks carry the intent, but a hover cut off at 200ms shows "Spider____" for a frame. It is
also cousin to Retype (dim, then back). So: **loader only**, or for hover blank just the `y`.

**Where.** The loader. Hover only in the one-letter variant.

---

## Top 4

1. **In Quotes** (letters). The best ratio of recognition to cost: two pseudo-elements, legible
   inside a 300ms hover, and funny on two levels (the Quotes mode, and so-called quote marks).
   Nothing in the current fourteen adds a glyph.
2. **Magnifier** (mark). A mark-only idea a stranger reads at once, and it gives phones something
   new. It is the only one of the set where the spider is *acted on* by a tool. It pairs with any
   letters track because it never touches the word.
3. **Dwell** (mark). The wittiest of the thirteen: the wordmark measures how long you have hovered
   on it, in the reading-time spine's own visual language. Every frame is near rest, so it survives
   being cut off anywhere, and it pays off more the longer you stay.
4. **Three Times Round** (letters). It turns Skim, the most distinctive way of reading in the app,
   into a rhythm on the loader that is unlike anything in the set: non-sequential, building, three
   rounds. It reuses Dew's proven colour-and-glow mechanism, so its risk is choreography rather
   than rendering.

Next in line: **Typing…**, which is the honest animation for a screen that is waiting on a model,
but whose 1px dots need checking on a 1× display before it can be trusted on hover.
