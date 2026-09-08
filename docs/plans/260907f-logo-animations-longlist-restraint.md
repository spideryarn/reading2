# Longlist: restrained logo hover animations

One of eight longlists generated on 2026-09-07 against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md), which has the DOM, the
constraints and the format. **The framing given to this one was restraint**: the ideas a serious
tool for researchers could ship without embarrassment, judged not on how they look the first time
but on what they look like the ninth. The other seven lists are producing sweeps, glitches and
spiders abseiling down the letters; this one is the counterweight, on the theory that whatever
survives on a page a paying reader looks at forty times a day will come from here. The working
question throughout was *does this still feel like the mark noticing you, or has it started
performing at you?* — so every idea below states its **amplitude and duration in real units, and its
easing curve, because in this lane those numbers are the idea**, plus the point at which the effect
tips over into being noticeable in the wrong way. Two or three have a dry joke in them, so the list
is not merely quiet.

## Shared mechanics, stated once

Five things every idea below inherits, so they are not repeated seventeen times.

1. **Both copies already hover.** `.logo-home` and `.dock-home` each do `opacity: 0.85 → 1` over
   `0.15s` (`dock.css` § the wordmark, `dock-fit.css` § the wordmark at the left-hand end). Anything
   here either composes with that or replaces it. Several of these are *better* as a replacement —
   an opacity lift is the least specific gesture available, and it is currently doing all the work.
2. **`.logo-letter` is inline.** Any transform on a letter needs `display: inline-block` set by the
   animation's own rule. `.logo` is `inline-flex`, so a pseudo-element needs `position: absolute`
   against it — free on `.logo-home` (it is `position: fixed`), but `.dock-home` is static and needs
   `position: relative` adding.
3. **The dock copy is inside `overflow: hidden`.** The bar's segment clips
   (`dock-fit.css:44`), so any glow, shadow or sweep that leaves the `.logo` box is cut off square in
   the dock and not in the corner. Ideas that light up *outside* the mark must either stay inside the
   padding box or declare that they skip the dock.
4. **The motion guard flattens transitions, not just animations** — `transition-duration: 0.01ms`
   as well as `animation-duration` (`tailwind.css` § the motion guard). Under
   `prefers-reduced-motion` a hover therefore *snaps* to the hovered state and stays there. So the
   test is not only "is frame one safe" but "**is the fully-hovered pose a legitimate static
   image**". Every idea below is written to pass that; where one doesn't, it says so.
5. **Numbers are for a 20×20 glyph and 0.82rem text in a ~120×44 box.** A 2px overshoot here is
   proportionally what 20px would be on a masthead. Read every figure as small on purpose.

---

## 1. Hover intent

**What the reader sees** Nothing at all, if the pointer is only travelling past. The effect — any
effect — begins only once the pointer has actually settled on the mark.

**Why it belongs** The wordmark sits in a fixed corner and at the end of the dock, both of them
places a pointer crosses on its way somewhere else, and a flourish that fires on a fly-past is the
single fastest way to make a tool feel cheap.

**Mechanism** Not an animation but a modifier every other idea should carry:
`transition-delay: 130ms` (or `animation-delay`) on the `:hover` rule, and `transition-delay: 0ms`
on the base rule so the exit is immediate. Asymmetric delay in pure CSS, no JS, no timers.

**Numbers** Enter delay 130 ms; exit delay 0 ms. Nothing else.

**Easing** n/a — this is a delay, not a curve.

**Cost** Easy (two declarations).

**Risk** Set too long and the mark feels unresponsive to a deliberate hover, which is a worse
failure than firing too eagerly.

**Tips over at** ~200 ms of enter delay, where a deliberate hover starts to feel like the page is
thinking about it. Below 90 ms it stops filtering fly-pasts and you have paid two lines for nothing.

---

## 2. The settle

**What the reader sees** The spider glyph rises a hair off the baseline and stops just past where it
was going, then eases back the last fraction — the way a physical object with mass arrives. The word
beside it does not move.

**Why it belongs** It is a material responding rather than a timeline playing, and a tool for people
who read for a living should feel like it is made of something.

