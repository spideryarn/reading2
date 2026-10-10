# Longlist: more wordmark animations from spider behaviour, yarn, and motion craft

Up: [261010p-more-logo-animations.md](261010p-more-logo-animations.md)

The lane: what real spiders do, what yarn and looms do, and the old character-animation principles
(anticipation, squash and stretch, follow-through, a contact shadow) that make 20px of orange read
as a creature rather than an icon. Eight of the twelve are **mark-only**, because on a phone the
spider is all there is.

## What the mark actually is, looked at again

`public/spideryarn-logo.png` is 1203 × 1272 and bilateral, not radial: two **forelegs raised** (tips
at roughly 26% / 3% and 75% / 3%, meeting the body loop at roughly 43% / 32% and 55% / 32%), two
**mid legs** splayed out sideways (the left one running down to the body, the right one up and
out), two **hind legs** down, and a knotted loop where a body would be. Three consequences used
below:

- **The forelegs are separable.** Each sits in its own clear upper quadrant with nothing else
  crossing it, so a polygon `clip-path` can lift one out — the first idea here that moves *part* of
  the spider without an SVG trace (§ 1).
- **Upside down is not the same picture.** The 260907f shortlist measured IoU 0.34 at 180° — so a
  flip is visibly a flip, which reopens Played Dead on different grounds (§ 6).
- **A mirror (`scaleX(-1)`) is nearly the same picture**, so a turn-around reads as the spider
  turning rather than the icon changing (§ 8).

Prior art checked: the 260907f spider list already had Ballooning, Moulting, Dropped Stitch,
Unravel, Two-Ply, Ball Unspools and Stabilimentum, and the wildcards had Played Dead and Startled;
none of those is re-proposed except Played Dead, deliberately, in § 6. Heavy Landing (a near-miss)
is the ancestor of § 3, and § 3 says what is different.

---

## Mark

### 1. Semaphore

**Reach:** mark.

**What the reader sees.** One raised foreleg lifts higher and waves — twice, quick, like a peacock
spider flagging at a female — then the other answers, and both settle. The rest of the spider is
perfectly still. It is the first time the mark has had a *limb*.

**Why it's Spideryarn.** Peacock and jumping spiders court with legs-as-flags: a signal sent
deliberately, at the reader, and the mark becomes a character that greets you.

