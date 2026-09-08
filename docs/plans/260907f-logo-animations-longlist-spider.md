# Longlist: hover animations from the name and the mark

One of eight longlists generated on 2026-09-07 against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md), which has the DOM, the
constraints and the output format. **My framing was the name and the mark itself** — spiders, yarn,
webs, thread, silk, weaving — and specifically *observed behaviour* rather than atmosphere: what a
real orb weaver actually does (drops on a dragline and climbs back, builds in a fixed order, plucks
a radius to read it, sits at the hub with a leg on every radius, eats the web at dawn and respins
it) and what real textile actually does (unspools, sags, plies, drops a stitch, cinches into a
knot). The other seven agents have other framings, so nothing here reaches for typography, motion
theory, or the product's features except where the thread metaphor lands on one by itself.

## What I found when I looked at the mark

Worth writing down, because three of these are not in the brief and they change what is possible.

- **It is one continuous strand.** The legs do not stop at the body — the upper-left leg runs down
  *through* the knot and comes out as the lower-right one, and the same for the other pair. It is a
  single rope tied in an overhand knot with six loose ends. That is the single most animatable fact
  about it, and it is what makes "draw itself in one stroke" honest rather than decorative.
- **The knot has three holes** — one vertical lens above, two below. **At 20 px they are 1–2 px
  and effectively vanish**, so the mark reads as a blob with six spokes. Any idea that depends on
  interior detail is dead on arrival; any idea that depends on the six spokes being *radial* is
  cheap.
- **The legs are not symmetrical.** Two sweep up and inward like raised forelegs, two run nearly
  horizontal and are the longest, two splay down. Rotating the whole mark therefore reads as
  *tumbling*, not spinning — which kills some ideas and is the whole point of one.
- **`.logo` has no `position`**, so every absolutely-positioned pseudo-element below needs
  `.logo { position: relative }` added first. One line, safe in both copies.
- **`.dock` is `overflow-x: auto; overflow-y: hidden`** (dock.css § .dock). So in the dock copy
  anything drawn above or below the bar is *clipped*, and anything drawn wide *adds scroll width to
  the bar*. The corner copy is `position: fixed` at `top: var(--safe-top)` — nothing above it but
  the screen edge. **Threads hang down in the corner and are clipped in the dock**; I name it per
  idea where it bites.

## Two mechanisms most of these share

Written once so the entries can be short.

**The ten-letter stagger, without JavaScript.** There are exactly ten `.logo-letter` spans, so
`:nth-child(1)`…`:nth-child(10)` is a complete, JS-free index. Ten one-line rules:

```css
.logo-anim .logo-letter { display: inline-block; }   /* they are inline by default */
.logo-anim .logo-letter:nth-child(1) { animation-delay: 0ms; }
/* … :nth-child(10) { animation-delay: 270ms; } */
```

**Recolouring the mark without an SVG.** `mask-image: url(/spideryarn-logo.png)` with
`mask-size: 20px 20px` over a painted box gives complete control of what the mark's alpha is filled
with — including a *rotating* fill, which is how several ideas below get per-leg behaviour with no
trace. Because the legs are radial, a `conic-gradient` rotating behind the mask lights them one at a
time for free.

**The resting-state rule.** The global motion guard flattens everything to `0.01ms` and
`animation-iteration-count: 1`, so whatever `0%`/`100%` says is what a reduced-motion reader sees,
frozen. Every keyframe set below is written to start and end at neutral. I flag the two that are
hard to make safe.

---

## The longlist

### 1. Pluck the Thread

**What the reader sees.** The ten letters are a taut string; the spider plucks it at the left and a
single travelling bump runs S → n, lifting each letter about 2 px as it passes, then rebounds off
the end and comes back smaller, and again smaller, until it settles. The mark itself does not move —
it plucked, it is now listening.

**Why it belongs.** Vibration is how a spider reads its web, and this app is about reading a thing
by feeling along it rather than being told what it says.

**Mechanism.** One keyframe `pluck { 0%,100% { transform: none } 20% { transform: translateY(-2px) } }`
on `.logo-letter`, `display: inline-block`, `animation: pluck 1.1s ease-in-out infinite` with the
ten-letter stagger at ~28 ms. The damping is the trick and it is free: give the keyframe a second
smaller bump at 55% and a third at 80%, so a single pass *is* the decay.