**Mechanism** `.logo:hover .logo-image { transform: translateY(-1.5px); }` with a spring curve. Use
CSS `linear()` for a real spring if you want the settle to be honest; a `cubic-bezier` with
overshoot is the cheap approximation and is fine at this amplitude.

**Numbers** Travel `-1.5px`. Overshoot `0.4px` (i.e. peak at `-1.9px`), one settle, no second bounce.
Enter 260 ms; exit 190 ms with **no** overshoot, because a thing you let go of does not spring past
its rest position.

**Easing** Enter `cubic-bezier(0.22, 1.32, 0.36, 1)`; exit `cubic-bezier(0.33, 0, 0.67, 1)`.

**Cost** Easy.

**Risk** A second bounce. One overshoot reads as mass; two reads as a bouncing ball, and the
distance between them is about 0.5px and 120 ms.

**Tips over at** overshoot above ~2px, or any `animation-iteration-count` greater than 1. At 20px
tall, a 2px overshoot is 10% of the glyph and stops being physics.

---

## 3. One step home

**What the reader sees** The spider takes half a step to the left, away from the word and toward the
corner it links to, and holds there while you point at it. When you leave, it walks back — more
slowly than it left.

**Why it belongs** The motion carries the one piece of information the control has to give: this is
the way out of the article and back to the library, and the mark leans in that direction before you
click.

**Mechanism** `.logo:hover .logo-image { transform: translateX(-1.5px); }`. Transform only, so the
`0.4rem` flex gap is untouched and neither copy reflows. Pairs naturally with #2 if you want a
diagonal.

**Numbers** `-1.5px` on X. Enter 190 ms; **exit 300 ms** — the asymmetry is the point.

**Easing** Enter `cubic-bezier(0.2, 0.8, 0.2, 1)`; exit `cubic-bezier(0.4, 0, 0.6, 1)`.

**Cost** Easy.

**Risk** In the dock the wordmark is at the left-hand *end* of the bar, so stepping left steps toward
the frame's clipped edge; at 1.5px there is padding to spare (`0.6rem`), but anything larger clips.

**Tips over at** ~3px, where it stops reading as a lean and starts reading as the glyph detaching
from its word.

---

## 4. The long exhale

**What the reader sees** On hover, almost nothing — the mark brightens as it does today. The effect
is entirely in the release: when the pointer leaves, the brightness and a 1px lift drain away over
nearly a second, so the mark seems to relax rather than switch off.

**Why it belongs** Almost every hover animation is designed for the arrival and lets the departure
snap; designing the departure instead is the difference between a control that reacts and one that
has a temperament.

**Mechanism** Nothing but transition timings on the existing `opacity` rule plus a `translateY`.
Fast, short enter on `:hover`; long, slow-out exit declared on the base rule.

**Numbers** Enter: opacity `0.85 → 1`, `translateY(0 → -1px)`, 140 ms. Exit: the same two properties
back, **880 ms**.

**Easing** Enter `cubic-bezier(0.4, 0, 1, 1)` (ease-in, quick to attend); exit
`cubic-bezier(0.16, 1, 0.3, 1)` (a long expo tail — most of the change happens in the first 200 ms
and the last 5% takes half a second).

**Cost** Easy — arguably the cheapest idea on this list, and it changes only numbers already in the
file.

**Risk** If the pointer sweeps across the logo repeatedly, the slow exits overlap and the mark looks
like it is lagging rather than relaxing. Mitigated by #1.

**Tips over at** ~1.2 s of exit, where a reader who has moved on notices the corner still moving in
their peripheral vision. Peripheral motion after the pointer has gone is the exact thing that makes
chrome feel restless.

---

## 5. Breathing

**What the reader sees** If you rest on the mark for more than a moment, it settles into a very slow
swell — bigger and brighter, smaller and dimmer, over four seconds, with no visible start or end to
the cycle. It is a rest state, not a repeat.

**Why it belongs** It is the answer to the ten-second hover the brief warns about: a seamless loop is
a different species from a gesture playing again, and it lets the mark be alive without ever doing
anything twice.