**CSS mechanism.** Two pseudo-elements on `.logo-mark`, `inset: 0`, `background: var(--highlight)`,
`mask: url(/spideryarn-logo.png) center / 100% 100% no-repeat` (Radius Sweep's overlay, exactly), each
`clip-path: polygon(…)`ed down to one foreleg's quadrant — left roughly
`polygon(16% 0, 50% 0, 47% 31%, 38% 31%)`, right its mirror. Meanwhile `.logo-image` gets the
complementary cut-out, `clip-path: polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, <left
leg poly>, <right leg poly>)`, so the real legs vanish under the painted copies. Each pseudo
animates `transform: rotate()` about its joint (`transform-origin: 43% 31%` / `57% 31%`), because the
mask rotates with the box: `0 → -16deg → -4deg → -16deg → 0` on the left, the right delayed 300ms
and mirrored. The clip is on the class, so at rest nothing is cut.

**Risk.** The highest-reward and the most fiddly here. (a) The polygons are tuned to *this PNG*; a
new logo silently cuts the wrong leg — write the coordinates as a named comment and a browser
screenshot test. (b) At the joint the cut line crosses a 1.5px-wide stroke; rotating 16° about a
point on that line opens a sub-pixel wedge, which should be invisible at 20px but must be looked at
2.2× on the loader. (c) The painted leg must match the PNG's orange; Radius Sweep already relies on
`--highlight` equalling it, so this inherits that check rather than adding one. Reduced motion:
base style plus clip plus un-rotated legs — pixel-identical to the mark if (c) holds.

**Suits:** both. On hover the first wave lands by ~250ms; on the loader it is the most alive thing
the spider has ever done.

### 2. Double Take

**Reach:** mark.

**What the reader sees.** The spider tilts its whole body about ten degrees and leans in a hair, as
if peering at you; holds; then a quick counter-tilt the other way — a second look — and comes
upright. Curiosity, not effort: small, fast, and pointed at the reader.

**Why it's Spideryarn.** Jumping spiders really do turn and *look*: they have the best eyes of any
spider and swivel toward what interests them. A reading tool that looks back at you before helping.

**CSS mechanism.** `.logo-image` keyframes about `transform-origin: 50% 75%` (the "neck" sits low,
under the forelegs): `15% { rotate(10deg) scale(1.04) translateY(-0.5px) }`, `40% { rotate(9deg) …
}` (a settle inside the hold), `46% { rotate(12deg) }` (the anticipation — a little *more* before the
snap), `52% { rotate(-7deg) }` on a fast `cubic-bezier(.2,.9,.3,1.2)`, `58% { rotate(-5deg) }`,
`82%, 100% { none }`.

**Risk.** Shares the lean with Strain, but Strain is −15° with a `scaleX` haul and a shudder; this
is a positive tilt, a scale-*up*, and a snap. If the two still feel alike, cut the first tilt to 7°
and lean on the snap. Reduced motion: base style.

**Suits:** hover above all — it is fast enough to finish inside a 300ms hover's first half.

### 3. Hop, With a Shadow

**Reach:** mark.

**What the reader sees.** The spider crouches (squashes wide and low), springs straight up stretched
tall and thin, hangs for a beat at the top, and lands with a squash and a tiny wobble. Underneath, a
faint orange footprint shrinks as it rises and spreads as it lands — so the jump has a floor.

**Why it's Spideryarn.** A salticid's jump is the spider's signature move, and the
crouch-leap-squash is textbook animation; the contact shadow is the one detail that makes a 20px
hop read as weight rather than as an icon bobbing.

**CSS mechanism.** `.logo-image`, `transform-origin: 50% 100%` (squash from the feet): `0% none`,
`16% translateY(1px) scale(1.14, .84)` (anticipation), `30% translateY(-6px) scale(.9, 1.14)` (take-off
stretch, `ease-out`), `46% translateY(-7px) scale(1)` (apex hang, `ease-in`), `60% translateY(0)
scale(1.16, .82)` (impact), `70% scale(.95, 1.05)`, `80%, 100% none`. The footprint is
`.logo-mark::after`: absolutely positioned at `bottom: -2px; left: 20%; width: 60%; height: 2px;
border-radius: 50%`, `background: color-mix(in oklab, var(--highlight) 40%, transparent)`, resting
`opacity: 0`, keyframed in step with the image — present at 0–16%, `scaleX(.4)` and faint at the
apex, `scaleX(1.25)` at the impact frame, gone by 100%.

**Risk.** Heavy Landing was a near-miss because Dragline already spends the mark's vertical budget
*downward*; this spends it *upward* (7px against the dock's ~10px headroom) and returns to the slot,
so it is a different square. The footprint cannot be a dark shadow on the dark bar, hence a warm
footprint; if it reads as a smudge, drop it and keep the squash. Reduced motion: base style.

**Suits:** both, and it pairs well on the loader with anything on the letters that is horizontal.

### 4. Courtship Thrum

**Reach:** mark.

**What the reader sees.** The spider vibrates in a rhythm — *tap-tap … tap-tap … brrrrr* — a
fraction of a pixel each time, with the faintest warm flicker on each tap, then sits still for a
beat and repeats. Not a shiver: a signal.

**Why it's Spideryarn.** A male orb-weaver plucks the female's web in a species-specific rhythm to
announce that he is a suitor and not lunch. On the loader, beside Pluck on the letters, it reads as
the spider sending and the word trembling in reply.

**CSS mechanism.** One `.logo-image` keyframe set over 1.6s, mostly flat: taps at 2% and 8%
(`translateY(0.8px)` for one stop each, back to `none`), the same at 20% and 26%, then a buzz from
40–52% alternating `translateX(±0.6px)` every 2%. A second animation on the same element writes
`filter: drop-shadow(0 0 1.5px color-mix(in oklab, var(--highlight) 50%, transparent))` on the tap
frames only. `steps()`-free; `linear` between stops so the taps are crisp.

**Risk.** Sub-pixel jitter at 1× can read as a rendering bug on a stranger's screen — the rhythm is
what saves it, so do not let a polish pass even it out into a constant buzz. Reduced motion: base
style.

**Suits:** loader first (the pairing is the point); fine on hover.

### 5. Pholcid Whirl

**Reach:** mark.

**What the reader sees.** For half a second the spider spins itself into a blur — a tight, fast
orbit with warm smear-ghosts either side — then stops dead and is perfectly crisp again, as if
nothing happened.

**Why it's Spideryarn.** Cellar spiders (Pholcidae), threatened, whirl in their webs so fast they
become a blur nobody can grab. Comic, true, and the only idea here built on *stopping*: the crisp
still after is the payoff.

**CSS mechanism.** Two animations on `.logo-image`: `spya-whirl-orbit 70ms linear 120ms 8` cycling
`translate(1px,0) → (0,1px) → (-1px,0) → (0,-1px)`, and `spya-whirl-smear 700ms 1` on `filter`
that ramps to `blur(0.4px) drop-shadow(1.5px 0 0 color-mix(in oklab, var(--highlight) 45%,
transparent)) drop-shadow(-1.5px 0 0 color-mix(…))` and cuts back to `none` in a single stop at the
moment the orbit's last iteration ends (an abrupt stop is the joke; an eased one is a fade). Hover
plays it once; the loader repeats it every ~2s with a long rest.

**Risk.** Blur on a 20px mark is the "image failed to decode" look if it lingers — keep it under
600ms and always ending sharp. A 14Hz orbit is motion, not luminance flashing, so it is well clear
of flash thresholds, but it is the busiest thing in the set; the global reduced-motion guard
removes it entirely (base style).

**Suits:** both; best as a rare draw.

### 6. Thanatosis (Played Dead, again)

**Reach:** mark.

**What the reader sees.** The spider flinches up, tips over onto its back with a small bounce, and
goes grey. It lies there. One leg twitches. Then it rolls the rest of the way round and is upright,
orange, and entirely innocent.

**Why it's Spideryarn.** Many spiders play dead when disturbed — and the reader just poked it.

**CSS mechanism.** `.logo-image`, `transform-origin: 50% 60%`, using the individual `rotate`
property so the flip and the bounce do not fight: `10% { translate: 0 -2px; scale: 1.05 }`
(startle), `24% { rotate: 180deg; translate: 0 1px; scale: 1.06 .9 }` (lands, squashed),
`30%, 60% { rotate: 180deg; scale: 1 }`, `63% { rotate: 184deg }` (the twitch), `66% { rotate:
180deg }`, `84%, 100% { rotate: 360deg }` — visually rest, so class removal snaps invisibly. A
parallel `filter` keyframe holds `grayscale(.7) brightness(.85)` from 26–66%.

**Risk.** Deliberately re-proposed: the wildcards list killed it on "looks the same upside down",
but the shortlist's own diff found 180° visibly different (IoU 0.34), and the grey plus the twitch
carry "dead" even if the pose alone would not. It is still a full rotation, which the shortlist
warned reads as tumbling — here tumbling *is* the gag. Grey on a stranger's screen for half a
second is "disabled", not "broken". Reduced motion: base style (the 100% frame equals it anyway).

**Suits:** hover — it is a punchline; on the loader, the grey would look like an error state.

### 7. Skein

**Reach:** mark.

**What the reader sees.** Fine diagonal threads slide across the spider's body as it turns a
quarter-turn and back — it looks, for a moment, like a ball of yarn being wound — then the threads
fade and it is the spider again.

**Why it's Spideryarn.** The mark *is* one continuous strand; this lets you see it as yarn, wound,
which is the name's other half drawn on the half that is always visible.

**CSS mechanism.** `.logo-mark::after`, `inset: 0`, masked to the PNG as in Radius Sweep, with
`background: repeating-linear-gradient(-55deg, transparent 0 1.6px, var(--highlight-ink) 1.6px
2.3px)` and `background-position` animated along the stripe normal (`0 0 → 8px 0`) so the threads
slide; `opacity: 0 → .9 → 0`. The turn goes on `.logo-mark` itself (`rotate(-25deg)` and back on a
soft ease), so the image and its threads turn together.

**Risk.** At 1× a 0.7px stripe may alias into moiré; tune the period to whole pixels at 20px and
check it at 2.2×. If `--highlight-ink` is too close to `--highlight` on one theme, the threads
vanish — that theme then gets Radius Sweep's static two-tone, which is fine. Reduced motion: the
pseudo is static at `opacity: 0` by its base declaration, so base style.

**Suits:** loader first (2.2× is where the threads show); acceptable on hover.

### 8. Pacing

**Reach:** mark.

**What the reader sees.** The spider walks three pixels to the right with a tiny bob on each step,
turns round (a quick squash through edge-on), walks back past its slot to the left, turns again, and
returns to the middle. A small creature waiting for something.

**Why it's Spideryarn.** It is what a loading screen is: someone pacing while the article arrives.
On the loader it says "nearly there" without a progress bar.

**CSS mechanism.** `.logo-image` keyframes over 3s: the walk is four stops each way of
`translateX` in 0.75px increments with alternating `translateY(-0.5px) rotate(±3deg)` (the bob that
implies legs), `steps`-free but with `ease-in-out` per step; each turn is `scaleX(1) → scaleX(0.1) →
scaleX(-1)` over 120ms, so the edge-on frame is the visible "turn" — the mirror being near-identical
is what makes it a turn rather than a different icon. Ends at `translateX(0) scaleX(1)`.

**Risk.** ±3px is inside the corner's 9.6px padding and leaves 3.4px of the 6.4px gap before the
word; do not widen it. On a 300ms hover you see a step and a half — pleasant but slight, so this is
weighted to the loader. Reduced motion: base style.

**Suits:** loader, mainly. Hover is a bonus.

---

## Letters

### 9. The Shed

**Reach:** letters.

**What the reader sees.** The odd letters rise one pixel and the even letters drop one, as a loom
opens its warp; they hold; then they cross over — odds down, evens up — and finally all ten snap
level with a tiny downward knock, the reed beating the weft home.

**Why it's Spideryarn.** Weaving is the original way of making many threads into one fabric, which
is the reading the app wants: separate strands, beaten together.

**CSS mechanism.** `.logo-letter:nth-child(odd)` and `(even)` set `--shed: 1` / `-1`; one keyframe:
`0% none`, `18%, 38% translateY(calc(var(--shed) * var(--logo-px) * -1))`, `52%, 70%
translateY(calc(var(--shed) * var(--logo-px) * 1))`, `80% translateY(calc(var(--logo-px) * 0.6))`
(the beat, every letter, on a hard `cubic-bezier(.6,0,1,1)`), `88% translateY(calc(var(--logo-px) *
-0.15))`, `100% none`. No stagger: the shed opens all at once, and that is what separates it from
Pluck's travelling wave and Sag's curve. Optional: a weft drawn as each letter's own `::after`
hairline (`width: 100%`, so no word width is ever measured), `scaleX` 0→1 staggered left to right
during the crossover and gone on the beat.

**Risk.** A zigzag word is one notch from "bouncy text"; the hold frames and the beat are what make
it mechanical rather than playful, so keep them. The optional weft at x-height is a strikethrough —
place it at the baseline like the seam's thread, or drop it. Reduced motion: base style.

**Suits:** both.

### 10. Knit Row

**Reach:** letters.

**What the reader sees.** Left to right, each letter turns over once on its horizontal axis — knit
forward, purl back, alternating — like stitches being worked along a needle, and the row is
finished.

**Why it's Spideryarn.** Yarn's half of the name, made literal: the word is knitted, a stitch at a
time, in reading order.

**CSS mechanism.** `transform: perspective(calc(var(--logo-px) * 40)) rotateX(360deg)` on odd
letters and `rotateX(-360deg)` on even (the `perspective()` is what makes the two directions look
different — without it `rotateX` is just a `scaleY`), 340ms each, `animation-delay: calc(var(--i) *
55ms)`, `ease-in-out`, once. Rest at both ends is identical.

**Risk.** Each letter passes through a one-pixel sliver; with the stagger, at most two letters are
slivers at once, which reads as motion. If any frame shows four, slow the stagger. Reduced motion:
base style.

**Suits:** both.

### 11. Tension

**Reach:** letters.

**What the reader sees.** The word is pulled taut from both ends: the gaps open evenly and every
letter thins a touch, as a stretched thing does; then it is let go, overshoots — the letters crowd
a hair too close — rings once, and is still.

**Why it's Spideryarn.** Every knitter knows a yarn's tension, and every spider tests a line before
trusting it; squash and stretch applied to a string rather than a ball.

**CSS mechanism.** Per letter, `--pull: calc(var(--i) - 4.5)`; keyframe: `30%, 45%
translateX(calc(var(--pull) * var(--logo-px) * 0.35)) scaleY(.93)`, `60%
translateX(calc(var(--pull) * var(--logo-px) * -0.12)) scaleY(1.03)`, `72%
translateX(calc(var(--pull) * var(--logo-px) * 0.05))`, `84%, 100% none`. The stretch eases in
slowly (load), the release is a fast spring (follow-through). Ends move ±1.6px; nothing reflows.

**Risk.** Close kin of The Seam, which parts at one point; this parts everywhere evenly, and thins.
If the 1.6px reads as nothing at 1×, it is a loader animation only. Reduced motion: base style.

**Suits:** both; strongest on the loader.

### 12. Flick

**Reach:** letters.

**What the reader sees.** A crack travels down the word like a rope being flicked: the S barely
tips, each letter after it tips a little further, and the n at the tip snaps over about twelve
degrees and whips back — the fastest and furthest, as the end of a whip always is — then everything
rings down to rest.

**Why it's Spideryarn.** Follow-through is a thread's physics: energy put in at one end arrives
amplified at the other. Pluck already moves the word up and down; this one *rotates* it.

**CSS mechanism.** `transform-origin: 50% 100%`; `--amp: calc(var(--i) + 1)`; keyframe `20%
rotate(calc(var(--amp) * 1.2deg)) translateY(calc(var(--amp) * var(--logo-px) * -0.15))`, `40%
rotate(calc(var(--amp) * -0.6deg))`, `58% rotate(calc(var(--amp) * 0.25deg))`, `75%, 100% none`;
`animation-delay: calc(var(--i) * 30ms)`, 900ms, once.

**Risk.** Twelve degrees on the n is the visible ceiling before it looks like a dropped glyph; the
amplitude ramp, not the wave, is the idea, so if it reads as "wave" the ramp is too shallow.
Reduced motion: base style.

**Suits:** both.

---

## Top four

1. **Semaphore** — the first animation that gives the spider a *limb* and a reason to wave it, and
   it is mark-only, so it works on a phone. Fiddly geometry, but bounded: two polygons and a
   pivot, on machinery (masked overlay on `.logo-mark`) that Radius Sweep already proved.
2. **Hop, With a Shadow** — the purest motion-craft piece: anticipation, stretch, hang, squash, and a
   contact footprint that gives 20px of orange a floor to land on. Cheap, upward rather than
   Dragline's downward, and reads instantly on hover.
3. **Pacing** — made for the loader: a small creature waiting while the article arrives, with the
   near-symmetric mirror doing the turn for free.
4. **The Shed** — the letters' track needs new shapes too, and this is a genuinely new one (the
   whole word split two ways at once, then beaten level), with the loom behind it.

Runner-up: **Courtship Thrum**, for the loader pairing with Pluck — call and answer across the two
tracks.