**Cost.** Easy — one keyframe, ten delay rules.

**Risk.** Without the damping it is a Mexican wave, which is the single most tired micro-interaction
on the web. Amplitude above ~3 px stops reading as a string and starts reading as bouncing.

---

### 2. Dragline Drop

**What the reader sees.** The spider drops straight down out of its slot, paying out a hairline
thread from where it was, hangs for a beat swinging a degree or two, then climbs briskly back up and
the thread retracts into nothing. It is the single most recognisable thing a spider does, and it
takes about a second.

**Why it belongs.** A dragline is a spider's undo — it never lets go of where it came from — which
is exactly the promise that the article is always still there behind whatever the AI just said.

**Mechanism.** `.logo-image { animation: drop 1.4s ease-in-out infinite }` with
`translateY(0 → 11px → 11px → 0)` plus a ±1.5deg `rotate` on the hang. The thread is
`.logo::before`: `position: absolute; left: calc(0.7rem + 9px); top: 0.7rem; width: 1px;
height: 12px; background: currentColor; transform-origin: top; transform: scaleY(0)`, animated
`scaleY` in lockstep. There is room: the image is 20 px in a 44 px box.

**Cost.** Medium — a pseudo-element, a hard-coded left offset that has to match the flex layout, and
two animations that must stay in sync.

**Risk.** The `left` offset is computed from `.logo`'s padding and gap, so it silently drifts if
either changes; and a 1 px vertical line at some fractional device pixel ratios renders as a grey
smear rather than an orange thread.

---

### 3. Radius Sweep

**What the reader sees.** A brighter tone travels around the mark like a hand on a clock face,
lighting each of the six legs in turn and then the next — up-left, up-right, right, down-right,
down-left, left — while the rest of the spider stays its ordinary orange. Nothing moves; the light
goes round.

**Why it belongs.** The spider at the hub keeps a leg on every radius and polls them; this is that,
and it is the closest thing in the mark to "the reader attending to one part at a time".

**Mechanism.** No SVG trace. `.logo-image { visibility: hidden }` and a `.logo::before` sized
20×20 at the image's position, `mask-image: url(/spideryarn-logo.png); mask-size: 20px 20px`,
`background: conic-gradient(from var(--a), var(--highlight) 0 300deg, var(--highlight-ink) 330deg,
var(--highlight) 360deg)`, with `@property --a { syntax: '<angle>'; inherits: false;
initial-value: 0deg }` animated 0→360deg over 3s linear. `--highlight-ink` already exists
(tokens.css) and is the orange mixed 85% with white, so it works in both themes.

**Cost.** Medium — the mask duplication and one `@property`.

**Risk.** `@property` is needed to animate the angle at all, and if it is unsupported the gradient
sits frozen at 0deg — which is a *wrong resting state*, one leg permanently paler. Guard with
`@supports (background: conic-gradient(from var(--a), red, blue))` or accept the frozen frame is
harmless. Also: hiding the real `<img>` and painting a mask means the `alt` text and the printed
page lose the mark.

---

### 4. The Knot Tightens

**What the reader sees.** The spider cinches: it draws in to about 86% of its size quickly, holds a
fraction, then springs back past its true size by a hair and settles. Like a slipknot pulled and let
go, and it happens on a beat rather than continuously.

**Why it belongs.** The body of this mark is literally a knot of loops, and a knot that tightens is
the visual of a loose set of ideas being pulled into one — which is what the name is about.

**Mechanism.** `.logo-image { animation: cinch 1.6s cubic-bezier(.34,1.56,.64,1) infinite }`,
keyframes `0%,100% { transform: scale(1) } 25% { transform: scale(.86) } 60% { transform: scale(1.04) }`.
`transform-origin: center` — the flex box does not reflow because `scale` is a transform.

**Cost.** Easy — five lines.

**Risk.** On the PNG the legs shrink with the body, so it reads as the whole spider getting smaller
rather than the *knot* cinching. The true version — the body contracting while the six leg tips stay
pinned — **needs an SVG trace** (per-path transforms), and is a much better animation; worth costing
separately.

---

### 5. Dew Line

**What the reader sees.** A row of tiny beads settles along the top of the word, one above each
letter, arriving left to right over about half a second, each one brightening as it lands. They sit
there catching the light, and if you keep hovering they very slowly evaporate from the far end back.