**Mechanism** `@keyframes logo-breathe { 0%, 100% { transform: scale(1); opacity: 1 }
50% { transform: scale(1.012); opacity: 0.94 } }` on `.logo:hover`, with an
`animation-delay` so it only starts after the arrival gesture has finished. `0%` and `100%` are
identical, which is what removes the seam.

**Numbers** Scale `1 → 1.012 → 1` (0.24px on a 20px glyph). Opacity `1 → 0.94 → 1`. Period **4000
ms**, infinite. Start delay 700 ms after hover begins.

**Easing** `ease-in-out` on the whole loop, which for a sinusoidal swell is correct and for anything
faster would not be.

**Cost** Easy.

**Risk** The frozen frame. Under `prefers-reduced-motion` the animation is flattened to one 0.01ms
iteration, so it stops at whatever `0%` is — which here is the true resting state, deliberately. Any
version whose `0%` is mid-swell would freeze mid-swell.

**Tips over at** scale above ~1.03, or a period below ~2.5 s. Below 2.5 s it reads as a pulse, and a
pulse is a notification.

---

## 6. Yarn tension

**What the reader sees** The ten letters draw very slightly toward each other, as though a thread
running through the word has been pulled taut, and they hold in that tightened position while you
point. The word's outer edges do not move; only the space inside it closes.

**Why it belongs** The name is a thread, and this is the only gesture on the list that is literally
about tension in a line — it makes the wordmark behave like the thing it is named after without
drawing a single new shape.

**Mechanism** `.logo:hover .logo-letter { display: inline-block; }` plus ten `nth-child` rules
setting `transform: translateX(calc((4.5 - var(--i)) * 0.13px))`, so letter 1 moves right and letter
10 moves left by equal amounts and the sum is zero. Transforms do not reflow, so neither copy's box
changes; `letter-spacing` would and is forbidden.

**Numbers** Per-letter step `0.13px`, giving `±0.585px` at the two ends and total closure `1.17px`.
Enter 240 ms with 15% overshoot (peak closure `1.35px`), settling to the held value. Exit 320 ms, no
overshoot.

**Easing** Enter `cubic-bezier(0.34, 1.28, 0.64, 1)`; exit `cubic-bezier(0.33, 0, 0.67, 1)`.

**Cost** Medium — ten `nth-child` rules, or one rule if you are willing to emit a `--i` custom
property per letter in `HomeLogo.tsx`/`Dock.tsx` (which both already `.split("")` and index, so it is
one attribute).

**Risk** Sub-pixel transforms on text are rendered by rasterising at fractional offsets; on a
non-retina display at 0.82rem this can read as the letters getting *blurrier* rather than closer.
Check it on a 1× screen before believing it.

**Tips over at** total closure above ~3px, where the word visibly changes width even though its box
does not, and the reader reads it as a layout bug.

---

## 7. Thread underline

**What the reader sees** A hairline in the brand orange draws itself from the left under the word,
reaching the last letter in about a quarter of a second, and then simply stays. When you leave it
retracts to the right — out the way it came in.

**Why it belongs** It is a thread appearing under the word Spideryarn, and it is the most obviously
shippable thing on this list: it is what a careful, unshowy product does, and it will still be fine
on the four hundredth hover.

**Mechanism** `.logo::after` — absolutely positioned, `left`/`right` inset to the text run,
`height: 1px`, `background: var(--highlight)`, `opacity: 0.35`, `transform: scaleX(0)`. On hover
`scaleX(1)` with `transform-origin: left`; on the base rule `transform-origin: right`, which is what
makes it retract in the direction it grew rather than shrinking back toward the start.
`.dock-home` needs `position: relative` (see shared mechanics). Do not select `.logo-text` — the dock
copy does not have it.

**Numbers** Height `1px` (not `0.0625rem` — this one wants to be a device pixel). Opacity `0.35`.
Enter 260 ms; exit 200 ms.

**Easing** Enter `cubic-bezier(0.2, 0.8, 0.2, 1)`; exit `cubic-bezier(0.4, 0, 1, 1)`.

**Cost** Easy.

