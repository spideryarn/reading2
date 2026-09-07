# Browser check: the thirteen wordmark animations

What a Sonnet subagent found driving Chrome against the real thing on 2026-09-07, and what was
fixed as a result. Kept because three of the defects are the kind that a stylesheet cannot show you
and a unit test cannot reach — they are all a pseudo-element or a fill mode behaving exactly as
written and not as intended.

Method, and it matters: **motion was verified by sampling `getComputedStyle` across each
animation's cycle**, not from single screenshots, with cropped and upscaled captures for anything
that needed the eye (thread colour, mask clipping, cursor placement). A still of a 1.6s loop tells
you nothing, and "they all work" from one screenshot is worse than no check at all.

Tested against `a.logo.logo-home` on `/privacy` — the real corner wordmark, `position: fixed` — and
against the `/design` gallery. Chrome only; **Safari and Firefox are unverified**, which matters
for `spya-radius` alone (see below).

## The headline

**No silent no-ops.** All thirteen visibly do something, and each does the thing its entry in
[the shortlist](260907f-logo-animations-shortlist.md) describes. The two mechanisms the shortlist
flagged as most likely to have failed quietly both survive the Vite build:

- **`@property --spya-angle` genuinely interpolates** 0°→360°, confirmed by pixel-diffing two frames
  rather than by trusting the declaration. It is not sitting at the static two-tone fallback.
- **`mask-image: url(/spideryarn-logo.png)` resolves and clips to leg-shaped pixels**, not to a
  20px box — so Vite neither rewrote nor inlined the public asset.
- The 1px threads in `spya-dragline` and `spya-abseil` render as an **orange hairline**, not the
  grey smear the longlists warned about at some device-pixel ratios.

**Both layout regressions ruled out, measured continuously rather than before-and-after.** The
corner wordmark's computed `position` stayed `fixed` under all thirteen and its box stayed pinned at
(0, 0) — so `.spya-anim:not(.logo-home)` holds. Its width stayed exactly 136px under all thirteen
at desktop width, and exactly 41.59px under all thirteen at 390px, where the word is hidden.

**The long press behaves.** Press and hold ~500ms, release: the URL stays put. An ordinary short
click afterwards navigates to the library.

**At 390px** the word correctly disappears and exactly the six mark-only animations still run;
the other seven correctly do nothing, with no stray artefact where the word was.

## Four defects, all fixed

### 1. Three pseudo-elements were anchored to the whole wordmark, not to their letter

`.spya-anim .logo-letter` had `display: inline-block` but no `position`, so a `::before` or
`::after` on a letter resolved against the nearest positioned ancestor — the 136px-wide `<a>`.

Measured on the one the check happened to look at: `spya-type`'s block cursor computed
`left: 137.3px` while the `n` ended at **108.8px**, so it floated 28px past the end of the word and
outside the anchor's own box. The other two — `spya-seam`'s thread at `left: 100%` and
`spya-abseil`'s at `left: 50%` — have the same fault by the same mechanism and would each have been
found later, separately, by somebody else.

The shortlist specified `position: relative` on each host letter and it was dropped in
transcription, three times. **The fix is one line for all ten letters** rather than three for the
three that host something today: it costs nothing and retires the class of bug.

### 2. `spya-type` stranded four letters permanently dim under reduced motion

With `prefers-reduced-motion: reduce`, letters **S, a, r, n** froze at `opacity: 0.3` and stayed
there past four seconds, leaving a visibly half-faded "**S**pidery**arn**" — a rendering fault, not
the documented "faint for up to 670ms" transient. Confirmed two independent ways.

The cause was `animation-fill-mode: both`. Filling *forwards* makes the animation's 100% frame the
letter's resting value, so the wordmark's correctness depended on every one of ten animations having
reported itself finished — under a guard that flattens duration to 0.01ms while leaving delays
alone. `backwards` fills only the delay and then reverts to the **base style**, which is the fully
lit word. `spya-register`, which staggers the same way but with a continuous curve rather than
`steps()`, never showed it.

This is the file's own rule — *return to the resting state* — applied to a place where it had been
quietly waived.

### 3. The `/design` gallery misrepresented `spya-dawn`

`.design-logo-cell` is a column flex container, which stretches its items, so `.logo` became a 280px
box around 140px of content. `spya-dawn`'s mask is sized as a percentage of that box, so half the
sweep was spent crossing empty space: correct in the app, feeble in the gallery.

Fixed with `align-self: flex-start` on the wordmark rather than `align-items` on the cell, so the
caption and class name below still fill the width and wrap. **A gallery that misrepresents one of
the things it exists to show is worse than no gallery** — the page's own rule is *render the thing,
do not describe it*, and a stretched box is a description.

### 4. (Not a defect) Safari and Firefox are unchecked

Only `spya-radius` depends on anything either might not have — `@property` nested inside
`@layer app`. It degrades to a static two-tone spider rather than to a broken one, so this is worth
one look rather than a gate.

## What this check was worth

Three of the four are invisible to every other kind of check we have. The stylesheet is right in
each case — the pseudo-elements are positioned exactly as written, the fill mode does exactly what
`both` means — and the unit tests assert the seam between the registry and the stylesheet rather
than what a browser lays out. The failing thing was the gap between *what the rule says* and *what
box it resolves against*, and only a browser knows that.

## The second pass: the six reworked animations, and the dock