**Why it belongs.** Dew is the one moment a web becomes visible — the structure was always there and
the light made it readable, which is a fair description of what this product is for.

**Mechanism.** `.logo-letter::after { content:''; position:absolute; top:-3px; left:50%;
width:2px; height:2px; border-radius:50%; background: var(--highlight-ink); opacity:0 }` with
`.logo-letter { position: relative; display: inline-block }`, one `bead` keyframe animating
`opacity` and a 1 px `translateY`, ten-letter stagger at 45 ms.

**Cost.** Medium — a pseudo-element on every letter, ten delays, and `position: relative` on an
element that currently has none.

**Risk.** A 2 px dot at 0.82rem is subpixel on a non-retina display and renders as a faint grey
crumb — it will read as dirt on the screen, not dew. Needs testing at 1× before it is believed.

---

### 6. Silk Draws Itself

**What the reader sees.** The mark is not there, and then a single line begins at one leg tip and
draws — travelling inward, through the knot, looping around it, and out again to the opposite leg
tip, in one unbroken movement, until the whole spider exists. Then it holds. It takes about 900 ms
and it looks like it is being extruded rather than faded in.

**Why it belongs.** This is the truest possible animation for *this* mark, because the mark really is
one continuous strand — the legs pass through the knot and come out the other side. It says the
whole thing is one thread, which is the name.

**Mechanism.** **Requires an SVG trace of the mark** — and specifically a trace that preserves the
single-stroke topology rather than an autotraced outline, so `stroke-dasharray: <len>;
stroke-dashoffset: <len> → 0` walks the actual path in the actual order. Inline the SVG in
`HomeLogo.tsx` and `Dock.tsx` alongside (not instead of) the PNG, or swap to it entirely.

**Cost.** Hard — a tracing pass, a hand-corrected path order, a second copy of the mark to keep in
sync with the PNG, and `pathLength` normalisation so the dash numbers survive a re-trace.

**Risk.** An autotrace of a filled shape gives you the *outline* of the stroke, not its centreline —
you get the line drawing its own border, which looks like a leak, not like silk. This idea is worth
nothing without a proper centreline trace, and that is the real cost hiding in "Hard".

---

### 7. Unravel and Re-knit

**What the reader sees.** The `n` on the end lets go: it rotates loose and drops out of the row,
then the `r`, then the `a`, unpicking the word from the right at about 60 ms a letter — and before
it has taken more than half, the left end is already knitting back, letters swinging up into place
in order. The word is never fully gone.

**Why it belongs.** Yarn: pull the loose end and the row comes undone. It is the only idea here that
plays with the fact that the ten letters *are* a row of stitches.

**Mechanism.** `.logo-letter { display: inline-block; transform-origin: top center }`, keyframe
`unpick { 0%,100% { transform:none; opacity:1 } 40% { transform: rotate(28deg) translateY(3px); opacity:.15 } }`,
`animation-duration: 1.6s`, stagger **in reverse** — `:nth-child(10) { animation-delay: 0ms }` down
to `:nth-child(1) { animation-delay: 540ms }`.

**Cost.** Medium — ten reversed delays, and the timing has to be tuned so the re-knit overlaps the
unravel or it looks like the logo is broken for half a second.

**Risk.** This is a *navigation link*, and making the word you are about to click unreadable while
you point at it is the kind of clever that gets switched off in a week. The rotation must stay small
enough that you can still read "Spideryarn" at every frame.

---

### 8. Dawn Rebuild

**What the reader sees.** A soft edge sweeps right to left across the whole control and everything
behind it is *gone* — mark and word both eaten — and then immediately a second edge sweeps left to
right and puts it all back, slightly brighter than before. Eaten in one direction, respun in the
other; the asymmetry is the whole idea.

**Why it belongs.** An orb weaver eats its own web at dawn and builds a new one the same day, which
is the least sentimental possible statement of what re-reading something is.

**Mechanism.** One `mask-image: linear-gradient(90deg, #000 40%, transparent 60%)` on `.logo` with
`mask-size: 250% 100%` and `mask-position` animated `100% → -150% → 100%` — the outbound and return
legs of a single keyframe, with different easings (`ease-in` to eat, `ease-out` to spin). Masking
`.logo` takes the `<img>` and the letters together, which is the point.

