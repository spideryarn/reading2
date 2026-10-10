# Longlist: wordmark animations from what reading deeply looks like

Up: [261010p-more-logo-animations.md](261010p-more-logo-animations.md)

One of four longlists written against
[261010p-more-logo-animations-brief.md](261010p-more-logo-animations-brief.md). **This one's framing
is the vision**: what a mind does when it reads well, acted out by a spider and ten letters.
[vision.md](../project/vision.md) lists the things to act out. Greg's list of what "deeply" means is
*"understanding it, learning, remembering, having ideas, noticing, highlighting, perhaps seeing
problems, seeing connections"*. The principles add a few more: effort goes where it is needed, the
author's text is not rewritten, and every claim can be traced to its source. Underneath all of it
is the line *"it augments human cognition, but it doesn't replace it."*

The September principles longlist
([260907f-logo-animations-longlist-principles.md](260907f-logo-animations-longlist-principles.md))
turned the product's **arguments** into pictures: the dog-ear, the compression joke, the
two-minute timer refused. This list acts out the **behaviour** of reading instead: where the eyes
stop, slowing down, going back over a line, the head tilting as a question forms, the moment
something clicks. None of these is a slogan. Each is something a reader would recognise their own
mind doing.

## The loader, and what to do with someone's attention while they wait

The loader comes **just before reading**: the reader has handed over an article and is waiting for
it. Three things follow from that.

- **Don't promise progress.** Anything that fills up, counts or ticks along looks like a progress
  bar, and a progress bar that is not tied to real progress is lying to the reader. Loops should
  look like activity, not like a meter.
- **Don't look like a notification.** A short pulse that radiates outwards means "look at me". The
  loader should do the opposite and draw attention inwards, towards the page that is about to
  appear.
- **Set the pace for slow reading.** These few seconds are the one place where the app can suggest
  the speed it hopes the reader will read at. A loader that slows down, settles or comes into
  focus does more for the next half hour than one that spins.

So several of the ideas below are built to sit beside a partner on the loader and look like a mind
**getting ready to read**: Narrowing, It Clicks, Ritardando, Line by Line.

Shared mechanics, stated once:

- Every letter is already `display: inline-block; position: relative` and has `--i` set (0–9)
  while animating, so per-letter pseudo-elements and staggers cost nothing extra.
- **`var()` inside a keyframe is resolved separately for each animated element.** So one
  `@keyframes` can move each letter by a different amount if each letter sets its own custom
  property, such as `--k: calc(var(--i) - 4.5)`. Two of the ideas below (On Balance, It Clicks)
  depend on this. It needs no `@property`, because the keyframe animates `transform`, not the
  variable.
