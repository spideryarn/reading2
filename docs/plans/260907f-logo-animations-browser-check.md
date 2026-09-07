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

---

Brief: [260907f-logo-animations-brief.md](260907f-logo-animations-brief.md) ·
Shortlist: [260907f-logo-animations-shortlist.md](260907f-logo-animations-shortlist.md) ·
The feature: [design-logo.md](../project/design-logo.md)

Up: [plans.md](../project/plans.md)