**Cost.** Easy — about a dozen lines, one keyframe.

**Risk.** This is one keyframe away from the previous app's Highlight Sweep, and if the eat/respin
asymmetry gets tuned out during polish it *becomes* Highlight Sweep. Also: a mask on `.logo` creates
a containing block and can interact with `.logo-home`'s `position: fixed` — check the corner copy
doesn't shift a pixel.

---

### 9. Something in the Web

**What the reader sees.** One letter in the middle — say the `e` — jolts sharply, as if hit. The
jolt spreads outward to its neighbours in both directions, smaller each step, dying out before it
reaches the ends. Last of all, the spider twitches once: it felt it.

**Why it belongs.** The reader lands on one sentence and the whole structure of the piece registers
it — that is the argument for hierarchy, staged as an insect hitting a web.

**Mechanism.** Same `pluck`-family keyframe as #1 but with per-letter *amplitude* as well as delay:
`--amp` custom property per `:nth-child`, `transform: translateY(calc(var(--amp) * -1px))`, delays
fanning outward from the struck index (`:nth-child(5)` 0 ms, `4` and `6` 50 ms, `3` and `7` 100 ms,
…). The mark's twitch is a second keyframe on `.logo-image` at `animation-delay: 260ms`.

**Cost.** Medium — twenty rules, two keyframes, and the fan-out has to be hand-tabulated.

**Risk.** Unless the propagation is unmistakably *outward from a point in both directions*, it
degrades into #1 with extra steps, and you have paid twice for one animation. Also, which letter is
struck should probably vary — and doing that without JavaScript means three variant classes, which is
three times the CSS.

---

### 10. Dropped Stitch

**What the reader sees.** One letter quietly loses its footing and slips 4 px below the line, hanging
by a thread you can only just see. It dangles a moment, and then it is picked back up and the row is
whole again. Nothing else in the wordmark reacts.

**Why it belongs.** It is the smallest possible piece of textile behaviour, and it is a joke about
close reading: you only notice the dropped stitch if you were actually looking.

**Mechanism.** `.logo-letter:nth-child(7) { display: inline-block; position: relative }` with
`animation: drop-stitch 2.2s ease-in-out infinite` on `translateY(0 → 4px → 4px → 0)`, and a
`::before` above it — `width: 1px; height: 5px; top: -5px; background: currentColor;
transform-origin: bottom; transform: scaleY(0)` — animated in step so the thread only exists while
the letter is down.

**Cost.** Easy — about fifteen lines, one letter.

**Risk.** A single misaligned glyph is indistinguishable from a font-rendering bug, and at 300 ms of
hover the reader sees only the fault and never the recovery. It needs to fall *and* be retrieved
inside the first second or it is just broken-looking.

---

### 11. Two-Ply

**What the reader sees.** The colour along the word alternates in a slow travelling pattern — some
letters the ordinary orange, some a paler warm tone — and the pattern slides steadily left to right,
so it looks like two differently-lit strands twisting around each other along the length of the
word. Nothing moves at all; only the colour travels.

**Why it belongs.** Plying is two strands becoming one that is stronger than either, which is as
close as this mark gets to stating the product's actual argument: the reader and the AI, twisted,
not one replacing the other.

**Mechanism.** `.logo-letter { animation: ply 2.4s linear infinite }` with
`ply { 0%,100% { color: var(--highlight) } 50% { color: var(--highlight-ink) } }` and the ten-letter
stagger at 240 ms — a full period spread across the word, so the pattern travels. Both colours are
tokens, so light and dark are free.

**Cost.** Easy — one keyframe plus the shared stagger.

**Risk.** The two tokens are close enough that on a low-contrast display it may read as nothing at
all; and if they are pushed apart to fix that, the wordmark starts flickering between two colours,
which looks like a loading state. `--highlight-ink` is mixed with white, so check it against the
dark theme's page colour before assuming it lightens.

---

### 12. The Web Behind

**What the reader sees.** Behind the whole wordmark, an orb web builds itself in the order a real one
is built: first a single line across the top, then a rough frame hanging off it, then the radii
snapping in from the rim to the centre, and finally the spiral working *inward*, tightening. It is
faint — barely more than a watermark — and when it is finished it stays for a beat and fades.