**Risk** It reads as a link underline, which on a link is either exactly right or completely
redundant depending on your taste — and at `opacity: 1` it definitely reads as a link underline and
nothing more.

**Tips over at** opacity above ~0.5, or height above 1px. A 2px rule under a 0.82rem word is a
button, not a thread.

---

## 8. Specular pass

**What the reader sees** A soft band of light travels once across the spider and the word, left to
right, and stops when it reaches the end. It does not come back and it does not repeat, however long
you hover.

**Why it belongs** Light is the most expensive-feeling effect available and one of the cheapest to
implement, and a *single* pass — rather than a loop — is the difference between a well-made object
catching the light and a shop-window banner.

**Mechanism** `.logo::before`, `inset: 0`, `pointer-events: none`,
`background: linear-gradient(105deg, transparent 40%, color-mix(in oklch, var(--panel) 70%,
transparent) 50%, transparent 60%)`, sized ~2.4× the box and animated on `background-position` or
`translateX`. `animation-iteration-count: 1` and `animation-fill-mode: forwards` are the whole idea.
Colour from `--panel` (light) so it works in both themes; in dark mode `--panel` is the lighter
value, which is what you want.

**Numbers** Band width 26px at 105°. Travel 150px (box width plus the band). Duration **620 ms**,
once. Peak opacity **0.14**.

**Easing** `cubic-bezier(0.4, 0, 0.2, 1)` — accelerating in, decelerating out, so the band is
briefest at the edges and slowest across the mark.

**Cost** Medium.

**Risk** Clipping in the dock: the `::before` must stay inside the padding box or the bar's
`overflow: hidden` will cut the band off with a hard vertical edge halfway through its travel.

**Tips over at** peak opacity above ~0.25, or any repeat. At 0.3 and looping this is the glossy
button of 2010, which is precisely the register this list exists to avoid.

---

## 9. The lean

**What the reader sees** The spider tips very slightly toward wherever your pointer is inside the
control, and follows it if you move — but lazily, always a beat behind. It is not tracking you so
much as inclining toward you.

**Why it belongs** It is attention rather than decoration: the mark responds to *where* you are, not
merely to the fact of you, and it is the only idea here that is different on every hover without
being random.

**Mechanism** `pointerenter`/`pointermove` on `.logo` sets two custom properties from the pointer's
position within the box, normalised to −1…1; CSS reads them:
`transform: translate(calc(var(--lx) * 0.8px), calc(var(--ly) * 0.5px)) rotate(calc(var(--lx) * 2deg))`
on `.logo-image`. The lag is a `transition` on `transform`, **not** a JS spring — the transition
duration *is* the inertia. `pointerleave` clears both to 0. ~10 lines of JS, in the one place both
components can share.

**Numbers** Max translate `0.8px` X, `0.5px` Y. Max rotation `2°`. Transition 180 ms (the lag). Return
to zero over 320 ms.

**Easing** `cubic-bezier(0.25, 0.46, 0.45, 0.94)` throughout — a plain ease-out, because the
following motion should never overshoot the pointer.

**Cost** Hard — the only JS on this list beyond choosing an animation, and the brief asks that to be
declared.

**Risk** Rotation of a six-fold radially symmetric mark at 2° may be genuinely invisible, in which
case you have written JS for the translate alone. Check whether the rotation is doing anything before
keeping it.

**Tips over at** rotation above ~5° or translate above ~2px, at which point the glyph reads as
detached from the word and the whole thing becomes a desk toy.

---

## 10. It leans away — *wit*

**What the reader sees** Exactly #9 with the sign flipped: the spider edges *away* from your pointer,
a fraction of a pixel, keeping its distance. It never gets far, and it comes back the moment you
leave it alone.

**Why it belongs** A spider that is slightly shy of the cursor is the only joke on this list that
costs a minus sign, and it makes the mark a character rather than a decoration — dry, and completely
deniable.

**Mechanism** #9 with `-0.8px` / `-0.5px` and no rotation. Ship both and let the random picker choose;
they are one line apart and nobody will consciously notice which they got, only that the mark did not
do the same thing twice.