After [Fable's review](260907f-logo-animations-fable-review.md) changed six of the numbers, the same
method again — plus the one surface nobody had looked at.

**All six reworked animations do what they were reworked to do**, measured rather than eyeballed:

- **Pluck** genuinely skews now. At t=340ms the `S` is at +0.37px (rebounding down from its first
  swing) while the `n` is at −0.38px (starting its first rise) — opposite signs at the same instant,
  which is the thing "a travelling wave" was falsely claiming and "a decaying oscillation" gets
  honestly. The `S`'s own half-period is ~170ms, so ≈2.9Hz against the 3Hz intended.
- **Abseil**'s thread now meets the letter. `calc(0.5em - 8px)` resolves to −1.44px at 13.12px, and
  the `n`'s measured `actualBoundingBoxAscent` in Trebuchet is exactly **7px** — independently
  confirming the constant the fix was reasoned from. Residual gap **0.44px**.
- **Strain** shudders twice (−14 → −15 → −14 → −15 → −14 across 26–58%) and the letters brighten at
  exactly 58%, after it lets go, which was the beat the first version had out of order.
- **Register**'s plates are all present at t=0 on all ten letters; only the lock travels.
- **The cursor** spans 4.72px → 13.90px against Trebuchet's 5px cap and 14px baseline, and the same
  em-based values land identically under Geist.
- **The two threads** compute `matrix(1,0,0,0,0,0)` under reduced motion — `scaleY(0)`, zero
  rendered height, which is the fix for the pair that hung fully drawn.
- **The gallery** now seats the radius overlay 0.0125px from the image's own left edge (one spider,
  not two) and hangs the dragline's thread over the spider rather than in front of the `S`.

**The seam's thread was the one incomplete fix.** The curve stops it being read as an en dash — at
3× it is a visible shallow crescent in `--highlight` — but at 1× it very nearly disappears. That is
the exact outcome Fable's entry predicted and named a fallback for, so the fallback was taken: the
thread moved from x-height to just above the baseline, where a hairline reads as a stitch rather
than as either punctuation or nothing.

### And the surface nobody had looked at

Every check until now was the corner copy. The reading view's is a different typeface in a 40px bar
that clips.

- **Nothing clips and nothing adds scroll width.** `.dock`'s `scrollWidth` was identical to baseline
  across all thirteen, through their full cycles. The letter-anchored pseudo-elements all resolve
  correctly under Geist.
- **But the clearance is much tighter than documented.** The bar measured **39px**, not the 40 our
  notes assumed, and the two 8px drops clear by about **0.6px** rather than the 1.8 that was
  calculated. They still clear. The number should not be nudged without measuring it here, and
  `/design` cannot stand in — its cells clip a whole card, not a 40px strip.
- **One real break, found only in the dock.** `spya-dragline` made the word "Spideryarn" vanish
  entirely while it ran — unpainted rather than dimmed or clipped, with every computed style saying
  it should be visible, in both headless and headed Chrome, and only there: not in the corner, and
  not with any of the four other image-animating effects. It has the signature of a compositing
  fault rather than a CSS-logic one, and `spya-dragline` is the only animation with two
  independently transform-animating pieces at once.

  **The code changed underneath that measurement**, though, which is its own lesson: the thread
  moved from `.spya-dragline::before` — absolutely positioned against the whole anchor, inside a
  `.dock-home` whose `opacity: 0.85` makes a stacking context — to a 20×20 wrapper that does not
  overlap the text at all.

## The third pass: the vanishing word, and the numbers three estimates got wrong

**It does not reproduce.** Sampled at ten points across the full 1.6s cycle on a real article, with
the animations paused and seeked rather than waited on: all ten letters at `opacity: 1`, all with
non-degenerate rects, the word visibly painted in every screenshot while the spider drops and
returns. The thread now sits inside a 20×20 wrapper that starts at x≈16 while the word starts at
x≈42, so it no longer paints over the text at all — the fault was in a version of the rule that no
longer exists.

**The lesson is about the measurement, not the bug.** A browser check that runs for half an hour
against a dev server with hot reload is measuring whatever the tree happened to contain at each
moment. It found something real and reported it against code that had already been replaced. If a
finding matters, re-run it against a known commit.

**And three estimates of the vertical clearance were all wrong in the same way.** Five pixels, then
1.8, then "an estimate" — every one of them arithmetic from the keyframe's *plateau*, ignoring the
spring easing in front of it. Measured: Abseil's drop overshoots to **8.78px** around 320ms before
settling to the flat 8, and at that peak the letter's box clears the dock's 40px clip by **0.55px**;
Dragline clears by 0.60px. Nothing is cut — what clips is rendered pixels rather than boxes, and the
`n` has no descender — but the margin is half a pixel rather than the five somebody first wrote down.

One more number worth keeping straight, because two agents measured different things and both were
right: **`.dock` is 40px; the wordmark's own anchor inside it is 39px.**

---

Brief: [260907f-logo-animations-brief.md](260907f-logo-animations-brief.md) ·
Shortlist: [260907f-logo-animations-shortlist.md](260907f-logo-animations-shortlist.md) ·
Fable's review: [260907f-logo-animations-fable-review.md](260907f-logo-animations-fable-review.md) ·
Astra's review: [260907f-logo-animations-astra-review.md](260907f-logo-animations-astra-review.md) ·
The feature: [design-logo.md](../project/design-logo.md)

Up: [plans.md](../project/plans.md)