**Why it belongs.** The build order is the point: a web is not drawn, it is *constructed in stages
that depend on each other*, which is exactly the pipeline that produced the article the reader is
looking at.

**Mechanism.** **New markup**: an inline SVG, `position: absolute; inset: 0; pointer-events: none;
opacity: .18; stroke: var(--rule-strong); fill: none`, sized to the ~120×44 control. Each element
gets `stroke-dasharray`/`stroke-dashoffset` self-drawing with sequenced `animation-delay` —
bridge 0 ms, frame 150 ms, eight radii 400 ms staggered 40 ms, spiral 800 ms. No trace of the *mark*
is needed; the web is drawn from scratch and is much easier geometry than the spider.

**Cost.** Hard — new markup in two components, and ~40 lines of SVG that has to be hand-drawn to look
like a web rather than a bicycle wheel.

**Risk.** It needs about 1.4 s to pay off and the median hover is shorter, so most readers see half a
wheel. And in the dock copy `overflow-y: hidden` clips anything the web extends above or below the
bar, so it has to fit inside 44 px of height, where an orb web is barely legible.

---

### 13. All Six at Once

**What the reader sees.** The mark trembles — a genuinely tiny, fast quiver, well under a pixel of
travel — and the letters nearest it tremble too, less and less as they go right, so that by the
`n` the motion is gone. It looks like the whole thing is alive and listening, not like anything is
happening to it.

**Why it belongs.** A spider at the hub holds a leg on every radius and reads all of them
simultaneously; this is the mark doing that, and it is the most *restrained* idea on the list.

**Mechanism.** `translate: 0 calc(var(--amp) * 1px)` keyframed at ~14 Hz on `.logo-image` and each
`.logo-letter`, with `--amp` falling from `0.5` on the image through `0.35`…`0.02` across the ten
`:nth-child` rules. Use `translate` (the independent property) rather than `transform` so it does not
collide with another animation's transform.

**Cost.** Easy — one keyframe, eleven amplitude declarations.

**Risk.** Subpixel high-frequency motion is the most likely thing here to read as a *rendering bug*
rather than an effect — some people will see text shimmer and assume the page is broken, and a few
will find it physically unpleasant. The motion guard covers the declared preference but not the
people who never set it.

---

### 14. Ball Unspools

**What the reader sees.** The spider rolls — tumbling, not spinning, because its legs are uneven —
and as it rolls it pays out a hairline of orange along the baseline of the word, so a thin underline
grows from S to n behind it. When the line reaches the end it stops, and the whole thing rewinds.

**Why it belongs.** A ball of yarn rolls and leaves a line, and the line it leaves here is an
underline under the product's own name.

**Mechanism.** `.logo-image { animation: roll 1.8s linear infinite }` on `rotate(0 → 360deg)`, plus
`.logo::after { position:absolute; left:calc(0.7rem + 24px); right:0.7rem; bottom:0.55rem; height:1px;
background: currentColor; transform-origin:left; transform: scaleX(0) }` animated `scaleX(0 → 1 → 0)`.
Both start and end at neutral, so the frozen frame is clean.

**Cost.** Medium — a pseudo-element with hard-coded offsets, and the roll and the line must finish
together or the gag dies.

**Risk.** The mark tumbling looks like the spider is being *thrown*, not like yarn unspooling — the
asymmetric legs make rotation read as physical distress. Reducing the rotation to ±25° instead of a
full turn fixes it and half-kills the idea; worth prototyping both.

---

### 15. Ballooning

**What the reader sees.** The spider lifts a few pixels, tilts as if caught by air, and drifts very
slowly and irregularly — never far, never fast — with a single fine thread trailing below and behind
it that wavers as it goes. It never actually leaves.

**Why it belongs.** Spiderlings disperse by releasing silk and floating off on an electrostatic
charge, which is a lovely fact and, more usefully, the gentlest possible motion — for the copy in the
corner, which is fixed over real content, gentlest is a virtue.

**Mechanism.** `.logo-image { animation: balloon 4s ease-in-out infinite }` on
`translate: 0 -3px` + `rotate: -5deg` with an intermediate keyframe at 35% that moves *sideways*
1 px, so the path is not a straight line. The tether is a `.logo::before` 1 px line below the image
with its own slower `rotate` about `transform-origin: top`.

**Cost.** Easy — around fifteen lines, no per-letter work.