**Numbers** Max translate `-0.8px` X, `-0.5px` Y. Transition 200 ms (very slightly slower than #9 —
retreat is less urgent than attention). Return 300 ms.

**Easing** `cubic-bezier(0.25, 0.46, 0.45, 0.94)`.

**Cost** Hard only because it shares #9's JS; free if #9 ships.

**Risk** If the amplitude is large enough to be consciously read, "the button moves away from your
cursor" is a hostile UI pattern with a bad name, and the joke curdles.

**Tips over at** ~2px. Below 1px it is a mood; above 2px it is the thing that makes people angry at
cookie banners.

---

## 11. Six-fold turn — *wit*

**What the reader sees** The spider rotates a sixth of a full turn, decisively, in a quarter of a
second — and ends up looking exactly as it did before, because it has six legs. You see it turn; you
cannot see that it has turned.

**Why it belongs** It is a whole gesture that leaves no trace, which is the most restrained thing an
animation can be, and it is quietly funny in a way that survives repetition precisely because there
is nothing to get tired of.

**Mechanism** `@keyframes { to { transform: rotate(60deg) } }` on `.logo-image`, `iteration-count: 1`,
`fill-mode: forwards`. Randomise the direction between `60deg` and `-60deg` if you want it to differ
between hovers. **Resting state is safe by construction**: every multiple of 60° is the same image, so
a reduced-motion freeze lands on a correct-looking mark.

**Numbers** `60°`, once. Duration **240 ms**. No overshoot on a rotation of this size — an overshoot
would be the only way to reveal that it is not symmetric.

**Easing** `cubic-bezier(0.34, 1.16, 0.64, 1)` — a hint of settle, small enough not to expose the
asymmetry.

**Cost** Easy — **conditional on a check**. Rotate `public/spideryarn-logo.png` by 60° and diff it
against the original. The brief says "radially symmetric-*ish*", and *ish* is doing all the work here.

**Risk** If the mark is not close enough to six-fold symmetric, the joke inverts: the spider ends up
visibly askew and stays there, and under reduced motion it snaps there instantly with no motion to
explain it. That failure is bad enough that the diff is a gate, not a nicety.

**Tips over at** any residual asymmetry a reader can see at 20px. If the diff shows it, fall back to
a full `360deg` over 900 ms — slower, less funny, and provably safe.

---

## 12. One blink — *wit*

**What the reader sees** A moment after you arrive, the whole mark dims for about a tenth of a second
and comes straight back. It is unmistakably a blink.

**Why it belongs** A blink is the smallest available sign that something is alive and has noticed
you, and it is the one gesture on this list that reads as a *reaction to you* rather than a property
of the object.

**Mechanism** `@keyframes logo-blink { 0%, 100% { opacity: 1 } 42%, 58% { opacity: 0.86 } }` on
`.logo:hover`, `iteration-count: 1`, with a delay so it lands after the arrival rather than during it.
Deliberately a flat-bottomed dip rather than a spike — a blink has a closed phase.

**Numbers** Dip to opacity **0.86**. Closed phase **95 ms**. Whole keyframe 220 ms. Delay **420 ms**
after hover begins. Once per hover, never repeated.

**Easing** `ease-in-out`. A linear blink looks like a dropped frame.

**Cost** Easy.

**Risk** At speed it is indistinguishable from a rendering glitch, and on a slow machine a dropped
frame during the dip makes it look like the page stuttered.

**Tips over at** a dip below ~0.75 opacity (now a flash, and flashes are warnings), or any repeat —
a blink twice is a twitch.

---

## 13. Only the i

**What the reader sees** One letter — the `i`, third in the word — rises a single pixel and comes
back down. Nothing else in the mark moves at all.

**Why it belongs** Restraint as narrowness of scope rather than low amplitude: a full-size gesture
confined to 1/10th of the wordmark, which is a much more interesting kind of quiet than doing a small
version of everything.

**Mechanism** `.logo:hover .logo-letter:nth-child(3) { display: inline-block; transform:
translateY(-1px); }`. Works identically in both copies because the letter spans are the same in
`.logo-text` and `.dock-btn-label` — this is exactly the case the brief's "select on `.logo-letter`"
rule was written for.