- Mark pseudo-elements hang off `.logo-mark` (`inset: 0` is the spider's box), never `.logo-image`.

---

## 1. Fixations

- **Reach** — letters
- **What the reader sees** — A short orange underline hops across the word in three jumps:
  under `Spi`, then `der`, then `yarn`. Then it jumps **back** under `der` for a second, brighter
  look before it goes. It does not slide. It jumps from place to place, the way eyes really move
  across a line.
- **Why it's Spideryarn** — Reading is jumps and pauses, not a smooth sweep, and the jump back is
  the part a careful reader does that a skimmer does not.
- **CSS mechanism** — `.logo-letter::after` at `left: 0; right: 0; bottom: calc(var(--logo-px) * -2);
  height: 1px; background: var(--highlight); transform: scaleX(0)`. The letters sit flush with no
  gaps, so three letters' underlines join into one span. There are three keyframe sets, one per
  group (`:nth-child(-n+3)`, `(n+4):nth-child(-n+6)`, `(n+7)`), over a 1.6s loop. Each group snaps
  on (`scaleX(1)`, 40ms), holds about 200ms and snaps off, at 0–15%, 17–30% and 32–48%. The middle
  group also has a second, brighter peak at 52–64% (`opacity` 1 and a 1px glow), and every group is
  at `scaleX(0)` again by 70%. Base style is no underline, so reduced motion shows the plain
  wordmark.
- **Risk** — An underline on a link can look like the ordinary "you are hovering a link"
  underline. The hops and the jump back are what tell the two apart, so the hold times must be long
  enough to see as stops. Letterforms #13, Saccade Order, was the near idea. It brightened single
  letters in "eye order" and admitted the eye does not really jump within one short word. This one
  uses spans of three letters, which is what a single stop of the eye actually takes in.
- **Suits** — both

## 2. Ritardando

- **Reach** — letters
- **What the reader sees** — A one-pixel lift with a warm glow runs through the word quickly at
  first, then slows down letter by letter. It races through `Spid`, gets slower through `er`,
  dawdles over `yarn`, and the final `n` stays lifted longest before it settles.
- **Why it's Spideryarn** — Principle 3 is effort in the right places. Go quickly through what you
  don't need, so there is time to slow down for what you do. The reader slows down by choice, not
  because the text was hard.
- **CSS mechanism** — One keyframe set: `translateY(calc(var(--logo-px) * -1))` plus a `color` and
  `text-shadow` peak at 30%, and no 0% or 100% stop, the same as `spya-dew`. The stagger grows with
  the square of the position, `animation-delay: calc(var(--i) * var(--i) * 7ms)`, which gives 0, 7,
  28, 63 and so on up to 567ms. The durations stretch too: `animation-duration: calc(500ms +
  var(--i) * 40ms)`. Loop 1.8s on the loader, one run on hover. Reduced motion shows the base style.
- **Risk** — If the slowdown is gentle it is just another wave, and Pluck and Dew already cover
  waves. The slowdown has to be obvious, with the `n` lingering for at least four times the `S`'s
  time, or there is no point to it.
- **Suits** — both, and the loader especially, since it suggests a reading pace

## 3. The Tilt

- **Reach** — letters
- **What the reader sees** — A warm glow reads along the word and **stops at the `y`**. The `y`
  tips back a few degrees on its baseline, like a head tilting at something that doesn't quite add
  up, and holds there for a moment. Then it straightens, and the glow carries on through `arn`.
- **Why it's Spideryarn** — This is the moment a question forms, which is what "interrogate" means.
  The letter that stops is `y`, which sounds like *why*.
- **CSS mechanism** — A Dew-style colour keyframe on every letter with `animation-delay:
  calc(var(--i) * 60ms)`, plus 380ms extra on `:nth-child(n+8)` so the glow waits. Letter 7 gets
  its own keyframe: `transform-origin: 50% 85%`, then `rotate(-7deg)` from 25% to 60% of a 1.1s
  run, then back to `none`. Colour and rotation together, no box change. Loop about 2s on the
  loader. Reduced motion shows the base style.
- **Risk** — One tilted letter in the middle of a word looks like a typo if it stays there, so it
  must stay within about 7° and always end upright. The principles list's #12, Question in the
  Margin, drew a "?". This idea deliberately does not draw a glyph. The question shows in the
  posture.
- **Suits** — both; on hover the stop at the `y` lands about 400ms in, so it suits a long press
  best

## 4. It Clicks

- **Reach** — letters
- **What the reader sees** — The letters drift slightly out of line, each tipped and nudged by its
  own small amount, like a sentence that hasn't been understood yet. Then **all ten snap straight at
  the same instant**, with a single warm flash across the whole word. A still pause follows before
  it happens again.
- **Why it's Spideryarn** — This is the moment of understanding, when pieces you were holding
  separately fall into place. It is the only idea in the set where everything happens at once
  rather than in a staggered wave.
- **CSS mechanism** — Each letter gets a fixed pair of small values from its `:nth-child`, for
  example `--r: 2.5deg; --dy: calc(var(--logo-px) * -1)` on the `S` and `--r: -3deg; --dy: 0` on the
  `p`. These are hand-picked rather than generated, so the muddle looks the same every time and
  looks deliberate. Keyframes, 1.8s: `0% { transform: none }`, ease into `55% { transform:
  translateY(var(--dy)) rotate(var(--r)) }`, then a hard `cubic-bezier(.2,1.6,.4,1)` to
  `62% { transform: none; text-shadow: 0 0 calc(var(--logo-px)*4) <highlight 60%> }`, the glow
  gone by 75%, and rest until 100%. No delays: the whole point is that the snap is simultaneous.
  Reduced motion shows the base style.
- **Risk** — The muddled frame has to stay small (±3°, ±1px) or it reads as broken rendering
  rather than "not yet understood". If the hover ends mid-muddle the letters snap home, which by
  luck looks like the same click.
- **Suits** — both; on the loader it is the best single picture of what the reader is about to
  do

## 5. On Balance

- **Reach** — letters
- **What the reader sees** — The word tips like a beam on a pivot. The `S` end dips while the `n`
  end rises, then it tips the other way, less, and settles level. Each letter leans slightly with
  the beam, so the word looks like one rigid object being weighed.
- **Why it's Spideryarn** — This is weighing a claim, reading as a referee would, with the
  judgement going one way and then the other before it settles. Sag is the word under a load; this
  is the word making up its mind.
- **CSS mechanism** — `--k: calc(var(--i) - 4.5)` on each letter, which gives values from −4.5 to
  +4.5. One keyframe set: `20% { transform: translateY(calc(var(--k) * var(--logo-px) * -0.5))
  rotate(-1.5deg) }`, `45%` with the opposite sign at 0.35 strength, `68%` at 0.15, and `85%, 100%
  { transform: none }`. The ends move about 2.3px at most, well within budget. Because `var()`
  resolves per letter, one `@keyframes` drives all ten. 1.6s. Reduced motion shows the base style.
- **Risk** — The pivot is between `d` and `e`, not between `Spider` and `yarn`, so it tips about
  the middle of the word rather than about the meaning. That is fine visually, and moving the pivot
  is one number. Without the per-letter `rotate` it reads as a ripple, not a beam, so the lean is
  needed.
- **Suits** — both

## 6. Turn the Page

- **Reach** — letters
- **What the reader sees** — A page turn runs across the word from left to right. Each letter in
  turn narrows to a thin edge, as if seen side on, and widens back, with two or three letters on
  the turn at any moment. The word that comes back is the same word.
- **Why it's Spideryarn** — This is the moment before reading, and the text that comes back is
  unchanged (principle 5, no hidden reformulation). Turning the page does not rewrite it.
- **CSS mechanism** — `transform: perspective(calc(var(--logo-px) * 60)) rotateY(0 → 80deg → 0)`,
  stopping short of edge-on, so a letter never disappears. Stagger `calc(var(--i) * 70ms)`, run
  600ms, loop 1.6s. The September tech longlist's `sy-flip` went to 180° and stalled because it
  needed something to show on the back face. Stopping at 80° means there is no back face to design.
  Reduced motion shows the base style.
- **Risk** — A letter squeezed to 20% width for a frame can look like a font glitch on a nav link.
  This needs a real look at 13px before anyone commits to it. It is much safer at the loader's 2.2×.
- **Suits** — loader; borderline on hover

## 7. In Quotes

- **Reach** — letters
- **What the reader sees** — Orange curly quotation marks slide in a pixel or two from outside the
  word, `“` before the `S` and `”` after the `n`, and hold there for a moment. The word between
  them doesn't move at all. Then they fade away.
- **Why it's Spideryarn** — Quoting is the opposite of summarising: the words are kept exactly as
  the author wrote them, with a mark around them. This idea is Quotes mode and principle 5 in one
  gesture.
- **CSS mechanism** — `:nth-child(1)::before { content: "\201C"; right: 100%; top:
  calc(var(--logo-px) * -2) }` and `:nth-child(10)::after { content: "\201D"; left: 100% }`, both
  `color: var(--highlight-text); opacity: 0`. Keyframes: `opacity` 0→1 and `translateX` from ±2
  logo-px to 0, over 0–25%, hold until 70%, fade by 90%. The base style is invisible, so reduced
  motion shows the plain wordmark.
- **Risk** — The opening mark sits in the gap between spider and `S`, and that gap is small in the
  corner copy, so check it doesn't touch the spider. Raising it to the top edge, where quotation
  marks sit anyway, helps. The glyph is drawn in whatever face the letter has, and Trebuchet's curly
  quotes differ from Geist's, which is acceptable.
- **Suits** — both

## 8. Line by Line

- **Reach** — mark
- **What the reader sees** — The spider reads. It turns in small ticks, left, left-centre,
  right-centre, right, pausing at each one, like eyes stopping along a line. Then it swings back
  and drops a pixel for the next line, and does it again. After three lines it rises back to where
  it started.
- **Why it's Spideryarn** — This is the mascot doing what the app is for, slowly and in order, one
  line after another. It works on a phone, where the word is hidden and only the spider shows.
- **CSS mechanism** — `.logo-image` keyframes over 2.4s, in three 33% blocks. Within each block
  four stops are held by putting pairs of keyframes at the same value: `rotate(-5deg)`,
  `rotate(-1.5deg)`, `rotate(1.5deg)`, `rotate(5deg)`, then a quick smooth return to `-5deg` while
  `translateY` steps 0 → 1px → 2px from block to block. The last 8% eases back to `none`. Reduced
  motion shows the base style.
- **Risk** — The spider has no obvious front at 20px, so the ticks might read as twitching rather
  than looking. The pauses and the drop to a new line are what make it read as reading, so keep
  them clear. It overlaps a little with Settle's lean, but that is a single transition and this is
  a rhythm.
- **Suits** — both; the loader especially, beside any letters partner, where it looks like the
  spider is reading its own name

## 9. Narrowing

- **Reach** — mark
- **What the reader sees** — A faint orange ring appears well outside the spider and **shrinks**
  onto it, fading as it closes in, then another follows. It is the reverse of a sonar ping:
  attention closing in on one thing instead of spreading out.
- **Why it's Spideryarn** — Attention, and the loader's job: draw the reader in, not call out to
  them. A ring spreading outwards is a notification. A ring closing in is concentration.
- **CSS mechanism** — `.logo-mark::before { inset: -2px; border: 1px solid var(--highlight);
  border-radius: 50%; opacity: 0; transform: scale(1.8) }`. Keyframes over 1.5s:
  `0% { scale(1.8); opacity: 0 }`, `30% { opacity: 0.55 }`, `80% { scale(1); opacity: 0 }`, and stay
  there. Infinite. On the loader a second ring can come from `::after` half a cycle later. Base
  style is invisible, so reduced motion shows the plain mark.
- **Risk** — At 1.8× the ring is about 43px across, a hair taller than the 40px bar, but it is
  nearly transparent at that size, so the clipping won't show. If it is timed too fast it looks
  like a pulse, so keep it at 1.5s or slower.
- **Suits** — loader first; fine on hover

## 10. Making a Note

- **Reach** — mark
- **What the reader sees** — The spider dips and tips forward like a pen nib touching the page,
  and a short orange stroke draws itself underneath, left to right. The spider lifts. The stroke
  stays a moment and fades.
- **Why it's Spideryarn** — A deep reader takes notes. This is Comments and highlighting, done by
  the spider in its own margin, as the reader's own act rather than something done for them.
- **CSS mechanism** — `.logo-image`: `translateY(1px) rotate(-10deg)` from 15% to 45%, `none` by
  60%, 1.6s. `.logo-mark::after { left: 10%; right: 10%; bottom: -3px; height: 1px; background:
  var(--highlight); transform: scaleX(0); transform-origin: left }`, `scaleX(1)` from 20% to 45%,
  holding until 75% and then fading by `opacity` until 95%. Reduced motion shows the base style.
- **Risk** — The 3px below the mark has to fit the bar. It does: the spider is about 21px tall in a
  40px bar. The principles list's Friend's Tick and Marginalia put their marks by the letters. This
  one is mark-only and the spider is the one writing, which is the point.
- **Suits** — both

## 11. Taking It In

- **Reach** — mark
- **What the reader sees** — A small orange bead sits just right of the spider, in the gap before
  the word. It drifts into the spider's centre, getting smaller, and is gone. The spider glows once
  along its legs, as if it had swallowed the bead.
- **Why it's Spideryarn** — This is internalising: what the reader takes from the page and keeps.
  Learn mode's question is what you took from it, and this is that, in miniature.
- **CSS mechanism** — `.logo-mark::before`: a 3px circle, `left: calc(100% + 2px); top: calc(50%
  - 1.5px)`, then `translateX(-12px) scale(0.2)` from 0% to 45% with `opacity` falling to 0. The
  glow on `.logo-image` is `filter: drop-shadow(0 0 2px var(--highlight))` peaking at 55% and gone
  by 80%. `drop-shadow` follows the PNG's alpha, so the glow is leg-shaped for free. 1.4s.
  Reduced motion: the base style hides the bead, so the plain mark shows.
- **Risk** — The bead sits in the gap, where a letters partner on the loader might be glowing too.
  That is fine but could be busy. The principles list's #3, Yarn Out, Yarn Back, also has a thread
  going out from the spider and coming back. This idea is about the swallow, not the thread.
- **Suits** — both

## 12. Turn It Over

- **Reach** — mark
- **What the reader sees** — The spider flips once top over bottom, a full turn about a horizontal
  axis, like a coin turned over in the fingers to look at the other side, and lands exactly as it
  was.
- **Why it's Spideryarn** — This is interrogating, turning a claim over to look at its underside.
  It is also the only idea here that treats the mark as an object to examine rather than a
  creature.
- **CSS mechanism** — `.logo-image`: `transform: perspective(60px) rotateX(0 → 360deg)`, eased
  `cubic-bezier(.5,0,.3,1)` over 900ms, then a pause to 1.6s on the loader. It finishes at 360°,
  which looks the same as 0°, so unlike Six-fold Turn (cut because it left the spider askew) it
  ends at rest. Reduced motion shows the base style.
- **Risk** — At 90° the spider is a thin line for a frame or two, which on a 20px hover could look
  like it blinked out. On the loader it reads as a flip. It shares the "spider gets thrown" worry
  that sank The Letters Don't Care's tumble, but the move is slower and has one axis, so it should
  look deliberate. Check it on screen.
- **Suits** — loader first; hover acceptable

## 13. Dwell

- **Reach** — mark
- **What the reader sees** — The longer you point at the spider, the warmer it gets. A soft glow
  gathers along the legs: visibly in the first 300ms, still growing at two seconds, and then it
  holds. Move away and it is gone.
- **Why it's Spideryarn** — This is Reading time mode, the record of where you spent your
  attention, made into a single small object. Time given becomes warmth, with no counter and no
  streak.
- **CSS mechanism** — `.logo-image` with `animation: spya-dwell 3s cubic-bezier(.1,.7,.3,1) 1
  forwards`, from `filter: none` to `filter: drop-shadow(0 0 1px var(--highlight))
  drop-shadow(0 0 3px <highlight 50%>) saturate(1.15)`. The 100% frame is a warm, glowing spider,
  which is a still worth shipping, so `forwards` is allowed, and reduced motion lands on that
  frame.
- **Risk** — It doesn't loop, so it cannot join a loader track. It is a hover and long-press idea
  only. It is also close to Warm Drift, but Warm Drift breathes in and out and this only builds up.
  If one of the two goes, keep the one with the idea behind it.
- **Suits** — hover only

---

## Top 4

1. **It Clicks** (letters). It is the moment of understanding, the thing the whole product is
   for, shown as everything snapping at once. Nothing in the existing fourteen is simultaneous.
   Every letters animation there is a wave. It is cheap: one keyframe and ten hand-picked pairs of
   values.
2. **Line by Line** (mark). It shows the spider reading, and it works on a phone where only the
   spider shows. On the loader it pairs with any letters track as "the spider reading its own name".
3. **On Balance** (letters). It is a referee weighing a claim. It is a new shape, a rigid tilting
   beam, unlike Sag's curve or Pluck's ripple, it stays within budget, and the per-letter `var()`
   makes it one keyframe set.
4. **Narrowing** (mark). It answers the brief's question about the loader directly: attention
   closing in rather than a signal going out. It is also the only idea that draws a shape around
   the spider (a ring) rather than moving or lighting the spider itself.

**Honourable mentions**: **Fixations**, the only one that acts out how eyes really move across text,
jump back included, and is a close fifth. **Turn It Over** is the most fun on the loader, but only
the loader. Pairing note: It Clicks with Narrowing is the best two-track loader moment on this
list. Attention gathers on the mark while understanding snaps into place in the word.