**Risk.** In the dock copy the trailing thread points down out of a bar that is
`overflow-y: hidden`, so it is cut off at the bar's edge and reads as an artefact; either shorten it
to fit inside 44 px or skip the tether in `.dock-home` and keep it in `.logo-home`.

---

## The five nobody would have guessed

### 16. The Bridge Line

**What the reader sees.** A thread pays out to the right from the spider, loose and waving, hunting
across the top of the word — it overshoots, sags, hunts again — and then it *catches* on the final
`n` and snaps taut, and only at that instant do the ten letters brighten, one after another, as if
they were always hanging off it and just got hung.

**Why it belongs.** An orb weaver's first act is to throw silk into the wind until it snags something
across a gap; every other thread in the web hangs from that one line. The word here is being
*founded*, not decorated, and it is the only idea on the list where the letters are subordinate to
the thread.

**Mechanism.** `.logo::before` — `position:absolute; top:0.6rem; left:calc(0.7rem + 20px); height:1px;
right:0.7rem; background: currentColor; transform-origin: left` — animated on **two** properties:
`scaleX` 0 → 1.05 → 1 (the throw and the snap taut) and `rotate` ±1.5deg with a couple of
intermediate keyframes (the hunting), over ~700 ms `cubic-bezier(.2,.8,.2,1)`. Then the letters:
`opacity: .5 → 1` with the shared ten-letter stagger at 30 ms and
`animation-delay: calc(700ms + var(--i))`.

**Cost.** Medium — a pseudo-element, two co-ordinated timelines, and the stagger.

**Risk.** **It is a sequence, and the payoff is at 900 ms.** A reader who brushes past for 300 ms
sees a line wobble and the word go dim, which is strictly worse than nothing. Either accept that it
rewards a real pause (which is arguably on-brand), or start the letters at full opacity and have the
snap *overbrighten* them instead — safer, less good.

---

### 17. Stronger Than Steel

**What the reader sees.** The row of letters takes a weight. It sags — a proper smooth catenary, the
middle letters dropping about 3 px, the outer ones barely at all, the curve unmistakably the shape a
hanging line makes and not a wave. It holds the load for a moment, and then springs back level with a
faint overshoot, as if it was never going to break.

**Why it belongs.** Silk is stronger than steel by weight, and this is that fact as a physical
demonstration on the product's own name: put a load on it, it bends and does not fail.

**Mechanism.** No stagger at all — every letter runs the *same* keyframe at the *same* time, and the
curve comes from a per-letter offset: ten `:nth-child` rules setting `--sag` to a hand-tabulated
parabola (`0, .45, .78, .96, 1, 1, .96, .78, .45, 0`), and
`sag { 0%,100% { translate: 0 0 } 45% { translate: 0 calc(var(--sag) * 3px) } 70% { translate: 0 calc(var(--sag) * -0.6px) } }`.
Because there is no stagger it costs ten declarations and one keyframe, and it is *exactly*
symmetrical, which is what makes it read as physics rather than as animation.

**Cost.** Easy — one keyframe and a table of ten numbers.

**Risk.** A sagging baseline is one badly-chosen number away from looking like a drunk font. The
curve must be a real catenary shape and it must return to *precisely* zero — and since the motion
guard freezes frame one, `0%` being exactly neutral is doing load-bearing work here.

---

### 18. Moulting

**What the reader sees.** For a second there are two spiders. A pale, motionless ghost of the mark
stays exactly where the mark was, and the real one steps up and to the right out of it, orientating
itself; then the ghost thins out and is gone, and the real one settles back into place. It is quiet
and slightly uncanny.

**Why it belongs.** A spider grows by climbing out of its own skin and leaving a perfect empty copy
behind — an old shape you have outgrown but which is still exactly the shape you were. That is
re-reading something you thought you understood, and it is the only idea here that is about the
reader changing rather than the text.