**Numbers** `-1px`, held while hovered. Enter 200 ms with a `0.3px` overshoot; exit 260 ms, flat.

**Easing** Enter `cubic-bezier(0.22, 1.3, 0.36, 1)`; exit `cubic-bezier(0.33, 0, 0.67, 1)`.

**Cost** Easy.

**Risk** It looks like a typographic bug — one letter sitting off the baseline — rather than a
gesture, unless it is unmistakably in motion. The 200 ms and the overshoot are what carry it; a
`transition: none` version of this would just look broken.

**Tips over at** ~2px, or any second letter joining in. The moment two letters move, it stops being
one element doing one thing and becomes a half-hearted wave.

---

## 14. From where you came

**What the reader sees** The ten letters each lift a hair, one after another — and the ripple runs in
the direction you approached from, so entering from the left runs left-to-right and entering from the
right runs the other way. You never quite predict it, because it depends on how you moved.

**Why it belongs** Responsiveness rather than performance: the same effect, differently every time,
determined by something the reader did rather than by a random number — which is what keeps it alive
at the fortieth hover.

**Mechanism** `pointerenter` compares `event.clientX` with the box centre and sets
`data-from="left" | "right"` on `.logo`. Two CSS blocks give the ten `.logo-letter` children
`animation-delay: calc(var(--i) * 14ms)` and its reverse. The letters need
`display: inline-block`. Falls back to "left" for keyboard focus, which is the correct reading order.

**Numbers** Per-letter lift `0.6px`. Per-letter stagger **14 ms**, so the ripple crosses all ten
letters in 126 ms and the whole gesture is ~300 ms. Each letter's own keyframe 190 ms, up and back.

**Easing** `ease-out` up, `ease-in` down, per letter — so the wave has a crest.

**Cost** Medium (four lines of JS, two CSS blocks, or one block plus a `--dir` multiplier).

**Risk** Staggered per-letter animation is the single most overused wordmark effect on the web, and at
any visible amplitude this becomes it. What saves it is that 0.6px is below the threshold at which you
can see the individual letters move — you see the *wave*, not the letters.

**Tips over at** lift above ~1.5px or stagger above ~30 ms. At 30 ms and 3px this is the bouncing
navbar logo of every startup site since 2014.

---

## 15. A millimetre off the page

**What the reader sees** The spider gains a very soft shadow directly beneath it and appears to lift
off the surface by about a millimetre. Nothing moves; the mark simply stops being flat.

**Why it belongs** It is depth rather than motion, so it composes with everything else on this list
and costs no movement budget — and a mark that lifts toward you when pointed at is the plainest
possible statement that it is a control.

**Mechanism** `.logo:hover .logo-image { filter: drop-shadow(0 1px 1.5px var(--logo-lift)); }`
transitioning from `drop-shadow(0 0 0 transparent)`. `--logo-lift` is defined per theme:
`color-mix(in oklch, var(--ink) 18%, transparent)` in light, and in dark mode a shadow is invisible so
it becomes a faint bloom — `color-mix(in oklch, var(--highlight) 22%, transparent)` at
`drop-shadow(0 0 2px …)`. Token-driven, no hard-coded hex.

**Numbers** Light: offset `0 1px`, blur `1.5px`, 18% alpha. Dark: offset `0 0`, blur `2px`, 22% alpha.
Enter 200 ms; exit 280 ms.

**Easing** `cubic-bezier(0.2, 0.8, 0.2, 1)` both ways.

**Cost** Easy, plus two theme tokens.

**Risk** `drop-shadow` on a 20px alpha PNG is filtered per-pixel and on a low-DPI screen the shadow
can look like a grey fringe rather than a shadow. And in the dock, a 2px bloom is within the padding
but only just — check it against the frame's `overflow: hidden`.

**Tips over at** blur above ~3px or alpha above ~30%, where the glyph looks like it has a halo and the
whole thing acquires the drop-shadow-on-everything look of a 2008 web app.

---

## 16. Warmer by four degrees

