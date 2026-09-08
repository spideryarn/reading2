# Longlist: logo animations — the wildcards

One of eight parallel longlists generated on 2026-09-07 against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md). **My framing was the
wildcards**: the surprising, the playful, the ideas nobody asked for. The reasoning I was given is
that a random picker over a dozen animations can afford one or two that are *rare* — an effect seen
one hover in fifty is more delightful than one seen every time, because the reader is not sure they
saw it — and that a held gesture (Greg's long-click) has a shape no hover effect can have: it can
build while you hold and resolve when you let go. So these push on rarity as a mechanic,
context-awareness (the clock, the visit count, where the reader came from, which direction the
cursor entered from), physical comedy at 20 pixels, breaking the frame, genre pastiche, the second
hover, and the deliberately anticlimactic. Taste is somebody else's pass; each idea carries an
honest note on whether it would survive a researcher seeing it mid-session, and several would not.

Two conventions I use beyond the brief's format:

- **Rarity** — how often the picker should be allowed to choose it. `Every time` means it belongs
  in the ordinary rotation; `1 in 50` means it needs a weighted picker (`Math.random()` against a
  weight table, three lines) and a reader who sees it should doubt their own eyes.
- **Serious session?** — would this be fine over a researcher's shoulder at 3pm on a Tuesday, when
  they are three hours into a hard paper and did not ask to be entertained.

A note on rarity that applies to the whole list: the picker must be **stateless about the outcome**
and stateful only about counts. Never make a rare animation *guaranteed* on the fiftieth hover in a
visible way, because the reader who works it out stops being surprised and starts being managed —
which is uncomfortably close to the streaks and nudges in
[vision.md § Anti-goals](../project/vision.md#anti-goals). Weighted random, and no counter the
reader can see.

---

## 1. The Long Wind-Up

**What the reader sees** — Hold the mark down and it starts to brace: the spider sinks a fraction,
tilts, and tightens; the ten letters lean in behind it like a queue about to be flung; over four
seconds it is unmistakably building to *something*. Let go, and everything relaxes back to exactly
where it was in a tenth of a second. Nothing happened.

**Why it belongs to this product** — Spideryarn's whole argument is against the theatrical shortcut
that promises to deliver the piece and delivers nothing; a wind-up with no payoff is the same joke
told about itself.

**Mechanism** — Long-press only. `pointerdown` on `.logo` adds `.logo--winding`; `pointerup` /
`pointercancel` / `pointerleave` removes it. One 4s `ease-in` keyframe on `.logo--winding
.logo-image` (`transform: scale(0.94) rotate(-6deg) translateY(1px)`) and a second on
`.logo--winding .logo-letter` with a per-letter `animation-delay: calc(var(--i) * 18ms)` (skew
`-4deg`, `translateX(-1px)`); `--i` set inline in both `HomeLogo.tsx` and `Dock.tsx` where the
letters are already mapped with an index. Removing the class drops back to the resting rule with
`transition: transform 120ms ease-out`. Safe at one frame because the resting state is untouched.

**Cost** — Medium (a dozen lines of CSS, plus ~15 lines of pointer handling and the `--i` index).

**Risk** — A reader who holds it a second time expecting a payoff and gets none twice will read it
as broken rather than as a joke; the gag needs the release to be *crisp* and slightly funny in
itself, not just an absence.

**Rarity** — 1 in 12 (long-press rotation only). **Serious session?** Yes — it is entirely silent
and entirely inside the control.

---

## 2. Charge and Release

**What the reader sees** — Press and hold, and a warmer orange floods the word from the `S`
rightwards at a steady rate, like a fuse; when it reaches the final `n` the whole mark gives one
soft pulse and settles. Let go early and the colour drains back the way it came.

**Why it belongs to this product** — A held gesture that *shows its own duration* is the only
honest kind of progress indicator, and progress you can see and abandon is the interaction model of
the whole reading view.

**Mechanism** — The one idea here that genuinely needs the held gesture. `.logo--held` sets
`--charge: 1` and the letters read `color: color-mix(in oklch, var(--ink), var(--highlight)
calc(var(--charge) * 100%))` — but per-letter, so it is a front rather than a fade: give each
`.logo-letter` a `transition-delay: calc(var(--i) * 90ms)` on `color`. Release removes the class and
the same transition runs backwards, delays reversed via a second class. `@property --charge` is not
needed if the delay ladder does the work. Ten letters × 90ms = 900ms to full.

**Cost** — Easy-to-Medium (the CSS is ~20 lines; the pointer handling is shared with #1).

**Risk** — On the dock copy the word is subject to the bar's fit ladder and may be showing fewer
letters or none, in which case the fuse has nothing to burn along — it must degrade to a plain
mark pulse rather than looking stuck.

**Rarity** — Every time (this is the sensible default for long-press). **Serious session?** Yes.
This is the one from my lane I would ship to a stranger.

---

## 3. Startled

**What the reader sees** — Whichever edge your cursor crosses, the spider bolts away from it —
enters from the left and it scuttles right, enters from below and it hops — hits the far side of its
own 20px box, flattens against it for a beat, then creeps warily back to centre.

**Why it belongs to this product** — It is the only animation in the set that knows something about
*you* rather than about itself, which is the same trick as a reading tool that knows where you are
in the argument.

**Mechanism** — `pointerenter` handler compares `event.clientX/Y` to `getBoundingClientRect()` and
sets one of four classes (`.logo--flee-e/w/n/s`) on `.logo`. Each is a 900ms keyframe on
`.logo-image` — a fast `translateX(6px)` in 120ms, a 300ms hold with `scaleY(0.85)`, then a
`cubic-bezier` creep home. Max 6px of travel, so nothing leaves the box or moves the layout.

**Cost** — Medium (four keyframe sets, or one with a `--dx/--dy` pair set inline; ~15 lines of JS).

**Risk** — Direction detection on a fast diagonal entry is a coin flip, and a spider that flees
*towards* the cursor reads as a bug rather than as timidity; snap to the dominant axis and accept
the ties.

**Rarity** — Every time. **Serious session?** Yes — 6px of motion inside a 20px box is nothing.

---

## 4. The Letters Don't Care

**What the reader sees** — The spider has some kind of episode — it spins twice, overshoots, wobbles
to a halt slightly off-centre, and rights itself with visible effort. The ten letters do not move a
pixel. They do not acknowledge it.

**Why it belongs to this product** — The joke is deadpan and it is carried entirely by restraint,
which is the register the rest of the product is written in.

**Mechanism** — The cheapest idea in this list. One keyframe on `.logo .logo-image` only:
`rotate(0 → 720deg)` over 700ms with an overshoot easing, then a 200ms damped `rotate(±4deg)`
wobble, ending at `rotate(720deg)` — which is visually identical to the resting `0deg`, so the
reduced-motion freeze is safe at any frame. No selector touches `.logo-letter` at all; the restraint
is the implementation.

**Cost** — Easy.

**Risk** — At 20px a full rotation of a radially symmetric mark is nearly invisible — the six legs
mean it reads as a shimmer, not a spin. It may need the overshoot exaggerated, or a deliberate 15°
final offset held only while hovered, to be legible at all.

**Rarity** — Every time. **Serious session?** Yes.

---

## 5. Played Dead

**What the reader sees** — Hover the mark for the fifth time in a minute and the spider gives up:
it flips onto its back, legs up, and lies there. It stays flipped for as long as you hover, and
rights itself only once you have left it alone.

**Why it belongs to this product** — A tool that is meant to be lived in for hours should be
allowed one moment of being visibly tired of you.

**Mechanism** — A module-level counter in `HomeLogo.tsx`/`Dock.tsx` (in-memory, per page load, not
`localStorage` — this is a *this-minute* joke, not a lifetime one) with a rolling 60s window. Above
threshold, `.logo--dead` runs a 400ms keyframe: `rotate(180deg) translateY(2px)` with a small
bounce, then holds. Removed on `pointerleave` with a 250ms transition back. The mark's flat colour
means "on its back" is conveyed by the flip alone, which may not be enough — see the risk.

**Cost** — Medium (counter plus timing window; the CSS is a dozen lines).

**Risk** — A silhouette with six symmetric legs looks *the same upside down*. Without an SVG trace
that gives the legs a bend, "played dead" may read as "nothing happened", which kills the entire
gag. Honest verdict: this idea probably requires the SVG trace the brief warns about, and is not
worth that on its own — but it is nearly free if some other idea pays for the trace first.

**Rarity** — Conditional rather than random. **Serious session?** Yes, if it reads at all.

---

## 6. Spideryawn

**What the reader sees** — Somewhere around one hover in fifty, and only in the small hours, the `r`
in the wordmark quietly becomes a `w` for about a second, and then is an `r` again. The word said
*spideryawn*. You are not certain it did.

**Why it belongs to this product** — This is the screenshot-and-send-to-a-friend one, and the reason
to build a weighted picker at all: a joke that most readers will never see, and that the ones who do
see will not be able to prove.

**Mechanism** — **Do not change the letter's text**, which would reflow the dock's flex row (`w` is
wider than `r`). Instead give the seventh `.logo-letter` a `position: relative` and an
`::after { content: 'w'; position: absolute; inset: 0; }` that is `opacity: 0` at rest; the
animation cross-fades `color: transparent` on the letter itself against `opacity: 1` on the
pseudo-element over 200ms, holds 900ms, and crosses back. Zero layout effect because the
pseudo-element is out of flow. Gate on `new Date().getHours() < 5` in the picker's weight table, and
weight it to ~2%.

**Cost** — Medium (the pseudo-element and the cross-fade are easy; the weighted, clock-gated picker
is the real work, and every other rare idea then shares it).

**Risk** — A reader who *does* catch it may reasonably wonder whether the app renders their text
wrong elsewhere; the swap must be slow enough to read as deliberate and not fast enough to read as
a glitch. Also: it is a pun, and it is 3am, and those two facts are related.

**Rarity** — ~1 in 50, and only 00:00–05:00 local. **Serious session?** Nobody serious is working
at 4am. That is the point, and it is also the excuse.

---

## 7. Night Patrol

**What the reader sees** — After midnight the word stays dim on hover while the spider brightens
and takes a slow walk along the baseline beneath the letters, left to right and back, at a pace
suggesting it has all night. During the day it does none of this.

**Why it belongs to this product** — A reading tool is used at strange hours by people who have lost
track of the time, and it is nice to be acknowledged by something.

**Mechanism** — Clock-gated class `.logo--nocturnal` set once on mount. `.logo-image` gets a 3.2s
`alternate infinite` keyframe of `translateX(0 → var(--word-w))` where `--word-w` is read from the
letters' container width at mount (JS, one `getBoundingClientRect`) — or, simpler and layout-proof,
a fixed `translateX(0 → 70px)` on the corner copy and disabled on the dock copy where the word's
width is not fixed. Letters get `opacity: 0.7` while nocturnal, restored on `pointerleave`.

**Cost** — Medium (Hard if the walk is to be width-aware in both DOM shapes).

**Risk** — The mark leaving its 20px slot to travel across the word means it is briefly *on top of*
the letters; at 20px over a 0.82rem word that is a smudge. It probably needs to walk *below* the
baseline, which costs vertical room the dock copy does not have — so this is corner-copy-only, and
must be declared as such.

**Rarity** — Every time, between midnight and 5am. **Serious session?** Yes, and gently pleasant.

---

## 8. Abseil

**What the reader sees** — The final `n` detaches from the word and drops on a single thread of
yarn, hanging maybe ten pixels below the baseline, bobbing on the line's own springiness. After a
moment it is reeled smoothly back up and re-joins the word as though nothing happened.

**Why it belongs to this product** — A wordmark literally made of thread should be allowed to
demonstrate the property once.

**Mechanism** — The last `.logo-letter` gets `display: inline-block; position: relative` and a
`::before` thread — a 1px-wide `background: var(--rule)` pseudo-element anchored at the letter's top,
`transform-origin: top`, `scaleY` animated 0 → 1 in step with the letter's `translateY(0 → 10px)`.
A spring easing (`cubic-bezier(.34,1.56,.64,1)`) on the drop and a plain `ease-in-out` on the reel
back. Total cycle 1.4s, ending exactly at rest.

**Cost** — Medium.

**Risk** — **This is the frame-breaking one and it collides with the brief's rule directly.** Ten
pixels below the baseline is outside the control's box: on the corner copy that is empty fixed space
and fine, but the dock copy sits *inside a bar* and will be clipped by the bar's overflow — the `n`
would visibly vanish, which is worse than not running. Ship it corner-only, or invert it in the dock
so the letter rises instead of falls (which is a worse joke, because gravity is the joke).

**Rarity** — 1 in 8. **Serious session?** Yes.

---

## 9. Cursor Tether

**What the reader sees** — While you hover, a single hairline of yarn runs from the spider to your
cursor and stays attached, stretching and swinging as you move, with a slight lag as though it has
weight. Move away and it lets go, and the loose end whips back into the mark.

**Why it belongs to this product** — Of everything here this is the one that is not a joke at all:
it is the mark asserting that it is made of thread, and that the thread reaches the reader.

**Mechanism** — Genuinely needs JS, and is the only idea here where I think that is justified. One
absolutely-positioned 1px `div` inside `.logo` (`background: var(--highlight)`, `opacity: 0.5`,
`transform-origin: 0 0`, `pointer-events: none`), updated in a `pointermove` handler with
`transform: rotate(θ) scaleX(d)` computed from the pointer's offset — one `requestAnimationFrame`
coalesced write per frame, with the target lerped ~0.2 towards the true cursor for the lag. Capped
at `d < 60px` so it cannot streak across the page. On `pointerleave`, a 200ms `scaleX(0)` transition.

**Cost** — Hard (JS, ~40 lines, plus the rAF discipline).

**Risk** — Two. A line following the cursor is *the* effect that looks cheap when it is a frame
behind, so the lerp has to be a deliberate weight rather than accidental jank. And a stray element
under the cursor is a hit-testing hazard — `pointer-events: none` is mandatory and easy to forget.
It also does nothing at all on touch, where the long-press lives.

**Rarity** — Every time. **Serious session?** Yes, and arguably it should not be a wildcard at all.

---

## 10. The Beachball That Doesn't

**What the reader sees** — The mark spins up like a loading indicator and the ten letters go grey
and empty, as though the wordmark itself is fetching — and then, before you can register that you
are waiting, it is finished. The whole performance takes 350ms.

**Why it belongs to this product** — The joke is precisely Spideryarn's pitch: the point is not to
make the article shorter, it is to make the wait for understanding disappear.

**Mechanism** — Two staggered keyframes. `.logo-image` gets `rotate(0 → 540deg)` over 350ms with a
hard `cubic-bezier(.2,0,0,1)` decelerate so it *lands* rather than stops. `.logo-letter` gets
`color: var(--rule) → var(--highlight)` with `animation-delay: calc(var(--i) * 22ms)`, so the word
fills in left to right behind the spin and completes just after it. Ends at rest.

**Cost** — Easy.

**Risk** — Genre pastiche only works if the reference is unmistakable, and at 20px a spinning
six-legged silhouette does not obviously read as "spinner". If it fails to land the reference it is
just a spin, which the set already has.

**Rarity** — 1 in 12. **Serious session?** Yes.

---

## 11. Broken Image

**What the reader sees** — For about 120 milliseconds the logo is the browser's broken-image icon —
the torn page, the little grey box — and then it is the spider again, with no acknowledgement.

**Why it belongs to this product** — Nothing about the product. It belongs to the *set*, as the one
that is purely a software in-joke, and it is the funniest idea in this list.

**Mechanism** — A pseudo-element on `.logo` drawn as a 20×20 inline-SVG `data:` URI approximating
the broken-image glyph in `var(--rule)`, cross-fading over the real image for 120ms. **Never
actually break the `src`** — an `onerror` path or a real 404 would poison the browser cache and
could leave the mark broken permanently.

**Cost** — Easy (Medium if the fake glyph has to look convincing in both themes).

**Risk** — **This is the one that should probably not ship, and I want that on the record.** A
researcher three hours into a hard paper who sees the app's own logo break for a moment does not
think "ha"; they think "is this thing about to lose my notes?", and the correct response to that
thought is a support email. It is a joke about software failure told inside software that is
holding the reader's work. Keep it in the longlist because it is genuinely funny and because it
might be right at 1 in 200 — but it is the first thing I would cut.

**Rarity** — 1 in 200, if at all. **Serious session?** **No.** Actively harmful there.

---

## 12. The Progress Bar That Gives Up

**What the reader sees** — A hairline bar appears under the wordmark and races to about 90%, then
slows, then crawls, then spends a long moment at what is visibly 97% — and then simply fades away,
never having finished. The word is unchanged.

**Why it belongs to this product** — Every reader of long difficult things knows the feeling of a
progress bar that lies, and this one at least admits it.

**Mechanism** — An `::after` on `.logo`, `position: absolute; bottom: 0; left: 0; height: 1px;
background: var(--highlight); transform-origin: left; transform: scaleX(0)`. One keyframe with
deliberately uneven stops — `0% {0} 25% {.9} 60% {.94} 92% {.97} 100% {.97}` — over 3.5s, with
`opacity` dropping to 0 in the last 300ms. Absolutely positioned, so no layout effect; the 1px sits
inside the control's existing padding in both DOM shapes.

**Cost** — Easy.

**Risk** — Three and a half seconds is a long time for a hover flourish, and a reader who leaves at
one second sees only a bar that filled — which is not the joke, it is just a bar. The gag only lands
for someone who stays, which makes it a poor citizen of a random set unless the hover is likely to
be long. Also, a progress bar under a *link* invites the reading "the page is loading", which is a
worse misunderstanding than #11's.

**Rarity** — 1 in 20. **Serious session?** Borderline — it briefly imitates a system state.

---

## 13. The Second Hover

**What the reader sees** — The first hover is ordinary: the spider brightens, the word warms. Leave,
come back within about ten seconds, and the spider is at the *other end* of the word, on the far
side of the `n`, apparently having strolled there while you were not looking, and behaving as though
that is where it has always been.

**Why it belongs to this product** — An animation that remembers you were here a moment ago is the
smallest possible version of the thing the whole app does.

**Mechanism** — A per-component timestamp of the last `pointerleave`. If the next `pointerenter` is
within 10s, add `.logo--moved`, which applies a `translateX` equal to the word's width to
`.logo-image` **instantly, with no transition** — the comedy depends on never seeing it travel — and
a matching negative `translateX` to the letters' wrapper so the whole control's ink stays inside its
box. Because the wrapper class differs between the two DOM shapes, this must select the letters
themselves (`.logo-letter`) rather than the wrapper, per the brief's trap.

**Cost** — Medium (Hard in the dock, where the word's width is decided by the fit ladder at runtime
and cannot be a constant).

**Risk** — Moving both the mark and the letters without a reflow is fiddly, and a half-pixel error
shows up as a visible jump on a control the reader looks at constantly. Get it wrong and the corner
of the app twitches.

**Rarity** — Conditional (second hover within 10s). **Serious session?** Yes — it is silent and
still.

---

## 14. Homecoming

**What the reader sees** — If you have just come back to the shelf from an article, the spider is
carrying something: a single small dot of highlighter-orange that travels with it, and on hover it
walks the dot up to the `S`, sets it down, and the dot soaks into the letter and is gone.

**Why it belongs to this product** — It says the thing the product's whole shelf is for — that you
brought something back from the reading — without a word of copy.

**Mechanism** — Context comes from the router: the shelf already knows whether navigation arrived
from a reading view, so pass a boolean into `HomeLogo` and let it set `.logo--carrying`. The dot is
an `::before` on `.logo-image` (4px, `border-radius: 50%`, `background: var(--highlight)`) animated
along a short `translate` path to the first letter over 700ms, then `scale(0) opacity(0)` while the
first `.logo-letter` takes a 300ms `text-shadow: 0 0 6px var(--highlight)` bloom and releases it.

**Cost** — Medium (the CSS), plus whatever plumbing the "arrived from an article" bit costs — check
before promising it is cheap.

**Risk** — Ties a cosmetic flourish to routing state, which is a coupling that will rot the first
time navigation changes; and the meaning ("you brought something back") is legible only to someone
who is told, which makes it decoration wearing a metaphor.

**Rarity** — Every time, in that one context. **Serious session?** Yes.

---

## 15. Waking Up

**What the reader sees** — If the page has been sitting untouched for a few minutes, the mark is
dimmer than usual and rising and falling very slightly, asleep. Your hover does not snap it awake:
it takes most of a second to come up to full brightness, and then gives one small shake as if
getting its bearings.

**Why it belongs to this product** — The delay is the whole idea — a thing that takes a moment to
come round is more alive than a thing that responds instantly, and this app is built for long sits.

**Mechanism** — An idle timer (`pointermove`/`keydown`/`scroll` reset, 5 min) toggles `.logo--asleep`
on `.logo`: `opacity: .55` plus a 4s `alternate infinite` `scale(1 → 1.04)` breath on `.logo-image`.
On `pointerenter` while asleep, swap to `.logo--waking`: an 800ms `ease-out` opacity climb followed
by a 250ms three-step `rotate(±5deg)` shake, then remove both classes. Every state ends at the
resting transform.

**Cost** — Medium (the idle timer is the fiddly part, and it should be shared, not per-component).

**Risk** — A dim logo is indistinguishable from a *disabled* logo, and this is the app's way home;
a reader who reads "asleep" as "unavailable" has been actively misled by a decoration. The floor of
0.55 opacity may be too low to be safe.

**Rarity** — Conditional (after 5 min idle). **Serious session?** Yes, but see the risk — this is
the one most likely to be misread as a state rather than a mood.

---

## 16. Overcaffeinated

**What the reader sees** — The spider vibrates. Not a wobble, a genuine high-frequency buzz, for
about half a second, with the letters catching a sympathetic sub-pixel jitter — and then it stops
dead, holds absolutely still for a beat, and settles by a degree or two, embarrassed.

**Why it belongs to this product** — The pause after is the joke, and the pause after is also what
the product is: the moment where the noise stops and you can think.

**Mechanism** — `.logo-image` gets a 60ms `steps(2)` `infinite` keyframe of `translate(±0.5px,
±0.5px)` running for 500ms via `animation-iteration-count`, then a second 400ms animation
(`animation-delay: 500ms`) that does nothing but `rotate(0 → 2deg → 0)` slowly. `.logo-letter` gets
the same jitter at a third of the amplitude and a 30ms stagger so the word shivers rather than
shakes as a block.

**Cost** — Easy.

**Risk** — Sub-pixel jitter on text is the single most reliable way to make an interface look cheap,
and on a low-DPI external monitor it will alias into visible mush. If the letters have to be
excluded, half the joke goes with them.

**Rarity** — 1 in 20. **Serious session?** Marginal — it is the most visually irritating idea here.

---

## 17. The Fiftieth

**What the reader sees** — Once, and rarely, the spider walks the length of the wordmark and every
letter it passes unravels behind it into a loop of loose yarn; it reaches the end, turns, walks back,
and re-knits each letter in reverse order, and by the time it is home the word is exactly as it was.
Two and a half seconds, and it will probably not happen again this month.

**Why it belongs to this product** — It is the mark performing the product's actual claim: the text
comes apart into structure and goes back together, and nothing is lost.

**Mechanism** — The showpiece, and the expensive one. Needs the **SVG trace** the brief describes,
so the letters can be replaced by a `stroke-dasharray` path that draws itself out and back
(`stroke-dashoffset` animated per letter, `animation-delay: calc(var(--i) * 120ms)` outbound and
`calc((9 - var(--i)) * 120ms)` return). Each letter's glyph would need a traced path — ten paths,
one time, a designer's afternoon — held in a single inline `<svg>` overlaid on the real letters and
revealed only for this animation, with the real letters `color: transparent` for the duration.

**Cost** — Hard. New markup, an SVG trace of ten glyphs plus the mark, and a second copy of the
wordmark to keep in sync — exactly the scope creep
[the brief warns about](260907f-logo-animations-brief.md#what-the-previous-version-had-do-not-simply-re-list-these).

**Risk** — The cost is the risk: this is one animation costing more than the other seventeen
combined, for something almost nobody will see. **My honest recommendation is to build it only if
the SVG trace is being done anyway for another reason** — and to notice that "almost nobody will
see it" is either the entire justification or the entire objection, depending on the day.

**Rarity** — 1 in 100. **Serious session?** Yes, and it is the one someone would screenshot.

---

## 18. Drum Roll, Nothing

**What the reader sees** — The letters rise one after another into a shallow arc, the way a wave
goes through a crowd, until all ten are aloft and hanging there a fraction too long — and then they
drop, all at once, back into the line they started in, with a small compression on landing. That is
the entire event.

**Why it belongs to this product** — It is the second and better anticlimax: the first (#1) refuses
to start, this one refuses to *mean* anything, and a set that contains both is making a point.

**Mechanism** — `.logo-letter { display: inline-block }` (it is inline today — the brief flags this)
and one 1.5s keyframe: `translateY(0 → -5px)` over the first 45% with `animation-delay: calc(var(--i)
* 55ms)`, a hold, then a shared drop — achieved by making the *rise* staggered and the *fall* part of
a second, unstaggered animation triggered by `animation-delay` arithmetic so all ten land together.
Landing is `scaleY(0.88)` for 80ms and out. Ends at rest.

**Cost** — Medium (getting ten staggered rises to fall in unison is the whole difficulty, and may be
easier with a `steps()`-free two-animation approach than with one keyframe).

**Risk** — Five pixels of vertical travel is within budget in the corner but the dock copy sits in a
bar with its own tight vertical rhythm; if it clips, the wave has no crest and the animation is a
twitch. Check the bar's actual `overflow` before promising it works in both.

**Rarity** — 1 in 12. **Serious session?** Yes.

---

## Notes for whoever prioritises this

- **Three of these share one piece of infrastructure**, and it is small: a weighted picker with a
  handful of contextual predicates (hour of day, hovers-this-minute, ms-since-last-leave,
  idle-since, arrived-from-article). That is maybe 40 lines and it is the difference between a set
  that is random and a set that appears to know things. Build it once, or build none of them.
- **Two ideas are honest about needing the SVG trace** (#5 Played Dead, #17 The Fiftieth) and
  neither justifies it alone. If the trace happens for some other reason, both become cheap.
- **Two collide with the brief's overflow rule** and I have said where: #8 Abseil needs ~10px below
  the baseline and is corner-copy-only; #7 Night Patrol needs to walk below the word and is the
  same. Neither should be fudged into the dock.
- **One should probably not exist** (#11 Broken Image) and it is in the list because the brief said
  not to self-censor. It is the funniest and the most likely to generate a support email, and those
  are the same property.
- **Everything here ends at the resting state**, so the global reduced-motion flatten leaves the
  mark correct at one frame. The two that do not by construction — #5 Played Dead, which *holds*
  upside down, and #13 The Second Hover, which *holds* displaced — both need an explicit
  `prefers-reduced-motion` opt-out rather than relying on the guard, and that is a real cost against
  them.