**Mechanism.** You cannot put a pseudo-element on an `<img>`, so the ghost is `.logo::before`:
`position:absolute` over the image's slot, `mask-image: url(/spideryarn-logo.png);
mask-size: 20px 20px; background: currentColor; opacity: 0`, animated `0 → .3 → 0`. The real
`.logo-image` runs `translate: 3px -2px` and a 4° rotate out and back on a slower, softer ease. No
SVG trace — the mask does it all.

**Cost.** Medium — one masked pseudo-element, two animations, one hard-coded position.

**Risk.** Two overlapping copies of a logo is *precisely* what a double-paint or compositing bug
looks like, and the ghost has to be faint enough to read as intentional and strong enough to be
visible at 20 px, which may be an empty interval. The 3 px separation at this size is also close to
"the logo is just blurry".

---

### 19. Stabilimentum

**What the reader sees.** A bold zigzag writes itself across the middle of the wordmark, corner to
corner, in three or four quick strokes — thicker than a thread, clearly deliberate — pauses as if
signed, and fades. It sits *over* the letters without obscuring them.

**Why it belongs.** Some orb weavers write a heavy zigzag of silk across the middle of the web —
called a stabilimentum — and after a century of argument nobody agrees what it is for. It is a
spider making a mark on its own work whose purpose is not settled, which is the most honest thing
this product could say about itself while it is still an experiment.

**Mechanism.** No SVG needed. `.logo::after` spanning the control, `background:
repeating-linear-gradient(-52deg, currentColor 0 1.5px, transparent 1.5px 9px)`, `opacity: .35`,
`mix-blend-mode: multiply` (or `screen` in dark — set via the theme block), revealed by an animated
`mask-image: linear-gradient(90deg, #000, transparent)` whose `mask-position` sweeps left to right
over 500 ms, then the whole thing fades on `opacity`. `pointer-events: none`.

**Cost.** Medium — a pseudo-element, a gradient that has to be tuned to look hand-drawn rather than
like hatching, and a per-theme blend mode.

**Risk.** It is **scribbling over your own logo**, and one notch too opaque or one degree too regular
and it stops being a signature and becomes a redaction. Also `mix-blend-mode` on a `position: fixed`
element with a `z-index` can force a new stacking context — check the corner copy still sits above
the spine.

---

### 20. Washing Line

**What the reader sees.** The spider leaves its slot and walks along the top of the word, left to
right, and the row of letters *sags under it as it passes* — each letter dipping a pixel or two as
the spider arrives over it and lifting again as it moves on, so a small travelling dent follows the
spider across the word. At the `n` it turns round and walks back, and the dent goes with it.

**Why it belongs.** The ten letters sitting in a row are a horizontal thread, and this is the only
idea that treats them as a thing with *tension* that something can stand on — the name becomes the
web rather than a label next to one.

**Mechanism.** `.logo-image { animation: walk 3s ease-in-out infinite alternate }` on
`translate: 0 → 92px` (and a 1 px vertical bob at ~6 Hz for the gait, as a second, faster keyframe on
`rotate` to avoid fighting over `translate`). The dent is the ten-letter stagger again, but with a
*short* duty cycle — `dip { 0%, 12%, 100% { translate: 0 0 } 6% { translate: 0 2px } }` at the same
3 s duration, delays spread evenly 0 → 270 ms, so each letter dips only while the spider is above it.
The two timelines share one duration, which is what keeps them locked.

**Cost.** Medium — two co-ordinated animations, the ten delays, and a `translate` distance that has to
be measured against the real rendered word rather than guessed.

**Risk.** The mark travels over the letters, so at some point it is sitting on top of a glyph and the
control looks obstructed; and 92 px is a specific number that goes wrong the moment the font metrics
or the `0.4rem` gap change. It is also, frankly, a lot of motion for a link you look at fifty times a
day — this is the one on the list most likely to be adored the first week and disabled the second.

---

## Honest summary of what needs an SVG trace

- **Needs a proper centreline trace** (the expensive kind, and an autotrace will not do): #6 Silk
  Draws Itself, and the true version of #4 The Knot Tightens.
- **Needs new SVG markup but not a trace of the mark**: #12 The Web Behind.
- **Everything else works on the PNG as it stands** — and #3 Radius Sweep, #18 Moulting and #19
  Stabilimentum are specifically designed to get effects that *look* like they need a trace out of
  `mask-image` and a gradient instead. If the trace is refused, those three are where the vein still
  pays.

The cheapest three with the best ratio of effect to lines are **#17 Stronger Than Steel**, **#1 Pluck
the Thread** and **#11 Two-Ply** — all Easy, all pure keyframes, none of them needing a pseudo-element
or a hard-coded offset that can drift.