**What the reader sees** Almost certainly nothing you could describe. The orange warms very slightly
while you point at it, and cools back afterwards over about twice as long.

**Why it belongs** It is the purest test of the whole framing: an effect you would not notice being
added but would notice being removed, and one that never becomes tiresome because it never becomes
conscious.

**Mechanism** `.logo:hover { filter: hue-rotate(-4deg) saturate(1.04) brightness(1.02); }`. One
declaration, works on the PNG and the text together because both are inside `.logo` and both are
`--highlight`. Replaces the existing opacity lift rather than joining it, since brightening by
lightening and brightening by warming are two answers to one question.

**Numbers** Hue `-4°` (toward red). Saturation `+4%`. Brightness `+2%`. Enter 400 ms; exit **760 ms**.

**Easing** `ease-in-out` both directions — there is no motion, so there is nothing for a physical
curve to be about.

**Cost** Easy.

**Risk** **That it is literally invisible.** On a poorly calibrated display, or in dark mode where
the orange sits on a dark ground, a 4° hue shift may not survive; you would have shipped nothing and
would never find out, which is the [silent-success](../reusable/silent-success.md) shape exactly.
Verify by screenshot-diffing hovered against un-hovered before believing it works.

**Tips over at** ~10° of hue, where the brand orange visibly becomes a different orange, and the mark
starts to look like it is in an error state.

---

## 17. Reading light

**What the reader sees** A soft pool of full-strength colour follows your pointer along the word, with
the letters ahead of it and behind it sitting slightly dimmer — as though you were moving a small lamp
across the mark. The falloff is wide and gentle; no letter ever switches on or off.

**Why it belongs** It is the gist column's fisheye ([column-context.md](../project/column-context.md))
rendered at 120px wide — the product's own idea of *sharp where you are looking, soft elsewhere*,
applied to its own name.

**Mechanism** The honest version is not cheap. Set `--px` from `pointermove` on `.logo`. Then either
(a) paint the letters at `opacity: 0.78` and overlay a duplicate run at full strength masked by
`radial-gradient(circle 34px at var(--px) 50%, black, transparent)` — which needs a second copy of the
text in both components, so **new markup**; or (b) put `background: radial-gradient(...)` plus
`-webkit-background-clip: text; color: transparent` on `.logo`, which is one rule but affects every
text descendant and needs checking against the `img` and against the dock's fit ladder. Propose (b)
first and fall back to (a). No SVG trace needed either way.

**Numbers** Pool radius `34px` (about three letters). Dim level `0.78` opacity outside it, `1.0`
inside. Tracking transition **120 ms**, so the light lags the pointer slightly rather than sticking to
it. Fade the whole effect in over 260 ms on enter and out over 340 ms on leave.

**Easing** `cubic-bezier(0.25, 0.46, 0.45, 0.94)` on the tracking (never overshoot the pointer);
`ease-out` on the fade in and out.

**Cost** Hard — JS for the pointer, and either duplicated markup or a `background-clip: text` rule
that has to be checked in both copies and both themes.

**Risk** `background-clip: text` with `color: transparent` fails to a **completely invisible
wordmark** if the background does not paint — in an unusual theme, a forced-colours mode, or a
print stylesheet. That is a much worse failure than the effect not working, and it is the reason to
prefer (a) despite the extra markup.

**Tips over at** a dim level below ~0.6, or a pool radius below ~20px. Narrow and dark, it stops being
a reading light and becomes a spotlight, which is a performance.

---

## What I would ship, if it were one

**#7 Thread underline** for the safe default, **#4 The long exhale** as the cheapest change with the
highest ratio of feeling to lines, and **#11 Six-fold turn** for the joke — subject to its diff. All
three carry **#1 Hover intent**, which is not optional in a fixed corner.

If the set is genuinely random as Greg asked, the argument for including several of these is that
they are *indistinguishable from each other at a conscious level* — a reader gets a different
sub-perceptual response each time and reads the mark as responsive rather than as a slot machine.
That is a different reason for having a set than the previous version had, and it is the reason worth
building on.

---

Up: [plans.md](../project/plans.md)
